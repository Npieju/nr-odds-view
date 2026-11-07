import{setTimeout as sleep}from'node:timers/promises';
import{officialHtml,parseMeetings,parseUpcoming,jstDate}from'./discovery.mjs';
import{prepareJraRace}from'./prepare-race.mjs';import{collectInterimOnce}from'./collector.mjs';import{liveWindow}from'./live-window.mjs';import{atomicJson}from'./store.mjs';
export function nextRace(races,now){return [...races].sort((a,b)=>a.sales_close_ms-b.sales_close_ms).find(r=>r.sales_close_ms>now)??null;}
export function refreshVenues(slots,menus){
 const active=new Set(menus.map(v=>v.venue_code));
 for(const code of slots.keys())if(!active.has(code))slots.delete(code);
 for(const venue of menus){
  const slot=slots.get(venue.venue_code);
  if(!slot || slot.cname!==venue.cname)slots.set(venue.venue_code,{...venue,races:[],lastList:-Infinity,config:null,lastPoll:0,error:null});
 }
}
export async function watchMeetings({root,store,output,signal,clock=Date.now,wait=sleep,getHtml=officialHtml,prepare=prepareJraRace,collect=collectInterimOnce,write=atomicJson}){
 let day=null,lastMenu=-Infinity;const slots=new Map();
 while(!signal?.aborted){
  const now=clock(),today=jstDate(now);
  // Midnight is a new discovery cycle, not the end of the collector process.
  if(today!==day){day=today;slots.clear();lastMenu=-Infinity;}
  if(now-lastMenu>=300000){try{
   const top=await getHtml({root,store});const entry=top.match(/doAction\(['"]\/JRADB\/accessO.html['"],\s*['"]([^'"]+)/)?.[1];
   if(!entry)throw Error('Missing odds menu');
   refreshVenues(slots,parseMeetings(await getHtml({root,store,cname:entry}),day));
   lastMenu=now;
  }catch(error){console.error('Menu:',error.message);lastMenu=now-240000;}}
  for(const slot of slots.values()){
   if(clock()<(slot.retryAt??0))continue;
   try{
    if(clock()-slot.lastList>=60000){slot.lastList=clock();const html=await getHtml({root,store,cname:slot.cname});if(!html.includes('class="race_num"'))throw Error('Unrecognized race list');slot.races=parseUpcoming(html,day,clock());}
    const target=nextRace(slot.races,clock());
    if(!target){slot.finished=true;continue;}
    slot.finished=false;
    if(slot.config?.cname!==target.cname || slot.preparedStart!==target.scheduled_start_at){slot.config=await prepare({cname:target.cname,root,store});slot.preparedStart=target.scheduled_start_at;slot.lastPoll=0;console.log(JSON.stringify({stage:'race_selected',venue:slot.venue,race:slot.config.race_number}));}
    const interval=Date.parse(slot.config.sales_close_at)-clock()<=600000?10000:30000;
    if(clock()-slot.lastPoll>=interval){const r=await collect({config:slot.config,root,store});slot.lastPoll=clock();slot.error=r.ok?null:r.error_message??'取得失敗';}
   }catch(error){slot.error=error.message;slot.retryAt=clock()+30000;console.error(slot.venue,error.message);}
  }
  // Do not publish a previous-day snapshot if midnight occurred during a request.
  if(jstDate(clock())!==day)continue;
  const venues=[...slots.values()].map(s=>({venue:s.venue,venue_code:s.venue_code,finished:!!s.finished,error:s.error,current:s.config?liveWindow(store,s.config,clock()):null}));
  write(output,{schema_version:1,generated_at:new Date(clock()).toISOString(),meeting_date:day,markets:[],venues});
  await wait(slots.size?2000:15000,undefined,{signal});
 }
}
