// Native rendering and interaction regression with synthetic landmarks, NOT face-model validation.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createWechatClient} from './wechat-mcp.mjs';
const project=resolve(import.meta.dirname,'..'), layoutCheck=process.argv.includes('--layout');
const output=resolve(project,'.artifacts/native-face',layoutCheck?'layout':'');
await mkdir(output,{recursive:true});
execFileSync(process.execPath,[resolve(project,'node_modules/typescript/bin/tsc'),'--ignoreConfig','--module','commonjs','--target','ES2020','--skipLibCheck','--types','miniprogram-api-typings','--outDir',resolve(output,'compiled'),resolve(project,'tests/fixtures/face106.ts')],{cwd:project,windowsHide:true});
const fixture={};Function('exports',await readFile(resolve(output,'compiled/tests/fixtures/face106.js'),'utf8'))(fixture);
const anchor=fixture.face106();
const client=await createWechatClient(), mocks=new Set();
const call=(name,args={})=>client.call(name,{project,...args});
const evaluate=async(fn,args=[])=>{
  const source=`async function(...args){try{return await (${fn.toString()})(...args);}catch(error){return {testError:String(error),stack:error.stack};}}`;
  const value=(await call('automation_evaluate',{action:'evaluate',fnSource:source,args})).result.result;
  if(value?.testError)throw new Error(JSON.stringify(value));return value;
};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const report={startedAt:new Date().toISOString(),environment:'WeChat DevTools native simulator',fixture:'synthetic 106 landmarks and 128x128 RGB illustration; synchronous normal results',realPhoneValidated:false,faceModelValidated:false,readiness:[],checks:[],cleanup:[],passed:false};
async function openReadyRuntime(){
  await call('open_project_window',{windowMode:'fullMode'});
  // A window can exist before its automator has attached. Retry only this read-only probe.
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const ready=await evaluate(function(){return getCurrentPages().length>0;});
      if(!ready)throw new Error('No page is ready');
      report.readiness.push({attempt,passed:true});return;
    }catch(error){
      report.readiness.push({attempt,passed:false,error:String(error)});
      if(attempt===3)throw error;
      await pause(500);
    }
  }
}
function check(name,passed,evidence){report.checks.push({name,passed:!!passed,evidence});assert.ok(passed,`${name}: ${JSON.stringify(evidence)}`);console.log(`PASS ${name}`);}
async function mock(method,payload){await call('automation_wx_api',{action:'mock',method,...payload});mocks.add(method);}
async function state(){return evaluate(function(){return getCurrentPages().slice(-1)[0].data;});}
async function waitFor(predicate,label){const end=Date.now()+12000;let s;do{s=await state();if(predicate(s))return s;await pause(200);}while(Date.now()<end);throw new Error(`${label}: ${JSON.stringify(s)}`);}
try{
  await call('close_project_window');await openReadyRuntime();
  await call('automation_navigate',{action:'reLaunch',url:'/pages/entry/index',wait:1});
  await evaluate(function(anchor){getApp().__faceSmoke={anchor,hidden:false,multiple:false,delay:0,frames:0,detections:0,destroyed:0,stopped:0};return true;},[anchor]);
  await mock('authorize',{result:{errMsg:'authorize:ok'}});
  await mock('createCameraContext',{functionDeclaration:`function(){return{onCameraFrame(callback){const s=getApp().__faceSmoke;return{start(){const emit=()=>{const frame=(${fixture.faceFrame.toString()})(128);s.frames++;callback({width:128,height:128,data:frame.data.buffer});};s.timer=setInterval(emit,120);emit();},stop(){clearInterval(s.timer);s.stopped++;}};}};}`});
  // Generic mockWxMethod serializes this synchronous API's returned methods away.
  // Install the synthetic session in the debug runtime only; restore before reopening.
  await evaluate(function(){const s=getApp().__faceSmoke;s.originalVK=wx.createVKSession;
    wx.createVKSession=function(){const events={};let closed=false;return{
      on(name,fn){events[name]=fn;},off(name){delete events[name];},start(fn){fn(null);},
      detectFace(){s.detections++;const name=s.detections===1?'addAnchors':'updateAnchors';const deliver=()=>{if(!closed&&events[name])events[name](s.hidden?[]:s.multiple?[s.anchor,s.anchor]:[s.anchor]);};if(s.delay)setTimeout(deliver,s.delay);else deliver();},
      destroy(){closed=true;s.destroyed++;}
    };};return true;
  });
  await call('automation_navigate',{action:'navigateTo',url:'/pages/live/index',wait:1});
  await call('automation_element_action',{action:'tap',selector:'.primary-button',wait:0.5});
  await evaluate(function(){getCurrentPages().slice(-1)[0].onCameraReady();return true;});
  const live=await waitFor(s=>s.phase==='live','automatic face rendering');
  check('default face mode starts without A/B selection',live.trackingMode==='face'&&live.gpu&&!live.error,{phase:live.phase,gpu:live.gpu});
  // Native tap events rather than calling the color handlers directly.
  await call('automation_element_action',{action:'tap',selector:'.category[data-value="lipstick"]',wait:.2});
  await call('automation_element_action',{action:'tap',selector:'.shade[data-value="berry"]',wait:.2});
  await call('automation_element_action',{action:'tap',selector:'.finish[data-value="velvet"]',wait:.2});
  const lips=await state();check('native taps select lip shade and finish',lips.lipShade==='berry'&&lips.look.lipstick&&lips.look.lipFinish==='velvet',{lipShade:lips.lipShade,look:lips.look});
  await call('simulator_screenshot',{path:resolve(output,'lips.png'),optimize:false});
  if(layoutCheck){
    const measure=()=>evaluate(function(){return new Promise(resolve=>{
      wx.createSelectorQuery().select('.live-stage').boundingClientRect().select('.mirror-viewport').boundingClientRect()
        .select('.shade-list').boundingClientRect().selectViewport().scrollOffset().exec(items=>{
          const p=getCurrentPages().slice(-1)[0];resolve({stage:items[0],mirror:items[1],shades:items[2],scrollTop:items[3].scrollTop,
            windowHeight:wx.getWindowInfo().windowHeight,canvasWidth:p.data.canvasWidth,canvasHeight:p.data.canvasHeight});
        });
    });});
    const before=await measure();
    const scrolled=await evaluate(function(top){return new Promise(resolve=>wx.pageScrollTo({scrollTop:top,duration:0,success:()=>resolve(true),fail:()=>resolve(false)}));},
      [Math.max(before.scrollTop+before.mirror.top+20,before.scrollTop+before.shades.bottom-before.windowHeight+12)]);
    await pause(250);
    const after=await measure();
    check('native mirror stays visible while selecting shades without stretching',
      scrolled&&after.scrollTop>before.scrollTop&&Math.abs(after.mirror.top)<=1&&
      after.stage.top>=-1&&after.stage.bottom<=after.windowHeight+1&&after.shades.top>=after.mirror.bottom-1&&after.shades.bottom<=after.windowHeight+1&&
      Math.abs(after.stage.width/after.stage.height-1)<.01,after);
    await call('simulator_screenshot',{path:resolve(output,'mirror-selecting.png'),optimize:false});
  }
  // Continuous-frame automation taps can time out; remaining controls use page handlers.
  const layered=await evaluate(function(){const p=getCurrentPages().slice(-1)[0];p.onCategory({currentTarget:{dataset:{value:'blush'}}});p.onColor({currentTarget:{dataset:{value:'peach'}}});return p.data;});
  check('page handlers stack three independent layers',layered.look.foundation&&layered.look.lipstick&&layered.look.blush,{look:layered.look});
  const split=await evaluate(function(){const p=getCurrentPages().slice(-1)[0];p.onCompare();return p.data;});
  check('comparison handler retains stacked makeup',split.mode==='split'&&split.look.blush,{mode:split.mode});
  await call('simulator_screenshot',{path:resolve(output,'stacked-split.png'),optimize:false});
  await evaluate(function(){getApp().__faceSmoke.hidden=true;return true;});
  const lost=await waitFor(s=>s.phase==='view'&&s.status.includes('完整入镜'),'missing face withdrawal');check('missing face withdraws makeup',true,{status:lost.status});
  await evaluate(function(){getApp().__faceSmoke.hidden=false;getApp().__faceSmoke.multiple=true;return true;});
  const multiple=await waitFor(s=>s.status.includes('一张脸'),'multiple face withdrawal');check('multiple faces remain unpainted',multiple.phase==='view',{status:multiple.status});
  await evaluate(function(){getApp().__faceSmoke.multiple=false;return true;});await waitFor(s=>s.phase==='live','face recovery');
  await evaluate(function(){getApp().__faceSmoke.delay=1000;return true;});
  const stale=await waitFor(s=>s.phase==='view'&&s.status.includes('更新定位'),'stale result withdrawal');check('late landmarks do not leave a stale effect',true,{injectedDelayMs:1000,maximumDetectionAgeMs:900,status:stale.status});
  const stopped=await evaluate(function(){const p=getCurrentPages().slice(-1)[0];p.onHide();const s=getApp().__faceSmoke;return{phase:p.data.phase,hasFrame:p.data.hasFrame,destroyed:s.destroyed,stopped:s.stopped,frames:s.frames,detections:s.detections};});
  check('hide destroys detector and camera listener',stopped.phase==='off'&&!stopped.hasFrame&&stopped.destroyed>0&&stopped.stopped>0,stopped);
  report.passed=true;
}catch(error){report.error=String(error);process.exitCode=1;console.error(error);}
finally{
  const steps=[['stop synthetic capture and restore face API',()=>evaluate(function(){const p=getCurrentPages().slice(-1)[0];if(p.route==='pages/live/index')p.stopCamera();const s=getApp().__faceSmoke;if(s){clearInterval(s.timer);if(s.originalVK)wx.createVKSession=s.originalVK;}delete getApp().__faceSmoke;return true;})],
    ...[...mocks].map(method=>[`restore ${method}`,()=>call('automation_wx_api',{action:'restore',method})]),
    ['close test runtime',()=>call('close_project_window')],['reopen clean runtime',openReadyRuntime],
    ['verify restoration',async()=>{await call('automation_navigate',{action:'reLaunch',url:'/pages/entry/index',wait:1});const s=await evaluate(function(){return{clean:!getApp().__faceSmoke,camera:typeof wx.createCameraContext,vk:typeof wx.createVKSession};});assert.ok(s.clean&&s.camera==='function'&&s.vk==='function');}]];
  for(const[name,action]of steps){try{await action();report.cleanup.push({name,passed:true});}catch(e){report.cleanup.push({name,passed:false,error:String(e)});report.passed=false;process.exitCode=1;}}
  report.finishedAt=new Date().toISOString();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(`Report: ${resolve(output,'report.json')}`);
}
