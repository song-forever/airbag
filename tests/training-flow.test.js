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
const followUp={status:'done',observation:'本跳能看到上一跳所选动作已保持。',time:.4};
function report({schemaVersion=5,instruction='下一跳保持双手在身前',check='回看腾空时双手仍在身前',follow=followUp,type='直飞',description='本跳可见保持板身朝向前方。',relation=follow?'same':'none',practiceActionType=type}={}){
 return {model:'qwen3.7-plus',frameCount:4,usage:{},analysis:{schemaVersion,stages:phaseNames.map(phase=>({phase,analysis:phase+'可见表现',time:null})),nextJump:{instruction,reason:'这是本跳最明确且易于执行的动作。',check,time:null},...(schemaVersion>=4?{followUp:follow}:{}),...(schemaVersion===5?{recognizedAction:{type,description,time:.4},focusRelation:relation,practiceActionType}:{})}};
}
function clip(id,createdAt,{actionType='直飞',actionDetail='',focus='',analysis=null,actionMode='auto'}={}){
 const item={id,createdAt,actionMode,actionType,actionDetail,focus,action:actionType+(actionDetail?' · '+actionDetail:''),source:'camera',blob:new Blob(['clip'],{type:'video/mp4'}),duration:6,width:720,height:1280,trimStart:0,trimEnd:6,note:'本机测试',keyframes:[],analysis};
 if(analysis&&imported.getTrainingContext)analysis.trainingGoalKey=imported.getTrainingContext(item,[]).goalKey;
 return item;
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function settleUntil(predicate){for(let i=0;i<60&&!predicate();i++)await Promise.resolve();assert.ok(predicate(),'expected analysis pipeline boundary');}
function fixture(){
 const htmlWrites=[];
 class Element extends EventTarget{
  constructor(id=''){super();this.id=id;this.children=[];this._text='';this.hidden=false;this.disabled=false;this.value='';this.dataset={};this.style={};this.checked=false;this.paused=true;this.classList={add(){},remove(){},toggle(){}};}
  set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>typeof child==='string'?child:child.textContent).join('');}
  set innerHTML(value){htmlWrites.push(String(value));this._text='';this.children=[];}get innerHTML(){return '';}
  append(...children){this.children.push(...children);}prepend(...children){this.children.unshift(...children);}replaceChildren(...children){this._text='';this.children=children;}
  setAttribute(name,value){this[name]=String(value);}removeAttribute(name){delete this[name];}load(){}pause(){this.paused=true;}async play(){this.paused=false;}showModal(){}close(){}click(){}remove(){}
  getContext(){return {clearRect(){},drawImage(){},getImageData(){return {data:new Uint8Array(160*90*4)};}};}
 }
 const nodes=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
 const document=new EventTarget();document.hidden=false;document.body=new Element();document.getElementById=id=>nodes[id];document.createElement=tag=>new Element(tag);
 document.querySelectorAll=query=>query==='[id]'?Object.values(nodes):[];
 const window=new EventTarget();window.scrollTo=()=>{};
 const events=[],requests=[],saved=[];let timerId=0;
 const globals={...imported,document,window,navigator:{},console,Blob,URL,DOMException,AbortController,Event,devicePixelRatio:1,performance:{now:()=>1000},localStorage:{getItem:()=>null,setItem(){}},confirm:()=>true,setTimeout:()=>++timerId,clearTimeout(){},setInterval:()=>++timerId,clearInterval(){},saved};
 if(imported.getTrainingContext)globals.getTrainingContext=(...args)=>{events.push('context');return imported.getTrainingContext(...args);};
 const context=vm.createContext(globals);
 vm.runInContext(source.replace(/^import[^\n]+\n/gm,'').replaceAll('import.meta.url',JSON.stringify(appUrl.href))+`\nthis.testAPI={
  analyzeCurrent,selectRecord,renderAnalysis,
  setup:(items,selected)=>{records=items;current=selected;apiKey='sk-local-test-only';autoAnalyze=true;},
  provider:fn=>{analyzeFrames=fn;}, extractor:fn=>{extractFrames=fn;},
  replaceHistory:items=>{records=items;},snapshot:()=>({current,records,analysisBusy}),
  save:fn=>{persistRecord=fn;}
 };`,context);
 const api=context.testAPI;
 api.extractor(async()=>{events.push('extract');return frames;});
 api.provider(async payload=>{events.push('provider');requests.push(payload);return report({follow:payload.previousFocus?followUp:null});});
 api.save(async record=>{events.push('persist');saved.push(structuredClone(record));return true;});
 return {api,nodes,events,requests,saved,htmlWrites};
}

test('the next jump sends one prior cue selected once before extraction, then saves its successful snapshot',async()=>{
 const previous=clip('first',1000,{analysis:report({schemaVersion:3,instruction:'起跳时保持双手在身前',check:'离台时双手仍在身前'})});
 const current=clip('second',2000),f=fixture();f.api.setup([current,previous],current);
 f.api.extractor(async()=>{f.events.push('extract');previous.analysis.analysis.nextJump.instruction='抽帧期间源建议被修改';return frames;});
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
  f.nodes.trimStart.value='1.5';f.nodes.trimLabel.textContent='1.5–6.0 秒';return frames;
 });
 f.api.provider(async()=>{throw new Error('模型读取失败');});await f.api.analyzeCurrent();
 assert.equal(current.trimStart,0);assert.equal(current.trimEnd,6);assert.equal(current.contentStart,.3);assert.equal(current.contentStartConfirmed,false);
 assert.equal(f.nodes.trimStart.value,'0.0');assert.equal(f.nodes.trimEnd.value,'6.0');assert.equal(f.nodes.trimLabel.textContent,'0.0–6.0 秒');
 assert.equal(current.analysis,oldReport);assert.equal(current.trainingContext,oldContext);assert.equal(current.keyframes,oldKeyframes);
 assert.equal(f.saved.length,0);assert.ok(f.nodes.analysisResult.textContent.includes('原来的下一跳建议'));
});
