import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {parseArgs} from 'node:util';
import {Store} from './store.mjs';
import {serveLive} from './server.mjs';
import {watchMeetings} from './meetings.mjs';
import {watchNar} from './nar.mjs';

function openBrowser(address){
 if(process.platform!=='win32')return;
 const browser=spawn('rundll32.exe',['url.dll,FileProtocolHandler',address],{stdio:'ignore',windowsHide:true});
 browser.on('error',()=>console.log(address));
 browser.unref();
}
async function main(){
 const {values}=parseArgs({options:{
  interval:{type:'string',default:'5'},'nar-final-interval':{type:'string',default:'2'},port:{type:'string',default:'8787'},
  'serve-only':{type:'boolean'},'no-browser':{type:'boolean'}
 }});
 const port=Number(values.port),intervalMs=Number(values.interval)*1000;
 const finalIntervalMs=Number(values['nar-final-interval'])*1000;
 if(![5000,10000].includes(intervalMs))throw Error('--interval must be 5 or 10 seconds.');
 if(![1000,2000,5000,10000].includes(finalIntervalMs) || finalIntervalMs>intervalMs)throw Error('Invalid --nar-final-interval.');
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid --port.');
 const root=resolve(process.env.ODDS_DATA_DIR??'data');
 const address=`http://127.0.0.1:${port}/#live/nar`;
 const viewer=Boolean(values['serve-only']);
 const dataPath=join(root,'live.json'),server=serveLive({dataPath,port,localStatus:{viewer,interval_ms:viewer?null:intervalMs,nar_final_interval_ms:viewer?null:finalIntervalMs}});
 const controller=new AbortController();
 const stop=()=>controller.abort();
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 let store;
 try{
  try{await once(server,'listening');}
  catch(error){
   if(error.code!=='EADDRINUSE')throw error;
   const existing=await fetch(new URL('/data/local-status',address),{signal:AbortSignal.timeout(1500)})
    .then(response=>response.json()).catch(()=>null);
   if(existing?.service!=='odds-observer-local' || existing.viewer!==viewer ||
      (!viewer && (existing.interval_ms!==intervalMs || existing.nar_final_interval_ms!==finalIntervalMs)))throw error;
   console.log('Odds Observer is already running.');
   if(!values['no-browser'])openBrowser(address);
   return;
  }
  if(!viewer)store=new Store(join(root,'observations.sqlite'));
  console.log(viewer?'Viewer only.':`JRA + NAR, target ${intervalMs/1000}s before cutoff. Data: ${root}`);
  if(!viewer)console.log(`NAR final 5 min: ${finalIntervalMs/1000}s for the nearest cutoff venue.`);
  console.log('Press Ctrl+C to stop.');
  if(!values['no-browser'])openBrowser(address);
  if(viewer){if(!controller.signal.aborted)await once(controller.signal,'abort');}
  else{
   const common={root,store,intervalMs,signal:controller.signal};
   const jobs=[watchMeetings({...common,output:dataPath,localArchive:true}),
    watchNar({...common,finalIntervalMs,output:join(root,'nar-live.json')})];
   const outcomes=await Promise.allSettled(jobs.map(job=>job.catch(error=>{
    if(controller.signal.aborted && error.name==='AbortError')return;
    stop();throw error;
   })));
   for(const result of outcomes)if(result.status==='rejected')throw result.reason;
  }
 }finally{
  store?.close();
  server.close();
  process.off('SIGINT',stop);process.off('SIGTERM',stop);
 }
}

try{await main();}
catch(error){
 console.error(error.code==='EADDRINUSE'?'Port already in use. Stop the existing Odds Observer or use --port.':error.message);
 process.exitCode=1;
}
