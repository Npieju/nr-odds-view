import { createServer } from 'node:http';
import { readFileSync,readdirSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outcomePath } from './archive.mjs';

export function serveLive({dataPath,port=8787,localStatus}) {
 const root=dirname(dataPath);
 const files=new Map([['/','index.html'],['/index.html','index.html'],['/app.js','app.js'],['/history.mjs','history.mjs'],['/chart.mjs','chart.mjs'],['/demo.mjs','demo.mjs'],['/style.css','style.css']]);
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  try{
   const url=new URL(req.url,'http://localhost'),path=url.pathname;
   const history=path.match(/^\/data\/(jra|nar)-history(?:\/([A-Za-z0-9_-]{1,80}))?$/);
   if(path==='/data/local-status' && localStatus){
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.end(JSON.stringify({service:'odds-observer-local',...localStatus}));
   }else if(history){
    await serveHistory(url,res,root,history[1],history[2]);
   }else if(path==='/data/live.json' || path==='/data/nar-live.json'){
    res.setHeader('Content-Type','application/json; charset=utf-8');
    try{res.end(readFileSync(path==='/data/live.json'?dataPath:join(root,'nar-live.json')));}catch{res.end(JSON.stringify({markets:[],generated_at:null}));}
   }else if(files.has(path)){
    const name=files.get(path);res.setHeader('Content-Type',(name.endsWith('.js')||name.endsWith('.mjs'))?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
    res.end(readFileSync(fileURLToPath(new URL('../public/'+name,import.meta.url))));
   }else{res.statusCode=404;res.end('Not found');}
  }catch{res.statusCode=500;res.end('Unable to load local view');}
 });
 server.listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${server.address().port}`));return server;
}

function entries(path){
 try{return readdirSync(path);}
 catch(error){if(error.code!=='ENOENT')throw error;return [];}
}

async function serveHistory(url,res,root,category,id){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 const day=url.searchParams.get('date');
 const racePattern=category==='nar'?/^nar-(\d{4})(\d{2})(\d{2})-\d{2}-\d{2}$/:/^(\d{4})(\d{2})(\d{2})(?:-\d{2}){4}$/;
 const match=id?.match(racePattern);
 if((id&&!match) || (day!==null&&(id || !/^\d{4}-\d{2}-\d{2}$/.test(day)))){
  res.statusCode=400;res.end('{}');return;
 }
 const historyRoot=join(root,category+'-history');
 let local;
 if(id){
  const meetingDate=match.slice(1).join('-');
  let outcome=null;
  try{outcome=JSON.parse(readFileSync(outcomePath(root,category,meetingDate,id),'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(url.searchParams.get('outcome')==='1'){res.end(JSON.stringify({outcome}));return;}
  try{
   const body=readFileSync(join(historyRoot,meetingDate,id+'.json'),'utf8');
   res.end(outcome?JSON.stringify({...JSON.parse(body),outcome}):body);return;
  }catch(error){if(error.code!=='ENOENT')throw error;}
 }else if(day){
  const races=entries(join(historyRoot,day)).filter(name=>name.endsWith('.json')&&racePattern.test(name.slice(0,-5))).map(name=>{
   const {race_id,venue,race_number,race_label}=JSON.parse(readFileSync(join(historyRoot,day,name),'utf8'));
   return {race_id,venue,race_number,race_label};
  });
  local={races};
 }else{
  local={dates:entries(historyRoot).filter(name=>/^\d{4}-\d{2}-\d{2}$/.test(name)).sort().reverse()};
 }
 if(category==='jra'){
  const upstream=new URL('https://nr-odds-live-feed.goodthinker.chatgpt.site/api/history'+(id?'/'+id:''));
  if(day)upstream.searchParams.set('date',day);
  try{
   const response=await fetch(upstream,{signal:AbortSignal.timeout(id?8000:2500),redirect:'error'});
   if(id){res.statusCode=response.status;res.end(await response.text());return;}
   if(response.ok){
    const remote=await response.json();
    if(day)local.races=[...new Map([...remote.races,...local.races].map(race=>[race.race_id,race])).values()];
    else local.dates=[...new Set([...remote.dates,...local.dates])].sort().reverse();
   }
  }catch{/* Local records remain available when the published archive is offline. */}
 }
 if(!local){res.statusCode=404;res.end('{}');return;}
 if(day)local.races.sort((a,b)=>a.race_number-b.race_number || a.race_id.localeCompare(b.race_id));
 res.end(JSON.stringify(local));
}
