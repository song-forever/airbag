import test from 'node:test';
import assert from 'node:assert/strict';
import { TRAINING_GOALS, LEARNING_STAGES, normalizeTrainingSession, createTrainingSession, createTrainingSessionStore, describeTrainingSession, trainingAttemptTime } from '../src/training-session.js';

const session={id:'group-1',goal:'grab',detail:'正脚抓板',stage:'acquisition',startedAt:100};
function storage(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}

test('session creation uses whitelisted intent and stage, stripping unrelated data',()=>{
 const created=createTrainingSession({...session,detail:'  正脚抓板  ',apiKey:'do-not-store',video:'private'},{id:'new-group',now:200});
 assert.deepEqual(created,{...session,id:'new-group',startedAt:200});
 assert.equal(TRAINING_GOALS.length,4);assert.equal(LEARNING_STAGES.length,5);
 assert.equal(JSON.stringify(created).includes('do-not-store'),false);
});

test('malformed sessions are rejected rather than coerced into a different training goal',()=>{
 for(const value of [null,[],{}, {...session,id:''},{...session,id:'x'.repeat(129)}, {...session,goal:'360'}, {...session,stage:'mastered'}, {...session,detail:'x'.repeat(81)}, {...session,detail:7}, {...session,startedAt:-1}, {...session,startedAt:Infinity}, {...session,startedAt:1.5}]){
  assert.equal(normalizeTrainingSession(value),null);
 }
 assert.throws(()=>createTrainingSession({goal:'other',stage:'acquisition'},{id:'a',now:200}));
});

test('independent local storage restores the exact session and never touches saved credentials',()=>{
 const saved=storage();saved.values.set('airbag-settings-v1:/airbag/','secret-credential');
 const make=()=>createTrainingSessionStore({getStorage:()=>saved,appPath:'/airbag/'});
 const store=make();assert.deepEqual(store.snapshot(),{session:null,persisted:true});
 store.save(session);assert.deepEqual(make().snapshot(),{session,persisted:true});
 assert.equal(saved.values.get('airbag-settings-v1:/airbag/'),'secret-credential');
 store.save(null);assert.equal(make().snapshot().session,null);
 assert.equal(saved.values.get('airbag-settings-v1:/airbag/'),'secret-credential');
});

test('snapshots and saved sessions are detached from caller mutations',()=>{
 const saved=storage(),store=createTrainingSessionStore({getStorage:()=>saved,appPath:'/airbag'}),input={...session};
 store.save(input);input.detail='调用方修改';const snapshot=store.snapshot();snapshot.session.stage='variation';
 assert.deepEqual(store.snapshot().session,session);
 assert.throws(()=>store.save({...session,goal:'unknown'}));assert.deepEqual(store.snapshot().session,session);
});

test('malformed storage and denied storage safely retain an in-memory session',()=>{
 const saved=storage(),initial=createTrainingSessionStore({getStorage:()=>saved,appPath:'/airbag'});
 saved.values.set(initial.storageKey,'not-json');
 assert.deepEqual(createTrainingSessionStore({getStorage:()=>saved,appPath:'/airbag'}).snapshot(),{session:null,persisted:false});
 const denied=createTrainingSessionStore({getStorage:()=>{throw new Error('denied');},appPath:'/airbag'});
 assert.deepEqual(denied.save(session),{session,persisted:false});
 assert.deepEqual(denied.snapshot(),{session,persisted:false});
});

test('different app directories do not share session state and empty means free practice',()=>{
 const saved=storage(),a=createTrainingSessionStore({getStorage:()=>saved,appPath:'/airbag///'}),b=createTrainingSessionStore({getStorage:()=>saved,appPath:'/other'});
 a.save(session);assert.equal(b.snapshot().session,null);
 assert.equal(describeTrainingSession(null),'自由练习');
 assert.match(describeTrainingSession(session),/抓板/);assert.match(describeTrainingSession(session),/正脚抓板/);
 assert.match(describeTrainingSession(session),/学/);
});

test('an explicit old-clip assignment uses joined time without mutating original creation time',()=>{
 const record={createdAt:50,trainingSession:session,trainingJoinedAt:250};
 assert.equal(trainingAttemptTime(record),250);assert.equal(record.createdAt,50);
 for(const time of [undefined,-1,Infinity,2.5])assert.equal(trainingAttemptTime({...record,trainingJoinedAt:time}),50);
 assert.equal(trainingAttemptTime({...record,trainingSession:null}),50);
 assert.equal(trainingAttemptTime({createdAt:NaN}),null);
});
