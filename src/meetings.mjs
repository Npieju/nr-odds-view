import{setTimeout as sleep}from'node:timers/promises';
import{officialHtml,parseMeetings,parseUpcoming,jstDate}from'./discovery.mjs';
import{prepareJraRace}from'./prepare-race.mjs';import{collectInterimOnce}from'./collector.mjs';import{liveWindow}from'./live-window.mjs';import{atomicJson}from'./store.mjs';import{writeLocalRaceArchive}from'./archive.mjs';
export function nextRace(races,now){return [...races].sort((a,b)=>a.sales_close_ms-b.sales_close_ms).find(r=>r.sales_close_ms>now)??null;}
export function refreshVenues(slots,menus){
 const active=new Set(menus.map(v=>v.venue_code));
 for(const code of slots.keys())if(!active.has(code))slots.delete(code);
 for(const venue of menus){
  const slot=slots.get(venue.venue_code);
  if(!slot || slot.cname!==venue.cname)slots.set(venue.venue_code,{...venue,races:[],lastList:-Infinity,config:null,nextPoll:0,error:null});
 }
}
export async function watchMeetings({root,store,output,signal,clock=Date.now,wait=sleep,getHtml=officialHtml,prepare=prepareJraRace,collect=collectInterimOnce,write=atomicJson,intervalMs=10000,localArchive=false}){
 let day=null,lastMenu=-Infinity,lastPublish=-Infinity;const slots=new Map();
 while(!signal?.aborted){
  const now=clock(),today=jstDate(now);
  let changed=false;
  // Midnight is a new discovery cycle, not the end of the collector process.
  if(today!==day){day=today;slots.clear();lastMenu=-Infinity;changed=true;}
  if(now-lastMenu>=300000){try{
   const top=await getHtml({root,store});const entry=top.match(/doAction\(['"]\/JRADB\/accessO.html['"],\s*['"]([^'"]+)/)?.[1];
   if(!entry)throw Error('Missing odds menu');
   refreshVenues(slots,parseMeetings(await getHtml({root,store,cname:entry}),day));
   lastMenu=now;changed=true;
  }catch(error){console.error('Menu:',error.message);lastMenu=now-240000;}}
  const update=async slot=>{
   if(clock()<(slot.retryAt??0))return;
   try{
    if(clock()-slot.lastList>=60000){slot.lastList=clock();const html=await getHtml({root,store,cname:slot.cname});if(!html.includes('class="race_num"'))throw Error('Unrecognized race list');slot.races=parseUpcoming(html,day,clock());}
    const target=nextRace(slot.races,clock());
    const previous=slot.config;
    if(localArchive && previous && previous.cname!==target?.cname &&
       clock()>=Date.parse(previous.sales_close_at) && slot.archived!==previous.race_id){
     writeLocalRaceArchive(root,store,previous,'jra');
     slot.archived=previous.race_id;changed=true;
    }
    if(slot.finished!==!target)changed=true;
    slot.finished=!target;
    if(!target)return;
    if(slot.config?.cname!==target.cname || slot.preparedStart!==target.scheduled_start_at){slot.config=await prepare({cname:target.cname,root,store});slot.preparedStart=target.scheduled_start_at;slot.nextPoll=0;changed=true;console.log(JSON.stringify({stage:'race_selected',venue:slot.venue,race:slot.config.race_number}));}
    const at=clock(),remaining=Date.parse(slot.config.sales_close_at)-at;
    if(remaining>0 && at>=slot.nextPoll){
     slot.nextPoll=at+(remaining<=600000?intervalMs:Math.min(30000,remaining-600000));
     changed=true;
     const r=await collect({config:slot.config,root,store});
     slot.error=r.ok?null:r.error_message??'取得失敗';
     if(!r.ok)slot.nextPoll=Math.max(slot.nextPoll,clock()+([403,429].includes(r.http_status)?60000:10000));
    }
   }catch(error){changed ||= slot.error!==error.message;slot.error=error.message;slot.retryAt=clock()+30000;console.error(slot.venue,error.message);}
  };
  if(intervalMs<10000)await Promise.all([...slots.values()].map(update));
  else for(const slot of slots.values())await update(slot);
  // Do not publish a previous-day snapshot if midnight occurred during a request.
  if(jstDate(clock())!==day)continue;
  if(!changed && clock()-lastPublish<5000 && intervalMs<10000){
   await wait(slots.size?250:15000,undefined,{signal});continue;
  }
  const venues=[...slots.values()].map(s=>({venue:s.venue,venue_code:s.venue_code,finished:!!s.finished,error:s.error,current:s.config?liveWindow(store,s.config,clock()):null}));
  try{
   lastPublish=clock();
   write(output,{schema_version:1,generated_at:new Date(clock()).toISOString(),meeting_date:day,markets:[],venues});
  }catch(error){
   if(!['EPERM','EBUSY','EACCES'].includes(error.code))throw error;
   // A reader or scanner can temporarily block replacement on Windows.
   // Keep collecting and publish the next snapshot after the lock clears.
   console.error('Publish temporarily blocked:',error.code);
  }
  await wait(slots.size?(intervalMs<10000?250:2000):15000,undefined,{signal});
 }
}
