import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AnswerEngine,candidates,questionKey,normalize,answerFits,promptExample} from '../src/answer-engine.mjs';
import {partialAnswers} from '../src/codex-provider.mjs';
const bank=JSON.parse(fs.readFileSync(new URL('../data/answers.json',import.meta.url)));
test('pausing unused generation cancels it while leaving the engine reusable',async t=>{
 let requests=0;
 const provider={generate(q,{signal}){requests++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));},close(){}};
 const {engine}=fixture(t,provider);const first=engine.prime('Name an unknown fixture answer');engine.pauseGeneration();await first;
 assert.equal(engine.inflight.size,0);assert.equal(engine.closed,false);
 const second=engine.prime('Name another unknown fixture answer');assert.equal(requests,2);engine.pauseGeneration();await second;
});
function fixture(t,provider=null,onReady=()=>{}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'puffer-engine-'));
  const opts={bankPath:new URL('../data/answers.json',import.meta.url),cachePath:path.join(dir,'learned.json'),provider,onReady};
  const engine=new AnswerEngine(opts);
  t.after(()=>{engine.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {engine,opts};
}

test('controlled wording aliases match without dropping meaningful constraints',()=>{
  assert.equal(questionKey('Name an European country!'),questionKey('Name a country in Europe'));
  assert.deepEqual(candidates('Name an English city',bank),candidates('Name a city in England',bank));
  assert.equal(candidates('Name a landlocked country in Europe',bank).length,0);
});

test('letter and length constraints filter the base bank',()=>{
  const a=candidates('Name a fruit starting with the letter P',bank);
  assert.ok(a.length>2);assert.ok(a.every(x=>normalize(x).startsWith('p')));
  const b=candidates('Name a fruit ending with E',bank);
  assert.ok(b.length>2);assert.ok(b.every(x=>normalize(x).endsWith('e')));
  assert.deepEqual(candidates('Name a fruit with 4 letters',{questions:{'Name a fruit':['Apple','Pear','Kiwi']}}),['Pear','Kiwi']);
});

test('stream parser only returns complete JSON strings, including escapes',()=>{
  assert.deepEqual(partialAnswers('{"answers":["St. Louis","New'),['St. Louis']);
  assert.deepEqual(partialAnswers('{"answers":["A \\"B\\"","C]D"]}'),['A "B"','C]D']);
  assert.deepEqual(partialAnswers('Not JSON or an answer list'),[]);
});

test('verified rarity takes priority and used answers stay excluded',t=>{
  const {engine}=fixture(t);
  engine.learn('Name a fruit','Apple',{accepted:true,tier:'plankton'});
  engine.learn('Name a fruit','Quince',{accepted:true,tier:'deepcut'});
  assert.equal(engine.answer('Name a fruit',new Set()).text,'Quince');
  assert.equal(engine.answer('Name a fruit',new Set(['quince'])).text,'Apple');
});

test('misses retire guesses for their own category and persist across restarts',t=>{
  const {engine,opts}=fixture(t);
  engine.learn('Name a fruit','Mangosteen',{miss:true});engine.save();
  const reloaded=new AnswerEngine(opts);
  assert.notEqual(reloaded.answer('Name a fruit',new Set()).text,'Mangosteen');
  assert.ok(reloaded.records('Name a fruit').every(a=>a.text!=='Mangosteen'));
  reloaded.learn('Name a fruit','Mangosteen',{accepted:true,tier:'rare'});
  assert.equal(reloaded.answer('Name a fruit',new Set()).text,'Mangosteen');
  reloaded.close();
});

test('learning never leaks between different questions',t=>{
  const {engine}=fixture(t);
  engine.learn('Name a country','Japan',{accepted:true,tier:'rare'});
  assert.equal(engine.answer('Name a martial art',new Set()),null);
});

test('unknown categories stream usable answers before generation finishes',async t=>{
  let complete,onAnswer,requests=0,ready=0;
  const provider={generate(q,opts){requests++;onAnswer=opts.onAnswer;return new Promise(r=>{complete=r;});},close(){}};
  const {engine}=fixture(t,provider,()=>ready++);
  const pending=engine.prime('Name a martial art');
  const same=engine.prime('Name a martial art');assert.equal(pending,same);assert.equal(requests,1);
  onAnswer('Silat');assert.equal(ready,1);assert.equal(engine.answer('Name a martial art',new Set()).text,'Silat');
  complete(['Silat','Savate']);await pending;
  assert.equal(engine.records('Name a martial art').length,2);
});

test('known categories do not spend model usage',async t=>{
  let count=0;
  const {engine}=fixture(t,{generate(){count++;return Promise.resolve([]);},close(){}});
  await engine.prime('Name a fruit');assert.equal(count,0);
});

test('common-only local answers trigger rare backfill while staying immediately usable',async t=>{
  let requests=0;
  const {engine}=fixture(t,{async generate(){requests++;return ['Interjection','Conjecture','Ejecta'];},close(){}});
  const q='Name an English word containing “ject”';
  engine.learn(q,'Objective',{accepted:true,tier:'plankton'});
  assert.equal(engine.answer(q,new Set()).text,'Objective');
  await engine.prime(q,{exclude:new Set(['objective'])});assert.equal(requests,1);
  assert.equal(engine.answer(q,new Set()).text,'Interjection');
  assert.equal(engine.answer(q,new Set()).source,'codex');
  await engine.prime(q);assert.equal(requests,1);
  engine.learn(q,'Conjecture',{accepted:true,tier:'deepcut'});
  assert.equal(engine.answer(q,new Set()).text,'Conjecture');
});

test('obsolete generation is cancelled and cannot answer the new category',async t=>{
  const calls=[];
  const provider={generate(q,opts){calls.push({q,...opts});return new Promise((resolve,reject)=>{opts.signal.addEventListener('abort',()=>reject(new Error('aborted')));calls.at(-1).resolve=resolve;});},close(){}};
  const {engine}=fixture(t,provider);
  const old=engine.prime('Name a martial art');
  const next=engine.prime('Name a Caribbean island');
  assert.equal(calls[0].signal.aborted,true);
  calls[1].onAnswer('Aruba');calls[1].resolve(['Aruba']);await Promise.all([old,next]);
  assert.equal(engine.answer('Name a Caribbean island',new Set()).text,'Aruba');
  assert.equal(engine.answer('Name a martial art',new Set()),null);
});

test('failed providers back off instead of retrying on every game packet',async t=>{
  let count=0;
  const {engine}=fixture(t,{async generate(){count++;throw new Error('temporarily unavailable');},close(){}});
  await engine.prime('Name a martial art');await engine.prime('Name a martial art');
  assert.equal(count,1);
});

test('invalid model strings and duplicate spellings are filtered',async t=>{
  const {engine}=fixture(t,{async generate(q,{onAnswer}){for(const a of ['',null,'A'.repeat(61),'Silat','silat'])onAnswer(a);return ['Savate'];},close(){}});
  await engine.prime('Name a martial art');
  assert.deepEqual(engine.records('Name a martial art').map(a=>a.text),['Silat','Savate']);
});

test('spelled-out lengths answer constrained subject questions without AI',()=>{
  const answers=candidates('Name a body part spelled with three letters',bank);
  assert.ok(answers.includes('Eye'));assert.ok(answers.includes('Hip'));
  assert.ok(answers.every(a=>normalize(a).length===3));
});

test('local dictionary solves word patterns and preserves every explicit constraint',()=>{
  const a=candidates('Name an English word containing “age”',bank);
  assert.ok(a.length>50);assert.ok(a.every(w=>w.includes('age')));
  const b=candidates('Name a five-letter word starting with S',bank);
  assert.ok(b.length>20);assert.ok(b.every(w=>w.length===5&&w.startsWith('s')));
  assert.equal(candidates('Name an English word containing age and related to astronomy',bank).length,0);
});


test('fresh model answers must obey explicit spelling constraints',async t=>{
  assert.equal(answerFits('Name a body part spelled with three letters','Elbow'),false);
  assert.equal(answerFits('Name a five-letter word starting with S','spoon'),true);
  assert.equal(answerFits('Name an English word containing “age”','train'),false);
  const {engine}=fixture(t,{async generate(){return ['Elbow','Rib'];},close(){}});
  await engine.prime('Name a body part spelled with three letters',{force:true});
  assert.ok(engine.records('Name a body part spelled with three letters').some(a=>a.text==='Rib'));
  assert.ok(!engine.records('Name a body part spelled with three letters').some(a=>a.text==='Elbow'));
});


test('letter-count word prompts use the dictionary without model delay',()=>{
  const q='Name an English word with three or more S’s';
  const a=candidates(q,bank);assert.ok(a.length>20);
  assert.ok(a.every(w=>[...w].filter(x=>x==='s').length>=3));
  assert.equal(answerFits(q,'sunshine'),false);
  assert.equal(answerFits(q,'possession'),true);
});


test('server-confirmed aliases share an exclusion key across bots and future games',t=>{
  const {engine}=fixture(t);
  engine.learn('Name a sport','Chukkers',{accepted:true,tier:'rare',canonical:'Chukka'});
  assert.equal(engine.answer('Name a sport',new Set()).text,'Chukka');
  assert.ok(!engine.records('Name a sport',new Set(['chukka'])).some(a=>a.text==='Chukka'));
  engine.save();
});

test('quoted affix notation stays local and enforces the affix',async t=>{
  for(const q of ['Name an English word ending in “-ware”',"Name an English word ending with '-ware'",'Name an English word ending in -ware']){
    const answers=candidates(q,bank);assert.ok(answers.length>3);assert.ok(answers.every(w=>w.endsWith('ware')));
    assert.equal(answerFits(q,'hardware'),true);assert.equal(answerFits(q,'warmer'),false);
  }
  const answers=candidates('Name an English word ending in “-ism”',bank);
  assert.ok(answers.length>20);assert.ok(answers.every(w=>w.endsWith('ism')));
  const prefix=candidates('Name an English word starting with “pre-”',bank);
  assert.ok(prefix.length>20);assert.ok(prefix.every(w=>w.startsWith('pre')));
  assert.equal(answerFits('Name an English word starting with “pre-”','repair'),false);
  assert.deepEqual(candidates('Name an English word ending in “-ism” and related to physics',bank),[]);
  let modelCalls=0;const {engine}=fixture(t,{async generate(){modelCalls++;return [];},close(){}});
  await engine.prime('Name an English word ending in “-ware”');
  await engine.prime('Name an English word ending in “-ism”');
  assert.equal(modelCalls,0);
});

test('reviewed aliases exclude duplicates without upgrading guesses to verified answers',t=>{
  const {engine}=fixture(t);
  engine.learn('Name an airline','Southwest Airlines',{proposed:true});
  assert.equal(engine.records('Name an airline')[0].source,'codex');
  assert.deepEqual(engine.records('Name an airline',new Set(['southwest'])),[]);
  engine.learn('Name an airline','Southwest',{accepted:true,tier:'plankton'});
  assert.equal(engine.records('Name an airline').length,1);
  assert.equal(engine.answer('Name an airline',new Set()).text,'Southwest');
  assert.deepEqual(engine.records('Name an airline',new Set(['southwestairlines'])),[]);
  engine.learn('Name an area in a school','Gymnasium',{proposed:true});
  assert.deepEqual(engine.records('Name an area in a school',new Set(['gym'])),[]);
  engine.learn('Name a building','Gymnasium',{proposed:true});
  assert.equal(engine.answer('Name a building',new Set(['gym'])).text,'Gymnasium');
});

test('single explicit examples are available while fresh alternatives generate',async t=>{
  const q="Name a body part animals have but humans don't (like wings)";
  assert.equal(promptExample(q),'wings');
  assert.equal(promptExample('Name an emotion (for example, joy)'),'joy');
  assert.equal(promptExample('Name a pronoun (like “they”)'),'they');
  assert.equal(promptExample('Name a word (like this or that)'),null);
  assert.equal(promptExample('Name a word (not foo)'),null);
  assert.equal(promptExample('Name a body part spelled with three letters (like elbow)'),null);
  const {engine}=fixture(t,{async generate(){return ['Fins','Beak'];},close(){}});
  assert.equal(engine.answer(q,new Set()).text,'wings');
  assert.equal(engine.answer(q,new Set()).source,'example');
  assert.equal(engine.answer(q,new Set(['wings'])),null);
  await engine.prime(q);assert.equal(engine.records(q).length,3);
  assert.ok(engine.records(q).every(a=>a.source!=='verified'));
  const constrained=candidates('Name a five-letter word starting with S (like spoon)',bank);
  assert.ok(constrained.length>10);assert.ok(constrained.every(x=>x.length===5&&x.startsWith('s')));
});

test('minimum and maximum letter lengths use the bank without dropping subject constraints',async t=>{
  for(const q of ['Name a country with 8 or more letters','Name a country with at least eight letters']){
    const answers=candidates(q,bank);assert.ok(answers.length>50);
    assert.ok(answers.every(a=>normalize(a).length>=8));
    assert.equal(answerFits(q,'Chad'),false);assert.equal(answerFits(q,'Argentina'),true);
  }
  const short=candidates('Name a country with at most four letters',bank);
  assert.ok(short.includes('Chad'));assert.ok(short.every(a=>normalize(a).length<=4));
  assert.equal(answerFits('Name a country with 4 or fewer letters','Argentina'),false);
  assert.deepEqual(candidates('Name a country in Europe with 8 or more letters and a coast',bank),[]);
  const words=candidates('Name an English word with 8 or more letters',bank);
  assert.ok(words.length>50);assert.ok(words.every(w=>w.length>=8));
  let calls=0;const {engine}=fixture(t,{async generate(){calls++;return [];},close(){}});
  await engine.prime('Name a country with 8 or more letters');assert.equal(calls,0);
});

test('a provider usage limit backs off across categories while local answers remain usable',async t=>{
  let requests=0;
  const {engine}=fixture(t,{async generate(){requests++;throw new Error('You have hit your usage limit');},close(){}});
  await engine.prime('Name a martial art');await engine.prime('Name a Caribbean island');
  assert.equal(requests,1);assert.ok(engine.providerRetryAt>Date.now());
  assert.ok(engine.answer('Name a fruit',new Set()));
  engine.providerRetryAt=0;await engine.prime('Name a Caribbean island');assert.equal(requests,2);
});

test('server rarity outweighs repeated acceptance of a lower-value answer',t=>{
  const {engine}=fixture(t),q='Name an item in a custom rarity test';
  for(let i=0;i<20;i++)engine.learn(q,'No points',{accepted:true,tier:'tooclever'});
  for(const [text,tier] of [['Common','plankton'],['Uncommon','schooler'],['Rare','rare'],['Deep','deepcut'],['Rarest','krillion']])engine.learn(q,text,{accepted:true,tier});
  assert.deepEqual(engine.records(q).map(a=>a.text),['Rarest','Deep','Rare','Uncommon','Common','No points']);
});

test('rare-requested proposals can beat common answers but never verified rare answers',t=>{
  const {engine}=fixture(t),q='Name an item in a custom rarity test';
  engine.learn(q,'Common',{accepted:true,tier:'plankton'});
  engine.learn(q,'Rare suggestion',{proposed:true,rarityRequested:true});
  assert.equal(engine.answer(q,new Set()).text,'Rare suggestion');
  assert.equal(engine.answer(q,new Set()).source,'codex');
  engine.learn(q,'Verified deep cut',{accepted:true,tier:'deepcut'});
  assert.equal(engine.answer(q,new Set()).text,'Verified deep cut');
  engine.learn(q,'Rare suggestion',{miss:true});
  assert.equal(engine.answer(q,new Set(['verifieddeepcut'])).text,'Common');
});

test('a fresh category streams three choices and defers refill until the useful pool runs down',async t=>{
  const jobs=[],provider={generate(q,opts){return new Promise(resolve=>jobs.push({...opts,resolve}));},close(){}};
  const {engine}=fixture(t,provider),q='Name an African antelope';
  const first=engine.prime(q);assert.equal(jobs[0].count,3);
  jobs[0].onAnswer('Kudu');assert.equal(engine.answer(q,new Set()).text,'Kudu');
  jobs[0].resolve(['Kudu','Eland','Topi']);await first;
  assert.equal(jobs.length,1);
  await engine.prime(q,{exclude:new Set(['kudu'])});assert.equal(jobs.length,1);
  const backfill=engine.prime(q,{exclude:new Set(['kudu','eland'])});
  assert.equal(jobs.length,2);assert.equal(jobs[1].count,18);
  jobs[1].resolve(['Gnu','Oryx','Impala','Gerenuk','Springbok']);await backfill;
  assert.equal(engine.records(q).length,8);
});

test('switching to a fully local category cancels obsolete model work',async t=>{
  let signal,requests=0;
  const provider={generate(q,opts){requests++;signal=opts.signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))));},close(){}};
  const {engine}=fixture(t,provider);const previous=engine.prime('Name a martial art');
  await engine.prime('Name a fruit');await previous;
  assert.equal(signal.aborted,true);assert.equal(requests,1);
});

test('an empty model list does not spend two further requests on an exhausted category',async t=>{
  let requests=0;const {engine}=fixture(t,{async generate(){requests++;return [];},close(){}});
  await engine.prime('Name a finite custom category');await engine.prime('Name a finite custom category');
  assert.equal(requests,1);
});
