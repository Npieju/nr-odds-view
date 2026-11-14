import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {replayFrame} from '../public/demo.mjs';
import {projectWinOdds,winForecastInput,FORECAST_COEFFICIENTS} from '../public/history.mjs';

const HORIZONS=[60,30,10];
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const read=path=>JSON.parse(readFileSync(path,'utf8'));

function cases(category,days,root){
 const result=[];
 for(const day of days){
  const archiveDir=join(root,category+'-history',day);
  const outcomesDir=join(root,'race-outcomes',category,day);
  for(const name of readdirSync(archiveDir).filter(name=>name.endsWith('.json')).sort()){
   const outcomePath=join(outcomesDir,name);
   if(!existsSync(outcomePath))continue;
   const archive=read(join(archiveDir,name)),outcome=read(outcomePath);
   if(outcome.race_id!==archive.race_id)continue;
   const final=new Map(outcome.final_odds.win.filter(q=>q.status==='active' && q.low>=1)
    .map(q=>[q.selection,q.low]));
   const start=Date.parse(archive.window_start_at),close=Date.parse(archive.sales_close_at);
   for(const horizon of HORIZONS){
    const asOf=close-horizon*1000;
    if(asOf<start)continue;
    const market=replayFrame(archive,(asOf-start)/1000).markets.find(m=>m.market==='win');
    if(!market)continue;
    const input=winForecastInput(market,asOf,close);
    if(!input || input.selections.length!==final.size || !input.selections.every(id=>final.has(id)))continue;
    result.push({race:archive.race_id,horizon,input,final});
   }
  }
 }
 return result;
}

function score(samples,coefficients){
 let error=0,count=0,shortError=0,shortCount=0;
 for(const {input,final} of samples){
  const projected=coefficients?projectWinOdds(input,coefficients):null;
  for(const [i,id] of input.selections.entries()){
   const current=input.current[i],estimate=projected?.get(id)??current;
   const difference=Math.abs(1/estimate-1/final.get(id));
   error+=difference;count++;
   if(current<=10){shortError+=difference;shortCount++;}
  }
 }
 return {mean:error/count,shortMean:shortError/shortCount,count,shortCount};
}

function fit(samples){
 // Keep the two corrections bounded while the training history is small.
 let best={level:0,momentum:0},loss=score(samples,best).mean;
 for(let level=-20;level<=20;level++){
  for(let momentum=0;momentum<=32;momentum++){
   const candidate={level:level/100,momentum:momentum/40};
   const candidateLoss=score(samples,candidate).mean;
   if(candidateLoss<loss){best=candidate;loss=candidateLoss;}
  }
 }
 return best;
}

function report(label,samples,category,coefficients){
 if(!samples.length)return;
 const rows=[samples,...HORIZONS.map(horizon=>samples.filter(s=>s.horizon===horizon))];
 for(const group of rows){
  if(!group.length)continue;
  const models=[null,FORECAST_COEFFICIENTS[category],coefficients].map(model=>score(group,model));
  console.log(JSON.stringify({
   period:label,horizonSeconds:group===samples?HORIZONS:group[0].horizon,
   races:new Set(group.map(s=>s.race)).size,horseObservations:models[0].count,shortOddsObservations:models[0].shortCount,
   inverseMaePoints:Object.fromEntries(['latest','current','calibrated'].map((model,i)=>[model,{
    all:Number((100*models[i].mean).toFixed(3)),atMost10:Number((100*models[i].shortMean).toFixed(3))
   }]))
  }));
 }
}

const [category,lastTrainingDay,evaluationDay,root=process.env.ODDS_DATA_DIR??'data']=process.argv.slice(2);
if(!Object.hasOwn(FORECAST_COEFFICIENTS,category) || !datePattern.test(lastTrainingDay) ||
   (evaluationDay && (!datePattern.test(evaluationDay) || evaluationDay<=lastTrainingDay))){
 throw Error('Usage: node src/calibrate-forecast.mjs <jra|nar> <last-training-date> [later-evaluation-date] [data-dir]');
}
const trainingDays=readdirSync(join(root,category+'-history'),{withFileTypes:true})
 .filter(entry=>entry.isDirectory() && datePattern.test(entry.name) && entry.name<=lastTrainingDay)
 .map(entry=>entry.name).sort();
const training=cases(category,trainingDays,root);
if(!training.length)throw Error('No training snapshots with matched settled win odds');
const coefficients=fit(training);
console.log(JSON.stringify({category,trainingDays,currentCoefficients:FORECAST_COEFFICIENTS[category],coefficients}));
report('training',training,category,coefficients);
if(evaluationDay)report(evaluationDay,cases(category,[evaluationDay],root),category,coefficients);
