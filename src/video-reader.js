const aborted=()=>new DOMException('本次视频读取已取消。','AbortError');
export function waitForVideo(video,{signal,readyState=2,timeoutMs=30000,prime=false}={}){
 if(signal?.aborted)return Promise.reject(aborted());
 return new Promise((resolve,reject)=>{
  let timer,settled=false;
  const events=['loadedmetadata','loadeddata','canplay','progress','seeked'];
  const cleanup=()=>{clearTimeout(timer);events.forEach(name=>video.removeEventListener(name,check));video.removeEventListener('error',onError);signal?.removeEventListener('abort',onAbort);};
  const done=error=>{if(settled)return;settled=true;cleanup();error?reject(error):resolve(video);};
  const check=()=>{if(video.readyState>=readyState){done();return;}if(prime&&video.readyState>=1)video.play()?.catch(()=>{});};
  const onError=()=>done(new Error('无法解码视频，请使用兼容的 MP4 视频。')),onAbort=()=>done(aborted());
  events.forEach(name=>video.addEventListener(name,check));video.addEventListener('error',onError,{once:true});signal?.addEventListener('abort',onAbort,{once:true});
  timer=setTimeout(()=>done(new Error('本机读取视频超时，尚未向模型发送请求。请保持页面前台后重试。')),timeoutMs);check();
 });
}
export async function openVideoReader(blob,{signal,readyState=2,documentImpl=document,urlImpl=URL}={}){
 const video=documentImpl.createElement('video');video.muted=true;video.defaultMuted=true;video.playsInline=true;video.preload='auto';
 video.setAttribute('muted','');video.setAttribute('playsinline','');
 video.style.cssText='position:fixed;width:2px;height:2px;opacity:.01;left:0;bottom:0;pointer-events:none';documentImpl.body.append(video);
 const url=urlImpl.createObjectURL(blob);let disposed=false;
 const dispose=()=>{if(disposed)return;disposed=true;video.pause();video.removeAttribute('src');video.load();video.remove();urlImpl.revokeObjectURL(url);};
 try{
  const loaded=waitForVideo(video,{signal,readyState,prime:readyState>=2});video.src=url;video.load();await loaded;video.pause();
  return {video,dispose};
 }catch(error){dispose();throw error;}
}
export async function seekVideoFrame(video,time,{signal,timeoutMs=15000}={}){
 if(signal?.aborted)throw aborted();
 const duration=video.duration;
 const target=Math.max(0,Number.isFinite(duration)?Math.min(time,Math.max(0,duration-.12)):time);
 if(!video.seeking&&video.readyState>=2&&Math.abs(video.currentTime-target)<.002)return;
 await new Promise((resolve,reject)=>{
  let timer,settled=false;
  const events=['seeked','loadeddata','canplay'];
  const cleanup=()=>{clearTimeout(timer);events.forEach(name=>video.removeEventListener(name,check));video.removeEventListener('error',onError);signal?.removeEventListener('abort',onAbort);};
  const done=error=>{if(settled)return;settled=true;cleanup();error?reject(error):resolve();};
  const check=()=>{if(!video.seeking&&video.readyState>=2&&Math.abs(video.currentTime-target)<.06)done();};
  const onError=()=>done(new Error('本机无法读取这段视频的画面，尚未向模型发送请求。')),onAbort=()=>done(aborted());
  events.forEach(name=>video.addEventListener(name,check));video.addEventListener('error',onError,{once:true});signal?.addEventListener('abort',onAbort,{once:true});
  timer=setTimeout(()=>{if(!video.seeking&&video.readyState>=2&&Math.abs(video.currentTime-target)<.06)done();else done(new Error('本机读取视频画面超时，尚未向模型发送请求。请保持页面前台后重试。'));},timeoutMs);
  try{video.currentTime=target;check();}catch(error){done(error);}
 });
}
