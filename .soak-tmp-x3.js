// Headless 60-round soak: real hooks.js + every landed pack through real dispatch.
const g = globalThis; g.window = g; g.IQ = {}; g.localStorage = { _s:{}, getItem(k){return this._s[k]??null}, setItem(k,v){this._s[k]=String(v)}, removeItem(k){delete this._s[k]} };
g.document = { getElementById(){return null}, querySelector(){return null}, querySelectorAll(){return []}, createElement(){return {style:{},classList:{add(){},remove(){}},setAttribute(){},appendChild(){}}}, body:{className:'',classList:{add(){},remove(){},contains(){return false}},appendChild(){},insertBefore(){}}, addEventListener(){}, head:{appendChild(){}} };
require('./alignment.js'); require('./worlds.js'); require('./worlds-realm.js'); require('./worlds-pop.js'); require('./worlds-mind.js');
require('./hooks.js');
const packs=['pack-hunters','pack-realm','pack-events','pack-chaos','pack-stones','pack-horror','pack-undead','pack-gunship','pack-countries','pack-brit','pack-nam','pack-muses','pack-ailments','pack-void-extra','hellheaven','pack-hellaudio','hell-skin','sanctuary','cameo-pack','pack-cavern','pack-popcult-a','pack-popcult-b','pack-story','pack-funny'];
for(const p of packs){ try{require('./'+p+'.js')}catch(e){console.log('LOADFAIL',p,String(e).slice(0,80))} }
const IQ=g.IQ, H=IQ.Hooks;
IQ.Align.begin('soak-seed-a',4096);
let hp=100,score=0,streak=0,errs=0,fired={},mods={},maxD=0,deaths=0;
for(let round=1;round<=60;round++){
  const slice=IQ.Align.at(round)||{align:'bad',theme:'hell-layer',dim:'2d',heal:0,amp:0};
  const world=slice.theme||'jungle'; const align=slice.align;
  const mk=(seed)=>{let a=seed>>>0;return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}};
  const rng=mk(round*7919);
  const ctx={round,world,align,hp,score,streak,timerLen:60,optCount:8,rng,runId:'soak',seed:round*31};
  try{
    let ms=H.dispatch('roundStart',ctx); ms.forEach(m=>{fired[world]=(fired[world]||0)+1;for(const k in m){mods[k]=(mods[k]||0)+1;if(k==='hpDelta')hp+=m[k];if(k==='scoreDelta')score+=m[k];}});
    if(slice.heal){hp=Math.min(100,hp+30);}
    for(let t=1;t<=20;t++){ H.dispatch('tick',{dtSec:3,round,world,align,hp,score,streak,timerLen:60,optCount:8,rng:mk(round*100+t),runId:'soak',seed:round*31}); }
    const correct=rng()<0.72;
    H.dispatch('preAnswer',{round,world,align,hp,score,streak,timerLen:30,optCount:8,rng,runId:'soak',seed:round});
    if(!correct){streak=0;} else streak++;
    score+=correct?120:-40;
    if(!correct&&align!=='good')hp-=15;
    ms=H.dispatch('answer',{round,world,align,hp,score,streak,timerLen:30,optCount:8,rng,runId:'soak',seed:round,res:{correct,picked:2,correctIdx:correct?2:0}});
    ms.forEach(m=>{for(const k in m){if(k==='hpDelta')hp+=m[k];if(k==='scoreDelta')score+=m[k];}});
    H.dispatch('reveal',{round,world,align,hp,score,streak,timerLen:30,optCount:8,rng,runId:'soak',seed:round,res:{correct}});
    H.dispatch('interlude',{round,world,align,hp,score,streak,timerLen:60,optCount:8,rng,runId:'soak',seed:round});
    if(hp<0){deaths++;break;}
    maxD=round;
  }catch(e){errs++;console.log('ROUND',round,'ERR',String(e).slice(0,90));break;}
}
console.log(JSON.stringify({maxDepthReached:maxD,hpLeft:hp,score,errs,deaths,picksFired:fired,modifierCounts:mods,packsLoaded:Object.keys(IQ.Hooks._packs||{}).length}));
