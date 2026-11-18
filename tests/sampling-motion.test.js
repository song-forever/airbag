import test from 'node:test';
import assert from 'node:assert/strict';
import {observeMotion,estimateMotionEpisode,createMotionScout} from '../src/sampling-motion.js';
import {getScoutFrameTimes,getAdaptiveFrameTimes} from '../src/frame-sampling.js';

const width=108,height=192,dt=.125,duration=6;
const background=(x,y)=>60+((Math.floor(x/4)*13+Math.floor(y/4)*7+(Math.floor(x/8)*Math.floor(y/8)%9)*11)%100);
function frame({brightness=0,dx=0,dy=0,rect=null}={}){
 const out=new Uint8Array(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const wx=(x-dx+width*100)%width,wy=(y-dy+height*100)%height;
  let value=background(wx,wy);
  if(rect&&wx>=rect.x*width&&wx<(rect.x+rect.w)*width&&wy>=rect.y*height&&wy<(rect.y+rect.h)*height)value=220;
  out[y*width+x]=Math.max(0,Math.min(255,value+brightness));
 }
 return out;
}
function sequence(options){
 const observations=[];let previous=frame(options(0));
 for(let i=1;i<48;i++){
  const current=frame(options(i));observations.push(observeMotion(current,previous,{width,height,time:i*dt}));previous=current;
 }
 return {observations,proposal:estimateMotionEpisode(observations,{duration})};
}
test('static scenes and uniform exposure changes do not invent a jump window',()=>{
 for(const options of [()=>({}),i=>({brightness:Math.round(Math.sin(i/5)*25)})]){
  const {proposal}=sequence(options);assert.equal(proposal.window,null);assert.equal(proposal.confidence,'unknown');
 }
});
test('background pan and repeated camera shake remain unknown',()=>{
 for(const options of [i=>({dx:i}),i=>({dx:[-2,0,2,0][i%4],dy:[-1,0,1,0][i%4]})]){
  const {observations,proposal}=sequence(options);assert.ok(observations.some(o=>o.cameraShift.accepted));
  assert.equal(proposal.window,null);assert.equal(proposal.confidence,'unknown');
 }
});
test('a large foreground pass is insufficient evidence for the far-end jump',()=>{
 const {proposal}=sequence(i=>({rect:i>=8&&i<25?{x:.12+(i-8)*.018,y:.18,w:.25,h:.63}:null}));
 assert.equal(proposal.window,null);assert.equal(proposal.reason,'large-foreground-motion');
});
test('two equally strong moving episodes do not arbitrarily choose one',()=>{
 const {proposal}=sequence(i=>{
  const phase=i>=8&&i<20?i-8:i>=30&&i<42?i-30:null;
  return {rect:phase===null?null:{x:.1+phase*.045,y:.35,w:.13,h:.2}};
 });
 assert.equal(proposal.window,null);assert.equal(proposal.reason,'multiple-comparable-episodes');
});
test('local travel survives pan and exposure while retaining sparse context outside the proposal',()=>{
 const {proposal}=sequence(i=>{const p=(i-8)/14;return {dx:i,brightness:Math.round(Math.sin(i/5)*20),
  rect:p>=0&&p<1?{x:.1+p*.5,y:.5-Math.sin(p*Math.PI)*.2,w:.13,h:.2}:null};});
 assert.equal(proposal.confidence,'medium');
 assert.ok(proposal.window.start>0&&proposal.window.start<=1);
 assert.ok(proposal.window.end>=2.75&&proposal.window.end<duration-1);
 assert.ok(proposal.window.end-proposal.window.start<duration*.5);
});
test('malformed observations and pixel inputs return unknown or null safely',()=>{
 assert.equal(observeMotion(new Uint8Array(1),new Uint8Array(1),{width,height,time:0}),null);
 for(const observations of [null,[null],[{time:1,energy:NaN}],[{time:1,energy:0},{time:.5,energy:0}]]){
  assert.equal(estimateMotionEpisode(observations,{duration}).confidence,'unknown');
 }
});
test('a motion episode at a fractional-duration tail stays inside the video and can be sampled',()=>{
 const duration=6.2056;
 const observations=getScoutFrameTimes(duration).map(time=>({time,energy:time>=5.5?.01:0,global:false,
  component:time>=5.5?{cx:.2+(time-5.5)*.3,cy:.4,w:.1,h:.2}:null,cameraShift:{accepted:false}}));
 const proposal=estimateMotionEpisode(observations,{duration});
 assert.equal(proposal.confidence,'medium');
 assert.ok(proposal.window.end<=duration,'rounding cannot exceed a legitimate fractional video duration');
 const sampled=getAdaptiveFrameTimes(duration,{window:proposal.window});
 assert.ok(sampled.times.at(-1)<=duration-.12);
});

function canvasHarness({missingRead=false,throwRead=false,badPixels=false}={}){
 const calls={create:0,draw:0,read:0};let pixels=null;
 const context={drawImage(){calls.draw++;},getImageData(){calls.read++;if(throwRead)throw Error('read denied');return {data:badPixels?new Uint8Array(4):pixels};}};
 if(missingRead)delete context.getImageData;
 const canvas={width:0,height:0,getContext(){return context;}};
 const scout=createMotionScout({createCanvas(){calls.create++;return canvas;}});
 return {scout,canvas,calls,setPixels(gray){
  pixels=new Uint8ClampedArray(gray.length*4);
  for(let i=0;i<gray.length;i++){pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=gray[i];pixels[i*4+3]=255;}
 }};
}
test('streaming scout keeps a fixed 192px canvas and returns scalar features, then releases it',()=>{
 const h=canvasHarness(),video={videoWidth:720,videoHeight:1280,currentTime:19};
 for(let i=0;i<40;i++){
  h.setPixels(frame({rect:i>=8&&i<24?{x:.1+(i-8)*.03,y:.4,w:.13,h:.2}:null}));
  const result=h.scout.observe(video,i*dt);
  if(i===0)assert.equal(result,null);
  else{assert.equal(result.time,i*dt);assert.ok(Object.values(result).every(value=>!ArrayBuffer.isView(value)),'features retain no decoded frame');}
  assert.equal(h.canvas.width,width);assert.equal(h.canvas.height,height);
 }
 assert.equal(video.currentTime,19,'observation must not seek the video');
 assert.equal(h.calls.create,1,'streaming does not allocate a canvas for every frame');
 assert.equal(h.calls.draw,40);assert.equal(h.calls.read,40);
 h.scout.dispose();assert.equal(h.canvas.width,0);assert.equal(h.canvas.height,0);
 assert.equal(h.scout.observe(video,6),null);assert.equal(h.calls.draw,40);
});
test('a canvas without pixel read support is disabled before drawing',()=>{
 const h=canvasHarness({missingRead:true});
 for(let i=0;i<3;i++)assert.equal(h.scout.observe({videoWidth:720,videoHeight:1280},i),null);
 assert.equal(h.calls.create,1);assert.equal(h.calls.draw,0);assert.equal(h.calls.read,0);
});
test('canvas, DOM and pixel failures safely disable only the motion scout',()=>{
 assert.equal(createMotionScout().observe({videoWidth:720,videoHeight:1280},0),null);
 assert.equal(createMotionScout({createCanvas(){throw Error('no canvas');}}).observe({videoWidth:720,videoHeight:1280},0),null);
 for(const options of [{throwRead:true},{badPixels:true}]){
  const h=canvasHarness(options),video={videoWidth:720,videoHeight:1280};
  assert.equal(h.scout.observe(video,0),null);assert.equal(h.scout.observe(video,1),null);
  assert.equal(h.calls.draw,1);assert.equal(h.canvas.width,0);
 }
});
test('orientation or backward time starts a new one-frame history',()=>{
 const h=canvasHarness(),video={videoWidth:720,videoHeight:1280};h.setPixels(frame());
 assert.equal(h.scout.observe(video,1),null);assert.ok(h.scout.observe(video,2));
 assert.equal(h.scout.observe(video,.5),null);assert.ok(h.scout.observe(video,.625));
 video.videoWidth=1280;video.videoHeight=720;
 h.setPixels(new Uint8Array(192*108));assert.equal(h.scout.observe(video,.75),null);
 assert.equal(h.canvas.width,192);assert.equal(h.canvas.height,108);
});
