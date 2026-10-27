import {NaturalTyper} from './typing.mjs';

const NEIGHBORS={q:'w',w:'e',e:'r',r:'t',t:'y',y:'u',u:'i',i:'o',o:'p',p:'o',a:'s',s:'d',d:'f',f:'g',g:'h',h:'j',j:'k',k:'l',l:'k',z:'x',x:'c',c:'v',v:'b',b:'n',n:'m',m:'n'};

export class HumanTyper extends NaturalTyper {
 constructor(answer,{minorTypos=false,now=Date.now(),random=Math.random}={}){
  super(answer,{now,random});
  this.pace=this.between(55,105);this.burstRemaining=this.between(3,6);
  // One possible mistake per short answer, on about 6% of eligible answers.
  this.mistakePlanned=minorTypos&&answer.length>=4&&answer.length<=12&&random()<.06;
  this.mistakeAt=this.mistakePlanned?1+Math.floor(random()*Math.min(3,answer.length-2)):null;
  this.typo=null;this.correctionRequested=false;this.correctedTypo=false;
 }
 next({value='',secondsLeft,fuseLevel=null,urgent=false,now=Date.now()}={}){
  const rushed=urgent||Number.isInteger(fuseLevel)&&fuseLevel>=3||Number.isFinite(secondsLeft)&&secondsLeft<=3||now-this.startedAt>=2600;
  if(this.typo){
   if(value===this.typo.draft){
    if(!rushed&&fuseLevel===0&&now<this.correctionAt)return {kind:'wait'};
    this.correctionRequested=true;
    return {kind:'backspace'};
   }
   if(value===this.typo.prefix){
    this.correctedTypo=this.correctionRequested;
    this.nextAt=now+(rushed?0:this.between(40,90));
   }
   this.typo=null;
  }
  const step=super.next({value,secondsLeft,urgent:rushed,now});
  if(step.kind!=='type')return step;
  if(!rushed){
   this.nextAt=now+this.between(Math.max(30,this.pace-25),this.pace+35);
   if(step.text===' ')this.nextAt+=this.between(60,140);
   if(--this.burstRemaining<=0){this.nextAt+=this.between(40,100);this.burstRemaining=this.between(3,6);}
  }
  const neighbor=NEIGHBORS[step.text.toLowerCase()];
  if(this.mistakePlanned&&!rushed&&fuseLevel===0&&now-this.startedAt<1100&&value.length===this.mistakeAt&&neighbor){
   const wrong=step.text===step.text.toUpperCase()?neighbor.toUpperCase():neighbor;
   this.mistakePlanned=false;this.typo={prefix:value,draft:value+wrong};
   this.correctionAt=now+this.between(110,220);
   return {kind:'type',text:wrong,typo:true};
  }
  return step;
 }
}
