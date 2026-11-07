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
