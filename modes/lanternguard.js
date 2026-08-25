/* ============================================================
   modes/lanternguard.js — STAGE "LANTERN WATCH" (Wave 5)
   Full-surface takeover stage. Own input model: a dark grove
   hides the answer options; your LANTERN (cursor spotlight,
   radius ~140px) reveals them. Options OUTSIDE the light are
   silhouettes — visually dimmed but ALWAYS clickable (never
   hard-disabled; fairness). A seeded MOTH SWARM is drawn to
   brightness: hovering in one spot (>=2.2s cumulative within a
   90px anchor) telegraphs for 0.7s then dims your lantern 25%
   (radius 140 -> 105) for 3s. Purely cosmetic: hit-testing and
   option geometry never change.
   BONUS: answer correctly while at FULL brightness (not dimmed):
   +20 'CLEAR-EYED'. Touch fallback (documented on the goal card):
   touch users get a fixed lantern at board centre, the moth
   mechanic is disabled and CLEAR-EYED is unavailable (a pinned
   light can never be punished).
   Seed-deterministic (net:'seed'): option positions, question,
   option order and moth-swarm look all derive from ctx.rng at
   mount in FIXED DRAW ORDER (see drawSchedule); MP tabs see the
   identical grove. Moth punishment is player-behaviour driven
   (like RED LIGHT's move-detector), not seeded state.
   POINTS CURVE vs puzzle par (100*diff+40): LG_PAY pays
   150/225/310/400/490 at diff 1..5 = [107%,94%,91%,91%,91%] of
   par, inside the sibling takeover band [60%,135%]; +20 bonus
   tops out at 510 < 135% of diff-5 par (729). Wrong pick -40/-12;
   timeout self-limits to timerLen. Silhouettes keep guessing
   possible even with a dead monitor, so the round always resolves.
   Fairness rails: flashes <=140 ms via ctx.fx (engine-gated);
   pause overlay pointer-events:none + escapable (Esc/P); text
   >=11px; IQB_MOTION off => no flicker/shimmer animation.
   Touch parity: tap == click; keyboard 1-6 mirrors taps.
   ============================================================ */
(function(){
var root=window.IQ=window.IQ||{};
function register(def){
  if(root.Stage&&typeof root.Stage.register==='function')root.Stage.register(def);
  else(window.__stagePending=window.__stagePending||[]).push(def); /* StageCore drains */
}

var GLYPHS=['plus','cross','ring','square','diamond','triangle'];
var COLORS=[0,2,3,5];
var N=6;                          /* options hidden in the grove */
var R_LIT=140,R_DIM=105;          /* lantern radius px, full vs dimmed */
var DWELL_MS=2200,TELE_MS=700,DIM_MS=3000,ANCHOR_R=90;
var BONUS_EYE=20;                 /* 'CLEAR-EYED' */
var LG_PAY=[150,225,310,400,490]; /* win points by ctx.diff (see header) */
var T={};
var CTX=null;

/* ---------- seeded schedule: FIXED DRAW ORDER ---------- */
/*
   1 positions       N*2 rng()      x,y percent, rejection-spaced >=16%
   2 sequence        K*2 rng()      glyph+color per step (K=3, +1 tier>=2)
   3 distractors     variable rng() until N unique options
   4 shuffle         N-1 rng()      Fisher-Yates from last
   5 moth swarm      2 rng()        count (5..8), flutter phase
*/
function drawSchedule(rng,diff,tier){
  var pts=[],i;
  while(pts.length<N){
    var p={x:8+rng()*84,y:10+rng()*78};
    if(pts.every(function(q){return Math.hypot(q.x-p.x,q.y-p.y)>=16}))pts.push(p);
  }
  var K=3+(tier>=2?1:0),seq=[];
  for(i=0;i<K;i++)seq.push({g:GLYPHS[Math.floor(rng()*GLYPHS.length)],c:COLORS[Math.floor(rng()*COLORS.length)]});
  var step=seq[K-2],nxt=seq[K-1];
  var ans={g:nxt.g===step.g?GLYPHS[(GLYPHS.indexOf(nxt.g)+1)%GLYPHS.length]:nxt.g,c:nxt.c};
  var opts=[{g:ans.g,c:ans.c}];
  while(opts.length<N){
    var m={g:GLYPHS[Math.floor(rng()*GLYPHS.length)],c:COLORS[Math.floor(rng()*COLORS.length)]};
    if(!opts.some(function(o){return o.g===m.g&&o.c===m.c}))opts.push(m);
  }
  for(i=opts.length-1;i>0;i--){var j=Math.floor(rng()*(i+1));var tmo=opts[i];opts[i]=opts[j];opts[j]=tmo;}
  return {pts:pts,seq:seq,opts:opts,answerIdx:0,moths:5+Math.floor(rng()*4),flutter:rng()};
}

/* ---------- shared round clock (pausable, smoke-injectable) ---------- */
function rawNow(){return typeof window.__LANTERN_CLOCK__==='function'?window.__LANTERN_CLOCK__():Date.now();}
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
  removeEventListener('pointermove',onMove,true);
  if(T.root&&T.root.removeEventListener)T.root.removeEventListener('pointermove',onMove);
  T={};
}
function settle(res){
  if(T.done)return;T.done=true;
  const r=T.resolve;cleanup();
  setTimeout(()=>r&&r(res),420); /* let the reveal land */
}
function dimActive(){return T.phase==='dim'&&now()<T.dimUntil;}
function radius(){return dimActive()?R_DIM:R_LIT;}
function win(){
  var clear=T.touchMode?false:!dimActive();
  var pts=T.pay+(clear?BONUS_EYE:0);
  try{CTX.audio.p('levelup');CTX.fx.flash('rgba(255,176,30,.15)',130)}catch(e){}
  settle({kind:'score',correct:true,points:pts,hpDelta:0,
    summary:clear?'THE WARD HOLDS \u00B7 CLEAR-EYED +'+BONUS_EYE:
      (T.touchMode?'THE WARD HOLDS':'THE WARD HOLDS \u00B7 MOTH-BLURRED, NO BONUS')});
}
function wrongPick(i){
  try{CTX.audio.p('buzz');CTX.fx.shake(10,260)}catch(e){}
  settle({kind:'score',correct:false,points:-40,hpDelta:-12,
    summary:'WRONG SIGIL \u2014 THE GROVE CLOSES IN'});
}

/* ---------- moth dwell state machine ---------- */
/* idle -> (dwell>=DWELL_MS) telegraph(TELE_MS) -> dim(DIM_MS) -> idle */
function resetDwell(x,y,t){T.ax=x;T.ay=y;T.dwell=0;T.lastT=t;}
function feed(x,y,type){ /* pointer position in container %, pointerType string */
  if(T.done)return;
  if(type==='touch'&&!T.touchMode){ /* touch parity fallback: fixed centre lantern */
    T.touchMode=true;
    T.lamp.style.left='50%';T.lamp.style.top='50%';
    T.status.textContent='TOUCH MODE \u2014 LANTERN PINNED CENTRE \u00B7 MOTH MECHANIC OFF';
  }
  if(T.paused)return;
  var t=now();
  if(T.touchMode)return;
  if(Math.hypot(x-T.ax,y-T.ay)>ANCHOR_R)resetDwell(x,y,t);
  else{
    var dt=Math.min(200,Math.max(0,t-T.lastT));
    T.dwell+=dt;T.lastT=t;
  }
  stepMachines(t); /* react to fresh dwell in the same event */
  T.px=x;T.py=y;placeLamp(x,y);
}
function stepMachines(t){
  if(T.touchMode)return;
  if(T.phase==='tele'){
    if(t>=T.teleUntil){
      T.phase='dim';T.dimUntil=t+DIM_MS;
      T.status.textContent='MOTHS ON THE GLASS \u2014 LANTERN DIMMED';
      try{CTX.audio.p('heart',{vol:.35})}catch(e){}
    }
    return;
  }
  if(T.phase==='dim'){
    if(t>=T.dimUntil){T.phase='idle';resetDwell(T.px,T.py,t);T.status.textContent='THE FLAME RECOVERS';}
    return;
  }
  if(T.dwell>=DWELL_MS){ /* cumulative hover in one spot: moths incoming */
    T.phase='tele';T.teleUntil=t+TELE_MS;
    T.status.textContent='MOTHS GATHERING \u2014 MOVE!';
    try{CTX.audio.p('click',{vol:.3})}catch(e){}
  }
}

/* ---------- input ---------- */
function placeLamp(xPct,yPct){
  T.lamp.style.left=xPct+'%';T.lamp.style.top=yPct+'%';
  relight();
}
function relight(){
  var R=radius(),i;
  for(i=0;i<N;i++){
    var d=Math.hypot(T.sch.pts[i].x-T.px,T.sch.pts[i].y-T.py)*(T.boardW/100);
    var lit=d<=R;
    T.btns[i].classList.toggle('lg-sil',!lit);
  }
  T.lamp.classList.toggle('lg-dimlamp',dimActive());
}
function onMove(e){
  if(T.done)return;
  var rc=T.root.getBoundingClientRect();
  if(e.clientX<rc.left-40||e.clientX>rc.right+40||e.clientY<rc.top-40||e.clientY>rc.bottom+40)return;
  feed((e.clientX-rc.left)/rc.width*100,(e.clientY-rc.top)/rc.height*100,e.pointerType||'mouse');
}
function onKey(e){
  if(T.done)return;
  var k=e.key;
  if(k==='Escape'||k==='p'||k==='P'){T.paused?doResume():doPause();return}
  if(T.paused)return;
  var n=parseInt(k,10);
  if(n>=1&&n<=N)press(n-1);
}
function press(i){
  if(T.done||T.paused||i<0||i>=N)return;
  /* silhouettes stay clickable: hit-testing never gated by light or dim */
  if(i===T.sch.answerIdx){T.btns[i].classList.add('lg-right');win()}
  else{T.btns[i].classList.add('lg-wrong');wrongPick(i)}
}

/* ---------- markup helpers ---------- */
function symChip(g,c,size){
  var col=(window.IQ&&IQ.Board)?IQ.Board.palRow()[c%8]:'#ffd88a';
  var cx=size/2,cy=size/2,u=size*.72,r=u*.36,inner='';
  switch(g){
    case 'ring':inner='<circle cx="'+cx+'" cy="'+cy+'" r="'+(r*.8)+'" fill="none" stroke="'+col+'" stroke-width="'+(u*.14)+'"/>';break;
    case 'square':inner='<rect x="'+(cx-r*.8)+'" y="'+(cy-r*.8)+'" width="'+(r*1.6)+'" height="'+(r*1.6)+'" rx="2" fill="'+col+'"/>';break;
    case 'diamond':inner='<polygon points="'+cx+','+(cy-r)+' '+(cx+r)+','+cy+' '+cx+','+(cy+r)+' '+(cx-r)+','+cy+'" fill="'+col+'"/>';break;
    case 'triangle':inner='<polygon points="'+cx+','+(cy-r)+' '+(cx+r*.87)+','+(cy+r*.5)+' '+(cx-r*.87)+','+(cy+r*.5)+'" fill="'+col+'"/>';break;
    case 'cross':inner='<rect x="'+(cx-u*.11)+'" y="'+(cy-r)+'" width="'+(u*.22)+'" height="'+(r*2)+'" fill="'+col+'"/><rect x="'+(cx-r)+'" y="'+(cy-u*.11)+'" width="'+(r*2)+'" height="'+(u*.22)+'" fill="'+col+'"/>';break;
    default:inner='<rect x="'+(cx-u*.13)+'" y="'+(cy-r*.92)+'" width="'+(u*.26)+'" height="'+(r*1.84)+'" rx="2" fill="'+col+'"/><rect x="'+(cx-r*.92)+'" y="'+(cy-u*.13)+'" width="'+(r*1.84)+'" height="'+(u*.26)+'" rx="2" fill="'+col+'"/>';
  }
  return '<span class="lg-sym"><svg viewBox="0 0 '+size+' '+size+'" width="'+size+'" height="'+size+'">'+inner+'</svg></span>';
}
var CSS=
 '@media (prefers-reduced-motion:reduce){.stage-view[data-stage="lanternguard"] *{animation:none!important;transition:none!important}}'+
 '.lg-grove{position:relative;height:min(52vh,380px);max-width:760px;margin:10px auto;border-radius:12px;overflow:hidden;'+
 'background:radial-gradient(120% 90% at 50% 110%,#10160f 55%,#05070a);border:1px solid rgba(255,176,30,.22);cursor:crosshair}'+
 '.lg-lamp{position:absolute;width:'+R_LIT*2+'px;height:'+R_LIT*2+'px;transform:translate(-50%,-50%);pointer-events:none;'+
 'border-radius:50%;transition:opacity .25s;'+
 'background:radial-gradient(circle,rgba(255,214,140,.32) 0%,rgba(255,190,90,.14) 42%,rgba(255,176,30,0) 70%)}'+
 '.lg-lamp::after{content:"";position:absolute;left:50%;top:50%;width:10px;height:10px;transform:translate(-50%,-50%);'+
 'border-radius:50%;background:#ffdf9e;box-shadow:0 0 18px 8px rgba(255,200,110,.55)}'+
 '.lg-lamp.lg-dimlamp{filter:brightness(.55) saturate(.7)}'+
 '@media (prefers-reduced-motion:no-preference){.lg-lamp{animation:lgFlicker 2.6s ease-in-out infinite alternate}'+
 '@keyframes lgFlicker{from{opacity:.92}to{opacity:1}}}'+
 '.lg-opt{position:absolute;transform:translate(-50%,-50%);cursor:pointer;padding:8px 10px;border-radius:9px;'+
 'font-size:11px;letter-spacing:.08em;color:#ffe9c4;background:rgba(38,30,16,.85);border:1px solid rgba(255,176,30,.45);'+
 'display:flex;flex-direction:column;align-items:center;gap:2px;user-select:none;transition:filter .18s,opacity .18s}'+
 '.lg-sil{filter:grayscale(1) brightness(.32);opacity:.55}'+ /* silhouette: dimmed, STILL CLICKABLE */
 '.lg-key{font-size:11px;color:#c9a86a}'+
 '.lg-right{outline:2px solid #00e68a}.lg-wrong{outline:2px solid #ff2038}'+
 '.lg-q{font-size:13px;letter-spacing:.18em;color:#ffd88a;margin-top:8px}'+
 '.lg-seq{display:flex;gap:8px;align-items:center;justify-content:center;font-size:15px;color:#efe3c8}'+
 '.lg-status{min-height:20px;font-size:12px;letter-spacing:.16em;color:#ffcf8a;text-transform:uppercase}'+
 '.lg-foot{font-size:11px;color:#9b8b66;letter-spacing:.12em;text-align:center;max-width:720px}';

/* ---------- registration ---------- */
register({
 id:'lanternguard',
 name:'LANTERN WATCH',
 goalText:'KEEP MOVING, KEEP IT LIT \u2014 ANSWER BY LANTERN LIGHT.',
 controls:'MOVE TO SHINE \u00B7 CLICK / TAP A SIGIL OR PRESS 1\u20136',
 weight:3,           /* mid-low frequency: punishes static play, so it shares the wheel evenly */
 minDepth:4,
 net:'seed',
 mount(container,ctx){
  CTX=ctx;cleanup();
  T.pay=LG_PAY[Math.max(0,Math.min(4,(ctx.diff|0)-1))]||LG_PAY[0];
  T.sch=drawSchedule(ctx.rng,ctx.diff,ctx.tier);
  T.base=rawNow();T.frozen=0;T.paused=false;T.pauseAt=0;T.done=false;
  T.phase='idle';T.dimUntil=0;T.teleUntil=0;T.dwell=0;T.ax=-999;T.ay=-999;T.lastT=0;
  T.px=50;T.py=50;T.touchMode=false;

  var el=document.createElement('div');
  el.className='stage-view';el.setAttribute('data-stage','lanternguard');
  el.style.cssText='position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10px;'+
   "font-family:'Oxanium',sans-serif";
  var styleEl=document.createElement('style');styleEl.textContent=CSS;el.appendChild(styleEl);

  var q=document.createElement('div');q.className='lg-q';
  q.textContent='WHICH SIGIL COMPLETES THE WARD? \u2014 SHINE YOUR LANTERN TO SEE';
  var seq=document.createElement('div');seq.className='lg-seq';
  seq.innerHTML=T.sch.seq.map(function(s){return symChip(s.g,s.c,38)}).join('<span>\u2192</span>')+'<span>?</span>';
  var grove=document.createElement('div');grove.className='lg-grove';
  var lamp=document.createElement('div');lamp.className='lg-lamp';lamp.style.left='50%';lamp.style.top='50%';
  grove.appendChild(lamp);
  T.btns=[];
  for(var i=0;i<N;i++){
    var b=document.createElement('div');
    b.className='lg-opt';b.setAttribute('data-i',String(i));
    b.style.left=T.sch.pts[i].x+'%';b.style.top=T.sch.pts[i].y+'%';
    b.innerHTML=symChip(T.sch.opts[i].g,T.sch.opts[i].c,34)+'<span class="lg-key">'+(i+1)+'</span>';
    b.onclick=(function(idx){return function(){press(idx)}})(i);
    grove.appendChild(b);T.btns.push(b);
  }
  var status=document.createElement('div');status.className='lg-status';status.setAttribute('role','status');
  status.textContent='MOTHS LOVE A STILL FLAME \u2014 KEEP MOVING';
  var foot=document.createElement('div');foot.className='lg-foot';
  foot.textContent='dim silhouettes can still be tapped \u00B7 hover one spot '+Math.round(DWELL_MS/100)/10+
   's and the moths dim you ('+Math.round(DIM_MS/100)/10+'s) \u00B7 answer at full flame: CLEAR-EYED +'+BONUS_EYE+
   ' \u00B7 touch: lantern pinned centre, moths off, no bonus \u00B7 ESC/P pause';
  /* READY legend (pointer-events none, auto-fades) */
  var ready=document.createElement('div');
  ready.style.cssText='position:absolute;left:50%;top:14%;transform:translate(-50%,-50%);background:rgba(8,6,2,.88);'+
   'border:1px solid rgba(255,176,30,.35);color:#ffe9c4;font-size:12px;letter-spacing:.12em;padding:10px 16px;'+
   'border-radius:8px;pointer-events:none;text-transform:uppercase;transition:opacity .5s;z-index:9;text-align:center';
  ready.textContent='LANTERN WATCH \u2014 MOVE TO SHINE, TAP A SIGIL OR PRESS 1\u20136 \u00B7 ESC/P PAUSE';
  /* pause overlay: pointer-events none (escapable, never blocks), Esc/P toggles */
  var overlay=document.createElement('div');
  overlay.style.cssText='position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(2,3,6,.74);'+
   'color:#ffe9c4;font-size:15px;letter-spacing:.3em;pointer-events:none;z-index:20;text-transform:uppercase';
  overlay.textContent='PAUSED \u2014 PRESS ESC OR P TO RESUME';
  el.appendChild(q);el.appendChild(seq);el.appendChild(grove);el.appendChild(status);el.appendChild(foot);
  el.appendChild(ready);el.appendChild(overlay);
  container.appendChild(el);
  T.root=el;T.grove=grove;T.lamp=lamp;T.status=status;T.overlay=overlay;
  T.boardW=Math.max(320,Math.min(760,(container.clientWidth||640)));
  T.boardH=Math.min(380,Math.round((typeof window.innerHeight==='number'?window.innerHeight:800)*.52)||320);

  /* tick: moth state machine + silhouette relight (cosmetic only) */
  T.tickI=setInterval(function(){
    if(T.done)return;
    stepMachines(now());
    relight();
  },160);

  addEventListener('keydown',onKey,true);
  addEventListener('pointermove',onMove,true);
  /* fairness rail: self-limit inside timerLen so the engine never injects blind */
  T.safetyT=setTimeout(function(){if(!T.done)settle({kind:'score',correct:false,points:-40,hpDelta:-12,
    summary:'THE DARK TOOK YOU'})},Math.max(1500,ctx.timerLen*1000-450));

  window.__LANTERNGUARD__={ /* dev/soak peeks */
    sch:T.sch,press:press,feed:feed,paused:function(){return T.paused},
    now:now,dimActive:dimActive,radius:radius,touch:function(){return T.touchMode},
    dwell:function(){return T.dwell},phase:function(){return T.phase}};
  setTimeout(function(){ready.style.opacity='0'},3000);
  try{CTX.audio.p('sacrifice',{vol:.22})}catch(e){}
  return new Promise(function(resolve){T.resolve=resolve});
 },
 describe(){return {kind:'lanternguard'}},
 cleanup(){cleanup()}
});
})();
