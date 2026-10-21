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
