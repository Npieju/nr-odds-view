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
