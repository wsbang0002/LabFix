import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import handler, { getClientIp } from '../api/analyze.js';
let redisResult=1, redisOffline=false, aiData, aiEnabled=false;
const original = { ...process.env };
const valid = { errorType:'오류', summary:'요약', evidence:['단서'], causes:[{name:'원인',reason:'이유',check:'확인'}], steps:[{step:1,title:'제목',desc:'설명',why:'이유',expect:'결과',note:'주의'}], questions:[] };
beforeEach(() => {
  for (const k of ['VERCEL','VERCEL_ENV','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN']) delete process.env[k];
  process.env.NODE_ENV='development'; process.env.GEMINI_API_KEY='unit-test-only';
  redisResult=1;redisOffline=false;aiEnabled=false;
  mock.method(globalThis, 'fetch', async (url,options) => {
    if(String(url).includes('test.upstash.io')) {
      if(redisOffline) return new Response(JSON.stringify({error:'offline'}),{status:400});
      const payload=JSON.parse(options.body);
      assert.match(JSON.stringify(payload),/INCR/); assert.match(JSON.stringify(payload),/EXPIRE/);
      const command=Array.isArray(payload[0])?payload[0]:payload;
      assert.equal(command.at(-1),60);
      const result={result:redisResult};
      return new Response(JSON.stringify(Array.isArray(payload[0])?[result]:result));
    }
    if(!aiEnabled) throw new Error('Unexpected network access');
    const body=JSON.parse(options.body);
    assert.ok(body.systemInstruction);assert.ok(body.generationConfig.responseSchema);
    assert.match(JSON.stringify(body.contents),/test/);
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:typeof aiData==='string'?aiData:JSON.stringify(aiData)}],role:'model'},finishReason:'STOP'}]}),{headers:{'content-type':'application/json'}});
  });
});
afterEach(() => { mock.restoreAll(); for(const k of Object.keys(process.env)) if(!(k in original)) delete process.env[k]; Object.assign(process.env,original); });
async function request(body={env:'python',errorLog:'test'}, headers={}) {
 const res={statusCode:200,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
 await handler({method:'POST',headers,body,socket:{remoteAddress:'192.0.2.80'}},res);return res;
}
function redis(counter=1) {
 process.env.UPSTASH_REDIS_REST_URL='https://test.upstash.io';process.env.UPSTASH_REDIS_REST_TOKEN='unit-test-only';
 redisResult=counter;
}
function gemini(data) { aiEnabled=true;aiData=data; }
test('untrusted forwarded headers never override socket',()=>{
 assert.equal(getClientIp({headers:{'x-forwarded-for':'1.2.3.4','x-real-ip':'2.3.4.5','x-vercel-forwarded-for':'3.4.5.6'},socket:{remoteAddress:'192.0.2.1'}}),'192.0.2.1');
});
test('Vercel edge header validated, canonicalized; multi-value rejected',()=>{
 process.env.VERCEL='1';
 assert.equal(getClientIp({headers:{'x-vercel-forwarded-for':'2001:0db8:0:0::1'},socket:{}}),'2001:db8::1');
 assert.equal(getClientIp({headers:{'x-vercel-forwarded-for':'1.2.3.4, 5.6.7.8'},socket:{remoteAddress:'192.0.2.1'}}),'192.0.2.1');
});
test('malformed body and optional field types rejected',async()=>{
 for(const body of [null,[], 'text',{env:'python',errorLog:'test',codeSnippet:0},{env:'python',errorLog:'test',attemptedActions:false}]) assert.equal((await request(body)).statusCode,400);
});
test('production platform flag blocks mocks regardless of NODE_ENV',async()=>{
 process.env.VERCEL_ENV='production'; assert.equal((await request({env:'python',errorLog:'test',testMode:true})).statusCode,403);
});
test('Redis failure and invalid counter fail closed in production',async()=>{
 process.env.NODE_ENV='production';redis();redisOffline=true;
 assert.equal((await request()).statusCode,503);
 redisOffline=false;redisResult='invalid'; assert.equal((await request()).statusCode,503);
});
test('Redis sixth request is blocked without Gemini call',async()=>{
 process.env.NODE_ENV='production';redis(6); assert.equal((await request()).statusCode,429);assert.ok(globalThis.fetch.mock.calls.every(c=>String(c.arguments[0]).includes('test.upstash.io')));
});
test('SDK serializes system instruction and schema; valid result returned',async()=>{
 redis();gemini(valid); const res=await request();assert.equal(res.statusCode,200);assert.deepEqual(res.body.data,valid);
});
test('malformed JSON, null nested fields, oversized arrays rejected as upstream errors',async()=>{
 redis();for(const data of ['not json',{...valid,causes:[null]},{...valid,steps:[null]},{...valid,evidence:Array(21).fill('x')},{...valid,questions:[4]}]) {
  gemini(data);assert.equal((await request()).statusCode,502);
 }
});
test('upstream failure returns error, never demo data',async()=>{
 redis(); const res=await request();assert.equal(res.statusCode,500);assert.equal(res.body.success,false);assert.equal(res.body.data,undefined);
});
