/* gen_depth.js — IQ.Gens['compound'] + IQ.Gens['relay'] — HIGH-DEPTH PACK (Wave A / GenDepth)
 * ============================================================================
 * Dave: "puzzles too basic — closer to iqversus, must make SENSE even when
 * chaotic." The 16 audited families (research/gen-audit-report.md) go easy at
 * deep floors (>=10) because the same small-period shapes recycle. This pack
 * adds two genuinely deeper compositions that stay ONE-SENTENCE verifiable:
 *
 *   compound (kind:'matrix') — TWO independent channels bind every tile:
 *     shade channel: two ghost sequences cross the ANTI-DIAGONALS (ring index
 *       t=x+y spans five values on a 3x3) and their XOR tints each cell; both
 *       ghost periods scale with difficulty (P=[3,3,4,4,5], i.e. 3->5), so low
 *       tiers visibly wrap (t=3 repeats t=0) and high tiers never do.
 *     shape channel: forms climb the plus-ring-square-triangle ladder every
 *       SECOND column (cols 0-1 share a rung, col 2 sits one rung higher).
 *     Rule: "two ghost shades cross the diagonals and their XOR tints each
 *     cell while forms climb the ladder every second column". The hole tile is
 *     provably unique: only column 2 shares the truth's rung, and sampling
 *     rejects ghost draws whose ring shades at t=2,3,4 collide — so the truth
 *     can never byte-match a visible cell and both channels visibly vary.
 *
 *   relay (kind:'sequence') — the STEP ITSELF advances:
 *     color and shape alternate as step carriers (even transitions move color,
 *       odd transitions move shape), and every k-th transition the pace
 *       quickens: the active hop widens by a seeded increment each epoch.
 *       k=3 at d<=3, k=4 at d>=4. Chains are forced long enough (L>=k+2;
 *       k=4 -> L=7) that at least one quickened hop of BOTH carriers is
 *       visible, so the printed rule is verifiable on the board itself.
 *     Hops live in nonzero ranges (color 1..7, shape 1..3), so consecutive
 *       duplicate tiles are structurally impossible (the rotAccum fib bug
 *       class from the audit), and generation rejects any draw whose truth
 *       byte-matches a visible cell.
 *
 * Bars honoured (research/gen-audit-report.md):
 *   (a) one-sentence visually verifiable rule;
 *   (b) matrix hole pinned bottom-right (holeIndex 8); validate() rejects any
 *       other hole position;
 *   (c) 8 distinct options, exactly one correct, every decoy a single-
 *       attribute mutation of the truth;
 *   rotation appears ONLY on triangle carriers (the audit visibility law);
 *   rot is normalized to 0 everywhere else so a decoy can never render
 *   pixel-identical to the truth; rotation-pile degeneracy is structurally
 *   impossible (shape AND shade both vary on every board/chain).
 *
 * Contract (mirrors gen_logic1.js / gen_seqpack.js):
 *   window.IQ.Gens.compound = {name,'generate(opts{difficulty,seed,fam?})',
 *     'validate(p)->{ok,errors}', explain(p), selfTest(n)}
 *   window.IQ.Gens.relay    = same shape.
 *   generate({difficulty 1..5, seed uint32}) -> envelope {id, kind, difficulty,
 *   prompt, rule, board|seq, options:8 single-cell tiles, answer, meta}.
 *   Same seed => byte-identical puzzle. NO Math.random / Date.now anywhere —
 *   a missing seed defaults to 0 (the host always passes one via net:'seed').
 *   meta carries the private rule parameters (net.js never broadcasts meta);
 *   validate() recomputes the rule INDEPENDENTLY from meta and rejects any
 *   puzzle whose shipped answer contradicts it.
 *
 * SUGGESTED STAGE-TABLE WIRING for Main (NOT applied here — modes/mode-puzzle.js
 * is not my file): gate both families at depth >= 10, where they replace the
 * recycled easy-shape draws; combined weight share ~0.15 (suggest compound
 * 0.08, relay 0.07). Self-audit: research/gen-depth-selfaudit.js.
 *
 * Self-run: node gen_depth.js -> runs both selfTests, exits non-zero on fail.
 * ============================================================================
 */
(function(){
const root=typeof window!=='undefined'?window:globalThis;
root.IQ=root.IQ||{};
root.IQ.Gens=root.IQ.Gens||{};

const SHAPES=['plus','ring','square','triangle','diamond','cross'];
const LADDER=['plus','ring','square','triangle'];

// --- mulberry32 seeded RNG (same recipe as gen_logic1 / gen_count) ---
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

/* =================== family 1: compound (matrix) =================== */

const PERIODS=[3,3,4,4,5]; // both ghost periods scale 3 -> 5 with difficulty

function sampleCompound(d,r){
  const P=PERIODS[d-1];
  const U=shuffle(r,[0,1,2,3,4,5,6,7]).slice(0,P);
  const sb=r.int(4);
  // Ghost B: rejection-sample until the ring shades at t=2,3,4 are pairwise
  // distinct. Only column-2 cells share the truth's ladder rung, and their ring
  // indices are exactly 2,3,4 (truth t=4) — so this pins the truth tile apart
  // from EVERY visible cell, and keeps the shade channel visibly alive.
  let V=null;
  for(let tries=0;tries<64&&!V;tries++){
    const cand=shuffle(r,[0,1,2,3,4,5,6,7]).slice(0,P);
    const sh=function(t){return U[t%P]^cand[t%P];};
    const s2=sh(2),s3=sh(3),s4=sh(4);
    if(s2!==s3&&s3!==s4&&s2!==s4)V=cand;
  }
  if(!V){ // deterministic fallback (never hit in practice): spread the draws
    V=shuffle(r,[0,1,2,3,4,5,6,7]).slice(0,P);
    for(let i=1;i<P;i++)V[i]=(V[i]+i*3)%8;
  }
  return {fam:'compound',P:P,U:U,V:V,sb:sb};
}

function compoundCell(m,x,y){
  const t=x+y; // anti-diagonal ring index, spans 0..4 on a 3x3
  return {shape:LADDER[(m.sb+(x>>1))%4],color:m.U[t%m.P]^m.V[t%m.P],rot:0};
}

function buildCompound(d,r){
  const m=sampleCompound(d,r);
  const cells=[];
  for(let i=0;i<9;i++)cells.push(compoundCell(m,i%3,(i/3)|0));
  const truth=compoundCell(m,2,2);
  return {cells:cells,truth:truth,meta:m,
    rule:'two ghost shades cross the diagonals and their XOR tints each cell'+
         ' while forms climb the ladder every second column'};
}

function generateCompound(opts){
  opts=opts||{};
  const d=Math.min(5,Math.max(1,Math.floor(opts.difficulty||2)));
  const seed=(opts.seed!=null?opts.seed:0)>>>0;
  const r=new Rng(seed);
  const built=buildCompound(d,r);
  built.cells[8]=null;                          // hole: bottom-right, always
  const made=makeOptions(built.truth,r,d);
  return {
    id:'depth-compound-d'+d+'-'+seed.toString(36),
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

function validateCompound(p){
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
  if(!m||m.fam!=='compound'||!Array.isArray(m.U)||!Array.isArray(m.V)||
     !Number.isInteger(m.P)||!Number.isInteger(m.sb)){
    errors.push('missing/foreign compound meta');
  }else if(Array.isArray(cells)&&cells.length===9&&Array.isArray(p.options)&&
           Number.isInteger(p.answer)&&p.options[p.answer]){
    // independent re-derivation: the stated rule must reproduce the board AND the answer
    for(let i=0;i<8;i++){
      if(jk(cells[i])!==jk(compoundCell(m,i%3,(i/3)|0))){errors.push('cell '+i+' breaks its rule');break;}
    }
    const truth=compoundCell(m,2,2);
    if(jk(p.options[p.answer].cells[0])!==jk(truth))errors.push('answer tile breaks the compound rule');
  }
  return {ok:errors.length===0,errors:errors};
}

function selfTestCompound(rounds){
  rounds=rounds||50;
  const errors=[];let checked=0,fail=0;
  for(let seed=1;seed<=rounds;seed++){
    for(let d=1;d<=5;d++){
      checked++;
      const s=(seed*7919+d*104729)>>>0;
      try{
        const p=generateCompound({difficulty:d,seed:s});
        const tag='compound seed '+s+' d'+d;
        const v=validateCompound(p);
        if(!v.ok){fail++;errors.push(tag+' validate: '+v.errors.join('; '));continue;}
        if(jk(generateCompound({difficulty:d,seed:s}))!==jk(p)){fail++;errors.push(tag+' not deterministic');continue;}
        if(p.meta.P!==PERIODS[d-1]){fail++;errors.push(tag+' period knob off');continue;}
        const truth=p.meta?p.options[p.answer].cells[0]:null;
        let extra=0,badDecoy=0;
        for(let o=0;o<8;o++){
          if(o===p.answer)continue;
          const c=p.options[o].cells[0];
          if(jk(c)===jk(truth)){extra++;continue;}
          if((c.shape!==truth.shape)+(c.color!==truth.color)+(c.rot!==truth.rot)!==1)badDecoy++;
        }
        if(extra||badDecoy){fail++;errors.push(tag+' option bar broken (extra '+extra+', multi-mutant '+badDecoy+')');continue;}
        // truth never duplicates a visible cell; board never a rotation pile
        const vis=p.board.cells.filter(Boolean);
        if(vis.some(function(c){return jk(c)===jk(truth);})){fail++;errors.push(tag+' truth copies a visible cell');continue;}
      }catch(e){fail++;errors.push('compound seed '+s+' d'+d+' threw: '+e.message);}
    }
  }
  return {pass:checked-fail,fail:fail,checked:checked,details:errors};
}

/* =================== family 2: relay (sequence) =================== */

function relayParams(d,r){
  return {
    k:d<=3?3:4,            // sub-rule period: quicken every k-th step
    c0:r.int(8),           // starting shade
    sb:r.int(4),           // starting ladder rung
    c0s:r.int(7),          // initial color hop - 1 (hop stays in 1..7)
    s0s:r.int(3),          // initial shape hop - 1 (hop stays in 1..3)
    dc:1+r.int(2)          // seeded pace increment for the color carrier
  };
}

// The step itself advances: each epoch (floor(t/k)) widens the active hop.
function relayHop(p,t){
  const e=Math.floor(t/p.k);
  if(t%2===0)return {ch:'color',n:((p.c0s+e*p.dc)%7)+1}; // nonzero => no zero-steps
  return {ch:'shape',n:((p.s0s+e)%3)+1};
}

function relayCells(p,len){ // len+1 tiles; index len is the hidden answer
  const cells=[{shape:LADDER[p.sb],color:p.c0,rot:0}];
  let color=p.c0,rung=p.sb;
  for(let t=0;t<len;t++){
    const h=relayHop(p,t);
    if(h.ch==='color')color=(color+h.n)%8;else rung=(rung+h.n)%4;
    cells.push({shape:LADDER[rung],color:color,rot:0});
  }
  return cells;
}

function relayRule(p){
  return 'color and shape take turns stepping, and every '+p.k+
         ' steps the pace quickens by another hop';
}

// Chains long enough that a quickened hop of BOTH carriers is visible:
// k=3 needs transitions 3 (odd) and 4 (even) -> L>=5; k=4 needs transition 5 -> L=7.
function relayLen(d,r){const k=d<=3?3:4;return k===3?5+r.int(3):7;}

function generateRelay(opts){
  opts=opts||{};
  const d=Math.min(5,Math.max(1,Math.floor(opts.difficulty||2)));
  const seed=(opts.seed!=null?opts.seed:0)>>>0;
  const r=new Rng(seed);
  const L=relayLen(d,r);
  let p=null,cells=null;
  for(let att=0;att<64;att++){ // reject draws whose truth copies a visible cell
    p=relayParams(d,r);
    cells=relayCells(p,L);
    const truth=cells[L];
    if(!cells.slice(0,L).some(function(c){return jk(c)===jk(truth);}))break;
  }
  const vis=cells.slice(0,L),truth=cells[L];
  const made=makeOptions(truth,r,d);
  return {
    id:'depth-relay-d'+d+'-'+seed.toString(36),
    kind:'sequence',
    difficulty:d,
    prompt:'WHAT COMES NEXT?',
    rule:relayRule(p),
    seq:vis,
    options:made.tiles,
    answer:made.answer,
    meta:{fam:'relay',len:L,params:p}
  };
}

function validateRelay(p){
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
  if(!m||m.fam!=='relay'||!m.params||!Number.isInteger(m.len)){
    errors.push('missing/foreign relay meta');
  }else if(Array.isArray(p.seq)&&Array.isArray(p.options)&&Number.isInteger(p.answer)&&p.options[p.answer]){
    // independent re-derivation from meta params
    const ex=relayCells(m.params,m.len);
    let broke=null;
    for(let i=0;i<p.seq.length;i++)
      if(jk(p.seq[i])!==jk(ex[i])){broke='visible tile '+i+' breaks the relay rule';break;}
    if(!broke&&p.seq.some(function(c,i){return i>0&&jk(c)===jk(p.seq[i-1]);}))
      broke='consecutive duplicate tiles';
    if(broke)errors.push(broke);
    else if(jk(p.options[p.answer].cells[0])!==jk(ex[m.len]))
      errors.push('answer tile breaks the relay rule');
  }
  return {ok:errors.length===0,errors:errors};
}

function selfTestRelay(rounds){
  rounds=rounds||50;
  const errors=[];let checked=0,fail=0;
  for(let seed=1;seed<=rounds;seed++){
    for(let d=1;d<=5;d++){
      checked++;
      const s=((0x51ED+Math.imul(seed,7919))^Math.imul(d,97))>>>0;
      try{
        const p=generateRelay({difficulty:d,seed:s});
        const tag='relay seed '+s+' d'+d;
        const v=validateRelay(p);
        if(!v.ok){fail++;errors.push(tag+' validate: '+v.errors.join('; '));continue;}
        if(jk(generateRelay({difficulty:d,seed:s}))!==jk(p)){fail++;errors.push(tag+' not deterministic');continue;}
        if(p.meta.params.k!==(d<=3?3:4)){fail++;errors.push(tag+' k knob off');continue;}
        if(p.seq.length<(d<=3?5:7)){fail++;errors.push(tag+' chain too short to show the quickening');continue;}
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
      }catch(e){fail++;errors.push('relay seed '+s+' d'+d+' threw: '+e.message);}
    }
  }
  return {pass:checked-fail,fail:fail,checked:checked,details:errors};
}

/* =================== registration =================== */

const compoundApi={name:'compound',generate:generateCompound,validate:validateCompound,
  explain:function(p){return (p&&p.rule)||'';},selfTest:selfTestCompound};
const relayApi={name:'relay',generate:generateRelay,validate:validateRelay,
  explain:function(p){return (p&&p.rule)||'';},selfTest:selfTestRelay};

root.IQ.Gens.compound=compoundApi;
root.IQ.Gens.relay=relayApi;

if(typeof module!=='undefined'&&module.exports)
  module.exports={compound:compoundApi,relay:relayApi};

if(typeof require!=='undefined'&&typeof module!=='undefined'&&require.main===module){
  let bad=0;
  [compoundApi,relayApi].forEach(function(api){
    const res=api.selfTest(50);
    console.log(api.name+': '+(res.fail?'SELF-TEST FAILED:\n'+res.details.join('\n')
      :'self-test OK ('+res.pass+'/'+res.checked+' puzzles verified)'));
    if(res.fail)bad=1;
  });
  process.exit(bad);
}
})();
