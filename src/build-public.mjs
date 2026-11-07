import {mkdirSync,copyFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
const output=resolve(process.argv[2]??'work/pages-dist');
if(existsSync(join(output,'index.html')))throw Error('Use an empty output directory to avoid publishing stale files');
mkdirSync(join(output,'data'),{recursive:true});
for(const name of ['index.html','app.js','style.css','history.mjs'])copyFileSync(new URL('../public/'+name,import.meta.url),join(output,name));
writeFileSync(join(output,'.nojekyll'),'');
writeFileSync(join(output,'data/live.json'),JSON.stringify({schema_version:1,generated_at:null,markets:[],connection_message:'ライブ配信は未接続です。実データ収集は現在ローカルで動作します。'})+'\n');
console.log(output);
