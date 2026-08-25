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
 * elim → end) and the pure fold/clamp/LMS/roundPlan logic.
 *
 * Determinism: the harness RNG is mulberry32(seed) — no Math.random here.
 * ==========================================================================*/

import { createNet, type BusHandle, type DataConnLike, type Frame, type PeerCtor, type PeerLike } from './net2.ts';
import {
  clampSr,
  evaluateElimination,
  foldScore,
  parseStg,
  roundPlan,
  srCeiling,
  MpSession,
  type ScoreRec,
} from '../scenes/mp.ts';
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
  busMembers = new Set<BusStub>();
  scheduled = 0;

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
    setTimeout(fire, this.latency());
    if (this.rng() < DUP_P) setTimeout(fire, this.latency() + 3);
  }

  /** Deliver onto a bus member: same adversarial treatment. */
  deliverToBus(target: BusStub, frame: Frame): void {
    this.scheduled++;
    const copy = JSON.parse(JSON.stringify(frame));
    const fire = (): void => target.receive(JSON.parse(JSON.stringify(copy)));
    setTimeout(fire, this.latency());
    if (this.rng() < DUP_P) setTimeout(fire, this.latency() + 3);
  }
}

/** One end of a paired peer connection (DataConnection stand-in). */
class ConnEnd implements DataConnLike {
  open = false;
  peer: string;
  remote: ConnEnd | null = null;
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
    if (!this.open || !this.remote || !this.worldRef) return;
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
      setTimeout(() => dead.fire('error', [{ type: 'peer-unavailable' }]), 5);
      return dead;
    }
    const a = new ConnEnd(id);
    const b = new ConnEnd(this.id ?? '?');
    a.worldRef = this.world;
    b.worldRef = this.world;
    a.remote = b;
    b.remote = a;
    const lat = this.world.latency();
    setTimeout(() => {
      a.open = true;
      a.fire('open', []);
    }, lat);
    setTimeout(() => {
      b.open = true;
      this.fire('connection', [b]);
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

/** BroadcastChannel stand-in wired to the shared hub (no echo to sender). */
class BusStub implements BusHandle {
  world: StubWorld;
  readonly myId: string;
  private cb: ((f: Frame) => void) | null = null;

  constructor(world: StubWorld, myId: string) {
    this.world = world;
    this.myId = myId;
    world.busMembers.add(this);
  }

  onFrame(cb: (f: Frame) => void): void {
    this.cb = cb;
  }

  /** Test hook used by the hub's deliverToBus. */
  receive(f: Frame): void {
    this.cb?.(f);
  }

  post(frame: Frame): void {
    for (const m of [...this.world.busMembers]) {
      if (m !== this) this.world.deliverToBus(m, frame);
    }
  }

  close(): void {
    this.world.busMembers.delete(this);
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
  const parsed = parseStg(planPz.stg);
  check(
    'parseStg round-trips pz/tk ids and rejects junk',
    parsed?.kind === 'puzzle' &&
      parsed.index === 6 &&
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
      busFactory: (_code, myId) => new BusStub(world, myId),
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
    round: null as { n: number; seed: number; id: string } | null,
    sr: null as { points: number; hpDelta: number; correct: boolean | null } | null,
    reveal: null as { n: number; scores: number } | null,
    elim: null as string[] | null,
    endRows: -1,
  };

  m1.subscribe((e) => {
    cliEv.push(e.t);
    if (e.t === 'begin') seen.begin = { timer: e.timer, sd: e.sd, rn: e.rn };
    if (e.t === 'round') seen.round = { n: e.n, seed: e.stg.seed, id: e.stg.id };
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

  mh.round(3, 'pz:2', 999, 60);
  await waitFor('client saw round', () => seen.round != null);
  check(
    'round frame carries stage ref + seed identically',
    seen.round != null && seen.round.n === 3 && seen.round.seed === 999 && seen.round.id === 'pz:2',
    JSON.stringify(seen.round),
  );

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

  mh.endMatch([{ uid: 'HOST', name: 'HOST', pts: 230 }]);
  await waitFor('client saw end', () => seen.endRows === 1);
  check('end frame carries final scores', seen.endRows === 1);

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
  const hostPeer = world.peers.get('iqvs-RACE') ?? world.peers.get('iqvs-RACE2');
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

  // Mid-game catch-up: GAMMA joined AFTER begin/round fired. Its MpSession's
  // first lobby event triggers metaReq; the host must unicast the begin
  // frame AND the in-flight round so the joiner mounts the live challenge.
  const m3 = new MpSession(C3, 'client', {}, j3.players);
  const caught = { begin: false, round: false };
  m3.subscribe((e) => {
    if (e.t === 'begin' && e.sd === 0x1234abcd) caught.begin = true;
    if (e.t === 'round' && e.n === 3 && e.stg.seed === 999) caught.round = true;
  });

  // Poke the roster so post-subscribe observers see convergence at 4.
  C1.send({ t: 'hello', uid: String(C1.myUid()), name: 'ALPHA' });
  await waitFor('roster converges to 4 everywhere', () => hc.lastLobbySize === 4 && c2.lastLobbySize === 4 && seen3.lobbySize === 4);
  check('4-player roster converges over surviving transport', true);

  H.broadcast({ t: 'round', n: 600 });
  await waitFor('post-death broadcast reaches GAMMA', () => seen3.roundN === 600);
  check('host still authoritative after broker death', seen3.roundN === 600);

  await waitFor('mid-game catch-up delivered to GAMMA', () => caught.begin && caught.round);
  check(
    'late joiner received begin + in-flight round via unicast replay',
    caught.begin && caught.round,
    JSON.stringify(caught),
  );

  /* ---- handshake-ordering race: peerjs load lags the bus reply ---- */
  console.log('[race] slow peerjs load vs instant bus lobby reply');
  const C4 = createNet({
    // Fresh-tab repro: the script tag takes ~seconds on first load; the
    // stub compresses that to 60ms — still far above stub bus latency.
    makePeer: () => new Promise<PeerCtor>((resolve) => setTimeout(() => resolve(ctor), 60)),
    busFactory: (_code, myId) => new BusStub(world, myId),
  });
  const j4 = await C4.join('RACE', 'EPSILON');
  check(
    'join completes when the host reply outruns the peer constructor',
    Array.isArray(j4.players),
    'players=' + JSON.stringify(j4.players?.length ?? 0),
  );

  console.log('  (stub deliveries scheduled: ' + world.scheduled + ')');
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
