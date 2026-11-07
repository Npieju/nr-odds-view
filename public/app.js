const $=id=>document.getElementById(id);
let data=null,market='win',endpoint='low',fetchFailed=false;
const url=new URL(location.href).searchParams.get('data')||'data/live.json';
const time=t=>t?new Date(t).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false}):'—';
const labels={no_data:'未受信',sales_closed:'発売締切済み',waiting:'収集開始待ち',collector_stale:'受信が停止しています',source_stale_or_unknown:'元データが古い／時刻不明',partial_window:'5分間の一部のみ観測',collection_gap:'取得に欠損あり',source_time_regression:'発表時刻が逆行',series_interrupted:'欠損・取消等で系列を分割'};
function chart(points,start,close){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 180 45');svg.setAttribute('aria-label','受信時刻によるオッズ推移');
 if(!points.length)return svg;
 const values=points.map(p=>p[endpoint]), min=Math.min(...values), max=Math.max(...values),segments=new Map();
 for(const p of points){if(!segments.has(p.segment))segments.set(p.segment,[]);segments.get(p.segment).push(`${2+176*(Date.parse(p.received_at)-start)/(close-start)},${40-35*(p[endpoint]-min)/(max-min||1)}`);}
 for(const coords of segments.values()){const line=document.createElementNS(svg.namespaceURI,'polyline');line.setAttribute('points',coords.join(' '));line.setAttribute('stroke','#c9ed83');line.setAttribute('stroke-width','2');line.setAttribute('fill','none');svg.append(line);}
 return svg;
}
function render(){
 if(!data?.generated_at){$('quality').textContent=fetchFailed?'表示データに接続できません':'収集データはまだありません';return;}
 const now=Date.now(),close=Date.parse(data.sales_close_at),remaining=Math.max(0,Math.ceil((close-now)/1000));
 $('race').textContent=data.race_label||data.race_id;
 $('count').textContent=`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`;
 const m=data.markets.find(m=>m.market===market);if(!m)return;
 const stale=now-Date.parse(data.generated_at)>30000;
 const flags=[...m.quality_flags];if(stale)flags.push('collector_stale');if(now>=close)flags.push('sales_closed');
 $('mode').textContent=fetchFailed?'表示データへの接続失敗':now>=close?'発売締切済み':flags.length?'観測状況を確認':'観測中';
 $('quality').textContent=[fetchFailed?'表示データの取得失敗':null,...new Set(flags.map(f=>labels[f]||f))].filter(Boolean).join(' / ')||'最新の観測データを表示中';
 const age=m.source_time?Math.max(0,Math.floor((now-Date.parse(m.source_time))/1000)):null;
 const receiptAge=m.received_at?Math.max(0,Math.floor((now-Date.parse(m.received_at))/1000)):null;
 $('times').textContent=`発表 ${time(m.source_time)}（分精度${age===null?'':`・古さ ${Math.max(0,age-60)}〜${age}秒`}） / 受信 ${time(m.received_at)}${receiptAge===null?'':`（${receiptAge}秒前）`}\n発売締切 ${time(data.sales_close_at)}${data.close_basis==='scheduled_rule_not_observed'?'（通常規則からの予定）':''} / 予定発走 ${time(data.scheduled_start_at)} / ${data.sales_channel||''}`;
 $('endpoint-wrap').hidden=market!=='place';$('rows').replaceChildren();
 const selections=[...m.selections].sort((a,b)=>Math.abs(b.extrema[endpoint].fall?.pct??0)-Math.abs(a.extrema[endpoint].fall?.pct??0));
 for(const s of selections){
  const tr=document.createElement('tr'),e=s.extrema[endpoint],last=s.latest;
  const current=m.received_at && last?.received_at===m.received_at;
  const quote=!last?'—':`${last.low.toFixed(1)}${market==='place'?'–'+last.high.toFixed(1):''}${current?'':'（過去値）'}`;
  for(const [i,value] of [s.selection,quote,null,e.fall?e.fall.pct.toFixed(1)+'%':'—',e.rise?'+'+e.rise.pct.toFixed(1)+'%':'—',e.fall?`${time(e.fall.from_received_at)} → ${time(e.fall.to_received_at)}`:'—'].entries()){
   const td=document.createElement('td');if(i===2)td.append(chart(s.points,Date.parse(data.window_start_at),close));else td.textContent=value;
   if(i===3)td.className='fall';if(i===4)td.className='rise';tr.append(td);
  }$('rows').append(tr);
 }
}
document.querySelectorAll('[data-market]').forEach(b=>b.onclick=()=>{market=b.dataset.market;document.querySelectorAll('[data-market]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();});
$('endpoint').onchange=e=>{endpoint=e.target.value;render();};
async function poll(){try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error();data=await r.json();fetchFailed=false;}catch{fetchFailed=true;}render();setTimeout(poll,1000);}poll();setInterval(render,1000);
