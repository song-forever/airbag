import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForVideo,openVideoReader,seekVideoFrame} from '../src/video-reader.js';
class Video extends EventTarget{
 constructor(){super();this.readyState=0;this.duration=10;this.seeking=false;this.time=0;this.style={};this.plays=0;this.pauses=0;}
 setAttribute(){}removeAttribute(){}remove(){this.removed=true;}load(){}pause(){this.pauses++;}
 play(){this.plays++;this.readyState=2;this.dispatchEvent(new Event('loadeddata'));return Promise.resolve();}
 set src(value){this.url=value;this.readyState=2;this.dispatchEvent(new Event('loadeddata'));}
 set currentTime(value){this.time=value;this.seeking=false;this.dispatchEvent(new Event('seeked'));}get currentTime(){return this.time;}
}
test('an already loaded video does not wait for a load event that has already fired',async()=>{
 const v=new Video();v.readyState=2;assert.equal(await waitForVideo(v,{timeoutMs:10}),v);
});
test('reader installs handlers before assigning the blob URL and disposes resources once',async()=>{
 const v=new Video();let revoked=0,attached=0;
 const reader=await openVideoReader(new Blob(['video']),{documentImpl:{createElement:()=>v,body:{append(){attached++;}}},urlImpl:{createObjectURL:()=> 'blob:test',revokeObjectURL(){revoked++;}}});
 assert.equal(reader.video,v);assert.equal(attached,1);assert.ok(v.pauses>0);reader.dispose();reader.dispose();assert.equal(revoked,1);assert.equal(v.removed,true);
});
test('metadata-only videos can prime a muted decoder to obtain the first frame',async()=>{
 const v=new Video();v.readyState=1;await waitForVideo(v,{prime:true,timeoutMs:10});assert.equal(v.plays,1);assert.equal(v.readyState,2);
});
test('cancelled and failed loads report local reading errors',async()=>{
 const v=new Video(),controller=new AbortController();const pending=waitForVideo(v,{signal:controller.signal});controller.abort();await assert.rejects(pending,{name:'AbortError'});
 await assert.rejects(waitForVideo(new Video(),{timeoutMs:5}),/本机读取视频超时/);
 const bad=new Video(),error=waitForVideo(bad);bad.dispatchEvent(new Event('error'));await assert.rejects(error,/无法解码/);
});
test('seeking handles cached frames and keeps the last seek inside the playable tail',async()=>{
 const v=new Video();v.readyState=2;v.time=1;await seekVideoFrame(v,1,{timeoutMs:5});await seekVideoFrame(v,10,{timeoutMs:5});assert.equal(v.currentTime,9.88);
});
test('seeking is cancellable and has a bounded local timeout',async()=>{
 const v=new Video(),controller=new AbortController();controller.abort();await assert.rejects(seekVideoFrame(v,1,{signal:controller.signal}),{name:'AbortError'});
 const slow=new Video();slow.seeking=true;await assert.rejects(seekVideoFrame(slow,1,{timeoutMs:5}),/本机读取视频画面超时/);
});
