import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastWinOdds,lastForecastFrame,forecastQuoteStatus,marketWithAcceptedQuote} from '../public/history.mjs';
import {replayFrame} from '../public/demo.mjs';

const start=Date.parse('2026-11-07T06:00:00Z');
const close=start+600000;
const stamp=offset=>new Date(start+offset).toISOString();
const snapshot=(offset,odds,segment=0)=>odds.map(low=>({
 received_at:stamp(offset),source_time:stamp(Math.floor(offset/60000)*60000),low,high:low,segment
}));

function archive({segment=0}={}){
 const frames=[snapshot(390000,[10,3,4]),snapshot(490000,[8,3,5],segment),
  snapshot(550000,[6,3,6],segment),snapshot(600000,[1,100,100],segment)];
 return {window_start_at:stamp(0),sales_close_at:stamp(600000),
  outcome:{final_odds:{win:[{selection:'01',low:1}]}},
  markets:[{market:'win',selections:frames[0].map((_,i)=>({
   selection:String(i+1),points:frames.map(frame=>frame[i])
  }))}]};
}

function at(offset,recording=archive()){
 return replayFrame(recording,offset/1000).markets[0];
}

test('win forecast updates with each visible receipt and projects synchronized share changes',()=>{
 const early=forecastWinOdds(at(490000),'jra',start+490000,close);
 const later=forecastWinOdds(at(550000),'jra',start+550000,close);
 const levelOnly=forecastWinOdds(at(490000,archive({segment:1})),'jra',start+490000,close);
 assert.equal(early.size,3);
 assert.ok(early.get('1')<levelOnly.get('1'));
 assert.ok(early.get('3')>levelOnly.get('3'));
 assert.ok(later.get('1')<early.get('1'));
 assert.deepEqual(forecastWinOdds(at(490000),'jra',start+490001,close),early);
});

test('forecast is limited to fresh pre-close win receipts and excludes results',()=>{
 const market=at(550000);
 assert.equal(forecastWinOdds(market,'jra',start+549999,close).size,0);
 assert.equal(forecastQuoteStatus(market,start+580001),'waiting');
 assert.equal(forecastWinOdds(market,'jra',start+580001,close).size,3);
 assert.equal(forecastQuoteStatus(market,start+610001),null);
 assert.equal(forecastWinOdds(market,'jra',close,close).size,0);
 assert.equal(forecastWinOdds(at(390000),'jra',start+390000,close+120000).size,0);
 assert.equal(forecastWinOdds({...market,market:'place'},'jra',start+550000,close).size,0);
 const stale=at(550000);
 stale.source_time=stamp(360000);
 assert.equal(forecastWinOdds(stale,'jra',start+550000,close).size,0);
 const ended=at(600000);
 assert.deepEqual(ended,market);
 assert.deepEqual(forecastWinOdds(ended,'jra',Date.parse(ended.received_at),close),
  forecastWinOdds(market,'jra',start+550000,close));
});

test('archive reconstruction uses the last fresh receipt and skips stale and post-close prices',()=>{
 const market=archive().markets[0];
 const stale=snapshot(590000,[2,9,9]).map(p=>({...p,source_time:stamp(360000)}));
 market.selections.forEach((s,i)=>s.points.splice(-1,0,stale[i]));
 const frame=lastForecastFrame(market,close);
 assert.equal(frame.received_at,stamp(550000));
 assert.deepEqual(forecastWinOdds(frame,'jra',Date.parse(frame.received_at),close),
  forecastWinOdds(at(550000),'jra',start+550000,close));
});

test('repeated unchanged polls keep the same forecast and a legacy regression cannot clear it',()=>{
 const recording=archive();
 const repeated=snapshot(531000,[8,3,5]).map(p=>({...p,source_time:stamp(480000)}));
 recording.markets[0].selections.forEach((s,i)=>s.points.splice(2,0,repeated[i]));
 const first=at(490000,recording),next=at(531000,recording);
 const expected=forecastWinOdds(first,'jra',start+490000,close);
 assert.deepEqual(forecastWinOdds(next,'jra',start+531000,close),expected);
 const raw={...next,received_at:stamp(540000),source_time:stamp(420000),quality_flags:['source_time_regression']};
 const accepted=marketWithAcceptedQuote(raw);
 assert.equal(accepted.received_at,next.received_at);
 assert.deepEqual(forecastWinOdds(accepted,'jra',start+540000,close),expected);
});
