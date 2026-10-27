import { prepareAnalysisFrames } from './analysis-preparation.js?v=0.13.1';
import { getTrainingContext } from './training-context.js?v=0.9.0';
import { ComparisonPlayer } from './comparison-player.js?v=0.12.0';
import { CameraZoom } from './camera-zoom.js?v=0.7.0';
import { FrameMotionDetector } from './motion-detector.js?v=0.12.5';
import { makeVideoFile, canShareVideo } from './video-export.js?v=0.5.5';
import { VIDEO_MODELS, CATALOG_DATE, DEFAULT_MODEL, getModel } from './model-catalog.js?v=0.13.1';
import { analyzeFrames, MAX_BODY_BYTES, MAX_FRAME_BYTES } from './analysis-client.js?v=0.13.1';
import { openVideoReader, seekVideoFrame } from './video-reader.js?v=0.5.4';
import { JumpTracker } from './tracker.js?v=6764207';
import { createSettingsStore, isValidApiKey } from './settings-store.js?v=0.13.1';
const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map(el => [el.id, el]));
const comparison = new ComparisonPlayer({elements:ui,createElement:tag=>document.createElement(tag)});
const settingsStore=createSettingsStore({getStorage:()=>localStorage,appPath:new URL('./',import.meta.url).pathname});
let {apiKey,autoAnalyze,model,persisted:settingsPersisted}=settingsStore.snapshot();
let records = [], current = null, currentUrl = null, stream = null, detector = null, detectorPromise = null;
let analysisDetector=null,analysisDetectorPromise=null;
let detectionActive=false;
let armed = false, processing = false, recorder = null, chunks = [], armedAt = 0, recordingStart = 0, departureAt = null;
let armTimer = null, inferenceTimer = null, wakeLock = null, finishing = false, discardCapture = false, pendingReason = '';
let keepScreenAwake=false,wakeLockPending=null,wakeLockGeneration=0;
let cameraOpenPromise=null,cameraGeneration=0;
let analysisController = null, analysisBusy = false, analysisRun = 0;
const MIN_RECORDING_MS=6000,MAX_RECORDING_MS=45000,END_TAIL_MS=3000;
let autoFinishAt=null,autoFinishReason='',firstPersonAt=null;
let tracker = new JumpTracker({maxDurationMs:MAX_RECORDING_MS, lostGraceMs:2200,minRecordingMs:MIN_RECORDING_MS});
const motionCanvas=document.createElement('canvas');motionCanvas.width=160;motionCanvas.height=90;
const motionContext=motionCanvas.getContext('2d',{alpha:false,willReadFrequently:true});
const motionDetector=new FrameMotionDetector({width:160,height:90,edgeRatio:.1,minChangedPixels:3});
let motionState=null,motionSince=null,lastMotionAt=null;
let zoomQuietUntil=0;
const cameraZoom=new CameraZoom({onChange:renderCameraZoom,onTransition:resetMotionForZoom});
function renderCameraZoom(state){
 ui.cameraZoom.hidden=!stream||!state.supported;ui.zoomUnavailable.hidden=!stream||state.supported;
 if(ui.cameraZoom.hidden)ui.cameraZoom.open=false;
 ui.zoomError.hidden=!state.error;ui.zoomError.textContent=state.error;
 if(!state.supported)return;
 const label=value=>Number(value.toFixed(2))+'×';
 ui.zoomSummaryValue.textContent=label(state.value);ui.zoomToggle.setAttribute('aria-label','相机变焦，当前'+label(state.value));
 ui.zoomValue.textContent=label(state.value);ui.zoomRange.min=state.min;ui.zoomRange.max=state.max;ui.zoomRange.step=state.step;ui.zoomRange.value=state.value;
 ui.zoomRange.setAttribute('aria-valuetext',label(state.value));ui.cameraZoom.setAttribute('aria-busy',String(state.busy));
 ui.zoomPresets.replaceChildren();
 const presets=[...new Set([state.min,...[1,2,3,5].filter(value=>value>=state.min&&value<=state.max)])];
 for(const value of presets){const button=document.createElement('button');button.type='button';button.textContent=label(value);button.setAttribute('aria-label','相机变焦 '+label(value));button.setAttribute('aria-pressed',String(Math.abs(value-state.value)<Math.max(.01,state.step/2)));button.onclick=()=>cameraZoom.set(value);ui.zoomPresets.append(button);}
}
function resetMotionForZoom(){
 zoomQuietUntil=performance.now()+1000;motionDetector.reset();motionState=null;motionSince=null;drawTarget(null);
 if(armed&&departureAt!==null){
  tracker.startFromMotion([],recordingStart);lastMotionAt=performance.now();
  if(autoFinishReason!=='max_duration'){autoFinishAt=null;autoFinishReason='';}
 }
}
ui.zoomRange.oninput=()=>cameraZoom.set(Number(ui.zoomRange.value));
document.addEventListener('pointerdown',event=>{
 if(ui.cameraZoom.open&&!ui.cameraZoom.contains(event.target))ui.cameraZoom.open=false;
});
ui.cameraZoom.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&ui.cameraZoom.open){event.preventDefault();ui.cameraZoom.open=false;ui.zoomToggle.focus();}
});
const formatTime = (t) => Number.isFinite(t) ? Math.floor(t/60).toString().padStart(2,'0') + ':' + Math.floor(t%60).toString().padStart(2,'0') : '00:00';
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const reasons = {
 target_lost_after_receding:'目标远离并离开视野后，延时结束',
 visible_arc_finished:'根据目标运动变化，估计本次尝试结束',
 motion_finished:'画面恢复稳定后，延时结束本次录像',
 max_duration:'达到最长拍摄时间，已保留录像',
 manual:'手动结束拍摄', interrupted:'页面离开前台，录像已中断',
 waiting_timeout:'等待出发超时，未生成录像',
 track_ended:'摄像头中断，已保存可用录像'
};
function toast(message) { ui.toast.textContent=message; ui.toast.hidden=false; clearTimeout(toast.timer); toast.timer=setTimeout(()=>ui.toast.hidden=true,5000); }
function status(message,error=false) {ui.captureStatus.textContent=message; ui.statusDot.className='status-dot '+(error?'error':stream?'active':'');}
function goalText(){return '自动识别动作';}
function updateRecognizedAction(record){
 const recognized=record.analysis?.analysis?.recognizedAction;
 ui.clipTitle.textContent=recognized?.type||record.actionType||'待识别动作';
 ui.recognizedActionHint.textContent=recognized?recognized.description:'分析时自动识别动作，无需选择或输入。';
 ui.actionEvidenceList.replaceChildren();ui.actionEvidencePanel.hidden=!recognized?.features;
 if(recognized?.features){
  const labels={yes:'观察到',no:'未见相应表现',uncertain:'暂无法确认'};
  const show=(label,feature)=>{
   if(!feature)return;
   const row=appendText(ui.actionEvidenceList,'div','','recognition-evidence');
   appendText(row,'strong',label+'：'+(labels[feature.state]||'暂无法确认'));
   if(!feature.evidence?.length)appendText(row,'p','本项暂不作确定判断。');
   for(const evidence of feature.evidence||[]){
    appendText(row,'p',evidence.observation);
    const button=appendText(row,'button','回看 '+evidence.time.toFixed(2)+'s','time-link');button.type='button';button.onclick=()=>reviewAt(evidence.time);
   }
  };
  show('转体',recognized.features.rotation);show('抓板',recognized.features.grab);
  if(recognized.otherAction)show('其他动作',{state:'yes',evidence:recognized.otherAction.evidence});
 }
}
function setView(view) {
 if(view!=='review')comparison.pause();
 ui.captureView.hidden=view!=='capture'; ui.reviewView.hidden=view!=='review';
 ui.captureTab.classList.toggle('active',view==='capture'); ui.reviewTab.classList.toggle('active',view==='review');
 if(view==='review') renderHistory();
}
function updateModelHint() {
 ui.modelValidation.hidden=true;
 const selected=getModel(ui.modelSelect.value);
 ui.modelHint.textContent=(selected?.thinking?'此模型始终开启思考，可能需要更长时间。':'按模型支持的方式调用；优先使用非思考模式。')+' 当前发送视频画面，不发送音频。';
}
function populateModels() {
 const groups=new Map();ui.modelSelect.replaceChildren();
 for(const entry of VIDEO_MODELS){let group=groups.get(entry.group);if(!group){group=document.createElement('optgroup');group.label=entry.group;groups.set(entry.group,group);ui.modelSelect.append(group);}const option=document.createElement('option');option.value=entry.id;option.textContent=entry.id+(entry.id===DEFAULT_MODEL?' · 推荐':entry.thinking?' · 思考模式':'');group.append(option);}
 ui.modelCatalogInfo.textContent='已按提供的免费额度清单筛选 '+VIDEO_MODELS.length+' 个视频型号及版本 · '+CATALOG_DATE;
 ui.modelSelect.value=model;updateModelHint();
}
function showSettings() {ui.apiKeyInput.value=apiKey;ui.autoAnalyzeInput.checked=autoAnalyze;ui.modelSelect.value=model;updateModelHint();ui.settingsDialog.showModal();}
function renderSettingsStatus(){
 ui.analysisPrivacy.textContent=apiKey?'已连接百炼模型 · '+(settingsPersisted?'密钥已保存在本机':'密钥暂留本次页面')+(autoAnalyze?' · 已允许每跳自动分析':''):'仅将抽取画面发送到百炼模型；需要填写自己的 API Key。';
 ui.settingsSaveHint.textContent=settingsPersisted?'密钥、模型和自动分析设置会自动保存在此浏览器，下次打开自动恢复。':'本机存储不可用：当前设置仍可使用，但刷新后可能无法恢复。';
}
function saveSettings(patch){
 const result=settingsStore.update(patch);
 ({apiKey,autoAnalyze,model,persisted:settingsPersisted}=result);
 renderSettingsStatus();return result;
}
populateModels();
renderSettingsStatus();
ui.apiKeyInput.oninput=()=>{
 saveSettings({apiKey:ui.apiKeyInput.value});
 ui.autoAnalyzeInput.checked=autoAnalyze;
};
ui.modelSelect.onchange=()=>{updateModelHint();if(getModel(ui.modelSelect.value))saveSettings({model:ui.modelSelect.value});};
ui.autoAnalyzeInput.onchange=()=>{
 const value=ui.apiKeyInput.value.trim();
 if(ui.autoAnalyzeInput.checked&&!isValidApiKey(value)){ui.autoAnalyzeInput.checked=false;toast('开启自动分析前，请先填写完整的 API Key。');return;}
 saveSettings({apiKey:value,autoAnalyze:ui.autoAnalyzeInput.checked});
};
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
 ui.armBtn.hidden=false;ui.armBtn.disabled=busy||processing||finishing;ui.recordActions.hidden=!busy||!recorder;ui.importBtn.disabled=busy||processing||finishing;
 ui.reviewTab.disabled=busy||processing||finishing;
 ui.stopDetectionBtn.disabled=!stream&&!detectionActive;
 ui.openCameraBtn.disabled=processing;ui.closeCameraBtn.hidden=!stream||busy;
}
function keepAwake() {
 keepScreenAwake=true;
 if(document.hidden||wakeLock||wakeLockPending||!navigator.wakeLock)return Promise.resolve();
 const generation=wakeLockGeneration;
 const pending=Promise.resolve().then(async()=>{
  try{
   const lock=await navigator.wakeLock.request('screen');
   if(document.hidden||generation!==wakeLockGeneration){await lock.release().catch(()=>{});return;}
   wakeLock=lock;
   lock.addEventListener('release',()=>{
    if(wakeLock!==lock)return;wakeLock=null;
    if(keepScreenAwake&&!document.hidden)setTimeout(()=>{if(keepScreenAwake&&!document.hidden)keepAwake();},1000);
   });
  }catch{}
  finally{if(wakeLockPending===pending)wakeLockPending=null;}
 });
 wakeLockPending=pending;return pending;
}
function releaseAwake(){wakeLockGeneration++;wakeLockPending=null;const lock=wakeLock;wakeLock=null;if(lock)lock.release().catch(()=>{});}
function stopStream(value){value?.getTracks().forEach(track=>{track.onended=null;if(track.readyState!=='ended')track.stop();});}
function openCamera() {
 if(cameraOpenPromise)return cameraOpenPromise;
 if(stream)return Promise.resolve(stream);
 const generation=++cameraGeneration;
 let acquired=null;
 // Defer the body until the shared promise has been assigned, including when
 // feature checks fail synchronously before getUserMedia is reached.
 const operation=Promise.resolve().then(async()=>{
  try {
   if(!window.isSecureContext)throw new Error('拍摄需要 HTTPS 链接，请通过已发布的网站打开。');
   if(!navigator.mediaDevices?.getUserMedia)throw new Error('当前浏览器不支持网页拍摄，请用 Safari 打开，或导入已有视频。');
   if(document.hidden||generation!==cameraGeneration)throw new DOMException('相机准备已取消，请返回页面后重试。','AbortError');
   status('正在请求摄像头权限…');
   acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:60,max:60}}});
   if(document.hidden||generation!==cameraGeneration)throw new DOMException('相机准备已取消，请返回页面后重试。','AbortError');
   stream=acquired;
   ui.cameraVideo.srcObject=acquired;ui.cameraVideo.hidden=false;ui.cameraPlaceholder.hidden=true;ui.cameraStage.classList.add('live');
   await ui.cameraVideo.play();
   if(document.hidden||generation!==cameraGeneration||stream!==acquired)throw new DOMException('相机准备已取消，请返回页面后重试。','AbortError');
   const settings=acquired.getVideoTracks()[0].getSettings();
   cameraZoom.attach(acquired.getVideoTracks()[0]);
   ui.cameraQuality.textContent=(settings.width||'')+' × '+(settings.height||'')+' · '+Math.round(settings.frameRate||30)+' fps';
   ui.cameraBadge.innerHTML='<i></i> CAMERA READY';
   ui.cameraHint.textContent='相机已就绪 · 保持手机固定';status('相机已开启，准备后将自动等待出发');ui.closeCameraBtn.hidden=false;ui.stopDetectionBtn.disabled=false;
   acquired.getVideoTracks()[0].onended=()=>{if(stream!==acquired)return;if(armed)finishCapture('track_ended');else closeCamera();};
   return acquired;
  }catch(err){
   if(generation===cameraGeneration)closeCamera();
   if(acquired!==stream)stopStream(acquired);
   if(err.name==='NotAllowedError')throw new Error('摄像头权限未开启。请在 Safari 网站设置中允许相机，再重试。');
   if(err.name==='NotReadableError')throw new Error('摄像头暂时不可用，请关闭其他正在使用相机的应用。');
   throw err;
  }finally{if(cameraOpenPromise===operation)cameraOpenPromise=null;}
 });
 cameraOpenPromise=operation;return operation;
}
function closeCamera() {
 if(armed)return;
 cameraGeneration++;cameraOpenPromise=null;
 detectionActive=false;clearTimeout(inferenceTimer);
 if(stream){stopStream(stream);stream=null;}
 cameraZoom.attach(null);
 ui.cameraVideo.srcObject=null;ui.cameraVideo.hidden=true;ui.cameraPlaceholder.hidden=false;ui.cameraStage.classList.remove('live');
 ui.cameraBadge.innerHTML='<i></i> CAMERA OFF';ui.cameraBadge.classList.remove('recording');ui.closeCameraBtn.hidden=true;
 const ctx=ui.trackingCanvas.getContext('2d');ctx.clearRect(0,0,ui.trackingCanvas.width,ui.trackingCanvas.height);
 ui.stopDetectionBtn.disabled=true;status('摄像头已关闭');ui.cameraHint.textContent='准备好后，点击下方按钮';ui.recordClock.textContent='00:00';
}
async function createPersonDetector(delegate) {
 const {FilesetResolver,ObjectDetector}=await import(new URL('./vision/vision_bundle.mjs',import.meta.url).href);
 const fileset=await FilesetResolver.forVisionTasks(new URL('./vision/wasm',import.meta.url).href);
 return ObjectDetector.createFromOptions(fileset,{baseOptions:{modelAssetPath:new URL('./vision/model.tflite',import.meta.url).href,delegate},runningMode:'VIDEO',scoreThreshold:.38,maxResults:8,categoryAllowlist:['person']});
}
async function loadAnalysisDetector(){
 if(analysisDetector)return analysisDetector;
 if(!analysisDetectorPromise)analysisDetectorPromise=createPersonDetector('CPU').then(value=>{analysisDetector=value;return value;}).catch(error=>{analysisDetectorPromise=null;throw error;});
 return analysisDetectorPromise;
}
async function loadDetector() {
 if(detector)return detector;
 if(detectorPromise)return detectorPromise;
 detectorPromise=(async()=>{
  status('首次准备：正在加载本地人物检测资源…');
  try{detector=await createPersonDetector('GPU');}catch{detector=await createPersonDetector('CPU');}
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
function detectFrameChange(video) {
 motionContext.drawImage(video,0,0,motionCanvas.width,motionCanvas.height);
 const pixels=motionContext.getImageData(0,0,motionCanvas.width,motionCanvas.height).data;
 const gray=new Uint8Array(pixels.length/4);
 for(let i=0,j=0;i<pixels.length;i+=4,j++)gray[j]=(pixels[i]*77+pixels[i+1]*150+pixels[i+2]*29)>>8;
 const now=performance.now();
 motionState=motionDetector.update(gray,now,{learning:armed&&departureAt===null&&now-armedAt<2000});return motionState.moving;
}
function startMotionRecording(detections) {
 const mime=['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
 const options={videoBitsPerSecond:4500000};if(mime)options.mimeType=mime;
 const capture=new MediaRecorder(stream,options),captureChunks=[];let finalized=false;
 capture.ondataavailable=e=>{if(e.data.size)captureChunks.push(e.data);};
 capture.onerror=()=>{if(recorder===capture)finishCapture('track_ended');};
 capture.onstop=()=>{if(finalized||recorder!==capture)return;finalized=true;return finalizeRecording();};
 recorder=capture;chunks=captureChunks;recordingStart=performance.now();
 try{capture.start(1000);}catch(error){recorder=null;chunks=[];throw error;}
 departureAt=recordingStart;lastMotionAt=recordingStart;firstPersonAt=detections.length?recordingStart:null;autoFinishAt=null;autoFinishReason='';tracker.startFromMotion(detections,departureAt);
 setCaptureControls(true);ui.stopBtn.textContent='■ 结束并保存';
 ui.cameraBadge.innerHTML='<i></i> RECORDING';ui.cameraBadge.classList.add('recording');
 ui.cameraHint.textContent='正在录像 · 自动结束最短 6 秒';status('已检测到画面运动，开始录像');
}
async function armCapture() {
 if(armed||processing||finishing||analysisBusy)return;
 const clickedAt=performance.now();
 processing=true;ui.armBtn.disabled=true;ui.armLabel.textContent='正在准备…';setCaptureControls(false);
 try{
  await openCamera();
  if(document.hidden)throw new Error('请保持页面在前台，再点击准备。');
  if(!window.MediaRecorder)throw new Error('当前浏览器不支持录像，请使用较新的 Safari 或导入已有视频。');
  recorder=null;chunks=[];departureAt=null;recordingStart=0;armedAt=clickedAt;discardCapture=false;finishing=false;pendingReason='';
  armed=true;detectionActive=true;autoFinishAt=null;firstPersonAt=null;clearTimeout(inferenceTimer);tracker.reset();motionDetector.reset();motionState=null;motionSince=null;lastMotionAt=null;setCaptureControls(true);keepAwake();
  // Person detection helps follow the attempt, but must not block motion start.
  loadDetector().catch(()=>{if(armed)status('画面变化检测已就绪 · 人物跟踪暂不可用');});
  ui.stopBtn.textContent='停止侦测';ui.recordClock.textContent='侦测中';
  ui.cameraBadge.innerHTML='<i></i> DETECTING';ui.cameraHint.textContent='正在侦测 · 尚未录像';status('正在侦测画面变化，检测到出发后才开始录像');
  armTimer=setInterval(()=>{
   const now=performance.now();ui.recordClock.textContent=departureAt!==null?formatTime((now-recordingStart)/1000):'侦测中';
   if(departureAt!==null&&now-recordingStart>=MAX_RECORDING_MS)queueAutoFinish('max_duration',now);
   if(autoFinishAt!==null&&now>=autoFinishAt)finishCapture(autoFinishReason);
  },200);
  detectLoop();
 }catch(err){status(err.message,true);toast(err.message);}
 finally{processing=false;ui.armBtn.disabled=false;ui.armLabel.textContent='开始探测';setCaptureControls(armed);}
}
function queueAutoFinish(reason,now){
 if(autoFinishAt!==null)return;autoFinishReason=reason;autoFinishAt=Math.max(recordingStart+MIN_RECORDING_MS,now+END_TAIL_MS);
 ui.cameraHint.textContent='正在保留结束后的气垫画面';
}
function detectLoop() {
 if(!detectionActive||!stream)return;
 const started=performance.now();
 try{
  const video=ui.cameraVideo;
  const zoomSettling=cameraZoom.state.busy||performance.now()<zoomQuietUntil;
  if(zoomSettling&&armed&&departureAt===null)ui.cameraHint.textContent='正在变焦，等待画面稳定 · 尚未录像';
  if(video.readyState>=2&&video.videoWidth&&!zoomSettling){
   const now=performance.now(),changed=detectFrameChange(video);
   // Starting is deliberately sensitive; completion ignores tiny pixel noise.
   const completionMotion=motionState?.completionMoving??(motionState?.changedRatio>=.002);
   if(completionMotion){
    lastMotionAt=now;
    if(autoFinishReason==='motion_finished'){autoFinishAt=null;autoFinishReason='';ui.cameraHint.textContent='正在录像 · 自动结束最短 6 秒';}
   }
   let detections=[];
   if(detector&&!analysisBusy&&!finishing){try{
    const result=detector.detectForVideo(video,now);
    detections=(result.detections||[]).map(d=>({x:d.boundingBox.originX/video.videoWidth,y:d.boundingBox.originY/video.videoHeight,w:d.boundingBox.width/video.videoWidth,h:d.boundingBox.height/video.videoHeight,score:d.categories[0]?.score||0}));
   }catch{/* Motion detection continues if person inference fails. */}}
   if(armed&&departureAt===null){
    const warmingUp=now-armedAt<2000;
    ui.cameraHint.textContent=warmingUp?'准备中 · 前 2 秒不触发录像':'正在侦测中央画面 · 等待持续运动';
    if(!warmingUp&&changed){
     if(motionSince===null)motionSince=now;
     if(now-motionSince>=350){
      try{startMotionRecording(detections);}catch(error){finishCapture('track_ended',true);toast('未能开始录像：'+error.message);return;}
     }
    }else motionSince=null;
   }
   if(armed&&departureAt!==null&&firstPersonAt===null&&detections.length)firstPersonAt=now;
   const info=armed&&departureAt!==null?tracker.update(detections,now):{state:'waiting',target:detections.sort((a,b)=>b.w*b.h*b.score-a.w*a.h*a.score)[0]||null};
   drawTarget(info.target);
   if(armed&&info.state==='complete'&&now-recordingStart>=MIN_RECORDING_MS)queueAutoFinish(info.reason,now);
   if(armed&&departureAt!==null&&lastMotionAt!==null&&now-lastMotionAt>=1000)queueAutoFinish('motion_finished',now);
  }
 }catch{status('跟踪暂时中断，录像继续；可手动结束',true);}
 inferenceTimer=setTimeout(detectLoop,Math.max(40,180-(performance.now()-started)));
}
function finishCapture(reason='manual',discard=false) {
 if(!armed||finishing)return;
 const waiting=recorder===null;
 if(reason==='interrupted'||reason==='track_ended'||(reason==='manual'&&waiting))detectionActive=false;
 finishing=true;armed=false;pendingReason=reason;discardCapture=discard;autoFinishAt=null;
 clearInterval(armTimer);clearTimeout(inferenceTimer);if(detectionActive)inferenceTimer=setTimeout(detectLoop,180);setCaptureControls(false);
 ui.armBtn.disabled=true;ui.armLabel.textContent='正在保存…';
 status(discard?'正在取消本次…':'正在保存这一跳…');
 if(recorder){if(recorder.state!=='inactive')recorder.stop();}else finalizeRecording();
}
async function getVideoMetadata(blob) {
 const reader=await openVideoReader(blob,{readyState:1});
 try{
  const video=reader.video;let duration=video.duration;
  if(!Number.isFinite(duration)){try{video.currentTime=1e10;await sleep(250);duration=video.duration;}catch{} }
  if(!Number.isFinite(duration)&&video.seekable.length)duration=video.seekable.end(video.seekable.length-1);
  return {duration,width:video.videoWidth,height:video.videoHeight};
 }finally{reader.dispose();}
}
async function seekVideo(video,time,signal){return seekVideoFrame(video,time,{signal});}
async function getPoster(blob,time=0) {
 let reader;
 try{reader=await openVideoReader(blob);const v=reader.video;await seekVideo(v,Math.max(.01,time));
 const c=document.createElement('canvas'),scale=Math.min(1,240/Math.max(v.videoWidth,v.videoHeight));c.width=Math.max(1,Math.round(v.videoWidth*scale));c.height=Math.max(1,Math.round(v.videoHeight*scale));c.getContext('2d').drawImage(v,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.65);
 }catch{return '';}finally{reader?.dispose();}
}
async function finalizeRecording() {
 const didRecord=!!recorder;
 const mime=recorder?.mimeType||'video/mp4',blob=new Blob(chunks,{type:mime});chunks=[];
 const elapsed=didRecord?(performance.now()-recordingStart)/1000:0;
 const departedOffset=firstPersonAt===null?0:Math.max(0,(firstPersonAt-recordingStart)/1000-.25);
 const detectedAction=goalText();const shouldAnalyze=autoAnalyze&&!!apiKey&&!!departureAt&&pendingReason!=='interrupted';
 if(!detectionActive)closeCamera();
 if(!document.hidden)keepAwake();
 try{
  if(!didRecord){status(pendingReason==='waiting_timeout'?reasons.waiting_timeout:'已停止侦测，未生成录像');return;}
  if(discardCapture||blob.size<100){status('已取消，准备好后可以重新拍摄');return;}
  let meta;try{meta=await getVideoMetadata(blob);}catch{meta={duration:elapsed,width:0,height:0};}
  if(!Number.isFinite(meta.duration)||meta.duration<=0)meta.duration=elapsed;
  const clip={id:crypto.randomUUID(),createdAt:Date.now(),source:'camera',name:'现场拍摄',blob,duration:meta.duration,width:meta.width,height:meta.height,action:detectedAction,actionMode:'auto',actionType:'待识别动作',actionDetail:'',focus:'',contentStart:departedOffset,contentStartConfirmed:firstPersonAt!==null,trimStart:Math.max(0,Math.min(departedOffset,meta.duration-.5)),trimEnd:meta.duration,reason:pendingReason,note:reasons[pendingReason]||'自动检测结束',poster:'',analysis:null};
  clip.poster=await getPoster(blob,clip.trimStart+.1);records.unshift(clip);await persistRecord(clip);await selectRecord(clip,{internal:true});setView('review');window.scrollTo({top:0,behavior:'smooth'});
  if(shouldAnalyze)setTimeout(()=>{if(current===clip)analyzeCurrent();},0);else if(autoAnalyze&&!apiKey)toast('录像已保存。请在设置中填写百炼模型 Key 后分析。');
 }catch(err){toast('录像处理失败：'+err.message);}
 finally{finishing=false;recorder=null;ui.armBtn.disabled=false;ui.armLabel.textContent='准备下一跳';setCaptureControls(false);if(detectionActive){ui.cameraBadge.innerHTML='<i></i> DETECTING';ui.cameraBadge.classList.remove('recording');ui.cameraHint.textContent='侦测继续开启 · 点击准备下一跳可录像';ui.recordClock.textContent='侦测中';status('本跳已结束，侦测继续开启；点击准备下一跳可再次录像');}}
}
async function importVideo(file) {
 if(!file)return;
 if(armed||processing||finishing||analysisBusy){toast('请先结束当前拍摄或分析。');return;}
 if(file.size>500*1024*1024){toast('请先选择较短的一跳视频，文件需小于 500 MB。');return;}
 processing=true;ui.importBtn.disabled=true;toast('正在读取视频…');
 try {
  const meta=await getVideoMetadata(file);
  if(!Number.isFinite(meta.duration)||meta.duration<=0)throw new Error('未能读取视频时长，请换成 MP4 后重试。');
  const clip={id:crypto.randomUUID(),createdAt:Date.now(),source:'import',name:file.name,blob:file,duration:meta.duration,width:meta.width,height:meta.height,action:goalText(),actionMode:'auto',actionType:'待识别动作',actionDetail:'',focus:'',trimStart:0,trimEnd:Math.min(meta.duration,60),reason:'import',note:'导入的原始视频',poster:'',analysis:null};
  clip.poster=await getPoster(file,.1);records.unshift(clip);await persistRecord(clip);await selectRecord(clip,{internal:true});setView('review');window.scrollTo({top:0,behavior:'smooth'});
  toast(meta.duration>60?'视频已导入。请先选择其中一跳，最长 60 秒。':'视频已导入，分析时会自动识别动作。');
 }catch(err){toast(err.message);}finally{processing=false;ui.importBtn.disabled=false;ui.fileInput.value='';}
}
async function selectRecord(record,{internal=false}={}) {
 if(armed||(!internal&&(processing||finishing))){toast('请先完成当前拍摄或保存。');return;}
 if(analysisBusy){toast('请先等待或取消当前分析，再切换视频。');return;}
 comparison.close();current=record;if(currentUrl)URL.revokeObjectURL(currentUrl);currentUrl=URL.createObjectURL(record.blob);
 ui.reviewVideo.src=currentUrl;setReviewSpeed(1);ui.reviewVideo.loop=false;
 ui.reviewVideo.onloadedmetadata=()=>{ui.reviewVideo.currentTime=record.trimStart;};
 ui.reviewEmpty.hidden=true;ui.reviewContent.hidden=false;
 updateRecognizedAction(record);ui.clipSource.textContent=(record.source==='camera'?'现场拍摄':'本地导入')+' / '+new Date(record.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
 ui.clipMeta.textContent=record.duration.toFixed(1)+' 秒 · '+(record.width?record.width+' × '+record.height+' · ':'')+record.note+(record.persisted?' · 已保存在本机':' · 暂留当前页面');
 ui.trimStart.max=record.duration;ui.trimEnd.max=record.duration;ui.trimStart.value=record.trimStart.toFixed(1);ui.trimEnd.value=record.trimEnd.toFixed(1);
 ui.trimLabel.textContent=record.trimStart.toFixed(1)+'–'+record.trimEnd.toFixed(1)+' 秒';
 ui.analyzeBtn.disabled=false;ui.analysisProgress.hidden=true;ui.analysisError.hidden=true;ui.analysisIdle.hidden=!!record.analysis;
 updateVideoSaveControls();renderAnalysis();renderHistory();ui.reviewCount.textContent=String(records.length);
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
 if(!current||comparison.active)return;
 if(!ui.reviewVideo.paused&&ui.reviewVideo.currentTime>=current.trimEnd-.05){
  if(loopEnabled){ui.reviewVideo.currentTime=current.trimStart;if(!ui.reviewVideo.paused)ui.reviewVideo.play().catch(()=>{});}
  else ui.reviewVideo.pause();
 }
});
ui.reviewVideo.addEventListener('ended',()=>{if(current&&!comparison.active&&loopEnabled){ui.reviewVideo.currentTime=current.trimStart;ui.reviewVideo.play().catch(()=>{});}});
function reviewAt(time){comparison.close();ui.reviewVideo.currentTime=current.trimStart+Math.min(Math.max(time,0),current.trimEnd-current.trimStart);ui.reviewVideo.pause();}
function appendText(parent,tag,text,className=''){const el=document.createElement(tag);el.textContent=typeof text==='string'?text:JSON.stringify(text);if(className)el.className=className;parent.append(el);return el;}
function renderAnalysis() {
 comparison.render(current,records);
 const result=ui.analysisResult;result.replaceChildren();
 const data=current?.analysis;result.hidden=!data;ui.analysisIdle.hidden=!!data;ui.exportReportBtn.disabled=!data;
 ui.analyzeBtn.textContent=data?'重新分析这一跳 ↗':'分析这一跳 ↗';
 if(!data)return;
 const a=data.analysis;
 if([2,3,4,5,6].includes(a?.schemaVersion)&&a.nextJump){
  if([3,4,5,6].includes(a.schemaVersion)&&Array.isArray(a.stages)){
   for(const stage of a.stages){
    const row=document.createElement('div');row.className='observation';const head=document.createElement('div');head.className='observation-head';
    appendText(head,'strong',stage.phase);
    const t=stage.time;if(typeof t==='number'&&Number.isFinite(t)){const button=appendText(head,'button','回看 '+t.toFixed(2)+'s','time-link');button.onclick=()=>reviewAt(t);}
    row.append(head);appendText(row,'p',stage.analysis);result.append(row);
   }
  }
  const prior=current.trainingContext?.previousFocus;
  const followUpLabels={done:'已做到',partial:'部分做到',not_yet:'尚未做到',uncertain:'暂时无法判断'};
  if(a.focusRelation==='different')appendText(result,'p','本跳动作类型已变化，已重新选择训练重点。','action-change-note');
  if(prior&&a.focusRelation!=='different'&&a.followUp&&followUpLabels[a.followUp.status]){
   const panel=document.createElement('section');panel.className='followup-card';
   appendText(panel,'small','上次训练重点');appendText(panel,'p',prior.instruction,'followup-goal');
   appendText(panel,'p','检查标准：'+prior.check,'followup-check');
   appendText(panel,'strong','这一跳：'+followUpLabels[a.followUp.status],'followup-status '+a.followUp.status);
   appendText(panel,'p',a.followUp.observation);
   const t=a.followUp.time;
   if(typeof t==='number'&&Number.isFinite(t)){const button=appendText(panel,'button','回看 '+t.toFixed(2)+'s','time-link');button.onclick=()=>reviewAt(t);}
   result.append(panel);
  }
  appendText(result,'h3','总体分析');
  const next=a.nextJump,box=document.createElement('div');box.className='focus-box';
  appendText(box,'small','下一跳，只做这一件事');appendText(box,'p',next.instruction);result.append(box);
  appendText(result,'p',next.reason);
  const t=next.time;if(typeof t==='number'&&Number.isFinite(t)){const button=appendText(result,'button','回看 '+t.toFixed(2)+'s','time-link');button.onclick=()=>reviewAt(t);}
  appendText(result,'p','回来检查：'+next.check);
 }else{
  appendText(result,'p','这是一份旧版报告，重新分析即可生成下一跳的单点建议。');
 }
 if(current.keyframes?.length){const strip=document.createElement('div');strip.className='keyframes';for(const frame of current.keyframes){const btn=document.createElement('button');btn.className='keyframe';const img=document.createElement('img');img.src=frame.dataUrl;img.alt=frame.time.toFixed(1)+'秒画面';appendText(btn,'span',frame.time.toFixed(1)+'s');btn.prepend(img);btn.onclick=()=>reviewAt(frame.time);strip.append(btn);}result.append(strip);}
 const u=data.usage||{};appendText(result,'div',data.model+(data.frameCount?' · '+data.frameCount+' 张画面':'')+'\n'+(u.total_tokens?u.total_tokens.toLocaleString()+' Token · ':'')+(Number.isFinite(data.estimatedCostCny)?'标价估算 ¥'+data.estimatedCostCny.toFixed(4)+'（免费额度抵扣前）':'未配置此模型单价，费用以百炼账单为准'),'usage');
}
async function prepareAnalysisDetector(signal) {
 let model=analysisDetector;
 if(!model){
  let timer,onAbort;
  try{
   if(signal.aborted)throw new DOMException('Aborted','AbortError');
   model=await Promise.race([loadAnalysisDetector(),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),8000);}),new Promise((_,reject)=>{onAbort=()=>reject(new DOMException('Aborted','AbortError'));signal.addEventListener('abort',onAbort,{once:true});})]);
  }catch(error){if(error.name==='AbortError')throw error;return null;}
  finally{clearTimeout(timer);if(onAbort)signal.removeEventListener('abort',onAbort);}
 }
 return model||null;
}
async function findContentStart(video,start,end,signal,model=analysisDetector) {
 if(!model)return null;
 const hasPerson=async time=>{
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  await seekVideo(video,time,signal);
  try{return (model.detectForVideo(video,performance.now()).detections||[]).some(item=>(item.categories?.[0]?.score||0)>=.38);}catch{return null;}
 };
 for(let time=start;time<end-.15;time+=1){
  ui.progressDetail.textContent='正在定位有效动作起点 '+(time-start).toFixed(1)+' 秒';
  const found=await hasPerson(time);
  if(found===null)return null;
  if(found){
   let first=time;
   for(let t=Math.max(start,time-1);t<time;t+=.25){if(await hasPerson(t)){first=t;break;}}
   return Math.max(start,first-.25);
  }
 }
 return start;
}
async function extractFrames(record,signal) {
 let start=record.trimStart;const end=record.trimEnd;let duration=end-start;
 if(duration<0.5||duration>60)throw new Error('请选择 0.5 至 60 秒的片段。');
 const reader=await openVideoReader(record.blob,{signal}),v=reader.video;
 try {
  const localDetector=await prepareAnalysisDetector(signal);
  if(!record.contentStartConfirmed){
   const contentStart=await findContentStart(v,start,end,signal,localDetector);
   if(typeof contentStart==='number'&&contentStart>start+.05&&end-contentStart>=.5){
    start=contentStart;duration=end-start;record.trimStart=start;record.contentStart=start;
    ui.trimStart.value=start.toFixed(1);ui.trimLabel.textContent=start.toFixed(1)+'–'+end.toFixed(1)+' 秒';
   }
   record.contentStartConfirmed=typeof contentStart==='number';
  }
  return await prepareAnalysisFrames(v,{start,end,signal,seek:seekVideo,maxBodyBytes:MAX_BODY_BYTES,maxFrameBytes:MAX_FRAME_BYTES,
   detectPersons:localDetector?video=>{
    const result=localDetector.detectForVideo(video,performance.now());
    return (result.detections||[]).map(d=>({x:d.boundingBox.originX/video.videoWidth,y:d.boundingBox.originY/video.videoHeight,w:d.boundingBox.width/video.videoWidth,h:d.boundingBox.height/video.videoHeight,score:d.categories[0]?.score||0}));
   }:undefined,
   onProgress:({phase,completed,total})=>{
    const labels={scout:'正在定位重点区间',locate:'正在定位人物范围',encode:'正在抽取与裁剪画面'};
    ui.progressTitle.textContent=labels[phase];ui.progressDetail.textContent=completed+' / '+total+' · 在本机处理，原片不上传。';
    const ranges={scout:[0,15],locate:[15,20],encode:[35,20]},[base,span]=ranges[phase];ui.analysisMeter.value=Math.round(base+span*completed/total);
   }});
 }finally{reader.dispose();}
}
async function analyzeCurrent() {
 if(!current||analysisBusy||armed||processing||finishing){if(armed||processing||finishing)toast('请先结束拍摄并等待保存完成。');return;}
 if(!apiKey){showSettings();toast('先填写自己的百炼模型 Key，再点击分析。');return;}
 if(!autoAnalyze){const yes=confirm('本次将把抽取画面直接发送至阿里云百炼模型，并产生 API 费用。是否继续？');if(!yes)return;}
 const record=current,run=++analysisRun;analysisController=new AbortController();analysisBusy=true;
 comparison.close();ui.compareSection.hidden=true;
 const trainingContext=getTrainingContext({...record,actionMode:'auto'},records);
 const beforeExtraction={trimStart:record.trimStart,trimEnd:record.trimEnd,contentStart:record.contentStart,contentStartConfirmed:record.contentStartConfirmed};
 ui.analysisProgress.hidden=false;ui.analysisIdle.hidden=true;ui.analysisResult.hidden=true;ui.analysisError.hidden=true;ui.analyzeBtn.hidden=true;ui.analysisMeter.value=0;ui.progressTitle.textContent='正在准备画面';ui.armBtn.disabled=true;ui.importBtn.disabled=true;ui.nextJumpBtn.disabled=true;ui.deleteClipBtn.disabled=true;ui.applyTrimBtn.disabled=true;
 let timer=null;
 try {
  const prepared=await extractFrames(record,analysisController.signal),frames=prepared.frames;
  ui.progressTitle.textContent='正在识别动作并复盘';ui.progressDetail.textContent='自动识别动作，分析助滑、起跳与腾空。可先慢放回看。';ui.analysisMeter.value=65;
  const data=await analyzeFrames({apiKey,model,frames,samplingMetadata:prepared.samplingMetadata,actionMode:'auto',duration:record.trimEnd-record.trimStart,previousFocus:trainingContext.previousFocus},{signal:analysisController.signal});
  data.preparation=prepared.preparation;
  if(run!==analysisRun)return;
  data.trainingGoalKey=trainingContext.goalKey;record.trainingContext=trainingContext;record.analysis=data;record.actionMode='auto';record.actionType=data.analysis.recognizedAction?.type||'无法判断';record.action=record.actionType;record.actionDetail='';record.focus='';record.keyframes=Array.from({length:Math.min(8,frames.length)},(_,i)=>frames[Math.round(i*(frames.length-1)/(Math.min(8,frames.length)-1))]);await persistRecord(record);
  ui.analysisMeter.value=100;updateRecognizedAction(record);renderAnalysis();renderHistory();toast('这一跳的分析已完成。');
 }catch(err){
  if(run===analysisRun){Object.assign(record,beforeExtraction);ui.trimStart.value=record.trimStart.toFixed(1);ui.trimEnd.value=record.trimEnd.toFixed(1);ui.trimLabel.textContent=record.trimStart.toFixed(1)+'–'+record.trimEnd.toFixed(1)+' 秒';ui.analysisError.hidden=false;ui.analysisError.textContent=err.name==='AbortError'?'分析已取消或请求超时，视频仍保存在本机。':err.message;ui.analysisIdle.hidden=!!record.analysis;if(record.analysis)renderAnalysis();}
 }finally{
  clearTimeout(timer);if(run===analysisRun){analysisBusy=false;analysisController=null;ui.analysisProgress.hidden=true;ui.analyzeBtn.hidden=false;ui.armBtn.disabled=false;ui.importBtn.disabled=false;ui.nextJumpBtn.disabled=false;ui.deleteClipBtn.disabled=false;ui.applyTrimBtn.disabled=false;comparison.render(record,records);}
 }
}
function download(blob,name){const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=name;a.rel='noopener';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),300000);}
function updateVideoSaveControls(){
 let available=false;try{available=!!current&&canShareVideo(makeVideoFile(current));}catch{}
 ui.shareVideoBtn.disabled=!available;
 ui.videoSaveHint.textContent=available?'在系统菜单中点击“存储视频”，即可保存到 iPhone 相册。':'请用支持系统视频保存的 iPhone Safari 打开。';
}
ui.openCameraBtn.onclick=()=>openCamera().catch(err=>{toast(err.message);status(err.message,true);});
ui.closeCameraBtn.onclick=closeCamera;ui.armBtn.onclick=armCapture;ui.stopBtn.onclick=()=>finishCapture('manual');
ui.cancelBtn.onclick=()=>finishCapture('manual',true);
ui.stopDetectionBtn.onclick=()=>{detectionActive=false;if(armed){finishCapture('manual');}else{clearTimeout(inferenceTimer);closeCamera();status('探测已结束');}};
ui.importBtn.onclick=ui.emptyImportBtn.onclick=()=>ui.fileInput.click();
ui.fileInput.onchange=()=>importVideo(ui.fileInput.files[0]);
ui.captureTab.onclick=()=>setView('capture');ui.reviewTab.onclick=()=>setView('review');
ui.settingsBtn.onclick=showSettings;ui.howBtn.onclick=()=>ui.helpDialog.showModal();
document.querySelectorAll('[data-close]').forEach(btn=>btn.onclick=()=>$(btn.dataset.close).close());
ui.settingsForm.onsubmit=e=>{
 e.preventDefault();const value=ui.apiKeyInput.value.trim();
 if(value&&!isValidApiKey(value)){toast('请填写完整的百炼 API Key。');return;}
 if(ui.autoAnalyzeInput.checked&&!value){toast('开启自动分析前，请先填写 API Key。');return;}
 const selectedModel=ui.modelSelect.value;
 if(!getModel(selectedModel)){ui.modelValidation.textContent='请选择免费额度清单中筛选出的视频理解模型。';ui.modelValidation.hidden=false;return;}
 saveSettings({apiKey:value,autoAnalyze:ui.autoAnalyzeInput.checked,model:selectedModel});ui.apiKeyInput.value='';ui.settingsDialog.close();
 toast(settingsPersisted?(apiKey?'设置已自动保存在本机。':'本地回放模式，无需百炼模型 Key。'):'本机存储不可用，设置暂留当前页面。');
};
ui.clearKeyBtn.onclick=()=>{saveSettings({apiKey:''});ui.apiKeyInput.value='';ui.autoAnalyzeInput.checked=false;toast(settingsPersisted?'密钥已从本机清除，自动分析已关闭。':'当前页面密钥已清除，自动分析已关闭；本机存储不可用，请清理网站数据以确保旧密钥删除。');};
function setReviewSpeed(speed){
 ui.reviewVideo.playbackRate=speed;comparison.setPlaybackRate(speed);
 document.querySelectorAll('[data-speed]').forEach(button=>{const selected=Number(button.dataset.speed)===speed;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});
}
document.querySelectorAll('[data-speed]').forEach(btn=>btn.onclick=()=>setReviewSpeed(Number(btn.dataset.speed)));
function stepFrame(delta){if(!current)return;comparison.pause();ui.reviewVideo.pause();ui.reviewVideo.currentTime=Math.min(current.trimEnd-.01,Math.max(current.trimStart,ui.reviewVideo.currentTime+delta/60));}
ui.prevFrameBtn.onclick=()=>stepFrame(-1);ui.nextFrameBtn.onclick=()=>stepFrame(1);
ui.loopBtn.onclick=()=>{loopEnabled=!loopEnabled;ui.loopBtn.setAttribute('aria-pressed',String(loopEnabled));ui.loopBtn.classList.toggle('selected',loopEnabled);};ui.loopBtn.classList.add('selected');
ui.nextJumpBtn.onclick=()=>{setView('capture');window.scrollTo({top:0,behavior:'smooth'});};
ui.analyzeBtn.onclick=analyzeCurrent;ui.cancelAnalysisBtn.onclick=()=>analysisController?.abort();
ui.applyTrimBtn.onclick=async()=>{
 if(!current||analysisBusy)return;
 const start=Number(ui.trimStart.value),end=Number(ui.trimEnd.value);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>current.duration||end-start<0.5||end-start>60){toast('请选择有效片段，时长为 0.5 至 60 秒。');return;}
 current.trimStart=start;current.trimEnd=Math.min(end,current.duration);current.analysis=null;current.keyframes=[];
 if(current.actionMode==='auto'){current.actionType='待识别动作';current.action='自动识别动作';}
 await persistRecord(current);await selectRecord(current);toast('分析片段已更新。');
};
ui.shareVideoBtn.onclick=async()=>{
 if(!current)return;
 try{
  const file=makeVideoFile(current);
  if(!canShareVideo(file)){toast('请在 iPhone Safari 中打开，再选择存储视频。');return;}
  await navigator.share({files:[file],title:'跃练视频'});
 }catch(error){
  if(error.name==='AbortError')toast('已取消保存，视频仍保留在浏览器。');
  else toast('未能打开系统保存菜单，请重试；视频仍保留在浏览器。');
 }
};
ui.exportReportBtn.onclick=()=>{if(!current?.analysis)return;download(new Blob([JSON.stringify({createdAt:new Date(current.createdAt).toISOString(),action:current.action,range:{start:current.trimStart,end:current.trimEnd},...current.analysis,trainingContext:current.trainingContext||null},null,2)],{type:'application/json'}),'跃练-动作分析.json');};
ui.deleteClipBtn.onclick=async()=>{
 if(!current||analysisBusy)return;if(!confirm('删除这一跳在当前浏览器中的视频和分析？'))return;
 comparison.close();const id=current.id;try{await dbOp('readwrite',s=>s.delete(id));}catch{toast('本地存储不可用，已清除当前页面中的记录。');}
 records=records.filter(r=>r.id!==id);current=null;if(currentUrl){URL.revokeObjectURL(currentUrl);currentUrl=null;}ui.reviewVideo.removeAttribute('src');ui.reviewVideo.load();
 if(records.length)await selectRecord(records[0]);else{ui.reviewContent.hidden=true;ui.reviewEmpty.hidden=false;ui.reviewCount.textContent='0';}
 renderHistory();
};
document.addEventListener('visibilitychange',()=>{if(document.hidden){comparison.pause();releaseAwake();detectionActive=false;if(armed)finishCapture('interrupted');else closeCamera();}else if(keepScreenAwake)keepAwake();});
window.addEventListener('pagehide',()=>{comparison.close();releaseAwake();detectionActive=false;if(armed)finishCapture('interrupted');if(stream&&!armed)closeCamera();});
window.addEventListener('pageshow',()=>{if(keepScreenAwake&&!document.hidden)keepAwake();});
window.addEventListener('beforeunload',event=>{if(armed||analysisBusy){event.preventDefault();event.returnValue='';}});
window.addEventListener('unhandledrejection',event=>{console.warn('An operation could not complete.');});
initializeHistory();
