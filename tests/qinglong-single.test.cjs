'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const root=path.join(__dirname,'..');
const targets=['dist/zeekr.qinglong.js',...fs.readdirSync(path.join(root,'qinglong')).filter(x=>x.endsWith('.js')).map(x=>'qinglong/'+x)];
async function run(file,env) {
  let src=fs.readFileSync(path.join(root,file),'utf8');
  assert.ok(src.includes('ZEEKR_SINGLE_MODE_V336'), file+' capability sentinel missing');
  const marker='\n(async function () {'; const at=src.lastIndexOf(marker); assert.ok(at>0);
  src=src.slice(0,at)+`\nzeekrMain = async function(rt) { calls.push({token:rt.env.ZEEKR_TOKEN, val:rt.env.ZEEKR_VAL, mode:rt.env.ZEEKR_MODE}); return {ok:true,lines:[],result:{debrisCount:1,walkVal:2,failed:[]}}; };\nzeekrQLReport = async function(id,r) { reports.push(id); };\nzeekrQLNotify = async function(title,body) { notices.push({title,body}); };\n`+src.slice(at);
  const calls=[],reports=[],notices=[],logs=[]; let exit;
  const ctx={calls,reports,notices,Buffer,URL,setTimeout,clearTimeout,require,console:{log:(...a)=>logs.push(a.join(' '))},process:{env,exit:c=>{exit=c}}};
  vm.createContext(ctx); await vm.runInContext(src,ctx); return {calls,reports,notices,logs,exit};
}
const jwt=(id)=>'Bearer x.'+Buffer.from(JSON.stringify({sub:{accountInfoDTO:{accountId:id}}})).toString('base64url')+'.y';
const a=jwt('1111111111'), b=jwt('2222222222'), c=jwt('3333333333');
for(const file of targets) test(file+' single isolation, identity, reports and notify',async()=>{
  const r=await run(file,{ZEEKR_TOKEN_1:a,ZEEKR_TOKEN_2:b,ZEEKR_TOKEN_3:c,ZEEKR_SINGLE_VARIABLE:'ZEEKR_TOKEN_2',ZEEKR_NICKNAMES:'["first","second","third"]'});
  assert.equal(r.exit,0); assert.equal(r.calls.length,1); assert.equal(r.calls[0].token,b); assert.equal(r.calls[0].mode,'all'); assert.deepEqual(r.reports,['2222222222']); assert.equal(r.notices.length,1); assert.match(r.notices[0].title,/同步后签到/); assert.match(r.notices[0].body,/second/); assert.doesNotMatch(r.notices[0].body,/first|third/); assert.ok(r.logs.some(x=>x.includes('单账号模式：仅执行 ZEEKR_TOKEN_2'))); assert.ok(!r.logs.join('\n').includes(b));
});
test('invalid selections always fail closed without notification or execution',async()=>{
 for(const [selector,value] of [['','x'],['ZEEKR_TOKEN_2',''],['ZEEKR_TOKEN_2','  '],['ZEEKR_TOKEN_2','a&b'],['ZEEKR_TOKEN_2','a\n'],['ZEEKR_TOKEN_2','#comment'],['ZEEKR_TOKEN_2 ','x'],['zeekr_token_2','x'],['ZEEKR_VAL','x'],['Bearer secret','x'],['ZEEKR_TOKEN_9','x']]) {
   const r=await run(targets[0],{ZEEKR_TOKEN_1:a,ZEEKR_TOKEN_2:value,ZEEKR_VAL:c,ZEEKR_SINGLE_VARIABLE:selector});
   assert.equal(r.exit,1,selector); assert.equal(r.calls.length,0); assert.equal(r.reports.length,0); assert.equal(r.notices.length,0); assert.ok(!r.logs.join('\n').includes('Bearer secret'));
 }
});
test('normal multi-account and indexed nickname remain unchanged',async()=>{
 const r=await run(targets[0],{ZEEKR_TOKEN_1:a,ZEEKR_TOKEN_2:b,ZEEKR_NICKNAME_2:'named'});
 assert.equal(r.calls.length,2); assert.equal(r.notices.length,1); assert.match(r.notices[0].body,/named/); assert.deepEqual(r.reports,['1111111111','2222222222']);
});
test('select unnumbered token and preserve numbered explicit nickname',async()=>{
 let r=await run(targets[0],{ZEEKR_TOKEN:a,ZEEKR_TOKEN_2:b,ZEEKR_SINGLE_VARIABLE:'ZEEKR_TOKEN',ZEEKR_NICKNAME_1:'base'});
 assert.equal(r.calls[0].token,a); assert.match(r.notices[0].body,/base/);
 r=await run(targets[0],{ZEEKR_TOKEN:a,ZEEKR_TOKEN_2:b,ZEEKR_SINGLE_VARIABLE:'ZEEKR_TOKEN_2',ZEEKR_NICKNAME_2:'indexed'});
 assert.match(r.notices[0].body,/indexed/);
});
