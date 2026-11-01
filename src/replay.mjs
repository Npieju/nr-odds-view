// Receipt time, never publication time, controls historical availability.
export function replayAtCutoff(store, {source,race_id,market,decision_at,sales_close_at,channel,evidence,maxAgeMs=90000}) {
  const decision = Date.parse(decision_at), close = Date.parse(sales_close_at);
  if (![decision,close].every(Number.isFinite) || ![decision_at,sales_close_at].every(t=>/(Z|[+-]\d{2}:\d{2})$/.test(t)) || !channel || !evidence || !(maxAgeMs>0)) throw new Error('Explicit zoned decision/close times, channel and evidence required');
  const rows=store.rows().filter(r=>r.source===source && r.race_id===race_id && r.market===market);
  const candidate=rows.filter(r=>r.phase==='interim' && r.received_ms<=decision && r.received_ms<close).at(-1);
  const flags=[];
  if (decision>=close) flags.push('decision_at_or_after_close');
  if (!candidate) flags.push('no_preclose_receipt');
  else {
    if (candidate.source_ms===null) flags.push('unknown_source_time');
    else if (decision-candidate.source_ms>maxAgeMs) flags.push('stale_source_time');
    if (decision-candidate.received_ms>maxAgeMs) flags.push('collector_stale');
  }
  const final=rows.filter(r=>r.phase==='final').at(-1);
  const snapshot=candidate ? JSON.parse(candidate.payload) : null;
  const differences=snapshot && final ? JSON.parse(final.payload).quotes.flatMap(q=>{
    const p=snapshot.quotes.find(p=>p.selection===q.selection);
    return p?.status==='active' && q.status==='active' ? [{selection:q.selection,low_change_pct:(q.low/p.low-1)*100,high_change_pct:(q.high/p.high-1)*100}] : [];
  }) : [];
  return {source,race_id,market,decision_at,sales_close_at,channel,evidence,quality_flags:flags,
    signal_eligible:flags.length===0,snapshot,final_received_at:final?.received_at ?? null,
    retrospective_only:true,differences};
}
