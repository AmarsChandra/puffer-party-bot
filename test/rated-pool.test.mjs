import {test} from 'node:test';
import assert from 'node:assert/strict';
import {playRatedPool} from '../src/rated-pool.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function lanes(count){return Array.from({length:count},(_,i)=>({run:{root:'table-'+i,state:{records:[],current:0,active:null}},tab:{id:String(i)},engine:{pauseGeneration(){}}}));}
async function seat(run,options,room){
 while(!options.shouldStop()&&!options.canQueue())await sleep(1);
 if(options.shouldStop())return false;
 run.state.active={room,rated:true};options.onObservation();return true;
}
function win(run,room){run.state.active=null;const record={room,outcome:'win',finishedAt:new Date().toISOString()};run.state.records.push(record);return {record};}
test('a finished slot refills while the other original match remains active',async()=>{
 const tables=lanes(2),calls=[0,0];let stop=false,refilledBeforeOtherFinished=false;
 const result=await playRatedPool(tables,{idleMs:1,betweenMatchMs:0,shouldStop:()=>stop,playMatch:async(run,tab,engine,options)=>{
  const i=Number(tab.id),n=++calls[i],room=String(i)+n;
  if(!await seat(run,options,room))return {};
  if(i===1){while(!options.shouldStop())await sleep(1);}else await sleep(5);
  if(i===0&&n===2){refilledBeforeOtherFinished=tables[1].run.state.active!==null;stop=true;}
  return win(run,room);
 }});
 assert(refilledBeforeOtherFinished);assert(calls[0]>=2);assert.equal(result.status,'stopped');
});
test('a failed extra slot switches to one healthy slot and keeps refilling it',async()=>{
 const tables=lanes(2),calls=[0,0],states=[],retired=[];let stop=false;
 const result=await playRatedPool(tables,{idleMs:1,betweenMatchMs:0,shouldStop:()=>stop,onStatus:s=>states.push(s),retireLane:async slot=>{retired.push(slot.index);},playMatch:async(run,tab,engine,options)=>{
  const i=Number(tab.id);calls[i]++;
  if(i===1){await sleep(5);throw new Error('Second tab unavailable');}
  if(!await seat(run,options,'A'+calls[i]))return {};
  await sleep(10);if(calls[i]>=3)stop=true;return win(run,'A'+calls[i]);
 }});
 assert.equal(result.mode,1);assert.equal(calls[1],1);assert(calls[0]>=3);assert(states.some(s=>s.mode===1&&s.retainedSlot===1));assert.deepEqual(retired,[1]);
});
test('repeated active observation delays reduce the pool to one table',async()=>{
 const tables=lanes(2);let stop=false;
 const result=await playRatedPool(tables,{idleMs:1,betweenMatchMs:0,shouldStop:()=>stop,playMatch:async(run,tab,engine,options)=>{
  if(!await seat(run,options,'R'+tab.id))return {};
  if(tab.id==='0'){run.lastObservationGapMs=4000;for(let i=0;i<3;i++)options.onObservation();await sleep(5);stop=true;}
  else while(!options.shouldStop())await sleep(1);
  return win(run,'R'+tab.id);
 }});
 assert.equal(result.mode,1);assert.match(result.fallbackReason,/delays/);
});
