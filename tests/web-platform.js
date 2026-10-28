// OFFLINE ONLY: all JWTs are synthetic, unsigned alg:none fixtures, not login credentials.
// Execute source templates + real core; HTTP is a strict local substitute, never a network client.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'parts/core.js'), 'utf8');
const tests = [];
const test = (name, fn) => tests.push({name, fn});
const encode = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
function fixture(platform, {objectSub = false, device = '0', exp = 4102444800} = {}) {
  const sub = '{"accountInfoDTO":{"accountId":2007000000000000123},"accountLoginInfoDTO":{"lastLoginDeviceId":' + JSON.stringify(device) + (platform === undefined ? '' : ',"platform":' + JSON.stringify(platform)) + '}}';
  const payload = objectSub ? '{"sub":' + sub + ',"exp":' + exp + '}' : JSON.stringify({sub, exp});
  return 'Bearer ' + encode({alg:'none',typ:'JWT'}) + '.' + encode(payload) + '.';
}
function sandbox(logs = []) {
  const context = vm.createContext({console:{log:m=>logs.push(String(m))}, Date, setTimeout:fn=>{queueMicrotask(fn);return 0;}});
  return context;
}
function loadCore() { const c = sandbox(); vm.runInContext(core, c); c.zeekrSleep = async()=>{}; return c; }
function offlineResponse(req, calls) {
  calls.push(req);
  const p = new URL(req.url).pathname;
  if (p.endsWith('/getUncollectedBallsPageNew')) return {code:'000000', data:{uncollectedVal:[]}};
  if (p.endsWith('/taskMsg')) return {code:'000000', data:{taskReachMsgList:[]}};
  if (p.endsWith('/center') || p.endsWith('/initDayWalkData')) return {code:'000000',data:{}};
  throw new Error('Unexpected offline request path');
}
async function runCore(platform, options = {}) {
  const c = loadCore(), calls = [], logs = [];
  const credential = fixture(platform, options);
  const result = await c.zeekrMain({platform:'Egern',env:{TOKEN:credential,MODE:'all',STEPS:'12345',APPVER:'5.0.5',NOTIFY:'0'},log:m=>logs.push(m),notify:()=>{},http:async req=>({status:200,body:JSON.stringify(offlineResponse(req,calls))})});
  return {c,calls,logs,result,credential};
}
for (const platform of ['WEB_PC', 'IOS', 'ANDROID', undefined, 'WEB_PC_EVIL', 'WEB_PC\n']) {
  test('real core flow request platform ' + JSON.stringify(platform), async()=>{
    const r = await runCore(platform);
    assert.ok(r.result.ok, 'offline flow succeeds');
    assert.ok(r.calls.length >= 4, 'sign/walk/tasks/claim requests exercised');
    assert.ok(r.calls.every(q=>q.headers.platform === (platform === 'WEB_PC' ? 'WEB_PC' : '')), 'only WEB_PC maps to request platform');
    const walk = r.calls.find(q=>q.url.includes('initDayWalkData'));
    assert.equal(JSON.parse(walk.body).accountId, '2007000000000000123');
    assert.equal(r.c.zeekrParseToken(r.credential).deviceId, '0');
    assert.ok(!r.logs.join('\n').includes(r.credential), 'diagnostics never print credential');
  });
}
test('object sub preserves unquoted long account ID', async()=>{
  const r = await runCore('WEB_PC', {objectSub:true});
  assert.equal(r.c.zeekrParseToken(r.credential).accountId, '2007000000000000123');
});
async function runWrapper(kind, env, stored, request) {
  const calls=[],logs=[],notifications=[],writes=[];
  const data={zeekr_val:stored,zeekr_cap_last:String(Date.now())};
  const c=sandbox(logs);
  const template=fs.readFileSync(path.join(root,'tpl',kind+'.js'),'utf8').replace('/*__CORE__*/',core+'\nzeekrSleep = async function () {};');
  const storage={get:k=>data[k],set:(k,v)=>{data[k]=v;writes.push(k);},read:k=>data[k],write:(v,k)=>{data[k]=v;writes.push(k);return true;}};
  const parameters={MODE:'all',STEPS:'12345',APPVER:'5.0.5',NOTIFY:'0',CAPSHOW:'0',...env};
  if(kind==='egern') {
    vm.runInContext(template.replace('export default async function (ctx)', 'var entry = async function (ctx)'),c);
    const http={};
    for(const method of ['get','post','put']) http[method]=async(url,o)=>({status:200,text:async()=>JSON.stringify(offlineResponse({...o,url,method:method.toUpperCase()},calls))});
    await c.entry({env:parameters,storage,request,notify:n=>notifications.push(n),http});
  } else {
    c.$argument=parameters;c.$persistentStore=storage;c.$loon={};
    if(request)c.$request=request;
    c.$notify=(title,subtitle,body)=>notifications.push({title,body});
    c.$httpClient={};
    for(const method of ['get','post'])c.$httpClient[method]=(req,cb)=>cb(null,{status:200},JSON.stringify(offlineResponse(req,calls)));
    await new Promise((resolve,reject)=>{c.$done=resolve;try{vm.runInContext(template,c);}catch(e){reject(e);}});
  }
  return {calls,logs,notifications,writes,data};
}
for(const kind of ['classic','egern']) {
  for(const key of ['ZEEKR_TOKEN','TOKEN'])test(kind+' explicit '+key+' wins over stored app credential',async()=>{
    const web=fixture('WEB_PC'),app=fixture('IOS');
    const r=await runWrapper(kind,{[key]:web},JSON.stringify({authorization:app,device_id:'STORED'}));
    assert.ok(r.calls.length>=4,'real wrapper runs core');
    assert.ok(r.calls.every(q=>q.headers.Authorization===web&&q.headers.platform==='WEB_PC'),'explicit web credential selected');
    assert.ok(r.logs.some(x=>x.includes('Token 来源: env')),'explicit source diagnostic');
    assert.ok(!r.logs.join('\n').includes(web),'no credential in logs');
  });
  test(kind+' placeholder falls back to storage without overwriting explicit device',async()=>{
    const web=fixture('WEB_PC');
    const r=await runWrapper(kind,{ZEEKR_TOKEN:'${TOKEN}',DEVICE_ID:'EXPLICIT'},JSON.stringify({authorization:web,device_id:'STORED'}));
    assert.ok(r.calls.length>=4,'placeholder falls back');
    assert.ok(r.calls.every(q=>q.headers.platform==='WEB_PC'&&q.headers.device_id==='EXPLICIT'),'explicit device preserved');
    assert.ok(r.logs.some(x=>x.includes('Token 来源: storage')),'storage source diagnostic');
  });
  test(kind+' same credential capture refreshes device silently',async()=>{
    const web=fixture('WEB_PC');
    const r=await runWrapper(kind,{},JSON.stringify({authorization:web,device_id:'OLD'}),{headers:{Authorization:web,Device_ID:'NEW'},method:'GET',url:'https://offline.invalid/capture'});
    assert.equal(JSON.parse(r.data.zeekr_val).device_id,'NEW');
    assert.equal(r.notifications.length,0,'device change adds no notification');
    assert.equal(r.calls.length,0,'capture never runs business flow');
    assert.ok(!r.logs.join('\n').includes(web),'no credential logs');
  });
}
for(const key of ['DEVICEID','DEVICE_ID','ZEEKR_DEVICE_ID','zeekr-device-id'])test('device key normalization '+key,()=>{
  assert.equal(loadCore().zeekrLoadConfig({env:{[key]:'0'}}).deviceId,'0');
});
test('expiry inside next 24 hours remains usable',async()=>{
  const r=await runCore('WEB_PC',{exp:Math.floor(Date.now()/1000)+3600});
  assert.ok(r.result.ok,'not expired yet');
  assert.ok(r.logs.some(x=>x.includes('Token 过期:')),'expiry diagnostic');
});
test('string sub preserves unquoted long device ID',()=>{
  const raw='{"accountInfoDTO":{"accountId":2007000000000000123},"accountLoginInfoDTO":{"lastLoginDeviceId":2007000000000000456,"platform":"WEB_PC"}}';
  const unsigned='Bearer '+encode({alg:'none'})+'.'+encode({sub:raw,exp:4102444800})+'.';
  assert.equal(loadCore().zeekrParseToken(unsigned).deviceId,'2007000000000000456');
});
for(const kind of ['classic','egern'])test(kind+' preserves existing multi-token first-account behavior',async()=>{
  const first=fixture('WEB_PC'),second=fixture('IOS');
  const r=await runWrapper(kind,{TOKEN:first+'\n'+second},null);
  assert.ok(r.calls.length>=4,'multi-token configuration still runs');
  assert.ok(r.calls.every(q=>q.headers.Authorization===first),'first credential retained');
});
for(const enabled of [true,false])test('Egern CAPTURE='+enabled+' preserves switch behavior',async()=>{
  const unsigned=fixture('WEB_PC');
  const r=await runWrapper('egern',{ZEEKR_CAPTURE:enabled,ZEEKR_CAPDEBUG:!enabled},null,{headers:{Authorization:unsigned,device_id:'OFFLINE-DEVICE'},method:'GET'});
  assert.equal(r.writes.includes('zeekr_val'),enabled);
  assert.equal(r.notifications.length,enabled?1:0,'off suppresses debug too');
  assert.equal(r.calls.length,0);
  assert.ok(!r.logs.join('\n').includes(unsigned),'no full credential diagnostics');
});
test('expired credentials stop before HTTP',async()=>{
  const r=await runCore('WEB_PC',{exp:Math.floor(Date.now()/1000)-1});
  assert.equal(r.result.ok,false);
  assert.equal(r.calls.length,0);
  assert.ok(r.logs.some(x=>x.includes('Token 已过期')));
});
(async()=>{
 let passed=0, failed=0;
 for(const {name,fn} of tests) { try { await fn(); passed++; console.log('PASS '+name); } catch(e) { failed++; console.error('FAIL '+name+': '+e.message); } }
 console.log(`${passed} passed, ${failed} failed (${tests.length} tests; unsigned offline fixtures)`);
 if(failed) process.exitCode=1;
})();
