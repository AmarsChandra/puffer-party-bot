import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {mergeReveal,refreshRegularBank} from './regular-bank.mjs';
import {AnswerEngine,questionKey} from './answer-engine.mjs';
const source='https://krillion.io/api/unlimited/1/reveal';
const q='Name an object in the regular-bank test';
function fixture(t,answers,provider=null){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'puffer-regular-'));
 const index=mergeReveal(null,{rounds:[{text:q,answers}]},{url:source});
 fs.writeFileSync(path.join(dir,'regular-bank.json'),JSON.stringify(index));
 const engine=new AnswerEngine({bankPath:new URL('./answers.json',import.meta.url),cachePath:path.join(dir,'learned.json'),provider});
 t.after(()=>{engine.close();fs.rmSync(dir,{recursive:true,force:true});});return {engine,index};
}
test('regular reveals retain rare canonical choices and do not transfer answers between prompts',t=>{
 const {engine,index}=fixture(t,[{answer:'Common',tier:'plankton'},{answer:'Deep',tier:'deepcut'},{answer:'Gem',tier:'krillion'},{answer:'gem',tier:'rare'}]);
 assert.equal(index.questions[questionKey(q)].answers.length,3);
 assert.equal(engine.answer(q,new Set()).text,'Gem');
 assert.equal(engine.answer(q,new Set(['gem'])).text,'Deep');
 assert.equal(engine.answer('Name a different object in the regular-bank test',new Set()),null);
 assert.equal(engine.answer(q,new Set()).source,'regular-bank');
 assert.equal(engine.answer(q,new Set()).regularSource,source);
 assert.deepEqual(engine.entry(q).answers,{});
});
test('Puffer rejection or a different awarded tier overrides the regular-game expectation',t=>{
 const {engine}=fixture(t,[{answer:'Gem',tier:'krillion'},{answer:'Deep',tier:'deepcut'}]);
 engine.learn(q,'Gem',{accepted:true,tier:'plankton'});
 assert.equal(engine.answer(q,new Set()).text,'Deep');
 const gem=engine.records(q).find(a=>a.text==='Gem');
 assert.equal(gem.source,'verified');assert.equal(gem.tier,'plankton');
 engine.learn(q,'Deep',{miss:true});assert.equal(engine.answer(q,new Set()).text,'Gem');
});
test('a complete finite regular-game pool avoids model usage without marking it Puffer-verified',async t=>{
 let requests=0;
 const {engine}=fixture(t,Array.from({length:6},(_,i)=>({answer:'Choice '+i,tier:'deepcut'})),{async generate(){requests++;return [];},close(){}});
 await engine.prime(q);assert.equal(requests,0);
 assert.equal(engine.records(q).filter(a=>a.source==='verified').length,0);
 assert.equal(engine.records(q).length,6);
});
test('imported word choices still obey explicit constraints and keep a bounded rare-first pool',()=>{
 const word='Name an English word ending in “-ism”';
 const index=mergeReveal(null,{prompts:[{text:word,answers:[{answer:'prism',tier:'plankton'},{answer:'Wrong',tier:'krillion'},{answer:'atavism',tier:'deepcut'},{answer:'holism',tier:'rare'}]}]},{url:source,limit:2});
 assert.deepEqual(index.questions[questionKey(word)].answers.map(a=>a.text),['atavism','holism']);
});
test('refresh requests only public daily and first previews, and respects access denials',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'puffer-refresh-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const calls=[],fetchImpl=async url=>{calls.push(url);const data=url.endsWith('/today')?{date:'2026-10-22'}:url.includes('?date=')?{prompts:[{text:q,answers:[{answer:'Gem',tier:'krillion'}]}]}:null;return {ok:data!==null,status:data?200:402,json:async()=>data};};
 const index=await refreshRegularBank({output:path.join(dir,'regular-bank.json'),fetchImpl});
 assert.equal(index.questions[questionKey(q)].answers[0].text,'Gem');
 assert.equal(calls.length,7);assert.ok(!calls.some(u=>/\/archive|\/2(?:\/|$)/.test(u)));
 assert.equal(calls.filter(u=>u.endsWith('/reveal')).length,0);
});
