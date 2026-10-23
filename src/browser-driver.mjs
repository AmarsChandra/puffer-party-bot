import fs from 'node:fs';
import path from 'node:path';
import {normalize,AnswerEngine} from './answer-engine.mjs';
import {CodexProvider} from './codex-provider.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function observe(tab){
 return tab.playwright.evaluate(()=>{
  const text=document.body.innerText;
  const input=Array.from(document.querySelectorAll('input')).find(e=>e.getAttribute('aria-label')==='Your answer'||/you're out|watching/i.test(e.placeholder));
  return {text:text.slice(0,6500),answerInput:input?{placeholder:input.placeholder,disabled:input.disabled,value:input.value}:null};
 });
}
export function createRun(root){
 fs.mkdirSync(root,{recursive:true});
 let state={startedAt:new Date().toISOString(),target:100,current:0,best:0,records:[],active:null,recording:{method:'Timestamped browser screenshots',audio:false},name:'Dinosaur'};
 if(fs.existsSync(path.join(root,'run.json')))state=JSON.parse(fs.readFileSync(path.join(root,'run.json')));
 const frameSeq=fs.existsSync(path.join(root,'frames'))?fs.readdirSync(path.join(root,'frames')).filter(f=>/\.png$/.test(f)).length:0;
 return {root,state,seq:0,frameSeq,question:null,used:new Set(),submitted:new Set(),lastFrame:0,lastSubmit:0};
}
function log(run,type,data={}){fs.appendFileSync(path.join(run.root,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),type,...data})+'\n');}
function save(run){fs.writeFileSync(path.join(run.root,'run.json'),JSON.stringify(run.state,null,2));}
async function capture(run,tab,force=false){
 if(!force&&Date.now()-run.lastFrame<650)return;
 const before=Date.now(),bytes=await tab.screenshot({fullPage:false});
 const rel=`frames/${String(++run.frameSeq).padStart(7,'0')}.png`;fs.mkdirSync(path.join(run.root,'frames'),{recursive:true});fs.writeFileSync(path.join(run.root,rel),bytes);
 fs.appendFileSync(path.join(run.root,'frames.jsonl'),JSON.stringify({file:rel,at:before,finishedAt:Date.now(),match:run.state.active?.number??null})+'\n');run.lastFrame=Date.now();
}
export async function drive(run,tab,engine,{seconds=35,queue=true}={}){
 const end=Date.now()+seconds*1000;let last;
 while(Date.now()<end&&run.state.current<run.state.target){
  const s=await observe(tab),text=s.text,lastText=run.lastText;last=s;run.lastText=text;
  if(text!==lastText)log(run,'visible-state',{text});
  const room=/\b([A-HJ-NP-Z]{4})\s*\nCATEGORY|\b([A-HJ-NP-Z]{4})\s*\nGAME OVER/.exec(text)?.slice(1).find(Boolean);
  const rated=/RATED (?:4–6|1V1|3S|8–10)/.test(text)&&!/UNRATED/.test(text);
  if(room&&!rated)throw new Error('Refusing to play an unrated table in this ranked run');
  const ownNameVisible=text.split('\n').some(line=>line.trim()===run.state.name);
  if(room&&ownNameVisible&&!run.state.active&&!run.state.records.some(r=>r.room===room)){
   run.state.active={number:run.state.records.length+1,room,startedAt:new Date().toISOString(),rated,name:run.state.name};run.question=null;run.used.clear();run.submitted.clear();log(run,'match-start',run.state.active);save(run);
  }
  const lost=s.answerInput?.disabled&&/you['’]re out/i.test(s.answerInput.placeholder)||/\bYOU (?:LOSE|LOST)\b/.test(text);
  const won=/GAME OVER[\s\S]*\nYOU WIN\b/.test(text);
  const interrupted=!ownNameVisible&&(s.answerInput?.disabled&&/spectating/i.test(s.answerInput.placeholder)||/GAME\s+\d+\s*[·•]\s*LOBBY/.test(text));
  if(run.state.active&&(won||lost||interrupted)){
   await capture(run,tab,true);const record={...run.state.active,outcome:won&&run.state.active.rated?'win':lost?'loss':'inconclusive',finishedAt:new Date().toISOString(),...(interrupted?{reason:'Seat absent after spectating or table rollover; no result screen observed'}:{})};
   run.state.records.push(record);run.state.current=record.outcome==='win'?run.state.current+1:0;run.state.best=Math.max(run.state.best,run.state.current);run.state.active=null;log(run,'match-end',{...record,current:run.state.current,best:run.state.best});save(run);
   if(run.state.current>=run.state.target)break;
   const leave=tab.playwright.getByRole('button',{name:'Leave room',exact:true});
   if(await leave.count())await leave.click();else if(await tab.playwright.getByRole('button',{name:'NEW TABLE',exact:true}).count())await tab.playwright.getByRole('button',{name:'NEW TABLE',exact:true}).click();
   const after=await observe(tab);log(run,'after-leave',{text:after.text});run.lastText=after.text;
   if(won||interrupted)break;
   await sleep(200);continue;
  }
  const q=/\n(Name [^\n]+)/.exec(text)?.[1];
  if(q){
   if(run.question!==q){run.question=q;run.used.clear();run.submitted.clear();log(run,'category',{question:q});}
   // Visible answer bubbles precede RATED; include only observed answer strings.
   const prefix=text.split(/RATED (?:4–6|1V1|3S|8–10)/)[0];for(const line of prefix.split('\n'))if(line.trim())run.used.add(normalize(line));
   void engine.prime(q,{exclude:new Set([...run.used,...run.submitted])});
   const holder=/▸\s*([^\n]+?)\s+is up/.exec(text)?.[1]?.trim().replace(/^new category\s*[·•]\s*/i,'');
   if((holder===run.state.name||s.answerInput?.placeholder.toLowerCase().startsWith('your puffer'))&&s.answerInput&&!s.answerInput.disabled&&Date.now()-run.lastSubmit>350){
    const choice=engine.answer(q,new Set([...run.used,...run.submitted]));
    if(choice){
     log(run,'turn-choice',{question:q,choice:choice.text,placeholder:s.answerInput.placeholder});
     const input=tab.playwright.getByRole('textbox',{name:'Your answer',exact:true});await input.fill(choice.text);
     const button=tab.playwright.getByRole('button',{name:/^Send answer$/i});
     const enabled=await button.isEnabled();log(run,'send-button',{enabled});
     if(enabled){
      await input.press('Enter');run.lastSubmit=Date.now();run.submitted.add(normalize(choice.text));log(run,'submitted',{question:q,answer:choice.text,source:choice.source});
      const after=await observe(tab);log(run,'after-submit',{text:after.text});run.lastText=after.text;
     }
    }
   }
  }
  if(queue&&!run.state.active&&/WHO'S PLAYING/.test(text)){
   const ratedButton=tab.playwright.getByRole('button',{name:'▶ RATED ◀',exact:true});
   if(await ratedButton.count()){await ratedButton.click();const after=await observe(tab);log(run,'ranked-queue',{text:after.text});run.lastText=after.text;}
  }
  await capture(run,tab);
  await sleep(80);
 }
 save(run);return {current:run.state.current,best:run.state.best,games:run.state.records.length,active:run.state.active,lastText:last?.text?.slice(0,1700),frames:run.frameSeq};
}

export async function createBrowserEngine(root,repo){
 const provider=new CodexProvider({cwd:path.join(root,'answer-worker'),onLog:(type,data)=>fs.appendFileSync(path.join(root,'model-events.jsonl'),JSON.stringify({at:new Date().toISOString(),type,...data})+'\n')});
 const engine=new AnswerEngine({bankPath:path.join(repo,'data/answers.json'),cachePath:path.join(repo,'data/learned-answers.json'),provider});
 engine.save=()=>{fs.mkdirSync(path.dirname(engine.cachePath),{recursive:true});fs.writeFileSync(engine.cachePath+'.browser-tmp',JSON.stringify(engine.data,null,2));fs.renameSync(engine.cachePath+'.browser-tmp',engine.cachePath);};
 await provider.start();return engine;
}
