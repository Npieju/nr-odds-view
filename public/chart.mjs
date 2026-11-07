const NS='http://www.w3.org/2000/svg';
const make=(tag,attrs={})=>{
 const node=document.createElementNS(NS,tag);
 for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);
 return node;
};
const label=(text,attrs)=>{const node=make('text',attrs);node.textContent=text;return node;};
const colors={low:'#c9ed83',high:'#83c8ef'};
export function oddsChart({samples,points,start,close,latest,market,endpoint,relativeTime,readout,width=660}){
 const plot={left:43,right:width-30,top:30,bottom:192};
 const svg=make('svg',{viewBox:`0 0 ${width} 226`,role:'img','aria-label':'締切前10分のオッズ推移。横軸は締切までの時間、縦軸はオッズ倍率'});
 const endpoints=market==='place'?['low','high']:['low'];
 const current=latest && Date.parse(latest.received_at)>=start && Date.parse(latest.received_at)<close?latest:null;
 const values=[...points,...(current?[current]:[])].flatMap(p=>endpoints.map(key=>p[key]));
 const minimum=values.length?Math.min(...values):1,maximum=values.length?Math.max(...values):2;
 const padding=Math.max(.1,(maximum-minimum)*.08);
 const floor=Math.max(0,minimum-padding),ceiling=maximum+padding;
 const x=t=>plot.left+(t-start)/(close-start)*(plot.right-plot.left);
 const y=value=>plot.bottom-(value-floor)/(ceiling-floor)*(plot.bottom-plot.top);
 const grid=(x1,y1,x2,y2,guide=false)=>make('line',{x1,y1,x2,y2,stroke:guide?'#80938a':'#33443c','stroke-dasharray':guide?'4 4':'none'});
 svg.append(label('倍率',{x:5,y:15,class:'axis'}));
 for(let step=0;step<=5;step++){
  const t=start+(close-start)*step/5;
  svg.append(grid(x(t),plot.top,x(t),plot.bottom));
  svg.append(label(relativeTime(t),{x:x(t),y:211,'text-anchor':'middle',class:'axis'}));
 }
 for(const value of [...new Set([minimum,(minimum+maximum)/2,maximum])]){
  svg.append(grid(plot.left,y(value),plot.right,y(value)));
  svg.append(label(value.toFixed(1),{x:37,y:y(value)+4,'text-anchor':'end',class:'axis'}));
 }
 if(!values.length){svg.append(label('表示できる観測値がありません',{x:width/2,y:115,'text-anchor':'middle',class:'axis'}));return svg;}
 const reference=points.map(p=>p[endpoint]);
 if(reference.length)for(const value of new Set([Math.min(...reference),Math.max(...reference)]))svg.append(grid(plot.left,y(value),plot.right,y(value),true));
 for(const key of endpoints){
  let previous=null;
  for(const sample of samples){
   if(!sample.point){previous=null;continue;}
   const cx=x(sample.at),cy=y(sample.point[key]);
   if(previous?.segment===sample.point.segment)svg.append(make('line',{x1:previous.x,y1:previous.y,x2:cx,y2:cy,stroke:colors[key],'stroke-width':2}));
   const dot=make('circle',{cx,cy,r:3,fill:colors[key],tabindex:0});
   const value=`${relativeTime(sample.at)}  ${sample.point.low.toFixed(1)}${market==='place'?'–'+sample.point.high.toFixed(1):''}倍`;
   const title=make('title');title.textContent=value;dot.append(title);
   for(const event of ['focus','pointerenter','click'])dot.addEventListener(event,()=>{readout.textContent=value;});
   svg.append(dot);previous={x:cx,y:cy,segment:sample.point.segment};
  }
  if(current)svg.append(make('circle',{cx:x(Date.parse(current.received_at)),cy:y(current[key]),r:4,fill:'#101719',stroke:'#fff','stroke-width':2}));
 }
 return svg;
}
