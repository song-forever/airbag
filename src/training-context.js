const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const goalText=value=>typeof value==='string'?value.trim().replace(/\s+/g,' '):'';
const cueText=(value,max)=>typeof value==='string'&&value.trim()&&value.trim().length<=max?value.trim():null;
const actionTypes=['直飞','抓板','转体','转体抓板','其他','无法判断'];
const knownLegacyTypes=actionTypes.slice(0,4);

/** Exact goals keep different tricks, directions and explicit user focuses apart. */
export function goalKeyForRecord(record){
 if(record?.actionMode==='auto')return JSON.stringify(['auto']);
 return JSON.stringify([
  goalText(record?.actionType)||goalText(record?.action),
  goalText(record?.actionDetail),
  goalText(record?.focus),
 ]);
}

function focusSnapshot(value,record){
 if(!object(value)||typeof value.sourceId!=='string'||!value.sourceId.trim()||value.sourceId.length>256||value.sourceId===record?.id
  ||!Number.isFinite(value.sourceCreatedAt)||value.sourceCreatedAt<0||!Number.isFinite(record?.createdAt)||value.sourceCreatedAt>=record.createdAt)return null;
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
 const goalKey=goalKeyForRecord(record),empty={goalKey,previousFocus:null},automatic=record?.actionMode==='auto';
 const saved=record?.trainingContext;
 if(object(saved)&&saved.goalKey===goalKey&&Object.hasOwn(saved,'previousFocus')){
  if(saved.previousFocus===null)return empty;
  const previousFocus=focusSnapshot(saved.previousFocus,record);
  if(previousFocus)return {goalKey,previousFocus};
 }
 if(!Number.isFinite(record?.createdAt))return empty;
 const earlier=(Array.isArray(records)?records:[]).filter(item=>object(item)&&item.id!==record.id&&Number.isFinite(item.createdAt)&&item.createdAt>=0&&item.createdAt<record.createdAt)
  .sort((a,b)=>b.createdAt-a.createdAt||(String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0));
 for(let index=0;index<earlier.length;){
  let end=index+1;while(end<earlier.length&&earlier[end].createdAt===earlier[index].createdAt)end++;
  const sameTime=earlier.slice(index,end);
  // A changed goal ends the run of related attempts, even if it has no report.
  // Equal timestamps cannot establish which goal came last, so also reset.
  if(!automatic&&sameTime.some(item=>goalKeyForRecord(item)!==goalKey))break;
  for(const candidate of sameTime){
   const report=candidate.analysis;
   if(!object(report)||(Object.hasOwn(report,'trainingGoalKey')&&report.trainingGoalKey!==goalKeyForRecord(candidate)))continue;
   const next=report.analysis?.nextJump;
   const previousFocus=focusSnapshot({sourceId:candidate.id,sourceCreatedAt:candidate.createdAt,instruction:next?.instruction,check:next?.check,...(automatic?{actionType:sourceActionType(candidate)}:{})},record);
   if(previousFocus)return {goalKey,previousFocus};
  }
  index=end;
 }
 return empty;
}
