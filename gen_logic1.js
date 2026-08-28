/* IQ.Gens['logicA'] — MATRIX LOGIC PACK (W1) for IQ BATTLE.
 * Five classic-matrix archetypes, 3x3 boards, hole always bottom-right,
 * decoys = single-attribute mutations of the true fragment (gen_iqb pattern).
 *
 * Archetypes (p.meta.arch):
 *   chain    — progression-chain rows: shape morphs one step along a fixed
 *              chain per column (per-row offset shift at d>=4).
 *   xor      — XOR-overlay: two hidden ghost layers (row-constant A, column-
 *              constant B); cell color = A[y] XOR B[x]. At d>=4 the shape
 *              channel also encodes (A+B) mod 6.
 *   lattice  — position-lattice: color = palette[(dir*(x+y)) mod k], k grows
 *              with difficulty (d1:2 .. d5:5).
 *   rotpile  — quarter-turn march: rot accumulates +90 deg per step in
 *              reading order while shades deepen row-by-row (+ column drift
 *              at d>=4); the hole tile is bound by both channels.
 *   cluster  — count-cluster: seeded cells keep the seed hue; every other
 *              cell's color = base + (count of orthogonally adjacent seeds),
 *              mod 8. Answer = neighbor-seed count around the hole.
 *
 * Contract: generate({difficulty 1..5, seed uint32}) -> puzzle envelope
 * {id, kind:'matrix', difficulty, prompt, rule, board{cols,rows,cells,holeIndex},
 *  options:8 single-cell tiles {cols,rows,cells}, answer}. Same seed =>
 * byte-identical puzzle. Host-authoritative scoring: no client scoring here.
 *
 * Registers window.IQ.Gens.logicA. Self-runs selfTest() under node. */
(function(){
const root=typeof window!=='undefined'?window:globalThis;
root.IQ=root.IQ||{};
root.IQ.Gens=root.IQ.Gens||{};

const SHAPES=['plus','ring','square','triangle','diamond','cross'];
const ARCHS=['chain','xor','lattice','rotpile','cluster'];

// --- mulberry32 seeded RNG (same recipe as IQ.Puzzles / gen_count) ---
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

const PROMPTS=[
  'WHICH FRAGMENT COMPLETES THE PATTERN?',
  'THE GRID IS BROKEN. RESTORE THE MISSING PIECE.',
  'ONE TILE WAS SWALLOWED. NAME IT.',
  'FIND THE PIECE THE PATTERN DEMANDS.'
];

// --- archetype builders: {cells(9), truth, meta, rule} ---
function build(arch,d,r){
  // Only the triangle renders rotation (other shapes have 90-degree symmetry):
  // rotation-bearing rotpile wears it; everywhere else invisible rots are 0
  // so a rot-mutant decoy can never render identical to the truth.
  const shape=arch==='rotpile'?'triangle':r.pick(SHAPES);
  const rot=(arch==='rotpile'||shape==='triangle')?r.int(4):0;

  if(arch==='chain'){
    const L=d<=2?3:(d===3?4:5);
    const list=shuffle(r,SHAPES).slice(0,L);
    const base=r.int(L);
    const rs=d>=4?1:0;           // per-row chain offset at higher difficulty
    const color=r.int(8);
    const cells=[];
    for(let y=0;y<3;y++)for(let x=0;x<3;x++)
      cells.push({shape:list[(base+y*rs+x)%L],color,rot});
    const truth={shape:list[(base+2*rs+2)%L],color,rot};
    return {cells,truth,meta:{list,base,rs,color,rot},
      rule:'shapes march one step along a fixed chain across each row'};
  }

  if(arch==='xor'){
    const hi=d<=2?4:8;           // wider ghost-value spread at d>=3
    const a=[r.int(hi),r.int(hi),r.int(hi)];   // row-constant layer
    const b=[r.int(hi),r.int(hi),r.int(hi)];   // column-constant layer
    const shapeEnc=d>=4;                       // shape = (A+B) mod 6
    const cells=[];
    for(let y=0;y<3;y++)for(let x=0;x<3;x++)
      cells.push({shape:shapeEnc?SHAPES[(a[y]+b[x])%SHAPES.length]:shape,
                  color:a[y]^b[x],rot});
    const truth={shape:shapeEnc?SHAPES[(a[2]+b[2])%SHAPES.length]:shape,
                 color:a[2]^b[2],rot};
    return {cells,truth,meta:{a,b,shapeEnc,shape,rot},
      rule:'two ghost layers overlap: the shade is their XOR'+
           (shapeEnc?', the form their sum':'')};
  }

  if(arch==='lattice'){
    const k=[2,3,3,4,5][d-1];
    const hues=shuffle(r,[0,1,2,3,4,5,6,7]).slice(0,k);
    const dir=r.f()<.5?1:-1;
    const cells=[];
    for(let y=0;y<3;y++)for(let x=0;x<3;x++)
      cells.push({shape,color:hues[((dir*(x+y))%k+k)%k],rot});
    const truth={shape,color:hues[((dir*4)%k+k)%k],rot};
    return {cells,truth,meta:{k,dir,hues,shape,rot},
      rule:'shades follow the diagonals, cycling through '+k+' hues'};
  }

  if(arch==='rotpile'){
    // iqb fix: never a bare rotation pile. The mark still quarter-turns in
    // reading order, but shades co-vary row-by-row (and drift across rows at
    // d>=4), so the answer is bound by TWO channels and never duplicates a
    // visible cell. rs+cs must avoid 0 mod 4, else cell 0 == the truth tile.
    const start=r.int(4);
    const c0=r.int(8);
    let rs,cs;
    do{ rs=d>=3?1+r.int(3):1; cs=d>=4?1+r.int(2):0; }while(((rs+cs)&3)===0);
    const cells=[];
    for(let i=0;i<9;i++){
      const y=(i/3)|0,x=i%3;
      cells.push({shape,color:(c0+rs*y+cs*x)%8,rot:(start+i)%4});
    }
    const truth={shape,color:(c0+2*rs+2*cs)%8,rot:start};
    return {cells,truth,
      meta:{start,c0,rs,cs,shape},
      rule:'every step turns the mark a quarter-turn while the shade'+
           (cs?', deepening down each row and drifting across it':', deepening row by row')};
  }

  // cluster — answer hue = count of orthogonally adjacent seeds, mod 8
  const ns=[2,3,4,5,6][d-1];
  const seeds=shuffle(r,[0,1,2,3,4,5,6,7]).slice(0,ns); // hole (8) never seeded
  const seedHue=r.int(8);
  // base offset 1..3 keeps every count hue (base..base+4) clear of seedHue
  const hueBase=(seedHue+1+r.int(3))%8;
  const has=function(i){return seeds.indexOf(i)>=0;};
  const cells=[];
  for(let i=0;i<9;i++){
    if(has(i)){cells.push({shape,color:seedHue,rot});continue;}
    const y=(i/3)|0,x=i%3;
    let c=0;
    if(x>0&&has(i-1))c++;
    if(x<2&&has(i+1))c++;
    if(y>0&&has(i-3))c++;
    if(y<2&&has(i+3))c++;
    cells.push({shape,color:(hueBase+c)%8,rot});
  }
  const cnt=(has(5)?1:0)+(has(7)?1:0);
  const truth={shape,color:(hueBase+cnt)%8,rot};
  return {cells,truth,meta:{seeds:seeds.slice().sort(function(p,q){return p-q;}),
    seedHue,hueBase,shape,rot},
    rule:'each shade counts the marked neighbours around it'};
}

// --- decoys: single-attribute mutations of the truth tile ---
function makeOptions(truth,r,d){
  const seen={};seen[jk(truth)]=1;
  const options=[truth];
  const colorW=Math.max(.4,.72-d*.06);   // easier tiers lean on obvious hue swaps
  const shapeW=(1-colorW)*.55;
  let guard=0;
  while(options.length<8&&guard++<400){
    const m={shape:truth.shape,color:truth.color,rot:truth.rot};
    const roll=r.f();
    if(roll<colorW){
      m.color=d>=4?(m.color+(r.f()<.5?1:7))%8       // subtle +/-1 at high tiers
                  :(m.color+1+r.int(7))%8;
    }else if(roll<colorW+shapeW){
      m.shape=SHAPES[(SHAPES.indexOf(m.shape)+1+r.int(SHAPES.length-1))%SHAPES.length];
    }else if(truth.shape==='triangle'){
      m.rot=(m.rot+1+r.int(3))%4;
    }else{
      m.shape=SHAPES[(SHAPES.indexOf(m.shape)+1+r.int(SHAPES.length-1))%SHAPES.length];
    }
    const key=jk(m);
    if(!seen[key]){seen[key]=1;options.push(m);}
  }
  for(let off=1;options.length<8&&off<8;off++){
    const m={shape:truth.shape,color:(truth.color+off)%8,rot:truth.rot};
    const key=jk(m);
    if(!seen[key]){seen[key]=1;options.push(m);}
  }
  const answer=r.int(8);
  const others=options.slice(1);
  others.splice(answer,0,options[0]);
  return {tiles:others.map(function(m){
    return {cols:1,rows:1,cells:[m]};
  }),answer:answer};
}

function generate(opts){
  opts=opts||{};
  const d=Math.min(5,Math.max(1,Math.floor(opts.difficulty||2)));
  const seed=(opts.seed!=null?opts.seed:(Date.now()^(Math.random()*1e9)))>>>0;
  const r=new Rng(seed);
  const arch=ARCHS[r.int(ARCHS.length)];
  const built=build(arch,d,r);
  built.cells[8]=null;                        // hole: bottom-right
  const made=makeOptions(built.truth,r,d);
  return {
    id:'logicA-'+arch+'-d'+d+'-'+seed.toString(36),
    kind:'matrix',
    difficulty:d,
    prompt:r.pick(PROMPTS),
    rule:built.rule,
    board:{cols:3,rows:3,cells:built.cells,holeIndex:8},
    options:made.tiles,
    answer:made.answer,
    meta:Object.assign({arch:arch},built.meta)
  };
}

// --- rule re-derivation (used by selfTest; also handy for host-side audits) ---
function expectCell(m,i){
  const y=(i/3)|0,x=i%3;
  switch(m.arch){
    case 'chain':
      return {shape:m.list[(m.base+m.rs*y+x)%m.list.length],color:m.color,rot:m.rot};
    case 'xor':
      return {shape:m.shapeEnc?SHAPES[(m.a[y]+m.b[x])%SHAPES.length]:m.shape,
              color:m.a[y]^m.b[x],rot:m.rot};
    case 'lattice':
      return {shape:m.shape,color:m.hues[((m.dir*(x+y))%m.k+m.k)%m.k],rot:m.rot};
    case 'rotpile':
      return {shape:m.shape,color:(m.c0+m.rs*(((i/3)|0))+m.cs*(i%3))%8,
              rot:(m.start+i)%4};
    case 'cluster':{
      const has=function(v){return m.seeds.indexOf(v)>=0;};
      if(has(i))return {shape:m.shape,color:m.seedHue,rot:m.rot};
      let c=0;
      if(x>0&&has(i-1))c++;
      if(x<2&&has(i+1))c++;
      if(y>0&&has(i-3))c++;
      if(y<2&&has(i+3))c++;
      return {shape:m.shape,color:(m.hueBase+c)%8,rot:m.rot};
    }
  }
  return null;
}

function validate(p){
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
    for(let i=0;i<8;i++){
      const c=cells[i];
      if(!c||typeof c.shape!=='string'||!Number.isInteger(c.color)||
         c.color<0||c.color>7||!Number.isInteger(c.rot)||c.rot<0||c.rot>3)
        errors.push('malformed cell at '+i);
    }
  }
  if(!Array.isArray(p.options)||p.options.length!==8)errors.push('options must hold exactly 8 tiles');
  else{
    const seen=new Set();
    p.options.forEach(function(o,i){
      const c=o&&Array.isArray(o.cells)&&o.cells.length===1?o.cells[0]:null;
      if(!c||typeof c.shape!=='string'||!Number.isInteger(c.color)||
         c.color<0||c.color>7||!Number.isInteger(c.rot)||c.rot<0||c.rot>3){
        errors.push('malformed option tile '+i);return;
      }
      const key=jk(c);
      if(seen.has(key))errors.push('duplicate option at '+i);
      seen.add(key);
    });
  }
  if(!Number.isInteger(p.answer)||p.answer<0||p.answer>7)errors.push('answer must index 0..7');
  return {ok:errors.length===0,errors:errors};
}

function explain(p){return (p&&p.rule)||'';}

// --- behavioral self-test: every (seed, difficulty) pair must validate,
// reproduce byte-identically, obey its stated rule, and carry exactly one
// correct option at the declared answer index. ---
function selfTest(rounds){
  rounds=rounds||50;
  const errors=[];
  const stats={checked:0,byArch:{},byDiff:{}};
  for(let seed=1;seed<=rounds;seed++){
    for(let d=1;d<=5;d++){
      const s=(seed*7919+d*104729)>>>0;
      const p=generate({difficulty:d,seed:s});
      const tag='seed '+s+' d'+d+' ['+(p.meta&&p.meta.arch)+']';
      const v=validate(p);
      if(!v.ok){errors.push(tag+' validate: '+v.errors.join('; '));continue;}
      if(jk(generate({difficulty:d,seed:s}))!==jk(p)){
        errors.push(tag+' not deterministic');continue;
      }
      const m=p.meta;
      if(!m||ARCHS.indexOf(m.arch)<0){errors.push(tag+' missing meta');continue;}
      let broke=null;
      for(let i=0;i<8;i++){
        if(jk(p.board.cells[i])!==jk(expectCell(m,i))){broke='cell '+i+' breaks its rule';break;}
      }
      if(broke){errors.push(tag+' '+broke);continue;}
      const truth=expectCell(m,8);
      const hits=p.options.filter(function(o){return jk(o.cells[0])===jk(truth);});
      if(hits.length!==1){errors.push(tag+' true fragment appears '+hits.length+'x');continue;}
      if(jk(p.options[p.answer].cells[0])!==jk(truth)){
        errors.push(tag+' answer index does not point at the true fragment');continue;
      }
      stats.checked++;
      stats.byArch[m.arch]=(stats.byArch[m.arch]||0)+1;
      stats.byDiff[d]=(stats.byDiff[d]||0)+1;
    }
  }
  return {ok:errors.length===0,errors:errors.slice(0,20),checked:stats.checked,stats:stats};
}

const api={name:'logicA',generate:generate,validate:validate,explain:explain,selfTest:selfTest};
root.IQ.Gens.logicA=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(typeof require!=='undefined'&&typeof module!=='undefined'&&require.main===module){
  console.log(JSON.stringify(selfTest(50)));
}
})();
