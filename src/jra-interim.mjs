import { parseTanpukuTable } from './jra-final.mjs';

// Interim time label is documented in public JRA HTML captures (see docs/live.md).
// Reuse numeric table validation with independently parsed interim phase/time.
export function parseJraInterim(html, manifest, attempt) {
  const labels=[...html.matchAll(/<div class="cell time">\s*<strong>([^<]+)<\/strong>\s*<\/div>/g)].map(m=>m[1]);
  const clocks=labels.map(t=>t.match(/^(\d{1,2})時(\d{2})分現在オッズ$/)).filter(Boolean);
  if(clocks.length!==1 || labels.some(t=>/最終|確定/.test(t))) throw Error('Not an unambiguous interim odds page');
  const [,hour,minute]=clocks[0];
  if(+hour>23 || +minute>59) throw Error('Invalid source clock');
  const date=manifest.race_label?.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if(!date) throw Error('Race date required');
  const source_time=`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}T${hour.padStart(2,'0')}:${minute}:00+09:00`;
  const received=Date.parse(attempt.received_at), source=Date.parse(source_time);
  // Same-day collector only: no guessed previous-day clock around midnight.
  if(!Number.isFinite(source) || source>received || received-source>86400000) throw Error('Ambiguous or future source date');
  return parseTanpukuTable(html,manifest,attempt,{phase:'interim',source_time,time_precision:'minute',adapter_verification:'historical-layout-current-interim-not-yet-observed'});
}
