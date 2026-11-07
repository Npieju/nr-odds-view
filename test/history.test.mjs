import test from 'node:test';import assert from 'node:assert/strict';import {samples30} from '../public/history.mjs';import {Store} from '../src/store.mjs';import {liveWindow} from '../src/live-window.mjs';
const start=Date.parse('2028-01-03T04:00:00Z');const point=(ms,low)=>({received_at:new Date(start+ms).toISOString(),low,high:low,segment:0});
test('30-second values use receipts available at boundary and leave long gaps empty',()=>{
 const s=samples30([point(1000,2),point(29000,3),point(31000,4)],start,start+120000);
 assert.deepEqual(s.map(x=>x.point?.low??null),[null,3,4,null,null]);assert.equal(s[1].at,start+30000);
});
test('default graph starts ten minutes before cutoff and separates latest from sampled values',()=>{
 const store=new Store();try{
 const t=new Date(start).toISOString(),c={race_id:'synthetic',sales_close_at:new Date(start+600000).toISOString(),expected_selections:['01'],horse_names:{'01':'架空馬'}};
 store.ingest({source:'jra-web',race_id:'synthetic',market:'win',phase:'interim',received_at:t,request_started_at:t,source_time:t,time_precision:'minute',expected_selections:['01'],quotes:[{selection:'01',status:'active',low:2,high:2}]},Buffer.from('synthetic'));
 const r=liveWindow(store,c,start+10000);assert.equal(r.window_start_at,t);assert.equal(r.markets[0].selections[0].points.length,1);assert.equal(r.markets[0].selections[0].latest.low,2);assert.ok(!r.markets[0].quality_flags.includes('waiting'));
 }finally{store.close();}
});

import {currentMoves} from '../public/history.mjs';
test('current comparison follows recovery rather than reporting the past maximum drawdown',()=>{
 const series=[point(0,10),point(10000,5),point(20000,9),point(30000,20)];
 assert.deepEqual(currentMoves(series,series[2],'low'),{fall:-10,rise:80});
 assert.deepEqual(currentMoves(series,series[1],'low'),{fall:-50,rise:0});
});
test('current comparison needs a previous value in the same uninterrupted segment',()=>{
 const first=point(0,10),recent={...point(60000,5),segment:1},latest={...point(70000,8),segment:1};
 assert.equal(currentMoves([first,recent],recent,'low'),null);
 assert.deepEqual(currentMoves([first,recent,latest],latest,'low'),{fall:0,rise:60});
});

import {timeBeforeClose} from '../public/history.mjs';
test('relative labels agree for races held at different times',()=>{
 for(const close of [start+600000,start+3600000]){
  assert.equal(timeBeforeClose(close-600000,close),'10分前');
  assert.equal(timeBeforeClose(close-480000,close),'8分前');
  assert.equal(timeBeforeClose(close-90000,close),'1分30秒前');
  assert.equal(timeBeforeClose(close,close),'締切');
 }
});

import {replayFrame} from '../public/demo.mjs';
test('replay exposes only recorded receipts up to its position and before cutoff',()=>{
 const points=[point(-1000,10),point(311,5),point(10100,4),point(599000,3),point(600000,2)];
 const archive={race_id:'archive-fixture',outcome:{standings:[]},window_start_at:new Date(start).toISOString(),
  sales_close_at:new Date(start+600000).toISOString(),markets:[{
   market:'win',quality_flags:['sales_closed'],selections:[
    {selection:'01',horse_name:'架空馬',points,latest:points.at(-1)},
    {selection:'02',points:points.slice(0,2),latest:points[1]}
   ]
  }]};
 const initial=replayFrame(archive,0).markets[0];
 assert.equal(initial.received_at,null);
 assert.equal(initial.selections[0].latest,null);
 const early=replayFrame(archive,10).markets[0];
 assert.equal(early.observation_count,1);
 assert.deepEqual(early.selections[0].points,[points[1]]);
 assert.equal(early.selections[0].horse_name,'架空馬');
 const middle=replayFrame(archive,11).markets[0];
 assert.equal(middle.observation_count,2);
 assert.equal(middle.received_at,points[2].received_at);
 assert.equal(middle.selections[1].latest,points[1]);
 assert.deepEqual(middle.quality_flags,[]);
 const end=replayFrame(archive,601);
 assert.equal(end.generated_at,archive.sales_close_at);
 assert.equal('outcome' in end,false);
 assert.equal(end.markets[0].selections[0].latest,points[3]);
 assert.equal(archive.markets[0].selections[0].latest,points[4]);
});

import {marketTrends,trendQuoteFresh} from '../public/history.mjs';
function trendMarket(series,market='win'){
 const selections=series.map((prices,index)=>{
  const points=prices.flatMap((price,minute)=>[10000,20000].map(delay=>{
   const [low,high]=Array.isArray(price)?price:[price,price];
   return {...point(minute*60000+delay,low),high,source_time:new Date(start+minute*60000).toISOString()};
  }));
  return {selection:String(index+1),points,latest:{...points.at(-1)}};
 });
 const {received_at,source_time}=selections[0].latest;
 return {market,received_at,source_time,selections};
}

test('trend markers require a sustained move and exclude field-wide drift and reversals',()=>{
 const m=trendMarket([[10,9.5,9,8.8],[10,10.5,11,12],[10,10,10,8],[10,9,8,8.1],
  [10,10.2,10.4,10.6],[10,10.2,10.4,10.6],[10,10.2,10.4,10.6],[10,10.2,10.4,10.6]]);
 assert.deepEqual([...marketTrends(m)],[['1',{direction:'down',percent:-12}],['2',{direction:'up',percent:20}]]);
 // Repeated polls of one publication are still a single input.
 for(const selection of m.selections)selection.points=selection.points.slice(-2);
 assert.equal(marketTrends(m).size,0);
});

test('place trends agree at both endpoints and never bridge a broken segment',()=>{
 const steady=[[10,20],[10,20],[10,20]];
 const m=trendMarket([[[10,20],[9,19],[8,18]],[[10,20],[9,21],[8,22]],steady,steady,steady],'place');
 assert.deepEqual([...marketTrends(m)],[['1',{direction:'down',percent:-10}]]);
 const interrupted=m.selections[0];
 interrupted.points.at(-1).segment=interrupted.latest.segment=1;
 assert.equal(marketTrends(m).size,0);
});

test('trend markers expire on an old receipt or a stale source timestamp',()=>{
 const m=trendMarket([[10,9,8],[10,10,10],[10,10,10]]);
 const latest=Date.parse(m.received_at);
 assert.equal(trendQuoteFresh(m,latest+30000),true);
 assert.equal(trendQuoteFresh(m,latest+30001),false);
 assert.equal(trendQuoteFresh({...m,source_time:new Date(latest-90001).toISOString()},latest),false);
 assert.equal(trendQuoteFresh(m,latest-1),false);
});

import {sortOddsRows} from '../public/history.mjs';
test('table sorts observations, movements and outcomes independently, keeping missing values last',()=>{
 const entries=[
  {s:{selection:'10',horse_name:'イ',latest:{low:4.0,high:8.0}},move:{fall:-5,rise:30},
   finish:{rank:2},final:{status:'active',low:3.0,high:5.0}},
  {s:{selection:'02',horse_name:'ア',latest:{low:4.5,high:7.0}},move:{fall:-25,rise:10},
   finish:{rank:1},final:{status:'active',low:6.0,high:6.5}},
  {s:{selection:'01',horse_name:'ウ'},finish:{rank:null,status:'取消'},final:{status:'withdrawn',low:null,high:null}},
  {s:{selection:'03',horse_name:'エ',latest:{low:4.5,high:9.0}},move:{fall:0,rise:0},finish:{rank:1}}
 ];
 const order=(key,direction='ascending',endpoint='low')=>sortOddsRows([...entries],{key,direction},endpoint,false).map(r=>r.s.selection);
 assert.deepEqual(order('number'),['01','02','03','10']);
 assert.deepEqual(order('name'),['02','10','01','03']);
 assert.deepEqual(order('odds'),['10','02','03','01']);
 assert.deepEqual(order('odds','ascending','high'),['02','10','03','01']);
 assert.deepEqual(order('fall'),['02','10','03','01']);
 assert.deepEqual(order('rise','descending'),['10','02','03','01']);
 assert.deepEqual(order('finish','descending'),['10','02','03','01']);
 assert.deepEqual(order('final'),['10','02','01','03']);
 assert.deepEqual(order('final','descending'),['02','10','01','03']);
});
