import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJraFinal } from '../src/jra-final.mjs';
import { replayAtCutoff } from '../src/replay.mjs';
import { Store } from '../src/store.mjs';
const manifest={race_id:'synthetic',race_label:'2026年11月1日（日曜）4回東京11日 11レース',expected_selections:['01'],roster_evidence:'synthetic independent roster'};
const attempt={started_at:'2026-11-01T06:00:00Z',received_at:'2026-11-01T06:00:01Z'};
const html=`<h1>単勝・複勝オッズ（馬番順）${manifest.race_label}</h1><div class="cell time"><strong>最終オッズ</strong></div><table class="basic narrow-xy tanpuku"><tr><td class="num">1</td><td class="odds_tan">2.0</td><td class="odds_fuku"><span class="min">1.1</span><span class="max">1.3</span></td></tr></table>`;
test('synthetic final layout preserves ranges and unknown source clock',()=>{
 const s=parseJraFinal(html,manifest,attempt);assert.equal(s.length,2);assert.equal(s[0].phase,'final');assert.equal(s[0].source_time,null);assert.equal(s[1].quotes[0].high,1.3);
});
test('wrong identity, partial roster, unknown phase/status fail closed',()=>{
 for(const [h,m] of [[html,{...manifest,race_label:'wrong race'}],[html,{...manifest,expected_selections:['01','02']}],[html.replace('最終オッズ','15時30分現在'),manifest],[html.replace('2.0','取消'),manifest]]) assert.throws(()=>parseJraFinal(h,m,attempt));
});
test('cutoff uses receipt time, excludes late interim and final even with old source time',()=>{
 const store=new Store();try{
 const base={source:'jra-web',race_id:'synthetic',market:'win',phase:'interim',request_started_at:'2026-11-01T05:59:58Z',received_at:'2026-11-01T06:00:00Z',source_time:'2026-11-01T06:00:00Z',time_precision:'minute',expected_selections:['01'],quotes:[{selection:'01',status:'active',low:2,high:2}]};
 store.ingest(base,Buffer.from('synthetic'));
 store.ingest({...base,received_at:'2026-11-01T06:00:11Z',quotes:[{...base.quotes[0],low:3,high:3}]},Buffer.from('synthetic'));
 store.ingest({...base,phase:'final',received_at:'2026-11-01T06:00:12Z',source_time:null,time_precision:'unknown',quotes:[{...base.quotes[0],low:4,high:4}]},Buffer.from('synthetic'));
 const query={source:'jra-web',race_id:'synthetic',market:'win',decision_at:'2026-11-01T06:00:09Z',sales_close_at:'2026-11-01T06:00:10Z',channel:'synthetic',evidence:'synthetic'};
 const result=replayAtCutoff(store,query);assert.equal(result.snapshot.quotes[0].low,2);assert.equal(result.differences[0].low_change_pct,100);assert.equal(result.signal_eligible,true);
 assert.equal(replayAtCutoff(store,{...query,decision_at:query.sales_close_at}).signal_eligible,false);
 assert.equal(replayAtCutoff(store,{...query,decision_at:'2026-11-01T05:59:59Z'}).snapshot,null);
 }finally{store.close();}
});
