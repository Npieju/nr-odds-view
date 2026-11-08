import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { liveWindow } from '../src/live-window.mjs';
import { parseJraInterim } from '../src/jra-interim.mjs';
import { collectInterimOnce,validateLiveConfig,watchJra } from '../src/collector.mjs';
const close=Date.parse('2026-11-01T06:35:00Z'), start=close-300000;
const config={window_ms:300000,race_id:'synthetic',race_label:'2026年11月1日（日曜）4回東京11日 11レース',sales_close_at:new Date(close).toISOString(),scheduled_start_at:new Date(close+60000).toISOString(),sales_channel:'synthetic',close_evidence:'synthetic',roster_evidence:'synthetic',cname:'synthetic/AB',expected_selections:['01'],max_gap_ms:30000};
const html=label=>`<h1>Logo</h1><h1>単勝・複勝オッズ（馬番順）${config.race_label}</h1><div class="cell time"><strong>${label}</strong></div><table class="basic narrow-xy tanpuku"><tr><td class="num">1</td><td class="odds_tan">2.0</td><td class="odds_fuku"><span class="min">1.1</span><span class="max">1.3</span></td></tr></table>`;
function add(s,offset,low,over={}){const t=new Date(start+offset).toISOString();s.ingest({source:'jra-web',race_id:'synthetic',market:'win',phase:'interim',request_started_at:t,received_at:t,source_time:new Date(Math.floor((start+offset)/60000)*60000).toISOString(),time_precision:'minute',expected_selections:['01'],quotes:[{selection:'01',status:'active',low,high:low}],...over},Buffer.from('synthetic'));}
test('interim label yields minute source clock; final and unknown are rejected',()=>{
 const a={started_at:'2026-11-01T06:30:01Z',received_at:'2026-11-01T06:30:02Z'};
 const [s]=parseJraInterim(html('15時30分現在オッズ'),config,a);assert.equal(s.phase,'interim');assert.equal(s.source_time,'2026-11-01T15:30:00+09:00');
 for(const label of ['最終オッズ','確定オッズ','16時30分現在オッズ','不明'])assert.throws(()=>parseJraInterim(html(label),config,a));
});
test('ordered maximum movements update without future, final or postclose leakage',()=>{
 const s=new Store();try{
 add(s,-1000,100);add(s,0,10);add(s,10000,5);add(s,20000,8);add(s,30000,4);add(s,40000,1,{phase:'final'});add(s,300000,1);
 const early=liveWindow(s,config,start+20000).markets[0].selections[0];assert.equal(early.extrema.low.fall.pct,-50);assert.ok(Math.abs(early.extrema.low.rise.pct-60)<1e-8);
 const late=liveWindow(s,config,start+30000).markets[0].selections[0];assert.equal(late.extrema.low.fall.pct,-60);assert.equal(late.extrema.low.fall.from_received_at,new Date(start).toISOString());
 assert.equal(liveWindow(s,config,close).markets[0].observation_count,4);assert.equal(liveWindow(s,config,close).markets[0].signal_eligible,false);
 }finally{s.close();}
});
test('gaps and withdrawal split series and do not invent a drop',()=>{
 for(const withdrawal of [false,true]){const s=new Store();try{
 add(s,0,10);
 if(withdrawal)add(s,10000,10,{quotes:[{selection:'01',status:'withdrawn',low:null,high:null}]});
 add(s,withdrawal?20000:60000,1);
 const m=liveWindow(s,config,start+(withdrawal?20000:60000)).markets[0];assert.equal(m.selections[0].extrema.low.fall,null);assert.ok(m.quality_flags.includes('series_interrupted'));
 }finally{s.close();}}
});
test('stale source/receipt and partial window cannot claim eligible live signal',()=>{
 const s=new Store();try{add(s,60000,2);const m=liveWindow(s,config,start+180000).markets[0];assert.equal(m.signal_eligible,false);for(const f of ['partial_window','collector_stale','source_stale_or_unknown'])assert.ok(m.quality_flags.includes(f));}finally{s.close();}
});
test('collector parses both markets atomically and stores errors without empty market',async()=>{
 const root=mkdtempSync(join(tmpdir(),'odds-live-')),s=new Store();try{
 // Use UTC time represented in JST, safely before a synthetic future close.
 const now=new Date(),jst=new Date(now.getTime()+9*3600000),y=jst.getUTCFullYear(),mo=jst.getUTCMonth()+1,d=jst.getUTCDate();
 const c={...config,race_label:`${y}年${mo}月${d}日（日曜）4回東京11日 11レース`,sales_close_at:new Date(Date.now()+60000).toISOString()};
 const page=html(`${jst.getUTCHours()}時${String(jst.getUTCMinutes()).padStart(2,'0')}分現在オッズ`).replace(config.race_label,c.race_label);
 // Generate a synthetic Shift_JIS response without adding an encoding dependency.
 const decoder=new TextDecoder('shift_jis'),encoding=new Map();
 for(let i=0;i<128;i++)encoding.set(String.fromCharCode(i),[i]);
 for(let a=0x81;a<=0xfc;a++) for(let b=0x40;b<=0xfc;b++){
  const bytes=[a,b],char=decoder.decode(new Uint8Array(bytes));
  if(char.length===1 && char!=='\ufffd' && !encoding.has(char))encoding.set(char,bytes);
 }
 const bytes=new Uint8Array([...page].flatMap(char=>{assert.ok(encoding.has(char),'encodable synthetic character');return encoding.get(char);}));
 const r=await collectInterimOnce({config:c,root,store:s,fetchImpl:async()=>new Response(bytes)});assert.equal(r.stage,'normalized_interim');assert.equal(s.rows().length,2);
 assert.equal(JSON.parse(s.rows()[1].payload).phase,'interim');
 const final=await collectInterimOnce({config:c,root,store:s,fetchImpl:async()=>new Response('final')});assert.equal(final.ok,false);assert.equal(s.rows().length,2);
 }finally{s.close();rmSync(root,{recursive:true,force:true});}
});
test('collector refuses expired schedules and unsafe configuration',async()=>{
 assert.throws(()=>validateLiveConfig({...config,interval_ms:1}));assert.throws(()=>validateLiveConfig({...config,close_evidence:null}));
 await assert.rejects(watchJra({config,root:'.',store:null,output:'unused'}),/already closed/);
});

test('five-minute collector continuously publishes and stops at the sales deadline',async()=>{
 const root=mkdtempSync(join(tmpdir(),'odds-watch-')),store=new Store();let clock=start-1000,calls=0;const updates=[];
 try{
 await watchJra({config,root,store,output:join(root,'live.json'),now:()=>clock,wait:async ms=>{clock+=ms;},collect:async()=>{calls++;add(store,clock-start,10-calls/100);return {ok:true,received_at:new Date(clock).toISOString(),stage:'synthetic_interim'};},onUpdate:s=>updates.push(s)});
 assert.equal(calls,30);assert.equal(clock,close);assert.equal(updates.at(-1).markets[0].observation_count,30);assert.ok(updates.at(-1).markets[0].quality_flags.includes('sales_closed'));
 assert.equal(updates[0].markets[0].observation_count,0);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('stale prices remain visible as observations while current eligibility is suppressed',()=>{
 const s=new Store();try{
 add(s,0,10,{source_time:new Date(start-120000).toISOString()});
 add(s,10000,5,{source_time:new Date(start-120000).toISOString()});
 const m=liveWindow(s,config,start+10000).markets[0];assert.equal(m.signal_eligible,false);assert.equal(m.selections[0].latest.low,5);assert.equal(m.selections[0].points.length,2);assert.equal(m.selections[0].latest.stale_at_receipt,true);assert.equal(m.selections[0].extrema.low.fall.pct,-50);
 }finally{s.close();}
});

test('older publication returned after newer one stays in evidence but never creates a movement',()=>{
 const s=new Store();try{
 add(s,0,10);add(s,60000,5);
 add(s,70000,100,{source_time:new Date(start).toISOString()});
 const during=liveWindow(s,config,start+70000).markets[0];
 assert.equal(during.source_time,new Date(start+60000).toISOString());
 assert.equal(during.received_at,during.selections[0].latest.received_at);
 assert.equal(during.selections[0].latest.low,5);
 assert.ok(during.quality_flags.includes('source_time_regression'));
 add(s,80000,5);
 const m=liveWindow(s,{...config,max_gap_ms:90000},start+80000).markets[0];
 assert.equal(m.observation_count,4);assert.equal(m.selections[0].points.length,3);assert.equal(m.selections[0].extrema.low.rise,null);assert.equal(m.selections[0].extrema.low.fall.pct,-50);assert.ok(m.quality_flags.includes('source_time_regression'));
 }finally{s.close();}
});

test('the preview and collection window share the same publication watermark',()=>{
 const s=new Store();try{
  const c={...config,window_ms:240000},old=new Date(start).toISOString();
  add(s,60000,4);add(s,65000,99,{source_time:old});
  const m=liveWindow(s,c,start+65000).markets[0];
  assert.equal(m.received_at,new Date(start+60000).toISOString());
  assert.equal(m.selections[0].latest.low,4);
  assert.equal(m.observation_count,2);
 }finally{s.close();}
});
