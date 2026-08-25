/* ============================================================================
 * research/feel-stats.js — Wave 5 "road to 10" FEEL HARNESS (variety+pacing)
 *
 * Purpose : Bots cannot judge fun, but they can MEASURE variety and pacing.
 *           This harness simulates the DIRECTOR (index.html IQ.Stage.pick /
 *           eligible, L272-302) over the REAL registered stage tables and the
 *           REAL alignment world rotation, then scores the output against the
 *           wave-5 feel heuristics:
 *             H1  takeover gap 3-6 depths          (rail enforces >=3)
 *             H2  no takeover stage twice within 8
 *             H3  no world theme twice within 4
 *             H4  10-depth window entropy >= 2.2/ln(4) ~= 1.587 bits
 *           Plus quip-pool breadth (shadow.js POOLS, demonsay FALLBACK,
 *           pack-quips-w4 POOLS, pack-story tables) -> repeats-expected/10.
 *
 * Method  : - REAL modules loaded headless with a window shim (pattern stolen
 *             from research/soak-headless.js): alignment.js, worlds.js,
 *             worlds-realm/pop/mind.js, hooks.js, and every mode file actually
 *             wired in index.html L1072-1095.
 *           - The ONLY re-implemented game code is the tiny Stage registry +
 *             director, copied VERBATIM from index.html L245-303 (cited
 *             inline). Two clearly-marked variant hooks (__setShare /
 *             applyWeights) exist ONLY for counterfactual proposal sims;
 *             defaults are the shipped constants (.70/.55, real weights).
 *           - Determinism: one seeded mulberry32 rng per run (same family as
 *             soak-headless.js L14); NO Math.random on our side. NOTE: the
 *             live engine passes rng=null (index.html L570) so the shipped
 *             director falls back to Math.random (L294) -- see report.
 *
 * Run     : node research/feel-stats.js
 * Output  : JSON on stdout (rendered into feel-stats-report.md). LOADFAIL
 *           lines print for any module that refuses to load headless.
 *
 * Rails   : read-only on game code; parody ids only; no gameplay changes here.
 * ==========================================================================*/
'use strict';
const g = globalThis;
g.window = g;
g.localStorage = { _s:{}, getItem(k){return this._s[k]??null}, setItem(k,v){this._s[k]=String(v)}, removeItem(k){delete this._s[k]} };
g.matchMedia = g.matchMedia || function(){ return { matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} }; };
g.requestAnimationFrame = g.requestAnimationFrame || function(){ return 0; };
g.cancelAnimationFrame = g.cancelAnimationFrame || function(){};
g.performance = g.performance || { now:function(){return 0} };
function noopCtx(){ return new Proxy({}, { get(t,k){ if(k==='canvas') return {width:300,height:150,style:{}}; if(typeof k==='symbol') return undefined; return t[k]; }, set(){ return true; } }); }
g.document = {
  getElementById(){return null}, querySelector(){return null}, querySelectorAll(){return []},
  createElement(tag){ tag=String(tag||'');
    return { tag, style:{}, classList:{add(){},remove(){},toggle(){},contains(){return false}},
      setAttribute(){}, appendChild(){}, removeChild(){}, insertBefore(){}, remove(){},
      addEventListener(){}, focus(){}, querySelector(){return null}, querySelectorAll(){return []},
      getContext(){ return noopCtx(); }, width:300, height:150, isConnected:false, textContent:'', innerHTML:'' }; },
  body:{ className:'', classList:{add(){},remove(){},toggle(){},contains(){return false}}, appendChild(){}, insertBefore(){}, removeChild(){} },
  addEventListener(){}, head:{appendChild(){}}, documentElement:{appendChild(){}}, readyState:'complete'
};

const ROOT = __dirname + '/..';
const fs = require('fs');

/* ---------------------------------------------------------------------------
 * STAGE CORE — VERBATIM PORT of index.html L244-303 (director + registry).
 * Variant hooks (SHARE_EARLY/LATE + __setShare) are additions for the
 * counterfactual sims; their defaults equal the shipped constants (L293).
 * -------------------------------------------------------------------------*/
window.IQ = window.IQ || {};
IQ.Stage = (function(){
 const stages=new Map();                                    // idx L246
 let lastTakeover=-99, recentStages=[];                     // idx L247 (W5: anti-repeat memory)
 let SHARE_EARLY=.64, SHARE_LATE=.48;                       // idx L293 (hooked for variants)
 function normalize(def){                                   // idx L248-261
  return {
   id:String(def.id||'').trim(),name:String(def.name||def.id||'stage'),
   weight:Math.max(0,+def.weight||1),
   minDepth:Math.max(1,+def.minDepth||1),
   worlds:Array.isArray(def.worlds)?def.worlds.map(String):null,
   aligns:Array.isArray(def.aligns)?def.aligns.map(String):null,
   net:def.net==='relay'?'relay':'seed',
   mount:def.mount,describe:def.describe||null,frame:def.frame||null,
   onKey:def.onKey||null,cleanup:def.cleanup||null,
   goalText:String(def.goalText||'').slice(0,140),
   controls:String(def.controls||'').slice(0,90)
  };
 }
 function register(def){                                    // idx L262-267
  try{
   if(!def||typeof def!=='object'||typeof def.mount!=='function'||!String(def.id||'').trim())return null;
   const s=normalize(Object.assign({goalText:'survive the round'},def));stages.set(s.id,s);return s;
  }catch(e){return null}
 }
 function get(id){return typeof id==='string'?stages.get(id)||null:null}   // idx L268
 function list(){return Array.from(stages.values())}                       // idx L269
 /* Director wheel: puzzle's share is pinned (~70% early -> ~55% deep);
  * remaining stages split the rest by weight. */                          // idx L270-271
function eligible(depth,world,align){                                     // idx L272-279
  return list().filter(s=>{
   if(depth<s.minDepth)return false;
   if(s.worlds&&(!world||!s.worlds.includes(world)))return false;
   if(s.aligns&&(!align||!s.aligns.includes(align)))return false;
   return true;
  });
 }
 /* Director rails (QA): DEPTH 1-2 are ALWAYS the classic puzzle; takeovers
  * require minDepth>=3; at most ONE takeover per any 3 consecutive depths. */ // idx L280-281
 function take(s,depth){lastTakeover=depth;recentStages.push(s.id);if(recentStages.length>3)recentStages.shift();return s}
 function pick(rng,depth,world,align){                                     // idx L283-302
  depth=Math.max(1,Math.round(+depth||1));
  if(depth<3)return get('puzzle');
  if(depth-lastTakeover<3)return get('puzzle');
  const pool=eligible(depth,world,align);
  if(!pool.length)return get('puzzle');
  const pz=pool.find(s=>s.id==='puzzle');
  let rest=pool.filter(s=>s.id!=='puzzle'&&Math.max(3,s.minDepth)<=depth);
  if(!rest.length)return pz||get('puzzle');
  if(!pz)return take(rest[0],depth);
  const fresh=rest.filter(s=>!recentStages.includes(s.id));
  if(fresh.length)rest=fresh;
  const share=depth<=10?SHARE_EARLY:SHARE_LATE;
  const r=(rng?rng():Math.random());
  const restW=rest.reduce((a,s)=>a+s.weight,0);
  const pzW=restW*share/(1-share);
  let x=r*(pzW+restW);
  if(x<pzW)return pz;
  x-=pzW;
  for(const s of rest){x-=s.weight;if(x<=0)return take(s,depth)}
  return take(rest[rest.length-1],depth);
 }
 return {register,get,list,pick,eligible,reset(){lastTakeover=-99;recentStages=[]},
         __setShare(e,l){SHARE_EARLY=e;SHARE_LATE=l}};                     // idx L303 (+variant hook)
})();
/* END VERBATIM PORT ----------------------------------------------------------------*/

/* Load order mirrors index.html: alignment(L166) -> worlds(L167-170) -> hooks(L178). */
try{ require(ROOT+'/alignment.js'); }catch(e){ console.log('LOADFAIL alignment.js', String(e).slice(0,120)); }
for(const w of ['worlds.js','worlds-realm.js','worlds-pop.js','worlds-mind.js']){
  try{ require(ROOT+'/'+w); }catch(e){ console.log('LOADFAIL',w,String(e).slice(0,120)); }
}
try{ require(ROOT+'/hooks.js'); }catch(e){ console.log('LOADFAIL hooks.js', String(e).slice(0,120)); }

/* Every mode file actually wired in index.html L1072-1095. */
const MODES = ['modes/mode-puzzle.js','modes/mode-redlight.js','modes/snake.js','modes/doom.js',
 'modes/saberclash.js','modes/slime.js','modes/tetris.js','modes/pacman.js','modes/battleship.js',
 'modes/slots.js','modes/floorfall.js','modes/hunterdodge.js','modes/laserstorm.js',
 'modes/dronedodge.js','modes/fractalsolve.js','modes/hypercube606.js','modes/phoenixritual.js',
 'modes/gauntlet.js','modes/sniperstage.js','modes/pop-glitter-stage.js','modes/metal-stage.js',
 'modes/terminator.js','modes/skylaser.js','modes/madmax.js'];
for(const m of MODES){ try{ require(ROOT+'/'+m); }catch(e){ console.log('LOADFAIL',m,String(e).slice(0,120)); } }

/* Seeded rng — mulberry32, same family as soak-headless.js L14. */
function makeRng(seed){ let a=seed>>>0; return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}; }
function hashSeed(s){ let h=2166136261>>>0; s=String(s); for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);} return h>>>0; }

/* Counterfactual helper: re-register a stage with a new weight, preserving
 * every other field captured by the real registration. */
function applyWeights(map){
  for(const id in map){
    const s=IQ.Stage.get(id);
    if(s) IQ.Stage.register(Object.assign({},s,{weight:map[id]}));
  }
}
const BASE_WEIGHTS = {}; for(const s of IQ.Stage.list()) BASE_WEIGHTS[s.id]=s.weight;

/* ---------------- registry dump (real registrations) ---------------- */
const REG = IQ.Stage.list().map(s=>({id:s.id,w:s.weight,minD:s.minDepth,worlds:s.worlds,aligns:s.aligns}));
REG.sort((a,b)=>a.id.localeCompare(b.id));
console.log('=== REGISTERED STAGES (real modules, n='+REG.length+') ===');
for(const s of REG) console.log(JSON.stringify(s));
console.log('=== WORLDS (real registry) ===');
for(const al of ['bad','good','chaotic','neutral']) console.log(al, JSON.stringify(IQ.Worlds.list(al)));

/* ---------------- simulation core ---------------- */
const DEPTHS=30;
const BUCKETS=[[1,2,'d1-2'],[3,5,'d3-5'],[6,10,'d6-10'],[11,20,'d11-20'],[21,30,'d21-30']];
function runSim(runs, opts){
  opts=opts||{};
  if(opts.share) IQ.Stage.__setShare(opts.share[0],opts.share[1]); else IQ.Stage.__setShare(.70,.55);
  if(opts.weights) applyWeights(opts.weights); else applyWeights(BASE_WEIGHTS);
  const takeoverIds=IQ.Stage.list().map(s=>s.id).filter(id=>id!=='puzzle');
  const acc={opening:[],gaps:[],stageRepeatDist:[],worldRepeatDist:[],puzzleBuckets:{},
             winEntropy:[],worstDrought:[],neverSeen:[],appears:{}};
  const repViol=[]; const worldRepViol=[]; let worldRepEx=[];
  for(let run=1;run<=runs;run++){
    const rng=makeRng(hashSeed('feel-'+run)^0x9E3779B9);
    IQ.Stage.reset();                                      // engine does this at startRun (index.html L524)
    IQ.Align.begin('feel-'+run, DEPTHS);
    const seq=[], worlds=[];
    for(let d=1;d<=DEPTHS;d++){
      const slice=IQ.Align.at(d);                          // consumed in order, like the engine
      const world=(slice&&slice.theme)||null, align=(slice&&slice.align)||null;
      const def=IQ.Stage.pick(rng,d,world,align);
      const id=(def&&def.id)||'puzzle';
      seq.push(id); worlds.push(world);
      if(id!=='puzzle') acc.appears[id]=(acc.appears[id]||0)+1;
    }
    const firstT=seq.findIndex(id=>id!=='puzzle');
    acc.opening.push(firstT<0?DEPTHS+1:firstT+1);
    const tpos=[]; for(let i=0;i<seq.length;i++) if(seq[i]!=='puzzle') tpos.push(i+1);
    for(let i=1;i<tpos.length;i++) acc.gaps.push(tpos[i]-tpos[i-1]);
    const lastSeenAt={};
    for(let i=0;i<seq.length;i++){
      const id=seq[i];
      if(lastSeenAt[id]!=null && id!=='puzzle'){
        const dist=i-lastSeenAt[id]; acc.stageRepeatDist.push(dist);
        if(dist<8) repViol.push({run,d:i+1,id,dist});
      }
      lastSeenAt[id]=i;
    }
    const lastW={};
    for(let i=0;i<worlds.length;i++){ const w=worlds[i]; if(!w) continue;
      if(lastW[w]!=null){ const dist=i-lastW[w]; acc.worldRepeatDist.push(dist);
        if(dist<4){ worldRepViol.push({w}); if(worldRepEx.length<12) worldRepEx.push({run,d:i+1,w,dist}); } }
      lastW[w]=i;
    }
    for(const [lo,hi,name] of BUCKETS){
      let pz=0,tot=0;
      for(let d=lo;d<=hi;d++){ tot++; if(seq[d-1]==='puzzle') pz++; }
      (acc.puzzleBuckets[name]=acc.puzzleBuckets[name]||[]).push(pz/tot);
    }
    let entSum=0,entN=0;
    for(let s0=0;s0+10<=DEPTHS;s0++){
      const cnt={}; for(let k=s0;k<s0+10;k++) cnt[seq[k]]=(cnt[seq[k]]||0)+1;
      let H=0; for(const id in cnt){ const p=cnt[id]/10; H-=p*Math.log(p)/Math.LN2; }
      entSum+=H; entN++;
    }
    acc.winEntropy.push(entSum/entN);
    const seenIds=new Set(seq.filter(id=>id!=='puzzle'));
    let worst=0;
    for(const id of seenIds){
      let cur=0,best=0;
      for(let d=3;d<=DEPTHS;d++){ if(seq[d-1]===id){ if(cur>best)best=cur; cur=0; } else cur++; }
      if(cur>best)best=cur;
      if(best>worst)worst=best;
    }
    acc.worstDrought.push(worst);
    acc.neverSeen.push(takeoverIds.filter(id=>!seenIds.has(id)).length);
  }
  const mean=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
  const pct=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.min(b.length-1,Math.floor(p*b.length))]};
  const ENT_T=2.2/Math.log(4); /* literal wave-5 threshold, ~=1.587 bits */
  const gapHist={}; for(const gp of acc.gaps) gapHist[gp]=(gapHist[gp]||0)+1;
  const repById={}; for(const v of repViol) repById[v.id]=(repById[v.id]||0)+1;
  const wrepByTheme={}; for(const v of worldRepViol) wrepByTheme[v.w]=(wrepByTheme[v.w]||0)+1;
  const shareOut={}; for(const k in acc.puzzleBuckets) shareOut[k]=+mean(acc.puzzleBuckets[k]).toFixed(4);
  return {
    runs,
    opening:{mean:+mean(acc.opening).toFixed(2),median:pct(acc.opening,.5),p90:pct(acc.opening,.9),max:Math.max(...acc.opening)},
    gap:{min:Math.min(...acc.gaps),max:Math.max(...acc.gaps),mean:+mean(acc.gaps).toFixed(2),
         violOver6:acc.gaps.filter(x=>x>6).length,violUnder3:acc.gaps.filter(x=>x<3).length,samples:acc.gaps.length,gapHist},
    stageRepeat:{samples:acc.stageRepeatDist.length,min:Math.min(...acc.stageRepeatDist),
                 mean:+mean(acc.stageRepeatDist).toFixed(2),violWithin8:repViol.length,byId:repById},
    worldRepeat:{samples:acc.worldRepeatDist.length,min:Math.min(...acc.worldRepeatDist),
                 mean:+mean(acc.worldRepeatDist).toFixed(2),violWithin4:worldRepViol.length,
                 byTheme:wrepByTheme,examples:worldRepEx},
    puzzleShare:shareOut,
    entropy:{thresholdBits:+ENT_T.toFixed(3),meanWindowBits:+mean(acc.winEntropy).toFixed(3),
             p10Bits:+pct(acc.winEntropy,.1).toFixed(3),minRunMeanBits:+Math.min(...acc.winEntropy).toFixed(3),
             runsBelowThreshold:acc.winEntropy.filter(h=>h<ENT_T).length,
             effectiveTypesPer10:+mean(acc.winEntropy.map(h=>Math.exp(h*Math.LN2))).toFixed(2)},
    drought:{worstMean:+mean(acc.worstDrought).toFixed(2),worstMax:Math.max(...acc.worstDrought),
             neverSeenMean:+mean(acc.neverSeen).toFixed(2),neverSeenMax:Math.max(...acc.neverSeen),
             takeoverStageCount:takeoverIds.length},
    appearancesPerRun:(()=>{const o={};for(const id in acc.appears)o[id]=+(acc.appears[id]/runs).toFixed(2);return o})()
  };
}

console.log('\n=== BASELINE (shipped constants) ===');
const baseline = runSim(1000);

console.log('\n=== VARIANT A — flatten top weights (proposal sim) ===');
const variantA = runSim(1000,{weights:{ saberclash:5, 'doom-corridor':5, hypercube606:5 }});

console.log('\n=== VARIANT B — A + takeover share .64 early /.48 deep (proposal sim) ===');
const variantB = runSim(1000,{weights:{ saberclash:5, 'doom-corridor':5, hypercube606:5 }, share:[.64,.48]});

/* ---------------- quip pool breadth (static extraction from real sources) ---- */
function objectPoolScan(src, declRegex){
  /* Locate `NAME = {`, balanced-scan to matching brace, then find each pool
     via `key: [` (quoted or bare key) and count string literals inside. */
  const m=src.match(declRegex); if(!m) return null;
  let i=m.index+m[0].length-1, depth=0, end=-1;
  for(;i<src.length;i++){ const ch=src[i];
    if(ch==='{')depth++; else if(ch==='}'){depth--; if(!depth){end=i;break;}} }
  const body=src.slice(m.index+m[0].length,end);
  const pools={};
  const keyRe=/(?:'([^']*)'|"([^"]*)"|([A-Za-z_$][\w$-]*))\s*:\s*\[/g; let km;
  while((km=keyRe.exec(body))){
    const keyName=km[1]||km[2]||km[3];
    let j=keyRe.lastIndex-1; depth=0; let e=-1;
    for(;j<body.length;j++){ const ch=body[j];
      if(ch==='[')depth++; else if(ch===']'){depth--; if(!depth){e=j;break;}} }
    if(e<0) continue;
    const arr=body.slice(keyRe.lastIndex,e);
    const strs=arr.match(/(['"])((?:\\.|(?!\1)[^\\])*)\1/g)||[];
    pools[keyName]=strs.length;
  }
  return pools;
}
function extractArrayCount(src, name){
  const m=src.match(new RegExp('(?:const|var|let)\\s+'+name+'\\s*=\\s*\\['));
  if(!m) return 0;
  let i=m.index+m[0].length-1, depth=0, end=-1;
  for(;i<src.length;i++){ const ch=src[i];
    if(ch==='[')depth++; else if(ch===']'){depth--; if(!depth){end=i;break;}} }
  const body=src.slice(m.index+m[0].length,end);
  const strs=body.match(/(['"])((?:\\.|(?!\1)[^\\])*)\1/g)||[];
  return strs.length;
}
const qsrc=f=>fs.readFileSync(ROOT+'/'+f,'utf8');
const shadowPools=objectPoolScan(qsrc('shadow.js'),/POOLS\s*=\s*\{/)||{};
const demonPools=objectPoolScan(qsrc('demonsay.js'),/FALLBACK\s*=\s*\{/)||{};
const w4Pools=objectPoolScan(qsrc('pack-quips-w4.js'),/POOLS\s*=\s*\{/)||{};
const storySrc=qsrc('pack-story.js');
const story={
  whispersLayers:extractArrayCount(storySrc,'WHISPERS'),
  chapters:extractArrayCount(storySrc,'CHAPTERS'),
  chaptersExtra:extractArrayCount(storySrc,'CHAPTERS_EXTRA'),
  sanctuary:extractArrayCount(storySrc,'SANCTUARY_FIRST')+extractArrayCount(storySrc,'SANCTUARY_RETURN')+extractArrayCount(storySrc,'SANCTUARY_VETERAN'),
  despair:extractArrayCount(storySrc,'DESPAIR'),
  defiance:extractArrayCount(storySrc,'DEFIANCE')
};
/* content_quips.js feeds IQ.Content.shadowQuips which DemonSay PREFERS (demonsay.js L225-229) */
const cqPath=ROOT+'/content_quips.js';
const contentPools=fs.existsSync(cqPath)?(objectPoolScan(fs.readFileSync(cqPath,'utf8'),/shadowQuips\s*[:=]\s*\{/)||{}):null;
function sumObj(o){ let n=0; for(const k in o) n+=o[k]; return n; }
function minPool(o){ const v=Object.values(o); return v.length?Math.min(...v):0; }
const E_REPEATS_PER_10=N=>+(45/Math.max(1,N)).toFixed(3); /* C(10,2)/N expected same-line collisions in 10 uniform draws */
const whispersTotal=sumObj(shadowPools)?story.whispersLayers:story.whispersLayers;
const quips={
  shadowJs:{pools:shadowPools,total:sumObj(shadowPools)},
  demonsayFallback:{pools:demonPools,total:sumObj(demonPools)},
  packQuipsW4:{pools:w4Pools,total:sumObj(w4Pools)},
  packStory:story,totalStory:Object.values(story).reduce((a,b)=>a+b,0),
  contentQuipsShadowPref:contentPools?{pools:contentPools,total:sumObj(contentPools)}:'file absent',
  repeatsPer10Formula:'C(10,2)/poolSize (uniform draws, 1 line/round)',
  repeatsPer10:{
    shadowSmallestPool:E_REPEATS_PER_10(minPool(shadowPools)),
    demonSmallestPool:E_REPEATS_PER_10(minPool(demonPools)),
    storyWhispersSingleLayer:E_REPEATS_PER_10(Math.round(story.whispersLayers/7))
  }
};

const out={ registryCount:REG.length, runs:1000, depths:DEPTHS,
            baseline, variantA, variantB, quips };
console.log('\n=== RESULTS ===');
console.log(JSON.stringify(out,null,1));
