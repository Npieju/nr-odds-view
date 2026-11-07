import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import worker from '../feed-api/worker/index.js';
test('feed requires write authentication, preserves latest version and provides uncached CORS reads',async()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../feed-api/drizzle/0000_live_feed.sql',import.meta.url),'utf8'));
 const env={PUBLISH_TOKEN:'synthetic-test-token',DB:{prepare(sql){const s=db.prepare(sql);return {async first(){return s.get();},bind(...args){return {async run(){return s.run(...args);}};}};}}};
 const url='https://synthetic.test/api/live',stamp=Date.now();
 const payload={schema_version:1,generated_at:new Date(stamp).toISOString(),race_id:'synthetic',markets:[],raw:'must not be exposed'};
 const put=(p,token)=>worker.fetch(new Request(url,{method:'PUT',headers:{authorization:'Bearer '+token},body:JSON.stringify(p)}),env);
 try{
 assert.equal((await put(payload,'wrong')).status,401);assert.equal((await put(payload,env.PUBLISH_TOKEN)).status,200);
 const get=await worker.fetch(new Request(url),env);assert.equal(get.headers.get('access-control-allow-origin'),'https://npieju.github.io');assert.equal(get.headers.get('cache-control'),'no-store');const result=await get.json();assert.equal(result.race_id,'synthetic');assert.equal(result.raw,undefined);
 await put({...payload,race_id:'older',generated_at:new Date(stamp-1000).toISOString()},env.PUBLISH_TOKEN);
 assert.equal((await (await worker.fetch(new Request(url),env)).json()).race_id,'synthetic');
 assert.equal((await put({...payload,generated_at:new Date(stamp-120000).toISOString()},env.PUBLISH_TOKEN)).status,400);
 }finally{db.close();}
});
