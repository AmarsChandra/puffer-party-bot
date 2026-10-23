#!/usr/bin/env node
/** One public seat, sequential games, all outcomes retained. No self-play wins. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {PufferBot} from './puffer-bot.mjs';
import {AnswerEngine} from './answer-engine.mjs';
import {CodexProvider} from './codex-provider.mjs';

import {ROOT,DATA,RUNS,SOURCE_FILES} from './paths.mjs';
export function verifiedOutcome(result,queue){
 const room=result?.finalRoom,start=result?.startingRoom;
 if(!room||room.phase!=='over'||!room.gameId||room.settings?.isPrivate!==false||room.queue!==queue)return 'inconclusive';
 if(!start||!['countdown','round'].includes(start.phase)||start.gameNumber!==room.gameNumber||!start.players.some(p=>p.id===result.playerId))return 'inconclusive';
 const me=room.players.find(p=>p.id===result.playerId);
 if(!me||result.winnerId!==room.winnerId||result.gameId!==room.gameId)return 'inconclusive';
 if(result.won===true&&room.winnerId===me.id&&me.place===1&&me.alive&&me.lives>0)return 'win';
 if(result.won===false&&room.winnerId&&room.winnerId!==me.id)return 'loss';
 return 'inconclusive';
}
export function streakProgress(records){
 let current=0,best=0;
 const seen=new Set();
 for(const r of records){
  const duplicate=r.gameId&&seen.has(r.gameId);
  if(r.gameId)seen.add(r.gameId);
  current=r.outcome==='win'&&!duplicate?current+1:0;
  best=Math.max(best,current);
 }
 return {current,best};
}
function fingerprint(){
 return Object.fromEntries(SOURCE_FILES.map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(ROOT,name))).digest('hex')]));
}
async function main(){
 const opts={target:20,size:'party',output:path.join(RUNS,'streak'),cache:path.join(DATA,'learned-answers.json'),timeout:600000};
 for(let i=2;i<process.argv.length;i++){
  const raw=process.argv[i].replace(/^--/,''),key=raw==='watch-seat'?'watchSeat':raw;
  if(!['target','size','output','cache','timeout','name','watchSeat'].includes(key)||!process.argv[i+1])throw new Error('Use --target 20 --size party --output DIR --cache FILE --timeout MS --watch-seat FILE');
  opts[key]=process.argv[++i];
 }
 if(!Number.isInteger(Number(opts.target))||opts.target<1)throw new Error('Invalid streak target');
 if(!['duel','trio','party','crowd'].includes(opts.size))throw new Error('Invalid queue size');
 fs.mkdirSync(opts.output,{recursive:true});
 const manifestPath=path.join(opts.output,'streak.json'),sources=fingerprint();
 const state={version:1,target:Number(opts.target),queue:opts.size,kind:'sequential-public-matchmaking',startedAt:new Date().toISOString(),sources,records:[],status:'running'};
 const save=()=>{state.progress=streakProgress(state.records);const tmp=manifestPath+'.tmp';fs.writeFileSync(tmp,JSON.stringify(state,null,2));fs.renameSync(tmp,manifestPath);};
 if(fs.existsSync(manifestPath))throw new Error('This output directory already contains a streak. Use a new directory to preserve its evidence.');
 const log=(type,data={})=>{const line=JSON.stringify({at:new Date().toISOString(),type,...data});console.log(line);fs.appendFileSync(path.join(opts.output,'streak.jsonl'),line+'\n');};
 let current,stopping=false;
 const provider=new CodexProvider({cwd:path.join(opts.output,'answer-worker'),onLog:log});
 const engine=new AnswerEngine({bankPath:path.join(DATA,'answers.json'),cachePath:opts.cache,provider,onLog:log,onReady:q=>current?.answerReady(q)});
 process.once('SIGINT',()=>{stopping=true;log('stopping-after-current-game');});
 process.once('SIGTERM',()=>{stopping=true;log('stopping-after-current-game');});
 save();
 try{
  await engine.warmup();
  while(!stopping&&state.progress.current<state.target){
   if(JSON.stringify(fingerprint())!==JSON.stringify(sources))throw new Error('Source files changed during validation; start a fresh streak with the new version.');
   const number=state.records.length+1,gameDir=path.join(opts.output,`game-${String(number).padStart(3,'0')}`);
   current=new PufferBot({name:opts.name??'PufferBot',size:opts.size,output:gameDir,engine,timeout:Number(opts.timeout),watchSeat:opts.watchSeat});
   log('match-start',{number,streak:state.progress.current,queue:opts.size});
   try{
    const result=await current.run();
    const outcome=verifiedOutcome(result,opts.size);
    const resultFile=path.join(gameDir,'result.json');fs.writeFileSync(resultFile,JSON.stringify(result,null,2));
    state.records.push({number,outcome,gameId:result.gameId,room:result.room,gameNumber:result.gameNumber,players:result.startingRoom?.players.filter(p=>!p.removed).length,resultFile:path.relative(opts.output,resultFile),accepted:result.player?.answers,lives:result.player?.lives,finishedAt:new Date().toISOString()});
    if(opts.watchSeat){save();log('result-visible',{number,outcome,room:result.room,progress:state.progress});await sleep(8000);}
   }catch(error){
    state.records.push({number,outcome:'inconclusive',room:current.seat?.code,error:error.message,finishedAt:new Date().toISOString()});
   }finally{current.close();await current.leave();}
   save();log('match-finished',{...state.records.at(-1),progress:state.progress,target:state.target});
   // A loss returns control for diagnosis and improvement. Evidence is retained.
   if(state.records.at(-1).outcome!=='win'){state.status='needs-improvement';save();process.exitCode=2;return;}
   if(state.progress.current<state.target&&!stopping)await sleep(1500);
  }
  state.status=state.progress.current>=state.target?'target-reached':'stopped';save();log('streak-finished',{status:state.status,progress:state.progress,manifest:manifestPath});
 }finally{current?.close();engine.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.stack??error.message);process.exitCode=1;});
