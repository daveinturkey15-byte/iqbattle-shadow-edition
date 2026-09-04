/* ============================================================================
 * ICE CONFIGURATION - what the WebRTC leg is allowed to use to find a path.
 *
 * net2.ts used to construct every Peer as `new Ctor(id, { debug: 1 })` with no
 * `config` at all, so peers fell back to peerjs's single default STUN server
 * and had NO relay. Two players on the same LAN connect fine that way; two
 * players on different networks behind symmetric NAT or CGNAT cannot, and the
 * failure surfaces as the join quietly timing out - indistinguishable from a
 * wrong invite code.
 *
 * STUN only discovers your public address. When both ends are behind a NAT
 * that refuses to hold a port open, the ONLY thing that connects them is a
 * TURN relay, which forwards the media itself. There is no free public TURN
 * with published credentials any more (openrelay.metered.ca was the standard
 * one and is dead: host lookup and connect both fail on every transport, as of
 * 2026-09-04), so TURN has to come from an account.
 *
 * Credentials are therefore injected at BUILD time and never committed:
 *   VITE_TURN_URLS        comma-separated, e.g. "turn:x.example:3478,turns:x.example:5349?transport=tcp"
 *   VITE_TURN_USERNAME
 *   VITE_TURN_CREDENTIAL
 * The Pages workflow forwards them from repository secrets. With none set the
 * build is exactly as connectable as before - STUN only, just from more
 * servers - so an absent secret degrades, it does not break.
 *
 * NOTE: a browser TURN credential is not a secret in the cryptographic sense;
 * it necessarily ships inside the client bundle and anyone can read it. Keeping
 * it out of git is about rotation and quota, not concealment. Use a
 * quota-limited credential, and rotate it if the allowance is drained.
 * ==========================================================================*/

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type EnvLike = Record<string, string | undefined>;

/* Several operators on purpose: one STUN host being down or blocked on a
 * given network should not cost the run its public-address discovery. */
export const STUN_SERVERS: readonly IceServer[] = Object.freeze([
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:global.stun.twilio.com:3478' },
]);

/* `import.meta.env` is NOT a readable object in a production bundle. Vite
 * substitutes the exact TEXT `import.meta.env.VITE_FOO` at build time; reading
 * the env as an object (`const e = import.meta.env; e[name]`) compiles to
 * something with no VITE_ keys in it, so the value silently vanishes from the
 * build while still working in dev. Verified the hard way: a build with
 * VITE_TURN_URLS set produced ZERO occurrences of the URL in dist/. Each name
 * below must therefore stay written out in full, exactly once, literally. */
declare global {
  interface ImportMetaEnv {
    readonly VITE_TURN_URLS?: string;
    readonly VITE_TURN_USERNAME?: string;
    readonly VITE_TURN_CREDENTIAL?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

/** Build-time env, or {} anywhere import.meta.env does not exist (node gates). */
export function currentEnv(): EnvLike {
  try {
    return {
      VITE_TURN_URLS: import.meta.env.VITE_TURN_URLS,
      VITE_TURN_USERNAME: import.meta.env.VITE_TURN_USERNAME,
      VITE_TURN_CREDENTIAL: import.meta.env.VITE_TURN_CREDENTIAL,
    };
  } catch {
    return {};
  }
}

/**
 * The TURN entry, or null when it is not fully configured. A partial config is
 * deliberately treated as NO config: shipping a relay with a missing password
 * just spends the ICE gathering window on an allocation that always 401s.
 */
export function turnFromEnv(env: EnvLike = currentEnv()): IceServer | null {
  const raw = (env.VITE_TURN_URLS ?? '').trim();
  const username = (env.VITE_TURN_USERNAME ?? '').trim();
  const credential = (env.VITE_TURN_CREDENTIAL ?? '').trim();
  if (!raw || !username || !credential) return null;

  const urls = raw.split(',').map((u) => u.trim()).filter(Boolean)
    .filter((u) => u.startsWith('turn:') || u.startsWith('turns:'));
  if (urls.length === 0) return null;

  return { urls, username, credential };
}

/** STUN always; TURN appended when credentials were supplied at build time. */
export function iceServers(env: EnvLike = currentEnv()): IceServer[] {
  const list: IceServer[] = STUN_SERVERS.map((s) => ({ ...s }));
  const turn = turnFromEnv(env);
  if (turn) list.push(turn);
  return list;
}

/** True when this build can relay - i.e. can cross a symmetric NAT. */
export function hasRelay(env: EnvLike = currentEnv()): boolean {
  return turnFromEnv(env) !== null;
}

/** The single options object every `new Peer(...)` in net2.ts is built with. */
export function peerOptions(env: EnvLike = currentEnv()): {
  debug: number;
  config: { iceServers: IceServer[] };
} {
  return { debug: 1, config: { iceServers: iceServers(env) } };
}
