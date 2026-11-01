import { performance } from 'node:perf_hooks';
import { archiveRaw } from './store.mjs';

export function actionLinks(html) {
  return [...html.matchAll(/doAction\(\s*['"](\/JRADB\/access[OD]\.html)['"]\s*,\s*['"]([^'"]+)['"]/g)]
    .map(m=>({ path:m[1],cname:m[2] }));
}

// A raw probe, deliberately separate from a production odds parser.
// Do not infer source_time from the HTTP Date header or the fetch time.
export async function probeJra({ cname, root, store, fetchImpl = fetch }) {
  if (typeof cname !== 'string' || !/^[A-Za-z0-9_/.-]{1,160}$/.test(cname)) throw new Error('Invalid CNAME');
  const started_at = new Date().toISOString(), start = performance.now();
  let record;
  try {
    const response = await fetchImpl('https://www.jra.go.jp/JRADB/accessO.html',{
      method:'POST',body:new URLSearchParams({cname}),redirect:'error',
      headers:{'User-Agent':'OddsObserver/0.1 (personal source-quality measurement)'},
      signal:AbortSignal.timeout(15000)
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const received_at = new Date().toISOString();
    const raw_hash = archiveRaw(root,bytes);
    const html = new TextDecoder('shift_jis').decode(bytes);
    const page_error = /パラメータエラー|アクセスが集中|ご指定のページに接続できません/.test(html);
    record = { source:'jra-web',started_at,received_at,ok:response.ok && !page_error,
      http_status:response.status,elapsed_ms:performance.now()-start,raw_hash,
      bytes:bytes.length,http_date:response.headers.get('date'),
      cache_age:response.headers.get('age'),etag:response.headers.get('etag'),
      page_error,request_cname:cname,links:actionLinks(html),
      stage:'raw_only',source_time:null };
  } catch (error) {
    record = { source:'jra-web',started_at,received_at:new Date().toISOString(),ok:false,
      elapsed_ms:performance.now()-start,error_code:error.cause?.code ?? error.name,
      error_message:error.message,stage:'raw_only' };
  }
  store.attempt(record);
  return record;
}
