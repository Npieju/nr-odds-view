import {samples30,currentMoves,timeBeforeClose} from './history.mjs';
import {oddsChart} from './chart.mjs';
const $=id=>document.getElementById(id);
let data=null,feed=null,selectedVenue=null,market='win',endpoint='low',fetchFailed=false;
try{selectedVenue=localStorage.getItem('odds-venue');}catch{}
const local=['localhost','127.0.0.1'].includes(location.hostname);
const url=new URL(location.href).searchParams.get('data')||(local?'data/live.json':'https://nr-odds-live-feed.goodthinker.chatgpt.site/api/live');
const time=t=>t?new Date(t).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false}):'—';
const historyApi='https://nr-odds-live-feed.goodthinker.chatgpt.site/api/history';
let archive=null,historyMessage='',historyRequest=0,historyLoading=false,historyRefreshing=false;
let detailRace=null,detailHorse=null,detailVersion='';
const isHistory=()=>location.hash==='#history';
const labels={no_data:'未受信',sales_closed:'発売締切済み',waiting:'10分間のグラフ開始前',collector_stale:'受信が停止しています',source_stale_or_unknown:'元データが古い／時刻不明',partial_window:'10分間の一部のみ観測',collection_gap:'取得に欠損あり',source_time_regression:'発表時刻が逆行',series_interrupted:'欠損・取消等で系列を分割'};
async function getJSON(url){
 const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('取得できませんでした');
 return response.json();
}
function fillSelect(select,options){
 select.replaceChildren(...options.map(([value,label])=>new Option(label,value)));
}
async function loadHistory(level){
 const request=++historyRequest;
 const active=()=>request===historyRequest && isHistory();
 historyLoading=true;
 archive=null;historyMessage='履歴を読み込み中';render();
 try{
  if(level==='dates'){
   const {dates}=await getJSON(historyApi);if(!active())return;
   const previous=$('history-date').value;
   fillSelect($('history-date'),dates.map(date=>[date,date]));
   if(dates.includes(previous))$('history-date').value=previous;
  }
  if(level!=='race'){
   const date=$('history-date').value;
   const {races}=date?await getJSON(`${historyApi}?date=${date}`):{races:[]};if(!active())return;
   const previous=$('history-race').value;
   fillSelect($('history-race'),races.map(r=>[r.race_id,`${r.venue} ${r.race_number}R`]));
   if(races.some(r=>r.race_id===previous))$('history-race').value=previous;
   else if(races.length)$('history-race').selectedIndex=races.length-1;
  }
  const id=$('history-race').value;
  const value=id?await getJSON(`${historyApi}/${encodeURIComponent(id)}`):null;
  if(!active())return;
  archive=value;historyMessage=value?'':'保存済みのレースがありません';
 }catch(error){if(!active())return;historyMessage=`履歴を表示できません · ${error.message}`;}
 finally{if(request===historyRequest)historyLoading=false;}
 render();
}
async function refreshHistoryIndex(){
 if(!isHistory() || historyLoading || historyRefreshing)return;
 if(!archive){await loadHistory('dates');return;}
 historyRefreshing=true;
 const request=historyRequest,date=$('history-date').value,race=$('history-race').value;
 try{
  const [{dates},{races}]=await Promise.all([getJSON(historyApi),getJSON(`${historyApi}?date=${date}`)]);
  if(request!==historyRequest || !isHistory())return;
  const options=[[$('history-date'),dates.map(d=>[d,d]),date],[$('history-race'),races.map(r=>[r.race_id,`${r.venue} ${r.race_number}R`]),race]];
  for(const [select,items,selected] of options){
   if(select.options.length===items.length && items.every(([value],i)=>select.options[i].value===value))continue;
   fillSelect(select,items);
   if(items.some(([value])=>value===selected))select.value=selected;
  }
 }catch{/* Keep the open archive available during a transient network error. */}
 finally{historyRefreshing=false;}
}
function showDetail(selection){
 detailRace=data.race_id;detailHorse=selection;detailVersion='';
 $('detail').showModal();
 renderDetail(data.markets.find(m=>m.market===market),Date.now());
}
function renderDetail(m,now){
 if(!$('detail').open)return;
 const selection=m.selections.find(s=>s.selection===detailHorse);
 if(data.race_id!==detailRace || !selection){$('detail').close();return;}
 const close=Date.parse(data.sales_close_at),start=Date.parse(data.window_start_at);
 const until=Math.min(now,close-1);
 const version=[detailRace,detailHorse,market,endpoint,m.received_at,Math.floor((until-start)/30000)].join('/');
 if(version===detailVersion)return;
 detailVersion=version;
 const samples=samples30(selection.points,start,until);
 const latest=selection.latest;
 const value=p=>p?`${p.low.toFixed(1)}${market==='place'?'–'+p.high.toFixed(1):''}`:'—';
 const values=selection.points.map(p=>p[endpoint]);
 $('detail-title').textContent=`${selection.selection} ${selection.horse_name||'馬名未取得'} · ${market==='win'?'単勝':'複勝'}`;
 const range=values.length?`最高 ${Math.max(...values).toFixed(1)} / 最低 ${Math.min(...values).toFixed(1)}`:'最高 — / 最低 —';
 $('detail-summary').textContent=`${isHistory()?'最後の観測':'現在'} ${value(latest)}倍 · ${range}${market==='place'?`（${endpoint==='low'?'下限':'上限'}）`:''}`;
 $('chart-legend').textContent=market==='place'?'緑 下限 ／ 青 上限 ／ ○ 最後の受信':'緑 単勝 ／ ○ 最後の受信';
 $('chart-readout').textContent='';
 const relativeTime=at=>timeBeforeClose(at,close);
 const width=Math.max(340,Math.min(660,$('detail-chart').clientWidth||660));
 $('detail-chart').replaceChildren(oddsChart({samples,points:selection.points,start,close,latest,market,endpoint,relativeTime,readout:$('chart-readout'),width}));
 $('detail-values').replaceChildren(...samples.map(({at,point})=>{
  const entry=document.createElement('div'),clock=document.createElement('time'),price=document.createElement('strong');
  clock.textContent=relativeTime(at);price.textContent=value(point);entry.append(clock,price);
  if(point)entry.title=`受信 ${time(point.received_at)} / 発表 ${time(point.source_time)}`;
  return entry;
 }));
}
function render(){
 const archived=isHistory();
 $('history-controls').hidden=!archived;$('venues').hidden=archived;
 $('history-link').setAttribute('aria-current',archived?'page':'false');
 $('latest-link').setAttribute('aria-current',archived?'false':'page');
 $('odds-heading').textContent=archived?'最後の観測値':'現在オッズ';
 const venues=feed?.venues??[];
 if(archived){data=archive;$('meeting').textContent=archive?.meeting_date??'';}
 else if(venues.length){
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
  if($('detail').open)$('detail').close();
  $('rows').replaceChildren();delete $('rows').dataset.version;$('count').textContent='—';
  if(archived){$('mode').textContent='履歴';$('race').textContent='保存済みのレース';$('times').textContent='';$('quality').textContent=historyMessage;return;}
  const connected=Array.isArray(feed?.venues);
  $('mode').textContent=fetchFailed?'接続失敗':connected?'接続済み・開催情報待ち':'ライブ配信未接続';
  $('race').textContent='直前オッズ観測';
  $('times').textContent=connected?'本日の開催が見つかると自動で表示します。':data?.connection_message||'コレクターからの実データを待っています。';
  $('quality').textContent=fetchFailed?'表示データに接続できません':'ライブデータはまだ表示されていません';return;
 }
 const close=Date.parse(data.sales_close_at),now=archived?close:Date.now(),remaining=Math.max(0,Math.ceil((close-now)/1000));
 $('race').textContent=data.race_label||data.race_id;
 $('count').textContent=archived?'終了':`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`;
 const m=data.markets.find(m=>m.market===market);if(!m)return;
 const stale=!archived && now-Date.parse(feed.generated_at)>30000;
 const flags=[...m.quality_flags];if(stale)flags.push('collector_stale');if(now>=close)flags.push('sales_closed');
 $('mode').textContent=archived?'履歴 · 締切前の観測':fetchFailed?'表示データへの接続失敗':now>=close?'発売締切済み':flags.includes('waiting')?'現在オッズを更新中':flags.length?'観測状況を確認':'観測中';
 $('quality').textContent=[!archived&&fetchFailed?'表示データの取得失敗':null,...new Set(flags.map(f=>labels[f]||f))].filter(Boolean).join(' / ')||'最新の観測データを表示中';
 const age=m.source_time?Math.max(0,Math.floor((now-Date.parse(m.source_time))/1000)):null;
 const receiptAge=m.received_at?Math.max(0,Math.floor((now-Date.parse(m.received_at))/1000)):null;
 $('times').textContent=`発表 ${time(m.source_time)}（分精度${age===null?'':`・${archived?'締切時の':''}古さ ${Math.max(0,age-60)}〜${age}秒`}） / 受信 ${time(m.received_at)}${receiptAge===null?'':`（${archived?'締切':''}${receiptAge}秒前）`}\n発売締切 ${time(data.sales_close_at)}${data.close_basis==='scheduled_rule_not_observed'?'（通常規則からの予定）':''} / 予定発走 ${time(data.scheduled_start_at)} / ${data.sales_channel||''}`;
 $('endpoint-wrap').hidden=market!=='place';
 renderDetail(m,now);
 const rowVersion=[archived,data.race_id,market,endpoint,m.received_at,m.selections.length,m.observation_count].join('/');
 if($('rows').dataset.version===rowVersion)return;
 $('rows').dataset.version=rowVersion;$('rows').replaceChildren();
 const selections=m.selections.map(s=>{
  const current=Boolean(m.received_at && s.latest?.received_at===m.received_at);
  return {s,current,move:current?currentMoves(s.points,s.latest,endpoint):null};
 }).sort((a,b)=>(a.move?.fall??Infinity)-(b.move?.fall??Infinity));
 for(const {s,current,move} of selections){
  const tr=document.createElement('tr'),last=s.latest;
  const quote=!last?'—':`${last.low.toFixed(1)}${market==='place'?'–'+last.high.toFixed(1):''}${current?'':'（過去値）'}`;
  for(const [i,value] of [s.selection,s.horse_name||'馬名未取得',quote,move?move.fall.toFixed(1)+'%':'—',move?(move.rise>0?'+':'')+move.rise.toFixed(1)+'%':'—'].entries()){
   const td=document.createElement('td');td.textContent=value;
   if(i===3)td.className='fall';if(i===4)td.className='rise';tr.append(td);
  }
  const cell=document.createElement('td'),button=document.createElement('button');
  button.textContent='開く';button.className='open-chart';button.disabled=!s.points.length;
  button.setAttribute('aria-label',`${s.horse_name||s.selection}の推移を開く`);button.onclick=()=>showDetail(s.selection);
  cell.append(button);tr.append(cell);
  $('rows').append(tr);
 }
}
document.querySelectorAll('[data-market]').forEach(b=>b.onclick=()=>{market=b.dataset.market;document.querySelectorAll('[data-market]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();});
$('endpoint').onchange=e=>{endpoint=e.target.value;render();};
$('history-date').onchange=()=>loadHistory('day');
$('history-race').onchange=()=>loadHistory('race');
function changePage(){
 if($('detail').open)$('detail').close();
 if(isHistory())loadHistory('dates');else render();
}
window.addEventListener('hashchange',changePage);changePage();
setInterval(refreshHistoryIndex,15000);
async function poll(){try{feed=await getJSON(url);fetchFailed=false;}catch{fetchFailed=true;}if(!isHistory())render();setTimeout(poll,1000);}poll();setInterval(()=>{if(!isHistory())render();},1000);
