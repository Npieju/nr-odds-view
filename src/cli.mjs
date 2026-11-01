import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store, archiveRaw, atomicJson, validateSnapshot } from './store.mjs';
import { probeJra } from './probe.mjs';
import { collectJraFinal } from './jra-final.mjs';
import { replayAtCutoff } from './replay.mjs';
import { watchJra } from './collector.mjs';
import { serveLive } from './server.mjs';

const [command,...args] = process.argv.slice(2);
const root = resolve(process.env.ODDS_DATA_DIR ?? 'data');
const store = new Store(resolve(root,'observations.sqlite'));
try {
  if (command === 'watch-jra') {
    if(args.length!==1) throw new Error('watch-jra <live-config.json>');
    const controller=new AbortController();
    process.once('SIGINT',()=>controller.abort());
    await watchJra({config:JSON.parse(readFileSync(args[0],'utf8')),root,store,output:resolve(root,'live.json'),signal:controller.signal});
  } else if(command==='serve') {
    serveLive({dataPath:resolve(root,'live.json'),port:Number(args[0]??8787)});
  } else if (command === 'collect-jra-final') {
    if(args.length!==2) throw new Error('collect-jra-final <current-CNAME> <manifest.json>');
    const result=await collectJraFinal({cname:args[0],manifest:JSON.parse(readFileSync(args[1],'utf8')),root,store});
    console.log(JSON.stringify(result,null,2));
    if(!result.ok) process.exitCode=1;
  } else if (command === 'replay') {
    if(args.length!==1) throw new Error('replay <cutoff-query.json>');
    console.log(JSON.stringify(replayAtCutoff(store,JSON.parse(readFileSync(args[0],'utf8'))),null,2));
  } else if (command === 'ingest') {
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
    throw new Error('Commands: watch-jra, serve, probe-jra, ingest, export, compare, replay. See README.md.');
  }
} catch (error) {
  console.error(error.message);process.exitCode=1;
} finally { store.close(); }
