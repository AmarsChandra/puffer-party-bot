#!/usr/bin/env node
/** Cache rare choices from the public daily and free first-round reveals. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {questionKey,normalize,answerFits} from './answer-engine.mjs';
import {DATA} from './paths.mjs';
const TIER={krillion:5,deepcut:4,rare:3,schooler:2,plankton:1,tooclever:0};
export function mergeReveal(index,data,{url,retrievedAt=new Date().toISOString(),limit=80}={}){
 if(!url?.startsWith('https://krillion.io/api/'))throw new Error('A Krillion reveal source is required');
 const prompts=data.prompts??data.rounds;
 if(!Array.isArray(prompts))throw new Error('Reveal is missing its prompt list');
 index??={version:1,questions:{},sources:{}};
 if(index.version!==1||!index.questions||!index.sources)throw new Error('Unsupported regular bank');
 let answerCount=0,kept=0;
 for(const q of prompts){
  if(typeof q.text!=='string'||!Array.isArray(q.answers))continue;
  const seen=new Set(),answers=[];
  for(const a of [...q.answers].sort((a,b)=>(TIER[b?.tier]??-1)-(TIER[a?.tier]??-1))){
   if(typeof a?.answer!=='string'||!(a.tier in TIER)||!answerFits(q.text,a.answer))continue;
   const key=normalize(a.answer);if(seen.has(key))continue;seen.add(key);answerCount++;
   if(answers.length<limit)answers.push({text:a.answer,tier:a.tier});
  }
  if(answers.length){index.questions[questionKey(q.text)]={question:q.text,sourceUrl:url,retrievedAt,complete:seen.size<=limit,answers};kept+=answers.length;}
 }
 index.sources[url]={retrievedAt,prompts:prompts.length,eligibleAnswers:answerCount,retainedAnswers:kept,sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex')};
 index.updatedAt=retrievedAt;return index;
}
export async function refreshRegularBank({output=path.join(DATA,'regular-bank.json'),fetchImpl=fetch,onLog=()=>{}}={}){
 let index=fs.existsSync(output)?JSON.parse(fs.readFileSync(output)):null;
 const get=async url=>{const r=await fetchImpl(url,{signal:AbortSignal.timeout(12000)});if(r.status===402||r.status===403){onLog({url,status:r.status,skipped:true});return null;}if(!r.ok)throw new Error(`Regular bank request failed: ${r.status} ${url}`);return r.json();};
 const today=await get('https://krillion.io/api/today');
 if(today&&/^\d{4}-\d{2}-\d{2}$/.test(today.date)){
  const url='https://krillion.io/api/reveal?date='+today.date,data=await get(url);
  if(data){index=mergeReveal(index,data,{url});onLog({url,prompts:data.prompts?.length});}
 }
 // These are the free first dives offered by the normal client. No unlock
 // credentials or archive dates are supplied, and access denials stay denied.
 for(const base of ['unlimited','packs/movies','packs/sports','packs/geography','packs/lexicon']){
  const gameUrl='https://krillion.io/api/'+base+'/1';
  if(!await get(gameUrl))continue;
  const url=gameUrl+'/reveal',data=await get(url);
  if(data){index=mergeReveal(index,data,{url});onLog({url,prompts:data.rounds?.length});}
 }
 if(!index)throw new Error('No public reveal data was available');
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output+'.tmp',JSON.stringify(index,null,2));fs.renameSync(output+'.tmp',output);
 return index;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);let output=path.join(DATA,'regular-bank.json');
 if(args.length&&!(args.length===2&&args[0]==='--output'))throw new Error('Use node regular-bank.mjs [--output FILE]');
 if(args.length)output=path.resolve(args[1]);
 const index=await refreshRegularBank({output,onLog:row=>console.log(JSON.stringify(row))});
 console.log(JSON.stringify({output,questions:Object.keys(index.questions).length,answers:Object.values(index.questions).reduce((n,q)=>n+q.answers.length,0),sources:Object.keys(index.sources).length}));
}
