/* IQ.Accolades 'accolades' — original-game end-of-match accolade engine
   (definitions per research/w1-original-recon.md#19). PURE: computes from a
   completed matchRecord; no client-side scoring, no DOM, no timers.

   matchRecord = {
     players: [{uid, name}, ...],
     rounds:  [{n, picks:{uid:{pos,correct,timeMs}}, winnerUid?}, ...]
   }
   Accolades.compute(matchRecord) -> [{uid, id, label}, ...]
   TIES SHARE: every accolade may be awarded to multiple players.

   Accolade semantics (deterministic derivations from the record):
   - king-hill      King of the Hill  — held cumulative 1st place after the most
                                      rounds. Per-round proxy points (host may
                                      override with winnerUid): correct answer =
                                      100 + speed bonus (k-th fastest of c correct
                                      solvers gets c-k). Tied leaders all hold.
   - not-earth      Not of this Earth — won EVERY round (round win = winnerUid,
                                      else fastest correct pick).
   - front-runner   Front Runner      — most round wins.
   - lone-wolf      Lone Wolf         — ONLY correct solver of a round, and the
                                      match had >= 4 players (threshold: 4; with
                                      3 players nobody can earn it).
   - lightning      Lightning Strike  — single fastest correct answer of the match
                                      (timeMs ties share).
   - hot-streak     Hot Streak        — longest consecutive-correct streak.
   - flawless       Flawless          — correct in every round.
   - rapid          Rapid Response    — lowest average timeMs over correct
                                      answers; needs >= ceil(rounds/2) correct
                                      answers to qualify (anti one-lucky-pick).

   HOST WIRING (recommended): accumulate picks during play via the helper so
   building the final matchRecord is trivial:
     var ms = { rounds: [] };
     // on each reveal, once per player:
     IQ.Accolades.recordRound(ms, { uid, pos, correct, timeMs }); // appends to current round
     IQ.Accolades.recordRound(ms, { n: r.n + 1 });                // open next round (optional)
     // optionally mark an authoritative round winner before opening the next round:
     ms.rounds[ms.rounds.length - 1].winnerUid = uid;
     var accolades = IQ.Accolades.compute({ players: roster, rounds: ms.rounds });

   Unit cases (also enforced by Accolades.selfTest()):
   1. Tie sharing — A and B both correct at 120 ms in R1 => BOTH get 'lightning'
      (single fastest correct answer is shared); all-equal streaks share 'hot-streak'.
   2. Lone Wolf threshold — with 4 players and exactly one correct solver in R2,
      that solver earns 'lone-wolf'; replaying the identical record with only
      3 players yields NO 'lone-wolf' for anyone.
*/
(function(){
const root=typeof window!=='undefined'?window:globalThis;
root.IQ=root.IQ||{};

var DEFS=[
 ['king-hill','King of the Hill'],
 ['not-earth','Not of this Earth'],
 ['front-runner','Front Runner'],
 ['lone-wolf','Lone Wolf'],
 ['lightning','Lightning Strike'],
 ['hot-streak','Hot Streak'],
 ['flawless','Flawless'],
 ['rapid','Rapid Response']
];

function t(v){return typeof v==='number'&&isFinite(v)?v:Infinity}

/**
 * Record one player's revealed pick into a mutable match state.
 * Appends to the newest round; pass `n` in the pick to open/switch rounds.
 * @param {{rounds:Array}} matchState persistent host-side state ({rounds:[]})
 * @param {{uid:string,pos:number,correct:boolean,timeMs?:number,n?:number,winnerUid?:string}} rec
 * @returns {{rounds:Array}} the same matchState (chainable)
 */
function recordRound(matchState,rec){
 matchState=matchState||{};matchState.rounds=matchState.rounds||[];
 rec=rec||{};
 var n=typeof rec.n==='number'?rec.n:(matchState.rounds.length?matchState.rounds[matchState.rounds.length-1].n:1);
 var rd=null;
 for(var i=matchState.rounds.length-1;i>=0;i--){if(matchState.rounds[i].n===n){rd=matchState.rounds[i];break}}
 if(!rd){rd={n:n,picks:{}};matchState.rounds.push(rd);matchState.rounds.sort(function(a,b){return a.n-b.n})}
 if(rec.uid!=null)rd.picks[rec.uid]={pos:rec.pos,correct:!!rec.correct,timeMs:rec.timeMs};
 if(rec.winnerUid!=null)rd.winnerUid=rec.winnerUid;
 return matchState;
}

/**
 * Compute end-of-match accolades. Pure; ties share every accolade.
 * @param {{players:Array<{uid:string,name?:string}>,rounds:Array<{n:number,picks:Object,winnerUid?:string}>}} mr
 * @returns {Array<{uid:string,id:string,label:string}>}
 */
function compute(mr){
 var out=[];
 if(!mr||!Array.isArray(mr.players)||!Array.isArray(mr.rounds)||!mr.rounds.length)return out;
 var uids=mr.players.map(function(p){return p.uid});
 var R=mr.rounds.length;

 var wins={},correct={},sumT={},best={},holds={},cur={},lone={},lightUids=null,fastT=Infinity;
 var cum={};

 mr.rounds.slice().sort(function(a,b){return a.n-b.n}).forEach(function(rd){
  rd=rd||{};var picks=rd.picks||{};
  var corr=[];
  uids.forEach(function(u){
   var p=picks[u];
   if(p&&p.correct){corr.push({u:u,tm:t(p.timeMs)});}
  });
  corr.sort(function(a,b){return a.tm-b.tm});

  // streak / totals
  uids.forEach(function(u){
   var p=picks[u];
   if(p&&p.correct){
    correct[u]=(correct[u]||0)+1;
    sumT[u]=(sumT[u]||0)+t(p.timeMs);
    cur[u]=(cur[u]||0)+1;
    if(cur[u]>(best[u]||0))best[u]=cur[u];
   }else cur[u]=0;
  });

  if(corr.length){
   // lightning: global fastest single correct (ties share)
   corr.forEach(function(e){
    if(e.tm<fastT){fastT=e.tm;lightUids=[e.u];}
    else if(e.tm===fastT&&lightUids&&lightUids.indexOf(e.u)<0)lightUids.push(e.u);
   });
   // round winner: authoritative winnerUid, else fastest correct
   var w=(rd.winnerUid!=null&&picks[rd.winnerUid]&&picks[rd.winnerUid].correct)?rd.winnerUid:corr[0].u;
   wins[w]=(wins[w]||0)+1;
   if(corr.length===1)lone[corr[0].u]=true;
  }

  // king of the hill: proxy points -> cumulative leader(s) hold the hill
  var c=corr.length;
  corr.forEach(function(e,k){cum[e.u]=(cum[e.u]||0)+100+(c-1-k);});
  var top=-Infinity,topU=[];
  uids.forEach(function(u){var v=cum[u]||0;if(v>top){top=v;topU=[u]}else if(v===top)topU.push(u)});
  if(top>0)topU.forEach(function(u){holds[u]=(holds[u]||0)+1});
 });
 if(lightUids)lightUids.sort();

 function maxKeys(map,filter){ // keys strictly > 0, maximal value
  var bv=0,bu=[];
  uids.forEach(function(u){
   if(filter&&!filter(u))return;
   var v=map[u]||0;
   if(v>bv){bv=v;bu=[u]}else if(v===bv&&v>0)bu.push(u);
  });
  return bu;
 }

 var minQual=Math.ceil(R/2);
 var winners={
  'king-hill':maxKeys(holds),
  'not-earth':uids.filter(function(u){return (wins[u]||0)===R}),
  'front-runner':maxKeys(wins),
  'lone-wolf':mr.players.length>=4?Object.keys(lone):[],
  'lightning':lightUids||[],
  'hot-streak':maxKeys(best),
  'flawless':uids.filter(function(u){return (correct[u]||0)===R}),
  'rapid':argmax2(uids,function(u){return (correct[u]||0)>=minQual&&correct[u]>0?sumT[u]/correct[u]:Infinity})
 };

 DEFS.forEach(function(d){
  winners[d[0]].forEach(function(u){out.push({uid:u,id:d[0],label:d[1]})});
 });
 return out;
}

// lowest average time wins; ties share; Infinity never wins
function argmax2(uids,score){
 var bv=Infinity,bu=[];
 uids.forEach(function(u){var v=score(u);
  if(v<bv){bv=v;bu=[u]}
  else if(v===bv)bu.push(u);
 });
 return bv===Infinity?[]:bu;
}

/**
 * Seeded self-test: exercises tie-sharing, the Lone Wolf >=4-player threshold,
 * clean sweeps and no-award edge cases. Pure; returns {ok,failed}.
 */
function selfTest(){
 var fails=[];
 function eq(name,got,want){
  var g=JSON.stringify(got),w=JSON.stringify(want);
  if(g!==w)fails.push(name+': got '+g+' want '+w);
 }
 function ids(ac,id){return ac.filter(function(a){return a.id===id}).map(function(a){return a.uid}).sort()}

 // Scenario 1 — 4 players, 3 rounds: tie-sharing + lone-wolf threshold.
 function mk(players){
  return {players:players.map(function(u){return{uid:u,name:u}}),rounds:[
   {n:1,picks:{A:{pos:0,correct:true,timeMs:120},B:{pos:0,correct:true,timeMs:120},C:{pos:2,correct:false,timeMs:900},D:{pos:3,correct:false,timeMs:950}}},
   {n:2,picks:{A:{pos:1,correct:false,timeMs:300},B:{pos:1,correct:false,timeMs:310},C:{pos:0,correct:true,timeMs:500},D:{pos:2,correct:false,timeMs:800}}},
   {n:3,picks:{A:{pos:0,correct:true,timeMs:130},B:{pos:0,correct:true,timeMs:140},C:{pos:2,correct:false,timeMs:700},D:{pos:3,correct:false,timeMs:750}}}
  ]};
 }
 var ac=compute(mk(['A','B','C','D']));
 eq('tie lightning',ids(ac,'lightning'),['A','B']);           // both 120ms share it
 eq('lone wolf 4p',ids(ac,'lone-wolf'),['C']);                // sole solver of R2
 eq('front runner',ids(ac,'front-runner'),['A']);             // A won R1+R3
 eq('no flawless',ids(ac,'flawless'),[]);
 eq('hot streak tie',ids(ac,'hot-streak'),['A','B','C']);    // best streak is 1 for every correct solver -> shared
 eq('rapid',ids(ac,'rapid'),['A']);                           // avg 125 vs B 130
 var ac3=compute(mk(['A','B','C']));                          // identical picks, 3 players
 eq('lone wolf threshold',ids(ac3,'lone-wolf'),[]);           // <4 players: never awarded

 // Scenario 2 — clean sweep: A wins/correct every round.
 var sw=compute({players:[{uid:'A'},{uid:'B'}],rounds:[
  {n:1,picks:{A:{pos:0,correct:true,timeMs:200},B:{pos:1,correct:false,timeMs:400}}},
  {n:2,picks:{A:{pos:2,correct:true,timeMs:250},B:{pos:1,correct:false,timeMs:300}}}
 ]});
 eq('sweep not-earth',ids(sw,'not-earth'),['A']);
 eq('sweep flawless',ids(sw,'flawless'),['A']);
 eq('sweep lightning',ids(sw,'lightning'),['A']);
 eq('sweep king',ids(sw,'king-hill'),['A']);

 // Scenario 3 — empty record.
 eq('empty',compute({players:[],rounds:[]}),[]);

 // recordRound helper wiring check.
 var ms={rounds:[]};
 recordRound(ms,{n:1,uid:'A',pos:0,correct:true,timeMs:100});
 recordRound(ms,{uid:'B',pos:1,correct:false,timeMs:200});
 recordRound(ms,{n:2,uid:'A',pos:3,correct:false,timeMs:100});
 eq('recordRound rounds',ms.rounds.map(function(r){return r.n}),[1,2]);
 eq('recordRound picks',Object.keys(ms.rounds[0].picks).sort(),['A','B']);
 var rc=compute({players:[{uid:'A'},{uid:'B'}],rounds:ms.rounds});
 eq('recordRound compute',ids(rc,'lightning'),['A']);

 return {ok:fails.length===0,failed:fails,checks:11};
}

root.IQ.Accolades={name:'accolades',compute:compute,recordRound:recordRound,selfTest:selfTest};
if(typeof module!=='undefined'&&module.exports)module.exports=root.IQ.Accolades;
})();
