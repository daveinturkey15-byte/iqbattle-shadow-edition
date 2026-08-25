/* gen_depth2.js — IQ.Gens['parquet'] + IQ.Gens['pendulum'] — HIGH-DEPTH PACK II (Wave 5 / GenFamilies2)
 * ============================================================================
 * Second wave of genuinely deeper compositions in the gen_depth.js mold: still
 * ONE-SENTENCE verifiable, still audited-bar clean.
 *
 *   parquet (kind:'matrix') — the 3x3 is tiled by a seeded TWO-COLOUR CHECKER
 *     whose phase slips one step per row (colour(x,y) = seeded pair indexed by
 *     (x+y+phase)%2 — moving down a row shifts the stripe pattern one column),
 *     while a seeded 5-shape wheel turns one notch per row AND gains one extra
 *     notch every P columns (P=2 at difficulty<=3, P=3 at difficulty>=4):
 *     wheelIndex = base + x + 2y + floor(x/P)  (mod 5).
 *     Rule: "colours checker across the grid but slip one step down each row,
 *     while the shape wheel turns one notch per row plus an extra notch every
 *     <P> columns". The hole tile is provably unique: the truth's wheel index
 *     collides with at most one visible cell ((0,1) at P=2 / (1,0) at P=3)
 *     and that cell always sits on the OPPOSITE checker parity, so its colour
 *     can never match; generation still runs a rejection pass over the seeded
 *     knobs as belt-and-braces. Both channels visibly vary on every board
 *     (all five wheel indices land on the 3x3), so single-channel shortcuts
 *     and rotation-pile degeneracy are structurally impossible (rot is 0
 *     everywhere — rotation appears ONLY where a carrier is a triangle, via
 *     the shared decoy builder's visibility law).
 *
 *   pendulum (kind:'sequence') — the shade swings around a seeded pivot:
 *     term 0 sits ON the pivot; each transition alternates sign (+up, -down),
 *     upHop(t)  = ((u0 + inc*floor(t/k)) % 7) + 1   (even transitions)
 *     downHop(t)= ((d0 + inc*floor(t/k)) % 7) + 1   (odd  transitions)
 *     so the swing amplitude widens by the seeded increment inc every k terms
 *     (k=3 at difficulty<=3, k=4 at difficulty>=4; k is PRINTED in the rule).
 *     Hops live in 1..7 — never zero mod 8 — and the form climbs exactly one
 *     ladder rung per term, so consecutive duplicate tiles are structurally
 *     impossible (the rotAccum fib bug class). Chains run L>=k+2 tiles so a
 *     WIDENED hop of BOTH signs is visible on the board itself, and generation
 *     rejects any draw whose truth byte-matches a visible cell.
 *
 * Bars honoured (research/gen-audit-report.md method):
 *   (a) one-sentence visually verifiable rule (length-guarded);
 *   (b) matrix hole pinned bottom-right (holeIndex 8); validate() rejects any
 *       other hole position;
 *   (c) 8 distinct options, exactly one correct, every decoy a single-
 *       attribute mutation of the truth;
 *   rotation appears ONLY on triangle carriers; rot normalized to 0 elsewhere
 *   so no decoy can render pixel-identical to the truth.
 *
 * Contract (mirrors gen_depth.js / gen_logic1.js):
 *   window.IQ.Gens.parquet  = {name,'generate(opts{difficulty,seed})',
 *     'validate(p)->{ok,errors}', explain(p), selfTest(n)}
 *   window.IQ.Gens.pendulum = same shape.
 *   generate({difficulty 1..5, seed uint32}) -> envelope {id, kind, difficulty,
 *   prompt, rule, board|seq, options:8 single-cell tiles, answer, meta}.
 *   Same seed => byte-identical puzzle. NO Math.random / Date.now anywhere —
 *   a missing seed defaults to 0 (the host always passes one via net:'seed').
 *   meta carries the private rule parameters (net.js never broadcasts meta);
 *   validate() recomputes the rule from meta and rejects any puzzle whose
 *   shipped answer contradicts it. Independent solvers live OUTSIDE this file
 *   in research/gen-depth2-selfaudit.js.
 *
 * SUGGESTED STAGE-TABLE WIRING for Main (NOT applied here — modes/mode-puzzle.js
 * is not my file): gate BOTH families at depth >= 9, weight ~0.06 EACH
 * (~0.12 combined alongside gen_depth.js's 0.15 share at depth >= 10).
 * Self-audit: research/gen-depth2-selfaudit.js (20 samples x difficulty 1..5
 * against fresh independent solvers + 550-per-family stress sweep).
 *
 * Self-run: node gen_depth2.js -> runs both selfTests, exits non-zero on fail.
 * ============================================================================
 */
(function(){
const root=typeof window!=='undefined'?window:globalThis;
root.IQ=root.IQ||{};
root.IQ.Gens=root.IQ.Gens||{};

const SHAPES=['plus','ring','square','triangle','diamond','cross'];
const LADDER=['plus','ring','square','triangle'];

// --- mulberry32 seeded RNG (same recipe as gen_depth / gen_logic1) ---
function mulberry32(a){
  return function(){
    a|=0;a=(a+0x6D2B79F5)|0;
    let t=Math.imul(a^(a>>>15),1|a);
    t=(t+Math.imul(t^(t>>>7),61|t))^t;
    return((t^t>>>14)>>>0)/4294967296;
  };
}
class Rng{
  constructor(seed){this.next=mulberry32(seed>>>0);}
  f(){return this.next();}
  int(n){return Math.min(n-1,Math.floor(this.next()*n));}
  pick(arr){return arr[this.int(arr.length)];}
}
function shuffle(r,arr){
  const out=arr.slice();
  for(let i=out.length-1;i>0;i--){const j=r.int(i+1);[out[i],out[j]]=[out[j],out[i]];}
  return out;
}
function jk(o){return JSON.stringify(o);}

const MATRIX_PROMPTS=[
  'WHICH FRAGMENT COMPLETES THE PATTERN?',
  'TWO RULES ENTANGLE. NAME THE MISSING TILE.',
  'THE GRID IS BROKEN. RESTORE THE MISSING PIECE.'
];

// --- shared option builder: truth + 7 single-attribute mutants, all distinct.
// Rot mutants only when the truth wears the triangle (visibility law): on any
// 90-degree-symmetric shape a rot-mutant would render identical to the truth.
function makeOptions(truth,r,d){
  const seen={};seen[jk(truth)]=1;
  const options=[truth];
  const colorW=Math.max(.4,.72-d*.06);
  const shapeW=(1-colorW)*.55;
  let guard=0;
  while(options.length<8&&guard++<400){
    const m={shape:truth.shape,color:truth.color,rot:truth.rot};
    const roll=r.f();
    if(roll<colorW){
      m.color=d>=4?(m.color+(r.f()<.5?1:7))%8:(m.color+1+r.int(7))%8;
    }else if(roll<colorW+shapeW||truth.shape!=='triangle'){
      m.shape=SHAPES[(SHAPES.indexOf(m.shape)+1+r.int(SHAPES.length-1))%SHAPES.length];
    }else{
      m.rot=(m.rot+1+r.int(3))%4;
    }
    const key=jk(m);
    if(!seen[key]){seen[key]=1;options.push(m);}
  }
  let off=0;
  while(options.length<8&&off++<8){
    const m={shape:truth.shape,color:(truth.color+off)%8,rot:truth.rot};
    if(!seen[jk(m)]){seen[jk(m)]=1;options.push(m);}
  }
  const answer=r.int(8);
  const others=options.slice(1);
  others.splice(answer,0,options[0]);
  return {tiles:others.map(function(m){return {cols:1,rows:1,cells:[m]};}),answer:answer};
}

/* =================== family 1: parquet (matrix) =================== */

// Seeded 5-shape wheel drawn from the six carriers.
function sampleWheel(r){
  return shuffle(r,SHAPES.slice()).slice(0,5);
}
function parquetPeriod(d){return d<=3?2:3;}

function sampleParquet(d,r){
  // Rejection over the seeded knobs: accept the first draw whose truth tile
  // byte-differs from every visible cell. (The wheel algebra already pins the
  // truth apart — its lone co-index cell always sits on the opposite checker
  // parity — so this accepts first try; the loop is the documented guard.)
  let m=null;
  for(let tries=0;tries<64;tries++){
    m={fam:'parquet',P:parquetPeriod(d),
       ca:r.int(8),cb:0,ph:r.int(2),sb:r.int(4),SET:sampleWheel(r)};
    m.cb=(m.ca+1+r.int(7))%8;
    const truth=parquetCell(m,2,2);
    let clash=false;
    for(let y=0;y<3&&!clash;y++)for(let x=0;x<3&&!clash;x++){
      if(x===2&&y===2)continue;
      if(jk(parquetCell(m,x,y))===jk(truth))clash=true;
    }
    if(!clash)return m;
  }
  return m; // unreachable in practice; last draw still validates below
}

function parquetCell(m,x,y){
  // colour: two-colour checker whose phase slips one step per row
  const color=((x+y+m.ph)%2===0)?m.ca:m.cb;
  // shape: wheel turns one notch per row plus one extra notch every P columns
  const shape=m.SET[(m.sb+x+2*y+Math.floor(x/m.P))%5];
  return {shape:shape,color:color,rot:0};
}

function parquetRule(P){
  return 'colours checker across the grid but slip one step down each row, '+
         'while the shape wheel turns one notch per row plus an extra notch '+
         'every '+P+' columns';
}

function buildParquet(d,r){
  const m=sampleParquet(d,r);
  const cells=[];
  for(let i=0;i<9;i++)cells.push(parquetCell(m,i%3,(i/3)|0));
  const truth=parquetCell(m,2,2);
  return {cells:cells,truth:truth,meta:m,rule:parquetRule(m.P)};
}

function generateParquet(opts){
  opts=opts||{};
  const d=Math.min(5,Math.max(1,Math.floor(opts.difficulty||2)));
  const seed=(opts.seed!=null?opts.seed:0)>>>0;
  const r=new Rng(seed);
  const built=buildParquet(d,r);
  built.cells[8]=null;                          // hole: bottom-right, always
  const made=makeOptions(built.truth,r,d);
  return {
    id:'depth-parquet-d'+d+'-'+seed.toString(36),
    kind:'matrix',
    difficulty:d,
    prompt:r.pick(MATRIX_PROMPTS),
    rule:built.rule,
    board:{cols:3,rows:3,cells:built.cells,holeIndex:8},
    options:made.tiles,
    answer:made.answer,
    meta:built.meta
  };
}

function validCell(c){
  return !!c&&typeof c.shape==='string'&&SHAPES.indexOf(c.shape)>=0&&
    Number.isInteger(c.color)&&c.color>=0&&c.color<=7&&
    Number.isInteger(c.rot)&&c.rot>=0&&c.rot<=3;
}

function validateParquet(p){
  const errors=[];
  if(!p||typeof p!=='object')return {ok:false,errors:['not a puzzle object']};
  if(p.kind!=='matrix')errors.push('kind must be "matrix"');
  if(!Number.isInteger(p.difficulty)||p.difficulty<1||p.difficulty>5)
    errors.push('difficulty must be an integer 1..5');
  const b=p.board;
  if(!b||b.cols!==3||b.rows!==3)errors.push('board must be 3x3');
  const cells=b&&b.cells;
  if(!Array.isArray(cells)||cells.length!==9)errors.push('board.cells must hold 9 entries');
  else{
    if(b.holeIndex!==8)errors.push('hole must sit at index 8 (bottom-right)');
    if(cells[8]!==null&&cells[8]!==undefined)errors.push('hole cell must be empty');
    for(let i=0;i<8;i++)if(!validCell(cells[i]))errors.push('malformed cell at '+i);
  }
  if(!Array.isArray(p.options)||p.options.length!==8)errors.push('options must hold exactly 8 tiles');
  else{
    const seen=new Set();
    p.options.forEach(function(o,i){
      const c=o&&o.cols===1&&o.rows===1&&Array.isArray(o.cells)&&o.cells.length===1?o.cells[0]:null;
      if(!validCell(c)){errors.push('malformed option tile '+i);return;}
      const key=jk(c);
      if(seen.has(key))errors.push('duplicate option at '+i);
      seen.add(key);
    });
  }
  if(!Number.isInteger(p.answer)||p.answer<0||p.answer>7)errors.push('answer must index 0..7');
  const m=p.meta;
  if(!m||m.fam!=='parquet'||!Array.isArray(m.SET)||m.SET.length!==5||
     !Number.isInteger(m.P)||!Number.isInteger(m.ca)||!Number.isInteger(m.cb)||
     !Number.isInteger(m.ph)||!Number.isInteger(m.sb)){
    errors.push('missing/foreign parquet meta');
  }else if(Array.isArray(cells)&&cells.length===9&&Array.isArray(p.options)&&
           Number.isInteger(p.answer)&&p.options[p.answer]){
    // independent re-derivation: the stated rule must reproduce the board AND the answer
    for(let i=0;i<8;i++){
      if(jk(cells[i])!==jk(parquetCell(m,i%3,(i/3)|0))){errors.push('cell '+i+' breaks its rule');break;}
    }
    const truth=parquetCell(m,2,2);
    if(jk(p.options[p.answer].cells[0])!==jk(truth))errors.push('answer tile breaks the parquet rule');
  }
  return {ok:errors.length===0,errors:errors};
}

function selfTestParquet(rounds){
  rounds=rounds||50;
  const errors=[];let checked=0,fail=0;
  for(let seed=1;seed<=rounds;seed++){
    for(let d=1;d<=5;d++){
      checked++;
      const s=((0x51F2+Math.imul(seed,7919))^Math.imul(d,97))>>>0;
      try{
        const p=generateParquet({difficulty:d,seed:s});
        const tag='parquet seed '+s+' d'+d;
        const v=validateParquet(p);
        if(!v.ok){fail++;errors.push(tag+' validate: '+v.errors.join('; '));continue;}
        if(jk(generateParquet({difficulty:d,seed:s}))!==jk(p)){fail++;errors.push(tag+' not deterministic');continue;}
        if(p.meta.P!==parquetPeriod(d)){fail++;errors.push(tag+' period knob off');continue;}
        const truth=p.options[p.answer].cells[0];
        let extra=0,badDecoy=0;
        for(let o=0;o<8;o++){
          if(o===p.answer)continue;
          const c=p.options[o].cells[0];
          if(jk(c)===jk(truth)){extra++;continue;}
          if((c.shape!==truth.shape)+(c.color!==truth.color)+(c.rot!==truth.rot)!==1)badDecoy++;
        }
        if(extra||badDecoy){fail++;errors.push(tag+' option bar broken (extra '+extra+', multi-mutant '+badDecoy+')');continue;}
        // truth never duplicates a visible cell; both channels visibly vary
        const vis=p.board.cells.filter(Boolean);
        if(vis.some(function(c){return jk(c)===jk(truth);})){fail++;errors.push(tag+' truth copies a visible cell');continue;}
        if(new Set(vis.map(function(c){return c.color;})).size<2){fail++;errors.push(tag+' colour channel frozen');continue;}
        if(new Set(vis.map(function(c){return c.shape;})).size<3){fail++;errors.push(tag+' shape channel too quiet');continue;}
      }catch(e){fail++;errors.push('parquet seed '+s+' d'+d+' threw: '+e.message);}
    }
  }
  return {pass:checked-fail,fail:fail,checked:checked,details:errors};
}

/* =================== family 2: pendulum (sequence) =================== */

function pendulumParams(d,r){
  return {
    k:d<=3?3:4,            // amplitude widens every k terms (printed in rule)
    piv:r.int(8),          // seeded pivot shade (term 0 sits on it)
    sb:r.int(4),           // starting ladder rung
    u0:r.int(7),           // up-swing base amplitude - 1
    d0:r.int(7),           // down-swing base amplitude - 1
    inc:1+r.int(2)         // seeded widening increment
  };
}

// The swing widens every k terms: epoch floor(t/k) lifts BOTH amplitudes.
function pendulumHop(q,t){
  const e=Math.floor(t/q.k);
  if(t%2===0)return ((q.u0+q.inc*e)%7)+1;   // up-swing, always 1..7
  return ((q.d0+q.inc*e)%7)+1;              // down-swing, always 1..7
}

function pendulumCells(q,len){ // len+1 tiles; index len is the hidden answer
  const cells=[{shape:LADDER[q.sb],color:q.piv,rot:0}];
  let color=q.piv;
  for(let t=0;t<len;t++){
    const h=pendulumHop(q,t);
    color=t%2===0?(color+h)%8:(color-h+8)%8;
    cells.push({shape:LADDER[(q.sb+t+1)%4],color:color,rot:0}); // form climbs one rung per term
  }
  return cells;
}

function pendulumRule(k){
  return 'the shade swings above then below its pivot colour, widening every '+
         k+' steps, while the form climbs one rung per term';
}

// Chains long enough that a WIDENED hop of BOTH signs is visible:
// k=3 -> transitions 3 (down,e=1) and 4 (up,e=1) need L>=5, use 6..7;
// k=4 -> transitions 4 (up,e=1) and 5 (down,e=1) need L>=6, use 7.
function pendulumLen(d,r){const k=d<=3?3:4;return k===3?6+r.int(2):7;}

function generatePendulum(opts){
  opts=opts||{};
  const d=Math.min(5,Math.max(1,Math.floor(opts.difficulty||2)));
  const seed=(opts.seed!=null?opts.seed:0)>>>0;
  const r=new Rng(seed);
  const L=pendulumLen(d,r);
  let q=null,cells=null;
  for(let att=0;att<64;att++){ // reject draws whose truth copies a visible cell
    q=pendulumParams(d,r);
    cells=pendulumCells(q,L);
    const truth=cells[L];
    if(!cells.slice(0,L).some(function(c){return jk(c)===jk(truth);}))break;
  }
  const vis=cells.slice(0,L),truth=cells[L];
  const made=makeOptions(truth,r,d);
  return {
    id:'depth-pendulum-d'+d+'-'+seed.toString(36),
    kind:'sequence',
    difficulty:d,
    prompt:'WHAT COMES NEXT?',
    rule:pendulumRule(q.k),
    seq:vis,
    options:made.tiles,
    answer:made.answer,
    meta:{fam:'pendulum',len:L,params:q}
  };
}

function validatePendulum(p){
  const errors=[];
  if(!p||typeof p!=='object')return {ok:false,errors:['not a puzzle object']};
  if(p.kind!=='sequence')errors.push('kind must be "sequence"');
  if(!Number.isInteger(p.difficulty)||p.difficulty<1||p.difficulty>5)
    errors.push('difficulty must be an integer 1..5');
  if(!Array.isArray(p.seq)||p.seq.length<4||p.seq.length>7)errors.push('seq must hold 4-7 visible cells');
  else if(!p.seq.every(validCell))errors.push('seq contains an invalid cell');
  if(!Array.isArray(p.options)||p.options.length!==8)errors.push('options must hold exactly 8 tiles');
  else{
    const seen=new Set();
    p.options.forEach(function(o,i){
      const c=o&&o.cols===1&&o.rows===1&&Array.isArray(o.cells)&&o.cells.length===1?o.cells[0]:null;
      if(!validCell(c)){errors.push('malformed option tile '+i);return;}
      const key=jk(c);
      if(seen.has(key))errors.push('duplicate option at '+i);
      seen.add(key);
    });
  }
  if(!Number.isInteger(p.answer)||p.answer<0||p.answer>7)errors.push('answer out of range');
  const m=p.meta;
  if(!m||m.fam!=='pendulum'||!m.params||!Number.isInteger(m.len)||
     !Number.isInteger(m.params.k)||!Number.isInteger(m.params.piv)||
     !Number.isInteger(m.params.sb)||!Number.isInteger(m.params.u0)||
     !Number.isInteger(m.params.d0)||!Number.isInteger(m.params.inc)){
    errors.push('missing/foreign pendulum meta');
  }else if(Array.isArray(p.seq)&&Array.isArray(p.options)&&Number.isInteger(p.answer)&&p.options[p.answer]){
    // independent re-derivation from meta params
    const ex=pendulumCells(m.params,m.len);
    let broke=null;
    for(let i=0;i<p.seq.length;i++)
      if(jk(p.seq[i])!==jk(ex[i])){broke='visible tile '+i+' breaks the pendulum rule';break;}
    if(!broke&&p.seq.some(function(c,i){return i>0&&jk(c)===jk(p.seq[i-1]);}))
      broke='consecutive duplicate tiles';
    if(broke)errors.push(broke);
    else if(jk(p.options[p.answer].cells[0])!==jk(ex[m.len]))
      errors.push('answer tile breaks the pendulum rule');
  }
  return {ok:errors.length===0,errors:errors};
}

function selfTestPendulum(rounds){
  rounds=rounds||50;
  const errors=[];let checked=0,fail=0;
  for(let seed=1;seed<=rounds;seed++){
    for(let d=1;d<=5;d++){
      checked++;
      const s=((0x51F3+Math.imul(seed,7919))^Math.imul(d,97))>>>0;
      try{
        const p=generatePendulum({difficulty:d,seed:s});
        const tag='pendulum seed '+s+' d'+d;
        const v=validatePendulum(p);
        if(!v.ok){fail++;errors.push(tag+' validate: '+v.errors.join('; '));continue;}
        if(jk(generatePendulum({difficulty:d,seed:s}))!==jk(p)){fail++;errors.push(tag+' not deterministic');continue;}
        if(p.meta.params.k!==(d<=3?3:4)){fail++;errors.push(tag+' k knob off');continue;}
        if(p.seq.length<(d<=3?6:7)){fail++;errors.push(tag+' chain too short to show the widening');continue;}
        const truth=p.options[p.answer].cells[0];
        let extra=0,badDecoy=0;
        for(let o=0;o<8;o++){
          if(o===p.answer)continue;
          const c=p.options[o].cells[0];
          if(jk(c)===jk(truth)){extra++;continue;}
          if((c.shape!==truth.shape)+(c.color!==truth.color)+(c.rot!==truth.rot)!==1)badDecoy++;
        }
        if(extra||badDecoy){fail++;errors.push(tag+' option bar broken (extra '+extra+', multi-mutant '+badDecoy+')');continue;}
        if(p.seq.some(function(c){return jk(c)===jk(truth);})){fail++;errors.push(tag+' truth copies a visible cell');continue;}
        for(let i=1;i<p.seq.length;i++)
          if(jk(p.seq[i])===jk(p.seq[i-1])){fail++;errors.push(tag+' consecutive duplicate at '+i);break;}
      }catch(e){fail++;errors.push('pendulum seed '+s+' d'+d+' threw: '+e.message);}
    }
  }
  return {pass:checked-fail,fail:fail,checked:checked,details:errors};
}

/* =================== registration =================== */

const parquetApi={name:'parquet',generate:generateParquet,validate:validateParquet,
  explain:function(p){return (p&&p.rule)||'';},selfTest:selfTestParquet};
const pendulumApi={name:'pendulum',generate:generatePendulum,validate:validatePendulum,
  explain:function(p){return (p&&p.rule)||'';},selfTest:selfTestPendulum};

root.IQ.Gens.parquet=parquetApi;
root.IQ.Gens.pendulum=pendulumApi;

if(typeof module!=='undefined'&&module.exports)
  module.exports={parquet:parquetApi,pendulum:pendulumApi};

if(typeof require!=='undefined'&&typeof module!=='undefined'&&require.main===module){
  let bad=0;
  [parquetApi,pendulumApi].forEach(function(api){
    const res=api.selfTest(50);
    console.log(api.name+': '+(res.fail?'SELF-TEST FAILED:\n'+res.details.join('\n')
      :'self-test OK ('+res.pass+'/'+res.checked+' puzzles verified)'));
    if(res.fail)bad=1;
  });
  process.exit(bad);
}
})();
