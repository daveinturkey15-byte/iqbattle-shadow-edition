/* ============================================================================
 * GATE: lobby identity (src/scenes/lobby-roster.ts + the mp.ts wiring).
 *
 * Run: node --experimental-strip-types src/scenes/selftest-lobby.ts   (0 = PASS)
 *
 * Guards the defect that told every joiner it was the host: the lobby tagged
 * the "you" card by SEAT INDEX, and seat 0 is always the host, so host and
 * joiner tabs rendered an identical roster — "you · host" on the host's card
 * on everybody's screen.
 *
 * The leaf maths is asserted directly, and then the same assertion is made
 * over a REAL MpSession roster carried across a loopback `lobby` frame, so
 * this gate fails if the wiring in buildMpScreen regresses back to seat
 * order even while seatTags() stays correct.
 *
 * Falsified before trusted: restoring `i === 0 ? ['you','host'] : []`
 * (i.e. tagging by index) makes "joiner: host card is not you" exit 1.
 * ==========================================================================*/

import { lobbyView, seatTags, startControl, type LobbySeat } from './lobby-roster.ts';
import { MpSession } from './mp.ts';
import type { Frame, NetApi, PlayerRec } from '../net/net2.ts';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) return;
  failures++;
  console.error('FAIL: ' + name + (detail ? ' -- ' + detail : ''));
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  check(name, g === w, 'got ' + g + ', want ' + w);
}

/* ---- seatTags: identity, never seat order ------------------------------ */

const HOST: LobbySeat = { uid: 'HOST', name: 'OxAlpha', isHost: true };
const JOINER: LobbySeat = { uid: 'C2', name: 'Dave', isHost: false };
const OTHER: LobbySeat = { uid: 'C3', name: 'shadow awaits', isHost: false };

eq('host screen: own card is you · host', seatTags(HOST, 'HOST'), ['you', 'host']);
eq('host screen: joiner card is bare', seatTags(JOINER, 'HOST'), []);

eq('joiner: host card is not you', seatTags(HOST, 'C2'), ['host']);
eq('joiner: own card is you', seatTags(JOINER, 'C2'), ['you']);
eq('joiner: third seat is bare', seatTags(OTHER, 'C2'), []);

/* An unknown local uid must tag NOBODY — a missing self-marker is cosmetic,
 * a misplaced one is a lie about who the player is. */
eq('unknown local uid tags nobody as you', seatTags(HOST, null), ['host']);
eq('local uid absent from roster tags nobody', seatTags(JOINER, 'C9'), []);
eq('seat with no uid is never you', seatTags({ uid: null, name: 'X', isHost: false }, null), []);

/* ---- startControl: only the host gets a live START --------------------- */

eq('host gets a live primary START', startControl(true), { label: 'START', variant: 'primary', enabled: true });
const joinerStart = startControl(false);
check('joiner START is disabled', joinerStart.enabled === false);
check('joiner START is not primary', joinerStart.variant !== 'primary', joinerStart.variant);
check('joiner START says what it waits for', /WAITING/i.test(joinerStart.label), joinerStart.label);

/* ---- lobbyView: the projection buildMpScreen actually uses -------------- */

const ROSTER: PlayerRec[] = [
  { id: 'HOST', name: 'OxAlpha', isHost: true },
  { id: 'C2', name: 'Dave', isHost: false },
];
const hostView = lobbyView(ROSTER, 'HOST', true);
const joinView = lobbyView(ROSTER, 'C2', false);
eq('host view can start', hostView.canStart, true);
eq('joiner view cannot start', joinView.canStart, false);
eq('host view tags seat 0', seatTags(hostView.players[0], hostView.youUid), ['you', 'host']);
eq('joiner view tags seat 1', seatTags(joinView.players[1], joinView.youUid), ['you']);
check(
  'host and joiner screens are NOT identical',
  JSON.stringify(hostView.players.map((p) => seatTags(p, hostView.youUid)))
  !== JSON.stringify(joinView.players.map((p) => seatTags(p, joinView.youUid))),
);

/* ---- end to end: identity survives a real lobby frame ------------------ */

/** Minimal loopback: whatever the host broadcasts, the client receives. */
function wire(): { hostNet: NetApi; clientNet: NetApi } {
  const clientHandlers = new Map<string, Array<(f: Frame) => void>>();
  const stub = (uid: string, onSend: (f: Frame) => void,
    handlers: Map<string, Array<(f: Frame) => void>>): NetApi => ({
    host: async () => ({ code: 'TEST' }),
    join: async () => ({ players: [] }),
    on(type, fn) {
      const list = handlers.get(type) ?? [];
      list.push(fn);
      handlers.set(type, list);
      return () => {
        const cur = handlers.get(type) ?? [];
        const i = cur.indexOf(fn);
        if (i >= 0) cur.splice(i, 1);
      };
    },
    send: () => undefined,
    broadcast: (obj) => { onSend(obj); return true; },
    kick: () => true,
    unicast: () => undefined,
    leave: () => undefined,
    myUid: () => uid,
    debugLog: () => [],
    refreshLobby: () => undefined,
    sanitizeRound: (p) => p,
  });
  const deliverToClient = (f: Frame): void => {
    for (const fn of clientHandlers.get(f.t) ?? []) fn(JSON.parse(JSON.stringify(f)) as Frame);
  };
  return {
    hostNet: stub('HOST', deliverToClient, new Map()),
    clientNet: stub('C2', () => undefined, clientHandlers),
  };
}

const { hostNet, clientNet } = wire();
const hostSession = new MpSession(hostNet, 'host', {}, [ROSTER[0]]);
const clientSession = new MpSession(clientNet, 'client', {}, []);

// The host publishes the roster the moment the joiner registers.
hostNet.broadcast({ t: 'lobby', players: ROSTER });

const liveHost = lobbyView(hostSession.rosterNow(), hostSession.myUid(), true);
const liveJoin = lobbyView(clientSession.rosterNow(), clientSession.myUid(), false);

eq('live: joiner roster arrived', liveJoin.players.map((p) => p.name), ['OxAlpha', 'Dave']);
eq('live: joiner is not told it is the host',
  seatTags(liveJoin.players[0], liveJoin.youUid), ['host']);
eq('live: joiner sees itself on its own seat',
  seatTags(liveJoin.players[1], liveJoin.youUid), ['you']);
eq('live: host sees itself on seat 0',
  seatTags(liveHost.players[0], liveHost.youUid), ['you', 'host']);
check('live: exactly one you on the joiner screen',
  liveJoin.players.filter((p) => seatTags(p, liveJoin.youUid).includes('you')).length === 1);
check('live: exactly one you on the host screen',
  liveHost.players.filter((p) => seatTags(p, liveHost.youUid).includes('you')).length === 1);
check('live: only the host screen can start',
  liveHost.canStart === true && liveJoin.canStart === false);

/* ---- runner ------------------------------------------------------------ */

if (failures > 0) {
  console.error('\nSELFTEST FAILED — ' + failures + ' failing check(s)');
  process.exit(1);
}
console.log('SELFTEST PASSED — lobby identity: you follows uid, START follows role');
process.exit(0);
