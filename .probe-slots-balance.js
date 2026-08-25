/* .probe-slots-balance.js — EV verification for modes/slots.js ONE-ARMED GOD.
 * Simulates the exact engine funnel (index.html applyStageResult): takeover
 * parity cap min(points,100*diff+60), points clamp [-200,500], neutral ladder
 * avoided by design (correct=true whenever the god paid anything), shutout
 * rounds cost the engine's wrong baseline -(10+10*diff).
 * Band: expected payout must land in [60%,135%] of puzzle payout (100*diff+40)
 * at every diff. Run: node .probe-slots-balance.js  (exit 1 = out of band)
 */
'use strict';
const STRIP_LEN = 20;
const SKULL_DIST = [[0,0,0],[0,0,1],[0,1,1],[1,1,2],[1,2,2]];
const BASE = [
  { eye: 7, moon: 6, key: 4, crown: 3 },
  { eye: 6, moon: 5, key: 5, crown: 4 },
  { eye: 6, moon: 6, key: 4, crown: 4 }
];
/* ---- tables under test (must mirror modes/slots.js) ---- */
const T = {
  stakes:  [20, 30, 40, 50, 60],
  pairPay: [45, 80, 130, 190, 260],
  triple: [
    {eye: 95,  moon: 125, key: 160,  crown: 260},
    {eye: 180, moon: 240, key: 320,  crown: 520},
    {eye: 280, moon: 370, key: 500,  crown: 800},
    {eye: 430, moon: 570, key: 760,  crown: 1200},
    {eye: 520, moon: 690, key: 920,  crown: 1450}
  ],
  jackpot: [600, 900, 1300, 1800, 2300]
};

function mulberry32(a){return function(){a|=0;a=(a+0x6D2B79F5)|0;var t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}}
function buildStrip(comp){const arr=[];for(const s in comp)for(let k=0;k<comp[s];k++)arr.push(s);return arr}

function linePayout(line,pairPay,triple,jackpot){
  let stars=0,skull=false;const rest={};
  for(const s of line){if(s==='skull')skull=true;else if(s==='star')stars++;else rest[s]=(rest[s]||0)+1}
  if(skull)return 0;
  if(stars===3)return jackpot;
  let bestN=0,bestSym=null;
  for(const sym in rest)if(rest[sym]>bestN){bestN=rest[sym];bestSym=sym}
  if(bestSym===null)return 0;
  if(bestN+stars>=3)return triple[bestSym];
  if(bestN+stars===2)return pairPay;
  return 0;
}
function spinHist(strips,pairPay,triple,jackpot){
  const h=new Map();
  for(let a=0;a<20;a++)for(let b=0;b<20;b++)for(let c=0;c<20;c++){
    const p=linePayout([strips[0][a],strips[1][b],strips[2][c]],pairPay,triple,jackpot);
    h.set(p,(h.get(p)||0)+1/8000);
  }
  return h;
}
function sampleStrips(diff,wantStar,rng){
  const dist=SKULL_DIST[diff-1],strips=[];
  for(let r=0;r<3;r++){
    const arr=buildStrip(BASE[r]);
    for(let s=0;s<dist[r];s++)arr[(rng()*arr.length)|0]='skull';
    if(wantStar)arr[(rng()*arr.length)|0]='star';
    for(let i=arr.length-1;i>0;i--){const j=(rng()*(i+1))|0;const t=arr[i];arr[i]=arr[j];arr[j]=t}
    while(arr.length>STRIP_LEN)arr.pop();
    while(arr.length<STRIP_LEN)arr.push('eye');
    strips.push(arr);
  }
  return strips;
}

let bad=0;
for(let diff=1;diff<=5;diff++){
  const rngN=mulberry32(7000+diff), rngS=mulberry32(9000+diff);
  const WGOOD=1/6; /* align cadence ~5:1 bad:good (w1-contracts C2) */
  const comb=new Map();
  for(const [p,q] of spinHist(sampleStrips(diff,false,rngN),T.pairPay[diff-1],T.triple[diff-1],T.jackpot[diff-1]))
    comb.set(p,(comb.get(p)||0)+q*(1-WGOOD));
  for(const [p,q] of spinHist(sampleStrips(diff,true,rngS),T.pairPay[diff-1],T.triple[diff-1],T.jackpot[diff-1]))
    comb.set(p,(comb.get(p)||0)+q*WGOOD);
  const entries=[...comb.entries()];
  let dist=new Map([[0,1]]);
  for(let sp=0;sp<3;sp++){
    const mul=(sp===2&&diff>=5)?2:1, next=new Map();
    for(const [t,qt] of dist)for(const [p,q] of entries){
      const k=t+p*mul;next.set(k,(next.get(k)||0)+qt*q);
    }
    dist=next;
  }
  const puzzle=100*diff+40, lo=.6*puzzle, hi=1.35*puzzle, cap=puzzle+20;
  let rawEV=0,awardedEV=0,pBleed=0;
  for(const [tot,q] of dist){
    rawEV+=tot*q;
    awardedEV+=(tot>0?Math.min(cap,Math.max(0,Math.min(500,Math.round(tot)))):-(10+10*diff))*q;
    if(tot===0)pBleed+=q;
  }
  const pct=100*awardedEV/puzzle;
  const inBand=awardedEV>=lo&&awardedEV<=hi;
  if(!inBand)bad++;
  console.log(`diff${diff}: rawEV ${rawEV.toFixed(0)} (${(100*rawEV/puzzle)|0}%) | awardedEV ${awardedEV.toFixed(0)} (${pct.toFixed(0)}%) | band [${lo|0},${hi|0}] cap ${cap} ${inBand?'IN BAND':'** OUT OF BAND **'} | P(shutout -10hp)=${(100*pBleed).toFixed(0)}%`);
}
console.log(bad ? 'FAIL: '+bad+' diff tier(s) out of band' : 'PASS: all diffs within 60-135% band');
process.exit(bad?1:0);
