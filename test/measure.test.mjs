import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {measureWindow} from '../src/measure.mjs';
test('measurement excludes receipts at cutoff, counts repeated polls and timestamp uncertainty',()=>{
 const store=new Store();try{
 const config={race_id:'synthetic',cname:'synthetic/AB',sales_close_at:'2026-11-07T04:14:00Z',close_basis:'scheduled_rule_not_observed'};
 const sample=(t,low)=>({source:'jra-web',race_id:'synthetic',market:'win',phase:'interim',request_started_at:t,received_at:t,source_time:'2026-11-07T04:09:00Z',time_precision:'minute',expected_selections:['01'],quotes:[{selection:'01',status:'active',low,high:low}]});
 for(const [t,value] of [['04:09:10',10],['04:09:20',10],['04:09:30',8],['04:09:40',10],['04:14:00',1]])store.ingest(sample('2026-11-07T'+t+'Z',value),Buffer.from('synthetic'));
 const attempt={source:'jra-web',request_cname:config.cname,started_at:'2026-11-07T04:09:10Z',received_at:'2026-11-07T04:09:11Z',ok:true};
 store.attempt({...attempt,stage:'raw_only'});store.attempt({...attempt,stage:'normalized_interim'});
 const r=measureWindow(store,config),m=r.markets[0];assert.equal(r.http_requests,1);assert.equal(m.observations,4);assert.equal(m.content_transitions,2);assert.equal(m.content_versions_observed,3);assert.equal(m.distinct_source_times,1);assert.equal(m.seconds_before_close_last_receipt,260);assert.equal(m.source_age_at_receipt_ms.min_bound_median,0);assert.equal(m.source_age_at_receipt_ms.max_bound_p95,40000);assert.equal(r.markets[1].source_age_at_receipt_ms.max_bound_p95,null);
 }finally{store.close();}
});
