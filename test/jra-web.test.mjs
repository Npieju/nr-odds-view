import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJraTanpuku,collectJraWeb } from '../src/jra-web.mjs';
import { Store } from '../src/store.mjs';

// Synthetic prices/identity; markup based on official DOM inspected 2026-11-01.
const config={race_id:'2026110105041111',expected_selections:['01','02'],roster_evidence:'synthetic independent roster',cname:'synthetic/AB'};
const clocks={request_started_at:'2026-11-01T06:37:01Z',received_at:'2026-11-01T06:37:02Z'};
function html(marker='15時37分現在',odds='2.0') {return `<div class="race_header"><div class="cell date">2026年11月1日（日曜）4回東京11日</div>
  <div class="cell time">発走時刻：<strong>15時40分</strong></div><div class="race_number"><img alt="11レース"></div>
  <div class="refresh_line"><div class="cell time"><strong>${marker}</strong></div></div></div>
  <table class="basic narrow-xy tanpuku"><thead><tr><th class="num">馬番</th><th class="odds_tan">単勝</th></tr></thead><tbody>
  <tr><td class="waku" rowspan="2">枠1</td><td class="num">1</td><td class="horse">模擬A</td>
  <td class="odds_tan"><strong class="red">${odds}</strong></td><td class="odds_fuku"><span class="inner"><span class="min">1.1</span><span class="cap">-</span><span class="max">1.8</span></span></td></tr>
  <tr><td class="num">2</td><td class="horse">模擬B</td><td class="odds_tan">4.0</td><td class="odds_fuku">1.5 - 2.5</td></tr></tbody></table>`;}
test('official table shape parses identity, rowspan, nested odds and explicit minute marker',()=>{
  const [win,place]=parseJraTanpuku(html(),config,clocks);
  assert.equal(win.source_time,'2026-11-01T15:37:00+09:00');assert.equal(win.quotes[0].low,2);
  assert.equal(place.quotes[0].high,1.8);assert.equal(win.scheduled_start_at,'2026-11-01T15:40:00+09:00');
});
test('final/confirmed marker never manufactures announcement time',()=>{
  for(const [marker,phase] of [['最終オッズ','final'],['確定オッズ','confirmed']]) {
    const s=parseJraTanpuku(html(marker),config,clocks)[0];assert.equal(s.phase,phase);assert.equal(s.source_time,null);
  }
});
test('wrong race, unknown phase, missing horse, duplicate horse, unrecognized value fail closed',()=>{
  for(const page of [html().replace('4回東京11日','4回京都11日'),html('更新済み'),html().replace('class="num">2','class="num">1'),
    html().replace('<td class="odds_tan">4.0</td>',''),html('15時37分現在','---'),html('15時38分現在'),html('2月30日15時37分現在')])
    assert.throws(()=>parseJraTanpuku(page,config,clocks));
  assert.throws(()=>parseJraTanpuku(html(),config,{...clocks,received_at:'2026-10-31T06:37:02Z'}));
});
test('withdrawal remains unavailable; capped values remain lower bounds',()=>{
  assert.equal(parseJraTanpuku(html('15時37分現在','取消'),config,clocks)[0].quotes[0].status,'withdrawn');
  assert.equal(parseJraTanpuku(html('15時37分現在','999.9以上'),config,clocks)[0].quotes[0].lower_bound,true);
});
test('HTTP collector archives original bytes; error pages and network failures add no quotes',async()=>{
  const root=mkdtempSync(join(tmpdir(),'jra-test-')),s=new Store();
  try {
    // ASCII entity conversion permits a Shift_JIS-compatible synthetic response without dependencies.
    const ascii=html('最終オッズ').replace(/[^\x00-\x7f]/g,c=>'&#'+c.codePointAt(0)+';');
    const result=await collectJraWeb({config,root,store:s,fetchImpl:async()=>new Response(ascii)});
    assert.equal(result.ok,true);assert.equal(s.rows().length,2);
    const error=await collectJraWeb({config,root,store:s,fetchImpl:async()=>new Response('error')});
    assert.equal(error.ok,false);assert.ok(error.raw_hash);assert.equal(s.rows().length,2);
    const blocked=await collectJraWeb({config,root,store:s,fetchImpl:async()=>{throw new Error('blocked');}});
    assert.equal(blocked.ok,false);assert.equal(s.rows().length,2);
  } finally {s.close();rmSync(root,{recursive:true,force:true});}
});
