import fs from 'node:fs';
import {playRatedMatch} from './browser-driver.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Each worker refills independently; no worker waits for a batch of results.
// Keep this entire promise awaited inside one browser-tool execution.
export async function playRatedPool(lanes,{
 controlPath=null,shouldStop=()=>false,onStatus=()=>{},onMatch=()=>{},
 recoverLane=null,retireLane=null,playMatch=playRatedMatch,perMatchSeconds=Infinity,
 queueWaitSeconds=120,maxObservationGapMs=2500,betweenMatchMs=1000,
 idleMs=250,statusIntervalMs=30000,
}={}){
 if(!lanes.length||new Set(lanes.map(l=>l.run.root)).size!==lanes.length||new Set(lanes.map(l=>l.tab.id??l.tab)).size!==lanes.length||new Set(lanes.map(l=>l.engine)).size!==lanes.length)throw new Error('Pool needs distinct runs, tabs and engines');
 const slots=lanes.map((lane,index)=>({...lane,index,phase:'waiting',failed:false,queueStarted:0,slowObservations:0,restart:false,errors:0}));
 const roomClaims=new Map();let mode=slots.length,single=0,fallbackReason=null,lease=null,stopping=false,lastControl=0,lastStatus=0;
 for(const slot of slots){
  // Continuous play is not limited by an old per-table streak target.
  slot.run.state.target=Number.MAX_SAFE_INTEGER;
  const room=slot.run.state.active?.room;
  if(room){if(roomClaims.has(room))throw new Error('Pool already contains duplicate rooms');roomClaims.set(room,slot.run.root);}
 }
 const stopped=()=>{
  if(stopping)return true;
  if(shouldStop())stopping=true;
  if(controlPath&&Date.now()-lastControl>=200){
   lastControl=Date.now();
   try{const control=JSON.parse(fs.readFileSync(controlPath,'utf8'));if(control.stop===true||control.continue===false)stopping=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return stopping;
 };
 const enabled=slot=>mode>1||slot.index===single;
 const publish=(force=false)=>{
  if(!force&&Date.now()-lastStatus<statusIntervalMs)return;
  lastStatus=Date.now();onStatus({status:stopping?'stopping':'running',mode,retainedSlot:mode===1?single+1:null,fallbackReason,updatedAt:new Date().toISOString(),slots:slots.map(s=>({slot:s.index+1,tabId:s.tab.id,phase:s.phase,room:s.run.state.active?.room??null,typed:s.run.naturalTypingObserved===true,submitted:!!s.run.lastSubmit,lastObservedAt:s.run.lastObservedAt??null,error:s.error??null}))});
 };
 const fallback=(reason,failedSlot=null)=>{
  if(mode===1)return;
  single=(slots.find(s=>s!==failedSlot&&!s.failed&&s.run.state.active)??slots.find(s=>s!==failedSlot&&!s.failed)??slots[0]).index;
  mode=1;fallbackReason=reason;lease=null;publish(true);
 };
 const canQueue=slot=>{
  if(stopped()||!enabled(slot))return false;
  if(lease&&(lease.run.state.active||lease.failed||lease.phase==='finished'))lease=null;
  if(!lease)lease=slot;
  if(lease!==slot)return false;
  slot.queueStarted||=Date.now();slot.phase='queuing';return true;
 };
 const observe=slot=>{
  if(slot.run.state.active){slot.phase=enabled(slot)?'playing':'draining';slot.queueStarted=0;if(lease===slot)lease=null;}
  if(slot.run.state.active&&slot.run.lastObservationGapMs>maxObservationGapMs)slot.slowObservations++;else slot.slowObservations=0;
  if(slot.slowObservations>=3)fallback('Repeated browser delays during active games');
  if(slot.queueStarted&&Date.now()-slot.queueStarted>queueWaitSeconds*1000){slot.restart=true;fallback('A rated slot could not enter a game',slot);}
  publish();
 };
 publish(true);
 const worker=async slot=>{
  while(!stopped()){
   if(!enabled(slot)&&!slot.run.state.active){
    slot.phase='parked';slot.engine.pauseGeneration?.();
    const collision=/same room ([A-Z]{4})/.exec(slot.error??'')?.[1];
    const owner=collision&&slots.find(s=>s.run.root===roomClaims.get(collision));
    if(retireLane&&!slot.retired&&(!collision||owner?.run.state.active?.room!==collision)){await retireLane(slot);slot.retired=true;slot.phase='retired';}
    publish();await sleep(idleMs);continue;
   }
   slot.phase=slot.run.state.active?'playing':'waiting';slot.restart=false;slot.queueStarted=0;
   try{
    const result=await playMatch(slot.run,slot.tab,slot.engine,{
     maxSeconds:perMatchSeconds,roomClaims,canQueue:()=>canQueue(slot),
     shouldStop:()=>stopped()||slot.restart||!enabled(slot)&&!slot.run.state.active,
     onObservation:()=>observe(slot),
    });
    slot.phase='finished';if(lease===slot)lease=null;slot.engine.pauseGeneration?.();
    if(result.record){await onMatch(result.record,slot.index);slot.errors=0;}
    if(stopped())break;
    if(result.record?.outcome==='inconclusive')fallback('An active game ended without a verified result',slot);
    if(slot.restart||!result.record&&enabled(slot)){
     fallback('A rated slot stopped without a match result',slot);
     if(recoverLane&&enabled(slot)){await recoverLane(slot);slot.queueStarted=0;}
    }
    publish(true);await sleep(betweenMatchMs);
   }catch(error){
    if(stopped())break;
    slot.error=String(error.message??error);slot.errors++;slot.failed=true;
    fallback(slot.error,slot);if(lease===slot)lease=null;publish(true);
    // A failing extra slot does not queue again. Try to finish its existing
    // game once, while the healthy retained slot keeps running.
    if(slot.run.state.active&&slot.errors<2){await sleep(idleMs);continue;}
    if(slot.run.state.active){
     const record={...slot.run.state.active,outcome:'inconclusive',finishedAt:new Date().toISOString(),reason:slot.error};
     slot.run.state.records.push(record);slot.run.state.active=null;slot.run.state.current=0;
     fs.writeFileSync(slot.run.root+'/run.json',JSON.stringify(slot.run.state,null,2));await onMatch(record,slot.index);
    }
    if(recoverLane&&enabled(slot)){try{await recoverLane(slot);slot.failed=false;}catch(recoveryError){slot.error=String(recoveryError.message??recoveryError);}}
    if(slot.index===single&&slot.failed){stopping=true;throw new Error('The retained rated tab needs recovery: '+slot.error);}
    await sleep(idleMs);
   }
  }
  slot.phase='stopped';slot.engine.pauseGeneration?.();publish(true);
 };
 const settled=await Promise.allSettled(slots.map(worker));
 const errors=settled.filter(r=>r.status==='rejected').map(r=>String(r.reason?.message??r.reason));
 return {status:errors.length?'error':'stopped',mode,fallbackReason,errors};
}
