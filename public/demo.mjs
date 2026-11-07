export const DEMO_SECONDS=600;
// Reference replay from the published archive. Live race selection is independent.
export const REPLAY_RACE_ID='20261107-05-05-01-10';

export function replayFrame(archive,elapsedSeconds){
 const start=Date.parse(archive.window_start_at),close=Date.parse(archive.sales_close_at);
 const now=Math.max(start,Math.min(close,start+elapsedSeconds*1000));
 const markets=archive.markets.map(({market,selections})=>{
  const receipts=new Set();
  let latest=null;
  const visible=selections.map(({selection,horse_name,points})=>{
   const observed=points.filter(point=>{
    const at=Date.parse(point.received_at);
    return at>=start && at<=now && at<close;
   });
   for(const point of observed)receipts.add(point.received_at);
   const last=observed.at(-1)??null;
   if(last && (!latest || Date.parse(last.received_at)>Date.parse(latest.received_at)))latest=last;
   return {selection,horse_name,points:observed,latest:last};
  });
  return {market,received_at:latest?.received_at??null,source_time:latest?.source_time??null,
   observation_count:receipts.size,quality_flags:latest?[]:['no_data'],selections:visible};
 });
 const {outcome,...recording}=archive;
 return {...recording,generated_at:new Date(now).toISOString(),remaining_seconds:Math.ceil((close-now)/1000),markets};
}
