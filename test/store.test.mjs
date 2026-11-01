import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, validateSnapshot, contentHash, ageBounds } from '../src/store.mjs';
import { probeJra, actionLinks } from '../src/probe.mjs';

// Synthetic examples, never represented as observed JRA market data.
const raw = Buffer.from('synthetic response');
const snapshot = (override={}) => ({ source:'jra-web',race_id:'synthetic-race',market:'win',phase:'interim',
  timing:{scheduled_start_at:'2026-11-01T07:00:00Z',sales_close_at:'2026-11-01T06:59:00Z',sales_channel:'synthetic',evidence:'synthetic test deadline',observed_at:'2026-11-01T06:00:00Z'},
  request_started_at:'2026-11-01T06:29:59.000Z',received_at:'2026-11-01T06:30:00.000Z',
  source_time:'2026-11-01T15:30:00+09:00',time_precision:'minute',
  expected_selections:['01','02'],quotes:[{selection:'01',status:'active',low:2,high:2},{selection:'02',status:'active',low:4,high:4}],...override });
const second = override => snapshot({request_started_at:'2026-11-01T06:30:59Z',received_at:'2026-11-01T06:31:00Z',
  source_time:'2026-11-01T06:31:00Z',quotes:[{selection:'01',status:'active',low:1.5,high:1.5},{selection:'02',status:'active',low:5,high:5}],...override});
function usingStore(fn) { const s=new Store();try{return fn(s);}finally{s.close();} }

test('minute precision gives an interval, not invented second precision',()=> {
  assert.deepEqual(ageBounds(snapshot(),Date.parse('2026-11-01T06:31:15Z')),{min_ms:15000,max_ms:75000});
});
test('reject partial markets, duplicate keys, zero odds, missing phase and timezone',()=>{
  for (const s of [snapshot({quotes:[]}),snapshot({quotes:[snapshot().quotes[0],snapshot().quotes[0]]}),
    snapshot({quotes:[{selection:'01',status:'active',low:0,high:0},snapshot().quotes[1]]}),
    snapshot({phase:undefined}),snapshot({received_at:'2026-11-01T06:30:00'})]) assert.throws(()=>validateSnapshot(s));
});
test('canonical contents match across source, ordering, timestamps',()=>{
  assert.equal(contentHash(snapshot()),contentHash(snapshot({source:'ipat',quotes:snapshot().quotes.toReversed()})));
});
test('repeated observations remain in evidence, but do not invent changes',()=>usingStore(s=>{
  s.ingest(snapshot(),raw);s.ingest(snapshot(),raw);
  const m=s.export({now:Date.parse(snapshot().received_at)}).markets[0];
  assert.equal(m.observation_count,2);assert.equal(m.movements.length,0);
}));
test('price changes rank correctly using only preceding same-source interim data',()=>usingStore(s=>{
  s.ingest(snapshot(),raw);s.ingest(second(),raw);
  const m=s.export({now:Date.parse(second().received_at)}).markets[0];
  assert.equal(m.movements[0].selection,'01');assert.equal(m.movements[0].odds_change_pct,-25);
}));
test('final prices are retained but never exported as pre-close signals',()=>usingStore(s=>{
  s.ingest(snapshot(),raw);s.ingest(second({phase:'final'}),raw);
  const m=s.export({now:Date.parse(second().received_at)}).markets[0];
  assert.equal(m.signal_eligible,false);assert.deepEqual(m.movements,[]);assert.ok(m.quality_flags.includes('post_close_data'));
}));
test('stale and unknown source clocks suppress signals',()=>usingStore(s=>{
  s.ingest(snapshot({source_time:null,time_precision:'unknown'}),raw);
  let m=s.export({now:Date.parse(snapshot().received_at)}).markets[0];
  assert.equal(m.signal_eligible,false);assert.ok(m.quality_flags.includes('unknown_source_time'));
  s.ingest(second({source_time:snapshot().source_time}),raw);
  m=s.export({now:Date.parse('2026-11-01T06:35:00Z')}).markets[0];
  assert.ok(m.quality_flags.includes('stale_source_time'));assert.ok(m.quality_flags.includes('collector_stale'));
}));
test('changed contents with unchanged timestamp are marked as a revision',()=>usingStore(s=>{
  s.ingest(snapshot(),raw);s.ingest(second({source_time:snapshot().source_time}),raw);
  const m=s.export({now:Date.parse(second().received_at)}).markets[0];
  assert.ok(m.quality_flags.includes('same_timestamp_revision'));assert.deepEqual(m.movements,[]);
}));
test('source time regression is caught even when contents did not change',()=>usingStore(s=>{
  s.ingest(snapshot(),raw);s.ingest(second({source_time:'2026-11-01T06:29:00Z',quotes:snapshot().quotes}),raw);
  assert.ok(s.export({now:Date.parse(second().received_at)}).markets[0].quality_flags.includes('source_time_regression'));
}));
test('withdrawal prevents false market movement signal',()=>usingStore(s=>{
  s.ingest(snapshot(),raw);s.ingest(second({quotes:[{selection:'01',status:'withdrawn',low:null,high:null},snapshot().quotes[1]]}),raw);
  assert.ok(s.export({now:Date.parse(second().received_at)}).markets[0].quality_flags.includes('market_membership_change'));
}));
test('same-content source comparison reports first-observed differences only',()=>usingStore(s=>{
  s.ingest(snapshot(),raw);s.ingest(snapshot({source:'ipat',received_at:'2026-11-01T06:30:07Z'}),raw);
  assert.equal(s.compare()[0].observations.find(x=>x.source==='ipat').observed_delay_ms,7000);
}));
test('cross-source/cross-market snapshots are not used as movement baselines',()=>usingStore(s=>{
  s.ingest(snapshot({source:'ipat'}),raw);s.ingest(second(),raw);
  assert.ok(s.export({now:Date.parse(second().received_at)}).markets.every(m=>m.movements.length===0));
}));
test('probe archives original bytes and never publishes unparsed raw data',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odds-observer-'));const s=new Store();
  try {
    const result=await probeJra({cname:'synthetic/AB',root:directory,store:s,
      fetchImpl:async()=>new Response('<html>synthetic raw page</html>',{status:200})});
    assert.equal(result.ok,true);assert.equal(result.stage,'raw_only');
    assert.ok(existsSync(join(directory,'raw',result.raw_hash.slice(0,2),result.raw_hash+'.bin')));
    assert.equal(s.rows().length,0);
  } finally {s.close();rmSync(directory,{recursive:true,force:true});}
});
test('network failures are stored as failures, not empty markets',async()=>{
  const s=new Store();
  try {
    const r=await probeJra({cname:'synthetic/AB',root:tmpdir(),store:s,
      fetchImpl:async()=>{throw new Error('synthetic network failure');}});
    assert.equal(r.ok,false);assert.equal(s.rows().length,0);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM attempts WHERE ok=0').get().n,1);
  } finally {s.close();}
});
test('official action links are discovered rather than inventing checksum values',()=>{
  assert.deepEqual(actionLinks(`<a onclick="doAction('/JRADB/accessO.html', 'synthetic/AB')">`),[{path:'/JRADB/accessO.html',cname:'synthetic/AB'}]);
});
