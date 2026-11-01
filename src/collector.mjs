import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { probeJra } from './probe.mjs';
import { parseJraInterim } from './jra-interim.mjs';
import { atomicJson } from './store.mjs';
import { liveWindow } from './live-window.mjs';

export function validateLiveConfig(c) {
 const zoned=t=>typeof t==='string' && /(Z|[+-]\d{2}:\d{2})$/.test(t) && Number.isFinite(Date.parse(t));
 if(!zoned(c.sales_close_at) || !zoned(c.scheduled_start_at) || Date.parse(c.sales_close_at)>=Date.parse(c.scheduled_start_at)) throw Error('Explicit sales close and scheduled start required');
 if(!c.sales_channel || !c.close_evidence || !c.roster_evidence || !c.race_label || !/^[A-Za-z0-9_-]{1,80}$/.test(c.race_id??'')) throw Error('Race, roster and channel-specific close evidence required');
 if(!/^[A-Za-z0-9_/.-]{1,160}$/.test(c.cname??'') || !Array.isArray(c.expected_selections) || !c.expected_selections.length || new Set(c.expected_selections).size!==c.expected_selections.length || c.expected_selections.some(s=>!/^\d{2}$/.test(s))) throw Error('CNAME and independent roster required');
 for(const [key,minimum,maximum] of [['interval_ms',5000,60000],['max_age_ms',1000,300000],['max_gap_ms',5000,300000]]) if(c[key]!==undefined && (!Number.isFinite(c[key]) || c[key]<minimum || c[key]>maximum)) throw Error('Invalid '+key);
 return c;
}

export async function collectInterimOnce({config,root,store,fetchImpl}) {
 const attempt=await probeJra({cname:config.cname,root,store,fetchImpl});
 if(!attempt.ok) return attempt;
 try {
  if(Date.parse(attempt.received_at)>=Date.parse(config.sales_close_at)) throw Error('Receipt after sales close');
  const raw=readFileSync(join(root,'raw',attempt.raw_hash.slice(0,2),attempt.raw_hash+'.bin'));
  const snapshots=parseJraInterim(new TextDecoder('shift_jis').decode(raw),config,attempt);
  store.db.exec('BEGIN');
  try{for(const s of snapshots) store.ingest(s,raw);store.db.exec('COMMIT');}catch(error){store.db.exec('ROLLBACK');throw error;}
  const result={...attempt,stage:'normalized_interim'};store.attempt(result);return result;
 } catch(error){const result={...attempt,ok:false,stage:'parse_rejected',error_message:error.message};store.attempt(result);return result;}
}

export async function watchJra({config,root,store,output,signal,onUpdate=()=>{},now=Date.now,wait=sleep,collect=collectInterimOnce}) {
 validateLiveConfig(config);
 const close=Date.parse(config.sales_close_at), start=close-300000, interval=config.interval_ms??10000;
 if(now()>=close) throw Error('Sales already closed; collector not started');
 if(start-now()>3600000) throw Error('Start collector within one hour of the five-minute window');
 let failures=0;
 const publish=()=>{const state=liveWindow(store,config,now());atomicJson(output,state);onUpdate(state);};
 publish();
 while(!signal?.aborted && now()<close){
  if(now()<start){await wait(Math.min(1000,start-now()),undefined,{signal});publish();continue;}
  const began=now();
  const result=await collect({config,root,store});failures=result.ok?0:failures+1;
  publish();
  console.log(JSON.stringify({received_at:result.received_at,ok:result.ok,stage:result.stage,error:result.error_message}));
  const delay=Math.min(close-now(),Math.max(1000,interval*Math.min(8,2**failures)-(now()-began)));
  if(delay>0) await wait(delay,undefined,{signal});
 }
 publish();
}
