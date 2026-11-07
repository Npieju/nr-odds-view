// Last actually received value at each 30-second boundary; never use a later receipt.
export function samples30(points,start,until,maxCarryMs=45000){
 const sorted=[...points].sort((a,b)=>Date.parse(a.received_at)-Date.parse(b.received_at));
 const out=[];let index=0,last=null;
 for(let tick=start;tick<=until;tick+=30000){
  while(index<sorted.length && Date.parse(sorted[index].received_at)<=tick)last=sorted[index++];
  out.push({at:tick,point:last && tick-Date.parse(last.received_at)<=maxCarryMs?last:null});
 }
 return out;
}

export function timeBeforeClose(at,close){
 const seconds=Math.max(0,Math.round((close-at)/1000));
 if(!seconds)return '締切';
 const minutes=Math.floor(seconds/60),remainder=seconds%60;
 return `${minutes?minutes+'分':''}${remainder?remainder+'秒':''}前`;
}

// Compare the latest displayed observation only with its uninterrupted history.
export function currentMoves(points,latest,endpoint){
 if(!latest || !Number.isFinite(latest[endpoint]) || latest[endpoint]<=0 || latest.segment==null)return null;
 const at=Date.parse(latest.received_at),current=latest[endpoint];
 const prior=points.filter(p=>p.segment===latest.segment && Date.parse(p.received_at)<at && Number.isFinite(p[endpoint]) && p[endpoint]>0).map(p=>p[endpoint]);
 if(!prior.length)return null;
 const peak=Math.max(current,...prior),trough=Math.min(current,...prior);
 return {fall:100*(current-peak)/peak,rise:100*(current-trough)/trough};
}

export function trendQuoteFresh(quote,now){
 const receiptAge=now-Date.parse(quote.received_at);
 const sourceAge=now-Date.parse(quote.source_time);
 return receiptAge>=0 && receiptAge<=30000 && sourceAge>=0 && sourceAge<=90000;
}

// The source timestamp has minute precision. Polling the same publication does not
// add another step, even when it spans several 30-second chart ticks.
function trendPublications(points,latest){
 const end=Date.parse(latest.source_time),received=Date.parse(latest.received_at);
 const publications=new Map();
 for(const point of points){
  const at=Date.parse(point.source_time);
  if(point.segment===latest.segment && !point.stale_at_receipt &&
     at>=end-180000 && at<=end && Date.parse(point.received_at)<=received){
   publications.set(at,point);
  }
 }
 const sequence=[...publications.values()];
 if(latest.segment==null || sequence.length<3 || sequence.at(-1).received_at!==latest.received_at)return [];
 return sequence;
}

function median(values){
 const sorted=values.sort((a,b)=>a-b);
 return (sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2;
}

export function marketTrends({market,received_at,source_time,selections}){
 const cohorts=new Map(),trends=new Map();
 for(const {selection,points,latest} of selections){
  if(!received_at || !source_time || latest?.received_at!==received_at || latest.source_time!==source_time)continue;
  const sequence=trendPublications(points,latest);
  if(!sequence.length)continue;
  const baseline=sequence[0].source_time;
  if(!cohorts.has(baseline))cohorts.set(baseline,[]);
  cohorts.get(baseline).push({selection,sequence});
 }
 const endpoints=market==='place'?['low','high']:['low'];
 for(const horses of cohorts.values()){
  if(horses.length<Math.max(3,Math.ceil(selections.length/2)))continue;
  const field=endpoints.map(key=>median(horses.map(({sequence})=>
   100*(sequence.at(-1)[key]/sequence[0][key]-1))));
  for(const {selection,sequence} of horses){
   const signals=endpoints.map((key,index)=>endpointTrend(sequence,key,field[index]));
   const [low,high]=signals;
   if(!low || (market==='place' && high?.direction!==low.direction))continue;
   trends.set(selection,high && Math.abs(high.percent)<Math.abs(low.percent)?high:low);
  }
 }
 return trends;
}

function endpointTrend(sequence,endpoint,fieldPercent){
 // Work in displayed tenths so a single 0.1 tick cannot pass due to float error.
 const ticks=sequence.map(point=>Math.round(point[endpoint]*10));
 if(ticks.some(tick=>!Number.isFinite(tick) || tick<=0))return null;
 const net=ticks.at(-1)-ticks[0];
 if(Math.abs(net)<2 || Math.abs(net)*100<ticks[0]*5)return null;
 const direction=Math.sign(net),percent=100*net/ticks[0];
 if(!(direction*(percent-fieldPercent)>=3))return null;
 let sameDirection=0,path=0,lastMove=0;
 for(let index=1;index<ticks.length;index++){
  const step=ticks[index]-ticks[index-1];
  if(Math.sign(step)===direction)sameDirection++;
  if(step)lastMove=index;
  path+=Math.abs(step);
 }
 // Reject zigzags, a final reversal, or a move that has gone flat for two minutes.
 const lastMoveAge=Date.parse(sequence.at(-1).source_time)-Date.parse(sequence[lastMove].source_time);
 if(sameDirection<2 || Math.abs(net)*10<path*7 ||
    Math.sign(ticks[lastMove]-ticks[lastMove-1])!==direction || lastMoveAge>60000)return null;
 return {direction:direction<0?'down':'up',percent};
}
