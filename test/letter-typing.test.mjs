import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NaturalTyper,turnSeconds,fuseLevelFromTransform} from '../src/letter-typing.mjs';

test('the clock parser never mistakes lives for a countdown',()=>{
 for(const lives of [1,2,3,4,5])assert.equal(turnSeconds(`▸ your puffer · type an answer\n${lives}\nSEND`),null);
 assert.equal(turnSeconds('Dinosaur\n1502\nFLOATING\n2/6\n▸ your puffer · type an answer\n8 seconds left\nSEND'),8);
 assert.equal(turnSeconds('▸ Dinosaur is up\n2.5s\nSEND'),2.5);
 assert.equal(turnSeconds('FLOATING\n2/6\nSEND'),null);
});
test('the visible fuse transform maps to inflation levels',()=>{
 for(const [scale,level] of [[0,0],[.2,1],[.6,3],[1,5]])assert.equal(fuseLevelFromTransform(`transform: scaleX(${scale.toFixed(2)});`),level);
 for(const style of [null,'','scaleX(-0.2)','scaleX(1.2)'])assert.equal(fuseLevelFromTransform(style),null);
});
test('typing varies its initial pause, builds on the existing draft, and pauses before Enter',()=>{
 const slow=new NaturalTyper('Quince',{now:0,random:()=>.99});const fast=new NaturalTyper('Quince',{now:0,random:()=>0});
 assert(slow.nextAt>fast.nextAt);assert.equal(fast.next({value:'',secondsLeft:10,now:0}).kind,'wait');
 let value='';for(let now=300;value!=='Quince';now+=150){const step=fast.next({value,secondsLeft:10,now});assert.equal(step.kind,'type');value+=step.text;}
 assert.equal(fast.next({value,secondsLeft:8,now:1300}).kind,'wait');
 assert.equal(fast.next({value,secondsLeft:8,now:1500}).kind,'submit');
});
test('a short clock accelerates individual keystrokes without pasting the rest of the answer',()=>{
 for(const secondsLeft of [0,1,3]){
  const typer=new NaturalTyper('Quince',{now:0});assert.deepEqual(typer.next({value:'Qui',secondsLeft,now:1}),{kind:'type',text:'n'});
  assert.equal(typer.next({value:'Quince',secondsLeft,now:1}).kind,'submit');
 }
});
test('a hot visible fuse accelerates individual keys without needing a countdown',()=>{
 const typer=new NaturalTyper('Quince',{now:0});
 assert.deepEqual(typer.next({value:'Qui',urgent:true,now:1}),{kind:'type',text:'n'});
 assert.equal(typer.next({value:'Quince',urgent:true,now:1}).kind,'submit');
});
test('slow browser calls accelerate typing but still emit only one character per action',()=>{
 const typer=new NaturalTyper('A long conventional answer',{now:0});
 assert.deepEqual(typer.next({value:'A l',secondsLeft:9,now:2600}),{kind:'type',text:'o'});
});
test('an unknown clock keeps natural timing and never pastes a completed answer',()=>{
 const typer=new NaturalTyper('Quince',{now:0,random:()=>0});assert.equal(typer.next({value:'',secondsLeft:null,now:0}).kind,'wait');
 assert.deepEqual(typer.next({value:'Qui',secondsLeft:null,now:500}),{kind:'type',text:'n'});
});
