import test from 'node:test';
import assert from 'node:assert/strict';
import {Mp4PreRoll} from '../src/mp4-preroll.js';
const join=parts=>{const size=parts.reduce((sum,x)=>sum+x.length,0),b=new Uint8Array(size);let at=0;for(const part of parts){b.set(part,at);at+=part.length;}return b;};
const u32=value=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,value);return b;};
const box=(type,...parts)=>{const body=join(parts);return join([u32(body.length+8),new TextEncoder().encode(type),body]);};
const full=(type,flags,...parts)=>box(type,u32(flags),...parts);
function header({edit=false}={}){
 const mvhd=full('mvhd',0,u32(0),u32(0),u32(1000),u32(0),new Uint8Array(80));
 const tkhd=full('tkhd',3,u32(0),u32(0),u32(1),u32(0),u32(0),new Uint8Array(60));
 const mdhd=full('mdhd',0,u32(0),u32(0),u32(1000),u32(0),new Uint8Array(4));
 const hdlr=full('hdlr',0,u32(0),new TextEncoder().encode('vide'),new Uint8Array(12));
 const edts=edit?box('edts',full('elst',0,u32(1),u32(0),u32(0),u32(0x10000))):new Uint8Array();
 return join([box('ftyp',new TextEncoder().encode('isom'),u32(0)),box('moov',mvhd,box('trak',tkhd,edts,box('mdia',mdhd,hdlr)),box('mvex',full('trex',0,u32(1),u32(1),u32(1000),u32(4),u32(0x1010000))))]);
}
function fragment(time,{sync=true,sequence=1}={}){
 const tfhd=full('tfhd',0x20038,u32(1),u32(1000),u32(4),u32(0x1010000));
 const tfdt=full('tfdt',0,u32(time));
 let trun=full('trun',5,u32(1),u32(0),u32(sync?0x2000000:0x1010000));
 let moof=box('moof',full('mfhd',0,u32(sequence)),box('traf',tfhd,tfdt,trun));
 trun=full('trun',5,u32(1),u32(moof.length+8),u32(sync?0x2000000:0x1010000));
 moof=box('moof',full('mfhd',0,u32(sequence)),box('traf',tfhd,tfdt,trun));
 return join([moof,box('mdat',new Uint8Array([1,2,3,4]))]);
}
test('keeps preceding keyframe, rebases media and preserves one playable-container timeline',async()=>{
 const ring=new Mp4PreRoll({keepSeconds:2});await ring.append(header());
 for(let i=0;i<8;i++)await ring.append(fragment(i*1000));
 ring.commit();await ring.append(fragment(8000));const result=await ring.finish();
 assert.equal(result.startTime,6000/1000);assert.equal(result.endTime,9);assert.equal(result.duration,3);assert.equal(result.preRollSeconds,2);assert.equal(result.blob.type,'video/mp4');
 const bytes=new Uint8Array(await result.blob.arrayBuffer()),string=new TextDecoder().decode(bytes);
 const times=[];for(let i=0;i<bytes.length-16;i++)if(string.slice(i,i+4)==='tfdt')times.push(new DataView(bytes.buffer).getUint32(i+8));assert.deepEqual(times,[0,1000,2000]);
});
test('input chunks may split every box header or contain several complete fragments',async()=>{
 const input=join([header(),...Array.from({length:6},(_,i)=>fragment(i*1000))]);
 const ring=new Mp4PreRoll();for(let i=0;i<input.length;i+=13)await ring.append(input.subarray(i,i+13));ring.commit();const result=await ring.finish();assert.equal(result.duration,2);assert.equal(result.startTime,4);
});
test('retention begins at preceding sync fragment even if that adds extra pre-roll',async()=>{
 const ring=new Mp4PreRoll();await ring.append(header());for(let i=0;i<7;i++)await ring.append(fragment(i*1000,{sync:i%3===0}));ring.commit();const result=await ring.finish();assert.equal(result.startTime,3);assert.equal(result.preRollSeconds,4);
});
test('commit freezes preceding queued data and an unconfirmed attempt is discarded',async()=>{
 const ring=new Mp4PreRoll();await ring.append(header());await ring.append(fragment(0));const append=ring.append(new Blob([fragment(1000)]));ring.commit();await append;const result=await ring.finish();assert.equal(result.duration,2);
 const discarded=new Mp4PreRoll();await discarded.append(header());await discarded.append(fragment(0));assert.equal(await discarded.finish(),null);
});
test('single identity edit list is retained with updated segment duration',async()=>{
 const ring=new Mp4PreRoll();await ring.append(header({edit:true}));await ring.append(fragment(0));ring.commit();const result=await ring.finish();assert.equal(result.duration,1);
});
test('malformed, unsupported and incomplete streams fail explicitly',async()=>{
 const malformed=new Mp4PreRoll();await assert.rejects(()=>malformed.append(join([u32(4),new TextEncoder().encode('ftyp')])),/盒大小/);
 const webm=new Mp4PreRoll();await webm.append(new Uint8Array(100000));webm.commit();await assert.rejects(()=>webm.finish(),/视频分段格式/);
 const incomplete=new Mp4PreRoll();await incomplete.append(header());await incomplete.append(fragment(0).subarray(0,40));incomplete.commit();await assert.rejects(()=>incomplete.finish(),/不完整/);
});
test('waiting and confirmed buffers enforce byte limits',async()=>{
 const waiting=new Mp4PreRoll({maxWaitingBytes:100});await assert.rejects(()=>waiting.append(header()),/上限|间隔/);
 const committed=new Mp4PreRoll({maxRecordingBytes:header().length+8});await committed.append(header());committed.commit();await assert.rejects(()=>committed.append(fragment(0)),/上限/);
});
test('disposing releases retained references and forbids further append',async()=>{
 const ring=new Mp4PreRoll();await ring.append(header());await ring.append(fragment(0));ring.dispose();assert.equal(ring.bytes,0);assert.equal(ring.fragments.length,0);await assert.rejects(()=>ring.append(fragment(1000)),/结束/);
});
