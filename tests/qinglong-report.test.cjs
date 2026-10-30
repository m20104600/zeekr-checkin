/* Synthetic report fixtures only; no network or account APIs. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../qinglong/zeekr_0810_all.js'),'utf8');
const split=src.lastIndexOf('\n(async function () {');

test('report contains only bound account and structured numbers, and HTTPS only',async()=>{
  const sent=[], logs=[];
  const env={ZEEKR_REPORT_URL:'https://fixture.invalid/api/report',ZEEKR_REPORT_KEY:'offline-report-key'};
  const ctx=vm.createContext({process:{env},console:{log:x=>logs.push(x)},URL,Buffer,require:()=>{throw Error('no network')}});
  vm.runInContext(src.slice(0,split),ctx);
  ctx.zeekrQLHttp=async options=>{sent.push(options);return {status:200}};
  await ctx.zeekrQLReport('123456',{ok:true,result:{debrisCount:2,walkVal:5,failed:[]},lines:['secret raw token must not be sent']});
  assert.equal(sent.length,1);assert.equal(sent[0].noRedirect,true);
  const body=JSON.parse(sent[0].body);
  assert.deepEqual(body,{account:'123456',tag:'早间场',state:'ok',summary:'碎片 2，能量 5，未领 0'});
  assert.ok(!sent[0].body.includes('secret raw token'));
  env.ZEEKR_REPORT_URL='http://fixture.invalid/api/report';
  await ctx.zeekrQLReport('123456',{ok:true});assert.equal(sent.length,1);
  env.ZEEKR_REPORT_URL='https://fixture.invalid/api/report';
  await ctx.zeekrQLReport('bad',{ok:true});assert.equal(sent.length,1);
});
