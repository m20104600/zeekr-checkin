// OFFLINE ONLY: unsigned synthetic JWTs, actual source core + wrappers, no network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const core=fs.readFileSync(path.join(root,'parts/core.js'),'utf8');
const tests=[];const test=(name,fn)=>tests.push({name,fn});
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function credential(platform='WEB_PC',device='0'){return 'Bearer '+b64({alg:'none'})+'.'+b64({sub:JSON.stringify({accountInfoDTO:{accountId:'2007000000000000123'},accountLoginInfoDTO:{lastLoginDeviceId:device,platform}}),exp:4102444800})+'.';}
const readTask={name:'阅读文章',doc:{path:'https://offline.invalid/?acticleId=2007000000000000456'},taskTakeDTO:{currentComplete:0,maxCompleteLimit:1}};
const weekly={name:'每周点赞帖子',taskTakeDTO:{currentComplete:0,maxCompleteLimit:1}};
function normal(req){const p=new URL(req.url).pathname;
 if(p.endsWith('/taskMsg'))return {code:'000000',data:{taskReachMsgList:[readTask,weekly]}};
 if(p.endsWith('/detail'))return {code:'000000',data:{id:'2007000000000000456',accountId:'2007000000000000789',isFabulous:0,title:'Offline article'}};
 if(p.endsWith('/pub/list'))return {code:'000000',data:{list:[{id:'2007000000000000456',accountId:'2007000000000000789',isFabulous:0}]}};
 if(p.endsWith('/getUncollectedBallsPageNew'))return {code:'000000',data:{uncollectedVal:[]}};
 return {code:'000000',data:{}};
}
async function run({kind='core',env={},respond=normal,platform='WEB_PC',device='0',runtime='OFFLINE',setup=()=>{}}={}){
 const calls=[],events=[],logs=[],notifications=[];let ticks=1793188800000;
 class Clock extends Date{static now(){return ticks;}}
 const context=vm.createContext({Date:Clock,console:{log:x=>logs.push(x)},setTimeout:(f,ms)=>{events.push({sleep:ms});ticks+=ms;queueMicrotask(f);return 0;}});
 const http=async req=>{calls.push(req);events.push({request:new URL(req.url).pathname});const response=await respond(req,calls);if(response&&response.raw!==undefined)return {status:response.status||200,body:response.raw};return {status:200,body:JSON.stringify(response)};};
 const parameters={TOKEN:credential(platform,device),APPVER:'5.0.5',STEPS:'off',NOTIFY:'1',...env};
 let result;
 if(kind==='core'){vm.runInContext(core,context);setup(context);result=await context.zeekrMain({platform:runtime,env:parameters,http,log:x=>logs.push(x),notify:(title,body)=>notifications.push({title,body})});}
 else{
  const template=fs.readFileSync(path.join(root,'tpl',kind+'.js'),'utf8').replace('/*__CORE__*/',core);
  if(kind==='egern'){
   vm.runInContext(template.replace('export default async function (ctx)','var entry = async function (ctx)'),context);
   const adapter={};for(const method of ['get','post'])adapter[method]=async(url,o)=>{const r=await http({...o,url,method:method.toUpperCase()});return {status:r.status,text:async()=>r.body};};
   result=await context.entry({env:parameters,storage:{get:()=>null},http:adapter,notify:n=>notifications.push(n)});
  }else{
   context.$argument=parameters;context.$loon={};context.$persistentStore={read:()=>null};context.$notify=(title,sub,body)=>notifications.push({title,body});context.$httpClient={};
   for(const method of ['get','post'])context.$httpClient[method]=(req,cb)=>http(req).then(r=>cb(null,{status:r.status},r.body),e=>cb(e.message));
   await new Promise((resolve,reject)=>{context.$done=resolve;try{vm.runInContext(template,context);}catch(e){reject(e);}});
  }
 }
 return {context,result,calls,events,logs,notifications};
}
for(const kind of ['core','classic','egern'])for(const target of ['/center','/taskMsg','/detail','/getUncollectedBallsPageNew'])test(kind+' auth stops immediately at '+target,async()=>{
 const r=await run({kind,env:{POLL:'1'},respond:req=>new URL(req.url).pathname.endsWith(target)?{code:'000009',msg:'认证失败'}:normal(req)});
 assert.ok(r.calls.at(-1).url.includes(target),'no request after auth failure');
 assert.ok(r.events.at(-1).request,'no sleep after auth failure');
 assert.ok(!r.logs.join('\n').match(/全部完成|本次查询无待领取|可取皆已领完/),'no false success');
 assert.ok(r.notifications.at(-1).title.startsWith('❌'),'failure notification');
 if(r.result)assert.equal(r.result.ok,false);
});
test('auth classifier precise temporary and explicit failures',async()=>{
 const r=await run({env:{MODE:'claim'}});const classify=r.context.zeekrIsAuthDead;
 assert.equal(typeof classify,'function');
 for(const status of [401,403,'401','403'])assert.equal(classify(status,{code:'PARSE_ERROR',msg:'gateway'}),true);
 for(const msg of ['登录服务暂时异常','登录服务不可用，请稍后重试','系统繁忙'])assert.equal(classify(503,{code:'999999',msg}),false);
 for(const msg of ['认证失败','未授权','Token 无效','登录已失效','请重新登录'])assert.equal(classify(200,{code:'999999',msg}),true);
 assert.equal(classify(200,{code:'000009',msg:'认证失败'}),true);
 assert.equal(classify(200,{code:'000009',msg:'认证失败'}),true);
});
for(const kind of ['core','classic','egern'])for(const retry of [false,true])test(kind+' nested batch authentication aborts '+(retry?'single retry':'initial batch'),async()=>{
 let batches=0,authAt=0;
 const r=await run({kind,env:{MODE:'claim',POLL:'1'},respond:(req,calls)=>{
  if(req.url.endsWith('/getUncollectedBallsPageNew')) return {code:'000000',data:{uncollectedVal:[{id:'D1',valDefineCode:'DEBRIS',eventCode:'EASY_DEBRIS',sourceId:'offline1'},{id:'D2',valDefineCode:'DEBRIS',eventCode:'EASY_DEBRIS',sourceId:'offline2'}]}};
  if(req.url.endsWith('/batchApply')) {
   batches++;
   if(retry&&batches===1) return {code:'999999',msg:'offline normal failure'};
   authAt=calls.length;
   return {code:'000000',data:[{success:false,code:'000009',msg:'认证失败'}]};
  }
  return normal(req);
 }});
 assert.ok(authAt>0);assert.equal(r.calls.length,authAt,'no retry after nested auth');
 assert.ok(r.events.at(-1).request,'no sleep after nested auth');
 assert.ok(r.notifications.at(-1).title.includes('认证失败'));
 assert.ok(!r.logs.join('\n').match(/全部完成|可取皆已领完/));
 if(r.result)assert.equal(r.result.ok,false);
});
test('failed reward query never reports empty-success',async()=>{
 const r=await run({env:{MODE:'claim',POLL:'1'},respond:req=>({code:'999999',msg:'登录服务暂时异常'})});
 assert.equal(r.result.ok,false);assert.equal(r.calls.length,1);
 assert.ok(!r.logs.join('\n').match(/全部完成|本次查询无待领取|可取皆已领完/));
 assert.ok(!r.logs.join('\n').includes('认证失败'),'temporary failure not mislabeled auth');
});
for(const kind of ['core','classic','egern'])test(kind+' WEB_PC remains H5 despite APP_SECRET',async()=>{
 const r=await run({kind,env:{APP_SECRET:'offline-signing-fixture',DEVICE_ID:'EXPLICIT'}});
 assert.ok(r.calls.every(q=>q.headers.x_ca_key==='H5-SIGN-SECRET-KEY'&&q.headers.platform==='WEB_PC'&&q.headers.device_id==='EXPLICIT'));
 assert.ok(!r.calls.some(q=>/behaviorTrack|comment\/pub|recommend|festival|taskGet/.test(q.url)),'extra requests opt-in');
 const read=r.calls.find(q=>q.url.includes('/detail'));assert.equal(read.headers['Content-Type'],undefined,'GET omits JSON content type');
});
for(const kind of ['core','classic','egern'])test(kind+' native mode explicit and exact article IDs',async()=>{
 const r=await run({kind,platform:'IOS',device:'OFFLINE-NATIVE',env:{APP_SECRET:'offline-signing-fixture',NATIVE:'1',NATIVE_REQUESTS:'1'},respond:req=>req.url.includes('/detail')?{raw:'{"code":"000000","data":{"id":2007000000000000456,"accountId":2007000000000000789,"isFabulous":0}}'}:normal(req)});
 const native=r.calls.filter(q=>/detail|fabulous|behaviorTrack|comment\/pub|recommend/.test(q.url));
 assert.ok(native.length>=5,'native extra chain exercised');
 assert.ok(native.every(q=>q.headers.x_ca_key==='APP-SIGN-SECRET-KEY'&&q.headers.device_id==='OFFLINE-NATIVE'));
 assert.ok(r.calls.filter(q=>/center|taskMsg|getUncollected/.test(q.url)).every(q=>q.headers.x_ca_key==='H5-SIGN-SECRET-KEY'),'business requests stay H5');
 const like=JSON.parse(r.calls.find(q=>q.url.includes('/fabulous')).body);assert.equal(like.moduleId,'2007000000000000456');assert.equal(like.toAccountId,'2007000000000000789');
 assert.ok(!r.calls.some(q=>q.url.includes('/invitation/pub/list')),'reuse article avoids square lookup');
});
for(const kind of ['core','classic','egern'])test(kind+' WEB_PC with nonzero device never enables native identity',async()=>{
 const r=await run({kind,platform:'WEB_PC',device:'OFFLINE-WEB-DEVICE',env:{APP_SECRET:'offline-signing-fixture',NATIVE:'1',NATIVE_REQUESTS:'1'}});
 assert.ok(r.calls.every(q=>q.headers.x_ca_key==='H5-SIGN-SECRET-KEY'&&q.headers.platform==='WEB_PC'));
 assert.ok(!r.calls.some(q=>/behaviorTrack|comment\/pub|recommend/.test(q.url)));
});
test('WEB_PC zero device cannot opt into invalid native identity',async()=>{
 const r=await run({env:{APP_SECRET:'offline-signing-fixture',NATIVE:'1',NATIVE_REQUESTS:'1'}});
 assert.ok(r.calls.every(q=>q.headers.x_ca_key==='H5-SIGN-SECRET-KEY'&&q.headers.platform==='WEB_PC'));
});
for(const target of ['/festival','/taskGet'])test('optional '+target+' timeout does not block main flow',async()=>{
 const r=await run({env:{PAGE_CONTEXT:'1'},respond:req=>{if(req.url.endsWith(target))throw Error('offline timeout');return normal(req);}});
 assert.ok(r.calls.some(q=>q.url.endsWith(target)),'optional endpoint exercised');assert.equal(r.result.ok,true);assert.ok(r.calls.some(q=>q.url.endsWith('/center')));
});
for(const target of ['/festival','/taskGet','/behaviorTrack','/comment/pub/list','/recommend'])test('optional '+target+' auth never swallowed',async()=>{
 const r=await run({platform:'IOS',device:'OFFLINE-NATIVE',env:{PAGE_CONTEXT:'1',NATIVE:'1',NATIVE_REQUESTS:'1',APP_SECRET:'offline-signing-fixture',POLL:'1',READWAIT:'120'},respond:req=>new URL(req.url).pathname.endsWith(target)?{code:'000009',msg:'认证失败'}:normal(req)});
 assert.equal(r.result.ok,false);assert.ok(r.calls.at(-1).url.includes(target));assert.ok(r.events.at(-1).request);assert.ok(!r.logs.join('\n').includes('全部完成'));
});
test('completed reading task skips article HTTP',async()=>{
 const r=await run({respond:req=>req.url.endsWith('/taskMsg')?{code:'000000',data:{taskReachMsgList:[{...readTask,taskTakeDTO:{currentComplete:1,maxCompleteLimit:1}}]}}:normal(req)});
 assert.equal(r.result.ok,true);assert.ok(!r.calls.some(q=>q.url.includes('/detail')));
});
test('READWAIT DELAY default zero and strict capped seconds parser',async()=>{
 const r=await run();const cfg=r.context.zeekrLoadConfig({env:{}});
 assert.equal(cfg.readWait,'');assert.equal(cfg.delay,'');
 const seconds=r.context.zeekrResolveSeconds;
 assert.equal(typeof seconds,'function');
 for(const x of ['',undefined,'off','-1','1e5','9-2','5-','Infinity','9007199254740992'])assert.equal(seconds(x,120),0);
 assert.equal(seconds('999',120),120);assert.equal(seconds('100-200',120)<=120,true);
});
for(const [runtime,cap] of [['Quantumult X',5000],['Egern',15000],['Loon',15000]])test(runtime+' optional delay shares finite phone budget',async()=>{
 const env={READWAIT:'120',DELAY:'120'};
 const setup=c=>{c.zeekrRand=(min,max)=>min;};
 const baseline=await run({runtime,setup}),r=await run({runtime,env,setup});
 const sum=r=>r.events.reduce((n,e)=>n+(e.sleep||0),0);
 const extra=sum(r)-sum(baseline);assert.ok(extra>0,'opt-in takes effect');assert.ok(extra<=cap,'optional wait total capped');
});
test('daily steps opt-in only; default still per-run sample',async()=>{
 const steps=async(daily,high)=>{const r=await run({env:{STEPS:'10000-20000',DAILYSTEPS:daily?'1':'0'},setup:c=>{c.zeekrRand=(min,max)=>high?max:min;}});return JSON.parse(r.calls.find(q=>q.url.includes('/initDayWalkData')).body).stepCounts;};
 assert.notEqual(await steps(false,false),await steps(false,true));
 assert.equal(await steps(true,false),await steps(true,true));
});
for(const kind of ['core','classic','egern'])for(const target of ['/initDayWalkData','/fabulous','/collectedAllEnergy','/collectIntegralZeekrBalls','/batchApply','/applyV2/apply'])test(kind+' auth aborts retry/claim/sleep at '+target,async()=>{
 const rewards=[{id:'W',val:12,valDefineCode:'CARBON_VALUE'},{id:'G',val:1,valDefineCode:'ZEEKR_VALUE'},{id:'D',valDefineCode:'DEBRIS',eventCode:'EASY_DEBRIS',sourceId:'offline'},{id:'L',sceneCode:'SIGN_CONTINUOUS_7_LOTTERY',sourceId:'offline'}];
 const r=await run({kind,env:{STEPS:'12000',POLL:'1'},respond:req=>{
  const p=new URL(req.url).pathname;if(p.endsWith(target))return {code:'000009',msg:'认证失败'};
  if(p.endsWith('/getUncollectedBallsPageNew'))return {code:'000000',data:{uncollectedVal:rewards}};
  if(p.endsWith('/batchApply'))return {code:'000000',data:[{success:true}]};
  return normal(req);
 }});
 assert.ok(r.calls.at(-1).url.includes(target));assert.ok(r.events.at(-1).request,'no post-auth sleep');assert.ok(!r.logs.join('\n').match(/全部完成|本次查询无待领取|可取皆已领完/));
 assert.ok(r.notifications.at(-1).title.includes('认证失败'));if(r.result)assert.equal(r.result.ok,false);
});
for(const kind of ['core','classic','egern'])for(const status of [401,403])test(kind+' HTTP '+status+' non-JSON aborts',async()=>{
 const r=await run({kind,env:{MODE:'claim',POLL:'1'},respond:()=>({status,raw:'<html>offline rejection</html>'})});
 assert.equal(r.calls.length,1);assert.ok(r.events.at(-1).request);assert.ok(r.notifications.at(-1).title.includes('认证失败'));
});
for(const target of ['/festival','/taskGet'])test('optional '+target+' generic temporary service failure is soft',async()=>{
 const r=await run({env:{PAGE_CONTEXT:'1'},respond:req=>req.url.endsWith(target)?{code:'999999',msg:'登录服务暂时异常'}:normal(req)});
 assert.equal(r.result.ok,true);assert.ok(r.calls.some(q=>q.url.endsWith(target)));assert.ok(r.calls.some(q=>q.url.endsWith('/getUncollectedBallsPageNew')));
});
test('QX skips optional context HTTP because fetch cannot be cancelled',async()=>{
 const r=await run({runtime:'Quantumult X',env:{PAGE_CONTEXT:'1',NATIVE:'1',NATIVE_REQUESTS:'1',APP_SECRET:'offline-signing-fixture'},platform:'IOS',device:'OFFLINE-NATIVE'});
 assert.equal(r.result.ok,true);
 assert.ok(!r.calls.some(q=>/festival|taskGet|behaviorTrack|comment\/pub|recommend/.test(q.url)),'no unbounded optional transport');
});
test('optional HTTP has bounded timeout and spends phone budget',async()=>{
 const r=await run({runtime:'Egern',env:{PAGE_CONTEXT:'1'},setup:c=>{const original=c.zeekrRequest;c.zeekrRequest=async(...args)=>{if(args[1].endsWith('/festival')){await c.zeekrSleep(15000);throw Error('offline deadline');}return original(...args);};}});
 assert.equal(r.result.ok,true);assert.ok(!r.calls.some(q=>q.url.endsWith('/taskGet')),'spent optional budget skips later optional calls');
 const other=await run({env:{PAGE_CONTEXT:'1'}});assert.ok(other.calls.filter(q=>/festival|taskGet/.test(q.url)).every(q=>q.timeoutMs<=5000));
});
(async()=>{let failed=0;for(const {name,fn} of tests){try{await fn();console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.message);}}console.log(`${tests.length-failed} passed, ${failed} failed (${tests.length} offline PR5 integration tests)`);if(failed)process.exitCode=1;})();
