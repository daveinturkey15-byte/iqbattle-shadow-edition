/* ============================================================================
 * LMS MATCH SELFTEST — a full 3-seat Last-Man-Standing match played through
 * the REAL stack: MpSession (frame sanitizers and all) on a loopback wire,
 * driving the REAL lmsdirector.ts sequencing over the REAL lms.ts reducer.
 * Nothing here re-implements match logic; the harness only plays the part
 * main.ts plays — it deals depths, reports answers, and ticks the clock.
 *
 *   node --experimental-strip-types src/scenes/selftest-lms.ts   (exit 0 = PASS)
 *
 * The property that matters is CONVERGENCE: after every depth, every screen's
 * table must be byte-identical to the host's. A desync here is the bug class
 * that made v1 matches unarguable.
 *
 * Delivery is synchronous and ordered on purpose — src/net/selftest.ts
 * already proves the transport survives duplication and reordering, so this
 * gate isolates the match layer.
 * ==========================================================================*/

import { MpSession } from './mp.ts';
import type { Frame, NetApi, PlayerRec } from '../net/net2.ts';
import { createDirector, type LmsDirector } from './lmsdirector.ts';
import { PARITY_GUARD_DEPTHS, weaponFor } from './mpfeat.ts';
import { pointsFor } from './lms.ts';

/* ------------------------------------------------------------------ */
/* Loopback wire                                                       */
/* ------------------------------------------------------------------ */

interface Node {
  uid: string;
  handlers: Map<string, Array<(f: Frame) => void>>;
  gone: boolean;
}

class Hub {
  nodes = new Map<string, Node>();
  roster: PlayerRec[] = [];
  /** Every frame that crossed the wire, for the determinism transcript. */
  log: string[] = [];

  add(uid: string, name: string, isHost: boolean): Node {
    const node: Node = { uid, handlers: new Map(), gone: false };
    this.nodes.set(uid, node);
    this.roster.push({ id: uid, name, isHost });
    return node;
  }

  private deliver(node: Node, frame: Frame): void {
    if (node.gone) return;
    for (const fn of node.handlers.get(frame.t) ?? []) fn(JSON.parse(JSON.stringify(frame)));
  }

  broadcastFromHost(frame: Frame): void {
    this.log.push('H>' + frame.t + ':' + JSON.stringify(frame.scores ?? frame.uids ?? frame.n ?? ''));
    for (const [uid, node] of this.nodes) if (uid !== 'HOST') this.deliver(node, frame);
  }

  sendToHost(from: string, frame: Frame): void {
    const stamped = { ...frame, src: from, uid: from };
    this.log.push(from + '>' + frame.t);
    const host = this.nodes.get('HOST');
    if (host) this.deliver(host, stamped);
  }

  unicast(to: string, frame: Frame): void {
    const node = this.nodes.get(to);
    if (node) this.deliver(node, frame);
  }

  netFor(uid: string): NetApi {
    const node = this.nodes.get(uid)!;
    const hub = this;
    return {
      host: async () => ({ code: 'TEST' }),
      join: async () => ({ players: [...hub.roster] }),
      on(type, fn) {
        const list = node.handlers.get(type) ?? [];
        list.push(fn);
        node.handlers.set(type, list);
        return () => {
          const cur = node.handlers.get(type) ?? [];
          const i = cur.indexOf(fn);
          if (i >= 0) cur.splice(i, 1);
        };
      },
      send: (obj) => { if (uid !== 'HOST') hub.sendToHost(uid, obj); },
      broadcast: (obj) => { if (uid === 'HOST') hub.broadcastFromHost(obj); return true; },
      kick: () => true,
      unicast: (id, obj) => hub.unicast(id, obj),
      leave: () => { node.gone = true; },
      myUid: () => uid,
      debugLog: () => [],
      refreshLobby: () => undefined,
      sanitizeRound: (p) => p,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Simulated screen — the slice of main.ts the director talks to       */
/* ------------------------------------------------------------------ */

interface Screen {
  uid: string;
  name: string;
  role: 'host' | 'client';
  session: MpSession;
  dir: LmsDirector;
  depth: number;
  kind: 'puzzle' | 'takeover';
  answerIdx: number;
  clock: number;
  finished: boolean;
  toasts: string[];
  /** Set when the director asked for an advance; the driver performs it. */
  pendingAdvance: number | null;
}

const DIFF_AT = (depth: number): number => Math.min(5, 1 + Math.floor(depth / 6));
const SANCTUARY_AT = (depth: number): boolean => depth % 5 === 0;

function buildScreen(hub: Hub, uid: string, name: string, role: 'host' | 'client', seed: number): Screen {
  const session = new MpSession(hub.netFor(uid), role, {}, [...hub.roster]);
  const screen: Screen = {
    uid, name, role, session,
    dir: null as unknown as LmsDirector,
    depth: 0, kind: 'puzzle', answerIdx: 3, clock: 0,
    finished: false, toasts: [], pendingAdvance: null,
  };
  screen.dir = createDirector({
    role,
    myUid: uid,
    wire: {
      reveal: (n, a, scores, hp) => session.reveal(n, a, scores, hp),
      pushScores: (n, scores, hp, reason) => session.pushScores(n, scores, hp, reason),
      eliminate: (uids) => session.eliminate(uids),
      endMatch: (scores, reason) => session.endMatch(scores, reason),
      sendSr: (n, v) => session.sendSr(n, v),
      attack: (t, w, n) => session.attack(t, w, n),
      roster: () => hub.roster.map((p) => ({ id: p.id, name: p.name })),
    },
    depth: () => screen.depth,
    kind: () => screen.kind,
    answerIdx: () => screen.answerIdx,
    diffAt: DIFF_AT,
    sanctuaryAt: SANCTUARY_AT,
    scoreMul: () => 1,
    clockSec: () => screen.clock,
    toast: (msg) => screen.toasts.push(msg),
    advance: (ms) => { screen.pendingAdvance = ms; },
    finish: () => { screen.finished = true; },
    changed: () => undefined,
  }, hub.roster.map((p) => ({ uid: p.id, name: p.name })), seed);
  /* Main subscribes the director to every inbound event; do the same. */
  session.subscribe((e) => screen.dir.handle(e));
  return screen;
}

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.error('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tableOf(s: Screen): string {
  return JSON.stringify(s.dir.state().table);
}

function ptsOf(s: Screen, uid: string): number {
  return s.dir.state().table.find((r) => r.uid === uid)?.pts ?? -1;
}

interface World {
  hub: Hub;
  host: Screen;
  c1: Screen;
  c2: Screen;
  all: Screen[];
}

function newWorld(seed: number): World {
  const hub = new Hub();
  hub.add('HOST', 'DAVE', true);
  hub.add('c1', 'MIRA', false);
  hub.add('c2', 'KOZ', false);
  const host = buildScreen(hub, 'HOST', 'DAVE', 'host', seed);
  const c1 = buildScreen(hub, 'c1', 'MIRA', 'client', seed);
  const c2 = buildScreen(hub, 'c2', 'KOZ', 'client', seed);
  return { hub, host, c1, c2, all: [host, c1, c2] };
}

/** Host deals depth n; every screen opens it (clients mount the round frame). */
function openDepth(w: World, n: number, kind: 'puzzle' | 'takeover', answerIdx: number): void {
  for (const s of w.all) {
    s.depth = n;
    s.kind = kind;
    s.answerIdx = answerIdx;
    s.clock = 0;
    s.pendingAdvance = null;
    s.dir.openDepth(n);
  }
}

/** Perform whatever advances the directors asked for (host reveal → next). */
function settle(w: World): void {
  for (const s of w.all) {
    if (s.pendingAdvance !== null) { s.depth++; s.pendingAdvance = null; }
  }
}

function converged(w: World): boolean {
  const h = tableOf(w.host);
  return tableOf(w.c1) === h && tableOf(w.c2) === h;
}

/* ------------------------------------------------------------------ */
/* Scenario                                                            */
/* ------------------------------------------------------------------ */

function scenario(seed: number, quiet: boolean): { transcript: string; world: World } {
  const w = newWorld(seed);
  const rng = mulberry32(seed);
  const say = (name: string, ok: boolean, detail?: string): void => { if (!quiet) check(name, ok, detail); };

  /* --- depth 1: everybody answers, tables must converge ---------------- */
  openDepth(w, 1, 'puzzle', 3);
  w.host.clock = 1.2; w.host.dir.answer(true, 0, 0);
  w.c1.clock = 2.4; w.c1.dir.answer(true, 0, 0);
  w.c2.clock = 3.1; w.c2.dir.answer(false, 0, -12);
  say('depth 1 closes when the last seat answers', w.host.pendingAdvance !== null);
  say('every screen agrees on the table after depth 1', converged(w), tableOf(w.host) + ' vs ' + tableOf(w.c1));
  say('a correct answer pays the shared formula', ptsOf(w.host, 'HOST') === pointsFor(DIFF_AT(1), 1));
  say('a wrong answer floors at 0 rather than going negative', ptsOf(w.host, 'c2') === 0);
  say('clients learn their own hp from the reveal', w.c2.dir.state().hp.c2 === 88);
  settle(w);

  /* --- depth 2: parity guard refuses every attack ---------------------- */
  openDepth(w, 2, 'puzzle', 1);
  const beforeGuard = tableOf(w.host);
  w.c1.dir.throwAt('HOST', 'rotten');
  say('parity guard: a client attack at depth ' + PARITY_GUARD_DEPTHS + ' moves nothing', tableOf(w.host) === beforeGuard);
  for (const s of w.all) { s.clock = 1 + rng(); s.dir.answer(true, 0, 0); }
  say('depth 2 converges', converged(w));
  settle(w);

  /* --- depth 3: a lying client gains only what the formula allows ------ */
  openDepth(w, 3, 'puzzle', 5);
  const c1Before = ptsOf(w.host, 'c1');
  w.c1.clock = 0.9;
  w.c1.dir.answer(true, 9999, 60); /* claims a fortune and a heal */
  say(
    'host re-derives puzzle points; the inflated claim is ignored',
    ptsOf(w.host, 'c1') - c1Before === pointsFor(DIFF_AT(3), w.host.dir.state().streaks.c1),
    'gained ' + (ptsOf(w.host, 'c1') - c1Before),
  );
  say('the inflated hp claim is ignored too', w.host.dir.state().hp.c1 === 100);
  w.host.clock = 1.1; w.host.dir.answer(true, 0, 0);
  w.c2.clock = 1.5; w.c2.dir.answer(true, 0, 0);
  say('depth 3 converges', converged(w));
  settle(w);

  /* --- depth 4: a real attack lands and propagates --------------------- */
  openDepth(w, 4, 'puzzle', 2);
  const spec = weaponFor('rotten', 4);
  const attackerBefore = ptsOf(w.host, 'c1');
  const victimBefore = ptsOf(w.host, 'HOST');
  w.c1.dir.throwAt('HOST', 'rotten');
  say('attacker pays the depth-scaled cost', ptsOf(w.host, 'c1') === Math.max(0, attackerBefore - spec.cost));
  say('victim takes the depth-scaled damage', ptsOf(w.host, 'HOST') === Math.max(0, victimBefore - spec.dmg));
  say('the attack reaches every screen through the scores frame', converged(w));
  say('the thrower cannot throw twice in one depth', (() => {
    const t = tableOf(w.host);
    w.c1.dir.throwAt('c2', 'rotten');
    return tableOf(w.host) === t;
  })());
  for (const s of w.all) { s.clock = 1 + rng(); s.dir.answer(true, 0, 0); }
  settle(w);

  /* --- depth 5: one seat goes silent; the clock closes the depth -------- */
  openDepth(w, 5, 'puzzle', 0);
  const silentBefore = w.host.dir.state().hp.c2;
  w.host.clock = 2; w.host.dir.answer(true, 0, 0);
  w.c1.clock = 2.2; w.c1.dir.answer(true, 0, 0);
  say('a depth with a silent seat does NOT close on its own', w.host.pendingAdvance === null);
  w.host.dir.timeout();
  say('the timeout sweep closes the depth', w.host.pendingAdvance !== null);
  say('only the silent seat is punished', w.host.dir.state().hp.c2 === silentBefore - 12);
  say('sanctuary heals the seats that answered', w.host.dir.state().hp.HOST === 100);
  say('the table still converges after a timeout', converged(w));
  settle(w);

  /* --- depth 6: a takeover depth adopts the stage's own economy --------- */
  openDepth(w, 6, 'takeover', -1);
  const tkBefore = ptsOf(w.host, 'c1');
  w.host.clock = 3; w.host.dir.answer(true, 220, -5);
  w.c1.clock = 3; w.c1.dir.answer(true, 220, -5);
  w.c2.clock = 3; w.c2.dir.answer(false, -60, -20);
  say('takeover points come from the stage', ptsOf(w.host, 'c1') === tkBefore + 220);
  say('takeover hp deltas apply', w.host.dir.state().hp.c1 === 95);
  say('takeover depth converges', converged(w));
  settle(w);

  const transcript = JSON.stringify({
    table: w.host.dir.state().table,
    hp: w.host.dir.state().hp,
    phases: w.host.dir.state().phases,
    log: w.hub.log.length,
  });
  return { transcript, world: w };
}

/** Separate world: drive a seat all the way to elimination and the end. */
function eliminationScenario(): void {
  const w = newWorld(99);
  let d = 1;

  /* Phase 1 — HOST and c1 bank points while c2 answers wrong and eats a
   * curse every depth the parity guard allows. Score floor + hp drain are
   * BOTH required to die, so this exercises the 'and' verdict honestly. */
  let guard = 0;
  while (w.host.dir.state().phases.c2 === 'alive' && guard++ < 40) {
    openDepth(w, d, 'puzzle', 1);
    if (d > PARITY_GUARD_DEPTHS) w.host.dir.throwAt('c2', 'curse');
    w.host.clock = 1; w.host.dir.answer(true, 0, 0);
    w.c1.clock = 1.2; w.c1.dir.answer(true, 0, 0);
    w.c2.clock = 1.4; w.c2.dir.answer(false, 0, 0);
    settle(w);
    d++;
  }

  const st = w.host.dir.state();
  check('a floored + drained seat is eliminated', st.phases.c2 === 'spectator',
    JSON.stringify(st.phases) + ' hp=' + JSON.stringify(st.hp));
  check('elimination needed BOTH floors — it took more than one bad depth', d > 4, 'died at depth ' + d);
  check('the elim frame reached the eliminated client', w.c2.dir.state().phases.c2 === 'spectator');
  check('a spectator may not answer', !w.c2.dir.mayAnswer());
  check('a spectator may not attack', !w.c2.dir.mayAttack());
  check('a spectator exposes no attack targets', w.c2.dir.rows().every((r) => !r.targetable));
  check('the eliminated seat was told', w.c2.toasts.some((t) => t.includes('YOU ARE OUT')));
  check('the match did NOT end at the first elimination', !w.host.finished);
  check('the table still converges with a spectator at the table', converged(w));

  /* Phase 2 — now drown c1 too, leaving exactly one seat standing. */
  guard = 0;
  while (!w.host.finished && guard++ < 40) {
    openDepth(w, d, 'puzzle', 1);
    w.host.dir.throwAt('c1', 'curse');
    w.host.clock = 1; w.host.dir.answer(true, 0, 0);
    w.c1.clock = 1.2; w.c1.dir.answer(false, 0, 0);
    /* c2 is out — its answer must be refused, not folded. */
    w.c2.clock = 1.3; w.c2.dir.answer(true, 0, 0);
    settle(w);
    d++;
  }
  check('end-when-one fires', w.host.finished, 'guard=' + guard);
  check('the host crowned the survivor', w.host.dir.state().winnerUid === 'HOST');
  check('both clients saw the end frame', w.c1.finished && w.c2.finished);
  check('the final tables agree', tableOf(w.host) === tableOf(w.c1) && tableOf(w.host) === tableOf(w.c2));
  check('the spectator never scored again', ptsOf(w.host, 'c2') === 0);
}

/** A seat that walks out must not stall the depth it was blocking. */
function rageQuitScenario(): void {
  const w = newWorld(5);
  openDepth(w, 3, 'puzzle', 1);
  w.host.clock = 1; w.host.dir.answer(true, 0, 0);
  w.c1.clock = 1; w.c1.dir.answer(true, 0, 0);
  check('the depth waits on the third seat', w.host.pendingAdvance === null);
  /* c2 slams the door — mp.ts turns the transport event into peer-leave. */
  w.host.dir.handle({ t: 'peer-leave', id: 'c2' });
  check('the door slamming closes the depth', w.host.pendingAdvance !== null);
  check('the leaver is marked left, not eliminated', w.host.dir.state().phases.c2 === 'left');
  check('the leaver is never crowned', w.host.dir.state().winnerUid !== 'c2');
}

/**
 * Seeded sweep: many differently-shaped matches, asserting the invariant that
 * actually matters after EVERY depth — all three screens hold byte-identical
 * tables. One scripted match proves the happy path; only a sweep catches an
 * ordering bug that needs a particular interleaving of answers, attacks,
 * timeouts and departures to show up.
 */
function sweepScenario(matches: number, depthsPer: number): void {
  let worstDesync: string | null = null;
  let attacks = 0;
  let timeouts = 0;
  let eliminations = 0;
  let ended = 0;
  const endDepths: number[] = [];

  for (let m = 0; m < matches && !worstDesync; m++) {
    const rng = mulberry32(1000 + m * 7919);
    const w = newWorld(1000 + m);
    let d = 1;
    for (let step = 0; step < depthsPer && !w.host.finished; step++) {
      const kind = rng() < 0.25 ? 'takeover' : 'puzzle';
      openDepth(w, d, kind, Math.floor(rng() * 8));

      /* Attacks fire before answers roughly a third of the time. */
      if (rng() < 0.34) {
        const from = w.all[Math.floor(rng() * 3)];
        const to = w.all[Math.floor(rng() * 3)];
        if (from !== to) {
          const before = tableOf(w.host);
          from.dir.throwAt(to.uid, rng() < 0.5 ? 'rotten' : 'curse');
          if (tableOf(w.host) !== before) attacks++;
        }
      }

      /* Each seat answers, stays silent, or (rarely) walks out. */
      let silent = false;
      for (const s of w.all) {
        const roll = rng();
        if (roll < 0.12) { silent = true; continue; }
        s.clock = 0.5 + rng() * 4;
        s.dir.answer(rng() < 0.55, Math.round(rng() * 300 - 60), Math.round(rng() * 20 - 15));
      }
      if (rng() < 0.03) {
        const victim = w.all[1 + Math.floor(rng() * 2)];
        w.host.dir.handle({ t: 'peer-leave', id: victim.uid });
      }
      if (silent && w.host.pendingAdvance === null) { w.host.dir.timeout(); timeouts++; }

      if (!converged(w)) {
        worstDesync = 'match ' + m + ' depth ' + d + ': host ' + tableOf(w.host)
          + ' / c1 ' + tableOf(w.c1) + ' / c2 ' + tableOf(w.c2);
        break;
      }
      settle(w);
      d++;
    }
    const ph = w.host.dir.state().phases;
    eliminations += Object.values(ph).filter((p) => p === 'spectator').length;
    if (w.host.finished) { ended++; endDepths.push(d); }
  }

  endDepths.sort((x, y) => x - y);
  const median = endDepths.length ? endDepths[Math.floor(endDepths.length / 2)] : 0;

  check('sweep: ' + matches + ' matches converge on every depth', worstDesync === null, worstDesync ?? undefined);
  check('sweep exercised real events (attacks/timeouts/eliminations)',
    attacks > 0 && timeouts > 0 && eliminations > 0,
    'attacks=' + attacks + ' timeouts=' + timeouts + ' eliminations=' + eliminations);
  /* The rule this pass exists to fix: matches must actually be winnable.
   * Under adversarial play (12% of seats go silent every depth) the vast
   * majority should reach a last-one-standing, and not on depth 2. */
  check('sweep: matches reach a winner', ended >= matches * 0.8, ended + '/' + matches + ' ended');
  check('sweep: matches are not decided instantly', median >= 6, 'median end depth ' + median);
  console.log('  ..  sweep: ' + attacks + ' attacks landed, ' + timeouts + ' timeouts, '
    + eliminations + ' eliminations, ' + ended + '/' + matches + ' matches ended'
    + (endDepths.length ? ' (end depth: min ' + endDepths[0] + ', median ' + median
      + ', max ' + endDepths[endDepths.length - 1] + ')' : ''));
}

/* ------------------------------------------------------------------ */

console.log('[lms-match] 3 seats · loopback wire · real MpSession + director');
const a = scenario(4242, false);
console.log('[lms-match] elimination + end-when-one');
eliminationScenario();
console.log('[lms-match] rage quit');
rageQuitScenario();

const b = scenario(4242, true);
check('determinism: the same match replays byte-identically', a.transcript === b.transcript);

console.log('[lms-match] seeded sweep');
sweepScenario(60, 24);

if (failures) {
  console.error('[lms-match] FAILURES: ' + failures);
  process.exit(1);
}
console.log('[lms-match] ALL PASS');
