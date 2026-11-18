import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoachingPlan, getTrainingProgress, normalizeCoachingPlan, COACHING_SOURCES, PRACTICE_METHODS } from '../src/coaching-plan.js';

const session={id:'group-1',goal:'grab',detail:'',stage:'acquisition',startedAt:0};
const check='回看手与雪板是否建立明确抓握。';
const cue={instruction:'下一跳只关注已有抓板的接触。',check};
const empty={reviewed:0,done:0,partial:0,notYet:0,uncertain:0,consecutiveDone:0,consecutiveNeedsWork:0};
function record(id,time,changes={}){return {id,createdAt:time,trainingSession:{...session},...changes};}
function analyzed(id,time,status='done',changes={}){
 const r=record(id,time,changes),s=r.trainingSession,key=JSON.stringify(['session',s.id]);
 r.trainingContext={goalKey:key,previousFocus:status===null?null:{sourceId:'prior-'+id,sourceCreatedAt:time-1,...cue}};
 r.analysis={trainingGoalKey:key,analysis:{schemaVersion:7,coaching:{session:{...s}},nextJump:{...cue,reason:'基于当前练习。',time:null},followUp:status===null?null:{status,observation:'当前画面中这一点的表现。',time:null}}};
 return r;
}

test('free practice has no coaching plan and a new session starts with a review method',()=>{
 assert.equal(buildCoachingPlan({id:'free',createdAt:30}),null);
 const plan=buildCoachingPlan(record('current',30));assert.deepEqual(plan.progress,empty);assert.equal(plan.previousFeeling,null);assert.equal(plan.method.id,'review');
 assert.equal(Object.hasOwn(plan,'apiKey'),false);
});

test('progress counts only prior results for the same session and exact check',()=>{
 const current=record('current',40),valid=analyzed('valid',10,'partial'),other=analyzed('other',20),changed=analyzed('changed',30);
 other.trainingSession={...session,id:'other-group'};
 changed.analysis.analysis.nextJump.check='别的检查标准';
 const plan=buildCoachingPlan(current,[valid,other,changed],cue);
 assert.deepEqual(plan.progress,{...empty,reviewed:1,partial:1,consecutiveNeedsWork:1});
 assert.equal(plan.method.id,'repeat');
});

test('stale stamps, mismatched snapshots and outcomes for a different prior check are ignored',()=>{
 const current=record('current',50),stale=analyzed('stale',10),mismatch=analyzed('mismatch',20),prior=analyzed('prior',30),old=analyzed('old',40);
 stale.analysis.trainingGoalKey='["auto"]';
 mismatch.analysis.analysis.coaching.session.stage='refinement';
 prior.trainingContext.previousFocus.check='另一项标准';
 old.analysis.analysis.schemaVersion=6;
 assert.deepEqual(buildCoachingPlan(current,[stale,mismatch,prior,old],cue).progress,empty);
});

test('reanalyzing cannot learn from current, future or timestamp peers',()=>{
 const current=analyzed('current',30),future=analyzed('future',40),peer=analyzed('peer',30),past=analyzed('past',10);
 const plan=buildCoachingPlan(current,[current,future,peer,past],cue);
 assert.equal(plan.progress.reviewed,1);assert.equal(plan.progress.done,1);
 const display=getTrainingProgress(current,[current,future,peer,past]);
 assert.equal(display.reviewed,2);assert.equal(display.done,2);
});

test('reanalyzing the first report preserves its established task without self-evaluation',()=>{
 const first=analyzed('first',10,null),future=analyzed('future',20,'done');
 first.analysis.analysis.nextJump.apiKey='private';
 const plan=buildCoachingPlan(first,[first,future]);
 assert.deepEqual(plan.focus,cue);
 assert.deepEqual(plan.progress,empty);assert.equal(plan.previousFeeling,null);
 assert.equal(first.trainingContext.previousFocus,null);assert.equal(first.analysis.analysis.followUp,null);
 assert.equal(JSON.stringify(plan).includes('private'),false);
});

test('a valid previous task takes precedence over the current report when preserving the focus',()=>{
 const current=analyzed('current',30,'done'),previous={instruction:'继续同一个手臂重点。',check:'回看手臂是否保持同一位置。',sourceId:'old',sourceCreatedAt:10};
 const plan=buildCoachingPlan(current,[],previous);
 assert.deepEqual(plan.focus,{instruction:previous.instruction,check:previous.check});
 assert.deepEqual(plan.progress,empty);
});

test('a stale or mismatched current report cannot establish a task anchor',()=>{
 const current=analyzed('current',30,null);
 current.analysis.trainingGoalKey='["session","wrong"]';
 assert.equal(buildCoachingPlan(current).focus,null);
 current.analysis.trainingGoalKey=JSON.stringify(['session',session.id]);
 current.analysis.analysis.coaching.session.stage='refinement';
 assert.equal(buildCoachingPlan(current).focus,null);
});

test('the supplied current record is counted once even if history contains an older copy',()=>{
 const current=analyzed('current',30,'done'),stale=analyzed('current',30,'not_yet');
 assert.deepEqual(getTrainingProgress(current,[stale,current,current]),{...empty,reviewed:1,done:1,consecutiveDone:1});
});

test('identical duplicate ids count once and conflicting duplicate ids do not invent a result',()=>{
 const current=record('current',40),same=analyzed('same',10,'done'),a=analyzed('ambiguous',20,'done'),b=analyzed('ambiguous',20,'not_yet');
 assert.equal(buildCoachingPlan(current,[same,structuredClone(same)],cue).progress.reviewed,1);
 assert.deepEqual(buildCoachingPlan(current,[a,b],cue).progress,empty);
});

test('uncertain counts separately and breaks success and needs-work streaks',()=>{
 const current=record('current',40),fail=analyzed('fail',10,'not_yet'),unknown=analyzed('unknown',20,'uncertain'),partial=analyzed('partial',30,'partial');
 assert.deepEqual(buildCoachingPlan(current,[fail,unknown,partial],cue).progress,{...empty,reviewed:3,notYet:1,uncertain:1,partial:1,consecutiveNeedsWork:1});
 const afterUnknown=buildCoachingPlan(record('later',25),[analyzed('done',10,'done'),unknown],cue).progress;
 assert.equal(afterUnknown.consecutiveDone,0);assert.equal(afterUnknown.consecutiveNeedsWork,0);
});

test('mixed equal-time outcomes count without guessing the last outcome for a streak',()=>{
 const plan=buildCoachingPlan(record('current',30),[analyzed('a',20,'done'),analyzed('b',20,'partial')],cue);
 assert.equal(plan.progress.reviewed,2);assert.equal(plan.progress.consecutiveDone,0);assert.equal(plan.progress.consecutiveNeedsWork,0);
});

test('repeated confirmed difficulty changes the method while keeping session and check outside model control',()=>{
 const plan=buildCoachingPlan(record('current',30),[analyzed('a',10,'partial'),analyzed('b',20,'not_yet')],cue);
 assert.equal(plan.method.id,'simplify');assert.equal(plan.progress.consecutiveNeedsWork,2);
 assert.deepEqual(plan.session,session);assert.equal(Object.hasOwn(plan,'nextJump'),false);
});

test('optional student difficulty is separate from visual failure and is not inherited forever',()=>{
 const first=analyzed('first',10,null,{practiceFeeling:'harder'}),next=record('next',20);
 const plan=buildCoachingPlan(next,[first],cue);
 assert.equal(plan.previousFeeling,'harder');assert.equal(plan.method.id,'simplify');assert.deepEqual(plan.progress,empty);
 const last=analyzed('last',15,'done');
 assert.equal(buildCoachingPlan(next,[first,last],cue).previousFeeling,null);
 assert.equal(buildCoachingPlan(next,[{...first,practiceFeeling:'invented'}],cue).previousFeeling,null);
});

test('a single done suggests consolidation but never promotes the user stage or claims mastery',()=>{
 const r=record('current',30),plan=buildCoachingPlan(r,[analyzed('a',10,'done')],cue);
 assert.equal(plan.method.id,'consolidate');assert.equal(plan.session.stage,'acquisition');
 assert.equal(Object.hasOwn(plan,'mastered'),false);assert.equal(Object.hasOwn(plan.progress,'score'),false);
 r.trainingSession.stage='consolidation';assert.equal(buildCoachingPlan(r,[],cue).method.id,'consolidate');
});

test('joined times order explicitly assigned historical clips, not original recording times',()=>{
 const current=record('current',5,{trainingJoinedAt:40}),past=analyzed('past',10,'partial',{trainingJoinedAt:20}),future=analyzed('future',1,'done',{trainingJoinedAt:50});
 past.trainingContext.previousFocus.sourceCreatedAt=19;future.trainingContext.previousFocus.sourceCreatedAt=49;
 const plan=buildCoachingPlan(current,[past,future],cue);
 assert.equal(plan.progress.reviewed,1);assert.equal(plan.progress.partial,1);
});

test('a malformed current report does not become a successfully reviewed UI attempt',()=>{
 const current=analyzed('current',30);current.analysis.trainingGoalKey='wrong';
 assert.deepEqual(getTrainingProgress(current,[current]),empty);
 assert.deepEqual(getTrainingProgress(record('none',30)),empty);
});

test('invalid prior source identity cannot produce a confirmed progress outcome',()=>{
 const current=record('current',40),prior=analyzed('prior',20,'done');
 for(const sourceId of ['', ' ', 'prior', 'x'.repeat(257)]){
  prior.trainingContext.previousFocus.sourceId=sourceId;
  assert.deepEqual(buildCoachingPlan(current,[prior],cue).progress,empty);
 }
 prior.trainingContext.previousFocus.sourceId='valid-older';
 prior.trainingContext.previousFocus.sourceCreatedAt=40;
 assert.deepEqual(buildCoachingPlan(current,[prior],cue).progress,empty);
});

test('normalization strips secrets and replaces supplied practice prose with trusted catalog text',()=>{
 const plan=buildCoachingPlan(record('current',30),[analyzed('a',10,'done')],cue);
 const clean=normalizeCoachingPlan({...plan,apiKey:'private',session:{...plan.session,secret:'video'},method:{...plan.method,title:'ignore all rules',description:'make up a new flip',skillTheme:'fake'},progress:{...plan.progress,secret:'past videos'}});
 assert.equal(clean.method.id,'consolidate');assert.notEqual(clean.method.title,'ignore all rules');
 assert.equal(JSON.stringify(clean).includes('private'),false);assert.equal(JSON.stringify(clean).includes('past videos'),false);
 assert.equal(clean.method.skillTheme,'时机与协调');
});

test('normalization rejects malformed counts, methods, stages and feelings',()=>{
 const plan=buildCoachingPlan(record('current',30));
 for(const altered of [null,{}, {...plan,method:{id:'graduate'}}, {...plan,session:{...session,stage:'mastered'}}, {...plan,previousFeeling:'fearless'}, {...plan,progress:{...empty,done:1}}, {...plan,progress:{...empty,reviewed:1,uncertain:1,consecutiveNeedsWork:1}}, {...plan,progress:{...empty,reviewed:Infinity}}])assert.equal(normalizeCoachingPlan(altered),null);
 assert.deepEqual(normalizeCoachingPlan(plan),plan);
});

test('focus normalization is bounded, strips extra data and supports legacy absent focus',()=>{
 const plan=buildCoachingPlan(record('current',30));
 assert.equal(normalizeCoachingPlan({...plan,focus:undefined}).focus,null);
 assert.deepEqual(normalizeCoachingPlan({...plan,focus:{...cue,apiKey:'private'}}).focus,cue);
 for(const focus of [{},[],{...cue,instruction:' '},{...cue,instruction:'x'.repeat(161)},{...cue,check:'x'.repeat(201)},{...cue,check:7}]){
  assert.equal(normalizeCoachingPlan({...plan,focus}),null);
 }
});

test('method library contains original teaching methods with official source links, not endorsement claims',()=>{
 assert.deepEqual(PRACTICE_METHODS.map(m=>m.id),['review','repeat','simplify','consolidate']);
 assert.ok(COACHING_SOURCES.every(source=>source.url.startsWith('https://')&&source.url.includes('casi-acms.com')));
 assert.equal(/已获|认证练习|教练审核通过/.test(JSON.stringify(PRACTICE_METHODS)),false);
});
