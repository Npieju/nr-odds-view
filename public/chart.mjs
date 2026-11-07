const NS='http://www.w3.org/2000/svg';
const WIDTH=760;
const LEFT=48;
const RIGHT=WIDTH-28;
const COLORS={low:'#c9ed83',high:'#83c8ef'};

function node(tag,attributes={}){
 const element=document.createElementNS(NS,tag);
 for(const [key,value] of Object.entries(attributes))element.setAttribute(key,value);
 return element;
}
function text(value,x,y,className,anchor='middle'){
 const element=node('text',{x,y,class:className,'text-anchor':anchor});
 element.textContent=value;
 return element;
}
function xAt(at,start,close){return LEFT+(at-start)/(close-start)*(RIGHT-LEFT);}
function grid(x1,y1,x2,y2,major=false){
 return node('line',{x1,y1,x2,y2,stroke:major?'#667c70':'#34473c','stroke-dasharray':major?'4 3':'none'});
}

export function chartTimeAxis(){
 const axis=node('svg',{viewBox:`0 0 ${WIDTH} 22`,class:'chart-time-axis','aria-label':'各馬共通の時間軸'});
 const labels=['10分前','8分前','6分前','4分前','2分前','締切'];
 for(const [index,value] of labels.entries())axis.append(text(value,xAt(index,0,5),15,'chart-axis-label'));
 return axis;
}

export function oddsChart({samples,points,start,close,latest,market,relativeTime}){
 const endpoints=market==='place'?['low','high']:['low'];
 const height=market==='place'?82:68;
 const top=8,bottom=44,firstPriceY=58;
 const svg=node('svg',{viewBox:`0 0 ${WIDTH} ${height}`,class:'row-chart',role:'img','aria-label':'オッズ推移。横軸は締切までの時間、縦軸は倍率'});
 const current=latest && Date.parse(latest.received_at)>=start && Date.parse(latest.received_at)<close?latest:null;
 const values=[...points,...(current?[current]:[])].flatMap(point=>endpoints.map(key=>point[key]));
 const minimum=Math.min(...values),maximum=Math.max(...values);
 const padding=Math.max(.05,(maximum-minimum)*.08);
 const floor=minimum-padding,ceiling=maximum+padding;
 const y=value=>bottom-(value-floor)/(ceiling-floor)*(bottom-top);
 const x=at=>xAt(at,start,close);

 // The value strip is part of the plot. Its text shares each dot's exact x coordinate.
 svg.append(node('rect',{x:LEFT,y:bottom+1,width:RIGHT-LEFT,height:height-bottom-1,fill:'#1b2821'}));
 for(let step=0;step<=5;step++){
  const at=start+(close-start)*step/5;
  svg.append(grid(x(at),top,x(at),height-2));
 }
 for(const value of new Set([minimum,maximum])){
  svg.append(grid(LEFT,y(value),RIGHT,y(value),true));
  svg.append(text(value.toFixed(1),LEFT-5,y(value)+3,'chart-axis-label','end'));
 }
 for(const [line,key] of endpoints.entries()){
  let previous=null;
  for(const {at,point} of samples){
   const cx=x(at),priceY=firstPriceY+line*13;
   if(!point){
    previous=null;
    svg.append(text('—',cx,priceY,'chart-missing'));
    continue;
   }
   const cy=y(point[key]);
   if(previous?.segment===point.segment)svg.append(node('line',{x1:previous.x,y1:previous.y,x2:cx,y2:cy,stroke:COLORS[key],'stroke-width':1.7}));
   const dot=node('circle',{cx,cy,r:2.4,fill:COLORS[key]});
   const valueLabel=text(point[key].toFixed(1),cx,priceY,`chart-price chart-price-${key}`);
   for(const element of [dot,valueLabel]){
    const title=node('title');title.textContent=`${relativeTime(at)} ${point[key].toFixed(1)}倍`;element.append(title);
   }
   svg.append(dot,valueLabel);
   previous={x:cx,y:cy,segment:point.segment};
  }
  if(current)svg.append(node('circle',{cx:x(Date.parse(current.received_at)),cy:y(current[key]),r:3,fill:'#101719',stroke:'#fff','stroke-width':1.5}));
 }
 return svg;
}
