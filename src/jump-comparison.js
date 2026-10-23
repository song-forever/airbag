import {goalKeyForRecord} from './training-context.js?v=0.9.0';

const actionTypes=['直飞','抓板','转体','转体抓板'];
const phases=['助滑','上台','起跳','腾空'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

function reportFor(record){
 const report=record?.analysis;
 if(!object(report)||!object(report.analysis)||![2,3,4,5,6].includes(report.analysis.schemaVersion))return null;
 if(Object.hasOwn(report,'trainingGoalKey')&&report.trainingGoalKey!==goalKeyForRecord(record))return null;
 return report.analysis;
}

function actualAction(record){
 const report=reportFor(record);
 if(!report)return null;
 // Stored goals and retained training cues are not evidence of the observed action.
 return actionTypes.includes(report.recognizedAction?.type)?report.recognizedAction.type:null;
}

function videoRange(record){
 const blob=record?.blob,duration=record?.duration;
 if(!blob||!Number.isFinite(blob.size)||blob.size<=0||typeof blob.slice!=='function'||!Number.isFinite(duration)||duration<=0)return null;
 const start=Number.isFinite(record.trimStart)?Math.max(0,Math.min(duration,record.trimStart)):0;
 const end=Number.isFinite(record.trimEnd)?Math.max(0,Math.min(duration,record.trimEnd)):duration;
 return end>start?{start,end,anchor:start}:null;
}

/** Use the closest earlier comparable video, independently of frozen cue lineage. */
export function findComparisonRecord(current,records=[]){
 const action=actualAction(current);
 if(!action||!videoRange(current)||!Number.isFinite(current?.createdAt)||current.createdAt<0)return null;
 const candidates=(Array.isArray(records)?records:[]).filter(record=>record?.id!==current.id
  &&typeof record?.id==='string'&&record.id.trim()&&Number.isFinite(record.createdAt)&&record.createdAt>=0&&record.createdAt<current.createdAt
  &&videoRange(record)&&actualAction(record)===action);
 candidates.sort((a,b)=>b.createdAt-a.createdAt||(a.id<b.id?-1:a.id>b.id?1:0));
 return candidates[0]||null;
}

function phaseAnchor(record,phase,range){
 const stages=reportFor(record)?.stages;
 if(!Array.isArray(stages))return null;
 const matching=stages.filter(stage=>stage?.phase===phase);
 if(matching.length!==1)return null;
 const time=matching[0].time;
 if(!Number.isFinite(time)||time<0||time>range.end-range.start)return null;
 return range.start+time;
}

/** Absolute video seconds; a phase uses equal lead/tail on both sides to align its anchor. */
export function getComparisonSegments(current,previous){
 const currentRange=videoRange(current),previousRange=videoRange(previous),action=actualAction(current);
 if(!currentRange||!previousRange||!action||actualAction(previous)!==action)return [];
 const segments=[{id:'whole',label:'整跳',current:currentRange,previous:previousRange}];
 for(const phase of phases){
  const currentAnchor=phaseAnchor(current,phase,currentRange),previousAnchor=phaseAnchor(previous,phase,previousRange);
  if(currentAnchor===null||previousAnchor===null)continue;
  const lead=Math.min(.8,currentAnchor-currentRange.start,previousAnchor-previousRange.start);
  const tail=Math.min(1.2,currentRange.end-currentAnchor,previousRange.end-previousAnchor);
  if(lead+tail<.05)continue;
  segments.push({id:phase,label:phase,
   current:{start:currentAnchor-lead,end:currentAnchor+tail,anchor:currentAnchor},
   previous:{start:previousAnchor-lead,end:previousAnchor+tail,anchor:previousAnchor}});
 }
 return segments;
}
