import {encodeFrame,getFrameByteBudget} from '/airbag/frame-encoding.js';
import {MAX_BODY_BYTES,MAX_FRAME_BYTES} from '/airbag/analysis-client.js';
import {JumpTracker} from '/airbag/tracker.js';
const $=id=>document.getElementById(id);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function assert(value,message){if(!value)throw Error(message);}
function event(target,name,timeout=12000){return new Promise((resolve,reject)=>{
 const done=(error,value)=>{clearTimeout(timer);target.removeEventListener(name,success);target.removeEventListener('error',fail);error?reject(error):resolve(value);};
 const success=value=>done(null,value),fail=()=>done(Error(name+' failed'));
 const timer=setTimeout(()=>done(Error(name+' timed out')),timeout);
 target.addEventListener(name,success,{once:true});target.addEventListener('error',fail,{once:true});
});}
function run(button,output,task){$(button).onclick=async()=>{$(button).disabled=true;$(output).textContent='正在检查…';try{$(output).textContent='通过\n'+await task();}catch(error){$(output).textContent='未通过：'+error.message;}finally{$(button).disabled=false;}};}
run('encoding','encodingResult',async()=>{
 const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');
 const pixels=ctx.createImageData(canvas.width,canvas.height);let seed=20261021;
 for(let i=0;i<pixels.data.length;i+=4){for(let j=0;j<3;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i+j]=seed>>>24;}pixels.data[i+3]=255;}ctx.putImageData(pixels,0,0);
 const bytes=url=>Math.floor((url.length-url.indexOf(',')-1)*3/4)-(url.endsWith('==')?2:url.endsWith('=')?1:0);
 const before=bytes(canvas.toDataURL('image/jpeg',.76));let smaller=0;
 const encoded=await encodeFrame(canvas,{maxBytes:20000,createCanvas:()=>{smaller++;return document.createElement('canvas');}});
 assert(bytes(encoded)<=20000,'实际JPEG超过20,000字节');assert(smaller>0,'未触发缩尺寸路径');
 const budget=getFrameByteBudget({frameCount:96,maxBodyBytes:MAX_BODY_BYTES,maxFrameBytes:MAX_FRAME_BYTES});
 assert(budget>0&&budget*4/3*96<MAX_BODY_BYTES,'96帧预算错误');
 const controller=new AbortController(),pending=encodeFrame(canvas,{maxBytes:20000,createCanvas:()=>document.createElement('canvas'),signal:controller.signal});controller.abort();
 let cancelled=false;try{await pending;}catch(error){cancelled=error.name==='AbortError';}assert(cancelled,'编码未响应取消');
 return '实际Canvas JPEG：'+before.toLocaleString()+' → '+bytes(encoded).toLocaleString()+' 字节\n已触发缩尺寸路径；96帧预算有效；取消操作生效。';
});
run('recording','recordingResult',async()=>{
 const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
 assert(canvas.captureStream&&window.MediaRecorder,'此浏览器不支持生成画面录像');
 const ctx=canvas.getContext('2d');let frame=0;const draw=()=>{ctx.fillStyle='#193039';ctx.fillRect(0,0,640,360);ctx.fillStyle='#d9edaa';ctx.fillRect((frame++*19)%540,140,100,80);ctx.fillStyle='white';ctx.font='24px system-ui';ctx.fillText('LOCAL QA '+frame,20,40);};draw();
 const stream=canvas.captureStream(30),chunks=[];let recorder,timer;
 try{
  const mime=['video/mp4','video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
  recorder=new MediaRecorder(stream,mime?{mimeType:mime}:{});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  const stopped=event(recorder,'stop');recorder.start(100);timer=setInterval(draw,33);setTimeout(()=>{if(recorder.state!=='inactive')recorder.stop();},1100);await stopped;
  const blob=new Blob(chunks,{type:recorder.mimeType});assert(blob.size>100,'没有完整录像数据');
  const video=$('recorded'),loaded=event(video,'loadeddata'),url=URL.createObjectURL(blob);video.src=url;video.onemptied=()=>URL.revokeObjectURL(url);await loaded;
  assert(video.videoWidth===640&&video.videoHeight===360,'录像无法解码');await video.play();await pause(200);video.pause();
  assert(video.currentTime>0,'回看没有前进');
  return '真实MediaRecorder：'+recorder.mimeType+'\n'+chunks.length+' 个数据块，'+blob.size.toLocaleString()+' 字节\n可解码为640×360，并播放至 '+video.currentTime.toFixed(3)+' 秒。';
 }finally{clearInterval(timer);if(recorder&&recorder.state!=='inactive')recorder.stop();stream.getTracks().forEach(track=>track.stop());}
});
let detector=null,detectorTimestamp=0;
run('detect','detectionResult',async()=>{
 const file=$('detectionFile').files[0];assert(file,'请先选择本地视频');
 const {FilesetResolver,ObjectDetector}=await import('/airbag/vision/vision_bundle.mjs');
 if(!detector){const fileset=await FilesetResolver.forVisionTasks('/airbag/vision/wasm');detector=await ObjectDetector.createFromOptions(fileset,{baseOptions:{modelAssetPath:'/airbag/vision/model.tflite',delegate:'CPU'},runningMode:'VIDEO',scoreThreshold:.38,maxResults:8,categoryAllowlist:['person']});}
 const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';document.body.append(video);const url=URL.createObjectURL(file);const loaded=event(video,'loadeddata');video.src=url;
 try{
  await loaded;assert(Number.isFinite(video.duration),'无法读取视频时长');
  const times=[...new Set([.02,.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6].filter(time=>time<video.duration-.04))],tracker=new JumpTracker();
  const base=detectorTimestamp+1000,lines=[];let detected=0;
  for(const time of times){if(Math.abs(video.currentTime-time)>.005){const seeked=event(video,'seeked');video.currentTime=time;await seeked;}
   detectorTimestamp=base+time*1000;const result=detector.detectForVideo(video,detectorTimestamp),people=(result.detections||[]).map(d=>({x:d.boundingBox.originX/video.videoWidth,y:d.boundingBox.originY/video.videoHeight,w:d.boundingBox.width/video.videoWidth,h:d.boundingBox.height/video.videoHeight,score:d.categories[0]?.score||0}));
   if(people.length)detected++;const info=tracker.update(people,detectorTimestamp);lines.push(time.toFixed(2)+'s：'+people.length+' 人；'+info.state);
  }
  assert(detected>0,'资源已加载，但本次选取时刻没有人物检测结果');
  return '本地WASM和模型资源成功加载；'+detected+'/'+times.length+' 个时刻检测到人物。\n'+lines.join('\n')+'\n此项仅验证本地解码与检测连通，不替代现场自动起止验证。';
 }finally{video.removeAttribute('src');video.load();video.remove();URL.revokeObjectURL(url);}
});
