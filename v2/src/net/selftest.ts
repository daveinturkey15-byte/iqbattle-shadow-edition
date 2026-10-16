/* ============================================================================
 * MP SELFTEST — node-runnable proof for src/net/net2.ts + src/scenes/mp.ts.
 *
 *   cd v2 && node src/net/selftest.ts        (exit 0 = PASS)
 *
 * Style follows research/net-transport-proof.js: stubbed dual transports
 * (in-memory BroadcastChannel hub + paired PeerJS-like conns) with ADVERSARIAL
 * delivery — every frame may be delivered TWICE (seeded 15% dup chance) and
 * always lands after a random 0–12ms delay, so 500-frame bursts arrive heavily
 * reordered. The epoch-watermark dedupe must collapse ALL of that to
 * exactly-once: zero loss, zero duplication, across BOTH transports.
 *
 * Also exercises the MpSession protocol flow (begin → round → sr → reveal →
 * elim → end), pure fold/clamp/LMS/roundPlan logic, and explicitly scheduled
 * active/closed/ended catch-up through the real session and LMS director.
 *
 * Determinism: the harness RNG is mulberry32(seed) — no Math.random here.
 * ==========================================================================*/

import { createNet, type BusHandle, type DataConnLike, type Frame, type PeerCtor, type PeerLike } from './net2.ts';
import {
  clampSr,
  evaluateElimination,
  familyForDepth,
  foldScore,
  hueIndexForDepth,
  parseStg,
  roundPlan, runSeedFromRound,
  srCeiling,
  MpSession,
  setActiveSession,
  wireMain,
  type MpMatchSnapshot,
  type RoomSnapshot,
  type ScoreRec,
} from '../scenes/mp.ts';
import { createDirector } from '../scenes/lmsdirector.ts';
/* Seeded harness RNG                                                   */
/* ------------------------------------------------------------------ */

function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Adversarial stub world                                               */
/* ------------------------------------------------------------------ */

const DUP_P = 0.15; // chance any single delivery happens twice

class StubWorld {
  rng: () => number;
  peers = new Map<string, PeerStub>();
  // One hub PER ROOM CODE — real BroadcastChannels are namespaced by name,
  // so frames must never leak across rooms (two hosts share myUid 'HOST').
  hubs = new Map<string, Set<BusStub>>();
  connectionPairs: Array<{ client: ConnEnd; host: ConnEnd }> = [];
  scheduled = 0;
  manual = false;
  pending: Array<{ type: string; fire: () => void }> = [];

  /** Explicit delivery order for lifecycle regressions, without timer races. */
  flush(type?: string): void {
    let delivered = 0;
    for (;;) {
      const i = this.pending.findIndex((item) => !type || item.type === type);
      if (i < 0) return;
      if (++delivered > 10000) throw new Error('manual delivery did not quiesce');
      this.pending.splice(i, 1)[0].fire();
    }
  }

  failConnection(conn: ConnEnd): void {
    const fire = () => conn.fire('error', [{ type: 'peer-unavailable' }]);
    if (this.manual) this.pending.push({ type: 'connection-error', fire });
    else setTimeout(fire, 5);
  }

  busHub(code: string): Set<BusStub> {
    let s = this.hubs.get(code);
    if (!s) {
      s = new Set<BusStub>();
      this.hubs.set(code, s);
    }
    return s;
  }

  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }

  latency(): number {
    return Math.floor(this.rng() * 12);
  }

  /** Deliver to a peer conn: random delay (=> reordering) + dup injection. */
  deliverToConn(conn: ConnEnd, obj: unknown): void {
    this.scheduled++;
    const fire = (): void => conn.fire('data', [JSON.parse(JSON.stringify(obj))]);
    if (this.manual) {
      const type = (obj as Frame).t;
      this.pending.push({ type, fire }, { type, fire });
      return;
    }
    setTimeout(fire, this.latency());
    if (this.rng() < DUP_P) setTimeout(fire, this.latency() + 3);
  }

  /** Deliver onto a bus member: same adversarial treatment. */
  deliverToBus(target: BusStub, frame: Frame): void {
    this.scheduled++;
    const copy = JSON.parse(JSON.stringify(frame));
    const fire = (): void => target.receive(JSON.parse(JSON.stringify(copy)));
    if (this.manual) {
      this.pending.push({ type: frame.t, fire }, { type: frame.t, fire });
      return;
    }
    setTimeout(fire, this.latency());
    if (this.rng() < DUP_P) setTimeout(fire, this.latency() + 3);
  }
}

/** One end of a paired peer connection (DataConnection stand-in). */
class ConnEnd implements DataConnLike {
  open = false;
  peer: string;
  remote: ConnEnd | null = null;
  dropData = false;
  private cbs = new Map<string, Array<(...args: unknown[]) => void>>();

  constructor(peerId: string) {
    this.peer = peerId;
  }

  on(ev: string, cb: (...args: unknown[]) => void): void {
    const list = this.cbs.get(ev) ?? [];
    list.push(cb);
    this.cbs.set(ev, list);
  }

  fire(ev: string, args: unknown[]): void {
    for (const cb of [...(this.cbs.get(ev) ?? [])]) cb(...args);
  }

  send(data: unknown): void {
    if (!this.open || !this.remote || !this.worldRef || this.dropData) return;
    this.worldRef.deliverToConn(this.remote, data);
  }

  worldRef: StubWorld | null = null;

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.fire('close', []);
  }
}

/** PeerJS Peer stand-in with a broker registry keyed by full peer id. */
class PeerStub implements PeerLike {
  open = false;
  world: StubWorld;
  id: string | null;
  private cbs = new Map<string, Array<(...args: unknown[]) => void>>();

  constructor(world: StubWorld, id: string | null) {
    this.world = world;
    this.id = id;
  }

  on(ev: string, cb: (...args: unknown[]) => void): void {
    const list = this.cbs.get(ev) ?? [];
    list.push(cb);
    this.cbs.set(ev, list);
    if (ev === 'open') {
      setTimeout(() => {
        this.open = true;
        cb(this.id);
      }, 1);
    }
  }

  private fire(ev: string, args: unknown[]): void {
    for (const cb of [...(this.cbs.get(ev) ?? [])]) cb(...args);
  }

  connect(id: string, _opts?: { reliable?: boolean; serialization?: string }): DataConnLike {
    const target = this.world.peers.get(id);
    if (!target || !target.open) {
      const dead = new ConnEnd(id);
      this.world.failConnection(dead);
      return dead;
    }
    const a = new ConnEnd(id);
    const b = new ConnEnd(this.id ?? '?');
    a.worldRef = this.world;
    b.worldRef = this.world;
    a.remote = b;
    this.world.connectionPairs.push({ client: a, host: b });
    b.remote = a;
    const lat = this.world.latency();
    setTimeout(() => {
      a.open = true;
      a.fire('open', []);
    }, lat);
    setTimeout(() => {
      b.open = true;
      target.fire('connection', [b]);
    }, lat);
    return a;
  }

  reconnect(): void {
    // Registry-based stub "rebuilds the broker leg": re-register + open.
    this.open = true;
    if (this.id && !this.destroyed && !this.world.peers.has(this.id)) {
      this.world.peers.set(this.id, this);
    }
  }

  private destroyed = false;

  destroy(): void {
    this.destroyed = true;
    this.open = false;
    this.cbs.clear();
    if (this.id) this.world.peers.delete(this.id);
  }

  /** Simulate a silent broker drop on a live peer (idle host repro). */
  simulateBrokerDeath(): void {
    if (this.id) this.world.peers.delete(this.id);
    this.open = false;
    this.fire('close', []);
  }
}

/** BroadcastChannel stand-in wired to its room's hub (no echo to sender). */
class BusStub implements BusHandle {
  world: StubWorld;
  readonly myId: string;
  readonly code: string;
  private cb: ((f: Frame) => void) | null = null;

  constructor(world: StubWorld, code: string, myId: string) {
    this.world = world;
    this.code = code;
    this.myId = myId;
    world.busHub(code).add(this);
  }

  onFrame(cb: (f: Frame) => void): void {
    this.cb = cb;
  }

  /** Test hook used by the hub's deliverToBus. */
  receive(f: Frame): void {
    this.cb?.(f);
  }

  post(frame: Frame): void {
    for (const m of [...this.world.busHub(this.code)]) {
      if (m !== this) this.world.deliverToBus(m, frame);
    }
  }

  close(): void {
    this.world.busHub(this.code).delete(this);
  }
}

function makePeerCtor(world: StubWorld): PeerCtor {
  // Test seam: `new Ctor(id)` must yield the stub instance; constructors may
  // return an object, which becomes the result of the `new` expression.
  const ctor = function (id: string | null): PeerStub {
    const p = new PeerStub(world, id);
    if (id) world.peers.set(id, p);
    return p;
  } as unknown as PeerCtor;
  return ctor;
}

/* ------------------------------------------------------------------ */
/* Harness helpers                                                      */
/* ------------------------------------------------------------------ */

let failures = 0;

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) console.log('  ok  ' + name);
  else {
    failures++;
    console.error('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

async function waitFor(label: string, cond: () => boolean, ms = 10000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timeout: ' + label);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/* ------------------------------------------------------------------ */
/* Pure logic checks                                                    */
/* ------------------------------------------------------------------ */

function pureChecks(): void {
  console.log('[pure] clampSr / srCeiling / foldScore / elimination / roundPlan');

  /* ---- seeded puzzle pool ------------------------------------------
   * The pick was `(depth-1) % families`, i.e. the same scripted opening
   * in every run anyone ever played. These assertions are the regression
   * guard on "should be from a random pool" (owner, 2026-08-26). */
  {
    const N = 12;
    let sameSeedStable = true;
    let differentSeedsDiffer = false;
    let everyBagComplete = true;
    let noImmediateRepeat = true;
    let coversEveryFamily = true;

    for (const seed of [1, 2, 12345, 0xbeef, 0x7fffffff]) {
      const seen = new Set<number>();
      let prev = -1;
      for (let bag = 0; bag < 6; bag++) {
        const inBag = new Set<number>();
        for (let slot = 0; slot < N; slot++) {
          const depth = bag * N + slot + 1;
          const fam = familyForDepth(seed, depth, N);
          if (fam < 0 || fam >= N) everyBagComplete = false;
          if (fam === prev) noImmediateRepeat = false;
          prev = fam;
          inBag.add(fam);
          seen.add(fam);
          if (familyForDepth(seed, depth, N) !== fam) sameSeedStable = false;
        }
        /* A bag may lose ONE slot to the seam swap; never more. */
        if (inBag.size < N - 1) everyBagComplete = false;
      }
      if (seen.size !== N) coversEveryFamily = false;
    }

    const openA = [1, 2, 3, 4].map((d) => familyForDepth(101, d, N)).join(',');
    const openB = [1, 2, 3, 4].map((d) => familyForDepth(202, d, N)).join(',');
    const openC = [1, 2, 3, 4].map((d) => familyForDepth(303, d, N)).join(',');
    differentSeedsDiffer = !(openA === openB && openB === openC);

    check('pool: same seed always deals the same board order', sameSeedStable);
    check('pool: different runs open with different families', differentSeedsDiffer,
      openA + ' | ' + openB + ' | ' + openC);
    check('pool: every family appears before any repeats', everyBagComplete);
    check('pool: a family never follows itself', noImmediateRepeat);
    check('pool: the whole family set gets used', coversEveryFamily);
    check('pool: a single-family list still works', familyForDepth(7, 5, 1) === 0);

    /* Hue wheel had the same fixed-script problem. */
    const hueA = [1, 2, 3].map((d) => hueIndexForDepth(11, d, 6)).join(',');
    const hueB = [1, 2, 3].map((d) => hueIndexForDepth(4000, d, 6)).join(',');
    check('pool: board hue is seeded too', hueA !== hueB, hueA + ' vs ' + hueB);
  }

  check('clampSr rejects garbage', clampSr(null) === null && clampSr('x') === null && clampSr(42) === null);
  const v = clampSr({ correct: 1, points: 9999, hpDelta: -999 });
  check(
    'clampSr clamps to engine rails',
    !!v && v.correct === true && v.points === 500 && v.hpDelta === -60,
    JSON.stringify(v),
  );
  const nv = clampSr({ correct: 0, points: 'junk', hpDelta: 5.7 });
  check(
    'clampSr defaults non-numeric points to 0 and rounds hp',
    !!nv && nv.correct === false && nv.points === 0 && nv.hpDelta === 6,
    JSON.stringify(nv),
  );
  check('clampSr treats junk correct as null', clampSr({ correct: 'yes' })?.correct === null);

  check('srCeiling anti-spoof', srCeiling(9999, 3) === 340 && srCeiling(100, 3) === 100);

  const scores = [
    { uid: 'a', pts: -5 },
    { uid: 'b', pts: 300 },
    { uid: 'c', pts: -50 },
  ];
  const hp: Record<string, number> = { a: 0, b: 80, c: 30 };
  check(
    "elimination 'and' mode needs floor AND hp death",
    JSON.stringify(evaluateElimination(scores, hp)) === JSON.stringify(['a']),
  );
  check(
    "elimination 'or' mode needs either",
    JSON.stringify(evaluateElimination(scores, hp, { mode: 'or' })) === JSON.stringify(['a', 'c']),
  );

  const SEED = 0xdeadbeef;
  const planPz = roundPlan(SEED, 7, 8, 3, () => false);
  const base: ScoreRec[] = [{ uid: 'H', name: 'HOST', pts: 10 }];
  const table = foldScore(base, { uid: 'H', name: 'HOST', pts: 40 });
  const grown = foldScore(table, { uid: 'C1', name: 'ALPHA', pts: 5 });
  check(
    'foldScore upserts by uid without mutating inputs',
    base.length === 1 &&
      base[0].pts === 10 &&
      table.length === 1 &&
      table[0].pts === 40 &&
      grown.length === 2 &&
      grown[0].pts === 40 &&
      grown[1].uid === 'C1',
  );
  const planTk = roundPlan(SEED, 5, 8, 3, () => true);
  check(
    'roundPlan takeover mirrors main.dealTakeover',
    planTk.kind === 'takeover' &&
      planTk.index === ((SEED ^ Math.imul(5, 97)) >>> 0) % 3 &&
      planTk.stg === 'tk:' + (((SEED ^ Math.imul(5, 97)) >>> 0) % 3) &&
      planTk.seed === ((SEED ^ Math.imul(5, 0x9e37)) >>> 0),
    JSON.stringify(planTk),
  );
  check(
    'roundPlan deterministic',
    JSON.stringify(roundPlan(SEED, 4, 8, 3, () => false)) ===
      JSON.stringify(roundPlan(SEED, 4, 8, 3, () => false)),
  );
  /* The client's half of the seed contract. A `round` frame carries the
   * BOARD seed for one depth, and the client used to store that as its run
   * seed — so host and client rolled different round modifiers, worlds,
   * curses, fate events and emerald offers while both believed they were on
   * the host's seed. runSeedFromRound is the inverse of the derivation
   * roundPlan ships, and it is asserted against the real roundPlan output
   * (not a copy of the formula) across both round kinds and a spread of
   * depths, including the 32-bit wrap the XOR can produce. */
  let seedRoundTrips = true;
  for (const s0 of [SEED, 0, 1, 0xffffffff, 0x9e3779b9]) {
    for (let d = 1; d <= 64; d++) {
      const pz = roundPlan(s0 >>> 0, d, 8, 3, () => false);
      const tk = roundPlan(s0 >>> 0, d, 8, 3, () => true);
      if (runSeedFromRound(pz.seed, d, 'puzzle') !== (s0 >>> 0)) seedRoundTrips = false;
      if (runSeedFromRound(tk.seed, d, 'takeover') !== (s0 >>> 0)) seedRoundTrips = false;
    }
  }
  check('runSeedFromRound inverts roundPlan for every depth and both kinds', seedRoundTrips);
  check(
    'a board seed read as a run seed does NOT survive the round trip (the bug)',
    runSeedFromRound(roundPlan(SEED, 6, 8, 3, () => false).seed, 6, 'puzzle') === SEED &&
      roundPlan(SEED, 6, 8, 3, () => false).seed !== SEED,
  );

  const parsed = parseStg(planPz.stg);
  check(
    'parseStg round-trips pz/tk ids and rejects junk',
    parsed?.kind === 'puzzle' &&
      /* Round-trip is the property under test. This used to assert the
       * literal 6, which was only ever true because the family pick was the
       * scripted (depth-1)%families; it is a seeded bag now. */
      parsed.index === planPz.index &&
      planPz.stg === 'pz:' + planPz.index &&
      parseStg('tk:2')?.kind === 'takeover' &&
      parseStg('evil:9') === null &&
      parseStg('') === null,
  );
}

/* ------------------------------------------------------------------ */
/* Transport scenario: 3 sessions, 500-frame bursts, zero loss/dup      */
/* ------------------------------------------------------------------ */

interface Counters {
  roundsIn: Map<number, number>;
  lobbySeen: number;
  lastLobbySize: number;
}

function makeCounters(): Counters {
  return { roundsIn: new Map<number, number>(), lobbySeen: 0, lastLobbySize: 0 };
}

async function transportScenario(): Promise<void> {
  console.log('[transport] host + 2 clients · 500-frame bursts · dup+reorder delivery');
  const world = new StubWorld(777);
  const ctor = makePeerCtor(world);
  const mkNet = () =>
    createNet({
      makePeer: async () => ctor,
      busFactory: (_code, myId) => new BusStub(world, _code, myId),
    });

  const H = mkNet();
  const C1 = mkNet();
  const C2 = mkNet();

  const hc = makeCounters();
  const c1 = makeCounters();
  const c2 = makeCounters();

  const hosted = await H.host('RACE', 'HOST');
  check('host resolves with requested code', hosted.code === 'RACE', hosted.code);

  const j1 = await C1.join('RACE', 'ALPHA');
  check('join resolves with a roster containing the host', Array.isArray(j1.players) && j1.players.some((p) => p.isHost));

  const j2 = await C2.join('RACE', 'BETA');
  check('second join resolves', Array.isArray(j2.players));
  let targetedC1 = 0;
  let targetedC2 = 0;
  C1.on('targeted-probe', () => targetedC1++);
  C2.on('targeted-probe', () => targetedC2++);
  H.unicast(String(C2.myUid()), { t: 'targeted-probe', value: 'private' });
  await waitFor('targeted frame reaches only its recipient', () => targetedC2 === 1);
  check('host unicast is recipient-bound and dual-transport deduped', targetedC1 === 0 && targetedC2 === 1,
    'c1=' + targetedC1 + ' c2=' + targetedC2);

  // Subscribe AFTER host()/join(): both call teardown() first (v1 parity),
  // which clears any pre-session handlers.
  H.on('lobby', (m) => {
    hc.lobbySeen++;
    hc.lastLobbySize = Array.isArray(m.players) ? m.players.length : 0;
  });
  C1.on('lobby', (m) => {
    c1.lobbySeen++;
    c1.lastLobbySize = Array.isArray(m.players) ? m.players.length : 0;
  });
  C2.on('lobby', (m) => {
    c2.lobbySeen++;
    c2.lastLobbySize = Array.isArray(m.players) ? m.players.length : 0;
  });

  // Poke: a client re-hello (tab-refresh semantics) makes the host
  // re-broadcast its roster so these post-join subscribers see convergence.
  C1.send({ t: 'hello', uid: String(C1.myUid()), name: 'ALPHA' });
  await waitFor('rosters converge at 3', () => hc.lastLobbySize === 3 && c1.lastLobbySize === 3 && c2.lastLobbySize === 3);
  check('roster converges to 3 on all sides', true);

  /* ---- burst A: host → clients, 500 frames ---- */
  C1.on('round', (m) => bumpRound(c1.roundsIn, m.n));
  C2.on('round', (m) => bumpRound(c2.roundsIn, m.n));

  for (let i = 0; i < 500; i++) H.broadcast({ t: 'round', n: i });

  const allOnce = (m: Map<number, number>): boolean =>
    m.size === 500 && [...m.values()].every((c) => c === 1);
  await waitFor('both clients drained the 500-burst', () => allOnce(c1.roundsIn) && allOnce(c2.roundsIn));
  check(
    '500-frame burst: zero loss, zero dup on client 1',
    allOnce(c1.roundsIn),
    'received=' + c1.roundsIn.size + ' maxCount=' + Math.max(0, ...c1.roundsIn.values()),
  );
  check(
    '500-frame burst: zero loss, zero dup on client 2',
    allOnce(c2.roundsIn),
    'received=' + c2.roundsIn.size,
  );

  /* ---- burst B: both clients → host, 250 picks each on BOTH transports ---- */
  const pickKeys = new Set<string>();
  let picksIn = 0;
  H.on('pick', (m) => {
    picksIn++;
    pickKeys.add(String(m.uid) + ':' + String(m.n));
  });
  for (let i = 0; i < 250; i++) {
    C1.send({ t: 'pick', n: i, idx: i % 8 });
    C2.send({ t: 'pick', n: i, idx: i % 8 });
  }
  await waitFor('host drained all 500 picks exactly-once', () => picksIn === 500 && pickKeys.size === 500);
  check(
    'dual-transport client sends: 500 delivered, 500 unique (dedupe collapsed both pipes)',
    picksIn === 500 && pickKeys.size === 500,
    'delivered=' + picksIn + ' unique=' + pickKeys.size,
  );

  /* ---- protocol flow through MpSession ---- */
  console.log('[protocol] begin → round → sr → reveal → elim → end');
  const mh = new MpSession(H, 'host');
  const m1 = new MpSession(C1, 'client');
  const hostEv: string[] = [];
  const cliEv: string[] = [];

  // State lives in a container object: TS control-flow analysis narrows bare
  // `let x = null` to `never` across awaits, but property reads reset at calls.
  const seen = {
    begin: null as { timer: number; sd: number; rn?: string } | null,
    round: null as { n: number; seed: number; id: string; forcedGood?: true; closed: boolean; roundElapsedMs: number } | null,
    reveal: null as { n: number; scores: number } | null,
    elim: null as string[] | null,
    sr: null as { correct: boolean | null; points: number; hpDelta: number } | null,
    endRows: -1,
  };
  m1.subscribe((e) => {
    cliEv.push(e.t);
    if (e.t === 'begin') seen.begin = { timer: e.timer, sd: e.sd, rn: e.rn };
    if (e.t === 'round') seen.round = {
      n: e.n,
      seed: e.stg.seed,
      id: e.stg.id,
      ...(e.forcedGood === true ? { forcedGood: true as const } : {}),
      closed: e.closed,
      roundElapsedMs: e.roundElapsedMs,
    };
    if (e.t === 'reveal') seen.reveal = { n: e.n, scores: e.scores.length };
    if (e.t === 'elim') seen.elim = e.uids;
    if (e.t === 'end') seen.endRows = e.scores.length;
  });
  mh.subscribe((e) => {
    hostEv.push(e.t);
    if (e.t === 'sr') seen.sr = { points: e.sr.points, hpDelta: e.sr.hpDelta, correct: e.sr.correct };
  });
  mh.begin(45, true, 'Shadow Room', 0x1234abcd);
  await waitFor('client saw begin', () => seen.begin != null);
  check(
    'begin frame carries timer/lms/rn/run-seed',
    seen.begin != null && seen.begin.timer === 45 && seen.begin.sd === 0x1234abcd && seen.begin.rn === 'Shadow Room',
    JSON.stringify(seen.begin),
  );

  mh.round(3, 'pz:2', 999, 60, true);
  await waitFor('client saw round', () => seen.round != null);
  check(
    'round frame carries stage ref, seed, forced-good marker, and an open fresh clock',
    seen.round != null && seen.round.n === 3 && seen.round.seed === 999 &&
      seen.round.id === 'pz:2' && seen.round.forcedGood === true &&
      !seen.round.closed && seen.round.roundElapsedMs === 0,
    JSON.stringify(seen.round),
  );
  H.broadcast({
    t: 'round',
    n: 2,
    stg: { id: 'pz:2', seed: 9 },
    timerLen: 60,
    closed: false,
    roundElapsedMs: 0,
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  check(
    'stale lower-depth round is ignored after depth 3',
    cliEv.filter((type) => type === 'round').length === 1 && seen.round?.n === 3,
    cliEv.join(',') + ' / ' + JSON.stringify(seen.round),
  );
  const preClient = mkNet();
  const preJoin = await preClient.join('RACE', 'DELTA');
  const preUid = String(preClient.myUid());
  const preMatch: MpMatchSnapshot = {
    depth: 3,
    scores: [
      { uid: 'HOST', name: 'HOST', pts: 140 },
      { uid: String(C1.myUid()), name: 'ALPHA', pts: 90 },
      { uid: String(C2.myUid()), name: 'BETA', pts: 80 },
      { uid: preUid, name: 'DELTA', pts: 0 },
    ],
    hp: { HOST: 76, [String(C1.myUid())]: 62, [String(C2.myUid())]: 100, [preUid]: 100 },
    phases: {
      HOST: 'alive',
      [String(C1.myUid())]: 'alive',
      [String(C2.myUid())]: 'spectator',
      [preUid]: 'alive',
    },
    prevRanks: { HOST: 1, [String(C1.myUid())]: 2, [String(C2.myUid())]: 3, [preUid]: 4 },
    answered: ['HOST', String(C1.myUid())],
    clocks: { HOST: 12, [String(C1.myUid())]: 19 },
    budget: { HOST: 4, [String(C1.myUid())]: 3, [String(C2.myUid())]: 0, [preUid]: 4 },
    closed: false,
    roundElapsedMs: 55000,
    over: false,
    winnerUid: null,
  };
  const preSession = new MpSession(preClient, 'client', {}, preJoin.players);
  const activeSnapshot = { value: null as RoomSnapshot | null };
  const routedSnapshot = { value: null as RoomSnapshot | null };
  preSession.subscribe((e) => {
    if (e.t === 'room-snapshot') activeSnapshot.value = e;
  });
  mh.setRoomSnapshotProvider(() => preMatch);
  setActiveSession(preSession);
  const stopWire = wireMain({ onRoomSnapshot: (snapshot) => { routedSnapshot.value = snapshot; } });
  preSession.requestRoomName();
  await waitFor('active join receives atomic snapshot', () => activeSnapshot.value?.phase === 'active');
  const active = activeSnapshot.value?.phase === 'active' ? activeSnapshot.value : null;
  check(
    'active snapshot carries current forced-good round and full LMS ledger',
    active?.round?.forcedGood === true && active.round.closed === false &&
      active.round.roundElapsedMs === 55000 && active.match.depth === 3 &&
      active.match.closed === false && active.match.roundElapsedMs === 55000 &&
      active.match.answered.includes(String(C1.myUid())) &&
      active.match.scores.some((row) => row.uid === preUid && row.pts === 0) &&
      active.match.hp[preUid] === 100,
    JSON.stringify(active),
  );
  check(
    'snapshot contains no pre-reveal answer and wireMain dispatches it',
    !!active && !('answer' in active) &&
      !!active.round && !('answer' in active.round) && !('answerIdx' in active.round) &&
      !('answer' in active.match) && routedSnapshot.value?.phase === 'active',
    JSON.stringify({ active: active?.phase, routed: routedSnapshot.value?.phase }),
  );
  stopWire();
  setActiveSession(null);


  m1.sendSr(3, { correct: true, points: 9999, hpDelta: -999 }); // spoofed verdict
  await waitFor('host saw sanitized sr', () => seen.sr != null);
  check(
    'spoofed sr verdict clamped at the door (points 500, hp -60)',
    seen.sr != null && seen.sr.points === 500 && seen.sr.hpDelta === -60 && seen.sr.correct === true,
    JSON.stringify(seen.sr),
  );

  mh.reveal(3, 2, [
    { uid: 'HOST', name: 'HOST', pts: 140 },
    { uid: String(C1.myUid()), name: 'ALPHA', pts: 90 },
  ]);
  await waitFor('client saw reveal', () => seen.reveal != null);
  check('reveal folds 2 score rows at n=3', seen.reveal != null && seen.reveal.n === 3 && seen.reveal.scores === 2);

  mh.eliminate([String(C2.myUid())]);
  await waitFor('client saw elim', () => seen.elim != null);
  check('elim frame carries uids', JSON.stringify(seen.elim) === JSON.stringify([String(C2.myUid())]));

  const endedMatch: MpMatchSnapshot = {
    ...preMatch,
    closed: true,
    roundElapsedMs: 60000,
    over: true,
    winnerUid: 'HOST',
  };
  mh.setRoomSnapshotProvider(() => endedMatch);
  mh.endMatch(endedMatch.scores, 'last-standing', 'HOST');
  await waitFor('client saw end', () => seen.endRows === endedMatch.scores.length);
  check('end frame carries final score table', seen.endRows === endedMatch.scores.length);

  check(
    'client event stream saw the full protocol in order',
    (() => {
      // m1 subscribes post-join, so its first observed frame is begin.
      const want = ['begin', 'round', 'reveal', 'elim', 'end'];
      let wi = 0;
      for (const t of cliEv) {
        if (wi < want.length && t === want[wi]) wi++;
      }
      return wi === want.length;
    })(),
    cliEv.join(','),
  );
  check('host sr relay observed exactly once', hostEv.filter((t) => t === 'sr').length === 1, hostEv.join(','));

  /* ---- resilience: host broker leg dies mid-lobby (idle-host repro) ---- */
  console.log('[resilience] host broker death → bus-only join must succeed');
  const hostPeer = world.peers.get('iqb-RACE') ?? world.peers.get('iqb-RACE2');
  check('host peer currently registered with broker', hostPeer != null);
  hostPeer?.simulateBrokerDeath();

  const C3 = mkNet();
  const seen3 = { lobbySize: 0, roundN: -1 };
  const j3 = await C3.join('RACE', 'GAMMA'); // peer.connect now dead — bus must carry it
  check(
    'join resolves while host has NO broker connection',
    Array.isArray(j3.players),
    'players=' + JSON.stringify(j3.players),
  );
  C3.on('lobby', (m) => {
    seen3.lobbySize = Array.isArray(m.players) ? m.players.length : 0;
  });
  C3.on('round', (m) => {
    if (typeof m.n === 'number') seen3.roundN = m.n;
  });

  // A post-match join receives the complete terminal state, never replayed
  // begin/round frames that would remount a stale challenge.
  const m3 = new MpSession(C3, 'client', {}, j3.players);
  const caught = { snapshot: null as RoomSnapshot | null };
  m3.subscribe((e) => {
    if (e.t === 'room-snapshot') caught.snapshot = e;
  });
  setActiveSession(m3);
  const stopTerminalWire = wireMain({ onRoomSnapshot: (snapshot) => { caught.snapshot = snapshot; } });

  // Poke the roster so post-subscribe observers see convergence at 5.
  C1.send({ t: 'hello', uid: String(C1.myUid()), name: 'ALPHA' });
  await waitFor('roster converges to 5 everywhere', () => hc.lastLobbySize === 5 && c2.lastLobbySize === 5 && seen3.lobbySize === 5);
  check('5-player roster converges over surviving transport', true);

  H.broadcast({ t: 'round', n: 600 });
  await waitFor('post-death broadcast reaches GAMMA', () => seen3.roundN === 600);
  check('host still authoritative after broker death', seen3.roundN === 600);

  await waitFor('terminal snapshot delivered to GAMMA', () => caught.snapshot?.phase === 'ended');
  const terminal = caught.snapshot?.phase === 'ended' ? caught.snapshot : null;
  check(
    'late joiner receives one complete ended snapshot without entering the finished table',
    terminal?.match.over === true && terminal.match.closed === true &&
      terminal.match.roundElapsedMs === 60000 && terminal.match.winnerUid === 'HOST' &&
      terminal.end.scores.length === endedMatch.scores.length && terminal.end.winnerUid === 'HOST' &&
      !terminal.match.scores.some((row) => row.uid === String(C3.myUid())),
    JSON.stringify(terminal),
  );
  stopTerminalWire();
  setActiveSession(null);

  /* ---- handshake-ordering race: peerjs load lags the bus reply ---- */
  console.log('[race] slow peerjs load vs instant bus lobby reply');
  const C4 = createNet({
    // Fresh-tab repro: the script tag takes ~seconds on first load; the
    // stub compresses that to 60ms — still far above stub bus latency.
    makePeer: () => new Promise<PeerCtor>((resolve) => setTimeout(() => resolve(ctor), 60)),
    busFactory: (_code, myId) => new BusStub(world, _code, myId),
  });
  const j4 = await C4.join('RACE', 'EPSILON');
  check(
    'join completes when the host reply outruns the peer constructor',
    Array.isArray(j4.players),
    'players=' + JSON.stringify(j4.players?.length ?? 0),
  );

  /* ---- brokerless: peerjs never arrives — bus-only host + join ---- */
  console.log('[brokerless] dead broker/CDN must not block same-browser MP');
  const noPeer = {
    makePeer: async (): Promise<PeerCtor | null> => null, // CDN down forever
    busFactory: (_code: string, myId: string) => new BusStub(world, _code, myId),
  };
  const HB = createNet(noPeer);
  const JB = createNet({ ...noPeer });
  const hb = await HB.host('LONELY', 'HOSTB');
  check('host opens WITHOUT peerjs (bus-only room)', hb.code === 'LONELY', hb.code);
  const seenB = { hSize: 0, jSize: 0 };
  HB.on('lobby', (m) => {
    seenB.hSize = Array.isArray(m.players) ? m.players.length : 0;
  });
  const jb = await JB.join('LONELY', 'HERMIT');
  JB.on('lobby', (m) => {
    seenB.jSize = Array.isArray(m.players) ? m.players.length : 0;
  });
  check(
    'join completes fully brokerless (zero PeerJS involvement)',
    Array.isArray(jb.players),
    JSON.stringify(jb.players?.length ?? 0),
  );
  // Poke: re-hello makes the bus-only host re-broadcast its roster for our
  // post-handshake subscribers.
  JB.send({ t: 'hello', uid: String(JB.myUid()), name: 'HERMIT' });
  await waitFor('brokerless roster converges at 2', () => seenB.hSize === 2 && seenB.jSize === 2);
  check('bus-only roster converges to 2', true);

  // Joiner whose peer leg NEVER lands (hung WS handshake): bus carries it.
  const C5 = createNet({
    makePeer: () => new Promise<PeerCtor>(() => undefined), // never resolves
    busFactory: (_code, myId) => new BusStub(world, _code, myId),
  });
  const j5 = await C5.join('RACE', 'FROZENLEG');
  check(
    'join resolves while the peer leg hangs forever',
    Array.isArray(j5.players),
  );

  console.log('  (stub deliveries scheduled: ' + world.scheduled + ')');
}
async function deterministicCatchupScenario(): Promise<void> {
  console.log('[catchup] explicit delivery order through real net/session/director consumers');
  for (const mode of ['active', 'closed', 'ended', 'stale-open', 'stale-terminal', 'stale-overflow'] as const) {
    const stale = mode.startsWith('stale-');
    const world = new StubWorld(200);
    const ctor = makePeerCtor(world);
    const host = createNet({
      makePeer: async () => ctor,
      busFactory: (code, uid) => new BusStub(world, code, uid),
    });
    const rival = createNet({
      makePeer: async () => null,
      busFactory: (code, uid) => new BusStub(world, code, uid),
    });
    const guest = createNet({
      makePeer: async () => ctor,
      busFactory: (code, uid) => new BusStub(world, code, uid),
    });
    let stopWire: () => void = () => undefined;
    await host.host('ORDER', 'HOST');
    const hostSession = new MpSession(host, 'host', {}, [{ id: 'HOST', name: 'HOST', isHost: true }]);
    hostSession.setRoomName('Ordering Room');
    world.manual = true;
    const joiningRival = rival.join('ORDER', 'RIVAL');
    world.flush();
    await joiningRival;
    let elapsed = 55;
    let hostDepth = 3;
    const hostDir = createDirector({
      role: 'host', myUid: 'HOST',
      wire: {
        reveal: (n, a, scores, hp) => hostSession.reveal(n, a, scores, hp),
        pushScores: (n, scores, hp, reason) => hostSession.pushScores(n, scores, hp, reason),
        eliminate: (uids) => hostSession.eliminate(uids),
        endMatch: (scores, reason, winner) => hostSession.endMatch(scores, reason, winner),
        sendSr: (n, verdict) => hostSession.sendSr(n, verdict),
        attack: (target, weapon, n) => hostSession.attack(target, weapon, n),
        roster: () => hostSession.rosterNow(),
      },
      depth: () => hostDepth, kind: () => 'puzzle', answerIdx: () => 2,
      diffAt: () => 1, sanctuaryAt: () => false, scoreMul: () => 1,
      clockSec: () => elapsed,
      toast: () => undefined, advance: () => undefined,
      finish: () => undefined, changed: () => undefined,
    }, hostSession.rosterNow().map((p) => ({ uid: p.id, name: p.name })), 1234);
    hostSession.subscribe((event) => hostDir.handle(event));
    hostSession.setRoomSnapshotProvider((uid) => hostDir.snapshotForJoin(uid));
    hostSession.begin(60, true, 'Ordering Room', 1234);
    if (stale) {
      // Earn a real prior-round balance: timeout must move 140 -> 100,
      // rather than testing a negative score below the existing zero floor.
      hostDepth = 2;
      hostDir.openDepth(2);
      hostSession.round(2, 'pz:2', 998, 60);
      hostDir.answer(true, 140, 0);
      rival.send({ t: 'sr', n: 2, sr: { correct: 1, points: 140, hpDelta: 0 } });
      world.flush();
      hostDepth = 3;
    }
    hostDir.openDepth(3);
    hostSession.round(3, 'pz:2', 999, 60, true);
    hostDir.answer(true, 140, 0);
    world.flush();
    if (mode === 'closed' || mode === 'ended') {
      elapsed = 60;
      rival.send({ t: 'sr', n: 3, sr: { correct: 0, points: -40, hpDelta: -12 } });
      world.flush();
    }
    if (mode === 'ended') {
      rival.leave();
      world.flush();
    }
    // Broker loss makes the RTC upgrade fail; the existing bus room survives.
    world.peers.get('iqb-ORDER')!.simulateBrokerDeath();
    const joiningGuest = guest.join('ORDER', 'GUEST');
    await waitFor('RTC failure is queued before bus join', () =>
      world.pending.some((item) => item.type === 'connection-error'));
    world.flush('hello');
    world.flush('lobby');
    const joined = await joiningGuest;
    const session = new MpSession(guest, 'client', {}, joined.players);
    const events: string[] = [];
    session.subscribe((event) => events.push(event.t));
    session.requestRoomName();
    world.flush('metaReq');
    world.flush('meta');
    world.flush('lobby');
    check(mode + ': metadata arrives before lazy UI finishes without consuming catch-up',
      session.roomName() === 'Ordering Room' && !events.includes('room-snapshot'),
      events.join(','));

    const clientDir = createDirector({
      role: 'client', myUid: String(guest.myUid()),
      wire: {
        reveal: (n, a, scores, hp) => session.reveal(n, a, scores, hp),
        pushScores: (n, scores, hp, reason) => session.pushScores(n, scores, hp, reason),
        eliminate: (uids) => session.eliminate(uids),
        endMatch: (scores, reason, winner) => session.endMatch(scores, reason, winner),
        sendSr: (n, verdict) => session.sendSr(n, verdict),
        attack: (target, weapon, n) => session.attack(target, weapon, n),
        roster: () => session.rosterNow(),
      },
      depth: () => 3, kind: () => 'puzzle', answerIdx: () => 2,
      diffAt: () => 1, sanctuaryAt: () => false, scoreMul: () => 1,
      clockSec: () => elapsed,
      toast: () => undefined, advance: () => undefined,
      finish: () => undefined, changed: () => undefined,
    }, joined.players.map((p) => ({ uid: p.id, name: p.name })), 1234);
    const view = {
      snapshot: null as RoomSnapshot | null, mounts: 0, prematureEnds: 0,
      roundMounts: 0, reveals: 0, ends: 0,
    };
    try {
      setActiveSession(session);
      stopWire = wireMain({
        onBegin: () => { view.mounts++; },
        onRound: (event) => {
          if (!stale) return;
          view.roundMounts++;
          clientDir.openDepth(event.n);
        },
        onReveal: (event) => {
          if (!stale) return;
          view.reveals++;
          clientDir.handle(event);
        },
        onScores: (event) => { if (stale) clientDir.handle(event); },
        onElim: (event) => { if (stale) clientDir.handle(event); },
        onEnd: (event) => {
          if (event.reason === 'host-left') view.prematureEnds++;
          if (stale) { view.ends++; clientDir.handle(event); }
        },
        onRoomSnapshot: (snapshot) => {
          view.snapshot = snapshot;
          const mountedDepth = clientDir.state().depth;
          if (snapshot.phase !== 'lobby') clientDir.restoreSnapshot(snapshot.match);
          if (stale && snapshot.phase === 'active' && snapshot.round &&
            snapshot.round.n > mountedDepth) view.roundMounts++;
        },
      });
      // Force the exact old red ordering: failed RTC upgrade after successful
      // bus join, then the authoritative targeted snapshot.
      world.flush('connection-error');
      world.flush('metaReq');
      // A live begin/round/end can beat catch-up on the other transport.
      host.broadcast({ t: 'begin', timer: 60, lms: 1, rn: 'Ordering Room', sd: 1234 });
      host.broadcast({ t: 'round', n: 3, stg: { id: 'pz:2', seed: 999 },
        timerLen: 60, forcedGood: true, closed: false, roundElapsedMs: 0 });
      world.flush('begin');
      world.flush('round');
      if (stale) {
        // The OPEN ledger is already captured and queued. Closing the SAME
        // depth now sends a newer reveal that wins the delivery race.
        elapsed = 60;
        if (mode === 'stale-terminal') {
          hostDir.applyRoundHpDeltas(3, 'terminal-after-capture', [
            { uid: String(rival.myUid()), hpDelta: -100 },
            { uid: String(guest.myUid()), hpDelta: -100 },
          ]);
        }
        hostDir.timeout();
        world.flush('reveal');
        check(mode + ': live consumer is closed before the older snapshot arrives',
          clientDir.state().closed && !clientDir.mayAnswer() && view.reveals === 1 &&
          clientDir.state().hp.HOST === 100 &&
          clientDir.state().hp[String(guest.myUid())] === (mode === 'stale-terminal' ? 0 : 88) &&
          clientDir.state().hp[String(rival.myUid())] === (mode === 'stale-terminal' ? 0 : 88) &&
          clientDir.state().table.some((row) => row.uid === String(rival.myUid()) && row.pts === 100),
          JSON.stringify(clientDir.state()));
        if (mode === 'stale-terminal') {
          world.flush('elim');
          world.flush('end');
        }
        if (mode === 'stale-overflow') {
          // More authority events than the bounded pre-bootstrap journal.
          // An obsolete capture must trigger a complete recapture, not loss.
          for (let i = 0; i < 600; i++) {
            hostSession.pushScores(3, hostDir.state().table, hostDir.state().hp);
          }
        }
        world.flush('scores');
      }
      if (mode === 'ended') {
        host.broadcast({ t: 'end', scores: hostDir.state().table,
          reason: 'last-standing', winnerUid: 'HOST' });
        world.flush('end');
      }
      world.flush();
      const snapshot = view.snapshot;
      const expected = hostDir.snapshotForJoin(String(guest.myUid()));
      if (stale) {
        check(mode + ': bootstrap preserves newer reveal scores, HP and answer lock',
          snapshot?.phase === (mode === 'stale-terminal' ? 'ended' : 'active') &&
          snapshot.match.closed &&
          (snapshot.phase !== 'active' || snapshot.round?.closed === true) &&
          clientDir.state().closed && !clientDir.mayAnswer() &&
          clientDir.state().hp.HOST === 100 &&
          clientDir.state().hp[String(guest.myUid())] === (mode === 'stale-terminal' ? 0 : 88) &&
          clientDir.state().hp[String(rival.myUid())] === (mode === 'stale-terminal' ? 0 : 88) &&
          JSON.stringify(clientDir.state().table) === JSON.stringify(hostDir.state().table),
          JSON.stringify({ snapshot, state: clientDir.state() }));
        check(mode + ': the full older ledger survives without repeating scoring or mounting',
          clientDir.state().clocks.HOST === 55 && clientDir.state().answered.includes('HOST') &&
          clientDir.state().budget.HOST === hostDir.state().budget.HOST &&
          view.reveals === 1 && view.roundMounts === 1 &&
          events.filter((type) => type === 'room-snapshot').length === 1,
          JSON.stringify({ state: clientDir.state(), reveals: view.reveals, mounts: view.roundMounts, events }));
        if (mode === 'stale-terminal') {
          check('stale-terminal: elimination/end authority survives the older active capture',
            clientDir.state().over && clientDir.state().winnerUid === 'HOST' && view.ends === 1 &&
            clientDir.state().phases[String(rival.myUid())] === 'spectator' &&
            clientDir.state().phases[String(guest.myUid())] === 'spectator',
            JSON.stringify(clientDir.state()));
        }
        guest.send({ t: 'metaReq', snapshot: true });
        world.flush();
        check(mode + ': duplicate snapshot and reveal copies cannot reopen or refold the round',
          clientDir.state().closed && !clientDir.mayAnswer() && view.reveals === 1 &&
          view.roundMounts === 1 && events.filter((type) => type === 'room-snapshot').length === 1 &&
          JSON.stringify(clientDir.state().table) === JSON.stringify(hostDir.state().table));
        continue;
      }
      check(mode + ': consumer receives the complete current snapshot exactly once',
        !!snapshot && snapshot.phase === (mode === 'ended' ? 'ended' : 'active') &&
        events.filter((type) => type === 'room-snapshot').length === 1 &&
        view.prematureEnds === 0 &&
        JSON.stringify(snapshot.match) === JSON.stringify(expected),
        JSON.stringify({ snapshot, prematureEnds: view.prematureEnds, events }));
      check(mode + ': visible standings and answer lock restore from the host ledger',
        JSON.stringify(clientDir.rows().map(({ you, targetable, ...standing }) => standing)) ===
          JSON.stringify(hostDir.rows().map(({ you, targetable, ...standing }) => standing)) &&
        clientDir.state().depth === 3 &&
        clientDir.state().closed === (mode !== 'active') &&
        clientDir.state().over === (mode === 'ended') &&
        clientDir.mayAnswer() === (mode === 'active'),
        JSON.stringify(clientDir.state()));
      guest.send({ t: 'metaReq', snapshot: true });
      world.flush();
      check(mode + ': repeated requests and duplicated transport copies do not remount',
        events.filter((type) => type === 'room-snapshot').length === 1 && view.mounts === 1);
      if (mode === 'ended') {
        check('ended: late guest never enters the finished standings',
          !clientDir.rows().some((row) => row.uid === guest.myUid()) &&
          clientDir.state().winnerUid === 'HOST');
      }
    } finally {
      stopWire();
      setActiveSession(null);
      session.leave();
      rival.leave();
      hostSession.leave();
      world.flush();
    }
  }
}

async function captureResourcesScenario(): Promise<void> {
  console.log('[capture-resources] real earned balance, fractional response clock and spent attack allowance');
  for (const mode of ['same-depth-spent', 'advanced-depth-spent', 'terminal-spent',
    'cold-funded', 'cold-unfunded', 'newer-depth-refill'] as const) {
    const cold = mode.startsWith('cold-');
    const world = new StubWorld(402);
    const makeNet = () => createNet({
      makePeer: async () => null,
      busFactory: (code, uid) => new BusStub(world, code, uid),
    });
    const host = makeNet();
    const guest = makeNet();
    const rival = makeNet();
    await host.host('RESOURCE', 'HOST');
    const hostSession = new MpSession(host, 'host', {}, [{ id: 'HOST', name: 'HOST', isHost: true }]);
    hostSession.setRoomName('Resource Room');
    world.manual = true;
    const joinGuest = guest.join('RESOURCE', 'GUEST');
    world.flush();
    const joined = await joinGuest;
    const session = new MpSession(guest, 'client', {}, joined.players);
    const joinRival = rival.join('RESOURCE', 'RIVAL');
    world.flush();
    await joinRival;
    const guestUid = String(guest.myUid());
    const rivalUid = String(rival.myUid());
    let depth = 1;
    let elapsed = 12.345;
    const toasts: string[] = [];
    const makeDir = (mp: MpSession, role: 'host' | 'client') => createDirector({
      role, myUid: String(mp.myUid()),
      wire: {
        reveal: (n, a, scores, hp) => mp.reveal(n, a, scores, hp),
        pushScores: (n, scores, hp, reason) => mp.pushScores(n, scores, hp, reason),
        eliminate: (uids) => mp.eliminate(uids),
        endMatch: (scores, reason, winner) => mp.endMatch(scores, reason, winner),
        sendSr: (n, verdict) => mp.sendSr(n, verdict),
        attack: (target, weapon, n) => mp.attack(target, weapon, n),
        roster: () => mp.rosterNow(),
      },
      depth: () => depth, kind: () => 'puzzle', answerIdx: () => 2,
      diffAt: () => 1, sanctuaryAt: () => false, scoreMul: () => 1,
      clockSec: () => elapsed,
      toast: (msg) => { if (role === 'client') toasts.push(msg); },
      advance: () => undefined, finish: () => undefined, changed: () => undefined,
    }, mp.rosterNow().map((p) => ({ uid: p.id, name: p.name })), 4321);
    const hostDir = makeDir(hostSession, 'host');
    const clientDir = makeDir(session, 'client');
    const delivered: RoomSnapshot[] = [];
    let attackFrames = 0;
    host.on('attack', () => { attackFrames++; });
    hostSession.subscribe((event) => hostDir.handle(event));
    hostSession.setRoomSnapshotProvider((uid) => hostDir.snapshotForJoin(uid));
    setActiveSession(session);
    const stopWire = wireMain({
      onRound: (event) => { if (!cold) clientDir.openDepth(event.n); },
      onReveal: (event) => { if (!cold) clientDir.handle(event); },
      onScores: (event) => { if (!cold) clientDir.handle(event); },
      onElim: (event) => { if (!cold) clientDir.handle(event); },
      onEnd: (event) => { if (!cold) clientDir.handle(event); },
      onRoomSnapshot: (snapshot) => {
        delivered.push(snapshot);
        if (snapshot.phase !== 'lobby') clientDir.restoreSnapshot(snapshot.match);
      },
    });
    const capture = () => {
      guest.send({ t: 'metaReq', snapshot: true });
      world.flush('metaReq');
      world.flush('meta');
      world.flush('lobby');
    };
    const open = (n: number) => {
      depth = n;
      hostDir.openDepth(n);
      hostSession.round(n, 'pz:2', 900 + n, 60);
      world.flush('round');
    };
    const guestAnswer = () => {
      if (cold) guest.send({ t: 'sr', n: depth, sr: { correct: 1, points: 140, hpDelta: 0 } });
      else clientDir.answer(true, 140, 0);
      world.flush('sr');
    };
    const rivalAnswer = () => {
      rival.send({ t: 'sr', n: depth, sr: { correct: 1, points: 140, hpDelta: 0 } });
      world.flush('sr');
      world.flush('reveal');
    };
    try {
      hostSession.begin(60, true, 'Resource Room', 4321);
      world.flush('begin');
      // Two genuine puzzle rounds fund both the attacker and the victim.
      // A cold consumer deliberately has not installed any per-depth budget.
      for (const n of [1, 2]) {
        open(n);
        hostDir.answer(true, 140, 0);
        if (mode !== 'cold-unfunded') guestAnswer();
        if (n === 2 && mode === 'advanced-depth-spent') capture();
        rivalAnswer();
        if (mode === 'cold-unfunded') {
          hostDir.timeout();
          world.flush('reveal');
        }
      }
      open(3);
      hostDir.answer(true, 140, 0);
      check(mode + ': real host response clock records exact fractional seconds',
        hostDir.state().clocks.HOST === 12.345, JSON.stringify(hostDir.state().clocks));
      if (mode !== 'advanced-depth-spent' && mode !== 'newer-depth-refill') capture();
      if (!cold) {
        check(mode + ': live current-depth throw is funded before the first snapshot',
          delivered.length === 0 && clientDir.budget() === 1 &&
          clientDir.attackMenu().some((entry) => entry.spec.id === 'rotten' && entry.affordable) &&
          clientDir.rows().some((row) => row.uid === 'HOST' && row.targetable));
        clientDir.throwAt('HOST', 'rotten');
        world.flush('attack');
        world.flush('scores');
        check(mode + ': first real throw spends host and client allowance exactly once',
          clientDir.budget() === 0 && hostDir.state().budget[guestUid] === 0 &&
          attackFrames === 1 && toasts.filter((msg) => msg === 'ROTTEN THROWN').length === 1,
          JSON.stringify({ client: clientDir.state(), host: hostDir.state(), attackFrames, toasts }));
      } else {
        check(mode + ': cold default budget is absent, not known spent authority',
          clientDir.state().depth === 0 && clientDir.budget() === 0 &&
          !(guestUid in clientDir.state().budget));
      }
      if (mode === 'terminal-spent') {
        hostDir.applyRoundHpDeltas(3, 'terminal-after-spend', [
          { uid: guestUid, hpDelta: -100 }, { uid: rivalUid, hpDelta: -100 },
        ]);
        hostDir.timeout();
        world.flush('scores');
        world.flush('reveal');
        world.flush('elim');
        world.flush('end');
      }
      if (mode === 'newer-depth-refill') {
        guestAnswer();
        rivalAnswer();
        depth = 4;
        hostDir.openDepth(4);
        hostSession.round(4, 'pz:2', 904, 60);
        hostDir.answer(true, 140, 0);
        // The newer capture arrives while the local depth-3 allowance is spent.
        capture();
        world.flush('room-snapshot');
      } else {
        world.flush('room-snapshot');
      }
      const snapshot = delivered[0];
      if (mode === 'advanced-depth-spent') {
        // A real newer round clears the old depth's clocks. Live scores do
        // not carry response clocks, so never invent one from the old capture.
        check(mode + ': a newer round clears captured prior-depth response clocks',
          delivered.length === 1 && snapshot?.phase === 'active' &&
          snapshot.match.depth === 3 && clientDir.rows().find((row) => row.uid === 'HOST')?.clock === null);
      } else {
        check(mode + ': bootstrap retains the exact host response clock in sidebar rows',
          delivered.length === 1 && snapshot?.phase !== 'lobby' &&
          clientDir.state().clocks.HOST === 12.345 &&
          clientDir.rows().find((row) => row.uid === 'HOST')?.clock === 12.345,
          JSON.stringify({ snapshot, state: clientDir.state() }));
      }
      check(mode + ': bootstrap keeps the full authoritative table and HP ledger',
        JSON.stringify(clientDir.state().table) === JSON.stringify(hostDir.state().table) &&
        JSON.stringify(clientDir.state().hp) === JSON.stringify(hostDir.state().hp),
        JSON.stringify({ client: clientDir.state(), host: hostDir.state() }));
      if (cold || mode === 'newer-depth-refill') {
        check(mode + ': a legitimate initial or newer-depth allowance is not suppressed',
          clientDir.budget() === 1 && hostDir.state().budget[guestUid] === 1 &&
          clientDir.rows().some((row) => row.uid === 'HOST' && row.targetable) &&
          (mode === 'cold-unfunded' ||
            clientDir.attackMenu().some((entry) => entry.spec.id === 'rotten' && entry.affordable)),
          JSON.stringify(clientDir.state()));
      } else {
        const table = JSON.stringify(hostDir.state().table);
        const thrown = toasts.filter((msg) => msg === 'ROTTEN THROWN').length;
        const frames = attackFrames;
        check(mode + ': bootstrap cannot resurrect the spent current-depth allowance or target UI',
          clientDir.budget() === 0 && hostDir.state().budget[guestUid] === 0 &&
          !clientDir.rows().some((row) => row.targetable),
          JSON.stringify({ snapshot, state: clientDir.state() }));
        clientDir.throwAt('HOST', 'rotten');
        world.flush('attack');
        world.flush('scores');
        check(mode + ': no second throw frame or THROWN UI acknowledgement after bootstrap',
          attackFrames === frames && toasts.filter((msg) => msg === 'ROTTEN THROWN').length === thrown &&
          JSON.stringify(hostDir.state().table) === table,
          JSON.stringify({ attackFrames, toasts, state: clientDir.state() }));
        if (mode === 'terminal-spent') {
          check('terminal-spent: terminal state still forbids answering and attacking',
            snapshot?.phase === 'ended' && clientDir.state().over &&
            !clientDir.mayAnswer() && !clientDir.mayAttack());
        } else {
          guestAnswer();
          rivalAnswer();
          open(4);
          check(mode + ': the next real depth refills the spent allowance normally',
            clientDir.budget() === 1 && hostDir.state().budget[guestUid] === 1 &&
            clientDir.rows().some((row) => row.uid === 'HOST' && row.targetable));
        }
      }
    } finally {
      stopWire();
      setActiveSession(null);
      session.leave();
      rival.leave();
      hostSession.leave();
      world.flush();
    }
  }
}

async function survivingBusPresenceScenario(): Promise<void> {
  console.log('[presence] a closed RTC leg cannot retire a live bus seat');
  const world = new StubWorld(301);
  const ctor = makePeerCtor(world);
  let clock = 1000;
  const options = {
    makePeer: async () => ctor,
    busFactory: (code: string, uid: string) => new BusStub(world, code, uid),
    now: () => clock, presenceIntervalMs: 5, presenceLeaseMs: 40,
  };
  const host = createNet(options);
  const client = createNet(options);
  await host.host('SURVIVE', 'HOST');
  world.manual = true;
  let leaves = 0;
  let ends = 0;
  let rosterSize = 0;
  host.on('peer-leave', () => { leaves++; });
  host.on('lobby', (frame) => {
    rosterSize = Array.isArray(frame.players) ? frame.players.length : 0;
  });
  const joining = client.join('SURVIVE', 'GUEST');
  await waitFor('both RTC endpoints are open before bus handshake drains', () => {
    const pair = world.connectionPairs[0];
    return !!pair && pair.client.open && pair.host.open;
  });
  world.flush();
  await joining;
  client.on('end', () => { ends++; });
  const pair = world.connectionPairs[0];
  try {
    pair.client.close();
    pair.host.close();
    for (let tick = 0; tick < 8; tick++) {
      clock += 10;
      await new Promise<void>((resolve) => setTimeout(resolve, 6));
      world.flush();
    }
    host.refreshLobby();
    world.flush();
    check('live bus heartbeats preserve both roles beyond the RTC-loss lease',
      leaves === 0 && ends === 0 && rosterSize === 2,
      JSON.stringify({ leaves, ends, rosterSize }));
    client.leave();
    world.flush();
    check('explicit departure retires a bus seat once despite duplicate deliveries',
      leaves === 1 && rosterSize === 1 && ends === 0,
      JSON.stringify({ leaves, ends, rosterSize }));
  } finally {
    client.leave();
    host.leave();
    world.flush();
  }
  clock += 100;
  await new Promise<void>((resolve) => setTimeout(resolve, 15));
  check('leave closes the bus and stops presence deliveries',
    world.busHub('SURVIVE').size === 0 && world.pending.length === 0);
}

async function presenceFailureScenario(): Promise<void> {
  console.log('[presence] silent RTC failure with open DataChannels expires both seats');
  const world = new StubWorld(73);
  const ctor = makePeerCtor(world);
  let clock = 1000;
  const opts = {
    makePeer: async (): Promise<PeerCtor> => ctor,
    busFactory: (code: string, uid: string) => new BusStub(world, code + '-' + uid, uid),
    now: () => clock,
    presenceIntervalMs: 5,
    presenceLeaseMs: 40,
  };
  const host = createNet(opts);
  const client = createNet(opts);
  await host.host('FADE', 'HOST');
  let leaves = 0;
  host.on('peer-leave', (f) => {
    if (f.id === client.myUid()) leaves++;
  });
  await client.join('FADE', 'GUEST');
  const ended = { reason: null as string | null };
  client.on('end', (f) => {
    if (typeof f.reason === 'string') ended.reason = f.reason;
  });
  const pair = world.connectionPairs[0];
  check('realistic peer path is open before silent failure', !!pair && pair.client.open && pair.host.open);
  if (!pair) {
    host.leave();
    client.leave();
    return;
  }

  const clockTimer = setInterval(() => { clock += 5; }, 5);
  await new Promise<void>((resolve) => setTimeout(resolve, 60));
  check('active direct heartbeats do not retire an idle seat', leaves === 0 && pair.client.open && pair.host.open);

  pair.client.dropData = true;
  pair.host.dropData = true;
  const channelsStayedOpen = pair.client.open && pair.host.open;
  await waitFor('open but silent peer expires by heartbeat lease', () => leaves === 1 && ended.reason === 'host-left', 1000);
  clearInterval(clockTimer);
  check('silent RTC failure is bounded despite open DataChannels', channelsStayedOpen && leaves === 1 && ended.reason === 'host-left',
    'channelsOpen=' + channelsStayedOpen + ' leaves=' + leaves + ' end=' + ended.reason);
  host.leave();
  client.leave();
}

async function busLeaseScenario(): Promise<void> {
  console.log('[presence] bus-only seats expire when client heartbeat stops');
  const world = new StubWorld(91);
  let clock = 2000;
  const opts = {
    makePeer: async (): Promise<PeerCtor | null> => null,
    busFactory: (_code: string, uid: string) => new BusStub(world, _code, uid),
    now: () => clock,
    presenceIntervalMs: 5,
    presenceLeaseMs: 25,
  };
  const host = createNet(opts);
  const client = createNet({ ...opts, presenceIntervalMs: 100000 });
  await host.host('BUSLEASE', 'HOST');
  let leaves = 0;
  host.on('peer-leave', () => leaves++);
  await client.join('BUSLEASE', 'GUEST');
  // Keep time moving while already-scheduled deliveries drain.
  const clockTimer = setInterval(() => { clock += 5; }, 5);
  await waitFor('bus-only guest expires after missed heartbeat lease', () => leaves === 1, 1000);
  clearInterval(clockTimer);
  check('bus-only heartbeat lease retires exactly one stale seat', leaves === 1);
  host.leave();
  client.leave();
}


function bumpRound(m: Map<number, number>, n: unknown): void {
  if (typeof n !== 'number') return;
  m.set(n, (m.get(n) ?? 0) + 1);
}

/* ------------------------------------------------------------------ */
/* Runner                                                               */
/* ------------------------------------------------------------------ */

(async () => {
  console.log('== iqbattle v2 · net2/mp self-test ==');
  pureChecks();
  await transportScenario();
  await deterministicCatchupScenario();
  await captureResourcesScenario();
  await survivingBusPresenceScenario();
  await presenceFailureScenario();
  await busLeaseScenario();
  if (failures > 0) {
    console.error('\nSELFTEST FAILED — ' + failures + ' failing check(s)');
    process.exit(1);
  }
  console.log('\nSELFTEST PASSED — pure logic + dual-transport bursts exactly-once');
  process.exit(0);
})().catch((e: unknown) => {
  console.error('HARNESS CRASH', e);
  process.exit(2);
});
