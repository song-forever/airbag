import test from 'node:test';
import assert from 'node:assert/strict';
import {findComparisonRecord,getComparisonSegments} from '../src/jump-comparison.js';
import {goalKeyForRecord} from '../src/training-context.js';

function record(id,createdAt,overrides={}){
 return {id,createdAt,blob:new Blob(['video'],{type:'video/mp4'}),duration:10,trimStart:1,trimEnd:9,actionMode:'auto',actionType:'直飞',
  analysis:{analysis:{schemaVersion:5,recognizedAction:{type:'直飞'},stages:[{phase:'助滑',time:0},{phase:'上台',time:2},{phase:'起跳',time:3},{phase:'腾空',time:4}]}},...overrides};
}
function action(record,type){record.analysis.analysis.recognizedAction={type};return record;}
function stages(record,values){record.analysis.analysis.stages=values;return record;}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);

test('comparison chooses the nearest earlier analyzed video of the same observed action',()=>{
 const current=record('current',40),old=record('old',10),previous=record('previous',20),other=action(record('other',30),'抓板');
 assert.equal(findComparisonRecord(current,[other,old,current,previous]).id,'previous');
 assert.equal(findComparisonRecord(current,[previous,current,old,other]).id,'previous');
});

test('nearest same-action comparison is independent of a frozen older training-cue source',()=>{
 const old=record('old-source',10),nearer=record('nearer',20),current=record('current',30,{trainingContext:{previousFocus:{sourceId:'old-source'}}});
 assert.equal(findComparisonRecord(current,[old,nearer]).id,'nearer');
 assert.equal(findComparisonRecord(current,[nearer]).id,'nearer');
 assert.equal(findComparisonRecord(current,[]),null);
});

test('self, timestamp peers, future videos, missing video and stale reports cannot be used',()=>{
 const valid=record('valid',10),current=record('current',30);
 const stale=record('stale',20);stale.analysis.trainingGoalKey='a different goal';
 const candidates=[current,record('peer',30),record('future',40),record('no-video',29,{blob:null}),record('empty-video',28,{blob:new Blob([])}),record('unanalyzed',27,{analysis:null}),stale,valid];
 assert.equal(findComparisonRecord(current,candidates).id,'valid');
 const stamped=record('stamped',25);stamped.analysis.trainingGoalKey=goalKeyForRecord(stamped);
 assert.equal(findComparisonRecord(current,[...candidates,stamped]).id,'stamped');
});

test('retained training action and old action fields cannot override an unknown actual action',()=>{
 const valid=record('valid',10),unknown=action(record('unknown',20),'无法判断'),current=record('current',30);
 unknown.analysis.analysis.practiceActionType='直飞';unknown.actionType='直飞';
 assert.equal(findComparisonRecord(current,[valid,unknown]).id,'valid');
 assert.equal(findComparisonRecord(unknown,[valid]),null);
 for(const type of ['其他','无法判断','待识别动作','invented'])assert.equal(findComparisonRecord(action(record('current',30),type),[valid]),null);
 const missing=record('missing-recognition',20);delete missing.analysis.analysis.recognizedAction;
 assert.equal(findComparisonRecord(current,[missing]),null);
});

test('legacy goals without observed recognition cannot identify the actual action',()=>{
 const legacy=record('legacy',10,{actionMode:undefined,actionType:' 抓板 ',analysis:{analysis:{schemaVersion:3,stages:[]}}});
 const current=action(record('current',20),'抓板');
 assert.equal(findComparisonRecord(current,[legacy]),null);
 assert.deepEqual(getComparisonSegments(current,legacy),[]);
 legacy.actionType='';legacy.action='抓板';assert.equal(findComparisonRecord(current,[legacy]),null);
 legacy.analysis.analysis.practiceActionType='抓板';assert.equal(findComparisonRecord(current,[legacy]),null);
 legacy.analysis.analysis.recognizedAction={type:'无法判断'};assert.equal(findComparisonRecord(current,[legacy]),null);
});

test('recognized action is sufficient across supported report versions regardless of stored goals',()=>{
 const current=action(record('current',20),'抓板');
 for(const schemaVersion of [2,3,4,5,6]){
  const observed=record('observed',10,{actionMode:undefined,actionType:'转体',action:'直飞',analysis:{analysis:{schemaVersion,recognizedAction:{type:'抓板'}}}});
  assert.equal(findComparisonRecord(current,[observed]).id,'observed');
  assert.deepEqual(getComparisonSegments(current,observed).map(item=>item.id),['whole']);
 }
});

test('malformed current records and invalid time ranges do not produce comparison candidates',()=>{
 const previous=record('previous',10),current=record('current',20);
 for(const override of [{createdAt:NaN},{createdAt:-1},{duration:0},{trimStart:9,trimEnd:1},{blob:null},{analysis:{analysis:{schemaVersion:99}}}]){
  assert.equal(findComparisonRecord({...current,...override},[previous]),null);
 }
 assert.equal(findComparisonRecord(current,null),null);
 const a=record('a',15),b=record('b',15);
 assert.equal(findComparisonRecord(current,[b,a]).id,'a');
});

test('phase clips align corresponding anchors despite different trims and event timing',()=>{
 const current=record('current',20,{duration:20,trimStart:5,trimEnd:15});
 const previous=record('previous',10,{duration:15,trimStart:2,trimEnd:12});
 stages(current,[{phase:'起跳',time:3}]);stages(previous,[{phase:'起跳',time:6}]);
 const result=getComparisonSegments(current,previous);
 assert.deepEqual(result.map(item=>item.id),['whole','起跳']);
 assert.deepEqual(result[0],{id:'whole',label:'整跳',current:{start:5,end:15,anchor:5},previous:{start:2,end:12,anchor:2}});
 const phase=result[1];
 near(phase.current.anchor,8);near(phase.previous.anchor,8);
 near(phase.current.start,7.2);near(phase.current.end,9.2);
 near(phase.previous.start,7.2);near(phase.previous.end,9.2);
});

test('boundary anchors shorten both clips equally so the reference point remains synchronized',()=>{
 const current=stages(record('current',20),[{phase:'起跳',time:.2}]);
 const previous=stages(record('previous',10),[{phase:'起跳',time:7.5}]);
 const phase=getComparisonSegments(current,previous)[1];
 near(phase.current.start,1);near(phase.current.end,1.7);
 near(phase.previous.start,8.3);near(phase.previous.end,9);
 near(phase.current.anchor-phase.current.start,phase.previous.anchor-phase.previous.start);
 near(phase.current.end-phase.current.start,phase.previous.end-phase.previous.start);
});

test('zero-second timestamps are valid and absent timestamps never invent phase alignment',()=>{
 const current=stages(record('current',20),[{phase:'助滑',time:0},{phase:'上台',time:null},{phase:'起跳',time:3}]);
 const previous=stages(record('previous',10),[{phase:'助滑',time:0},{phase:'上台',time:1}]);
 const result=getComparisonSegments(current,previous);
 assert.deepEqual(result.map(item=>item.id),['whole','助滑']);
 assert.equal(result[1].current.start,1);assert.equal(result[1].current.anchor,1);
 assert.equal(result[1].previous.start,1);assert.equal(result[1].previous.anchor,1);
});

test('invalid, out-of-range, duplicate and too-short phase references are omitted',()=>{
 for(const time of [-.01,8.01,Infinity,NaN,'2',null]){
  const current=stages(record('current',20),[{phase:'起跳',time}]);
  assert.deepEqual(getComparisonSegments(current,record('previous',10)).map(item=>item.id),['whole']);
 }
 const duplicate=stages(record('current',20),[{phase:'起跳',time:2},{phase:'起跳',time:3}]);
 assert.deepEqual(getComparisonSegments(duplicate,record('previous',10)).map(item=>item.id),['whole']);
 const atStart=stages(record('start',20),[{phase:'起跳',time:0}]),atEnd=stages(record('end',10),[{phase:'起跳',time:8}]);
 assert.deepEqual(getComparisonSegments(atStart,atEnd).map(item=>item.id),['whole']);
});

test('whole-video fallback stays available for matching observed actions without phases',()=>{
 const current=record('current',20),previous=record('previous',10);
 delete current.analysis.analysis.stages;delete previous.analysis.analysis.stages;
 assert.deepEqual(getComparisonSegments(current,previous).map(item=>item.id),['whole']);
 assert.deepEqual(getComparisonSegments(current,action(record('other',10),'转体')),[]);
 assert.deepEqual(getComparisonSegments(current,{...previous,blob:null}),[]);
});
