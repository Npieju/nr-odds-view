import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watchJra } from '../src/watch.mjs';
import { Store } from '../src/store.mjs';
test('bounded sequential collector backs off and stops after failures, exporting private JSON',async()=>{
  const root=mkdtempSync(join(tmpdir(),'watch-test-')),store=new Store(),delays=[];let loaded=0;
  try {
    const r=await watchJra({loadConfig:()=>({version:++loaded}),root,store,count:20,intervalMs:10000,
      collect:async({config})=>({ok:false,version:config.version}),wait:async ms=>delays.push(ms)});
    assert.equal(r.completed,3);assert.deepEqual(delays,[20000,40000]);assert.equal(loaded,3);
    assert.equal(JSON.parse(readFileSync(join(root,'exports/latest.json'),'utf8')).access,'private');
    await assert.rejects(()=>watchJra({root,store,intervalMs:1}));
  } finally {store.close();rmSync(root,{recursive:true,force:true});}
});
