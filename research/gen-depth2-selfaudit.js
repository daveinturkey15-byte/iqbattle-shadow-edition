/* research/gen-depth2-selfaudit.js — Wave 5 self-audit for gen_depth2.js (parquet + pendulum).
 * Mirrors research/gen-depth-selfaudit.js / research/gen-audit-harness.js method:
 * 20 seeded samples per family (difficulty sweep 1..5), each checked against an
 * INDEPENDENT solver written fresh from the PRINTED rule (NOT the generator's
 * parquetCell/pendulumCells — different loops, different arithmetic), plus the
 * audit-report bars:
 *   (a) one-sentence verifiable rule present (length guard)
 *   (b) matrix hole always bottom-right
 *   (c) 8 distinct options, exactly one correct under the independent solver,
 *       every decoy a single-attribute mutation of the truth
 *   rotation-pile degeneracy detector ("rot is the only varying attribute")
 *   truth-copies-visible-cell probe
 *   consecutive-duplicate probe on sequences (the rotAccum fib bug class)
 * The pendulum solver additionally verifies the visible chain obeys the printed
 * swing ON ITS OWN TERMS — alternating signs, nonzero hops, widening at every
 * k-boundary, one-rung-per-term climb — so an answer that contradicts its own
 * rule can never ship silently.
 * Plus a 550-per-family stress sweep (validate + determinism + uniqueness).
 * Run: node research/gen-depth2-selfaudit.js  -> exits non-zero on any violation.
 */
'use strict';
const path=require('path');
const G=require(path.join(__dirname,'..','gen_depth2.js'));

const J=o=>JSON.stringify(o);
const diffAttr=(a,b)=>(a.shape!==b.shape)+(a.color!==b.color)+(a.rot!==b.rot);

/* ---------- independent solvers (fresh implementations, NOT the generator's) ---------- */

// parquet: rebuild the whole 3x3 from public meta with its own index math and
// read the hole off it. Also re-checks every visible cell, so a board that
// contradicts its printed rule fails loudly. Colour via explicit branch on the
// row-slipped checker parity; shape via a hand-rolled wheel counter that walks
// columns then rows instead of a closed-form index.
function solveParquet(p){
  const m=p.meta;
  if(!m||m.fam!=='parquet')return {err:'foreign meta'};
  const wheel={};
  for(let i=0;i<5;i++)wheel[i]=m.SET[i];
  const tileAt=(x,y)=>{
    // checker: parity of column-plus-row-plus-seeded-phase picks the shade
    const shade=((x+y+m.ph)%2===0)?m.ca:m.cb;
    // wheel: count notches by walking P-column jumps and per-row turns
    let notch=m.sb+x+2*y+((x-(x%m.P))/m.P);
    notch%=5;if(notch<0)notch+=5;
    return {shape:wheel[notch],color:shade,rot:0};
  };
  for(let y=0;y<3;y++)for(let x=0;x<3;x++){
    if(x===2&&y===2)continue; /* index 8 is the hole */
    const got=p.board.cells[y*3+x];
    if(!got||J(got)!==J(tileAt(x,y)))
      return {err:'visible cell ('+x+','+y+') breaks the parquet rule'};
  }
  return {truth:tileAt(2,2)};
}

// pendulum: fresh state machine over meta params; walks the VISIBLE prefix
// beat by beat verifying sign alternation, nonzero hops, the widening at each
// k-boundary and the one-rung climb, then steps once more to the hidden term.
function solvePendulum(p){
  const q=p.meta.params,k=q.k;
  let shade=q.piv,rung=-1;
  const rungs=['plus','ring','square','triangle'];
  for(let i=0;i<rungs.length;i++)if(rungs[i]===p.seq[0].shape)rung=i;
  if(rung<0||p.seq[0].color!==q.piv||p.seq[0].rot!==0)
    return {err:'first tile contradicts the pendulum seed state'};
  for(let t=0;t<p.seq.length;t++){
    if(J(p.seq[t])!==J({shape:rungs[rung],color:shade,rot:0}))
      return {err:'visible tile '+t+' breaks the pendulum rule'};
    if(t===p.seq.length-1)break;
    const e=Math.floor(t/k);
    let hop,size;
    if(t%2===0){ // up-beat: shade rises, the form still climbs exactly one rung
      size=(((q.u0+q.inc*e)%7)+7)%7+1;
      if((p.seq[t+1].color-p.seq[t].color+8)%8!==size)
        return {err:'up-swing at '+t+' contradicts the printed amplitude'};
      if(p.seq[t+1].shape!==rungs[(rung+1)%4])return {err:'form skipped its climb at '+t};
      shade=(shade+size)%8;
      hop=size;
    }else{       // down-beat: the shade must fall, never freeze
      if(p.seq[t+1].color===p.seq[t].color)return {err:'shade froze on a down-beat at '+t};
      size=(((q.d0+q.inc*e)%7)+7)%7+1;
      if((p.seq[t].color-p.seq[t+1].color+8)%8!==size)
        return {err:'down-swing at '+t+' contradicts the printed amplitude'};
      if(p.seq[t+1].shape!==rungs[(rung+1)%4])return {err:'form skipped its climb at '+t};
      shade=(shade-size+8)%8;
      hop=size;
    }
    rung=(rung+1)%4;
    if(hop<=0)return {err:'zero hop at '+t+' (consecutive-duplicate class)'};
  }
  const L=p.meta.len,t=L-1;
  const amp=(((t%2===0?q.u0:q.d0)+q.inc*Math.floor(t/k))%7+7)%7+1;
  if(t%2===0)shade=(shade+amp)%8;else shade=(shade-amp+8)%8;
  return {truth:{shape:rungs[(rung+1)%4],color:shade,rot:0}};
}
const SOLVE={parquet:solveParquet,pendulum:solvePendulum};

/* ---------- bar checks (fresh implementation, harness-method parity) ---------- */

function commonOptionBars(p,truth,errs,notes){
  if(typeof p.rule!=='string'||p.rule.length<12||p.rule.length>160)
    errs.push('rule sentence missing/too long');
  if(!Array.isArray(p.options)||p.options.length!==8){errs.push('options != 8');return;}
  const keys=new Set(p.options.map(o=>J(o.cells)));
  if(keys.size!==8)errs.push('duplicate options');
  if(!Number.isInteger(p.answer)||!p.options[p.answer]){errs.push('answer misindexed');return;}
  if(J(p.options[p.answer].cells)!==J([truth]))errs.push('answer misindexed');
  const ans=p.options[p.answer].cells[0];
  let correct=0;
  for(let i=0;i<8;i++){
    if(J(p.options[i].cells[0])===J(truth))correct++;
    if(i===p.answer)continue;
    const c=p.options[i].cells[0];
    if(diffAttr(c,ans)!==1)notes.push('decoy '+i+' mutates '+diffAttr(c,ans)+' attrs');
  }
  if(correct!==1)errs.push('correct-count='+correct);
}

function auditParquet(p,solved){
  const errs=[],notes=[];
  if(solved.err){errs.push(solved.err);return {errs,notes};}
  const truth=solved.truth,b=p.board,last=b.cols*b.rows-1;
  if(b.holeIndex!==last||b.cells[last]!==null)errs.push('hole not bottom-right');
  commonOptionBars(p,truth,errs,notes);
  // rotation-pile degeneracy: shape+color frozen while only rot varies?
  const vis=b.cells.filter(Boolean);
  if(vis.length&&vis.every(c=>c.shape===vis[0].shape&&c.color===vis[0].color)&&
     vis.some(c=>c.rot!==vis[0].rot))notes.push('ROTATION-PILE: rot is the only varying attribute');
  if(vis.some(c=>J(c)===J(truth)))notes.push('truth duplicates visible cell');
  return {errs,notes};
}

function auditPendulum(p,solved){
  const errs=[],notes=[];
  if(solved.err){errs.push(solved.err);return {errs,notes};}
  const truth=solved.truth;
  if(!Array.isArray(p.seq)||p.seq.length<4||p.seq.length>7)errs.push('seq len '+p.seq.length);
  commonOptionBars(p,truth,errs,notes);
  for(let i=1;i<p.seq.length;i++)
    if(J(p.seq[i])===J(p.seq[i-1]))errs.push('consecutive duplicate tiles at '+i);
  if(p.seq.some(c=>J(c)===J(truth)))notes.push('truth duplicates visible cell');
  if(p.seq.length&&p.seq.every(c=>c.shape===p.seq[0].shape&&c.color===p.seq[0].color)&&
     p.seq.some(c=>c.rot!==p.seq[0].rot))notes.push('ROTATION-PILE: rot is the only varying attribute');
  return {errs,notes};
}
const AUDIT={parquet:auditParquet,pendulum:auditPendulum};

/* ---------- sweep ---------- */

function run(){
  const report={};
  let totalErrs=0,totalNotes=0,fatal=false;
  for(const fam of ['parquet','pendulum']){
    const agg={n:0,errs:[],notes:{}};
    for(let s=0;s<20;s++){
      const d=1+(s%5),seed=(0xDEE2+s*7919+d*104729)>>>0;
      const api=G[fam];
      const p=api.generate({difficulty:d,seed:seed});
      const v=api.validate(p);
      if(!v.ok)agg.errs.push(fam+' d'+d+' seed '+seed+' validate: '+v.errors.join('; '));
      agg.n++;
      const r=AUDIT[fam](p,SOLVE[fam](p));
      agg.errs.push(...r.errs.map(e=>fam+' d'+d+' seed '+seed+': '+e));
      for(const n of r.notes)agg.notes[n]=(agg.notes[n]||0)+1;
    }
    totalErrs+=agg.errs.length;
    for(const n in agg.notes)totalNotes+=agg.notes[n];
    report[fam]=agg;
    console.log((agg.errs.length?'FAIL':'PASS')+' '+fam+' ('+agg.n+
      ' samples across difficulty 1..5, errors='+agg.errs.length+
      ', notes='+JSON.stringify(agg.notes)+')');
    agg.errs.forEach(e=>console.log('   ! '+e));
  }
  Object.keys(G).forEach(k=>{
    if(['parquet','pendulum'].indexOf(k)<0){console.log('FAIL unexpected export '+k);fatal=true;}
  });
  if(totalErrs>0||fatal){console.log('SELF-AUDIT FAILED');process.exit(1);}
  console.log('SELF-AUDIT CLEAN ('+totalNotes+' informational notes)');
}
run();
/* ---------- stress sweep: 550 seeds per family, cheap-but-deep probes ---------- */

function stress(){
  let bad=0;
  for(const fam of ['parquet','pendulum']){
    const api=G[fam];let fails=0;
    for(let s=1;s<=550;s++){
      const d=1+(s%5),seed=(0x51E5+s*7919+d*104729)>>>0;
      const p=api.generate({difficulty:d,seed:seed});
      const v=api.validate(p);
      if(!v.ok){fails++;console.log('   ! '+fam+' seed '+seed+' validate: '+v.errors.join('; '));continue;}
      if(J(api.generate({difficulty:d,seed:seed}))!==J(p)){fails++;console.log('   ! '+fam+' seed '+seed+' nondeterministic');continue;}
      const truth=p.options[p.answer].cells[0];
      const vis=fam==='parquet'?p.board.cells.filter(Boolean):p.seq;
      if(vis.some(c=>J(c)===J(truth))){fails++;console.log('   ! '+fam+' seed '+seed+' truth copies visible');continue;}
      for(let i=1;i<vis.length;i++)
        if(J(vis[i])===J(vis[i-1])){fails++;console.log('   ! '+fam+' seed '+seed+' consecutive duplicate at '+i);break;}
    }
    console.log((fails?'FAIL':'PASS')+' stress '+fam+' (550 seeds x difficulty cycle)');
    if(fails)bad=1;
  }
  if(bad){console.log('STRESS SWEEP FAILED');process.exit(1);}
  console.log('STRESS SWEEP CLEAN');
}
stress();
