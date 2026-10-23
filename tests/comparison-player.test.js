import test from 'node:test';
import assert from 'node:assert/strict';
import {ComparisonPlayer} from '../src/comparison-player.js';

function clip(id,createdAt,{type='直飞',start=1,end=7,phaseTime=2,prior=null}={}){
 return {id,createdAt,actionMode:'auto',actionType:type,blob:new Blob(['local clip'],{type:'video/mp4'}),duration:8,trimStart:start,trimEnd:end,
  trainingContext:{previousFocus:prior},analysis:{analysis:{schemaVersion:5,recognizedAction:{type},stages:[{phase:'起跳',time:phaseTime}]}}};
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(){
 class Element extends EventTarget{
  constructor(){super();this.children=[];this.dataset={};this.hidden=false;this.disabled=false;this.currentTime=0;this.readyState=2;this.seeking=false;this.playbackRate=1;this.paused=true;this.pauseCalls=0;this.playCalls=0;this.loads=0;this.classes=new Set();this.classList={toggle:(name,enabled)=>{if(enabled)this.classes.add(name);else this.classes.delete(name);}};this.ownerDocument={createElement:()=>new Element()};}
  append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}
  setAttribute(name,value){this[name]=String(value);}removeAttribute(name){delete this[name];}load(){this.loads++;}
  pause(){this.pauseCalls++;this.paused=true;this.dispatchEvent(new Event('pause'));}
  play(){this.playCalls++;this.paused=false;return this.playResult?.()||Promise.resolve();}
 }
 const ids=['compareSection','compareToggleBtn','compareHint','compareControls','compareStages','compareCue','comparePlaybackBtn','comparePrevious','comparePreviousVideo','comparePreviousLabel','compareCurrentLabel','comparisonPlayers','reviewVideo','loopBtn'];
 const ui=Object.fromEntries(ids.map(id=>[id,new Element()])),created=[],revoked=[];
 const timers=new Map();let timerId=0;
 const player=new ComparisonPlayer({setTimer:fn=>{const id=++timerId;timers.set(id,fn);return id;},clearTimer:id=>timers.delete(id),elements:ui,createElement:()=>new Element(),createObjectURL:blob=>{const url='blob:comparison-'+created.length;created.push({blob,url});return url;},revokeObjectURL:url=>revoked.push(url)});
 return {ui,player,created,revoked,timers};
}

test('rendering an unavailable comparison leaves normal playback alone',()=>{
 const {player,ui}=fixture(),current=clip('current',2000,{type:'无法判断'});ui.reviewVideo.paused=false;
 player.render(current,[clip('older',1000),current]);
 assert.equal(player.active,false);assert.equal(ui.compareToggleBtn.disabled,true);assert.equal(ui.reviewVideo.pauseCalls,0);assert.equal(ui.reviewVideo.paused,false);
 assert.match(ui.compareHint.textContent,/完成两跳同类动作/);assert.equal(ui.compareControls.hidden,true);
});

test('opening uses the closest same-action local video and closes with URL cleanup',()=>{
 const {player,ui,created,revoked}=fixture(),previous=clip('previous',1000),current=clip('current',2000,{prior:{sourceId:'previous',instruction:'双手保持在身前'}});
 player.render(current,[current,previous]);ui.reviewVideo.playbackRate=.5;ui.compareToggleBtn.onclick();
 assert.equal(player.active,true);assert.equal(created[0].blob,previous.blob);assert.equal(ui.comparePreviousVideo.src,created[0].url);assert.equal(ui.comparePreviousVideo.playbackRate,.5);
 assert.equal(ui.compareCue.hidden,false);assert.match(ui.compareCue.textContent,/双手保持在身前/);assert.equal(ui.loopBtn.disabled,true);
 assert.equal(ui.comparisonPlayers.classes.has('comparing'),true);assert.equal(ui.compareCurrentLabel.hidden,false);assert.match(ui.compareHint.textContent,/未按阶段对齐/);
 ui.compareToggleBtn.onclick();player.close();
 assert.equal(player.active,false);assert.deepEqual(revoked,[created[0].url]);assert.equal(ui.comparePreviousVideo.src,undefined);assert.equal(ui.comparePreviousVideo.loads,1);
 assert.equal(ui.loopBtn.disabled,false);assert.equal(ui.comparePrevious.hidden,true);assert.equal(ui.compareCurrentLabel.hidden,true);
});

test('a different frozen cue source is not attributed to the compared video',()=>{
 const {player,ui}=fixture(),previous=clip('previous',1000),current=clip('current',2000,{prior:{sourceId:'unrelated',instruction:'另一个视频的重点'}});
 player.render(current,[current,previous]);player.open();assert.equal(ui.compareCue.hidden,true);assert.equal(ui.compareCue.textContent,'');
});

test('phase selection aligns each video at its own absolute range and supports paired playback',async()=>{
 const {player,ui}=fixture(),previous=clip('previous',1000,{start:2,end:8,phaseTime:3}),current=clip('current',2000,{start:1,phaseTime:2});
 player.render(current,[previous,current]);player.open();
 const phase=ui.compareStages.children.find(button=>button.dataset.segment==='起跳');phase.onclick();
 assert.equal(ui.reviewVideo.currentTime,2.2);assert.equal(ui.comparePreviousVideo.currentTime,4.2);assert.equal(phase['aria-pressed'],'true');assert.match(ui.compareHint.textContent,/参考点对齐/);
 const playing=ui.comparePlaybackBtn.onclick();
 assert.equal(ui.reviewVideo.playCalls,1);assert.equal(ui.comparePreviousVideo.playCalls,1,'both play calls must happen synchronously in the same gesture');await playing;
 assert.equal(ui.comparePlaybackBtn.textContent,'暂停两跳');
 ui.reviewVideo.currentTime=4.19;ui.reviewVideo.dispatchEvent(new Event('timeupdate'));assert.equal(ui.reviewVideo.paused,true);assert.equal(ui.reviewVideo.currentTime,4.2);
 assert.equal(ui.comparePreviousVideo.paused,false);
 ui.comparePreviousVideo.currentTime=6.2;ui.comparePreviousVideo.dispatchEvent(new Event('timeupdate'));
 assert.equal(ui.comparePreviousVideo.paused,true);assert.equal(ui.comparePlaybackBtn.textContent,'一起播放');
 await ui.comparePlaybackBtn.onclick();assert.equal(ui.reviewVideo.currentTime,2.2);assert.equal(ui.comparePreviousVideo.currentTime,4.2);
 ui.comparePlaybackBtn.onclick();assert.equal(ui.reviewVideo.paused,true);assert.equal(ui.comparePreviousVideo.paused,true);
});

test('native playback stays inside the selected segment and does not restart on ended',()=>{
 const {player,ui}=fixture(),previous=clip('previous',1000),current=clip('current',2000);player.render(current,[current,previous]);player.open();
 ui.compareStages.children.find(button=>button.dataset.segment==='起跳').onclick();
 ui.reviewVideo.paused=false;ui.reviewVideo.currentTime=0;ui.reviewVideo.dispatchEvent(new Event('timeupdate'));assert.equal(ui.reviewVideo.currentTime,2.2);
 ui.reviewVideo.dispatchEvent(new Event('ended'));assert.equal(ui.reviewVideo.paused,true);assert.equal(ui.reviewVideo.currentTime,4.2);assert.equal(ui.reviewVideo.playCalls,0);
});

test('metadata-delayed seeks are replaced on phase changes and removed when the record changes',()=>{
 const {player,ui}=fixture(),previous=clip('previous',1000),current=clip('current',2000);ui.comparePreviousVideo.readyState=0;
 player.render(current,[current,previous]);player.open();ui.compareStages.children.find(button=>button.dataset.segment==='起跳').onclick();
 assert.equal(ui.comparePreviousVideo.currentTime,0);ui.comparePreviousVideo.readyState=1;ui.comparePreviousVideo.dispatchEvent(new Event('loadedmetadata'));
 assert.equal(ui.comparePreviousVideo.currentTime,2.2);
 player.close();ui.comparePreviousVideo.readyState=0;player.open();player.render(clip('other',3000),[current,previous]);
 ui.comparePreviousVideo.currentTime=99;ui.comparePreviousVideo.dispatchEvent(new Event('loadedmetadata'));assert.equal(ui.comparePreviousVideo.currentTime,99);
});

test('failed simultaneous playback pauses both videos and offers native playback',async()=>{
 const {player,ui}=fixture(),previous=clip('previous',1000),current=clip('current',2000);player.render(current,[current,previous]);player.open();
 ui.comparePreviousVideo.playResult=()=>Promise.reject(new DOMException('Blocked','NotAllowedError'));
 await ui.comparePlaybackBtn.onclick();assert.equal(ui.reviewVideo.paused,true);assert.equal(ui.comparePreviousVideo.paused,true);assert.match(ui.compareHint.textContent,/分别点击两个播放器/);assert.equal(player.active,true);
});

test('a stale failed play cannot pause a newer record or replace its comparison hint',async()=>{
 const {player,ui}=fixture(),previous=clip('previous',1000),current=clip('current',2000),later=clip('later',3000),gate=deferred();
 player.render(current,[current,previous]);player.open();ui.comparePreviousVideo.playResult=()=>gate.promise;const oldPlay=ui.comparePlaybackBtn.onclick();
 player.render(later,[later,current,previous]);player.open();ui.comparePreviousVideo.playResult=null;await ui.comparePlaybackBtn.onclick();
 gate.reject(new Error('Old failure'));await oldPlay;assert.equal(ui.reviewVideo.paused,false);assert.equal(ui.comparePreviousVideo.paused,false);assert.match(ui.compareHint.textContent,/整跳从各自片段起点/);
});


test('paired playback waits for both metadata and decoded seeks before enabling the user gesture',async()=>{
 const {player,ui}=fixture(),previous=clip('previous',1000),current=clip('current',2000);ui.comparePreviousVideo.readyState=0;
 player.render(current,[current,previous]);player.open();
 assert.equal(ui.comparePlaybackBtn.disabled,true);await ui.comparePlaybackBtn.onclick();assert.equal(ui.reviewVideo.playCalls,0);
 ui.comparePreviousVideo.readyState=1;ui.comparePreviousVideo.seeking=true;ui.comparePreviousVideo.dispatchEvent(new Event('loadedmetadata'));
 assert.equal(ui.comparePreviousVideo.currentTime,1);assert.equal(ui.comparePlaybackBtn.disabled,true);
 ui.comparePreviousVideo.readyState=2;ui.comparePreviousVideo.seeking=false;ui.comparePreviousVideo.dispatchEvent(new Event('seeked'));
 assert.equal(ui.comparePlaybackBtn.disabled,false);assert.equal(ui.comparePlaybackBtn.textContent,'一起播放');
 await ui.comparePlaybackBtn.onclick();assert.equal(ui.reviewVideo.playCalls,1);assert.equal(ui.comparePreviousVideo.playCalls,1);
});

test('timed-out or failed comparison preparation leaves native players available and can be retried',()=>{
 const {player,ui,timers}=fixture(),previous=clip('previous',1000),current=clip('current',2000);ui.comparePreviousVideo.readyState=0;
 player.render(current,[current,previous]);player.open();[...timers.values()][0]();
 assert.equal(ui.comparePlaybackBtn.disabled,false);assert.match(ui.compareHint.textContent,/分别使用播放器/);assert.equal(player.active,true);
 ui.comparePreviousVideo.readyState=2;ui.comparePlaybackBtn.onclick();assert.equal(ui.reviewVideo.playCalls,1);
 player.close();player.open();ui.comparePreviousVideo.readyState=0;
 ui.compareStages.children[0].onclick();ui.comparePreviousVideo.error={code:3};ui.comparePreviousVideo.dispatchEvent(new Event('error'));
 assert.match(ui.compareHint.textContent,/切换阶段重试/);assert.equal(timers.size,0);
});
