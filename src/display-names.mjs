// A curated set of ordinary, family-friendly words for the game lobby only.
export const DISPLAY_NAMES=Object.freeze([
 'Panda','Cloud','Maple','Otter','Willow','Ocean','Sunny','Pebble',
 'Garden','Robin','Meadow','Kite','Lantern','Forest','Daisy','River',
 'Snow','Star','Candle','Breeze','Pine','Rainbow','Harbor','Fern',
]);

export function nextDisplayName(previous){
 return DISPLAY_NAMES[(DISPLAY_NAMES.indexOf(previous)+1)%DISPLAY_NAMES.length];
}

// Call only from the public game lobby, immediately before joining Rated.
export async function prepareDisplayName(run,tab){
 if(!run.state.rotateDisplayName)return true;
 const queueId=run.state.records.length;
 if(run.namePreparedFor===queueId)return true;
 const field=tab.playwright.getByRole('textbox',{name:'YOUR NAME',exact:true});
 if(!await field.count())return false;
 const name=nextDisplayName(run.state.name);
 await field.fill(name);
 const visible=await tab.playwright.evaluate(expected=>Array.from(document.querySelectorAll('input')).some(input=>!input.disabled&&input.value===expected),name);
 if(!visible)throw new Error('The game lobby display name did not update');
 run.state.name=name;
 run.namePreparedFor=queueId;
 return true;
}
