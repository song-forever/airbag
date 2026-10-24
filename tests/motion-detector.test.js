import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const app=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('function detectFrameChange(video)'),app.indexOf('function startMotionRecording(',app.indexOf('function detectFrameChange(video)')));
let Detector;try{({FrameMotionDetector:Detector}=await import('../src/motion-detector.js'));}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const width=160,height=90;
function image({shift=0,box=0,brightness=0,flat=false}={}){
 const data=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const px=(x-shift+width)%width;
  let value=flat?80:35+((Math.imul(px+17,73856093)^Math.imul(y+31,19349663))>>>0)%150;
  if(px>=box&&px<box+36&&y>=25&&y<65)value=235;
  value=Math.min(255,value+brightness);const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
 }
 return data;
}
function harness(){let frame,now=0;const context=vm.createContext({Uint8Array,Math,performance:{now:()=>now},motionCanvas:{width,height},motionContext:{drawImage(){},getImageData(){return {data:frame};}},previousMotionFrame:null,motionDetector:Detector?new Detector({width,height}):null,motionState:null});vm.runInContext(source+';this.check=detectFrameChange;',context);return (data,time)=>{frame=data;now=time;return context.check({});};}
test('moving the whole camera and returning it to its position does not count as departure',()=>{
 const check=harness();check(image({box:15}),1000);check(image({box:15}),1800);
 assert.equal(check(image({shift:3,box:15}),2000),false,'a global frame translation must be rejected');
 assert.equal(check(image({box:15}),2180),false,'returning the camera must also be rejected');
});
test('a local moving object in a fixed scene still produces a motion signal',()=>{
 const check=harness();check(image({box:5}),1000);check(image({box:5}),1800);
 const signals=[25,50,75].map((box,i)=>check(image({box}),2000+i*180));assert.ok(signals.every(Boolean));
});
test('uniform lighting changes alone do not trigger departure',()=>{
 const check=harness();check(image({box:15}),1000);check(image({box:15}),1800);assert.equal(check(image({box:15,brightness:12}),2000),false);
});

test('a rider moving against a plain background is not mistaken for camera shake',()=>{
 const check=harness();check(image({box:5,flat:true}),1000);check(image({box:5,flat:true}),1800);assert.equal(check(image({box:40,flat:true}),2000),true);
});

function largeMovingRider(shift){
 const data=image({box:150});
 for(let y=0;y<height;y++)for(let x=0;x<112;x++){
  const px=(x-shift+width)%width;
  const value=35+((Math.imul(px+17,73856093)^Math.imul(y+31,19349663))>>>0)%150;
  const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=value;
 }
 return data;
}
test('nearby rider covering most cells does not suppress departure while background stays fixed',()=>{
 const check=harness();check(largeMovingRider(0),1000);check(largeMovingRider(0),1800);
 assert.equal(check(largeMovingRider(3),2000),true,'stationary textured background contradicts global camera translation');
});
test('a large local change survives the production consecutive-motion departure gate',()=>{
 const loop=app.slice(app.indexOf('function detectLoop()'),app.indexOf('function finishCapture('));
 let now=0,frame,starts=0;
 const context=vm.createContext({Uint8Array,Math,performance:{now:()=>now},motionCanvas:{width,height},motionContext:{drawImage(){},getImageData(){return {data:frame}}},motionDetector:new Detector({width,height}),motionState:null,motionSince:null,lastMotionAt:null,detectionActive:true,stream:{},cameraZoom:{state:{busy:false}},zoomQuietUntil:0,ui:{cameraVideo:{readyState:4,videoWidth:720,videoHeight:1280},cameraHint:{}},detector:null,analysisBusy:false,finishing:false,armed:true,departureAt:null,firstPersonAt:null,recordingStart:0,MIN_RECORDING_MS:10000,tracker:{update:()=>({state:'tracking',target:null})},drawTarget(){},queueAutoFinish(){},startMotionRecording(){starts++;context.departureAt=now;context.recordingStart=now},status(){},setTimeout(){},inferenceTimer:null});
 vm.runInContext(source+'\n'+loop+';this.tick=detectLoop;',context);
 for(const [time,shift] of [[1000,0],[1800,0],[2000,3],[2180,6],[2360,9]]){now=time;frame=largeMovingRider(shift);context.tick();}
 assert.equal(starts,1);
});
