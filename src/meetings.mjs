import{setTimeout as sleep}from'node:timers/promises';
import{officialHtml,parseMeetings,parseUpcoming,jstDate}from'./discovery.mjs';
import{prepareJraRace}from'./prepare-race.mjs';import{collectInterimOnce}from'./collector.mjs';import{liveWindow}from'./live-window.mjs';import{atomicJson}from'./store.mjs';
export function nextRace(races,now){return races.find(r=>r.sales_close_ms>now)??null;}
export async function watchMeetings({root,store,output,signal}){
 const day=jstDate(),slots=new Map();let lastMenu=0;
 while(!signal?.aborted && jstDate()===day){
  const now=Date.now();
  if(now-lastMenu>300000){try{
   const top=await officialHtml({root,store});const entry=top.match(/doAction\(['"]\/JRADB\/accessO.html['"],\s*['"]([^'"]+)/)?.[1];
   if(!entry)throw Error('Missing odds menu');
   const menus=parseMeetings(await officialHtml({root,store,cname:entry}),day);
   for(const venue of menus)if(!slots.has(venue.venue_code))slots.set(venue.venue_code,{...venue,races:[],lastList:0,config:null,lastPoll:0,error:null});
   lastMenu=now;
  }catch(error){console.error('Menu:',error.message);lastMenu=now-240000;}}
  for(const slot of slots.values()){
   if(Date.now()<(slot.retryAt??0))continue;
   try{
    if(now-slot.lastList>60000){slot.lastList=now;const html=await officialHtml({root,store,cname:slot.cname});if(!html.includes('class="race_num"'))throw Error('Unrecognized race list');slot.races=parseUpcoming(html,day,Date.now());}
    const target=nextRace(slot.races,Date.now());
    if(!target){slot.finished=true;continue;}
    slot.finished=false;
    if(slot.config?.cname!==target.cname || Date.parse(slot.config?.scheduled_start_at)!==Date.parse(target.scheduled_start_at)){slot.config=await prepareJraRace({cname:target.cname,root,store});slot.lastPoll=0;console.log(JSON.stringify({stage:'race_selected',venue:slot.venue,race:slot.config.race_number}));}
    const interval=Date.parse(slot.config.sales_close_at)-Date.now()<=300000?10000:30000;
    if(Date.now()-slot.lastPoll>=interval){const r=await collectInterimOnce({config:slot.config,root,store});slot.lastPoll=Date.now();slot.error=r.ok?null:r.error_message??'取得失敗';}
   }catch(error){slot.error=error.message;slot.retryAt=Date.now()+30000;console.error(slot.venue,error.message);}
  }
  const venues=[...slots.values()].map(s=>({venue:s.venue,venue_code:s.venue_code,finished:!!s.finished,error:s.error,current:s.config?liveWindow(store,s.config):null}));
  atomicJson(output,{schema_version:1,generated_at:new Date().toISOString(),meeting_date:day,markets:[],venues});
  await sleep(2000,undefined,{signal});
 }
}
