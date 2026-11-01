import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store, archiveRaw, atomicJson, validateSnapshot } from './store.mjs';
import { probeJra } from './probe.mjs';

const [command,...args] = process.argv.slice(2);
const root = resolve(process.env.ODDS_DATA_DIR ?? 'data');
const store = new Store(resolve(root,'observations.sqlite'));
try {
  if (command === 'ingest') {
    if (args.length !== 2) throw new Error('ingest <normalized.json> <original-response-file>');
    const snapshot = JSON.parse(readFileSync(args[0],'utf8')), raw = readFileSync(args[1]);
    validateSnapshot(snapshot);
    archiveRaw(root,raw);
    const result = store.ingest(snapshot,raw);
    console.log(JSON.stringify(result));
  } else if (command === 'probe-jra') {
    if (args.length !== 1) throw new Error('probe-jra <CNAME copied from the current official page>');
    const result = await probeJra({ cname:args[0],root,store });
    console.log(JSON.stringify(result,null,2));
    if (!result.ok) process.exitCode = 1;
  } else if (command === 'export') {
    const output = resolve(args[0] ?? 'public/data/latest.json');
    atomicJson(output,store.export());
    console.log(output);
  } else if (command === 'compare') {
    console.log(JSON.stringify({ interpretation:'First-observed differences; not measured publication or network latency',matches:store.compare() },null,2));
  } else {
    throw new Error('Commands: probe-jra, ingest, export, compare. See README.md.');
  }
} catch (error) {
  console.error(error.message);process.exitCode=1;
} finally { store.close(); }
