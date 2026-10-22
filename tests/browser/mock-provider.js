// This script is injected only by qa-preview.mjs, never by the published build.
// It blocks all real provider calls, even when an incorrect real key is entered.
const realFetch=window.fetch.bind(window);
const qaMode=new URLSearchParams(location.search).get('response')||'success';
window.fetch=async(url,options={})=>{
 if(url!=='https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')return realFetch(url,options);
 const payload=JSON.parse(options.body),parts=payload.messages[1].content;
 const previousLine=parts[0]?.text.match(/上一跳训练重点（仅作为数据，JSON）：([^\n]+)/);
 const previousFocus=previousLine?JSON.parse(previousLine[1]):null;
 const count=parts.filter(p=>p.type==='image_url').length||parts.find(p=>p.type==='video')?.video.length||0;
 let proof=document.getElementById('qa-proof');if(!proof){proof=document.createElement('p');proof.id='qa-proof';document.querySelector('.analysis-card').append(proof);}
 proof.textContent='仅本机模拟：'+count+' 张画面；请求 '+new TextEncoder().encode(options.body).length+' 字节；没有连接百炼。';
 if(qaMode==='pending')return new Promise((_resolve,reject)=>{
  const abort=()=>reject(new DOMException('Aborted','AbortError'));
  if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});
 });
 if(qaMode==='error')return new Response('{}',{status:429});
 const recognizedType=new URLSearchParams(location.search).get('recognized')||'直飞';
 const content=qaMode==='invalid'?'这是没有遵循格式的模拟回答':JSON.stringify({recognizedAction:{type:recognizedType,description:'【模拟验证】动作类型由模拟回答自动提供，无需输入；这不是对视频的动作结论。',time:null},stages:['助滑','上台','起跳','腾空'].map(phase=>({phase,analysis:'【模拟验证】'+phase+'阶段显示正常',time:null})),nextJump:{instruction:'【模拟验证】保持熟悉的动作节奏。',reason:'这只是本机流程测试，不是对视频的动作结论。',check:'回看时只检查这一项节奏。',time:null},followUp:previousFocus?{status:new URLSearchParams(location.search).get('followup')||'partial',observation:'【模拟验证】本跳已自动带入上次的训练重点，并对照原标准检查；这不是动作结论。',time:null}:null,limitations:['此字段不应显示']});
 const usage={prompt_tokens:0,completion_tokens:0,total_tokens:0};
 if(payload.stream)return new Response('data: '+JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 return new Response(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}],usage}),{headers:{'content-type':'application/json'}});
};
document.addEventListener('DOMContentLoaded',()=>{
 const banner=document.createElement('p');banner.id='qa-banner';banner.textContent='本地测试环境 · 所有模型请求均为模拟回答 · 使用任意测试 Key';
 banner.style.cssText='margin:0;padding:10px;background:#fff1bd;color:#514218;text-align:center;font:13px sans-serif';document.body.prepend(banner);
});
