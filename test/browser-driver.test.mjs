import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {drive,createRun,playRatedMatch} from '../src/browser-driver.mjs';
import {normalize} from '../src/answer-engine.mjs';
function setup(t,{rated=true,out=false,won=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ranked-browser-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let state={answerInput:{placeholder:out?"you're out · watching…":'your puffer — type!',disabled:out,value:''},text:`Dinosaur\n${rated?'RATED':'UNRATED'} 4–6\nABCD\n${won?'GAME OVER\nFLOATING\n1/6\nYOU WIN\nlast one floating':'CATEGORY 1\nName a type of sandwich\n▸ your puffer · type an answer\n2\nSEND'}`};
 const actions=[];const tab={screenshot:async()=>Buffer.from('fixture'),playwright:{evaluate:async()=>state,getByRole:(role,opts)=>({fill:async text=>actions.push(['fill',text]),isEnabled:async()=>true,press:async key=>{actions.push(['press',key]);state={...state,answerInput:{...state.answerInput,placeholder:'waiting…'},text:state.text.replace('your puffer · type an answer','someone is up')};},click:async()=>{actions.push(['click',opts.name]);state={text:'WHO\'S PLAYING',answerInput:null};},count:async()=>opts.name==='Leave room'?1:0})}};
 const engine={prime:async()=>{},answer:()=>({text:"Shooter's sandwich",source:'answer-archive'})};return {root,tab,engine,actions,run:createRun(root)};
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
