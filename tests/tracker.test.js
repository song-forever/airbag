import test from 'node:test';
import assert from 'node:assert/strict';
import {JumpTracker} from '../src/tracker.js';
const rider=(x=0.3,y=0.15,w=0.25,h=0.7,score=0.9)=>({x,y,w,h,score});
function lock(t) {
  t.update([rider()],0);t.update([rider()],250);
  assert.equal(t.update([rider()],550).state,'locked');
}
function depart(t) {
  lock(t);t.update([rider(0.33,0.2,0.21,0.58)],800);
  assert.equal(t.update([rider(0.35,0.22,0.19,0.53)],1100).state,'recording');
}
test('stationary rider and detector jitter never start recording',()=>{
  const t=new JumpTracker();lock(t);
  for(let ms=700;ms<=4000;ms+=100) assert.equal(t.update([rider(0.3+Math.sin(ms)*0.005,0.15,0.25,0.69)],ms).state,'locked');
});
test('tiny background people cannot arm an attempt',()=>{
  const t=new JumpTracker();
  for(let ms=0;ms<3000;ms+=200) assert.equal(t.update([rider(0.5,0.1,0.04,0.1)],ms).state,'waiting');
});
test('squatting without becoming narrower does not count as departure',()=>{
  const t=new JumpTracker();lock(t);
  t.update([rider(0.3,0.2,0.25,0.58)],800);
  assert.equal(t.update([rider(0.3,0.2,0.25,0.58)],1200).state,'locked');
  t.update([rider(0.3,0.27,0.25,0.58)],1500);
  assert.equal(t.update([rider(0.3,0.27,0.25,0.58)],1900).state,'locked');
});
test('person lost before departure resets instead of completing',()=>{
  const t=new JumpTracker();lock(t);assert.equal(t.update([],850).state,'locked');
  const r=t.update([],1600);assert.equal(r.state,'waiting');assert.equal(r.reason,'target_lost_before_departure');
});
test('brief movement then return does not trigger departure',()=>{
  const t=new JumpTracker();lock(t);t.update([rider(0.33,0.2,0.21,0.58)],800);t.update([rider()],900);
  assert.equal(t.update([rider()],1400).state,'locked');
});
test('persistent departing rider starts recording',()=>{const t=new JumpTracker();depart(t);assert.equal(t.state,'recording');});
test('new large foreground rider cannot replace a distant tracked rider',()=>{
  const t=new JumpTracker();depart(t);t.update([rider(0.4,0.29,0.13,0.35)],1400);
  t.update([rider(0.43,0.32,0.085,0.24),rider(0.05,0.1,0.28,0.75)],1700);
  assert.ok(Math.abs(t.target.h-0.24)<1e-8);
  assert.equal(t.update([rider(0.05,0.1,0.28,0.75)],4100).state,'recording');
  const r=t.update([rider(0.05,0.1,0.28,0.75)],5200);
  assert.equal(r.state,'complete');assert.equal(r.reason,'target_lost_after_receding');assert.ok(Math.abs(r.target.h-0.24)<1e-8);
});
test('occlusion before substantial recession does not finish recording',()=>{
  const t=new JumpTracker();depart(t);assert.equal(t.update([],2000).state,'recording');assert.equal(t.update([],4000).state,'recording');
});
test('receded target must be absent for the full grace period',()=>{
  const t=new JumpTracker({minRecordingMs:1500});depart(t);t.update([rider(0.4,0.29,0.13,0.35)],1400);t.update([rider(0.43,0.32,0.085,0.24)],1700);
  assert.equal(t.update([],2300).state,'recording');assert.equal(t.update([],3800).state,'recording');assert.equal(t.update([],3900).state,'complete');
});
test('small downward jitter after a rise cannot stop recording',()=>{
  const t=new JumpTracker();depart(t);t.update([rider(0.4,0.29,0.13,0.35)],1400);t.update([rider(0.43,0.32,0.085,0.24)],1700);
  t.update([rider(0.43,0.32,0.085,0.24)],2400);t.update([rider(0.43,0.26,0.085,0.24)],2800);
  assert.equal(t.update([rider(0.43,0.275,0.085,0.24)],3200).state,'recording');assert.equal(t.update([rider(0.43,0.275,0.085,0.24)],3700).state,'recording');
});
test('complete visible rise and substantial sustained descent can finish',()=>{
  const t=new JumpTracker();depart(t);t.update([rider(0.4,0.29,0.13,0.35)],1400);t.update([rider(0.43,0.32,0.085,0.24)],1700);
  t.update([rider(0.43,0.32,0.085,0.24)],2400);t.update([rider(0.43,0.26,0.085,0.24)],2800);t.update([rider(0.43,0.22,0.085,0.24)],3100);
  assert.equal(t.update([rider(0.43,0.29,0.085,0.24)],3400).state,'recording');t.update([rider(0.43,0.34,0.085,0.24)],3700);
  assert.equal(t.update([rider(0.43,0.36,0.085,0.24)],4200).state,'recording');
  const r=t.update([rider(0.43,0.36,0.085,0.24)],5100);assert.equal(r.state,'complete');assert.equal(r.reason,'visible_arc_finished');
});
test('default completion guard preserves at least four seconds after departure',()=>{
  const t=new JumpTracker();depart(t);t.update([rider(0.4,0.29,0.13,0.35)],1400);t.update([rider(0.43,0.32,0.085,0.24)],1700);
  assert.equal(t.update([],4000).state,'recording');assert.equal(t.update([],5099).state,'recording');assert.equal(t.update([],5100).state,'complete');
});
test('timeout bounds an attempt that never receded',()=>{
  const t=new JumpTracker({maxDurationMs:4000});depart(t);const r=t.update([],5100);assert.equal(r.state,'complete');assert.equal(r.reason,'max_duration');
});
test('reset starts an independent attempt',()=>{
  const t=new JumpTracker({maxDurationMs:4000});depart(t);t.update([],5100);t.reset();assert.equal(t.update([],6000).state,'waiting');assert.equal(t.target,null);assert.equal(t.recordingStarted,null);
});
test('invalid boxes and timestamps are handled explicitly',()=>{
  const t=new JumpTracker();assert.equal(t.update([rider(0,0,-1,0.5),{...rider(),x:NaN}],0).state,'waiting');assert.throws(()=>t.update([],NaN),/timestamp/);
});
