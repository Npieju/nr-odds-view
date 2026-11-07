import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function serveLive({dataPath,port=8787}) {
 const files=new Map([['/','index.html'],['/index.html','index.html'],['/app.js','app.js'],['/history.mjs','history.mjs'],['/style.css','style.css']]);
 const server=createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  try{
   const path=new URL(req.url,'http://localhost').pathname;
   if(path==='/data/live.json'){
    res.setHeader('Content-Type','application/json; charset=utf-8');
    try{res.end(readFileSync(dataPath));}catch{res.end(JSON.stringify({markets:[],generated_at:null}));}
   }else if(files.has(path)){
    const name=files.get(path);res.setHeader('Content-Type',(name.endsWith('.js')||name.endsWith('.mjs'))?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
    res.end(readFileSync(fileURLToPath(new URL('../public/'+name,import.meta.url))));
   }else{res.statusCode=404;res.end('Not found');}
  }catch{res.statusCode=500;res.end('Unable to load local view');}
 });
 server.listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${server.address().port}`));return server;
}
