import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {snapshotSources,auditCampaign} from '../src/adaptive-campaign.mjs';

test('nested source snapshots remain runnable and their audit detects changed evidence',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'puffer-snapshot-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const version=snapshotSources(root),base=path.join(root,'versions',version.id);
 const {candidates}=await import(pathToFileURL(path.join(base,'src/answer-engine.mjs')));
 const words=candidates('Name an English word containing “age”',{});
 assert.ok(words.length>50);assert.ok(words.every(w=>w.includes('age')));
 fs.writeFileSync(path.join(root,'campaign.json'),JSON.stringify({versions:[version],records:[],progress:{current:0,best:0},queue:'party',target:20,status:'awaiting-review'}));
 assert.deepEqual(auditCampaign(root).issues,[]);
 fs.appendFileSync(path.join(base,'src/answer-engine.mjs'),'\n// changed after capture\n');
 assert.ok(auditCampaign(root).issues.some(i=>i.includes('Source snapshot mismatch')));
});
