import {resolve} from 'node:path';import {runRelay} from './relay.mjs';
// Credential arrives through hidden stdin, never argv or a checked-in file.
if(process.stdin.isTTY)process.stdin.setRawMode(true);
console.error('Ready for relay credentials on hidden stdin.');
const token=await new Promise(resolve=>{let value='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{value+=chunk;if(/[\r\n]/.test(value)){process.stdin.pause();resolve(JSON.parse(value).token);}});});
await runRelay({path:resolve(process.env.ODDS_DATA_DIR??'data','live.json'),url:'https://nr-odds-live-feed.goodthinker.chatgpt.site/api/live',token});
