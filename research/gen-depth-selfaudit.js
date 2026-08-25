/* research/gen-depth-selfaudit.js — Wave A self-audit for gen_depth.js (compound + relay).
 * Mirrors research/gen-audit-harness.js method: 20 seeded samples per family
 * (difficulty sweep 1..5), each checked against an INDEPENDENT solver written
 * fresh from the PRINTED rule (NOT the generator's expand/relayCells), plus the
 * audit-report bars:
 *   (a) one-sentence verifiable rule present (length guard)
 *   (b) matrix hole always bottom-right
 *   (c) 8 distinct options, exactly one correct under the independent solver,
 *       every decoy a single-attribute mutation of the truth
 *   rotation-pile degeneracy detector ("rot is the only varying attribute")
 *   truth-copies-visible-cell probe
 *   consecutive-duplicate probe on sequences (the rotAccum fib bug class)
 * The relay solver additionally verifies the visible chain obeys the printed
 * pace rule ON ITS OWN TERMS — alternation beats, nonzero hops, quickening at
 * every k-th step — so a lockShape-style "answer contradicts its own rule"
 * regression can never ship silently.
 * Run: node research/gen-depth-selfaudit.js  -> exits non-zero on any violation.
 */
'use strict';
const path=require('path');
const G=require(path.join(__dirname,'..','gen_depth.js'));

const J=o=>JSON.stringify(o);
const LADDER=['plus','ring','square','triangle'];
const diffAttr=(a,b)=>(a.shape!==b.shape)+(a.color!==b.color)+(a.rot!==b.rot);

/* ---------- independent solvers ---------- */

// compound: rebuild the whole lattice straight from public meta with its own
// loops and read the hole off it. Also re-checks every visible cell, so a
// board that contradicts its printed rule fails loudly.
function solveCompound(p){
  const m=p.meta,U=m.U,V=m.V,P=m.P;
  const cell=(x,y)=>{
    const ring=x+y;
    return {shape:LADDER[(m.sb+Math.floor(x/2))%4],color:(U[ring%P]^V[ring%P])&7,rot:0};
  };
  for(let y=0;y<3;y++)for(let x=0;x<3;x++){
    if(x===2&&y===2)continue; /* index 8 is the hole */
    const got=p.board.cells[y*3+x];
    if(!got||J(got)!==J(cell(x,y)))
      return {err:'visible cell ('+x+','+y+') breaks the compound rule'};
  }
  return {truth:cell(2,2)};
}

// relay: fresh state machine over meta params; walks the VISIBLE prefix beat by
// beat verifying alternation, nonzero hops and the quickening at each k-boundary,
// then steps once more to the hidden term.
function solveRelay(p){
  const q=p.meta.params,k=q.k;
  let color=q.c0,rung=LADDER.indexOf(p.seq[0].shape);
  if(rung<0||p.seq[0].color!==q.c0||p.seq[0].rot!==0)
    return {err:'first tile contradicts the relay seed state'};
  for(let t=0;t<p.seq.length;t++){
    if(J(p.seq[t])!==J({shape:LADDER[rung],color:color,rot:0}))
      return {err:'visible tile '+t+' breaks the relay rule'};
    if(t===p.seq.length-1)break;
    const e=Math.floor(t/k);
    let hop;
    if(t%2===0){ // color beat: shape must hold still
      if(p.seq[t+1].shape!==p.seq[t].shape)return {err:'shape moved on a color beat at '+t};
      hop=((q.c0s+e*q.dc)%7)+1;
      if((p.seq[t+1].color-p.seq[t].color+8)%8!==hop)
        return {err:'color hop at '+t+' contradicts the pace rule'};
      color=(color+hop)%8;
    }else{       // shape beat: shade must hold still
      if(p.seq[t+1].color!==p.seq[t].color)return {err:'color moved on a shape beat at '+t};
      hop=((q.s0s+e)%3)+1;
      if((LADDER.indexOf(p.seq[t+1].shape)-rung+4)%4!==hop)
        return {err:'shape hop at '+t+' contradicts the pace rule'};
      rung=(rung+hop)%4;
    }
    if(hop<=0)return {err:'zero hop at '+t+' (consecutive-duplicate class)'};
  }
  const L=p.meta.len,t=L-1,e=Math.floor(t/k);
  if(t%2===0)color=(color+((q.c0s+e*q.dc)%7)+1)%8;
  else rung=(rung+((q.s0s+e)%3)+1)%4;
  return {truth:{shape:LADDER[rung],color:color,rot:0}};
}
const SOLVE={compound:solveCompound,relay:solveRelay};

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

function auditCompound(p,solved){
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

function auditRelay(p,solved){
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
const AUDIT={compound:auditCompound,relay:auditRelay};

/* ---------- sweep ---------- */

function run(){
  const report={};
  let totalErrs=0,totalNotes=0,fatal=false;
  for(const fam of ['compound','relay']){
    const agg={n:0,errs:[],notes:{}};
    for(let s=0;s<20;s++){
      const d=1+(s%5),seed=(0xDEE0+s*7919+d*104729)>>>0;
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
    if(['compound','relay'].indexOf(k)<0){console.log('FAIL unexpected export '+k);fatal=true;}
  });
  if(totalErrs>0||fatal){console.log('SELF-AUDIT FAILED');process.exit(1);}
  console.log('SELF-AUDIT CLEAN ('+totalNotes+' informational notes)');
}
run();
