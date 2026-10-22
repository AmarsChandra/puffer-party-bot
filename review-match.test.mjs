import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {reviewMatch} from './review-match.mjs';
import {auditCampaign} from './adaptive-campaign.mjs';
const bank=JSON.parse(fs.readFileSync(new URL('./answers.json',import.meta.url)));
test('review distinguishes a newly local solution from a slow general category',()=>{
 const result={room:'TEST',won:true,metrics:{categoryLatency:[{question:'Name an English word ending in “-ware”',readyMs:3762,firstTurnWaitMs:82},{question:'Name a country with at least five land neighbors',readyMs:6623,firstTurnWaitMs:82}]},accepted:[],rejected:[],finalRoom:{events:[]}};
 const report=reviewMatch(result,bank);
 assert.equal(report.findings[0].kind,'local-solver-opportunity');
 assert.equal(report.findings[1].kind,'slow-first-answer');
 assert.equal(report.learning.ownAccepted,0);
});
test('campaign audit rejects win counts that have no underlying match evidence',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'puffer-campaign-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'versions','v'),{recursive:true});fs.writeFileSync(path.join(root,'versions','v','code.mjs'),'code');
 const state={target:1,queue:'party',status:'target-reached',versions:[{id:'v',sources:{'code.mjs':createHash('sha256').update('code').digest('hex')}}],records:[{number:1,outcome:'win',gameId:'g',sourceVersion:'v',finishedAt:new Date().toISOString(),reviewed:true}],progress:{current:1,best:1}};
 fs.writeFileSync(path.join(root,'campaign.json'),JSON.stringify(state));
 const result=auditCampaign(root);assert.equal(result.complete,false);assert.ok(result.issues.some(x=>x.includes('Missing terminal result')));
});

test('rarity reports use only tiers actually returned by the server',()=>{
 const accepted=[{question:'Q',submit:{tier:'plankton'}},{question:'Q',submit:{tier:'rare'}},{question:'Q',submit:{tier:'deepcut'}},{question:'Q',submit:{tier:'krillion'}},{question:'Q',submit:{}}];
 const r=reviewMatch({accepted,metrics:{categoryLatency:[{question:'Q'}]}},{});
 assert.equal(r.rarity.rareOrBetter,3);assert.equal(r.rarity.rareOrBetterRate,3/5);
 assert.equal(r.rarity.tiers.unknown,1);assert.deepEqual(r.categories[0].rarity,r.rarity);
});
