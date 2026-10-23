import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {campaignStatistics,writeStatistics} from '../src/statistics.mjs';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'puffer-stats-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const result=(id,won,phase='over')=>({won,playerId:'me',winnerId:won?'me':'them',gameId:id,startingRoom:{phase:'round',gameNumber:1,players:[{id:'me',alive:true},{id:'them',alive:true},{id:'watcher',alive:false}]},finalRoom:{phase,gameNumber:1,gameId:id,winnerId:won?'me':'them',queue:'party',settings:{isPrivate:false},players:[{id:'me',place:won?1:2,alive:won,lives:won?2:0},{id:'them',alive:!won}]},player:{answers:1},accepted:[{submit:{accepted:true,tier:'rare'}}],rejected:[],metrics:{categoryLatency:[{readyMs:4,firstTurnWaitMs:82,firstTurnAt:1,firstSubmitMs:82,firstSource:'verified'}]}});
 const first=result('g1',true),partial=result('g2',false,'round');partial.accepted=[{submit:{accepted:true,tier:'plankton'}}];partial.rejected=[{submit:{why:'miss'}}];partial.metrics.categoryLatency=[{readyMs:null,firstTurnAt:1,firstSubmitMs:null,firstTurnWaitMs:null}];
 const third=result('g3',false);third.accepted=[];
 for(const [i,r]of [first,partial,third].entries())fs.writeFileSync(path.join(root,`${i+1}.json`),JSON.stringify(r));
 const state={startedAt:'2026-10-22T00:00:00Z',target:20,queue:'party',status:'awaiting-review',progress:{current:0,best:1},records:['win','inconclusive','loss'].map((outcome,i)=>({number:i+1,outcome,gameId:`g${i+1}`,sourceVersion:'v1',resultFile:`${i+1}.json`,finishedAt:`2026-10-22T00:0${i+1}:00Z`})),setupFailures:[{intendedMatch:1,error:'No seat assigned'}]};
 fs.writeFileSync(path.join(root,'campaign.json'),JSON.stringify(state));return {root,state};
}
test('statistics include interrupted attempts and missing timings without counting setup failures as games',t=>{
 const {root}=fixture(t),s=writeStatistics(root);
 assert.equal(s.outcomes.attempts,3);assert.equal(s.outcomes.wins,1);assert.equal(s.outcomes.confirmedWinRate,1/3);
 assert.equal(s.setupFailures.length,1);assert.equal(s.submissions.acceptanceRate,2/3);
 assert.equal(s.rarity.rareOrBetterRate,1/2);assert.equal(s.matches[0].players,2);
 assert.equal(s.latencyCoverage.unavailableCategories,1);assert.equal(s.latencyCoverage.firstTurnsWithoutSubmission,1);
 assert.equal(s.categoryReadiness.samples,2);assert.deepEqual(s.issues,[]);
 assert.match(fs.readFileSync(path.join(root,'stats','README-snippet.md'),'utf8'),/1 \/ 3 \(33.3%\)/);
 assert.equal(fs.readFileSync(path.join(root,'stats','matches.csv'),'utf8').trim().split('\n').length,4);
});
test('duplicate or unsupported win claims cannot inflate the published win count',t=>{
 const {root,state}=fixture(t);state.records.push({...state.records[0],number:4});state.records.push({number:5,outcome:'win',gameId:'no-result',sourceVersion:'v1'});
 fs.writeFileSync(path.join(root,'campaign.json'),JSON.stringify(state));const s=campaignStatistics(root);
 assert.equal(s.outcomes.wins,1);assert.equal(s.outcomes.attempts,5);assert.equal(s.outcomes.inconclusive,3);
 assert.ok(s.issues.some(x=>x.includes('Duplicate game ID')));assert.ok(s.issues.some(x=>x.includes('Outcome differs')));
});
