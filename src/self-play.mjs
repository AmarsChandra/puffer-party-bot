#!/usr/bin/env node
/** Sustained real-server test in an unlisted private room. Does not count a self-play result as a public win. */
import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {PufferBot} from './puffer-bot.mjs';
import {AnswerEngine} from './answer-engine.mjs';
import {CodexProvider} from './codex-provider.mjs';
import {DATA,RUNS} from './paths.mjs';
const options={categories:20,seconds:720,output:path.join(RUNS,'self-play'),cache:path.join(DATA,'learned-answers.json')};
for(let i=2;i<process.argv.length;i++){
  const key=process.argv[i].replace(/^--/,'');
  if(!['categories','seconds','output','cache'].includes(key)||!process.argv[i+1])throw new Error('Use --categories N --seconds N --output DIR --cache FILE');
  options[key]=process.argv[++i];
}
if(!Number.isInteger(Number(options.categories))||options.categories<1||options.categories>100)throw new Error('Invalid category count');
if(!Number.isFinite(Number(options.seconds))||options.seconds<10)throw new Error('Invalid time limit');
fs.mkdirSync(options.output,{recursive:true});
const log=(type,data)=>console.log(JSON.stringify({at:new Date().toISOString(),type,...data}));
const provider=new CodexProvider({cwd:path.join(options.output,'answer-worker'),onLog:log});
const bots=[];
const engine=new AnswerEngine({bankPath:path.join(DATA,'answers.json'),cachePath:options.cache,provider,onLog:log,onReady:()=>{for(const bot of bots)void bot.tick();}});
let resolveDone,stopping=false,timer;
const done=new Promise(resolve=>{resolveDone=resolve;});
const end=reason=>{if(!stopping){stopping=true;for(const bot of bots)bot.paused=true;resolveDone(reason);}};
class PrivateBot extends PufferBot{
  log(type,data={}){
    const line=JSON.stringify({at:new Date().toISOString(),side:this.options.name,type,...data});
    fs.appendFileSync(this.logPath,line+'\n');
    if(['category','error','result','generating-answers'].includes(type))console.log(line);
  }
  async join(){
    if(this.seat)return;
    await this.identity();
    const route=this.options.host?'/rooms':`/rooms/${this.options.room}/join`;
    const response=await fetch('https://party.krillion.io'+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://krillion.io'},body:JSON.stringify({guestToken:this.token,name:this.options.name,character:'krill',seen:[],isPrivate:true}),signal:AbortSignal.timeout(12000)});
    const seat=await response.json();
    if(!response.ok)throw new Error(seat.error??`Join failed ${response.status}`);
    this.seat={...seat,code:seat.code??this.options.room};
  }
  onRoom(){
    super.onRoom();
    if(this.options.host&&this.room.phase==='lobby'&&this.room.players.length===2&&!this.started){
      this.started=true;void this.act({type:'start'}).catch(e=>end('start-error: '+e.message));
    }
    if(this.room.phase==='over')end('game-over-before-target');
    else if((this.room.category?.index??0)>Number(options.categories))end('target-reached');
  }
}
process.once('SIGINT',()=>end('interrupted'));
try{
  await engine.warmup();
  const host=new PrivateBot({host:true,name:'PufferAlpha',output:options.output,engine,timeout:Number(options.seconds)*1000+5000});
  bots.push(host);await host.join();
  const guest=new PrivateBot({room:host.seat.code,name:'PufferBeta',output:options.output,engine,timeout:Number(options.seconds)*1000+5000});
  bots.push(guest);
  log('private-test',{room:host.seat.code,categories:Number(options.categories)});
  const runs=bots.map(bot=>bot.run().catch(e=>{end('client-error: '+e.message);}));
  timer=setTimeout(()=>end('time-limit'),Number(options.seconds)*1000);
  const reason=await done;
  const settleUntil=Date.now()+2000;
  while(bots.some(b=>b.pending.size)&&Date.now()<settleUntil)await sleep(50);
  const finalRoom=bots.map(b=>b.room).filter(Boolean).sort((a,b)=>b.version-a.version)[0];
  const report={createdAt:new Date().toISOString(),kind:'private-self-play',reason,room:host.seat.code,targetCategories:Number(options.categories),completedCategories:Math.max(0,(finalRoom?.category?.index??1)-1),passed:reason==='target-reached'&&finalRoom.players.every(p=>p.alive),bots:bots.map(b=>({name:b.options.name,metrics:b.metrics,player:finalRoom?.players.find(p=>p.id===b.seat.playerId)})),finalRoom};
  fs.writeFileSync(path.join(options.output,'self-play-report.json'),JSON.stringify(report,null,2));
  log('self-play-result',{passed:report.passed,reason,categories:report.completedCategories,players:report.bots.map(b=>({name:b.name,answers:b.player?.answers,lives:b.player?.lives,pops:b.player?.pops})),file:path.join(options.output,'self-play-report.json')});
  process.exitCode=report.passed?0:2;
}finally{
  clearTimeout(timer);
  for(const bot of bots){bot.close();bot.finish?.({stopped:true});}
  engine.close();
  await Promise.allSettled(bots.map(bot=>bot.leave()));
}
