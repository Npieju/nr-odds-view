import {parseNarMeetings,parseNarRaces,parseNarRoster,parseNarOdds} from '../src/nar.mjs';
import {liveWindow} from '../src/live-window.mjs';
import {Store} from '../src/store.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

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
