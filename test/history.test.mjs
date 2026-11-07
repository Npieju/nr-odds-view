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
 const archive={race_id:'archive-fixture',window_start_at:new Date(start).toISOString(),
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
 assert.equal(end.markets[0].selections[0].latest,points[3]);
 assert.equal(archive.markets[0].selections[0].latest,points[4]);
});
