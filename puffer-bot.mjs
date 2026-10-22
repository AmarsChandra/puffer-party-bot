#!/usr/bin/env node
/** Puffer Party client. Node.js 22+; no npm dependencies. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { AnswerEngine, candidates, normalize, questionKey } from './answer-engine.mjs';
import { CodexProvider } from './codex-provider.mjs';
export { candidates, normalize } from './answer-engine.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://party.krillion.io';
export function applyPatch(room, p) {
  if (!room || room.version !== p.base) return null;
  const next = { ...room, ...(p.set ?? {}), version: p.v, now: p.now };
  if (p.players || p.drop) {
    const players = new Map(room.players.map(x => [x.id, x]));
    for (const id of p.drop ?? []) players.delete(id);
    for (const player of p.players ?? []) players.set(player.id, player);
    next.players = [...players.values()].sort((a,b) => a.seat-b.seat);
  }
  for (const field of ['events','chat']) {
    if (p[field+'All']) next[field] = p[field+'All'];
    else if (p[field]) {
      next[field] = [...(room[field] ?? []), ...p[field]];
      if (p[field+'Length'] != null) next[field] = p[field+'Length'] === 0 ? [] : next[field].slice(-p[field+'Length']);
    }
  }
  return next;
}

async function post(url, body) {
  const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json',Origin:'https://krillion.io'}, body:JSON.stringify(body), signal:AbortSignal.timeout(12000) });
  const data = await r.json();
  if (!r.ok || data.ok === false) throw new Error(`${r.status}: ${data.error ?? JSON.stringify(data)}`);
  return data;
}

export class PufferBot {
  constructor(options={}) {
    this.options = options;
    this.bankPath = options.answers ?? path.join(DIR,'answers.json');
    this.pending = new Map(); this.tried = new Set(); this.used = new Set();
    this.room = null; this.seq = 0; this.busy = false; this.stopped = false;
    this.accepted = []; this.rejected = []; this.categories = [];
    this.outputDir = options.output ?? path.join(DIR,'runs');
    fs.mkdirSync(this.outputDir,{recursive:true});
    this.logPath=path.join(this.outputDir,`run-${Date.now()}.jsonl`);
    this.metrics={attempts:0,accepted:0,reactionMs:[],sources:{},unknownCategories:[],categoryLatency:[]};
    this.categoryTexts=new Map();this.lastEventSeq=0;this.nextSendAt=0;
    this.ownsEngine=!options.engine;
    this.engine=options.engine??new AnswerEngine({bankPath:this.bankPath,cachePath:options.cache??path.join(DIR,'learned-answers.json'),provider:options.provider??null,onLog:(t,d)=>this.log(t,d),onReady:q=>this.answerReady(q)});
  }
  log(type, data={}) { const line=JSON.stringify({at:new Date().toISOString(),type,...data});console.log(line);fs.appendFileSync(this.logPath,line+'\n'); }
  async identity({force=false}={}) {
    if(this.token&&!force&&this.tokenExp*1000>Date.now()+30000)return;
    const previousGuest=this.token?JSON.parse(Buffer.from(this.token.split('.')[1],'base64url')).g:null;
    const r = await fetch('https://krillion.io/api/party/token',{headers:this.guestCookie?{Cookie:this.guestCookie}:{},signal:AbortSignal.timeout(12000)});
    if(!r.ok) throw new Error(`Guest identity failed: ${r.status}`);
    const data=await r.json();
    if(typeof data.token!=='string') throw new Error('Guest token missing');
    const claims=JSON.parse(Buffer.from(data.token.split('.')[1],'base64url'));
    if(previousGuest&&claims.g!==previousGuest)throw new Error('Guest token refresh changed identity; refusing to replace the existing seat identity');
    const cookie=r.headers.getSetCookie?.().find(c=>c.startsWith('krillion-party-guest='));
    if(cookie)this.guestCookie=cookie.split(';',1)[0];
    this.token=data.token;
    this.tokenExp=data.exp??claims.exp;
    if(this.seat)this.publishWatchSeat();
  }
  publishWatchSeat(){
    if(!this.options.watchSeat)return;
    fs.mkdirSync(path.dirname(this.options.watchSeat),{recursive:true});
    const data={...this.seat,token:this.token,tokenExp:this.tokenExp,guestCookie:this.guestCookie,name:this.options.name??'PufferBot',character:'krill'};
    const tmp=this.options.watchSeat+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data),{mode:0o600});fs.renameSync(tmp,this.options.watchSeat);
  }
  async join() {
    if(this.options.resume){
      this.seat=JSON.parse(fs.readFileSync(this.options.resume,'utf8'));
      if(!this.seat.token)throw new Error('Saved seat lacks its guest identity token; create a new saved seat');
      this.token=this.seat.token;this.tokenExp=this.seat.tokenExp;this.guestCookie=this.seat.guestCookie;
    }
    await this.identity();
    const common = {guestToken:this.token, name:this.options.name ?? 'PufferBot',character:'krill',seen:[]};
    if(this.options.resume) {
      // Existing guest identity and seat were restored before identity renewal.
    } else if(this.options.room) {
      this.seat={...await post(`${BASE}/rooms/${this.options.room}/join`,common),code:this.options.room};
    } else {
      this.seat=await post(`${BASE}/quick-play`,{...common,size:this.options.size??'duel',rated:false});
    }
    if(!this.seat.code||!this.seat.playerId||!this.seat.playerKey) throw new Error('Incomplete seat response');
    this.publishWatchSeat();
    if(this.options.saveSeat) fs.writeFileSync(this.options.saveSeat,JSON.stringify({...this.seat,token:this.token,tokenExp:this.tokenExp,guestCookie:this.guestCookie}),{mode:0o600});
    this.log('joined',{room:this.seat.code,playerId:this.seat.playerId,url:`https://krillion.io/party/${this.seat.code}`});
  }
  send(msg) { if(this.ws?.readyState===WebSocket.OPEN) {this.ws.send(JSON.stringify(msg));return true;} return false; }
  act(action) {
    const cid=`${Date.now().toString(36)}-${++this.seq}`;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(cid);reject(new Error('Action acknowledgement timed out'));},10000);
      this.pending.set(cid,{resolve,reject,timer});
      if(!this.send({t:'act',cid,action})) {clearTimeout(timer);this.pending.delete(cid);reject(new Error('Connection unavailable'));}
    });
  }
  async connect() {
    if(this.stopped) return;
    const u=new URL(`${BASE.replace('https:','wss:')}/rooms/${this.seat.code}/ws`);
    u.searchParams.set('key',this.seat.playerKey); u.searchParams.set('token',this.token);
    this.ws=new WebSocket(u);
    this.ws.onmessage=e=>{
      try {
        const m=JSON.parse(String(e.data));
        if(m.t==='snap') this.room=m.room;
        else if(m.t==='patch') { const r=applyPatch(this.room,m.patch); if(!r){this.send({t:'sync'});return;} this.room=r; }
        else if(m.t==='ack') {const p=this.pending.get(m.cid); if(p){clearTimeout(p.timer);this.pending.delete(m.cid);p.resolve(m);} return;}
        else if(m.t==='gone'||m.t==='removed') {this.fail(new Error(`Room ${m.t}`));return;}
        else return;
        this.onRoom();
      } catch(err) {this.log('error',{message:err.message});}
    };
    this.ws.onerror=()=>{};
    this.ws.onclose=async e=>{
      for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Connection closed'));} this.pending.clear();
      if(this.stopped) return;
      if([4403,4404,4410].includes(e.code)) return this.fail(new Error(`Room connection refused (${e.code})`));
      this.log('reconnecting',{code:e.code});
      await sleep(1000);
      try {await this.identity({force:e.code===4401});await this.connect();} catch(err){this.fail(err);}
    };
  }
  onRoom() {
    if(this.stopped)return;
    const r=this.room;
    const self=r.players.find(p=>p.id===this.seat.playerId);
    this.firstRoomPhase??=r.phase;
    if(self&&!self.removed){this.sawSeat=true;clearTimeout(this.seatPresenceTimer);this.seatPresenceTimer=null;}
    else if(!this.seatPresenceTimer){
      this.seatPresenceTimer=setTimeout(()=>{
        if(this.stopped||this.room?.players.some(p=>p.id===this.seat.playerId&&!p.removed))return;
        const error=new Error('Assigned seat is absent from the room');
        error.unplayed=this.firstRoomPhase==='lobby'&&!this.sawSeat&&!this.playedGameNumber;
        this.fail?.(error);
      },this.options.seatPresenceGraceMs??3000);
    }
    if(this.seat.quickPlay&&r.phase==='lobby'&&self&&!self.removed&&!self.ready&&!this.playedGameNumber&&!this.readyPending){
      this.readyPending=true;void this.act({type:'again'}).then(ack=>this.log('queue-ready',{ok:ack.ok,error:ack.error})).catch(e=>this.log('queue-ready-error',{message:e.message})).finally(()=>{this.readyPending=false;});
    }
    if(r.phase==='round'&&self?.alive)this.playedGameNumber=r.gameNumber;
    if(r.category)this.categoryTexts.set(`${r.gameNumber}:${r.category.index}`,r.category.text);
    fs.writeFileSync(path.join(this.outputDir,'latest-room.json'),JSON.stringify(r,null,2));
    const key=`${r.gameNumber}:${r.category?.index}`;
    const changedCategory=this.categoryKey!==key;
    if(changedCategory) {
      this.categoryKey=key;this.tried.clear();this.used.clear();this.nextSendAt=0;
      if(r.category) {
        this.categories.push({index:r.category.index,text:r.category.text});this.log('category',r.category);
        this.categoryTiming={gameNumber:r.gameNumber,index:r.category.index,question:r.category.text,observedAt:Date.now(),readyMs:null,firstTurnAt:null,firstSubmitMs:null,firstTurnWaitMs:null};
        this.metrics.categoryLatency.push(this.categoryTiming);
      }
    }
    if(self?.alive&&['countdown','round'].includes(r.phase)&&(!this.startingRoom||this.startingRoom.gameNumber!==r.gameNumber))this.startingRoom=structuredClone(r);
    if(this.eventGame!==r.gameNumber){
      this.eventGame=r.gameNumber;this.lastEventSeq=0;this.eventQuestion=null;
    }
    const gameEvents=(r.events??[]).slice(Math.max(0,(r.events??[]).findLastIndex(e=>e.kind==='countdown')));
    for(const ev of gameEvents){
      if(ev.seq<=this.lastEventSeq)continue;
      if(ev.kind==='category')this.eventQuestion=this.categoryTexts.get(`${r.gameNumber}:${ev.index}`)??null;
      if(ev.kind==='pass'&&this.eventQuestion){
        this.engine.learn(this.eventQuestion,ev.answer,{accepted:true,tier:ev.tier});
      }
      this.lastEventSeq=ev.seq;
    }
    if(changedCategory)this.engine.save();
    let currentEvents=[];
    for(const e of r.events??[]) {
      if(e.kind==='category')currentEvents=[];
      currentEvents.push(e);
    }
    for(const e of currentEvents) {
      if(e.kind==='pass')this.used.add(normalize(e.answer));
      if(e.kind==='reject'&&e.playerId===this.seat.playerId)this.tried.add(normalize(e.text));
    }
    if(r.category&&r.phase==='round')void this.engine.prime(r.category.text,{exclude:new Set([...this.used,...this.tried])});
    if(r.category)this.answerReady(r.category.text,false);
    if(this.categoryTiming&&r.phase==='round'&&r.holderId===this.seat.playerId&&this.categoryTiming.firstTurnAt===null)this.categoryTiming.firstTurnAt=Date.now()+r.holderSince-r.now;
    if(this.lastPhase!==r.phase){this.lastPhase=r.phase;this.log('phase',{phase:r.phase});}
    if(r.phase==='over'&&this.playedGameNumber===r.gameNumber) {
      const me=r.players.find(p=>p.id===this.seat.playerId);
      this.engine.save();
      const result=this.snapshotResult();
      const f=path.join(this.outputDir,`result-${r.code}-${r.gameNumber}.json`);
      fs.writeFileSync(f,JSON.stringify(result,null,2));
      this.log('result',{won:result.won,answers:me?.answers,lives:me?.lives,file:f});
      this.finish(result);
    } else {
      clearTimeout(this.turnTimer);
      if(r.phase==='round'&&r.holderId===this.seat.playerId){
        const delay=Math.max(0,r.holderSince+80-r.now);
        this.turnTimer=setTimeout(()=>void this.tick(),delay);
      }
    }
  }
  snapshotResult(){
    const r=this.room;if(!r||!this.seat)return null;
    return {won:r.winnerId===this.seat.playerId,room:r.code,playerId:this.seat.playerId,winnerId:r.winnerId,gameNumber:r.gameNumber,gameId:r.gameId,rated:r.rated,player:r.players.find(p=>p.id===this.seat.playerId),categories:this.categories,accepted:this.accepted,rejected:this.rejected,metrics:this.metrics,startingRoom:this.startingRoom,finalRoom:r};
  }
  answerReady(question,submit=true){
    if(!this.room?.category||questionKey(question)!==questionKey(this.room.category.text))return;
    const timing=this.categoryTiming;
    if(timing&&timing.readyMs===null){
      const answer=this.engine.answer(question,new Set([...this.used,...this.tried]));
      if(answer){timing.readyMs=Date.now()-timing.observedAt;timing.firstSource=answer.source;this.log('first-answer-ready',{question,latencyMs:timing.readyMs,source:answer.source});}
    }
    if(submit)void this.tick();
  }
  turnKey(r) { return `${r.gameNumber}:${r.category?.index}:${r.holderSince}`; }
  async tick() {
    if(this.busy||this.stopped||this.paused||!this.room||Date.now()<this.nextSendAt)return;
    const r=this.room,me=r.players.find(p=>p.id===this.seat.playerId);
    if(r.phase!=='round'||r.holderId!==this.seat.playerId||!me?.alive)return;
    const turnKey=this.turnKey(r),categoryKey=this.categoryKey;
    if(this.acceptedTurn===turnKey)return;
    const serverTime=r.now+(Date.now()-this.receivedAt);
    if(serverTime<r.holderSince+80)return;
    const excluded=new Set([...this.tried,...this.used]);
    let choice;
    try{choice=this.engine.answer(r.category.text,excluded);}catch(e){this.log('error',{message:e.message});return;}
    if(!choice){
      void this.engine.prime(r.category.text,{exclude:excluded});
      if(this.unknownKey!==categoryKey){this.unknownKey=categoryKey;this.metrics.unknownCategories.push(r.category.text);this.log('generating-answers',{question:r.category.text});}
      return;
    }
    this.busy=true;
    const answer=choice.text,reactionMs=Math.max(0,Math.round(serverTime-r.holderSince));
    const timing=this.categoryTiming;
    if(timing&&timing.firstSubmitMs===null){
      timing.firstSubmitMs=Date.now()-timing.observedAt;
      timing.firstTurnAt??=Date.now()-reactionMs;
      timing.firstTurnWaitMs=Math.max(0,Date.now()-timing.firstTurnAt);
    }
    this.tried.add(normalize(answer));this.nextSendAt=Date.now()+180;this.metrics.attempts++;
    try{
      const ack=await this.act({type:'submit',text:answer});
      const provenance=choice.source==='regular-bank'?{regularTier:choice.regularTier,regularSource:choice.regularSource,regularDataHash:choice.regularDataHash}:{};
      this.log('answer',{question:r.category.text,answer,source:choice.source,...provenance,reactionMs,ok:ack.ok,submit:ack.submit,error:ack.error});
      if(ack.submit?.accepted){
        this.acceptedTurn=turnKey;this.metrics.accepted++;this.metrics.reactionMs.push(reactionMs);
        this.metrics.sources[choice.source]=(this.metrics.sources[choice.source]??0)+1;
        this.accepted.push({question:r.category.text,answer,source:choice.source,...provenance,reactionMs,submit:ack.submit});
        this.engine.learn(r.category.text,answer,{accepted:true,tier:ack.submit.tier,canonical:ack.submit.answer??answer});
        if(this.categoryKey===categoryKey){this.used.add(normalize(answer));this.used.add(normalize(ack.submit.answer??answer));}
      }else if(ack.submit?.why==='miss'||ack.submit?.why==='repeat'){
        this.rejected.push({question:r.category.text,answer,submit:ack.submit});
        if(ack.submit.why==='miss')this.engine.learn(r.category.text,answer,{miss:true});
      }else{
        if(this.categoryKey===categoryKey)this.tried.delete(normalize(answer));
        this.nextSendAt=Date.now()+700;
      }
    }catch(err){this.log('error',{message:err.message});this.nextSendAt=Date.now()+1000;}
    finally{
      this.busy=false;
      if(!this.stopped&&this.room?.category)void this.engine.prime(this.room.category.text,{exclude:new Set([...this.used,...this.tried])});
      if(!this.stopped)this.retryTimer=setTimeout(()=>void this.tick(),Math.max(0,this.nextSendAt-Date.now()));
    }
  }
  async run() {
    await this.join();
    return new Promise((resolve,reject)=>{
      this.finish=result=>{this.close();resolve(result);};
      this.fail=err=>{this.close();reject(err);};
      const onRoom=this.onRoom.bind(this);
      this.onRoom=()=>{this.receivedAt=Date.now();onRoom();};
      this.ticker=setInterval(()=>void this.tick(),50);
      this.pinger=setInterval(()=>this.send({t:'ping'}),15000);
      this.timeout=setTimeout(()=>this.fail(new Error('Game time limit exceeded')),this.options.timeout??600000);
      this.connect().catch(this.fail);
    });
  }
  close() {
    this.stopped=true;clearTimeout(this.turnTimer);clearTimeout(this.retryTimer);clearTimeout(this.seatPresenceTimer);clearInterval(this.ticker);clearInterval(this.pinger);clearTimeout(this.timeout);
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Client stopped'));}
    this.pending.clear();this.ws?.close();if(this.ownsEngine)this.engine.close();
  }
  async leave(){
    if(!this.seat||!this.token)return;
    try{await post(`${BASE}/rooms/${this.seat.code}/act`,{guestToken:this.token,playerKey:this.seat.playerKey,action:{type:'leave'}});}catch(err){this.log('cleanup-error',{message:err.message});}
  }
}

export function batchSummary(results){
  const reactions=results.flatMap(r=>r.metrics?.reactionMs??[]).sort((a,b)=>a-b);
  const attempts=results.reduce((n,r)=>n+(r.metrics?.attempts??0),0),accepted=results.reduce((n,r)=>n+(r.metrics?.accepted??0),0);
  return {games:results.length,wins:results.filter(r=>r.won).length,winRate:results.length?results.filter(r=>r.won).length/results.length:0,accepted,attempts,acceptanceRate:attempts?accepted/attempts:0,medianReactionMs:reactions.length?reactions[Math.floor(reactions.length/2)]:null,results:results.map(r=>({room:r.room,won:r.won,answers:r.player?.answers,lives:r.player?.lives,metrics:r.metrics}))};
}
async function main() {
  if(typeof WebSocket!=='function')throw new Error('Use Node.js 22 or newer (native WebSocket required).');
  const args=process.argv.slice(2),opts={ai:'codex'};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--help'){console.log('Usage: play.sh [--games 5] [--ai codex|off] [--name PufferBot] [--room CODE] [--answers FILE] [--cache FILE] [--output DIR] [--timeout MS] [--max-games N]\nDefault: one unrated 1v1, with signed-in Codex answer generation. --games plays every game; --max-games stops on a win.');return;}
    const names={'--name':'name','--room':'room','--answers':'answers','--output':'output','--max-games':'maxGames','--games':'games','--resume':'resume','--save-seat':'saveSeat','--timeout':'timeout','--ai':'ai','--cache':'cache','--codex':'codex'};
    const key=names[args[i]];if(!key||!args[i+1])throw new Error(`Unknown or incomplete argument: ${args[i]}`);opts[key]=args[++i];
  }
  if(!['codex','off'].includes(opts.ai))throw new Error('--ai must be codex or off');
  if(opts.games&&opts.maxGames)throw new Error('Choose --games or --max-games');
  const max=Number(opts.games??opts.maxGames??1);
  if(!Number.isInteger(max)||max<1||max>100)throw new Error('Game count must be 1–100');
  if(opts.timeout&&(!Number.isFinite(Number(opts.timeout))||Number(opts.timeout)<1000))throw new Error('--timeout must be at least 1000 milliseconds');
  if(opts.room){opts.room=opts.room.toUpperCase();if(!/^[A-HJ-NP-Z]{4}$/.test(opts.room))throw new Error('Invalid room code');}
  const output=opts.output??path.join(DIR,'runs');fs.mkdirSync(output,{recursive:true});
  const log=(type,data)=>console.log(JSON.stringify({at:new Date().toISOString(),type,...data}));
  const provider=opts.ai==='codex'?new CodexProvider({executable:opts.codex,cwd:path.join(output,'answer-worker'),onLog:log}):null;
  const engine=new AnswerEngine({bankPath:opts.answers??path.join(DIR,'answers.json'),cachePath:opts.cache??path.join(DIR,'learned-answers.json'),provider,onLog:log,onReady:q=>current?.answerReady(q)});
  let current;const results=[];
  const stop=async()=>{current?.close();engine.close();await current?.leave();process.exit(130);};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    if(provider){log('warming-up',{message:'Using signed-in Codex for fresh trivia answers.'});await engine.warmup();}
    for(let i=0;i<max;i++){
      current=new PufferBot({...opts,engine});
      try{const result=await current.run();results.push(result);await current.leave();}
      catch(err){await current.leave();throw err;}
      const summary=batchSummary(results);fs.writeFileSync(path.join(output,'batch-summary.json'),JSON.stringify(summary,null,2));log('batch',summary);
      if((!opts.games&&results.at(-1).won)||opts.resume||opts.room)break;
      if(i+1<max)await sleep(1500);
    }
    process.exitCode=results.some(r=>r.won)?0:2;
  }finally{engine.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
