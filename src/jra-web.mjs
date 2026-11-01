import { performance } from 'node:perf_hooks';
import { archiveRaw,validateSnapshot } from './store.mjs';
import { actionLinks } from './probe.mjs';

const venues={'札幌':'01','函館':'02','福島':'03','新潟':'04','東京':'05','中山':'06','中京':'07','京都':'08','阪神':'09','小倉':'10'};
const pad=v=>String(v).padStart(2,'0');
const text=s=>s.replace(/<script\b[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ')
  .replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,v)=>String.fromCodePoint(+v)).replace(/\s+/g,' ').trim();
const hasClass=(attrs,name)=>new RegExp(`\\bclass\\s*=\\s*["'][^"']*\\b${name}\\b[^"']*["']`,'i').test(attrs);
function cells(row) { return [...row.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)].map(m=>({attrs:m[2],value:text(m[3])})); }
const need=(v,message)=>{if(!v)throw new Error(message);return v;};

// Deliberately narrow to the observed official tanpuku table; fail closed on redesign.
export function parseJraTanpuku(html,config,clocks) {
  need(config && /^\d{16}$/.test(config.race_id),'Full race_id required');
  need(config.roster_evidence && Array.isArray(config.expected_selections) && config.expected_selections.length,'Independent race-card roster and evidence required');
  need(!/パラメータエラー|ご指定のページに接続できません|アクセス集中/.test(text(html)),'Official error page');
  const date=need(html.match(/class=["'][^"']*\bdate["'][^>]*>([\s\S]*?)<\/div>/i),'Race date missing');
  const d=need(text(date[1]).match(/(\d{4})年(\d+)月(\d+)日.*?(\d+)回(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉)(\d+)日/),'Race identity missing');
  const raceAlt=need(html.match(/class=["']race_number["'][\s\S]*?alt=["']([^"']+)["']/),'Race number image missing');
  const race=need(text(raceAlt[1]).match(/^(\d+)レース$/),'Race number missing');
  const race_id=d[1]+pad(d[2])+pad(d[3])+venues[d[5]]+pad(d[4])+pad(d[6])+pad(race[1]);
  need(race_id===config.race_id,'Official page race identity mismatch');
  const refresh=need(html.match(/class=["']refresh_line["'][^>]*>([\s\S]*?)<\/div>/i),'Odds refresh marker missing');
  const marker=text(refresh[1]);
  let phase,source_time=null;
  if (/最終オッズ/.test(marker)) phase='final';
  else if (/確定オッズ/.test(marker)) phase='confirmed';
  else {
    const stamp=need(marker.match(/(?:(\d+)月(\d+)日\s*)?(\d{1,2})時(\d{1,2})分\s*現在/),'Unrecognized odds phase/time marker');
    phase='interim';
    if (!stamp[1]) {
      const receiptDate=new Date(Date.parse(clocks.received_at)+9*3600000).toISOString().slice(0,10);
      need(receiptDate===`${d[1]}-${pad(d[2])}-${pad(d[3])}`,'Time-only advance-sale date is ambiguous');
    }
    // A time-only stamp is assigned the explicit race date, never the HTTP date.
    // Advance-sales pages with a different date must carry it in the marker.
    source_time=`${d[1]}-${pad(stamp[1]??d[2])}-${pad(stamp[2]??d[3])}T${pad(stamp[3])}:${pad(stamp[4])}:00+09:00`;
    need(Number.isFinite(Date.parse(source_time)) && new Date(Date.parse(source_time)+9*3600000).toISOString().slice(0,16)===source_time.slice(0,16),'Invalid source clock');
  }
  const tables=[...html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)].filter(m=>hasClass(m[1],'tanpuku'));
  need(tables.length===1,'Unique tanpuku table required');
  const quotes={win:[],place:[]};
  for(const row of tables[0][2].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cs=cells(row[1]);
    if(!cs.some(c=>hasClass(c.attrs,'odds_tan')) || /<th\b/i.test(row[1])) continue;
    const select=name=>need(cs.find(c=>hasClass(c.attrs,name)),`Missing ${name} cell`).value;
    const horse=select('num');need(/^\d{1,2}$/.test(horse),'Invalid horse number');
    const selection=pad(horse);
    for(const [market,css] of [['win','odds_tan'],['place','odds_fuku']]) {
      const value=select(css);let status='active',low=null,high=null,lower_bound=false;
      if (/^(取消|除外)$/.test(value)) status='withdrawn';
      else if (/^(発売なし|発売中止)$/.test(value)) status='suspended';
      else if (/^(無投票|票数なし)$/.test(value)) status='no_votes';
      else {
        const match=need(value.match(/^(\d+\.\d)(?:\s*[-－〜～]\s*(\d+\.\d))?\s*(以上)?$/),'Unknown odds cell; raw retained');
        low=+match[1];high=+(match[2]??match[1]);lower_bound=!!match[3];
        if(market==='place') need(match[2],'Place range missing');
      }
      quotes[market].push({selection,status,low,high,lower_bound});
    }
  }
  const post=need(text(html).match(/発走時刻：\s*(\d+)時(\d+)分/),'Scheduled post time missing');
  const scheduled_start_at=`${d[1]}-${pad(d[2])}-${pad(d[3])}T${pad(post[1])}:${pad(post[2])}:00+09:00`;
  return ['win','place'].map(market=>validateSnapshot({source:'jra-web',race_id,market,phase,...clocks,
    source_time,time_precision:source_time?'minute':'unknown',expected_selections:config.expected_selections,
    quotes:quotes[market],timing:config.timing??null,scheduled_start_at,roster_evidence:config.roster_evidence,
    source_marker:marker,access:'private',adapter_version:1}));
}

export async function collectJraWeb({config,root,store,fetchImpl=fetch}) {
  need(config && typeof config.cname==='string' && /^[A-Za-z0-9_/.-]{1,160}$/.test(config.cname),'Current official CNAME required');
  const started_at=new Date().toISOString(), start=performance.now();
  const attempt={source:'jra-web',race_id:config.race_id,started_at,ok:false,stage:'collection'};
  try {
    const response=await fetchImpl('https://www.jra.go.jp/JRADB/accessO.html',{
      method:'POST',body:new URLSearchParams({cname:config.cname}),redirect:'error',
      headers:{'User-Agent':'OddsObserver/0.2 (personal source-quality measurement)'},signal:AbortSignal.timeout(15000)});
    const bytes=new Uint8Array(await response.arrayBuffer());
    const received_at=new Date().toISOString();attempt.received_at=received_at;
    attempt.raw_hash=archiveRaw(root,bytes);attempt.http_status=response.status;
    attempt.http_date=response.headers.get('date');attempt.cache_age=response.headers.get('age');attempt.etag=response.headers.get('etag');
    need(response.ok,`HTTP ${response.status}`);
    const html=new TextDecoder('shift_jis',{fatal:true}).decode(bytes);
    attempt.links=actionLinks(html);
    const snapshots=parseJraTanpuku(html,config,{request_started_at:started_at,received_at});
    store.db.exec('BEGIN');
    try {for(const s of snapshots)store.ingest(s,bytes);store.db.exec('COMMIT');}
    catch(e){store.db.exec('ROLLBACK');throw e;}
    attempt.ok=true;attempt.snapshots=snapshots.length;
  } catch(e) {attempt.error_code=e.cause?.code??e.code??'JRA_COLLECTION_FAILED';attempt.error_message=e.message;}
  attempt.received_at??=new Date().toISOString();attempt.elapsed_ms=performance.now()-start;
  store.attempt(attempt);return attempt;
}

export async function discoverJra({root,store,fetchImpl=fetch}) {
  const started_at=new Date().toISOString();
  const record={source:'jra-web',started_at,ok:false,stage:'discovery'};
  try {
    const r=await fetchImpl('https://www.jra.go.jp/',{signal:AbortSignal.timeout(15000),redirect:'error'});
    const bytes=new Uint8Array(await r.arrayBuffer());record.raw_hash=archiveRaw(root,bytes);
    need(r.ok,`HTTP ${r.status}`);
    record.links=actionLinks(new TextDecoder('shift_jis').decode(bytes));
    need(record.links.length,'No official action links found');record.ok=true;
  }catch(e){record.error_code=e.cause?.code??e.name;record.error_message=e.message;}
  record.received_at=new Date().toISOString();store.attempt(record);return record;
}
