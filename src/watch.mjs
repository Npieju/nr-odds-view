import { setTimeout } from 'node:timers/promises';
import { collectJraWeb } from './jra-web.mjs';
import { atomicJson } from './store.mjs';
import { join } from 'node:path';

// A bounded local process. Actions cron is not used as a sub-minute collector.
export async function watchJra({loadConfig,root,store,intervalMs=30000,count=30,collect=collectJraWeb,wait=setTimeout,onResult=()=>{}}) {
  if(!Number.isInteger(intervalMs)||intervalMs<10000||intervalMs>300000||!Number.isInteger(count)||count<1||count>360)
    throw new Error('watch interval must be 10000..300000ms; count 1..360');
  let failures=0,completed=0;
  for(let i=0;i<count;i++) {
    const config=loadConfig(); // operator can update deadline/roster evidence between requests
    const result=await collect({config,root,store});completed++;
    failures=result.ok?0:failures+1;onResult(result);
    atomicJson(join(root,'exports/latest.json'),store.export());
    if(failures>=3) return {completed,stopped:'three_consecutive_failures'};
    if(i+1<count) await wait(Math.min(intervalMs*2**failures,300000));
  }
  return {completed,stopped:'count_limit'};
}
