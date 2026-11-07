const allowed='https://npieju.github.io';
function reply(data,status=200){return Response.json(data,{status,headers:{'Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Methods':'GET,PUT,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Cache-Control':'no-store','Vary':'Origin'}});}
const racePattern=/^\d{8}(?:-\d{2}){4}$/;
const datePattern=/^\d{4}-\d{2}-\d{2}$/;

async function history(request,env,url,id){
 if(request.method==='GET'){
  if(id){
   const row=await env.DB.prepare('SELECT payload FROM race_history WHERE race_id=?').bind(id).first();
   return row?reply(JSON.parse(row.payload)):reply({error:'race_not_found'},404);
  }
  const date=url.searchParams.get('date');
  if(!date){
   const {results}=await env.DB.prepare('SELECT DISTINCT meeting_date FROM race_history ORDER BY meeting_date DESC').all();
   return reply({dates:results.map(r=>r.meeting_date)});
  }
  if(!datePattern.test(date))return reply({error:'invalid_date'},400);
  const {results}=await env.DB.prepare('SELECT race_id,venue,race_number,race_label FROM race_history WHERE meeting_date=? ORDER BY close_ms,venue').bind(date).all();
  return reply({races:results});
 }
 if(request.method!=='PUT' || !id)return reply({error:'method'},405);
 if(!env.PUBLISH_TOKEN || request.headers.get('authorization')!==`Bearer ${env.PUBLISH_TOKEN}`)return reply({error:'unauthorized'},401);
 const body=await request.text();
 if(body.length>1500000)return reply({error:'too_large'},413);
 let data;
 try{data=JSON.parse(body);}catch{return reply({error:'invalid_json'},400);}
 const close=Date.parse(data?.sales_close_at);
 const markets=data?.markets;
 if(data?.schema_version!==1 || data.race_id!==id || !datePattern.test(data.meeting_date) || !id.startsWith(data.meeting_date.replaceAll('-','')) || !Number.isInteger(data.race_number) || !Number.isFinite(close) || close>Date.now() || !Array.isArray(markets) || !markets.every(m=>!m.received_at || Date.parse(m.received_at)<close))return reply({error:'invalid_history'},400);
 const received=Math.max(...markets.map(m=>m.received_at?Date.parse(m.received_at):-Infinity));
 if(!Number.isFinite(received))return reply({error:'empty_history'},400);
 const keys=['schema_version','generated_at','race_id','race_label','meeting_date','venue','race_number','sales_channel','close_basis','sales_close_at','scheduled_start_at','window_start_at','remaining_seconds','markets'];
 const clean=Object.fromEntries(keys.filter(key=>key in data).map(key=>[key,data[key]]));
 await env.DB.prepare(`INSERT INTO race_history VALUES (?,?,?,?,?,?,?,?)
  ON CONFLICT(race_id) DO UPDATE SET meeting_date=excluded.meeting_date,venue=excluded.venue,race_number=excluded.race_number,race_label=excluded.race_label,close_ms=excluded.close_ms,last_received_ms=excluded.last_received_ms,payload=excluded.payload
  WHERE excluded.last_received_ms>=race_history.last_received_ms`)
  .bind(id,data.meeting_date,data.venue,data.race_number,data.race_label,close,received,JSON.stringify(clean)).run();
 return reply({ok:true,race_id:id});
}
export default {async fetch(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(request.method==='OPTIONS')return reply({});
 if(path==='/api/history')return history(request,env,url);
 if(path.startsWith('/api/history/')){
  const id=path.slice('/api/history/'.length);
  return racePattern.test(id)?history(request,env,url,id):reply({error:'invalid_race'},400);
 }
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
 const keys=['schema_version','generated_at','race_id','race_label','sales_channel','close_basis','sales_close_at','scheduled_start_at','window_start_at','remaining_seconds','markets','meeting_date','venues'];
 const clean=Object.fromEntries(keys.filter(k=>k in data).map(k=>[k,data[k]]));
 await env.DB.prepare('INSERT INTO live_feed (id,generated_ms,payload) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET generated_ms=excluded.generated_ms,payload=excluded.payload WHERE excluded.generated_ms>live_feed.generated_ms').bind(ms,JSON.stringify(clean)).run();
 return reply({ok:true,generated_at:data.generated_at});
}};
