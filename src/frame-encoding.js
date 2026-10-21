const problem=(code,message)=>Object.assign(new Error(message),{code});
const checkAbort=signal=>{if(signal?.aborted)throw new DOMException('画面提取已取消。','AbortError');};
const jpegBytes=url=>{
 if(typeof url!=='string'||!url.startsWith('data:image/jpeg;base64,'))throw problem('frame_encode_failed','无法生成视频画面，请重试。');
 const body=url.slice(23);return Math.floor(body.length*3/4)-(body.endsWith('==')?2:body.endsWith('=')?1:0);
};
export function getFrameByteBudget({frameCount,maxBodyBytes,maxFrameBytes,reservedBytes=128*1024}){
 if(!Number.isInteger(frameCount)||frameCount<1||!Number.isFinite(maxBodyBytes)||maxBodyBytes<=reservedBytes||!Number.isFinite(maxFrameBytes)||maxFrameBytes<1)throw new RangeError('Invalid frame budget');
 return Math.max(1,Math.min(maxFrameBytes,Math.floor((maxBodyBytes-reservedBytes)*3/(4*frameCount))));
}
export async function encodeFrame(canvas,{maxBytes,createCanvas,signal,yieldControl=()=>new Promise(resolve=>setTimeout(resolve,0))}){
 checkAbort(signal);
 if(!Number.isFinite(maxBytes)||maxBytes<1||!canvas.width||!canvas.height)throw new RangeError('Invalid canvas or frame budget');
 const encode=(source,quality)=>{checkAbort(signal);const url=source.toDataURL('image/jpeg',quality);checkAbort(signal);return {url,bytes:jpegBytes(url)};};
 const retry=async()=>{await yieldControl();checkAbort(signal);};
 let result=encode(canvas,.76);if(result.bytes<=maxBytes)return result.url;
 for(const quality of [.64,.52,.4]){await retry();result=encode(canvas,quality);if(result.bytes<=maxBytes)return result.url;}
 const smaller=createCanvas();let width=canvas.width,height=canvas.height;
 for(let attempt=0;attempt<32;attempt++){
  await retry();const nextWidth=Math.max(1,Math.floor(width*.8)),nextHeight=Math.max(1,Math.floor(height*.8));
  if(nextWidth===width&&nextHeight===height)break;
  smaller.width=width=nextWidth;smaller.height=height=nextHeight;
  const context=smaller.getContext('2d',{alpha:false});if(!context)throw problem('frame_encode_failed','无法生成视频画面，请重试。');
  context.drawImage(canvas,0,0,width,height);result=encode(smaller,.64);if(result.bytes<=maxBytes)return result.url;
 }
 throw problem('frame_budget_exceeded','画面无法压缩到本次请求的大小预算内，请缩短片段后重试。');
}
