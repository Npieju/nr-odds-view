import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { archiveRaw, validateSnapshot } from './store.mjs';

const execute = promisify(execFile);
const fail = message => { throw new Error(message); };
export function validateConfig(c) {
  if (!c || !/^\d{16}$/.test(c.race_id)) fail('Full JV race_id YYYYMMDDJJKKHHRR required');
  if (!Array.isArray(c.expected_selections) || !c.expected_selections.length ||
      c.expected_selections.some(s=>!/^\d{2}$/.test(s) || +s<1 || +s>28) ||
      new Set(c.expected_selections).size!==c.expected_selections.length) fail('Independent horse roster required');
  if (typeof c.roster_evidence !== 'string' || !c.roster_evidence.trim()) fail('roster_evidence required');
  return c;
}

// JV-Data 4.9.0.1, format 7 (O1), 1-based byte offsets in the official PDF.
// O1 is ASCII; no Unicode->SJIS reconstruction is necessary with JVRead here.
export function parseO1(bytes, config, clocks) {
  validateConfig(config);
  const b=Buffer.from(bytes);
  if (b.length!==962 || b.subarray(960).toString()!=='\r\n' || b.some(x=>x>127)) fail('Invalid O1 length/encoding/terminator');
  const field=(pos,length)=>b.subarray(pos-1,pos-1+length).toString('ascii');
  if (field(1,2)!=='O1' || field(12,16)!==config.race_id) fail('O1 type/race identity mismatch');
  const code=field(3,1), phase=({'1':'interim','2':'presale_final','3':'final','4':'confirmed','5':'confirmed'})[code];
  if (!phase) fail(`Unsupported O1 data status ${code}; retain raw, no signal`);
  if (+field(36,2)!==config.expected_selections.length || !/^\d{2}$/.test(field(36,2))) fail('Roster count mismatch');
  const mdhm=field(28,8);
  let source_time=null;
  if (phase==='interim' && mdhm!=='00000000') {
    if (!/^\d{8}$/.test(mdhm)) fail('Invalid O1 announcement time');
    // New Year advance sales: choose the closest valid year to the race date.
    const year=+config.race_id.slice(0,4), raceDay=Date.parse(`${config.race_id.slice(0,4)}-${config.race_id.slice(4,6)}-${config.race_id.slice(6,8)}T00:00:00+09:00`);
    const candidates=[year-1,year,year+1].map(y=>`${y}-${mdhm.slice(0,2)}-${mdhm.slice(2,4)}T${mdhm.slice(4,6)}:${mdhm.slice(6,8)}:00+09:00`)
      .filter(t=>Number.isFinite(Date.parse(t)) && new Date(Date.parse(t)+9*3600000).toISOString().slice(0,16)===t.slice(0,16))
      .sort((a,b)=>Math.abs(Date.parse(a)-raceDay)-Math.abs(Date.parse(b)-raceDay));
    source_time=candidates[0] ?? fail('Impossible announcement date');
    if (Math.abs(Date.parse(source_time)-raceDay)>2*86400000) fail('Announcement date too far from race');
  }
  const snapshots=[];
  for (const [market,offset,width,flag] of [['win',44,8,40],['place',268,12,41]]) {
    if (!'0137'.includes(field(flag,1))) fail('Invalid sale flag');
    if (field(flag,1)!=='7') continue; // preserve flags in raw; not a complete available market
    const quotes=[];
    for(let i=0;i<28;i++) {
      const p=offset+i*width, selection=field(p,2), lo=field(p+2,4), hi=market==='place'?field(p+6,4):lo;
      if (selection==='  ') {
        if (field(p,width).trim()) fail('Malformed unused slot');
        continue;
      }
      if (!config.expected_selections.includes(selection)) fail('Unexpected horse in O1');
      let status='active', low=null, high=null;
      if (lo===hi && ['----','****','0000'].includes(lo)) status=lo==='0000'?'no_votes':'withdrawn';
      else {
        if (!/^\d{4}$/.test(lo) || !/^\d{4}$/.test(hi)) fail('Unknown or missing O1 odds');
        low=+lo/10;high=+hi/10;
      }
      quotes.push({selection,status,low,high,lower_bound:lo==='9999'||hi==='9999'});
    }
    snapshots.push(validateSnapshot({source:'jra-van',race_id:config.race_id,market,phase,
      ...clocks,source_time,time_precision:source_time?'minute':'unknown',
      expected_selections:config.expected_selections,quotes,
      timing:config.timing ?? null,roster_evidence:config.roster_evidence,
      provider_status:code,provider_created_date:field(4,8),announcement_raw:mdhm,
      access:'private',adapter_version:1}));
  }
  if (!snapshots.length) fail('No supported market on sale');
  return snapshots;
}

export async function readJvLink(config) {
  validateConfig(config);
  if (process.platform!=='win32') fail('JV-Link requires Windows');
  const script=fileURLToPath(new URL('../scripts/read-jvlink.ps1',import.meta.url));
  const {stdout}=await execute(process.env.JVLINK_POWERSHELL ?? 'powershell.exe',
    ['-NoProfile','-NonInteractive','-File',script,'-RaceKey',config.race_id],
    {timeout:45000,maxBuffer:2*1024*1024,windowsHide:true});
  return JSON.parse(stdout.replace(/^\uFEFF/,''));
}

export async function collectJvLink({config,root,store,reader=readJvLink}) {
  validateConfig(config);
  const started_at=new Date().toISOString();
  const attempt={source:'jra-van',race_id:config.race_id,started_at,ok:false,stage:'collection'};
  try {
    const result=await reader(config);
    if (!Array.isArray(result.records) || !result.records.length) fail('JV-Link returned no records');
    const pending=[];
    for(const record of result.records) {
      if (typeof record.base64!=='string' || !record.base64.length) fail('Missing original O1 bytes');
      const raw=Buffer.from(record.base64,'base64');
      // Archive before parsing, including malformed records. Never commit data/.
      (attempt.raw_hashes??=[]).push(archiveRaw(root,raw));
      const snapshots=parseO1(raw,config,{request_started_at:result.request_started_at,received_at:record.received_at});
      pending.push({raw,snapshots});
    }
    store.db.exec('BEGIN');
    try { for(const p of pending) for(const s of p.snapshots) store.ingest(s,p.raw);store.db.exec('COMMIT'); }
    catch(e) {store.db.exec('ROLLBACK');throw e;}
    attempt.ok=true;attempt.records=pending.length;attempt.snapshots=pending.reduce((n,p)=>n+p.snapshots.length,0);
  } catch(error) {attempt.error_code=error.code ?? 'JVLINK_COLLECTION_FAILED';attempt.error_message=error.message;}
  attempt.received_at=new Date().toISOString();
  store.attempt(attempt);
  return attempt;
}
