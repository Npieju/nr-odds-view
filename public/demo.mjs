// A deterministic browser-only feed. This data is never sent to the relay.
export const DEMO_SECONDS=600;
const start=Date.UTC(2026,0,1);
const interval=10;
const horseCount=8;
const iso=ms=>new Date(ms).toISOString();

export function demoFrame(elapsedSeconds){
 const elapsed=Math.max(0,Math.min(DEMO_SECONDS,elapsedSeconds));
 const now=start+elapsed*1000,close=start+DEMO_SECONDS*1000;
 const observations=[];
 for(let second=0;second<=elapsed && second<DEMO_SECONDS;second+=interval){
  if(second>=160 && second<=220)continue;
  observations.push(second);
 }
 const markets=['win','place'].map(market=>{
  const selections=Array.from({length:horseCount},(_,index)=>{
   const points=observations.map(second=>{
    const progress=second/DEMO_SECONDS;
    const trend=index%2===0?-progress*2:progress*2;
    const base=Math.max(1,3+index*2.8+trend+Math.sin(second/48+index)*(.5+index*.18));
    const low=Number((market==='win'?base:1+base*.24).toFixed(1));
    const high=market==='win'?low:Number((low+1.1+index*.22).toFixed(1));
    return {received_at:iso(start+second*1000),source_time:iso(start+Math.floor(second/60)*60000),low,high,segment:second>220?1:0};
   });
   return {selection:String(index+1).padStart(2,'0'),horse_name:`模擬馬 ${String.fromCharCode(65+index)}`,points,latest:points.at(-1)};
  });
  const latest=selections[0].latest;
  return {market,received_at:latest.received_at,source_time:latest.source_time,observation_count:observations.length,quality_flags:elapsed>=230?['collection_gap']:[],selections};
 });
 return {generated_at:iso(now),race_id:'demo-race',race_label:'模擬レース',window_start_at:iso(start),sales_close_at:iso(close),markets};
}
