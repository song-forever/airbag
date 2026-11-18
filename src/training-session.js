const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const timestamp=value=>Number.isSafeInteger(value)&&value>=0&&value<=8_640_000_000_000_000;
const catalog=items=>Object.freeze(items.map(item=>Object.freeze(item)));

export const TRAINING_GOALS=catalog([
 {id:'straight',label:'直飞'},
 {id:'grab',label:'抓板'},
 {id:'rotation',label:'转体'},
 {id:'rotation-grab',label:'转体抓板'},
]);

export const LEARNING_STAGES=catalog([
 {id:'initiation',label:'认识动作',description:'先理解这一项动作与练习目的。'},
 {id:'acquisition',label:'正在学会',description:'围绕一个检查标准练习已有动作。'},
 {id:'consolidation',label:'巩固稳定',description:'积累重复做到的表现，暂不增加新任务。'},
 {id:'refinement',label:'精修质量',description:'在已会的动作上细化节奏与协调。'},
 {id:'variation',label:'变化运用',description:'在已经熟悉的动作范围内保持同一技能重点。'},
]);

/** A session describes the student's intention, never an observed accomplishment. */
export function normalizeTrainingSession(value){
 if(!object(value)||typeof value.id!=='string'||!value.id||value.id.length>128
  ||!(/^[A-Za-z0-9_-]+$/).test(value.id)
  ||!TRAINING_GOALS.some(item=>item.id===value.goal)
  ||!LEARNING_STAGES.some(item=>item.id===value.stage)||!timestamp(value.startedAt))return null;
 const detail=value.detail===undefined?'':value.detail;
 if(typeof detail!=='string'||detail.trim().length>80)return null;
 return {id:value.id,goal:value.goal,detail:detail.trim(),stage:value.stage,startedAt:value.startedAt};
}

export function createTrainingSession(input,{id,now}={}){
 const session=normalizeTrainingSession({...input,id,startedAt:now});
 if(!session)throw new TypeError('训练目标、学习阶段或训练组信息无效。');
 return session;
}

export function describeTrainingSession(value){
 const session=normalizeTrainingSession(value);
 if(!session)return '自由练习';
 return [TRAINING_GOALS.find(item=>item.id===session.goal).label,session.detail,
  LEARNING_STAGES.find(item=>item.id===session.stage).label].filter(Boolean).join(' · ');
}

/** Explicit assignment of an old clip joins the group now, not at its filming time. */
export function trainingAttemptTime(record){
 if(normalizeTrainingSession(record?.trainingSession)&&timestamp(record?.trainingJoinedAt))return record.trainingJoinedAt;
 return timestamp(record?.createdAt)?record.createdAt:null;
}

export function createTrainingSessionStore({getStorage,appPath}){
 const directory=String(appPath||'/').replace(/\/+$/,'')+'/';
 const storageKey='airbag-training-session-v1:'+directory;
 let session=null,persisted=true;
 try{
  const raw=getStorage().getItem(storageKey);
  if(raw!==null&&raw!==undefined){
   const saved=JSON.parse(raw);
   if(!object(saved)||saved.version!==1||!(saved.session===null||normalizeTrainingSession(saved.session)))persisted=false;
   else session=normalizeTrainingSession(saved.session);
  }
 }catch{persisted=false;}
 const snapshot=()=>({session:normalizeTrainingSession(session),persisted});
 return {storageKey,snapshot,save(value){
  const clean=value===null?null:normalizeTrainingSession(value);
  if(value!==null&&!clean)throw new TypeError('训练组信息无效，原目标已保留。');
  session=clean;
  try{
   const storage=getStorage();
   if(session===null)storage.removeItem(storageKey);
   else storage.setItem(storageKey,JSON.stringify({version:1,session}));
   persisted=true;
  }catch{persisted=false;}
  return snapshot();
 }};
}
