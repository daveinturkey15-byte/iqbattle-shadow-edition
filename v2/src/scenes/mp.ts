/* ============================================================================
 * MP SCENE FLOW — multiplayer orchestration for IQ Battle: SHADOW v2.
 *
 * Layer over src/net/net2.ts implementing the v1 index.html multiplayer flow
 * (mechanic, not code) against the v2 scene architecture:
 *
 *   LOBBY   host creates a room (Main supplies code5()), joiner enters the
 *           code; roster syncs via `lobby` frames and the lobby screen
 *           re-renders on every change.
 *   BEGIN   host START → begin{timer,lms,rn,sd}: clients learn the round
 *           timer, last-man-standing flag, room name AND the run seed so
 *           they regenerate the IDENTICAL arc locally.
 *   ROUNDS  host picks stage+seed per depth (roundPlan() — mirrors main.ts
 *           dealPuzzle/dealTakeover formulas exactly), ships
 *           round{n,timerLen,stg{id,seed}}. Clients mount the same family
 *           at the same seed — puzzle payloads never cross the wire, so no
 *           answer can leak pre-reveal BY CONSTRUCTION.
 *   SR      client StageResults ship as integer verdicts only
 *           {sr{correct,points,hpDelta}}; the host clamps them (engine
 *           rails points [-200,500], hp [-60,60]) with an anti-spoof
 *           ceiling of 100*diff+40 — untrusted client numbers are never
 *           folded raw.
 *   REVEAL  host folds authoritative scores into reveal{n,answer,scores}.
 *   LMS     evaluateElimination() applies score-floor/hp-death ('and' mode,
 *           v1 lms.js Build-B semantics); host broadcasts elim{uids};
 *           eliminated = spectator; when ≤1 remain → end{scores}.
 *   META    meta/metaReq race-proofing pushes the room name to joiners who
 *           missed the initial push.
 *
 * WIRE-READY EXPORTS FOR MAIN (main.ts owns integration — do NOT edit it):
 *
 *   MPHost.start(code, name, roomName, opts?) -> Promise<MpStartResult>
 *   MPJoin.start(code, name, opts?)           -> Promise<MpStartResult>
 *   MpStartResult = { mp: MpSession; ui: Container; code: string; destroy(): void }
 *
 *   wireMain(handlers) subscribes stable game-phase handlers to the active
 *   session. THE 3 CALL SITES IN main.ts:
 *
 *   1) toLobby() — HOST path. Replace the solo buildLobby(...) call with:
 *        const { ui, mp } = await MPHost.start(code5(), name, roomName, {
 *          onStart: (seconds) => {
 *            const sd = makeSeed();                       // existing seed formula
 *            mp.begin(seconds, true, roomName, sd);       // ships begin frame
 *            startRun(name, roomName, seconds, sd);       // extend startRun to take seed
 *          },
 *          onLeave: () => { mp.leave(); toLanding(); },
 *        });
 *        setActiveSession(mp); show(ui);
 *
 *   2) NEW landing JOIN entry — read the code input, then:
 *        const { ui, mp } = await MPJoin.start(code, name, {
 *          onBegin: ({ timer, rn, sd }) =>
 *            startRun(name, rn || name + "'s Room", timer, sd),  // client runs the HOST's seed
 *          onLeave: () => { mp.leave(); toLanding(); },
 *        });
 *        setActiveSession(mp); show(ui);
 *
 *   3) deal()/dealTakeover()/dealPuzzle() + the StageResult funnel:
 *      - host, before mounting depth d:
 *          const plan = roundPlan(r.seed, r.depth, ALL_FAMILIES.length, TAKEOVERS.length,
 *                                 (d2) => takeoverDue(r.seed, d2));
 *          if (isHost()) mp.round(r.depth, plan.stg, plan.seed, r.timerLen);
 *        then mount plan.kind/plan.index/plan.seed instead of the local pick.
 *      - client, in the onRound handler (wireMain): mount the identical
 *        challenge from stg{id,seed} (parseStg gives kind/index).
 *      - StageResult funnel: client → mp.sendSr(n, res); host folds locally,
 *        then mp.reveal(n, answerIdx, scores); LMS loop:
 *          const dead = evaluateElimination(scores, hpMap);
 *          if (dead.length) mp.eliminate(dead);
 *          if (aliveAfter.length <= 1) mp.endMatch(scores);
 *
 * DETERMINISM: zero Math.random/Date.now in this module's logic — every
 * stage/seed decision is a pure function of (runSeed, depth). Fairness
 * rails inherited from net2: answers never ship pre-reveal, verdicts are
 * integers only, everything is escapable via LEAVE.
 * ==========================================================================*/

import type { Container } from 'pixi.js';
import type { Frame, NetApi, PlayerRec, Role } from '../net/net2.ts';
import { createNet } from '../net/net2.ts';
import { lobbyView } from './lobby-roster.ts';
import { adoptScores, aliveUids, applyElim, beginDepth, dropSeat, type LmsState } from './lms.ts';

/* ------------------------------------------------------------------ */
/* Pure protocol types                                                 */
/* ------------------------------------------------------------------ */

export interface ScoreRec {
  uid: string;
  name: string;
  pts: number;
}

export interface SrVerdict {
  correct: boolean | null;
  points: number;
  hpDelta: number;
}

export interface StageRef {
  id: string;
  seed: number;
}

export type SeatPhase = 'alive' | 'spectator' | 'left';

export interface MpMatchSnapshot {
  depth: number;
  scores: ScoreRec[];
  hp: Record<string, number>;
  phases: Record<string, SeatPhase>;
  prevRanks: Record<string, number>;
  answered: string[];
  clocks: Record<string, number>;
  budget: Record<string, number>;
  closed: boolean;
  roundElapsedMs: number;
  over: boolean;
  winnerUid: string | null;
}

export interface BeginInfo {
  timer: number;
  lms: boolean;
  rn?: string;
  sd: number;
}

export interface RoundInfo {
  n: number;
  stg: StageRef;
  timerLen: number;
  forcedGood?: true;
  closed: boolean;
  roundElapsedMs: number;
}

export type RoomSnapshot =
  | { t: 'room-snapshot'; phase: 'lobby' }
  | { t: 'room-snapshot'; phase: 'active'; begin: BeginInfo; round?: RoundInfo; match: MpMatchSnapshot }
  | { t: 'room-snapshot'; phase: 'ended'; begin: BeginInfo; match: MpMatchSnapshot; end: { scores: ScoreRec[]; reason?: string; winnerUid?: string } };

export type MpEvent =
  | { t: 'lobby'; players: PlayerRec[] }
  | { t: 'begin'; timer: number; lms: boolean; rn?: string; sd: number }
  | ({ t: 'round' } & RoundInfo)
  | RoomSnapshot
  | { t: 'pick'; uid: string; n: number; idx: number }
  | { t: 'sr'; uid: string; n: number; sr: SrVerdict }
  | { t: 'reveal'; n: number; scores: ScoreRec[]; hp?: Record<string, number> }
  | { t: 'scores'; n: number; scores: ScoreRec[]; hp?: Record<string, number>; reason?: string }
  | { t: 'end'; scores: ScoreRec[]; reason?: string; winnerUid?: string }
  | { t: 'elim'; uids: string[] }
  | { t: 'attack'; uid: string; targetUid?: string; weapon?: string; n?: number }
  | { t: 'meta'; rn?: string }
  | { t: 'peer-join'; id: string; name?: string }
  | { t: 'peer-leave'; id: string };

/** Engine clamp rails (research/mode-contract.md / rebuild brief). */
const SR_POINTS_MIN = -200;
const SR_POINTS_MAX = 500;
const SR_HP_MIN = -60;
const SR_HP_MAX = 60;

const TIMER_MIN = 1;
const TIMER_MAX = 120;
export const MAX_ROUND_ELAPSED_MS = TIMER_MAX * 1000;

/* ------------------------------------------------------------------ */
/* Wire-frame readers (validated boundary reads)                       */
/* ------------------------------------------------------------------ */

function asNum(v: unknown, dflt: number): number {
  return typeof v === 'number' && isFinite(v) ? v : dflt;
}

function asStr(v: unknown, dflt = ''): string {
  return typeof v === 'string' ? v : dflt;
}

function asScoreList(v: unknown): ScoreRec[] {
  if (!Array.isArray(v)) return [];
  const out: ScoreRec[] = [];
  for (const row of v) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    out.push({
      uid: asStr(r.uid, asStr(r.name, '?')),
      name: asStr(r.name, 'PLAYER').slice(0, 16),
      pts: Math.round(asNum(r.pts, 0)),
    });
  }
  return out;
}

function asPlayerList(v: unknown): PlayerRec[] {
  if (!Array.isArray(v)) return [];
  const out: PlayerRec[] = [];
  for (const row of v) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    out.push({
      id: asStr(r.id, asStr(r.name, '?')),
      name: asStr(r.name, 'PLAYER').slice(0, 16),
      isHost: r.isHost === true,
    });
  }
  return out;
}

/** uid -> hp, sanitized to 0..100 integers (host-authoritative broadcast). */
function asHpMap(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!k) continue;
    out[k.slice(0, 40)] = Math.max(0, Math.min(100, Math.round(asNum(raw, 100))));
  }
  return out;
}

function asUids(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((u): u is string => typeof u === 'string' && u.length > 0);
}
function asNumberMap(v: unknown, integer = true): Record<string, number> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!key || typeof raw !== 'number' || !isFinite(raw)) continue;
    out[key.slice(0, 40)] = Math.max(0, integer ? Math.round(raw) : raw);
  }
  return out;
}

function asPhaseMap(v: unknown): Record<string, SeatPhase> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, SeatPhase> = {};
  for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!key) continue;
    if (raw !== 'alive' && raw !== 'spectator' && raw !== 'left') return null;
    out[key.slice(0, 40)] = raw;
  }
  return out;
}

function asBeginInfo(v: unknown): BeginInfo | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  return {
    timer: Math.max(TIMER_MIN, Math.min(TIMER_MAX, Math.round(asNum(r.timer, 60)))),
    lms: r.lms === true || r.lms === 1,
    rn: typeof r.rn === 'string' ? r.rn.slice(0, 24) : undefined,
    sd: asNum(r.sd, 0) >>> 0,
  };
}

function asRoundInfo(v: unknown): RoundInfo | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const rawStage = r.stg;
  if (!rawStage || typeof rawStage !== 'object') return null;
  const s = rawStage as Record<string, unknown>;
  const n = Math.round(asNum(r.n, 0));
  const stg = { id: asStr(s.id).slice(0, 32), seed: asNum(s.seed, 0) >>> 0 };
  if (
    n < 1 || !stg.id ||
    typeof r.closed !== 'boolean' ||
    typeof r.roundElapsedMs !== 'number' || !isFinite(r.roundElapsedMs)
  ) return null;
  return {
    n,
    stg,
    timerLen: Math.max(TIMER_MIN, Math.min(TIMER_MAX, Math.round(asNum(r.timerLen, 60)))),
    ...(r.forcedGood === true ? { forcedGood: true as const } : {}),
    closed: r.closed,
    roundElapsedMs: Math.max(0, Math.min(MAX_ROUND_ELAPSED_MS, Math.round(r.roundElapsedMs))),
  };
}

function asMatchSnapshot(v: unknown): MpMatchSnapshot | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (
    typeof r.depth !== 'number' || !isFinite(r.depth) ||
    !Array.isArray(r.scores) || !Array.isArray(r.answered) ||
    typeof r.closed !== 'boolean' ||
    typeof r.roundElapsedMs !== 'number' || !isFinite(r.roundElapsedMs) ||
    typeof r.over !== 'boolean' ||
    (r.winnerUid !== null && typeof r.winnerUid !== 'string')
  ) return null;
  const hp = asHpMap(r.hp);
  const phases = asPhaseMap(r.phases);
  const prevRanks = asNumberMap(r.prevRanks);
  const clocks = asNumberMap(r.clocks, false); // Response seconds keep sub-second precision.
  const budget = asNumberMap(r.budget);
  if (!hp || !phases || !prevRanks || !clocks || !budget) return null;
  return {
    depth: Math.max(0, Math.round(r.depth)),
    scores: asScoreList(r.scores),
    hp,
    phases,
    prevRanks,
    answered: asUids(r.answered).map((uid) => uid.slice(0, 40)),
    clocks,
    budget,
    closed: r.closed,
    roundElapsedMs: Math.max(0, Math.min(MAX_ROUND_ELAPSED_MS, Math.round(r.roundElapsedMs))),
    over: r.over,
    winnerUid: typeof r.winnerUid === 'string' ? r.winnerUid.slice(0, 40) : null,
  };
}

function asRoomSnapshot(v: Frame): RoomSnapshot | null {
  const phase = v.phase;
  if (phase === 'lobby') return { t: 'room-snapshot', phase: 'lobby' };
  if (phase !== 'active' && phase !== 'ended') return null;
  const begin = asBeginInfo(v.begin);
  const match = asMatchSnapshot(v.match);
  if (!begin || !match) return null;
  if (phase === 'active') {
    if (v.round == null) return { t: 'room-snapshot', phase, begin, match };
    const round = asRoundInfo(v.round);
    return round ? { t: 'room-snapshot', phase, begin, round, match } : null;
  }
  if (!v.end || typeof v.end !== 'object') return null;
  const rawEnd = v.end as Record<string, unknown>;
  if (!Array.isArray(rawEnd.scores)) return null;
  const reason = typeof rawEnd.reason === 'string' ? rawEnd.reason.slice(0, 32) : undefined;
  return {
    t: 'room-snapshot',
    phase,
    begin,
    match,
    end: {
      scores: asScoreList(rawEnd.scores),
      ...(reason ? { reason } : {}),
      ...(typeof rawEnd.winnerUid === 'string' ? { winnerUid: rawEnd.winnerUid.slice(0, 40) } : {}),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested in src/net/selftest.ts)                     */
/* ------------------------------------------------------------------ */

/**
 * Sanitize + clamp an inbound sr verdict. Returns null for malformed frames.
 * Host-authoritative: client numbers NEVER enter scoring unclamped.
 */
export function clampSr(raw: unknown): SrVerdict | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  let correct: boolean | null = null;
  if (r.correct === 1 || r.correct === true) correct = true;
  else if (r.correct === 0 || r.correct === false) correct = false;
  const points = Math.max(
    SR_POINTS_MIN,
    Math.min(SR_POINTS_MAX, Math.round(asNum(r.points, 0))),
  );
  const hpDelta = Math.max(SR_HP_MIN, Math.min(SR_HP_MAX, Math.round(asNum(r.hpDelta, 0))));
  return { correct, points, hpDelta };
}

/** Anti-spoof ceiling (v1 discipline): verdict points above this are shaved. */
export function srCeiling(points: number, diffLevel: number): number {
  return Math.min(points, 100 * Math.max(1, Math.round(diffLevel)) + 40);
}

/** Ship-side defense in depth: clamp BEFORE the verdict leaves the client. */
export function clampSrOut(v: SrVerdict): Record<string, unknown> {
  return {
    correct: v.correct === true ? 1 : 0,
    points: Math.max(SR_POINTS_MIN, Math.min(SR_POINTS_MAX, Math.round(v.points))),
    hpDelta: Math.max(SR_HP_MIN, Math.min(SR_HP_MAX, Math.round(v.hpDelta))),
  };
}

/** Upsert-by-uid fold for reveal scores (stable insertion order kept). */
export function foldScore(table: ScoreRec[], rec: ScoreRec): ScoreRec[] {
  const out = table.map((s) => ({ ...s }));
  const i = out.findIndex((s) => s.uid === rec.uid);
  if (i >= 0) out[i] = { ...out[i], ...rec };
  else out.push({ ...rec });
  return out;
}

/**
 * LMS elimination (v1 lms.js Build-B semantics): default mode 'and' — a
 * player dies when the SCORE FLOOR and HP DEATH both hold; 'or' relaxes to
 * either. Returns the eliminated uids.
 */
export function evaluateElimination(
  scores: Array<{ uid: string; pts: number }>,
  hp: Record<string, number>,
  cfg?: { mode?: 'and' | 'or'; floor?: number },
): string[] {
  const mode = cfg?.mode ?? 'and';
  const floor = cfg?.floor ?? 0;
  const dead: string[] = [];
  for (const s of scores) {
    const floored = s.pts <= floor;
    const drained = (hp[s.uid] ?? 100) <= 0;
    const gone = mode === 'and' ? floored && drained : floored || drained;
    if (gone && !dead.includes(s.uid)) dead.push(s.uid);
  }
  return dead;
}

/**
 * Seeded shuffle-bag over the family list.
 *
 * The pick used to be `(depth - 1) % families`, which is not a rotation so
 * much as a fixed script: depth 1 was ALWAYS family 0, depth 2 always family
 * 1, in every run anyone ever played. Owner, 2026-08-26: "the first few
 * puzzles are always the same again? annoying, should be from a random pool,
 * like the actual original game".
 *
 * A bag beats plain random: you see every family once before any repeats, so
 * the run stays varied instead of clumping. The bag index is folded into the
 * hash, so bag 2 is a different order from bag 1, and the whole thing is a
 * pure function of the RUN SEED — which is what keeps every screen in a
 * multiplayer match dealing the identical board.
 *
 * Seam rule: if a reshuffle would repeat the family that just played, the new
 * bag's first two entries swap. Back-to-back repeats are the one thing a
 * shuffle-bag can still get wrong, and they are exactly what reads as "the
 * same puzzle again".
 */
export function familyForDepth(runSeed: number, depth: number, families: number): number {
  const n = Math.max(1, Math.floor(families));
  if (n === 1) return 0;
  const d = Math.max(1, Math.floor(depth)) - 1;
  const bag = Math.floor(d / n);
  const slot = d % n;
  const order = bagOrder(runSeed, bag, n);
  if (slot === 0 && bag > 0) {
    const prevLast = bagOrder(runSeed, bag - 1, n)[n - 1];
    if (order[0] === prevLast) return order[1];
  }
  if (slot === 1 && bag > 0) {
    const prevLast = bagOrder(runSeed, bag - 1, n)[n - 1];
    if (order[0] === prevLast) return order[0];
  }
  return order[slot];
}

/** One deterministic Fisher-Yates pass over 0..n-1 for (runSeed, bag). */
function bagOrder(runSeed: number, bag: number, n: number): number[] {
  let h = (runSeed ^ Math.imul(bag + 1, 0x9e3779b1)) >>> 0;
  const rnd = (): number => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a: number[] = [];
  for (let i = 0; i < n; i++) a.push(i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/**
 * Board hue for a depth. Also seeded: the hue wheel used to advance straight
 * off the depth, so every run opened gold, orange, crimson in that order.
 */
export function hueIndexForDepth(runSeed: number, depth: number, hues: number): number {
  const n = Math.max(1, Math.floor(hues));
  const off = (runSeed >>> 3) % n;
  return (Math.max(1, Math.floor(depth)) - 1 + off) % n;
}

export interface RoundPlan {
  kind: 'puzzle' | 'takeover';
  index: number;
  stg: string;
  seed: number;
}

/**
 * Deterministic host stage pick — mirrors main.ts dealPuzzle/dealTakeover
 * EXACTLY (famIdx=familyForDepth(seed,depth,n), seed^imul(depth,7919) for puzzles;
 * seed^imul(depth,97)%takeovers, seed^imul(depth,0x9E37) for takeovers) so a
 * client mounting plan.stg/plan.seed sees the identical challenge.
 */
export function roundPlan(
  runSeed: number,
  depth: number,
  families: number,
  takeovers: number,
  takeoverDue: (d: number) => boolean,
): RoundPlan {
  if (takeoverDue(depth)) {
    const index = ((runSeed ^ Math.imul(depth, 97)) >>> 0) % Math.max(1, takeovers);
    return {
      kind: 'takeover',
      index,
      stg: 'tk:' + index,
      seed: (runSeed ^ Math.imul(depth, 0x9e37)) >>> 0,
    };
  }
  const index = familyForDepth(runSeed, depth, families);
  return {
    kind: 'puzzle',
    index,
    stg: 'pz:' + index,
    seed: (runSeed ^ Math.imul(depth, 7919)) >>> 0,
  };
}

/**
 * Inverse of roundPlan's SEED derivation: recovers the run seed from the
 * per-round board seed a `round` frame carries.
 *
 * Why this exists: `round.stg.seed` is the BOARD seed for one depth
 * (runSeed ^ imul(depth, k)), not the run seed. A client that stores it as
 * its run seed diverges from the host on everything else derived from the
 * run seed — round modifiers, worlds, curses, fate, emerald offers — while
 * its arc plan still comes from the run seed it got in `begin`. That mixed
 * state is the multiplayer desync. The derivation is a pure XOR, so it
 * inverts exactly; this is the only supported way back.
 */
export function runSeedFromRound(boardSeed: number, depth: number, kind: 'puzzle' | 'takeover'): number {
  const d = Math.max(1, Math.floor(depth));
  return (boardSeed ^ Math.imul(d, kind === 'takeover' ? 0x9e37 : 7919)) >>> 0;
}

/** Inverse of roundPlan's stg encoding (validated). */
export function parseStg(stg: string): RoundPlan | null {
  const m = /^(pz|tk):(\d+)$/.exec(String(stg ?? ''));
  if (!m) return null;
  if (m[1] === 'pz') return { kind: 'puzzle', index: Number(m[2]), stg, seed: 0 };
  return { kind: 'takeover', index: Number(m[2]), stg, seed: 0 };
}

/* ------------------------------------------------------------------ */
/* MpSession                                                           */
/* ------------------------------------------------------------------ */

export interface MpHandlers {
  /** Client: a round frame arrived — mount the identical challenge. */
  onRemoteRound?(
    n: number,
    stg: StageRef,
    timerLen: number,
    forcedGood?: boolean,
    closed?: boolean,
    roundElapsedMs?: number,
  ): void;
  /** Every normalized event (both roles see one stream). */
  onEvent?(e: MpEvent): void;
}

type Sub = (e: MpEvent) => void;

interface HostSequence {
  epoch: string;
  n: number;
}
type SnapshotEvent = Extract<MpEvent, { t: 'round' | 'reveal' | 'scores' | 'elim' | 'end' | 'peer-leave' }>;
const SNAPSHOT_EVENT_LIMIT = 512;

/** Only the broadcast sequence is comparable to a match capture. Unicasts
 * have their own recipient-specific sequence space. */
function asHostSequence(value: unknown): HostSequence | null {
  if (typeof value !== 'string') return null;
  const match = /^([^:]+):(\d+)$/.exec(value);
  if (!match) return null;
  const n = Number(match[2]);
  return Number.isSafeInteger(n) ? { epoch: match[1], n } : null;
}

function isSnapshotEvent(type: string): boolean {
  return type === 'round' || type === 'reveal' || type === 'scores' ||
    type === 'elim' || type === 'end' || type === 'peer-leave';
}

/** A frame rejected by the live depth guard may still be needed to bring an
 * older bootstrap ledger forward before the next round. */
function snapshotEventFromFrame(f: Frame): SnapshotEvent | null {
  if (f.t === 'round') {
    const round = asRoundInfo(f);
    return round ? { t: 'round', ...round } : null;
  }
  if (f.t === 'reveal' || f.t === 'scores') {
    const n = Math.round(asNum(f.n, -1));
    if (n < 1) return null;
    return {
      t: f.t, n, scores: asScoreList(f.scores), hp: asHpMap(f.hp),
      ...(f.t === 'scores' && typeof f.reason === 'string' ? { reason: f.reason.slice(0, 32) } : {}),
    };
  }
  if (f.t === 'end') {
    return {
      t: 'end', scores: asScoreList(f.scores),
      reason: typeof f.reason === 'string' ? f.reason.slice(0, 32) : undefined,
      winnerUid: typeof f.winnerUid === 'string' ? f.winnerUid.slice(0, 40) : undefined,
    };
  }
  return null;
}

export class MpSession {
  readonly net: NetApi;
  readonly role: Role;
  private subs = new Set<Sub>(); // dynamic subscriber identity set
  private offs: Array<() => void> = [];
  private handlers: MpHandlers;
  private roster: PlayerRec[] = [];
  private roomLabel: string | null = null;
  private gone = false;
  private phase: 'lobby' | 'active' | 'ended' = 'lobby';
  private beginSeen = false;
  private endSeen = false;
  private roomSnapshotSeen = false;
  private lastRoundN = 0;
  private lastRoundSentN = 0;
  private pendingRound: RoundInfo | null = null;
  private roomSnapshotProvider: ((joiningUid: string) => MpMatchSnapshot | null) | null = null;
  /** Current host-authored match frames used to build one atomic join snapshot. */
  private lastBegin: Frame | null = null;
  private lastRound: Frame | null = null;
  private lastEnd: { scores: ScoreRec[]; reason?: string; winnerUid?: string } | null = null;
  private hostCaptureSq: string | null = null;
  private snapshotCapture: HostSequence | null = null;
  private snapshotEvents: Array<{ sq: HostSequence; event: SnapshotEvent }> = [];
  private snapshotDroppedThrough: HostSequence | null = null;
  private latestScores: {
    sq: HostSequence; n: number; scores: ScoreRec[]; hp?: Record<string, number>;
  } | null = null;

  /**
   * @param initialRoster seed for the lobby screen — the handshake's roster
   *   snapshot fired BEFORE this session subscribed, so it must be carried in
   *   explicitly (joiners pass the resolved join.players).
   */
  constructor(
    net: NetApi,
    role: Role,
    handlers: MpHandlers = {},
    initialRoster: PlayerRec[] = [],
  ) {
    this.net = net;
    this.role = role;
    this.handlers = handlers;
    this.roster = [...initialRoster];
    const listen = (type: string, fn: (f: Frame) => MpEvent | null): void => {
      this.offs.push(
        net.on(type, (f) => {
          const sq = f.src === 'HOST' ? asHostSequence(f._sq) : null;
          if (this.role === 'host' && sq) this.hostCaptureSq = f._sq!;
          if (this.role === 'client' && sq && isSnapshotEvent(type) &&
            this.snapshotCapture?.epoch === sq.epoch && sq.n <= this.snapshotCapture.n) return;
          let e: MpEvent | null = null;
          try {
            e = fn(f);
          } catch (err) {
            const w = globalThis as { __sessErr?: string[] };
            w.__sessErr = w.__sessErr || [];
            w.__sessErr.push('listen ' + type + ': ' + String(err).slice(0, 160));
            return;
          }
          if (this.role === 'client' && sq && isSnapshotEvent(type)) {
            if (!this.roomSnapshotSeen) {
              const event = e && isSnapshotEvent(e.t) ? e as SnapshotEvent : snapshotEventFromFrame(f);
              if (event) this.rememberSnapshotEvent(sq, event);
            }
            if (e?.t === 'scores' || e?.t === 'reveal') {
              const latest = this.latestScores;
              if (latest?.n === e.n && latest.sq.epoch === sq.epoch && latest.sq.n > sq.n) {
                e = { ...e, scores: latest.scores, hp: latest.hp };
              } else {
                this.latestScores = { sq, n: e.n, scores: e.scores, hp: e.hp };
              }
            }
          }
          if (e) this.fire(e);
        }),
      );
    };

    listen('lobby', (f) => {
      this.roster = asPlayerList(f.players);
      // Race-proof: a client that joined late asks the host for the room name.
      if (this.role === 'client' && !this.roomLabel) this.net.send({ t: 'metaReq' });
      return { t: 'lobby', players: [...this.roster] };
    });

    listen('begin', (f) => {
      if (this.beginSeen || this.phase === 'ended') return null;
      const begin = asBeginInfo(f);
      if (!begin) return null;
      this.beginSeen = true;
      this.phase = 'active';
      this.lastBegin = { t: 'begin', ...begin };
      const pending = this.pendingRound;
      this.pendingRound = null;
      if (pending) {
        queueMicrotask(() => {
          if (this.phase !== 'active' || pending.n <= this.lastRoundN) return;
          this.lastRoundN = pending.n;
          this.lastRound = { t: 'round', ...pending };
          this.handlers.onRemoteRound?.(
            pending.n,
            pending.stg,
            pending.timerLen,
            pending.forcedGood,
            pending.closed,
            pending.roundElapsedMs,
          );
          this.fire({ t: 'round', ...pending });
        });
      }
      return { t: 'begin', ...begin };
    });

    listen('round', (f) => {
      const round = asRoundInfo(f);
      if (!round || this.phase === 'ended') return null;
      if (this.phase === 'lobby') {
        if (!this.pendingRound || round.n > this.pendingRound.n) this.pendingRound = round;
        return null;
      }
      if (round.n <= this.lastRoundN) return null;
      this.lastRoundN = round.n;
      this.lastRound = { t: 'round', ...round };
      this.handlers.onRemoteRound?.(
        round.n,
        round.stg,
        round.timerLen,
        round.forcedGood,
        round.closed,
        round.roundElapsedMs,
      );
      return { t: 'round', ...round };
    });

    listen('pick', (f) => ({
      t: 'pick',
      uid: asStr(f.uid, asStr(f.src, '?')),
      n: Math.round(asNum(f.n, -1)),
      idx: Math.round(asNum(f.idx, -1)),
    }));

    listen('sr', (f) => {
      const n = Math.round(asNum(f.n, -1));
      const v = clampSr(f.sr);
      if (!v) return null; // malformed verdicts vanish at the door
      if (this.role === 'host' && this.lastRoundN > 0 && n !== this.lastRoundN) return null;
      return {
        t: 'sr',
        uid: asStr(f.uid, asStr(f.src, '?')),
        n,
        sr: v,
      };
    });

    listen('reveal', (f) => {
      if (this.role === 'client' && this.phase === 'ended') return null;
      const n = Math.round(asNum(f.n, -1));
      if (this.lastRoundN > 0 && n < this.lastRoundN) return null;
      return { t: 'reveal', n, scores: asScoreList(f.scores), hp: asHpMap(f.hp) };
    });

    listen('scores', (f) => {
      if (this.role === 'client' && this.phase === 'ended') return null;
      const n = Math.round(asNum(f.n, -1));
      if (this.lastRoundN > 0 && n !== this.lastRoundN) return null;
      return {
        t: 'scores',
        n,
        scores: asScoreList(f.scores),
        hp: asHpMap(f.hp),
        reason: typeof f.reason === 'string' ? f.reason.slice(0, 32) : undefined,
      };
    });

    listen('end', (f) => {
      if (this.endSeen) return null;
      const event = {
        t: 'end' as const,
        scores: asScoreList(f.scores),
        reason: typeof f.reason === 'string' ? f.reason.slice(0, 32) : undefined,
        winnerUid: typeof f.winnerUid === 'string' ? f.winnerUid.slice(0, 40) : undefined,
      };
      this.endSeen = true;
      this.phase = 'ended';
      this.lastEnd = {
        scores: event.scores.map((s) => ({ ...s })),
        reason: event.reason,
        winnerUid: event.winnerUid,
      };
      return event;
    });

    listen('room-snapshot', (f) => {
      if (this.role !== 'client') return null;
      let snapshot = asRoomSnapshot(f);
      if (!snapshot || this.roomSnapshotSeen) return null;
      if (snapshot.phase === 'lobby' && this.phase !== 'lobby') return null;
      if (snapshot.phase !== 'lobby') {
        const capture = asHostSequence(f._captureSq);
        const floor = this.snapshotDroppedThrough;
        if ((this.snapshotEvents.length > 0 && !capture) ||
          (floor && (!capture || floor.epoch !== capture.epoch || floor.n > capture.n))) {
          // The bounded journal cannot repair this capture. A fresh complete
          // ledger includes the discarded events; never bootstrap partially.
          this.net.send({ t: 'metaReq', snapshot: true });
          return null;
        }
        const merged = this.mergeSnapshot(snapshot, capture);
        if (!merged) {
          this.net.send({ t: 'metaReq', snapshot: true });
          return null;
        }
        snapshot = merged;
        this.snapshotCapture = capture;
        this.roomSnapshotSeen = true;
        this.snapshotEvents.length = 0;
        this.snapshotDroppedThrough = null;
      }
      this.phase = snapshot.phase;
      this.beginSeen = snapshot.phase !== 'lobby';
      this.endSeen = snapshot.phase === 'ended';
      this.pendingRound = null;
      this.lastBegin = snapshot.phase === 'lobby' ? null : { t: 'begin', ...snapshot.begin };
      this.lastRound = snapshot.phase === 'active' && snapshot.round
        ? { t: 'round', ...snapshot.round }
        : null;
      this.lastRoundN = snapshot.phase === 'active' ? snapshot.round?.n ?? 0 : this.lastRoundN;
      if (snapshot.phase === 'ended') {
        this.lastEnd = {
          scores: snapshot.end.scores.map((s) => ({ ...s })),
          reason: snapshot.end.reason,
          winnerUid: snapshot.end.winnerUid,
        };
      }
      return snapshot;
    });


    listen('elim', (f) => ({ t: 'elim', uids: asUids(f.uids) }));

    listen('attack', (f) => ({
      t: 'attack',
      uid: asStr(f.from, asStr(f.uid, asStr(f.src, '?'))),
      targetUid: typeof f.targetUid === 'string' ? f.targetUid.slice(0, 40) : undefined,
      weapon: typeof f.weapon === 'string' ? f.weapon.slice(0, 16) : undefined,
      n: typeof f.n === 'number' ? Math.round(f.n) : undefined,
    }));

    listen('meta', (f) => {
      if (this.role === 'host') return null;
      if (typeof f.rn === 'string' && f.rn) this.roomLabel = f.rn.slice(0, 24);
      return { t: 'meta', rn: typeof f.rn === 'string' ? f.rn.slice(0, 24) : undefined };
    });

    listen('peer-join', (f) => {
      if (this.role === 'host') this.pushMeta();
      return { t: 'peer-join', id: asStr(f.id), name: asStr(f.name) || undefined };
    });

    // A late joiner receives one complete host snapshot, never a begin/round
    // replay that resets the match to zero.
    listen('metaReq', (f) => {
      if (this.role !== 'host') return null;
      const uid = asStr(f.uid, asStr(f.src, '?'));
      if (!uid || uid === '?') return null;
      this.pushMeta();
      this.net.refreshLobby();
      if (f.snapshot === true) {
        const snapshot = this.roomSnapshotFor(uid);
        if (snapshot) this.net.unicast(uid, {
          ...snapshot,
          ...(this.hostCaptureSq ? { _captureSq: this.hostCaptureSq } : {}),
        });
      }
      return null;
    });

    listen('peer-leave', (f) => ({
      t: 'peer-leave',
      id: asStr(f.id, asStr(f.src, '?')),
    }));
  }

  private rememberSnapshotEvent(sq: HostSequence, event: SnapshotEvent): void {
    if (this.snapshotEvents.length === SNAPSHOT_EVENT_LIMIT) {
      const dropped = this.snapshotEvents.shift()!;
      const floor = this.snapshotDroppedThrough;
      if (!floor || floor.epoch !== dropped.sq.epoch || dropped.sq.n > floor.n) {
        this.snapshotDroppedThrough = dropped.sq;
      }
    }
    this.snapshotEvents.push({ sq, event });
  }

  /** Replay host authority into the captured ledger, not through subscribers:
   * UI advance/finish/score effects have already run for the live copies. */
  private mergeSnapshot(
    snapshot: Exclude<RoomSnapshot, { phase: 'lobby' }>,
    capture: HostSequence | null,
  ): Exclude<RoomSnapshot, { phase: 'lobby' }> | null {
    const m = snapshot.match;
    let st: LmsState = {
      role: 'client', myUid: this.myUid() ?? '?',
      table: m.scores, hp: m.hp, phases: m.phases, prevRanks: m.prevRanks,
      depth: m.depth, closed: m.closed, roundElapsedMs: m.roundElapsedMs,
      clocks: m.clocks, answered: m.answered, budget: m.budget,
      over: m.over, winnerUid: m.winnerUid,
      order: m.scores.map((row) => row.uid), streaks: {},
    };
    let round = snapshot.phase === 'active' ? snapshot.round : undefined;
    let end = snapshot.phase === 'ended' ? snapshot.end : null;
    let tableSq = capture;
    const newer = capture ? this.snapshotEvents
      .filter(({ sq }) => sq.epoch === capture.epoch && sq.n > capture.n)
      .sort((a, b) => a.sq.n - b.sq.n) : [];
    for (const { sq, event } of newer) {
      switch (event.t) {
        case 'round':
          if (!st.over && event.n > st.depth) {
            st = beginDepth(st, event.n);
            round = event;
            tableSq = sq;
          }
          break;
        case 'reveal':
        case 'scores':
          // A later depth's table without its round cannot be mounted safely.
          // Recapture rather than consuming its already-deduped reveal.
          if (event.n > st.depth && !st.over) return null;
          if (event.n !== st.depth || st.over) break;
          st = adoptScores(st, event.scores, event.t === 'reveal' && !st.closed);
          if (event.hp) st = { ...st, hp: { ...st.hp, ...event.hp } };
          if (event.t === 'reveal') st = { ...st, closed: true };
          tableSq = sq;
          break;
        case 'elim':
          st = applyElim(st, event.uids);
          break;
        case 'peer-leave':
          st = dropSeat(st, event.id);
          break;
        case 'end': {
          st = adoptScores(st, event.scores, false);
          const alive = aliveUids(st);
          st = { ...st, closed: true, over: true,
            winnerUid: event.winnerUid ?? (alive.length === 1 ? alive[0] : null) };
          end = { scores: st.table, reason: event.reason, winnerUid: st.winnerUid ?? undefined };
          tableSq = sq;
          break;
        }
      }
    }
    // Local lease/goodbye terminal events have no broadcast stamp. Their
    // authority still wins over an earlier active capture.
    if (!end && this.phase === 'ended' && this.lastEnd) {
      st = adoptScores(st, this.lastEnd.scores, false);
      st = { ...st, closed: true, over: true, winnerUid: this.lastEnd.winnerUid ?? st.winnerUid };
      end = { ...this.lastEnd, scores: st.table };
    }
    const match: MpMatchSnapshot = {
      depth: st.depth, scores: st.table, hp: st.hp, phases: st.phases,
      prevRanks: st.prevRanks, answered: st.answered, clocks: st.clocks, budget: st.budget,
      closed: st.closed, roundElapsedMs: st.roundElapsedMs,
      over: st.over, winnerUid: st.winnerUid,
    };
    if (tableSq) this.latestScores = { sq: tableSq, n: st.depth, scores: st.table, hp: st.hp };
    if (end) return { t: 'room-snapshot', phase: 'ended', begin: snapshot.begin, match, end };
    return {
      t: 'room-snapshot', phase: 'active', begin: snapshot.begin, match,
      ...(round ? { round: { ...round, closed: st.closed, roundElapsedMs: st.roundElapsedMs } } : {}),
    };
  }

  private fire(e: MpEvent): void {
    for (const sub of [...this.subs]) {
      try {
        sub(e);
      } catch (err) {
        const w = globalThis as { __sessErr?: string[] };
        w.__sessErr = w.__sessErr || [];
        w.__sessErr.push('sub ' + e.t + ': ' + String(err).slice(0, 160));
      }
    }
    try {
      this.handlers.onEvent?.(e);
    } catch {
      /* isolated */
    }
  }

  subscribe(fn: Sub): () => void {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }

  setRoomName(rn: string): void {
    this.roomLabel = String(rn ?? '').slice(0, 24) || null;
  }
  setRoomSnapshotProvider(provider: (joiningUid: string) => MpMatchSnapshot | null): void {
    if (this.role !== 'host') return;
    this.roomSnapshotProvider = provider;
  }

  private roomSnapshotFor(joiningUid: string): RoomSnapshot | null {
    if (!this.lastBegin) return { t: 'room-snapshot', phase: 'lobby' };
    const begin = asBeginInfo(this.lastBegin);
    const match = asMatchSnapshot(this.roomSnapshotProvider?.(joiningUid) ?? null);
    if (!begin || !match) return null;
    if (this.lastEnd) {
      return {
        t: 'room-snapshot',
        phase: 'ended',
        begin,
        match,
        end: {
          scores: this.lastEnd.scores.map((s) => ({ ...s })),
          ...(this.lastEnd.reason ? { reason: this.lastEnd.reason } : {}),
          ...(this.lastEnd.winnerUid ? { winnerUid: this.lastEnd.winnerUid } : {}),
        },
      };
    }
    const cachedRound = this.lastRound ? asRoundInfo(this.lastRound) : null;
    const round = cachedRound
      ? { ...cachedRound, closed: match.closed, roundElapsedMs: match.roundElapsedMs }
      : null;
    return {
      t: 'room-snapshot',
      phase: 'active',
      begin,
      ...(round ? { round } : {}),
      match,
    };
  }

  /** The room's display NAME (never the invite code), or null before the
   *  meta exchange has delivered it to a joiner. */
  roomName(): string | null {
    return this.roomLabel;
  }

  /**
   * Ask the host what the room is called.
   *
   * The host answers a join by broadcasting `meta` immediately, and
   * net.join() resolves only after that — so on a quiet room the answer has
   * already been and gone by the time this session attaches its listeners,
   * and it is never repeated because nothing else joins. The existing
   * race-proof only re-asked from the `lobby` handler, which has the same
   * problem. A joiner must be able to ask from a standing start; that is
   * this. Cheap, idempotent, and a no-op once the name is known.
   */
  requestRoomName(): void {
    if (this.role !== 'client' || this.roomLabel) return;
    this.net.send({ t: 'metaReq' });
  }

  rosterNow(): PlayerRec[] {
    return [...this.roster];
  }

  names(): string[] {
    return this.roster.map((p) => p.name);
  }

  myUid(): string | null {
    return this.net.myUid();
  }

  private pushMeta(): void {
    if (this.role !== 'host') return;
    if (!this.roomLabel) return;
    this.net.broadcast({ t: 'meta', rn: this.roomLabel });
  }

  /* ---- host actions (all no-op when not host) ------------------------- */

  /** begin{timer,lms,rn,sd} — starts the match on every screen. */
  begin(timerSec: number, lms: boolean, rn: string, runSeed: number): void {
    if (this.role !== 'host' || this.lastBegin || this.endSeen) return;
    this.setRoomName(rn);
    const frame: Frame = {
      t: 'begin',
      timer: Math.max(TIMER_MIN, Math.min(TIMER_MAX, Math.round(timerSec))),
      lms: lms ? 1 : 0,
      rn: String(rn ?? '').slice(0, 24),
      sd: runSeed >>> 0,
    };
    this.phase = 'active';
    this.beginSeen = false;
    this.lastRoundN = 0;
    this.lastRoundSentN = 0;
    this.lastRound = null;
    this.lastEnd = null;
    this.lastBegin = { ...frame };
    this.net.broadcast(frame);
  }

  /** Host deals a monotonic depth; the optional marker overrides only that beat. */
  round(n: number, stgId: string, seed: number, timerLen: number, forcedGood?: boolean): void {
    const depth = Math.round(n);
    if (this.role !== 'host' || this.phase !== 'active' || depth < 1 || depth <= this.lastRoundSentN) return;
    const frame: Frame = {
      t: 'round',
      n: depth,
      stg: { id: String(stgId).slice(0, 32), seed: seed >>> 0 },
      timerLen: Math.max(TIMER_MIN, Math.min(TIMER_MAX, Math.round(timerLen))),
      ...(forcedGood === true ? { forcedGood: true } : {}),
      closed: false,
      roundElapsedMs: 0,
    };
    this.lastRoundSentN = depth;
    this.net.broadcast(frame);
    this.lastRound = { ...frame };
  }


  /** reveal{n,answer,scores} — the ONLY frame allowed to carry an answer. */
  reveal(n: number, answerIdx: number, scores: ScoreRec[], hp?: Record<string, number>): void {
    if (this.role !== 'host') return;
    this.net.broadcast({
      t: 'reveal',
      n: Math.round(n),
      answer: Math.round(answerIdx),
      scores: scores.map((s) => ({ uid: s.uid, name: String(s.name).slice(0, 16), pts: Math.round(s.pts) })),
      ...(hp ? { hp: { ...hp } } : {}),
    });
  }

  /**
   * scores{n,scores,reason} — an out-of-band table push (attack landed, seat
   * left). Deliberately NOT a reveal: reveal is the advance signal, so score
   * corrections mid-depth must ride their own frame or every client skips a
   * round the moment someone throws a rotten tomato.
   */
  pushScores(n: number, scores: ScoreRec[], hp?: Record<string, number>, reason?: string): void {
    if (this.role !== 'host') return;
    this.net.broadcast({
      t: 'scores',
      n: Math.round(n),
      scores: scores.map((s) => ({ uid: s.uid, name: String(s.name).slice(0, 16), pts: Math.round(s.pts) })),
      ...(hp ? { hp: { ...hp } } : {}),
      ...(reason ? { reason: reason.slice(0, 32) } : {}),
    });
  }

  endMatch(scores: ScoreRec[], reason?: string, winnerUid?: string): void {
    if (this.role !== 'host' || this.endSeen || this.lastEnd) return;
    const end = {
      scores: scores.map((s) => ({ uid: s.uid, name: String(s.name).slice(0, 16), pts: Math.round(s.pts) })),
      ...(reason ? { reason: reason.slice(0, 32) } : {}),
      ...(winnerUid ? { winnerUid: winnerUid.slice(0, 40) } : {}),
    };
    this.phase = 'ended';
    this.lastEnd = {
      scores: end.scores.map((s) => ({ ...s })),
      reason: end.reason,
      winnerUid: end.winnerUid,
    };
    this.net.broadcast({ t: 'end', ...end });
  }

  eliminate(uids: string[]): void {
    if (this.role !== 'host') return;
    this.net.broadcast({ t: 'elim', uids: uids.filter((u) => typeof u === 'string') });
  }

  /* ---- client actions --------------------------------------------------- */

  pick(n: number, qid: string, idx: number): void {
    if (this.role !== 'client') return;
    this.net.send({ t: 'pick', n: Math.round(n), qid: String(qid).slice(0, 40), idx: Math.round(idx) });
  }

  /** Integer verdict relay — sanitized/clamped on BOTH ends (rail: never
   *  trust client numbers; never ship answers pre-reveal). */
  sendSr(n: number, v: SrVerdict): void {
    if (this.role !== 'client') return;
    this.net.send({ t: 'sr', n: Math.round(n), sr: clampSrOut(v) });
  }

  attack(targetUid: string, weapon: string, n: number): void {
    if (this.role !== 'client') return;
    this.net.send({
      t: 'attack',
      targetUid: String(targetUid).slice(0, 40),
      weapon: String(weapon).slice(0, 16),
      n: Math.round(n),
    });
  }

  leave(): void {
    if (this.gone) return;
    this.gone = true;
    for (const off of this.offs.splice(0)) off();
    this.subs.clear();
    this.snapshotEvents.length = 0;
    this.snapshotDroppedThrough = null;
    this.snapshotCapture = null;
    this.latestScores = null;
    this.hostCaptureSq = null;
    this.net.leave();
  }
}

/* ------------------------------------------------------------------ */
/* Lobby screen wiring (Pixi parts load lazily — node-safe module)     */
/* ------------------------------------------------------------------ */

export interface MpUiOpts {
  onStart?(seconds: number): void;
  onLeave?(): void;
  /** Extra banner line shown under the header (joiners: "waiting for host"). */
}

export interface MpStartResult {
  mp: MpSession;
  ui: Container;
  code: string;
  /** leave() + unsubscribe; call when Main swaps away from the lobby. */
  destroy(): void;
}

async function buildMpScreen(
  mp: MpSession,
  roomName: string,
  code: string,
  isHost: boolean,
  opts: MpUiOpts,
): Promise<{ ui: Container; stop(): void }> {
  const [{ Container }, { buildLobby }] = await Promise.all([
    import('pixi.js'),
    import('./lobby.ts'),
  ]);
  const holder = new Container();
  const render = (): void => {
    /* Identity, not seat order: mp.myUid() says which roster row is the local
     * player and `isHost` says whether this screen may begin the run. The
     * screen used to receive names only, so it tagged seat 0 "you · host" —
     * telling every joiner they were the host. */
    const view = lobbyView(mp.rosterNow(), mp.myUid(), isHost);
    holder.removeChildren();
    holder.addChild(
      buildLobby({
        /* A joiner opens on '<host>'s Room' and learns the real name from the
         * meta frame moments later. The lobby only re-rendered on `lobby`
         * frames, so that correction never reached the screen and the header
         * kept a name the host had not chosen. */
        roomName: mp.roomName() ?? roomName,
        code,
        players: view.players,
        youUid: view.youUid,
        canStart: view.canStart,
        onStart: (seconds) => {
          if (!isHost) return; // joiners wait for the host's begin frame
          opts.onStart?.(seconds);
        },
        onLeave: () => {
          mp.leave();
          opts.onLeave?.();
        },
      }),
    );
  };
  render();
  const stop = mp.subscribe((e) => {
    if (e.t === 'lobby' || e.t === 'meta') render();
  });
  return { ui: holder, stop };
}


/**
 * Host a room: creates the session, renders the live-roster lobby screen.
 *
 * ORDERING CONTRACT (regression-hardened): net.host()/net.join() call
 * teardown() on entry, which CLEARS every handler registered before them —
 * so MpSession (a pure bundle of net.on() subscriptions) MUST be constructed
 * only AFTER the handshake resolves. Building it first silently dead-ends
 * every wireMain handler while frames still reach net2.emit.
 */
export const MPHost = {
  async start(
    code: string,
    name: string,
    roomName: string,
    opts: MpUiOpts = {},
  ): Promise<MpStartResult> {
    const net = createNet();
    const rn = roomName || name + "'s Room";
    const hosted = await net.host(code, name);
    const mp = new MpSession(net, 'host', {}, [
      { id: 'HOST', name: name || 'HOST', isHost: true },
    ]);
    mp.setRoomName(rn);
    const screen = await buildMpScreen(mp, rn, hosted.code, true, opts);
    return {
      mp,
      ui: screen.ui,
      code: hosted.code,
      destroy: () => {
        screen.stop();
        mp.leave();
      },
    };
  },
};

/** Join a room by code: renders the lobby; gameplay starts on begin frame. */
export const MPJoin = {
  async start(code: string, name: string, opts: MpUiOpts = {}): Promise<MpStartResult> {
    const net = createNet();
    const joined = await net.join(code, name); // BEFORE MpSession — see note above
    const mp = new MpSession(net, 'client', {}, joined.players);
    mp.requestRoomName();
    // The room displays under the HOST's name (roster seat 0) until the
    // meta/metaReq exchange delivers the real room label.
    const rn = (mp.names()[0] ?? name) + "'s Room";
    const screen = await buildMpScreen(mp, rn, code.toUpperCase(), false, opts);
    return {
      mp,
      ui: screen.ui,
      code: code.toUpperCase(),
      destroy: () => {
        screen.stop();
        mp.leave();
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* wireMain — stable subscription point for main.ts                    */
/* ------------------------------------------------------------------ */

let activeSession: MpSession | null = null;

/** Main calls this right after MPHost/MPJoin .start() resolves. */
export function setActiveSession(mp: MpSession | null): void {
  activeSession = mp;
}

/** The game-phase handlers main.ts passes to wireMain (call site 3). */
export interface WireHandlers {
  onBegin?(e: Extract<MpEvent, { t: 'begin' }>): void;
  onRound?(e: Extract<MpEvent, { t: 'round' }>): void;
  onPick?(e: Extract<MpEvent, { t: 'pick' }>): void;
  onSr?(e: Extract<MpEvent, { t: 'sr' }>): void;
  onReveal?(e: Extract<MpEvent, { t: 'reveal' }>): void;
  onScores?(e: Extract<MpEvent, { t: 'scores' }>): void;
  onEnd?(e: Extract<MpEvent, { t: 'end' }>): void;
  onElim?(e: Extract<MpEvent, { t: 'elim' }>): void;
  onAttack?(e: Extract<MpEvent, { t: 'attack' }>): void;
  onPeerLeave?(e: Extract<MpEvent, { t: 'peer-leave' }>): void;
  onRoomSnapshot?(e: RoomSnapshot): void;
}

/**
 * Subscribe Main's game-phase handlers to the active session. Safe to call
 * once after each setActiveSession; returns an unsubscribe. See the header
 * comment for the exact 3 call sites in main.ts.
 */
export function wireMain(h: WireHandlers): () => void {
  if (!activeSession) return () => undefined;
  const mp = activeSession;
  const off = mp.subscribe((e) => {
    switch (e.t) {
      case 'begin':
        h.onBegin?.(e);
        break;
      case 'round':
        h.onRound?.(e);
        break;
      case 'pick':
        h.onPick?.(e);
        break;
      case 'sr':
        h.onSr?.(e);
        break;
      case 'reveal':
        h.onReveal?.(e);
        break;
      case 'scores':
        h.onScores?.(e);
        break;
      case 'end':
        h.onEnd?.(e);
        break;
      case 'elim':
        h.onElim?.(e);
        break;
      case 'attack':
        h.onAttack?.(e);
        break;
      case 'room-snapshot':
        h.onRoomSnapshot?.(e);
        break;
      case 'peer-leave':
        h.onPeerLeave?.(e);
        break;
    }
  });
  // MPJoin awaits lazy scene imports before Main is ready. Request catch-up
  // only AFTER its gameplay subscriber exists, not in the constructor or
  // the room-name exchange; transport dedupe cannot replay a consumed frame.
  if (mp.role === 'client') mp.net.send({ t: 'metaReq', snapshot: true });
  return off;
}
