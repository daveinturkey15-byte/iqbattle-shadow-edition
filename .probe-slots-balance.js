/* .probe-slots-balance.js — EV probe for modes/slots.js (throwaway balance math) */
'use strict';
const STRIP_LEN = 20;
const STAKES = [20, 30, 40, 50, 60];
const PAIR_PAY = [40, 34, 28, 21, 15];
const SKULL_DIST = [[0,0,0],[0,0,1],[0,1,1],[1,1,2],[1,2,2]];
const TRIPLE_PAY = { eye: 90, moon: 120, key: 160, crown: 260 };
const JACKPOT = 600;
const BASE = [
  { eye: 7, moon: 6, key: 4, crown: 3 },
  { eye: 6, moon: 5, key: 5, crown: 4 },
  { eye: 6, moon: 6, key: 4, crown: 4 }
];

function mulberry32(a){return function(){a|=0;a=(a+0x6D2B79F5)|0;var t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}}

function buildStrip(comp){const arr=[];for(const s in comp)for(let k=0;k<comp[s];k++)arr.push(s);return arr}

function linePayout(line,pairPay){
  let stars=0,skull=false;const rest={};
  for(const s of line){if(s==='skull')skull=true;else if(s==='star')stars++;else rest[s]=(rest[s]||0)+1}
  if(skull)return 0;
  if(stars===3)return JACKPOT;
  let bestN=0,bestSym=null;
  for(const sym in rest)if(rest[sym]>bestN){bestN=rest[sym];bestSym=sym}
  if(bestSym===null)return 0;
  if(bestN+stars>=3)return TRIPLE_PAY[bestSym];
  if(bestN+stars===2)return pairPay;
  return 0;
}

/* exact EV over uniform landings given fixed strips */
function evFixed(strips,pairPay,doubled){
  let sum=0;
  for(let a=0;a<20;a++)for(let b=0;b<20;b++)for(let c=0;c<20;c++){
    const p=linePayout([strips[0][a],strips[1][b],strips[2][c]],pairPay);
    sum+=p;
  }
  return sum/8000;
}

/* sample strip realizations (skulls replace uniform positions; star optional) */
function sampleStrips(diff,wantStar,rng){
  const dist=SKULL_DIST[diff-1];
  const strips=[];
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

const N=4000;
for(let diff=1;diff<=5;diff++){
  const pp=PAIR_PAY[diff-1],stake=STAKES[diff-1];
  const rng=mulberry32(1000+diff);
  let ev=0,evStar=0;
  for(let i=0;i<N;i++){
    ev+=evFixed(sampleStrips(diff,false,rng),pp,false)/N;
    evStar+=evFixed(sampleStrips(diff,true,rng),pp,false)/N;
  }
  const spin3Extra=diff>=5?ev:0; // spin3 doubled adds another ev worth
  const total=3*ev+spin3Extra;
  const totalStar=3*evStar+(diff>=5?evStar:0);
  const puzzle=100*diff+40, lo=.6*puzzle, hi=1.35*puzzle, cap=puzzle+20;
  console.log(`diff${diff}: stake ${stake} thr ${3*stake} | EV/spin ${ev.toFixed(1)} | EV/round ${total.toFixed(1)} (${(100*total/puzzle).toFixed(0)}% of ${puzzle}) band [${lo.toFixed(0)},${hi.toFixed(0)}] cap ${cap} | star-align EV ${totalStar.toFixed(1)}`);
}
