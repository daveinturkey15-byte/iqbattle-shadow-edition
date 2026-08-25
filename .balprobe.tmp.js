
'use strict';
// ---- floorfall schedule stats (replicates pickVictims/buildSchedule) ----
function mulberry(seed){var a=seed>>>0;return function(){a|=0;a=(a+0x6D2B79F5)|0;var t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
function lerp(a,b,t){return a+(b-a)*t;}
function paramsFor(d){d=Math.max(1,Math.min(10,d|0));return{gapMs:Math.round(lerp(4000,2200,(d-1)/9)),warnMs:Math.round(lerp(800,400,(d-1)/9)),doubleFall:d>=6};}
function pickVictims(rand,pool,P,ans){pool=pool.slice();var out=[];var want=P.doubleFall?2:1;
 for(var i=0;i<want;i++){if(pool.length-1<3)break;var tries=pool.length,placed=false;
  while(tries-->0&&pool.length>0){var idx=Math.floor(rand()*pool.length)%pool.length;var cand=pool[idx];
   var wrongStand=pool.length-(pool.indexOf(ans)>=0?1:0);
   if(cand===ans&&wrongStand>=3){pool.splice(idx,1);continue;}
   out.push(cand);pool.splice(idx,1);placed=true;break;}
  if(!placed)break;}
 return{v:out,standing:pool};}
function sched(seed,budgetMs,P,ans){var rand=mulberry(seed);var standing=[0,1,2,3,4,5,6,7];var beats=[];var t=Math.round(budgetMs*0.25);var g=0;
 while(t<=budgetMs*0.95&&standing.length>3&&g++<64){var r=pickVictims(rand,standing,P,ans);
  if(r.v.length){beats.push({t:t,lastDrop:t+P.warnMs,n:r.v.length});standing=r.standing;}t+=P.gapMs;}
 return{beats:beats,leftStanding:standing.length,ansSurvived:standing.indexOf(ans)>=0};}
var BUDGET=45000;
for(const D of [3,8,15]){const P=paramsFor(D);let drops=[],last=[],ansSafe=0,N=2000;
 for(let s=0;s<N;s++){const r=sched(s*7919+13,BUDGET,P,s%(8));drops.push(r.beats.reduce((a,b)=>a+b.n,0));
  if(r.beats.length)last.push(r.beats[r.beats.length-1].lastDrop);if(r.ansSurvived)ansSafe++;}
 const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
 console.log('floorfall d'+D,'P',JSON.stringify(P),'avgDrops',avg(drops).toFixed(2),
   'avgLastDropMs',last.length?Math.round(avg(last)):'-','ansTileSurvived',(ansSafe/N*100).toFixed(1)+'%');}

// ---- laserstorm: vaporize/threaded probabilities per random correct click ----
function lsParams(depth){var u=(Math.max(1,Math.min(10,depth|0))-1)/9;return{period:Math.round(3200-1800*u),tele:Math.round(900-350*u),beam:400,leadIn:1600,dual:depth>=5,salvo:depth>=9,salvoP:0.22,maxFiring:4};}
function lsRng(seed){return mulberry(seed);}
function permute(r){var a=[0,1,2,3,4,5,6,7],i,j,t;for(i=a.length-1;i>0;i--){j=Math.floor(r()*(i+1));t=a[i];a[i]=a[j];a[j]=t;}return a;}
function lsSched(seed,depth,H){var P=lsParams(depth),r=lsRng(seed),strikes=[];
 function sweep(off,dir,id){var order=permute(r),k=0,t,lane,s,cand,c,ln;
  for(t=P.leadIn+off;t-P.tele<=H;t+=P.period,k++){if(k>0&&k%8===0)order=permute(r);
   lane=dir>0?order[k%8]:7-order[k%8];s={lane:lane,start:t,dur:P.beam,tele:P.tele,sweep:id,extra:[]};
   if(P.salvo&&r()<P.salvoP){cand=[(lane+1)%8,(lane+3)%8,(lane+5)%8];
    for(c=0;c<cand.length&&s.extra.length<2;c++){ln=cand[c];if(ln===lane||s.extra.indexOf(ln)>=0)continue;
     var fc=0;for(var q=0;q<strikes.length;q++){var ss=strikes[q];if(ss.start<t+P.beam&&t<ss.start+ss.dur)fc+=1+ss.extra.length;}
     if(fc+1+s.extra.length+1<=P.maxFiring)s.extra.push(ln);}}
   strikes.push(s);}}
 sweep(0,r()<0.5?1:-1,0);if(P.dual)sweep(Math.round(P.period/2),-1,1);
 strikes.sort(function(a,b){return a.start-b.start;});return{P:P,strikes:strikes};}
for(const D of[3,8,15]){let vap=0,thread=0,tot=0,N=300,SAMP=40;const H=45000;
 for(let s=0;s<N;s++){const sch=lsSched(s*104729+7,D,H);
  for(let k=0;k<SAMP;k++){const t=1600+rng01(s*31+k)*(H-2000);const lane=(s*7+k)%8;tot++;
   let ph='idle';for(const st of sch.strikes){const hit=st.lane===lane||st.extra.indexOf(lane)>=0;if(!hit)continue;
    if(t>=st.start&&t<st.start+st.dur){ph='fire';break;}if(t>=st.start-st.tele&&t<st.start){ph='tele';}}
   if(ph==='fire')vap++;
   // threaded: adjacent lane fires within <=500ms after t
   let th=false;for(const st of sch.strikes){const lanes=[st.lane].concat(st.extra);
    for(const L of lanes){if(Math.abs(L-lane)===1&&st.start-t>=0&&st.start-t<=500)th=true;}}
   if(th)thread++;}}
 console.log('laserstorm d'+D,'P(vaporize @ random click)',(vap/tot*100).toFixed(1)+'%',
   'P(adjacent fire <=500ms -> threaded window)',(thread/tot*100).toFixed(1)+'%');}
function rng01(n){var x=Math.sin(n)*10000;return x-Math.floor(x);}

// ---- dronedodge spawn pressure at depths 3/8/15 ----
function ddParams(d){var u=(Math.max(1,Math.min(10,d|0))-1)/9;return{spawnInt:Math.round(2200-1300*u),jitter:0.3,life:7000,maxAlive:14,speedMul:1+0.1*Math.min(Math.max(1,d|0)-1,12),splitters:d>=7};}
function ddSpawns(seed,d,H){var P=ddParams(d),r=mulberry(seed),ev=[],t=1200;
 while(t<H){var side=Math.floor(r()*4),off=r(),spd=0.85+r()*P.jitter*2;ev.push({t:Math.round(t)});t+=P.spawnInt*(0.85+r()*P.jitter*2);}return ev;}
for(const D of[3,8,15]){const P=ddParams(D);let tot=[];
 for(let s=0;s<200;s++)tot.push(ddSpawns(s,D,45000).length);
 const avg=tot.reduce((a,b)=>a+b,0)/tot.length;
 console.log('dronedodge d'+D,'spawnInt',P.spawnInt,'speedMul',P.speedMul.toFixed(2),'splitters',P.splitters,
   'avgSpawnsIn45s',avg.toFixed(1),'maxBankableGuardsThisStage(min(spawns/3,2-carry))');}

// ---- hunterdodge exposure: net clock drift vs in-beam duty ----
for(const D of[3,8,15]){var d=Math.min(10,D);var turn=1.7*(1+0.15*Math.min(d-1,10));var half=lerp(24,16,(d-1)/9);
 console.log('hunterdodge d'+D,'turnRate',turn.toFixed(2)+'rad/s','coneFull',(half*2).toFixed(1)+'deg',
   'tick1 -10 then -6/s; netDrift=duty*1-(1-duty)*0.5; breakEvenDuty=33.3%');}
