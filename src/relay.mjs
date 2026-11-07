import {readFile} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
export async function relayOnce({path,url,token,fetchImpl=fetch,now=Date.now()}){
 const body=await readFile(path,'utf8'),data=JSON.parse(body);
 if(!data.generated_at || now-Date.parse(data.generated_at)>60000)return {ok:false,skipped:'stale_or_missing'};
 const response=await fetchImpl(url,{method:'PUT',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body,signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error(`Relay HTTP ${response.status}`);
 return {ok:true,generated_at:data.generated_at};
}
export async function runRelay({path,url,token,signal}){
 let previous=null;
 while(!signal?.aborted){try{
  const data=JSON.parse(await readFile(path,'utf8'));
  if(data.generated_at!==previous){const r=await relayOnce({path,url,token});if(r.ok){previous=r.generated_at;console.log(JSON.stringify({stage:'relay_sent',generated_at:previous}));}}
 }catch(error){console.error(error.code==='ENOENT'?'Waiting for collector JSON':error.message);}
 await sleep(2000,undefined,{signal});
 }
}
