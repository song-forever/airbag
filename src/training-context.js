const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const goalText=value=>typeof value==='string'?value.trim().replace(/\s+/g,' '):'';
const cueText=(value,max)=>typeof value==='string'&&value.trim()&&value.trim().length<=max?value.trim():null;
const actionTypes=['直飞','抓板','转体','转体抓板','其他','无法判断'];
const knownLegacyTypes=actionTypes.slice(0,4);
const masteryLevels=['','初学','能做但不稳定','能稳定完成'];

export function normalizeJumpIntent(value){
 if(!object(value))return null;
 const {action='',mastery=''}=value;
 if(typeof action!=='string'||typeof mastery!=='string')return null;
 const plannedAction=action.trim(),selfAssessment=mastery.trim();
 if(plannedAction.length>60||!masteryLevels.includes(selfAssessment))return null;
 return plannedAction||selfAssessment?{action:plannedAction,mastery:selfAssessment}:null;
}

/** Exact goals keep different tricks, directions and explicit user focuses apart. */
export function goalKeyForRecord(record){
 const session=normalizeTrainingSession(record?.trainingSession);
 if(session)return JSON.stringify(['session',session.id]);
 if(record?.trainingSession!=null)return JSON.stringify(['invalid-session',String(record?.id??'')]);
 if(record?.actionMode==='auto')return JSON.stringify(['auto']);
 return JSON.stringify([
  goalText(record?.actionType)||goalText(record?.action),
  goalText(record?.actionDetail),
  goalText(record?.focus),
 ]);
}

function focusSnapshot(value,record){
 const attemptTime=trainingAttemptTime(record);
 if(!object(value)||typeof value.sourceId!=='string'||!value.sourceId.trim()||value.sourceId.length>256||value.sourceId===record?.id
  ||!Number.isFinite(value.sourceCreatedAt)||value.sourceCreatedAt<0||attemptTime===null||value.sourceCreatedAt>=attemptTime)return null;
 const instruction=cueText(value.instruction,160),check=cueText(value.check,200);
 if(!instruction||!check||(Object.hasOwn(value,'actionType')&&!actionTypes.includes(value.actionType)))return null;
 return {sourceId:value.sourceId,sourceCreatedAt:value.sourceCreatedAt,instruction,check,...(Object.hasOwn(value,'actionType')?{actionType:value.actionType}:{})};
}

function sourceActionType(candidate){
 const analysis=candidate.analysis?.analysis;
 if(actionTypes.includes(analysis?.practiceActionType))return analysis.practiceActionType;
 if(actionTypes.includes(analysis?.recognizedAction?.type))return analysis.recognizedAction.type;
 const legacy=goalText(candidate.actionType),action=goalText(candidate.action);
 return knownLegacyTypes.includes(legacy)?legacy:knownLegacyTypes.includes(action)?action:'无法判断';
}

/** Freeze this returned snapshot only after a successful analysis of the record. */
export function getTrainingContext(record,records=[]){
 const session=normalizeTrainingSession(record?.trainingSession),attemptTime=trainingAttemptTime(record);
 const goalKey=goalKeyForRecord(record),empty={goalKey,previousFocus:null},automatic=record?.actionMode==='auto';
 const finish=context=>session?{...context,coachingPlan:buildCoachingPlan(record,records,context.previousFocus)}:context;
 if(record?.trainingSession!=null&&!session)return empty;
 const saved=record?.trainingContext;
 const savedSession=normalizeTrainingSession(saved?.coachingPlan?.session);
 if(object(saved)&&saved.goalKey===goalKey&&Object.hasOwn(saved,'previousFocus')
  &&(!session||JSON.stringify(savedSession)===JSON.stringify(session))){
  if(saved.previousFocus===null)return finish(empty);
  const previousFocus=focusSnapshot(saved.previousFocus,record);
  if(previousFocus)return finish({goalKey,previousFocus});
 }
 if(attemptTime===null)return finish(empty);
 const earlier=(Array.isArray(records)?records:[]).filter(item=>object(item)&&item.id!==record.id&&trainingAttemptTime(item)!==null&&trainingAttemptTime(item)<attemptTime)
  .sort((a,b)=>trainingAttemptTime(b)-trainingAttemptTime(a)||(String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0));
 for(let index=0;index<earlier.length;){
  let end=index+1;while(end<earlier.length&&trainingAttemptTime(earlier[end])===trainingAttemptTime(earlier[index]))end++;
  const sameTime=earlier.slice(index,end);
  // A changed goal ends the run of related attempts, even if it has no report.
  // Equal timestamps cannot establish which goal came last, so also reset.
  if(!automatic&&!session&&sameTime.some(item=>goalKeyForRecord(item)!==goalKey))break;
  for(const candidate of sameTime){
   const candidateSession=normalizeTrainingSession(candidate.trainingSession);
   if(session?JSON.stringify(candidateSession)!==JSON.stringify(session):candidate.trainingSession!=null)continue;
   const report=candidate.analysis;
   if(!object(report)||(Object.hasOwn(report,'trainingGoalKey')&&report.trainingGoalKey!==goalKeyForRecord(candidate)))continue;
   if(session&&report.trainingGoalKey!==goalKey)continue;
   const next=report.analysis?.nextJump;
   const previousFocus=focusSnapshot({sourceId:candidate.id,sourceCreatedAt:trainingAttemptTime(candidate),instruction:next?.instruction,check:next?.check,...(automatic?{actionType:sourceActionType(candidate)}:{})},record);
   if(previousFocus)return finish({goalKey,previousFocus});
  }
  index=end;
 }
 return finish(empty);
}
import {normalizeTrainingSession,trainingAttemptTime} from './training-session.js?v=0.16.0';
import {buildCoachingPlan} from './coaching-plan.js?v=0.16.0';

