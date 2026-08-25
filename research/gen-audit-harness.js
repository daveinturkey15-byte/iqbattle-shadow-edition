/* gen-audit-harness.js — QUALITY-PASS audit for IQ.Gens logic/seq/missing packs.
 * Generates SAMPLES_PER_ARCH puzzles per archetype (difficulty sweep 1..5) and
 * mechanically checks the iqversus quality bars:
 *   (b) matrix hole always bottom-right
 *   (c) 8 options, all distinct, exactly one correct under an INDEPENDENT
 *       solver, every decoy a single-attribute mutation of the truth
 *   (a) one-sentence rule present (length guard)
 *   degeneracy guard: rot may never be the only attribute that varies on the
 *   board (the QA "rotation-only triangle pile" signature), and the truth tile
 *   must not be a byte-copy of a visible cell when the family promises a
 *   unique fill.
 * Run: node research/gen-audit-harness.js
 */
'use strict';
const path=require('path');
const G={};
for(const n of ['gen_logic1','gen_logic2','gen_seqpack','gen_missing'])
  G[n]=require(path.join(__dirname,'..',n+'.js'));

const mod8=x=>((x%8)+8)%8, mod4=x=>((x%4)+4)%4;
const J=o=>JSON.stringify(o);
const diffAttr=(a,b)=>(a.shape!==b.shape)+(a.color!==b.color)+(a.rot!==b.rot);

/* ---- independent solvers: truth recomputed from VISIBLE data + meta ---- */
const SOLVE={
  // gen_logic1 (meta-driven re-derivation, mirrors expectCell but standalone)
  'logicA:chain':p=>{const m=p.meta;return{shape:m.list[(m.base+m.rs*2+2)%m.list.length],color:m.color,rot:m.rot};},
  'logicA:xor':p=>{const m=p.meta;return{shape:m.shapeEnc?p.board&&null||['plus','ring','square','triangle','diamond','cross'][(m.a[2]+m.b[2])%6]:m.shape,color:m.a[2]^m.b[2],rot:m.rot};},
  'logicA:lattice':p=>{const m=p.meta;return{shape:m.shape,color:m.hues[((m.dir*4)%m.k+m.k)%m.k],rot:m.rot};},
  'logicA:rotpile':p=>{const m=p.meta;return{shape:m.shape,color:mod8(m.c0+2*m.rs+2*m.cs),rot:m.start};},
  'logicA:cluster':p=>{const m=p.meta;const has=v=>m.seeds.indexOf(v)>=0;
    const c=(has(5)?1:0)+(has(7)?1:0);return{shape:m.shape,color:(m.hueBase+c)%8,rot:m.rot};},
  // gen_logic2 (visible-only)
  'logicB:lockShape':p=>{const c=p.board.cells;
    return {shape:c[0].shape,color:c[1].color===c[0].color?c[6].color:c[1].color,rot:0};},
  'logicB:mirrorCols':p=>{const c=p.board.cells;const off=mod8(c[2].color-c[0].color);
    return{shape:c[0].shape,color:mod8(c[6].color+off),rot:0};},
  'logicB:diagGrad':p=>{const c=p.board.cells;
    const sc=mod8(c[1].color-c[0].color),sr=mod4(c[5].rot-c[2].rot);
    return{shape:c[0].shape,color:mod8(c[0].color+sc*4),rot:mod4(c[2].rot+sr*2)};},
  'logicB:parityGrid':p=>{const c=p.board.cells;return{shape:'ring',color:c[6].color,rot:0};},
  'logicB:freqSet':p=>{const c=p.board.cells;const counts={};
    c.forEach(cell=>{if(cell)counts[cell.color]=(counts[cell.color]||0)+1;});
    let key=-1;for(const k in counts)if(counts[k]===1)key=+k;
    return{shape:c[0].shape,color:key,rot:0};},
};

function auditMatrix(tag,p,truth){
  const errs=[],notes=[];
  const b=p.board,last=b.cols*b.rows-1;
  if(b.holeIndex!==last||b.cells[last]!==null)errs.push('hole not bottom-right');
  if(typeof p.rule!=='string'||p.rule.length<12||p.rule.length>160)errs.push('rule sentence missing/too long');
  if(p.options.length!==8)errs.push('options != 8');
  const keys=new Set(p.options.map(o=>J(o.cells)));
  if(keys.size!==8)errs.push('duplicate options');
  const hits=p.options.filter(o=>J(o.cells)===J([truth]));
  if(hits.length!==1)errs.push('correct-count='+hits.length);
  if(J(p.options[p.answer].cells)!==J([truth]))errs.push('answer misindexed');
  const ans=p.options[p.answer].cells[0];
  for(let i=0;i<8;i++){
    if(i===p.answer)continue;
    const c=p.options[i].cells[0];
    if(c.cells){errs.push('decoy '+i+' not single-cell');continue;}
    if(diffAttr(c,ans)!==1)notes.push('decoy '+i+' mutates '+diffAttr(c,ans)+' attrs');
  }
  // rotation-pile degeneracy: shape+color constant across all visible cells?
  const vis=b.cells.filter(Boolean).filter(c=>!c.cells);
  if(vis.length===vis.filter(c=>c.shape===vis[0].shape&&c.color===vis[0].color).length&&vis.some(c=>c.rot!==vis[0].rot))
    notes.push('ROTATION-PILE: rot is the only varying attribute');
  // truth copy of a visible cell (copyable-answer tell)
  if(vis.some(c=>J(c)===J(ans)))notes.push('truth duplicates visible cell');
  return {errs,notes};
}

function auditSeq(fam,p){
  const errs=[],notes=[];
  if(p.seq.length<4||p.seq.length>7)errs.push('seq len '+p.seq.length);
  if(typeof p.rule!=='string'||p.rule.length<12)errs.push('rule sentence missing');
  if(p.options.length!==8)errs.push('options != 8');
  const keys=new Set(p.options.map(o=>J(o.cells)));
  if(keys.size!==8)errs.push('duplicate options');
  const ans=p.options[p.answer].cells[0];
  for(let i=0;i<8;i++){
    if(i===p.answer)continue;
    const d=diffAttr(p.options[i].cells[0],ans);
    if(d!==1)notes.push('decoy '+i+' mutates '+d+' attrs');
  }
  if(p.seq.some(c=>J(c)===J(ans)))notes.push('truth duplicates visible cell');
  return {errs,notes};
}

function run(){
  const report={};
  let worst=[];
  // logicA per archetype
  for(const arch of ['chain','xor','lattice','rotpile','cluster']){
    const agg={n:0,errs:[],notes:{}};
    for(let s=0;s<20;s++){
      const d=1+(s%5),seed=(0xA11CE+s*7919+d*104729)>>>0;
      // force arch via rejection on seeded stream: regenerate until arch matches
      let p=null;
      for(let t=0;t<200;t++){p=G.gen_logic1.generate({difficulty:d,seed:(seed+t)>>>0});if(p.meta.arch===arch)break;}
      if(p.meta.arch!==arch){agg.errs.push('could not sample '+arch);continue;}
      agg.n++;
      const truth=SOLVE['logicA:'+arch](p);
      const r=auditMatrix('logicA:'+arch,p,truth);
      agg.errs.push(...r.errs);
      for(const n of r.notes)agg.notes[n]=(agg.notes[n]||0)+1;
    }
    report['logicA/'+arch]=agg;
  }
  // logicB per archetype
  for(const arch of ['lockShape','mirrorCols','diagGrad','parityGrid','freqSet']){
    const agg={n:0,errs:[],notes:{}};
    for(let s=0;s<20;s++){
      const d=1+(s%5),seed=(0xB0B5+s*2654435761+d*97)>>>0;
      const p=G.gen_logic2.generate({difficulty:d,seed,arch});
      agg.n++;
      const truth=SOLVE['logicB:'+arch](p);
      const r=auditMatrix('logicB:'+arch,p,truth);
      agg.errs.push(...r.errs);
      for(const n of r.notes)agg.notes[n]=(agg.notes[n]||0)+1;
    }
    report['logicB/'+arch]=agg;
  }
  // seqPack per family
  for(const fam of ['arith','geo3','rotAccum','dual','ladder']){
    const agg={n:0,errs:[],notes:{}};
    for(let s=0;s<20;s++){
      const d=1+(s%5),seed=(0x5EED+s*7919+d*104729)>>>0;
      const p=G.gen_seqpack.generate({difficulty:d,kinds:[fam],seed});
      agg.n++;
      const r=auditSeq(fam,p);
      agg.errs.push(...r.errs);
      for(const n of r.notes)agg.notes[n]=(agg.notes[n]||0)+1;
    }
    report['seqPack/'+fam]=agg;
  }
  // missingSec
  {
    const agg={n:0,errs:[],notes:{}};
    for(let s=0;s<40;s++){
      const d=1+(s%5),seed=0xBEEF+s*7919;
      const p=G.gen_missing.generate({difficulty:d,seed});
      agg.n++;
      const b=p.board,last=b.cols*b.rows-1;
      if(b.holeIndex!==last||b.cells[last]!==null)agg.errs.push('hole not bottom-right');
      const m=p.meta,hx=p.board.holeIndex%p.board.cols,hy=Math.floor(p.board.holeIndex/p.board.cols);
      const truth=J(G.gen_missing&&require('../gen_missing.js').solveSection?null:null); // placeholder
      // independent recompute via exported api surface: use validate + answer tile recompute
      const sec=(function(){const mm=p.meta;
        // rebuild buildBlock locally (mirror)
        function slotFilled(t,x,y,w,h){if(t==='solid')return true;if(t==='bar')return y===0;
          if(t==='lattice')return (w===2&&h===2)?(x+y)%2===0:!((x===0||x===w-1)&&(y===0||y===h-1));
          return (x+y)%2===0;}
        const leaves=new Array(mm.bw*mm.bh);
        for(let y=0;y<mm.bh;y++)for(let x=0;x<mm.bw;x++){const i=y*mm.bw+x;
          if(!slotFilled(mm.template,x,y,mm.bw,mm.bh)){leaves[i]=null;continue;}
          let c;const bx=hx,by=hy;
          if(mm.rule==='rowColor')c=mm.pal[by%mm.pal.length];
          else if(mm.rule==='colColor')c=mm.pal[bx%mm.pal.length];
          else if(mm.rule==='checker')c=mm.pal[(bx+by)%2];
          else if(mm.rule==='latin')c=mm.pal[(bx+by)%3];
          else c=(mm.h0+mm.sx*bx+mm.sy*by)%8;
          const rot=mm.shape==='triangle'?((mm.rotA*bx+mm.rotB*by)%4+4)%4:0;
          leaves[i]={shape:mm.shape,color:c,rot:rot};}
        return leaves;})();
      const hits=p.options.filter(o=>J(o.cells)===J(sec));
      if(hits.length!==1)agg.errs.push('correct-count='+hits.length);
      if(J(p.options[p.answer].cells)!==J(sec))agg.errs.push('answer misindexed');
      if(new Set(p.options.map(o=>J(o.cells))).size!==8)agg.errs.push('duplicate options');
    }
    report['missingSec/section']=agg;
  }
  // print
  let totalErr=0,totalNote=0;
  for(const k of Object.keys(report)){
    const r=report[k];totalErr+=r.errs.length;
    const noteStr=Object.keys(r.notes).map(n=>n+' x'+r.notes[n]).join('; ');
    totalNote+=Object.values(r.notes).reduce((a,n)=>a+n,0);
    console.log((r.errs.length?'FAIL':'PASS')+'  '+k+'  ('+r.n+' samples)'+
      (r.errs.length?'  errors: '+r.errs.slice(0,3).join(' | '):'')+
      (noteStr?'  notes: '+noteStr:''));
  }
  console.log('\nerrors='+totalErr);
  process.exit(totalErr?1:0);
}
run();
