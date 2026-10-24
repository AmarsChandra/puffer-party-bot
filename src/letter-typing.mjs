// Local timing only. Every typing action emits exactly one character.
export function turnSeconds(text){
 const match=/▸[^\n]+\n(\d+(?:\.\d+)?)\s*\nSEND\b/i.exec(text);
 return match?Number(match[1]):null;
}

export class NaturalTyper {
 constructor(answer,{now=Date.now(),random=Math.random}={}){
  this.answer=answer;this.random=random;this.startedAt=now;
  this.nextAt=now+this.between(220,650);this.finishAt=null;
 }
 between(min,max){return Math.round(min+(max-min)*this.random());}
 next({value='',secondsLeft,now=Date.now()}){
  const hurried=Number.isFinite(secondsLeft)&&secondsLeft<=3||now-this.startedAt>=2600;
  if(value===this.answer){
   if(hurried)return {kind:'submit'};
   this.finishAt??=now+this.between(65,180);
   return {kind:now>=this.finishAt?'submit':'wait'};
  }
  this.finishAt=null;
  if(!hurried&&now<this.nextAt)return {kind:'wait'};
  if(!this.answer.startsWith(value))return {kind:'clear'};
  this.nextAt=now+this.between(hurried?15:40,hurried?40:130)+(value.endsWith(' ')&&!hurried?this.between(60,150):0);
  return {kind:'type',text:Array.from(this.answer.slice(value.length))[0]};
 }
}
