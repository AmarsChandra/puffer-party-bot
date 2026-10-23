#!/usr/bin/env node
/** Repository-ready statistics derived from retained public game evidence. No credentials. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifiedOutcome,streakProgress} from './streak-runner.mjs';

function distribution(values){
 const a=values.filter(Number.isFinite).sort((x,y)=>x-y),n=a.length;
 return {samples:n,medianMs:n?(a[Math.floor((n-1)/2)]+a[Math.ceil((n-1)/2)])/2:null,p95Ms:n?a[Math.ceil(n*.95)-1]:null,maxMs:n?a[n-1]:null};
}
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function tiersOf(answers){
 const tiers={};for(const a of answers){const tier=a.submit?.tier??'unknown';tiers[tier]=(tiers[tier]??0)+1;}
 const rareOrBetter=(tiers.rare??0)+(tiers.deepcut??0)+(tiers.krillion??0);
 return {tiers,rareOrBetter,acceptedAcknowledgements:answers.length,rareOrBetterRate:answers.length?rareOrBetter/answers.length:null};
}
export function campaignStatistics(root){
 const state=read(path.join(root,'campaign.json')),issues=[],seen=new Set(),allAccepted=[],allRejected=[],ready=[],wait=[],sources={},rows=[];
 for(const row of state.records){
  const result=row.resultFile?read(path.join(root,row.resultFile)):null;
  const evidence=row.evidenceFile?read(path.join(root,row.evidenceFile)):null;
  let outcome=result?verifiedOutcome(result,state.queue):'inconclusive';
  if(outcome!==row.outcome)issues.push(`Outcome differs from evidence for match ${row.number}`);
  if(row.gameId&&seen.has(row.gameId)){issues.push(`Duplicate game ID for match ${row.number}`);outcome='inconclusive';}
  if(row.gameId)seen.add(row.gameId);
  const accepted=result?(result.accepted??[]).filter(a=>a.submit?.accepted===true):(evidence?.submissionsObserved??[]).filter(a=>a.submit?.accepted===true);
  const rejected=result?(result.rejected??[]):(evidence?.submissionsObserved??[]).filter(a=>['miss','repeat'].includes(a.submit?.why));
  allAccepted.push(...accepted);allRejected.push(...rejected);
  const timings=result?.metrics?.categoryLatency??[];
  const categoryReady=timings.map(t=>t.readyMs).filter(Number.isFinite),turnWait=timings.map(t=>t.firstTurnWaitMs).filter(Number.isFinite);
  ready.push(...categoryReady);wait.push(...turnWait);
  for(const t of timings)if(t.firstSource)sources[t.firstSource]=(sources[t.firstSource]??0)+1;
  rows.push({number:row.number,gameId:row.gameId??null,room:row.room??null,outcome,players:result?.startingRoom?.players.filter(p=>p.alive&&!p.removed).length??row.players??null,sourceVersion:row.sourceVersion,finishedAt:row.finishedAt,
   acceptedAcknowledgements:accepted.length,rejections:rejected.length,serverAccepted:result?.player?.answers??null,rarity:tiersOf(accepted),categoryReadiness:distribution(categoryReady),firstTurnWait:distribution(turnWait),codexRequests:result?.metrics?.codexRequests??null,archiveCoveredCategories:timings.filter(t=>t.archiveCovered===true).length,archiveAccepted:accepted.filter(a=>a.source==='answer-archive').length,archiveTierAgreements:accepted.filter(a=>a.source==='answer-archive'&&a.archiveTier===a.submit?.tier).length,timedCategories:timings.length,unavailableCategories:timings.filter(t=>t.readyMs==null).length,firstTurnsWithoutSubmission:timings.filter(t=>t.firstTurnAt!=null&&t.firstSubmitMs===null).length});
 }
 const wins=rows.filter(r=>r.outcome==='win').length,losses=rows.filter(r=>r.outcome==='loss').length,inconclusive=rows.length-wins-losses,acknowledgements=allAccepted.length+allRejected.length;
 const progress=streakProgress(rows);
 if(JSON.stringify(progress)!==JSON.stringify(state.progress))issues.push('Streak differs from retained evidence');
 const versions=[...new Set(rows.map(r=>r.sourceVersion))].map(id=>{const v=rows.filter(r=>r.sourceVersion===id);return {sourceVersion:id,attempts:v.length,wins:v.filter(r=>r.outcome==='win').length,losses:v.filter(r=>r.outcome==='loss').length,inconclusive:v.filter(r=>r.outcome==='inconclusive').length,acceptedAcknowledgements:v.reduce((n,r)=>n+r.acceptedAcknowledgements,0),rareOrBetter:v.reduce((n,r)=>n+r.rarity.rareOrBetter,0)};});
 return {schemaVersion:1,generatedAt:new Date().toISOString(),cohort:'Public party-queue attempts retained in this adaptive campaign, including its imported first seven games. Private tests and unrelated earlier attempts are excluded.',
  status:state.status,activeMatch:state.active?.number??null,startedAt:state.startedAt,lastResultAt:rows.at(-1)?.finishedAt??null,queue:state.queue,
  outcomes:{attempts:rows.length,wins,losses,inconclusive,confirmedWinRate:rows.length?wins/rows.length:null},streak:{...progress,target:state.target},
  setupFailures:(state.setupFailures??[]).map(f=>({intendedMatch:f.intendedMatch,at:f.at,error:f.error,sourceVersion:f.sourceVersion,evidenceFile:f.evidenceFile??null})),
  codexUsage:{measuredMatches:rows.filter(r=>r.codexRequests!==null).map(r=>r.number),requests:rows.reduce((n,r)=>n+(r.codexRequests??0),0),unmeasuredMatches:rows.filter(r=>r.codexRequests===null).map(r=>r.number)},
  submissions:{acceptedAcknowledgements:allAccepted.length,rejections:allRejected.length,acknowledgements,acceptanceRate:acknowledgements?allAccepted.length/acknowledgements:null,misses:allRejected.filter(a=>a.submit?.why==='miss').length,repeats:allRejected.filter(a=>a.submit?.why==='repeat').length},
  rarity:tiersOf(allAccepted),categoryReadiness:distribution(ready),firstTurnWait:distribution(wait),latencyCoverage:{attemptsWithTimings:rows.filter(r=>r.timedCategories>0).length,attemptsWithoutTimings:rows.filter(r=>!r.timedCategories).map(r=>r.number),categoryObservations:rows.reduce((n,r)=>n+r.timedCategories,0),unavailableCategories:rows.reduce((n,r)=>n+r.unavailableCategories,0),firstTurnsWithoutSubmission:rows.reduce((n,r)=>n+r.firstTurnsWithoutSubmission,0)},firstAnswerSources:sources,versions,matches:rows,issues,
  interpretation:['Inconclusive public attempts count as non-wins and break the streak. Setup failures before participation are listed separately.','Acceptance and rarity use retained gameplay acknowledgements; they do not count model proposals as accepted. Partial interruption logs are included when available.','Category readiness includes local, cached and generated answers. The codex source can include cached model proposals; it does not mean every answer required a fresh request.','Latency percentiles exclude missing measurements. Unavailable answers, first turns without a submission, and attempts missing timing evidence are reported separately in latencyCoverage.','Player counts exclude spectators. Model prompt requests do not establish rarity; only server tiers do.','Codex request counts cover only matches instrumented with the ai-request counter; older missing counts are not zero. Counts exclude this development chat and are generation requests, not token or billing totals.','Results are a measured sample across different categories and source versions, not a guarantee of future wins.']};
}
const percent=n=>n===null?'n/a':(n*100).toFixed(1)+'%';
const ms=n=>n===null?'n/a':Math.round(n).toLocaleString('en-US')+' ms';
export function statisticsMarkdown(s){
 const o=s.outcomes,a=s.submissions;
 return `# Puffer Party bot — observed public results

As of ${s.generatedAt}. ${s.cohort}

| Metric | Observed result |
| --- | --- |
| Public attempts | ${o.attempts} |
| Confirmed wins | ${o.wins} / ${o.attempts} (${percent(o.confirmedWinRate)}) |
| Confirmed losses / inconclusive interruptions | ${o.losses} / ${o.inconclusive} |
| Current / best consecutive wins | ${s.streak.current} / ${s.streak.best} |
| Accepted gameplay acknowledgements | ${a.acceptedAcknowledgements} / ${a.acknowledgements} (${percent(a.acceptanceRate)}) |
| Miss / repeat rejections | ${a.misses} / ${a.repeats} |
| Rare, deep-cut or Krillion answers | ${s.rarity.rareOrBetter} / ${s.rarity.acceptedAcknowledgements} (${percent(s.rarity.rareOrBetterRate)}) |
| Category first-answer availability, median / p95 | ${ms(s.categoryReadiness.medianMs)} / ${ms(s.categoryReadiness.p95Ms)} (${s.categoryReadiness.samples} observations) |
| First-turn wait, median / p95 | ${ms(s.firstTurnWait.medianMs)} / ${ms(s.firstTurnWait.p95Ms)} (${s.firstTurnWait.samples} observations) |
| Categories without an available answer / first turns without a submission | ${s.latencyCoverage.unavailableCategories} / ${s.latencyCoverage.firstTurnsWithoutSubmission} |
| Setup failures before participation | ${s.setupFailures.length} |

Rarity tiers are reported by the game: ${Object.entries(s.rarity.tiers).map(([tier,count])=>`${tier}: ${count}`).join(', ')||'none yet'}.

${s.interpretation.join('\n\n')}

The accompanying summary.json contains per-version results and evidence issues; matches.csv contains every public attempt. ${s.issues.length?`Evidence issues requiring review: ${s.issues.join('; ')}.`:'No evidence mismatches were found by this statistics pass.'}
`;
}
function csvValue(value){const text=value??'';return /[",\n]/.test(String(text))?'"'+String(text).replaceAll('"','""')+'"':String(text);}
export function writeStatistics(root,output=path.join(root,'stats')){
 const stats=campaignStatistics(root);fs.mkdirSync(output,{recursive:true});
 const fields=['number','room','gameId','outcome','players','sourceVersion','acceptedAcknowledgements','rejections','serverAccepted','rareOrBetter','rareOrBetterRate','categoryReadinessMedianMs','firstTurnWaitMedianMs','finishedAt'];
 const csv=[fields.join(','),...stats.matches.map(r=>[r.number,r.room,r.gameId,r.outcome,r.players,r.sourceVersion,r.acceptedAcknowledgements,r.rejections,r.serverAccepted,r.rarity.rareOrBetter,r.rarity.rareOrBetterRate,r.categoryReadiness.medianMs,r.firstTurnWait.medianMs,r.finishedAt].map(csvValue).join(','))].join('\n')+'\n';
 for(const [file,body]of [['summary.json',JSON.stringify(stats,null,2)],['matches.csv',csv],['README-snippet.md',statisticsMarkdown(stats)]]){fs.writeFileSync(path.join(output,file)+'.tmp',body);fs.renameSync(path.join(output,file)+'.tmp',path.join(output,file));}
 return stats;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const opts={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i].replace(/^--/,'');if(!['campaign','output'].includes(key)||!process.argv[i+1])throw new Error('Use --campaign DIR [--output DIR]');opts[key]=process.argv[++i];}
 if(!opts.campaign)throw new Error('--campaign is required');const stats=writeStatistics(path.resolve(opts.campaign),opts.output?path.resolve(opts.output):undefined);console.log(JSON.stringify({outcomes:stats.outcomes,streak:stats.streak,issues:stats.issues}));
}
