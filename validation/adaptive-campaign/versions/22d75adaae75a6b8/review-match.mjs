/** Evidence-based review of a finished match. Does not invent new verified answers. */
import {candidates,questionKey} from './answer-engine.mjs';
export function reviewMatch(result,bank){
 const categories=(result.metrics?.categoryLatency??[]).map(t=>{
  const matches=q=>questionKey(q)===questionKey(t.question);
  const accepted=(result.accepted??[]).filter(a=>matches(a.question));
  const rejected=(result.rejected??[]).filter(a=>matches(a.question));
  const local=candidates(t.question,bank);
  return {question:t.question,readyMs:t.readyMs,firstTurnWaitMs:t.firstTurnWaitMs,accepted:accepted.length,misses:rejected.filter(a=>a.submit?.why==='miss').length,repeats:rejected.filter(a=>a.submit?.why==='repeat').length,localCandidatesNow:local.length,modelWaitAvoidable:local.length>0&&(t.readyMs??0)>100};
 });
 const passes=(result.finalRoom?.events??[]).filter(e=>e.kind==='pass');
 return {room:result.room,gameId:result.gameId,won:result.won,categories,
  learning:{serverConfirmedPassesObserved:passes.length,ownAccepted:result.accepted?.length??0,retiredMisses:(result.rejected??[]).filter(a=>a.submit?.why==='miss').length},
  findings:[
   ...categories.filter(c=>c.modelWaitAvoidable).map(c=>({kind:'local-solver-opportunity',question:c.question,observedWaitMs:c.readyMs,candidatesNow:c.localCandidatesNow})),
   ...categories.filter(c=>c.readyMs>5000&&!c.modelWaitAvoidable).map(c=>({kind:'slow-first-answer',question:c.question,observedWaitMs:c.readyMs})),
   ...categories.filter(c=>c.misses||c.repeats).map(c=>({kind:'answer-quality',question:c.question,misses:c.misses,repeats:c.repeats}))
  ]};
}
