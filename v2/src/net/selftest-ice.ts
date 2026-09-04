/* ============================================================================
 * GATE: ICE configuration (src/net/ice.ts).
 *
 * Run: node --experimental-strip-types src/net/selftest-ice.ts
 *
 * Guards the defect that leaves cross-network multiplayer unable to connect:
 * peers built with no `config`, so no relay and one STUN server. Falsified -
 * dropping the TURN entry from iceServers() makes "turn is offered when
 * configured" exit 1.
 * ==========================================================================*/

import {
  STUN_SERVERS, hasRelay, iceServers, peerOptions, turnFromEnv, type EnvLike,
} from './ice.ts';

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

const FULL: EnvLike = {
  VITE_TURN_URLS: 'turn:relay.example:3478, turns:relay.example:5349?transport=tcp ',
  VITE_TURN_USERNAME: 'u1',
  VITE_TURN_CREDENTIAL: 'p1',
};

/* ---- STUN is unconditional -------------------------------------------- */
const bare = iceServers({});
check('stun present with no env', bare.length >= 1, JSON.stringify(bare));
check('every bare entry is stun', bare.every((s) => {
  const u = Array.isArray(s.urls) ? s.urls : [s.urls];
  return u.every((x) => x.startsWith('stun:'));
}), JSON.stringify(bare));
check('more than one stun operator', bare.length >= 2, 'len=' + bare.length);
eq('no relay without credentials', hasRelay({}), false);
eq('no turn entry without credentials', turnFromEnv({}), null);

/* ---- TURN when fully configured ---------------------------------------- */
const turn = turnFromEnv(FULL);
check('turn is offered when configured', turn !== null);
eq('turn urls are split and trimmed', turn?.urls,
  ['turn:relay.example:3478', 'turns:relay.example:5349?transport=tcp']);
eq('turn carries the username', turn?.username, 'u1');
eq('turn carries the credential', turn?.credential, 'p1');
eq('hasRelay true when configured', hasRelay(FULL), true);

const full = iceServers(FULL);
check('stun survives alongside turn', full.length === bare.length + 1,
  'full=' + full.length + ' bare=' + bare.length);
check('turn is in the served list', full.some((s) => {
  const u = Array.isArray(s.urls) ? s.urls : [s.urls];
  return u.some((x) => x.startsWith('turn:') || x.startsWith('turns:'));
}), JSON.stringify(full));

/* ---- a HALF-configured relay must be ignored, not shipped broken ------- */
eq('url without creds is ignored', turnFromEnv({ VITE_TURN_URLS: 'turn:relay.example:3478' }), null);
eq('creds without url are ignored',
  turnFromEnv({ VITE_TURN_USERNAME: 'u', VITE_TURN_CREDENTIAL: 'p' }), null);
eq('missing password is ignored',
  turnFromEnv({ ...FULL, VITE_TURN_CREDENTIAL: '   ' }), null);
eq('a non-turn scheme is not a relay',
  turnFromEnv({ ...FULL, VITE_TURN_URLS: 'stun:relay.example:3478' }), null);

/* ---- what net2.ts actually hands to peerjs ----------------------------- */
const opts = peerOptions(FULL);
check('peerOptions carries a config', !!opts.config, JSON.stringify(opts));
check('peerOptions ships iceServers', Array.isArray(opts.config.iceServers)
  && opts.config.iceServers.length > 0, JSON.stringify(opts.config));
eq('peerOptions keeps debug', opts.debug, 1);
check('bare peerOptions still has stun', peerOptions({}).config.iceServers.length >= 2);

/* STUN_SERVERS is shared across every Peer; a mutation would leak between
 * sessions, so iceServers() must hand out copies. */
const a = iceServers({}), b = iceServers({});
a[0].urls = 'stun:mutated';
check('iceServers returns fresh objects', b[0].urls !== 'stun:mutated', JSON.stringify(b[0]));
check('STUN_SERVERS is frozen', Object.isFrozen(STUN_SERVERS));

/* ---- the Vite trap ------------------------------------------------------
 * Vite substitutes the exact TEXT `import.meta.env.VITE_FOO` at build time.
 * Reading the env as an OBJECT works in dev and silently ships nothing in
 * production - a build with VITE_TURN_URLS set produced zero occurrences of
 * the URL in dist/. So assert the literal accessors are still present in the
 * source; a refactor to dynamic access must fail here, not in the field. */
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./ice.ts', import.meta.url), 'utf8');
for (const name of ['VITE_TURN_URLS', 'VITE_TURN_USERNAME', 'VITE_TURN_CREDENTIAL']) {
  check('literal accessor for ' + name,
    src.includes('import.meta.env.' + name),
    'ice.ts must read import.meta.env.' + name + ' literally, not via a variable');
}

if (failures > 0) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('selftest-ice: OK');
