import { ageBounds } from './store.mjs';
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(p*values.length)-1]:null;
export function measureWindow(store,config) {
 const close=Date.parse(config.sales_close_at),start=close-300000;
 const rows=store.rows().filter(r=>r.source==='jra-web' && r.race_id===config.race_id && r.phase==='interim' && r.received_ms>=start && r.received_ms<close);
 const attempts=store.db.prepare('SELECT detail FROM attempts').all().map(r=>JSON.parse(r.detail)).filter(r=>r.source==='jra-web' && r.request_cname===config.cname && Date.parse(r.started_at)>=start && Date.parse(r.started_at)<close);
 const http=attempts.filter(r=>r.stage==='raw_only'),rejected=attempts.filter(r=>r.stage==='parse_rejected');
 return {race_id:config.race_id,window_start_at:new Date(start).toISOString(),sales_close_at:config.sales_close_at,close_basis:config.close_basis??'user_supplied',http_requests:http.length,http_failures:http.filter(r=>!r.ok).length,parse_rejections:rejected.length,
  markets:['win','place'].map(market=>{
   const stream=rows.filter(r=>r.market===market),ages=stream.filter(r=>r.source_ms!==null).map(r=>ageBounds(JSON.parse(r.payload),r.received_ms));
   const transitions=stream.filter((r,i)=>!i || r.content_hash!==stream[i-1].content_hash);
   const gaps=stream.slice(1).map((r,i)=>r.received_ms-stream[i].received_ms),last=stream.at(-1);
   const regressions=stream.filter((r,i)=>i && r.source_ms!==null && r.source_ms<Math.max(...stream.slice(0,i).map(p=>p.source_ms??-Infinity)));
   return {market,observations:stream.length,content_transitions:Math.max(0,transitions.length-1),content_versions_observed:transitions.length,distinct_source_times:new Set(stream.map(r=>r.source_time)).size,
    first_received_at:stream[0]?.received_at??null,last_received_at:last?.received_at??null,last_source_time:last?.source_time??null,
    seconds_before_close_last_receipt:last?(close-last.received_ms)/1000:null,
    source_age_at_receipt_ms:{min_bound_median:percentile(ages.map(a=>a.min_ms),.5),max_bound_median:percentile(ages.map(a=>a.max_ms),.5),max_bound_p95:percentile(ages.map(a=>a.max_ms),.95)},
    max_receipt_gap_ms:gaps.length?Math.max(...gaps):null,
    source_time_regressions:regressions.map(r=>({received_at:r.received_at,source_time:r.source_time})),
    updates:transitions.map(r=>({received_at:r.received_at,source_time:r.source_time}))};
  })};
}
