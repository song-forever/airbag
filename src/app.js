import { VIDEO_MODELS, TEXT_ONLY_MODELS, CATALOG_DATE, DEFAULT_MODEL, getModel } from './model-catalog.js';
import { analyzeFrames } from './analysis-client.js';
import { JumpTracker } from './tracker.js';
const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map(el => [el.id, el]));
let apiKey = '', autoAnalyze = false, model = DEFAULT_MODEL;
let action = '直飞', actionDetail = '', focus = '';
let records = [], current = null, currentUrl = null, stream = null, detector = null, detectorPromise = null;
let armed = false, processing = false, recorder = null, chunks = [], recordingStart = 0, departureAt = null;
let armTimer = null, inferenceTimer = null, wakeLock = null, finishing = false, discardCapture = false, pendingReason = '';
let analysisController = null, analysisBusy = false, analysisRun = 0;
let tracker = new JumpTracker({maxDurationMs:18000, lostGraceMs:2200});
const formatTime = (t) => Number.isFinite(t) ? Math.floor(t/60).toString().padStart(2,'0') + ':' + Math.floor(t%60).toString().padStart(2,'0') : '00:00';
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const reasons = {
 target_lost_after_receding:'目标远离并离开视野后，延时结束',
 visible_arc_finished:'根据目标运动变化，估计本次尝试结束',
 max_duration:'达到最长拍摄时间，已保留录像',
 manual:'手动结束拍摄', interrupted:'页面离开前台，录像已中断',
 waiting_timeout:'等待出发超时，保留当前录像',
 track_ended:'摄像头中断，已保存可用录像'
};
function toast(message) { ui.toast.textContent=message; ui.toast.hidden=false; clearTimeout(toast.timer); toast.timer=setTimeout(()=>ui.toast.hidden=true,5000); }
function status(message,error=false) {ui.captureStatus.textContent=message; ui.statusDot.className='status-dot '+(error?'error':stream?'active':'');}
function goalText() {return action+(actionDetail?' · '+actionDetail:'')+(focus?'；关注：'+focus:'');}
function setView(view) {
 ui.captureView.hidden=view!=='capture'; ui.reviewView.hidden=view!=='review';
 ui.captureTab.classList.toggle('active',view==='capture'); ui.reviewTab.classList.toggle('active',view==='review');
 if(view==='review') renderHistory();
}
function updateModelHint() {
 const custom=ui.modelSelect.value==='__custom';ui.customModelField.hidden=!custom;
 const selected=custom?getModel(ui.customModelInput.value.trim(),{allowCustom:true}):getModel(ui.modelSelect.value);
 ui.modelHint.textContent=custom?'填写百炼控制台中的完整视频理解模型 ID，使用当前北京地域 Key；新增型号的兼容性需实际验证。':(selected?.thinking?'此模型始终开启思考，可能需要更长时间。':'按模型支持的方式调用；优先使用非思考模式。')+' 当前发送视频画面，不发送音频。';
}
function populateModels() {
 const groups=new Map();ui.modelSelect.replaceChildren();
 for(const entry of VIDEO_MODELS){let group=groups.get(entry.group);if(!group){group=document.createElement('optgroup');group.label=entry.group;groups.set(entry.group,group);ui.modelSelect.append(group);}const option=document.createElement('option');option.value=entry.id;option.textContent=entry.id+(entry.thinking?' · 思考模式':'');group.append(option);}
 const unsupported=document.createElement('optgroup');unsupported.label='仅支持文本，不能分析视频';
 for(const id of TEXT_ONLY_MODELS){const option=document.createElement('option');option.value=id;option.textContent=id+' · 不支持视频';option.disabled=true;unsupported.append(option);}ui.modelSelect.append(unsupported);
 const other=document.createElement('option');other.value='__custom';other.textContent='其他 / 新增百炼视频模型…';ui.modelSelect.append(other);
 ui.modelCatalogInfo.textContent=VIDEO_MODELS.length+' 个视频模型及版本 · 清单核对 '+CATALOG_DATE+' · 可用地域和额度以控制台为准';
 ui.modelSelect.value=model;updateModelHint();
}
function showSettings() {ui.apiKeyInput.value=apiKey;ui.autoAnalyzeInput.checked=autoAnalyze;ui.modelSelect.value=VIDEO_MODELS.some(entry=>entry.id===model)?model:'__custom';ui.customModelInput.value=ui.modelSelect.value==='__custom'?model:'';updateModelHint();ui.settingsDialog.showModal();}
populateModels();
ui.modelSelect.onchange=updateModelHint;
function persistGoal() {
 try {localStorage.setItem('airbag-goal-v1',JSON.stringify({action,actionDetail,focus}));}catch{}
}
function updateAction(next) {
 action=next;document.querySelectorAll('[data-action]').forEach(btn=>btn.classList.toggle('selected',btn.dataset.action===action));
 ui.actionDetails.hidden=action==='直飞';
 ui.actionDetailLabel.textContent=action==='抓板'?'抓板名称（选填）':action==='转体'?'方向与目标角度':'描述目标动作';
 ui.actionDetail.placeholder=action==='抓板'?'例如：你想练习的抓板':action==='转体'?'例如：正脚 / 反脚、目标角度':'用一句话描述目标';
 persistGoal();
}
try {const saved=JSON.parse(localStorage.getItem('airbag-goal-v1')||'null');if(saved){action=['直飞','抓板','转体','自定义'].includes(saved.action)?saved.action:'直飞';actionDetail=String(saved.actionDetail||'');focus=String(saved.focus||'');}}catch{}
ui.actionDetail.value=actionDetail;ui.focusInput.value=focus;updateAction(action);
const dbPromise = new Promise((resolve,reject)=>{
 if(!('indexedDB' in window)){reject(new Error('本机不支持本地记录'));return;}
 const req=indexedDB.open('airbag-journal-v1',1);
 req.onupgradeneeded=()=>req.result.createObjectStore('clips',{keyPath:'id'});
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});
async function dbOp(mode,fn) {
 const db=await dbPromise;
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('clips',mode), store=tx.objectStore('clips');let result;
  try {const req=fn(store);req.onsuccess=()=>result=req.result;}catch(err){reject(err);return;}
  tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });
}
async function persistRecord(record) {
 try {await dbOp('readwrite',s=>s.put(record));record.persisted=true;return true;}
 catch {record.persisted=false;toast('本地空间不足或存储不可用：本跳暂留内存，请下载重要视频。');return false;}
}
async function initializeHistory() {
 try {records=(await dbOp('readonly',s=>s.getAll())).sort((a,b)=>b.createdAt-a.createdAt);records.forEach(r=>r.persisted=true);if(records.length) await selectRecord(records[0]);}
 catch {toast('当前浏览器无法保存历史记录；仍可拍摄、分析和下载。');}
 ui.reviewCount.textContent=String(records.length);renderHistory();
}
function setCaptureControls(busy) {
 ui.armBtn.hidden=busy;ui.recordActions.hidden=!busy;ui.importBtn.disabled=busy||processing||finishing;
 ui.reviewTab.disabled=busy||processing||finishing;
 ui.openCameraBtn.disabled=processing;ui.closeCameraBtn.hidden=!stream||busy;
 document.querySelectorAll('[data-action],#actionDetail,#focusInput').forEach(el=>el.disabled=busy);
}
async function keepAwake() {
 try {if('wakeLock' in navigator){wakeLock=await navigator.wakeLock.request('screen');wakeLock.addEventListener('release',()=>{wakeLock=null;});}}catch{}
}
function releaseAwake(){if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}}
async function openCamera() {
 if(stream)return;
 if(!window.isSecureContext)throw new Error('拍摄需要 HTTPS 链接，请通过已发布的网站打开。');
 if(!navigator.mediaDevices?.getUserMedia)throw new Error('当前浏览器不支持网页拍摄，请用 Safari 打开，或导入已有视频。');
 status('正在请求摄像头权限…');
 try {
  stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:60,max:60}}});
  ui.cameraVideo.srcObject=stream;ui.cameraVideo.hidden=false;ui.cameraPlaceholder.hidden=true;ui.cameraStage.classList.add('live');
  await ui.cameraVideo.play();
  const settings=stream.getVideoTracks()[0].getSettings();
  ui.cameraQuality.textContent=(settings.width||'')+' × '+(settings.height||'')+' · '+Math.round(settings.frameRate||30)+' fps';
  ui.cameraBadge.innerHTML='<i></i> CAMERA READY';
  ui.cameraHint.textContent='相机已就绪 · 保持手机固定';status('相机已开启，准备后将自动等待出发');ui.closeCameraBtn.hidden=false;
  stream.getVideoTracks()[0].onended=()=>{if(armed)finishCapture('track_ended');else closeCamera();};
 }catch(err){closeCamera();if(err.name==='NotAllowedError')throw new Error('摄像头权限未开启。请在 Safari 网站设置中允许相机，再重试。');if(err.name==='NotReadableError')throw new Error('摄像头暂时不可用，请关闭其他正在使用相机的应用。');throw err;}
}
function closeCamera() {
 if(armed)return;
 clearTimeout(inferenceTimer);releaseAwake();
 if(stream){stream.getTracks().forEach(track=>{track.onended=null;track.stop();});stream=null;}
 ui.cameraVideo.srcObject=null;ui.cameraVideo.hidden=true;ui.cameraPlaceholder.hidden=false;ui.cameraStage.classList.remove('live');
 ui.cameraBadge.innerHTML='<i></i> CAMERA OFF';ui.cameraBadge.classList.remove('recording');ui.closeCameraBtn.hidden=true;
 const ctx=ui.trackingCanvas.getContext('2d');ctx.clearRect(0,0,ui.trackingCanvas.width,ui.trackingCanvas.height);
 status('摄像头已关闭');ui.cameraHint.textContent='准备好后，点击下方按钮';ui.recordClock.textContent='00:00';
}
async function loadDetector() {
 if(detector)return detector;
 if(detectorPromise)return detectorPromise;
 detectorPromise=(async()=>{
  status('首次准备：正在加载本地人物检测资源…');
  const {FilesetResolver,ObjectDetector}=await import(new URL('./vision/vision_bundle.mjs',import.meta.url).href);
  const fileset=await FilesetResolver.forVisionTasks(new URL('./vision/wasm',import.meta.url).href);
  const options={baseOptions:{modelAssetPath:new URL('./vision/model.tflite',import.meta.url).href,delegate:'GPU'},runningMode:'VIDEO',scoreThreshold:.38,maxResults:8,categoryAllowlist:['person']};
  try{detector=await ObjectDetector.createFromOptions(fileset,options);}catch{options.baseOptions.delegate='CPU';detector=await ObjectDetector.createFromOptions(fileset,options);}
  return detector;
 })();
 try{return await detectorPromise;}catch(err){detectorPromise=null;throw new Error('人物检测资源未能加载。请检查网络后重试；也可以先导入视频复盘。');}
}
function drawTarget(rect) {
 const canvas=ui.trackingCanvas,video=ui.cameraVideo;
 canvas.width=Math.round(canvas.clientWidth*devicePixelRatio);canvas.height=Math.round(canvas.clientHeight*devicePixelRatio);
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
 if(!rect||!video.videoWidth)return;
 const scale=Math.min(canvas.width/video.videoWidth,canvas.height/video.videoHeight);
 const x=(canvas.width-video.videoWidth*scale)/2+rect.x*video.videoWidth*scale;
 const y=(canvas.height-video.videoHeight*scale)/2+rect.y*video.videoHeight*scale;
 const w=rect.w*video.videoWidth*scale,h=rect.h*video.videoHeight*scale;
 ctx.strokeStyle='#d9edaa';ctx.lineWidth=2*devicePixelRatio;ctx.setLineDash([10*devicePixelRatio,5*devicePixelRatio]);ctx.strokeRect(x,y,w,h);
 ctx.fillStyle='#d9edaa';ctx.font=(10*devicePixelRatio)+'px sans-serif';ctx.fillText('本次目标',Math.max(5,x),Math.max(14*devicePixelRatio,y-8*devicePixelRatio));
}
async function armCapture() {
 if(armed||processing||finishing||analysisBusy)return;
 processing=true;ui.armBtn.disabled=true;ui.armLabel.textContent='正在准备…';setCaptureControls(false);
 try{
  await openCamera();await loadDetector();
  if(document.hidden)throw new Error('请保持页面在前台，再点击准备。');
  if(!window.MediaRecorder)throw new Error('当前浏览器不支持录像，请使用较新的 Safari 或导入已有视频。');
  const mime=['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
  const options={videoBitsPerSecond:4500000};if(mime)options.mimeType=mime;
  recorder=new MediaRecorder(stream,options);chunks=[];departureAt=null;recordingStart=performance.now();discardCapture=false;finishing=false;pendingReason='';
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  recorder.onerror=()=>finishCapture('track_ended');
  recorder.onstop=finalizeRecording;
  recorder.start(1000);armed=true;tracker.reset();setCaptureControls(true);await keepAwake();
  ui.cameraBadge.innerHTML='<i></i> WAITING FOR RIDER';ui.cameraHint.textContent='自动检测已就绪 · 等待出发';status('等待第一个出发的人 · 跟踪框出现后再出发');
  armTimer=setInterval(()=>{
   const now=performance.now();ui.recordClock.textContent=departureAt?formatTime((now-departureAt)/1000):'等待中';
   if(!departureAt&&now-recordingStart>60000)finishCapture('waiting_timeout');
   if(departureAt&&now-departureAt>=18000)finishCapture('max_duration');
  },200);
  detectLoop();
 }catch(err){status(err.message,true);toast(err.message);}
 finally{processing=false;ui.armBtn.disabled=false;ui.armLabel.textContent='准备下一跳';setCaptureControls(armed);}
}
function detectLoop() {
 if(!armed||!detector||!stream)return;
 const started=performance.now();
 try{
  const video=ui.cameraVideo;
  if(video.readyState>=2&&video.videoWidth){
   const result=detector.detectForVideo(video,performance.now());
   const detections=(result.detections||[]).map(d=>({x:d.boundingBox.originX/video.videoWidth,y:d.boundingBox.originY/video.videoHeight,w:d.boundingBox.width/video.videoWidth,h:d.boundingBox.height/video.videoHeight,score:d.categories[0]?.score||0}));
   const info=tracker.update(detections,performance.now());drawTarget(info.target);
   if(info.state==='recording'&&!departureAt){departureAt=performance.now();ui.cameraBadge.innerHTML='<i></i> RECORDING';ui.cameraBadge.classList.add('recording');ui.cameraHint.textContent='正在记录这一跳';status('已检测到出发，正在跟踪本次滑手');}
   else if(info.state==='locked'&&!departureAt){status('目标已锁定 · 等待出发');ui.cameraHint.textContent='已锁定镜头前滑手';}
   else if(info.state==='waiting'&&!departureAt){status('等待出发 · 请保持目标在画面中');}
   if(info.reason==='target_temporarily_lost'&&departureAt)status('目标暂时被遮挡，继续保留录像');
   if(info.state==='complete'){finishCapture(info.reason);return;}
  }
 }catch{status('跟踪暂时中断，录像继续；可手动结束',true);}
 inferenceTimer=setTimeout(detectLoop,Math.max(40,180-(performance.now()-started)));
}
function finishCapture(reason='manual',discard=false) {
 if(!armed||finishing)return;
 finishing=true;armed=false;pendingReason=reason;discardCapture=discard;
 clearInterval(armTimer);clearTimeout(inferenceTimer);releaseAwake();setCaptureControls(false);
 ui.armBtn.disabled=true;ui.armLabel.textContent='正在保存…';
 status(discard?'正在取消本次…':'正在保存这一跳…');
 if(recorder&&recorder.state!=='inactive')recorder.stop();else finalizeRecording();
}
async function getVideoMetadata(blob) {
 const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='metadata';
 const url=URL.createObjectURL(blob);video.src=url;
 try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('视频元数据读取超时')),10000);video.onloadedmetadata=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(new Error('视频格式暂不兼容，请导出为 H.264 编码的 MP4 后重试。'));};});
  let duration=video.duration;
  if(!Number.isFinite(duration)||duration===Infinity){
   video.currentTime=1e10;await sleep(250);duration=video.duration;video.currentTime=0;
  }
  return {duration,width:video.videoWidth,height:video.videoHeight};
 }finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
async function seekVideo(video,time,signal) {
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 if(Math.abs(video.currentTime-time)<.015&&video.readyState>=2)return;
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>done(new Error('视频画面读取超时，请重试或缩短片段。')),7000);
  const done=error=>{clearTimeout(timer);video.removeEventListener('seeked',onSeek);video.removeEventListener('error',onError);signal?.removeEventListener('abort',onAbort);error?reject(error):resolve();};
  const onSeek=()=>done(),onError=()=>done(new Error('无法解码这段视频，请尝试导出 MP4。')),onAbort=()=>done(new DOMException('Aborted','AbortError'));
  video.addEventListener('seeked',onSeek,{once:true});video.addEventListener('error',onError,{once:true});signal?.addEventListener('abort',onAbort,{once:true});
  try{video.currentTime=time;}catch(err){done(err);}
 });
}
async function getPoster(blob,time=0) {
 const url=URL.createObjectURL(blob),v=document.createElement('video');v.muted=true;v.playsInline=true;v.preload='auto';v.src=url;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('poster timeout')),5000);v.onloadeddata=()=>{clearTimeout(timer);resolve();};v.onerror=()=>{clearTimeout(timer);reject();};});
  await seekVideo(v,Math.max(.01,time));
  const c=document.createElement('canvas');const scale=Math.min(1,240/Math.max(v.videoWidth,v.videoHeight));c.width=Math.max(1,Math.round(v.videoWidth*scale));c.height=Math.max(1,Math.round(v.videoHeight*scale));c.getContext('2d').drawImage(v,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.65);
 }catch{return '';}finally{v.removeAttribute('src');v.load();URL.revokeObjectURL(url);}
}
async function finalizeRecording() {
 const mime=recorder?.mimeType||'video/mp4',blob=new Blob(chunks,{type:mime});chunks=[];
 const elapsed=(performance.now()-recordingStart)/1000;
 const departedOffset=departureAt?Math.max(0,(departureAt-recordingStart)/1000-1.2):0;
 const detectedAction=goalText();const shouldAnalyze=autoAnalyze&&!!apiKey&&!!departureAt&&pendingReason!=='interrupted';
 closeCamera();
 try{
  if(discardCapture||blob.size<100){status('已取消，准备好后可以重新拍摄');return;}
  let meta;try{meta=await getVideoMetadata(blob);}catch{meta={duration:elapsed,width:0,height:0};}
  if(!Number.isFinite(meta.duration)||meta.duration<=0)meta.duration=elapsed;
  const clip={id:crypto.randomUUID(),createdAt:Date.now(),source:'camera',name:'现场拍摄',blob,duration:meta.duration,width:meta.width,height:meta.height,action:detectedAction,actionType:action,actionDetail,focus,trimStart:Math.min(departedOffset,meta.duration-.1),trimEnd:meta.duration,reason:pendingReason,note:reasons[pendingReason]||'自动检测结束',poster:'',analysis:null};
  clip.poster=await getPoster(blob,clip.trimStart+.1);records.unshift(clip);await persistRecord(clip);await selectRecord(clip,{internal:true});setView('review');window.scrollTo({top:0,behavior:'smooth'});
  if(shouldAnalyze)setTimeout(()=>{if(current===clip)analyzeCurrent();},0);else if(autoAnalyze&&!apiKey)toast('录像已保存。请在设置中填写百炼模型 Key 后分析。');
 }catch(err){toast('录像处理失败：'+err.message);}
 finally{finishing=false;recorder=null;ui.armBtn.disabled=false;ui.armLabel.textContent='准备下一跳';setCaptureControls(false);}
}
async function importVideo(file) {
 if(!file)return;
 if(armed||processing||finishing||analysisBusy){toast('请先结束当前拍摄或分析。');return;}
 if(file.size>500*1024*1024){toast('请先选择较短的一跳视频，文件需小于 500 MB。');return;}
 processing=true;ui.importBtn.disabled=true;toast('正在读取视频…');
 try {
  const meta=await getVideoMetadata(file);
  if(!Number.isFinite(meta.duration)||meta.duration<=0)throw new Error('未能读取视频时长，请换成 MP4 后重试。');
  const clip={id:crypto.randomUUID(),createdAt:Date.now(),source:'import',name:file.name,blob:file,duration:meta.duration,width:meta.width,height:meta.height,action:goalText(),actionType:action,actionDetail,focus,trimStart:0,trimEnd:Math.min(meta.duration,60),reason:'import',note:'导入的原始视频',poster:'',analysis:null};
  clip.poster=await getPoster(file,.1);records.unshift(clip);await persistRecord(clip);await selectRecord(clip,{internal:true});setView('review');window.scrollTo({top:0,behavior:'smooth'});
  toast(meta.duration>60?'视频已导入。请先选择其中一跳，最长 60 秒。':'视频已导入，确认目标动作后可开始分析。');
 }catch(err){toast(err.message);}finally{processing=false;ui.importBtn.disabled=false;ui.fileInput.value='';}
}
async function selectRecord(record,{internal=false}={}) {
 if(armed||(!internal&&(processing||finishing))){toast('请先完成当前拍摄或保存。');return;}
 if(analysisBusy){toast('请先等待或取消当前分析，再切换视频。');return;}
 current=record;if(currentUrl)URL.revokeObjectURL(currentUrl);currentUrl=URL.createObjectURL(record.blob);
 ui.reviewVideo.src=currentUrl;ui.reviewVideo.playbackRate=.5;ui.reviewVideo.loop=false;
 ui.reviewVideo.onloadedmetadata=()=>{ui.reviewVideo.currentTime=record.trimStart;};
 ui.reviewEmpty.hidden=true;ui.reviewContent.hidden=false;
 ui.clipTitle.textContent=record.actionType||'这一跳';ui.clipSource.textContent=(record.source==='camera'?'现场拍摄':'本地导入')+' / '+new Date(record.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
 ui.clipMeta.textContent=record.duration.toFixed(1)+' 秒 · '+(record.width?record.width+' × '+record.height+' · ':'')+record.note+(record.persisted?' · 已保存在本机':' · 暂留当前页面');
 ui.trimStart.max=record.duration;ui.trimEnd.max=record.duration;ui.trimStart.value=record.trimStart.toFixed(1);ui.trimEnd.value=record.trimEnd.toFixed(1);
 ui.trimLabel.textContent=record.trimStart.toFixed(1)+'–'+record.trimEnd.toFixed(1)+' 秒';ui.reviewAction.value=record.actionType||'直飞';ui.reviewActionDetail.value=record.actionDetail||'';
 ui.analyzeBtn.disabled=false;ui.analysisProgress.hidden=true;ui.analysisError.hidden=true;ui.analysisIdle.hidden=!!record.analysis;
 renderAnalysis();renderHistory();ui.reviewCount.textContent=String(records.length);
}
function renderHistory() {
 ui.historyList.replaceChildren();ui.historyTotal.textContent=String(records.length);
 for(const record of records){
  const btn=document.createElement('button');btn.className='history-item'+(record===current?' active':'');
  const img=document.createElement('img');if(record.poster)img.src=record.poster;img.alt='';
  const div=document.createElement('div'),title=document.createElement('strong'),small=document.createElement('small');
  title.textContent=record.actionType||'这一跳';small.textContent=new Date(record.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+' · '+record.duration.toFixed(1)+'秒 · '+(record.analysis?'已分析':'待复盘');
  div.append(title,small);btn.append(img,div);btn.onclick=()=>selectRecord(record);ui.historyList.append(btn);
 }
}
let loopEnabled=true;
ui.reviewVideo.addEventListener('timeupdate',()=>{
 if(!current)return;
 if(!ui.reviewVideo.paused&&ui.reviewVideo.currentTime>=current.trimEnd-.05){
  if(loopEnabled){ui.reviewVideo.currentTime=current.trimStart;if(!ui.reviewVideo.paused)ui.reviewVideo.play().catch(()=>{});}
  else ui.reviewVideo.pause();
 }
});
ui.reviewVideo.addEventListener('ended',()=>{if(current&&loopEnabled){ui.reviewVideo.currentTime=current.trimStart;ui.reviewVideo.play().catch(()=>{});}});
function appendText(parent,tag,text,className=''){const el=document.createElement(tag);el.textContent=typeof text==='string'?text:JSON.stringify(text);if(className)el.className=className;parent.append(el);return el;}
function renderAnalysis() {
 const result=ui.analysisResult;result.replaceChildren();
 const data=current?.analysis;result.hidden=!data;ui.analysisIdle.hidden=!!data;ui.exportReportBtn.disabled=!data;
 ui.analyzeBtn.textContent=data?'重新分析这一跳 ↗':'分析这一跳 ↗';
 if(!data)return;
 const a=data.analysis;
 if(a.rawText){appendText(result,'div',a.rawText,'raw-result');}
 else {
  appendText(result,'p',a.summary||'分析已完成','result-summary');
  for(const item of (Array.isArray(a.observations)?a.observations:[])){
   const row=document.createElement('div');row.className='observation';const head=document.createElement('div');head.className='observation-head';
   const t=Number(item.time);if(Number.isFinite(t)){const button=appendText(head,'button',t.toFixed(1)+'s','time-link');button.onclick=()=>{ui.reviewVideo.currentTime=current.trimStart+Math.min(Math.max(t,0),current.trimEnd-current.trimStart);ui.reviewVideo.pause();};}
   appendText(head,'span',item.certainty||'画面观察','certainty');row.append(head);
   appendText(row,'p',item.evidence||'');if(item.interpretation)appendText(row,'p',item.interpretation,'inference');result.append(row);
  }
  if(a.focus){const box=document.createElement('div');box.className='focus-box';appendText(box,'small','下次只关注这一点');appendText(box,'p',a.focus);result.append(box);}
  if(Array.isArray(a.limitations)&&a.limitations.length)appendText(result,'p','判断范围：'+a.limitations.join('；'),'limitations');
 }
 if(current.keyframes?.length){const strip=document.createElement('div');strip.className='keyframes';for(const frame of current.keyframes){const btn=document.createElement('button');btn.className='keyframe';const img=document.createElement('img');img.src=frame.dataUrl;img.alt=frame.time.toFixed(1)+'秒画面';appendText(btn,'span',frame.time.toFixed(1)+'s');btn.prepend(img);btn.onclick=()=>{ui.reviewVideo.currentTime=current.trimStart+frame.time;ui.reviewVideo.pause();};strip.append(btn);}result.append(strip);}
 const u=data.usage||{};appendText(result,'div',data.model+' · 抽帧分析，非逐帧结论\n'+(u.total_tokens?u.total_tokens.toLocaleString()+' Token · ':'')+(Number.isFinite(data.estimatedCostCny)?'标价估算 ¥'+data.estimatedCostCny.toFixed(4)+'（免费额度抵扣前）':'未配置此模型单价，费用以百炼账单为准'),'usage');
}
async function extractFrames(record,signal) {
 const start=record.trimStart,end=record.trimEnd,duration=end-start;
 if(duration<0.5||duration>60)throw new Error('请选择 0.5 至 60 秒的片段。');
 const v=document.createElement('video');v.muted=true;v.playsInline=true;v.preload='auto';v.style.cssText='position:fixed;width:1px;height:1px;opacity:.001;left:0;bottom:0;pointer-events:none';document.body.append(v);
 const url=URL.createObjectURL(record.blob);v.src=url;let frames=[];
 try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('视频加载超时')),10000);const onAbort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};signal.addEventListener('abort',onAbort,{once:true});v.onloadeddata=()=>{clearTimeout(timer);signal.removeEventListener('abort',onAbort);resolve();};v.onerror=()=>{clearTimeout(timer);signal.removeEventListener('abort',onAbort);reject(new Error('无法读取视频画面，请使用兼容的 MP4 视频。'));};});
  const count=Math.min(32,Math.max(8,Math.ceil(duration*6))),c=document.createElement('canvas'),scale=Math.min(1,960/Math.max(v.videoWidth,v.videoHeight));
  c.width=Math.max(1,Math.round(v.videoWidth*scale));c.height=Math.max(1,Math.round(v.videoHeight*scale));const ctx=c.getContext('2d',{alpha:false});
  for(let i=0;i<count;i++){
   if(signal.aborted)throw new DOMException('Aborted','AbortError');
   const relative=Math.max(.01,(duration-.08)*i/(count-1));await seekVideo(v,start+relative,signal);
   ctx.drawImage(v,0,0,c.width,c.height);frames.push({time:Number(relative.toFixed(3)),dataUrl:c.toDataURL('image/jpeg',.76)});
   ui.analysisMeter.value=Math.round((i+1)/count*55);ui.progressDetail.textContent='正在抽取画面 '+(i+1)+' / '+count+'，原片不上传。';await sleep(0);
  }
  return frames;
 }finally{v.removeAttribute('src');v.load();v.remove();URL.revokeObjectURL(url);}
}
async function analyzeCurrent() {
 if(!current||analysisBusy||armed||processing||finishing){if(armed||processing||finishing)toast('请先结束拍摄并等待保存完成。');return;}
 if(!apiKey){showSettings();toast('先填写自己的百炼模型 Key，再点击分析。');return;}
 if(!autoAnalyze){const yes=confirm('本次将把抽取画面直接发送至阿里云百炼模型，并产生 API 费用。是否继续？');if(!yes)return;}
 const record=current,run=++analysisRun;analysisController=new AbortController();analysisBusy=true;record.actionType=ui.reviewAction.value;record.actionDetail=ui.reviewActionDetail.value.trim();record.action=record.actionType+(record.actionDetail?' · '+record.actionDetail:'')+(record.focus?'；关注：'+record.focus:'');
 ui.analysisProgress.hidden=false;ui.analysisIdle.hidden=true;ui.analysisResult.hidden=true;ui.analysisError.hidden=true;ui.analyzeBtn.hidden=true;ui.analysisMeter.value=0;ui.progressTitle.textContent='正在准备画面';ui.armBtn.disabled=true;ui.importBtn.disabled=true;ui.nextJumpBtn.disabled=true;ui.deleteClipBtn.disabled=true;ui.applyTrimBtn.disabled=true;ui.reviewAction.disabled=true;ui.reviewActionDetail.disabled=true;
 let timer=null;
 try {
  const frames=await extractFrames(record,analysisController.signal);
  ui.progressTitle.textContent='百炼模型正在看这一跳';ui.progressDetail.textContent='正在分析助滑、起跳与腾空。可先在左侧慢放回看。';ui.analysisMeter.value=65;
  const data=await analyzeFrames({apiKey,model,frames,action:record.action,duration:record.trimEnd-record.trimStart},{signal:analysisController.signal});
  if(run!==analysisRun)return;
  record.analysis=data;record.keyframes=frames.filter((_,i)=>i%Math.max(1,Math.floor(frames.length/6))===0).slice(0,6);await persistRecord(record);
  ui.analysisMeter.value=100;renderAnalysis();renderHistory();toast('这一跳的分析已完成。');
 }catch(err){
  if(run===analysisRun){ui.analysisError.hidden=false;ui.analysisError.textContent=err.name==='AbortError'?'分析已取消或请求超时，视频仍保存在本机。':err.message;ui.analysisIdle.hidden=!!record.analysis;if(record.analysis)renderAnalysis();}
 }finally{
  clearTimeout(timer);if(run===analysisRun){analysisBusy=false;analysisController=null;ui.analysisProgress.hidden=true;ui.analyzeBtn.hidden=false;ui.armBtn.disabled=false;ui.importBtn.disabled=false;ui.nextJumpBtn.disabled=false;ui.deleteClipBtn.disabled=false;ui.applyTrimBtn.disabled=false;ui.reviewAction.disabled=false;ui.reviewActionDetail.disabled=false;}
 }
}
function download(blob,name){const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
ui.openCameraBtn.onclick=()=>openCamera().catch(err=>{toast(err.message);status(err.message,true);});
ui.closeCameraBtn.onclick=closeCamera;ui.armBtn.onclick=armCapture;ui.stopBtn.onclick=()=>finishCapture('manual');
ui.cancelBtn.onclick=()=>finishCapture('manual',true);
ui.importBtn.onclick=ui.emptyImportBtn.onclick=()=>ui.fileInput.click();
ui.fileInput.onchange=()=>importVideo(ui.fileInput.files[0]);
ui.captureTab.onclick=()=>setView('capture');ui.reviewTab.onclick=()=>setView('review');
ui.settingsBtn.onclick=showSettings;ui.howBtn.onclick=()=>ui.helpDialog.showModal();
document.querySelectorAll('[data-close]').forEach(btn=>btn.onclick=()=>$(btn.dataset.close).close());
ui.settingsForm.onsubmit=e=>{
 e.preventDefault();const value=ui.apiKeyInput.value.trim();
 if(value&&(/[\s\r\n]/.test(value)||value.length<16)){toast('请填写完整的百炼 API Key。');return;}
 if(ui.autoAnalyzeInput.checked&&!value){toast('开启自动分析前，请先填写 API Key。');return;}
 const selectedModel=ui.modelSelect.value==='__custom'?ui.customModelInput.value.trim():ui.modelSelect.value;
 if(!getModel(selectedModel,{allowCustom:true})){toast('请选择视频理解模型，或填写正确的百炼视频模型 ID。');return;}
 apiKey=value;autoAnalyze=ui.autoAnalyzeInput.checked;model=selectedModel;ui.apiKeyInput.value='';ui.settingsDialog.close();
 ui.analysisPrivacy.textContent=apiKey?'已连接百炼模型 · 密钥仅本次打开有效'+(autoAnalyze?' · 已允许每跳自动分析':''):'仅将抽取画面发送到百炼模型；需要填写自己的 API Key。';
 toast(apiKey?'本次设置已保存。':'本地回放模式，无需百炼模型 Key。');
};
ui.clearKeyBtn.onclick=()=>{apiKey='';autoAnalyze=false;ui.apiKeyInput.value='';ui.autoAnalyzeInput.checked=false;toast('密钥已清除，自动分析已关闭。');};
document.querySelectorAll('[data-action]').forEach(btn=>btn.onclick=()=>{if(action!==btn.dataset.action){actionDetail='';ui.actionDetail.value='';}updateAction(btn.dataset.action);});
ui.actionDetail.oninput=()=>{actionDetail=ui.actionDetail.value.trim();persistGoal();};ui.focusInput.oninput=()=>{focus=ui.focusInput.value.trim();persistGoal();};
document.querySelectorAll('[data-speed]').forEach(btn=>btn.onclick=()=>{ui.reviewVideo.playbackRate=Number(btn.dataset.speed);document.querySelectorAll('[data-speed]').forEach(b=>b.classList.toggle('selected',b===btn));});
function stepFrame(delta){if(!current)return;ui.reviewVideo.pause();ui.reviewVideo.currentTime=Math.min(current.trimEnd-.01,Math.max(current.trimStart,ui.reviewVideo.currentTime+delta/60));}
ui.prevFrameBtn.onclick=()=>stepFrame(-1);ui.nextFrameBtn.onclick=()=>stepFrame(1);
ui.loopBtn.onclick=()=>{loopEnabled=!loopEnabled;ui.loopBtn.setAttribute('aria-pressed',String(loopEnabled));ui.loopBtn.classList.toggle('selected',loopEnabled);};ui.loopBtn.classList.add('selected');
ui.nextJumpBtn.onclick=()=>{setView('capture');window.scrollTo({top:0,behavior:'smooth'});};
ui.analyzeBtn.onclick=analyzeCurrent;ui.cancelAnalysisBtn.onclick=()=>analysisController?.abort();
ui.applyTrimBtn.onclick=async()=>{
 if(!current||analysisBusy)return;
 const start=Number(ui.trimStart.value),end=Number(ui.trimEnd.value);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>current.duration||end-start<0.5||end-start>60){toast('请选择有效片段，时长为 0.5 至 60 秒。');return;}
 current.trimStart=start;current.trimEnd=Math.min(end,current.duration);current.analysis=null;current.keyframes=[];
 await persistRecord(current);await selectRecord(current);toast('分析片段已更新。');
};
ui.reviewAction.onchange=ui.reviewActionDetail.onchange=async()=>{
 if(!current)return;
 current.actionType=ui.reviewAction.value;current.actionDetail=ui.reviewActionDetail.value.trim();current.action=current.actionType+(current.actionDetail?' · '+current.actionDetail:'');
 current.analysis=null;current.keyframes=[];await persistRecord(current);ui.clipTitle.textContent=current.actionType;renderAnalysis();renderHistory();
};
ui.downloadVideoBtn.onclick=()=>{if(current)download(current.blob,'跃练-'+new Date(current.createdAt).toISOString().replace(/[:.]/g,'-')+(current.blob.type.includes('webm')?'.webm':'.mp4'));};
ui.exportReportBtn.onclick=()=>{if(!current?.analysis)return;download(new Blob([JSON.stringify({createdAt:new Date(current.createdAt).toISOString(),action:current.action,range:{start:current.trimStart,end:current.trimEnd},...current.analysis},null,2)],{type:'application/json'}),'跃练-动作分析.json');};
ui.deleteClipBtn.onclick=async()=>{
 if(!current||analysisBusy)return;if(!confirm('删除这一跳在当前浏览器中的视频和分析？'))return;
 const id=current.id;try{await dbOp('readwrite',s=>s.delete(id));}catch{toast('本地存储不可用，已清除当前页面中的记录。');}
 records=records.filter(r=>r.id!==id);current=null;if(currentUrl){URL.revokeObjectURL(currentUrl);currentUrl=null;}ui.reviewVideo.removeAttribute('src');ui.reviewVideo.load();
 if(records.length)await selectRecord(records[0]);else{ui.reviewContent.hidden=true;ui.reviewEmpty.hidden=false;ui.reviewCount.textContent='0';}
 renderHistory();
};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&armed){finishCapture('interrupted');}else if(!document.hidden&&armed)keepAwake();});
window.addEventListener('pagehide',()=>{apiKey='';if(armed)finishCapture('interrupted');if(stream&&!armed)closeCamera();});
window.addEventListener('beforeunload',event=>{if(armed||analysisBusy){event.preventDefault();event.returnValue='';}});
window.addEventListener('unhandledrejection',event=>{console.warn('An operation could not complete.');});
initializeHistory();
