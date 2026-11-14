'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), path=require('node:path'), os=require('node:os');
const source=fs.readFileSync(path.join(__dirname,'../tpl/qinglong.js'),'utf8');
function setup(t){
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'zeekr-month-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const x={process:{env:{dir_data:dir},cwd:()=>dir},require,Buffer,URL,console,setTimeout,clearTimeout};
 vm.createContext(x);vm.runInContext(source.slice(0,source.lastIndexOf('\n(async function () {')),x);return {x,dir};
}
test('account isolation, duplicate receipts, UTC+8 month rollover',t=>{
 const {x}=setup(t), now=Date.parse('2026-11-30T15:59:59Z'), next=now+1000;
 assert.equal(x.zeekrQLMonth(now),'2026-11');assert.equal(x.zeekrQLMonth(next),'2026-12');
 let sign={id:'reward-1',kind:'integral',value:1,source:'每日签到'};
 x.zeekrQLMonthlyRecord('123',sign,now);x.zeekrQLMonthlyRecord('123',sign,now);
 x.zeekrQLMonthlyRecord('123',{id:'reward-2',kind:'seven',prize:'5Kr'},now);
 x.zeekrQLMonthlyRecord('123',{id:'reward-3',kind:'integral',value:'3',source:'other'},now);
 x.zeekrQLMonthlyRecord('123',{id:'reward-4',kind:'seven',prize:'未知奖品'},now);
 x.zeekrQLMonthlyRecord('456',{id:'reward-1',kind:'integral',value:2,source:'DAILY_SIGN'},now);
 const a=x.zeekrQLMonthlySummary('123',now),b=x.zeekrQLMonthlySummary('456',now),c=x.zeekrQLMonthlySummary('123',next);
 assert.deepEqual([a.sign,a.seven,a.unknownIntegral,a.unknownSeven,a.invalid],[1,5,3,1,0]);
 assert.deepEqual([b.sign,b.seven],[2,0]);assert.deepEqual([c.sign,c.seven],[0,0]);
 assert.throws(()=>x.zeekrQLMonthlyRecord('123',{id:'',kind:'seven',prize:'5Kr'},now));
 assert.throws(()=>x.zeekrQLMonthlyRecord('123',{id:'x',kind:'integral',value:-1},now));
 assert.throws(()=>x.zeekrQLMonthlySummary('../bad',now));
});
test('invalid local records are reported, not counted',t=>{
 const {x}=setup(t),now=Date.parse('2026-11-11T00:00:00Z');
 x.zeekrQLMonthlyRecord('123',{id:'x',kind:'integral',value:1,source:'签到'},now);
 const dir=x.zeekrQLMonthlyDir('123',now);fs.writeFileSync(path.join(dir,'a'.repeat(64)+'.json'),'{');
 assert.equal(x.zeekrQLMonthlySummary('123',now).invalid,1);
});
test('generated Qinglong entry records and notifies per account',async t=>{
 const {dir}=setup(t), calls=[], notices=[];
 let src=fs.readFileSync(path.join(__dirname,'../qinglong/zeekr_0001_all.js'),'utf8');
 const at=src.lastIndexOf('\n(async function () {');assert.ok(at>0);
 src=src.slice(0,at)+`\nzeekrMain=async function(rt){ await rt.monthlyReward({kind:'integral',id:'signed',value:1,source:'每日签到'});await rt.monthlyReward({kind:'seven',id:'seven',prize:'5Kr'});calls.push(1);return {ok:true,lines:[],result:{debrisCount:0,walkVal:0,failed:[]}}; };\nzeekrQLReport=async function(){};zeekrQLNotify=async function(title,body){notices.push(body)};\n`+src.slice(at);
 const token='Bearer x.'+Buffer.from(JSON.stringify({sub:{accountInfoDTO:{accountId:'123456789'}}})).toString('base64url')+'.y';
 const ctx={calls,notices,Buffer,URL,setTimeout,clearTimeout,require,console,process:{env:{dir_data:dir,ZEEKR_TOKEN_1:token},exit:()=>{},cwd:()=>dir}};
 vm.createContext(ctx);await vm.runInContext(src,ctx);
 assert.equal(calls.length,1);assert.equal(notices.length,1);assert.match(notices[0],/本月签到极值：1\/10/);assert.match(notices[0],/七日极值：5/);
});

test('claim helpers only record successful receipts, including seven-day prize',async t=>{
 const {x}=setup(t), core=fs.readFileSync(path.join(__dirname,'../parts/core.js'),'utf8');
 vm.runInContext(core,x);const events=[],logs=[];let success=true;
 x.zeekrPost=async()=>success?{code:'000000',data:{success:true,invoice:{materialSnapshot:{name:'5Kr'}}}}:{code:'FAIL',msg:'failed'};
 x.zeekrSleep=async()=>{};x.zeekrRand=()=>0;
 const ctx={RT:{monthlyReward:e=>events.push(e)},out:s=>logs.push(s)};
 await x.zeekrClaimIntegral(ctx,[{id:'i',val:1,sourceId:'每日签到'}]);
 await x.zeekrClaimSevenDayLottery(ctx,[{id:'s'}]);
 success=false;await x.zeekrClaimIntegral(ctx,[{id:'bad',val:2}]);await x.zeekrClaimSevenDayLottery(ctx,[{id:'bad7'}]);
 assert.equal(events.length,2);assert.equal(events[0].source,'每日签到');assert.equal(events[1].prize,'5Kr');
});
