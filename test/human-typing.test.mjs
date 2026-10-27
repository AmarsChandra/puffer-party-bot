import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HumanTyper} from '../src/human-typing.mjs';

function simulate(answer,options={},fuseLevel=0){
 const typer=new HumanTyper(answer,{now:0,random:()=>0,...options});
 let value='';const steps=[];
 for(let now=0;now<=7000;now+=25){
  const step=typer.next({value,fuseLevel,now});steps.push({now,value,...step});
  if(step.kind==='type'){assert.equal(Array.from(step.text).length,1);value+=step.text;}
  else if(step.kind==='backspace')value=Array.from(value).slice(0,-1).join('');
  else if(step.kind==='clear')assert.fail('An intentional typo must use Backspace');
  else if(step.kind==='submit'){assert.equal(value,answer);return {steps,typer};}
 }
 assert.fail('Answer was not submitted');
}

test('an occasional wrong letter is noticed, backspaced, and corrected before Enter',()=>{
 const {steps,typer}=simulate('Quince',{minorTypos:true});
 assert.equal(steps.filter(s=>s.typo).length,1);assert.equal(steps.filter(s=>s.kind==='backspace').length,1);
 const mistake=steps.find(s=>s.typo),correction=steps.find(s=>s.kind==='backspace');
 assert(correction.now-mistake.now>=110);assert(correction.now-mistake.now<=250);assert(typer.correctedTypo);
});
test('ordinary answers, short or long answers, and unreadable or warm fuses skip deliberate typos',()=>{
 for(const [answer,options,fuse] of [
  ['Quince',{minorTypos:false},0],['Fig',{minorTypos:true},0],
  ['A much longer answer',{minorTypos:true},0],['Quince',{minorTypos:true},null],
  ['Quince',{minorTypos:true},1],['Quince',{minorTypos:true},4],
  ['Quince',{minorTypos:true,random:()=>.5},0],
 ])assert(!simulate(answer,options,fuse).steps.some(s=>s.typo));
});
test('a warming fuse corrects an existing mistake immediately instead of waiting or submitting it',()=>{
 const typer=new HumanTyper('Quince',{minorTypos:true,now:0,random:()=>0});let value='';
 for(let now=0;now<1200;now+=25){
  const step=typer.next({value,fuseLevel:0,now});
  if(step.kind==='type')value+=step.text;
  if(step.typo){
   assert.deepEqual(typer.next({value,fuseLevel:4,now:now+1}),{kind:'backspace'});
   value=Array.from(value).slice(0,-1).join('');
   assert.deepEqual(typer.next({value,fuseLevel:4,now:now+2}),{kind:'type',text:'u'});
   return;
  }
 }
 assert.fail('No typo was produced by the forced test scenario');
});
