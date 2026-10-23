#!/usr/bin/env node
/** Build a local rare-first index from exported public answer-archive pages. */
import fs from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {questionKey,normalize,answerFits} from './answer-engine.mjs';
import {DATA} from './paths.mjs';
export const SCORE_TIER={100:'krillion',85:'deepcut',60:'rare',30:'schooler',15:'tooclever',10:'plankton',0:'tooclever'};
export function mergeArchive(index,data,{limit=100}={}){
 const url=new URL(data.url);
 if(url.origin!=='https://www.linkedinpinpointanswer.today'||!/^\/krillion-answers\/\d{4}-\d{2}-\d{2}$/.test(url.pathname)||url.search||url.hash)throw new Error('A public daily answer archive URL is required');
 if(!Array.isArray(data.prompts)||!data.prompts.length)throw new Error('Archive export is missing prompts');
 index??={version:1,kind:'answer-archive',questions:{},sources:{}};
 if(index.version!==1||index.kind!=='answer-archive'||!index.questions||!index.sources)throw new Error('Unsupported answer archive');
 const retrievedAt=data.retrievedAt??new Date().toISOString(),date=url.pathname.split('/').pop();let retained=0;
 for(const q of data.prompts){
  if(typeof q.text!=='string'||!Array.isArray(q.answers))throw new Error('Incomplete archive prompt');
  const seen=new Set(),answers=[];
  for(const a of [...q.answers].sort((a,b)=>b.score-a.score)){
   const tier=SCORE_TIER[a.score];
   if(!tier||!answerFits(q.text,a.answer))continue;
   const key=normalize(a.answer);if(seen.has(key))continue;seen.add(key);
   if(answers.length<limit)answers.push({text:a.answer,tier});
  }
  if(!answers.length)continue;
  const key=questionKey(q.text),existing=index.questions[key];
  if(!existing||date>=existing.date){
   index.questions[key]={question:q.text,date,sourceUrl:url.href,retrievedAt,complete:Number.isInteger(q.totalAnswers)&&q.totalAnswers===seen.size&&seen.size<=limit,answers};
  }
  retained+=answers.length;
 }
 index.sources[url.href]={date,retrievedAt,prompts:data.prompts.length,retainedAnswers:retained,sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex')};
 index.updatedAt=[index.updatedAt??'',retrievedAt].sort().at(-1);return index;
}
export function importArchive(directory,output=path.join(DATA,'answer-archive.json.gz')){
 let index=null;
 for(const file of fs.readdirSync(directory).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort())index=mergeArchive(index,JSON.parse(fs.readFileSync(path.join(directory,file),'utf8')));
 if(!index)throw new Error('No dated public archive exports found');
 fs.mkdirSync(path.dirname(output),{recursive:true});const bytes=JSON.stringify(index,null,2);fs.writeFileSync(output+'.tmp',output.endsWith('.gz')?gzipSync(bytes):bytes);fs.renameSync(output+'.tmp',output);return index;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length!==1&&args.length!==3||args.length===3&&args[1]!=='--output')throw new Error('Use node src/answer-archive.mjs EXPORT_DIRECTORY [--output FILE]');
 const index=importArchive(path.resolve(args[0]),args[2]?path.resolve(args[2]):undefined);
 console.log(JSON.stringify({sources:Object.keys(index.sources).length,questions:Object.keys(index.questions).length,answers:Object.values(index.questions).reduce((n,q)=>n+q.answers.length,0)}));
}
