/* ============================================================
   modes/mode-puzzle.js — STAGE #1 "SIGIL TRIAL" (W2 polymorphic)
   The classic IQ Versus round, ported onto the Stage contract.
   Owns: gen_* families + rotation tables, forged puzzles, the
   round-1 power cut, option grid, MP pick relay (legacy pattern).
   Never touches window.G — resolves a StageResult; the engine
   layers streak/emerald/curse/hook modifiers.
   ============================================================ */
(function(){
'use strict';
var root=window.IQ=window.IQ||{};
if(!root.Stage||typeof root.Stage.register!=='function')return;

/* ---------- per-round module state (reset by every mount) ---------- */
var S={};

function reset(){
 clearTimeout(S.zapT);clearTimeout(S.revT);
 S={pz:null,ord:null,done:false,depth:0,tier:0,tl:null,boardSVG:'',zapT:null,revT:null};
}

function shuffledOrder(n,rng){
 var o=Array.from({length:n},(_,i)=>i);
 for(let i=o.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[o[i],o[j]]=[o[j],o[i]]}
 return o;
}
/* ---------- generator families + rotation tables (ported verbatim,
   Math.random -> seeded rng for MP determinism) ---------- */
function fallbackPuzzle(){
 const cells=[];for(let i=0;i<9;i++)cells.push(i===4?null:{shape:'plus',color:(i%2===0?i:i+2)%8,rot:i%4});
 const correct={shape:'plus',color:2,rot:0};
 return{id:'fb'+Date.now(),kind:'matrix',difficulty:1,rule:'colors advance along rows',
  board:{cols:3,rows:3,cells,holeIndex:4},
  options:Array.from({length:8},(_,i)=>({cols:1,rows:1,cells:[i?{...correct,color:(correct.color+i)%8}:correct]})),answer:0};
}
function makePuzzle(ctx){
 const G_=root.Gens||{};const table=
  ctx.tier<=0?['iqvs','iqvs','latin','cycle']:
  ctx.tier===1?['iqvs','iqvs','iqvs','latin','cycle','count','logicA','missingSec']:
  ctx.tier===2?['iqvs','iqvs','latin','cycle','count','dual','dual','logicA','logicB','seqPack','missingSec']:
  ['wild','wild','dual','iqvs','iqvs','latin','logicA','logicB','seqPack','missingSec'];
 let gname=table[Math.floor(ctx.rng()*table.length)];
 if(ctx.tier>=2&&(G_.retroA||G_.retroB)&&ctx.rng()<.12)gname=(G_.retroA&&(!G_.retroB||ctx.rng()<.5))?'retroA':'retroB';
 const gen=G_[gname];
 const kinds=ctx.tier>=2?['matrix','sequence','oddone']:['matrix','matrix','sequence'];
 if(gen&&gen.generate){try{
  const p=gen.generate({difficulty:ctx.diff,kinds});
  const okShape=p&&p.options&&p.options.length===8&&Number.isFinite(p.difficulty)&&(p.board||p.seq||p.oddBoard||(p.kind==='retro'&&p.retro));
  if(okShape&&(!gen.validate||gen.validate(p).ok!==false))return p;
 }catch(e){}}
 try{return root.Puzzles.generate({difficulty:ctx.diff})}catch(e){return fallbackPuzzle()}
}
function corrupt(pz,ctx){
 const tl=S.tl;
 if(pz.board&&tl.corruptChance&&ctx.rng()<tl.corruptChance){
  const idx=pz.board.cells.findIndex((c,i)=>i!==pz.board.holeIndex&&c);
  if(idx>=0)pz.board.cells[idx]={...pz.board.cells[idx],color:(pz.board.cells[idx].color+Math.floor(ctx.rng()*7)+1)%8};
  pz.corrupted=true;}
 if(pz.options&&tl.impossibleChance&&ctx.rng()<tl.impossibleChance){
  const a=pz.answer;pz.options[a]=JSON.parse(JSON.stringify(pz.options[(a+3)%8]));pz.impossible=true;}
 return pz;
}

/* ---------- rendering ---------- */
function tile(t,size,showQ){return ctx_board().tileSVG(t,size,S.tier,showQ)}
function ctx_board(){return (window.IQ&&window.IQ.Board)||{tileSVG:(t,s)=>''}}

function renderInto(container){
 const pz=S.pz;if(!pz)return;
 let html='';const SZ=Math.max(180,Math.min(330,innerWidth-110,innerHeight-300));
 if(pz.kind==='matrix')html=tile(pz.board,SZ,true);
 else if(pz.kind==='sequence'){const cs=SZ/(pz.seq.length+1);
  html=`<div style="display:flex;gap:10px;align-items:center">${pz.seq.map(c=>tile({cols:1,rows:1,cells:[c]},cs*.8,false)).join('')}${tile({cols:1,rows:1,cells:[null]},cs*.8,true)}</div>`;}
 else html=tile(pz.oddBoard,SZ,false)+'<div style="text-align:center;margin-top:8px;font-size:11px;letter-spacing:.2em;opacity:.6">ONE FRAGMENT IS AN IMPOSTOR</div>';
 const bf=document.createElement('div');bf.className='stage-board';container.appendChild(bf);bf.innerHTML=html;
 S.boardSVG=html;
 drawOptions(bf);
}
function drawOptions(boardEl){
 const pz=S.pz;if(!pz||!pz.options)return;
 let order=S.ord;
 if(!order||order.length!==pz.options.length)order=pz.options.map((_,i)=>i); // client: ord arrives in frame
 const og=document.createElement('div');og.className='stage-opts';og.id='stage-optgrid';boardEl.appendChild(og);
 order.forEach((oi,pos)=>{
  const b=document.createElement('div');b.className='opt-btn';b.dataset.i=oi;
  b.innerHTML=ctx_board().tileSVG((window.IQ.Board?window.IQ.Board.optTile:p=>p)(pz.options[oi]),104,S.tier,false)+`<span class="opt-key">${pos+1}</span>`;
  b.onclick=()=>pick(pos);
  og.appendChild(b);});
 S.optOrder=order;
}

/* ---------- resolution ---------- */
function finish(res){
 if(S.done)return;S.done=true;
 clearTimeout(S.zapT);clearTimeout(S.revT);
 S.resolve&&S.resolve(res);
}
function pick(pos){
 if(S.done||!S.pz||S.pickedOnce)return;
 const pz=S.pz,client=CTX.mp.client;
 if(client){ /* legacy input-relay: host scores the pick authoritatively */
  S.pickedOnce=true;
  try{CTX.net.send({t:'pick',n:CTX.depth,pos,name:CTX.name,uid:CTX.net.uid()})}catch(e){}
  const btns=board_btns();
  btns.forEach(b=>b.classList.toggle('picked',S.optOrder[pos]===+b.dataset.i));
  finish({kind:'score',correct:false,points:0,hpDelta:0,summary:'',relay:false}); // host reveal tells the truth
  return;
 }
 const impossible=(pz.answer===-99||pz.impossible);
 const correct=!impossible&&pos>=0&&S.optOrder[pos]===pz.answer;
 S.pickedOnce=true;
 const btns=board_btns();
 btns.forEach(b=>b.classList.toggle('picked',pos>=0&&S.optOrder[pos]===+b.dataset.i));
 if(!correct&&pos>=0)(btns.find(b=>S.optOrder[pos]===+b.dataset.i)||{}).classList?.add('wrongpick');
 if(!impossible)setTimeout(()=>{const cb=btns.find(b=>+b.dataset.i===pz.answer);cb&&cb.classList.add('correct')},250);
 let res;
 if(impossible)res={kind:'score',correct:null,points:0,hpDelta:0,summary:''}; // engine runs the emerald ladder
 else if(correct)res={kind:'score',correct:true,points:Math.round(100*pz.difficulty+CTX.leftFrac()*80),hpDelta:0,summary:pz.rule||''};
 else{var d=Math.max(1,Math.min(5,Math.ceil((CTX.depth||1)/6)));res={kind:'score',correct:false,points:-(10+10*d),hpDelta:-(5+2*d),summary:''};}
 S.revT=setTimeout(()=>finish(res),1250); // hold for the reveal beat
}
function board_btns(){return Array.from(document.querySelectorAll('#stage-optgrid .opt-btn'))}
let CTX=null;

/* ---------- round-1 signature power cut (ported flavor) ---------- */
function maybeZap(){
 const tl=S.tl;
 if(CTX.depth!==1||!tl.zapAtFraction||S.zapFired)return;S.zapFired=true;
 S.zapT=setTimeout(()=>{
  if(S.done)return;
  const z=document.createElement('div');z.style.cssText='position:fixed;inset:0;z-index:120;background:#dff3ff;pointer-events:none';document.body.appendChild(z);
  CTX.audio.p('glitch');CTX.fx.invert(220);CTX.fx.flash('rgba(223,243,255,.85)',140);CTX.fx.shake(18,420);
  CTX.banner('POWER CUT?');
  setTimeout(()=>{z.remove();CTX.quip('zap')},420);
 },CTX.timerLen*tl.zapAtFraction*1000);
}

/* ---------- registration ---------- */
root.Stage.register({
 id:'puzzle',
 name:'SIGIL TRIAL',
 weight:10,
 net:'relay', // legacy pattern: host scores picks via describe()
 mount(container,ctx){
  reset();CTX=ctx;
  S.depth=ctx.depth;S.tier=ctx.tier;
  try{S.tl=(window.IQ&&IQ.Shadow&&IQ.Shadow.TIMELINE)?IQ.Shadow.TIMELINE(ctx.depth):{zapAtFraction:null,subtleGlitch:false,corruptChance:0,impossibleChance:0}}catch(e){S.tl={zapAtFraction:null,corruptChance:0,impossibleChance:0}}
  return new Promise(resolve=>{
   S.resolve=resolve;
   if(ctx.mp.client){
    /* client: rebuild strictly from the host frame — no answer field ever ships */
    const pl=ctx.frame||{};
    S.pz={kind:pl.kind,board:pl.board,oddBoard:pl.oddBoard,seq:pl.seq,options:pl.options,ord:pl.ord,answer:-99,impossible:!!pl.imp};
    S.ord=pl.ord||null;
    renderInto(container);
    return;
   }
   let pz=null;
   const forgedPool=ctx.forgedPool||[];
   if(ctx.forgery&&forgedPool.length&&(ctx.depth<=2||ctx.rng()<.5)){
    pz={...forgedPool[Math.floor(ctx.rng()*forgedPool.length)]};
   }else pz=corrupt(makePuzzle(ctx),ctx);
   S.pz=pz;
   pz.w1=ctx.world?{theme:ctx.world,align:ctx.align}:undefined;
   S.ord=shuffledOrder(pz.options.length,ctx.rng); // ONE fixed order per round, shipped in the frame
   renderInto(container);
   maybeZap();
  });
 },
 /* serializable payload merged into the host 'round' frame (sanitizeRound
    discipline: NEVER ship answer/rule/explanation) */
 frame(){
  const pz=S.pz;if(!pz)return null;
  const ob=pz.oddBoard?{cols:pz.oddBoard.cols,rows:pz.oddBoard.rows,cells:pz.oddBoard.cells}:undefined;
  return {kind:pz.kind,board:pz.board,oddBoard:ob,seq:pz.seq,options:pz.options,ord:S.ord,imp:pz.impossible?1:0};
 },
 /* what the ENGINE (host only) may read at scoring/reveal time */
 describe(){
  const pz=S.pz;if(!pz)return null;
  return {kind:'puzzle',answer:pz.impossible?-99:pz.answer,imp:!!pz.impossible,
   difficulty:pz.difficulty,ord:S.optOrder||S.ord,rule:pz.rule||'',boardSVG:S.boardSVG||''};
 },
 cleanup(){reset()}
});
})();
