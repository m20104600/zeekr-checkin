'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../tpl/qinglong.js'), 'utf8');
function context() {
  const x = {process: {env: {}}, Buffer, URL, setTimeout, clearTimeout, console, require};
  vm.createContext(x);
  vm.runInContext(src.slice(0, src.lastIndexOf('\n(async function () {')), x);
  return x;
}
test('all and claim summaries keep outcomes and warnings, omit noise', () => {
  const x = context();
  const r = {ok:true, result:{debrisCount:3, lotteryCount:0, walkVal:300, integralVal:0, failed:[]}, lines:[
    '[极氪签到] ✅ 签到成功（今日已签到）', '[极氪签到] 🔥 连续签到7天(4/7)',
    '[极氪签到] 🚶 步数上报成功: 22785 步', '[极氪签到] 📖 阅读文章成功: 一篇文章',
    '[极氪签到] 📋 任务: ⏳ 减碳2000g  ✅ 步行3000步  ✅ 阅读文章',
    '[极氪签到] ⚠️ Token 即将过期，请尽快更新！', '[极氪签到] 🎉 全部完成！'
  ]};
  const text=x.zeekrQLCompact(r);
  for (const word of ['签到成功','4/7','22785','碎片 3','能量 +300','减碳2000g','Token 即将过期']) assert.ok(text.includes(word),word);
  assert.doesNotMatch(text,/\[极氪签到\]|一篇文章|全部完成/);
  const claim=x.zeekrQLCompact({ok:true,result:{debrisCount:0,lotteryCount:1,walkVal:0,integralVal:3,failed:[]},lines:[]});
  assert.match(claim,/七日奖励 1/); assert.match(claim,/极值 \+3/); assert.doesNotMatch(claim,/签到成功/);
  const fail=x.zeekrQLCompact({ok:false,lines:['[极氪签到] ❌ 签到失败：认证失败']});
  assert.match(fail,/签到失败/); assert.doesNotMatch(fail,/碎片 0/);
});
test('partial failures remain visible without leaking sensitive text', () => {
  const x=context();
  const out=x.zeekrQLCompact({ok:true,result:{debrisCount:1,walkVal:0,failed:[{label:'奖励',reason:'稍后再试'}]},lines:[
    '[极氪签到] ⚠️ 未领净 1 项：奖励→稍后再试', '[极氪签到] ⛔ Bearer abc.def.secret'
  ]});
  assert.match(out,/未领净 1 项/); assert.doesNotMatch(out,/abc\.def\.secret/);
});
test('oversized content splits without cutting surrogate pairs or losing content', () => {
  const x=context(); const input=('账号🚙测试\n').repeat(1500);
  const pieces=Array.from(x.zeekrQLSplit(input,3000));
  assert.ok(pieces.length>1); assert.equal(pieces.join(''),input);
  assert.ok(pieces.every(p=>p.length<=3000));
  assert.ok(pieces.every(p=>!/[\uD800-\uDBFF]$/.test(p) && !/^[\uDC00-\uDFFF]/.test(p)));
});
test('direct Telegram non-success response is not logged as sent', async () => {
  const x=context(); const logs=[];
  x.console={log: line=>logs.push(line)};
  x.require=()=>{throw new Error('absent');};
  x.process.env.TG_BOT_TOKEN='offline-test'; x.process.env.TG_CHAT_ID='offline-chat';
  x.zeekrQLHttp=async()=>({status:400,body:'{"ok":false}'});
  assert.equal(await x.zeekrQLNotify('title','body'),false);
  assert.ok(!logs.some(line=>line.includes('通知已通过 Telegram 发送')));
});

test('duplicate sendNotify module is not retried via another path', async () => {
  const x=context(); let calls=0; const fn=async()=>{calls++;throw new Error('');};
  x.require=name => name.endsWith('sendNotify.js') ? {sendNotify:fn} : (()=>{throw new Error('none');})();
  const ok=await x.zeekrQLNotify('title','body');
  assert.equal(ok,false); assert.equal(calls,1);
});
