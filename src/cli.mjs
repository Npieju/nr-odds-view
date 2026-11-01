import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store, archiveRaw, atomicJson, validateSnapshot } from './store.mjs';
import { probeJra } from './probe.mjs';
import { collectJvLink } from './jvlink.mjs';
import { auditRace } from './audit.mjs';
import { collectJraWeb, discoverJra } from './jra-web.mjs';
import { watchJra } from './watch.mjs';

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
  } else if(command==='watch-jra') {
    if(args.length<1 || args.length>3) throw new Error('watch-jra <race.local.json> [interval-ms=30000] [count=30]');
    const result=await watchJra({loadConfig:()=>JSON.parse(readFileSync(args[0],'utf8')),root,store,
      intervalMs:args[1]===undefined?30000:Number(args[1]),count:args[2]===undefined?30:Number(args[2]),
      onResult:r=>console.log(JSON.stringify(r))});
    console.log(JSON.stringify(result));if(result.stopped==='three_consecutive_failures')process.exitCode=1;
  } else if (command === 'collect-jra') {
    if(args.length!==1) throw new Error('collect-jra <race.local.json>');
    const result=await collectJraWeb({config:JSON.parse(readFileSync(args[0],'utf8')),root,store});
    console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
  } else if (command === 'discover-jra') {
    const result=await discoverJra({root,store});
    console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
  } else if (command === 'collect-jvlink') {
    if (args.length!==1) throw new Error('collect-jvlink <race.local.json>');
    const result=await collectJvLink({config:JSON.parse(readFileSync(args[0],'utf8')),root,store});
    console.log(JSON.stringify(result,null,2));
    if(!result.ok) process.exitCode=1;
  } else if (command === 'audit') {
    if(args.length!==1) throw new Error('audit <audit.local.json>');
    console.log(JSON.stringify(auditRace(store,JSON.parse(readFileSync(args[0],'utf8'))),null,2));
  } else if (command === 'export') {
    const output = resolve(args[0] ?? resolve(root,'exports/latest.json'));
    if (!output.startsWith(root+'/') && !output.startsWith(root+'\\')) throw new Error('Export must stay under ODDS_DATA_DIR; redistribution permission is unverified');
    atomicJson(output,store.export());
    console.log(output);
  } else if (command === 'compare') {
    console.log(JSON.stringify({ interpretation:'First-observed differences; not measured publication or network latency',matches:store.compare() },null,2));
  } else {
    throw new Error('Commands: discover-jra, collect-jra, probe-jra, collect-jvlink (optional), ingest, export, compare, audit. See README.md.');
  }
} catch (error) {
  console.error(error.message);process.exitCode=1;
} finally { store.close(); }
