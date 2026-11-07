import {resolve} from 'node:path';import {runRelay} from './relay.mjs';
import {Store} from './store.mjs';
import {runArchiveRelay} from './archive.mjs';
// Credential arrives through hidden stdin, never argv or a checked-in file.
if(process.stdin.isTTY)process.stdin.setRawMode(true);
console.error('Ready for relay credentials on hidden stdin.');
const token=await new Promise(resolve=>{let value='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{value+=chunk;if(/[\r\n]/.test(value)){process.stdin.pause();resolve(JSON.parse(value).token);}});});
if(process.stdin.isTTY)process.stdin.setRawMode(false);
const root=resolve(process.env.ODDS_DATA_DIR??'data');
const origin='https://nr-odds-live-feed.goodthinker.chatgpt.site';
if(process.argv.includes('--history')){
 const store=new Store(resolve(root,'observations.sqlite'));
 try{await runArchiveRelay({root,store,url:`${origin}/api/history`,token,once:process.argv.includes('--once')});}finally{store.close();}
}else{
 await runRelay({path:resolve(root,'live.json'),url:`${origin}/api/live`,token});
}
