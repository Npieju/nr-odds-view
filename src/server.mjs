import { createServer } from 'node:http';
import { readFileSync,readdirSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function serveLive({dataPath,port=8787}) {
 const root=dirname(dataPath);
 const files=new Map([['/','index.html'],['/index.html','index.html'],['/app.js','app.js'],['/history.mjs','history.mjs'],['/chart.mjs','chart.mjs'],['/demo.mjs','demo.mjs'],['/style.css','style.css']]);
 const server=createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  try{
   const url=new URL(req.url,'http://localhost'),path=url.pathname;
   if(path==='/data/nar-history' || path.startsWith('/data/nar-history/')){
    res.setHeader('Content-Type','application/json; charset=utf-8');
    const historyRoot=join(root,'nar-history');
    if(path==='/data/nar-history'){
     const day=url.searchParams.get('date');
     if(day===null){
      const dates=entries(historyRoot).filter(name=>/^\d{4}-\d{2}-\d{2}$/.test(name)).sort().reverse();
      res.end(JSON.stringify({dates}));
     }else if(/^\d{4}-\d{2}-\d{2}$/.test(day)){
      const races=entries(join(historyRoot,day)).filter(name=>/^nar-\d{8}-\d{2}-\d{2}\.json$/.test(name)).sort().map(name=>{
       const {race_id,venue,race_number,race_label}=JSON.parse(readFileSync(join(historyRoot,day,name),'utf8'));
       return {race_id,venue,race_number,race_label};
      });
      res.end(JSON.stringify({races}));
     }else{res.statusCode=400;res.end('{}');}
    }else{
     const id=path.slice('/data/nar-history/'.length),match=id.match(/^nar-(\d{4})(\d{2})(\d{2})-\d{2}-\d{2}$/);
     if(!match){res.statusCode=404;res.end('{}');return;}
     const day=match.slice(1).join('-');
     try{res.end(readFileSync(join(historyRoot,day,id+'.json')));}
     catch(error){if(error.code!=='ENOENT')throw error;res.statusCode=404;res.end('{}');}
    }
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
