import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {archiveRaw,atomicJson} from './store.mjs';
import {parseJraFinal} from './jra-final.mjs';
import {outcomePath} from './archive.mjs';
import {narUrl,parseNarFinalOdds,verifyNarRaceLink} from './nar.mjs';

const jraOrigin='https://www.jra.go.jp';
const text=html=>html.replace(/<[^>]*>/g,'').replaceAll('&nbsp;',' ').replaceAll('&amp;','&').replaceAll('&#39;',"'").trim();
const rows=html=>[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m=>m[1]);
const cell=(row,name)=>text(row.match(new RegExp('<td\\b[^>]*class="'+name+'(?: [^"]*)?"[^>]*>([\\s\\S]*?)<\\/td>'))?.[1]??'');
const status=new Map([['取消','取消'],['出走取消','取消'],['除外','除外'],['競走除外','除外'],
 ['発走除外','除外'],['中止','中止'],['競走中止','中止'],['失格','失格']]);

function standings(table,fields,expected,winPayout){
 if(!table || !winPayout)throw Error('払戻発表済みの成績待ち');
 const names=new Map(Object.entries(expected)),found=[];
 for(const row of rows(table)){
  const number=cell(row,fields.number);
  if(!number && !/<td\b/.test(row))continue;
  const selection=number.padStart(2,'0'),horse_name=cell(row,fields.horse);
  const place=cell(row,fields.place).replace(/\s/g,'');
  const rank=/^[1-9]\d?$/.test(place)?Number(place):null;
  const finishStatus=rank?'finished':status.get(place);
  if(!/^\d{1,2}$/.test(number) || !names.has(selection) || !horse_name ||
     (names.get(selection) && names.get(selection)!==horse_name) || !finishStatus){
   throw Error('成績の馬番・馬名・着順を照合できません');
  }
  names.delete(selection);
  found.push({selection,horse_name,rank,status:finishStatus});
 }
 if(names.size || !found.some(s=>s.rank===1))throw Error('成績に未取得の着順があります');
 return found;
}

export function parseJraStandings(html,race,expected){
 const title=html.match(/<h1\b[^>]*>(?:(?!<\/h1>)[\s\S])*?レース結果<span class="opt">([^<]+)<\/span>[\s\S]*?<\/h1>/)?.[1];
 if(title!==race.race_label)throw Error('中央の成績が対象レースと一致しません');
 const table=html.match(/<div class="race_result_unit">\s*<table\b[^>]*>([\s\S]*?)<\/table>/)?.[1];
 const payout=html.match(/<li class="win">([\s\S]*?)<\/li>/)?.[1]??'';
 const winPayout=/<div class="yen">\s*[\d,]+\s*<span class="unit">円<\/span>/.test(payout);
 return standings(table,{place:'place',number:'num',horse:'horse'},expected,winPayout);
}

export function parseNarStandings(html,race,expected){
 verifyNarRaceLink(html,race);
 const header=[...html.matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4>/g)]
  .map(m=>text(m[1]).match(/^(\d{4})年(\d{1,2})月(\d{1,2})日.*第(\d{1,2})競走\s*競走成績$/)).find(Boolean);
 if(!header || [header[1],header[2].padStart(2,'0'),header[3].padStart(2,'0')].join('-')!==race.meeting_date ||
    Number(header[4])!==race.race_number)throw Error('地方の成績が対象レースと一致しません');
 const table=html.match(/<section class="gradeTable">\s*<table>([\s\S]*?)<\/table>/)?.[1];
 const payout=html.match(/<section class="(?:newRefundTable|refundTable)">([\s\S]*?)<\/section>/)?.[1]??'';
 const winPayout=rows(payout).some(row=>cell(row,'title')==='単勝' && /^[\d,]+円$/.test(cell(row,'refundMoney')));
 return standings(table,{place:'a',number:'c',horse:'d'},expected,winPayout);
}

function expectedHorses(race){
 return Object.fromEntries(race.markets.flatMap(m=>m.selections.map(s=>[s.selection,s.horse_name])));
}

async function page(url,{root,fetchImpl,signal,clock,encoding='utf-8',body}){
 const started_at=new Date(clock()).toISOString();
 const timeout=AbortSignal.timeout(10000);
 const response=await fetchImpl(url,{...(body?{method:'POST',body}:{}),redirect:'error',
  headers:{'Cache-Control':'no-cache'},signal:signal?AbortSignal.any([signal,timeout]):timeout});
 if(!response.ok)throw Error(`結果取得 HTTP ${response.status}`);
 const raw=new Uint8Array(await response.arrayBuffer()),received_at=new Date(clock()).toISOString();
 return {html:new TextDecoder(encoding).decode(raw),raw_hash:archiveRaw(root,raw),started_at,received_at};
}

export async function collectRaceOutcome(category,race,{root,store,fetchImpl=fetch,signal,clock=Date.now}){
 const options={root,fetchImpl,signal,clock};
 let result,odds,finishes,quotes;
 if(category==='jra'){
  const last=store.raceRows('jra-web',race.race_id,'interim',Date.parse(race.sales_close_at)-1).at(-1);
  if(!last)throw Error('中央の保存済み取得記録がありません');
  const snapshot=JSON.parse(last.payload);
  const attempt=store.db.prepare(`SELECT json_extract(detail,'$.request_cname') AS cname FROM attempts
   WHERE source='jra-web' AND json_extract(detail,'$.raw_hash')=? AND json_extract(detail,'$.request_cname') IS NOT NULL
   ORDER BY id DESC LIMIT 1`).get(last.raw_hash);
  if(!/^[A-Za-z0-9_/.-]{1,160}$/.test(attempt?.cname??''))throw Error('中央のオッズ取得先を確認できません');
  const oddsUrl=jraOrigin+'/JRADB/accessO.html';
  const oddsRequest={...options,encoding:'shift_jis',body:new URLSearchParams({cname:attempt.cname})};
  const discovery=await page(oddsUrl,oddsRequest);
  const link=discovery.html.match(/href="(\/JRADB\/accessS\.html\?CNAME=pw01sde[A-Za-z0-9/]+)"/)?.[1];
  if(!link)throw Error('中央の成績ページ待ち');
  result=await page(jraOrigin+link,{...options,encoding:'shift_jis'});
  const names=expectedHorses(race);
  const expected=Object.fromEntries(snapshot.expected_selections.map(number=>[number,names[number]]));
  finishes=parseJraStandings(result.html,race,expected);
  odds=await page(oddsUrl,oddsRequest);
  const manifest={race_id:race.race_id,race_label:race.race_label,
   roster_evidence:snapshot.roster_evidence,expected_selections:snapshot.expected_selections,
   withdrawn_selections:finishes.filter(s=>s.status==='取消'||s.status==='除外').map(s=>s.selection)};
  quotes=Object.fromEntries(parseJraFinal(odds.html,manifest,odds).map(m=>[m.market,m.quotes]));
 }else{
  const id=race.race_id.match(/^nar-\d{8}-(\d{2})-\d{2}$/);
  if(!id)throw Error('地方の競走IDを確認できません');
  const venue_code=String(Number(id[1])),config={...race,venue_code};
  const url=endpoint=>narUrl(endpoint,race.meeting_date,venue_code,race.race_number);
  result=await page(url('RaceMarkTable'),options);
  finishes=parseNarStandings(result.html,config,expectedHorses(race));
  odds=await page(url('OddsTanFuku'),options);
  config.horse_names=Object.fromEntries(finishes.map(s=>[s.selection,s.horse_name]));
  quotes=parseNarFinalOdds(odds.html,config);
 }
 const withdrawn=new Set(finishes.filter(s=>s.status==='取消'||s.status==='除外').map(s=>s.selection));
 if(Object.values(quotes).some(market=>market.some(q=>(q.status==='withdrawn')!==withdrawn.has(q.selection)))){
  throw Error('成績と最終オッズで取消・除外の状態が一致しません');
 }
 return {race_id:race.race_id,standings:finishes,final_odds:quotes,
  result_received_at:result.received_at,odds_received_at:odds.received_at,
  evidence:{result:result.raw_hash,odds:odds.raw_hash}};
}

function entries(path){
 try{return readdirSync(path,{withFileTypes:true});}
 catch(error){if(error.code==='ENOENT')return [];throw error;}
}

function* pendingArchives(root){
 for(const category of ['jra','nar']){
  const history=join(root,category+'-history');
  for(const date of entries(history).filter(d=>d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name)).reverse()){
   for(const file of entries(join(history,date.name))){
    const id=file.name.slice(0,-5);
    if(!file.isFile() || !file.name.endsWith('.json') || !/^(?:nar-)?\d{8}(?:-\d{2}){2,4}$/.test(id))continue;
    const path=outcomePath(root,category,date.name,id);
    if(existsSync(path))continue;
    yield {category,date:date.name,id,path,archive:join(history,date.name,file.name)};
   }
  }
 }
}

export async function runOutcomeCollector({root,store,signal,once=false,clock=Date.now,fetchImpl=fetch}){
 const retry=new Map();
 let saved=0;
 do{
  for(const job of pendingArchives(root)){
   if(signal?.aborted)return saved;
   const previous=retry.get(job.id);
   if(previous && clock()<previous.at)continue;
   try{
    const race=JSON.parse(readFileSync(job.archive,'utf8'));
    if(race.race_id!==job.id || race.meeting_date!==job.date)throw Error('履歴の競走IDが一致しません');
    const start=Date.parse(race.scheduled_start_at);
    if(!Number.isFinite(start) || clock()<start+120000)continue;
    const outcome=await collectRaceOutcome(job.category,race,{root,store,signal,clock,fetchImpl});
    atomicJson(job.path,outcome);
    saved++;retry.delete(job.id);
    console.log(`結果取得 ${job.id}`);
   }catch(error){
    if(signal?.aborted)return saved;
    const delay=Math.min(900000,2*(previous?.delay??30000));
    retry.set(job.id,{at:clock()+delay,delay,message:error.message});
    if(previous?.message!==error.message)console.error(`結果待ち ${job.id}: ${error.message}`);
   }
   await sleep(500,undefined,{signal});
  }
  if(!once)await sleep(30000,undefined,{signal});
 }while(!once && !signal?.aborted);
 return saved;
}
