import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAnalysisFrames } from '../src/analysis-preparation.js';
const JPEG='data:image/jpeg;base64,/9j/4AECA//Z';
function fixture({start=0,end=6.2,detector=true}={}){
 const video={duration:10,videoWidth:720,videoHeight:1280,currentTime:0};
 const draws=[],encoded=[],seeks=[],events=[];
 const canvas={width:0,height:0,getContext:()=>({drawImage:(...args)=>draws.push(args)})};
 const options={start,end,seek:async(v,t)=>{seeks.push(t);v.currentTime=t;},createCanvas:()=>canvas,
  yieldTask:async()=>{},encode:async(c,opts)=>{encoded.push({width:c.width,height:c.height,maxBytes:opts.maxBytes,time:video.currentTime});return JPEG;},
  onProgress:event=>events.push(event)};
 if(detector)options.detectPersons=v=>{
  const t=v.currentTime-start,y=t<=4?.5-t*.1:.1+(t-4)*.15;
  return [{x:.45,y,w:.06,h:.1,score:.9}];
 };
 return {video,options,draws,encoded,seeks,events};
}
test('one sparse/dense/cropped sequence is prepared from source pixels, not extra detail images',async()=>{
 const f=fixture(),result=await prepareAnalysisFrames(f.video,f.options);
 assert.equal(result.samplingMetadata.strategy,'adaptive-subject-crop');assert.equal(result.samplingMetadata.windowSource,'detected');
 assert.ok(result.preparation.denseFrameCount>result.preparation.beforeFrameCount+result.preparation.afterFrameCount);
 assert.ok(result.preparation.denseFps>=20);assert.equal(result.frames.length,f.encoded.length);assert.equal(result.frames.length,f.draws.length);
 assert.ok(result.frames.length>=4&&result.frames.length<=96);assert.ok(result.samplingMetadata.croppedFrameCount>0);
 for(let i=0;i<result.frames.length;i++){
  const frame=result.frames[i],draw=f.draws[i];assert.equal(draw.length,9);assert.equal(draw[0],f.video);
  assert.ok(frame.time>=.01&&frame.time<=6.08);if(i)assert.ok(frame.time>result.frames[i-1].time);
  assert.ok(Math.max(f.encoded[i].width,f.encoded[i].height)<=512);
  if(frame.crop){assert.equal(frame.crop.sourceWidth,720);assert.equal(frame.crop.sourceHeight,1280);assert.equal(draw[1],frame.crop.x);assert.equal(draw[3],frame.crop.width);}
 }
 assert.ok(!Object.hasOwn(result,'details'));assert.ok(!Object.hasOwn(result,'frameGroups'));
});
test('unavailable or failing local detection keeps complete images and honestly labels the default interval',async()=>{
 for(const failing of [false,true]){
  const f=fixture({detector:false});if(failing)f.options.detectPersons=()=>{throw Error('local detector unavailable');};
  const r=await prepareAnalysisFrames(f.video,f.options);assert.equal(r.samplingMetadata.windowSource,'fallback');assert.equal(r.samplingMetadata.croppedFrameCount,0);
  assert.ok(r.frames.every(frame=>!frame.crop));assert.equal(r.frames.length,f.encoded.length);
  for(const draw of f.draws)assert.deepEqual(draw.slice(1,5),[0,0,720,1280]);
 }
});
test('trimmed video seeks use absolute times but returned evidence times remain clip-relative',async()=>{
 const f=fixture({start:2,end:8.2}),r=await prepareAnalysisFrames(f.video,f.options);
 assert.ok(f.seeks.every(time=>time>=2.01&&time<=8.08));
 for(let i=0;i<r.frames.length;i++)assert.ok(Math.abs(r.frames[i].time+2-f.encoded[i].time)<1e-8);
});
test('abort during scouting or encoding stops preparation before publishing partial frames',async()=>{
 for(const phase of ['scout','encode']){
  const f=fixture(),controller=new AbortController();f.options.signal=controller.signal;
  f.options.onProgress=event=>{if(event.phase===phase)controller.abort();};
  await assert.rejects(prepareAnalysisFrames(f.video,f.options),e=>e.name==='AbortError');
  if(phase==='scout')assert.equal(f.encoded.length,0);else assert.equal(f.encoded.length,1);
 }
});
test('pre-aborted, bad input and decoder errors do not reach image encoding',async()=>{
 const f=fixture(),c=new AbortController();c.abort();await assert.rejects(prepareAnalysisFrames(f.video,{...f.options,signal:c.signal}),e=>e.name==='AbortError');
 await assert.rejects(prepareAnalysisFrames(f.video,{...f.options,end:100}),RangeError);
 await assert.rejects(prepareAnalysisFrames(f.video,{...f.options,seek:async()=>{throw Error('decoder failed');}}),/decoder failed/);
 assert.equal(f.encoded.length,0);
});
