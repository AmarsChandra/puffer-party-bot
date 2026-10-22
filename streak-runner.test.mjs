import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifiedOutcome,streakProgress} from './streak-runner.mjs';

function result(){
 const players=[{id:'me',alive:true,lives:2,place:1},{id:'opponent',alive:false,lives:0,place:2}];
 return {won:true,playerId:'me',winnerId:'me',gameId:'game-1',startingRoom:{gameNumber:1,phase:'round',players},finalRoom:{gameId:'game-1',gameNumber:1,phase:'over',queue:'party',settings:{isPrivate:false},winnerId:'me',players}};
}
test('wins require a public server result for a match the bot actually entered',()=>{
 assert.equal(verifiedOutcome(result(),'party'),'win');
 const privateGame=result();privateGame.finalRoom.settings.isPrivate=true;
 assert.equal(verifiedOutcome(privateGame,'party'),'inconclusive');
 const spectator=result();spectator.startingRoom.players=[];
 assert.equal(verifiedOutcome(spectator,'party'),'inconclusive');
 const claimedWin=result();claimedWin.finalRoom.winnerId='opponent';
 assert.equal(verifiedOutcome(claimedWin,'party'),'inconclusive');
 const wrongQueue=result();wrongQueue.finalRoom.queue='duel';
 assert.equal(verifiedOutcome(wrongQueue,'party'),'inconclusive');
});
test('a loss, incomplete game, or repeated game ID breaks a winning streak',()=>{
 const rows=[{gameId:'a',outcome:'win'},{gameId:'b',outcome:'win'},{gameId:'c',outcome:'loss'},{gameId:'d',outcome:'win'}];
 assert.deepEqual(streakProgress(rows),{current:1,best:2});
 rows.push({gameId:'d',outcome:'win'});
 assert.deepEqual(streakProgress(rows),{current:0,best:2});
 assert.deepEqual(streakProgress([{gameId:'x',outcome:'win'},{outcome:'inconclusive'},{gameId:'y',outcome:'win'}]),{current:1,best:1});
});
