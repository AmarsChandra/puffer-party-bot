import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advanceTauntRound,tauntDue,consumeTaunt} from '../src/taunt-schedule.mjs';

test('only every fifth category round permits one taunt despite repeated own turns',()=>{
 const state={},used=[];
 for(let round=1;round<=15;round++){
  for(let turn=0;turn<4;turn++){
   advanceTauntRound(state,'ROOM:'+round);
   if(tauntDue(state)){used.push(round);consumeTaunt(state);}
  }
 }
 assert.deepEqual(used,[5,10,15]);assert.equal(state.tauntSchedule.rounds,15);
});
test('cadence persists across games and restarts, and a skipped fifth round does not trigger the sixth',()=>{
 let state={};for(let round=1;round<=4;round++)advanceTauntRound(state,'FIRST:'+round);
 state=JSON.parse(JSON.stringify(state));advanceTauntRound(state,'NEXT:1');assert(tauntDue(state));
 advanceTauntRound(state,'NEXT:1');assert.equal(state.tauntSchedule.rounds,5);assert(tauntDue(state));
 advanceTauntRound(state,'NEXT:2');assert(!tauntDue(state));
 for(let round=3;round<=6;round++)advanceTauntRound(state,'NEXT:'+round);
 assert(tauntDue(state));consumeTaunt(state);state=JSON.parse(JSON.stringify(state));assert(!tauntDue(state));
});
