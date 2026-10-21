import test from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_MODELS, TEXT_ONLY_MODELS, RETIRED_MODELS, DEFAULT_MODEL, getModel } from '../src/model-catalog.js';
import { analyzeFrames, estimateCostCny } from '../src/analysis-client.js';
const key='sk-test-only-not-a-real-key-12345';
const jpeg='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,1,2,255,217]).toString('base64');
const payload=model=>({apiKey:key,model,duration:6,action:'直飞',frames:[0,1,3,5].map(time=>({time,dataUrl:jpeg}))});
const answer=JSON.stringify({summary:'可见起跳过程',observations:[{time:3,evidence:'画面可见',certainty:'画面明确'}],focus:'回看起跳',limitations:[]});
function sse(answerText=answer){return new Response([
 'data: '+JSON.stringify({choices:[{delta:{reasoning_content:'PRIVATE REASONING'}}]})+'\r\n\r\n',
 'data: '+JSON.stringify({choices:[{delta:{content:answerText.slice(0,17)}}]})+'\r\n\r\n',
 'data: '+JSON.stringify({choices:[{delta:{content:answerText.slice(17)},finish_reason:'stop'}]})+'\r\n\r\n',
 'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:2000,completion_tokens:100,total_tokens:2100}})+'\r\n\r\n',
 'data: [DONE]\r\n\r\n'].join(''),{headers:{'content-type':'text/event-stream'}});}

test('catalog has unique IDs, includes requested visual model, excludes text-only models',()=>{
 assert.equal(new Set(VIDEO_MODELS.map(x=>x.id)).size,VIDEO_MODELS.length);
 for(const id of ['qwen3.7-plus','qwen3.8-max','qwen3.8-flash','qwen3-vl-plus','kimi-k2.6'])assert.ok(getModel(id));
 for(const id of TEXT_ONLY_MODELS)assert.equal(getModel(id,{allowCustom:true}),null);
 for(const id of ['https://evil.example','../key','x\nAuthorization','qwen-realtime','vision-embedding'])assert.equal(getModel(id,{allowCustom:true}),null);
 assert.equal(getModel('new-video-model-v1',{allowCustom:true}),null);
 assert.equal(DEFAULT_MODEL,'qwen3.7-plus');
 assert.equal(VIDEO_MODELS.length,31);
});
test('every catalog model constructs a compatible request and returns the selected model',async t=>{
 for(const config of VIDEO_MODELS)await t.test(config.id,async()=>{
  const result=await analyzeFrames(payload(config.id),{fetchImpl:async(_url,options)=>{
   const request=JSON.parse(options.body);assert.equal(request.model,config.id);assert.ok(!options.body.includes(key));
   assert.equal(request.stream,!!config.stream);
   if(config.thinking)assert.notEqual(request.enable_thinking,false);
   if(config.minimax){assert.deepEqual(request.thinking,{type:'disabled'});assert.equal(request.enable_thinking,undefined);}
   if(config.omni){assert.deepEqual(request.modalities,['text']);const video=request.messages[1].content.find(x=>x.type==='video');assert.equal(video.video.length,4);}
   return config.stream?sse():new Response(JSON.stringify({choices:[{message:{content:answer}}],usage:{prompt_tokens:2000,completion_tokens:100,total_tokens:2100}}));
  }});
  assert.equal(result.model,config.id);assert.equal(result.analysis.summary,'可见起跳过程');assert.equal(result.usage.total_tokens,2100);assert.ok(!JSON.stringify(result).includes('PRIVATE REASONING'));
 });
});
test('text-only models never send video material',async()=>{
 for(const model of TEXT_ONLY_MODELS){let called=false;await assert.rejects(analyzeFrames(payload(model),{fetchImpl:async()=>{called=true;}}),{code:'unsupported_model'});assert.equal(called,false);}
});
test('models outside the selected quota list cannot send a request, including through the old custom flag',async()=>{
 for(const id of ['qwen3.8-max-prime','ZHIPU/GLM-5.3-Flash','MiniMax/MiniMax-M3','kimi/kimi-k2.6','new-video-model-v1']){
  assert.equal(getModel(id,{allowCustom:true}),null);let called=false;
  await assert.rejects(analyzeFrames(payload(id),{fetchImpl:async()=>{called=true;}}),{code:'unsupported_model'});assert.equal(called,false);
 }
});
test('streamed errors or incomplete responses are rejected',async()=>{
 for(const body of ['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n','data: {"error":{"message":"secret"}}\n\n','data: {"choices":[{"finish_reason":"length"}]}\n\n'])await assert.rejects(analyzeFrames(payload('kimi-k2.7-code'),{fetchImpl:async()=>new Response(body,{headers:{'content-type':'text/event-stream'}})}),{code:'invalid_provider_response'});
});
test('new model prices do not inherit VL Plus prices; free quota is never assumed',()=>{
 assert.equal(estimateCostCny({prompt_tokens:16000,completion_tokens:700},'qwen3-vl-plus'),.023);
 assert.equal(estimateCostCny({prompt_tokens:16000,completion_tokens:700},'qwen3.7-plus'),null);
 assert.equal(estimateCostCny({prompt_tokens:16000,completion_tokens:700},'MiniMax/MiniMax-M3'),null);
});
test('truncated JSON answers fail, while SSE reasoning envelopes can exceed the JSON wire limit',async()=>{
 await assert.rejects(analyzeFrames(payload('qwen3-vl-plus'),{fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'unfinished'}}]}))}),{code:'invalid_provider_response'});
 const reasoning='data: '+JSON.stringify({choices:[{delta:{reasoning_content:'r'.repeat(300*1024)}}]})+'\n\n';
 const streamText=reasoning+await sse().text();
 const result=await analyzeFrames(payload('kimi-k2.7-code'),{fetchImpl:async()=>new Response(streamText,{headers:{'content-type':'text/event-stream','content-length':String(Buffer.byteLength(streamText))}})});
 assert.equal(result.analysis.summary,'可见起跳过程');
});
test('unknown future versions never inherit prices and filtered streams never report success',async()=>{
 assert.equal(estimateCostCny({prompt_tokens:10000,completion_tokens:1000},'qwen3-vl-plus-unknown-future'),null);
 const body='data: '+JSON.stringify({choices:[{delta:{content:answer},finish_reason:'content_filter'}]})+'\n\ndata: [DONE]\n\n';
 await assert.rejects(analyzeFrames(payload('kimi-k2.7-code'),{fetchImpl:async()=>new Response(body,{headers:{'content-type':'text/event-stream'}})}),{code:'invalid_provider_response'});
});

test('retired IDs are blocked even when manually entered',async()=>{for(const id of RETIRED_MODELS){assert.equal(getModel(id,{allowCustom:true}),null);let called=false;await assert.rejects(analyzeFrames(payload(id),{fetchImpl:async()=>{called=true;}}),{code:'unsupported_model'});assert.equal(called,false);}});

test('selected model IDs exactly match the video-capable subset of the supplied quota list',()=>{
 const ids = 'qwen3.7-plus qwen3.8-max qwen3.8-flash qwen3-vl-plus qwen3.8-max-0902 qwen3.7-plus-2026-05-26 qwen3.7-flash qwen3.7-flash-2026-07-15 qwen3.7-max-2026-06-08 qwen3.6-plus qwen3.6-plus-2026-04-02 qwen3.6-flash qwen3.6-flash-2026-04-16 qwen3.5-plus qwen3.5-plus-2026-02-15 qwen3.5-plus-2026-04-20 qwen3.5-flash qwen3.5-flash-2026-02-23 qwen3.8-27b qwen3.6-35b-a3b qwen3.6-27b qwen3.5-397b-a17b qwen3.5-122b-a10b qwen3.5-27b qwen3.5-35b-a3b qwen3.8-omni-flash qwen3.5-omni-plus qwen3-omni-flash kimi-k2.6 kimi-k2.5 kimi-k2.7-code'.split(' ');
 assert.deepEqual(new Set(VIDEO_MODELS.map(x=>x.id)),new Set(ids));
 assert.deepEqual(VIDEO_MODELS.slice(0,4).map(x=>x.id),ids.slice(0,4));
 for(const entry of VIDEO_MODELS)for(const key of Object.keys(entry))assert.ok(!/quota|balance|expiry|remaining/i.test(key));
});
