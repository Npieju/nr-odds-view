import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {collectRaceOutcome,parseJraStandings,parseNarStandings} from '../src/outcomes.mjs';

const day='2028-01-03';
const names={'01':'架空馬甲','02':'架空馬乙','03':'架空馬丙'};
const race={race_id:'nar-20280103-31-09',meeting_date:day,venue_code:'31',race_number:9,
 scheduled_start_at:day+'T20:20:00+09:00',markets:[{selections:Object.entries(names).map(([selection,horse_name])=>({selection,horse_name}))}]};
const link='<a id="RaceList" href="../TodayRaceInfo/RaceList?k_raceDate=2028%2F01%2F03&amp;k_babaCode=31&amp;k_raceNo=9">当日メニュー</a>';
const heading='<h4>2028年1月3日（月） 高 知 第9競走';
const cell=(key,value)=>'<td class="'+key+'">'+value+'</td>';
const row=(...values)=>'<tr>'+values.join('')+'</tr>';
const plain=value=>'<td>'+value+'</td>';
const narFinishes=Object.values(names).map((name,i)=>row(cell('a',i===2?'取 消':'1'),cell('c',i+1),cell('d horseName',name))).join('');
const payout='<section class="newRefundTable"><table>'+row(cell('title','単勝'),cell('refundMoney','220円'))+'</table></section>';
const narResult=link+heading+'<span>競走成績</span></h4><section class="gradeTable"><table>'+narFinishes+'</table></section>';
const finalOdds=link+heading+' 20:20発走</h4><h4 class="odd_title">単勝・複勝 オッズ （最終）</h4>'+
 '<table class="odd_popular_table_02"><tr><th>馬番</th></tr>'+
 row(...['1','1','架空馬甲','2.2','1.1-','1.4'].map(plain))+
 row(...['2','2','架空馬乙','3.4','1.2-','1.7'].map(plain))+
 row(...['3','3','架空馬丙','','','','出走取消'].map(plain))+'</table>';

test('confirmed standings preserve dead heats and cancellations, and reject a wrong race or missing payout',()=>{
 assert.throws(()=>parseNarStandings(narResult,race,names),/払戻/);
 assert.throws(()=>parseNarStandings(narResult+payout,{...race,race_number:10},names),/照合/);
 const parsed=parseNarStandings(narResult+payout,race,names);
 assert.deepEqual(parsed.map(s=>[s.rank,s.status]),[[1,'finished'],[1,'finished'],[null,'取消']]);

 const jra={race_label:'架空のレース'};
 const jraResult='<h1>レース結果<span class="opt">'+jra.race_label+'</span></h1><div class="race_result_unit"><table>'+
  row(cell('place',1),cell('num',1),cell('horse',names['01']))+
  row(cell('place','中止'),cell('num',2),cell('horse',names['02']))+'</table></div>';
 const jraPayout='<li class="win"><div class="yen">220<span class="unit">円</span></div></li>';
 assert.throws(()=>parseJraStandings(jraResult,jra,{'01':names['01'],'02':names['02']}),/払戻/);
 assert.deepEqual(parseJraStandings(jraResult+jraPayout,jra,{'01':names['01'],'02':names['02']}).map(s=>s.status),['finished','中止']);
});

test('outcome collection waits for settlement, then accepts only final odds for the same roster',async()=>{
 const root=mkdtempSync(join(tmpdir(),'odds-outcome-'));
 let paid=false,final=false;
 const requested=[];
 const fetchImpl=async url=>{
  const result=url.pathname.endsWith('/RaceMarkTable');requested.push(result?'result':'odds');
  return new Response(result?narResult+(paid?payout:''):final?finalOdds:finalOdds.replace('（最終）','（20:17 現在）'));
 };
 try{
  await assert.rejects(collectRaceOutcome('nar',race,{root,fetchImpl}),/払戻/);
  assert.deepEqual(requested,['result']);
  paid=true;
  await assert.rejects(collectRaceOutcome('nar',race,{root,fetchImpl}),/最終/);
  final=true;
  const outcome=await collectRaceOutcome('nar',race,{root,fetchImpl});
  assert.equal(outcome.standings[0].rank,1);
  assert.equal(outcome.final_odds.place[0].high,1.4);
  assert.equal(outcome.final_odds.win[2].status,'withdrawn');
  assert.ok(Date.parse(outcome.odds_received_at)>=Date.parse(outcome.result_received_at));
 }finally{rmSync(root,{recursive:true,force:true});}
});
