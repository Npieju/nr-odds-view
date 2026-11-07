import {parseNarMeetings,parseNarRaces,parseNarRoster,parseNarOdds,narFastVenue,watchNar} from '../src/nar.mjs';
import {liveWindow} from '../src/live-window.mjs';
import {Store} from '../src/store.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const day='2028-01-03';
const query='k_raceDate=2028%2F01%2F03&amp;k_babaCode=31';
const raceQuery=query+'&amp;k_raceNo=9';
const link='<a id="RaceList" href="../TodayRaceInfo/RaceList?'+raceQuery+'">当日メニュー</a>';
const header=link+'<h4>2028年1月3日（月） 高 知 第9競走 20:20発走 </h4>';
const cells=values=>values.map(value=>'<td>'+value+'</td>').join('');
const row=(...values)=>'<tr>'+cells(values)+'</tr>';
const odds=(phase='20:17 現在',quoteRows=[row('1','1','架空馬甲','5.5','2.1-','3.7'),row('1','2','架空馬乙','','','','出走取消')])=>
 header+'<h4 class="odd_title">単勝・複勝　オッズ （'+phase+'）</h4>'+
 '<table class="odd_popular_table_02"><tr><th>馬番</th></tr>'+quoteRows.join('')+'</table>';
const attempts={started_at:day+'T20:17:45+09:00',received_at:day+'T20:17:47+09:00'};

function fixtureRace(){
 const [venue]=parseNarMeetings('TodayRaceInfoTop 本日のレース情報'+
  '<a href="/KeibaWeb/TodayRaceInfo/RaceList?'+query+'" class="courseName night">高知</a>'+
  '<a href="/KeibaWeb/TodayRaceInfo/RaceList?k_raceDate=2028%2F01%2F04&amp;k_babaCode=3" class="courseName">帯広ば</a>',day);
 const [race]=parseNarRaces('<section class="raceTable">当日メニュー'+
  row('9R','20:20','','','<a>架空競走</a>','','','','2','<a href=/KeibaWeb/TodayRaceInfo/OddsTanFuku?'+raceQuery+'>オッズ</a>')+'</section>',day,venue);
 const horse_names=parseNarRoster(header+
  '<tr><td class="horseNum">1</td><td><a class="horseName">架空馬甲</a></td></tr>'+
  '<tr><td class="horseNum">2</td><td><a class="horseName">架空馬乙</a></td></tr>',race);
 return {...race,horse_names,expected_selections:Object.keys(horse_names)};
}

test('NAR discovery, independent roster and pre-cutoff win/place use the normal graph contract',()=>{
 const race=fixtureRace(),store=new Store();
 try{
  assert.equal(race.race_id,'nar-20280103-31-09');
  assert.equal(race.sales_close_at,'2028-01-03T11:18:00.000Z');
  const snapshots=parseNarOdds(odds(),race,attempts);
  for(const snapshot of snapshots)store.ingest(snapshot,Buffer.from('synthetic'));
  const state=liveWindow(store,race,Date.parse(attempts.received_at));
  assert.deepEqual(state.markets.map(m=>m.observation_count),[1,1]);
  assert.equal(state.markets[1].selections[0].latest.high,3.7);
  assert.equal(state.markets[1].selections[1].latest,null);
  assert.equal(state.markets[0].source_time,day+'T20:17:00+09:00');
 }finally{store.close();}
});

test('NAR rejects final odds, cutoff receipts and missing or mismatched rows',()=>{
 const race=fixtureRace();
 assert.throws(()=>parseNarOdds(odds('最終'),race,attempts),/発売中/);
 assert.throws(()=>parseNarOdds(odds(),race,{...attempts,received_at:race.sales_close_at}),/締切/);
 assert.throws(()=>parseNarOdds(odds('20:18 現在'),race,attempts),/発表時刻/);
 assert.throws(()=>parseNarOdds(odds(undefined,[row('1','1','架空馬甲','5.5','2.1-','3.7')]),race,attempts),/欠落/);
 assert.throws(()=>parseNarOdds(odds().replace('20:20発走','20:25発走'),race,attempts),/予定発走/);
 assert.throws(()=>parseNarOdds(odds().replace('架空馬甲','別の馬'),race,attempts),/不一致/);
});

test('NAR accelerates only the nearest open cutoff within five minutes',()=>{
 const now=Date.parse(day+'T20:13:00+09:00');
 const near={venue_code:'31',sales_close_ms:now+300000},other={venue_code:'32',sales_close_ms:now+301000};
 assert.equal(narFastVenue([near,other],now-1),null);
 assert.equal(narFastVenue([other,near],now),'31');
 assert.equal(narFastVenue([near,other],near.sales_close_ms),'32');
 assert.equal(narFastVenue([near,other],other.sales_close_ms),null);
});

test('a slow venue does not delay the fastest last-five-minute NAR collector',async()=>{
 const start=Date.parse(day+'T20:13:59+09:00');
 let now=start;
 const root=mkdtempSync(join(tmpdir(),'odds-fast-nar-')),store=new Store(),controller=new AbortController();
 const requests=new Map([['31',[]],['32',[]]]);
 const delayed=[];
 const roster='<tr><td class="horseNum">1</td><td><a class="horseName">架空馬甲</a></td></tr>'+
  '<tr><td class="horseNum">2</td><td><a class="horseName">架空馬乙</a></td></tr>';
 const menu='TodayRaceInfoTop 本日のレース情報'+['31','32'].map(code=>
  '<a href="/KeibaWeb/TodayRaceInfo/RaceList?'+query.replace('=31','='+code)+'" class="courseName">'+code+'</a>').join('');
 const latest=new Map();
 const fetchImpl=async url=>{
  const page=url.pathname.split('/').at(-1),code=url.searchParams.get('k_babaCode');
  const q=raceQuery.replace('=31','='+code),modify=html=>html.replaceAll('=31','='+code).replace('20:20発走',code==='31'?'20:20発走':'20:21発走');
  if(page==='TodayRaceInfoTop')return new Response(menu);
  if(page==='RaceList')return new Response('<section class="raceTable">当日メニュー'+
   row('9R',code==='31'?'20:20':'20:21','','','架空競走','','','','2','<a href=/KeibaWeb/TodayRaceInfo/OddsTanFuku?'+q+'>オッズ</a>')+'</section>');
  if(page==='DebaTable')return new Response(modify(header+roster));
  assert.equal(page,'OddsTanFuku');
  requests.get(code).push(now);
  if(code==='32')await new Promise(resolve=>delayed.push({resolve,until:now+4800}));
  return new Response(modify(odds('20:13 現在')));
 };
 const wait=async ms=>{
  now+=ms;
  if(now>=start+12500)controller.abort();
  for(const task of delayed)if(task.until<=now || controller.signal.aborted)task.resolve();
  await new Promise(resolve=>setImmediate(resolve));
 };
 try{
  await watchNar({root,store,output:join(root,'nar-live.json'),signal:controller.signal,clock:()=>now,fetchImpl,wait,
   intervalMs:5000,finalIntervalMs:2000,write:(_path,state)=>{
    for(const venue of state.venues)latest.set(venue.venue_code,venue);
   }});
  const [fast,slow]=[requests.get('31'),requests.get('32')];
  assert.ok(fast.length>=6 && slow.length>=2);
  assert.ok(fast.slice(1).every((at,i)=>at-fast[i]>=2000 && at-fast[i]<2400));
  assert.ok(slow.slice(1).every((at,i)=>at-slow[i]>=5000));
  assert.ok(fast[1]<slow[0]+4800);
  assert.equal(latest.get('31').poll_interval_ms,2000);
  assert.equal(latest.get('32').poll_interval_ms,5000);
 }finally{
  store.close();
  rmSync(root,{recursive:true,force:true});
 }
});
