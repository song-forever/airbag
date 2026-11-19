import test from 'node:test';
import assert from 'node:assert/strict';
import {getTrainingContext,goalKeyForRecord} from '../src/training-context.js';
import {analyzeFrames} from '../src/analysis-client.js';
import {getTrainingProgress} from '../src/coaching-plan.js';

test('reanalysis of the first jump preserves the established group task without inventing a prior attempt',async()=>{
 const session={id:'first-jump-group',goal:'grab',detail:'熟悉动作',stage:'acquisition',startedAt:1};
 const original={instruction:'继续原来同一项练习。',check:'original-check',reason:'已观察到的依据。',time:null};
 const record={id:'first',createdAt:10,trainingJoinedAt:10,actionMode:'auto',trainingSession:session};
 const goalKey=goalKeyForRecord(record);
 record.trainingContext={goalKey,previousFocus:null};
 record.analysis={trainingGoalKey:goalKey,analysis:{schemaVersion:7,nextJump:original,followUp:null,coaching:{session,positive:null}}};
 // A historical first report is frozen with no previous jump; reanalysis is not
 // another physical attempt, but it must not reset the group's established task.
 const context=getTrainingContext(record,[record]);
 const jpeg='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,1,2,255,217]).toString('base64');
 const stages=['助滑','上台','起跳','腾空'].map(phase=>({phase,analysis:'可见动作。',time:null}));
 const result=await analyzeFrames({apiKey:'sk-test-only-not-a-real-key-12345',model:'qwen3-vl-plus',actionMode:'auto',duration:4,
  frames:[0,1,2,3].map(time=>({time,dataUrl:jpeg})),previousFocus:context.previousFocus,coachingPlan:context.coachingPlan},
 {fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({stages,
  nextJump:{instruction:'换一个新的任务。',check:'new-check',reason:'不应被采用的新重点。',time:null},
  followUp:{status:'done',observation:'模型试图把本跳当作上一跳。',time:null},coaching:{positive:null},
  orientationTrace:[[0,'air','unknown'],[1,'air','unknown'],[2,'air','unknown'],[3,'air','unknown']],recognizedAction:{rotation:{state:'uncertain',evidence:[]},grab:{state:'uncertain',evidence:[]},otherAction:null}})}}]}))});
 assert.equal(result.analysis.nextJump.check,original.check);
 assert.equal(result.analysis.nextJump.instruction,original.instruction);
 assert.equal(result.analysis.followUp,null);
 record.analysis={...result,trainingGoalKey:goalKey};record.trainingContext=context;
 assert.equal(getTrainingProgress(record,[record,record]).reviewed,0);
 const next={id:'next',createdAt:20,trainingJoinedAt:20,trainingSession:session,actionMode:'auto'};
 assert.equal(getTrainingContext(next,[record]).previousFocus.check,original.check);
});
