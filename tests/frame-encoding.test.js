import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFrame } from '../src/frame-encoding.js';

const jpeg = (bytes, marker = 0) => {
  const body = Buffer.alloc(bytes, marker);
  body.set([255, 216, 255, 224]);
  body[body.length - 2] = 255;
  body[body.length - 1] = 217;
  return 'data:image/jpeg;base64,' + body.toString('base64');
};

test('an incompressible one-pixel canvas fails without an unbounded retry loop', async () => {
  let encodings = 0;
  const createCanvas = () => ({
    width: 1, height: 1,
    getContext: () => ({ drawImage() {} }),
    toDataURL() {
      // Terminate a broken implementation instead of hanging the entire test runner.
      if (++encodings > 32) throw new Error('encoding loop exceeded the test watchdog');
      return jpeg(2048);
    },
  });
  await assert.rejects(encodeFrame(createCanvas(), { maxBytes: 128, createCanvas }),
    error => error.code === 'frame_budget_exceeded');
});

test('a cancelled extraction does not encode or publish a frame',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 const canvas={width:160,height:90,toDataURL(){calls++;return jpeg(128);}};
 await assert.rejects(encodeFrame(canvas,{maxBytes:1024,createCanvas:()=>canvas,signal:controller.signal}),{name:'AbortError'});assert.equal(calls,0);
});
test('cancellation during a compression retry prevents the frame from being published',async()=>{
 const controller=new AbortController();let calls=0;
 const canvas={width:160,height:90,toDataURL(){calls++;if(calls===2)controller.abort();return jpeg(calls===1?2048:128);}};
 await assert.rejects(encodeFrame(canvas,{maxBytes:512,createCanvas:()=>canvas,signal:controller.signal}),{name:'AbortError'});
});

test('exact JPEG byte budgets are honored even with Base64 padding',async()=>{
 const canvas={width:160,height:90,toDataURL(){return jpeg(128);}};
 assert.equal(await encodeFrame(canvas,{maxBytes:128,createCanvas:()=>canvas}),jpeg(128));
});
test('compression retries yield control and finish inside a reduced canvas budget',async()=>{
 let yields=0;const source={width:100,height:100,toDataURL(){return jpeg(2048);}};
 const smaller={width:0,height:0,getContext:()=>({drawImage(){}}),toDataURL(){return jpeg(Math.max(32,this.width*this.height));}};
 const data=await encodeFrame(source,{maxBytes:512,createCanvas:()=>smaller,yieldControl:async()=>{yields++;}});
 assert.ok(Buffer.from(data.split(',')[1],'base64').length<=512);assert.ok(yields>3);assert.ok(smaller.width<100);
});
