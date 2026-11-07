import {archiveRaw} from './store.mjs';import {actionLinks} from './probe.mjs';
export const venuesByCode={'01':'札幌','02':'函館','03':'福島','04':'新潟','05':'東京','06':'中山','07':'中京','08':'京都','09':'阪神','10':'小倉'};
export const jstDate=(at=Date.now())=>new Date(at+9*3600000).toISOString().slice(0,10);
export function parseMeetings(html,date){
 const compact=date.replaceAll('-',''),found=new Map();
 for(const link of actionLinks(html)){
  const m=link.cname.match(/^pw15orl00(\d{2})\d{8}(\d{8})\//);
  if(m && m[2]===compact && venuesByCode[m[1]])found.set(m[1],{venue_code:m[1],venue:venuesByCode[m[1]],cname:link.cname});
 }
 return [...found.values()];
}
export function parseUpcoming(html,date,now=Date.now()){
 const found=new Map();
 for(const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)){
  const time=row[1].match(/<td class="time">\s*(\d{1,2})時(\d{2})分\s*<\/td>/);
  const link=actionLinks(row[1]).find(l=>/^pw151ou/.test(l.cname));
  if(!time || !link)continue;
  const start=Date.parse(`${date}T${time[1].padStart(2,'0')}:${time[2]}:00+09:00`);
  if(start-60000>now)found.set(link.cname,{cname:link.cname,scheduled_start_at:new Date(start).toISOString(),sales_close_ms:start-60000});
 }
 return [...found.values()].sort((a,b)=>a.sales_close_ms-b.sales_close_ms);
}
export async function officialHtml({root,store,cname,fetchImpl=fetch}){
 const started_at=new Date().toISOString();let result;
 try{
 const url=cname?'https://www.jra.go.jp/JRADB/accessO.html':'https://www.jra.go.jp/keiba/';
 const r=await fetchImpl(url,{...(cname?{method:'POST',body:new URLSearchParams({cname})}:{}),signal:AbortSignal.timeout(15000),redirect:'error'});
 const raw=new Uint8Array(await r.arrayBuffer()),received_at=new Date().toISOString(),raw_hash=archiveRaw(root,raw);
 result={source:'jra-discovery',started_at,received_at,ok:r.ok,raw_hash,request_cname:cname??null,http_status:r.status,stage:'raw_only'};store.attempt(result);
 if(!r.ok)throw Error('Discovery HTTP '+r.status);
 return new TextDecoder('shift_jis').decode(raw);
 }catch(error){if(!result)store.attempt({source:'jra-discovery',started_at,received_at:new Date().toISOString(),ok:false,error_message:error.message});throw error;}
}
