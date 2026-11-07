import {setTimeout as sleep} from 'node:timers/promises';
import {archiveRaw,atomicJson} from './store.mjs';
import {jstDate} from './discovery.mjs';
import {nextRace} from './meetings.mjs';
import {liveWindow} from './live-window.mjs';
import {writeLocalRaceArchive} from './archive.mjs';

const base='https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/';
const source='nar-web';
const rateLimited=/HTTP (403|429)/;
const format=t=>new Date(t).toISOString();
const text=html=>html.replace(/<[^>]*>/g,'').replaceAll('&nbsp;',' ').replaceAll('&amp;','&').trim();
const rows=html=>[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m=>m[1]);
const cells=row=>[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m=>text(m[1]));
const dateParam=date=>date.replaceAll('-','/');
const selectionNumber=value=>value.padStart(2,'0');

function narUrl(endpoint,date,code,number){
 const url=new URL(endpoint,base);
 if(date)url.searchParams.set('k_raceDate',dateParam(date));
 if(code)url.searchParams.set('k_babaCode',code);
 if(number)url.searchParams.set('k_raceNo',number);
 return url;
}

export function parseNarMeetings(html,date){
 const venues=new Map();
 if(!html.includes('TodayRaceInfoTop') || !html.includes('本日のレース情報'))throw Error('開催一覧の形式が不明');
 for(const [,href,name] of html.matchAll(/<a href="([^"]*\/RaceList\?[^"]+)" class="courseName[^"]*"[^>]*>([^<]+)<\/a>/g)){
  const params=new URL(href.replaceAll('&amp;','&'),base).searchParams;
  const code=params.get('k_babaCode');
  if(params.get('k_raceDate')===dateParam(date) && /^\d{1,2}$/.test(code))venues.set(code,{venue_code:code,venue:text(name)});
 }
 return [...venues.values()];
}

export function parseNarRaces(html,date,{venue_code,venue}){
 if(!html.includes('class="raceTable"') || !html.includes('当日メニュー'))throw Error('発走一覧の形式が不明');
 const races=[];
 for(const row of rows(html)){
  const [number,time,change,,name]=cells(row);
  if(!/^\d{1,2}R$/.test(number??'') || /中止|取りやめ/.test(change??''))continue;
  const link=row.match(/\/KeibaWeb\/TodayRaceInfo\/OddsTanFuku\?([^\s"'<>]+)/);
  if(!link)continue;
  const params=new URLSearchParams(link[1].replaceAll('&amp;','&'));
  const race_number=Number(number.slice(0,-1));
  if(params.get('k_raceDate')!==dateParam(date) || params.get('k_babaCode')!==venue_code ||
     Number(params.get('k_raceNo'))!==race_number || !/^\d{1,2}:\d{2}$/.test(time))throw Error('競走一覧の照合に失敗');
  const start=Date.parse(`${date}T${time.padStart(5,'0')}:00+09:00`);
  const close=start-120000;
  races.push({venue,venue_code,source,meeting_date:date,race_number,
   race_id:`nar-${date.replaceAll('-','')}-${selectionNumber(venue_code)}-${selectionNumber(String(race_number))}`,
   race_label:`${venue} ${number} ${name}`,scheduled_start_at:format(start),sales_close_at:format(close),
   sales_close_ms:close,sales_channel:'楽天競馬の通常規則（発走2分前）',close_basis:'scheduled_rule_not_observed'});
 }
 return races;
}

function verifyRaceHeader(html,config){
 const header=html.match(/<h4\b[^>]*>\s*(\d{4})年(\d{1,2})月(\d{1,2})日[^<]*?第(\d{1,2})競走\s*(\d{1,2}:\d{2})発走\s*<\/h4>/);
 if(!header)throw Error('競走ヘッダーが不明');
 const [,year,month,day,race,time]=header;
 const date=`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
 const start=Date.parse(`${date}T${time.padStart(5,'0')}:00+09:00`);
 if(date!==config.meeting_date || Number(race)!==config.race_number || start!==Date.parse(config.scheduled_start_at)){
  throw Error('競走または予定発走が変更されました');
 }
 const list=html.match(/<a id="RaceList" href="[^"]*\/RaceList\?([^"]+)"/)?.[1];
 const params=new URLSearchParams(list?.replaceAll('&amp;','&'));
 if(params.get('k_babaCode')!==config.venue_code || params.get('k_raceDate')!==dateParam(date) ||
    Number(params.get('k_raceNo'))!==config.race_number)throw Error('競馬場の照合に失敗');
}

export function parseNarRoster(html,config){
 verifyRaceHeader(html,config);
 const names={};
 for(const row of rows(html)){
  const number=row.match(/<td\b[^>]*class="horseNum"[^>]*>\s*(\d{1,2})\s*<\/td>/)?.[1];
  if(!number)continue;
  const name=row.match(/<a\b[^>]*class="horseName"[^>]*>([\s\S]*?)<\/a>/)?.[1];
  const selection=selectionNumber(number);
  if(!name || names[selection])throw Error('出馬表の馬番・馬名が不明');
  names[selection]=text(name);
 }
 if(!Object.keys(names).length)throw Error('出馬表が取得できません');
 return names;
}

export function parseNarOdds(html,config,attempt){
 verifyRaceHeader(html,config);
 const current=html.match(/<h4 class="odd_title">\s*単勝・複勝\s*オッズ\s*（(\d{1,2}:\d{2})\s*現在）\s*<\/h4>/);
 if(!current)throw Error('発売中の時刻付き単複オッズがありません');
 const table=html.match(/<table class="odd_popular_table_02">([\s\S]*?)<\/table>/)?.[1];
 if(!table || !table.includes('<th>馬番</th>'))throw Error('単複テーブルの形式が不明');
 const source_time=`${config.meeting_date}T${current[1].padStart(5,'0')}:00+09:00`;
 const published=Date.parse(source_time),received=Date.parse(attempt.received_at);
 if(!Number.isFinite(published) || published>received || received>=config.sales_close_ms)throw Error('発表時刻または締切を照合できません');
 const expected_selections=Object.keys(config.horse_names);
 const quotes={win:[],place:[]},seen=new Set();
 const odds=/^\d+(?:\.\d+)?$/;
 for(const row of rows(table)){
  const parts=cells(row);
  if(!parts.length)continue;
  const [,number,name,win,low,high]=parts;
  const selection=selectionNumber(number??'');
  if(!/^\d{1,2}$/.test(number??'') || !name || config.horse_names[selection]!==name || seen.has(selection))throw Error('出馬表とオッズの馬番・馬名が不一致');
  seen.add(selection);
  const placeLow=low?.replace(/[-－]$/,'').trim();
  const withdrawn=parts.slice(6).some(value=>/出走取消|競走除外|発走除外/.test(value));
  for(const [market,a,b] of [['win',win,win],['place',placeLow,high]]){
   if(withdrawn){quotes[market].push({selection,status:'withdrawn',low:null,high:null});continue;}
   if(!odds.test(a??'') || !odds.test(b??''))throw Error('未確認のオッズ表示');
   quotes[market].push({selection,status:'active',low:Number(a),high:Number(b)});
  }
 }
 if(seen.size!==expected_selections.length)throw Error('オッズに欠落した馬番があります');
 return Object.entries(quotes).map(([market,values])=>({
  source,race_id:config.race_id,market,phase:'interim',source_time,time_precision:'minute',
  received_at:attempt.received_at,request_started_at:attempt.started_at,expected_selections,quotes:values
 }));
}

async function getNar(url,clock,fetchImpl){
 const began=clock(),response=await fetchImpl(url,{headers:{'Cache-Control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(5000)});
 const raw=new Uint8Array(await response.arrayBuffer());
 const ended=clock();
 if(!response.ok)throw Error(`地方競馬情報サイト HTTP ${response.status}`);
 return {raw,html:new TextDecoder('utf-8').decode(raw),started_at:format(began),received_at:format(ended),
  elapsed_ms:ended-began,cache_age:response.headers.get('age')};
}

async function collectNar({config,root,store,clock,fetchImpl}){
 const url=narUrl('OddsTanFuku',config.meeting_date,config.venue_code,config.race_number);
 const began=clock();
 let attempt={source,started_at:format(began),race_id:config.race_id};
 try{
  const {html,raw,...clocks}=await getNar(url,clock,fetchImpl);
  attempt={...attempt,...clocks,raw_hash:archiveRaw(root,raw)};
  const snapshots=parseNarOdds(html,config,attempt);
  store.db.exec('BEGIN');
  try{
   for(const snapshot of snapshots)store.ingest(snapshot,raw);
   store.db.exec('COMMIT');
  }catch(error){store.db.exec('ROLLBACK');throw error;}
  store.attempt({...attempt,ok:true,source_time:snapshots[0].source_time});
 }catch(error){
  store.attempt({received_at:format(clock()),...attempt,ok:false,error_message:error.message});
  throw error;
 }
}

// Give the shortest remaining sales window the fast lane. At most one venue
// uses it, even when several venues are inside the final five minutes.
export function narFastVenue(races,now){
 const target=nextRace(races,now);
 return target && target.sales_close_ms-now<=300000?target.venue_code:null;
}

export async function watchNar({root,store,output,signal,clock=Date.now,fetchImpl=fetch,
 intervalMs=10000,finalIntervalMs=intervalMs,wait=sleep,write=atomicJson}){
 const venues=new Map(),pending=new Set();
 const fast=finalIntervalMs<intervalMs;
 let day=null,nextMenu=0,sourceError=null,lastPublish=-Infinity,changed=true;
 let menuTask=null,fastResumeAt=0;

 function track(promise){
  pending.add(promise);
  promise.finally(()=>pending.delete(promise)).catch(()=>{});
  return promise;
 }

 async function refreshMenu(today,started){
  try{
   const menu=await getNar(narUrl('TodayRaceInfoTop'),clock,fetchImpl);
   if(day!==today || signal?.aborted)return;
   const discovered=parseNarMeetings(menu.html,today);
   const active=new Set(discovered.map(venue=>venue.venue_code));
   for(const code of venues.keys())if(!active.has(code))venues.delete(code);
   for(const venue of discovered){
    if(!venues.has(venue.venue_code))venues.set(venue.venue_code,{...venue,races:null,nextList:0,lastPoll:-Infinity,pollRetryAt:0});
   }
   nextMenu=started+300000;sourceError=null;changed=true;
  }catch(error){
   changed ||= sourceError!==error.message;
   const limited=rateLimited.test(error.message);
   if(limited)fastResumeAt=Math.max(fastResumeAt,clock()+60000);
   sourceError=error.message;nextMenu=started+(limited?60000:30000);
   console.error('地方開催一覧',sourceError);
  }
 }

 async function update(slot,today){
  try{
   if(clock()>=slot.nextList){
    slot.nextList=clock()+30000;
    const schedule=await getNar(narUrl('RaceList',today,slot.venue_code),clock,fetchImpl);
    slot.races=parseNarRaces(schedule.html,today,slot);
    slot.nextList=clock()+60000;
   }
   if(!slot.races || signal?.aborted || day!==today)return;
   const race=nextRace(slot.races,clock());
   changed ||= slot.finished!==!race;
   slot.finished=!race;
   const previous=slot.config;
   if(previous && previous.race_id!==race?.race_id && clock()>=previous.sales_close_ms && slot.archived!==previous.race_id){
    writeLocalRaceArchive(root,store,previous,'nar');
    slot.archived=previous.race_id;
   }
   if(previous && previous.race_id!==race?.race_id && clock()<previous.sales_close_ms)slot.config=null;
   if(!race){slot.error=null;return;}
   if(previous?.race_id!==race.race_id || previous.sales_close_ms!==race.sales_close_ms){
    const deba=await getNar(narUrl('DebaTable',today,slot.venue_code,race.race_number),clock,fetchImpl);
    slot.config={...race,horse_names:parseNarRoster(deba.html,race)};
    slot.config.expected_selections=Object.keys(slot.config.horse_names);
    slot.lastPoll=-Infinity;changed=true;
   }
   const at=clock(),remaining=race.sales_close_ms-at;
   const priority=priorityVenue(at)===slot.venue_code;
   const interval=priority?finalIntervalMs:intervalMs;
   if(!signal?.aborted && day===today && remaining>0 && remaining<=600000 &&
      at>=Math.max(slot.lastPoll+interval,slot.pollRetryAt)){
    slot.lastPoll=at;
    await collectNar({config:slot.config,root,store,clock,fetchImpl});
    slot.error=null;changed=true;
   }
  }catch(error){
   changed ||= slot.error!==error.message;
   slot.error=error.message;
   const limited=rateLimited.test(error.message),retryAt=clock()+(limited?60000:10000);
   slot.pollRetryAt=Math.max(slot.pollRetryAt,retryAt);
   if(limited)fastResumeAt=Math.max(fastResumeAt,retryAt);
   if(/予定発走/.test(error.message))slot.nextList=Math.min(slot.nextList,clock()+10000);
   console.error('地方 '+slot.venue,slot.error);
  }
 }

 function priorityVenue(now){
  if(!fast || now<fastResumeAt)return null;
  return narFastVenue([...venues.values()].flatMap(slot=>nextRace(slot.races??[],now)??[]),now);
 }

 try{
  while(!signal?.aborted){
   const now=clock(),today=jstDate(now);
   if(day!==today){day=today;nextMenu=0;venues.clear();changed=true;}
   if(!menuTask && now>=nextMenu)menuTask=track(refreshMenu(today,now).finally(()=>{menuTask=null;}));
   for(const slot of venues.values()){
    if(!slot.task)slot.task=track(update(slot,today).finally(()=>{slot.task=null;}));
   }
   if(changed || now-lastPublish>=5000){
    const priority=priorityVenue(now);
    const state=[...venues.values()].map(({venue,venue_code,finished,error,config})=>({
     venue,venue_code,finished:!!finished,error:error??null,
     poll_interval_ms:venue_code===priority?finalIntervalMs:intervalMs,
     current:config?{...liveWindow(store,config,now),race_number:config.race_number}:null
    }));
    try{
     write(output,{schema_version:1,generated_at:format(now),meeting_date:day,source_error:sourceError,markets:[],venues:state});
     changed=false;lastPublish=now;
    }catch(error){
     if(!['EPERM','EBUSY','EACCES'].includes(error.code))throw error;
     console.error('地方ライブJSON更新待ち',error.code);
    }
   }
   await wait(venues.size?(fast?100:intervalMs<10000?250:1000):1000,undefined,{signal});
  }
 }finally{
  await Promise.allSettled(pending);
 }
}
