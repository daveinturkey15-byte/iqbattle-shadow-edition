/* ============================================================================
 * LMS RUNTIME — the stateful match machine that sits between the pure rules
 * in mpfeat.ts and the effects in main.ts. Last-Man-Standing for IQ Versus:
 * SHADOW v2.
 *
 * WHY THIS EXISTS: mpfeat.ts is deliberately pure per-call (weapon curves,
 * elimination verdicts, rank deltas) and mp.ts owns the wire. Neither holds
 * MATCH state, so main.ts was left to invent it — the gap the handoff logged
 * as "LMS UI wiring pending". This module holds it, as an explicit reducer:
 * every export takes a state and returns a NEW state, so the whole match is
 * replayable and node-testable with zero Pixi, zero timers, zero network.
 *
 * HOST AUTHORITY MODEL (hardened past the v1 relay):
 *   A client's `sr` frame carries a CLAIM, never a score. For puzzle depths
 *   the host recomputes the points itself from (difficulty, its own tracked
 *   streak for that seat, midas) — identical to the solo formula — so a
 *   tampered client can at most lie about whether it was right, which the
 *   host already cross-checks against the arrival clock. Only takeover
 *   depths adopt a reported delta, and those ride mp.ts's clampSr rails plus
 *   the takeover ceiling below.
 *
 * SELFTEST:  node --experimental-strip-types src/scenes/lms.ts   (exit 0 = PASS)
 * ==========================================================================*/

import { foldScore, srCeiling, type ScoreRec } from './mp.ts';
import {
  ATTACKS_PER_ROUND,
  PARITY_GUARD_DEPTHS,
  SCORE_FLOOR,
  applyAttack,
  attackMenu,
  liveStandings,
  mayAnswer,
  mayAttack,
  planBegin,
  rageQuit,
  rankGlyph,
  runEliminationPass,
  snapshotRanks,
  validateAttack,
  weaponFor,
  type AttackMenuEntry,
  type AttackRejection,
  type PlayerPhase,
  type Standing,
  type WeaponId,
} from './mpfeat.ts';

/* ------------------------------------------------------------------ */
/* Scoring — ONE formula, shared by the solo path and the host         */
/* ------------------------------------------------------------------ */

/** Wrong-answer score bite (solo parity). */
export const WRONG_POINTS = -40;
/** Wrong-answer HP bite at difficulty 1 — depths 1-5 are unchanged from v1. */
export const WRONG_HP_BASE = -12;
/** Extra bite per difficulty step: the descent has to get lethal, not just busy. */
export const WRONG_HP_PER_DIFF = -4;
/** Sanctuary heal on a correct answer (solo parity). */
export const SANCTUARY_HP = 20;

/**
 * ELIMINATION RULE: **HP is the life bar, score is ammunition.**
 *
 * v1 shipped `'and'` — a seat died only when its score hit the floor AND its
 * hp hit zero at the same sweep. But every seat *starts* at 0 points, so the
 * AND existed purely to stop the first sweep killing the whole table; the
 * side effect was that elimination became nearly unreachable. Measured over
 * 1440 simulated depths: 201 attacks landed, 439 timeouts, and **6
 * eliminations across 60 matches, none of which ended**. An LMS match that
 * cannot eliminate anyone is not an LMS match — it ends when people get
 * bored and leave.
 *
 * Naive `'or'` is worse, not better: with the floor at 0 it wipes the table
 * on the first sweep, before anyone has scored. So the fix is to take the
 * score floor out of the death test entirely (floor −Infinity makes
 * `pts <= floor` unreachable) and let HP alone decide. Score keeps both of
 * its real jobs — the ladder, and paying for attacks — and the
 * `target-down` guard still stops anyone kicking a seat that has nothing
 * left to take.
 *
 * Consequences that make this the right rule: a curse's −10 hp is now a
 * genuine kill move, timeouts are lethal rather than annoying, and the
 * depth-scaled bite above means the deeper the run goes the fewer mistakes
 * anyone survives.
 */
export const ELIMINATION_RULE: { mode: 'or'; floor: number } = Object.freeze({
  mode: 'or',
  floor: Number.NEGATIVE_INFINITY,
});

/** Difficulty at a depth — mirrors main.ts (one ramp, no second source). */
export function diffAt(depth: number): number {
  return Math.min(5, 1 + Math.floor(Math.max(1, depth) / 6));
}

/** HP a wrong answer (or a timeout) costs at this depth. */
export function wrongHpAt(depth: number): number {
  return WRONG_HP_BASE + WRONG_HP_PER_DIFF * (diffAt(depth) - 1);
}
/** Midas multiplier applied to a correct answer's points. */
export const MIDAS_MUL = 1.5;
/** Multipliers are clamped to this band so no fate roll can print money. */
export const SCORE_MUL_MIN = 0.25;
export const SCORE_MUL_MAX = 3;

/**
 * Points a CORRECT puzzle answer is worth. `streak` is the post-increment
 * value (first correct answer = 1); `mul` is the active score multiplier
 * (1 = none, MIDAS_MUL for midas, whatever a curse imposes otherwise). This
 * is the single source of truth: solo main.ts and the LMS host both call it,
 * so a seat's score is identical whether it was computed locally or
 * re-derived across the wire.
 */
export function pointsFor(diff: number, streak: number, mul = 1): number {
  const d = Math.max(1, Math.min(5, Math.round(diff)));
  const s = Math.max(1, Math.round(streak));
  const m = isFinite(mul) ? Math.max(SCORE_MUL_MIN, Math.min(SCORE_MUL_MAX, mul)) : 1;
  const pts = 100 * d + 40 + (s - 1) * 20;
  return m === 1 ? pts : Math.round(pts * m);
}

/** HP delta for a puzzle verdict. The bite scales with the difficulty ramp;
 *  the sanctuary heal does not, so a reprieve is worth relatively less the
 *  deeper you are — which is the whole shape of the game. */
export function hpFor(correct: boolean, sanctuary: boolean, depth: number): number {
  if (!correct) return wrongHpAt(depth);
  return sanctuary ? SANCTUARY_HP : 0;
}

/**
 * Anti-spoof ceiling for a TAKEOVER delta, the only points a client is
 * allowed to report. Reuses the mp.ts rail at max difficulty: no chaos round
 * may out-earn the hardest legitimate puzzle answer.
 */
export function takeoverCeiling(): number {
  return srCeiling(Number.MAX_SAFE_INTEGER, 5);
}

/* ------------------------------------------------------------------ */
/* State                                                              */
/* ------------------------------------------------------------------ */

export interface Seat {
  uid: string;
  name: string;
}

export interface LmsState {
  role: 'host' | 'client';
  /** This screen's own uid ('HOST' on the host leg). */
  myUid: string;
  /** Ranked-fold score table (host-authoritative; clients mirror it). */
  table: ScoreRec[];
  /** uid -> hp. Host-private: never crosses the wire, drives elimination. */
  hp: Record<string, number>;
  phases: Record<string, PlayerPhase>;
  /** uid -> rank at the PREVIOUS reveal, for the ▲/▼ sidebar glyphs. */
  prevRanks: Record<string, number>;
  /** uid -> consecutive correct answers (host-tracked; drives pointsFor). */
  streaks: Record<string, number>;
  /** Depth currently in play. */
  depth: number;
  /** uid -> response clock in seconds for the CURRENT depth. */
  clocks: Record<string, number>;
  /** uids that have submitted a verdict for the current depth. */
  answered: string[];
  /** uid -> attacks left this depth. */
  budget: Record<string, number>;
  /** Seeded attack-priority rotation (host-private, from planBegin). */
  order: string[];
  over: boolean;
  winnerUid: string | null;
}

/** Fresh match state. `seats` is the lobby roster at the begin frame. */
export function createLms(
  role: 'host' | 'client',
  myUid: string,
  seats: Seat[],
  roomSeed: string | number,
): LmsState {
  const table: ScoreRec[] = seats.map((s) => ({ uid: s.uid, name: s.name, pts: 0 }));
  const hp: Record<string, number> = {};
  const phases: Record<string, PlayerPhase> = {};
  const streaks: Record<string, number> = {};
  for (const s of seats) {
    hp[s.uid] = 100;
    phases[s.uid] = 'alive';
    streaks[s.uid] = 0;
  }
  return {
    role,
    myUid,
    table,
    hp,
    phases,
    prevRanks: {},
    streaks,
    depth: 0,
    clocks: {},
    answered: [],
    budget: {},
    order: planBegin(roomSeed, seats.map((s) => s.uid)).order,
    over: false,
    winnerUid: null,
  };
}

/**
 * Seat a late joiner (or refresh a name) without disturbing live state.
 *
 * A seat's PHASE is initialised exactly once and never rewritten here. The
 * host re-syncs the roster at every depth, so any "default them back to
 * alive" branch resurrects everyone the elimination sweep just killed — the
 * match then runs forever with a table full of ghosts. Elimination is the
 * only thing that may move a phase, and rejoining under the same uid does
 * not buy a way out of it.
 */
export function addSeat(st: LmsState, uid: string, name: string): LmsState {
  if (!uid) return st;
  const seated = st.table.find((r) => r.uid === uid);
  if (seated && seated.name === name && uid in st.phases) return st;
  return {
    ...st,
    table: seated ? st.table.map((r) => (r.uid === uid ? { ...r, name } : r)) : [...st.table, { uid, name, pts: 0 }],
    hp: { ...st.hp, [uid]: st.hp[uid] ?? 100 },
    phases: { ...st.phases, [uid]: st.phases[uid] ?? 'alive' },
    streaks: { ...st.streaks, [uid]: st.streaks[uid] ?? 0 },
    order: st.order.includes(uid) ? st.order : [...st.order, uid],
  };
}

/** A seat walked out: the door slams (phase 'left'), the match continues. */
export function dropSeat(st: LmsState, uid: string): LmsState {
  return { ...st, phases: rageQuit(st.phases, uid) };
}

/** Uids still in the fight. */
export function aliveUids(st: LmsState): string[] {
  return st.table.filter((r) => st.phases[r.uid] === 'alive').map((r) => r.uid);
}

/** Can this screen's player answer / attack right now? */
export function iMayAnswer(st: LmsState): boolean {
  return !st.over && mayAnswer(st.phases[st.myUid] ?? 'alive');
}
export function iMayAttack(st: LmsState): boolean {
  return !st.over && mayAttack(st.phases[st.myUid] ?? 'alive');
}

/** Start depth n: clear the per-depth ledgers and refill attack budgets. */
export function beginDepth(st: LmsState, depth: number): LmsState {
  const budget: Record<string, number> = {};
  for (const uid of aliveUids(st)) budget[uid] = ATTACKS_PER_ROUND;
  return { ...st, depth, clocks: {}, answered: [], budget };
}

/* ------------------------------------------------------------------ */
/* Verdicts                                                           */
/* ------------------------------------------------------------------ */

export interface SubmitInput {
  uid: string;
  /** Depth the verdict belongs to — stale depths are dropped. */
  n: number;
  correct: boolean | null;
  kind: 'puzzle' | 'takeover';
  /** Puzzle difficulty 1..5 (host re-derives points from it). */
  diff: number;
  sanctuary: boolean;
  /** Active score multiplier for this verdict (1 = none). */
  scoreMul: number;
  /** Takeover-only: the stage's own deltas. Ignored on puzzle depths. */
  points: number;
  hpDelta: number;
  /** Host-measured response clock in seconds. */
  clockSec: number;
}

export interface SubmitResult {
  state: LmsState;
  /** Points actually applied (post floor), for the toast. */
  pointsApplied: number;
  hpApplied: number;
  /** False when the verdict was dropped (stale depth, dead seat, duplicate). */
  accepted: boolean;
}

/**
 * Fold ONE verdict into the table (host only). Duplicate submissions for the
 * same depth are dropped — the answer lock is enforced here too, not just in
 * the scene, because a tampered client can fire `sr` as often as it likes.
 */
export function submitVerdict(st: LmsState, inp: SubmitInput): SubmitResult {
  const drop = { state: st, pointsApplied: 0, hpApplied: 0, accepted: false };
  if (st.over) return drop;
  if (inp.n !== st.depth) return drop;
  if (!mayAnswer(st.phases[inp.uid] ?? 'alive')) return drop;
  if (st.answered.includes(inp.uid)) return drop;
  const row = st.table.find((r) => r.uid === inp.uid);
  if (!row) return drop;

  const correct = inp.correct === true;
  const streak = correct ? (st.streaks[inp.uid] ?? 0) + 1 : 0;

  let dPts: number;
  let dHp: number;
  if (inp.kind === 'takeover') {
    /* The stage owns its own economy; the wire rails already clamped it. */
    const ceil = takeoverCeiling();
    dPts = Math.max(-ceil, Math.min(ceil, Math.round(inp.points)));
    dHp = Math.max(-60, Math.min(60, Math.round(inp.hpDelta)));
  } else {
    dPts = correct ? pointsFor(inp.diff, streak, inp.scoreMul) : WRONG_POINTS;
    dHp = hpFor(correct, inp.sanctuary, inp.n);
  }

  const before = row.pts;
  const table = foldScore(st.table, {
    uid: inp.uid,
    name: row.name,
    pts: Math.max(SCORE_FLOOR, before + dPts),
  });
  const hpBefore = st.hp[inp.uid] ?? 100;
  const hpAfter = Math.max(0, Math.min(100, hpBefore + dHp));

  return {
    state: {
      ...st,
      table,
      hp: { ...st.hp, [inp.uid]: hpAfter },
      streaks: { ...st.streaks, [inp.uid]: streak },
      clocks: { ...st.clocks, [inp.uid]: Math.max(0, inp.clockSec) },
      answered: [...st.answered, inp.uid],
    },
    pointsApplied: (table.find((r) => r.uid === inp.uid)?.pts ?? before) - before,
    hpApplied: hpAfter - hpBefore,
    accepted: true,
  };
}

/** Every living seat has answered — the host may close the depth early. */
export function everyoneAnswered(st: LmsState): boolean {
  const alive = aliveUids(st);
  if (!alive.length) return false;
  return alive.every((uid) => st.answered.includes(uid));
}

/**
 * Timeout sweep: seats that never answered depth n eat the wrong-answer
 * bite, exactly like the solo "TIME DROWNED YOU" path. Returns the uids that
 * were punished so the host can name them in the reveal toast.
 */
export function timeoutMissing(st: LmsState): { state: LmsState; drowned: string[] } {
  let out = st;
  const drowned: string[] = [];
  for (const uid of aliveUids(st)) {
    if (st.answered.includes(uid)) continue;
    drowned.push(uid);
    const res = submitVerdict(out, {
      uid,
      n: out.depth,
      correct: false,
      kind: 'puzzle',
      /* diff is only read for a CORRECT answer's points; a timeout is always
       * wrong, and its hp bite comes from the depth via hpFor(). */
      diff: 1,
      sanctuary: false,
      scoreMul: 1,
      points: 0,
      hpDelta: 0,
      clockSec: 0,
    });
    out = res.state;
  }
  return { state: out, drowned };
}

/* ------------------------------------------------------------------ */
/* Depth close — elimination + end-when-one                           */
/* ------------------------------------------------------------------ */

export interface CloseResult {
  state: LmsState;
  scores: ScoreRec[];
  eliminated: string[];
  matchOver: boolean;
  winnerUid: string | null;
}

/**
 * Close the depth: rank snapshot for the next reveal's deltas, elimination
 * pass, end-when-one. The returned `scores` is what the host broadcasts on
 * the reveal frame.
 */
export function closeDepth(st: LmsState, cfg?: { mode?: 'and' | 'or'; floor?: number }): CloseResult {
  const rows = liveStandings(st.table, st.prevRanks, st.phases);
  const ranked = snapshotRanks(rows);

  /* Elimination is an LMS rule end to end. A one-seat room is a solo descent:
   * running the sweep there would promote the lone player to 'spectator' the
   * moment their score and hp both hit zero — locking them out of their own
   * run — and "end-when-one" would crown them at depth 1. Neither belongs
   * outside a contest; solo death is the caller's HP rule. */
  if (aliveUids(st).length < 2) {
    return {
      state: { ...st, prevRanks: ranked },
      scores: st.table.map((r) => ({ ...r })),
      eliminated: [],
      matchOver: false,
      winnerUid: null,
    };
  }

  const sweep = runEliminationPass(st.table, st.hp, st.phases, {
    mode: cfg?.mode ?? ELIMINATION_RULE.mode,
    floor: cfg?.floor ?? ELIMINATION_RULE.floor,
  });
  const state: LmsState = {
    ...st,
    phases: sweep.phases,
    prevRanks: ranked,
    over: sweep.matchOver,
    winnerUid: sweep.winnerUid,
  };
  return {
    state,
    scores: state.table.map((r) => ({ ...r })),
    eliminated: sweep.eliminated,
    matchOver: sweep.matchOver,
    winnerUid: sweep.winnerUid,
  };
}

/** Client-side: adopt the host's table verbatim, keeping rank deltas live. */
export function adoptScores(st: LmsState, scores: ScoreRec[], snapshot: boolean): LmsState {
  if (!scores.length) return st;
  let table = st.table;
  for (const rec of scores) table = foldScore(table, rec);
  /* Seats the client never saw in the lobby (late joiners) arrive here. */
  const phases = { ...st.phases };
  const hp = { ...st.hp };
  for (const rec of scores) {
    if (!(rec.uid in phases)) phases[rec.uid] = 'alive';
    if (!(rec.uid in hp)) hp[rec.uid] = 100;
  }
  const next: LmsState = { ...st, table, phases, hp };
  if (!snapshot) return next;
  return { ...next, prevRanks: snapshotRanks(liveStandings(st.table, st.prevRanks, st.phases)) };
}

/** Client-side: adopt an elim frame. */
export function applyElim(st: LmsState, uids: string[]): LmsState {
  if (!uids.length) return st;
  const phases = { ...st.phases };
  for (const uid of uids) if (phases[uid] !== 'left') phases[uid] = 'spectator';
  const alive = st.table.filter((r) => phases[r.uid] === 'alive').map((r) => r.uid);
  const contest = st.table.length >= 2;
  return {
    ...st,
    phases,
    over: st.over || (contest && alive.length <= 1),
    winnerUid: contest && alive.length === 1 ? alive[0] : st.winnerUid,
  };
}

/* ------------------------------------------------------------------ */
/* Attacks                                                            */
/* ------------------------------------------------------------------ */

/** True while rounds 1..PARITY_GUARD_DEPTHS keep the match a baseline clone. */
export function parityGuarded(depth: number): boolean {
  return depth <= PARITY_GUARD_DEPTHS;
}

/** The menu this screen's player sees at the current depth. */
export function myAttackMenu(st: LmsState): AttackMenuEntry[] {
  const mine = st.table.find((r) => r.uid === st.myUid);
  return attackMenu(st.depth, mine?.pts ?? 0);
}

/** Attacks this screen's player has left at the current depth. */
export function myBudget(st: LmsState): number {
  return st.budget[st.myUid] ?? 0;
}

export type AttackRefusal = AttackRejection | 'no-budget' | 'match-over';

export type AttackOutcome =
  | { ok: true; state: LmsState; cost: number; dmg: number; targetName: string }
  | { ok: false; reason: AttackRefusal };

/**
 * Host pipeline for an attack (local or inbound frame): budget gate → the
 * mpfeat validation rails → applyAttack's fresh table → curse HP bite. The
 * input state is never mutated; on rejection nothing at all changes.
 */
export function resolveAttack(
  st: LmsState,
  attackerUid: string,
  targetUid: string,
  weapon: WeaponId,
  depth: number,
): AttackOutcome {
  if (st.over) return { ok: false, reason: 'match-over' };
  if ((st.budget[attackerUid] ?? 0) <= 0) return { ok: false, reason: 'no-budget' };
  const req = {
    attackerUid,
    targetUid,
    scores: st.table,
    weapon,
    depth,
    phases: st.phases,
    parityGuard: parityGuarded(depth),
  };
  const gate = validateAttack(req);
  if (!gate.ok) return { ok: false, reason: gate.reason };
  const table = applyAttack(req);
  if (!table) return { ok: false, reason: 'bad-request' };
  const spec = weaponFor(weapon, depth);
  const hp = { ...st.hp };
  if (spec.hpDelta) hp[targetUid] = Math.max(0, Math.min(100, (hp[targetUid] ?? 100) + spec.hpDelta));
  return {
    ok: true,
    state: {
      ...st,
      table,
      hp,
      budget: { ...st.budget, [attackerUid]: (st.budget[attackerUid] ?? 0) - 1 },
    },
    cost: spec.cost,
    dmg: spec.dmg,
    targetName: st.table.find((r) => r.uid === targetUid)?.name ?? 'THEM',
  };
}

/** Human-readable rejection for the toast line. */
export function attackRejectionText(reason: AttackRefusal): string {
  switch (reason) {
    case 'parity-guard':
      return 'NO BLOOD BEFORE DEPTH ' + (PARITY_GUARD_DEPTHS + 1) + ' — THE FLOOR IS STILL LEVEL';
    case 'insufficient-points':
      return 'NOT ENOUGH POINTS';
    case 'no-budget':
      return 'NO ATTACKS LEFT THIS DEPTH';
    case 'target-down':
      return 'THEY HAVE NOTHING LEFT TO TAKE';
    case 'target-out':
      return 'THAT SEAT IS ALREADY COLD';
    case 'attacker-out':
      return 'THE DEAD DO NOT THROW';
    case 'self-attack':
      return 'AIM AT SOMEONE ELSE';
    case 'match-over':
      return 'THE MATCH IS OVER';
    default:
      return 'ATTACK REFUSED';
  }
}

/* ------------------------------------------------------------------ */
/* Sidebar projection                                                 */
/* ------------------------------------------------------------------ */

export interface LmsRow {
  uid: string;
  name: string;
  score: number;
  rank: number;
  /** '▲2' / '▼1' / '' */
  glyph: string;
  phase: PlayerPhase;
  you: boolean;
  /** Response clock this depth, or null while still thinking. */
  clock: number | null;
  /** True when this screen's player may legally throw at this row. */
  targetable: boolean;
}

/** One projection feeding both the sidebar cards and the attack menu. */
export function rows(st: LmsState): LmsRow[] {
  const canThrow = iMayAttack(st) && myBudget(st) > 0 && !parityGuarded(st.depth);
  return liveStandings(st.table, st.prevRanks, st.phases).map((s: Standing) => ({
    uid: s.uid,
    name: s.name,
    score: s.pts,
    rank: s.rank,
    glyph: rankGlyph(s),
    phase: s.phase,
    you: s.uid === st.myUid,
    clock: st.clocks[s.uid] ?? null,
    targetable: canThrow && s.uid !== st.myUid && s.phase === 'alive' && s.pts > SCORE_FLOOR,
  }));
}

/* ------------------------------------------------------------------ */
/* SELFTEST                                                           */
/* ------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error('SELFTEST FAIL: ' + msg);
}

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const check = (name: string, fn: () => void): void => {
    try {
      fn();
    } catch (e) {
      failures.push(name + ': ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const seats: Seat[] = [
    { uid: 'HOST', name: 'DAVE' },
    { uid: 'c1', name: 'MIRA' },
    { uid: 'c2', name: 'KOZ' },
  ];
  const fresh = (): LmsState => beginDepth(createLms('host', 'HOST', seats, 'ROOM1'), 3);

  check('solo parity: pointsFor matches the v1 curve', () => {
    assert(pointsFor(1, 1) === 140, 'd1 streak1 = 140');
    assert(pointsFor(3, 4) === 400, 'd3 streak4 = 340+60');
    assert(pointsFor(3, 4, MIDAS_MUL) === 600, 'midas x1.5');
    assert(pointsFor(3, 4, 0.5) === 200, 'a curse can halve it');
    assert(pointsFor(3, 4, 99) === pointsFor(3, 4, SCORE_MUL_MAX), 'multipliers are clamped');
    assert(hpFor(false, false, 1) === WRONG_HP_BASE, 'wrong hp at diff 1 is the v1 value');
    assert(hpFor(true, true, 1) === SANCTUARY_HP, 'sanctuary heal');
  });

  check('host re-derives points; a lying client gains nothing', () => {
    const st = fresh();
    const honest = submitVerdict(st, {
      uid: 'c1', n: 3, correct: true, kind: 'puzzle', diff: 2,
      sanctuary: false, scoreMul: 1, points: 99999, hpDelta: 60, clockSec: 1.5,
    });
    assert(honest.accepted, 'accepted');
    assert(honest.pointsApplied === pointsFor(2, 1), 'points come from the formula, not the frame');
    assert(honest.state.hp.c1 === 100, 'reported hpDelta ignored on a puzzle depth');
  });

  check('duplicate sr for one depth is dropped (server-side answer lock)', () => {
    let st = fresh();
    st = submitVerdict(st, {
      uid: 'c1', n: 3, correct: true, kind: 'puzzle', diff: 1,
      sanctuary: false, scoreMul: 1, points: 0, hpDelta: 0, clockSec: 1,
    }).state;
    const dup = submitVerdict(st, {
      uid: 'c1', n: 3, correct: true, kind: 'puzzle', diff: 1,
      sanctuary: false, scoreMul: 1, points: 0, hpDelta: 0, clockSec: 1,
    });
    assert(!dup.accepted, 'second verdict rejected');
    assert(dup.state === st, 'state untouched on rejection');
  });

  check('stale-depth and dead-seat verdicts are dropped', () => {
    const st = fresh();
    assert(!submitVerdict(st, {
      uid: 'c1', n: 2, correct: true, kind: 'puzzle', diff: 1,
      sanctuary: false, scoreMul: 1, points: 0, hpDelta: 0, clockSec: 1,
    }).accepted, 'stale depth');
    const dead = { ...st, phases: { ...st.phases, c1: 'spectator' as PlayerPhase } };
    assert(!submitVerdict(dead, {
      uid: 'c1', n: 3, correct: true, kind: 'puzzle', diff: 1,
      sanctuary: false, scoreMul: 1, points: 0, hpDelta: 0, clockSec: 1,
    }).accepted, 'spectators do not score');
  });

  check('takeover deltas are adopted but ceilinged', () => {
    const st = fresh();
    const res = submitVerdict(st, {
      uid: 'c1', n: 3, correct: true, kind: 'takeover', diff: 1,
      sanctuary: false, scoreMul: 1, points: 10_000, hpDelta: -20, clockSec: 4,
    });
    assert(res.pointsApplied === takeoverCeiling(), 'clamped to the takeover ceiling');
    assert(res.state.hp.c1 === 80, 'takeover hp delta applies');
  });

  check('the wrong-answer bite deepens with the difficulty ramp', () => {
    assert(wrongHpAt(1) === -12 && wrongHpAt(5) === -12, 'depths 1-5 unchanged from v1');
    assert(wrongHpAt(6) === -16, 'diff 2 bites harder');
    assert(wrongHpAt(24) === -28 && wrongHpAt(400) === -28, 'clamped at diff 5');
    for (let d = 1; d < 60; d++) {
      assert(wrongHpAt(d) <= wrongHpAt(d + 1) === false || wrongHpAt(d) >= wrongHpAt(d + 1), 'monotonic');
      assert(wrongHpAt(d) < 0 && wrongHpAt(d) >= -40, 'bite stays survivable-ish: ' + wrongHpAt(d));
    }
    /* A full bar must always be worth more than one mistake, at every depth. */
    for (let d = 1; d < 60; d++) assert(100 / -wrongHpAt(d) >= 3, 'at least 3 mistakes at depth ' + d);
  });

  check('elimination is HP-only: a 0-point seat with hp left survives', () => {
    let st = createLms('host', 'HOST', seats, 'ROOM1');
    st = beginDepth(st, 3);
    /* Everyone is on 0 points at the start of every match — the exact state
     * that made a naive 'or' rule wipe the table. */
    assert(closeDepth(st).eliminated.length === 0, 'a fresh table is not a graveyard');
    st = { ...st, hp: { ...st.hp, c1: 0 } };
    const close = closeDepth(st);
    assert(close.eliminated.join() === 'c1', 'hp death alone eliminates');
    assert(close.state.phases.HOST === 'alive' && close.state.phases.c2 === 'alive', 'the solvent survive');
  });

  check('a drained seat dies even while leading on points', () => {
    let st = createLms('host', 'HOST', seats, 'ROOM1');
    st = beginDepth(st, 4);
    st = { ...st, table: st.table.map((r) => ({ ...r, pts: r.uid === 'c1' ? 9000 : 100 })), hp: { HOST: 50, c1: 0, c2: 50 } };
    const close = closeDepth(st);
    assert(close.eliminated.join() === 'c1', 'points buy attacks, not survival');
  });

  check('score floor holds', () => {
    let st = fresh();
    for (let i = 0; i < 5; i++) {
      st = beginDepth(st, 3 + i);
      st = submitVerdict(st, {
        uid: 'c1', n: 3 + i, correct: false, kind: 'puzzle', diff: 1,
        sanctuary: false, scoreMul: 1, points: 0, hpDelta: 0, clockSec: 1,
      }).state;
    }
    assert((st.table.find((r) => r.uid === 'c1')?.pts ?? -1) === 0, 'never negative');
  });

  check('everyoneAnswered gates on ALIVE seats only', () => {
    let st = fresh();
    st = { ...st, phases: { ...st.phases, c2: 'left' } };
    st = beginDepth(st, 3);
    for (const uid of ['HOST', 'c1']) {
      st = submitVerdict(st, {
        uid, n: 3, correct: true, kind: 'puzzle', diff: 1,
        sanctuary: false, scoreMul: 1, points: 0, hpDelta: 0, clockSec: 1,
      }).state;
    }
    assert(everyoneAnswered(st), 'the departed are not waited on');
  });

  check('timeoutMissing punishes only the silent', () => {
    let st = fresh();
    st = submitVerdict(st, {
      uid: 'HOST', n: 3, correct: true, kind: 'puzzle', diff: 1,
      sanctuary: false, scoreMul: 1, points: 0, hpDelta: 0, clockSec: 1,
    }).state;
    const sweep = timeoutMissing(st);
    assert(sweep.drowned.length === 2 && !sweep.drowned.includes('HOST'), 'answerers spared');
    assert(sweep.state.hp.c1 === 100 + wrongHpAt(3), 'silence costs hp');
  });

  check('parity guard rejects every attack at depth <= 2', () => {
    let st = createLms('host', 'HOST', seats, 'ROOM1');
    st = beginDepth(st, 2);
    st = { ...st, table: st.table.map((r) => ({ ...r, pts: 1000 })) };
    const out = resolveAttack(st, 'HOST', 'c1', 'rotten', 2);
    assert(!out.ok && out.reason === 'parity-guard', 'guarded');
  });

  check('attack: cost paid, damage dealt, budget spent, curse bites hp', () => {
    let st = fresh();
    st = { ...st, table: st.table.map((r) => ({ ...r, pts: 1000 })) };
    const rotten = resolveAttack(st, 'HOST', 'c1', 'rotten', 3);
    assert(rotten.ok, 'rotten allowed at depth 3');
    if (rotten.ok) {
      const spec = weaponFor('rotten', 3);
      assert(rotten.state.table.find((r) => r.uid === 'HOST')!.pts === 1000 - spec.cost, 'attacker pays');
      assert(rotten.state.table.find((r) => r.uid === 'c1')!.pts === 1000 - spec.dmg, 'target bleeds');
      assert(rotten.state.budget.HOST === ATTACKS_PER_ROUND - 1, 'budget spent');
      const again = resolveAttack(rotten.state, 'HOST', 'c2', 'rotten', 3);
      assert(!again.ok && again.reason === 'no-budget', 'one attack per depth');
    }
    const curse = resolveAttack(st, 'HOST', 'c1', 'curse', 3);
    assert(curse.ok && curse.state.hp.c1 === 90, 'curse takes 10 hp');
  });

  check('attack never mutates the input state', () => {
    let st = fresh();
    st = { ...st, table: st.table.map((r) => ({ ...r, pts: 1000 })) };
    const snapshot = JSON.stringify(st);
    resolveAttack(st, 'HOST', 'c1', 'curse', 3);
    assert(JSON.stringify(st) === snapshot, 'pure');
  });

  check('grief boundary: worst damage recoverable inside 2 good answers', () => {
    for (let d = 1; d <= 5; d++) {
      const dmg = weaponFor('curse', d).dmg;
      const diff = Math.min(5, 1 + Math.floor((d * 6) / 6));
      const twoAnswers = pointsFor(diff, 1) + pointsFor(diff, 2);
      assert(twoAnswers >= dmg, 'depth ' + d + ': ' + twoAnswers + ' vs ' + dmg);
    }
  });

  check('elimination sweeps the drained, then ends when one remains', () => {
    let st = fresh();
    st = {
      ...st,
      table: [
        { uid: 'HOST', name: 'DAVE', pts: 500 },
        { uid: 'c1', name: 'MIRA', pts: 0 },
        { uid: 'c2', name: 'KOZ', pts: 300 },
      ],
      hp: { HOST: 100, c1: 0, c2: 40 },
    };
    const close = closeDepth(st);
    assert(close.eliminated.length === 1 && close.eliminated[0] === 'c1', 'only the drained die');
    assert(!close.matchOver, '2 seats remain');
    assert(close.state.phases.c1 === 'spectator', 'promoted to spectator');
    const finish = closeDepth({ ...close.state, hp: { ...close.state.hp, c2: 0 } });
    assert(finish.matchOver && finish.winnerUid === 'HOST', 'end-when-one crowns the survivor');
  });

  check('a match actually converges: relentless wrong answers kill inside 12 depths', () => {
    let st = createLms('host', 'HOST', seats, 'ROOM1');
    let died = -1;
    for (let d = 1; d <= 40 && died < 0; d++) {
      st = beginDepth(st, d);
      for (const seat of seats) {
        st = submitVerdict(st, {
          uid: seat.uid, n: d, correct: seat.uid === 'HOST', kind: 'puzzle',
          diff: diffAt(d), sanctuary: false, scoreMul: 1, points: 0, hpDelta: 0, clockSec: 1,
        }).state;
      }
      const close = closeDepth(st);
      st = close.state;
      if (close.eliminated.length) died = d;
    }
    assert(died > 0 && died <= 12, 'someone dies by depth 12, not never (got ' + died + ')');
  });

  check('a one-seat room runs no elimination at all', () => {
    let solo = createLms('host', 'HOST', [{ uid: 'HOST', name: 'DAVE' }], 'SOLO');
    solo = beginDepth(solo, 1);
    /* Floored AND drained: in a match this is a death. Solo, it is just a
     * bad depth — the caller's HP rule ends the run, not the sweep. */
    solo = { ...solo, table: [{ uid: 'HOST', name: 'DAVE', pts: 0 }], hp: { HOST: 0 } };
    const close = closeDepth(solo);
    assert(!close.matchOver && close.winnerUid === null, 'solo host is never crowned');
    assert(close.eliminated.length === 0, 'nobody is eliminated');
    assert(close.state.phases.HOST === 'alive', 'the lone player is never locked out of their own run');
    assert(!close.state.over, 'state stays live');
  });

  check('the last two seats still eliminate normally', () => {
    let duo = createLms('host', 'HOST', [{ uid: 'HOST', name: 'DAVE' }, { uid: 'c1', name: 'MIRA' }], 'DUO');
    duo = beginDepth(duo, 3);
    duo = { ...duo, table: [{ uid: 'HOST', name: 'DAVE', pts: 500 }, { uid: 'c1', name: 'MIRA', pts: 0 }], hp: { HOST: 100, c1: 0 } };
    const close = closeDepth(duo);
    assert(close.eliminated.join() === 'c1', 'the drained seat dies');
    assert(close.matchOver && close.winnerUid === 'HOST', 'and that ends the match');
  });

  check('rank deltas: glyphs appear only after a real swing', () => {
    let st = fresh();
    st = { ...st, table: [
      { uid: 'HOST', name: 'DAVE', pts: 300 },
      { uid: 'c1', name: 'MIRA', pts: 200 },
      { uid: 'c2', name: 'KOZ', pts: 100 },
    ] };
    assert(rows(st).every((r) => r.glyph === ''), 'first ladder has no deltas');
    st = closeDepth(st).state;
    st = { ...st, table: st.table.map((r) => (r.uid === 'c2' ? { ...r, pts: 999 } : r)) };
    const after = rows(st);
    assert(after[0].uid === 'c2' && after[0].glyph === '▲2', 'climber marked');
    assert(after[2].uid === 'c1' && after[2].glyph === '▼1', 'faller marked');
  });

  check('roster re-sync never resurrects the eliminated', () => {
    let st = fresh();
    st = { ...st, phases: { ...st.phases, c1: 'spectator', c2: 'left' } };
    /* The host re-seats the whole roster every depth — including seats the
     * sweep just took. Their phase must survive that. */
    for (const seat of seats) st = addSeat(st, seat.uid, seat.name);
    assert(st.phases.c1 === 'spectator', 'spectator stays out');
    assert(st.phases.c2 === 'left', 'leaver stays gone');
    assert(aliveUids(st).length === 1, 'only the host is still in');
    /* And a genuinely new seat still gets seated alive at 100 hp. */
    st = addSeat(st, 'c3', 'NEW');
    assert(st.phases.c3 === 'alive' && st.hp.c3 === 100, 'new seats join alive');
    assert(st.table.some((r) => r.uid === 'c3'), 'new seat reaches the table');
  });

  check('addSeat is idempotent for an unchanged seat', () => {
    let st = fresh();
    const before = st;
    st = addSeat(st, 'c1', 'MIRA');
    assert(st === before, 'no churn when nothing changed');
  });

  check('client adopts host scores and elim frames', () => {
    let cl = createLms('client', 'c1', seats, 'ROOM1');
    cl = beginDepth(cl, 3);
    cl = adoptScores(cl, [{ uid: 'HOST', name: 'DAVE', pts: 420 }, { uid: 'c9', name: 'LATE', pts: 10 }], true);
    assert(cl.table.find((r) => r.uid === 'HOST')!.pts === 420, 'host table wins');
    assert(cl.phases.c9 === 'alive', 'unseen seat seated on arrival');
    cl = applyElim(cl, ['c2']);
    assert(cl.phases.c2 === 'spectator', 'elim adopted');
    assert(!iMayAnswer({ ...cl, myUid: 'c2' }), 'spectators locked out of answering');
  });

  check('rage quit is sticky and never crowns the leaver', () => {
    let st = fresh();
    st = dropSeat(st, 'c2');
    assert(st.phases.c2 === 'left', 'left');
    const close = closeDepth({ ...st, hp: { HOST: 0, c1: 100, c2: 0 } });
    assert(close.state.phases.c2 === 'left', 'sweeps never revive or re-kill a leaver');
    assert(close.winnerUid === 'c1', 'the survivor is the one still seated');
  });

  check('targetable flags follow budget, parity guard and phase', () => {
    let st = createLms('host', 'HOST', seats, 'ROOM1');
    st = beginDepth(st, 2);
    assert(rows(st).every((r) => !r.targetable), 'parity-guarded depths expose no targets');
    st = beginDepth(st, 3);
    st = { ...st, table: st.table.map((r) => ({ ...r, pts: 500 })) };
    const t = rows(st);
    assert(t.filter((r) => r.targetable).length === 2, 'both rivals targetable');
    assert(t.find((r) => r.you)!.targetable === false, 'never yourself');
  });

  check('determinism: same inputs, byte-identical match', () => {
    const play = (): string => {
      let st = createLms('host', 'HOST', seats, 'ROOM7');
      for (let d = 1; d <= 8; d++) {
        st = beginDepth(st, d);
        seats.forEach((s, i) => {
          st = submitVerdict(st, {
            uid: s.uid, n: d, correct: (d + i) % 3 !== 0, kind: d % 4 === 0 ? 'takeover' : 'puzzle',
            diff: Math.min(5, 1 + Math.floor(d / 3)), sanctuary: d % 5 === 0, scoreMul: 1,
            points: 120, hpDelta: -5, clockSec: (d + i) / 4,
          }).state;
        });
        if (d === 6) {
          const a = resolveAttack(st, 'HOST', 'c1', 'curse', d);
          if (a.ok) st = a.state;
        }
        st = closeDepth(st).state;
      }
      return JSON.stringify({ table: st.table, hp: st.hp, phases: st.phases, order: st.order });
    };
    assert(play() === play(), 'reruns identical');
  });

  return { ok: failures.length === 0, failures };
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /lms\.ts$/.test(process.argv[1] ?? '');
if (isMain) {
  const res = selfTest();
  for (const f of res.failures) console.error('  FAIL ' + f);
  console.log(res.ok ? '[lms-selftest] ALL PASS' : '[lms-selftest] FAILURES: ' + res.failures.length);
  if (!res.ok) process.exit(1);
}
