import {NaturalTyper} from './typing.mjs';

export const TAUNTS=["I'm going to win"];

// Draft-only typing: Enter is reserved for the prepared answer, never a taunt.
export class TauntingTyper {
 constructor(answer,{enabled=false,random=Math.random}={}){
  this.answer=answer;this.enabled=enabled;this.random=random;this.phase='pending';
 }
 between(min,max){return Math.round(min+(max-min)*this.random());}
 next({value='',fuseLevel=null,now=Date.now()}){
  const readable=Number.isInteger(fuseLevel)&&fuseLevel>=0&&fuseLevel<=5;
  if(this.phase==='pending'){
   if(value&&!this.answer.startsWith(value))return {kind:'clear'};
   const eligible=TAUNTS.filter(p=>(p.length+Array.from(this.answer).length)*.13+2.2<=6);
   if(this.enabled&&!value&&readable&&fuseLevel===0&&eligible.length){
    this.phrase=eligible[Math.min(eligible.length-1,Math.floor(this.random()*eligible.length))];
    this.phase='taunt';this.startedAt=now;this.nextAt=now+this.between(100,180);
   }else{this.phase='answer';this.skipReason=value?'existing-answer-draft':!readable?'unreadable-fuse':fuseLevel>0?'puffer-already-inflating':'answer-too-long';}
  }
  if(this.phase==='taunt'||this.phase==='hold'){
   if(!readable||fuseLevel>=3||now-this.startedAt>=3500)this.phase='clearing';
   else if(value===this.phrase){
    this.phase='hold';this.holdUntil??=now+1000;
    if(now<this.holdUntil)return {kind:'wait',tauntVisible:true};
    this.phase='clearing';
   }else{
    if(now<this.nextAt)return {kind:'wait'};
    if(!this.phrase.startsWith(value))return {kind:'clear'};
    this.nextAt=now+this.between(45,85);
    return {kind:'type',text:Array.from(this.phrase.slice(value.length))[0]};
   }
  }
  if(this.phase==='clearing'){
   if(value)return {kind:'clear'};
   this.phase='answer';
  }
  this.answerTyper??=new NaturalTyper(this.answer,{now,random:this.random});
  return this.answerTyper.next({value,urgent:readable&&fuseLevel>=4,now});
 }
}
