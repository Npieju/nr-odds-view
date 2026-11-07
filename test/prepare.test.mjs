import test from 'node:test';import assert from 'node:assert/strict';import {rosterSelections} from '../src/prepare-race.mjs';
test('roster includes horses with blinker icon nested in number cell',()=>{
 assert.deepEqual(rosterSelections('<td class="num">7</td><td class="num">8<span class="horse_icon blinker"><img alt="ブリンカー着用" /></span>\n</td><td class="num">9</td>'),['07','08','09']);
 assert.throws(()=>rosterSelections('<td class="num">8不明</td>'));
});
