import test from 'node:test';
import assert from 'node:assert/strict';
import {makeVideoFile,canShareVideo} from '../src/video-export.js';
const bytes=new Uint8Array([0,1,2,255,7]);
const record=(type,name='现场拍摄')=>({blob:new Blob([bytes],{type}),name,createdAt:1720000000000});
test('downloads retain original video bytes and the correct container extension',async()=>{
 for(const [type,extension] of [['video/mp4;codecs=avc1.42E01E','mp4'],['video/quicktime','mov'],['video/webm','webm'],['video/x-m4v','m4v']]){
  const file=makeVideoFile(record(type));assert.ok(file.name.endsWith('.'+extension));assert.deepEqual(new Uint8Array(await file.arrayBuffer()),bytes);assert.equal(file.type,type.split(';')[0]);
 }
});
test('an imported file without MIME metadata uses its original extension',()=>{
 assert.ok(makeVideoFile(record('','IMG_4040.MOV')).name.endsWith('.mov'));
 assert.ok(makeVideoFile(record('','clip.webm')).name.endsWith('.webm'));
 assert.throws(()=>makeVideoFile({blob:new Blob([])}),/没有可下载/);
});
test('native saving is offered only when the browser accepts this exact video file',()=>{
 const file=makeVideoFile(record('video/mp4'));let files;
 assert.equal(canShareVideo(file,{share(){},canShare(value){files=value.files;return true;}}),true);assert.deepEqual(files,[file]);
 assert.equal(canShareVideo(file,{}),false);assert.equal(canShareVideo(file,{share(){},canShare(){return false;}}),false);assert.equal(canShareVideo(file,{share(){},canShare(){throw Error('unsupported');}}),false);
});

const {exportVideoBatch,hasVideo}=await import('../src/video-export.js');
test('batch export sends every selected original video once, with unique filenames, then clears only after confirmation',async()=>{
 const items=[record('video/mp4'),record('video/quicktime')],events=[];
 const result=await exportVideoBatch(items,{navigatorImpl:{canShare:({files})=>files.length===2,share:async({files})=>{events.push('share');assert.equal(new Set(files.map(file=>file.name)).size,2);for(const file of files)assert.deepEqual(new Uint8Array(await file.arrayBuffer()),bytes);}},confirmSaved:()=>{events.push('confirm');return true;},clearVideos:async selected=>{events.push('clear');assert.deepEqual(selected,items);}});
 assert.deepEqual(events,['share','confirm','clear']);assert.deepEqual(result,{exported:2,cleared:2});
});
test('batch cancellation, unsupported payload, failed sharing and unconfirmed saves never clear videos',async()=>{
 for(const scenario of ['cancel','unsupported','failed','unconfirmed']){
  let clears=0,confirms=0;
  const task=exportVideoBatch([record('video/mp4')],{navigatorImpl:{canShare:()=>scenario!=='unsupported',share:async()=>{if(scenario==='cancel')throw new DOMException('Cancelled','AbortError');if(scenario==='failed')throw Error('share failed');}},confirmSaved:()=>{confirms++;return false;},clearVideos:async()=>clears++});
  if(scenario==='unconfirmed'){assert.equal((await task).cleared,0);assert.equal(confirms,1);}else await assert.rejects(task);
  assert.equal(clears,0);
 }
});
test('missing videos cannot be exported and cleanup failures are surfaced',async()=>{
 assert.equal(hasVideo({blob:null}),false);assert.equal(hasVideo(record('video/mp4')),true);
 await assert.rejects(()=>exportVideoBatch([]),/请选择/);await assert.rejects(()=>exportVideoBatch([{blob:null}]),/请选择/);
 await assert.rejects(()=>exportVideoBatch([record('video/mp4')],{navigatorImpl:{canShare:()=>true,share:async()=>{}},confirmSaved:()=>true,clearVideos:async()=>{throw Error('storage failed');}}),/storage failed/);
});
