import test from 'node:test';import assert from 'node:assert/strict';import {parseMeetings,parseUpcoming} from '../src/discovery.mjs';import {nextRace} from '../src/meetings.mjs';import {rosterNames} from '../src/prepare-race.mjs';import {Store} from '../src/store.mjs';import {liveWindow} from '../src/live-window.mjs';
const date='2026-11-07';
test('current-day venue discovery excludes tomorrow and duplicates',()=>{
 const a=c=>`doAction('/JRADB/accessO.html','${c}')`;
 const h=[a('pw15orl00052026050120261107/BC'),a('pw15orl00082026050120261107/9A'),a('pw15orl00032026030120261107/C6'),a('pw15orl00052026050120261107/BC'),a('pw15orl00052026050220261108/AA')].join(' ');
 assert.deepEqual(parseMeetings(h,date).map(v=>v.venue),['東京','京都','福島']);
});
test('race watcher selects next race at cutoff and ends without carrying another day',()=>{
 const row=(clock,cname)=>`<tr><td class="time">${clock}</td><a onclick="doAction('/JRADB/accessO.html','${cname}')">単複</a></tr>`;
 const now=Date.parse('2026-11-07T13:40:00+09:00');
 const races=parseUpcoming(row('13時50分','pw151ouSynthetic1/AB')+row('14時25分','pw151ouSynthetic2/AB')+row('発走済','pw151ouSynthetic0/AB'),date,now);
 assert.equal(races.length,2);assert.equal(nextRace(races,Date.parse('2026-11-07T13:48:59+09:00')).cname,'pw151ouSynthetic1/AB');assert.equal(nextRace(races,Date.parse('2026-11-07T13:49:00+09:00')).cname,'pw151ouSynthetic2/AB');assert.equal(nextRace(races,Date.parse('2026-11-07T14:24:00+09:00')),null);
});
test('horse names follow independent roster number rather than odds rank',()=>{
 assert.deepEqual(rosterNames('<tr><td class="num">8<span><img alt="ブリンカー" /></span></td><td class="horse"><div class="name"><a href="/horse">合成馬</a></div></td></tr>'),{'08':'合成馬'});
});
test('prewindow latest quote includes horse name without contaminating five-minute movement',()=>{
 const s=new Store();try{const t='2026-11-07T04:00:00Z',c={race_id:'synthetic',sales_close_at:'2026-11-07T04:10:00Z',horse_names:{'01':'架空馬'},expected_selections:['01']};
 s.ingest({source:'jra-web',race_id:'synthetic',market:'win',phase:'interim',received_at:t,request_started_at:t,source_time:t,time_precision:'minute',expected_selections:['01'],quotes:[{selection:'01',status:'active',low:2,high:2}]},Buffer.from('synthetic'));
 const m=liveWindow(s,c,Date.parse(t)).markets[0];assert.equal(m.selections[0].horse_name,'架空馬');assert.equal(m.selections[0].latest.low,2);assert.equal(m.selections[0].points.length,0);assert.equal(m.selections[0].extrema.low.fall,null);assert.ok(m.quality_flags.includes('waiting'));
 }finally{s.close();}
});
