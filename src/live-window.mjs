import { ageBounds } from './store.mjs';

export function liveWindow(store, config, now=Date.now()) {
 const close=Date.parse(config.sales_close_at), start=close-(config.window_ms??600000);
 const source=config.source??'jra-web';
 const evidence=store.raceRows?.(source,config.race_id,'interim',Math.min(now,close-1))??store.rows();
 const all=evidence.filter(r=>r.source===source && r.race_id===config.race_id && r.received_ms<close && r.received_ms<=now && r.phase==='interim');
 const markets=['win','place'].map(market=>{
  const observations=all.filter(r=>r.market===market),flags=[];
  let sourceWatermark=-Infinity,regressed=false;
  const accepted=observations.filter(r=>{
   // Keep older replies in SQLite but do not use them as the current quote.
   if(r.source_ms!==null && r.source_ms<sourceWatermark){
    if(r.received_ms>=start)regressed=true;
    return false;
   }
   if(r.source_ms!==null)sourceWatermark=r.source_ms;
   return true;
  });
  const stream=accepted.filter(r=>r.received_ms>=start),last=accepted.at(-1);
  const maxAge=config.max_age_ms??90000, gap=config.max_gap_ms??30000;
  if(!last) flags.push('no_data');
  if(now>=close) flags.push('sales_closed');
  if(now<start) flags.push('waiting');
  if(last && now-last.received_ms>gap) flags.push('collector_stale');
  if(last && (last.source_ms===null || ageBounds(JSON.parse(last.payload),now).max_ms>maxAge)) flags.push('source_stale_or_unknown');
  if(stream[0]?.received_ms>start+gap) flags.push('partial_window');
  if(stream.some((r,i)=>i && r.received_ms-stream[i-1].received_ms>gap)) flags.push('collection_gap');
  if(regressed)flags.push('source_time_regression');
  const series=new Map(); let previous=null;
  for(const r of stream){
   const s=JSON.parse(r.payload);
   const membership=s.quotes.map(q=>q.selection+':'+q.status).sort().join('|');
   const broken=previous && (r.received_ms-previous.received_ms>gap || r.source_ms<previous.source_ms || membership!==previous.membership);
   if(broken) {for(const v of series.values()) v.segment++; flags.push('series_interrupted');}
   for(const q of s.quotes){
    if(!series.has(q.selection)) series.set(q.selection,{selection:q.selection,segment:0,points:[]});
    const v=series.get(q.selection);
    if(q.status!=='active' || r.source_ms===null){v.segment++;continue;}
    const source_age_bounds_ms=ageBounds(s,r.received_ms);
    // Preserve observed prices even when stale; freshness gates the current signal,
    // never rewrites the historical observations or hides the latest numeric quote.
    v.points.push({received_at:s.received_at,source_time:s.source_time,low:q.low,high:q.high,segment:v.segment,source_age_bounds_ms,stale_at_receipt:source_age_bounds_ms.max_ms>maxAge});
   }
   previous={...r,membership};
  }
  const preview=last?JSON.parse(last.payload):null;
  if(!stream.length)for(const selection of config.expected_selections??[])series.set(selection,{selection,segment:0,points:[]});
  const selections=[...series.values()].map(v=>{
   const extrema={};
   for(const endpoint of ['low','high']){
    let up=null,down=null,min=null,max=null,segment=-1;
    for(const p of v.points){
     if(p.segment!==segment){min=max=null;segment=p.segment;}
     const event=from=>({pct:(p[endpoint]/from[endpoint]-1)*100,from:from[endpoint],to:p[endpoint],from_received_at:from.received_at,to_received_at:p.received_at,from_source_time:from.source_time,to_source_time:p.source_time});
     if(min && p[endpoint]>min[endpoint]){const e=event(min);if(!up || e.pct>up.pct) up=e;}
     if(max && p[endpoint]<max[endpoint]){const e=event(max);if(!down || e.pct<down.pct) down=e;}
     if(!min || p[endpoint]<min[endpoint]) min=p;
     if(!max || p[endpoint]>max[endpoint]) max=p;
    }
    extrema[endpoint]={rise:up,fall:down};
   }
   const quote=preview?.quotes.find(q=>q.selection===v.selection && q.status==='active');
   const latest=v.points.at(-1)??(quote?{low:quote.low,high:quote.high,received_at:preview.received_at,source_time:preview.source_time}:null);
   return {selection:v.selection,horse_name:config.horse_names?.[v.selection]??null,points:v.points,extrema,latest};
  });
  selections.sort((a,b)=>Math.abs(b.extrema.low.fall?.pct??0)-Math.abs(a.extrema.low.fall?.pct??0));
  return {market,received_at:last?.received_at??null,source_time:last?.source_time??null,source_age_bounds_ms:last?ageBounds(JSON.parse(last.payload),now):null,observation_count:observations.filter(r=>r.received_ms>=start).length,quality_flags:[...new Set(flags)],signal_eligible:flags.length===0,selections};
 });
 return {schema_version:1,generated_at:new Date(now).toISOString(),race_id:config.race_id,race_label:config.race_label,sales_channel:config.sales_channel,close_basis:config.close_basis??'user_supplied',sales_close_at:config.sales_close_at,scheduled_start_at:config.scheduled_start_at,window_start_at:new Date(start).toISOString(),remaining_seconds:Math.max(0,Math.ceil((close-now)/1000)),markets};
}
