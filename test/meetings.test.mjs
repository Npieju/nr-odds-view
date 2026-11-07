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
 const s=new Store();try{const t='2026-11-07T04:00:00Z',c={window_ms:300000,race_id:'synthetic',sales_close_at:'2026-11-07T04:10:00Z',horse_names:{'01':'架空馬'},expected_selections:['01']};
 s.ingest({source:'jra-web',race_id:'synthetic',market:'win',phase:'interim',received_at:t,request_started_at:t,source_time:t,time_precision:'minute',expected_selections:['01'],quotes:[{selection:'01',status:'active',low:2,high:2}]},Buffer.from('synthetic'));
 const m=liveWindow(s,c,Date.parse(t)).markets[0];assert.equal(m.selections[0].horse_name,'架空馬');assert.equal(m.selections[0].latest.low,2);assert.equal(m.selections[0].points.length,0);assert.equal(m.selections[0].extrema.low.fall,null);assert.ok(m.quality_flags.includes('waiting'));
 }finally{s.close();}
});

import {watchMeetings,refreshVenues} from '../src/meetings.mjs';
test('venue reconciliation replaces changed official links and removes absent venues',()=>{
 const slots=new Map([['05',{venue_code:'05',cname:'old',config:{race_id:'old'}}],['08',{venue_code:'08',cname:'removed'}]]);
 refreshVenues(slots,[{venue_code:'05',venue:'東京',cname:'new'},{venue_code:'03',venue:'福島',cname:'added'}]);
 assert.deepEqual([...slots.keys()],['05','03']);assert.equal(slots.get('05').config,null);assert.equal(slots.get('05').cname,'new');
});
test('running watcher crosses date boundary and chooses fresh venues then next race without restart',async()=>{
 const controller=new AbortController(),store=new Store();let clock=Date.parse('2028-01-02T23:50:00+09:00');const snapshots=[],prepared=[];
 const currentDay=()=>new Date(clock+9*3600000).toISOString().slice(0,10);
 const action=c=>`doAction('/JRADB/accessO.html','${c}')`;
 const html=async({cname})=>{
  if(!cname)return action('menu');
  const d=currentDay().replaceAll('-','');
  if(cname==='menu')return action(`pw15orl00${d==='20280102'?'05':'03'}20280101${d}/AB`);
  const row=(time,c)=>`<tr><th class="race_num">R</th><td class="time">${time}</td><a onclick="${action(c)}">単複</a></tr>`;
  return d==='20280102'?row('23時59分','pw151ouOld/AB'):row('13時10分','pw151ouFirst/AB')+row('13時45分','pw151ouSecond/AB');
 };
 const prepare=async({cname})=>{
  prepared.push(cname);const time=cname.includes('Old')?'23:59':cname.includes('First')?'13:10':'13:45';const start=Date.parse(`${currentDay()}T${time}:00+09:00`);
  return {cname,race_id:cname.includes('Old')?'old':cname.includes('First')?'first':'second',race_number:prepared.length,scheduled_start_at:new Date(start).toISOString(),sales_close_at:new Date(start-60000).toISOString(),expected_selections:['01']};
 };
 try{
 await watchMeetings({store,root:'.',output:'unused',signal:controller.signal,clock:()=>clock,getHtml:html,prepare,collect:async()=>({ok:true}),write:(_,s)=>snapshots.push(s),wait:async()=>{if(snapshots.length===1)clock=Date.parse('2028-01-03T13:00:00+09:00');else if(snapshots.length===2)clock=Date.parse('2028-01-03T13:09:00+09:00');else controller.abort();}});
 assert.equal(snapshots.length,3);assert.equal(snapshots[0].meeting_date,'2028-01-02');assert.equal(snapshots[0].venues[0].current.race_id,'old');assert.equal(snapshots[1].meeting_date,'2028-01-03');assert.equal(snapshots[1].venues.length,1);assert.equal(snapshots[1].venues[0].venue,'福島');assert.equal(snapshots[1].venues[0].current.race_id,'first');assert.equal(snapshots[2].venues[0].current.race_id,'second');
 }finally{store.close();}
});
