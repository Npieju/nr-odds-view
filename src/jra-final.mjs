import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { probeJra } from './probe.mjs';
import { validateSnapshot } from './store.mjs';

const text = html => html.replace(/<[^>]*>/g, '').trim();

export function parseJraFinal(html, manifest, attempt) {
  if (!/<div class="cell time"><strong>最終オッズ<\/strong><\/div>/.test(html)) throw new Error('Unverified phase/layout; raw retained');
  return parseTanpukuTable(html,manifest,attempt,{phase:'final',source_time:null,time_precision:'unknown'});
}

// Shared numeric table contract; the caller must independently identify phase/time.
export function parseTanpukuTable(html, manifest, attempt, timing) {
  const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map(m=>text(m[1]));
  if (typeof manifest.race_label !== 'string' || !/^\d{4}年\d{1,2}月\d{1,2}日（.曜）\d+回\S+\d+日 \d+レース$/.test(manifest.race_label) ||
      !headings.some(h=>h.includes('単勝・複勝オッズ（馬番順）') && h.includes(manifest.race_label))) throw new Error('Race heading mismatch');
  if (!manifest.roster_evidence || !Array.isArray(manifest.expected_selections)) throw new Error('Independent roster evidence required');
  const tables = [...html.matchAll(/<table class="basic narrow-xy tanpuku">([\s\S]*?)<\/table>/g)];
  if (tables.length !== 1) throw new Error('Expected one tanpuku table');
  const rows = [...tables[0][1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m=>m[1]).filter(r=>r.includes('<td') && (r.includes('class="odds_tan"') ||
    (timing.phase==='final' && r.includes('class="num"'))));
  const markets = ['win','place'].map(market => {
    const quotes = rows.map(row => {
      const selection = text(row.match(/<td class="num">([\s\S]*?)<\/td>/)?.[1] ?? '').padStart(2,'0');
      const cell = row.match(new RegExp(`<td class="${market === 'win' ? 'odds_tan' : 'odds_fuku'}">([\\s\\S]*?)</td>`))?.[1] ?? '';
      const winCell=text(row.match(/<td class="odds_tan">([\s\S]*?)<\/td>/)?.[1]??'');
      if (timing.phase==='final' && manifest.withdrawn_selections?.includes(selection) &&
          /^(?:(?:出走)?取消|(?:競走|発走)?除外)$/.test(winCell)){
        return {selection,status:'withdrawn',low:null,high:null};
      }
      let low, high;
      if (market === 'win') low = high = text(cell);
      else {
        low = text(cell.match(/<span class="min">([^<]+)<\/span>/)?.[1] ?? '');
        high = text(cell.match(/<span class="max">([^<]+)<\/span>/)?.[1] ?? '');
      }
      if (![low,high].every(v=>/^\d+\.\d$/.test(v))) throw new Error('Unverified quote status/layout; raw retained');
      return { selection,status:'active',low:Number(low),high:Number(high) };
    });
    return validateSnapshot({source:'jra-web',race_id:manifest.race_id,market,...timing,
      request_started_at:attempt.started_at,received_at:attempt.received_at,
      expected_selections:manifest.expected_selections,
      roster_evidence:manifest.roster_evidence,quotes});
  });
  return markets;
}

export async function collectJraFinal({ cname, manifest, root, store, fetchImpl }) {
  const attempt = await probeJra({cname,root,store,fetchImpl});
  if (!attempt.ok) return attempt;
  const raw = readFileSync(join(root,'raw',attempt.raw_hash.slice(0,2),attempt.raw_hash+'.bin'));
  try {
    const snapshots = parseJraFinal(new TextDecoder('shift_jis').decode(raw),manifest,attempt);
    store.db.exec('BEGIN');
    try { for (const s of snapshots) store.ingest(s,raw); store.db.exec('COMMIT'); }
    catch(error) { store.db.exec('ROLLBACK'); throw error; }
    const result = {...attempt,stage:'normalized_final',markets:snapshots.map(s=>s.market)};
    store.attempt(result);
    return result;
  } catch(error) {
    const result = {...attempt,ok:false,stage:'parse_rejected',error_message:error.message};
    store.attempt(result);
    return result;
  }
}
