import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const hash = value => createHash('sha256').update(value).digest('hex');
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const epoch = value => {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('Timestamp must be an ISO date with an explicit timezone');
  }
  return Date.parse(value);
};

export function validateSnapshot(s) {
  if (!s || !id(s.source) || !id(s.race_id)) throw new Error('Invalid source/race_id');
  if (!['win','place','bracket','quinella','wide','exacta','trio','trifecta'].includes(s.market)) throw new Error('Invalid market');
  if (!['interim','final','confirmed'].includes(s.phase)) throw new Error('Explicit phase required');
  const received = epoch(s.received_at), started = epoch(s.request_started_at);
  if (started > received) throw new Error('Request starts after receipt');
  if (s.source_time === null) {
    if (s.time_precision !== 'unknown') throw new Error('Missing source_time must be unknown');
  } else {
    const t = epoch(s.source_time);
    if (!['minute','second'].includes(s.time_precision)) throw new Error('Invalid time_precision');
    if (s.time_precision === 'minute' && t % 60000 !== 0) throw new Error('Minute timestamp must be minute-aligned');
    if (t > received) throw new Error('Source time is in the future');
  }
  if (!Array.isArray(s.expected_selections) || !s.expected_selections.length || s.expected_selections.some(x => !id(x))) throw new Error('Explicit expected selections required');
  if (new Set(s.expected_selections).size !== s.expected_selections.length) throw new Error('Duplicate expected selections');
  if (!Array.isArray(s.quotes) || s.quotes.length !== s.expected_selections.length) throw new Error('Incomplete market');
  const seen = new Set();
  for (const q of s.quotes) {
    if (!s.expected_selections.includes(q.selection) || seen.has(q.selection)) throw new Error('Unknown/duplicate selection');
    seen.add(q.selection);
    if (!['active','withdrawn','no_votes','suspended'].includes(q.status)) throw new Error('Explicit quote status required');
    if (q.status === 'active') {
      if (!Number.isFinite(q.low) || q.low < 1 || !Number.isFinite(q.high) || q.high < q.low) throw new Error('Invalid odds');
      if (!['place','wide'].includes(s.market) && q.low !== q.high) throw new Error('Unexpected odds range');
    } else if (q.low !== null || q.high !== null) throw new Error('Unavailable odds must be null');
  }
  return s;
}

export function contentHash(s) {
  // Exclude clocks/HTTP metadata. Equivalent markets match across sources.
  return hash(JSON.stringify(s.quotes.map(q => ({ selection:q.selection, status:q.status, low:q.low, high:q.high }))
    .sort((a,b) => a.selection.localeCompare(b.selection))));
}

export function ageBounds(s, at = Date.now()) {
  if (s.source_time === null) return { min_ms:null, max_ms:null };
  const max = at - epoch(s.source_time);
  return { min_ms:Math.max(0,max-(s.time_precision === 'minute' ? 60000 : 1000)), max_ms:max };
}

export class Store {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive:true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY, source TEXT NOT NULL, race_id TEXT NOT NULL,
        market TEXT NOT NULL, phase TEXT NOT NULL, received_at TEXT NOT NULL,
        received_ms INTEGER NOT NULL, source_time TEXT, source_ms INTEGER,
        time_precision TEXT NOT NULL, content_hash TEXT NOT NULL, raw_hash TEXT NOT NULL,
        payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS obs_lookup ON observations(source,race_id,market,received_ms);
      CREATE TABLE IF NOT EXISTS attempts (
        id INTEGER PRIMARY KEY, source TEXT NOT NULL, started_at TEXT NOT NULL,
        received_at TEXT NOT NULL, ok INTEGER NOT NULL, detail TEXT NOT NULL);`);
  }
  close() { this.db.close(); }
  ingest(snapshot, raw) {
    const s = validateSnapshot(snapshot);
    if (!(raw instanceof Uint8Array)) throw new Error('Original response bytes required');
    const digest = contentHash(s), rawHash = hash(raw);
    this.db.prepare(`INSERT INTO observations
      (source,race_id,market,phase,received_at,received_ms,source_time,source_ms,time_precision,content_hash,raw_hash,payload)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(s.source,s.race_id,s.market,s.phase,s.received_at,epoch(s.received_at),
        s.source_time,s.source_time === null ? null : epoch(s.source_time),s.time_precision,digest,rawHash,JSON.stringify(s));
    return { content_hash:digest, raw_hash:rawHash };
  }
  attempt(record) {
    this.db.prepare('INSERT INTO attempts(source,started_at,received_at,ok,detail) VALUES(?,?,?,?,?)')
      .run(record.source,record.started_at,record.received_at,record.ok ? 1 : 0,JSON.stringify(record));
  }
  rows() { return this.db.prepare('SELECT * FROM observations ORDER BY received_ms,id').all(); }
  compare() {
    const groups = new Map();
    for (const r of this.rows()) {
      const key = `${r.race_id}/${r.market}/${r.phase}/${r.content_hash}`;
      if (!groups.has(key)) groups.set(key,new Map());
      const sources = groups.get(key);
      if (!sources.has(r.source)) sources.set(r.source,r);
    }
    return [...groups.entries()].filter(([,sources]) => sources.size > 1).map(([key,sources]) => {
      const first = Math.min(...[...sources.values()].map(r => r.received_ms));
      return { key, observations:[...sources.values()].map(r => ({ source:r.source,
        first_observed_at:r.received_at, observed_delay_ms:r.received_ms-first })) };
    });
  }
  export({ now = Date.now(), maxAgeMs = 90000, maxGapMs = 180000 } = {}) {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || !Number.isFinite(maxGapMs) || maxGapMs <= 0) throw new Error('Invalid quality limits');
    const streams = new Map();
    for (const row of this.rows()) {
      const key = `${row.source}/${row.race_id}/${row.market}`;
      if (!streams.has(key)) streams.set(key,[]);
      streams.get(key).push(row);
    }
    const markets = [];
    for (const rows of streams.values()) {
      const latest = rows.at(-1), s = JSON.parse(latest.payload), age = ageBounds(s,now);
      const flags = [];
      const lastTimed = rows.slice(0,-1).filter(r=>r.phase==='interim' && r.source_ms !== null).at(-1);
      if (now < latest.received_ms) flags.push('future_receipt');
      if (s.source_time === null) flags.push('unknown_source_time');
      if (s.phase !== 'interim') flags.push('post_close_data');
      if (age.max_ms !== null && age.max_ms > maxAgeMs) flags.push('stale_source_time');
      if (now-latest.received_ms > maxAgeMs) flags.push('collector_stale');
      const eligible = rows.filter(r => r.phase === 'interim' && r.source_ms !== null);
      const preceding = eligible.filter(r => r.received_ms < latest.received_ms && r.content_hash !== latest.content_hash).at(-1);
      if (s.phase === 'interim' && lastTimed && latest.source_ms !== null && latest.source_ms < lastTimed.source_ms) flags.push('source_time_regression');
      if (preceding && latest.received_ms-preceding.received_ms > maxGapMs) flags.push('comparison_gap');
      if (preceding && JSON.parse(preceding.payload).quotes.map(q=>`${q.selection}:${q.status}`).sort().join('|') !==
          s.quotes.map(q=>`${q.selection}:${q.status}`).sort().join('|')) flags.push('market_membership_change');
      // A new price is visible even if its timestamp did not advance. Keep the evidence,
      // but do not label it a newly timed signal.
      if (preceding && latest.source_ms !== null && latest.source_ms === preceding.source_ms) flags.push('same_timestamp_revision');
      const movements = [];
      if (!flags.length && preceding) {
        const previous = JSON.parse(preceding.payload);
        for (const q of s.quotes) {
          const p = previous.quotes.find(x=>x.selection===q.selection);
          if (q.status !== 'active' || !p || p.status !== 'active') continue;
          movements.push({ selection:q.selection, from_low:p.low, to_low:q.low,
            odds_change_pct:(q.low/p.low-1)*100,
            log_odds_change:Math.log(q.low/p.low),
            // A range is kept as a range; its lower endpoint is not a point probability.
            range: q.low !== q.high || p.low !== p.high,
            from_high:p.high, to_high:q.high,
            previous_received_at:previous.received_at, previous_source_time:previous.source_time });
        }
        movements.sort((a,b)=>Math.abs(b.log_odds_change)-Math.abs(a.log_odds_change));
      }
      markets.push({ source:s.source,race_id:s.race_id,market:s.market,phase:s.phase,
        received_at:s.received_at,source_time:s.source_time,time_precision:s.time_precision,
        source_age_bounds_ms:age,quality_flags:flags,signal_eligible:flags.length===0,
        observation_count:rows.length,quotes:s.quotes,movements });
    }
    return { schema_version:1,generated_at:new Date(now).toISOString(),markets };
  }
}

export function archiveRaw(root, bytes) {
  const digest = hash(bytes), directory = join(root,'raw',digest.slice(0,2));
  mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,`${digest}.bin`),bytes);
  return digest;
}

export function atomicJson(path, value) {
  mkdirSync(dirname(path),{recursive:true});
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp,JSON.stringify(value,null,2)+'\n');
  renameSync(temp,path);
}
