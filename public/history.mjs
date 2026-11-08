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

// Older live feeds can still advertise a rejected reply in the market header.
export function marketWithAcceptedQuote(market){
 if(!market.quality_flags?.includes('source_time_regression'))return market;
 const reportedSource=Date.parse(market.source_time);
 let newest=null;
 for(const {latest} of market.selections){
  const source=Date.parse(latest?.source_time);
  if(!(source>reportedSource))continue;
  if(!newest || source>Date.parse(newest.source_time) ||
     (source===Date.parse(newest.source_time) &&
      Date.parse(latest.received_at)>Date.parse(newest.received_at)))newest=latest;
 }
 return newest?{...market,received_at:newest.received_at,source_time:newest.source_time}:market;
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

const WINDOW_MS=300000;
const MAX_FORECAST_RECEIPT_AGE_MS=60000;
const MAX_FORECAST_SOURCE_AGE_MS=180000;
// Minimize mean absolute inverse-odds error on the 2026-11-07 archives.
// Reproduce with src/calibrate-forecast.mjs.
const COEFFICIENTS={jra:{level:0.01,momentum:0.35},nar:{level:0.05,momentum:0.225}};

export function forecastQuoteStatus(quote,now){
 if(trendQuoteFresh(quote,now))return 'fresh';
 const receiptAge=now-Date.parse(quote.received_at);
 const sourceAge=now-Date.parse(quote.source_time);
 // The displayed publication minute can precede the actual update by up to 60s.
 return receiptAge>=0 && receiptAge<=MAX_FORECAST_RECEIPT_AGE_MS &&
  sourceAge>=0 && sourceAge<=MAX_FORECAST_SOURCE_AGE_MS?'waiting':null;
}

export function lastForecastFrame(market,close){
 let latest=null,latestAt=close-WINDOW_MS-1;
 for(const {points} of market.selections){
  const point=points.findLast(p=>{
   const at=Date.parse(p.received_at);
   return at>latestAt && at<close && forecastQuoteStatus(p,at);
  });
  if(point){latest=point;latestAt=Date.parse(point.received_at);}
 }
 if(!latest)return null;
 const {received_at,source_time}=latest;
 const selections=market.selections.map(s=>({...s,
  latest:s.points.findLast(p=>p.received_at===received_at)
 }));
 return {...market,received_at,source_time,selections};
}

export function forecastWinOdds(market,category,asOf,close){
 const input=winForecastInput(market,asOf,close);
 return input?projectWinOdds(input,COEFFICIENTS[category]):new Map();
}

export function winForecastInput(market,asOf,close){
 const {received_at,source_time,selections}=market;
 if(market.market!=='win' || !(asOf>=close-WINDOW_MS && asOf<close) ||
    !forecastQuoteStatus(market,asOf))return null;

 const field=selections.filter(({latest})=>latest?.received_at===received_at && latest.source_time===source_time);
 if(field.length<2 || field.some(({latest})=>!validOdds(latest)))return null;

 const current=field.map(({latest})=>latest.low);
 const baseline=baselineOdds(field);
 return {
  selections:field.map(row=>row.selection),current,
  inverseSum:current.reduce((sum,odds)=>sum+1/odds,0),
  logOdds:current.map(Math.log),
  trend:baseline?current.map((odds,i)=>Math.log(baseline[i]/odds)):null
 };
}

export function projectWinOdds({selections,inverseSum,logOdds,trend},{level,momentum}){
 // Renormalization removes any field-wide shift in the log shares.
 const weights=logOdds.map((logOdd,i)=>Math.exp(-(1+level)*logOdd+momentum*(trend?.[i]??0)));
 const total=weights.reduce((sum,weight)=>sum+weight,0);
 const estimates=new Map();
 for(const [i,selection] of selections.entries()){
  const estimate=Math.max(1,total/(inverseSum*weights[i]));
  estimates.set(selection,Math.round(estimate*10)/10);
 }
 return estimates;
}

function validOdds(point){return Number.isFinite(point.low) && point.low>=1;}

function baselineOdds(field){
 const {latest,points}=field[0];
 const source=Date.parse(latest.source_time),receipt=Date.parse(latest.received_at);
 // Prefer two minutes of publication time, then one or three. Re-polling the
 // same minute cannot move the lookback or create a second publication.
 for(const minutes of [2,1,3]){
  const candidate=points.findLast(p=>p.segment===latest.segment &&
   Date.parse(p.source_time)===source-minutes*60000 && Date.parse(p.received_at)<receipt &&
   forecastQuoteStatus(p,Date.parse(p.received_at)));
  if(!candidate)continue;
  const prior=field.map(row=>row.points.findLast(p=>p.received_at===candidate.received_at));
  if(field.every((row,i)=>prior[i]?.source_time===candidate.source_time &&
     row.latest.segment!=null && prior[i].segment===row.latest.segment && validOdds(prior[i])))return prior.map(p=>p.low);
 }
 return null;
}

const horseNameOrder=new Intl.Collator('ja');
const horseNumber=row=>Number(row.s.selection);
const trendRank=trend=>trend?.direction==='down'?0:trend?.direction==='up'?1:2;
const orderValue={
 number:horseNumber,
 name:row=>row.s.horse_name||null,
 odds:(row,endpoint)=>row.s.latest?.[endpoint],
 forecast:row=>row.forecast,
 fall:row=>row.move?.fall,
 rise:row=>row.move?.rise,
 finish:row=>row.finish?.rank,
 final:(row,endpoint)=>row.final?.status==='active'?row.final[endpoint]:null
};

export function sortOddsRows(rows,sort,endpoint,demo){
 if(!sort){
  return rows.sort((a,b)=>trendRank(a.trend)-trendRank(b.trend) ||
   Math.abs(b.trend?.percent??0)-Math.abs(a.trend?.percent??0) ||
   (a.move?.fall??Infinity)-(b.move?.fall??Infinity) || (demo?horseNumber(a)-horseNumber(b):0));
 }
 const value=orderValue[sort.key],direction=sort.direction==='descending'?-1:1;
 return rows.sort((a,b)=>{
  const left=value(a,endpoint),right=value(b,endpoint);
  const leftMissing=sort.key==='name'?left===null:!Number.isFinite(left);
  const rightMissing=sort.key==='name'?right===null:!Number.isFinite(right);
  if(leftMissing!==rightMissing)return leftMissing?1:-1;
  if(!leftMissing){
   const order=sort.key==='name'?horseNameOrder.compare(left,right):left-right;
   if(order)return direction*order;
  }
  return horseNumber(a)-horseNumber(b);
 });
}
