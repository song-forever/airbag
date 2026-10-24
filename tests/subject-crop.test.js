import test from 'node:test';
import assert from 'node:assert/strict';
import { planSubjectCrops, estimateAirborneWindow, estimateSubjectWindow } from '../src/subject-crop.js';
const box = (extra={}) => ({x:.45,y:.3,w:.06,h:.1,score:.9,...extra});
const obs = (time,detections=[box()]) => ({time,detections});
const dimensions={width:720,height:1280};
const plan=(items,options={})=>planSubjectCrops(items,{...dimensions,...options});
const crops=result=>result.frames.filter(frame=>frame.rect);
const contains=(r,b,{width,height}=dimensions)=>r.x<=b.x*width+1e-8&&r.y<=b.y*height+1e-8&&r.x+r.width+1e-8>=(b.x+b.w)*width&&r.y+r.height+1e-8>=(b.y+b.h)*height;

test('one output per timestamp, original pixel padding in portrait and landscape',()=>{
 for(const size of [dimensions,{width:1280,height:720}]){
  const b=box(),items=[obs(0,[b]),obs(.1,[b])],result=planSubjectCrops(items,size);
  assert.equal(result.frames.length,items.length);
  for(const f of result.frames){assert.equal(f.source,'detected');assert.ok(contains(f.rect,b,size));assert.ok(f.rect.width>=b.w*size.width+1.8*b.h*size.height);assert.ok(f.rect.height>=b.h*size.height*1.95);assert.ok(Object.values(f.rect).every(Number.isInteger));}
 }
});
test('nearby upright boxes keep hand and board space during a crouch',()=>{
 const upright=box({w:.025,h:.12}),crouch=box({w:.025,y:.34,h:.07});
 const middle=plan([obs(0,[upright]),obs(.1,[crouch]),obs(.2,[upright])]).frames[1];
 assert.ok(middle.rect.width>=crouch.w*720+1.8*upright.h*1280);assert.ok(contains(middle.rect,crouch));
});
test('edges translate an intact crop rather than squeezing it',()=>{
 for(const b of [box({x:0}),box({x:.94}),box({y:0}),box({y:.9})]){
  const r=plan([obs(0,[b]),obs(.1,[b])]).frames[0].rect;
  assert.ok(contains(r,b));assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=720&&r.y+r.height<=1280);
 }
});
test('large bodies and no-gain windows fall back to complete frames',()=>{
 const items=[obs(0,[box({h:.8,w:.4})]),obs(.1,[box({h:.8,w:.4})])],p=plan(items);
 assert.equal(p.stats.full,2);assert.ok(p.frames.every(f=>f.source==='full'&&f.rect===null));
});
test('ambiguous people or a crossing do not become inferred crops',()=>{
 const ambiguous=plan([obs(0,[box({x:.3}),box({x:.6})]),obs(.1,[box({x:.3}),box({x:.6})])]);
 assert.equal(crops(ambiguous).length,0);
 const crossing=plan([obs(0),obs(.1,[box({x:.44}),box({x:.46})]),obs(.2)]);
 assert.equal(crossing.frames[1].rect,null);assert.equal(crossing.stats.ambiguous,1);
});
test('a new foreground person cannot replace the tracked distant rider',()=>{
 const fg=box({x:.02,y:.1,w:.3,h:.7});
 const p=plan([obs(0),obs(.1,[box(),fg]),obs(.2,[fg])]);
 assert.deepEqual(crops(p).map(f=>f.time),[0,.1]);assert.equal(p.frames[2].source,'full');
});
test('short bounded detection gaps include both compatible endpoint boxes',()=>{
 const a=box(),b=box({x:.47,y:.27}),p=plan([obs(0,[a]),obs(.1,[]),obs(.2,[]),obs(.3,[b])]);
 for(const i of [1,2]){assert.equal(p.frames[i].source,'interpolated');assert.ok(contains(p.frames[i].rect,a));assert.ok(contains(p.frames[i].rect,b));}
 const boundary=plan([obs(0),obs(.25,[]),obs(.5)]);assert.equal(boundary.frames[1].source,'interpolated');
});
test('long gaps and missing tails never use a stale crop',()=>{
 const p=plan([obs(0),obs(.1),obs(.2,[]),obs(.4,[]),obs(.7),obs(.8)]);
 assert.deepEqual(crops(p).map(f=>f.time),[0,.1]);assert.equal(p.frames.length,6);
 assert.equal(plan([obs(0),obs(.25,[]),obs(.50001)]).frames[1].rect,null);
 assert.equal(plan([obs(0),obs(.1),obs(.2,[])]).frames[2].rect,null);
});
test('low scores, invalid boxes and isolated detections retain full frames',()=>{
 for(const b of [box({score:.2}),box({score:1.1}),box({score:NaN}),box({x:-.1}),box({h:0}),box({x:.98}),null])assert.equal(crops(plan([obs(0,[b]),obs(.1,[b])])).length,0);
 assert.equal(plan([obs(0)]).frames[0].rect,null);
});
test('the sequence has no twelve-image budget and remains pure',()=>{
 const items=Array.from({length:70},(_,i)=>obs(i/10)),original=structuredClone(items);
 const a=plan(items),b=plan(items);assert.equal(crops(a).length,70);a.frames[0].rect.x=-999;
 assert.deepEqual(items,original);assert.deepEqual(b,plan(items));
});
test('invalid order and dimensions fail without reordering input',()=>{
 for(const items of [null,{},[obs(NaN)],[obs(-1)],[obs(1),obs(0)],[obs(0),obs(0)]])assert.throws(()=>plan(items),RangeError);
 for(const opts of [{width:0},{height:-1},{width:1.5}])assert.throws(()=>plan([],opts),RangeError);
 assert.deepEqual(plan([]).frames,[]);
});
test('a visible far-end vertical reversal provides only a candidate window',()=>{
 const ys=[.5,.46,.4,.32,.28,.3,.34,.4];
 const items=ys.map((y,i)=>obs(i*.25,[box({y})]));
 const w=estimateAirborneWindow(items,{duration:2.5});
 assert.ok(w);assert.equal(w.peakTime,1);assert.ok(w.start<1&&w.end>1);assert.ok(w.start>=0&&w.end<=2.5);
});
test('no reversal, an unobserved descent or a stationary crouch does not establish airtime',()=>{
 const rise=[.5,.46,.4,.32,.28].map((y,i)=>obs(i*.25,[box({y})]));
 assert.equal(estimateAirborneWindow(rise,{duration:2.5}),null);
 assert.equal(estimateAirborneWindow([...rise,obs(1.25,[]),obs(1.5,[])],{duration:2.5}),null);
 const crouch=[.15,.14,.12,.1,.12,.14,.15].map((h,i)=>obs(i*.25,[box({y:.5-h,h})]));
 assert.equal(estimateAirborneWindow(crouch,{duration:2.5}),null);
 assert.equal(estimateAirborneWindow(null,{duration:2.5}),null);
});

test('initial measured velocity keeps a fast rider through a short detection gap',()=>{
 const items=[
  obs(.734,[box({x:.003125,y:.519444,w:.167969,h:.422222,score:.65625})]),
  obs(.855,[box({x:.041406,y:.420833,w:.25625,h:.408333,score:.679687})]),
  obs(.976,[]),
  obs(1.096,[box({x:.325,y:.336111,w:.14375,h:.336111,score:.636719})]),
  obs(1.217,[box({x:.392969,y:.3,w:.097656,h:.298611,score:.636719})]),
 ];
 const result=planSubjectCrops(items,{width:1280,height:720});
 assert.equal(result.frames[3].source,'detected');
 assert.equal(result.frames[4].source,'detected');
 assert.equal(result.frames[2].source,'full'); // Wide gap union gains too little to crop safely.
 for(const i of [3,4])assert.ok(contains(result.frames[i].rect,items[i].detections[0],{width:1280,height:720}));
});

test('visible-subject fallback excludes a long empty tail without claiming an arc',()=>{
 const items=[obs(0,[]),obs(.5),obs(.65),obs(.8),obs(1,[]),obs(3,[])];
 assert.equal(estimateAirborneWindow(items,{duration:4}),null);
 assert.deepEqual(estimateSubjectWindow(items,{duration:4}),{start:.3,end:1.15});
 for(const data of [[],[obs(.5)],[obs(.5),obs(.6)],null])assert.equal(estimateSubjectWindow(data,{duration:4}),null);
});

test('dense timestamps and repeated decoded boxes do not erase rider velocity',()=>{
 const rows=[
  [0.734,0.003125,0.519444,0.167969,0.422222,0.65625],
  [0.745,0.003125,0.519444,0.167969,0.422222,0.65625],
  [0.788,0.074219,0.506944,0.167969,0.384722,0.59375],
  [0.83,0.042188,0.433333,0.246875,0.431944,0.613281],
  [0.855,0.041406,0.420833,0.25625,0.408333,0.679688],
  [0.872,0.041406,0.420833,0.25625,0.408333,0.679688],
  [0.914,0.026562,0.420833,0.289063,0.4,0.613281],
  [1.040999,0.29375,0.380556,0.141406,0.336111,0.523438],
  [1.084,0.317188,0.355556,0.152344,0.323611,0.699219],
  [1.096,0.325,0.336111,0.14375,0.336111,0.636719],
  [1.126,0.323437,0.327778,0.133594,0.316667,0.453125],
  [1.168,0.369531,0.298611,0.110156,0.322222,0.699219],
  [1.21,0.392969,0.3,0.097656,0.298611,0.636719],
  [1.217,0.392969,0.3,0.097656,0.298611,0.636719],
  [1.253,0.403125,0.25,0.1125,0.298611,0.699219],
  [1.295,0.432031,0.231944,0.105469,0.305556,0.613281],
  [1.337,0.444531,0.225,0.105469,0.298611,0.523438],
  [1.338,0.444531,0.225,0.105469,0.298611,0.523438],
  [1.379,0.458594,0.218056,0.096094,0.322222,0.699219],
  [1.422,0.489844,0.220833,0.094531,0.316667,0.546875],
  [1.458,0.497656,0.226389,0.1,0.316667,0.5],
  [1.464,0.497656,0.226389,0.1,0.316667,0.5],
  [1.506,0.503906,0.222222,0.1,0.322222,0.59375],
  [1.549,0.514844,0.231944,0.089063,0.305556,0.453125],
  [1.579,0.54375,0.2875,0.077344,0.266667,0.429688],
 ];
 const items=rows.map(([time,x,y,w,h,score])=>obs(time,[{x,y,w,h,score}]));
 const result=planSubjectCrops(items,{width:1280,height:720});
 assert.ok(result.stats.detected>=20);
 assert.equal(result.frames.at(-1).source,'detected');
 assert.ok(result.frames.at(-1).rect);
});
