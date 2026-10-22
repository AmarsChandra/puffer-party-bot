#!/usr/bin/env node
/** One match per invocation, followed by a required review. Source versions and every outcome are retained. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {PufferBot} from './puffer-bot.mjs';
import {AnswerEngine} from './answer-engine.mjs';
import {CodexProvider} from './codex-provider.mjs';
import {verifiedOutcome,streakProgress} from './streak-runner.mjs';
import {reviewMatch} from './review-match.mjs';
const DIR=path.dirname(fileURLToPath(import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const write=(file,data)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2));fs.renameSync(file+'.tmp',file);};
function snapshot(root,sources){
 sources??=Object.fromEntries(['puffer-bot.mjs','answer-engine.mjs','codex-provider.mjs','streak-runner.mjs','game-screen.mjs','adaptive-campaign.mjs','review-match.mjs','answers.json','english-words.json'].map(f=>[f,hash(fs.readFileSync(path.join(DIR,f)))]));
 const id=hash(JSON.stringify(sources)).slice(0,16),dir=path.join(root,'versions',id);fs.mkdirSync(dir,{recursive:true});
 for(const [file,expected]of Object.entries(sources)){
  const bytes=fs.readFileSync(path.join(DIR,file));if(hash(bytes)!==expected)throw new Error('Source differs from the historical run: '+file);
  fs.writeFileSync(path.join(dir,file),bytes);
 }
 return {id,sources};
}
export function auditCampaign(root){
 const state=JSON.parse(fs.readFileSync(path.join(root,'campaign.json'))),issues=[],seen=new Set();let lastTime=0;
 for(const v of state.versions)for(const [file,expected]of Object.entries(v.sources))if(hash(fs.readFileSync(path.join(root,'versions',v.id,file)))!==expected)issues.push('Source snapshot mismatch: '+v.id+'/'+file);
 for(const [index,row]of state.records.entries()){
  if(row.number!==index+1)issues.push('Sequence mismatch');
  if(['win','loss'].includes(row.outcome)&&!row.resultFile)issues.push('Missing terminal result: '+row.number);
  if(row.resultFile){const r=JSON.parse(fs.readFileSync(path.join(root,row.resultFile)));if(verifiedOutcome(r,state.queue)!==row.outcome||r.gameId!==row.gameId)issues.push('Result mismatch: '+row.number);}
  if(row.gameId&&seen.has(row.gameId))issues.push('Duplicate game ID');if(row.gameId)seen.add(row.gameId);
  if(!state.versions.some(v=>v.id===row.sourceVersion))issues.push('Missing version for '+row.number);
  const time=Date.parse(row.finishedAt);if(!Number.isFinite(time)||time<lastTime)issues.push('Invalid or out-of-order result');lastTime=time;
 }
 const progress=streakProgress(state.records);if(JSON.stringify(progress)!==JSON.stringify(state.progress))issues.push('Progress mismatch');
 return {target:state.target,records:state.records.length,progress,status:state.status,issues,complete:issues.length===0&&!state.active&&state.status==='target-reached'&&progress.current>=state.target&&state.records.every(r=>r.reviewed)};
}
async function main(){
 const opts={};for(let i=2;i<process.argv.length;i++){const k=process.argv[i].replace(/^--/,'');if(['init','next','audit'].includes(k))opts[k]=true;else if(['campaign','seed','note-file','cache','watch-seat'].includes(k)&&process.argv[i+1])opts[k]=process.argv[++i];else throw new Error('Use --campaign DIR --init | --seed OLD_RUN | --next | --note-file FILE | --audit');}
 if(!opts.campaign)throw new Error('--campaign is required');const root=path.resolve(opts.campaign),file=path.join(root,'campaign.json');fs.mkdirSync(root,{recursive:true});
 if(opts.init){
  if(fs.existsSync(file))throw new Error('Campaign already exists');
  write(file,{version:1,kind:'review-between-public-matches',target:20,queue:'party',startedAt:new Date().toISOString(),status:'awaiting-review',versions:[],records:[],reviews:[],progress:{current:0,best:0}});
  console.log('Campaign initialized');return;
 }
 if(opts.seed){
  if(fs.existsSync(file))throw new Error('Campaign already exists');const oldDir=path.resolve(opts.seed),old=JSON.parse(fs.readFileSync(path.join(oldDir,'streak.json')));
  if(old.status==='running')throw new Error('Wait for the existing run to finish its current game');
  const version=snapshot(root,old.sources),state={version:1,kind:'review-between-public-matches',target:old.target,queue:old.queue,startedAt:old.startedAt,status:'awaiting-review',versions:[version],records:[],reviews:[]};
  for(const r of old.records){const number=state.records.length+1,dir=path.join(root,'games',String(number).padStart(3,'0'));fs.mkdirSync(dir,{recursive:true});if(r.resultFile)fs.copyFileSync(path.join(oldDir,r.resultFile),path.join(dir,'result.json'));state.records.push({...r,number,resultFile:r.resultFile?path.relative(root,path.join(dir,'result.json')):undefined,sourceVersion:version.id,reviewed:false});}
  state.progress=streakProgress(state.records);write(file,state);console.log(JSON.stringify({seeded:state.records.length,progress:state.progress}));return;
 }
 const state=JSON.parse(fs.readFileSync(file));
 if(opts.audit){console.log(JSON.stringify(auditCampaign(root),null,2));return;}
 if(opts['note-file']){if(state.active)throw new Error('Wait for the active match before recording its review');const note=JSON.parse(fs.readFileSync(opts['note-file']));if(typeof note.summary!=='string'||!note.summary.trim())throw new Error('Review needs a nonempty summary');for(const r of state.records)if(!r.reviewed)r.reviewed=true;state.reviews.push({at:new Date().toISOString(),afterMatch:state.records.length,...note});state.status=state.progress.current>=state.target?'target-reached':'awaiting-review';write(file,state);console.log('Review recorded');return;}
 if(!opts.next)throw new Error('Choose --next, --audit, or --note-file');
 if(state.active)throw new Error('A match is already recorded as active; inspect its live process before continuing');
 if(state.records.some(r=>!r.reviewed))throw new Error('Review the previous match before starting another');
 if(state.progress.current>=state.target)throw new Error('Streak target already reached');
 const version=snapshot(root);if(!state.versions.some(v=>v.id===version.id))state.versions.push(version);
 const number=state.records.length+1,dir=path.join(root,'games',String(number).padStart(3,'0'));fs.mkdirSync(dir,{recursive:true});
 state.active={number,pid:process.pid,startedAt:new Date().toISOString(),output:dir,sourceVersion:version.id};state.status='playing';write(file,state);
 const log=(type,data={})=>console.log(JSON.stringify({at:new Date().toISOString(),type,...data}));let bot;
 const provider=new CodexProvider({cwd:path.join(root,'worker'),onLog:log});
 const engine=new AnswerEngine({bankPath:path.join(DIR,'answers.json'),cachePath:path.resolve(opts.cache??path.join(DIR,'learned-answers.json')),provider,onLog:log,onReady:q=>bot?.answerReady(q)});
 try{
  await engine.warmup();bot=new PufferBot({name:'PufferBot',size:state.queue,engine,output:dir,watchSeat:opts['watch-seat']?path.resolve(opts['watch-seat']):undefined,timeout:600000});
  const result=await bot.run(),outcome=verifiedOutcome(result,state.queue);write(path.join(dir,'result.json'),result);
  const review=reviewMatch(result,JSON.parse(fs.readFileSync(path.join(DIR,'answers.json'))));write(path.join(dir,'review.json'),review);
  state.records.push({number,outcome,gameId:result.gameId,room:result.room,gameNumber:result.gameNumber,players:result.startingRoom?.players.filter(p=>p.alive&&!p.removed).length,resultFile:path.relative(root,path.join(dir,'result.json')),reviewFile:path.relative(root,path.join(dir,'review.json')),sourceVersion:version.id,accepted:result.player?.answers,lives:result.player?.lives,finishedAt:new Date().toISOString(),reviewed:false});
  state.progress=streakProgress(state.records);state.status='awaiting-review';delete state.active;write(file,state);log('match-review',{number,outcome,progress:state.progress,review});
  if(opts['watch-seat'])await sleep(8000);
 }catch(error){
  if(!bot){state.setupFailures??=[];state.setupFailures.push({intendedMatch:number,sourceVersion:version.id,error:error.message,at:new Date().toISOString()});state.status='awaiting-review';delete state.active;write(file,state);throw error;}
  const partial=bot?.snapshotResult();let resultFile,reviewFile;
  if(partial){
   resultFile=path.relative(root,path.join(dir,'partial-result.json'));write(path.join(root,resultFile),{...partial,error:error.message});
   reviewFile=path.relative(root,path.join(dir,'review.json'));write(path.join(root,reviewFile),{...reviewMatch(partial,JSON.parse(fs.readFileSync(path.join(DIR,'answers.json')))),error:error.message});
  }
  state.records.push({number,outcome:'inconclusive',room:partial?.room,gameId:partial?.gameId,resultFile,reviewFile,sourceVersion:version.id,error:error.message,finishedAt:new Date().toISOString(),reviewed:false});state.progress=streakProgress(state.records);state.status='awaiting-review';delete state.active;write(file,state);throw error;
 }
 finally{bot?.close();engine.close();await bot?.leave();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.stack??e.message);process.exitCode=1;});
