const allowed='https://npieju.github.io';
function reply(data,status=200){return Response.json(data,{status,headers:{'Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Methods':'GET,PUT,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Cache-Control':'no-store','Vary':'Origin'}});}
export default {async fetch(request,env){
 const path=new URL(request.url).pathname;
 if(request.method==='OPTIONS')return reply({});
 if(path!=='/api/live')return reply({service:'Odds Observer live relay',endpoint:'/api/live'});
 if(request.method==='GET'){
  const row=await env.DB.prepare('SELECT payload FROM live_feed WHERE id=1').first();
  return reply(row?JSON.parse(row.payload):{generated_at:null,markets:[],connection_message:'配信API接続済み。コレクターの受信を待っています。'});
 }
 if(request.method!=='PUT')return reply({error:'method'},405);
 if(!env.PUBLISH_TOKEN || request.headers.get('authorization')!==`Bearer ${env.PUBLISH_TOKEN}`)return reply({error:'unauthorized'},401);
 const text=await request.text();if(text.length>1500000)return reply({error:'too_large'},413);
 let data;try{data=JSON.parse(text);}catch{return reply({error:'invalid_json'},400);}
 const ms=Date.parse(data.generated_at);
 if(!Number.isFinite(ms)||ms>Date.now()+10000||Date.now()-ms>60000||!Array.isArray(data.markets)||data.schema_version!==1)return reply({error:'invalid_or_old_snapshot'},400);
 // Accept only the projection the collector publishes, never raw response/credentials.
 const keys=['schema_version','generated_at','race_id','race_label','sales_channel','close_basis','sales_close_at','scheduled_start_at','window_start_at','remaining_seconds','markets'];
 const clean=Object.fromEntries(keys.filter(k=>k in data).map(k=>[k,data[k]]));
 await env.DB.prepare('INSERT INTO live_feed (id,generated_ms,payload) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET generated_ms=excluded.generated_ms,payload=excluded.payload WHERE excluded.generated_ms>live_feed.generated_ms').bind(ms,JSON.stringify(clean)).run();
 return reply({ok:true,generated_at:data.generated_at});
}};
