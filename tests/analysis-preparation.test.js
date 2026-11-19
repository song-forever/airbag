import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAnalysisFrames } from '../src/analysis-preparation.js';
import { planSubjectCrops, estimateAirborneWindow } from '../src/subject-crop.js';
import { getScoutFrameTimes, getAdaptiveFrameTimes } from '../src/frame-sampling.js';
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
function recordCropPlan(f) {
 const observations=new Map(),detect=f.options.detectPersons;
 f.options.detectPersons=video=>{
  const detections=detect(video),time=video.currentTime-f.options.start;
  observations.set(time,{time,detections});return detections;
 };
 return ()=>new Map(planSubjectCrops([...observations.values()].sort((a,b)=>a.time-b.time),
  {width:f.video.videoWidth,height:f.video.videoHeight}).frames.map(frame=>[frame.time,frame]));
}
const dimensions=frames=>new Set(frames.map(frame=>`${frame.crop.width}x${frame.crop.height}`));
const positions=frames=>new Set(frames.map(frame=>`${frame.crop.x},${frame.crop.y}`));
function assertContains(crop,original) {
 assert.ok(crop.x<=original.x&&crop.y<=original.y);
 assert.ok(crop.x+crop.width>=original.x+original.width&&crop.y+crop.height>=original.y+original.height);
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
test('missing person detections do not leave an early flight in sparse context',async()=>{
 const f=fixture({detector:false,end:5.17});
 f.options.detectPersons=()=>[];
 const r=await prepareAnalysisFrames(f.video,f.options);
 assert.equal(r.samplingMetadata.windowSource,'fallback');
 assert.deepEqual(r.samplingMetadata.denseWindow,{start:.01,end:5.05});
 assert.ok(r.frames.filter(frame=>frame.time>=.8&&frame.time<=1.25).length>=4);
 assert.ok(r.frames.length<=96);
});
test('a short visibility track before flight is not treated as the end of the action',async()=>{
 const f=fixture({detector:false,end:10});
 f.options.detectPersons=v=>v.currentTime>=8.05&&v.currentTime<=8.45
  ? [{x:.5,y:.4,w:.08,h:.15,score:.9}]:[];
 const r=await prepareAnalysisFrames(f.video,f.options);
 assert.equal(r.samplingMetadata.windowSource,'fallback');
 assert.ok(r.samplingMetadata.denseWindow.start<8);
 assert.ok(r.samplingMetadata.denseWindow.end>=9.5);
 assert.ok(r.frames.filter(frame=>frame.time>=9.14&&frame.time<=9.25).length>=2);
 assert.ok(r.frames.length<=96);
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

test('dense frames keep one scale while translating and retain three existing full-view anchors',async()=>{
 const f=fixture(),rawPlan=recordCropPlan(f),result=await prepareAnalysisFrames(f.video,f.options),window=result.samplingMetadata.denseWindow;
 const before=result.frames.filter(frame=>frame.time<window.start).at(-1);
 const after=result.frames.find(frame=>frame.time>window.end);
 const center=(window.start+window.end)/2;
 const middle=result.frames.filter(frame=>frame!==before&&frame!==after)
  .reduce((best,frame)=>Math.abs(frame.time-center)<Math.abs(best.time-center)?frame:best);
 assert.ok(before&&after&&middle);assert.ok(!before.crop&&!after.crop&&!middle.crop);
 const dense=result.frames.filter(frame=>frame.time>=window.start&&frame.time<=window.end&&frame!==middle);
 assert.ok(dense.length>3);assert.ok(dense.every(frame=>frame.crop));
 assert.equal(dimensions(dense).size,1);assert.ok(positions(dense).size>1);
 const raw=rawPlan();for(const frame of dense)assertContains(frame.crop,raw.get(frame.time).rect);
 assert.equal(result.frames.length,result.preparation.beforeFrameCount+result.preparation.denseFrameCount+result.preparation.afterFrameCount);
 assert.equal(result.samplingMetadata.croppedFrameCount,result.frames.filter(frame=>frame.crop).length);
 assert.equal(f.draws.length,result.frames.length);
});
test('a tracking gap stays full-view and separates independently fixed crop scales',async()=>{
 const f=fixture(),detect=f.options.detectPersons;
 f.options.detectPersons=video=>{
  const boxes=detect(video);
  return video.currentTime>=3.7&&video.currentTime<=3.9?[...boxes,...boxes]:boxes;
 };
 const result=await prepareAnalysisFrames(f.video,f.options),window=result.samplingMetadata.denseWindow;
 const dense=result.frames.filter(frame=>frame.time>=window.start&&frame.time<=window.end);
 const gap=dense.filter(frame=>frame.time>=3.7&&frame.time<=3.9);
 const before=dense.filter(frame=>frame.time<3.7&&frame.crop),after=dense.filter(frame=>frame.time>3.9&&frame.crop);
 assert.ok(gap.length>=2&&before.length>3&&after.length>3);
 assert.ok(gap.every(frame=>!frame.crop));
 for(const frame of gap){const index=result.frames.indexOf(frame);assert.deepEqual(f.draws[index].slice(1,5),[0,0,720,1280]);}
 assert.equal(dimensions(before).size,1);assert.equal(dimensions(after).size,1);
 assert.ok(positions(before).size>1&&positions(after).size>1);
 assert.notDeepEqual([before[0].crop.width,before[0].crop.height],[after[0].crop.width,after[0].crop.height]);
});
test('short isolated reliable runs stay full-view instead of forming a crop across gaps',async()=>{
 const f=fixture(),observations=new Map();
 f.options.detectPersons=video=>{
  const boxes=[{x:.45,y:.4,w:.06,h:.1,score:.9}],phase=video.currentTime%.2;
  const detections=phase<.075?boxes:[...boxes,...boxes];
  observations.set(video.currentTime,{time:video.currentTime,detections});
  return detections;
 };
 const result=await prepareAnalysisFrames(f.video,f.options),window=result.samplingMetadata.denseWindow;
 const dense=result.frames.filter(frame=>frame.time>=window.start&&frame.time<=window.end);
 const plan=planSubjectCrops([...observations.values()].sort((a,b)=>a.time-b.time),{width:720,height:1280});
 const raw=new Map(plan.frames.map(frame=>[frame.time,frame]));
 assert.ok(dense.filter(frame=>raw.get(frame.time)?.rect).length>=3);
 assert.ok(dense.every(frame=>!frame.crop));
});
test('a wide trajectory keeps the rider enlarged and edge clamping preserves every padded crop',async()=>{
 const f=fixture();
 f.options.detectPersons=video=>{
  const travel=video.currentTime*.105;
  return [{x:.01+travel,y:.01+travel,w:.3,h:.3,score:.9}];
 };
 const rawPlan=recordCropPlan(f),result=await prepareAnalysisFrames(f.video,f.options),window=result.samplingMetadata.denseWindow;
 const dense=result.frames.filter(frame=>frame.time>=window.start&&frame.time<=window.end&&frame.crop),raw=rawPlan();
 assert.ok(dense.length>3);assert.equal(dimensions(dense).size,1);assert.ok(positions(dense).size>1);
 assert.ok(dense.some(frame=>frame.crop.x===0)&&dense.some(frame=>frame.crop.y===0));
 assert.ok(dense.some(frame=>frame.crop.x+frame.crop.width===720));
 assert.ok(dense.some(frame=>frame.crop.y+frame.crop.height===1280));
 for(const frame of dense){
  const crop=frame.crop;assertContains(crop,raw.get(frame.time).rect);
  assert.ok(crop.x>=0&&crop.y>=0&&crop.x+crop.width<=720&&crop.y+crop.height<=1280);
  const draw=f.draws[result.frames.indexOf(frame)];assert.deepEqual(draw.slice(1,5),[crop.x,crop.y,crop.width,crop.height]);
 }
});
test('a run whose common width and height exceed the area limit stays full-view',async()=>{
 const f=fixture();f.video.videoWidth=1000;f.video.videoHeight=1000;
 f.options.detectPersons=video=>{
  const progress=video.currentTime/6.2,w=.7-.4*progress,h=.3+.4*progress;
  return [{x:(1-w)/2,y:(1-h)/2,w,h,score:.9}];
 };
 const rawPlan=recordCropPlan(f),result=await prepareAnalysisFrames(f.video,f.options),window=result.samplingMetadata.denseWindow;
 const dense=result.frames.filter(frame=>frame.time>=window.start&&frame.time<=window.end),raw=rawPlan();
 const original=dense.map(frame=>raw.get(frame.time).rect).filter(Boolean);
 assert.ok(original.length>3);
 assert.ok(Math.max(...original.map(rect=>rect.width))*Math.max(...original.map(rect=>rect.height))>=1000*1000*.65);
 assert.ok(dense.every(frame=>!frame.crop));
});

test('a reliable full-frame scout trajectory excludes fallback detection from all later frames',async()=>{
 const baseline=fixture(),expected=await prepareAnalysisFrames(baseline.video,baseline.options);
 const f=fixture(),detect=f.options.detectPersons;let fullCalls=0,fallbackCalls=0;
 f.options.detectPersons=()=>{fallbackCalls++;throw Error('fallback must not run');};
 f.options.detectPersons.fullFrame=video=>{fullCalls++;return detect(video);};
 const result=await prepareAnalysisFrames(f.video,f.options);
 assert.equal(fallbackCalls,0);assert.ok(fullCalls>=result.preparation.scoutCount);
 assert.deepEqual(result,expected);
});
test('an unsuccessful full-frame scout enables fallback only when its tracked coverage improves',async()=>{
 const baseline=fixture(),expected=await prepareAnalysisFrames(baseline.video,baseline.options);
 const f=fixture(),detect=f.options.detectPersons;let fullCalls=0,fallbackCalls=0;
 f.options.detectPersons=video=>{fallbackCalls++;return detect(video);};
 f.options.detectPersons.fullFrame=()=>{fullCalls++;throw Error('full-frame detector failed');};
 const result=await prepareAnalysisFrames(f.video,f.options);
 assert.ok(fallbackCalls>fullCalls);assert.equal(result.preparation.scoutCount,fullCalls*2);
 assert.deepEqual(result.frames,expected.frames);assert.deepEqual(result.samplingMetadata,expected.samplingMetadata);
 const events=f.events.filter(event=>event.phase==='scout');
 assert.equal(events.length,fullCalls*2);assert.equal(events.at(-1).total,events.length);
 assert.ok(events.every((event,index)=>event.completed===index+1&&event.completed<=event.total));
});
test('failed or equally useful fallback scouting restores full-frame observations and detector',async()=>{
 for(const fail of [true,false]){
  const baseline=fixture(),detect=baseline.options.detectPersons;
  baseline.options.detectPersons=video=>video.currentTime<=.22?detect(video):[];
  const expected=await prepareAnalysisFrames(baseline.video,baseline.options);
  const f=fixture();let fullCalls=0,fallbackCalls=0;
  f.options.detectPersons=video=>{
   fallbackCalls++;if(fail)throw Error('fallback failed');
   return video.currentTime<=.22?[{x:.1,y:.4,w:.06,h:.1,score:.9}]:[];
  };
  f.options.detectPersons.fullFrame=video=>{fullCalls++;return baseline.options.detectPersons(video);};
  const result=await prepareAnalysisFrames(f.video,f.options);
  assert.ok(fallbackCalls>0&&fullCalls>fallbackCalls);
  assert.equal(result.preparation.scoutCount,fallbackCalls*2);
  assert.ok(expected.samplingMetadata.croppedFrameCount>0);
  assert.deepEqual(result.frames,expected.frames);assert.deepEqual(result.samplingMetadata,expected.samplingMetadata);
 }
});
test('abort during fallback scouting never proceeds to locating or encoding',async()=>{
 const f=fixture(),controller=new AbortController();let fallbackCalls=0;
 f.options.signal=controller.signal;
 f.options.detectPersons=()=>{fallbackCalls++;controller.abort();return [];};
 f.options.detectPersons.fullFrame=()=>[];
 await assert.rejects(prepareAnalysisFrames(f.video,f.options),error=>error.name==='AbortError');
 assert.equal(fallbackCalls,1);assert.equal(f.encoded.length,0);
 assert.ok(f.events.every(event=>event.phase==='scout'));
});
test('a nonfunction detector does not invoke its fullFrame property and keeps full-view evidence',async()=>{
 const f=fixture();let calls=0;f.options.detectPersons={fullFrame:()=>{calls++;return [];}};
 const result=await prepareAnalysisFrames(f.video,f.options);
 assert.equal(calls,0);assert.ok(result.preparation.scoutCount>0);assert.ok(result.frames.every(frame=>!frame.crop));
});

test('failure of both detector paths safely retains complete frames',async()=>{
 const f=fixture();f.options.detectPersons=()=>{throw Error('fallback failed');};
 f.options.detectPersons.fullFrame=()=>{throw Error('full-frame failed');};
 const result=await prepareAnalysisFrames(f.video,f.options);
 assert.ok(result.frames.every(frame=>!frame.crop));
 assert.equal(result.samplingMetadata.croppedFrameCount,0);
 assert.equal(result.samplingMetadata.windowSource,'fallback');
 assert.ok(result.preparation.scoutCount>0);
});

test('a missing reliable window densely covers the seekable clip including an early jump',async()=>{
 for(const oneDetection of [false,true]){
  const f=fixture({end:5.16,detector:false});
  if(oneDetection)f.options.detectPersons=video=>video.currentTime===.01?[{x:.4,y:.4,w:.06,h:.1,score:.9}]:[];
  const result=await prepareAnalysisFrames(f.video,f.options);
  assert.deepEqual(result.samplingMetadata.denseWindow,{start:.01,end:5.04});
  assert.equal(result.samplingMetadata.windowSource,'fallback');
  assert.equal(result.preparation.beforeFrameCount,0);assert.equal(result.preparation.afterFrameCount,0);
  assert.ok(result.frames.length<=64);assert.equal(result.frames[0].time,.01);assert.equal(result.frames.at(-1).time,5.04);
  assert.ok(result.frames.some(frame=>Math.abs(frame.time-1.185)<.06));
 }
});
test('partial visibility expands before appearance and beyond disappearance instead of ending flight',async()=>{
 for(const visible of [{start:0,end:.9,event:1.8},{start:2,end:2.7,event:3.5}]){
  const f=fixture();
  f.options.detectPersons=video=>video.currentTime>=visible.start&&video.currentTime<=visible.end?[{x:.4,y:.5,w:.06,h:.1,score:.9}]:[];
  const scouts=getScoutFrameTimes(6.2).filter(time=>time>=visible.start&&time<=visible.end);
  const result=await prepareAnalysisFrames(f.video,f.options),window=result.samplingMetadata.denseWindow;
  const expectedStart=Math.max(.01,scouts[0]-.8),expectedEnd=scouts.at(-1)+2;
  assert.equal(result.samplingMetadata.windowSource,'fallback');
  assert.ok(window.start<=expectedStart+1e-9&&window.start>=expectedStart-.001-1e-9);
  assert.ok(window.end>=expectedEnd-1e-9&&window.end<=expectedEnd+.001+1e-9);
  assert.ok(result.frames.some(frame=>Math.abs(frame.time-visible.event)<.1));
  assert.ok(result.frames.length<=96&&result.preparation.denseFrameCount<=64);
 }
});
test('a genuine arc keeps its original candidate window and adaptive timestamps',async()=>{
 const f=fixture(),detect=f.options.detectPersons;
 const scouts=getScoutFrameTimes(6.2).map(time=>({time,detections:detect({...f.video,currentTime:time})}));
 const candidate=estimateAirborneWindow(scouts,{duration:6.2});assert.ok(candidate);
 const expected=getAdaptiveFrameTimes(6.2,{window:candidate});
 const result=await prepareAnalysisFrames(f.video,f.options);
 assert.equal(result.samplingMetadata.windowSource,'detected');
 assert.deepEqual(result.samplingMetadata.denseWindow,expected.denseWindow);
 assert.deepEqual(result.frames.map(frame=>frame.time),expected.times);
});
