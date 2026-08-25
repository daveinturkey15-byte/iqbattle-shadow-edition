/* ============================================================
   modes/mode-redlight.js — STAGE EXEMPLAR "RED LIGHT" (W2)
   Full-surface squid-parody timing game. Proves a stage can own
   an entirely different play surface + input model:
     GREEN LIGHT -> a mini symbol-pattern question (answer it!)
     RED LIGHT   -> total freeze; move/click/type and you bleed.
   Seed-deterministic (net:'seed'): every phase derives from
   ctx.rng so MP tabs see the identical run of lights.
   Never touches window.G — resolves one StageResult.
   ============================================================ */
(function(){
'use strict';
var root=window.IQ=window.IQ||{};
if(!root.Stage||typeof root.Stage.register!=='function')return;

var GLYPHS=['plus','cross','ring','square','diamond','triangle'];
var COLORS=[0,2,3,5]; /* stable palette slots: cyan, gold, green, rose */

var T={}; /* live handles */

function cleanup(){
 clearTimeout(T.phaseT);clearTimeout(T.lightT);clearTimeout(T.readyT);
 if(T.readyEl)T.readyEl.style.opacity='0'; /* round over — drop the onboarding legend */
 removeEventListener('pointermove',onMove,true);
 removeEventListener('pointerdown',onDown,true);
 removeEventListener('keydown',onKey,true);
 T={};
}
function fail(why){
 if(T.done)return;T.done=true;
 const res={kind:'score',correct:false,points:-40,hpDelta:T.hurt!=null?T.hurt:-12,summary:why};
 try{CTX.audio.p('buzz');CTX.fx.shake(14,300);CTX.fx.flash('rgba(255,32,56,.22)',140)}catch(e){}
 const settle=T.resolve;cleanup();
 setTimeout(()=>settle&&settle(res),650); /* let the red hit land */
}
function win(){
 if(T.done)return;T.done=true;
 const res={kind:'score',correct:true,points:120+T.tier*40,hpDelta:0,summary:'CROSSED THE FIELD'};
 try{CTX.audio.p('levelup');CTX.fx.flash('rgba(0,230,138,.16)',130)}catch(e){}
 const settle=T.resolve;cleanup();
 setTimeout(()=>settle&&settle(res),500);
}

/* ---- freeze detectors (RED LIGHT) ---- */
let lastXY=null;
function onMove(e){
 if(T.done)return;
 const p=T.root.getBoundingClientRect();
 if(e.clientX<p.left-80||e.clientX>p.right+80||e.clientY<p.top-80||e.clientY>p.bottom+80)return;
 if(!lastXY)lastXY=[e.clientX,e.clientY];
 else if(Math.hypot(e.clientX-lastXY[0],e.clientY-lastXY[1])>26){lastXY=null;fail('THE DOLL SAW YOU MOVE')}
}
function onDown(){if(!T.done&&T.red)fail('MOVED ON RED — ELIMINATED')}
function onKey(e){if(!T.done&&T.red&&e.key!=='Shift')fail('TWITCHED ON RED — ELIMINATED')}

/* ---- doll markup (pure CSS/SVG, no assets) ---- */
function dollSVG(){
 return '<svg viewBox="0 0 120 150" width="120" height="150" aria-hidden="true">'+
  '<g class="rl-doll">'+
  '<ellipse cx="60" cy="132" rx="34" ry="12" fill="rgba(255,160,190,.15)"/>'+
  '<path d="M38 128 q22 -10 44 0 l-6 -44 q-16 -8 -32 0 z" fill="#f4a7c3"/>'+
  '<rect x="46" y="118" width="28" height="10" rx="4" fill="#e2894f"/>'+
  '<circle cx="60" cy="52" r="26" fill="#f4cdbb"/>'+
  '<path d="M34 52 a26 26 0 0 1 52 0 z" fill="#3a2a2e"/>'+
  '<g class="rl-face"><circle cx="50" cy="54" r="3.4" fill="#1d1416"/><circle cx="70" cy="54" r="3.4" fill="#1d1416"/>'+
  '<path d="M52 66 q8 6 16 0" stroke="#1d1416" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>'+
  '<circle cx="45" cy="62" r="5" fill="#f4a7c3" opacity=".8"/><circle cx="75" cy="62" r="5" fill="#f4a7c3" opacity=".8"/>'+
  '</g></svg>';
}
function symChip(g,c,size){
 const col=(window.IQ&&IQ.Board)?IQ.Board.palRow()[c%8]:'#7dd3fc';
 const cx=size/2,cy=size/2,u=size*.72,r=u*.36;
 let inner='';
 switch(g){
  case 'ring':inner=`<circle cx="${cx}" cy="${cy}" r="${r*.8}" fill="none" stroke="${col}" stroke-width="${u*.14}"/>`;break;
  case 'square':inner=`<rect x="${cx-r*.8}" y="${cy-r*.8}" width="${r*1.6}" height="${r*1.6}" rx="2" fill="${col}"/>`;break;
  case 'diamond':inner=`<polygon points="${cx},${cy-r} ${cx+r},${cy} ${cx},${cy+r} ${cx-r},${cy}" fill="${col}"/>`;break;
  case 'triangle':inner=`<polygon points="${cx},${cy-r} ${cx+r*.87},${cy+r*.5} ${cx-r*.87},${cy+r*.5}" fill="${col}"/>`;break;
  case 'cross':inner=`<rect x="${cx-u*.11}" y="${cy-r}" width="${u*.22}" height="${r*2}" fill="${col}"/><rect x="${cx-r}" y="${cy-u*.11}" width="${r*2}" height="${u*.22}" fill="${col}"/>`;break;
  default:inner=`<rect x="${cx-u*.13}" y="${cy-r*.92}" width="${u*.26}" height="${r*1.84}" rx="2" fill="${col}"/><rect x="${cx-r*.92}" y="${cy-u*.13}" width="${r*1.84}" height="${u*.26}" rx="2" fill="${col}"/>`;
 }
 return `<span class="rl-sym"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${inner}</svg></span>`;
}

/* ---- phase machine ---- */
function light(green,ms){
 T.red=!green;
 T.root.classList.toggle('rl-green',green);
 T.root.classList.toggle('rl-red',!green);
 T.doll.classList.toggle('rl-facing',!green);
 T.state.textContent=green?'GREEN LIGHT — SOLVE':'RED LIGHT — FREEZE';
 try{CTX.audio.p(green?'click':'heart',{vol:.35})}catch(e){}
 if(!green){try{CTX.fx.flash('rgba(255,32,56,.18)',140)}catch(e){}
  addEventListener('pointermove',onMove,true);addEventListener('pointerdown',onDown,true);addEventListener('keydown',onKey,true);}
 else{removeEventListener('pointermove',onMove,true);removeEventListener('pointerdown',onDown,true);removeEventListener('keydown',onKey,true);lastXY=null;}
 clearTimeout(T.lightT);
 T.lightT=setTimeout(()=>{if(T.done)return;
  if(green)fail('TOO SLOW — THE LIGHT CHANGED');
  else{T.phase++;if(T.phase>=T.phases.length)return win();runPhase()}
 },ms);
}
function askPattern(){
 /* seed-deterministic mini puzzle: continue the symbol sequence */
 const K=3+(T.tier>=2?1:0);
 const seq=Array.from({length:K},()=>({g:GLYPHS[Math.floor(T.rng()*GLYPHS.length)],c:COLORS[Math.floor(T.rng()*COLORS.length)]}));
 const step=seq[K-2],nxt=seq[K-1];
 const answer={g:nxt.g===step.g?GLYPHS[(GLYPHS.indexOf(nxt.g)+1)%GLYPHS.length]:nxt.g,
               c:nxt.c};
 const opts=[answer];
 while(opts.length<4){
  const m={g:GLYPHS[Math.floor(T.rng()*GLYPHS.length)],c:COLORS[Math.floor(T.rng()*COLORS.length)]};
  if(!opts.some(o=>o.g===m.g&&o.c===m.c))opts.push(m);
 }
 /* deterministic shuffle */
 for(let i=opts.length-1;i>0;i--){const j=Math.floor(T.rng()*(i+1));[opts[i],opts[j]]=[opts[j],opts[i]]}
 T.qA=opts.indexOf(answer);T.answered=false;
 T.prompt.innerHTML='<div class="rl-q">CONTINUE THE PATTERN</div><div class="rl-seq">'+
  seq.map(s=>symChip(s.g,s.c,44)).join('<span class="rl-arrow">→</span>')+
  '<span class="rl-arrow">?</span></div>';
 T.opts.innerHTML='';
 opts.forEach((o,i)=>{
  const b=document.createElement('div');b.className='opt-btn rl-opt';b.dataset.i=i;
  b.innerHTML=symChip(o.g,o.c,52)+`<span class="opt-key">${i+1}</span>`;
  b.onclick=()=>{
   if(T.done||T.answered)return;T.answered=true;
   if(i!==T.qA){T.opts.querySelectorAll('.opt-btn').forEach((x,xi)=>xi===T.qA&&x.classList.add('correct'));fail('PATTERN BROKE — OUT OF SYNC');return}
   b.classList.add('correct');
   try{CTX.audio.p('sting')}catch(e){}
   goRed();
  };
  T.opts.appendChild(b);
 });
}
function goRed(){ /* survive the freeze, then the next light */
 const ph=T.phases[T.phase];
 T.count.style.width='100%';
 requestAnimationFrame(()=>{T.count.style.transition=`width ${ph.redMs}ms linear`;T.count.style.width='0%'});
 light(false,ph.redMs);
}
function runPhase(){
 const ph=T.phases[T.phase];
 T.count.style.width='100%';
 requestAnimationFrame(()=>{T.count.style.transition=`width ${ph.greenMs}ms linear`;T.count.style.width='0%'});
 light(true,ph.greenMs);
 askPattern();
}

/* ---------- registration ---------- */
var CTX=null;
root.Stage.register({
 id:'redlight',
 name:'RED LIGHT',
 goalText:'SOLVE ON GREEN. FREEZE ON RED.',
 controls:'CLICK / TAP OR PRESS 1\u20134',
 weight:6,
 minDepth:3,
 net:'seed',
 mount(container,ctx){
  CTX=ctx;cleanup();
  T.tier=ctx.tier;T.rng=ctx.rng;T.hurt=-12;
  const N=3+(ctx.tier>=2?1:0);
  const greenBase=Math.max(3200,(ctx.timerLen*1000)*.22);
  T.phases=Array.from({length:N},(_,i)=>({
   greenMs:Math.max(2600,greenBase-T.tier*350-i*250),
   redMs:1600+Math.floor(ctx.rng()*1100)
  }));
  T.phase=0;
  const el=document.createElement('div');
  el.className='stage-view';el.setAttribute('data-stage','redlight');
  el.innerHTML=
   '<div class="rl-field"></div>'+
   '<div class="rl-dollwrap">'+dollSVG()+'</div>'+
   '<div class="rl-state" role="status">GREEN LIGHT</div>'+
   '<div class="rl-prompt"></div>'+
   '<div class="rl-opts"></div>'+
   '<div class="rl-progress"><i class="rl-count"></i></div>'+
   '<div class="rl-foot">survive '+N+' lights · move on red and it sees you</div>';
  container.appendChild(el);
  T.root=el;
  T.doll=el.querySelector('.rl-dollwrap');
  T.state=el.querySelector('.rl-state');
  T.prompt=el.querySelector('.rl-prompt');
 /* 3s READY legend: name + goal + controls (non-blocking; pointer-events none) */
 const ready=document.createElement('div');
 ready.className='rl-ready';
 ready.style.cssText='position:absolute;left:50%;top:24%;transform:translate(-50%,-50%);'+
  'background:rgba(4,4,10,.88);border:1px solid rgba(255,255,255,.22);color:#f4e9ec;'+
  'font-size:13px;letter-spacing:.14em;padding:10px 16px;border-radius:8px;'+
  'pointer-events:none;text-transform:uppercase;transition:opacity .5s;z-index:9';
 ready.textContent='RED LIGHT \u2014 SOLVE ON GREEN. FREEZE ON RED. \u00B7 CLICK / TAP OR PRESS 1\u20134';
 el.appendChild(ready);
 T.readyEl=ready;T.readyT=setTimeout(()=>{ready.style.opacity='0'},3000);
  T.opts=el.querySelector('.rl-opts');
  T.count=el.querySelector('.rl-count');
  /* self-play / soak hook: which lane is the correct pattern continuation */
  window.__REDLIGHT__={correctOpt:()=>T.qA,phase:()=>T.phase};
  try{CTX.audio.p('sacrifice',{vol:.25})}catch(e){}
  setTimeout(runPhase,700);
  return new Promise(resolve=>{T.resolve=resolve});
 },
 describe(){return {kind:'redlight'}},
 cleanup(){cleanup()}
});
})();
