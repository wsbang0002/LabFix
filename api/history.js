import { Redis } from '@upstash/redis';
import { createHmac, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import net from 'node:net';

const COOKIE_NAME = 'labfix_sid';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90;
const RATE_WINDOW_SECONDS = 60;
const MAX_IP_REQUESTS = 120;
const MAX_SESSION_WRITES = 30;
const MAX_RECORDS = 30;
const MAX_RECORD_BYTES = 32 * 1024;

const ENV_KEYS = {
  arduino: ['os', 'board', 'ide', 'stage', 'port', 'recognized', 'extra'],
  python: ['os', 'ver', 'tool', 'venv', 'stage', 'cmd']
};

const RATE_LIMIT_SCRIPT = [
  "local current = redis.call('INCR', KEYS[1])",
  "if tonumber(current) == 1 then",
  "  redis.call('EXPIRE', KEYS[1], ARGV[1])",
  "end",
  "return current"
].join('\n');

const CREATE_RECORD_SCRIPT = [
  "if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1 then return -2 end",
  "local count = redis.call('HLEN', KEYS[1])",
  "if count >= tonumber(ARGV[3]) then return -1 end",
  "redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])",
  "redis.call('EXPIRE', KEYS[1], ARGV[4])",
  "return 1"
].join('\n');

const UPDATE_RECORD_SCRIPT = [
  "if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then return 0 end",
  "redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])",
  "redis.call('EXPIRE', KEYS[1], ARGV[3])",
  "return 1"
].join('\n');

function json(res, status, payload) {
  res.setHeader?.('Cache-Control', 'no-store, private');
  res.setHeader?.('Vary', 'Cookie');
  return res.status(status).json(payload);
}

function getHeader(req, name) {
  const headers = req.headers || {};
  return headers[name.toLowerCase()] ?? headers[name] ?? '';
}

function getClientIp(req, env) {
  const forwarded = env.VERCEL === '1' ? getHeader(req, 'x-vercel-forwarded-for') : '';
  const candidates = [forwarded, req.socket?.remoteAddress];
  for (const value of candidates) {
    if (typeof value !== 'string') continue;
    const ip = value.trim();
    if (!ip || net.isIP(ip) === 0) continue;
    if (net.isIP(ip) === 4) return ip;
    return new URL('http://[' + ip + ']/').hostname.slice(1, -1);
  }
  return 'unknown-ip';
}

function parseCookies(header) {
  const result = {};
  if (typeof header !== 'string') return result;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key && value) result[key] = value;
  }
  return result;
}

function signSession(sessionId, expiresAt, secret) {
  const payload = sessionId + '.' + expiresAt;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + signature;
}

function verifySession(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 300) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [sessionId, expiryText, signature] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  if (!/^\d{10,13}$/.test(expiryText)) return null;
  const expiresAt = Number(expiryText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + SESSION_TTL_SECONDS * 1000 + 60000) return null;
  const expected = createHmac('sha256', secret).update(sessionId + '.' + expiryText).digest();
  let supplied;
  try {
    supplied = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  return { id: sessionId, expiresAt };
}

function cookieHeader(sessionId, secret, env, now = Date.now()) {
  const expiresAt = now + SESSION_TTL_SECONDS * 1000;
  const token = signSession(sessionId, expiresAt, secret);
  const secure = env.NODE_ENV === 'production' || env.VERCEL === '1' || env.VERCEL_ENV === 'production';
  return COOKIE_NAME + '=' + token +
    '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + SESSION_TTL_SECONDS +
    (secure ? '; Secure' : '');
}

function originIsSameSite(req) {
  const origin = getHeader(req, 'origin');
  if (typeof origin !== 'string' || !origin) return false;
  const host = getHeader(req, 'host');
  if (typeof host !== 'string' || !host) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function safeText(value, max, field, optional = false) {
  if (value === undefined && optional) return '';
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(field + ' 형식이 올바르지 않거나 허용 길이를 초과했습니다.');
  }
  return value;
}

function normalizeRecord(input, { id, createdAt, updatedAt }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('기록 객체가 필요합니다.');
  if (!['arduino', 'python'].includes(input.envType)) throw new Error('지원하지 않는 개발 환경입니다.');
  if (!['pending', 'solved', 'unsolved'].includes(input.resolutionStatus)) throw new Error('해결 상태가 올바르지 않습니다.');
  if (!input.environment || typeof input.environment !== 'object' || Array.isArray(input.environment)) {
    throw new Error('환경 정보가 올바르지 않습니다.');
  }
  if (!Array.isArray(input.checkSteps) || input.checkSteps.length > 20) throw new Error('점검 단계 형식이 올바르지 않습니다.');

  const environment = {};
  for (const key of ENV_KEYS[input.envType]) {
    if (input.environment[key] !== undefined) environment[key] = safeText(input.environment[key], 1000, '환경 정보', true);
  }

  const checkSteps = input.checkSteps.map((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error('점검 단계 ' + (index + 1) + ' 형식이 올바르지 않습니다.');
    const stepNumber = Number(step.step);
    if (!Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > 20) throw new Error('점검 단계 번호가 올바르지 않습니다.');
    const status = step.status || '미시도';
    if (!['미시도', '효과 있음', '효과 없음'].includes(status)) throw new Error('점검 단계 상태가 올바르지 않습니다.');
    return {
      step: stepNumber,
      title: safeText(step.title, 300, '점검 단계 제목'),
      desc: safeText(step.desc, 2000, '점검 내용', true),
      why: safeText(step.why, 2000, '점검 이유', true),
      expect: safeText(step.expect, 2000, '예상 결과', true),
      note: safeText(step.note, 2000, '주의 사항', true),
      status
    };
  });

  const includeRawData = input.includeRawData === true;
  const record = {
    id,
    createdAt,
    updatedAt,
    envType: input.envType,
    title: safeText(input.title, 120, '문제 제목'),
    os: safeText(input.os, 100, '운영체제'),
    environment,
    errorType: safeText(input.errorType || '', 200, '오류 유형', true),
    summary: safeText(input.summary, 5000, '오류 요약'),
    checkSteps,
    resolutionStatus: input.resolutionStatus,
    resolutionMemo: safeText(input.resolutionMemo || '', 2000, '해결 메모', true),
    analysisSource: safeText(input.analysisSource || '', 200, '분석 출처', true),
    includeRawData,
    rawLog: includeRawData ? safeText(input.rawLog || '', 10000, '원본 로그', true) : '',
    rawCode: includeRawData ? safeText(input.rawCode || '', 5000, '원본 코드', true) : ''
  };

  if (Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_RECORD_BYTES) {
    throw new Error('기록 크기가 허용 한도(32KB)를 초과했습니다.');
  }
  return record;
}

function parseStoredRecord(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('저장 기록 형식 오류');
  return parsed;
}

export function createHistoryHandler(options = {}) {
  const redisFactory = options.redisFactory || ((url, token) => new Redis({ url, token }));
  const getEnv = options.getEnv || (() => process.env);
  const now = options.now || (() => Date.now());

  return async function historyHandler(req, res) {
    const env = getEnv();
    const method = req.method || 'GET';
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      res.setHeader?.('Allow', 'GET, POST, PUT, PATCH, DELETE');
      return json(res, 405, { success: false, error: '지원하지 않는 요청 방식입니다.' });
    }

    const secret = env.HISTORY_SESSION_SECRET;
    const redisUrl = env.UPSTASH_REDIS_REST_URL;
    const redisToken = env.UPSTASH_REDIS_REST_TOKEN;
    if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32 ||
        typeof redisUrl !== 'string' || !redisUrl.startsWith('https://') ||
        typeof redisToken !== 'string' || !redisToken) {
      return json(res, 503, {
        success: false,
        error: 'History 저장 서버 설정이 완료되지 않았습니다. HISTORY_SESSION_SECRET과 Upstash Redis 환경변수를 확인해 주세요.'
      });
    }

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      if (!originIsSameSite(req) || getHeader(req, 'sec-fetch-site') === 'cross-site') {
        return json(res, 403, { success: false, error: '요청 출처를 확인할 수 없어 작업을 차단했습니다. 페이지를 새로고침해 주세요.' });
      }
    }

    const cookies = parseCookies(getHeader(req, 'cookie'));
    const existing = verifySession(cookies[COOKIE_NAME], secret, now());
    const sessionId = existing?.id || randomUUID();
    const shouldSetCookie = !existing || existing.expiresAt < now() + 30 * 24 * 60 * 60 * 1000;

    try {
      const redis = redisFactory(redisUrl, redisToken);
      if (shouldSetCookie) res.setHeader?.('Set-Cookie', cookieHeader(sessionId, secret, env, now()));

      const ip = getClientIp(req, env);
      const ipBucket = createHash('sha256').update(ip).digest('hex').slice(0, 32);
      const ipCount = Number(await redis.eval(RATE_LIMIT_SCRIPT, ['labfix:history:rate:ip:' + ipBucket], [RATE_WINDOW_SECONDS]));
      if (!Number.isSafeInteger(ipCount) || ipCount < 1) throw new Error('Invalid IP rate counter');
      if (ipCount > MAX_IP_REQUESTS) {
        return json(res, 429, { success: false, error: 'History 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
      }

      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const sessionCount = Number(await redis.eval(RATE_LIMIT_SCRIPT, ['labfix:history:rate:session:' + sessionId], [RATE_WINDOW_SECONDS]));
        if (!Number.isSafeInteger(sessionCount) || sessionCount < 1) throw new Error('Invalid session rate counter');
        if (sessionCount > MAX_SESSION_WRITES) {
          return json(res, 429, { success: false, error: '기록 변경 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
        }
      }

      const recordsKey = 'labfix:history:v1:' + sessionId;
      if (method === 'GET') {
        const stored = await redis.hgetall(recordsKey) || {};
        const records = Object.values(stored).map(parseStoredRecord)
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        if (records.length) await redis.expire(recordsKey, SESSION_TTL_SECONDS);
        return json(res, 200, { success: true, storage: 'upstash', identity: 'anonymous-browser', records, count: records.length });
      }

      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json(res, 400, { success: false, error: 'JSON 객체가 필요합니다.' });
      }

      if (method === 'POST') {
        const recordId = 'rec_' + randomUUID();
        const timestamp = new Date(now()).toISOString();
        const record = normalizeRecord(body.record, { id: recordId, createdAt: timestamp, updatedAt: timestamp });
        const result = Number(await redis.eval(
          CREATE_RECORD_SCRIPT,
          [recordsKey],
          [recordId, JSON.stringify(record), MAX_RECORDS, SESSION_TTL_SECONDS]
        ));
        if (result === -1) return json(res, 409, { success: false, error: '브라우저별 최대 30개까지 기록할 수 있습니다. 기존 기록을 삭제한 후 다시 시도해 주세요.' });
        if (result !== 1) throw new Error('History create operation failed');
        return json(res, 201, { success: true, storage: 'upstash', record });
      }

      if (method === 'PUT') {
        if (typeof body.record?.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.record.id)) {
          return json(res, 400, { success: false, error: '수정할 기록 ID가 올바르지 않습니다.' });
        }
        const existingRaw = await redis.hget(recordsKey, body.record.id);
        if (!existingRaw) return json(res, 404, { success: false, error: '수정할 기록을 찾을 수 없습니다.' });
        const existingRecord = parseStoredRecord(existingRaw);
        const record = normalizeRecord(body.record, {
          id: existingRecord.id,
          createdAt: existingRecord.createdAt,
          updatedAt: new Date(now()).toISOString()
        });
        const updated = Number(await redis.eval(
          UPDATE_RECORD_SCRIPT,
          [recordsKey],
          [record.id, JSON.stringify(record), SESSION_TTL_SECONDS]
        ));
        if (updated !== 1) return json(res, 404, { success: false, error: '수정할 기록을 찾을 수 없습니다.' });
        return json(res, 200, { success: true, storage: 'upstash', record });
      }

      if (method === 'PATCH') {
        if (typeof body.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.id)) {
          return json(res, 400, { success: false, error: '수정할 기록 ID가 올바르지 않습니다.' });
        }
        const raw = await redis.hget(recordsKey, body.id);
        if (!raw) return json(res, 404, { success: false, error: '수정할 기록을 찾을 수 없습니다.' });
        const existingRecord = parseStoredRecord(raw);
        if (!['pending', 'solved', 'unsolved'].includes(body.resolutionStatus) ||
            typeof body.resolutionMemo !== 'string' || body.resolutionMemo.length > 2000) {
          return json(res, 400, { success: false, error: '해결 상태 또는 메모 형식이 올바르지 않습니다.' });
        }
        if (body.resolutionStatus === 'solved' && !body.resolutionMemo.trim() &&
            !existingRecord.checkSteps.some(step => step.status === '효과 있음')) {
          return json(res, 400, { success: false, error: '해결됨으로 변경하려면 해결 메모 또는 효과가 있었던 점검 단계가 필요합니다.' });
        }
        const record = { ...existingRecord, resolutionStatus: body.resolutionStatus, resolutionMemo: body.resolutionMemo.trim(), updatedAt: new Date(now()).toISOString() };
        await redis.eval(UPDATE_RECORD_SCRIPT, [recordsKey], [record.id, JSON.stringify(record), SESSION_TTL_SECONDS]);
        return json(res, 200, { success: true, storage: 'upstash', record });
      }

      if (method === 'DELETE') {
        if (body.all === true) {
          const existingRecords = await redis.hgetall(recordsKey) || {};
          const count = Object.keys(existingRecords).length;
          await redis.del(recordsKey);
          return json(res, 200, { success: true, deleted: count, count: 0 });
        }
        if (typeof body.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.id)) {
          return json(res, 400, { success: false, error: '삭제할 기록 ID가 올바르지 않습니다.' });
        }
        const deleted = Number(await redis.hdel(recordsKey, body.id));
        if (!deleted) return json(res, 404, { success: false, error: '삭제할 기록을 찾을 수 없습니다.' });
        return json(res, 200, { success: true, deleted: 1 });
      }

      return json(res, 405, { success: false, error: '지원하지 않는 요청 방식입니다.' });
    } catch (error) {
      // Do not log request bodies, cookies, API keys, or stored user records.
      return json(res, 503, { success: false, error: 'History 저장소에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' });
    }
  };
}

export const verifySessionCookie = verifySession;
export const normalizeHistoryRecord = normalizeRecord;
export default createHistoryHandler();
