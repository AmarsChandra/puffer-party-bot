export function advanceTauntRound(state,key){
 const schedule=state.tauntSchedule??={rounds:0,key:null,lastUsed:null};
 if(schedule.key!==key){schedule.rounds++;schedule.key=key;}
 return schedule.rounds;
}

export function tauntDue(state){
 const s=state.tauntSchedule;
 const interval=Number.isSafeInteger(state.tauntEveryRounds)&&state.tauntEveryRounds>0?state.tauntEveryRounds:5;
 return !!s&&s.rounds>0&&s.rounds%interval===0&&s.lastUsed!==s.rounds;
}

export function consumeTaunt(state){
 if(state.tauntSchedule)state.tauntSchedule.lastUsed=state.tauntSchedule.rounds;
}
