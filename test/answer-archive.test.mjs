import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {mergeArchive} from '../src/answer-archive.mjs';
import {AnswerEngine,questionKey} from '../src/answer-engine.mjs';
const q='Name an object in the archive test';
const page=(date,answers)=>({url:'https://www.linkedinpinpointanswer.today/krillion-answers/'+date,date,retrievedAt:date+'T12:00:00Z',prompts:[{text:q,totalAnswers:answers.length,answers}]});
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'puffer-archive-'));let requests=0,starts=0;
 const index=mergeArchive(null,page('2026-10-23',[{answer:'Gem',score:100},{answer:'Deep',score:85},{answer:'Common',score:10}]));
 fs.writeFileSync(path.join(dir,'answer-archive.json'),JSON.stringify(index));
 const provider={async start(){starts++;},async generate(){requests++;return [];},close(){}};
 const engine=new AnswerEngine({bankPath:new URL('../data/answers.json',import.meta.url),cachePath:path.join(dir,'learned.json'),provider});
 t.after(()=>{engine.close();fs.rmSync(dir,{recursive:true,force:true});});return {engine,index,usage:()=>({requests,starts})};
}
test('archive ranks are deduplicated, bounded and newest prompt occurrence wins',()=>{
 let index=mergeArchive(null,page('2026-10-23',[{answer:'Common',score:10},{answer:'Gem',score:100},{answer:'gem',score:85},{answer:'Deep',score:85}] ),{limit:2});
 index=mergeArchive(index,page('2026-10-22',[{answer:'Old',score:100}]));
 assert.deepEqual(index.questions[questionKey(q)].answers,[{text:'Gem',tier:'krillion'},{text:'Deep',tier:'deepcut'}]);
 assert.equal(index.questions[questionKey(q)].complete,false);
 assert.equal(Object.keys(index.sources).length,2);
 assert.throws(()=>mergeArchive(null,{...page('2026-10-23',[]),url:'https://other.example/krillion-answers/2026-10-23'}),/public daily/);
});
test('archive supplies rarest unused choices without marking them Puffer-verified or requesting Codex',async t=>{
 const {engine,usage}=setup(t);await engine.warmup();await engine.prime(q);
 assert.deepEqual(usage(),{requests:0,starts:1});
 const gem=engine.answer(q,new Set());assert.equal(gem.text,'Gem');assert.equal(gem.source,'answer-archive');assert.equal(gem.archiveTier,'krillion');
 assert.equal(engine.answer(q,new Set(['gem'])).text,'Deep');assert.deepEqual(engine.entry(q).answers,{});
 assert.equal(engine.answer('Name a different object in the archive test',new Set()),null);
 for(const a of engine.records(q))engine.learn(q,a.text,{accepted:true,tier:a.archiveTier});
 await engine.prime(q);assert.equal(usage().requests,0);
});
test('Puffer rejection and awarded tiers override archive claims, and exhausted/uncovered prompts use fallback',async t=>{
 const {engine,usage}=setup(t);engine.learn(q,'Gem',{accepted:true,tier:'plankton'});engine.learn(q,'Deep',{miss:true});
 assert.equal(engine.answer(q,new Set()).text,'Gem');
 assert.equal(engine.records(q).find(a=>a.text==='Gem').tier,'plankton');
 await engine.prime(q,{exclude:new Set(['common','gem','deep'])});assert.equal(usage().requests,1);
 await engine.prime('Name something unique in an uncovered archive test');assert.equal(usage().requests,2);
});
test('archive scores map Too Clever separately and enforce explicit answer constraints',()=>{
 const data=page('2026-10-23',[{answer:'holism',score:85},{answer:'wrong',score:100},{answer:'prism',score:15}]);data.prompts[0].text='Name an English word ending in ism';
 const index=mergeArchive(null,data),row=Object.values(index.questions)[0];assert.deepEqual(row.answers,[{text:'holism',tier:'deepcut'},{text:'prism',tier:'tooclever'}]);
});
