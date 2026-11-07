import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {Store,atomicJson} from '../src/store.mjs';
import {writeLocalRaceArchive,outcomePath} from '../src/archive.mjs';
import {serveLive} from '../src/server.mjs';

test('a locally saved central archive is served without a remote lookup',async()=>{
 const root=mkdtempSync(join(tmpdir(),'odds-local-test-')),store=new Store();
 const race_id='20280103-05-01-01-09';
 const config={race_id,race_label:'架空レース',meeting_date:'2028-01-03',venue:'東京',race_number:9,
  sales_close_at:'2028-01-03T06:00:00Z',expected_selections:['01'],horse_names:{'01':'架空馬'}};
 const snapshot={source:'jra-web',race_id,phase:'interim',market:'win',
  request_started_at:'2028-01-03T05:59:50Z',received_at:'2028-01-03T05:59:52Z',
  source_time:'2028-01-03T05:59:00Z',time_precision:'minute',expected_selections:['01'],
  quotes:[{selection:'01',status:'active',low:3.4,high:3.4}]};
 store.ingest(snapshot,Buffer.from('synthetic'));
 store.ingest({...snapshot,received_at:config.sales_close_at},Buffer.from('synthetic cutoff'));
 const server=serveLive({dataPath:join(root,'live.json'),port:0,localStatus:{interval_ms:5000}});
 try{
  writeLocalRaceArchive(root,store,config,'jra');
  await once(server,'listening');
  const url='http://127.0.0.1:'+server.address().port;
  const response=await fetch(url+'/data/jra-history/'+race_id);
  assert.equal(response.status,200);
  const race=await response.json();
  assert.equal(race.race_id,race_id);
  assert.equal(race.markets[0].received_at,snapshot.received_at);
  assert.equal(race.markets[0].observation_count,1);
  const outcome={race_id,standings:[{selection:'01',rank:1}],final_odds:{win:[{selection:'01',low:2.2,high:2.2}]}};
  assert.deepEqual(await (await fetch(url+'/data/jra-history/'+race_id+'?outcome=1')).json(),{outcome:null});
  atomicJson(outcomePath(root,'jra',config.meeting_date,race_id),outcome);
  assert.deepEqual(await (await fetch(url+'/data/jra-history/'+race_id+'?outcome=1')).json(),{outcome});
  const enriched=await (await fetch(url+'/data/jra-history/'+race_id)).json();
  assert.deepEqual(enriched.markets,race.markets);
  assert.deepEqual(enriched.outcome,outcome);
  assert.equal((await (await fetch(url+'/data/local-status')).json()).interval_ms,5000);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  store.close();
  rmSync(root,{recursive:true,force:true});
 }
});
