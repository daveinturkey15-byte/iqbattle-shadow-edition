/* ============================================================================
 * IQ.Align — W1 AlignmentDirector (contracts: research/w1-contracts.md C2)
 *
 * Host-authoritative round planner. The host builds the FULL match plan at
 * startRun (deterministic from a seed) and ships one slice per round inside
 * the round frame as `w1`. Clients never run this — they read G.w1.
 *
 * Cadence target ≈ 5 bad : 1 good over long runs:
 *   blocks of 4-6 hostile rounds (each may flip chaotic ~1-in-8), closed by
 *   ONE good/heal round. Good rounds resume the previous good theme when the
 *   gap is >=4 rounds (redemption continuity). Neutral limbo rounds may pad
 *   blocks. Rounds 1-2 are ALWAYS baseline null (parity guard, contracts C8).
 * ============================================================================*/
(function () {
'use strict';
const root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

function mul32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

const Align = (function(){
 let plan = [];

 function themesFor(align){
  try{
   if (root.IQ && IQ.Worlds && IQ.Worlds.list) return IQ.Worlds.list(align);
  }catch(e){}
  return [];
 }
 function pick(arr, r){ return arr.length ? arr[Math.floor(r()*arr.length)] : null; }

 /* Build the whole-match plan. seed: number|string (roomCode hashed). */
 function begin(seed, totalRounds){
  let h = 2166136261 >>> 0;
  const s = String(seed == null ? '' : seed);
  for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  const r = mul32(h ^ (totalRounds * 2654435761));
  plan = [];
  let lastGoodTheme = null, lastGoodRound = -99, round = 0;
  /* parity guard: rounds 1-2 pristine */
  plan.push(null); round++;           // round 1
  if (totalRounds > 1) plan.push(null), round++; // round 2
  while (round < totalRounds){
   const blockLen = 4 + Math.floor(r() * 3);       // 4..6 hostile rounds
   for (let b = 0; b < blockLen && round < totalRounds; b++, round++){
    const chaotic = r() < 0.125;
    const pool = themesFor(chaotic ? 'chaotic' : (r() < 0.15 ? 'neutral' : 'bad'));
    const fallbackPool = themesFor('bad');
    const themeId = pick(pool.length ? pool : fallbackPool, r);
    const dimRoll = r();
    const dim = dimRoll < 0.008 ? '606d' : (dimRoll < 0.04 ? '4d' : (dimRoll < 0.22 ? '3d' : '2d'));
    plan.push({ align: chaotic ? 'chaotic' : 'bad', theme: themeId, dim: dim, heal: 0, amp: 0 });
   }
   if (round < totalRounds){
    /* good round — redemption continuity */
    const goods = themesFor('good');
    let themeId = null;
    if (lastGoodTheme && (round - lastGoodRound) >= 4) themeId = lastGoodTheme;
    else themeId = pick(goods, r);
    if (themeId){ lastGoodTheme = themeId; lastGoodRound = round; }
    plan.push({ align: 'good', theme: themeId, dim: '2d', heal: 1, amp: 0 });
    round++;
   }
  }
  /* amplifier flags: alignment boundary crossings (vs previous planned round) */
  for (let i = 1; i < plan.length; i++){
   if (plan[i] && plan[i-1]) plan[i].amp = (plan[i].align !== plan[i-1].align) ? 1 : 0;
  }
 }

 /* plan[] is 0-indexed by construction order; game rounds are 1-based. */
 function at(round1){
  const e = plan[round1 - 1];
  return e ? { align:e.align, theme:e.theme, dim:e.dim||'2d', heal:e.heal||0, amp:e.amp||0 } : null;
 }

 function reset(){ plan = []; }
 function size(){ return plan.length; }

 return { begin, at, reset, size };
})();
root.IQ.Align = Align;

if (typeof module !== 'undefined' && module.exports) module.exports = root.IQ.Align;
})();
