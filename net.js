/* ============================================================================
 * IQ.Net — real multiplayer for IQ BATTLE (GitHub Pages, PeerJS).
 *
 * TOPOLOGY: star, HOST-AUTHORITATIVE. Clients only ever talk to the host;
 * the host validates every action, owns the score table, and relays state.
 * Requires PeerJS loaded BEFORE this file:
 *   <script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>
 *
 * ██████  S E C U R I T Y   W A R N I N G  —  R E A D   T H I S  ██████
 * █                                                                   █
 * █  THE ROUND PAYLOAD MUST NEVER CONTAIN THE ANSWER ON THE CLIENT.   █
 * █  The original iqversus.com is server-authoritative: the server     █
 * █  knows which option is correct and NEVER tells the browser during  █
 * █  play (only at reveal). We have no server on GitHub Pages, so the  █
 * █  HOST is the authority. That means ANY code that builds the        █
 * █  outbound 'round' message MUST pass the puzzle object through      █
 * █  IQ.Net.sanitizeRound(puzzle) first, which strips `answer`,        █
 * █  `rule`, and any other solution fields. If you ship answerIndex    █
 * █  inside the round payload, every client can read the correct       █
 * █  answer from the devtools network tab / JS console. LOUDLY:        █
 * █                                                                    █
 * █      IQ.Net.broadcast({ t:'round', ...IQ.Net.sanitizeRound(pz) });  █
 * █                                                                    █
 * █  Never: broadcast({t:'round', ...pz})  // LEAKS THE ANSWER          █
 * ███████████████████████████████████████████████████████████████████████
 *
 * Protocol: plain JSON frames `{ t:'lobby'|'round'|'pick'|'reveal'|'scores'
 * |'end'|'chat', ... }`.
 *   hello  client→host  {t:'hello', name, uid}  (uid = ONE stable id shared
 *                       by BOTH transports so the host never double-registers)
 *   lobby  host→all     {t:'lobby', players:[{id,name,isHost}], cfg}
 *   round  host→all     {t:'round', ...sanitized puzzle}  (NO answer!)
 *   pick   client→host  {t:'pick', qid, idx}  (host scores authoritatively)
 *   reveal host→all     {t:'reveal', answer, perPlayer}
 *   scores host→all     {t:'scores', arr}
 *   end    host→all     {t:'end', ...} ; clients also get {reason:'host-left'}
 *   chat   both ways    host relays {t:'chat', id, name, text} to everyone
 *
 * API (window.IQ.Net):
 *   .available                 -> true iff window.Peer exists
 *   .host(code, name)          -> Promise<{code}>  (retries id with suffix)
 *   .join(code, name)          -> Promise<{players:[{id,name,isHost}]}>
 *   .on(type, fn)              -> subscribe; fn(payloadObject); returns unsubscribe
 *                                  events: lobby round reveal scores end
 *                                          peer-join peer-leave
 *   .send(obj)                 -> client→host frame; on the host this loops
 *                                 back into the host's own handlers
 *   .broadcast(obj)            -> host→all clients AND fires locally on host
 *   .kick(id) .leave()         -> teardown helpers; all no-throw offline
 *   .debugLog()                -> last 20 net events [{t,dir,ts,ok}] (debug ring)
 * ==========================================================================*/
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  var MAX_ID_RETRIES = 8;        // iqvs-CODE, iqvs-CODE2, ... before giving up
  var ID_CHARS = /^[A-Z0-9]{3,12}$/;

  // ---- session state -------------------------------------------------------
  var state = {
    role: null,                  // 'host' | 'client' | null
    code: null,                  // actual room code we ended up hosting/joining
    peerId: null,                // remote peer id we connected to (client)
    peer: null,                  // our own Peer instance
    hostConn: null,              // client: the single DataConnection to host
    conns: {},                   // host: playerKey -> DataConnection
    players: {},                 // host: playerKey -> {id,name,isHost}
    handlers: {},                // event -> [fn,...]
   joining: false,              // client: handshake in flight (enables join retry)
   dead: false,
   seen: {},                    // bus poll/event dedup of recent frame nonces
   myUid: null,                 // THIS side's stable uid ('HOST' for host, C<ts><rand> for client)
   sqOut: 0,                    // host broadcast sequence — clients drop already-seen seqs
   sqSeen: {}                   // client-side dedupe of _sq across BOTH transports
  };

  // ---- tiny debug ring: last 20 net events, exposed via Net.debugLog() ------
  var LOG_CAP = 20;
  var logRing = [];
  function logEv(t, dir, ok) {
    try {
      logRing.push({ t: String(t == null ? '' : t), dir: dir, ts: Date.now(), ok: !!ok });
      if (logRing.length > LOG_CAP) logRing.splice(0, logRing.length - LOG_CAP);
    } catch (e) {}
  }
  /* ---- storage-event transport (same-browser, file://-proof).
   * Frames JSON'd into localStorage key 'iqvs-bus-<code>'; 'storage' events
   * fire in every OTHER tab sharing the origin. */
  var BC_ID_HOST = 'HOST';
  var lsKey = null, lsMyId = null;
  function lsHandler(ev) {
    if (!ev.key || ev.key !== lsKey || !ev.newValue) return;
    var m = null;
    try { m = JSON.parse(ev.newValue); } catch (e) { return; }
    if (m && m._n) { if (state.seen[m._n]) return; state.seen[m._n] = 1; var kn = Object.keys(state.seen); if (kn.length > 60) delete state.seen[kn[0]]; }
    if (!m || m.bc !== 1 || m.src === lsMyId) return;
    if (m.to && m.to !== lsMyId) return;
    if (state.role === 'host' && m.t === 'hello') {
      logEv('hello', 'in', true);
      var isNew = !Object.prototype.hasOwnProperty.call(state.players, m.src);
      state.players[m.src] = { id: m.src, name: String(m.name || 'PLAYER').slice(0, 16), isHost: false };
      var lobby = buildLobby(); lobby.src = lsMyId;
      lsSend(lobby);
      if (isNew) emit('peer-join', { id: m.src, name: state.players[m.src].name });
      emit('lobby', lobby); // host's OWN handlers must see the roster too
    } else if (state.role === 'host' && m.t === 'pick') {
      // bus frames already carry src=uid; normalize so the host game logic
      // sees the SAME {uid} field shape the PeerJS transport delivers
      if (!m.uid) m.uid = m.src;
      emit('pick', m);
    } else if (state.role === 'host' && m.t && m.t !== 'hello' && m.t !== 'lobby') {
      // attacks, sr verdicts, etc: same default-emit contract as the PeerJS
      // onData host branch — the bus is a full transport, not hello/pick only
      if (m._sq != null && seenSq(m._sq)) return;
      if (!m.uid) m.uid = m.src;
      emit(m.t, m);
    } else if (state.role === 'client') {
      if (m._sq != null && seenSq(m._sq)) return;
      logEv(m.t || '', 'in', true);
      emit(m.t || '', m);
    }
  }
  function lsSend(frame) {
    try {
      if (!lsKey) return;
      frame.bc = 1; frame.src = lsMyId; frame._n = Date.now() + '' + Math.floor(Math.random() * 1e6);
      var raw = JSON.stringify(frame);
      root.localStorage.setItem(lsKey, raw);
      /* Outbox ring: the single bus key is overwritten by burst writes
       * (reveal+round back-to-back). Poll-only tabs drain THIS queue so
       * no frame is lost between 400ms ticks. */
      try {
        var obk = lsKey + '-ob', box = null;
        try { box = JSON.parse(root.localStorage.getItem(obk)); } catch (e) {}
        if (!Array.isArray(box)) box = [];
        box.push({ n: frame._n, v: raw });
        if (box.length > 12) box.splice(0, box.length - 12);
        root.localStorage.setItem(obk, JSON.stringify(box));
      } catch (e) {}
    } catch (e) {}
  }
  function bcSend(frame) { lsSend(frame); }
  /* Poll fallback: some environments (headless, file://) never fire 'storage'
   * across tabs. A 400ms poll of the bus key with nonce-dedup is bulletproof. */
  var lsLastNonce = null, lsPollTimer = null;
  function lsPoll() {
    try {
      if (!lsKey) return;
      var obk = lsKey + '-ob', box = null;
      try { box = JSON.parse(root.localStorage.getItem(obk)); } catch (e) {}
      if (Array.isArray(box) && box.length) {
        var keep = [];
        for (var i = 0; i < box.length; i++) {
          var e2 = box[i];
          if (!e2 || !e2.n || state.seen[e2.n]) continue;
          try { lsHandler({ key: lsKey, newValue: e2.v }); } catch (e3) {}
          if (!state.seen[e2.n]) keep.push(e2);
        }
        try { root.localStorage.setItem(obk, JSON.stringify(keep.slice(-12))); } catch (e5) {}
      }
      var raw = root.localStorage.getItem(lsKey);
      var m = null;
      try { m = JSON.parse(raw); } catch (e) { return; }
      if (!m || !m._n || m._n === lsLastNonce) return;
      lsLastNonce = m._n;
      try { lsHandler({ key: lsKey, newValue: raw }); }
      catch (e) { try { root.localStorage.setItem('iqvs-neterr', String((e && e.message) || e) + ' :: ' + String((e && e.stack) || '').slice(0, 400)); } catch (_e) {} }
    } catch (e) {}
  }
  function startPoll() { if (!lsPollTimer) lsPollTimer = setInterval(lsPoll, 400); }
  function stopPoll() { if (lsPollTimer) { clearInterval(lsPollTimer); lsPollTimer = null; } }
  function bcOpen(code, myId) {
    if (typeof root.localStorage === 'undefined' || typeof root.addEventListener === 'undefined') return false;
    bcClose();
    try {
      lsKey = 'iqvs-bus-' + code;
      lsMyId = myId;
      root.addEventListener('storage', lsHandler);
      startPoll();
      return true;
    } catch (e) { lsKey = null; return false; }
  }
  function bcClose() {
    try { root.removeEventListener('storage', lsHandler); } catch (e) {}
    try { root.localStorage.removeItem('iqvs-bus-' + state.code); } catch (e) {}
    try { if (lsKey) root.localStorage.removeItem(lsKey + '-ob'); } catch (e) {}
    lsKey = null; stopPoll();
  }


  // ---- tiny event bus (all callbacks no-throw) ------------------------------
  function emit(type, payload) {
    var list = state.handlers[type];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](payload || {}); }
      catch (e) { /* a broken UI callback must never kill the session */ }
    }
  }
  /* Cross-transport dedupe: clients receive every host frame on BOTH the
   * PeerJS conn and the storage bus. Host stamps _sq in Net.broadcast;
   * whichever copy arrives first wins, the duplicate is dropped. */
  function seenSq(n) {
    if (n == null) return false;
    if (state.sqSeen[n]) return true;
    state.sqSeen[n] = 1;
    var k = Object.keys(state.sqSeen);
    if (k.length > 120) delete state.sqSeen[k[0]];
    return false;
  }

  function sanitizeCode(raw) {
    var c = String(raw == null ? '' : raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return c.slice(0, 12);
  }

  function wire(conn) {
    conn.on('data', function (data) {
      try { onData(conn, data); }
      catch (e) {
        logEv('handler-error', 'err', false);
        try { root.console.error('IQ.Net onData throw:', (e && e.stack) || e); } catch (_e) {}
        emit('net-error', { message: String((e && e.message) || e), stack: String((e && e.stack) || '') });
      }
    });
    conn.on('close', function () { onConnGone(conn); });
    conn.on('error', function () { onConnGone(conn); });
  }

  function onData(conn, data) {
    if (!data || typeof data !== 'object') return;
    var msg = data;
    try {
      if (typeof data === 'string') msg = JSON.parse(data);
    } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;

    logEv(msg.t, 'in', true);
    if (state.role === 'host') {
      if (msg.t === 'hello') {
        // register the client under ONE stable uid (both transports use the
        // same uid), closing/replacing any earlier conn registered for it —
        // this is what stops BC+PeerJS double-hello from doubling players.
        var pid = String(msg.uid || conn.peer);
        // if this physical conn was previously registered under another
        // key, retire the stale entry so it can't linger as a ghost
        for (var pk in state.conns) {
          if (Object.prototype.hasOwnProperty.call(state.conns, pk) && state.conns[pk] === conn && pk !== pid) {
            delete state.conns[pk];
            delete state.players[pk];
          }
        }
        var prev = state.conns[pid];
        if (prev && prev !== conn) { try { prev.close(); } catch (e) {} }
        var isNew = !Object.prototype.hasOwnProperty.call(state.players, pid);
        state.players[pid] = { id: pid, name: String(msg.name || 'PLAYER').slice(0, 16), isHost: false };
        state.conns[pid] = conn;
        if (isNew) emit('peer-join', { id: pid, name: state.players[pid].name });
        var lobby = buildLobby();
        broadcast(lobby);
        emit('lobby', lobby);
      } else if (msg.t === 'chat') {
        // relay chat with attribution; never trust claimed identity fields
        var pkey = connKey(conn);
        var p = pkey ? state.players[pkey] : null;
        broadcast({ t: 'chat', id: pkey || conn.peer, name: p ? p.name : '???', text: String(msg.text || '').slice(0, 200) });
      } else {
        // 'pick' etc: hand to host game logic untouched — host is the authority.
        // Stamp the sender's stable uid (conn key) so scoring keys by uid,
        // never by display name (same-name tabs must stay distinct).
        if (!msg.uid) msg.uid = connKey(conn) || conn.peer;
        if (msg._sq != null && seenSq(msg._sq)) return; // dual-transport duplicate
        emit(msg.t, msg);
      }
    } else if (state.role === 'client') {
      if (msg._sq != null && seenSq(msg._sq)) return;
      if (msg.t === 'end' && !state.dead) {
        // host explicitly ended; fallthrough emit below still fires
      }
      emit(msg.t, msg);
    }
  }

  function buildLobby() {
    var arr = [], k;
    for (k in state.players) if (Object.prototype.hasOwnProperty.call(state.players, k)) arr.push(state.players[k]);
    return { t: 'lobby', players: arr };
  }

  // host: a client vanished. client: the host vanished -> session over.
  // Conns are keyed by stable uid (not conn.peer), so find the key by identity.
  function connKey(conn) {
    for (var k in state.conns) {
      if (Object.prototype.hasOwnProperty.call(state.conns, k) && state.conns[k] === conn) return k;
    }
    return null;
  }
  function onConnGone(conn) {
    if (state.role === 'host') {
      var pid = connKey(conn);
      if (!pid || !state.players[pid]) return;
      if (state.conns[pid] !== conn) return; // superseded by a replacement hello
      delete state.conns[pid];
      var gone = state.players[pid];
      delete state.players[pid];
      emit('peer-leave', gone);
      var lobby = buildLobby();
      broadcast(lobby);
      emit('lobby', lobby);
    } else if (state.role === 'client' && !state.dead) {
      if (state.joining && retryJoinConn) { retryJoinConn(); return; } // broker flap -> retry
      endSession();
      emit('end', { reason: 'host-left' });
    }
  }

  function endSession() {
    state.dead = true;
    if (state.hostConn) { try { state.hostConn.close(); } catch (e) {} state.hostConn = null; }
  }

  // ---- public API -----------------------------------------------------------
  var Net = {};

  Net.available = function () {
    return typeof root.Peer === 'function';
  };

  /* Host a room. Resolves {code} once our Peer id is live. If `iqvs-CODE`
   * is taken on the broker we retry with numeric suffixes (CODE2, CODE3...). */
  Net.host = function (roomCode, displayName) {
    return new Promise(function (resolve, reject) {
      if (!Net.available()) { reject(new Error('IQ.Net: PeerJS unavailable')); return; }
      var base = sanitizeCode(roomCode);
      if (!ID_CHARS.test(base)) { reject(new Error('IQ.Net: room code must be 3-12 letters/digits')); return; }
      teardown();

      var attempt = 0;
      state.myUid = BC_ID_HOST; // host's own stable uid (bus frames use it too)
      state.role = 'host';
      state.code = base;
      state.players = {};
      state.conns = {};
      state.dead = false;
      bcOpen(base, BC_ID_HOST);

      function tryOpen() {
        attempt++;
        var id = 'iqvs-' + base + (attempt > 1 ? String(attempt) : '');
        var peer = new root.Peer(id, { debug: 1 });
        state.peer = peer;
        peer.on('open', function () {
          var finalCode = base + (attempt > 1 ? String(attempt) : '');
          // Ghost-code guard: if we fell back to a suffixed id, rebind the
          // storage bus to the REAL room code so joiners find us, and resolve
          // with the code index.html will actually display.
          if (finalCode !== base) bcOpen(finalCode, BC_ID_HOST);
          state.code = finalCode;
          state.players[peer.id] = { id: peer.id, name: String(displayName || 'HOST').slice(0, 16), isHost: true };
          peer.on('connection', function (conn) {
            wire(conn);
          });
          peer.on('disconnected', function () {
            try { peer.reconnect(); } catch (e) {}
          });
          peer.on('close', function () { if (!state.dead) { state.role = null; } });
          resolve({ code: state.code });
        });
        peer.on('error', function (err) {
          var type = err && err.type;
          logEv(type || 'peer-error', 'err', false);
          if ((type === 'unavailable-id' || type === 'invalid-id') && attempt < MAX_ID_RETRIES) {
            try { peer.destroy(); } catch (e) {}
            tryOpen(); // id taken -> next suffix
          } else if (!peer.open) {
            state.role = null; bcClose();
            reject(err instanceof Error ? err : new Error(String(type || 'peer-error')));
          } else {
            emit('end', { reason: 'net-error', detail: type }); // mid-session broker hiccup
          }
        });
      }
      tryOpen();
    });
  };

  // Set during join(): onConnGone calls it to retry the host connection
  // while the handshake is still in flight (broker flaps).
  var retryJoinConn = null;
  /* Join a hosted room. Resolves with the first lobby snapshot.
   * ONE stable uid is generated here and sent in BOTH hello frames (storage
   * bus + PeerJS), so the host registers this human exactly once even when
   * both transports connect. The peer connect retries twice (600ms apart)
   * before the 15s timeout rejects — brokers flap. */
  Net.join = function (roomCode, displayName) {
    return new Promise(function (resolve, reject) {
      if (!Net.available()) { reject(new Error('IQ.Net: PeerJS unavailable')); return; }
      var code = sanitizeCode(roomCode);
      if (!ID_CHARS.test(code)) { reject(new Error('IQ.Net: room code must be 3-12 letters/digits')); return; }
      teardown();

      state.role = 'client';
      state.code = code;
      state.dead = false;
      state.joining = true;
      var myUid = 'C' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
      state.myUid = myUid; // ONE stable uid shared by both transports
      if (bcOpen(code, myUid)) {
        bcSend({ t: 'hello', to: BC_ID_HOST, name: String(displayName || 'PLAYER').slice(0, 16), uid: myUid });
        logEv('hello', 'out', true);
      }
      var settled = false;

      var peer = new root.Peer(null, { debug: 1 });
      var failTimer = setTimeout(function () {
        if (!settled) {
          settled = true;
          retryJoinConn = null;
          logEv('join-timeout', 'err', false);
          teardown();
          reject(new Error('IQ.Net: join timeout'));
        }
      }, 15000);

      function settle() {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        retryJoinConn = null;
        state.joining = false;
      }

      var tryN = 0;
      function attemptConn() {
        if (settled) return;
        tryN++;
        var conn;
        try {
          conn = peer.connect('iqvs-' + code, { reliable: true, serialization: 'json' });
        } catch (e) { scheduleRetry(); return; }
        state.hostConn = conn;
        wire(conn);
        conn.on('open', function () {
          var ok = false;
          try { conn.send({ t: 'hello', name: String(displayName || 'PLAYER').slice(0, 16), uid: myUid }); ok = true; } catch (e) {}
          logEv('hello', 'out', ok);
        });
      }
      function scheduleRetry() {
        if (settled || tryN >= 3) return; // exhausted -> 15s failTimer rejects
        setTimeout(function () { if (!settled) attemptConn(); }, 600);
      }
      retryJoinConn = scheduleRetry;

      peer.on('open', attemptConn);

      peer.on('error', function (err) {
        var type = err && err.type;
        logEv(type || 'peer-error', 'err', false);
        if (settled) return;
        // host peer id not up yet / broker flap -> retry instead of failing
        if (type === 'peer-unavailable') { scheduleRetry(); return; }
        settle();
        teardown();
        reject(err instanceof Error ? err : new Error(String(type || 'peer-error')));
      });

      // first authoritative lobby snapshot completes the handshake
      var off = Net.on('lobby', function (msg) {
        if (settled) return;
        settle();
        off();
        resolve({ players: msg.players || [] });
      });
    });
  };

  Net.on = function (msgType, handler) {
    if (typeof handler !== 'function') return function () {};
    (state.handlers[msgType] = state.handlers[msgType] || []).push(handler);
    var self = this;
    return function () {
      var list = state.handlers[msgType] || [];
      var i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
    };
  };

  /* Client→host delivery. On the host this loops back into its own handlers,
   * so one game-code path works for both roles. No-throw when offline. */
  Net.send = function (obj) {
    var ok = false;
    try {
      if (state.role === 'client') obj._sq = (state.myUid || 'C') + ':' + (++state.sqOut); // host dedupes dual-transport copies
      if (state.role === 'client' && state.hostConn && state.hostConn.open) {
        state.hostConn.send(obj);
        ok = true;
      }
      if (state.role === 'client') {
        bcSend(Object.assign({}, obj, { to: BC_ID_HOST }));
        ok = true;
      } else if (state.role === 'host') {
        emit((obj && obj.t) || '', obj || {}); // host talks to itself
        ok = true;
      }
    } catch (e) { /* offline solo mode keeps working */ ok = false; }
    logEv((obj && obj.t) || 'send', 'out', ok);
  };

  /* Host→every client. ALSO fires locally on the host so both sides see the
   * same event stream. No-throw when offline. */
  Net.broadcast = function (obj) {
    try {
      if (state.role === 'host') {
        obj._sq = 'HOST:' + (++state.sqOut); // clients dedupe cross-transport copies by this
        var anyOpen = false, k;
        for (k in state.conns) {
          if (Object.prototype.hasOwnProperty.call(state.conns, k)) {
            var c = state.conns[k];
            if (c.open) { c.send(obj); anyOpen = true; }
          }
        }
        bcSend(obj);
        emit((obj && obj.t) || '', obj || {});
        logEv((obj && obj.t) || 'broadcast', 'out', anyOpen);
        return anyOpen;
      }
    } catch (e) { /* keep the host alive even if a pipe is broken */ }
    return false;
  };

  /* Last 20 net events ({t, dir:'in'|'out'|'err', ts, ok}) for debugging
   * silent transport failures. Copy — safe to mutate. */
  // internal alias used by onData/onConnGone
  var broadcast = Net.broadcast;
  Net.debugLog = function () {
    try { return logRing.slice(); } catch (e) { return []; }
  };

  /* THIS side's stable uid — 'HOST' when hosting, C<ts><rand> when joining.
   * Game code must key players/scoring by this, NEVER by display name
   * (two tabs on the same profile share a name but never a uid). */
  Net.myUid = function () {
    return state.myUid || null;
  };

  Net.kick = function (id) {
    try {
      if (state.role !== 'host') return false;
      var conn = state.conns[id];
      if (!conn) return false;
      delete state.conns[id];
      delete state.players[id];
      try { conn.close(); } catch (e) {}
      emit('peer-leave', { id: id });
      var lobby = buildLobby();
      Net.broadcast(lobby);
      emit('lobby', lobby);
      return true;
    } catch (e) { return false; }
  };

  Net.leave = function () {
    try { teardown(); } catch (e) {}
  };

  /* SECURITY HELPER — see the loud warning above.
   * Returns a copy of a puzzle WITHOUT anything that reveals the answer:
   * strips `answer`, `answerIndex`, `rule`, `explanation`. */
  Net.sanitizeRound = function (puzzle) {
    var out = {}, k;
    for (k in puzzle) {
      if (Object.prototype.hasOwnProperty.call(puzzle, k)) out[k] = puzzle[k];
    }
    delete out.answer;
    delete out.answerIndex;
    delete out.answerIdx;
    delete out.rule;
    delete out.explanation;
    return out;
  };

  function teardown() {
    retryJoinConn = null;
    state.dead = true;
    state.joining = false;
    var k;
    for (k in state.conns) {
      if (Object.prototype.hasOwnProperty.call(state.conns, k)) {
        try { state.conns[k].close(); } catch (e) {}
      }
    }
    state.conns = {};
    if (state.hostConn) { try { state.hostConn.close(); } catch (e) {} state.hostConn = null; }
    if (state.peer) { try { state.peer.destroy(); } catch (e) {} state.peer = null; }
    state.role = null;
    state.players = {};
    state.handlers = {};
    bcClose();
    state.code = null;
  }

  root.IQ.Net = Net;

  // Node guard: allow require('./net.js') smoke checks without a DOM.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Net;
  }
})();
