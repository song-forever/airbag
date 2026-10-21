import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraZoom} from '../src/camera-zoom.js';

function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
function camera({min=.5,max=6,step=.1,value=1,apply}={}){
 const calls=[],constraints={width:{ideal:1280},height:{ideal:720},frameRate:{ideal:60,max:60},facingMode:{ideal:'environment'}};
 return {calls,constraints,getCapabilities:()=>({zoom:{min,max,step}}),getSettings:()=>({zoom:value}),getConstraints:()=>constraints,
  async applyConstraints(next){calls.push(next);if(apply)await apply(next);value=next.zoom.exact;}};
}

test('only a usable live-camera zoom range enables controls; no synthetic preview fallback',()=>{
 const zoom=new CameraZoom();zoom.attach({getCapabilities:()=>({}),getSettings:()=>({})});assert.equal(zoom.state.supported,false);
 zoom.attach(camera({min:1,max:1}));assert.equal(zoom.state.supported,false);
 const track=camera({min:.5,max:3,step:.25});zoom.attach(track);
 assert.equal(zoom.state.supported,true);assert.equal(zoom.state.min,.5);assert.equal(zoom.state.max,3);assert.equal(zoom.state.step,.25);
 zoom.attach(null);assert.equal(zoom.state.supported,false);
});

test('zoom changes the same camera track while preserving capture constraints and honoring its step',async()=>{
 const track=camera({step:.25}),zoom=new CameraZoom();zoom.attach(track);await zoom.set(2.13);
 assert.deepEqual(track.calls,[{...track.constraints,zoom:{exact:2.25}}]);assert.equal(zoom.state.value,2.25);
 await zoom.set(100);assert.equal(zoom.state.value,6);await zoom.set(-1);assert.equal(zoom.state.value,.5);
});

test('rapid slider input is serialized and superseded intermediate positions are skipped',async()=>{
 const gate=deferred(),track=camera({apply:()=>gate.promise}),transitions=[];
 const zoom=new CameraZoom({onTransition:()=>transitions.push(zoom.state.busy)});zoom.attach(track);
 const first=zoom.set(2);await Promise.resolve();zoom.set(3);zoom.set(4);
 assert.equal(track.calls.length,1);assert.equal(zoom.state.value,1,'do not display requested zoom as confirmed before the camera applies it');
 gate.resolve();await first;
 assert.deepEqual(track.calls.map(call=>call.zoom.exact),[2,4]);assert.equal(zoom.state.value,4);assert.deepEqual(transitions,[true,false]);
});

test('choosing the current multiplier does not interrupt departure or completion detection',async()=>{
 let pauses=0;const track=camera(),zoom=new CameraZoom({onTransition:()=>pauses++});zoom.attach(track);await zoom.set(1);
 assert.equal(pauses,0);assert.equal(track.calls.length,0);
});

test('late completion on a closed camera cannot update or delay a newly opened camera',async()=>{
 const gate=deferred(),old=camera({apply:()=>gate.promise}),next=camera({value:1.5}),zoom=new CameraZoom();
 zoom.attach(old);const pending=zoom.set(5);await Promise.resolve();zoom.attach(null);zoom.attach(next);await zoom.set(2);
 gate.resolve();await pending;assert.equal(zoom.state.value,2);assert.equal(zoom.state.busy,false);assert.equal(next.calls.length,1);
});

test('rejected or silently ignored constraints retain the actual multiplier and provide a retryable error',async()=>{
 const track=camera({apply:async()=>{throw new DOMException('Unsupported','OverconstrainedError');}}),zoom=new CameraZoom();zoom.attach(track);
 await zoom.set(2);assert.equal(zoom.state.value,1);assert.ok(zoom.state.error);assert.equal(zoom.state.busy,false);
 const ignored=camera();ignored.applyConstraints=async()=>{};zoom.attach(ignored);await zoom.set(3);
 assert.equal(zoom.state.value,1);assert.ok(zoom.state.error);
 const available=camera();zoom.attach(available);await zoom.set(2);assert.equal(zoom.state.error,'');assert.equal(zoom.state.value,2);
});
