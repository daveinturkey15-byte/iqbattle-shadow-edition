/* IQ.Gens['seqPack'] — SEQUENCE-family generator pack for IQ BATTLE (W1).
 * kind:'sequence'. Chains of 4-7 visible cells; engine renders its own '?' terminator
 * after the chain (index.html renderBoard appends a null-cell tile).
 *
 * Five families:
 *   arith    — arithmetic color-steps (+k mod 8), shape/rot frozen
 *   geo3     — geometric run-doubling on a 3-color cycle (runs 1,2,3 easy / 1,2,4 hard)
 *   rotAccum — rotation accumulation: constant step (easy) or fibonacci-style mod 4 (hard)
 *   dual     — alternating dual-rules: odd transitions move color +k, even move rot +j
 *   ladder   — shape ladder plus->ring->square->triangle cycling while an arithmetic
 *              color rule carries alongside
 *
 * Options: 8 single-cell tiles ({cols:1,rows:1,cells:[cell]}). Every decoy mutates
 * EXACTLY ONE attribute of the true tile (color / shape / rot). Exactly one option
 * satisfies the rule.
 *
 * Host-authoritative: no scoring here. Rule parameters live in p.meta (never
 * broadcast — net.js ships only kind/board/oddBoard/seq/options/ord) and are used
 * solely by validate()/explain() to recompute the continuation independently.
 *
 * API: window.IQ.Gens.seqPack = {name,'generate(opts{difficulty1-5,kinds,seed?})',
 *      validate(p)->{ok,errors}, explain(p), selfTest(n)->{pass,fail,details}}
 * Deterministic: same seed => identical puzzle (mulberry32).
 */
(function(){
const root=typeof window!=='undefined'?window:globalThis;
root.IQ=root.IQ||{};
root.IQ.Gens=root.IQ.Gens||{};

function mul(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function ri(r,n){return Math.floor(r()*n)}
var SHAPES=['plus','ring','square','triangle','diamond','cross'];
var LADDER=['plus','ring','square','triangle'];
var FAMS=['arith','geo3','rotAccum','dual','ladder'];

function chainLen(d,r){return d===1?4:d===2?4+ri(r,2):d===3?5:d===4?5+ri(r,2):6+ri(r,2)}

// --- family samplers: return params + rule text -------------------------------
function sample(fam,d,r,hues){
 var p={};
 if(fam==='arith'){
  p.c0=hues[0];
  p.k=d===1?1:1+ri(r,d<=3?3:7);
  p.shape=SHAPES[ri(r,SHAPES.length)];p.rot=ri(r,4);
  p.rule='colors advance by the same step each time';
 }else if(fam==='geo3'){
  p.cols=[hues[0],hues[1],hues[2]];
  p.runs=d<=2?[1,2,3]:[1,2,4];
  p.shape=SHAPES[ri(r,SHAPES.length)];p.rot=ri(r,4);
  p.rule='each color holds one run, and every run lasts one tile longer';
  if(d>=3)p.rule='each color holds one run, and every run lasts twice the previous';
 }else if(fam==='rotAccum'){
  p.c0=hues[0];p.shape=SHAPES[ri(r,SHAPES.length)];
  p.fib=d>=4;
  if(!p.fib){p.r0=ri(r,4);p.k=1+ri(r,d===1?1:3);}
  else{do{p.a=ri(r,4);p.b=ri(r,4);}while(p.a===0&&p.b===0);}
 }else if(fam==='dual'){
  p.c0=hues[0];p.r0=ri(r,4);p.k=d===1?1:1+ri(r,d<=3?3:7);
  p.j=d===1?1:1+ri(r,d<=3?3:4);
  p.shape=SHAPES[ri(r,SHAPES.length)];
  p.rule='color moves on one turn, rotation moves on the next, alternating';
 }
 return p;
}
// ladder shares the arith color carrier
function sampleLadder(d,r,hues){
 return {c0:hues[0],k:d===1?1:1+ri(r,d<=3?3:7),rot:ri(r,4),
  rule:'shapes climb the ladder plus, ring, square, triangle while colors keep stepping'};
}

// --- expansion: cells[i] for i=0..len (len = the hidden answer) ---------------
function expand(fam,p,len){
 var cells=[];
 if(fam==='geo3'){
  // color indices per position: runs of 1,2,3 (easy) or 1,2,4 (hard) over a
  // 3-color cycle; chains never end on a run boundary so the answer is unique.
  var seq=[];var run=0;
  while(seq.length<len+1){var n=p.runs[Math.min(run,p.runs.length-1)];for(var q=0;q<n;q++)seq.push(run%3);run++;}
  for(var i=0;i<len+1;i++)cells.push({shape:p.shape,color:p.cols[seq[i]],rot:p.rot});
 }else if(fam==='rotAccum'){
  var prev,cur;
  for(var i2=0;i2<len+1;i2++){
   var rot;
   if(i2===0)rot=p.fib?p.a:p.r0;
   else if(i2===1)rot=p.fib?p.b:(p.r0+p.k)%4;
   else if(p.fib){rot=(prev+cur)%4;}
   else rot=(p.r0+p.k*i2)%4;
   if(p.fib){if(i2>0){prev=cur;}cur=rot;}
   cells.push({shape:p.shape,color:p.c0,rot:rot});
  }
 }else if(fam==='dual'){
  var color=p.c0,rot=p.r0;
  cells.push({shape:p.shape,color:color,rot:rot});
  for(var t=1;t<len+1;t++){
   if(t%2===1)color=(color+p.k)%8;else rot=(rot+p.j)%4;
   cells.push({shape:p.shape,color:color,rot:rot});
  }
 }else{
  for(var i3=0;i3<len+1;i3++){
   var cell={color:(p.c0+p.k*i3)%8,rot:p.rot};
   if(fam==='ladder')cell.shape=LADDER[i3%4];else cell.shape=p.shape;
   cells.push(cell);
  }
 }
 return cells;
}

// geo3: chain must end strictly inside a run, else the continuation is ambiguous.
// Boundary lengths are the cumulative run ends (1,3,6 / 1,3,7, then restart offsets).
function geo3Len(p,minL,maxL){
 var bad={},sum=0,run=0;
 while(sum<28){var n=p.runs[Math.min(run,p.runs.length-1)];sum+=n;bad[sum]=1;run++;
  if(run%p.runs.length===0)run=0;}
 for(var L=minL;L<=maxL;L++)if(!bad[L])return L;
 return maxL+1<=7?maxL+1:minL; // unreachable in practice; chains stay 4..7
}

// --- puzzle assembly ----------------------------------------------------------
function gen(opts){
 opts=opts||{};
 var d=Math.min(5,Math.max(1,Math.floor(opts.difficulty||2)));
 var seed=(opts.seed!=null?opts.seed:(Date.now()^Math.random()*1e9))>>>0;
 var r=mul(seed);
 var fam=null;
 if(Array.isArray(opts.kinds)){for(var ki=0;ki<opts.kinds.length;ki++)if(FAMS.indexOf(opts.kinds[ki])>=0){fam=opts.kinds[ki];break;}}
 if(!fam)fam=FAMS[ri(r,FAMS.length)];
 var hues=[0,1,2,3,4,5,6,7].sort(function(){return r()-.5});
 var p=sample(fam,d,r,hues);
 var ruleTxt;
 if(fam==='ladder'){p=sampleLadder(d,r,hues);ruleTxt=p.rule;}
 else ruleTxt=p.rule;
 var minL=chainLen(d,r),maxL=Math.min(7,minL+2);
 var L=minL+ri(r,maxL-minL+1);
 if(fam==='geo3')L=geo3Len(p,4,7);
 var cells=expand(fam,p,L);
 var vis=cells.slice(0,L);
 var truth=cells[L];

 // 8 options: truth + 7 one-attribute mutants, all distinct
 var options=[],seen={};
 function key(c){return c.shape+'|'+c.color+'|'+c.rot}
 seen[key(truth)]=1;options.push(truth);
 var guard=0;
 while(options.length<8&&guard++<400){
  var m={shape:truth.shape,color:truth.color,rot:truth.rot};
  var roll=r();
  if(roll<.6)m.color=(m.color+1+ri(r,7))%8;
  else if(roll<.85)m.shape=SHAPES[(SHAPES.indexOf(m.shape)+1+ri(r,SHAPES.length-1))%SHAPES.length];
  else m.rot=(m.rot+1+ri(r,3))%4;
  var k=key(m);
  if(!seen[k]){seen[k]=1;options.push(m);}
 }
 var f=0;
 while(options.length<8){var m2={shape:truth.shape,color:(truth.color+(++f))%8,rot:truth.rot};if(!seen[key(m2)]){seen[key(m2)]=1;options.push(m2);}}

 // deterministic shuffle places the answer
 var ord=options.map(function(_,i){return i});
 for(var i=ord.length-1;i>0;i--){var jj=ri(r,i+1);var tmp=ord[i];ord[i]=ord[jj];ord[jj]=tmp;}
 var tiles=ord.map(function(orig){return {cols:1,rows:1,cells:[options[orig]]}});
 var answer=ord.indexOf(0);

 return {id:'seqpack-'+fam+'-d'+d+'-'+seed.toString(36),kind:'sequence',difficulty:d,
  prompt:'WHAT COMES NEXT?',rule:ruleTxt,seq:vis,options:tiles,answer:answer,
  meta:{fam:fam,len:L,params:p}};
}

// --- validation: structural + independent rule recomputation ------------------
function validCell(c){return !!c&&Number.isInteger(c.color)&&c.color>=0&&c.color<8&&
 Number.isInteger(c.rot)&&c.rot>=0&&c.rot<4&&SHAPES.indexOf(c.shape)>=0;}

function validate(p){
 var errors=[];
 if(!p||p.kind!=='sequence'){errors.push('kind must be sequence');return {ok:false,errors:errors};}
 if(!Array.isArray(p.seq)||p.seq.length<4||p.seq.length>7)errors.push('seq must hold 4-7 visible cells');
 else if(!p.seq.every(validCell))errors.push('seq contains an invalid cell');
 if(!Array.isArray(p.options)||p.options.length!==8)errors.push('options must hold exactly 8 tiles');
 else{
  var keys={};
  for(var i=0;i<8;i++){var t=p.options[i];
   if(!t||t.cols!==1||t.rows!==1||!Array.isArray(t.cells)||t.cells.length!==1||!validCell(t.cells[0])){errors.push('option '+i+' is not a single valid cell');break;}
   var k=t.cells[0].shape+'|'+t.cells[0].color+'|'+t.cells[0].rot;
   if(keys[k])errors.push('duplicate option '+k);keys[k]=1;
  }
 }
 if(!Number.isInteger(p.answer)||p.answer<0||p.answer>7)errors.push('answer out of range');
 if(!p.meta||FAMS.indexOf(p.meta.fam)<0){errors.push('missing/unknown meta family');}
 else if(p.seq&&p.options&&Number.isInteger(p.answer)){
  var ex=expand(p.meta.fam,p.meta.params,p.meta.len)[p.meta.len];
  var got=p.options[p.answer]&&p.options[p.answer].cells[0];
  if(!got||got.shape!==ex.shape||got.color!==ex.color||got.rot!==ex.rot)errors.push('answer tile breaks the '+p.meta.fam+' rule');
 }
 return {ok:errors.length===0,errors:errors};
}

function explain(p){return (p&&p.rule)||'';}

// --- self-test ----------------------------------------------------------------
function eq(a,b){return a.shape===b.shape&&a.color===b.color&&a.rot===b.rot}
function selfTest(iterations){
 iterations=iterations||50;
 var errors=[];var checked=0;var fail=0;
 for(var s=0;s<iterations;s++){
  var base=((0x51ED+Math.imul(s+1,7919))>>>0);
  for(var fi=0;fi<FAMS.length;fi++)for(var d=1;d<=5;d++){
   checked++;
   try{
    var seed=(base^Math.imul(fi+1,2654435761)^Math.imul(d,97))>>>0;
    var p1=gen({difficulty:d,kinds:[FAMS[fi]],seed:seed});
    var v=validate(p1);
    if(!v.ok){fail++;errors.push(FAMS[fi]+' d'+d+' seed '+seed+' invalid: '+v.errors.join('; '));continue;}
    var p2=gen({difficulty:d,kinds:[FAMS[fi]],seed:seed});
    if(JSON.stringify(p1)!==JSON.stringify(p2)){fail++;errors.push(FAMS[fi]+' d'+d+' seed '+seed+' not deterministic');continue;}
    var truth=p1.options[p1.answer].cells[0];
    var others=0;
    for(var o=0;o<8;o++){
     if(o===p1.answer)continue;
     var c=p1.options[o].cells[0];
     if(eq(c,truth)){others++;continue;}
     var diff=(c.shape!==truth.shape)+(c.color!==truth.color)+(c.rot!==truth.rot);
     if(diff!==1){fail++;errors.push(FAMS[fi]+' d'+d+' seed '+seed+' decoy '+o+' mutates '+diff+' attributes');}
    }
    if(others){fail++;errors.push(FAMS[fi]+' d'+d+' seed '+seed+' has '+others+' extra correct-looking options');}
    if(p1.seq.length<4||p1.seq.length>7){fail++;errors.push(FAMS[fi]+' d'+d+' seed '+seed+' chain length '+p1.seq.length);}
   }catch(e){fail++;errors.push(FAMS[fi]+' d'+d+' seed '+seed+' threw: '+e.message);}
  }
 }
 return {pass:checked-fail,fail:fail,checked:checked,details:errors};
}

var api={name:'seqPack',generate:gen,validate:validate,explain:explain,selfTest:selfTest};
root.IQ.Gens.seqPack=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(typeof require!=='undefined'&&typeof module!=='undefined'&&require.main===module){
 var res=selfTest(50);
 console.log(res.fail?'SELF-TEST FAILED:\n'+res.details.join('\n'):'self-test OK ('+res.pass+'/'+res.checked+' puzzles verified)');
 process.exit(res.fail?1:0);
}
})();
