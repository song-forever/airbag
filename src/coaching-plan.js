import {normalizeTrainingSession,trainingAttemptTime} from './training-session.js?v=0.16.0';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max)=>typeof value==='string'&&value.trim()&&value.trim().length<=max?value.trim():null;
const taskFocus=value=>{
 const instruction=object(value)?text(value.instruction,160):null,check=object(value)?text(value.check,200):null;
 return instruction&&check?{instruction,check}:null;
};
const feeling=value=>['easier','same','harder'].includes(value)?value:null;
const sessionKey=session=>JSON.stringify(['session',session.id]);
const sameSession=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=1_000_000;
const freezeCatalog=items=>Object.freeze(items.map(item=>Object.freeze(item)));

export const COACHING_SOURCES=freezeCatalog([
 {title:'CASI：SAFE 渐进教学',url:'https://casi-acms.com/casi-interski/canada-day/'},
 {title:'CASI：视频回看与具体反馈',url:'https://casi-acms.com/casi-blog/video-analysis-as-a-teaching-tool/'},
 {title:'CASI：单板教学参考',url:'https://members.casi-acms.com/documents/Ref_Guide.pdf'},
]);

// Original teaching-method scaffolds. These are not sport-technique prescriptions
// or a claim that the exercises have been reviewed or endorsed by CASI.
export const PRACTICE_METHODS=freezeCatalog([
 {id:'review',title:'先理解这一件事',description:'先明确本轮只练什么、怎样检查，再用已经熟悉的动作尝试。',skillTheme:'单点练习'},
 {id:'repeat',title:'保持同一个重点',description:'沿用当前熟悉的动作，只围绕这一项检查标准练习，不同时增加新的任务。',skillTheme:'单点练习'},
 {id:'simplify',title:'把任务拆小再试',description:'先复习与当前检查标准有关的熟悉动作环节，用更简短的提示再尝试；不增加动作难度。',skillTheme:'单点练习'},
 {id:'consolidate',title:'重复巩固当前表现',description:'继续用同一检查标准积累练习，关注能否重复做到；一次成功不代表已经稳定掌握。',skillTheme:'单点练习'},
]);
const themes={straight:'站姿与平衡',grab:'时机与协调',rotation:'转向控制与时机','rotation-grab':'时机与协调'};
const methodFor=(session,id)=>({...PRACTICE_METHODS.find(item=>item.id===id),skillTheme:themes[session.goal]});
const emptyProgress=()=>({reviewed:0,done:0,partial:0,notYet:0,uncertain:0,consecutiveDone:0,consecutiveNeedsWork:0});

function reportDetails(record,session){
 if(!object(record)||!text(record.id,256))return null;
 const snapshot=normalizeTrainingSession(record.trainingSession),report=record.analysis,a=report?.analysis;
 if(!snapshot||!sameSession(snapshot,session)||!object(report)||a?.schemaVersion!==7
  ||report.trainingGoalKey!==sessionKey(snapshot)||record.trainingContext?.goalKey!==sessionKey(snapshot)
  ||!sameSession(normalizeTrainingSession(a.coaching?.session),snapshot))return null;
 const check=text(a.nextJump?.check,200),time=trainingAttemptTime(record);
 if(!check||!text(a.nextJump?.instruction,160)||time===null)return null;
 const follow=a.followUp,prior=record.trainingContext?.previousFocus;
 const validOutcome=object(follow)&&['done','partial','not_yet','uncertain'].includes(follow.status)
  &&!!text(follow.observation,400)&&text(prior?.check,200)===check
  &&!!text(prior?.sourceId,256)&&prior.sourceId!==record.id
  &&Number.isFinite(prior.sourceCreatedAt)&&prior.sourceCreatedAt>=0&&prior.sourceCreatedAt<time;
 return {id:record.id,time,check,status:validOutcome?follow.status:null,feeling:feeling(record.practiceFeeling)};
}

function eligibleRows(record,records,check,includeCurrent=false){
 const session=normalizeTrainingSession(record?.trainingSession),at=trainingAttemptTime(record);
 if(!session||at===null||!check)return [];
 const unique=new Map(),conflicts=new Set();
 for(const candidate of Array.isArray(records)?records:[]){
  if(candidate?.id===record.id)continue;
  const row=reportDetails(candidate,session);
  if(!row||row.check!==check||row.time>=at||conflicts.has(row.id))continue;
  const existing=unique.get(row.id);
  if(existing&&JSON.stringify(existing)!==JSON.stringify(row)){unique.delete(row.id);conflicts.add(row.id);}
  else unique.set(row.id,row);
 }
 if(includeCurrent){const own=reportDetails(record,session);if(own?.check===check)unique.set(own.id,own);}
 return [...unique.values()].sort((a,b)=>b.time-a.time||a.id.localeCompare(b.id));
}

function progressFor(rows){
 const progress=emptyProgress(),outcomes=rows.filter(row=>row.status);
 progress.reviewed=outcomes.length;
 for(const row of outcomes)progress[{done:'done',partial:'partial',not_yet:'notYet',uncertain:'uncertain'}[row.status]]++;
 // Timestamp peers have no known order. A mixed bucket cannot establish a
 // consecutive outcome; unknown evidence also breaks either visible streak.
 let kind=null;
 for(let start=0;start<outcomes.length;){
  let end=start+1;while(end<outcomes.length&&outcomes[end].time===outcomes[start].time)end++;
  const bucket=outcomes.slice(start,end);
  const category=bucket.every(row=>row.status==='done')?'done'
   :bucket.every(row=>row.status==='partial'||row.status==='not_yet')?'needsWork':null;
  if(!category||(kind!==null&&category!==kind))break;
  kind=category;
  progress[kind==='done'?'consecutiveDone':'consecutiveNeedsWork']+=bucket.length;
  start=end;
 }
 return progress;
}

function recentFeeling(rows){
 if(!rows.length)return null;
 const latest=rows.filter(row=>row.time===rows[0].time),value=latest[0].feeling;
 return value&&latest.every(row=>row.feeling===value)?value:null;
}

function chooseMethod(session,progress,previousFeeling,hasFocus){
 if(previousFeeling==='harder'||progress.consecutiveNeedsWork>=2)return 'simplify';
 if(session.stage==='initiation')return 'review';
 if(progress.consecutiveDone>0||session.stage==='consolidation')return 'consolidate';
 return hasFocus?'repeat':'review';
}

export function buildCoachingPlan(record,records=[],previousFocus=null){
 const session=normalizeTrainingSession(record?.trainingSession);
 if(!session)return null;
 // A first report has no previous attempt to evaluate. Its established task
 // nevertheless survives reanalysis; this anchor is never a self-follow-up.
 const focus=taskFocus(previousFocus)||(reportDetails(record,session)?taskFocus(record.analysis.analysis.nextJump):null);
 const rows=eligibleRows(record,records,focus?.check);
 const progress=progressFor(rows),previousFeeling=recentFeeling(rows);
 return {session,method:methodFor(session,chooseMethod(session,progress,previousFeeling,!!focus)),progress,previousFeeling,focus};
}

export function getTrainingProgress(record,records=[]){
 const session=normalizeTrainingSession(record?.trainingSession),own=session?reportDetails(record,session):null;
 return own?progressFor(eligibleRows(record,records,own.check,true)):emptyProgress();
}

/** The provider receives bounded program context, never arbitrary method prose. */
export function normalizeCoachingPlan(value){
 if(!object(value))return null;
 const session=normalizeTrainingSession(value.session),p=value.progress;
 if(!session||!object(p)||!object(value.method)||!PRACTICE_METHODS.some(item=>item.id===value.method.id))return null;
 const progress=emptyProgress();
 for(const field of Object.keys(progress)){if(!count(p[field]))return null;progress[field]=p[field];}
 if(progress.reviewed!==progress.done+progress.partial+progress.notYet+progress.uncertain
  ||progress.consecutiveDone>progress.done||progress.consecutiveNeedsWork>progress.partial+progress.notYet
  ||(progress.consecutiveDone>0&&progress.consecutiveNeedsWork>0))return null;
 const previousFeeling=value.previousFeeling??null;
 if(previousFeeling!==null&&!feeling(previousFeeling))return null;
 const focus=taskFocus(value.focus);
 if(value.focus!=null&&!focus)return null;
 return {session,method:methodFor(session,value.method.id),progress,previousFeeling,focus};
}
