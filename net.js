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
 *   hello  client→host  {t:'hello', name}
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
    conns: {},                   // host: connId -> DataConnection
    players: {},                 // host: playerId -> {id,name,isHost}
    handlers: {},                // event -> [fn,...]
    dead: false
  };
  /* ---- storage-event transport (same-browser, file://-proof).
   * Frames JSON'd into localStorage key 'iqvs-bus-<code>'; 'storage' events
   * fire in every OTHER tab sharing the origin. */
  var BC_ID_HOST = 'HOST';
  var lsKey = null, lsMyId = null;
  function lsHandler(ev) {
    if (!ev.key || ev.key !== lsKey || !ev.newValue) return;
    var m = null;
    try { m = JSON.parse(ev.newValue); } catch (e) { return; }
    if (!m || m.bc !== 1 || m.src === lsMyId) return;
    if (m.to && m.to !== lsMyId) return;
    if (state.role === 'host' && m.t === 'hello') {
      state.players[m.src] = { id: m.src, name: String(m.name || 'PLAYER').slice(0, 16), isHost: false };
      var lobby = buildLobby(); lobby.src = lsMyId;
      lsSend(lobby);
      emit('peer-join', { id: m.src, name: state.players[m.src].name });
      emit('lobby', lobby);
    } else if (state.role === 'host' && m.t === 'pick') {
      emit('pick', m);
    } else if (state.role === 'client') {
      emit(m.t || '', m);
    }
  }
  function lsSend(frame) {
    try {
      if (!lsKey) return;
      frame.bc = 1; frame.src = lsMyId; frame._n = Date.now() + '' + Math.floor(Math.random() * 1e6);
      root.localStorage.setItem(lsKey, JSON.stringify(frame));
    } catch (e) {}
  }
  function bcSend(frame) { lsSend(frame); }
  /* Poll fallback: some environments (headless, file://) never fire 'storage'
   * across tabs. A 400ms poll of the bus key with nonce-dedup is bulletproof. */
  var lsLastNonce = null, lsPollTimer = null;
  function lsPoll() {
    try {
      if (!lsKey) return;
      var raw = root.localStorage.getItem(lsKey);
      if (!raw || raw === lsLastNonce) { /* nonce lives inside; compare below */ }
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

  function sanitizeCode(raw) {
    var c = String(raw == null ? '' : raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return c.slice(0, 12);
  }

  function wire(conn) {
    conn.on('data', function (data) {
      try { onData(conn, data); }
      catch (e) {
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

    if (state.role === 'host') {
      if (msg.t === 'hello') {
        // register the freshly-helloed client, then push the lobby everywhere
        var pid = conn.peer;
        state.players[pid] = { id: pid, name: String(msg.name || 'PLAYER').slice(0, 16), isHost: false };
        state.conns[pid] = conn;
        emit('peer-join', { id: pid, name: state.players[pid].name });
        var lobby = buildLobby();
        broadcast(lobby);
        emit('lobby', lobby);
      } else if (msg.t === 'chat') {
        // relay chat with attribution; never trust claimed identity fields
        var p = state.players[conn.peer];
        broadcast({ t: 'chat', id: conn.peer, name: p ? p.name : '???', text: String(msg.text || '').slice(0, 200) });
      } else {
        // 'pick' etc: hand to host game logic untouched — host is the authority
        emit(msg.t, msg);
      }
    } else if (state.role === 'client') {
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
  function onConnGone(conn) {
    if (state.role === 'host') {
      var pid = conn.peer;
      if (!state.players[pid]) return;
      delete state.conns[pid];
      var gone = state.players[pid];
      delete state.players[pid];
      emit('peer-leave', gone);
      var lobby = buildLobby();
      broadcast(lobby);
      emit('lobby', lobby);
    } else if (state.role === 'client' && !state.dead) {
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
          state.code = base + (attempt > 1 ? String(attempt) : '');
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
          if ((type === 'unavailable-id' || type === 'invalid-id') && attempt < MAX_ID_RETRIES) {
            try { peer.destroy(); } catch (e) {}
            tryOpen(); // id taken -> next suffix
          } else if (!peer.open) {
            state.role = null;
            reject(err instanceof Error ? err : new Error(String(type || 'peer-error')));
          } else {
            emit('end', { reason: 'net-error', detail: type }); // mid-session broker hiccup
          }
        });
      }
      tryOpen();
    });
  };

  /* Join a hosted room. Resolves with the first lobby snapshot. */
  Net.join = function (roomCode, displayName) {
    return new Promise(function (resolve, reject) {
      if (!Net.available()) { reject(new Error('IQ.Net: PeerJS unavailable')); return; }
      var code = sanitizeCode(roomCode);
      if (!ID_CHARS.test(code)) { reject(new Error('IQ.Net: room code must be 3-12 letters/digits')); return; }
      teardown();

      state.role = 'client';
      state.code = code;
      state.dead = false;
      var myBcId = 'C' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
      if (bcOpen(code, myBcId)) bcSend({ t: 'hello', to: BC_ID_HOST, name: displayName });
      var settled = false;

      var peer = new root.Peer(null, { debug: 1 });
      var failTimer = setTimeout(function () {
        if (!settled) { settled = true; teardown(); reject(new Error('IQ.Net: join timeout')); }
      }, 15000);

      peer.on('open', function () {
        var conn = peer.connect('iqvs-' + code, { reliable: true, serialization: 'json' });
        state.hostConn = conn;
        wire(conn);
        conn.on('open', function () {
          try { conn.send({ t: 'hello', name: String(displayName || 'PLAYER').slice(0, 16) }); } catch (e) {}
        });
      });

      peer.on('error', function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        teardown();
        reject(err instanceof Error ? err : new Error(String((err && err.type) || 'peer-error')));
      });

      // first authoritative lobby snapshot completes the handshake
      var off = Net.on('lobby', function (msg) {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
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
    try {
      if (state.role === 'client' && state.hostConn && state.hostConn.open) {
        state.hostConn.send(obj);
      }
      if (state.role === 'client') {
        bcSend(Object.assign({}, obj, { to: BC_ID_HOST }));
      } else if (state.role === 'host') {
        emit((obj && obj.t) || '', obj || {}); // host talks to itself
      }
    } catch (e) { /* offline solo mode keeps working */ }
  };

  /* Host→every client. ALSO fires locally on the host so both sides see the
   * same event stream. No-throw when offline. */
  Net.broadcast = function (obj) {
    try {
      if (state.role === 'host') {
        var anyOpen = false, k;
        for (k in state.conns) {
          if (Object.prototype.hasOwnProperty.call(state.conns, k)) {
            var c = state.conns[k];
            if (c.open) { c.send(obj); anyOpen = true; }
          }
        }
        bcSend(obj);
        emit((obj && obj.t) || '', obj || {});
        return anyOpen;
      }
    } catch (e) { /* keep the host alive even if a pipe is broken */ }
    return false;
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
    state.dead = true;
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
