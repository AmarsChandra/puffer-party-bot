import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TauntingTyper,TAUNTS} from '../src/taunting.mjs';

test('a fresh fuse types a taunt one character at a time, holds a second, clears, then submits only the answer',()=>{
 const typer=new TauntingTyper('Quince',{enabled:true,minorTypos:true,random:()=>0});let value='',now=0,clears=0,holdStart=null,submitted=false;const typed=[];
 for(;now<7000;now+=50){
  const step=typer.next({value,fuseLevel:0,now});
  assert(!step.typo);assert.notEqual(step.kind,'backspace');
  if(step.tauntVisible)holdStart??=now;
  if(step.kind==='type'){assert.equal(Array.from(step.text).length,1);typed.push(step.text);value+=step.text;}
  if(step.kind==='clear'){assert.equal(value,TAUNTS[0]);assert(now-holdStart>=1000);value='';clears++;}
  if(step.kind==='submit'){assert.equal(value,'Quince');submitted=true;break;}
 }
 assert(submitted);assert.equal(clears,1);assert.equal(typed.join(''),TAUNTS[0]+'Quince');
});
test('inflated and unreadable fuse bars skip taunts, and an existing answer draft is preserved',()=>{
 for(const fuseLevel of [null,1,2,3,4,5]){
  const typer=new TauntingTyper('Quince',{enabled:true,random:()=>0});
  const step=typer.next({value:'',fuseLevel,now:3000});assert.notEqual(typer.phase,'taunt');assert.notEqual(step.kind,'clear');
 }
 const typer=new TauntingTyper('Quince',{enabled:true,random:()=>0});
 assert.notEqual(typer.next({value:'Qui',fuseLevel:0,now:0}).kind,'clear');assert.equal(typer.phase,'answer');
});
test('an inflating or unreadable fuse clears even a complete taunt instead of submitting it',()=>{
 for(const fuseLevel of [null,3,4,5]){
  const typer=new TauntingTyper('Quince',{enabled:true,random:()=>0});typer.next({fuseLevel:0,now:0});
  assert.deepEqual(typer.next({value:TAUNTS[0],fuseLevel,now:1000}),{kind:'clear'});
 }
});
test('slow browser calls abandon the taunt and longer answers require a larger time budget',()=>{
 const typer=new TauntingTyper('Quince',{enabled:true,random:()=>0});typer.next({fuseLevel:0,now:0});
 assert.deepEqual(typer.next({value:'I',fuseLevel:0,now:3500}),{kind:'clear'});
 const long=new TauntingTyper('A much longer conventional answer with many letters',{enabled:true,random:()=>0});
 long.next({fuseLevel:0,now:0});assert.equal(long.phase,'answer');
});
test('rising visible inflation still leaves time to clear and send a short answer',()=>{
 for(const random of [()=>0,()=>.5,()=>.99]){
  const typer=new TauntingTyper('Fig',{enabled:true,random});let value='',sent=false,cleared=false;const typed=[];
  for(let now=0;now<=7100;now+=50){
   const fuseLevel=[1200,2500,3900,5400,7100].filter(threshold=>now>=threshold).length;
   const step=typer.next({value,fuseLevel,now});
   if(step.kind==='type'){value+=step.text;typed.push(step.text);}
   if(step.kind==='clear'){cleared=true;value='';}
   if(step.kind==='submit'){assert.equal(value,'Fig');assert(now<5400);sent=true;break;}
  }
  assert(cleared);assert(sent);assert.equal(typed.join(''),"I'm going to winFig");
 }
});
test('a retained prior-turn draft is cleared before deciding whether a new taunt fits',()=>{
 const typer=new TauntingTyper('Fig',{enabled:true,random:()=>0});
 assert.deepEqual(typer.next({value:'prior answer',fuseLevel:0,now:0}),{kind:'clear'});
 assert.equal(typer.phase,'pending');typer.next({value:'',fuseLevel:0,now:50});assert.equal(typer.phase,'taunt');
});
