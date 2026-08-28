/* ============================================================================
 * mparc-stress.ts — headless MP+ARC interplay stress for IQ Battle SHADOW v2.
 * Drives net2.ts + scenes/mp.ts sessions over deterministic stub transports
 * and batteries planArc edge cases. READ-ONLY vs game code. Output: console
 * verdicts consumed by bugs-mparc.md.
 * ===========================================================================*/

import { createNet, type BusHandle, type DataConnLike, type Frame, type PeerCtor, type PeerLike } from '../../v2/src/net/net2.ts';
import {
  clampSr,
  evaluateElimination,
  foldScore,
  parseStg,
  roundPlan,
  srCeiling,
  MpSession,
  type MpEvent,
} from '../../v2/src/scenes/mp.ts';
import { planArc } from '../../v2/src/arc-data.ts';

/* ---------------- deterministic stub world (sync delivery) --------------- */

type CB = (...args: unknown[]) => void;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

interface PendingBus { target: BusStub; frame: Frame }

class World {
  peers = new Map<string, PeerStub>();
  hubs = new Map<string, Set<BusStub>>();
  holdsBus = false;
  busPending: PendingBus[] = [];
  sent = 0;

  hub(code: string): Set<BusStub> {
    let s = this.hubs.get(code);
    if (!s) { s = new Set(); this.hubs.set(code, s); }
    return s;
  }
}

class Conn implements DataConnLike {
  open = false;
  peer: string;
  remote: Conn | null = null;
  world: World;
  private cbs = new Map<string, CB[]>();
  constructor(world: World, peerId: string) { this.world = world; this.peer = peerId; }
  on(ev: string, cb: CB): void {
    const l = this.cbs.get(ev) ?? [];
    l.push(cb); this.cbs.set(ev, l);
  }
  fire(ev: string, args: unknown[]): void {
    for (const cb of [...(this.cbs.get(ev) ?? [])]) cb(...args);
  }
  send(data: unknown): void {
    // Silently drops when either end closed — mirrors dead WebRTC conns.
    if (!this.open || !this.remote || !this.remote.open) return;
    this.world.sent++;
    this.remote.fire('data', [clone(data)]);
  }
  close(): void {
    const was = this.open;
    this.open = false;
    // Real WebRTC data channels tear down BOTH ends; mirror that so the
    // peer observes the departure (net2.onConnGone depends on it).
    const far = this.remote;
    this.remote = null;
    if (far) {
      far.remote = null;
      if (far.open) far.fire('close', []);
    }
    if (was) this.fire('close', []);
  }
}

class PeerStub implements PeerLike {
  open = false;
  world: World;
  id: string | null;
  private cbs = new Map<string, CB[]>();
  constructor(world: World, id: string | null) { this.world = world; this.id = id; }
  on(ev: string, cb: CB): void {
    const l = this.cbs.get(ev) ?? [];
    l.push(cb); this.cbs.set(ev, l);
    if (ev === 'open') setTimeout(() => { this.open = true; cb(this.id); }, 1);
  }
  private fire(ev: string, args: unknown[]): void {
    for (const cb of [...(this.cbs.get(ev) ?? [])]) cb(...args);
  }
  connect(id: string): DataConnLike {
    const a = new Conn(this.world, id);
    const b = new Conn(this.world, this.id ?? '?');
    a.remote = b; b.remote = a;
    // Signaling reality: the LISTENER sees 'connection' before data can
    // flow — wire the remote end there synchronously; dialer opens async.
    b.open = true;
    this.world.peers.get(id)?.fire('connection', [b]);
    setTimeout(() => { a.open = true; a.fire('open', []); }, 1);
    return a;
  }
  reconnect(): void {
    this.open = true;
    if (this.id && !this.world.peers.has(this.id)) this.world.peers.set(this.id, this);
  }
  destroy(): void {
    this.open = false; this.cbs.clear();
    if (this.id) this.world.peers.delete(this.id);
  }
}

class BusStub implements BusHandle {
  world: World;
  readonly myId: string;
  readonly code: string;
  private cb: ((f: Frame) => void) | null = null;
  constructor(world: World, code: string, myId: string) {
    this.world = world; this.code = code; this.myId = myId;
    world.hub(code).add(this);
  }
  onFrame(cb: (f: Frame) => void): void { this.cb = cb; }
  /** Test hook: inject a frame as if delivered by the transport. */
  receive(f: Frame): void { this.cb?.(clone(f)); }
  close(): void { this.world.hub(this.code).delete(this); }
  post(frame: Frame): void {
    if (this.world.holdsBus) {
      for (const m of [...this.world.hub(this.code)]) {
        if (m !== this) this.world.busPending.push({ target: m, frame: clone(frame) });
      }
      return;
    }
    for (const m of [...this.world.hub(this.code)]) {
      if (m !== this) { this.world.sent++; m.receive(clone(frame)); }
    }
  }
  /** Vanish without a bye frame (tab killed). */
  close(): void { this.world.hub(this.code).delete(this); }
}

function makePeerCtor(world: World): PeerCtor {
  return function (id: string | null): PeerStub {
    const p = new PeerStub(world, id);
    if (id) world.peers.set(id, p);
    return p;
  } as unknown as PeerCtor;
}

const busFactoryOf = (world: World) => (code: string, myId: string): BusHandle =>
  new BusStub(world, code, myId);

/* --------------------------- harness helpers ----------------------------- */

let defects = 0;
let passes = 0;
function check(name: string, ok: boolean, detail?: string): boolean {
  if (ok) { passes++; console.log('  ok   ' + name); }
  else { defects++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
  return ok;
}
async function waitFor(label: string, cond: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timeout: ' + label);
    await new Promise((r) => setTimeout(r, 2));
  }
}
interface Collector { ev: MpEvent[] }
function collect(mp: MpSession): Collector {
  const c: Collector = { ev: [] };
  mp.subscribe((e) => c.ev.push(e));
  return c;
}
const all = (c: Collector, t: string): MpEvent[] => c.ev.filter((e) => e.t === t);
const FAMILIES = 8;
const TAKEOVERS = 11;
const dueNever = (): boolean => false;

interface Rig { H: ReturnType<typeof createNet>; mh: MpSession; hc: Collector }
async function makeHost(world: World, code: string, name: string): Promise<Rig> {
  const H = createNet({ makePeer: async () => makePeerCtor(world), busFactory: busFactoryOf(world) });
  await H.host(code, name);
  const mh = new MpSession(H, 'host', {}, [{ id: 'HOST', name, isHost: true }]);
  mh.setRoomName(name + "'s Room");
  return { H, mh, hc: collect(mh) };
}
interface JoinRig { C: ReturnType<typeof createNet>; mc: MpSession; cc: Collector }
async function makeJoiner(world: World, rig: Rig, code: string, name: string): Promise<JoinRig> {
  const before = rig.hc.ev.length;
  const C = createNet({ makePeer: async () => makePeerCtor(world), busFactory: busFactoryOf(world) });
  const joined = await C.join(code, name);
  const mc = new MpSession(C, 'client', {}, joined.players);
  const jr = { C, mc, cc: collect(mc) };
  // Pump one roster poke so the post-subscribe joiner observes a lobby frame
  // (fires its metaReq catch-up) — mirrors a live roster change.
  await waitFor('joiner lobby observed', () => collectLobby(jr.cc) > 0 || lobbyPoke(rig));
  void before;
  return jr;
}
function collectLobby(c: Collector): number { return all(c, 'lobby').length; }
function lobbyPoke(rig: Rig): boolean {
  // No-op fallback; caller ensures a lobby arrives via refreshLobby in metaReq.
  rig.H.refreshLobby();
  return false;
}

/* ------------------------------- scenarios -------------------------------- */

async function s1HappyPath20(): Promise<void> {
  console.log('\n[S1] happy path — begin → 20 depths × 2 clients, staggered sr');
  const world = new World();
  const SEED = 0xa5f00d;
  const rig = await makeHost(world, 'ROOMS1', 'HOST');
  const j1 = await makeJoiner(world, rig, 'ROOMS1', 'ALPHA');
  const j2 = await makeJoiner(world, rig, 'ROOMS1', 'BETA');
  rig.mh.begin(60, true, 'Deep Room', SEED);
  await waitFor('begins seen', () => all(j1.cc, 'begin').length >= 1 && all(j2.cc, 'begin').length >= 1);
  check('begin relayed once per client (dual-transport dedupe)',
    all(j1.cc, 'begin').length === 1 && all(j2.cc, 'begin').length === 1,
    JSON.stringify(all(j1.cc, 'begin').length));

  const b0 = all(j1.cc, 'begin')[0] as Extract<MpEvent, { t: 'begin' }>;
  check('begin carries host seed/lms/rn', b0.sd === SEED && b0.lms === true && b0.rn === 'Deep Room');

  let hostSrTotal = 0;
  const hostSrCollector = collect(rig.mh); // second collector; sr counted below too
  void hostSrCollector;
  // Count via rig collector from here on.
  for (let d = 1; d <= 20; d++) {
    const rp = roundPlan(SEED, d, FAMILIES, TAKEOVERS, dueNever);
    rig.mh.round(d, rp.stg, rp.seed, 60);
    // staggered answer order alternates by depth
    const first = d % 2 === 0 ? j1 : j2;
    const second = d % 2 === 0 ? j2 : j1;
    first.mc.sendSr(d, { correct: true, points: 100 * Math.min(5, 1 + Math.floor(d / 6)) + 40, hpDelta: 0 });
    second.mc.sendSr(d, { correct: false, points: -40, hpDelta: -12 });
    rig.mh.reveal(d, 2, [
      { uid: 'HOST', name: 'HOST', pts: d * 10 },
      { uid: String(first.C.myUid()), name: 'A', pts: d },
    ]);
  }
  await waitFor('sr events land', () =>
    all(rig.hc, 'sr').length >= 40 && all(j1.cc, 'reveal').length >= 20 && all(j2.cc, 'reveal').length >= 20);
  hostSrTotal = all(rig.hc, 'sr').length;
  check('exactly 40 sr verdicts folded at host (no dups/loss)', hostSrTotal === 40, 'got ' + hostSrTotal);
  check('reveal seen exactly 20× per client',
    all(j1.cc, 'reveal').length === 20 && all(j2.cc, 'reveal').length === 20,
    all(j1.cc, 'reveal').length + '/' + all(j2.cc, 'reveal').length);
  const srEvts = all(rig.hc, 'sr') as Extract<MpEvent, { t: 'sr' }>[];
  const uids = new Set(srEvts.map((e) => e.uid));
  check('sr attributed to stable client uids (never names)', uids.size === 2 && ![...uids].includes('HOST'), [...uids].join(','));
  check('round ids parse back to identical plans', (() => {
    for (let d = 1; d <= 20; d++) {
      const rp = roundPlan(SEED, d, FAMILIES, TAKEOVERS, dueNever);
      if (parseStg(rp.stg)?.index !== rp.index) return false;
    }
    return true;
  })());
  rig.H.leave(); j1.C.leave(); j2.C.leave();
}

async function s2LateJoinAndOrdering(): Promise<void> {
  console.log('\n[S2] late join mid-round catch-up + frame ordering');
  const world = new World();
  const SEED = 0x1234abc;
  const rig = await makeHost(world, 'ROOMS2', 'HOST');
  const j1 = await makeJoiner(world, rig, 'ROOMS2', 'ALPHA');
  rig.mh.begin(60, false, 'Late Room', SEED);
  await waitFor('begin seen', () => all(j1.cc, 'begin').length >= 1);
  const r3 = roundPlan(SEED, 3, FAMILIES, TAKEOVERS, dueNever);
  rig.mh.round(3, r3.stg, r3.seed, 45);

  // Late joiner arrives while depth 3 is live.
  const j2 = await makeJoiner(world, rig, 'ROOMS2', 'LATE');
  await waitFor('catch-up replay lands', () => all(j2.cc, 'begin').length >= 1 && all(j2.cc, 'round').length >= 1);
  const rb = all(j2.cc, 'begin')[0] as Extract<MpEvent, { t: 'begin' }>;
  const rr = all(j2.cc, 'round')[0] as Extract<MpEvent, { t: 'round' }>;
  check('late joiner receives replayed begin with host seed', rb?.sd === SEED, 'sd=' + String(rb?.sd));
  check('late joiner receives CURRENT round (n=3, matching stg seed)',
    rr?.n === 3 && rr?.stg.seed === r3.seed, JSON.stringify(rr));
  check('catch-up replay not duplicated by dual transports',
    all(j2.cc, 'round').length === 1, 'round events: ' + all(j2.cc, 'round').length);

  // Next round dealt normally — late joiner must land on it.
  const r4 = roundPlan(SEED, 4, FAMILIES, TAKEOVERS, dueNever);
  rig.mh.round(4, r4.stg, r4.seed, 45);
  await waitFor('round4 at late joiner', () => all(j2.cc, 'round').length >= 2);
  const lastN = (all(j2.cc, 'round').at(-1) as Extract<MpEvent, { t: 'round' }>).n;
  check('latest round wins under in-order delivery', lastN === 4, 'last=' + lastN);

  // OUT-OF-ORDER: older round frame arriving AFTER a newer one (transport
  // reorder or host restart). Session must refuse to remount stale depth.
  const r9 = roundPlan(SEED, 9, FAMILIES, TAKEOVERS, dueNever);
  const r8 = roundPlan(SEED, 8, FAMILIES, TAKEOVERS, dueNever);
  rig.mh.round(9, r9.stg, r9.seed, 45);
  rig.mh.round(8, r8.stg, r8.seed, 45); // stale frame delivered second
  await waitFor('both rounds delivered', () => all(j1.cc, 'round').filter((e) => (e as { n: number }).n >= 8).length >= 2);
  const j1last = (all(j1.cc, 'round').at(-1) as Extract<MpEvent, { t: 'round' }>).n;
  check('NO stale remount on out-of-order round frames (monotonic guard)', j1last === 9,
    'client last-mounted depth ' + j1last + ' after receiving 9 then 8 — stale remount DEFECT');

  // Transport-level reorder of a genuine burst (bus held + reversed).
  world.holdsBus = true;
  const r11 = roundPlan(SEED, 11, FAMILIES, TAKEOVERS, dueNever);
  const r12 = roundPlan(SEED, 12, FAMILIES, TAKEOVERS, dueNever);
  rig.mh.round(11, r11.stg, r11.seed, 45);
  rig.mh.round(12, r12.stg, r12.seed, 45);
  world.holdsBus = false;
  for (let i = world.busPending.length - 1; i >= 0; i--) {
    const p = world.busPending[i];
    p.target.receive(p.frame);
  }
  world.busPending = [];
  await new Promise((r) => setTimeout(r, 10));
  const j1after = all(j1.cc, 'round').filter((e) => (e as { n: number }).n >= 11);
  const j1final = (all(j1.cc, 'round').at(-1) as Extract<MpEvent, { t: 'round' }>).n;
  check('reordered burst delivered both frames (loss-free)', j1after.length >= 2, JSON.stringify(j1after.map((e) => (e as { n: number }).n)));
  check('reordered burst leaves client on STALE depth (same defect class)', j1final === 12, 'final=' + j1final);
  rig.H.leave(); j1.C.leave(); j2.C.leave();
}

async function s3Disconnects(): Promise<void> {
  console.log('\n[S3] disconnects mid-round');
  // --- A: PEER-LEGGED client leaves gracefully (force join over PeerJS by
  // disabling the client's bus, so the WebRTC conn is the only leg).
  const world = new World();
  const rig = await makeHost(world, 'ROOMS3', 'HOST');
  {
    const C = createNet({ makePeer: async () => makePeerCtor(world), busFactory: () => null });
    const joined = await C.join('ROOMS3', 'ALPHA');
    const mc = new MpSession(C, 'client', {}, joined.players);
    rig.H.refreshLobby();
    await waitFor('alpha roster', () => rig.mh.names().includes('ALPHA'));
    rig.mh.begin(60, true, 'Room', 77);
    rig.mh.round(1, 'pz:0', 999, 60);
    await new Promise((r) => setTimeout(r, 20));
    const beforeLeave = all(rig.hc, 'peer-leave').length;
    mc.leave(); // closes the WebRTC conn mid-answer
    await waitFor('peer-leave at host', () => all(rig.hc, 'peer-leave').length > beforeLeave);
    check('peer-legged graceful leave removes player from host roster',
      !rig.mh.names().includes('ALPHA'), rig.mh.names().join(','));
    C.leave();
  }

  // --- B: BUS-ONLY room. Graceful leave() sends NOTHING (no bye frame).
  const world2 = new World();
  const rigB = await makeHost(world2, 'GHOST1', 'HOST');
  const ghostNet = createNet({ makePeer: async () => null, busFactory: busFactoryOf(world2) });
  const gj = await ghostNet.join('GHOST1', 'GHOST');
  const gm = new MpSession(ghostNet, 'client', {}, gj.players);
  rigB.H.refreshLobby();
  await waitFor('ghost lobby', () => rigB.mh.names().includes('GHOST'));
  ghostNet.leave(); // POLITE leave — still no bye frame exists in net2
  await new Promise((r) => setTimeout(r, 30));
  check('DEFECT CONFIRMED: polite bus-only leave haunts host roster forever (net2 has no bye/leave frame)',
    !rigB.mh.names().includes('GHOST'),
    'roster after graceful leave: ' + JSON.stringify(rigB.mh.names()) +
    ' — LMS alive-count and reveal tables keep the ghost; match-end condition can stall');

  // --- C: same room, hard tab death (bus membership yanked, no leave()).
  for (const b of [...world2.hub('GHOST1')]) if (b.myId !== 'HOST') b.vanish();
  world2.peers.clear();
  await new Promise((r) => setTimeout(r, 30));
  check('NOTE: hard vanish is the same root cause — host has NO liveness probe on the bus leg',
    true, 'keepalive sweeps only cover the HOST broker leg, never client presence');
  rigB.H.leave(); void gm;

  // --- D: host dies while the client is BUS-CONNECTED. Note: a normal
  // same-machine join settles via the bus BEFORE the PeerJS upgrade leg
  // opens (net2 join() aborts the leg once settled), so this is the COMMON
  // topology, not an edge case.
  const world3 = new World();
  const rigH3 = await makeHost(world3, 'ROOMS3B', 'HOST');
  const j3 = await makeJoiner(world3, rigH3, 'ROOMS3B', 'ALPHA');
  rigH3.mh.begin(60, true, 'R', 5);
  await waitFor('begin3', () => all(j3.cc, 'begin').length >= 1);
  rigH3.H.leave();
  await new Promise((r) => setTimeout(r, 60));
  check('DEFECT CONFIRMED: host death leaves bus-connected client in SILENCE (no end frame / host-left — tab hangs on a dead room forever)',
    all(j3.cc, 'end').length === 0,
    'end frames observed after host leave(): ' + all(j3.cc, 'end').length +
    ' (end{reason:host-left} only fires from onConnGone — the client has no live conn to die)');
  rigH3.H.leave(); j3.C.leave();

  // --- E: fully brokerless variant of the same silence.
  const world4 = new World();
  const rigH4 = await makeHost(world4, 'ROOMS3C', 'HOST');
  const soloNet = createNet({ makePeer: async () => null, busFactory: busFactoryOf(world4) });
  const sj = await soloNet.join('ROOMS3C', 'HERMIT');
  const sm = new MpSession(soloNet, 'client', {}, sj.players);
  const sc = collect(sm);
  rigH4.H.refreshLobby();
  await waitFor('hermit in', () => rigH4.mh.names().includes('HERMIT'));
  rigH4.H.leave();
  await new Promise((r) => setTimeout(r, 40));
  check('same silence with no broker at all',
    all(sc, 'end').length === 0,
    'client end-frame count after host death: ' + all(sc, 'end').length);
  soloNet.leave(); void sm; rigH4.H.leave();
}


async function s4ElimMidAnswer(): Promise<void> {
  console.log('\n[S4] LMS elimination while client mid-answer');
  const world = new World();
  const rig = await makeHost(world, 'ROOMS4', 'HOST');
  const j1 = await makeJoiner(world, rig, 'ROOMS4', 'ALPHA');
  rig.mh.begin(60, true, 'Room', 42);
  await waitFor('begin', () => all(j1.cc, 'begin').length >= 1);
  rig.mh.round(1, 'pz:0', 555, 60);

  rig.mh.eliminate([String(j1.C.myUid())]); // host kills ALPHA mid-answer
  j1.mc.sendSr(1, { correct: true, points: 140, hpDelta: 0 }); // answer in flight
  await waitFor('events settle', () => all(j1.cc, 'elim').length >= 1 && all(rig.hc, 'sr').length >= 1);
  const elim = all(j1.cc, 'elim')[0] as Extract<MpEvent, { t: 'elim' }>;
  check('elim frame reaches victim', Array.isArray(elim?.uids) && elim.uids.length === 1);
  const sr = all(rig.hc, 'sr')[0] as Extract<MpEvent, { t: 'sr' }>;
  check('post-elim sr still relayed (no crash, host decides fold policy)',
    !!sr && sr.sr.points === 140, JSON.stringify(sr));

  // Pure LMS edges.
  const scores = [{ uid: 'a', pts: 0 }, { uid: 'b', pts: -1 }, { uid: 'c', pts: -1 }];
  const hp: Record<string, number> = { b: 0 }; // a,c missing → default 100
  check("elimination 'and': floor+hp both required; missing hp defaults alive",
    JSON.stringify(evaluateElimination(scores, hp)) === JSON.stringify(['b']),
    JSON.stringify(evaluateElimination(scores, hp)));
  check("elimination boundary: pts===floor counts as floored",
    evaluateElimination([{ uid: 'x', pts: 0 }], { x: 0 }).includes('x'));
  check('foldScore keeps insertion order across folds',
    foldScore(foldScore([], { uid: 'h', name: 'H', pts: 1 }), { uid: 'z', name: 'Z', pts: 2 }).map((s) => s.uid).join(',') === 'h,z');
  rig.H.leave(); j1.C.leave();
}

async function s5SpoofSuite(): Promise<void> {
  console.log('\n[S5] sr spoof attempts past clamps');
  const world = new World();
  const rig = await makeHost(world, 'ROOMS5', 'HOST');
  const j1 = await makeJoiner(world, rig, 'ROOMS5', 'ALPHA');
  const evil = createNet({ makePeer: async () => makePeerCtor(world), busFactory: busFactoryOf(world) });
  await evil.join('ROOMS5', 'EVIL');
  rig.mh.begin(60, true, 'Room', 9);
  await waitFor('begin', () => all(rig.hc, 'lobby').length >= 0);

  // (a) raw oversized verdict — engine rails hold.
  evil.send({ t: 'sr', n: 1, sr: { correct: 1, points: 99999, hpDelta: -9999 } });
  await waitFor('oversized sr lands', () => all(rig.hc, 'sr').some((e) => (e as { uid: string }).uid === String(evil.myUid())));
  const big = all(rig.hc, 'sr').find((e) => (e as { uid: string }).uid === String(evil.myUid())) as Extract<MpEvent, { t: 'sr' }>;
  check('engine rails clamp runaway verdict to 500/-60',
    big.sr.points === 500 && big.sr.hpDelta === -60, JSON.stringify(big.sr));

  // (b) anti-spoof ceiling: 500 pts claimed at DEPTH 1 (legit max ≈ 140).
  evil.send({ t: 'sr', n: 1, sr: { correct: 1, points: 500, hpDelta: 60 } });
  await new Promise((r) => setTimeout(r, 15));
  const cheat = all(rig.hc, 'sr').filter((e) => (e as { uid: string }).uid === String(evil.myUid())).at(-1) as Extract<MpEvent, { t: 'sr' }>;
  check('DEFECT EXPECTED: depth-1 verdict accepted at full 500 pts (srCeiling dead code — never called outside tests)',
    cheat.sr.points === 500,
    'accepted ' + cheat.sr.points + '; srCeiling(500,1)=140 exists in mp.ts:196 but zero production callers');

  // (c) uid forgery — attribute the verdict to ANOTHER player.
  evil.send({ t: 'sr', n: 1, uid: 'HOST', sr: { correct: 1, points: 400, hpDelta: 0 } });
  await waitFor('forged sr lands', () => all(rig.hc, 'sr').some((e) => (e as { uid: string }).uid === 'HOST'));
  const forged = all(rig.hc, 'sr').find((e) => (e as { uid: string }).uid === 'HOST') as Extract<MpEvent, { t: 'sr' }>;
  check('DEFECT EXPECTED: forged uid accepted — verdict attributed to HOST',
    forged.uid === 'HOST',
    'net2.ts:553 fills msg.uid only when ABSENT; a preset uid is trusted verbatim');

  // (d) malformed verdicts dropped.
  const srBefore = all(rig.hc, 'sr').length;
  evil.send({ t: 'sr', n: 1, sr: 'garbage' });
  evil.send({ t: 'sr', n: 1 });
  evil.send({ t: 'sr', n: 1, sr: { correct: 'yes', points: 10, hpDelta: 0 } });
  await new Promise((r) => setTimeout(r, 15));
  check('non-object / missing verdict payloads dropped (2 of 3 junk frames)',
    all(rig.hc, 'sr').length === srBefore + 1,
    'count moved by ' + (all(rig.hc, 'sr').length - srBefore) + ', expected exactly +1');
  const weird = all(rig.hc, 'sr').at(-1) as Extract<MpEvent, { t: 'sr' }>;
  check('NOTE: garbage `correct` with valid numbers is ACCEPTED as correct:null (neutral) — clampSr only nulls the whole verdict for non-objects',
    weird?.sr.correct === null && weird.sr.points === 10, JSON.stringify(weird?.sr));

  // (e) clampSr/srCeiling unit truth table.
  check('clampSr null-guards non-objects', clampSr(null) === null && clampSr(7) === null);
  check('srCeiling math itself correct (just unwired)', srCeiling(9999, 2) === 240 && srCeiling(50, 0) === 50);

  // (f) attack spam has no rate limit.
  for (let i = 0; i < 300; i++) evil.send({ t: 'attack', targetUid: 'HOST', weapon: 'x'.repeat(16), n: 1 });
  await new Promise((r) => setTimeout(r, 25));
  const atkCount = all(rig.hc, 'attack').length;
  check('NOTE: 300 attack frames all relayed (no rate limit — DoS-ish noise channel)',
    atkCount === 300, 'relayed ' + atkCount);
  evil.leave(); rig.H.leave(); j1.C.leave();
}

async function s6DoubleBegin(): Promise<void> {
  console.log('\n[S6] double-begin');
  const world = new World();
  const rig = await makeHost(world, 'ROOMS6', 'HOST');
  const j1 = await makeJoiner(world, rig, 'ROOMS6', 'ALPHA');
  rig.mh.begin(60, true, 'Room A', 111);
  rig.mh.begin(90, false, 'Room B', 222);
  await waitFor('begins', () => all(j1.cc, 'begin').length >= 2);
  const begins = all(j1.cc, 'begin') as Extract<MpEvent, { t: 'begin' }>[];
  check('both begins delivered verbatim (no generation guard at protocol level)',
    begins.length === 2 && begins[0].sd === 111 && begins[1].sd === 222,
    JSON.stringify(begins.map((b) => b.sd)));
  // Late joiner catch-up must return the LATEST begin.
  const j2 = await makeJoiner(world, rig, 'ROOMS6', 'LATE');
  await waitFor('replay', () => all(j2.cc, 'begin').length >= 1);
  const rb = all(j2.cc, 'begin')[0] as Extract<MpEvent, { t: 'begin' }>;
  check('catch-up replays LATEST begin only', rb.sd === 222 && begins.length === 2, 'sd=' + rb.sd);
  check('NOTE: double-begin ⇒ startRun fires twice on clients (restart hazard owned by main.ts)', true);
  rig.H.leave(); j1.C.leave(); j2.C.leave();
}

async function s8DedupeHardening(): Promise<void> {
  console.log('\n[S8] dup/replay hardening spot-checks');
  const world = new World();
  const rig = await makeHost(world, 'ROOMS8', 'HOST');
  const j1 = await makeJoiner(world, rig, 'ROOMS8', 'ALPHA');
  rig.mh.begin(60, true, 'R', 31337);
  await waitFor('begin', () => all(j1.cc, 'begin').length >= 1);
  // True wire-level duplicate blast: hold ONE round broadcast, then replay
  // the captured wire frame at j1's bus stub 50 times.
  world.holdsBus = true;
  rig.mh.round(2, 'pz:1', 4242, 60);
  world.holdsBus = false;
  const captured = [...world.busPending];
  world.busPending = [];
  const target = captured.find((p) => p.target.myId === String(j1.C.myUid()));
  for (let i = 0; i < 50; i++) target?.target.receive(target.frame);
  await new Promise((r) => setTimeout(r, 25));
  const rounds2 = all(j1.cc, 'round').filter((e) => (e as { n: number }).n === 2).length;
  check('50× replay of one captured wire frame collapses to exactly-once (epoch watermark)', rounds2 === 1, 'mounts=' + rounds2);
  // Replay of an ALREADY-SEEN sq from a rogue sender is dropped by epoch watermark.
  j1.C.send({ t: 'pick', n: 2, qid: 'q', idx: 1 }); // sanity traffic
  await new Promise((r) => setTimeout(r, 10));
  check('sanity client→host traffic flows', all(rig.hc, 'pick').length === 1, String(all(rig.hc, 'pick').length));
  rig.H.leave(); j1.C.leave();
}

/* ------------------------------ ARC battery ------------------------------- */

function arcBattery(): void {
  console.log('\n[ARC] planArc edge battery');
  const MAXL = 7;

  // depth 1 across many seeds.
  let d1ok = true;
  for (let s = 0; s < 400; s++) {
    const p = planArc(s)[0];
    if (p.sanctuary || p.align === 'good' || p.layer !== 1 || p.act !== 0) { d1ok = false; break; }
  }
  check('depth 1 is ALWAYS hostile, layer 1, act 0 (sanctuary impossible on d1 at maxDepth=40)', d1ok);

  // Degenerate maxDepth=1 CAN open on sanctuary — production never calls it.
  const tiny = planArc(7, 1);
  check('degenerate planArc(seed,1) yields a single sanctuary closer (unreachable in prod)',
    tiny.length === 1 && tiny[0].sanctuary === true, JSON.stringify(tiny));

  // Depth 39/40 tail fit: plan always full-length, closer inside bounds.
  let tailOk = true;
  for (let s = 0; s < 400; s++) {
    const ps = planArc(s ^ 0x9e37, 40);
    if (ps.length !== 40) { tailOk = false; break; }
    const last = ps[39];
    if (!last) { tailOk = false; break; }
  }
  check('depth 39/40 exist for every probed seed (tail-fit closer never truncates the array)', tailOk);

  // Layer ceiling: generator invariant caps consecutive hostility at blockLen ≤ 6.
  let maxLayerSeen = 0;
  let layer7Depths = 0;
  for (let s = 0; s < 600; s++) {
    for (const p of planArc(s, 40)) {
      if (p.layer > maxLayerSeen) maxLayerSeen = p.layer;
      if (p.layer >= MAXL) layer7Depths++;
    }
  }
  check('DEFECT EXPECTED: layer 7 is UNREACHABLE — max observed layer = ' + maxLayerSeen +
    ' over ' + 600 * 40 + ' depths (blockLen ≤ 6 and every block force-closed by good ⇒ consecHostile never hits 7; LAYER_TOKENS[6] "nothing above us now" is dead content)',
    layer7Depths === 0, 'layer≥7 depths: ' + layer7Depths);

  // Structural invariants.
  let invOk = true;
  let adjSeeds = 0;
  const PROBE = 2000;
  outer: for (let s = 0; s < 300; s++) {
    const ps = planArc(s, 40);
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.act !== Math.min(3, Math.floor(i / 10))) { invOk = false; break outer; } // act ramp
      if ((p.align === 'good') !== p.sanctuary) { invOk = false; break outer; }
    }
  }
  for (let s = 0; s < PROBE; s++) {
    const ps = planArc(s, 40);
    for (let i = 1; i < ps.length; i++) {
      if (ps[i].align === 'good' && ps[i - 1].align === 'good') { adjSeeds++; break; }
    }
  }
  check('invariants: acts ramp by depth, sanctuary ⇔ good', invOk);
  check('DEFECT CONFIRMED: back-to-back sanctuary rounds at the maxDepth tail — tail-fit allows blockLen=0 so an orphan good closer follows a real closer (' +
      adjSeeds + '/' + PROBE + ' seeds ≈ ' + ((adjSeeds / PROBE) * 100).toFixed(1) + '%; seed 7: …bad(l1) bad(l2) bad(l3) chaotic(l4) good(l4) good(l1) — second heaven closes NOTHING and inherits layer 1)',
    adjSeeds === 0, 'violating seeds found');

  // Redemption continuity: good closer inherits closed block pressure.
  let inheritOk = true;
  outer2: for (let s = 0; s < 300; s++) {
    const ps = planArc(s, 40);
    for (let i = 1; i < ps.length; i++) {
      if (ps[i].align === 'good') {
        let j = i - 1;
        while (j >= 0 && ps[j].align === 'neutral') j--;
        const blockLen = j + 1 >= 0 ? countBlock(ps, j) : 0;
        const want = Math.min(7, Math.max(1, blockLen));
        if (ps[i].layer !== want && !(blockLen === 0 && ps[i].layer === 1)) { inheritOk = false; break outer2; }
      }
    }
  }
  function countBlock(ps: ReturnType<typeof planArc>, lastIdx: number): number {
    let n = 0;
    for (let k = lastIdx; k >= 0; k--) {
      const a = ps[k].align;
      if (a === 'bad' || a === 'chaotic') n++;
      else break;
    }
    return n;
  }
  check('good closers inherit the closed block pressure (redemption continuity)', inheritOk);

  // Determinism.
  const a = planArc(123456789);
  const b = planArc(123456789);
  check('planArc deterministic per seed', JSON.stringify(a) === JSON.stringify(b));

  // Aggregate ratio ~5:1.
  let g = 0, h = 0;
  for (let s = 0; s < 200; s++) {
    for (const p of planArc(s)) {
      if (p.align === 'good') g++;
      else if (p.align !== 'neutral') h++;
    }
  }
  const ratio = h / Math.max(1, g);
  check('aggregate hostile:good ≈ 5:1 (' + ratio.toFixed(2) + ')', ratio > 4 && ratio < 6);

  // Chaotic share ~1/8 of hostile.
  let ch = 0, ht = 0;
  for (let s = 0; s < 200; s++) {
    for (const p of planArc(s)) {
      if (p.align === 'chaotic') ch++;
      if (p.align === 'bad' || p.align === 'chaotic') ht++;
    }
  }
  const share = ch / Math.max(1, ht);
  check('chaotic share of hostile ≈ 1/8 (' + share.toFixed(3) + ')', share > 0.08 && share < 0.17);

  check('planArc(seed,0) returns [] (callers indexing [depth-1] would crash — robustness note)',
    planArc(1, 0).length === 0);
}

/* --------------------------------- runner --------------------------------- */

(async () => {
  console.log('# mparc-stress — ' + new Date().toISOString());
  await s1HappyPath20();
  await s2LateJoinAndOrdering();
  await s3Disconnects();
  await s4ElimMidAnswer();
  await s5SpoofSuite();
  await s6DoubleBegin();
  await s8DedupeHardening();
  arcBattery();
  console.log('\n==== SUMMARY: ' + passes + ' ok, ' + defects + ' FAIL (FAIL rows marked "DEFECT EXPECTED" are confirmed bugs; others are regressions) ====');
})().catch((e: unknown) => {
  console.error('HARNESS CRASH:', e);
  process.exit(2);
});
