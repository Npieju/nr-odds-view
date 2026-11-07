import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {readRaceHeader,rosterNames} from './prepare-race.mjs';
import {liveWindow} from './live-window.mjs';
import {atomicJson} from './store.mjs';

export function archiveRace(root,rows,now=Date.now()) {
 const last=rows.at(-1);
 if(!last)return null;
 const html=new TextDecoder('shift_jis').decode(readFileSync(join(root,'raw',last.raw_hash.slice(0,2),last.raw_hash+'.bin')));
 const race=readRaceHeader(html),close=Date.parse(race.sales_close_at);
 if(race.race_id!==last.race_id)throw Error('Archived race identity mismatch');
 if(now<close)return null;
 const snap=JSON.parse(last.payload);
 const archive=liveWindow({rows:()=>rows},{...race,expected_selections:snap.expected_selections,horse_names:rosterNames(html)},close);
 if(!archive.markets.some(m=>m.observation_count))return null;
 return {...archive,meeting_date:race.meeting_date,venue:race.venue,race_number:race.race_number};
}

export function writeLocalRaceArchive(root,store,config,category) {
 const archive=liveWindow(store,config,Date.parse(config.sales_close_at));
 if(!archive.markets.some(m=>m.observation_count))return;
 const {meeting_date,venue,race_number}=config;
 atomicJson(join(root,category+'-history',meeting_date,config.race_id+'.json'),{...archive,meeting_date,venue,race_number});
}

export async function runArchiveRelay({root,store,url,token,once=false}) {
 const published=new Map();
 do {
  const races=store.db.prepare("SELECT race_id, MAX(id) AS last_id FROM observations WHERE source='jra-web' AND phase='interim' GROUP BY race_id").all();
  for(const {race_id,last_id} of races){
   if(published.get(race_id)===last_id)continue;
   try {
    const rows=store.db.prepare("SELECT * FROM observations WHERE source='jra-web' AND phase='interim' AND race_id=? ORDER BY received_ms,id").all(race_id);
    const archive=archiveRace(root,rows);
    if(!archive)continue;
    const response=await fetch(`${url}/${race_id}`,{method:'PUT',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(archive),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error(`History HTTP ${response.status}`);
    published.set(race_id,last_id);
    console.log(JSON.stringify({stage:'history_sent',race_id}));
   }catch(error){console.error(`History ${race_id}: ${error.message}`);if(once)throw error;}
  }
  if(!once)await sleep(30000);
 }while(!once);
}
