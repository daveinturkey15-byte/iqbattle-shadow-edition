/* ============================================================================
 * IQ.LMS — W1 Last-Man-Standing & Point Attacks (contracts: research/w1-contracts.md C7)
 *
 * PURE module: zero DOM writes, zero Audio, zero timers, zero network.
 * The HOST calls every function below; clients only ever read scores[]
 * carried inside existing reveal frames. Nothing here touches answer fields
 * and nothing here invents scoring — all state changes mirror what the host
 * broadcasts.
 *
 * ── HOST INTEGRATION POINTS (which frames carry what) ────────────────────────
 *  MATCH START   host: LMS.planBegin(roomSeed, uids) -> {order, attackBudget}.
 *                `order` is the seeded attack-priority rotation (uid list);
 *                host stores it. No frame needed (host-private state).
 *  ROUND FRAME   unchanged (C1): {t:'round', …, w1?:{…}}. Attack results ride
 *                inside the next reveal's scores[] — C7 forbids a new frame
 *                type for attack STATE. Clients re-render bars from scores[].
 *  CLIENT->HOST  {t:'attack', targetUid, weapon:'rotten'|'curse'} (C7).
 *                Host pipeline: LMS.validateAttack(...) -> if ok,
 *                LMS.attackResult(...) -> adopt returned newScores ->
 *                apply LMS.hpDelta(weapon) to host hp map (curse only).
 *  ELIMINATION   after each reveal host runs
 *                LMS.evaluateElimination(scores, hpMap, cfg); per eliminated
 *                uid broadcast {t:'elim', uid} (C7). Eliminated = spectator.
 *  MATCH END     when LMS.remaining(scores).length <= 1 stop looping rounds
 *                and broadcast {t:'end'} (C7).
 *  PARITY GUARD  while G.round <= 2 (C8) host SHOULD reject attacks entirely
 *                (reason 'parity-guard') so first rounds stay a baseline clone.
 *  MOTION/FX     any hit feedback (shake/sting) is the host/renderer's job,
 *                gated behind localStorage 'IQB_MOTION'; flashes <=200ms.
 *
 * ── ECONOMY DERIVATION (live-observed, see research/w1-overhaul-brainstorm.md §8)
 *  Wrong answer costs the player -40 pts; demon rivals bank ~80-140 per good
 *  answer (avg ~110). Grief boundary (§8): a victim must always be able to
 *  recover the damage within 2 good answers.
 *    rotten : dmg 120 <= 2 x 110 avg gain            -> inside boundary.
 *    curse  : dmg 200 == ~2 x avg gain (220 ceiling) -> inside boundary on the
 *             average-gain reading; NOTE for BalanceModel (C4 finalizes event
 *             damage): under the WORST-CASE gain reading (2 x 80 = 160) curse
 *             exceeds the strict cap, which is intentional — curse pays for
 *             the overflow with cost 150 + hpDelta -10 on the C4 HP track,
 *             and heal rounds (+30 hp) counter it. If Dave wants the strict
 *             worst-case guarantee, drop curse.dmg to 160; one-line change.
 * ============================================================================*/
(function () {
'use strict';
const root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

/* ── Constants table (single source of truth for the host UI too) ─────────── */
const WRONG_COST = 40;          // live-observed: wrong answer = -40 pts
const GOOD_GAIN_MIN = 80;       // demon rivals gain ~80-140 per good answer
const GOOD_GAIN_MAX = 140;
const RECOVERY_ANSWERS = 2;     // §8 grief boundary: recover within 2 good answers
const SCORE_FLOOR = 0;          // LMS score floor (C7): scores never go negative
const ATTACKS_PER_ROUND = 1;    // attackBudget.perRound handed out at begin()

const WEAPONS = {
  rotten: { cost: 80,  dmg: 120 },                    // cheap harass
  curse:  { cost: 150, dmg: 200, hpDelta: -10 }       // committed blow + HP sting
};

/* Seeded PRNG: fnv-1a string hash -> mulberry32 (same pattern as gen_iqvs.js). */
function rngFrom(seed){
  let h = 2166136261 >>> 0;
  const s = String(seed == null ? '' : seed);
  for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return function(){ h |= 0; h = h + 0x6D2B79F5 | 0; let t = Math.imul(h ^ h >>> 15, 1 | h);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/* In-place Fisher-Yates with injected rng (deterministic when rng is). */
function shuffled(arr, r){
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(r() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function findScore(scores, uid){
  for (let i = 0; i < scores.length; i++) if (scores[i] && scores[i].uid === uid) return scores[i];
  return null;
}

/**
 * Plan the LMS layer for a match. Host-only, call once at match start.
 * @param {string|number} roomSeed  Room code / seed (hashed, never mutated).
 * @param {Array<string|number>} [uids] Player uids in lobby order. Optional:
 *        when omitted `order` is [] and the host must pass uids to get a rotation.
 * @returns {{order:Array, attackBudget:{perRound:number}}} Seeded attack-priority
 *          rotation (a deterministic shuffle of `uids`) and per-round budget.
 */
function planBegin(roomSeed, uids){
  const r = rngFrom(roomSeed);
  const seats = Array.isArray(uids) && uids.length ? uids.map(String) : [];
  return {
    order: seats.length ? shuffled(seats, r) : [],
    attackBudget: { perRound: ATTACKS_PER_ROUND }
  };
}

/**
 * Elimination sweep after a reveal. Policy lives in cfg so the lead can tune
 * without touching this file:
 *   cfg.mode 'and' (default): eliminated iff pts<=0 AND hp<=0
 *                             (pts alone merely floors at 0; hp<=0 alone is
 *                             the C4 solo-death path).
 *   cfg.mode 'or'           : eliminated iff pts<=0 OR hp<=0 (hardcore).
 * Players missing from hpMap are treated as hp-alive (host may not track hp
 * for spectators); players with pts<=0 whose hp is still >0 survive on the
 * 'and' policy until the HP track finishes them.
 * @param {Array<{uid:string|number, pts:number}>} scores
 * @param {Object} hpMap  Map uid -> current hp (C4: start/cap 100).
 * @param {{mode?:'and'|'or'}} [cfg]
 * @returns {Array} uids eliminated this sweep (empty when none).
 */
function evaluateElimination(scores, hpMap, cfg){
  const out = [];
  if (!Array.isArray(scores)) return out;
  const mode = (cfg && cfg.mode) || 'and';
  const hp = hpMap || {};
  for (let i = 0; i < scores.length; i++){
    const s = scores[i];
    if (!s || typeof s.uid === 'undefined') continue;
    const ptsDead = (s.pts | 0) <= SCORE_FLOOR;
    const hpKnown = Object.prototype.hasOwnProperty.call(hp, s.uid);
    const hpDead = hpKnown && (Number(hp[s.uid]) | 0) <= 0;
    const dead = mode === 'or' ? (ptsDead || hpDead) : (ptsDead && hpDead);
    if (dead) out.push(s.uid);
  }
  return out;
}

/**
 * Validate an incoming {t:'attack'} frame BEFORE mutating anything.
 * Pure: reads only; returns the first failure reason found.
 * @param {{attackerUid:any, targetUid:any, cost:number,
 *          scores:Array<{uid:any, pts:number}>, parityGuard?:boolean}} req
 * @returns {{ok:boolean, reason?:string}}
 *   reasons: 'parity-guard' | 'bad-request' | 'no-such-attacker' |
 *            'no-such-target' | 'self-attack' | 'target-down' |
 *            'bad-cost' | 'insufficient-points'
 */
function validateAttack(req){
  if (!req || !req.scores || !Array.isArray(req.scores)) return { ok: false, reason: 'bad-request' };
  if (req.parityGuard) return { ok: false, reason: 'parity-guard' };       // C8: rounds 1-2 pristine
  const a = findScore(req.scores, req.attackerUid);
  if (!a) return { ok: false, reason: 'no-such-attacker' };
  const t = findScore(req.scores, req.targetUid);
  if (!t) return { ok: false, reason: 'no-such-target' };
  if (req.attackerUid === req.targetUid) return { ok: false, reason: 'self-attack' };
  if ((t.pts | 0) <= SCORE_FLOOR) return { ok: false, reason: 'target-down' };
  const cost = Number(req.cost);
  if (!isFinite(cost) || cost <= 0) return { ok: false, reason: 'bad-cost' };
  if ((a.pts | 0) < cost) return { ok: false, reason: 'insufficient-points' };
  return { ok: true };
}

/**
 * Apply a validated attack. NEVER mutates the input array; returns fresh
 * score objects with floors applied (C7: score floor 0 in LMS).
 * Attacker pays weapon.cost; target loses weapon.dmg. The curse hpDelta is
 * NOT applied here (hp lives in the host hp map) — read it via hpDelta().
 * @param {{scores:Array<{uid:any, pts:number}>, attackerUid:any,
 *          targetUid:any, weapon:'rotten'|'curse'}} payload
 * @returns {null|Array<{uid:any, pts:number}>} newScores, or null when the
 *          weapon is unknown or validation fails (host then rejects the frame).
 */
function attackResult(payload){
  if (!payload || !Array.isArray(payload.scores)) return null;
  const w = WEAPONS[payload.weapon];
  if (!w) return null;
  const gate = validateAttack({
    attackerUid: payload.attackerUid,
    targetUid: payload.targetUid,
    cost: w.cost,
    scores: payload.scores
  });
  if (!gate.ok) return null;
  return payload.scores.map(function (s){
    if (s.uid === payload.attackerUid) return { uid: s.uid, pts: Math.max(SCORE_FLOOR, (s.pts | 0) - w.cost) };
    if (s.uid === payload.targetUid)  return { uid: s.uid, pts: Math.max(SCORE_FLOOR, (s.pts | 0) - w.dmg) };
    return { uid: s.uid, pts: s.pts | 0 };
  });
}

/** HP delta the host must apply to hpMap[targetUid] for this weapon (0 most). */
function hpDelta(weapon){ const w = WEAPONS[weapon]; return w && w.hpDelta ? w.hpDelta : 0; }

/** Uids still alive under the C7 loop condition (score > floor). */
function remaining(scores){
  return Array.isArray(scores)
    ? scores.filter(function (s){ return s && (s.pts | 0) > SCORE_FLOOR; }).map(function (s){ return s.uid; })
    : [];
}

const LMS = {
  WEAPONS: WEAPONS,
  ECONOMY: {
    WRONG_COST: WRONG_COST,
    GOOD_GAIN_MIN: GOOD_GAIN_MIN,
    GOOD_GAIN_MAX: GOOD_GAIN_MAX,
    RECOVERY_ANSWERS: RECOVERY_ANSWERS,
    SCORE_FLOOR: SCORE_FLOOR,
    ATTACKS_PER_ROUND: ATTACKS_PER_ROUND
  },
  planBegin: planBegin,
  evaluateElimination: evaluateElimination,
  validateAttack: validateAttack,
  attackResult: attackResult,
  hpDelta: hpDelta,
  remaining: remaining
};

root.IQ.LMS = LMS;
if (typeof module !== 'undefined' && module.exports) module.exports = LMS;
})();
