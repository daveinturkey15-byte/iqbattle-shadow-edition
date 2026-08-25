/* ============================================================================
 * IQ.Align v2 — W1 AlignmentDirector + Continuity Planner (contracts: research/w1-contracts.md C2/C8)
 * Exclusive owner wave: ContinuityV2. Dave's continuity vision -> mechanics map:
 *
 *   SPEC 1 DESCENT ARCS ......... arcDepth increments per CONSECUTIVE hostile block
 *                                 (reset only by limbo/redemption/triptych). Deeper
 *                                 arcs rotate the bad-pool toward darker worlds
 *                                 (jungle/riot -> volcano -> hell/abyss-void) and
 *                                 deepen dim thresholds. Every slice ships
 *                                 ctx.arcDepth for hooks (harder-modifier scaling).
 *   SPEC 2 LIMBO RUNS ........... after a deep arc (depth >= 2) 1-2 NEUTRAL limbo
 *                                 rounds may precede redemption: align 'neutral',
 *                                 calm:1, heal 0, amp 0 (calm modifiers zero).
 *   SPEC 3 REDEMPTION CONTINUIT. kept + strengthened: good rounds resume the
 *                                 previous good theme when >=4 rounds apart AND
 *                                 INHERIT the closed arc's depth (ctx.arcDepth) so
 *                                 stair-of-heaven style worlds ascend visually per
 *                                 arc climbed. Depth resets to 0 after redemption.
 *   SPEC 4 SEED->PHOENIX CYCLE . every ~14 +/- 3 rounds a forced triptych:
 *                                 (a) garden  — world 'seed-garden', align neutral,
 *                                     curses quieted (neutral => Curses.roll is
 *                                     quiet), ctx purge:'curses', ctx hpDelta:+20,
 *                                     banner 'a small seed takes root';
 *                                 (b) fire    — 1-2 rounds later, world 'seed-fire',
 *                                     align bad, ctx harsh:2 (packs x2 their
 *                                     modifier magnitudes);
 *                                 (c) phoenix — immediately after fire, world
 *                                     'phoenix-rise', align good, ctx scoreMul:1.5,
 *                                     ctx purge:'all'. Cycle resets arcDepth.
 *                                 Worlds registered in worlds-realm.js (this repo).
 *   SPEC 5 ABYSS ZONE .......... rare (deep arcs only, depth >= 3): align bad,
 *                                 world 'abyss-void', ctx.allowNegativeHp=1 (engine
 *                                 owns clamping/death; planner ONLY emits the flag),
 *                                 black-hole pull drawn by the world.
 *   SPEC 6 PARITY + RATIO ...... rounds 1-2 always null (C8 pristine). Blocks of
 *                                 4-6 hostile closed by exactly 1 good keep the
 *                                 long-run ~5 bad : 1 good ratio; the triptych is
 *                                 ratio-neutral (1 bad / 1 good / 1 neutral).
 *   SPEC forcedAlign ........... IQ.Align.force(align): one-shot runtime override
 *                                 (PackEvents nuke). Consumed ONCE by the next
 *                                 at(round>2): overrides align/theme of the slice
 *                                 and stamps ctx.forcedAlign. Base plan stays
 *                                 deterministic under the same seed.
 *
 * Slice shape (superset of frozen C2 — unknown keys are inert to the engine and
 * ship to clients inside pz.w1 / the round frame where hooks read them):
 *   {align, theme, dim, heal, amp,                 // frozen C2 fields
 *    arcDepth, calm, phase, harsh, purge, hpDelta, scoreMul, allowNegativeHp,
 *    banner, forcedAlign}
 *
 * Gameplay delivery: this file ALSO registers hook id 'alignment-continuity' via
 * window.IQ.Hooks.add(...) (defensive retry until HooksCore lands) translating
 * the ctx fields above into modifiers {hpDelta, scoreMul, bannerText, flag, sfx}.
 * ============================================================================*/
(function () {
'use strict';
const root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

/* Deterministic seeded rng (mulberry32), unchanged from v1. */
function mul32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

/* Dark-world descent rotation by arc depth (SPEC 1). */
const ROTATION = [
  ['jungle','riot'],
  ['volcano','jungle','riot'],
  ['volcano','hell','riot'],
  ['hell','volcano']
];
const ABYSS_THEME = 'abyss-void';

const Align = (function(){
 let plan = [];
 let pendingForce = null;     /* one-shot forced-align request (nuke) */
 let recentThemes = [];       /* feel-stats rail: last two themes, anti-repeat */
 let forcedConsumedAt = -1;

 function themesFor(align){
  try{
   if (root.IQ && IQ.Worlds && IQ.Worlds.list) return IQ.Worlds.list(align);
  }catch(e){}
  return [];
 }
 function pick(arr, r){
  if (!arr.length) return null;
  if (arr.length > 1 && recentThemes.length){
    /* feel-stats rail: avoid the last two themes when an alternative exists */
    const fresh = arr.filter(function(t){ return recentThemes.indexOf(t) === -1; });
    if (fresh.length) arr = fresh;
  }
  const t = arr[Math.floor(r()*arr.length)];
  recentThemes.push(t); if (recentThemes.length > 2) recentThemes.shift();
  return t;
 }
 function poolFor(align, prefs){
  const reg = themesFor(align);
  const wanted = (prefs || []).filter(function(t){ return reg.indexOf(t) >= 0; });
  return wanted.length ? wanted : (prefs && prefs.length ? prefs : reg);
 }

 /* ---------- SPEC 1: hostile entry scaled by descent depth ---------- */
 function hostileEntry(depth, r){
  /* SPEC 5: abyss zone — rare, deep arcs only */
  if (depth >= 3 && r() < 0.09){
   return { align:'bad', theme:ABYSS_THEME, dim:'4d', heal:0, amp:0,
            arcDepth:depth, allowNegativeHp:1 };
  }
  const chaotic = r() < 0.125;                       /* ~1-in-8 flip (frozen C2) */
  let pool;
  if (chaotic){
   pool = poolFor('chaotic');
   if (!pool.length) pool = poolFor('bad', ROTATION[Math.min(ROTATION.length-1, depth)]);
  }else{
   pool = poolFor('bad', ROTATION[Math.min(ROTATION.length-1, depth)]);
  }
  const themeId = pick(pool, r);
  /* deeper arcs bias dim modes darker (thresholds tighten with depth) */
  const d = Math.min(2, depth);
  const dimRoll = r();
  const dim = dimRoll < 0.008 ? '606d'
            : dimRoll < 0.04 - 0.010*d ? '4d'
            : dimRoll < 0.22 - 0.045*d ? '3d' : '2d';
  return { align: chaotic ? 'chaotic' : 'bad', theme: themeId, dim: dim,
           heal:0, amp:0, arcDepth: depth };
 }

 /* ---------- SPEC 2: limbo padding ---------- */
 function limboEntry(depth){
  return { align:'neutral', theme: pick(poolFor('neutral', ['limbo']), nullSafe()), dim:'2d',
           heal:0, amp:0, arcDepth: depth, calm:1 };
 }
 var _r = Math.random; /* replaced by seeded r during begin(); fallback only */
 function nullSafe(){ return _r; }

 /* ---------- SPEC 4: seed -> phoenix triptych ---------- */
 function triptychEntries(r){
  const fireOff = 1 + Math.floor(r() * 2);           /* fire within next 2 rounds */
  const out = [];
  out.push({ align:'neutral', theme:'seed-garden', dim:'2d', heal:0, amp:0,
             arcDepth:0, phase:'garden', purge:'curses', hpDelta:20,
             banner:'a small seed takes root' });
  for (let i = 1; i < fireOff; i++)
   out.push(hostileEntry(1, r));                     /* filler between garden/fire */
  out.push({ align:'bad', theme:'seed-fire', dim:'3d', heal:0, amp:0,
             arcDepth:1, phase:'fire', harsh:2 });
  out.push({ align:'good', theme:'phoenix-rise', dim:'2d', heal:0, amp:0,
             arcDepth:1, phase:'phoenix', purge:'all', scoreMul:1.5,
             banner:'the phoenix rises' });
  return out;
 }

 /* Build the whole-match plan. seed: number|string (roomCode hashed). */
 function begin(seed, totalRounds){
  let h = 2166136261 >>> 0;
  const s = String(seed == null ? '' : seed);
  for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  const r = mul32(h ^ ((totalRounds|0) * 2654435761));
  _r = r;
  plan = [];
  pendingForce = null; forcedConsumedAt = -1;

  let arcDepth = 0;                                  /* SPEC 1: consecutive hostile blocks */
  let lastGoodTheme = null, lastGoodRound = -99;
  let badCount = 0, goodCount = 0;                   /* SPEC 6: live 5:1 quota guard */
  let nextCycle = 11 + Math.floor(r() * 6);          /* SPEC 4: first triptych ~rounds 11-16 */

  /* SPEC 6: parity guard — rounds 1-2 pristine (frozen C8) */
  plan.push(null);
  if (totalRounds > 1) plan.push(null);
  let round = plan.length;

  while (round < totalRounds){
   /* SPEC 4: forced seed->phoenix triptych every ~14 +/- 3 rounds */
   if (round >= nextCycle){
    const trip = triptychEntries(r);
    for (let i = 0; i < trip.length && round < totalRounds; i++, round++) plan.push(trip[i]);
    arcDepth = 0;                                    /* serene reset */
    nextCycle = round + 7 + Math.floor(r() * 5);     /* +block overshoot lands gap at ~14 +/- 3 */
    continue;
   }
   /* SPEC 1: enter another hostile block -> arc deepens */
   arcDepth++;
   const chained = arcDepth > 1;                      /* continuing an open arc? */
   let blockLen = chained ? 3 + Math.floor(r() * 2)   /* chained blocks run shorter */
                          : 4 + Math.floor(r() * 3);
   /* SPEC 6 ratio trim: when planned bads run hot vs 5:1, shorten upcoming
      blocks instead of vetoing chains (keeps arcs deep AND ratio honest). */
   const deficit = badCount - 5 * goodCount;
   if (deficit > 2) blockLen = Math.max(2, blockLen - 1);
   if (deficit > 7) blockLen = Math.max(2, blockLen - 1);
   for (let b = 0; b < blockLen && round < totalRounds; b++, round++){
    const he = hostileEntry(arcDepth, r);
    plan.push(he);
    if (he.align !== 'chaotic') badCount++;
   }
   if (round >= totalRounds) break;

   /* SPEC 1: arcs deepen via CONSECUTIVE hostile blocks — sometimes skip the
      closing good round and descend further. Throttled by the live 5:1 quota
      so deep arcs can never wreck the long-run bad:good ratio (SPEC 6). */
   if (arcDepth < 4 && r() < 0.45 && badCount / Math.max(1, goodCount) < 6.5) continue;

   /* SPEC 2: after deep arcs, 1-2 neutral limbo rounds before redemption */
   if (arcDepth >= 2 && r() < 0.4){
    const limboN = 1 + (r() < 0.4 ? 1 : 0);
    for (let l = 0; l < limboN && round < totalRounds; l++, round++)
     plan.push(limboEntry(arcDepth));
   }
   if (round >= totalRounds) break;

   /* SPEC 3: redemption — resume prior good theme when >=4 apart (frozen C2),
      strengthened: inherit the arc depth just climbed (stair-of-heaven rise). */
   const goods = themesFor('good');
   let themeId = null;
   if (lastGoodTheme && (round - lastGoodRound) >= 4) themeId = lastGoodTheme;
   else themeId = pick(goods.length ? goods : ['ocean','heaven'], r);
   lastGoodTheme = themeId || lastGoodTheme;
   lastGoodRound = round;
   plan.push({ align:'good', theme:themeId, dim:'2d', heal:1, amp:0, arcDepth: arcDepth });
   goodCount++;
   round++;
   arcDepth = 0;                                      /* redeemed: descent restarts */
  }

  /* amplifier flags: alignment boundary crossings (vs previous planned round) */
  for (let i = 1; i < plan.length; i++){
   if (plan[i] && plan[i-1]) plan[i].amp = (plan[i].align !== plan[i-1].align) ? 1 : 0;
  }
 }

 /* plan[] is 0-indexed by construction order; game rounds are 1-based.
    Returns a COPY — callers may mutate. Injects one-shot forcedAlign (nuke). */
 function at(round1){
  let e = plan[round1 - 1];
  if (!e) return null;
  e = Object.assign({}, e);
  /* SPEC forcedAlign: consume exactly once, never during parity rounds */
  if (round1 > 2){
   let fa = null, ft = null;
   if (pendingForce){ fa = pendingForce.align; pendingForce = null; }
   else {
    /* documented fallback: PackEvents writes Hooks.state.forcedAlign when
       force() is unavailable; delete-on-consume so it can never fire twice */
    try{
     const st = root.IQ && IQ.Hooks && IQ.Hooks.state;
     if (st && st.forcedAlign){
      fa = String(st.forcedAlign).toLowerCase();
      ft = st.forcedTheme || null;
      delete st.forcedAlign; delete st.forcedTheme;
     }
    }catch(_e){}
   }
   if (fa){
    const pool = themesFor(fa);
    e.theme = ft || (pool.length ? pool[(round1 - 3) % pool.length] : e.theme);
    e.forcedAlign = fa;
    e.heal = fa === 'good' ? 1 : 0;
    forcedConsumedAt = round1;
   }
  }
  return e;
 }

 /* Runtime one-shot align override (PackEvents nuke consumption point). */
 function force(align){
  pendingForce = { align: String(align || '').toLowerCase() };
  return true;
 }
 function forcedAt(){ return forcedConsumedAt; }

 function reset(){ plan = []; pendingForce = null; forcedConsumedAt = -1; }
 function size(){ return plan.length; }

 return { begin, at, reset, size, force, forcedAt };
})();
root.IQ.Align = Align;

/* ---------------------------------------------------------------------------
 * Hook registration — translates planner ctx fields into Hooks modifiers.
 * Defensive: HooksCore's hooks.js may land after this file loads.
 * --------------------------------------------------------------------------*/
let _hooksDone = false, _hookTries = 0;
function addContinuityHooks(){
 if (_hooksDone) return true;
 try{
  const H = root.IQ && root.IQ.Hooks;
  if (!H || typeof H.add !== 'function') return false;
  H.add({
   id: 'alignment-continuity',
   worlds: ['seed-garden','seed-fire','phoenix-rise', ABYSS_THEME],
   handlers: {
    onRoundStart: function (ctx){
     let e = null;
     try{ e = (ctx && (ctx.w1 || ctx.entry || ctx.slice)) || null; }catch(_e){}
     if (!e){
      try{
       const rd = ctx && (ctx.round != null ? ctx.round : ctx.n);
       if (rd != null && root.IQ && IQ.Align) e = IQ.Align.at(rd);
      }catch(_e){}
     }
     if (!e) return;
     const mods = {};
     const flag = {};
     if (e.arcDepth) flag.arcDepth = e.arcDepth;              /* SPEC 1/3 */
     if (e.calm) flag.calm = 1;                               /* SPEC 2: zero-calm */
     if (e.allowNegativeHp) flag.allowNegativeHp = 1;         /* SPEC 5 */
     if (e.phase === 'garden'){                               /* SPEC 4a */
      mods.hpDelta = e.hpDelta || 20;
      mods.bannerText = e.banner;
      flag.purge = 'curses';
      mods.sfx = 'heal';
     }else if (e.phase === 'fire'){                           /* SPEC 4b */
      flag.harsh = e.harsh || 2;                              /* packs x2 magnitudes */
      mods.sfx = 'pain';
     }else if (e.phase === 'phoenix'){                        /* SPEC 4c */
      mods.scoreMul = e.scoreMul || 1.5;
      mods.bannerText = e.banner;
      flag.purge = 'all';
      mods.sfx = 'heal';
     }
     if (e.forcedAlign) flag.forcedAlign = e.forcedAlign;
     if (Object.keys(flag).length) mods.flag = flag;
     return mods;
    }
   }
  });
  _hooksDone = true;
 }catch(e){ /* stay unregistered; retried below */ }
 return _hooksDone;
}
if (!addContinuityHooks()){
 /* Retry until HooksCore lands (bounded, cheap). */
 const retry = function(){
  if (_hooksDone || ++_hookTries > 200){ return; }
  if (addContinuityHooks()) return;
  setTimeout(retry, 250);
 };
 if (typeof document !== 'undefined'){
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', retry);
  else setTimeout(retry, 250);
 } else setTimeout(retry, 250);
}

/* ---------------------------------------------------------------------------
 * Self-test: prints a readable 60-round plan showing arcs, limbo runs,
 * redemptions, abyss zones and a full seed->phoenix triptych. Node-runnable:
 *   node alignment.js            (default seed)
 *   node alignment.js MYSEED
 * --------------------------------------------------------------------------*/
function selfTest(seed){
 Align.begin(seed || 'continuity-selftest', 60);
 const rows = [];
 const stats = { bad:0, chaotic:0, good:0, neutral:0, parity:0,
                 limbo:0, gardens:0, fires:0, phoenix:0, abyss:0, forced:0 };
 let arcRuns = [], curArc = null;
 for (let i = 1; i <= Align.size(); i++){
  const e = Align.at(i);
  if (!e){ stats.parity++; rows.push(pad(i,2) + ' | -- | parity-guard (pristine)'); continue; }
  stats[e.align] = (stats[e.align] || 0) + 1;
  let tags = '';
  if (e.align === 'bad' || e.align === 'chaotic'){
   if (!curArc){ curArc = { start:i, depth:e.arcDepth }; }
   curArc.depth = e.arcDepth;
   if (e.theme === ABYSS_THEME){ stats.abyss++; tags += ' ABYSS(-hp)'; }
  }else if (curArc){ arcRuns.push(curArc); curArc = null; }
  if (e.calm){ stats.limbo++; tags += ' LIMBO'; }
  if (e.phase === 'garden'){ stats.gardens++; tags += ' <<SEED-GARDEN'; }
  if (e.phase === 'fire'){ stats.fires++; tags += ' <<SEED-FIRE(x2)'; }
  if (e.phase === 'phoenix'){ stats.phoenix++; tags += ' <<PHOENIX(x1.5)'; if (curArc){ arcRuns.push(curArc); curArc = null; } }
  if (e.align === 'good' && !e.phase) tags += ' REDEMPTION(d' + e.arcDepth + ')';
  if (e.forcedAlign){ stats.forced++; tags += ' FORCED'; }
  rows.push(pad(i,2) + ' | ' + pad(e.align,7) + ' | ' + pad(String(e.theme == null ? '(base)' : e.theme),12) +
            ' | d' + (e.arcDepth || 0) + (e.dim !== '2d' ? ' ' + e.dim : '') + tags);
 }
 if (curArc) arcRuns.push(curArc);
 const sum =
  'arcs: ' + arcRuns.map(function(a){ return 'r' + a.start + '(x' + a.depth + ')'; }).join(' ') +
  '\nstats: ' + JSON.stringify(stats) +
  '\nratio bad:good = ' + (stats.bad + stats.chaotic) + ':' + stats.good +
  ' (~' + (((stats.bad + stats.chaotic) / Math.max(1, stats.good))).toFixed(1) + ':1)';
 const out = rows.join('\n') + '\n' + sum;
 /* eslint-disable no-console */
 if (typeof console !== 'undefined') console.log(out);
 return out;
}
function pad(s, n){ s = String(s); while (s.length < n) s += ' '; return s; }

root.IQ.Align.selfTest = selfTest;

if (typeof module !== 'undefined' && module.exports){
 module.exports = root.IQ.Align;
 if (typeof require !== 'undefined' && require.main === module){
  selfTest(process.argv[2]);
 }
}
})();
