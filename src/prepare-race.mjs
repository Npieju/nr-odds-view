import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { probeJra } from './probe.mjs';
import { archiveRaw } from './store.mjs';

export function rosterSelections(html) {
 return [...html.matchAll(/<td class="num">([\s\S]*?)<\/td>/g)]
  .map(m=>m[1].replace(/<[^>]+>/g,'').trim())
  .map(n=>{if(!/^\d{1,2}$/.test(n))throw Error('Ambiguous roster number');return n.padStart(2,'0');});
}

// Prepare only JRA ordinary-race, same-day configs for the documented 即PAT rule.
// Scheduled close is explicitly inferred, never an observed acceptance state.
export async function prepareJraRace({cname,root,store,fetchImpl=fetch}) {
 const attempt=await probeJra({cname,root,store,fetchImpl});
 if(!attempt.ok)throw Error('Unable to fetch odds page');
 const raw=readFileSync(join(root,'raw',attempt.raw_hash.slice(0,2),attempt.raw_hash+'.bin'));
 const html=new TextDecoder('shift_jis').decode(raw);
 const label=html.match(/単勝・複勝オッズ（馬番順）<span class="opt">([^<]+)<\/span>/)?.[1];
 const identity=label?.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日（.曜）(\d+)回(東京|京都|福島|中山|阪神|新潟|中京|小倉|札幌|函館)(\d+)日 (\d+)レース$/);
 const clock=html.match(/発走時刻：<strong>(\d{1,2})時(\d{2})分<\/strong>/);
 const rosterPath=html.match(/href="(\/JRADB\/accessD\.html\?CNAME=[A-Za-z0-9_/.-]+)"/)?.[1];
 if(!identity || !clock || !rosterPath)throw Error('Unrecognized race identity, start or roster link');
 const [,year,month,day,meeting,venue,meetingDay,race]=identity;
 const date=`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
 const scheduled_start_at=`${date}T${clock[1].padStart(2,'0')}:${clock[2]}:00+09:00`;
 const start=Date.parse(scheduled_start_at);
 if(!Number.isFinite(start) || start<=Date.now())throw Error('Race is not upcoming');
 const rosterStarted=new Date().toISOString();
 const response=await fetchImpl('https://www.jra.go.jp'+rosterPath,{signal:AbortSignal.timeout(15000),redirect:'error'});
 const bytes=new Uint8Array(await response.arrayBuffer()),received_at=new Date().toISOString(),raw_hash=archiveRaw(root,bytes);
 const roster=new TextDecoder('shift_jis').decode(bytes);
 store.attempt({source:'jra-roster',started_at:rosterStarted,received_at,ok:response.ok,raw_hash,stage:'raw_only',http_status:response.status});
 if(!response.ok || !roster.includes(`<span class="opt">${label}</span>`))throw Error('Independent roster race mismatch');
 const expected_selections=rosterSelections(roster);
 if(!expected_selections.length || expected_selections.length>18 || new Set(expected_selections).size!==expected_selections.length)throw Error('Ambiguous roster');
 const codes={札幌:'01',函館:'02',福島:'03',新潟:'04',東京:'05',中山:'06',中京:'07',京都:'08',阪神:'09',小倉:'10'};
 return {race_id:`${date.replaceAll('-','')}-${codes[venue]}-${meeting.padStart(2,'0')}-${meetingDay.padStart(2,'0')}-${race.padStart(2,'0')}`,race_label:label,cname,expected_selections,
  roster_evidence:{url:'https://www.jra.go.jp'+rosterPath,raw_hash,received_at},
  sales_channel:'即PAT（通常締切規則での観測）',close_basis:'scheduled_rule_not_observed',
  close_evidence:{url:'https://www.jra.go.jp/dento/soku/instructions/hatsubai/jra.html',rule:'予定発走1分前。投票受付状態の実測ではない'},
  sales_close_at:new Date(start-60000).toISOString(),scheduled_start_at,interval_ms:10000,max_age_ms:90000,max_gap_ms:30000};
}
