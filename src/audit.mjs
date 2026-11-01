import { ageBounds } from './store.mjs';

const time = t => {
  if (typeof t!=='string' || !/(Z|[+-]\d{2}:\d{2})$/.test(t) || !Number.isFinite(Date.parse(t))) throw new Error('Explicit audit timestamp required');
  return Date.parse(t);
};
const quantile = (values,p) => values.length ? [...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1] : null;

// Cutoff is an explicitly evidenced channel deadline, not derived from post time.
// Report availability separately from usable freshness and from actual purchase success.
export function auditRace(store,{source,race_id,market,cutoff,deadline_evidence,deadline_observed_at,maxAgeMs=90000,as_of=new Date().toISOString()}) {
  const close=time(cutoff), asOf=time(as_of);
  if (!source || !race_id || !market || typeof deadline_evidence!=='string' || !deadline_evidence.trim()) throw new Error('Audit identity and deadline evidence required');
  if (time(deadline_observed_at)>=close) throw new Error('Deadline was not known before cutoff');
  if (asOf<close || !Number.isFinite(maxAgeMs) || maxAgeMs<=0) throw new Error('Invalid audit as_of/quality limit');
  const rows=store.rows().filter(r=>r.source===source && r.race_id===race_id && r.market===market && r.received_ms<=asOf);
  const before=rows.filter(r=>r.phase==='interim' && r.received_ms<close);
  const last=before.at(-1);
  const finals=rows.filter(r=>['final','confirmed'].includes(r.phase));
  const final=finals.filter(r=>r.phase==='confirmed').at(-1) ?? finals.at(-1);
  const summarize=r=>r ? {id:r.id,received_at:r.received_at,source_time:r.source_time,phase:r.phase,content_hash:r.content_hash,raw_hash:r.raw_hash} : null;
  const lastSnapshot=last ? JSON.parse(last.payload) : null;
  const age=lastSnapshot ? ageBounds(lastSnapshot,close) : {min_ms:null,max_ms:null};
  const flags=[];
  if(!last) flags.push('no_preclose_observation');
  else {
    if(age.max_ms===null) flags.push('unknown_source_time');
    else if(age.max_ms>maxAgeMs) flags.push('stale_at_cutoff');
    if(lastSnapshot.quotes.some(q=>q.lower_bound)) flags.push('capped_odds');
  }
  const differences=[];
  if(last && final) {
    const f=JSON.parse(final.payload);
    for(const q of lastSnapshot.quotes) {
      const end=f.quotes.find(v=>v.selection===q.selection);
      if(q.status!=='active' || end?.status!=='active' || q.lower_bound || end.lower_bound) continue;
      differences.push({selection:q.selection,preclose_low:q.low,preclose_high:q.high,
        final_low:end.low,final_high:end.high,low_change_pct:(end.low/q.low-1)*100,
        high_change_pct:(end.high/q.high-1)*100});
    }
  }
  const ages=before.map(r=>ageBounds(JSON.parse(r.payload),r.received_ms));
  const elapsed=before.map(r=>{const s=JSON.parse(r.payload);return r.received_ms-time(s.request_started_at);});
  const gaps=before.slice(1).map((r,i)=>r.received_ms-before[i].received_ms);
  const attempts=store.db.prepare('SELECT detail FROM attempts WHERE source=?').all(source).map(r=>JSON.parse(r.detail))
    .filter(a=>a.race_id===race_id && time(a.started_at)<close && time(a.received_at)<=asOf);
  return {schema_version:1,access:'private',source,race_id,market,cutoff,deadline_evidence,deadline_observed_at,as_of,
    interpretation:'Received before the evidenced deadline; does not prove an order could complete. Final comparison is hindsight only.',
    last_preclose:summarize(last),source_age_at_cutoff_ms:age,quality_flags:flags,
    usable_at_cutoff:flags.length===0,final:summarize(final),hindsight_differences:differences,
    metrics:{preclose_observations:before.length,unknown_source_times:ages.filter(a=>a.max_ms===null).length,
      age_max_median_ms:quantile(ages.filter(a=>a.max_ms!==null).map(a=>a.max_ms),.5),
      age_max_p95_ms:quantile(ages.filter(a=>a.max_ms!==null).map(a=>a.max_ms),.95),
      request_duration_p95_ms:quantile(elapsed,.95),observation_gap_p95_ms:quantile(gaps,.95),
      attempts:attempts.length,failed_attempts:attempts.filter(a=>!a.ok).length}};
}
