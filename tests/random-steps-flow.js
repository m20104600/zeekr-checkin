// Entirely offline integration tests. HTTP and credentials are test fixtures.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const credential='Bearer '+b64({alg:'none'})+'.'+b64({sub:JSON.stringify({accountInfoDTO:{accountId:'2007000000000000000'},accountLoginInfoDTO:{lastLoginDeviceId:'TEST-DEVICE'}}),exp:Math.floor(Date.now()/1000)+86400*30})+'.test';
function response(url,calls,body){
 const p=new URL(url).pathname;
 if(url.includes('itunes.apple.com'))return {results:[{version:'5.0.5'}]};
 if(p.includes('initDayWalkData'))calls.push(JSON.parse(body));
 if(p.includes('taskMsg'))return {success:true,code:'000000',data:{taskReachMsgList:[{name:'步行3000步',taskTakeDTO:{currentComplete:0,maxCompleteLimit:1}}]}};
 if(p.includes('getUncollectedBallsPageNew'))return {success:true,code:'000000',data:{uncollectedVal:[]}};
 return {success:true,code:'000000',data:{}};
}
(async()=>{
 const local=await import(pathToFileURL('/root/.hermes/skills/zeekr-auto-checkin/scripts/checkin.mjs'));
 const saved={fetch:global.fetch,timer:global.setTimeout,now:Date.now,argv:process.argv,env:{...process.env},log:console.log};
 let ticks=Date.now();Date.now=()=>ticks+=1000;
 global.setTimeout=(f)=>{queueMicrotask(f);return 0;};
 console.log=()=>{};
 try{
  for(const value of ['12000-18000','off']){
   const calls=[];
   global.fetch=async(url,opts={})=>({json:async()=>response(String(url),calls,opts.body)});
   process.env.ZEEKR_TOKEN=credential;process.env.ZEEKR_DEVICE_ID='TEST-REQUEST';
   process.env.ZEEKR_STEPS=value;delete process.env.ZEEKR_NO_STEPS;
   process.argv=['node','offline-test','--claim-max','0.01','--claim-waits','0.001','--claim-settle','0.001'];
   await local.main();
   if(value==='off')assert.equal(calls.length,0);
   else{
    assert.equal(calls.length,2,'local should report then retry');
    assert.ok(calls[0].stepCounts>=12000&&calls[0].stepCounts<=18000,'local must parse range');
    assert.equal(calls[1].stepCounts,calls[0].stepCounts,'local retry reuses sample');
    assert.equal(calls[0].stepCountsSecret,local.encodeStepSecret(calls[0].stepCounts));
   }
   saved.log('PASS offline local flow:',value);
  }
 }finally{
  global.fetch=saved.fetch;global.setTimeout=saved.timer;Date.now=saved.now;process.argv=saved.argv;console.log=saved.log;
  for(const k of Object.keys(process.env))if(!(k in saved.env))delete process.env[k];
  Object.assign(process.env,saved.env);
 }
 const source=fs.readFileSync(require('node:path').join(__dirname,'../parts/core.js'),'utf8');
 for(const value of ['12000-18000','off']){
  const ctx={console,setTimeout,Date};vm.createContext(ctx);vm.runInContext(source,ctx);
  ctx.zeekrSleep=async()=>{};
  const calls=[];
  const RT={platform:'OFFLINE-TEST',env:{TOKEN:credential,STEPS:value,APPVER:'5.0.5',DEVICE_ID:'TEST-REQUEST',POLL:'0'},log:()=>{},notify:()=>{},http:async req=>({status:200,body:JSON.stringify(response(req.url,calls,req.body))})};
  await ctx.zeekrMain(RT);
  if(value==='off')assert.equal(calls.length,0);
  else{
   assert.equal(calls.length,2,'core should report then retry');
   assert.ok(calls[0].stepCounts>=12000&&calls[0].stepCounts<=18000,'core must parse range');
   assert.equal(calls[1].stepCounts,calls[0].stepCounts,'core retry reuses sample');
   assert.equal(calls[0].stepCountsSecret,ctx.zeekrEncodeStepSecret(calls[0].stepCounts));
  }
  console.log('PASS offline core flow:',value);
 }
})().catch(e=>{console.error(e);process.exit(1);});
