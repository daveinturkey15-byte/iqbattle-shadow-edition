/* ============================================================================
 * MP SCENE FLOW — multiplayer orchestration for IQ Versus: SHADOW v2.
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

export type MpEvent =
  | { t: 'lobby'; players: PlayerRec[] }
  | { t: 'begin'; timer: number; lms: boolean; rn?: string; sd: number }
  | { t: 'round'; n: number; stg: StageRef; timerLen: number }
  | { t: 'pick'; uid: string; n: number; idx: number }
  | { t: 'sr'; uid: string; n: number; sr: SrVerdict }
  | { t: 'reveal'; n: number; scores: ScoreRec[] }
  | { t: 'end'; scores: ScoreRec[]; reason?: string }
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

function asUids(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((u): u is string => typeof u === 'string' && u.length > 0);
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

export interface RoundPlan {
  kind: 'puzzle' | 'takeover';
  index: number;
  stg: string;
  seed: number;
}

/**
 * Deterministic host stage pick — mirrors main.ts dealPuzzle/dealTakeover
 * EXACTLY (famIdx=(depth-1)%families, seed^imul(depth,7919) for puzzles;
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
  const index = (depth - 1) % Math.max(1, families);
  return {
    kind: 'puzzle',
    index,
    stg: 'pz:' + index,
    seed: (runSeed ^ Math.imul(depth, 7919)) >>> 0,
  };
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
  onRemoteRound?(n: number, stg: StageRef, timerLen: number): void;
  /** Every normalized event (both roles see one stream). */
  onEvent?(e: MpEvent): void;
}

type Sub = (e: MpEvent) => void;

export class MpSession {
  readonly net: NetApi;
  readonly role: Role;
  private subs = new Set<Sub>(); // dynamic subscriber identity set
  private offs: Array<() => void> = [];
  private handlers: MpHandlers;
  private roster: PlayerRec[] = [];
  private roomLabel: string | null = null;
  private gone = false;

  constructor(net: NetApi, role: Role, handlers: MpHandlers = {}) {
    this.net = net;
    this.role = role;
    this.handlers = handlers;

    const listen = (type: string, fn: (f: Frame) => MpEvent | null): void => {
      this.offs.push(
        net.on(type, (f) => {
          let e: MpEvent | null = null;
          try {
            e = fn(f);
          } catch (err) {
            const w = globalThis as { __sessErr?: string[] };
            w.__sessErr = w.__sessErr || [];
            w.__sessErr.push('listen ' + type + ': ' + String(err).slice(0, 160));
            return;
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

    listen('begin', (f) => ({
      t: 'begin',
      timer: Math.max(TIMER_MIN, Math.min(TIMER_MAX, Math.round(asNum(f.timer, 60)))),
      lms: f.lms === 1 || f.lms === true,
      rn: typeof f.rn === 'string' ? f.rn.slice(0, 24) : undefined,
      sd: asNum(f.sd, 0) >>> 0,
    }));

    listen('round', (f) => {
      const stgRaw = f.stg;
      const stg =
        stgRaw && typeof stgRaw === 'object'
          ? {
              id: asStr((stgRaw as Record<string, unknown>).id).slice(0, 32),
              seed: asNum((stgRaw as Record<string, unknown>).seed, 0) >>> 0,
            }
          : { id: '', seed: 0 };
      const n = Math.round(asNum(f.n, 0));
      const timerLen = Math.max(TIMER_MIN, Math.min(TIMER_MAX, Math.round(asNum(f.timerLen, 60))));
      this.handlers.onRemoteRound?.(n, stg, timerLen);
      return { t: 'round', n, stg, timerLen };
    });

    listen('pick', (f) => ({
      t: 'pick',
      uid: asStr(f.uid, asStr(f.src, '?')),
      n: Math.round(asNum(f.n, -1)),
      idx: Math.round(asNum(f.idx, -1)),
    }));

    listen('sr', (f) => {
      const v = clampSr(f.sr);
      if (!v) return null; // malformed verdicts vanish at the door
      return {
        t: 'sr',
        uid: asStr(f.uid, asStr(f.src, '?')),
        n: Math.round(asNum(f.n, -1)),
        sr: v,
      };
    });

    listen('reveal', (f) => ({
      t: 'reveal',
      n: Math.round(asNum(f.n, -1)),
      scores: asScoreList(f.scores),
    }));

    listen('end', (f) => ({
      t: 'end',
      scores: asScoreList(f.scores),
      reason: typeof f.reason === 'string' ? f.reason.slice(0, 32) : undefined,
    }));

    listen('elim', (f) => ({ t: 'elim', uids: asUids(f.uids) }));

    listen('attack', (f) => ({
      t: 'attack',
      uid: asStr(f.from, asStr(f.uid, asStr(f.src, '?'))),
      targetUid: typeof f.targetUid === 'string' ? f.targetUid.slice(0, 40) : undefined,
      weapon: typeof f.weapon === 'string' ? f.weapon.slice(0, 16) : undefined,
      n: typeof f.n === 'number' ? f.n : undefined,
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

    listen('peer-leave', (f) => ({
      t: 'peer-leave',
      id: asStr(f.id, asStr(f.src, '?')),
    }));
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
    if (this.role !== 'host') return;
    this.setRoomName(rn);
    this.net.broadcast({
      t: 'begin',
      timer: Math.max(TIMER_MIN, Math.min(TIMER_MAX, Math.round(timerSec))),
      lms: lms ? 1 : 0,
      rn: String(rn ?? '').slice(0, 24),
      sd: runSeed >>> 0,
    });
  }

  /** round{n,stg{ id,seed},timerLen} — deals depth n identically everywhere. */
  round(n: number, stgId: string, seed: number, timerLen: number): void {
    if (this.role !== 'host') return;
    this.net.broadcast({
      t: 'round',
      n: Math.round(n),
      stg: { id: String(stgId).slice(0, 32), seed: seed >>> 0 },
      timerLen: Math.max(TIMER_MIN, Math.min(TIMER_MAX, Math.round(timerLen))),
    });
  }

  /** reveal{n,answer,scores} — the ONLY frame allowed to carry an answer. */
  reveal(n: number, answerIdx: number, scores: ScoreRec[]): void {
    if (this.role !== 'host') return;
    this.net.broadcast({
      t: 'reveal',
      n: Math.round(n),
      answer: Math.round(answerIdx),
      scores: scores.map((s) => ({ uid: s.uid, name: String(s.name).slice(0, 16), pts: Math.round(s.pts) })),
    });
  }

  endMatch(scores: ScoreRec[], reason?: string): void {
    if (this.role !== 'host') return;
    this.net.broadcast({
      t: 'end',
      scores: scores.map((s) => ({ uid: s.uid, name: String(s.name).slice(0, 16), pts: Math.round(s.pts) })),
      ...(reason ? { reason: reason.slice(0, 32) } : {}),
    });
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
    holder.removeChildren();
    holder.addChild(
      buildLobby({
        roomName,
        code,
        players: mp.names(),
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
    if (e.t === 'lobby') render();
  });
  return { ui: holder, stop };
}


/** Host a room: creates the session, renders the live-roster lobby screen. */
export const MPHost = {
  async start(
    code: string,
    name: string,
    roomName: string,
    opts: MpUiOpts = {},
  ): Promise<MpStartResult> {
    const net = createNet();
    const mp = new MpSession(net, 'host');
    const rn = roomName || name + "'s Room";
    mp.setRoomName(rn);
    const hosted = await net.host(code, name);
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
    const mp = new MpSession(net, 'client');
    await net.join(code, name);
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
  onEnd?(e: Extract<MpEvent, { t: 'end' }>): void;
  onElim?(e: Extract<MpEvent, { t: 'elim' }>): void;
  onAttack?(e: Extract<MpEvent, { t: 'attack' }>): void;
  onPeerLeave?(e: Extract<MpEvent, { t: 'peer-leave' }>): void;
}

/**
 * Subscribe Main's game-phase handlers to the active session. Safe to call
 * once after each setActiveSession; returns an unsubscribe. See the header
 * comment for the exact 3 call sites in main.ts.
 */
export function wireMain(h: WireHandlers): () => void {
  if (!activeSession) return () => undefined;
  const mp = activeSession;
  return mp.subscribe((e) => {
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
      case 'end':
        h.onEnd?.(e);
        break;
      case 'elim':
        h.onElim?.(e);
        break;
      case 'attack':
        h.onAttack?.(e);
        break;
      case 'peer-leave':
        h.onPeerLeave?.(e);
        break;
    }
  });
}
