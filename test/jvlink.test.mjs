import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseO1,collectJvLink } from '../src/jvlink.mjs';
import { Store,hash } from '../src/store.mjs';
import { auditRace } from '../src/audit.mjs';

// Constructed from the published format. These bytes are NOT captured market data.
const config={race_id:'2026110105010211',expected_selections:['01','02'],roster_evidence:'synthetic independent race card',
  timing:{scheduled_start_at:'2026-11-01T15:40:00+09:00',sales_close_at:'2026-11-01T15:39:00+09:00',
    sales_channel:'synthetic-ipat',evidence:'synthetic deadline',observed_at:'2026-11-01T15:00:00+09:00'}};
const clocks={request_started_at:'2026-11-01T15:37:01+09:00',received_at:'2026-11-01T15:37:02+09:00'};
function fixture({code='1',stamp='11011537',win='0020',place='0012',high='0018'}={}) {
  const b=Buffer.alloc(962,32), put=(pos,v)=>b.write(v,pos-1,'ascii');
  put(1,'O1'+code+'20261101'+config.race_id+stamp+'02027703');
  put(44,'01'+win+'01'+'02004002');
  put(268,'01'+place+high+'01'+'020020003002');
  put(961,'\r\n');return b;
}
const auditConfig={source:'jra-van',race_id:config.race_id,market:'win',cutoff:config.timing.sales_close_at,
  deadline_evidence:'synthetic',deadline_observed_at:config.timing.observed_at,as_of:'2026-11-01T16:00:00+09:00'};

test('O1 parses independently checked identity, minute time and both range endpoints',()=>{
  const [win,place]=parseO1(fixture(),config,clocks);
  assert.equal(win.source_time,'2026-11-01T15:37:00+09:00');
  assert.equal(win.quotes[0].low,2);assert.equal(place.quotes[0].high,1.8);
  assert.equal(win.access,'private');
});
test('O1 rejects truncation, race mismatch, roster mismatch, bad dates and future source time',()=>{
  assert.throws(()=>parseO1(fixture().subarray(0,961),config,clocks));
  assert.throws(()=>parseO1(fixture(),{...config,race_id:'2026110105010212'},clocks));
  assert.throws(()=>parseO1(fixture(),{...config,expected_selections:['01']},clocks));
  for(const stamp of ['02301537','11012401','11011538']) assert.throws(()=>parseO1(fixture({stamp}),config,clocks));
  const b=fixture();b.write('03',44-1);assert.throws(()=>parseO1(b,config,clocks));
});
test('withdrawal, no votes, capped odds and final phases are explicit',()=>{
  for(const [win,status] of [['----','withdrawn'],['****','withdrawn'],['0000','no_votes']])
    assert.equal(parseO1(fixture({win}),config,clocks)[0].quotes[0].status,status);
  assert.equal(parseO1(fixture({win:'9999'}),config,clocks)[0].quotes[0].lower_bound,true);
  for(const [code,phase] of [['2','presale_final'],['3','final'],['4','confirmed'],['5','confirmed']]) {
    const s=parseO1(fixture({code,stamp:'00000000'}),config,clocks)[0];
    assert.equal(s.phase,phase);assert.equal(s.source_time,null);
  }
  for(const code of ['0','9']) assert.throws(()=>parseO1(fixture({code}),config,clocks));
});
test('collector archives bytes, stores repeats, and records failed parses without partial ingestion',async()=>{
  const root=mkdtempSync(join(tmpdir(),'jvlink-test-')),s=new Store();
  try {
    const raw=fixture(), record={base64:raw.toString('base64'),received_at:clocks.received_at};
    const reader=async()=>({request_started_at:clocks.request_started_at,records:[record]});
    assert.equal((await collectJvLink({config,root,store:s,reader})).ok,true);
    assert.equal((await collectJvLink({config,root,store:s,reader})).ok,true);
    assert.equal(s.rows().length,4);
    const malformed=Buffer.from('bad');
    const bad=await collectJvLink({config,root,store:s,reader:async()=>({request_started_at:clocks.request_started_at,
      records:[record,{...record,base64:malformed.toString('base64')}]})});
    assert.equal(bad.ok,false);assert.equal(s.rows().length,4);
    const digest=hash(malformed);assert.ok(existsSync(join(root,'raw',digest.slice(0,2),digest+'.bin')));
  } finally {s.close();rmSync(root,{recursive:true,force:true});}
});
test('audit uses receipt before cutoff, excludes at-cutoff/late backfills and separates final',()=>{
  const s=new Store();try {
    const add=(options,received)=>s.ingest(parseO1(fixture(options),config,{request_started_at:received,received_at:received})[0],fixture(options));
    add({stamp:'11011538'},'2026-11-01T15:38:20+09:00');
    add({stamp:'11011538',win:'0015'},config.timing.sales_close_at);
    add({stamp:'11011537',win:'0010'},'2026-11-01T15:39:10+09:00');
    add({code:'3',stamp:'00000000',win:'0012'},'2026-11-01T15:40:10+09:00');
    add({code:'4',stamp:'00000000',win:'0013'},'2026-11-01T15:45:00+09:00');
    const a=auditRace(s,auditConfig);
    assert.equal(a.last_preclose.received_at,'2026-11-01T15:38:20+09:00');
    assert.equal(a.hindsight_differences[0].preclose_low,2);
    assert.equal(a.hindsight_differences[0].final_low,1.3);
    assert.equal(a.final.phase,'confirmed');assert.equal(a.usable_at_cutoff,true);
    assert.equal(auditRace(s,{...auditConfig,as_of:'2026-11-01T15:40:20+09:00'}).final.phase,'final');
    assert.equal(s.export({now:Date.parse('2026-11-01T15:38:30+09:00')}).markets[0].quotes[0].low,2);
  } finally {s.close();}
});
test('unknown deadline and elapsed deadline suppress interim signals; stale audit remains evidence',()=>{
  const s=new Store();try {
    const a=parseO1(fixture(),{...config,timing:null},clocks)[0];s.ingest(a,fixture());
    assert.ok(s.export({now:Date.parse(clocks.received_at)}).markets[0].quality_flags.includes('unknown_sales_deadline'));
    const report=auditRace(s,auditConfig);assert.equal(report.usable_at_cutoff,false);
    assert.ok(report.quality_flags.includes('stale_at_cutoff'));
    assert.throws(()=>auditRace(s,{...auditConfig,deadline_observed_at:config.timing.sales_close_at}));
    s.ingest({...a,timing:config.timing},fixture());
    assert.ok(s.export({now:Date.parse(config.timing.sales_close_at)}).markets[0].quality_flags.includes('sales_closed'));
  } finally {s.close();}
});
