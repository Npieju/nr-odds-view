import {samples30} from './history.mjs';
const $=id=>document.getElementById(id);
let data=null,feed=null,selectedVenue=null,market='win',endpoint='low',fetchFailed=false;
try{selectedVenue=localStorage.getItem('odds-venue');}catch{}
const local=['localhost','127.0.0.1'].includes(location.hostname);
const url=new URL(location.href).searchParams.get('data')||(local?'data/live.json':'https://nr-odds-live-feed.goodthinker.chatgpt.site/api/live');
const time=t=>t?new Date(t).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false}):'—';
const labels={no_data:'未受信',sales_closed:'発売締切済み',waiting:'10分間のグラフ開始前',collector_stale:'受信が停止しています',source_stale_or_unknown:'元データが古い／時刻不明',partial_window:'10分間の一部のみ観測',collection_gap:'取得に欠損あり',source_time_regression:'発表時刻が逆行',series_interrupted:'欠損・取消等で系列を分割'};
function chart(points,start,close){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 180 45');svg.setAttribute('aria-label','受信時刻によるオッズ推移');
 if(!points.length)return svg;
 const values=points.map(p=>p[endpoint]), min=Math.min(...values), max=Math.max(...values),segments=new Map();
 for(const p of points){if(!segments.has(p.segment))segments.set(p.segment,[]);segments.get(p.segment).push(`${2+176*(Date.parse(p.received_at)-start)/(close-start)},${40-35*(p[endpoint]-min)/(max-min||1)}`);}
 for(const coords of segments.values()){const line=document.createElementNS(svg.namespaceURI,'polyline');line.setAttribute('points',coords.join(' '));line.setAttribute('stroke','#c9ed83');line.setAttribute('stroke-width','2');line.setAttribute('fill','none');svg.append(line);}
 return svg;
}
function render(){
 const venues=feed?.venues??[];
 if(venues.length){
  if(!venues.some(v=>v.venue_code===selectedVenue))selectedVenue=venues[0].venue_code;
  const signature=venues.map(v=>v.venue_code+v.current?.race_id+v.finished).join('|');
  if($('venues').dataset.signature!==signature){
   $('venues').replaceChildren();$('venues').dataset.signature=signature;
   for(const v of venues){const b=document.createElement('button');b.type='button';b.dataset.venue=v.venue_code;b.setAttribute('role','tab');
    const race=v.current?.race_label?.match(/ (\d+)レース$/)?.[1];b.textContent=v.venue+(v.finished?' · 終了':race?' · '+race+'R':'');
    b.onclick=()=>{selectedVenue=v.venue_code;try{localStorage.setItem('odds-venue',selectedVenue);}catch{}render();};$('venues').append(b);}
  }
  $('venues').querySelectorAll('button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.venue===selectedVenue)));
  const selected=venues.find(v=>v.venue_code===selectedVenue);data=selected.current;
  $('meeting').textContent=`${feed.meeting_date} / ${venues.length}場開催 · ${selected.venue}${selected.finished?'の本日分は終了':''}${selected.error?' / '+selected.error:''}`;
 }else if(Array.isArray(feed?.venues)){
  data=null;$('venues').replaceChildren();delete $('venues').dataset.signature;
  $('meeting').textContent=`${feed.meeting_date} / 当日の開催情報を確認中`;
 }else{data=feed;$('meeting').textContent='';}
 if(!data?.generated_at){
  $('rows').replaceChildren();$('count').textContent='—';
  const connected=Array.isArray(feed?.venues);
  $('mode').textContent=fetchFailed?'接続失敗':connected?'接続済み・開催情報待ち':'ライブ配信未接続';
  $('race').textContent='直前オッズ観測';
  $('times').textContent=connected?'本日の開催が見つかると自動で表示します。':data?.connection_message||'コレクターからの実データを待っています。';
  $('quality').textContent=fetchFailed?'表示データに接続できません':'ライブデータはまだ表示されていません';return;
 }
 const now=Date.now(),close=Date.parse(data.sales_close_at),remaining=Math.max(0,Math.ceil((close-now)/1000));
 $('race').textContent=data.race_label||data.race_id;
 $('count').textContent=`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`;
 const m=data.markets.find(m=>m.market===market);if(!m)return;
 const stale=now-Date.parse(feed.generated_at)>30000;
 const flags=[...m.quality_flags];if(stale)flags.push('collector_stale');if(now>=close)flags.push('sales_closed');
 $('mode').textContent=fetchFailed?'表示データへの接続失敗':now>=close?'発売締切済み':flags.includes('waiting')?'現在オッズを更新中':flags.length?'観測状況を確認':'観測中';
 $('quality').textContent=[fetchFailed?'表示データの取得失敗':null,...new Set(flags.map(f=>labels[f]||f))].filter(Boolean).join(' / ')||'最新の観測データを表示中';
 const age=m.source_time?Math.max(0,Math.floor((now-Date.parse(m.source_time))/1000)):null;
 const receiptAge=m.received_at?Math.max(0,Math.floor((now-Date.parse(m.received_at))/1000)):null;
 $('times').textContent=`発表 ${time(m.source_time)}（分精度${age===null?'':`・古さ ${Math.max(0,age-60)}〜${age}秒`}） / 受信 ${time(m.received_at)}${receiptAge===null?'':`（${receiptAge}秒前）`}\n発売締切 ${time(data.sales_close_at)}${data.close_basis==='scheduled_rule_not_observed'?'（通常規則からの予定）':''} / 予定発走 ${time(data.scheduled_start_at)} / ${data.sales_channel||''}`;
 $('endpoint-wrap').hidden=market!=='place';$('rows').replaceChildren();
 const start=Date.parse(data.window_start_at),until=Math.min(now,close-1);
 document.querySelectorAll('thead .history-tick').forEach(n=>n.remove());
 const ticks=samples30([],start,until);
 for(const tick of ticks){const th=document.createElement('th');th.className='history-tick';th.textContent=time(tick.at);document.querySelector('thead tr').append(th);}
 const selections=[...m.selections].sort((a,b)=>Math.abs(b.extrema[endpoint].fall?.pct??0)-Math.abs(a.extrema[endpoint].fall?.pct??0));
 for(const s of selections){
  const tr=document.createElement('tr'),e=s.extrema[endpoint],last=s.latest;
  const current=m.received_at && last?.received_at===m.received_at;
  const quote=!last?'—':`${last.low.toFixed(1)}${market==='place'?'–'+last.high.toFixed(1):''}${current?'':'（過去値）'}`;
  const samples=samples30(s.points,start,until);
  const graphPoints=samples.map((sample,i)=>sample.point?{...sample.point,received_at:new Date(sample.at).toISOString(),segment:`${sample.point.segment}/${samples.slice(0,i).filter(x=>!x.point).length}`} :null).filter(Boolean);
  for(const [i,value] of [s.selection,s.horse_name||'馬名未取得',quote,null,e.fall?e.fall.pct.toFixed(1)+'%':'—',e.rise?'+'+e.rise.pct.toFixed(1)+'%':'—'].entries()){
   const td=document.createElement('td');if(i===3)td.append(chart(graphPoints,start,close));else td.textContent=value;
   if(i===4)td.className='fall';if(i===5)td.className='rise';tr.append(td);
  }
  for(const sample of samples){const td=document.createElement('td'),p=sample.point;td.className='history-value';td.textContent=p?`${p.low.toFixed(1)}${market==='place'?'–'+p.high.toFixed(1):''}`:'—';if(p)td.title=`受信 ${time(p.received_at)} / 発表 ${time(p.source_time)}`;tr.append(td);}
  $('rows').append(tr);
 }
}
document.querySelectorAll('[data-market]').forEach(b=>b.onclick=()=>{market=b.dataset.market;document.querySelectorAll('[data-market]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();});
$('endpoint').onchange=e=>{endpoint=e.target.value;render();};
async function poll(){try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error();feed=await r.json();fetchFailed=false;}catch{fetchFailed=true;}render();setTimeout(poll,1000);}poll();setInterval(render,1000);
