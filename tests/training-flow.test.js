import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
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
function fixture({storage={getItem:()=>null,setItem(){},removeItem(){}},navigator={},confirmAction=()=>true}={}){
 const htmlWrites=[],downloads=[];
 class Element extends EventTarget{
  constructor(id=''){super();this.id=id;this.children=[];this._text='';this.hidden=false;this.disabled=false;this.value='';this.dataset={};this.style={};this.checked=false;this.paused=true;this.readyState=2;this.seeking=false;this.classList={add(){},remove(){},toggle(){}};}
  set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>typeof child==='string'?child:child.textContent).join('');}
  set innerHTML(value){htmlWrites.push(String(value));this._text='';this.children=[];}get innerHTML(){return '';}
  append(...children){this.children.push(...children);}prepend(...children){this.children.unshift(...children);}replaceChildren(...children){this._text='';this.children=children;}
  setAttribute(name,value){this[name]=String(value);}removeAttribute(name){delete this[name];}load(){}pause(){this.paused=true;}async play(){this.paused=false;}showModal(){}close(){}click(){}remove(){}
  getContext(){return {clearRect(){},drawImage(){},getImageData(){return {data:new Uint8Array(160*90*4)};}};}
 }
 const nodes=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
 const document=new EventTarget();document.hidden=false;document.body=new Element();document.getElementById=id=>nodes[id];document.createElement=tag=>{
  const element=new Element(tag);
  if(tag==='a')element.click=()=>downloads.push({url:element.href,name:element.download});
  return element;
 };
 const speeds=[.25,.5,1].map(speed=>{const button=new Element();button.dataset.speed=String(speed);return button;});
 document.querySelectorAll=query=>query==='[id]'?Object.values(nodes):query==='[data-speed]'?speeds:[];
 const window=new EventTarget();window.scrollTo=()=>{};
 const events=[],requests=[],saved=[];let timerId=0;
 const globals={...imported,document,window,navigator,console,Blob,URL,DOMException,AbortController,Event,crypto:webcrypto,devicePixelRatio:1,performance:{now:()=>1000},localStorage:storage,confirm:confirmAction,setTimeout:()=>++timerId,clearTimeout(){},setInterval:()=>++timerId,clearInterval(){},saved};
 if(imported.getTrainingContext)globals.getTrainingContext=(...args)=>{events.push('context');return imported.getTrainingContext(...args);};
 const context=vm.createContext(globals);
 vm.runInContext(source.replace(/^import[^\n]+\n/gm,'').replaceAll('import.meta.url',JSON.stringify(appUrl.href))+`\nconst originalExtractor=extractFrames;this.testAPI={
  analyzeCurrent,selectRecord,renderAnalysis,importVideo,assignCurrentTraining,
  setup:(items,selected)=>{records=items;current=selected;saveSettings({apiKey:'sk-local-test-only',autoAnalyze:true});},
  provider:fn=>{analyzeFrames=fn;}, extractor:fn=>{extractFrames=fn;},
  replaceHistory:items=>{records=items;},snapshot:()=>({current,records,analysisBusy}),
  save:fn=>{persistRecord=fn;},settings:()=>({apiKey,autoAnalyze,model})
  ,realExtractor:(record,signal)=>originalExtractor(record,signal)
  ,reader:fn=>{openVideoReader=fn;}
  ,localDetector:fn=>{loadAnalysisDetector=fn;analysisDetector=null;analysisDetectorPromise=null;}
  ,preparer:fn=>{prepareAnalysisFrames=fn;}
  ,metadata:fn=>{getVideoMetadata=fn;},poster:fn=>{getPoster=fn;}
  ,training:()=>({session:trainingSession,persisted:trainingPersisted})
  ,importProcessing:fn=>{getVideoMetadata=fn;getPoster=async()=>'';}
 };`,context);
 const api=context.testAPI;
 api.extractor(async()=>{events.push('extract');return preparedFrames;});
 api.provider(async payload=>{events.push('provider');requests.push(payload);return report({follow:payload.previousFocus?followUp:null});});
 api.save(async record=>{events.push('persist');saved.push(structuredClone(record));return true;});
 return {api,nodes,speeds,events,requests,saved,htmlWrites,downloads};
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
 f.api.preparer(async(v,options)=>{prepared++;assert.equal(loaded,1);assert.equal(v,video);const boxes=await options.detectPersons(v);assert.equal(boxes[0].x,.1);assert.equal(boxes[0].w,.2);return preparedFrames;});
 const result=await f.api.realExtractor(current,new AbortController().signal);
 assert.equal(result,preparedFrames);assert.equal(loaded,1);assert.equal(prepared,1);assert.equal(disposed,1);assert.equal(f.requests.length,0);
});

test('applying an imported play range preserves its start in playback and analysis',async()=>{
 const f=fixture(),current=clip('import',1000);current.source='import';
 f.api.setup([current],current);await f.api.selectRecord(current);
 f.nodes.trimStart.value='1';f.nodes.trimEnd.value='5';await f.nodes.applyTrimBtn.onclick();
 const video={duration:6,videoWidth:720,videoHeight:1280};
 f.api.reader(async()=>({video,dispose(){}}));
 f.api.localDetector(async()=>({detectForVideo(){throw new Error('Confirmed ranges must not scout for a new start');}}));
 f.api.preparer(async(_video,{start,end})=>{assert.equal(start,1);assert.equal(end,5);return preparedFrames;});
 const prepared=await f.api.realExtractor(current,new AbortController().signal);
 assert.equal(prepared,preparedFrames);assert.equal(f.saved.at(-1).contentStartConfirmed,true);
 assert.equal(current.trimStart,1);assert.equal(current.trimEnd,5);
});

test('an imported jump keeps its own learning references in review, analysis and export',async()=>{
 const older=clip('older',1000),f=fixture();f.api.setup([older],older);
 const file=new Blob(['video'],{type:'video/mp4'});file.name='jump.mp4';
 f.nodes.jumpActionInput.value='Indy 抓板';f.nodes.jumpActionInput.oninput();
 f.nodes.jumpMasteryInput.value='能做但不稳定';f.nodes.jumpMasteryInput.onchange();
 f.api.importProcessing(async()=>{throw new Error('Could not open file');});
 await f.api.importVideo(file);
 assert.equal(f.nodes.jumpActionInput.value,'Indy 抓板');assert.equal(f.nodes.jumpMasteryInput.value,'能做但不稳定');
 f.api.importProcessing(async()=>({duration:6,width:720,height:1280}));
 await f.api.importVideo(file);
 const {current}=f.api.snapshot(),intent={action:'Indy 抓板',mastery:'能做但不稳定'};
 assert.deepEqual(current.jumpIntent,intent);assert.deepEqual(f.saved.at(-1).jumpIntent,intent);
 assert.equal(f.nodes.clipIntent.hidden,false);
 assert.equal(f.nodes.clipPlannedAction.textContent,intent.action);assert.equal(f.nodes.clipMastery.textContent,intent.mastery);
 assert.equal(f.nodes.jumpActionInput.value,'');assert.equal(f.nodes.jumpMasteryInput.value,'');
 f.nodes.jumpActionInput.value='下一跳练的是直飞';f.nodes.jumpActionInput.oninput();
 await f.api.analyzeCurrent();
 assert.deepEqual(f.requests.at(-1).jumpIntent,intent);
 assert.equal(current.actionType,'直飞');assert.equal(f.nodes.clipPlannedAction.textContent,'Indy 抓板');
 f.nodes.exportReportBtn.onclick();
 const {url}=f.downloads.at(-1);
 try {
  const exported=await fetch(url).then(response=>response.json());
  assert.deepEqual(exported.jumpIntent,intent);
  assert.equal(exported.action,'直飞');
 } finally{URL.revokeObjectURL(url);}
 await f.api.selectRecord(older);assert.equal(f.nodes.clipIntent.hidden,true);
});

test('analysis extraction uses tile fallback only when full-frame person detection is empty',async()=>{
 const f=fixture(),current=clip('camera',1000);current.contentStartConfirmed=true;
 const video={duration:6,videoWidth:720,videoHeight:1280};let full=0,tiles=0,disposed=0;
 f.api.reader(async()=>({video,dispose:()=>disposed++}));
 f.api.localDetector(async()=>({detectForVideo:image=>{
  if(image===video){full++;return {detections:[]};}
  tiles++;return {detections:[{boundingBox:{originX:72,originY:128,width:144,height:256},categories:[{categoryName:'person',score:.9}]}]};
 }}));
 f.api.preparer(async(v,options)=>{const boxes=await options.detectPersons(v);assert.equal(full,1);assert.equal(tiles,2);assert.ok(boxes.length>0);assert.ok(boxes.every(box=>box.x>=0&&box.y>=0&&box.x+box.w<=1&&box.y+box.h<=1));return preparedFrames;});
 assert.equal(await f.api.realExtractor(current,new AbortController().signal),preparedFrames);assert.equal(disposed,1);assert.equal(f.requests.length,0);
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
 let revealed=false;f.nodes.reviewVideo.scrollIntoView=()=>{revealed=true;};
 const evidenceButton=f.nodes.actionEvidenceList.children[0].children.find(child=>child.className==='time-link');evidenceButton.onclick();assert.equal(f.nodes.reviewVideo.currentTime,.2);assert.equal(revealed,true);
 current.analysis=report({schemaVersion:5});await f.api.selectRecord(current);assert.equal(f.nodes.actionEvidencePanel.hidden,true);
});

test('attention persists across videos and reloads until explicitly changed or cleared',async()=>{
 const storage=settingsStorage(),first=clip('first-attention',1000),second=clip('second-attention',2000),f=fixture({storage});first.attention='旧视频的观察主题';f.api.setup([second,first],second);await f.api.selectRecord(second);
 assert.equal(f.nodes.attentionIndicator.hidden,true);
 f.nodes.attentionDialog.showModal=()=>{f.nodes.attentionDialog.open=true;};
 f.nodes.attentionBtn.onclick();assert.equal(f.nodes.attentionDialog.open,true);
 f.nodes.jumpAttentionInput.value='  持续留意提前转肩  ';f.nodes.jumpAttentionInput.oninput();await f.nodes.jumpAttentionInput.onchange();
 assert.equal(f.nodes.attentionIndicator.hidden,false);assert.equal(f.nodes.attentionBtn['aria-label'],'特别关注，已设置');
 await f.api.analyzeCurrent();assert.equal(f.requests[0].attention,'持续留意提前转肩');assert.equal(second.analysis.attention,'持续留意提前转肩');
 await f.api.selectRecord(first);assert.equal(f.nodes.jumpAttentionInput.value,'  持续留意提前转肩  ');await f.api.analyzeCurrent();assert.equal(f.requests[1].attention,'持续留意提前转肩');
 f.nodes.jumpAttentionInput.value='改看抓板';f.nodes.jumpAttentionInput.oninput();assert.equal(second.analysis.attention,'持续留意提前转肩');
 const reopened=fixture({storage});reopened.api.setup([second,first],second);await reopened.api.selectRecord(second);assert.equal(reopened.nodes.jumpAttentionInput.value,'改看抓板');
 reopened.nodes.jumpAttentionInput.value='';reopened.nodes.jumpAttentionInput.oninput();const cleared=fixture({storage});cleared.api.setup([first],first);await cleared.api.selectRecord(first);assert.equal(cleared.nodes.jumpAttentionInput.value,'');
 assert.equal(cleared.nodes.attentionIndicator.hidden,true);
});

test('attention is frozen while analysis is running and restored after extraction fails',async()=>{
 const current=clip('attention-freeze',1000),f=fixture(),gate=deferred();current.attention='关注本跳舒展';f.api.setup([current],current);await f.api.selectRecord(current);f.nodes.jumpAttentionInput.value='关注本跳舒展';f.nodes.jumpAttentionInput.oninput();f.api.extractor(()=>gate.promise);
 const pending=f.api.analyzeCurrent();await settleUntil(()=>f.api.snapshot().analysisBusy);assert.equal(f.nodes.jumpAttentionInput.disabled,true);assert.equal(f.nodes.attentionBtn.disabled,true);
 f.nodes.jumpAttentionInput.value='分析期间改动';f.nodes.jumpAttentionInput.oninput();assert.equal(current.attention,'关注本跳舒展');gate.resolve(preparedFrames);await pending;
 assert.equal(f.requests[0].attention,'关注本跳舒展');assert.equal(current.analysis.attention,'关注本跳舒展');assert.equal(f.nodes.jumpAttentionInput.disabled,false);assert.equal(f.nodes.attentionBtn.disabled,false);
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

function setTraining(f,{goal='grab',detail='让熟悉的抓板更连贯',stage='consolidation'}={}){
 f.nodes.trainingGoalSelect.value=goal;f.nodes.trainingStageSelect.value=stage;f.nodes.trainingDetailInput.value=detail;
 f.nodes.trainingForm.onsubmit({preventDefault(){}});return f.api.training().session;
}
function coachedReport(session,{positive='本跳可见保持同一练习节奏',...options}={}){
 const value=report({schemaVersion:7,...options});
 value.analysis.coaching={session,positive:{observation:positive,time:.4},method:{id:'repeat',title:'围绕同一标准再练一次',description:'继续熟悉的动作，只检查本轮这一点。',skillTheme:'时机与协调'}};
 return value;
}

test('training goal and stage persist independently of credentials; changed goals form a new group without rewriting history',async()=>{
 const storage=settingsStorage(),f=fixture({storage}),old=clip('old-session',1000,{analysis:report()});f.api.setup([old],old);
 const first=setTraining(f);assert.equal(first.goal,'grab');assert.equal(first.stage,'consolidation');assert.match(f.nodes.trainingSessionSummary.textContent,/抓板/);
 const reopened=fixture({storage});assert.equal(reopened.api.training().session.id,first.id);assert.equal(reopened.nodes.trainingDetailInput.value,'让熟悉的抓板更连贯');
 const other=setTraining(f,{goal:'rotation',detail:'熟悉的转体',stage:'refinement'});assert.notEqual(other.id,first.id);assert.equal(old.trainingSession,undefined);assert.ok(old.analysis);
 const savedId=other.id;setTraining(f,{goal:'rotation',detail:'熟悉的转体',stage:'refinement'});assert.equal(f.api.training().session.id,savedId,'saving unchanged selection must not split the group');
 f.nodes.newTrainingGroupBtn.onclick();assert.notEqual(f.api.training().session.id,savedId);assert.ok(old.analysis);
 setTraining(f,{goal:'',detail:'',stage:'acquisition'});assert.equal(f.api.training().session,null);assert.equal(f.nodes.trainingStageSelect.disabled,true);assert.ok(old.analysis);assert.equal(f.requests.length,0);
});

test('local import snapshots the group before metadata resolves and rejects edits during that import',async()=>{
 const f=fixture(),first=setTraining(f),gate=deferred();f.api.setup([],null);
 f.api.metadata(()=>gate.promise);f.api.poster(async()=> '');
 const file=Object.assign(new Blob(['video'],{type:'video/mp4'}),{name:'snapshot.mp4'}),pending=f.api.importVideo(file);
 assert.equal(f.nodes.trainingGoalSelect.disabled,true);assert.equal(f.nodes.applyTrainingBtn.disabled,true);
 setTraining(f,{goal:'rotation',stage:'refinement'});assert.equal(f.api.training().session.id,first.id);
 gate.resolve({duration:4,width:720,height:1280});await pending;
 const importedClip=f.api.snapshot().current;assert.equal(importedClip.trainingSession.id,first.id);assert.equal(importedClip.source,'import');assert.ok(Number.isFinite(importedClip.trainingJoinedAt));
 const second=setTraining(f,{goal:'rotation',stage:'refinement'});assert.notEqual(second.id,first.id);assert.equal(importedClip.trainingSession.id,first.id);assert.match(f.nodes.recordTrainingSummary.textContent,/抓板/);assert.equal(f.requests.length,0);
});

test('assigning analyzed history requires confirmation, preserves video time, and creates one new group attempt',async()=>{
 let approved=false,confirmations=0;const f=fixture({confirmAction:()=>{confirmations++;return approved;}}),session=setTraining(f),old=clip('assign',1000,{analysis:report()});old.practiceFeeling='harder';old.trainingContext={goalKey:'old',previousFocus:null};
 const originalBlob=old.blob;f.api.setup([old],old);await f.api.selectRecord(old);const previousAnalysis=old.analysis;
 assert.equal(f.nodes.assignTrainingBtn.hidden,false);await f.nodes.assignTrainingBtn.onclick();assert.equal(confirmations,1);assert.equal(old.analysis,previousAnalysis);assert.equal(old.trainingSession,undefined);
 approved=true;await f.nodes.assignTrainingBtn.onclick();assert.equal(confirmations,2);assert.equal(old.createdAt,1000);assert.equal(old.blob,originalBlob);assert.equal(old.analysis,null);assert.equal(old.trainingContext,undefined);assert.equal(old.practiceFeeling,undefined);assert.equal(old.trainingSession.id,session.id);assert.ok(old.trainingJoinedAt>old.createdAt);assert.equal(f.nodes.assignTrainingBtn.hidden,true);assert.equal(f.api.snapshot().records.length,1);
 old.blob=null;setTraining(f,{goal:'rotation'});await f.api.selectRecord(old);assert.equal(f.nodes.assignTrainingBtn.hidden,true,'a cleared video must not lose its only retained report through reassignment');
});

test('schema 7 shows grounded positive feedback, method and optional self-report with phase details collapsed',async()=>{
 const f=fixture(),session=setTraining(f),marker='<img src=x onerror=alert(1)>',current=clip('coached-ui',Date.now());current.trainingSession=session;current.trainingJoinedAt=current.createdAt;
 f.api.setup([current],current);f.api.provider(async payload=>{f.requests.push(payload);return coachedReport(session,{positive:'保持住的动作 '+marker,follow:null});});await f.api.analyzeCurrent();
 assert.equal(f.requests[0].coachingPlan.session.id,session.id);assert.equal(current.analysis.analysis.schemaVersion,7);
 const result=f.nodes.analysisResult,text=result.textContent;assert.match(text,/保持住的动作/);assert.match(text,/本组同一检查标准/);assert.match(text,/一次做到|下一跳开始核对/);assert.match(text,/本次练习方式/);assert.ok(!f.htmlWrites.some(value=>value.includes(marker)));
 const details=result.children.find(child=>child.className==='stage-details');assert.ok(details);assert.notEqual(details.open,true);assert.match(details.textContent,/助滑/);assert.match(details.textContent,/腾空/);assert.ok(text.indexOf('保持住的动作')<text.indexOf('总体分析'));
 const section=result.children.find(child=>child.className==='practice-feeling'),buttons=section.children.find(child=>child.className==='feeling-options');await buttons.children[2].onclick();assert.equal(current.practiceFeeling,'harder');assert.equal(f.requests.length,1);
 const rendered=f.nodes.analysisResult.children.find(child=>child.className==='practice-feeling').children.find(child=>child.className==='feeling-options');assert.equal(rendered.children[2]['aria-pressed'],'true');await rendered.children[2].onclick();assert.equal(current.practiceFeeling,undefined);assert.equal(f.requests.length,1);
});

test('a delayed training assignment cannot overwrite the title of another selected clip',async()=>{
 const f=fixture(),gate=deferred();setTraining(f);
 const old=clip('assign-delayed',1000),other=clip('other-selected',2000,{analysis:report({type:'转体',follow:null})});f.api.setup([other,old],old);await f.api.selectRecord(old);
 f.api.save(()=>gate.promise);const assigning=f.api.assignCurrentTraining();await f.api.selectRecord(other);assert.equal(f.nodes.clipTitle.textContent,'转体');
 gate.resolve(true);await assigning;assert.equal(f.api.snapshot().current,other);assert.equal(f.nodes.clipTitle.textContent,'转体');assert.equal(other.trainingSession,undefined);
});

for(const outcome of ['success','failed','cancelled'])test(`practice feeling controls are usable after ${outcome} analysis completes`,async()=>{
 const f=fixture(),session=setTraining(f),current=clip('feeling-boundary-'+outcome,Date.now()),gate=deferred();current.trainingSession=session;current.trainingJoinedAt=current.createdAt;
 const oldReport=outcome==='success'?null:coachedReport(session,{follow:null});current.analysis=oldReport;
 if(oldReport)current.practiceFeeling='same';
 f.api.setup([current],current);await f.api.selectRecord(current);
 f.api.provider(payload=>{f.requests.push(payload);return gate.promise;});
 const pending=f.api.analyzeCurrent();await settleUntil(()=>f.requests.length===1);assert.equal(f.api.snapshot().analysisBusy,true);assert.equal(f.nodes.analysisResult.hidden,true);
 if(outcome==='success')gate.resolve(coachedReport(session,{follow:null}));
 else{if(outcome==='cancelled')f.nodes.cancelAnalysisBtn.onclick();gate.reject(outcome==='cancelled'?new DOMException('Cancelled','AbortError'):new Error('Provider failed'));}
 await pending;assert.equal(f.api.snapshot().analysisBusy,false);assert.equal(f.nodes.analysisResult.hidden,false);
 if(oldReport){assert.equal(current.analysis,oldReport);assert.equal(current.practiceFeeling,'same');}
 const section=f.nodes.analysisResult.children.find(child=>child.className==='practice-feeling'),buttons=section.children.find(child=>child.className==='feeling-options');
 assert.ok(buttons.children.every(button=>button.disabled===false),'settled results must release their native disabled controls');
 await buttons.children[2].onclick();assert.equal(current.practiceFeeling,'harder');assert.equal(f.requests.length,1,'saving a feeling must not make a new model request');
});

test('review downloads the original video when native file sharing is unavailable',async()=>{
 const f=fixture(),item=clip('download',1);f.api.setup([item],item);await f.api.selectRecord(item);
 assert.equal(f.nodes.shareVideoBtn.disabled,false);assert.equal(f.nodes.shareVideoBtn.textContent,'下载原片');
 await f.nodes.shareVideoBtn.onclick();
 assert.equal(f.downloads.length,1);const [{name,url}]=f.downloads;
 try{
  assert.match(name,/\.mp4$/);
  const downloaded=await fetch(url).then(response=>response.blob());
  assert.equal(downloaded.type,item.blob.type);assert.equal(await downloaded.text(),await item.blob.text());
 }finally{URL.revokeObjectURL(url);}
});

test('review opens the system save menu when the original video can be shared',async()=>{
 const shared=[],f=fixture({navigator:{canShare:({files})=>files[0].type==='video/mp4',share:async payload=>shared.push(payload)}});
 const item=clip('share',1);f.api.setup([item],item);await f.api.selectRecord(item);
 assert.equal(f.nodes.shareVideoBtn.disabled,false);assert.equal(f.nodes.shareVideoBtn.textContent,'保存到相册');
 await f.nodes.shareVideoBtn.onclick();assert.equal(f.downloads.length,0);assert.equal(shared.length,1);
 assert.equal(await shared[0].files[0].text(),await item.blob.text());
});
