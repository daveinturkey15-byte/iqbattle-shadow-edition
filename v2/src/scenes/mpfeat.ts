/* ============================================================================
 * MP GAME FEATURES — v1 LMS/attack feature layer as pure functions + UI specs
 * for IQ Battle: SHADOW v2. Ports lms.js (Build-B semantics) onto the v2 wire
 * (src/scenes/mp.ts), which owns the protocol; THIS module owns the game rules
 * Main wires around it. Zero DOM, zero timers, zero network, zero randomness
 * outside injected RNG — every function here is deterministic and pure.
 *
 * WHAT MAIN WIRES (integration points; main.ts/scenes/mp.ts are NOT edited):
 *
 *   SCORE TABLE   foldScore (mp.ts) folds each reveal; liveStandings() turns
 *                 the table into ranked rows with rank DELTAS vs the previous
 *                 reveal (▲/▼ for the sidebar cards).
 *   ATTACK MENU   attackMenu(depth, myPts) -> per-weapon {cost,dmg,hpDelta,
 *                 affordable,reason} straight off the v1 balance-pass curves
 *                 (rotten cost 60+15d / dmg 60+20d, curse 100+25d / 100+30d /
 *                 hpDelta −10, depth clamped 1..5). Client clicks a rival card
 *                 -> Main sends {t:'attack'}; host validates with
 *                 validateAttack() then adopts applyAttack()'s fresh table
 *                 (never mutates).
 *   ELIMINATION   runEliminationPass() = mp.ts evaluateElimination ('and'
 *                 default, 'or' hardcore) + spectator phase bookkeeping +
 *                 end-when-one (≤1 alive => matchOver + winnerUid). Rage quit
 *                 = rageQuit() marking the uid 'left' — the door slams, the
 *                 match continues without them. mayAnswer/mayAttack gate the
 *                 input paths (the dead do not score).
 *   TIMER SYNC    validateTimerSync() compares the host-authoritative
 *                 remaining time against the client countdown; |drift| >
 *                 500ms flags desync (optional half-RTT compensation).
 *   MATCH START   planBegin(roomSeed, uids) -> seeded attack-priority
 *                 rotation + per-round attack budget (host-private state).
 *
 * FAIRNESS RAILS inherited from v1 lms.js: score floor 0 (scores never go
 * negative), parity-guard rejects ALL attacks at depth ≤ 2 (rounds 1-2 stay
 * a baseline clone), grief boundary — worst attack damage stays recoverable
 * within 2 good answers (avg gain 60-100/answer, damage scales WITH victim
 * income). Nothing here touches answer fields or invents frames; state
 * changes ride existing reveal/scores traffic.
 *
 * SELFTEST:   cd v2 && node src/scenes/mpfeat.ts        (exit 0 = PASS)
 * Simulates a full 20-depth LMS match between 3 players — seeded answers,
 * attacks, parity-guard rejections, rank swings, an elimination to spectator,
 * one rage-quit, and the end-when-one gate — asserting the narrative beats
 * and byte-identical determinism across reruns.
 * ==========================================================================*/

import { evaluateElimination, foldScore, type ScoreRec } from './mp.ts';

/* ------------------------------------------------------------------ */
/* Economy constants (v1 lms.js balance rev2)                          */
/* ------------------------------------------------------------------ */

/** LMS score floor (C7): scores never go negative. */
export const SCORE_FLOOR = 0;

/** Attack budget handed out per alive player per depth. */
export const ATTACKS_PER_ROUND = 1;

/** Parity guard (C8): depths ≤ this reject attacks entirely. */
export const PARITY_GUARD_DEPTHS = 2;

/** v1 economy: good answers gain 60–100 pts (grief boundary anchor). */
export const GOOD_GAIN_MIN = 60;
export const GOOD_GAIN_MAX = 100;

export type WeaponId = 'rotten' | 'curse';

export interface WeaponSpec {
  id: WeaponId;
  label: string;
  /** Points the attacker pays. */
  cost: number;
  /** Points stripped from the target (floored at SCORE_FLOOR). */
  dmg: number;
  /** HP the HOST subtracts from hpMap[target] (curse only). */
  hpDelta: number;
}

export const WEAPON_DEPTH_MIN = 1;
export const WEAPON_DEPTH_MAX = 5;

/**
 * Depth-scaled weapon economics (v1 balance rev2 §5, exact curve):
 *   rotten: cost 60+15d, dmg 60+20d            (d1: 75/80 … d5: 135/160)
 *   curse : cost 100+25d, dmg 100+30d, hp −10  (d1: 125/130 … d5: 225/250)
 * Damage scales WITH victim income so the 2-good-answer recovery boundary
 * holds at every depth. Depth clamps to [1,5].
 */
export function weaponFor(id: WeaponId, depth: number): WeaponSpec {
  const d = Math.max(
    WEAPON_DEPTH_MIN,
    Math.min(WEAPON_DEPTH_MAX, Math.floor(isFinite(depth) ? depth : WEAPON_DEPTH_MIN)),
  );
  if (id === 'rotten') {
    return { id, label: 'ROTTEN', cost: 60 + 15 * d, dmg: 60 + 20 * d, hpDelta: 0 };
  }
  return { id, label: 'CURSE', cost: 100 + 25 * d, dmg: 100 + 30 * d, hpDelta: -10 };
}

/** HP delta the host must apply to hpMap[target] (0 for most weapons). */
export function hpDeltaFor(id: WeaponId, depth: number): number {
  return weaponFor(id, depth).hpDelta;
}

/* ------------------------------------------------------------------ */
/* Attack menu spec (UI helper — Main renders these rows)              */
/* ------------------------------------------------------------------ */

export interface AttackMenuEntry {
  spec: WeaponSpec;
  affordable: boolean;
  /** 'READY' or why the button greys out. */
  reason: string;
}

/**
 * Build the attacker's menu at the current depth. Pure display math: reads
 * no table/hp state, so it can render before every reveal side-effect-free.
 */
export function attackMenu(depth: number, myPts: number): AttackMenuEntry[] {
  const ids: WeaponId[] = ['rotten', 'curse'];
  return ids.map((id) => {
    const spec = weaponFor(id, depth);
    const affordable = myPts >= spec.cost;
    return {
      spec,
      affordable,
      reason: affordable
        ? 'READY'
        : `NOT ENOUGH POINTS — COSTS ${spec.cost} (NEED ${spec.cost - myPts} MORE)`,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Attack validation + application (host pipeline)                     */
/* ------------------------------------------------------------------ */

export type PlayerPhase = 'alive' | 'spectator' | 'left';

export type AttackRejection =
  | 'parity-guard'
  | 'bad-request'
  | 'no-such-attacker'
  | 'no-such-target'
  | 'self-attack'
  | 'attacker-out'
  | 'target-out'
  | 'target-down'
  | 'insufficient-points';

export interface AttackRequest {
  attackerUid: string;
  targetUid: string;
  scores: ScoreRec[];
  weapon: WeaponId;
  /** Current puzzle depth — scales the curves. */
  depth: number;
  /** uid -> phase; missing entries count as 'alive'. */
  phases?: Record<string, PlayerPhase>;
  /** True at depth ≤ PARITY_GUARD_DEPTHS — every attack is rejected. */
  parityGuard?: boolean;
}

export type AttackGate = { ok: true } | { ok: false; reason: AttackRejection };

function findScore(scores: ScoreRec[], uid: string): ScoreRec | null {
  for (const s of scores) {
    if (s && s.uid === uid) return s;
  }
  return null;
}

function phaseOf(phases: Record<string, PlayerPhase> | undefined, uid: string): PlayerPhase {
  return (phases && phases[uid]) || 'alive';
}

/**
 * Validate an inbound {t:'attack'} BEFORE mutating anything. Reads only;
 * rejection order below is the first-failure-reported order.
 */
export function validateAttack(req: AttackRequest): AttackGate {
  if (!req || !Array.isArray(req.scores)) return { ok: false, reason: 'bad-request' };
  if (req.parityGuard) return { ok: false, reason: 'parity-guard' };
  const attacker = findScore(req.scores, req.attackerUid);
  if (!attacker) return { ok: false, reason: 'no-such-attacker' };
  const target = findScore(req.scores, req.targetUid);
  if (!target) return { ok: false, reason: 'no-such-target' };
  if (req.attackerUid === req.targetUid) return { ok: false, reason: 'self-attack' };
  if (phaseOf(req.phases, req.attackerUid) !== 'alive') return { ok: false, reason: 'attacker-out' };
  if (phaseOf(req.phases, req.targetUid) !== 'alive') return { ok: false, reason: 'target-out' };
  if (target.pts <= SCORE_FLOOR) return { ok: false, reason: 'target-down' };
  if (attacker.pts < weaponFor(req.weapon, req.depth).cost)
    return { ok: false, reason: 'insufficient-points' };
  return { ok: true };
}

/**
 * Apply an attack AFTER validation. Never mutates the input table; returns
 * fresh rows (names preserved) with the score floor applied: attacker pays
 * spec.cost, target loses spec.dmg. Returns null when validation fails —
 * the host then rejects the frame. The curse hpDelta is NOT applied here
 * (hp lives in the host hp map); read it via hpDeltaFor().
 */
export function applyAttack(req: AttackRequest): ScoreRec[] | null {
  if (!req || !Array.isArray(req.scores)) return null;
  if (!validateAttack(req).ok) return null;
  const spec = weaponFor(req.weapon, req.depth);
  return req.scores.map((s) => {
    if (s.uid === req.attackerUid) return { ...s, pts: Math.max(SCORE_FLOOR, s.pts - spec.cost) };
    if (s.uid === req.targetUid) return { ...s, pts: Math.max(SCORE_FLOOR, s.pts - spec.dmg) };
    return { ...s };
  });
}

/* ------------------------------------------------------------------ */
/* Match begin — seeded attack rotation                                */
/* ------------------------------------------------------------------ */

/* Seeded PRNG: fnv-1a string hash -> mulberry32 (same pattern as v1 lms.js). */
export function rngFrom(seed: string | number): () => number {
  let h = 2166136261 >>> 0;
  const s = String(seed == null ? '' : seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h |= 0;
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates over a COPY with an injected rng (deterministic). */
export function shuffled<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

export interface BeginPlan {
  /** Deterministic attack-priority rotation (uid list, host-private). */
  order: string[];
  attackBudget: { perRound: number };
}

/** Host-only, once at match start. Hashes the seed, never mutates inputs. */
export function planBegin(roomSeed: string | number, uids: string[]): BeginPlan {
  return {
    order: shuffled(uids.map(String), rngFrom(roomSeed)),
    attackBudget: { perRound: ATTACKS_PER_ROUND },
  };
}

/* ------------------------------------------------------------------ */
/* Live standings with rank deltas                                     */
/* ------------------------------------------------------------------ */

export interface Standing extends ScoreRec {
  /** 1-based position, pts desc, stable on insertion-order ties. */
  rank: number;
  /** prevRank − rank: positive climbed (▲), negative fell (▼), 0 unmoved/new. */
  delta: number;
  phase: PlayerPhase;
}

/**
 * Rank the current table. Sort is STABLE: equal pts keep reveal insertion
 * order, so the ladder never jitter-flickers between reveals.
 */
export function liveStandings(
  table: ScoreRec[],
  prevRanks?: Record<string, number>,
  phases?: Record<string, PlayerPhase>,
): Standing[] {
  return table
    .map((row, i) => ({ row, i }))
    .sort((x, y) => y.row.pts - x.row.pts || x.i - y.i)
    .map(({ row }, idx) => ({
      ...row,
      rank: idx + 1,
      delta: prevRanks && prevRanks[row.uid] != null ? prevRanks[row.uid] - (idx + 1) : 0,
      phase: phaseOf(phases, row.uid),
    }));
}

/** Compact ▲/▼ glyph for a sidebar card ('' when unmoved). */
export function rankGlyph(s: Standing): string {
  if (s.delta > 0) return `▲${s.delta}`;
  if (s.delta < 0) return `▼${-s.delta}`;
  return '';
}

/** Snapshot uid -> rank for the NEXT reveal's delta computation. */
export function snapshotRanks(rows: Standing[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.uid] = r.rank;
  return out;
}

/* ------------------------------------------------------------------ */
/* Elimination flow — sweep, spectator state, end-when-one             */
/* ------------------------------------------------------------------ */

export interface SweepResult {
  /** Uids eliminated THIS pass (freshly dead only). */
  eliminated: string[];
  /** Uids still 'alive' after applying this pass. */
  aliveUids: string[];
  /** Next-phase map: eliminated become 'spectator' ('left' is sticky). */
  phases: Record<string, PlayerPhase>;
  /** True when ≤ 1 seat remains — the match ends HERE. */
  matchOver: boolean;
  /** Sole survivor, or null when the void takes everyone. */
  winnerUid: string | null;
}

/**
 * One elimination pass after a reveal. Filters to currently-alive seats,
 * delegates the and/or verdict to mp.ts evaluateElimination, promotes the
 * dead to 'spectator', and applies the C7 loop condition: an LMS match ends
 * ONLY when ≤ 1 player remains. Input table/phases are never mutated.
 */
export function runEliminationPass(
  table: ScoreRec[],
  hp: Record<string, number>,
  phases: Record<string, PlayerPhase>,
  cfg?: { mode?: 'and' | 'or'; floor?: number },
): SweepResult {
  const contenders = table.filter((r) => phaseOf(phases, r.uid) === 'alive');
  const dead = evaluateElimination(contenders, hp, cfg);
  const nextPhases: Record<string, PlayerPhase> = { ...phases };
  for (const uid of dead) {
    if (nextPhases[uid] !== 'left') nextPhases[uid] = 'spectator';
  }
  const aliveUids = contenders.filter((r) => !dead.includes(r.uid)).map((r) => r.uid);
  const matchOver = aliveUids.length <= 1;
  return {
    eliminated: dead,
    aliveUids,
    phases: nextPhases,
    matchOver,
    winnerUid: aliveUids.length === 1 ? aliveUids[0] : null,
  };
}

/**
 * Rage quit: the uid's phase flips to 'left' (sticky — sweeps never revive,
 * re-eliminate, or crown them) and their row freezes. Unknown uids are
 * ignored so stale peer-leave frames are harmless.
 */
export function rageQuit(
  phases: Record<string, PlayerPhase>,
  uid: string,
): Record<string, PlayerPhase> {
  if (!(uid in phases)) return { ...phases };
  return { ...phases, [uid]: 'left' };
}

/** The dead do not score (v1 sendSr guard). */
export function mayAnswer(p: PlayerPhase): boolean {
  return p === 'alive';
}

/** Spectators and leavers cannot attack either. */
export function mayAttack(p: PlayerPhase): boolean {
  return p === 'alive';
}

/* ------------------------------------------------------------------ */
/* Round-timer sync validation                                         */
/* ------------------------------------------------------------------ */

/** Desync tolerance: beyond this the client countdown is flagged. */
export const TIMER_SYNC_TOLERANCE_MS = 500;

export interface TimerSyncReport {
  ok: boolean;
  /** clientRemaining − authoritativeRemaining (ms; positive = client slow). */
  driftMs: number;
  toleranceMs: number;
}

/**
 * Compare the host-authoritative remaining time (carried on the round frame,
 * evaluated at the SAME wall instant) against the client's own countdown.
 * rttMs (optional) halves out transit so lag isn't misread as drift:
 * expected client remaining ≈ authoritative − rtt/2.
 */
export function validateTimerSync(
  authoritativeRemainingMs: number,
  clientRemainingMs: number,
  opts?: { rttMs?: number; toleranceMs?: number },
): TimerSyncReport {
  const tolerance = opts?.toleranceMs ?? TIMER_SYNC_TOLERANCE_MS;
  const rtt = opts?.rttMs != null && isFinite(opts.rttMs) ? Math.max(0, opts.rttMs) : 0;
  const driftMs = Math.round(clientRemainingMs - (authoritativeRemainingMs - rtt / 2));
  return { ok: Math.abs(driftMs) <= tolerance, driftMs, toleranceMs: tolerance };
}

/* ------------------------------------------------------------------ */
/* SELFTEST — full simulated 20-depth LMS match                        */
/* ------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error('SELFTEST FAIL: ' + msg);
}

interface MatchSim {
  log: string[];
  winnerUid: string | null;
  matchOver: boolean;
  finalPhases: Record<string, PlayerPhase>;
  finalTable: ScoreRec[];
  depthsPlayed: number;
  attacksLanded: number;
  cursesLanded: number;
}

const SEATS: Array<{ uid: string; name: string }> = [
  { uid: 'h', name: 'HOST' },
  { uid: 'b', name: 'BRUNO' },
  { uid: 'c', name: 'CY' },
];

function seatName(uid: string): string {
  const seat = SEATS.find((s) => s.uid === uid);
  return seat !== undefined ? seat.name : uid;
}

/** Row lookup that THROWS instead of lying with an unchecked cast. */
function rowOf(rows: ScoreRec[], uid: string): ScoreRec {
  const row = rows.find((r) => r.uid === uid);
  if (row === undefined) throw new Error('SELFTEST FAIL: no score row for ' + uid);
  return row;
}

/** Sim tuning: answer accuracy starts at 62% and falls 1.5% per depth. */
const SIM_CORRECT_BASE = 0.635;
const SIM_CORRECT_RAMP = 0.015;
/**
 * Deterministic 3-player LMS match, up to DEPTH_LIMIT depths. Every decision
 * comes from rngFrom(seed) in a fixed call order — rerun and the narrative
 * is byte-identical.
 */
export function simulateMatch(seed: number, depthLimit = 20): MatchSim {
  const rng = rngFrom(seed);
  const log: string[] = [];

  const pts: Record<string, number> = {};
  const hp: Record<string, number> = {};
  let phases: Record<string, PlayerPhase> = {};
  let table: ScoreRec[] = [];
  for (const s of SEATS) {
    pts[s.uid] = 0;
    hp[s.uid] = 100;
    phases[s.uid] = 'alive';
    table.push({ uid: s.uid, name: s.name, pts: 0 });
  }

  const begin = planBegin(seed, SEATS.map((s) => s.uid));
  log.push(`MATCH START — seed ${seed} — attack rotation ${begin.order.map(seatName).join(' > ')}`);
  assert(new Set(begin.order).size === SEATS.length, 'begin rotation is a permutation of the seats');
  assert(begin.attackBudget.perRound === 1, 'one attack per player per depth');

  let prevRanks: Record<string, number> | undefined;
  let parityRejections = 0;
  let attacksLanded = 0;
  let cursesLanded = 0;
  let quitsDone = false;
  let winnerUid: string | null = null;
  let matchOver = false;
  let depth = 1;

  for (; depth <= depthLimit && !matchOver; depth++) {
    log.push(`— DEPTH ${depth} —`);
    const parity = depth <= PARITY_GUARD_DEPTHS;

    /* 1) Answers: correct gains 60-100; a miss costs 40 pts + 15 hp.
     * Depth ramp: puzzles bite harder as the abyss deepens (p falls 1.5%/d),
     * so LMS endgames converge instead of grinding to the depth cap. */
    for (const s of SEATS) {
      if (!mayAnswer(phases[s.uid])) continue;
      const good = rng() < SIM_CORRECT_BASE - depth * SIM_CORRECT_RAMP;
      if (good) {
        const gain = GOOD_GAIN_MIN + Math.floor(rng() * (GOOD_GAIN_MAX - GOOD_GAIN_MIN + 1));
        pts[s.uid] += gain;
        table = foldScore(table, { uid: s.uid, name: s.name, pts: pts[s.uid] });
        log.push(`  ${s.name} nails it (+${gain} -> ${pts[s.uid]})`);
      } else {
        pts[s.uid] = Math.max(SCORE_FLOOR, pts[s.uid] - 40);
        hp[s.uid] -= 15;
        table = foldScore(table, { uid: s.uid, name: s.name, pts: pts[s.uid] });
        log.push(`  ${s.name} misses (-> ${pts[s.uid]} pts, ${hp[s.uid]} hp)`);
      }
    }

    /* 2) Attacks: rotation order, budget 1 each, parity-guarded at d ≤ 2. */
    for (const atk of begin.order) {
      if (!mayAttack(phases[atk])) continue;
      const targets = SEATS.filter((s) => {
        if (s.uid === atk || !mayAttack(phases[s.uid])) return false;
        return rowOf(table, s.uid).pts > SCORE_FLOOR;
      });
      if (!targets.length) continue;
      const tgt = targets[Math.floor(rng() * targets.length)].uid;
      const menu = attackMenu(depth, pts[atk]);
      assert(menu.length === 2 && menu.every((m) => m.spec.dmg > 0), 'menu stays populated');
      const canPay = (id: WeaponId): boolean =>
        weaponFor(id, depth).cost <= pts[atk];
      let weapon: WeaponId | null = null;
      if (canPay('curse') && rng() < 0.45) weapon = 'curse';
      else if (canPay('rotten')) weapon = 'rotten';
      if (weapon === null) {
        log.push(`  ${seatName(atk)} eyes ${seatName(tgt)} but cannot afford anything`);
        continue;
      }

      const req: AttackRequest = {
        attackerUid: atk,
        targetUid: tgt,
        scores: table,
        depth,
        phases,
        parityGuard: parity,
        weapon,
      };
      const gate = validateAttack(req);
      if (parity) {
        assert(
          !gate.ok && gate.reason === 'parity-guard',
          `depth ${depth} attacks are parity-rejected`,
        );
        if (parityRejections === 0)
          log.push('  parity guard holds — the opening depths stay pristine');
        parityRejections++;
        continue;
      }
      assert(gate.ok, `validated attack passes at depth ${depth}`);
      const next = applyAttack(req);
      assert(next !== null, 'a validated attack always applies');
      table = next ?? [];
      pts[atk] = rowOf(table, atk).pts;
      pts[tgt] = rowOf(table, tgt).pts;
      hp[tgt] += hpDeltaFor(weapon, depth);
      attacksLanded++;
      if (weapon === 'curse') cursesLanded++;
      const spec = weaponFor(weapon, depth);
      log.push(
        `  ${seatName(atk)} strikes ${seatName(tgt)} with ${spec.label}` +
          ` (−${spec.cost} paid, −${spec.dmg} dealt${spec.hpDelta ? `, ${spec.hpDelta} hp` : ''})`,
      );
    }

    /* 3) Reveal: standings with rank deltas vs the previous board. */
    const standings = liveStandings(table, prevRanks, phases);
    for (const st of standings) {
      const g = rankGlyph(st);
      if (g.startsWith('▲')) log.push(`  ${st.name} climbs to #${st.rank} ${g}`);
      else if (g.startsWith('▼')) log.push(`  ${st.name} slips to #${st.rank} ${g}`);
    }
    prevRanks = snapshotRanks(standings);

    /* 4) Elimination sweep — spectator state, end-when-one. */
    const sweep = runEliminationPass(table, hp, phases, { mode: 'and' });
    phases = sweep.phases;
    for (const uid of sweep.eliminated)
      log.push(`  ${seatName(uid)} ELIMINATED — SPECTATING (the dead do not score)`);
    assert(sweep.aliveUids.every((u) => mayAnswer(phases[u])), 'alive seats can act');

    /* 5) Scripted rage quit: CY walks at the first chance from depth 9. */
    if (!quitsDone && depth >= 9 && phases.c === 'alive') {
      phases = rageQuit(phases, 'c');
      quitsDone = true;
      log.push('  CY rage-quits — the door slams mid-match');
      assert(!mayAttack(phases.c) && !mayAnswer(phases.c), 'leavers cannot act');
    }

    /* 6) End-when-one gate. */
    if (sweep.matchOver) {
      matchOver = true;
      winnerUid = sweep.winnerUid;
      log.push(
        winnerUid !== null
          ? `MATCH OVER — WINNER ${seatName(winnerUid)} (last one standing)`
          : 'MATCH OVER — THE VOID WINS',
      );
    }
  }

  return {
    log,
    winnerUid,
    matchOver,
    finalPhases: phases,
    finalTable: table,
    depthsPlayed: matchOver ? depth - 1 : depthLimit,
    attacksLanded,
    cursesLanded,
  };
}

function unitTests(): void {
  /* Weapon curves: exact v1 balance-pass numbers + clamping. */
  const r1 = weaponFor('rotten', 1);
  assert(r1.cost === 75 && r1.dmg === 80 && r1.hpDelta === 0, 'rotten d1 = 75/80/hp0');
  const r5 = weaponFor('rotten', 5);
  assert(r5.cost === 135 && r5.dmg === 160, 'rotten d5 = 135/160');
  const c1 = weaponFor('curse', 1);
  assert(c1.cost === 125 && c1.dmg === 130 && c1.hpDelta === -10, 'curse d1 = 125/130/−10');
  const c5 = weaponFor('curse', 5);
  assert(c5.cost === 225 && c5.dmg === 250 && c5.hpDelta === -10, 'curse d5 = 225/250/−10');
  assert(JSON.stringify(weaponFor('curse', 99)) === JSON.stringify(c5), 'depth clamps high');
  assert(JSON.stringify(weaponFor('curse', -3)) === JSON.stringify(c1), 'depth clamps low');
  assert(hpDeltaFor('rotten', 3) === 0 && hpDeltaFor('curse', 3) === -10, 'hp deltas by weapon');

  /* Menu + affordability. */
  const menu = attackMenu(1, 90);
  assert(menu.length === 2, 'menu lists both weapons');
  assert(menu[0].affordable && !menu[1].affordable, 'affordability split at 90 pts, d1');
  assert(menu[1].reason.includes('NEED 35 MORE'), 'shortfall message names the gap');

  /* Validation matrix. */
  const tbl: ScoreRec[] = [
    { uid: 'h', name: 'H', pts: 300 },
    { uid: 'b', name: 'B', pts: 50 },
  ];
  const base: AttackRequest = {
    attackerUid: 'h',
    targetUid: 'b',
    scores: tbl,
    weapon: 'rotten',
    depth: 3,
  };
  assert(validateAttack(base).ok, 'clean attack passes');
  const guarded = validateAttack({ ...base, parityGuard: true });
  assert(!guarded.ok && guarded.reason === 'parity-guard', 'parity guard rejects');
  assert(validateAttack({ ...base, attackerUid: 'x' }).ok === false, 'unknown attacker rejected');
  assert(validateAttack({ ...base, targetUid: 'x' }).ok === false, 'unknown target rejected');
  assert(validateAttack({ ...base, targetUid: 'h' }).ok === false, 'self attack rejected');
  assert(validateAttack({ ...base, attackerUid: 'b', targetUid: 'h' }).ok === false, 'broke attacker rejected');
  const down: ScoreRec[] = [
    { uid: 'h', name: 'H', pts: 300 },
    { uid: 'b', name: 'B', pts: 0 },
  ];
  const onDown = validateAttack({ ...base, scores: down });
  assert(!onDown.ok && onDown.reason === 'target-down', 'floored target unassailable');
  const onSpec = validateAttack({ ...base, phases: { b: 'spectator' } });
  assert(!onSpec.ok && onSpec.reason === 'target-out', 'spectator unassailable');

  /* Application: pays cost, deals dmg, floors, never mutates. */
  const rot3 = weaponFor('rotten', 3); // cost 105, dmg 120
  const after = applyAttack(base) as NonNullable<ReturnType<typeof applyAttack>>;
  assert(after !== null, 'valid attack applies');
  assert(tbl[0].pts === 300 && tbl[1].pts === 50, 'input table untouched');
  assert(rowOf(after, 'h').pts === 300 - rot3.cost, 'attacker pays the curve');
  assert(rowOf(after, 'b').pts === SCORE_FLOOR, 'overkill damage floors at 0');
  assert(rowOf(after, 'b').name === 'B', 'names survive the fold');
  assert(applyAttack({ ...base, attackerUid: 'ghost', targetUid: 'b' }) === null, 'invalid apply -> null');

  /* Elimination semantics delegate correctly (and/or + sticky left). */
  const solo: ScoreRec[] = [{ uid: 'h', name: 'H', pts: 0 }];
  const sweepAnd = runEliminationPass(solo, { h: 5 }, { h: 'alive' }, { mode: 'and' });
  assert(sweepAnd.eliminated.length === 0, "'and': hp>0 survives despite pts<=floor");
  const sweepOr = runEliminationPass(solo, { h: 5 }, { h: 'alive' }, { mode: 'or' });
  assert(sweepOr.eliminated.length === 1, "'or': pts floor alone kills");
  const sweepDead = runEliminationPass(solo, { h: 0 }, { h: 'alive' });
  assert(
    sweepDead.eliminated.length === 1 &&
      sweepDead.phases.h === 'spectator' &&
      sweepDead.matchOver &&
      sweepDead.winnerUid === null,
    'both conditions met: spectator + match over, void wins',
  );
  const leftSticky = runEliminationPass(solo, { h: 0 }, { h: 'left' });
  assert(leftSticky.eliminated.length === 0 && leftSticky.phases.h === 'left', "'left' is sticky");
  const pair: ScoreRec[] = [
    { uid: 'h', name: 'H', pts: 0 },
    { uid: 'b', name: 'B', pts: 20 },
  ];
  const sweepOne = runEliminationPass(pair, { h: 0, b: 9 }, { h: 'alive', b: 'alive' });
  /* Standings: stable ties + rank deltas + phase surfacing. */
  const tied: ScoreRec[] = [
    { uid: 'a', name: 'A', pts: 100 },
    { uid: 'b', name: 'B', pts: 200 },
    { uid: 'c', name: 'C', pts: 100 },
  ];
  const st1 = liveStandings(tied);
  assert(st1[0].uid === 'b' && st1[1].uid === 'a' && st1[2].uid === 'c', 'stable pts-desc order');
  assert(rankGlyph(st1[0]) === '', 'first reveal shows no glyph');
  const prev = { a: 1, b: 3, c: 2 };
  const st2 = liveStandings(tied, prev, { b: 'spectator' });
  assert(st2[0].uid === 'b' && st2[0].delta === 2 && rankGlyph(st2[0]) === '▲2', '▲2 for the climber');
  assert(st2[1].delta === -1 && rankGlyph(st2[1]) === '▼1', '▼1 for the faller');
  assert(st2[0].phase === 'spectator', 'phases surface on standings rows');

  /* Timer sync: 500ms tolerance with half-RTT compensation. */
  assert(validateTimerSync(30000, 30200).ok, '+200ms drift tolerated');
  assert(validateTimerSync(30000, 29800).ok, '−200ms drift tolerated');
  const bad = validateTimerSync(30000, 30601);
  assert(!bad.ok && bad.driftMs === 601, '601ms drift flagged (> 500ms)');
  const comp = validateTimerSync(30000, 29800, { rttMs: 800 });
  assert(comp.ok && comp.driftMs === 200, 'half-RTT compensation absorbs transit lag');
  assert(TIMER_SYNC_TOLERANCE_MS === 500, 'tolerance rail pinned at 500ms');
}

function selfTest(): void {
  unitTests();
  console.log('unit tests: PASS');
  console.log('');

  const seed = 20260826;
  const m = simulateMatch(seed);

  /* Full-match narrative assertions. */
  const text = m.log.join('\n');
  assert(text.includes('MATCH START'), 'narrative opens with MATCH START');
  assert(text.includes('attack rotation'), 'rotation announced at begin');
  assert(text.includes('parity guard holds'), 'parity guard beat appears at depth ≤ 2');
  assert(m.depthsPlayed >= 12, 'match runs a real distance (≥ 12 depths)');
  assert(m.attacksLanded >= 3, 'multiple attacks land');
  assert(m.cursesLanded >= 1, 'at least one CURSE lands');
  assert(text.includes('with CURSE') && text.includes('-10 hp'), 'curse hpDelta surfaces');
  assert(text.includes('ELIMINATED — SPECTATING'), 'an elimination reaches spectator state');
  assert(text.includes('rage-quits'), 'the rage quit happens');
  assert(m.finalPhases.c === 'left', 'CY ends LEFT (not merely spectator)');
  assert(m.matchOver, 'end-when-one fires');
  assert(m.winnerUid !== null && m.finalPhases[m.winnerUid] === 'alive', 'winner is the sole alive seat');
  const aliveSeats = Object.values(m.finalPhases).filter((p) => p === 'alive').length;
  assert(aliveSeats === 1, 'exactly one seat alive at the whistle');
  for (const s of SEATS) {
    const row = m.finalTable.find((r) => r.uid === s.uid);
    assert(row !== undefined && row.pts >= SCORE_FLOOR, `score floor holds for ${s.name}`);
  }

  /* Determinism: same seed replays byte-identically into a fresh object graph. */
  const m2 = simulateMatch(seed);
  assert(JSON.stringify(m.log) === JSON.stringify(m2.log), 'same seed replays identically');
  assert(m.log !== m2.log, 'replay builds a fresh object graph');

  console.log(m.log.join('\n'));
  console.log('');
  console.log(
    `SELFTEST PASS — ${SEATS.length} players, ${m.depthsPlayed} depths, ` +
      `${m.attacksLanded} attacks (${m.cursesLanded} curses), ` +
      `winner ${seatName(m.winnerUid ?? '')}, final phases ${JSON.stringify(m.finalPhases)}`,
  );
}

/* Node entry: `cd v2 && node src/scenes/mpfeat.ts`. Browser-safe — the gate
 * touches process only behind a typeof guard, so the Vite bundle never runs. */
if (
  typeof process !== 'undefined' &&
  typeof process.argv?.[1] === 'string' &&
  /mpfeat/.test(process.argv[1])
) {
  selfTest();
}
