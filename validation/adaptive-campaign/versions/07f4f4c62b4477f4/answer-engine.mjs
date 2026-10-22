import fs from 'node:fs';
import path from 'node:path';

export const normalize=s=>String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases={
  'asian country':'country in asia','european country':'country in europe','african country':'country in africa',
  'south american country':'country in south america','north american country':'country in north america',
  'english city':'city in england','american state':'us state','u s state':'us state',
  'kitchen tool':'kitchen utensil','colour':'color',
  'city which has hosted the summer olympics':'city that has hosted the summer olympics',
  'city that hosted the summer olympics':'city that has hosted the summer olympics'
};
export function questionKey(q){
  let key=String(q).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  key=key.replace(/^(?:name|give|list)(?: me)? /,'').replace(/^(?:a|an|the) /,'').replace(/^(?:type|kind) of /,'');
  return aliases[key]??key;
}
export function unique(answers){const seen=new Set();return answers.filter(a=>typeof a==='string'&&a.trim()&&a.trim().length<=60&&!seen.has(normalize(a))&&seen.add(normalize(a))).map(a=>a.trim());}
function baseCandidates(question,bank){
  const key=questionKey(question);
  const exact=bank.questions?.[question]??Object.entries(bank.questions??{}).find(([q])=>questionKey(q)===key)?.[1]??[];
  const rules=(bank.rules??[]).filter(r=>new RegExp(r.pattern,'i').test(question));
  return unique([...exact,...rules.flatMap(r=>r.answers??bank.lists?.[r.list]??[])]);
}
const NUMBER={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
function letterLengthConstraint(q){
  const m=/(?:spelled )?with (?:(exactly|at least|at most) )?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?: (or more|or fewer|or less))? letters?[.!?]?$/.exec(q);
  if(!m||m[1]&&m[3])return null;
  return {index:m.index,count:NUMBER[m[2]]??Number(m[2]),minimum:m[1]==='at least'||m[3]==='or more',maximum:m[1]==='at most'||m[3]==='or fewer'||m[3]==='or less'};
}
function lengthFits(text,rule){const n=normalize(text).replace(/[^a-z]/g,'').length;return rule.minimum?n>=rule.count:rule.maximum?n<=rule.count:n===rule.count;}
function letterCountConstraint(q){
  const m=/(?:with|containing) (?:exactly )?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)( or more)? ["']?([a-z])(?:['’]s|s)?["']?\s*[.!?]?$/.exec(q);
  return m?{count:NUMBER[m[1]]??Number(m[1]),minimum:!!m[2],letter:m[3]}:null;
}
function countFits(text,rule){const count=[...normalize(text)].filter(x=>x===rule.letter).length;return rule.minimum?count>=rule.count:count===rule.count;}
function constraintQuestion(question){
  return String(question).toLowerCase().replace(/[“”]/g,'"').replace(/[‘’]/g,"'")
    .replace(/[‐‑‒–—]/g,'-')
    .replace(/(["'])\s*-\s*([a-z]+)\s*\1/g,'$1$2$1')
    .replace(/(["'])\s*([a-z]+)\s*-\s*\1/g,'$1$2$1')
    .replace(/\b((?:with|in)\s+)-([a-z]+)\b/g,'$1$2')
    .replace(/-/g,' ').replace(/\s+/g,' ').trim();
}
export function answerFits(question,text){
  if(!unique([text]).length)return false;
  const q=constraintQuestion(question);
  const lengthRule=letterLengthConstraint(q);if(lengthRule&&!lengthFits(text,lengthRule))return false;
  let m=/\b(\d+|three|four|five|six|seven|eight|nine|ten|eleven|twelve) letter word\b/.exec(q);
  if(m&&normalize(text).replace(/[^a-z]/g,'').length!==(NUMBER[m[1]]??Number(m[1])))return false;
  m=/(?:starts?|begins?|starting|beginning) (?:with|in) (?:the letters? )?["']?([a-z]{1,12})["']?\s*[.!?]?$/.exec(q);
  if(m&&!normalize(text).startsWith(m[1]))return false;
  m=/(?:ends?|ending) (?:with|in) (?:the letters? )?["']?([a-z]{1,12})["']?\s*[.!?]?$/.exec(q);
  if(m&&!normalize(text).endsWith(m[1]))return false;
  if(/\b(?:english )?word\b/.test(q)){
    m=/(?:containing|contains|with the letters) ["']?([a-z]{1,12})["']?\s*[.!?]?$/.exec(q);
    if(m&&!normalize(text).includes(m[1]))return false;
  }
  const countRule=letterCountConstraint(q);if(countRule&&!countFits(text,countRule))return false;
  return true;
}
// A single explicit example is useful immediately, while alternatives generate.
export function promptExample(question){
  const m=/\((?:like|for example,?|e\.g\.,?)\s+([^()]{1,50})\)\s*[.!?]?$/i.exec(question);
  if(!m)return null;
  const text=m[1].trim().replace(/^["'“‘]|["'”’]$/g,'');
  if(/[,/;&]|\b(?:or|and|etc)\b/i.test(text)||!unique([text]).length)return null;
  return answerFits(question.slice(0,m.index).trim(),text)?text:null;
}
let dictionary;
function wordCandidates(question){
  const q=constraintQuestion(question).replace(/[.!?]$/,'').trim();
  const m=/^name (?:an? )?(?:english )?(?:(\d+|three|four|five|six|seven|eight|nine|ten|eleven|twelve) letter )?word (.+)$/.exec(q);
  if(!m)return [];
  let length=m[1]?(NUMBER[m[1]]??Number(m[1])):null,filter;
  const tail=m[2];let x;
  if((x=/^(?:containing|that contains|contains|with the letters) ["']?([a-z]{1,12})["']?$/.exec(tail)))filter=w=>w.includes(x[1]);
  else if((x=/^(?:starting|beginning|that starts|that begins|starts|begins) (?:with|in) (?:the letters? )?["']?([a-z]{1,12})["']?$/.exec(tail)))filter=w=>w.startsWith(x[1]);
  else if((x=/^(?:ending|that ends|ends) (?:with|in) (?:the letters? )?["']?([a-z]{1,12})["']?$/.exec(tail)))filter=w=>w.endsWith(x[1]);
  else if(/^(?:that is |which is )?(?:a )?palindrome$/.test(tail))filter=w=>w===w.split('').reverse().join('');
  else if(letterLengthConstraint(tail)?.index===0){const rule=letterLengthConstraint(tail);filter=w=>lengthFits(w,rule);}
  else if(/^(?:with |containing )(?:a )?double letter$/.test(tail))filter=w=>/(.)\1/.test(w);
  else if(letterCountConstraint(tail)){const rule=letterCountConstraint(tail);filter=w=>countFits(w,rule);}
  else return [];
  dictionary??=JSON.parse(fs.readFileSync(new URL('./english-words.json',import.meta.url),'utf8'));
  return dictionary.filter(w=>(!length||w.length===length)&&filter(w)).slice(0,300);
}
export function candidates(question,bank){
  const direct=baseCandidates(question,bank);if(direct.length)return direct;
  const example=promptExample(question);
  const words=wordCandidates(example?question.slice(0,question.lastIndexOf('(')).trim():question);
  if(words.length)return unique([...(example?[example]:[]),...words]);
  if(example)return [example];
  let m=/^(.+?) (?:that )?(?:starts?|begins?|starting|beginning) with (?:the letter )?["']?([a-z])["']?\s*[.!?]?$/i.exec(question);
  if(m)return baseCandidates(m[1],bank).filter(a=>normalize(a).startsWith(m[2].toLowerCase()));
  m=/^(.+?) (?:that )?(?:ends?|ending) with (?:the letter )?["']?([a-z])["']?\s*[.!?]?$/i.exec(question);
  if(m)return baseCandidates(m[1],bank).filter(a=>normalize(a).endsWith(m[2].toLowerCase()));
  const q=constraintQuestion(question),lengthRule=letterLengthConstraint(q);
  if(lengthRule)return baseCandidates(q.slice(0,lengthRule.index).trim(),bank).filter(a=>lengthFits(a,lengthRule));
  return [];
}
const TIER={plankton:10,tooclever:0,schooler:30,rare:80,deepcut:150,krillion:250};
export class AnswerEngine {
  constructor({bankPath,cachePath,provider=null,onLog=()=>{},onReady=()=>{}}){
    this.bankPath=bankPath;this.cachePath=cachePath;this.provider=provider;this.onLog=onLog;this.onReady=onReady;
    this.data={version:2,questions:{}};this.inflight=new Map();this.attempts=new Map();this.retryAt=new Map();this.bankStamp=-1;this.closed=false;this.staticCache=new Map();
    if(fs.existsSync(cachePath)){
      const data=JSON.parse(fs.readFileSync(cachePath,'utf8'));
      if(data.version!==2||typeof data.questions!=='object')throw new Error('Unsupported learned answer cache');
      this.data=data;
    }
  }
  bank(){const stat=fs.statSync(this.bankPath);if(stat.mtimeMs!==this.bankStamp){const bank=JSON.parse(fs.readFileSync(this.bankPath,'utf8'));this.bankData=bank;this.bankStamp=stat.mtimeMs;this.staticCache.clear();
    this.aliasKeys=new Map(Object.entries(bank.answerAliases??{}).map(([q,aliases])=>[questionKey(q),new Map(Object.entries(aliases).map(([from,to])=>[normalize(from),normalize(to)]))]));
  }return this.bankData;}
  entry(question){const key=questionKey(question);return this.data.questions[key]??(this.data.questions[key]={question,answers:{}});}
  save(){fs.mkdirSync(path.dirname(this.cachePath),{recursive:true});const tmp=this.cachePath+`.tmp-${process.pid}`;fs.writeFileSync(tmp,JSON.stringify(this.data,null,2));fs.renameSync(tmp,this.cachePath);}
  records(question,exclude=new Set()){
    const entry=this.entry(question);this.bank();
    const key=questionKey(question);
    // Explicit, category-specific aliases group exclusions without asserting acceptance.
    const aliases=this.aliasKeys.get(key),answerKey=text=>aliases?.get(normalize(text))??normalize(text);
    const excluded=new Set([...exclude].map(answerKey));
    if(!this.staticCache.has(key))this.staticCache.set(key,candidates(question,this.bankData));
    const staticAnswers=this.staticCache.get(key);
    const pool=new Map(),exampleKey=normalize(promptExample(question)??'');
    staticAnswers.forEach((text,i)=>{const a=entry.answers[normalize(text)];pool.set(answerKey(a?.canonical??text),{text:a?.canonical?a.text:text,score:500-i/100,source:normalize(text)===exampleKey?'example':'bank'});});
    Object.entries(entry.answers).forEach(([storedKey,a])=>{
      const key=answerKey(a.canonical??storedKey);
      // A miss for this exact category outweighs unverified model or bank suggestions.
      if(a.misses>0&&!a.accepted){pool.delete(key);return;}
      const score=a.accepted?1000+(TIER[a.tier]??0)+Math.min(a.accepted,20)/100:a.rarityRequested?1040-(a.order??0)/100:300-(a.order??0)/100;
      if(!pool.has(key)||score>pool.get(key).score)pool.set(key,{...a,score,source:a.accepted?'verified':'codex'});
    });
    return [...pool].filter(([key])=>!excluded.has(key)).map(([,a])=>a).sort((a,b)=>b.score-a.score);
  }
  answer(question,exclude){return this.records(question,exclude)[0]??null;}
  learn(question,text,{accepted=false,tier=null,miss=false,proposed=false,canonical=null,rarityRequested=false}={}){
    if(!question||!unique([text]).length||(proposed&&!accepted&&!answerFits(question,text)))return;
    const answers=this.entry(question).answers,key=normalize(text);
    const a=answers[key]??{text,accepted:0,misses:0,order:Object.keys(answers).length};
    if(accepted){a.text=canonical??text;a.canonical=normalize(canonical??text);a.accepted++;a.tier=tier??a.tier;a.lastAccepted=new Date().toISOString();}
    if(miss)a.misses++;
    if(proposed)a.proposed=true;
    if(rarityRequested)a.rarityRequested=true;
    answers[key]=a;
  }
  prime(question,{exclude=new Set(),force=false}={}){
    const key=questionKey(question);
    this.activeKey=key;
    for(const [other,job] of this.inflight)if(other!==key)job.controller.abort();
    if(this.closed||!this.provider||this.inflight.has(key))return this.inflight.get(key)?.promise??Promise.resolve();
    const available=this.records(question,exclude);
    const rareChoices=available.filter(a=>a.accepted&&(TIER[a.tier]??0)>=TIER.rare).length;
    const rareProposals=available.filter(a=>!a.accepted&&a.rarityRequested).length;
    if(!force&&available.length>=8&&(available.some(a=>a.source==='bank')||rareChoices||rareProposals>=3))return Promise.resolve();
    if(Date.now()<Math.max(this.retryAt.get(key)??0,this.providerRetryAt??0))return Promise.resolve();
    const attempts=this.attempts.get(key)??0;
    if(attempts>=3)return Promise.resolve();
    this.attempts.set(key,attempts+1);
    const firstBurst=available.length===0&&attempts===0;let succeeded=false;
    const controller=new AbortController(),known=[...new Set([...this.records(question).map(a=>a.text),...exclude])];
    const promise=this.provider.generate(question,{count:firstBurst?3:18,exclude:known,signal:controller.signal,onAnswer:text=>{
      if(!this.closed){this.learn(question,text,{proposed:true,rarityRequested:true});this.onReady(question);}
    }}).then(answers=>{
      succeeded=true;
      const fresh=unique(answers);if(!fresh.length)this.attempts.set(key,3);
      for(const text of fresh)if(!this.closed){this.learn(question,text,{proposed:true,rarityRequested:true});this.onReady(question);}
    }).catch(e=>{if(!controller.signal.aborted){
      this.retryAt.set(key,Date.now()+1500*2**attempts);
      if(/usage.limit|rate.limit|too many requests/i.test(e.message)){this.providerRetryAt=Date.now()+60000;this.onLog('ai-paused',{retryAt:this.providerRetryAt,reason:'usage-limit'});}
      this.onLog('ai-error',{question,message:e.message});
    }}).finally(()=>{
      if(this.inflight.get(key)?.controller===controller)this.inflight.delete(key);
      if(!this.closed)this.save();
      if(firstBurst&&succeeded&&!this.closed&&!controller.signal.aborted&&this.activeKey===key&&this.records(question,exclude).length>0)void this.prime(question,{exclude});
    });
    this.inflight.set(key,{promise,controller});return promise;
  }
  async warmup(){
    if(!this.provider)return;
    await this.provider.start();
    const question='Name a city that has hosted the Summer Olympics';
    const answers=await this.provider.generate(question,{onAnswer:text=>this.learn(question,text,{proposed:true})});
    for(const text of unique(answers))this.learn(question,text,{proposed:true});
    this.save();
  }
  close(){this.closed=true;for(const job of this.inflight.values())job.controller.abort();this.save();this.provider?.close();}
}
