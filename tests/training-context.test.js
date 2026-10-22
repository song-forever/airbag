import test from 'node:test';
import assert from 'node:assert/strict';
import {getTrainingContext,goalKeyForRecord} from '../src/training-context.js';

const cue={instruction:'减少腾空时多余的手臂摆动。',check:'回看腾空时手臂是否保持稳定。'};
function record(id,createdAt,overrides={}){
 return {id,createdAt,actionType:'直飞',actionDetail:'',focus:'',...overrides};
}
function analyzed(id,createdAt,overrides={}){
 return record(id,createdAt,{analysis:{analysis:{schemaVersion:3,nextJump:{...cue,reason:'本跳可见的动作依据。',time:null}},model:'qwen3-vl-plus'},...overrides});
}

test('the next analysis automatically receives only the closest earlier successful cue',()=>{
 const first=analyzed('first',10),previous=analyzed('previous',20),current=record('current',30),future=analyzed('future',40);
 previous.analysis.apiKey='do-not-carry';previous.blob={secret:'video'};
 const context=getTrainingContext(current,[future,first,current,previous]);
 assert.deepEqual(context,{goalKey:goalKeyForRecord(current),previousFocus:{sourceId:'previous',sourceCreatedAt:20,...cue}});
 assert.equal(JSON.stringify(context).includes('do-not-carry'),false);assert.equal(JSON.stringify(context).includes('video'),false);
});

test('reanalyzing an old jump cannot inherit its own report, a future report or a timestamp peer',()=>{
 const current=analyzed('current',20);
 assert.equal(getTrainingContext(current,[current,analyzed('later',30),analyzed('peer',20)]).previousFocus,null);
 assert.equal(getTrainingContext(current,[current,analyzed('old',10),analyzed('later',30)]).previousFocus.sourceId,'old');
});

test('unanalyzed same-goal attempts do not lose the most recent available training point',()=>{
 const context=getTrainingContext(record('next',30),[record('unreviewed',20),analyzed('last-analyzed',10)]);
 assert.equal(context.previousFocus.sourceId,'last-analyzed');
});

test('switching the action, detail or explicit focus ends continuity, including A to B to A',()=>{
 const current=record('next-A',40),old=analyzed('old-A',10);
 for(const change of [{actionType:'抓板'},{actionDetail:'新的动作细节'},{focus:'不同关注点'}]){
  assert.equal(getTrainingContext(current,[old,record('middle-B',20,change)]).previousFocus,null);
 }
 const latest=analyzed('new-A',30);
 assert.equal(getTrainingContext(current,[record('middle-B',20,{actionType:'抓板'}),old,latest]).previousFocus.sourceId,'new-A');
});

test('matching goals normalize whitespace but do not merge different trick names or angles',()=>{
 const a=record('a',1,{actionType:' 转体 ',actionDetail:' 正脚   180 ',focus:' 手臂\n稳定 '}),b=record('b',2,{actionType:'转体',actionDetail:'正脚 180',focus:'手臂 稳定'});
 assert.equal(goalKeyForRecord(a),goalKeyForRecord(b));
 assert.notEqual(goalKeyForRecord(a),goalKeyForRecord({...b,actionDetail:'正脚 360'}));
 assert.equal(goalKeyForRecord({action:'直飞'}),goalKeyForRecord(record('c',3)));
});

test('a frozen source snapshot survives deletion, source reanalysis and caller mutation',()=>{
 const source=analyzed('previous',10),current=record('current',20);
 current.trainingContext=getTrainingContext(current,[source]);
 source.analysis.analysis.nextJump.instruction='修改后的旧报告';
 const restored=getTrainingContext(current,[]);
 assert.equal(restored.previousFocus.instruction,cue.instruction);
 restored.previousFocus.instruction='调用方修改';
 assert.equal(current.trainingContext.previousFocus.instruction,cue.instruction);
});

test('a frozen first analysis remains first even if an older jump is imported or analyzed later',()=>{
 const current=record('first',20);current.trainingContext=getTrainingContext(current,[]);
 assert.equal(getTrainingContext(current,[analyzed('late-old',10)]).previousFocus,null);
 const changed={...current,actionType:'抓板'};
 assert.equal(getTrainingContext(changed,[analyzed('new-goal-old',10,{actionType:'抓板'})]).previousFocus.sourceId,'new-goal-old');
});

test('malformed or stale prior reports are skipped without carrying invalid cues',()=>{
 const valid=analyzed('valid',10),current=record('next',30);
 for(const nextJump of [null,{}, {...cue,instruction:' '},{...cue,instruction:'x'.repeat(161)},{...cue,check:'x'.repeat(201)}]){
  const malformed=analyzed('invalid',20,{analysis:{analysis:{nextJump}}});
  assert.equal(getTrainingContext(current,[malformed,valid]).previousFocus.sourceId,'valid');
 }
 const stale=analyzed('stale',20);stale.analysis.trainingGoalKey=goalKeyForRecord({...stale,actionType:'抓板'});
 assert.equal(getTrainingContext(current,[stale,valid]).previousFocus.sourceId,'valid');
});

test('malformed stored snapshots fall back to safe history selection',()=>{
 const previous=analyzed('previous',10),current=record('current',20),goalKey=goalKeyForRecord(current);
 for(const previousFocus of [{sourceId:'current',sourceCreatedAt:10,...cue},{sourceId:'future',sourceCreatedAt:30,...cue},{sourceId:'previous',sourceCreatedAt:10,...cue,check:''}]){
  current.trainingContext={goalKey,previousFocus};
  assert.equal(getTrainingContext(current,[previous]).previousFocus.sourceId,'previous');
 }
 current.trainingContext={goalKey,previousFocus:{sourceId:'previous',sourceCreatedAt:10,...cue,apiKey:'secret',video:'extra'}};
 assert.deepEqual(Object.keys(getTrainingContext(current,[]).previousFocus),['sourceId','sourceCreatedAt','instruction','check']);
});

test('capture/import source and model changes do not reset an otherwise identical goal',()=>{
 const previous=analyzed('previous',10,{source:'camera'}),current=record('current',20,{source:'import'});
 current.model='another-model';assert.equal(getTrainingContext(current,[previous]).previousFocus.sourceId,'previous');
});

test('ambiguous equal-timestamp goal changes reset instead of guessing order',()=>{
 const current=record('next',30),a=analyzed('a',20),b=record('b',20,{actionType:'抓板'});
 assert.equal(getTrainingContext(current,[a,b]).previousFocus,null);assert.equal(getTrainingContext(current,[b,a]).previousFocus,null);
});

test('automatic recognition has a stable goal independent of the current unknown action fields',()=>{
 const first=record('first',10,{actionMode:'auto',actionType:'无法判断',focus:'旧关注点'}),next=record('next',20,{actionMode:'auto',actionType:'转体',actionDetail:'180'});
 assert.equal(goalKeyForRecord(first),JSON.stringify(['auto']));assert.equal(goalKeyForRecord(first),goalKeyForRecord(next));
 assert.notEqual(goalKeyForRecord(first),goalKeyForRecord(record('manual',30)));
});

test('automatic mode uses the nearest analyzed cue across manual goal changes and unanalyzed attempts',()=>{
 const straight=analyzed('straight',10),grab=analyzed('grab',20,{actionType:'抓板'}),unreviewed=record('unreviewed',30,{actionType:'转体'}),current=record('auto-next',40,{actionMode:'auto',actionType:'无法判断'});
 grab.analysis.trainingGoalKey=goalKeyForRecord(grab);
 const context=getTrainingContext(current,[straight,current,unreviewed,grab]);
 assert.deepEqual(context.previousFocus,{sourceId:'grab',sourceCreatedAt:20,...cue,actionType:'抓板'});
});

test('automatic cue lineage prefers practice action type even when the last jump itself was uncertain',()=>{
 const previous=analyzed('previous-auto',10,{actionMode:'auto',actionType:'无法判断'}),current=record('next-auto',20,{actionMode:'auto'});
 previous.analysis.analysis.practiceActionType='转体抓板';previous.analysis.analysis.recognizedAction={type:'无法判断'};
 previous.analysis.trainingGoalKey=goalKeyForRecord(previous);
 assert.equal(getTrainingContext(current,[previous]).previousFocus.actionType,'转体抓板');
 previous.analysis.analysis.practiceActionType='无法判断';previous.analysis.analysis.recognizedAction={type:'抓板'};
 assert.equal(getTrainingContext(current,[previous]).previousFocus.actionType,'无法判断');
});

test('automatic cue type falls back to recognized action, known legacy action and finally unknown',()=>{
 const previous=analyzed('previous',10,{actionMode:'auto',actionType:'自定义'}),current=record('next',20,{actionMode:'auto'});
 previous.analysis.analysis.recognizedAction={type:'转体'};
 assert.equal(getTrainingContext(current,[previous]).previousFocus.actionType,'转体');
 delete previous.analysis.analysis.recognizedAction;previous.actionType='抓板';
 assert.equal(getTrainingContext(current,[previous]).previousFocus.actionType,'抓板');
 delete previous.actionType;previous.action='转体抓板';
 assert.equal(getTrainingContext(current,[previous]).previousFocus.actionType,'转体抓板');
 previous.action='自定义动作';
 const unknown=getTrainingContext(current,[previous]).previousFocus;
 assert.equal(unknown.actionType,'无法判断');assert.equal(unknown.instruction,cue.instruction);
});

test('automatic selection validates historical goal stamps against each source rather than the auto group',()=>{
 const first=analyzed('valid-manual',10,{actionType:'抓板'}),stale=analyzed('stale',20,{actionType:'转体'}),current=record('next',30,{actionMode:'auto'});
 first.analysis.trainingGoalKey=goalKeyForRecord(first);stale.analysis.trainingGoalKey=goalKeyForRecord({...stale,actionType:'直飞'});
 assert.equal(getTrainingContext(current,[stale,first]).previousFocus.sourceId,'valid-manual');
});

test('automatic snapshots freeze cue action type after source reanalysis, deletion or current action inference',()=>{
 const previous=analyzed('previous',10,{actionMode:'auto'}),current=record('next',20,{actionMode:'auto',actionType:'无法判断'});
 previous.analysis.analysis.practiceActionType='抓板';current.trainingContext=getTrainingContext(current,[previous]);
 previous.analysis.analysis.practiceActionType='转体';current.actionType='直飞';
 const restored=getTrainingContext(current,[]);
 assert.equal(restored.previousFocus.actionType,'抓板');assert.equal(restored.previousFocus.instruction,cue.instruction);
 restored.previousFocus.actionType='转体';assert.equal(current.trainingContext.previousFocus.actionType,'抓板');
});

test('automatic first-report snapshots remain first and cannot inherit from self, peers or future jumps',()=>{
 const current=analyzed('current',20,{actionMode:'auto'}),peer=analyzed('peer',20),future=analyzed('future',30);
 assert.equal(getTrainingContext(current,[future,current,peer]).previousFocus,null);
 current.trainingContext=getTrainingContext(current,[]);
 assert.equal(getTrainingContext(current,[analyzed('late-old',10)]).previousFocus,null);
});

test('optional source action hints are whitelisted and malformed frozen hints are not trusted',()=>{
 const previous=analyzed('previous',10),current=record('next',20,{actionMode:'auto'}),goalKey=goalKeyForRecord(current);
 current.trainingContext={goalKey,previousFocus:{sourceId:'older',sourceCreatedAt:5,...cue,actionType:'编造动作',apiKey:'secret'}};
 const recovered=getTrainingContext(current,[previous]);
 assert.equal(recovered.previousFocus.sourceId,'previous');assert.equal(recovered.previousFocus.actionType,'直飞');assert.equal(JSON.stringify(recovered).includes('secret'),false);
});
