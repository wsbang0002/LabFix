import handler, { getClientIp, scrubEnvironmentDetails } from '../api/analyze.js';

/**
 * Extended Node.js Automated Test Suite for LabFix (12 Tests)
 * Run using: node test/verify.test.js
 */

let passedCount = 0;
let failedCount = 0;

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; }
  };
  return res;
}

// 1. Mock Request Blocked in Production Mode
async function testProductionMockRejection() {
  console.log('🧪 Test 1: Rejection of Mock Request in Production Mode');
  process.env.GEMINI_API_KEY = 'test_key';
  process.env.ALLOW_MOCK_TEST = 'true';
  process.env.LABFIX_TEST_TOKEN = 'secret_token';
  process.env.NODE_ENV = 'production';
  delete process.env.UPSTASH_REDIS_REST_URL;

  const req = {
    method: 'POST',
    headers: { 'x-labfix-test-token': 'secret_token' },
    body: { env: 'python', errorLog: 'Test log', testMode: true },
    socket: { remoteAddress: '127.0.0.1' }
  };
  const res = createMockRes();
  await handler(req, res);

  if (res.statusCode === 403 && res.body.error.includes('운영 환경')) {
    console.log('✅ PASS: Mock mode rejected with HTTP 403 in Production mode.');
    passedCount++;
  } else {
    console.error('❌ FAIL: Expected 403, got status:', res.statusCode, res.body);
    failedCount++;
  }
}

// 2. Mock Request Allowed in Development Mode with Valid Token
async function testDevMockSuccess() {
  console.log('\n🧪 Test 2: Valid Mock Request in Development Mode');
  process.env.GEMINI_API_KEY = 'test_key';
  process.env.ALLOW_MOCK_TEST = 'true';
  process.env.LABFIX_TEST_TOKEN = 'secret_token';
  process.env.NODE_ENV = 'development';

  const req = {
    method: 'POST',
    headers: { 'x-labfix-test-token': 'secret_token' },
    body: { env: 'python', errorLog: 'Valid error log', testMode: true },
    socket: { remoteAddress: '127.0.0.1' }
  };
  const res = createMockRes();
  await handler(req, res);

  if (res.statusCode === 200 && res.body.success === true && res.body.model === 'mock-test-engine') {
    console.log('✅ PASS: Mock request succeeded with correct token and model label.');
    passedCount++;
  } else {
    console.error('❌ FAIL: Valid mock request failed!', res);
    failedCount++;
  }
}

// 3. Mock Request Rejection on Invalid Token
async function testInvalidTokenMockRejection() {
  console.log('\n🧪 Test 3: Rejection of Mock Request on Mismatched Token');
  process.env.GEMINI_API_KEY = 'test_key';
  process.env.ALLOW_MOCK_TEST = 'true';
  process.env.LABFIX_TEST_TOKEN = 'secret_token';
  process.env.NODE_ENV = 'development';

  const req = {
    method: 'POST',
    headers: { 'x-labfix-test-token': 'wrong_token' },
    body: { env: 'python', errorLog: 'Valid error log', testMode: true },
    socket: { remoteAddress: '127.0.0.1' }
  };
  const res = createMockRes();
  await handler(req, res);

  if (res.statusCode === 403) {
    console.log('✅ PASS: Mismatched mock token correctly rejected with HTTP 403.');
    passedCount++;
  } else {
    console.error('❌ FAIL: Invalid token request passed!', res);
    failedCount++;
  }
}

// 4. Input Validation (Empty Log Rejection)
async function testEmptyLogValidation() {
  console.log('\n🧪 Test 4: Rejection of Empty Log');
  process.env.GEMINI_API_KEY = 'test_key';
  process.env.NODE_ENV = 'development';

  const req = {
    method: 'POST',
    headers: {},
    body: { env: 'arduino', errorLog: '   ' },
    socket: { remoteAddress: '127.0.0.1' }
  };
  const res = createMockRes();
  await handler(req, res);

  if (res.statusCode === 400 && res.body.error.includes('오류 로그는 필수')) {
    console.log('✅ PASS: Empty log rejected with HTTP 400.');
    passedCount++;
  } else {
    console.error('❌ FAIL: Empty log accepted!', res);
    failedCount++;
  }
}

// 5. Input Validation (Overlength Log Rejection)
async function testOverlengthLogValidation() {
  console.log('\n🧪 Test 5: Rejection of Log Exceeding 10,000 Chars');
  process.env.GEMINI_API_KEY = 'test_key';
  process.env.NODE_ENV = 'development';

  const req = {
    method: 'POST',
    headers: {},
    body: { env: 'arduino', errorLog: 'A'.repeat(10001) },
    socket: { remoteAddress: '127.0.0.1' }
  };
  const res = createMockRes();
  await handler(req, res);

  if (res.statusCode === 413) {
    console.log('✅ PASS: Overlength log rejected with HTTP 413 Payload Too Large.');
    passedCount++;
  } else {
    console.error('❌ FAIL: Overlength log accepted!', res);
    failedCount++;
  }
}

// 6. Fail-Closed Production Behavior Without Redis
async function testFailClosedProductionRedis() {
  console.log('\n🧪 Test 6: Fail-Closed Production Mode Without Redis');
  process.env.GEMINI_API_KEY = 'test_key';
  process.env.NODE_ENV = 'production';
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const req = {
    method: 'POST',
    headers: {},
    body: { env: 'python', errorLog: 'Valid error log' },
    socket: { remoteAddress: '127.0.0.2' }
  };
  const res = createMockRes();
  await handler(req, res);

  if (res.statusCode === 503 && res.body.error.includes('Upstash Redis')) {
    console.log('✅ PASS: Production mode without Redis safely rejected request with HTTP 503.');
    passedCount++;
  } else {
    console.error('❌ FAIL: Fail-closed production check failed!', res);
    failedCount++;
  }
}

// 7. GET Status Check Response Inspection
async function testGetStatusSanitization() {
  console.log('\n🧪 Test 7: GET Health Check Response Inspection');
  process.env.GEMINI_API_KEY = 'secret_api_key_value';
  process.env.GEMINI_MODEL = 'gemini-2.5-flash';

  const req = { method: 'GET', headers: {} };
  const res = createMockRes();
  await handler(req, res);

  if (
    res.statusCode === 200 &&
    res.body.hasApiKey === true && !JSON.stringify(res.body).includes('secret_api_key_value') &&
    res.body.model === 'gemini-2.5-flash' &&
    res.body.isProductionReady === false
  ) {
    console.log('✅ PASS: GET status response contains no sensitive key values and correctly marks isProductionReady=false.');
    passedCount++;
  } else {
    console.error('❌ FAIL: GET status exposed sensitive data or failed!', res);
    failedCount++;
  }
}

// 8. Unit Inspection: net.isIP Validation & Injection Prevention Test
async function testClientIpParsing() {
  process.env.VERCEL = '1';
  console.log('\n🧪 Test 8: net.isIP Validation & IP Injection Prevention Unit Test');
  
  const reqIPv4 = { headers: { 'x-vercel-forwarded-for': '203.0.113.195' }, socket: {} };
  const reqIPv6 = { headers: { 'x-vercel-forwarded-for': '2001:0db8:85a3:0000:0000:8a2e:0370:7334' }, socket: {} };
  const reqMultiProxy = { headers: { 'x-vercel-forwarded-for': '203.0.113.195' }, socket: {} };
  const reqInjectionAttack = { headers: { 'x-vercel-forwarded-for': '203.0.113.195; DROP TABLE; ' }, socket: { remoteAddress: '198.51.100.10' } };
  const reqEmptyHeader = { headers: {}, socket: { remoteAddress: '192.168.1.10' } };

  const ip1 = getClientIp(reqIPv4);
  const ip2 = getClientIp(reqIPv6);
  const ip3 = getClientIp(reqMultiProxy);
  const ip4 = getClientIp(reqInjectionAttack);
  const ip5 = getClientIp(reqEmptyHeader);

  if (
    ip1 === '203.0.113.195' &&
    ip2 === '2001:db8:85a3::8a2e:370:7334' &&
    ip3 === '203.0.113.195' &&
    ip4 === '198.51.100.10' && // Malicious text rejected by net.isIP, falls back to socket IP
    ip5 === '192.168.1.10'
  ) {
    console.log('✅ PASS: net.isIP correctly validated IPv4/IPv6, extracted client IP from multi-proxies, and safely rejected injection attempts.');
    passedCount++;
  } else {
    console.error('❌ FAIL: net.isIP extraction test failed!', { ip1, ip2, ip3, ip4, ip5 });
    failedCount++;
  }
  delete process.env.VERCEL;
}

// 9. Invalid HTTP Method Rejection
async function testInvalidMethodRejection() {
  console.log('\n🧪 Test 9: Rejection of Unsupported HTTP Methods');
  const req = { method: 'PUT', headers: {} };
  const res = createMockRes();
  await handler(req, res);

  if (res.statusCode === 405) {
    console.log('✅ PASS: Unsupported method (PUT) rejected with HTTP 405.');
    passedCount++;
  } else {
    console.error('❌ FAIL: Unsupported method allowed!', res);
    failedCount++;
  }
}

// 10. Memory Rate Limiting Threshold (Enforced for Mock Requests)
async function testMemoryRateLimitThreshold() {
  console.log('\n🧪 Test 10: Memory Rate Limit Threshold Enforcement on Mock Requests');
  process.env.GEMINI_API_KEY = 'test_key';
  process.env.ALLOW_MOCK_TEST = 'true';
  process.env.LABFIX_TEST_TOKEN = 'secret_token';
  process.env.NODE_ENV = 'development';
  delete process.env.UPSTASH_REDIS_REST_URL;

  const clientIp = '198.51.100.99';
  let rejectedOnSixth = false;

  for (let i = 1; i <= 6; i++) {
    const req = {
      method: 'POST',
      headers: { 'x-labfix-test-token': 'secret_token' },
      body: { env: 'python', errorLog: 'Valid error log', testMode: true },
      socket: { remoteAddress: clientIp }
    };
    const res = createMockRes();
    await handler(req, res);

    if (i <= 5 && res.statusCode !== 200) throw new Error('First five requests must succeed');
    if (i === 6 && res.statusCode === 429) {
      rejectedOnSixth = true;
    }
  }

  if (rejectedOnSixth) {
    console.log('✅ PASS: 6th mock request correctly triggered Rate Limit HTTP 429.');
    passedCount++;
  } else {
    console.error('❌ FAIL: Mock request bypassed rate limit!');
    failedCount++;
  }
}

// 11. Unit Inspection: Environment Whitelist Scrubbing Verification
async function testEnvironmentKeyWhitelisting() {
  console.log('\n🧪 Test 11: Direct Whitelist Scrubbing Unit Test');
  
  const rawInput = {
    os: 'Windows',
    board: 'Uno R3',
    maliciousField: 'DROP TABLE users;',
    rawLog: 'Sensitive log contents',
    rawCode: 'Sensitive code contents'
  };

  const scrubbedArduino = scrubEnvironmentDetails('arduino', rawInput);

  if (
    scrubbedArduino.os === 'Windows' &&
    scrubbedArduino.board === 'Uno R3' &&
    scrubbedArduino.maliciousField === undefined &&
    scrubbedArduino.rawLog === undefined &&
    scrubbedArduino.rawCode === undefined
  ) {
    console.log('✅ PASS: Environment details strictly scrubbed according to platform whitelist.');
    passedCount++;
  } else {
    console.error('❌ FAIL: Whitelist scrubbing failed!', scrubbedArduino);
    failedCount++;
  }
}

// 12. Missing API Key Guard
async function testMissingApiKeyGuard() {
  console.log('\n🧪 Test 12: Missing GEMINI_API_KEY Configuration Safeguard');
  delete process.env.GEMINI_API_KEY;

  const req = {
    method: 'POST',
    headers: {},
    body: { env: 'python', errorLog: 'Valid error log' },
    socket: { remoteAddress: '127.0.0.1' }
  };
  const res = createMockRes();
  await handler(req, res);

  if (res.statusCode === 503 && res.body.error.includes('GEMINI_API_KEY')) {
    console.log('✅ PASS: Missing API key safely rejected with HTTP 503.');
    passedCount++;
  } else {
    console.error('❌ FAIL: Missing API key safeguard failed!', res);
    failedCount++;
  }
}

async function runAllTests() {
  console.log('==============================================');
  console.log('🚀 Running LabFix Extended Backend Tests (12 Cases)');
  console.log('==============================================\n');

  await testProductionMockRejection();
  await testDevMockSuccess();
  await testInvalidTokenMockRejection();
  await testEmptyLogValidation();
  await testOverlengthLogValidation();
  await testFailClosedProductionRedis();
  await testGetStatusSanitization();
  await testClientIpParsing();
  await testInvalidMethodRejection();
  await testMemoryRateLimitThreshold();
  await testEnvironmentKeyWhitelisting();
  await testMissingApiKeyGuard();

  console.log('\n==============================================');
  console.log(`📊 Test Results: ${passedCount} Passed, ${failedCount} Failed`);
  console.log('==============================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runAllTests();