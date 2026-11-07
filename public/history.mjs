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
