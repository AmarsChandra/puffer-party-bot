import fs from 'node:fs';
import path from 'node:path';
import {normalize,AnswerEngine} from './answer-engine.mjs';
import {CodexProvider} from './codex-provider.mjs';
import {NaturalTyper,turnSeconds} from './letter-typing.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function observe(tab){
 return tab.playwright.evaluate(()=>{
  const text=document.body?.innerText??'';
  const input=Array.from(document.querySelectorAll('input')).find(e=>e.getAttribute('aria-label')==='Your answer'||/you're out|watching/i.test(e.placeholder));
  const prompt=document.querySelector('.pf-root .ds-card:not(.pf-newcat):not(.cleared):not(.gone) .prompt');
  let promptReady=false;
  if(prompt&&/^Name\s/i.test(prompt.innerText??'')){
   const card=prompt.parentElement;promptReady=null;
   try{
    if(typeof card.getAnimations==='function')promptReady=!card.getAnimations({subtree:true}).some(a=>(a.pending||a.playState==='running'||a.playState==='paused')&&a.effect?.getComputedTiming().iterations!==Infinity);
   }catch{}
   try{
    if(typeof getComputedStyle==='function'){
     const style=getComputedStyle(card);
     if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)<.99)promptReady=false;
    }
   }catch{}
   try{const rect=prompt.getBoundingClientRect();if(rect.width<=0||rect.height<=0)promptReady=false;}catch{}
  }
  return {text:text.slice(0,6500),promptReady,answerInput:input?{placeholder:input.placeholder,disabled:input.disabled,value:input.value}:null};
 });
}
export function promptIsReady(observation,seenAt,now=Date.now()){
 // Some DOM bridges cannot expose animation timing. The public entrance CSS
 // uses a 1.05s delay plus 0.7s animation; wait conservatively in that case.
 return observation.promptReady===null?now-seenAt>=1800:observation.promptReady!==false;
}
export function createRun(root){
 fs.mkdirSync(root,{recursive:true});
 let state={startedAt:new Date().toISOString(),target:100,current:0,best:0,records:[],active:null,recording:{method:'Timestamped browser screenshots',audio:false},name:'Dinosaur',naturalInput:true};
 if(fs.existsSync(path.join(root,'run.json')))state=JSON.parse(fs.readFileSync(path.join(root,'run.json')));
 const frameSeq=fs.existsSync(path.join(root,'frames'))?Math.max(0,...fs.readdirSync(path.join(root,'frames')).filter(f=>/^\d+\.png$/.test(f)).map(f=>Number.parseInt(f,10))):0;
 return {root,state,seq:0,frameSeq,question:null,used:new Set(),submitted:new Set(),pending:null,lastFrame:0,lastSubmit:0};
}
function log(run,type,data={}){
 if(run.state.trackStats===false){
  if(!['match-start','match-end','result-evidence','controller-window-start','controller-window-end','controller-progress'].includes(type))return;
  if(type==='controller-progress')data={room:run.state.active?.room};
  if(type==='controller-window-end')data={};
  if(type==='controller-window-start')data={};
 }
 fs.appendFileSync(path.join(run.root,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),type,...data})+'\n');
}
function save(run){fs.writeFileSync(path.join(run.root,'run.json'),JSON.stringify(run.state,null,2));}
async function capture(run,tab,force=false){
 if(run.state.recording?.enabled===false)return;
 if(!force&&Date.now()-run.lastFrame<(run.captureRetryMs??650))return;
 const before=Date.now();let bytes;
 try{bytes=await tab.screenshot({fullPage:false});}catch(e){
  run.lastFrame=Date.now();run.captureRetryMs=2500;
  if(run.windowMetrics)run.windowMetrics.recordingFailures++;
  log(run,'recording-error',{message:String(e.message??e),retryAfterMs:2500});return;
 }
 const rel=`frames/${String(++run.frameSeq).padStart(7,'0')}.png`;fs.mkdirSync(path.join(run.root,'frames'),{recursive:true});fs.writeFileSync(path.join(run.root,rel),bytes);
 fs.appendFileSync(path.join(run.root,'frames.jsonl'),JSON.stringify({file:rel,at:before,finishedAt:Date.now(),match:run.state.active?.number??null})+'\n');run.lastFrame=Date.now();run.captureRetryMs=650;
 if(run.windowMetrics)run.windowMetrics.maxRecordingMs=Math.max(run.windowMetrics.maxRecordingMs,run.lastFrame-before);
}
export async function drive(run,tab,engine,{seconds=35,queue=true,stopAfterMatch=false,onProgress=()=>{},progressIntervalMs=30000,roomClaims=null}={}){
 const end=Date.now()+seconds*1000;let last;
 const windowStarted=Date.now();
 run.windowMetrics={observations:0,maxObservationGapMs:0,maxRecordingMs:0,recordingFailures:0};
 let lastObserved=null,lastProgress=windowStarted;
 log(run,'controller-window-start',{previousWindowGapMs:run.lastWindowEnd?windowStarted-run.lastWindowEnd:null});
 run.waitReason=null;
 const waiting=(question,reason)=>{if(run.waitReason!==reason){log(run,'turn-waiting',{question,reason});run.waitReason=reason;}};
 try{
 while(Date.now()<end&&run.state.current<run.state.target){
  const s=await observe(tab),text=s.text,lastText=run.lastText;last=s;run.lastText=text;
  const observedAt=Date.now();run.windowMetrics.observations++;
  if(lastObserved!==null)run.windowMetrics.maxObservationGapMs=Math.max(run.windowMetrics.maxObservationGapMs,observedAt-lastObserved);
  lastObserved=observedAt;
  if(text!==lastText)log(run,'visible-state',{text});
  const room=/\b([A-HJ-NP-Z]{4})\s*\nCATEGORY|\b([A-HJ-NP-Z]{4})\s*\nGAME OVER/.exec(text)?.slice(1).find(Boolean);
  const rated=/RATED (?:4–6|1V1|3S|8–10)/.test(text)&&!/UNRATED/.test(text);
  if(room&&!rated)throw new Error('Refusing to play an unrated table in this ranked run');
  const ownNameVisible=text.split('\n').some(line=>line.trim()===run.state.name);
  if(room&&ownNameVisible&&!run.state.active&&!run.state.records.some(r=>r.room===room)){
   if(roomClaims?.has(room)&&roomClaims.get(room)!==run.root)throw new Error(`Parallel tables joined the same room ${room}; second controller stopped before input`);
   roomClaims?.set(room,run.root);
   run.state.active={number:run.state.records.length+1,room,startedAt:new Date().toISOString(),rated,name:run.state.name};run.question=null;run.pending=null;run.used.clear();run.submitted.clear();log(run,'match-start',run.state.active);save(run);
  }
  const lost=s.answerInput?.disabled&&/you['’]re out/i.test(s.answerInput.placeholder)||/\bYOU (?:LOSE|LOST)\b/.test(text);
  const won=/GAME OVER[\s\S]*\nYOU WIN\b/.test(text);
  const interrupted=!ownNameVisible&&(s.answerInput?.disabled&&/spectating/i.test(s.answerInput.placeholder)||/GAME\s+\d+\s*[·•]\s*LOBBY/.test(text));
  if(run.state.active&&(won||lost||interrupted)){
   log(run,'result-evidence',{room:run.state.active.room,text});
   await capture(run,tab,true);const record={...run.state.active,outcome:won&&run.state.active.rated?'win':lost?'loss':'inconclusive',finishedAt:new Date().toISOString(),...(interrupted?{reason:'Seat absent after spectating or table rollover; no result screen observed'}:{})};
   run.state.records.push(record);run.state.current=record.outcome==='win'?run.state.current+1:0;run.state.best=Math.max(run.state.best,run.state.current);run.state.active=null;log(run,'match-end',{...record,current:run.state.current,best:run.state.best});save(run);
   if(run.state.current>=run.state.target)break;
   const leave=tab.playwright.getByRole('button',{name:'Leave room',exact:true});
   if(await leave.count())await leave.click();else if(await tab.playwright.getByRole('button',{name:'NEW TABLE',exact:true}).count())await tab.playwright.getByRole('button',{name:'NEW TABLE',exact:true}).click();
   const after=await observe(tab);log(run,'after-leave',{text:after.text});run.lastText=after.text;
   if(won||interrupted||stopAfterMatch)break;
   await sleep(200);continue;
  }
  // A table can roll over or be revisited after its result was recorded.
  // Leave an unowned spectator/result screen instead of waiting there forever.
  if(!run.state.active&&(won||lost||s.answerInput?.disabled&&/spectating/i.test(s.answerInput.placeholder))){
   const leave=tab.playwright.getByRole('button',{name:'Leave room',exact:true});
   if(await leave.count()){await leave.click();run.lastText=(await observe(tab)).text;await sleep(80);continue;}
  }
  const q=/\n(Name [^\n]+)/.exec(text)?.[1];
  if(q&&run.state.active&&ownNameVisible){
   if(run.question!==q){run.question=q;run.questionSeenAt=Date.now();run.pending=null;run.used.clear();run.submitted.clear();log(run,'category',{question:q});}
   run.questionSeenAt??=Date.now();
   // Visible answer bubbles precede RATED; include only observed answer strings.
   const prefix=text.split(/RATED (?:4–6|1V1|3S|8–10)/)[0];for(const line of prefix.split('\n'))if(line.trim())run.used.add(normalize(line));
   void Promise.resolve(engine.prime(q,{exclude:new Set([...run.used,...run.submitted])})).catch(e=>log(run,'answer-prime-error',{question:q,message:String(e.message??e)}));
   const holder=/▸\s*([^\n]+?)\s+is up/.exec(text)?.[1]?.trim().replace(/^new category\s*[·•]\s*/i,'');
   if(!promptIsReady(s,run.questionSeenAt))waiting(q,'prompt-revealing');
   else if((holder===run.state.name||s.answerInput?.placeholder.toLowerCase().startsWith('your puffer'))&&s.answerInput&&!s.answerInput.disabled&&Date.now()-run.lastSubmit>350){
    const choice=run.pending?.choice??engine.answer(q,new Set([...run.used,...run.submitted]));
    if(choice){
     if(!run.pending){run.pending={question:q,choice};log(run,'turn-choice',{question:q,choice:choice.text,placeholder:s.answerInput.placeholder});}
     try{
     const input=tab.playwright.getByRole('textbox',{name:'Your answer',exact:true});let ready=true;
     if(run.state.naturalInput){
      run.pending.typer??=new NaturalTyper(choice.text);
      const step=run.pending.typer.next({value:s.answerInput.value,secondsLeft:turnSeconds(text)});
      ready=step.kind==='submit';
      if(step.kind==='type'){await input.pressSequentially(step.text,{});run.naturalTypingObserved=true;}
      else if(step.kind==='clear')await input.fill('');
     }else if(s.answerInput.value!==choice.text)await input.fill(choice.text);
     if(ready){
     const button=tab.playwright.getByRole('button',{name:/^Send answer$/i});
     const enabled=await button.isEnabled();log(run,'send-button',{enabled});
     if(enabled){
      await input.press('Enter');run.lastSubmit=Date.now();run.submitted.add(normalize(choice.text));run.pending=null;run.waitReason=null;log(run,'submitted',{question:q,answer:choice.text,source:choice.source});
      const after=await observe(tab);log(run,'after-submit',{text:after.text});run.lastText=after.text;
     }else waiting(q,'send-disabled');
     }
     }catch(e){
      if(!/selector deadline exceeded|element is not attached|element.*detached/i.test(String(e.message??e)))throw e;
      log(run,'input-retry',{question:q,message:String(e.message??e)});
     }
    }else waiting(q,'no-ready-answer');
   }else if(holder!==run.state.name&&!s.answerInput?.placeholder.toLowerCase().startsWith('your puffer')){
    run.pending=null;run.waitReason=null;
   }
  }
  if(queue&&!run.state.active&&/WHO'S PLAYING/.test(text)){
   const ratedButton=tab.playwright.getByRole('button',{name:'▶ RATED ◀',exact:true});
   if(await ratedButton.count()){await ratedButton.click();const after=await observe(tab);log(run,'ranked-queue',{text:after.text});run.lastText=after.text;}
  }
  await capture(run,tab);
  if(Date.now()-lastProgress>=progressIntervalMs){
   const progress={elapsedMs:Date.now()-windowStarted,current:run.state.current,best:run.state.best,active:run.state.active,question:run.question,waitReason:run.waitReason,metrics:{...run.windowMetrics}};
   log(run,'controller-progress',progress);
   try{await onProgress(progress);}catch(e){log(run,'progress-output-error',{message:String(e.message??e)});}
   lastProgress=Date.now();
  }
  await sleep(run.pending?.typer?15+Math.random()*40:80);
 }
 save(run);return {current:run.state.current,best:run.state.best,games:run.state.records.length,active:run.state.active,lastText:last?.text?.slice(0,1700),frames:run.frameSeq,metrics:{...run.windowMetrics}};
 }finally{
  run.lastWindowEnd=Date.now();log(run,'controller-window-end',{elapsedMs:run.lastWindowEnd-windowStarted,metrics:{...run.windowMetrics}});
 }
}

// Await this once for an entire match. Repeated short drive() calls create gaps
// while their caller handles chat/tool results, even when answers are cached.
export async function playRatedMatch(run,tab,engine,{maxSeconds=900,queue=true,onProgress=()=>{},progressIntervalMs=30000,roomClaims=null}={}){
 if(!Number.isFinite(maxSeconds)||maxSeconds<=0)throw new Error('maxSeconds must be positive');
 const before=run.state.records.length;
 const result=await drive(run,tab,engine,{seconds:maxSeconds,queue,stopAfterMatch:true,onProgress,progressIntervalMs,roomClaims});
 if(run.state.active){
  const record={...run.state.active,outcome:'inconclusive',finishedAt:new Date().toISOString(),reason:'Whole-match controller watchdog expired before a result was observed'};
  run.state.records.push(record);run.state.current=0;run.state.active=null;save(run);log(run,'match-end',{...record,current:0,best:run.state.best});
  const leave=tab.playwright.getByRole('button',{name:'Leave room',exact:true});
  if(await leave.count()){await leave.click();const after=await observe(tab);log(run,'after-leave',{text:after.text});run.lastText=after.text;}
 }
 return {...result,current:run.state.current,best:run.state.best,games:run.state.records.length,active:run.state.active,record:run.state.records[before]??null};
}

// Multiple complete matches share one awaited call and a warm local cache.
// The control file can stop new queues without interrupting an active match.
export async function playRatedBatch(run,tab,engine,{maxGames=10,maxSeconds=2700,perMatchSeconds=1800}={}){
 const before=run.state.records.length,end=Date.now()+maxSeconds*1000;
 for(let i=0;i<maxGames&&Date.now()<end&&run.state.current<run.state.target;i++){
  const controlFile=path.join(run.root,'control.json');
  if(fs.existsSync(controlFile)&&JSON.parse(fs.readFileSync(controlFile,'utf8')).continue===false)break;
  if(i>0&&run.state.naturalInput)await sleep(900+Math.random()*1600);
  const result=await playRatedMatch(run,tab,engine,{maxSeconds:perMatchSeconds});
  engine.pauseGeneration?.();
  if(!result.record||result.record.outcome==='inconclusive')break;
 }
 return {played:run.state.records.length-before,current:run.state.current,best:run.state.best,active:run.state.active};
}

// Separate engines own their generation/turn state. Sharing only the learned
// data object keeps synchronous cache saves from overwriting another table.
export function shareBrowserCache(engine,source){
 if(engine===source||engine.cachePath!==source.cachePath)throw new Error('Shared browser caches require distinct engines with the same cache path');
 engine.data=source.data;
}

// One whole match per tab, fully awaited together. Seat the first table before
// queuing the second so matchmaking does not pair our controllers together.
export async function playParallelRatedMatches(lanes,{maxSeconds=3600,seatWaitSeconds=120,onProgress=()=>{},progressIntervalMs=30000}={}){
 if(lanes.length!==2)throw new Error('The parallel trial requires exactly two tables');
 if(new Set(lanes.map(l=>l.run.root)).size!==2||new Set(lanes.map(l=>l.tab.id??l.tab)).size!==2||new Set(lanes.map(l=>l.engine)).size!==2)throw new Error('Parallel tables require separate runs, tabs and engines');
 const roomClaims=new Map();let firstFinished=false,overlapObserved=false;
 for(const lane of lanes){const room=lane.run.state.active?.room;if(!room)continue;if(roomClaims.has(room))throw new Error('Parallel tables already share a room');roomClaims.set(room,lane.run.root);}
 const report=()=>{
  const active=lanes.map(l=>l.run.state.active?.room??null);
  if(active.every(Boolean)&&new Set(active).size===2)overlapObserved=true;
  return onProgress({active,overlapObserved,typed:lanes.map(l=>l.run.naturalTypingObserved===true)});
 };
 const play=lane=>playRatedMatch(lane.run,lane.tab,lane.engine,{maxSeconds,roomClaims,onProgress:report,progressIntervalMs}).finally(()=>{lane.engine.pauseGeneration?.();});
 const first=play(lanes[0]).finally(()=>{firstFinished=true;});
 const second=(async()=>{
  const deadline=Date.now()+seatWaitSeconds*1000;
  while(!firstFinished&&!lanes[0].run.state.active&&Date.now()<deadline)await sleep(50);
  if(firstFinished||!lanes[0].run.state.active)return {skipped:'First table did not remain seated before the second queue'};
  return play(lanes[1]);
 })();
 const settled=await Promise.allSettled([first,second]);
 await report();
 return {overlapObserved,results:settled.map(r=>r.status==='fulfilled'?r.value:{error:String(r.reason?.message??r.reason)})};
}

export async function createBrowserEngine(root,repo,{trackStats=true,localFirst=false,sharedCacheFrom=null}={}){
 const provider=new CodexProvider({cwd:path.join(root,'answer-worker'),onLog:(type,data)=>{if(trackStats)fs.appendFileSync(path.join(root,'model-events.jsonl'),JSON.stringify({at:new Date().toISOString(),type,...data})+'\n');}});
 const engine=new AnswerEngine({bankPath:path.join(repo,'data/answers.json'),cachePath:path.join(repo,'data/learned-answers.json'),provider});
 if(sharedCacheFrom)shareBrowserCache(engine,sharedCacheFrom);
 if(localFirst){
  const prime=engine.prime.bind(engine);
  engine.prime=(question,options={})=>{
   if(!options.force&&engine.records(question,options.exclude??new Set()).length>=2){engine.pauseGeneration();return Promise.resolve();}
   return prime(question,options);
  };
 }
 engine.save=()=>{fs.mkdirSync(path.dirname(engine.cachePath),{recursive:true});fs.writeFileSync(engine.cachePath+'.browser-tmp',JSON.stringify(engine.data,null,2));fs.renameSync(engine.cachePath+'.browser-tmp',engine.cachePath);};
 await provider.start();return engine;
}
