import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const projectRoot=new URL('../',import.meta.url);
const appUrl=new URL('src/app.js',projectRoot);
const source=await readFile(appUrl,'utf8');
const html=await readFile(new URL('src/index.html',projectRoot),'utf8');
const imported={};
for(const match of source.matchAll(/^import \{([^}]+)\} from '([^']+)';/gm)){const namespace=await import(new URL(match[2],appUrl));for(const name of match[1].split(',').map(value=>value.trim()))imported[name]=namespace[name];}
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function settleUntil(predicate){for(let i=0;i<40&&!predicate();i++)await Promise.resolve();assert.ok(predicate(),'expected asynchronous lifecycle phase');}
function fakeStream({zoom=false,applyZoom=async()=>{}}={}){
 let zoomValue=1;
 const track={readyState:'live',onended:null,stops:0,stop(){this.stops++;this.readyState='ended';},getSettings(){return {width:1280,height:720,frameRate:60,...(zoom?{zoom:zoomValue}:{})};}};
 if(zoom){track.getCapabilities=()=>({zoom:{min:1,max:5,step:.1}});track.applyConstraints=async constraints=>{await applyZoom(constraints.zoom.exact);zoomValue=constraints.zoom.exact;};}
 return {track,getTracks:()=>[track],getVideoTracks:()=>[track]};
}
class Element extends EventTarget {
 constructor(id=''){super();this.id=id;this.hidden=false;this.disabled=false;this.value='';this.checked=false;this.textContent='';this.dataset={};this.style={};this.clientWidth=360;this.clientHeight=540;this.videoWidth=1280;this.videoHeight=720;this.readyState=2;this.currentTime=0;this.paused=true;this.classList={add(){},remove(){},toggle(){}};}
 append(){} prepend(){} replaceChildren(){} remove(){} setAttribute(){} removeAttribute(){} load(){} click(){} showModal(){} close(){}
 async play(){this.paused=false;} pause(){this.paused=true;}
 getContext(){return {clearRect(){},setLineDash(){},strokeRect(){},fillText(){},drawImage(){},getImageData(){return {data:new Uint8Array(160*90*4)};}};}
}
function fixture({getUserMedia,wakeRequest}={}){
 const nodes=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
 const actions=['直飞','抓板','转体','自定义'].map(action=>{const el=new Element();el.dataset.action=action;return el;});
 const speeds=['0.25','0.5','1'].map(speed=>{const el=new Element();el.dataset.speed=speed;return el;});
 const document=new EventTarget();document.hidden=false;document.body=new Element();
 document.getElementById=id=>nodes[id];document.createElement=tag=>new Element(tag);
 document.querySelectorAll=query=>query==='[id]'?Object.values(nodes):query==='[data-action]'?actions:query==='[data-speed]'?speeds:query.startsWith('[data-action],')?[...actions,nodes.actionDetail,nodes.focusInput]:[];
 const recorders=[];
 class Recorder {
  static isTypeSupported(){return true;}
  constructor(stream,options){this.stream=stream;this.mimeType=options.mimeType;this.state='inactive';recorders.push(this);}
  start(){this.state='recording';}
  stop(){this.state='inactive';}
 }
 const timers=new Map();let timerId=0;
 const addTimer=(kind,fn)=>{const id=++timerId;timers.set(id,{kind,fn});return id;};
 const window=new EventTarget();window.isSecureContext=true;window.MediaRecorder=Recorder;window.scrollTo=()=>{};
 const navigator={mediaDevices:{getUserMedia:getUserMedia||(()=>Promise.resolve(fakeStream()))}};
 if(wakeRequest)navigator.wakeLock={request:wakeRequest};
 let now=1000;
 const context=vm.createContext({document,window,navigator,MediaRecorder:Recorder,console,Blob,URL,DOMException,Event,devicePixelRatio:1,
  ...imported,
  crypto:{randomUUID},performance:{now:()=>now},localStorage:{getItem:()=>null,setItem(){}},
  JumpTracker:class {reset(){}startFromMotion(){}update(){return {state:'waiting',target:null,reason:'searching'};}},
  setTimeout:fn=>addTimer('timeout',fn),setInterval:fn=>addTimer('interval',fn),clearTimeout:id=>timers.delete(id),clearInterval:id=>timers.delete(id),confirm:()=>true});
 vm.runInContext(source.replace(/^import[^\n]+\n/gm,'').replaceAll('import.meta.url',JSON.stringify(appUrl.href))+`\nthis.testAPI={openCamera,closeCamera,armCapture,startMotionRecording,queueAutoFinish,finishCapture,finalizeRecording,detectLoop,
  zoom:value=>cameraZoom.set(value),
  snapshot:()=>({stream,armed,finishing,activeCapture:typeof activeCapture==='undefined'?null:activeCapture,records,armTimer,wakeLock,detectionActive,zoom:{...cameraZoom.state},zoomQuietUntil,motionSince,autoFinishAt,autoFinishReason}),
  mockProcessing:()=>{getVideoMetadata=async()=>({duration:6,width:1280,height:720});getPoster=async()=>'';persistRecord=async()=>true;selectRecord=async record=>{current=record;};},
  deferSave:promise=>{getVideoMetadata=()=>promise;},
  setMotionSignal:signal=>{motionDetector.update=()=>signal;},
  setMotion:moving=>{motionDetector.update=()=>({moving,ready:true,cameraMoving:false,changedRatio:moving ? .2 : 0});},
  setTrackerResult:result=>{tracker.update=()=>result;},
  setDetectorBoxes:boxes=>{detector={detectForVideo:()=>({detections:boxes})};},
  setDetector:(onDetect=()=>{})=>{detector={detectForVideo:()=>{onDetect();return {detections:[]};}};}};`,context);
 context.testAPI.setDetector();context.testAPI.mockProcessing();
 return {api:context.testAPI,document,window,nodes,recorders,timers,setNow:value=>now=value};
}

test('concurrent camera opens use one permission request and one camera stream',async()=>{
 const request=deferred();let calls=0;const f=fixture({getUserMedia:()=>{calls++;return request.promise;}});
 const first=f.api.openCamera(),second=f.api.openCamera();
 await settleUntil(()=>calls>0);const stream=fakeStream();request.resolve(stream);
 await first;await second;f.api.closeCamera();
 assert.equal(calls,1);assert.equal(stream.track.stops,1);
});

test('a camera permission result arriving after page hiding is stopped',async()=>{
 const request=deferred();let calls=0;const f=fixture({getUserMedia:()=>{calls++;return request.promise;}});
 const opened=f.api.openCamera();await settleUntil(()=>calls===1);
 f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));
 const stream=fakeStream();request.resolve(stream);
 await assert.rejects(opened,{name:'AbortError'});
 assert.equal(stream.track.stops,1);assert.equal(f.api.snapshot().stream,null);
});

test('a stale camera result cannot close a later successful stream',async()=>{
 const oldRequest=deferred(),newRequest=deferred();let calls=0;
 const f=fixture({getUserMedia:()=>++calls===1?oldRequest.promise:newRequest.promise});
 const first=f.api.openCamera();await settleUntil(()=>calls===1);f.api.closeCamera();
 const second=f.api.openCamera();await settleUntil(()=>calls===2);
 const currentStream=fakeStream();newRequest.resolve(currentStream);await second;
 const stale=fakeStream();oldRequest.resolve(stale);await assert.rejects(first,{name:'AbortError'});
 assert.equal(stale.track.stops,1);assert.equal(currentStream.track.stops,0);assert.equal(f.api.snapshot().stream,currentStream);
 f.api.closeCamera();
});

test('recorder error waits for final data and finalizes only once',async()=>{
 const f=fixture();await f.api.armCapture();f.api.startMotionRecording([]);const recorder=f.recorders[0];
 recorder.ondataavailable({data:new Blob([new Uint8Array(200)])});
 // Browsers can set inactive before dispatching error, then dispatch the
 // final dataavailable and stop events in subsequent tasks.
 recorder.state='inactive';recorder.onerror(new Event('error'));
 assert.equal(f.api.snapshot().finishing,true);
 recorder.ondataavailable({data:new Blob([new Uint8Array(300)])});
 const stopHandler=recorder.onstop;await stopHandler();await stopHandler();
 const state=f.api.snapshot();assert.equal(state.records.length,1);assert.equal(state.records[0].blob.size,500);
 assert.equal(state.activeCapture,null);assert.equal(state.finishing,false);
});

test('a queued ended callback from an old stream cannot stop a new recording',async()=>{
 const f=fixture();await f.api.openCamera();const oldEnded=f.api.snapshot().stream.track.onended;
 f.api.closeCamera();await f.api.armCapture();f.api.startMotionRecording([]);oldEnded();
 assert.equal(f.api.snapshot().armed,true);assert.equal(f.recorders[0].state,'recording');
 f.api.finishCapture('manual',true);await f.recorders[0].onstop();
});

test('duplicate stop callbacks cannot unlock a capture while its save is pending',async()=>{
 const f=fixture();const save=deferred();
 f.api.deferSave(save.promise);await f.api.armCapture();f.api.startMotionRecording([]);const recorder=f.recorders[0];
 recorder.ondataavailable({data:new Blob([new Uint8Array(200)])});f.api.finishCapture('manual');
 const stop=recorder.onstop;const first=stop();await stop();
 assert.equal(f.api.snapshot().finishing,true);
 save.resolve({duration:6,width:1280,height:720});await first;
 assert.equal(f.api.snapshot().records.length,1);
});

test('late wake lock remains held after foreground cancellation, then releases on hiding',async()=>{
 const wake=deferred();const f=fixture({wakeRequest:()=>wake.promise});
 const arming=f.api.armCapture();await settleUntil(()=>f.api.snapshot().armed);
 f.api.finishCapture('manual',true);
 let releases=0;const lock=new EventTarget();lock.release=async()=>{releases++;};wake.resolve(lock);await arming;await settleUntil(()=>f.api.snapshot().wakeLock===lock);
 assert.equal(f.api.snapshot().armed,false);assert.equal(releases,0);
 f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));assert.equal(releases,1);
 assert.equal([...f.timers.values()].filter(timer=>timer.kind==='interval').length,0);
});

test('late data from a previous recorder cannot enter the next capture',async()=>{
 const f=fixture();await f.api.armCapture();f.api.startMotionRecording([]);const first=f.recorders[0],oldDataHandler=first.ondataavailable;
 f.api.finishCapture('manual',true);await first.onstop();
 await f.api.armCapture();f.api.startMotionRecording([]);const second=f.recorders[1];
 oldDataHandler({data:new Blob([new Uint8Array(800)])});
 second.ondataavailable({data:new Blob([new Uint8Array(250)])});
 f.api.finishCapture('manual');await second.onstop();
 const records=f.api.snapshot().records;assert.equal(records.length,1);assert.equal(records[0].blob.size,250);
});

test('wake-lock await cannot restart timers after a visibility interruption',async()=>{
 const wake=deferred();const f=fixture({wakeRequest:()=>wake.promise});
 const arming=f.api.armCapture();await settleUntil(()=>f.api.snapshot().armed);
 f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));

 let releases=0;const lock=new EventTarget();lock.release=async()=>{releases++;};wake.resolve(lock);
 await arming;await settleUntil(()=>releases===1);
 assert.equal(f.api.snapshot().armed,false);assert.equal(f.api.snapshot().finishing,false);
 assert.equal([...f.timers.values()].filter(timer=>timer.kind==='interval').length,0);
 assert.equal(releases,1);assert.notEqual(f.nodes.captureStatus.textContent,'等待第一个出发的人 · 跟踪框出现后再出发');
});

test('waiting for departure never creates a recorder or expires at one minute',async()=>{
 const f=fixture();await f.api.armCapture();f.setNow(200000);
 for(const timer of [...f.timers.values()].filter(item=>item.kind==='interval'))timer.fn();
 assert.equal(f.recorders.length,0);assert.equal(f.api.snapshot().armed,true);assert.equal(f.api.snapshot().detectionActive,true);
 f.nodes.stopDetectionBtn.onclick();assert.equal(f.api.snapshot().armed,false);assert.equal(f.api.snapshot().detectionActive,false);
});
test('automatic video completion retains the tail and leaves detection active',async()=>{
 const f=fixture();await f.api.armCapture();f.api.startMotionRecording([]);const recorder=f.recorders[0];recorder.ondataavailable({data:new Blob([new Uint8Array(250)])});
 f.api.queueAutoFinish('motion_finished',11000);const tick=[...f.timers.values()].find(item=>item.kind==='interval').fn;
 f.setNow(13999);tick();assert.equal(recorder.state,'recording');
 f.setNow(14000);tick();assert.equal(recorder.state,'inactive');await recorder.onstop();
 assert.equal(f.api.snapshot().records.length,1);assert.equal(f.api.snapshot().armed,false);assert.equal(f.api.snapshot().detectionActive,true);assert.equal(f.api.snapshot().stream.track.stops,0);
 f.nodes.stopDetectionBtn.onclick();assert.equal(f.api.snapshot().stream,null);
});

test('zooming while waiting suppresses motion-triggered recording and inference until the image settles',async()=>{
 const applied=deferred();let constraints=0,inferences=0;
 const stream=fakeStream({zoom:true,applyZoom:()=>{constraints++;return applied.promise;}});
 const f=fixture({getUserMedia:async()=>stream});await f.api.armCapture();
 f.api.setDetector(()=>inferences++);f.api.setMotion(true);
 const zoom=f.api.zoom(2);await settleUntil(()=>constraints===1);
 for(const now of [1500,2000,3000]){f.setNow(now);f.api.detectLoop();}
 assert.equal(f.recorders.length,0);assert.equal(inferences,0);assert.equal(f.api.snapshot().motionSince,null);
 applied.resolve();await zoom;
 f.setNow(3999);f.api.detectLoop();assert.equal(f.recorders.length,0);assert.equal(inferences,0);
 // Sustained subject motion may start a recording once the zoom has settled.
 f.setNow(4001);f.api.detectLoop();f.setNow(4501);f.api.detectLoop();
 assert.equal(f.recorders.length,1);assert.equal(inferences,2);
 f.api.finishCapture('manual',true);await f.recorders[0].onstop();
});

test('zoom preserves the active recorder stream and suspends motion completion without removing the duration safety limit',async()=>{
 const applied=deferred();let constraints=0,inferences=0;
 const stream=fakeStream({zoom:true,applyZoom:()=>{constraints++;return applied.promise;}});
 const f=fixture({getUserMedia:async()=>stream});await f.api.armCapture();f.api.startMotionRecording([]);
 const recorder=f.recorders[0],tick=[...f.timers.values()].find(item=>item.kind==='interval').fn;
 f.api.setDetector(()=>inferences++);f.api.setTrackerResult({state:'complete',target:null,reason:'visible_arc_finished'});
 f.api.queueAutoFinish('motion_finished',11000);f.setNow(12000);
 const zoom=f.api.zoom(2);await settleUntil(()=>constraints===1);
 assert.equal(f.api.snapshot().autoFinishAt,null);
 f.setNow(15000);f.api.detectLoop();tick();
 assert.equal(inferences,0);assert.equal(f.api.snapshot().autoFinishAt,null);assert.equal(recorder.state,'recording');
 assert.equal(recorder.stream,stream);assert.equal(f.api.snapshot().stream,stream);assert.equal(stream.track.stops,0);
 f.setNow(46000);tick();assert.equal(f.api.snapshot().autoFinishReason,'max_duration');assert.equal(recorder.state,'recording');
 f.setNow(49000);tick();assert.equal(recorder.state,'inactive');
 await recorder.onstop();applied.resolve();await zoom;
});

test('a zoom completion from a closed camera cannot change the new camera or its motion cooldown',async()=>{
 const applied=deferred();let requests=0,changes=0;
 const old=fakeStream({zoom:true,applyZoom:()=>{changes++;return applied.promise;}}),current=fakeStream({zoom:true});
 const f=fixture({getUserMedia:async()=>++requests===1?old:current});await f.api.openCamera();
 const zoom=f.api.zoom(2);await settleUntil(()=>changes===1);f.api.closeCamera();f.setNow(5000);await f.api.openCamera();
 const quiet=f.api.snapshot().zoomQuietUntil;
 applied.resolve();await zoom;
 const state=f.api.snapshot();assert.equal(state.stream,current);assert.equal(state.zoom.value,1);assert.equal(state.zoom.busy,false);
 assert.equal(state.zoomQuietUntil,quiet);assert.equal(old.track.stops,1);assert.equal(current.track.stops,0);
 f.api.closeCamera();
});

test('first two seconds cannot trigger; continuous confirmation starts only afterwards',async()=>{
 const f=fixture();await f.api.armCapture();f.api.setMotion(true);
 for(const time of [1200,1600,2200,2800,2999]){f.setNow(time);f.api.detectLoop();}
 assert.equal(f.recorders.length,0);assert.equal(f.api.snapshot().motionSince,null);
 f.setNow(3000);f.api.detectLoop();assert.equal(f.recorders.length,0);
 f.setNow(3349);f.api.detectLoop();assert.equal(f.recorders.length,0);
 f.setNow(3350);f.api.detectLoop();assert.equal(f.recorders.length,1);
});
test('a brief change after warmup still needs continuous confirmation',async()=>{
 const f=fixture();await f.api.armCapture();f.api.setMotion(true);f.setNow(3000);f.api.detectLoop();
 f.api.setMotion(false);f.setNow(3200);f.api.detectLoop();
 f.api.setMotion(true);f.setNow(3400);f.api.detectLoop();f.setNow(3600);f.api.detectLoop();assert.equal(f.recorders.length,0);
 f.setNow(3750);f.api.detectLoop();assert.equal(f.recorders.length,1);
});

test('tiny continuous image noise cannot keep a completed empty scene recording forever',async()=>{
 const f=fixture();await f.api.armCapture();f.api.startMotionRecording([]);
 f.api.setMotionSignal({moving:true,ready:true,cameraMoving:false,changedRatio:.0004});
 for(const now of [1500,3000,5000,8000,11000,13000]){f.setNow(now);f.api.detectLoop();}
 assert.notEqual(f.api.snapshot().autoFinishAt,null,'finished quiet scene must queue automatic completion despite tiny start-level motion');
});

test('a stationary visible person does not block a quiet-scene finish',async()=>{
 const f=fixture();await f.api.armCapture();f.api.startMotionRecording([]);f.api.setMotionSignal({moving:false,ready:true,cameraMoving:false,changedRatio:0});
 f.api.setDetectorBoxes([{boundingBox:{originX:500,originY:250,width:80,height:180},categories:[{score:.8}]}]);
 for(const now of [1500,4000,11000]){f.setNow(now);f.api.detectLoop();}
 assert.notEqual(f.api.snapshot().autoFinishAt,null);
});
test('significant continuing motion prevents a quiet-scene finish',async()=>{
 const f=fixture();await f.api.armCapture();f.api.startMotionRecording([]);f.api.setMotionSignal({moving:true,ready:true,cameraMoving:false,changedRatio:.01});
 for(const now of [1500,4000,8000,11000,15000]){f.setNow(now);f.api.detectLoop();}
 assert.equal(f.api.snapshot().autoFinishAt,null);
});

test('quiet-scene finish can be queued early but never stops before ten seconds',async()=>{
 const f=fixture();await f.api.armCapture();f.api.startMotionRecording([]);f.api.setMotion(false);
 f.setNow(1999);f.api.detectLoop();assert.equal(f.api.snapshot().autoFinishAt,null);
 f.setNow(2000);f.api.detectLoop();assert.equal(f.api.snapshot().autoFinishAt,11000);
 const tick=[...f.timers.values()].find(item=>item.kind==='interval').fn;
 f.setNow(10999);tick();assert.equal(f.recorders[0].state,'recording');
 f.setNow(11000);tick();assert.equal(f.recorders[0].state,'inactive');
});
test('resumed substantial motion cancels a pending quiet-scene finish',async()=>{
 const f=fixture();await f.api.armCapture();f.api.startMotionRecording([]);f.api.setMotion(false);
 f.setNow(3300);f.api.detectLoop();assert.equal(f.api.snapshot().autoFinishReason,'motion_finished');
 f.api.setMotion(true);f.setNow(4000);f.api.detectLoop();assert.equal(f.api.snapshot().autoFinishAt,null);
 const tick=[...f.timers.values()].find(item=>item.kind==='interval').fn;
 f.setNow(11000);tick();assert.equal(f.recorders[0].state,'recording');
});
