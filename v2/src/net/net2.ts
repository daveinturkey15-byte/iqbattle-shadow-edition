/* ============================================================================
 * IQ2.NET — dual-transport multiplayer core for IQ Versus: SHADOW v2.
 *
 * TypeScript port of frozen-v1 net.js (repo root), mechanic-for-mechanic, with
 * every WAVE-5 transport hardening that research/net-transport-proof.js drove
 * to extinction (D5-class loss/dup races):
 *   - EPOCH-WATERMARK SEQ DEDUPE — outbound frames carry `_sq = '<epoch>:<n>'`
 *     (fresh epoch per host()/join()). Receivers keep a contiguous per-epoch
 *     high-water mark + hole set, so ANY reorder / duplication / replay
 *     collapses to exactly-once (the old "last 120 seen" FIFO leaked late
 *     replays past eviction — 6300+ dup handles per seed).
 *   - COLLISION-PROOF NONCES — bus frames carry `_n = '<uid>.<counter>.<ts36>'`,
 *     strictly unique per sender, so back-to-back reveal+round bursts can
 *     never collide into a false "already seen".
 *   - PER-WRITER OUTBOX RINGS — the localStorage fallback keeps a ring per
 *     writer ('iqvs-bus-<code>-ob-<uid>-<salt>', 256 slots, >10s pruned on
 *     write). Only the writer ever mutates its own ring (zero cross-tab
 *     read-modify-write race); readers NEVER delete — N poll-only tabs each
 *     drain the FULL stream.
 *
 * TRANSPORTS: PeerJS 1.4.7 loaded on demand via a dynamic <script> tag, PLUS
 * a same-browser BroadcastChannel bus (localStorage-ring fallback where
 * BroadcastChannel is unavailable) so tabs on one machine find each other
 * even when the broker is down. Every frame flows on BOTH pipes; _sq/_n
 * dedupe makes that exactly-once.
 *
 * TOPOLOGY: star, HOST-AUTHORITATIVE. Clients only ever talk to the host;
 * the host validates every action, owns scoring, relays state. v2 rounds are
 * regenerated from {family, seed} on every client, so the round frame NEVER
 * carries puzzle content — the answer cannot leak pre-reveal by construction.
 * `sanitizeRound()` remains exported for any future payload-bearing frame.
 *
 * FRAMES (plain JSON objects stamped {t, _sq?, _n?, src?, to?}):
 *   hello   client→host {name, uid}        lobby   host→all {players}
 *   begin   host→all {timer,lms,rn,sd}     round   host→all {n,timerLen,stg{id,seed}}
 *   pick    client→host {n,qid,idx}        sr      client→host {n,sr{correct,points,hpDelta}}
 *   reveal  host→all {n,answer,scores}     end     host→all {scores,reason?}
 *   elim    host→all {uids}                attack  client→host {targetUid,weapon,n}
 *   meta    host→all {rn}                  metaReq client→host {}
 *
 * DETERMINISM NOTE: Math.random/Date.now appear ONLY in session plumbing
 * (uids, epochs, nonces, bus salts) — never in gameplay decisions, which
 * derive exclusively from ctx seeds shipped in begin.sd / round.stg.seed.
 *
 * API (per createNet() instance; `Net` is the app-wide singleton):
 *   .host(roomCode, name)  -> Promise<{code}>   (retries taken ids CODE2..CODE8)
 *   .join(roomCode, name)  -> Promise<{players}>
 *   .on(type, fn)          -> unsubscribe       .send(obj)   client→host (host: local loopback)
 *   .broadcast(obj)        host→all (+local)    .kick(id) / .leave()
 *   .myUid() .debugLog() .sanitizeRound(puzzle)
 *
 * TESTABILITY: createNet({ makePeer?, busFactory? }) accepts transport
 * stubs; src/net/selftest.ts drives 3 sessions over adversarial stub pipes
 * (dup + reordered delivery, 500-frame bursts, zero loss/dup).
 * ==========================================================================*/

/* ---------------------------- public types ------------------------------ */

export type Role = 'host' | 'client';

export interface PlayerRec {
  id: string;
  name: string;
  isHost: boolean;
}

/** Loose wire shape: every frame has `t` plus free-form fields. */
export interface Frame {
  t: string;
  _sq?: string;
  _n?: string;
  src?: string;
  to?: string;
  uid?: string;
  name?: string;
  [k: string]: unknown;
}

export interface LogEv {
  t: string;
  dir: 'in' | 'out' | 'err';
  ts: number;
  ok: boolean;
}

/* Structural minimums of the PeerJS surface we touch (kept local — peerjs is
 * script-tag loaded, not imported, so it stays out of the vite bundle). */
export interface DataConnLike {
  open: boolean;
  peer: string;
  send(data: unknown): void;
  close(): void;
  on(ev: string, cb: (...args: unknown[]) => void): void;
}

export interface PeerLike {
  open: boolean;
  on(ev: string, cb: (...args: unknown[]) => void): void;
  connect(id: string, opts?: { reliable?: boolean; serialization?: string }): DataConnLike;
  reconnect(): void;
  destroy(): void;
}

export type PeerCtor = new (id: string | null, opts?: { debug?: number }) => PeerLike;

export interface BusHandle {
  post(frame: Frame): void;
  close(): void;
  onFrame(cb: (frame: Frame) => void): void;
}

export type BusFactory = (code: string, myId: string) => BusHandle | null;

/* --------------------- environment boundary probes ----------------------- */

/**
 * Untyped environment globals, read through ONE validated seam. Each probe
 * narrows with runtime checks before anything is used — no shape is trusted
 * without a check.
 */

/** A BroadcastChannel-like constructor as observed at runtime. */
interface BCLike {
  postMessage(m: unknown): void;
  close(): void;
  addEventListener(ev: string, cb: (e: MessageEvent) => void): void;
}

function envPeerCtor(): PeerCtor | null {
  const v: unknown = (globalThis as Record<string, unknown>).Peer;
  // Runtime-checked: only a constructible function qualifies as the peerjs
  // global (validated boundary — the cast documents the contract we probed).
  return typeof v === 'function' ? (v as PeerCtor) : null;
}

function envBroadcastChannelCtor(): (new (name: string) => BCLike) | null {
  const v: unknown = (globalThis as Record<string, unknown>).BroadcastChannel;
  return typeof v === 'function' ? (v as new (name: string) => BCLike) : null;
}

function envLocalStorage(): Storage | null {
  const v: unknown = (globalThis as Record<string, unknown>).localStorage;
  if (!v || typeof v !== 'object') return null;
  const ls = v as Partial<Storage>;
  return typeof ls.getItem === 'function' && typeof ls.setItem === 'function' ? (ls as Storage) : null;
}

function errorType(err: unknown): string | undefined {
  if (!err || typeof err !== 'object' || !('type' in err)) return undefined;
  const t: unknown = err.type;
  return typeof t === 'string' ? t : undefined;
}

/* ------------------------- PeerJS script loader -------------------------- */

const PEER_JS_URL = 'https://unpkg.com/peerjs@1.4.7/dist/peerjs.min.js';
let peerScriptPromise: Promise<PeerCtor | null> | null = null;

/** Load peerjs@1.4.7 via dynamic <script> tag; resolves null when offline. */
export function loadPeerJs(url: string = PEER_JS_URL): Promise<PeerCtor | null> {
  const ready = envPeerCtor();
  if (ready) return Promise.resolve(ready);
  if (peerScriptPromise) return peerScriptPromise;
  peerScriptPromise = new Promise<PeerCtor | null>((resolve) => {
    const doc: unknown = (globalThis as Record<string, unknown>).document;
    if (!doc || typeof (doc as { createElement?: unknown }).createElement !== 'function') {
      peerScriptPromise = null; // headless/non-DOM: allow a later retry
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve(envPeerCtor());
    };
    const s = (doc as Document).createElement('script'); // validated above
    s.src = url;
    s.async = true;
    s.onload = () => finish();
    s.onerror = () => {
      peerScriptPromise = null; // allow a later retry
      settled = true;
      resolve(null);
    };
    (doc as { head: HTMLElement }).head.appendChild(s);
    setTimeout(finish, 8000);
  });
  return peerScriptPromise;
}

export function peerAvailable(): boolean {
  return envPeerCtor() != null;
}

/* --------------------- real bus (BC + localStorage) ---------------------- */

const OB_CAP = 256; // per-writer ring bounds: entries
const OB_TTL = 10000; // …and age ms — stale rings can never replay ghosts
const POLL_MS = 400; // headless/file:// environments never fire 'storage'
const SEEN_NONCE_CAP = 4096;

interface RingEntry {
  n: string;
  t: number;
  v: string;
}

/** BroadcastChannel primary; localStorage per-writer-ring fallback. */
export function realBusFactory(code: string, myId: string): BusHandle | null {
  const BCCtor = envBroadcastChannelCtor();

  if (BCCtor) {
    try {
      const ch = new BCCtor('iqvs-bus-' + code);
      let cb: ((f: Frame) => void) | null = null;
      ch.addEventListener('message', (e: MessageEvent) => {
        const d: unknown = e.data;
        if (cb && d && typeof d === 'object') cb(d as Frame);
      });
      return {
        post: (f) => {
          try {
            ch.postMessage(f);
          } catch {
            /* a broken pipe never kills the session */
          }
        },
        close: () => {
          try {
            ch.close();
          } catch {
            /* noop */
          }
        },
        onFrame: (f) => {
          cb = f;
        },
      };
    } catch {
      /* fall through to the localStorage path */
    }
  }

  // localStorage fallback: storage events + 400ms poll of per-writer rings.
  const ls = envLocalStorage();
  const gAdd: unknown = (globalThis as Record<string, unknown>).addEventListener;
  if (!ls || typeof gAdd !== 'function') return null;
  const key = 'iqvs-bus-' + code;
  // One ring identity per session: a NEW session gets a fresh salt so old
  // rings are never resumed (their entries age out via OB_TTL regardless).
  const boxId =
    myId + '-' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  let cb: ((f: Frame) => void) | null = null;
  const deliverIfForeign = (raw: string | null): void => {
    if (!cb || !raw) return;
    let m: Frame | null = null;
    try {
      m = JSON.parse(raw) as Frame;
    } catch {
      return;
    }
    if (m && m.src !== myId) cb(m);
  };
  const storageHandler = (ev: StorageEvent): void => {
    if (!ev.key || ev.key !== key) return;
    deliverIfForeign(ev.newValue);
  };
  gAdd.call(globalThis, 'storage', storageHandler);

  let lastNonce: string | null = null;
  const timer = setInterval(() => {
    try {
      // Drain EVERY writer's ring; readers never delete — each tab skips
      // already-seen nonces itself, so N poll-only tabs each get the stream.
      const nowMs = Date.now();
      const prefix = key + '-ob-';
      const ks: string[] = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k && k.indexOf(prefix) === 0) ks.push(k);
      }
      for (const k of ks) {
        let box: RingEntry[] | null = null;
        try {
          const parsed: unknown = JSON.parse(ls.getItem(k) ?? 'null');
          if (Array.isArray(parsed)) box = parsed as RingEntry[];
        } catch {
          box = null; // skip corrupt ring
        }
        if (!box) continue;
        for (const e of box) {
          if (!e || !e.n || e.t < nowMs - OB_TTL) continue;
          deliverIfForeign(e.v);
        }
      }
      const raw = ls.getItem(key);
      if (!raw) return;
      let last: Frame | null = null;
      try {
        last = JSON.parse(raw) as Frame;
      } catch {
        return;
      }
      if (!last || !last._n || last._n === lastNonce || last.src === myId) return;
      lastNonce = last._n;
      deliverIfForeign(raw);
    } catch {
      /* poll errors are swallowed — the next tick retries */
    }
  }, POLL_MS);

  return {
    post: (f) => {
      const raw = JSON.stringify(f);
      try {
        ls.setItem(key, raw);
      } catch {
        /* quota/full — the ring below still carries it to pollers */
      }
      try {
        const obk = key + '-ob-' + boxId;
        let box: RingEntry[] | null = null;
        try {
          const parsed: unknown = JSON.parse(ls.getItem(obk) ?? 'null');
          if (Array.isArray(parsed)) box = parsed as RingEntry[];
        } catch {
          box = null; // start a fresh ring
        }
        if (!box) box = [];
        const nowMs = Date.now();
        box.push({ n: String(f._n ?? ''), t: nowMs, v: raw });
        while (box.length && (box[0].t < nowMs - OB_TTL || box.length > OB_CAP)) box.shift();
        ls.setItem(obk, JSON.stringify(box));
      } catch {
        /* ring failure degrades to the bare-key path only */
      }
    },
    close: () => {
      clearInterval(timer);
      try {
        const rm: unknown = (globalThis as Record<string, unknown>).removeEventListener;
        if (typeof rm === 'function') rm.call(globalThis, 'storage', storageHandler);
      } catch {
        /* noop */
      }
      try {
        ls.removeItem(key + '-ob-' + boxId);
      } catch {
        /* noop */
      }
    },
    onFrame: (f) => {
      cb = f;
    },
  };
}

/* ----------------------------- createNet -------------------------------- */

const MAX_ID_RETRIES = 8; // iqvs-CODE, iqvs-CODE2, … before giving up
const ID_CHARS = /^[A-Z0-9]{3,12}$/;
const LOG_CAP = 20;
const WM_HOLE_CAP = 32768; // valve >> any real reorder depth (bursts ~1e3)

export interface NetOpts {
  /** Override the PeerJS constructor source (tests inject a stub). */
  makePeer?: () => Promise<PeerCtor | null>;
  /** Override the same-browser bus (tests inject an in-memory hub). */
  busFactory?: BusFactory;
}

export interface NetApi {
  host(roomCode: string, displayName: string): Promise<{ code: string }>;
  join(roomCode: string, displayName: string): Promise<{ players: PlayerRec[] }>;
  on(type: string, fn: (payload: Frame) => void): () => void;
  send(obj: Frame): void;
  broadcast(obj: Frame): boolean;
  kick(id: string): boolean;
  leave(): void;
  myUid(): string | null;
  debugLog(): LogEv[];
  sanitizeRound(puzzle: Record<string, unknown>): Record<string, unknown>;
}

/** Contiguous per-epoch watermark: highest consecutive n + hole set. */
interface Watermark {
  hi: number;
  hole: Set<number>;
}

export function createNet(opts: NetOpts = {}): NetApi {
  const makePeerImpl = opts.makePeer ?? (async () => loadPeerJs());
  const busFactory = opts.busFactory ?? realBusFactory;

  const conns = new Map<string, DataConnLike>(); // host: uid -> conn (dynamic roster)
  const players = new Map<string, PlayerRec>(); // dynamic uid-keyed roster
  const handlers = new Map<string, Array<(p: Frame) => void>>();
  const logRing: LogEv[] = [];
  const seenNonces = new Set<string>();
  const opaqueSqSeen = new Set<string>();
  const watermarks = new Map<string, Watermark>();

  let role: Role | null = null;
  let code: string | null = null;
  let peer: PeerLike | null = null;
  let hostConn: DataConnLike | null = null;
  let bus: BusHandle | null = null;
  let dead = true;
  let joining = false;
  let myUid: string | null = null;
  let sqEp: string | null = null;
  let sqOut = 0;
  let nonceSeq = 0;
  let retryJoinConn: (() => void) | null = null;

  /* ---- tiny debug ring ---- */
  function logEv(t: string, dir: LogEv['dir'], ok: boolean): void {
    logRing.push({ t: String(t == null ? '' : t), dir, ts: Date.now(), ok: !!ok });
    if (logRing.length > LOG_CAP) logRing.splice(0, logRing.length - LOG_CAP);
  }

  /* ---- event bus (callbacks no-throw: a broken UI never kills a session) -- */
  function emit(payload: Frame): void {
    try {
      const w = globalThis as { __frames?: Array<{ t: string; dir: string }> };
      const fr = w.__frames || (w.__frames = []); fr.push({ t: payload.t, dir: 'in' }); if (fr.length > 200) fr.shift();
    } catch { /* dev trace only */ }
    const list = handlers.get(payload.t);
    if (!list) return;
    for (const fn of [...list]) {
      try {
        fn(payload);
      } catch {
        /* isolated */
      }
    }
  }

  /* ---- epoch-watermark dedupe: '<epoch>:<n>' -> exactly-once ------------- */
  function seenSq(n: string | null | undefined): boolean {
    if (n == null) return false;
    const s = String(n);
    const ci = s.lastIndexOf(':');
    if (ci > 0) {
      const ep = s.slice(0, ci);
      const num = Number(s.slice(ci + 1));
      if (ep && isFinite(num) && num >= 0) {
        let w = watermarks.get(ep);
        if (!w) {
          w = { hi: 0, hole: new Set<number>() };
          watermarks.set(ep, w);
        }
        // Drop if swept by the contiguous watermark OR already seen beyond it
        // (the hole check is what kills replay-of-out-of-order duplicates).
        if (num <= w.hi || w.hole.has(num)) return true;
        w.hole.add(num);
        while (w.hole.has(w.hi + 1)) {
          w.hole.delete(w.hi + 1);
          w.hi++;
        }
        // Memory guard only: needs >32k frames concurrently out of order.
        if (w.hole.size > WM_HOLE_CAP) w.hole.clear();
        return false;
      }
    }
    if (opaqueSqSeen.has(s)) return true; // opaque legacy seq value
    opaqueSqSeen.add(s);
    if (opaqueSqSeen.size > 512) {
      const first = opaqueSqSeen.values().next().value;
      if (first !== undefined) opaqueSqSeen.delete(first);
    }
    return false;
  }

  /** Collision-proof bus nonce: '<uid>.<counter>.<ts36>'. */
  function stampNonce(f: Frame): Frame {
    f._n = myUid + '.' + ++nonceSeq + '.' + Date.now().toString(36);
    f.src = myUid ?? '?';
    return f;
  }

  function seenNonce(n: string): boolean {
    if (seenNonces.has(n)) return true;
    seenNonces.add(n);
    if (seenNonces.size > SEEN_NONCE_CAP) {
      const first = seenNonces.values().next().value;
      if (first !== undefined) seenNonces.delete(first);
    }
    return false;
  }

  const clip = (s: string): string => String(s || 'PLAYER').slice(0, 16); // shared cap for all display names

  const sanitizeCode = (raw: string): string =>
    String(raw == null ? '' : raw)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 12);

  function lobbyFrame(): Frame {
    return { t: 'lobby', players: [...players.values()] };
  }

  function connKey(c: DataConnLike): string | null {
    for (const [k, v] of conns) if (v === c) return k;
    return null;
  }

  /* ---- inbound frames, both transports ------------------------------------ */
  function acceptHostFrame(msg: Frame, conn: DataConnLike | null): void {
    // Shared by the PeerJS branch (conn present) and the bus branch (conn
    // null) so hello registration/dedup behaves identically on either pipe.
    if (msg.t === 'hello') {
      const pid = String(msg.uid || (conn ? conn.peer : msg.src) || '?');
      if (conn) {
        // Retire stale registrations pointing at this physical conn so a
        // re-hello under a new uid cannot leave ghosts behind.
        for (const [pk, pc] of conns) {
          if (pc === conn && pk !== pid) {
            conns.delete(pk);
            players.delete(pk);
          }
        }
        const prev = conns.get(pid);
        if (prev && prev !== conn) {
          try {
            prev.close();
          } catch {
            /* already gone */
          }
        }
      }
      const isNew = !players.has(pid);
      players.set(pid, { id: pid, name: clip(String(msg.name ?? 'PLAYER')), isHost: false });
      if (conn) conns.set(pid, conn);
      if (isNew) emit({ t: 'peer-join', id: pid, name: players.get(pid)?.name });
      void broadcast(lobbyFrame()); // emits locally too — one path for both roles
      return;
    }
    if (msg.t === 'lobby') return;
    if (msg._sq != null && seenSq(msg._sq)) return; // dual-transport copy
    if (!msg.uid) msg.uid = conn ? connKey(conn) ?? conn.peer : msg.src; // score key = stable uid, never name
    emit(msg);
  }

  function acceptClientFrame(msg: Frame): void {
    if (msg.t === 'hello') return;
    if (msg._sq != null && seenSq(msg._sq)) return;
    emit(msg);
  }

  /* ---- inbound: PeerJS data ---------------------------------------------- */
  function onData(c: DataConnLike, data: unknown): void {
    if (!data || (typeof data !== 'object' && typeof data !== 'string')) return;
    let raw: unknown = data;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        return;
      }
    }
    if (!raw || typeof raw !== 'object') return;
    const msg = raw as Frame; // index-signature view; every field re-validated below
    if (typeof msg.t !== 'string') return;
    logEv(msg.t, 'in', true);
    if (role === 'host') acceptHostFrame(msg, c);
    else if (role === 'client') acceptClientFrame(msg);
  }

  function wireConn(c: DataConnLike): void {
    c.on('data', (d: unknown) => {
      try {
        onData(c, d);
      } catch (e) {
        logEv('handler-error', 'err', false);
        emit({ t: 'net-error', message: String((e as Error)?.message ?? e) });
      }
    });
    c.on('close', () => onConnGone(c));
    c.on('error', () => onConnGone(c));
  }

  /* ---- inbound: same-browser bus ------------------------------------------ */
  function onBusFrame(frame: Frame): void {
    if (!frame || typeof frame !== 'object' || typeof frame.t !== 'string') return;
    if (frame.to && frame.to !== myUid) return;
    if (frame.src === myUid) return; // never echo self (poll paths can)
    if (frame._n != null && seenNonce(frame._n)) return;
    logEv(frame.t, 'in', true);
    if (role === 'host') acceptHostFrame(frame, null);
    else if (role === 'client') acceptClientFrame(frame);
  }

  /* ---- teardown ----------------------------------------------------------- */
  function busClose(): void {
    try {
      bus?.close();
    } catch {
      /* noop */
    }
    bus = null;
  }

  function teardown(): void {
    retryJoinConn = null;
    dead = true;
    joining = false;
    for (const c of conns.values()) {
      try {
        c.close();
      } catch {
        /* noop */
      }
    }
    conns.clear();
    if (hostConn) {
      try {
        hostConn.close();
      } catch {
        /* noop */
      }
      hostConn = null;
    }
    watermarks.clear();
    opaqueSqSeen.clear();
    seenNonces.clear();
    sqEp = null;
    sqOut = 0;
    if (peer) {
      try {
        peer.destroy();
      } catch {
        /* noop */
      }
      peer = null;
    }
    role = null;
    players.clear();
    handlers.clear();
    busClose();
    code = null;
  }

  function onConnGone(c: DataConnLike): void {
    if (role === 'host') {
      const pid = connKey(c);
      if (!pid || !players.has(pid)) return;
      if (conns.get(pid) !== c) return; // superseded by a replacement hello
      conns.delete(pid);
      const gone = players.get(pid);
      players.delete(pid);
      emit({ t: 'peer-leave', id: pid, name: gone?.name });
      void broadcast(lobbyFrame());
    } else if (role === 'client' && !dead) {
      if (joining && retryJoinConn) {
        retryJoinConn(); // broker flap mid-handshake -> retry
        return;
      }
      dead = true;
      emit({ t: 'end', reason: 'host-left' });
    }
  }

  /* ---- host ---------------------------------------------------------------- */
  async function host(roomCode: string, displayName: string): Promise<{ code: string }> {
    const base = sanitizeCode(roomCode);
    if (!ID_CHARS.test(base)) throw new Error('IQ2.Net: room code must be 3-12 letters/digits');
    teardown();

    myUid = 'HOST';
    sqEp = 'H' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    sqOut = 0; // fresh epoch => fresh sequence space
    role = 'host';
    code = base;
    dead = false;
    bus = busFactory(base, myUid);
    bus?.onFrame(onBusFrame);

    const Ctor = await makePeerImpl();
    if (!Ctor) {
      role = null;
      busClose();
      throw new Error('IQ2.Net: PeerJS unavailable');
    }
    if (role !== 'host') throw new Error('IQ2.Net: session torn down while opening');

    let attempt = 0;
    return new Promise<{ code: string }>((resolve, reject) => {
      const tryOpen = (): void => {
        attempt++;
        const id = 'iqvs-' + base + (attempt > 1 ? String(attempt) : '');
        const p = new Ctor(id, { debug: 1 });
        peer = p;
        p.on('open', (...args: unknown[]) => {
          const finalCode = base + (attempt > 1 ? String(attempt) : '');
          // Ghost-code guard: fell back to a suffixed id -> rebind the bus to
          // the REAL room code so joiners find us.
          if (finalCode !== base) {
            busClose();
            bus = busFactory(finalCode, myUid ?? 'HOST');
            bus?.onFrame(onBusFrame);
          }
          code = finalCode;
          const selfId = String(args[0] ?? id);
          players.set(selfId, { id: selfId, name: clip(displayName || 'HOST'), isHost: true });
          p.on('connection', (...cargs: unknown[]) => {
            // Script-tag peerjs is untyped; the conn contract is enforced by
            // wireConn's usage — named boundary cast, single point.
            const conn = cargs[0] as DataConnLike;
            if (conn && typeof conn === 'object') wireConn(conn);
          });
          p.on('disconnected', () => {
            try {
              p.reconnect();
            } catch {
              /* peer already destroyed */
            }
          });
          p.on('close', () => {
            if (!dead) role = null;
          });
          resolve({ code: finalCode });
        });
        p.on('error', (err: unknown) => {
          const type = errorType(err);
          logEv(type || 'peer-error', 'err', false);
          if ((type === 'unavailable-id' || type === 'invalid-id') && attempt < MAX_ID_RETRIES) {
            try {
              p.destroy();
            } catch {
              /* noop */
            }
            tryOpen(); // id taken -> next suffix
          } else if (!p.open) {
            role = null;
            busClose();
            reject(err instanceof Error ? err : new Error(String(type ?? 'peer-error')));
          } else {
            emit({ t: 'end', reason: 'net-error', detail: type }); // mid-session hiccup
          }
        });
      };
      tryOpen();
    });
  }

  /* ---- join ------------------------------------------------------------------ */
  async function join(roomCode: string, displayName: string): Promise<{ players: PlayerRec[] }> {
    const c = sanitizeCode(roomCode);
    if (!ID_CHARS.test(c)) throw new Error('IQ2.Net: room code must be 3-12 letters/digits');
    teardown();

    role = 'client';
    code = c;
    dead = false;
    joining = true;
    // ONE stable uid shared by both hellos -> the host registers this human
    // exactly once even when both transports connect.
    const uid = 'C' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    myUid = uid;
    sqEp = uid; // client epoch == its stable uid (unique per join)
    sqOut = 0;

    bus = busFactory(c, uid);
    bus?.onFrame(onBusFrame);
    if (bus) {
      bus.post(stampNonce({ t: 'hello', to: 'HOST', name: clip(displayName), uid }));
      logEv('hello', 'out', true);
    }

    const Ctor = await makePeerImpl();
    if (!Ctor) {
      teardown();
      throw new Error('IQ2.Net: PeerJS unavailable');
    }
    if (role !== 'client') throw new Error('IQ2.Net: session torn down while joining');

    return new Promise<{ players: PlayerRec[] }>((resolve, reject) => {
      let settled = false;
      let tryN = 0;
      const p = new Ctor(null, { debug: 1 });
      peer = p;
      const failTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          retryJoinConn = null;
          logEv('join-timeout', 'err', false);
          teardown();
          reject(new Error('IQ2.Net: join timeout'));
        }
      }, 15000);
      const settle = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        retryJoinConn = null;
        joining = false;
      };
      const attemptConn = (): void => {
        if (settled) return;
        tryN++;
        let conn: DataConnLike;
        try {
          conn = p.connect('iqvs-' + c, { reliable: true, serialization: 'json' });
        } catch {
          scheduleRetry();
          return;
        }
        hostConn = conn;
        wireConn(conn);
        conn.on('open', () => {
          try {
            conn.send({ t: 'hello', name: clip(displayName), uid });
            logEv('hello', 'out', true);
          } catch {
            logEv('hello', 'out', false);
          }
        });
      };
      const scheduleRetry = (): void => {
        if (settled || tryN >= 3) return; // exhausted -> 15s failTimer rejects
        setTimeout(() => {
          if (!settled) attemptConn();
        }, 600);
      };
      retryJoinConn = scheduleRetry;

      p.on('open', () => attemptConn());
      p.on('error', (err: unknown) => {
        const type = errorType(err);
        logEv(type || 'peer-error', 'err', false);
        if (settled) return;
        if (type === 'peer-unavailable') {
          scheduleRetry(); // host id not up yet / broker flap -> retry
          return;
        }
        settle();
        teardown();
        reject(err instanceof Error ? err : new Error(String(type ?? 'peer-error')));
      });

      // First authoritative lobby snapshot completes the handshake (either
      // transport can deliver it — the bus alone suffices when the broker is
      // unreachable but a same-machine host exists).
      const off = on('lobby', (m) => {
        if (settled) return;
        settle();
        off();
        resolve({ players: (m.players as PlayerRec[]) ?? [] });
      });
    });
  }

  /* ---- messaging ------------------------------------------------------------- */
  function on(type: string, fn: (payload: Frame) => void): () => void {
    if (typeof fn !== 'function') return () => undefined;
    const list = handlers.get(type) ?? [];
    list.push(fn);
    handlers.set(type, list);
    return () => {
      const l = handlers.get(type) ?? [];
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    };
  }

  /** Client→host. On the host this loops back into its own handlers. */
  function send(obj: Frame): void {
    let ok = false;
    try {
      if (role === 'client') {
        obj._sq = sqEp + ':' + ++sqOut; // host dedupes dual-transport copies
        if (hostConn && hostConn.open) {
          hostConn.send(obj);
          ok = true;
        }
        bus?.post(stampNonce(Object.assign({}, obj, { to: 'HOST' })));
        ok = true;
      } else if (role === 'host') {
        emit(obj); // host talks to itself
        ok = true;
      }
    } catch {
      ok = false; // offline solo keeps working
    }
    logEv(obj?.t ?? 'send', 'out', ok);
  }

  /** Host→every client. ALSO fires locally so both sides share one stream. */
  function broadcast(obj: Frame): boolean {
    if (role !== 'host') return false;
    let anyOpen = false;
    try {
      const w = globalThis as { __frames?: Array<{ t: string; dir: string }> };
      const fo = w.__frames || (w.__frames = []); fo.push({ t: obj?.t ?? '?', dir: 'out' }); if (fo.length > 200) fo.shift();
      obj._sq = sqEp + ':' + ++sqOut; // clients dedupe cross-transport copies
      stampNonce(obj);
      for (const c of conns.values()) {
        if (c.open) {
          c.send(obj);
          anyOpen = true;
        }
      }
      bus?.post(obj);
      emit(obj);
      logEv(obj?.t ?? 'broadcast', 'out', anyOpen);
    } catch {
      /* a broken pipe never kills the host */
    }
    return anyOpen;
  }

  function kick(id: string): boolean {
    try {
      if (role !== 'host') return false;
      const conn = conns.get(id);
      if (!conn) return false;
      conns.delete(id);
      players.delete(id);
      try {
        conn.close();
      } catch {
        /* noop */
      }
      emit({ t: 'peer-leave', id });
      void broadcast(lobbyFrame());
      return true;
    } catch {
      return false;
    }
  }
  function leave(): void {
    try {
      teardown();
    } catch {
      /* leave never throws */
    }
  }

  /**
   * SECURITY HELPER — strips anything that reveals the answer from a puzzle
   * payload before it may ever cross the wire (v2 rounds ship {id, seed}
   * only, so this is belt-and-braces for future payload-bearing frames).
   */
  function sanitizeRound(puzzle: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(puzzle)) out[k] = puzzle[k];
    delete out.answer;
    delete out.answerIndex;
    delete out.answerIdx;
    delete out.rule;
    delete out.explanation;
    return out;
  }

  return {
    host,
    join,
    on,
    send,
    broadcast,
    kick,
    leave,
    myUid: () => myUid, // stable uid — scoring keys by this, NEVER by name
    debugLog: () => logRing.slice(),
    sanitizeRound,
  };
}

/** App-wide singleton (production). Tests build isolated createNet() worlds. */
export const Net: NetApi = createNet();
