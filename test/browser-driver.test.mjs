import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {drive,createRun,playRatedMatch,playRatedBatch,promptIsReady,playParallelRatedMatches,shareBrowserCache} from '../src/browser-driver.mjs';
import {normalize,AnswerEngine} from '../src/answer-engine.mjs';
function setup(t,{rated=true,out=false,won=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ranked-browser-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let state={answerInput:{placeholder:out?"you're out · watching…":'your puffer — type!',disabled:out,value:''},text:`Dinosaur\n${rated?'RATED':'UNRATED'} 4–6\nABCD\n${won?'GAME OVER\nFLOATING\n1/6\nYOU WIN\nlast one floating':'CATEGORY 1\nName a type of sandwich\n▸ your puffer · type an answer\n2\nSEND'}`};
 const actions=[];const tab={screenshot:async()=>Buffer.from('fixture'),playwright:{evaluate:async()=>state,getByRole:(role,opts)=>({fill:async text=>actions.push(['fill',text]),isEnabled:async()=>true,press:async key=>{actions.push(['press',key]);state={...state,answerInput:{...state.answerInput,placeholder:'waiting…'},text:state.text.replace('your puffer · type an answer','someone is up')};},click:async()=>{actions.push(['click',opts.name]);state={text:'WHO\'S PLAYING',answerInput:null};},count:async()=>opts.name==='Leave room'?1:0})}};
 const engine={prime:async()=>{},answer:()=>({text:"Shooter's sandwich",source:'answer-archive'})};const run=createRun(root);run.state.naturalInput=false;return {root,tab,engine,actions,run};
}
test('observed own-turn placeholder sends a ready choice with Enter, without mouse submission',async t=>{
 const f=setup(t);await drive(f.run,f.tab,f.engine,{seconds:.1,queue:false});assert.deepEqual(f.actions,[['fill',"Shooter's sandwich"],['press','Enter']]);
});
test('unrated tables are refused before typing an answer or inflating the streak',async t=>{
 const f=setup(t,{rated:false});await assert.rejects(drive(f.run,f.tab,f.engine,{seconds:.1,queue:false}),/unrated/);assert.deepEqual(f.actions,[]);assert.equal(f.run.state.current,0);
});
test('visible elimination records a loss and leaves immediately',async t=>{
 const f=setup(t,{out:true});await drive(f.run,f.tab,f.engine,{seconds:.1,queue:false});assert.equal(f.run.state.records[0].outcome,'loss');assert.equal(f.run.state.current,0);assert.deepEqual(f.actions,[['click','Leave room']]);
});
test('a finished room cannot be counted as two ranked wins',async t=>{
 const f=setup(t,{won:true});const original=f.tab.playwright.getByRole;f.tab.playwright.getByRole=(...args)=>({...original(...args),count:async()=>0});await drive(f.run,f.tab,f.engine,{seconds:.1,queue:false});assert.equal(f.run.state.current,1);
 await drive(f.run,f.tab,f.engine,{seconds:.1,queue:false});assert.equal(f.run.state.current,1);assert.equal(f.run.state.records.length,1);
});
test('a lost seat with a spectating input exits and resets the streak without inventing a result',async t=>{
 const f=setup(t);f.run.state.current=5;f.run.state.best=5;f.run.state.active={number:1,room:'ABCD',rated:true,name:'Dinosaur',startedAt:new Date().toISOString()};
 f.tab.playwright.evaluate=async()=>({text:'Other player\nRATED 4–6\nABCD\nCATEGORY 1\nName a cooking method',answerInput:{disabled:true,placeholder:'spectating this game…'}});
 await drive(f.run,f.tab,f.engine,{seconds:.1,queue:false});assert.equal(f.run.state.records[0].outcome,'inconclusive');assert.equal(f.run.state.current,0);assert.equal(f.run.state.best,5);assert.deepEqual(f.actions,[['click','Leave room']]);
});
test('a later-game lobby without the active player ends an interrupted attempt',async t=>{
 const f=setup(t);f.run.state.active={number:1,room:'ABCD',rated:true,name:'Dinosaur',startedAt:new Date().toISOString()};
 f.tab.playwright.evaluate=async()=>({text:'Other player\nRATED 4–6\nABCD\nGAME 2 · LOBBY\nJOIN NEXT GAME',answerInput:null});
 await drive(f.run,f.tab,f.engine,{seconds:.1,queue:false});assert.equal(f.run.state.records[0].outcome,'inconclusive');assert.deepEqual(f.actions,[['click','Leave room']]);
});
test('an unsent draft survives a temporarily disabled Send button and its own visible answer bubble',async t=>{
 const f=setup(t);let value='',sent=false,checks=0;const answer="Shooter's sandwich";
 f.tab.playwright.evaluate=async()=>({text:`${value?value+'\n':''}Dinosaur\nRATED 4–6\nABCD\nCATEGORY 1\nName a type of sandwich\n${sent?'▸ someone is up':'▸ your puffer · type an answer'}\nSEND`,answerInput:{placeholder:sent?'waiting…':'your puffer — type!',disabled:false,value}});
 f.tab.playwright.getByRole=(role,opts)=>({fill:async text=>{value=text;f.actions.push(['fill',text]);},isEnabled:async()=>++checks>1,press:async key=>{sent=true;f.actions.push(['press',key]);},count:async()=>0});
 f.engine.answer=(q,excluded)=>excluded.has(normalize(answer))?null:{text:answer,source:'answer-archive'};
 await drive(f.run,f.tab,f.engine,{seconds:.3,queue:false});assert.deepEqual(f.actions,[['fill',answer],['press','Enter']]);
 const events=fs.readFileSync(path.join(f.root,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert(events.some(e=>e.type==='turn-waiting'&&e.reason==='send-disabled'));
});
test('a turn with no prepared answer records the wait reason instead of failing silently',async t=>{
 const f=setup(t);f.engine.answer=()=>null;await drive(f.run,f.tab,f.engine,{seconds:.1,queue:false});assert.deepEqual(f.actions,[]);
 const events=fs.readFileSync(path.join(f.root,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert(events.some(e=>e.type==='turn-waiting'&&e.reason==='no-ready-answer'));assert.equal(events.at(-1).type,'controller-window-end');
});
test('fallback failure is logged without an unhandled rejection stopping the browser controller',async t=>{
 const f=setup(t);f.engine.prime=async()=>{throw new Error('fallback unavailable');};await drive(f.run,f.tab,f.engine,{seconds:.1,queue:false});
 const events=fs.readFileSync(path.join(f.root,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert(events.some(e=>e.type==='answer-prime-error'&&e.message==='fallback unavailable'));assert(f.actions.some(a=>a[0]==='press'));
});
test('whole-match control stays in one window through successive turns and returns on the result',async t=>{
 const f=setup(t);let turns=0;const progress=[];
 f.tab.playwright.evaluate=async()=>({text:`Dinosaur\nRATED 4–6\nABCD\n${turns>=2?'GAME OVER\nYOU WIN':'CATEGORY '+(turns+1)+'\nName a test category '+turns+'\n▸ your puffer · type an answer'}`,answerInput:{placeholder:turns>=2?'waiting…':'your puffer — type!',disabled:false,value:''}});
 const original=f.tab.playwright.getByRole;f.tab.playwright.getByRole=(...args)=>({...original(...args),press:async key=>{turns++;f.actions.push(['press',key]);}});
 const result=await playRatedMatch(f.run,f.tab,f.engine,{maxSeconds:2,queue:false,onProgress:p=>progress.push(p),progressIntervalMs:0});
 assert.equal(turns,2);assert.equal(result.record.outcome,'win');assert.equal(result.active,null);assert(progress.length>=2);
 const events=fs.readFileSync(path.join(f.root,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(events.filter(e=>e.type==='controller-window-start').length,1);assert.equal(events.filter(e=>e.type==='controller-window-end').length,1);
});
test('whole-match control leaves on a loss and returns without queuing another match',async t=>{
 const f=setup(t,{out:true});const result=await playRatedMatch(f.run,f.tab,f.engine,{maxSeconds:1});assert.equal(result.record.outcome,'loss');assert.equal(result.active,null);assert.deepEqual(f.actions,[['click','Leave room']]);
});
test('a failed screenshot does not prevent answering or recording the visible match result',async t=>{
 const f=setup(t);let sent=false;f.tab.screenshot=async()=>{throw new Error('screenshot unavailable');};
 f.tab.playwright.evaluate=async()=>({text:`Dinosaur\nRATED 4–6\nABCD\n${sent?'GAME OVER\nYOU WIN':'CATEGORY 1\nName a type of sandwich\n▸ your puffer · type an answer'}`,answerInput:{placeholder:sent?'waiting…':'your puffer — type!',disabled:false,value:''}});
 const original=f.tab.playwright.getByRole;f.tab.playwright.getByRole=(...args)=>({...original(...args),press:async()=>{sent=true;}});
 const result=await playRatedMatch(f.run,f.tab,f.engine,{maxSeconds:1,queue:false});assert(sent);assert.equal(result.record.outcome,'win');assert(result.metrics.recordingFailures>=1);
 const events=fs.readFileSync(path.join(f.root,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert(events.some(e=>e.type==='recording-error'));
});
test('the whole-match watchdog retains an inconclusive attempt and leaves rather than abandoning an active game',async t=>{
 const f=setup(t);const result=await playRatedMatch(f.run,f.tab,f.engine,{maxSeconds:.01,queue:false});assert.equal(result.record.outcome,'inconclusive');assert.match(result.record.reason,/watchdog/);assert.equal(result.active,null);assert(f.actions.some(a=>a[0]==='click'&&a[1]==='Leave room'));
});
test('resuming frame numbers preserves later recordings when an earlier frame is missing',async t=>{
 const f=setup(t);fs.mkdirSync(path.join(f.root,'frames'));fs.writeFileSync(path.join(f.root,'frames','0000001.png'),'one');fs.writeFileSync(path.join(f.root,'frames','0000003.png'),'three');assert.equal(createRun(f.root).frameSeq,3);
});
test('disabling recording skips screenshots including the forced result capture',async t=>{
 const f=setup(t,{won:true});f.run.state.recording.enabled=false;let screenshots=0;f.tab.screenshot=async()=>{screenshots++;throw new Error('Recording must stay disabled');};
 const result=await playRatedMatch(f.run,f.tab,f.engine,{maxSeconds:1,queue:false});assert.equal(result.record.outcome,'win');assert.equal(screenshots,0);assert.equal(f.run.frameSeq,0);
});
test('batch control advances through separate rated matches with analytics disabled',async t=>{
 const f=setup(t);let index=0,pauses=0;f.run.state.recording.enabled=false;f.run.state.trackStats=false;
 f.tab.playwright.evaluate=async()=>({text:`Dinosaur\nRATED 4–6\n${['ABCD','EFGH'][index]}\nGAME OVER\nYOU WIN`,answerInput:null});
 f.tab.playwright.getByRole=()=>({count:async()=>1,click:async()=>{index++;}});f.engine.pauseGeneration=()=>pauses++;
 const result=await playRatedBatch(f.run,f.tab,f.engine,{maxGames:2,maxSeconds:2,perMatchSeconds:1});
 assert.equal(result.played,2);assert.equal(result.current,2);assert.equal(pauses,2);
 const events=fs.readFileSync(path.join(f.root,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(events.filter(e=>e.type==='result-evidence').length,2);assert(!events.some(e=>['visible-state','after-leave','category'].includes(e.type)));
});
test('batch control respects a stop request before queuing another game',async t=>{
 const f=setup(t);fs.writeFileSync(path.join(f.root,'control.json'),JSON.stringify({continue:false}));
 const result=await playRatedBatch(f.run,f.tab,f.engine);assert.equal(result.played,0);assert.deepEqual(f.actions,[]);
});
test('a transient input deadline is retried after observing the current turn again',async t=>{
 const f=setup(t);let attempts=0,sent=false;f.run.state.recording.enabled=false;
 f.tab.playwright.evaluate=async()=>({text:`Dinosaur\nRATED 4–6\nABCD\n${sent?'GAME OVER\nYOU WIN':'CATEGORY 1\nName a type of sandwich\n▸ your puffer · type an answer'}`,answerInput:{placeholder:sent?'waiting…':'your puffer — type!',disabled:false,value:''}});
 const original=f.tab.playwright.getByRole;f.tab.playwright.getByRole=(...args)=>({...original(...args),press:async()=>{if(++attempts===1)throw new Error('Playwright selector deadline exceeded');sent=true;}});
 const result=await playRatedMatch(f.run,f.tab,f.engine,{maxSeconds:1,queue:false});assert.equal(result.record.outcome,'win');assert.equal(attempts,2);
});
test('an inactive spectator page leaves and returns to the rated queue without inventing a result',async t=>{
 const f=setup(t);let left=false,queued=false;f.run.state.recording.enabled=false;
 f.tab.playwright.evaluate=async()=>left?{text:queued?'Finding a rated table':"WHO'S PLAYING",answerInput:null}:{text:'Other player\nRATED 4–6\nABCD\nCATEGORY 13\nName a unit of mass',answerInput:{disabled:true,placeholder:'spectating this game…',value:''}};
 f.tab.playwright.getByRole=(role,{name})=>({count:async()=>1,click:async()=>{f.actions.push(['click',name]);if(name==='Leave room')left=true;else if(name==='▶ RATED ◀')queued=true;}});
 await drive(f.run,f.tab,f.engine,{seconds:.3});assert.equal(queued,true);assert.equal(f.run.state.records.length,0);assert.deepEqual(f.actions,[['click','Leave room'],['click','▶ RATED ◀']]);
});
test('a category outside the bot seat never requests fresh answers',async t=>{
 const f=setup(t);let primes=0;f.run.state.recording.enabled=false;
 f.tab.playwright.evaluate=async()=>({text:'Other player\nRATED 4–6\nABCD\nCATEGORY 1\nName a unit of mass',answerInput:null});f.engine.prime=async()=>{primes++;};
 await drive(f.run,f.tab,f.engine,{seconds:.1,queue:false});assert.equal(primes,0);assert.equal(f.run.state.records.length,0);
});
test('natural typing submits only after the entire answer is in the field',async t=>{
 const f=setup(t);let value='',sent=false,bursts=0;f.run.state.naturalInput=true;f.run.state.recording.enabled=false;f.engine.answer=()=>({text:'Quince',source:'bank'});
 f.tab.playwright.evaluate=async()=>({text:`Dinosaur\nRATED 4–6\nABCD\n${sent?'GAME OVER\nYOU WIN':'CATEGORY 1\nName a fruit\n▸ your puffer · type an answer\n10\nSEND'}`,answerInput:{placeholder:sent?'waiting…':'your puffer — type!',disabled:false,value}});
 const original=f.tab.playwright.getByRole;f.tab.playwright.getByRole=(...args)=>({...original(...args),fill:async text=>{assert.equal(text,'');value=text;},pressSequentially:async text=>{assert.equal(Array.from(text).length,1);bursts++;value+=text;},press:async()=>{assert.equal(value,'Quince');sent=true;}});
 const result=await playRatedMatch(f.run,f.tab,f.engine,{maxSeconds:4,queue:false});assert.equal(result.record.outcome,'win');assert(bursts>1);assert.equal(f.run.naturalTypingObserved,true);
});
test('even a hot visible fuse types the answer character by character instead of filling it',async t=>{
 const f=setup(t);let value='',sent=false;const letters=[];f.run.state.naturalInput=true;f.run.state.recording.enabled=false;f.engine.answer=()=>({text:'Quince',source:'bank'});
 f.tab.playwright.evaluate=async()=>({text:`Dinosaur\nRATED 4–6\nABCD\n${sent?'GAME OVER\nYOU WIN':'CATEGORY 1\nName a fruit\n▸ your puffer · type an answer\n1\nSEND'}`,fuseTransform:'transform: scaleX(0.80);',answerInput:{placeholder:sent?'waiting…':'your puffer — type!',disabled:false,value}});
 const original=f.tab.playwright.getByRole;f.tab.playwright.getByRole=(...args)=>({...original(...args),fill:async()=>{throw new Error('Whole-answer fill forbidden');},pressSequentially:async letter=>{letters.push(letter);value+=letter;},press:async()=>{assert.equal(value,'Quince');sent=true;}});
 const result=await playRatedMatch(f.run,f.tab,f.engine,{maxSeconds:2,queue:false});assert.equal(result.record.outcome,'win');assert.deepEqual(letters,Array.from('Quince'));
});
test('natural typing stops when the puffer moves to another player',async t=>{
 const f=setup(t);let value='',moved=false,bursts=0,enters=0;f.run.state.naturalInput=true;f.run.state.recording.enabled=false;f.engine.answer=()=>({text:'Quince',source:'bank'});
 f.tab.playwright.evaluate=async()=>({text:`Dinosaur\nRATED 4–6\nABCD\nCATEGORY 1\nName a fruit\n▸ ${moved?'Other player is up':'your puffer · type an answer'}\n10\nSEND`,answerInput:{placeholder:moved?'waiting…':'your puffer — type!',disabled:false,value}});
 const original=f.tab.playwright.getByRole;f.tab.playwright.getByRole=(...args)=>({...original(...args),pressSequentially:async text=>{bursts++;value+=text;moved=true;},press:async()=>{enters++;}});
 await drive(f.run,f.tab,f.engine,{seconds:1.3,queue:false});assert.equal(bursts,1);assert.equal(enters,0);assert.equal(f.run.pending,null);
});
test('the starting player does not touch the input until the prompt entrance finishes',async t=>{
 const f=setup(t);let checks=0,ready=false,sent=false,primes=0;f.run.state.recording.enabled=false;
 f.tab.playwright.evaluate=async()=>{ready=++checks>3;return {text:`Dinosaur\nRATED 4–6\nABCD\n${sent?'GAME OVER\nYOU WIN':'CATEGORY 1\nName a fruit\n▸ your puffer · type an answer\n1\nSEND'}`,promptReady:ready,answerInput:{placeholder:'your puffer — type!',disabled:false,value:''}};};
 f.engine.prime=async()=>{primes++;};const original=f.tab.playwright.getByRole;
 f.tab.playwright.getByRole=(...args)=>({...original(...args),fill:async()=>{assert(ready);assert(checks>3);},press:async()=>{assert(ready);sent=true;}});
 const result=await playRatedMatch(f.run,f.tab,f.engine,{maxSeconds:2,queue:false});assert.equal(result.record.outcome,'win');assert(primes>=4);
});
test('a low clock cannot bypass an unrevealed prompt',async t=>{
 const f=setup(t);f.run.state.naturalInput=true;f.run.state.recording.enabled=false;
 f.tab.playwright.evaluate=async()=>({text:'Dinosaur\nRATED 4–6\nABCD\nCATEGORY 1\nName a fruit\n▸ your puffer · type an answer\n0\nSEND',promptReady:false,answerInput:{placeholder:'your puffer — type!',disabled:false,value:''}});
 await drive(f.run,f.tab,f.engine,{seconds:.15,queue:false});assert.deepEqual(f.actions,[]);assert.equal(f.run.pending,null);
});
test('unsupported animation reads wait through the complete entrance instead of guessing from the clock',()=>{
 assert.equal(promptIsReady({promptReady:null},0,1700),false);assert.equal(promptIsReady({promptReady:null},0,1800),true);
 assert.equal(promptIsReady({promptReady:false},0,5000),false);assert.equal(promptIsReady({promptReady:true},0,10),true);
});
test('parallel tables type their own categories concurrently without mixing drafts',async t=>{
 const fixtures=[setup(t),setup(t)],submitted=[false,false],letters=[[],[]];
 const lanes=fixtures.map((f,i)=>{
  f.run.state.naturalInput=true;f.run.state.recording.enabled=false;f.run.state.trackStats=false;
  const answer=['Quince','Beet'][i],question=['Name a fruit','Name a vegetable'][i];let value='';
  f.tab.id=String(i);
  f.tab.playwright.evaluate=async()=>({text:`Dinosaur\nRATED 4–6\n${['ABCD','EFGH'][i]}\n${submitted.every(Boolean)?'GAME OVER\nYOU WIN':`CATEGORY 1\n${question}\n▸ your puffer · type an answer\n1\nSEND`}`,promptReady:true,answerInput:{placeholder:submitted[i]?'waiting…':'your puffer — type!',disabled:false,value}});
  f.tab.playwright.getByRole=(role,{name})=>({count:async()=>name==='Leave room'?1:0,click:async()=>{},isEnabled:async()=>true,fill:async()=>assert.fail('Natural parallel input must not paste'),pressSequentially:async letter=>{letters[i].push(letter);value+=letter;},press:async()=>{assert.equal(value,answer);submitted[i]=true;}});
  f.engine.answer=q=>{assert.equal(q,question);return {text:answer,source:'bank'};};
  return {run:f.run,tab:f.tab,engine:f.engine};
 });
 const result=await playParallelRatedMatches(lanes,{maxSeconds:3,progressIntervalMs:0});
 assert.equal(result.overlapObserved,true);assert(result.results.every(r=>r.record?.outcome==='win'));
 assert.deepEqual(letters,[Array.from('Quince'),Array.from('Beet')]);
});
test('a second controller in the same room stops before typing or counting a duplicate win',async t=>{
 const a=setup(t),b=setup(t);for(const f of [a,b])f.run.state.recording.enabled=false;
 let checks=0;a.tab.playwright.evaluate=async()=>({text:`Dinosaur\nRATED 4–6\nABCD\n${++checks>4?'GAME OVER\nYOU WIN':'CATEGORY 1\nName a fruit'}`,answerInput:null});
 const result=await playParallelRatedMatches([a,b],{maxSeconds:2,progressIntervalMs:0});
 assert.equal(result.overlapObserved,false);assert.equal(result.results[0].record.outcome,'win');assert.match(result.results[1].error,/same room/);
 assert.deepEqual(b.actions,[]);assert.equal(b.run.state.records.length,0);
});
test('shared browser learning survives alternating saves while generation state stays independent',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'parallel-cache-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const options={bankPath:path.join(root,'answers.json'),cachePath:path.join(root,'learned.json')};
 const a=new AnswerEngine(options),b=new AnswerEngine(options);shareBrowserCache(b,a);
 a.learn('Name a fruit','Quince',{accepted:true});a.save();b.learn('Name a vegetable','Beet',{accepted:true});b.save();a.save();
 const reloaded=new AnswerEngine(options);assert.equal(reloaded.entry('Name a fruit').answers.quince.accepted,1);assert.equal(reloaded.entry('Name a vegetable').answers.beet.accepted,1);
 const jobA={controller:new AbortController()},jobB={controller:new AbortController()};a.inflight.set('fruit',jobA);b.inflight.set('vegetable',jobB);
 a.pauseGeneration();assert.equal(jobA.controller.signal.aborted,true);assert.equal(jobB.controller.signal.aborted,false);assert.equal(b.closed,false);
});
test('a stop control interrupts a live controller before another key is typed',async t=>{
 const f=setup(t);let stop=false;f.run.state.recording.enabled=false;
 const result=await playRatedMatch(f.run,f.tab,f.engine,{maxSeconds:2,shouldStop:()=>stop,onObservation:()=>{stop=true;}});
 assert.equal(result.record.outcome,'inconclusive');assert.match(result.record.reason,/stopped/);assert(!f.actions.some(a=>a[0]==='fill'||a[0]==='press'));
});
test('queue admission can hold a lobby without clicking Rated',async t=>{
 const f=setup(t);f.run.state.recording.enabled=false;f.tab.playwright.evaluate=async()=>({text:"WHO'S PLAYING",answerInput:null});
 await drive(f.run,f.tab,f.engine,{seconds:.1,canQueue:()=>false});assert.deepEqual(f.actions,[]);
});
test('taunting only edits the draft and Enter sends the real answer after clearing it',async t=>{
 const f=setup(t);let value='',sent=false,clears=0;f.run.state.recording.enabled=false;f.run.state.taunting=true;
 f.engine.answer=()=>({text:'Fig',source:'bank'});
 f.tab.playwright.evaluate=async()=>({text:`Bobert\nDinosaur\nRATED 4–6\nABCD\n${sent?'GAME OVER\nYOU WIN':'CATEGORY 1\nName a fruit\n▸ your puffer · type an answer\n2\nSEND'}`,promptReady:true,fuseTransform:'transform: scaleX(0.00);',answerInput:{placeholder:sent?'waiting…':'your puffer — type!',disabled:false,value}});
 f.tab.playwright.getByRole=(role,{name})=>({count:async()=>name==='Leave room'?1:0,click:async()=>{},isEnabled:async()=>true,fill:async text=>{assert.equal(text,'');value='';clears++;},pressSequentially:async letter=>{assert.equal(Array.from(letter).length,1);value+=letter;},press:async()=>{assert.equal(value,'Fig');sent=true;}});
 const result=await playRatedMatch(f.run,f.tab,f.engine,{maxSeconds:8,queue:false});assert.equal(result.record.outcome,'win');assert.equal(clears,1);assert.equal(f.run.tauntDisplayed,true);
});
test('each rated match gets a new verified lobby name and result ownership follows it',async t=>{
 const f=setup(t);f.run.state.rotateDisplayName=true;f.run.state.recording.enabled=false;
 let lobby=true,value='Dinosaur',games=0;const renamed=[],queued=[];
 f.tab.playwright.evaluate=async(fn,arg)=>typeof arg==='string'?value===arg:{text:lobby?"WHO'S PLAYING":`${value}\nRATED 4–6\n${['ABCD','EFGH'][games]}\nGAME OVER\nYOU WIN`,answerInput:null};
 f.tab.playwright.getByRole=(role,{name})=>({
  count:async()=>Number(lobby?name==='YOUR NAME'||name==='▶ RATED ◀':name==='Leave room'),
  fill:async text=>{assert.equal(role,'textbox');assert.equal(name,'YOUR NAME');value=text;renamed.push(text);},
  click:async()=>{if(name==='▶ RATED ◀'){assert.equal(value,f.run.state.name);queued.push(value);lobby=false;}else{assert.equal(name,'Leave room');lobby=true;games++;}},
 });
 for(let i=0;i<2;i++){
  const result=await playRatedMatch(f.run,f.tab,f.engine,{maxSeconds:1});
  assert.equal(result.record.outcome,'win');assert.equal(result.record.name,queued[i]);
 }
 assert.deepEqual(renamed,['Panda','Cloud']);assert.deepEqual(queued,renamed);
});
test('an unverified display name cannot enter the rated queue',async t=>{
 const f=setup(t);f.run.state.rotateDisplayName=true;f.run.state.recording.enabled=false;let clicked=false;
 f.tab.playwright.evaluate=async(fn,arg)=>typeof arg==='string'?false:{text:"WHO'S PLAYING",answerInput:null};
 f.tab.playwright.getByRole=()=>({count:async()=>1,fill:async()=>{},click:async()=>{clicked=true;}});
 await assert.rejects(drive(f.run,f.tab,f.engine,{seconds:.1}),/display name did not update/);
 assert.equal(clicked,false);assert.equal(f.run.state.name,'Dinosaur');
});
