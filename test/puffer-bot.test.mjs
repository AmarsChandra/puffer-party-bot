import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PufferBot, applyPatch, candidates } from '../src/puffer-bot.mjs';

const bank = JSON.parse(fs.readFileSync(new URL('../data/answers.json',import.meta.url),'utf8'));
const winner = JSON.parse(fs.readFileSync(new URL('./fixtures/winning-game.json',import.meta.url),'utf8'));
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'puffer-test-'));
  const bot=new PufferBot({output:dir,cache:path.join(dir,'learned.json')});bot.log=()=>{};
  t.after(()=>{bot.close();fs.rmSync(dir,{recursive:true,force:true});});
  bot.seat={playerId:'me'};bot.categoryKey='1:1';bot.receivedAt=Date.now();
  bot.room={version:1,now:Date.now(),gameNumber:1,phase:'round',holderId:'me',holderSince:Date.now()-1000,category:{index:1,text:'Name a woodwind instrument'},players:[{id:'me',alive:true}],events:[]};
  return bot;
}

test('replays the actual win and verifies accepted answers remain available',()=>{
  assert.equal(winner.won,true);
  assert.equal(winner.finalRoom.winnerId,winner.playerId);
  assert.equal(winner.player.place,1);
  assert.equal(winner.player.answers,4);
  assert.equal(winner.player.lives,2);
  for(const a of winner.accepted) {
    assert.equal(a.submit.accepted,true);
    assert.ok(candidates(a.question,bank).includes(a.answer));
  }
  const opponent=winner.finalRoom.players.find(p=>p.id!==winner.playerId);
  assert.equal(opponent.lives,0);
  assert.equal(winner.finalRoom.events.filter(e=>e.kind==='pop'&&e.playerId===opponent.id).length,2);
});

test('patches enforce version continuity, replace players and bound event history',()=>{
  const room={version:3,players:[{id:'a',seat:0},{id:'b',seat:1}],events:[{seq:1}],chat:[]};
  const p={base:3,v:4,now:10,set:{holderId:'b'},drop:['a'],players:[{id:'b',seat:1,lives:1}],events:[{seq:2}],eventsLength:1};
  const r=applyPatch(room,p);
  assert.equal(r.version,4);assert.deepEqual(r.events,[{seq:2}]);assert.deepEqual(r.players,[{id:'b',seat:1,lives:1}]);
  assert.equal(applyPatch(r,p),null);
  assert.deepEqual(applyPatch(r,{base:4,v:5,now:11,events:[],eventsLength:0}).events,[]);
  assert.equal(room.players.length,2);
});

test('candidate lookup tolerates accents and punctuation and removes aliases',()=>{
  assert.ok(candidates('Name a Pokémon',bank).includes('Pikachu'));
  assert.ok(candidates('Name a U.S. state!',bank).includes('Wyoming'));
  assert.deepEqual(candidates('Unknown prompt',bank),[]);
  assert.deepEqual(candidates('Q',{questions:{Q:['A-B','A B','C']}}),['A-B','C']);
});

test('waits for the correct player and the future turn start',async t=>{
  const bot=fixture(t);let count=0;bot.act=async()=>{count++;return {submit:{accepted:true}};};
  bot.room.holderId='them';await bot.tick();
  bot.room.holderId='me';bot.room.holderSince=Date.now()+10000;await bot.tick();
  assert.equal(count,0);
});

test('an ack arriving before its room patch cannot cause a second submission',async t=>{
  const bot=fixture(t),answers=[];
  bot.act=async action=>{answers.push(action.text);return {ok:true,submit:{accepted:true,answer:action.text}};};
  await bot.tick();await bot.tick();await bot.tick();
  assert.equal(answers.length,1);
  bot.room={...bot.room,holderSince:bot.room.holderSince+1};bot.nextSendAt=0;
  await bot.tick();assert.equal(answers.length,2);assert.notEqual(answers[0],answers[1]);
});

test('rejected and already used answers are skipped',async t=>{
  const bot=fixture(t),answers=[];
  bot.used.add('heckelphone');
  bot.act=async action=>{answers.push(action.text);return {ok:true,submit:{accepted:false,why:'miss'}};};
  await bot.tick();bot.nextSendAt=0;await bot.tick();
  assert.deepEqual(answers,['Contrabassoon','Basset horn']);
});

test('a new category arriving before the previous ack keeps its answer set clean',async t=>{
  const bot=fixture(t);
  bot.act=async action=>{
    bot.categoryKey='1:2';bot.tried.clear();bot.used.clear();
    return {ok:true,submit:{accepted:true,answer:action.text}};
  };
  await bot.tick();assert.equal(bot.used.size,0);
});

test('first-answer readiness is measured before the bot gets its first turn',async t=>{
  const bot=fixture(t);let deliver;
  bot.engine.provider={generate(q,{onAnswer}){deliver=onAnswer;return Promise.resolve([]);},close(){}};
  bot.categoryKey=null;bot.room.category={index:1,text:'Name a martial art'};bot.room.holderId='them';
  bot.onRoom();
  assert.equal(bot.metrics.categoryLatency[0].readyMs,null);
  deliver('Karate');
  assert.equal(typeof bot.metrics.categoryLatency[0].readyMs,'number');
  assert.equal(bot.metrics.categoryLatency[0].firstSubmitMs,null);
  bot.room.holderId='me';bot.act=async action=>({ok:true,submit:{accepted:true,answer:action.text}});
  await bot.tick();
  assert.equal(typeof bot.metrics.categoryLatency[0].firstTurnWaitMs,'number');
  assert.equal(bot.accepted[0].answer,'Karate');
});

test('a finished game seen on joining cannot count as a played match',t=>{
  const bot=fixture(t);let finished=0;bot.finish=()=>finished++;
  bot.room.phase='over';bot.room.winnerId='them';bot.onRoom();
  assert.equal(finished,0);
  bot.room.phase='round';bot.room.holderId='them';bot.onRoom();
  bot.room.phase='over';bot.onRoom();
  assert.equal(finished,1);
});

const guestToken=(guest,exp)=>'test.'+Buffer.from(JSON.stringify({g:guest,exp})).toString('base64url')+'.signature';
test('reconnect reuses an unexpired token without creating another guest',async t=>{
  const bot=fixture(t);bot.tokenExp=Math.floor(Date.now()/1000)+3600;bot.token=guestToken('original',bot.tokenExp);
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async()=>{throw new Error('Unexpected identity request');};
  const originalToken=bot.token;await bot.identity();assert.equal(bot.token,originalToken);
});

test('token renewal sends the bot guest cookie and retains the same identity',async t=>{
  const bot=fixture(t);bot.tokenExp=1;bot.token=guestToken('original',1);bot.guestCookie='krillion-party-guest=original-cookie';
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});let sentCookie;
  globalThis.fetch=async(url,options)=>{sentCookie=options.headers.Cookie;const exp=Math.floor(Date.now()/1000)+3600;return new Response(JSON.stringify({token:guestToken('original',exp),exp}),{headers:{'Set-Cookie':'krillion-party-guest=renewed-cookie; HttpOnly; Secure'}});};
  await bot.identity();assert.equal(sentCookie,'krillion-party-guest=original-cookie');
  assert.equal(bot.guestCookie,'krillion-party-guest=renewed-cookie');
  assert.equal(JSON.parse(Buffer.from(bot.token.split('.')[1],'base64url')).g,'original');
});

test('identity mismatch cannot overwrite the saved seat token',async t=>{
  const bot=fixture(t);bot.tokenExp=1;bot.token=guestToken('original',1);const originalToken=bot.token;
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async()=>new Response(JSON.stringify({token:guestToken('different',9999999999),exp:9999999999}));
  await assert.rejects(bot.identity(),/changed identity/);assert.equal(bot.token,originalToken);
});

test('resume restores the guest identity before attempting any renewal',async t=>{
  const bot=fixture(t),file=path.join(bot.outputDir,'seat.json'),exp=Math.floor(Date.now()/1000)+3600;
  fs.writeFileSync(file,JSON.stringify({code:'ABCD',playerId:'me',playerKey:'own-seat',token:guestToken('original',exp),tokenExp:exp}));
  bot.options.resume=file;const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async()=>{throw new Error('Unexpected new guest');};
  await bot.join();assert.equal(bot.seat.playerId,'me');assert.equal(bot.tokenExp,exp);
});

test('an interrupted match snapshot retains evidence without guest credentials',t=>{
  const bot=fixture(t);bot.seat.playerKey='private-seat-key';bot.token='private-token';
  const snapshot=bot.snapshotResult();
  assert.equal(snapshot.finalRoom.phase,'round');assert.equal(snapshot.playerId,'me');
  assert.equal(snapshot.won,false);assert.equal(snapshot.metrics,bot.metrics);
  assert.ok(!JSON.stringify(snapshot).includes('private-seat-key'));assert.ok(!JSON.stringify(snapshot).includes('private-token'));
});

test('an assigned seat absent from the lobby fails before claiming participation',async t=>{
  const bot=fixture(t);bot.options.seatPresenceGraceMs=0;bot.room.phase='lobby';bot.room.players=[];let failure;
  bot.fail=e=>{failure=e;bot.close();};bot.onRoom();
  await new Promise(r=>setTimeout(r,10));
  assert.match(failure.message,/seat is absent/);assert.equal(failure.unplayed,true);
  assert.equal(bot.startingRoom,undefined);assert.equal(bot.playedGameNumber,undefined);
});

test('a waiting quick-play guest readies itself and records only its own played game',async t=>{
  const bot=fixture(t),actions=[];bot.seat.quickPlay='joined';bot.room.phase='lobby';bot.room.players[0].alive=false;
  bot.act=async action=>{actions.push(action);return {ok:true};};bot.onRoom();await Promise.resolve();
  assert.deepEqual(actions,[{type:'again'}]);assert.equal(bot.startingRoom,undefined);
  bot.room.phase='countdown';bot.room.gameNumber=2;bot.room.players[0].alive=true;bot.onRoom();
  assert.equal(bot.startingRoom.gameNumber,2);
});
