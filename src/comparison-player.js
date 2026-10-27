import {findComparisonRecord,getComparisonSegments} from './jump-comparison.js?v=0.11.0';

/** Owns only comparison playback; the main player remains usable when closed. */
export class ComparisonPlayer {
 constructor({elements,createElement=tag=>elements.compareStages.ownerDocument.createElement(tag),createObjectURL=blob=>URL.createObjectURL(blob),revokeObjectURL=url=>URL.revokeObjectURL(url),setTimer=(...args)=>setTimeout(...args),clearTimer=id=>clearTimeout(id)}){
  this.ui=elements;this.createElement=createElement;this.createObjectURL=createObjectURL;this.revokeObjectURL=revokeObjectURL;this.setTimer=setTimer;this.clearTimer=clearTimer;
  this.active=false;this.generation=0;this.preparation=null;this.ready=false;this.url=null;this.current=null;this.previous=null;this.segment=null;this.playing=false;this.pairedPlayback=false;
  if(elements.compareToggleBtn)elements.compareToggleBtn.onclick=()=>this.active?this.close():this.open();
  elements.comparePlaybackBtn.onclick=()=>this.togglePlayback();
  for(const video of [elements.reviewVideo,elements.comparePreviousVideo]){
   video.addEventListener('timeupdate',()=>this.boundPlayback(video));
   video.addEventListener('ended',()=>this.boundPlayback(video,true));
   video.addEventListener('play',()=>this.updatePlaybackLabel());
   video.addEventListener('pause',()=>this.updatePlaybackLabel());
  }
 }
 render(current,records){
  this.close();this.current=current;this.previous=findComparisonRecord(current,records);this.segments=this.previous?getComparisonSegments(current,this.previous):[];
  const ui=this.ui;ui.compareSection.hidden=!current;if(ui.compareToggleBtn)ui.compareToggleBtn.disabled=!this.previous||!this.segments.length;
  this.readyHint=this.previous?'已找到最近一跳同类动作，可并排回看。':'完成两跳同类动作的分析后，即可在这里对比；旧视频可重新分析。';
  ui.compareHint.textContent=this.readyHint;
 }
 clearPreparation(){
  const operation=this.preparation;if(!operation)return;
  this.clearTimer(operation.timer);
  for(const [video,event,listener] of operation.listeners)video.removeEventListener(event,listener);
  this.preparation=null;
 }
 pause(){
  if(!this.active)return;
  this.generation++;this.clearPreparation();this.ready=false;this.playing=false;this.pairedPlayback=false;
  this.ui.reviewVideo.pause();this.ui.comparePreviousVideo.pause();this.updatePlaybackLabel();
 }
 close(){
  if(this.active)this.pause();else{this.generation++;this.clearPreparation();}
  this.active=false;this.segment=null;this.ready=false;this.playing=false;this.pairedPlayback=false;
  const ui=this.ui;
  ui.compareControls.hidden=true;ui.comparePrevious.hidden=true;ui.compareCurrentLabel.hidden=true;
  ui.comparisonPlayers.classList.toggle('comparing',false);if(ui.compareToggleBtn){ui.compareToggleBtn.textContent='对比上一跳';ui.compareToggleBtn.setAttribute('aria-expanded','false');}
  ui.compareStages.replaceChildren();ui.compareCue.hidden=true;ui.compareCue.textContent='';
  if(ui.loopBtn)ui.loopBtn.disabled=false;
  if(this.url){ui.comparePreviousVideo.removeAttribute('src');ui.comparePreviousVideo.load();this.revokeObjectURL(this.url);this.url=null;}
  if(this.readyHint)ui.compareHint.textContent=this.readyHint;
 }
 open(){
  if(this.active||!this.previous||!this.segments?.length)return;
  const ui=this.ui;
  try{this.url=this.createObjectURL(this.previous.blob);}catch{ui.compareHint.textContent='未能打开上一跳视频，请重新选择本跳后重试。';return;}
  this.active=true;ui.reviewVideo.pause();ui.comparePreviousVideo.src=this.url;this.setPlaybackRate(ui.reviewVideo.playbackRate||1);
  ui.compareControls.hidden=false;ui.comparePrevious.hidden=false;ui.compareCurrentLabel.hidden=false;
  ui.comparisonPlayers.classList.toggle('comparing',true);if(ui.compareToggleBtn){ui.compareToggleBtn.textContent='收起对比';ui.compareToggleBtn.setAttribute('aria-expanded','true');}
  if(ui.loopBtn)ui.loopBtn.disabled=true;
  const type=this.previous.analysis.analysis.recognizedAction.type;
  ui.comparePreviousLabel.textContent='上一跳同类 · '+type+' · '+new Date(this.previous.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  ui.compareCurrentLabel.textContent='这一跳';
  const prior=this.current.trainingContext?.previousFocus;
  ui.compareCue.hidden=prior?.sourceId!==this.previous.id;
  ui.compareCue.textContent=ui.compareCue.hidden?'':'上次训练重点：'+prior.instruction;
  for(const segment of this.segments){
   const button=this.createElement('button');button.type='button';button.className='comparison-stage';button.textContent=segment.label;button.dataset.segment=segment.id;
   button.onclick=()=>this.selectSegment(segment);ui.compareStages.append(button);
  }
  this.selectSegment(this.segments[0]);
 }
 setPlaybackRate(rate){if(Number.isFinite(rate)&&rate>0)this.ui.comparePreviousVideo.playbackRate=rate;}
 preparePlayback(){
  if(!this.active||!this.segment)return;
  this.clearPreparation();this.ready=false;
  const generation=this.generation,operation={listeners:[],timer:null},items=[{video:this.ui.reviewVideo,range:this.segment.current},{video:this.ui.comparePreviousVideo,range:this.segment.previous}];
  this.preparation=operation;this.updatePlaybackLabel();
  const valid=()=>this.active&&generation===this.generation&&this.preparation===operation;
  const fail=()=>{if(!valid())return;this.clearPreparation();this.ready=false;this.updatePlaybackLabel();this.ui.compareHint.textContent='未能准备好两段视频，可切换阶段重试，或分别使用播放器回看。';};
  const check=()=>{
   if(!valid())return;
   if(items.some(item=>item.video.error)){fail();return;}
   for(const item of items){
    const video=item.video;
    if(video.readyState<1)continue;
    if(!item.positioned){try{video.currentTime=item.range.start;item.positioned=true;}catch{continue;}}
    item.ready=video.readyState>=2&&!video.seeking&&Math.abs(video.currentTime-item.range.start)<.04;
   }
   if(items.every(item=>item.ready)){this.clearPreparation();this.ready=true;this.updatePlaybackLabel();}
  };
  for(const {video} of items)for(const event of ['loadedmetadata','loadeddata','canplay','seeked','timeupdate','error']){
   video.addEventListener(event,check);operation.listeners.push([video,event,check]);
  }
  operation.timer=this.setTimer(fail,8000);check();
 }
 selectSegment(segment){
  if(!this.active)return;
  this.pause();this.segment=segment;
  for(const button of this.ui.compareStages.children){const selected=button.dataset.segment===segment.id;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}
  this.ui.compareHint.textContent=segment.id==='whole'?'整跳从各自片段起点播放，未按阶段对齐。':segment.label+'：按两份分析的阶段参考点对齐回看，时间位置为估计。';
  this.preparePlayback();
 }
 updatePlaybackLabel(){
  if(!this.active)return;
  if(this.ui.reviewVideo.paused&&this.ui.comparePreviousVideo.paused)this.playing=false;
  const moving=this.playing||!this.ui.reviewVideo.paused||!this.ui.comparePreviousVideo.paused;
  this.ui.comparePlaybackBtn.disabled=!moving&&!!this.preparation;
  this.ui.comparePlaybackBtn.textContent=moving?'暂停两跳':this.preparation?'正在准备两跳…':this.ready?'一起播放':'重新对齐';
 }
 async togglePlayback(){
  if(!this.active||!this.segment)return;
  if(this.playing||!this.ui.reviewVideo.paused||!this.ui.comparePreviousVideo.paused){this.pause();this.preparePlayback();return;}
  if(this.preparation)return;
  // Native scrubbing may have moved one side. Prepare again before playing.
  if(!this.ready||Math.abs(this.ui.reviewVideo.currentTime-this.segment.current.start)>=.04||Math.abs(this.ui.comparePreviousVideo.currentTime-this.segment.previous.start)>=.04){this.preparePlayback();if(!this.ready)return;}
  const generation=++this.generation;this.ready=false;this.playing=true;this.pairedPlayback=true;this.updatePlaybackLabel();
  // Both already-decoded videos start within this new user gesture on iPhone.
  const play=video=>{try{return Promise.resolve(video.play());}catch(error){return Promise.reject(error);}};
  const results=await Promise.allSettled([play(this.ui.reviewVideo),play(this.ui.comparePreviousVideo)]);
  if(!this.active||generation!==this.generation)return;
  if(results.some(result=>result.status==='rejected')){this.pause();this.preparePlayback();this.ui.compareHint.textContent='未能同时播放，可分别点击两个播放器的播放按钮回看。';}
  else this.updatePlaybackLabel();
 }
 boundPlayback(video,ended=false){
  if(!this.active||!this.segment)return;
  const range=video===this.ui.reviewVideo?this.segment.current:this.segment.previous;
  if(ended||(!video.paused&&video.currentTime>=range.end-.035)){
   video.pause();try{video.currentTime=range.end;}catch{}
   if(this.pairedPlayback&&this.ui.reviewVideo.paused&&this.ui.comparePreviousVideo.paused){this.pairedPlayback=false;this.preparePlayback();}
  }else if(!video.paused&&video.currentTime<range.start){try{video.currentTime=range.start;}catch{}}
  this.updatePlaybackLabel();
 }
}
