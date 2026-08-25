/* ============================================================
   modes/tidepool.js — STAGE "TIDE POOL" (Wave 5, road to 10)
   Full-surface takeover stage. Own input model: the 8 answer
   options are tide pools on a 5-row shore; a seeded TIDE cycles
   (pure f(round clock)) and SUBMERGED pools are unclickable —
   tap them anyway and you get a splash (no penalty, but it costs
   the DRY SHOES bonus). Tap your pool while it is DRY to answer.
   Seed-deterministic (net:'seed'): tide range/phase/period,
   question, option order and row placement all derive from
   ctx.rng at mount in FIXED DRAW ORDER (see drawSchedule), so MP
   tabs see the identical challenge. Live water level is pure
   f(local round clock) — player timing skill, like redlight.
   SOLVABILITY RAIL: the correct pool's row is drawn ONLY among
   rows that are above water >=35% of each cycle given the drawn
   tide range (analytic for the triangle wave: dryFrac = thr/max),
   so every mount is solvable by waiting. Verified over 500 seeds
   in research/smoke-tidepool.js.
   POINTS CURVE vs puzzle par (100*diff+40): TP_PAY pays
   130/200/280/370/460 at diff 1..5 = [93%,83%,82%,84%,85%] of par,
   inside the takeover band [60%,135%] used by sibling stages;
   +15 'DRY SHOES' (never tapped a submerged pool) tops out at
   475 < 135% of diff-5 par (729). Wrong pick -40/-12 hp; timeout
   self-limits to timerLen (engine injects the same wrong result).
   Fairness rails: submerged gating is LOCAL to this stage (class +
   click guard), engine disableOption hooks untouched; splash is
   feedback only; flashes <=140 ms; pause overlay pointer-events:none
   and escapable (Esc/P); all text >=11px; IQB_MOTION off => no
   shimmer/wave animation, state changes stay instant.
   Touch parity: tap == click (pointer events). No hover-dependent
   mechanics. Keyboard 1-8 mirrors taps.
   ============================================================ */
(function(){
'use strict';
var root=window.IQ=window.IQ||{};
function register(def){
  if(root.Stage&&typeof root.Stage.register==='function')root.Stage.register(def);
  else(window.__stagePending=window.__stagePending||[]).push(def); /* StageCore drains */
}

var GLYPHS=['plus','cross','ring','square','diamond','triangle'];
var COLORS=[0,2,3,5]; /* stable palette slots: cyan, gold, green, rose */
var ROWS=5;                       /* shore rows: 0 = waterline, 4 = high shelf */
var RAIL=0.35;                    /* correct row must be dry >=35% of cycle */
var TP_PAY=[130,200,280,370,460]; /* win points by ctx.diff (see header) */
var BONUS_DRY=15;                 /* 'DRY SHOES' */
var PERIODS=[8000,9000,10000,11000];
var T={};                         /* live handles */
var CTX=null;

/* ---------- tide math (pure, exported to smoke) ---------- */
function tri(x){return x<.5?x*2:2-2*x;}            /* 0 ->1 ->0 each cycle */
function waterAt(sch,ms){                           /* water height 0..max */
  var x=((ms/sch.period+sch.phase)%1+1)%1;
  return tri(x)*sch.max;
}
function rowThr(r){return r+0.5;}
function dryFrac(row,max){var t=rowThr(row);return t>=max?1:t/max;}
function submergedAt(sch,row,ms){return waterAt(sch,ms)>rowThr(row)+0.05;}

/* ---------- seeded schedule: FIXED DRAW ORDER ---------- */
/*
   1 tide max        rng()          (2.2 .. 3.2)
   2 tide phase      rng()          (0 .. 1)
   3 tide period     rng()          (index into PERIODS)
   4 sequence        K*2 rng()      glyph+color per step (K=3, +1 tier>=2)
   5 distractors     variable rng() until 8 unique options
   6 shuffle         7 rng()        Fisher-Yates from last
   7 answer row      rng()          among rows meeting the 35% rail
   8 distractor rows ROWS-1 rng()   any row (traps allowed)
*/
function drawSchedule(rng,diff,tier){
  var sch={max:2.2+rng(),phase:rng(),period:PERIODS[Math.floor(rng()*PERIODS.length)]};
  var K=3+(tier>=2?1:0);
  var seq=[],i,m;
  for(i=0;i<K;i++)seq.push({g:GLYPHS[Math.floor(rng()*GLYPHS.length)],c:COLORS[Math.floor(rng()*COLORS.length)]});
  var step=seq[K-2],nxt=seq[K-1]; /* continue-the-pattern answer (same rule as RED LIGHT) */
  var ans={g:nxt.g===step.g?GLYPHS[(GLYPHS.indexOf(nxt.g)+1)%GLYPHS.length]:nxt.g,c:nxt.c};
  var opts=[{g:ans.g,c:ans.c}];
  while(opts.length<8){
    m={g:GLYPHS[Math.floor(rng()*GLYPHS.length)],c:COLORS[Math.floor(rng()*COLORS.length)]};
    if(!opts.some(function(o){return o.g===m.g&&o.c===m.c}))opts.push(m);
  }
  for(i=opts.length-1;i>0;i--){var j=Math.floor(rng()*(i+1));var tmp=opts[i];opts[i]=opts[j];opts[j]=tmp;}
  sch.seq=seq;sch.opts=opts;sch.answerIdx=0;
  var eligible=[];
  for(i=0;i<ROWS;i++)if(dryFrac(i,sch.max)>=RAIL)eligible.push(i);
  sch.railRows=eligible;
  sch.answerRow=eligible[Math.floor(rng()*eligible.length)];
  sch.rows=[sch.answerRow];
  for(i=1;i<8;i++)sch.rows.push(Math.floor(rng()*ROWS));
  return sch;
}

/* ---------- shared round clock (pausable, smoke-injectable) ---------- */
function rawNow(){return typeof window.__TIDEPOOL_CLOCK__==='function'?window.__TIDEPOOL_CLOCK__():Date.now();}
function now(){ /* ms since mount, excluding paused stretches */
  var r=rawNow()-T.base;
  return r-T.frozen-(T.paused?rawNow()-T.pauseAt:0);
}
function doPause(){if(!T.done&&!T.paused){T.paused=true;T.pauseAt=rawNow();T.overlay.style.display='flex';}}
function doResume(){if(T.paused){T.frozen+=rawNow()-T.pauseAt;T.paused=false;T.overlay.style.display='none';}}

function cleanup(){
  clearInterval(T.tickI);
  clearTimeout(T.safetyT);
  removeEventListener('keydown',onKey,true);
  T={};
}
function settle(res){
  if(T.done)return;T.done=true;
  const r=T.resolve;cleanup();
  setTimeout(()=>r&&r(res),420); /* let the reveal land */
}
function win(){
  var dry=!T.soggy;
  var pts=T.pay+(dry?BONUS_DRY:0);
  try{CTX.audio.p('levelup');CTX.fx.flash('rgba(0,230,138,.16)',130)}catch(e){}
  settle({kind:'score',correct:true,points:pts,hpDelta:0,
    summary:dry?'CORRECT POOL \u00B7 DRY SHOES +'+BONUS_DRY:'CORRECT POOL \u00B7 SOGGY BUT RIGHT'});
}
function wrongPick(){
  try{CTX.audio.p('buzz');CTX.fx.shake(10,260)}catch(e){}
  settle({kind:'score',correct:false,points:-40,hpDelta:-12,
    summary:'WRONG POOL \u2014 THE CRAB JUDGES YOU'});
}

/* ---------- input ---------- */
function onKey(e){
  if(T.done)return;
  var k=e.key;
  if(k==='Escape'||k==='p'||k==='P'){T.paused?doResume():doPause();return}
  if(T.paused)return;
  var n=parseInt(k,10);
  if(n>=1&&n<=8)press(n-1);
}
function press(i){
  if(T.done||T.paused||i<0||i>7)return;
  var btn=T.btns[i];
  if(submergedAt(T.sch,T.sch.rows[i],now())){
    /* local gating, engine contract intact: submerged = unclickable */
    T.soggy=true;
    if(btn){btn.classList.remove('tp-splash');void btn.offsetWidth;btn.classList.add('tp-splash');}
    try{CTX.audio.p('heart',{vol:.3})}catch(e){}
    T.state.textContent='A COLD SPLASH \u2014 THAT POOL IS UNDERWATER';
    return;
  }
  if(i===T.sch.answerIdx){if(btn)btn.classList.add('tp-right');win()}
  else{if(btn)btn.classList.add('tp-wrong');wrongPick()}
}

/* ---------- markup helpers ---------- */
function symChip(g,c,size){
  var col=(window.IQ&&IQ.Board)?IQ.Board.palRow()[c%8]:'#7dd3fc';
  var cx=size/2,cy=size/2,u=size*.72,r=u*.36,inner='';
  switch(g){
    case 'ring':inner='<circle cx="'+cx+'" cy="'+cy+'" r="'+(r*.8)+'" fill="none" stroke="'+col+'" stroke-width="'+(u*.14)+'"/>';break;
    case 'square':inner='<rect x="'+(cx-r*.8)+'" y="'+(cy-r*.8)+'" width="'+(r*1.6)+'" height="'+(r*1.6)+'" rx="2" fill="'+col+'"/>';break;
    case 'diamond':inner='<polygon points="'+cx+','+(cy-r)+' '+(cx+r)+','+cy+' '+cx+','+(cy+r)+' '+(cx-r)+','+cy+'" fill="'+col+'"/>';break;
    case 'triangle':inner='<polygon points="'+cx+','+(cy-r)+' '+(cx+r*.87)+','+(cy+r*.5)+' '+(cx-r*.87)+','+(cy+r*.5)+'" fill="'+col+'"/>';break;
    case 'cross':inner='<rect x="'+(cx-u*.11)+'" y="'+(cy-r)+'" width="'+(u*.22)+'" height="'+(r*2)+'" fill="'+col+'"/><rect x="'+(cx-r)+'" y="'+(cy-u*.11)+'" width="'+(r*2)+'" height="'+(u*.22)+'" fill="'+col+'"/>';break;
    default:inner='<rect x="'+(cx-u*.13)+'" y="'+(cy-r*.92)+'" width="'+(u*.26)+'" height="'+(r*1.84)+'" rx="2" fill="'+col+'"/><rect x="'+(cx-r*.92)+'" y="'+(cy-u*.13)+'" width="'+(r*1.84)+'" height="'+(u*.26)+'" rx="2" fill="'+col+'"/>';
  }
  return '<span class="tp-sym"><svg viewBox="0 0 '+size+' '+size+'" width="'+size+'" height="'+size+'">'+inner+'</svg></span>';
}
var CSS=
 '@media (prefers-reduced-motion:reduce){.stage-view[data-stage="tidepool"] *{animation:none!important;transition:none!important}}'+
 '.tp-board{position:relative;height:min(46vh,320px);margin:14px auto 6px;max-width:680px;border-radius:12px;'+
 'background:linear-gradient(#20303a,#141d24);border:1px solid rgba(125,211,252,.25);overflow:hidden}'+
 '.tp-water{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(rgba(56,150,220,.42),rgba(20,70,120,.62));'+
 'border-top:2px solid rgba(160,225,255,.7);transition:height .28s linear;pointer-events:none}'+
 '.tp-watershim{position:absolute;left:0;right:0;top:-2px;height:6px;background:repeating-linear-gradient(90deg,rgba(255,255,255,.25) 0 14px,transparent 14px 28px)}'+
 '.tp-row{position:absolute;left:0;right:0;display:flex;justify-content:center;gap:4%;pointer-events:none}'+
 '.tp-pool{pointer-events:auto;cursor:pointer;width:19%;min-width:74px;padding:6px 2px;border-radius:9px;text-align:center;'+
 'font-size:11px;letter-spacing:.08em;color:#eaf6ff;background:#2b3f4c;border:1px solid rgba(125,211,252,.4);'+
 'display:flex;flex-direction:column;align-items:center;gap:2px;user-select:none}'+
 '.tp-pool.tp-sub{filter:brightness(.55) saturate(.6) hue-shift(-18deg);box-shadow:inset 0 0 14px rgba(30,110,190,.75);cursor:not-allowed}'+
 '.tp-key{font-size:11px;color:#9fd8f5}'+
 '.tp-splash{animation:tpSplash .45s ease-out}@keyframes tpSplash{0%{transform:translateY(0)}40%{transform:translateY(-7px) rotate(-2deg)}100%{transform:translateY(0)}}'+
 '.tp-right{outline:2px solid #00e68a}.tp-wrong{outline:2px solid #ff2038}'+
 '.tp-q{font-size:13px;letter-spacing:.18em;color:#ffd88a;margin-top:10px}'+
 '.tp-seq{display:flex;gap:8px;align-items:center;justify-content:center;margin-top:6px;font-size:15px;color:#cfe8f5}'+
 '.tp-state{min-height:20px;font-size:12px;letter-spacing:.16em;color:#bfe6ff;text-transform:uppercase}'+
 '.tp-foot{font-size:11px;color:#8fb6c9;letter-spacing:.12em;margin-top:6px}';

/* ---------- registration ---------- */
register({
 id:'tidepool',
 name:'TIDE POOL',
 goalText:'ANSWER ONLY FROM A DRY POOL. THE TIDE DECIDES WHEN.',
 controls:'CLICK / TAP A DRY POOL OR PRESS 1\u20138',
 weight:3,           /* mid-low takeover frequency: gentle input model, but tide waits punish rushers */
 minDepth:3,
 net:'seed',
 mount(container,ctx){
  CTX=ctx;cleanup();
  T.pay=TP_PAY[Math.max(0,Math.min(4,(ctx.diff|0)-1))]||TP_PAY[0];
  T.sch=drawSchedule(ctx.rng,ctx.diff,ctx.tier);
  T.base=rawNow();T.frozen=0;T.paused=false;T.pauseAt=0;T.soggy=false;T.done=false;
  var motionOn=true;
  try{motionOn=window.IQB_MOTION!==false&&!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)}catch(e){}

  var el=document.createElement('div');
  el.className='stage-view';el.setAttribute('data-stage','tidepool');
  el.style.cssText='position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10px;'+
   "font-family:'Oxanium',sans-serif";
  var styleEl=document.createElement('style');styleEl.textContent=CSS;el.appendChild(styleEl);

  var q=document.createElement('div');q.className='tp-q';q.textContent='CONTINUE THE PATTERN \u2014 PICK YOUR POOL WHILE IT IS DRY';
  var seq=document.createElement('div');seq.className='tp-seq';
  seq.innerHTML=T.sch.seq.map(function(s){return symChip(s.g,s.c,40)}).join('<span>\u2192</span>')+'<span>?</span>';
  var board=document.createElement('div');board.className='tp-board';
  var water=document.createElement('div');water.className='tp-water';board.appendChild(water);
  if(motionOn){var shim=document.createElement('div');shim.className='tp-watershim';water.appendChild(shim)}
  /* one pool per option, placed in its scheduled shore row */
  var perRow={},r,i;
  for(i=0;i<8;i++){r=T.sch.rows[i];(perRow[r]=perRow[r]||[]).push(i)}
  T.btns=[];
  var rowH=100/ROWS;
  for(r=0;r<ROWS;r++){
    if(!perRow[r])continue;
    var rowEl=document.createElement('div');rowEl.className='tp-row';
    rowEl.style.bottom=(r*rowH+6)+'%';rowEl.style.height=rowH+'%';
    perRow[r].forEach(function(idx){
      var b=document.createElement('div');
      b.className='tp-pool';b.setAttribute('data-i',String(idx));
      b.innerHTML=symChip(T.sch.opts[idx].g,T.sch.opts[idx].c,34)+'<span class="tp-key">'+(idx+1)+'</span>';
      b.onclick=function(){press(idx)};
      rowEl.appendChild(b);T.btns[idx]=b;
    });
    board.appendChild(rowEl);
  }
  var state=document.createElement('div');state.className='tp-state';state.setAttribute('role','status');state.textContent='WATCH THE TIDE';
  var foot=document.createElement('div');foot.className='tp-foot';
  foot.textContent='submerged pools cannot be tapped \u00B7 splashes are harmless but ruin DRY SHOES +'+BONUS_DRY;
  /* READY legend: goal + controls (pointer-events none, auto-fades) */
  var ready=document.createElement('div');
  ready.style.cssText='position:absolute;left:50%;top:16%;transform:translate(-50%,-50%);background:rgba(4,10,16,.88);'+
   'border:1px solid rgba(125,211,252,.35);color:#eaf6ff;font-size:12px;letter-spacing:.12em;padding:10px 16px;'+
   'border-radius:8px;pointer-events:none;text-transform:uppercase;transition:opacity .5s;z-index:9;text-align:center';
  ready.textContent='TIDE POOL \u2014 ANSWER FROM A DRY POOL \u00B7 CLICK / TAP OR PRESS 1\u20138 \u00B7 ESC/P PAUSE';
  /* pause overlay: pointer-events none (escapable, never blocks), Esc/P toggles */
  var overlay=document.createElement('div');
  overlay.style.cssText='position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(2,8,14,.72);'+
   'color:#eaf6ff;font-size:15px;letter-spacing:.3em;pointer-events:none;z-index:20;text-transform:uppercase';
  overlay.textContent='PAUSED \u2014 PRESS ESC OR P TO RESUME';
  el.appendChild(q);el.appendChild(seq);el.appendChild(board);el.appendChild(state);el.appendChild(foot);
  el.appendChild(ready);el.appendChild(overlay);
  container.appendChild(el);
  T.root=el;T.water=water;T.state=state;T.boardH=320;T.overlay=overlay;

  /* render loop: water level + submersion gating, pure f(clock) */
  T.tickI=setInterval(function(){
    if(T.done)return;
    var t=now(),lvl=waterAt(T.sch,t);
    T.water.style.height=Math.max(0,Math.min(1,lvl/ROWS))*100+'%';
    for(var i=0;i<8;i++){
      var sub=submergedAt(T.sch,T.sch.rows[i],t);
      T.btns[i].classList.toggle('tp-sub',sub);
      T.btns[i].setAttribute('aria-disabled',sub?'true':'false');
    }
    var rising=((t/T.sch.period+T.sch.phase)%1)<.5;
    T.state.textContent=(T.paused?'PAUSED':(rising?'TIDE IS COMING IN':'TIDE IS GOING OUT'));
  },140);
  setTimeout(function(){ready.style.opacity='0'},3000);

  addEventListener('keydown',onKey,true);
  /* fairness rail: never let the engine's timeout inject first with no signal */
  T.safetyT=setTimeout(function(){if(!T.done)settle({kind:'score',correct:false,points:-40,hpDelta:-12,
    summary:'THE TIDE CLAIMED YOU'})},Math.max(1500,ctx.timerLen*1000-450));

  window.__TIDEPOOL__={ /* dev/soak peeks (smoke-gated logic lives in pure fns above) */
    sch:T.sch,press:press,paused:function(){return T.paused},soggy:function(){return T.soggy},
    now:now,waterAt:waterAt,submergedAt:submergedAt,dryFrac:dryFrac,railRows:T.sch.railRows};
  try{CTX.audio.p('sacrifice',{vol:.22})}catch(e){}
  return new Promise(function(resolve){T.resolve=resolve});
 },
 describe(){return {kind:'tidepool'}},
 cleanup(){cleanup()}
});
})();
