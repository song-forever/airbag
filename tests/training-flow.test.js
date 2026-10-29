import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url),appUrl=new URL('src/app.js',root);
const source=await readFile(appUrl,'utf8'),html=await readFile(new URL('src/index.html',root),'utf8');
const imported={};
for(const match of source.matchAll(/^import \{([^}]+)\} from '([^']+)';/gm)){
 const namespace=await import(new URL(match[2],appUrl));
 for(const name of match[1].split(',').map(value=>value.trim()))imported[name]=namespace[name];
}
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
const phaseNames=['助滑','上台','起跳','腾空'];
const frames=[0,.2,.4,.6].map(time=>({time,dataUrl:'data:image/jpeg;base64,/9j/2Q=='}));
const preparedFrames={frames,samplingMetadata:{strategy:"adaptive-subject-crop",denseWindow:{start:.2,end:.6},windowSource:"fallback",croppedFrameCount:0},preparation:{denseFrameCount:3}};
const followUp={status:'done',observation:'本跳能看到上一跳所选动作已保持。',time:.4};
function report({schemaVersion=5,instruction='下一跳保持双手在身前',check='回看腾空时双手仍在身前',follow=followUp,type='直飞',description='本跳可见保持板身朝向前方。',relation=follow?'same':'none',practiceActionType=type}={}){
 return {model:'qwen3.7-plus',frameCount:4,usage:{},analysis:{schemaVersion,stages:phaseNames.map(phase=>({phase,analysis:phase+'可见表现',time:null})),nextJump:{instruction,reason:'这是本跳最明确且易于执行的动作。',check,time:null},...(schemaVersion>=4?{followUp:follow}:{}),...(schemaVersion>=5?{recognizedAction:{type,description,time:.4},focusRelation:relation,practiceActionType}:{})}};
}
function clip(id,createdAt,{actionType='直飞',actionDetail='',focus='',analysis=null,actionMode='auto'}={}){
 const item={id,createdAt,actionMode,actionType,actionDetail,focus,action:actionType+(actionDetail?' · '+actionDetail:''),source:'camera',blob:new Blob(['clip'],{type:'video/mp4'}),duration:6,width:720,height:1280,trimStart:0,trimEnd:6,note:'本机测试',keyframes:[],analysis};
 if(analysis&&imported.getTrainingContext)analysis.trainingGoalKey=imported.getTrainingContext(item,[]).goalKey;
 return item;
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function settleUntil(predicate){for(let i=0;i<60&&!predicate();i++)await Promise.resolve();assert.ok(predicate(),'expected analysis pipeline boundary');}
function fixture({storage={getItem:()=>null,setItem(){},removeItem(){}}}={}){
 const htmlWrites=[];
 class Element extends EventTarget{
  constructor(id=''){super();this.id=id;this.children=[];this._text='';this.hidden=false;this.disabled=false;this.value='';this.dataset={};this.style={};this.checked=false;this.paused=true;this.readyState=2;this.seeking=false;this.classList={add(){},remove(){},toggle(){}};}
  set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>typeof child==='string'?child:child.textContent).join('');}
  set innerHTML(value){htmlWrites.push(String(value));this._text='';this.children=[];}get innerHTML(){return '';}
  append(...children){this.children.push(...children);}prepend(...children){this.children.unshift(...children);}replaceChildren(...children){this._text='';this.children=children;}
  setAttribute(name,value){this[name]=String(value);}removeAttribute(name){delete this[name];}load(){}pause(){this.paused=true;}async play(){this.paused=false;}showModal(){}close(){}click(){}remove(){}
  getContext(){return {clearRect(){},drawImage(){},getImageData(){return {data:new Uint8Array(160*90*4)};}};}
 }
 const nodes=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
 const document=new EventTarget();document.hidden=false;document.body=new Element();document.getElementById=id=>nodes[id];document.createElement=tag=>new Element(tag);
 const speeds=[.25,.5,1].map(speed=>{const button=new Element();button.dataset.speed=String(speed);return button;});
 document.querySelectorAll=query=>query==='[id]'?Object.values(nodes):query==='[data-speed]'?speeds:[];
 const window=new EventTarget();window.scrollTo=()=>{};
 const events=[],requests=[],saved=[];let timerId=0;
 const globals={...imported,document,window,navigator:{},console,Blob,URL,DOMException,AbortController,Event,devicePixelRatio:1,performance:{now:()=>1000},localStorage:storage,confirm:()=>true,setTimeout:()=>++timerId,clearTimeout(){},setInterval:()=>++timerId,clearInterval(){},saved};
 if(imported.getTrainingContext)globals.getTrainingContext=(...args)=>{events.push('context');return imported.getTrainingContext(...args);};
 const context=vm.createContext(globals);
 vm.runInContext(source.replace(/^import[^\n]+\n/gm,'').replaceAll('import.meta.url',JSON.stringify(appUrl.href))+`\nconst originalExtractor=extractFrames;this.testAPI={
  analyzeCurrent,selectRecord,renderAnalysis,
  setup:(items,selected)=>{records=items;current=selected;saveSettings({apiKey:'sk-local-test-only',autoAnalyze:true});},
  provider:fn=>{analyzeFrames=fn;}, extractor:fn=>{extractFrames=fn;},
  replaceHistory:items=>{records=items;},snapshot:()=>({current,records,analysisBusy}),
  save:fn=>{persistRecord=fn;},settings:()=>({apiKey,autoAnalyze,model})
  ,realExtractor:(record,signal)=>originalExtractor(record,signal)
  ,reader:fn=>{openVideoReader=fn;}
  ,localDetector:fn=>{loadAnalysisDetector=fn;analysisDetector=null;analysisDetectorPromise=null;}
  ,preparer:fn=>{prepareAnalysisFrames=fn;}
 };`,context);
 const api=context.testAPI;
 api.extractor(async()=>{events.push('extract');return preparedFrames;});
 api.provider(async payload=>{events.push('provider');requests.push(payload);return report({follow:payload.previousFocus?followUp:null});});
 api.save(async record=>{events.push('persist');saved.push(structuredClone(record));return true;});
 return {api,nodes,speeds,events,requests,saved,htmlWrites};
}

function settingsStorage(){const values=new Map();return {values,getItem:name=>values.get(name)??null,setItem:(name,value)=>values.set(name,value),removeItem:name=>values.delete(name)};}
test('setting controls automatically save without submitting, restore on reopen and delete an emptied key',()=>{
 const storage=settingsStorage(),f=fixture({storage}),key='sk-local-test-only-not-a-real-key';
 f.nodes.settingsBtn.onclick();f.nodes.apiKeyInput.value=key;f.nodes.apiKeyInput.oninput();
 f.nodes.modelSelect.value='qwen3-vl-plus';f.nodes.modelSelect.onchange();
 f.nodes.autoAnalyzeInput.checked=true;f.nodes.autoAnalyzeInput.onchange();
 const reopened=fixture({storage});reopened.nodes.settingsBtn.onclick();
 assert.equal(reopened.nodes.apiKeyInput.value,key);assert.equal(reopened.nodes.modelSelect.value,'qwen3-vl-plus');assert.equal(reopened.nodes.autoAnalyzeInput.checked,true);
 assert.ok(reopened.nodes.analysisPrivacy.textContent.includes('密钥已保存在本机'));
 reopened.nodes.apiKeyInput.value='';reopened.nodes.apiKeyInput.oninput();
 assert.equal(reopened.nodes.autoAnalyzeInput.checked,false);
 const cleared=fixture({storage});cleared.nodes.settingsBtn.onclick();
 assert.equal(cleared.nodes.apiKeyInput.value,'');assert.equal(cleared.nodes.modelSelect.value,'qwen3-vl-plus');assert.equal(cleared.nodes.autoAnalyzeInput.checked,false);
 assert.equal(f.requests.length,0);assert.equal(reopened.requests.length,0);
});

test('the existing save and clear controls persist settings while partial key edits do not replace a valid key',()=>{
 const storage=settingsStorage(),f=fixture({storage}),key='sk-local-test-only-not-a-real-key';
 f.nodes.settingsBtn.onclick();f.nodes.apiKeyInput.value=key;f.nodes.modelSelect.value='qwen3-vl-plus';f.nodes.autoAnalyzeInput.checked=true;
 f.nodes.settingsForm.onsubmit({preventDefault(){}});
 f.nodes.settingsBtn.onclick();f.nodes.apiKeyInput.value='sk-incomplete';f.nodes.apiKeyInput.oninput();
 const unchanged=fixture({storage});unchanged.nodes.settingsBtn.onclick();assert.equal(unchanged.nodes.apiKeyInput.value,key);
 f.nodes.clearKeyBtn.onclick();const cleared=fixture({storage});cleared.nodes.settingsBtn.onclick();
 assert.equal(cleared.nodes.apiKeyInput.value,'');assert.equal(cleared.nodes.modelSelect.value,'qwen3-vl-plus');assert.equal(cleared.nodes.autoAnalyzeInput.checked,false);
});

test('unwritable settings storage displays the limitation and still accepts settings for this page',()=>{
 const storage={getItem(){throw new Error('Storage disabled');},setItem(){throw new Error('Storage disabled');},removeItem(){throw new Error('Storage disabled');}};
 const f=fixture({storage});f.nodes.settingsBtn.onclick();f.nodes.apiKeyInput.value='sk-local-test-only-not-a-real-key';f.nodes.apiKeyInput.oninput();
 assert.equal(f.api.settings().apiKey,'sk-local-test-only-not-a-real-key');assert.ok(f.nodes.settingsSaveHint.textContent.includes('本机存储不可用'));
 f.nodes.clearKeyBtn.onclick();assert.equal(f.api.settings().apiKey,'');assert.equal(f.api.settings().autoAnalyze,false);
});

test('a camera clip with a confirmed start still initializes its separate analysis detector',async()=>{
 const f=fixture(),current=clip('camera',1000);current.contentStartConfirmed=true;
 const video={duration:6,videoWidth:720,videoHeight:1280};let loaded=0,disposed=0,prepared=0;
 f.api.reader(async()=>({video,dispose:()=>disposed++}));
 f.api.localDetector(async()=>{loaded++;return {detectForVideo:()=>({detections:[{boundingBox:{originX:72,originY:128,width:144,height:256},categories:[{score:.9}]}]})};});
 f.api.preparer(async(v,options)=>{prepared++;assert.equal(loaded,1);assert.equal(v,video);const boxes=options.detectPersons(v);assert.equal(boxes[0].x,.1);assert.equal(boxes[0].w,.2);return preparedFrames;});
 const result=await f.api.realExtractor(current,new AbortController().signal);
 assert.equal(result,preparedFrames);assert.equal(loaded,1);assert.equal(prepared,1);assert.equal(disposed,1);assert.equal(f.requests.length,0);
});

test('cancelling while local analysis detection initializes disposes the video before preparation or API calls',async()=>{
 const f=fixture(),current=clip('camera',1000);current.contentStartConfirmed=true;
 const c=new AbortController(),gate=deferred();let loaded=0,disposed=0,prepared=0;
 f.api.reader(async()=>({video:{duration:6,videoWidth:720,videoHeight:1280},dispose:()=>disposed++}));
 f.api.localDetector(()=>{loaded++;return gate.promise;});f.api.preparer(async()=>{prepared++;return preparedFrames;});
 const task=f.api.realExtractor(current,c.signal);await settleUntil(()=>loaded===1);c.abort();
 await assert.rejects(task,error=>error.name==='AbortError');assert.equal(disposed,1);assert.equal(prepared,0);assert.equal(f.requests.length,0);
});

test('the next jump sends one prior cue selected once before extraction, then saves its successful snapshot',async()=>{
 const previous=clip('first',1000,{analysis:report({schemaVersion:3,instruction:'起跳时保持双手在身前',check:'离台时双手仍在身前'})});
 const current=clip('second',2000),f=fixture();f.api.setup([current,previous],current);
 f.api.extractor(async()=>{f.events.push('extract');previous.analysis.analysis.nextJump.instruction='抽帧期间源建议被修改';return preparedFrames;});
 await f.api.analyzeCurrent();
 assert.deepEqual(f.events,['context','extract','provider','persist']);
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].previousFocus.instruction,'起跳时保持双手在身前');
 assert.equal(f.requests[0].previousFocus.check,'离台时双手仍在身前');
 assert.equal(f.saved.length,1);assert.equal(f.saved[0].trainingContext.previousFocus.sourceId,'first');
 assert.equal(f.saved[0].analysis.trainingGoalKey,f.saved[0].trainingContext.goalKey);
 assert.equal(f.saved[0].analysis.analysis.followUp.status,'done');
});

test('a successful cue snapshot stays unchanged after the source is reanalyzed or removed',async()=>{
 const instruction='保持双手在身前',check='腾空时双手仍在身前';
 const previous=clip('first',1000,{analysis:report({instruction,check})}),current=clip('second',2000),f=fixture();
 f.api.setup([current,previous],current);await f.api.analyzeCurrent();
 const snapshot=structuredClone(current.trainingContext);
 previous.analysis.analysis.nextJump.instruction='后来重新分析的另一个建议';previous.analysis.analysis.nextJump.check='后来改变的检查标准';
 f.api.replaceHistory([current]);await f.api.selectRecord(current);
 assert.deepEqual(current.trainingContext,snapshot);assert.equal(f.events.filter(event=>event==='context').length,1);
 assert.ok(f.nodes.analysisResult.textContent.includes(instruction));assert.ok(f.nodes.analysisResult.textContent.includes(check));
 assert.ok(!f.nodes.analysisResult.textContent.includes('后来重新分析的另一个建议'));
});

test('first-jump analysis cannot inherit from itself or a future jump',async()=>{
 const current=clip('first',1000,{analysis:report({instruction:'旧的本跳建议'})}),future=clip('future',2000,{analysis:report({instruction:'未来一跳建议'})});
 const f=fixture();f.api.setup([future,current],current);await f.api.analyzeCurrent();
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].previousFocus,null);
 assert.equal(current.trainingContext.previousFocus,null);assert.equal(current.analysis.analysis.followUp,null);
});

test('recognizing a different action starts a new focus without grading the previous action cue',async()=>{
 const previous=clip('first',1000,{analysis:report({instruction:'直飞的上次训练重点'})}),current=clip('second',2000),f=fixture();
 f.api.setup([current,previous],current);f.api.provider(async payload=>{f.requests.push(payload);return report({type:'转体',description:'本跳空中可见主动转体。',relation:'different',follow:null,instruction:'这一跳新的转体训练重点'});});
 await f.api.analyzeCurrent();
 assert.equal(f.requests[0].actionMode,'auto');assert.equal(f.requests[0].previousFocus.instruction,'直飞的上次训练重点');
 assert.equal(current.actionMode,'auto');assert.equal(current.actionType,'转体');assert.equal(current.action,'转体');
 const text=f.nodes.analysisResult.textContent;
 assert.ok(text.includes('这一跳新的转体训练重点'));assert.ok(!text.includes('直飞的上次训练重点'));
 assert.ok(/不同|变化|改变|切换/.test(text),'explain the changed action instead of grading its unrelated prior focus');
 assert.equal(f.nodes.clipTitle.textContent,'转体');assert.ok(f.nodes.recognizedActionHint.textContent.includes('本跳空中可见主动转体。'));
});

test('analysis starts without a typed goal, automatically recognizes the action and removes stale manual goal fields',async()=>{
 const current=clip('first',1000,{actionType:'',actionDetail:'旧的手动描述',focus:'旧的关注点'}),f=fixture();f.api.setup([current],current);
 await f.api.analyzeCurrent();
 assert.equal(f.requests[0].actionMode,'auto');assert.equal(Object.hasOwn(f.requests[0],'action'),false);
 assert.equal(f.nodes.reviewAction,undefined);assert.equal(f.nodes.reviewActionDetail,undefined);assert.equal(f.nodes.focusInput,undefined);
 assert.equal(current.actionMode,'auto');assert.equal(current.actionType,'直飞');assert.equal(current.action,'直飞');assert.equal(current.actionDetail,'');assert.equal(current.focus,'');
 assert.equal(f.nodes.clipTitle.textContent,'直飞');assert.ok(f.nodes.recognizedActionHint.textContent.includes('本跳可见保持板身朝向前方。'));
 assert.equal(f.saved[0].analysis.trainingGoalKey,f.saved[0].trainingContext.goalKey);
});

test('uncertain recognition is displayed honestly and preserves the previous training context',async()=>{
 const previous=clip('first',1000,{analysis:report({instruction:'此前明确的训练重点'})}),current=clip('second',2000),f=fixture();f.api.setup([current,previous],current);
 f.api.provider(async()=>report({type:'无法判断',description:'本跳无法确认动作类型。',relation:'uncertain',practiceActionType:'直飞',follow:{status:'uncertain',observation:'暂时无法确认上次动作是否完成。',time:null},instruction:'继续此前明确的训练重点'}));
 await f.api.analyzeCurrent();
 assert.equal(current.actionType,'无法判断');assert.equal(current.trainingContext.previousFocus.sourceId,'first');assert.equal(current.trainingContext.previousFocus.instruction,'此前明确的训练重点');
 assert.equal(current.analysis.analysis.practiceActionType,'直飞');assert.equal(f.nodes.clipTitle.textContent,'无法判断');
 assert.ok(f.nodes.recognizedActionHint.textContent.includes('本跳无法确认动作类型。'));assert.ok(f.nodes.analysisResult.textContent.includes('暂时无法判断'));
});

for(const outcome of ['failed','cancelled'])test(`${outcome} reanalysis preserves the saved report and its cue snapshot`,async()=>{
 const previous=clip('first',1000,{analysis:report({instruction:'新候选建议'})}),oldReport=report({instruction:'原来的下一跳建议'}),current=clip('second',2000,{analysis:oldReport});
 const oldContext={goalKey:oldReport.trainingGoalKey,previousFocus:{sourceId:'older',sourceCreatedAt:500,instruction:'原来的上次建议',check:'原来的上次检查'}};
 current.trainingContext=oldContext;const f=fixture(),gate=deferred();f.api.setup([current,previous],current);
 f.api.provider(payload=>{f.requests.push(payload);return gate.promise;});const analysis=f.api.analyzeCurrent();
 await settleUntil(()=>f.requests.length===1);
 if(outcome==='cancelled')f.nodes.cancelAnalysisBtn.onclick();
 gate.reject(outcome==='cancelled'?new DOMException('Cancelled','AbortError'):new Error('服务暂时不可用'));
 await analysis;
 assert.equal(current.analysis,oldReport);assert.equal(current.trainingContext,oldContext);assert.equal(f.saved.length,0);
 assert.ok(f.nodes.analysisResult.textContent.includes('原来的下一跳建议'));assert.equal(f.nodes.analysisResult.hidden,false);
});

test('follow-up renders frozen cue and evidence as text between stages and the overall advice; older reports remain visible',async()=>{
 const marker='<img src=x onerror="alert(1)">',previous=clip('first',1000,{analysis:report({instruction:'上次重点 '+marker,check:'上次检查 '+marker})}),current=clip('second',2000),f=fixture();
 f.api.setup([current,previous],current);f.api.provider(async()=>report({follow:{status:'partial',observation:'本次证据 '+marker,time:.4}}));await f.api.analyzeCurrent();
 const text=f.nodes.analysisResult.textContent;
 assert.ok(text.includes('这一跳：部分做到'));
 for(const value of ['上次重点 '+marker,'上次检查 '+marker,'本次证据 '+marker])assert.ok(text.includes(value),value);
 assert.ok(text.indexOf('腾空可见表现')<text.indexOf('上次重点 '+marker));assert.ok(text.indexOf('本次证据 '+marker)<text.indexOf('总体分析'));
 assert.ok(!f.htmlWrites.some(value=>value.includes(marker)),'untrusted provider/cue text must not become HTML');
 for(const schemaVersion of [2,3,4]){
  current.analysis=report({schemaVersion,instruction:'旧版仍可见的建议',follow:null});f.api.renderAnalysis();
  assert.ok(f.nodes.analysisResult.textContent.includes('旧版仍可见的建议'));
  assert.ok(!f.nodes.analysisResult.textContent.includes('上次重点 '+marker));
 }
});

test('failed analysis rolls back provisional automatic trimming and retains the original report, cue and keyframes',async()=>{
 const oldReport=report({instruction:'原来的下一跳建议'}),current=clip('current',2000,{analysis:oldReport});
 const oldContext={goalKey:oldReport.trainingGoalKey,previousFocus:{sourceId:'older',sourceCreatedAt:500,instruction:'原来的训练重点',check:'原来的检查标准'}};
 const oldKeyframes=[{time:.4,dataUrl:frames[2].dataUrl}];
 current.contentStart=.3;current.contentStartConfirmed=false;current.trainingContext=oldContext;current.keyframes=oldKeyframes;
 const f=fixture();f.api.setup([current],current);await f.api.selectRecord(current);
 f.api.extractor(async record=>{
  record.trimStart=1.5;record.contentStart=1.5;record.contentStartConfirmed=true;
  f.nodes.trimStart.value='1.5';f.nodes.trimLabel.textContent='1.5–6.0 秒';return preparedFrames;
 });
 f.api.provider(async()=>{throw new Error('模型读取失败');});await f.api.analyzeCurrent();
 assert.equal(current.trimStart,0);assert.equal(current.trimEnd,6);assert.equal(current.contentStart,.3);assert.equal(current.contentStartConfirmed,false);
 assert.equal(f.nodes.trimStart.value,'0.0');assert.equal(f.nodes.trimEnd.value,'6.0');assert.equal(f.nodes.trimLabel.textContent,'0.0–6.0 秒');
 assert.equal(current.analysis,oldReport);assert.equal(current.trainingContext,oldContext);assert.equal(current.keyframes,oldKeyframes);
 assert.equal(f.saved.length,0);assert.ok(f.nodes.analysisResult.textContent.includes('原来的下一跳建议'));
});


test('two-jump comparison opens locally, shares speed controls and resets both UI and playback to 1x on another selection',async()=>{
 const previous=clip('previous',1000,{analysis:report({follow:null})}),current=clip('current',2000,{analysis:report()}),next=clip('next',3000,{analysis:report()}),f=fixture();
 current.trainingContext={previousFocus:{sourceId:previous.id,instruction:'这一跳对应的旧重点'}};
 previous.analysis.analysis.stages.forEach((stage,index)=>stage.time=index+.5);
 current.analysis.analysis.stages.forEach((stage,index)=>stage.time=index+1);
 f.api.setup([next,current,previous],current);await f.api.selectRecord(current);
 assert.equal(f.nodes.reviewVideo.playbackRate,1);assert.equal(f.speeds[2]['aria-pressed'],'true');assert.equal(f.speeds[1]['aria-pressed'],'false');
 assert.equal(f.nodes.compareToggleBtn,undefined);assert.equal(f.nodes.compareSection.hidden,true);f.nodes.comparePreviousInput.checked=true;f.nodes.comparePreviousInput.onchange();
 assert.equal(f.nodes.comparePrevious.hidden,false);assert.equal(f.nodes.compareControls.hidden,false);assert.equal(f.nodes.loopBtn.disabled,true);
 assert.ok(f.nodes.compareCue.textContent.includes('这一跳对应的旧重点'));
 const takeoff=f.nodes.compareStages.children.find(button=>button.textContent==='起跳');takeoff.onclick();
 assert.ok(f.nodes.compareHint.textContent.includes('参考点'));assert.equal(f.nodes.reviewVideo.currentTime,2.2);assert.equal(f.nodes.comparePreviousVideo.currentTime,1.7);
 f.speeds[1].onclick();assert.equal(f.nodes.reviewVideo.playbackRate,.5);assert.equal(f.nodes.comparePreviousVideo.playbackRate,.5);
 await f.api.selectRecord(next);
 assert.equal(f.nodes.reviewVideo.playbackRate,1);assert.equal(f.nodes.comparePreviousVideo.playbackRate,1);assert.equal(f.speeds[2]['aria-pressed'],'true');
 assert.equal(f.nodes.comparePrevious.hidden,false);assert.equal(f.nodes.loopBtn.disabled,true);f.nodes.comparePreviousInput.checked=false;f.nodes.comparePreviousInput.onchange();assert.equal(f.nodes.comparePrevious.hidden,true);assert.equal(f.nodes.compareSection.hidden,true);assert.equal(f.nodes.loopBtn.disabled,false);assert.equal(f.requests.length,0,'local comparison must not make a model request');
});


test('schema 6 reports render derived recognition evidence as text and preserve stage and overall analysis',async()=>{
 const f=fixture(),current=clip('evidence',2000),a=report({schemaVersion:6,follow:null}),marker='<img src=x onerror=alert(1)>';
 a.analysis.recognizedAction.features={rotation:{state:'no',evidence:[{time:.2,observation:'朝向稳定 '+marker},{time:.4,observation:'整体朝向仍稳定'}]},grab:{state:'no',evidence:[{time:.2,observation:'手与板分离'},{time:.4,observation:'手与板继续分离'}]}};
 a.analysis.recognizedAction.evidenceIncomplete=false;f.api.setup([current],current);f.api.provider(async()=>a);await f.api.analyzeCurrent();
 assert.equal(f.nodes.clipTitle.textContent,'直飞');assert.equal(f.nodes.actionEvidencePanel.hidden,false);assert.ok(f.nodes.actionEvidenceList.textContent.includes('朝向稳定 '+marker));assert.ok(!f.htmlWrites.some(value=>value.includes(marker)));
 assert.ok(f.nodes.analysisResult.textContent.includes('腾空可见表现'));assert.ok(f.nodes.analysisResult.textContent.includes('总体分析'));
 const evidenceButton=f.nodes.actionEvidenceList.children[0].children.find(child=>child.className==='time-link');evidenceButton.onclick();assert.equal(f.nodes.reviewVideo.currentTime,.2);
 current.analysis=report({schemaVersion:5});await f.api.selectRecord(current);assert.equal(f.nodes.actionEvidencePanel.hidden,true);
});

test('attention persists across videos and reloads until explicitly changed or cleared',async()=>{
 const storage=settingsStorage(),first=clip('first-attention',1000),second=clip('second-attention',2000),f=fixture({storage});first.attention='旧视频的观察主题';f.api.setup([second,first],second);await f.api.selectRecord(second);
 f.nodes.jumpAttentionInput.value='  持续留意提前转肩  ';f.nodes.jumpAttentionInput.oninput();await f.nodes.jumpAttentionInput.onchange();
 await f.api.analyzeCurrent();assert.equal(f.requests[0].attention,'持续留意提前转肩');assert.equal(second.analysis.attention,'持续留意提前转肩');
 await f.api.selectRecord(first);assert.equal(f.nodes.jumpAttentionInput.value,'  持续留意提前转肩  ');await f.api.analyzeCurrent();assert.equal(f.requests[1].attention,'持续留意提前转肩');
 f.nodes.jumpAttentionInput.value='改看抓板';f.nodes.jumpAttentionInput.oninput();assert.equal(second.analysis.attention,'持续留意提前转肩');
 const reopened=fixture({storage});reopened.api.setup([second,first],second);await reopened.api.selectRecord(second);assert.equal(reopened.nodes.jumpAttentionInput.value,'改看抓板');
 reopened.nodes.jumpAttentionInput.value='';reopened.nodes.jumpAttentionInput.oninput();const cleared=fixture({storage});cleared.api.setup([first],first);await cleared.api.selectRecord(first);assert.equal(cleared.nodes.jumpAttentionInput.value,'');
});

test('attention is frozen while analysis is running and restored after extraction fails',async()=>{
 const current=clip('attention-freeze',1000),f=fixture(),gate=deferred();current.attention='关注本跳舒展';f.api.setup([current],current);await f.api.selectRecord(current);f.nodes.jumpAttentionInput.value='关注本跳舒展';f.nodes.jumpAttentionInput.oninput();f.api.extractor(()=>gate.promise);
 const pending=f.api.analyzeCurrent();await settleUntil(()=>f.api.snapshot().analysisBusy);assert.equal(f.nodes.jumpAttentionInput.disabled,true);
 f.nodes.jumpAttentionInput.value='分析期间改动';f.nodes.jumpAttentionInput.oninput();assert.equal(current.attention,'关注本跳舒展');gate.resolve(preparedFrames);await pending;
 assert.equal(f.requests[0].attention,'关注本跳舒展');assert.equal(current.analysis.attention,'关注本跳舒展');assert.equal(f.nodes.jumpAttentionInput.disabled,false);
 f.api.extractor(async()=>{throw Error('提取失败');});await f.api.analyzeCurrent();assert.equal(f.nodes.jumpAttentionInput.disabled,false);assert.equal(current.analysis.attention,'关注本跳舒展');
});

test('comparison preference restores independently of model credentials and opens without a page toggle',async()=>{
 const storage=settingsStorage(),f=fixture({storage});f.nodes.comparePreviousInput.checked=true;f.nodes.comparePreviousInput.onchange();
 const reopened=fixture({storage}),previous=clip('compare-prev',1000,{analysis:report({follow:null})}),current=clip('compare-current',2000,{analysis:report()});
 reopened.api.setup([current,previous],current);await reopened.api.selectRecord(current);assert.equal(reopened.nodes.comparePreviousInput.checked,true);assert.equal(reopened.nodes.comparePrevious.hidden,false);assert.equal(reopened.nodes.compareToggleBtn,undefined);
 reopened.nodes.comparePreviousInput.checked=false;reopened.nodes.comparePreviousInput.onchange();assert.equal(reopened.nodes.comparePrevious.hidden,true);const off=fixture({storage});assert.equal(off.nodes.comparePreviousInput.checked,false);
});

test('cleared video records retain reports while playback, trimming and new analysis are unavailable',async()=>{
 const f=fixture(),item=clip('archived',1,{analysis:report()});item.blob=null;item.videoClearedAt=123;f.api.setup([item],item);
 await f.api.selectRecord(item);
 assert.equal(f.nodes.reviewVideo.hidden,true);assert.equal(f.nodes.analyzeBtn.disabled,true);assert.equal(f.nodes.applyTrimBtn.disabled,true);assert.equal(f.nodes.shareVideoBtn.disabled,true);assert.equal(f.nodes.exportReportBtn.disabled,false);
 assert.match(f.nodes.historyList.textContent,/视频已清理/);assert.equal(f.nodes.batchExportBtn.disabled,true);
 await f.api.analyzeCurrent();assert.equal(f.requests.length,0);assert.ok(item.analysis);
});
