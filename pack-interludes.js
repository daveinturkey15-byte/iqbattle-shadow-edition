/* ============================================================================
 * pack-interludes.js — Between-round interlude takeovers (remake-wave army)
 *
 * Spec-line → mechanic map (Dave's brief):
 *  [1] SLIME GUN GALLERY ......... world 'arcade-gallery' onInterlude: 5
 *      drifting targets (pointer-events:auto panel re-enabled over the
 *      engine's none-rail), click/tap to shoot; hits bank slime tokens in
 *      IQ.Hooks.state; each token = scoreMul +0.1 next round, capped +0.5.
 *      IQB_MOTION off → static row of 3 targets. Misses cost nothing.
 *  [2] FRUIT MACHINE ('essence', no money metaphor) .. world 'luck-den'
 *      onInterlude: 3 reels (CSS spin, motion-gated); STOP once per reel;
 *      final symbols come from ctx.rng (seeded → host/client agree).
 *      Pair = blessing (seeded pool: scoreMul 1.25 OR hpDelta +10);
 *      triple = jackpot hpDelta +25. Applied next round via onRoundStart.
 *  [3] SNIPER SCOPE PUZZLE ....... world 'scope-range' onInterlude: briefing
 *      card arms a scope fog for the NEXT puzzle: self-mounted pointer-
 *      events:none layer (masked dim+blur, scope ring follows the pointer,
 *      true tiles visible only inside the circle). Answering without ever
 *      scoping is allowed but risky: onPreAnswer adds scoreMul 0.8.
 *  [4] COLLECTIBLES BANK ......... onAnswer (correct only): occasional
 *      pickup spawn — rings in worlds tagged 'arcade', coins in gold/
 *      fortune worlds, bananas in jungle worlds (rng pick otherwise);
 *      banked in IQ.Hooks.state; every 10th auto-cashout: +20 score
 *      (pickup coin value 20) & tiny heal +5.
 *
 * Acceptance: overlays escapable (✕ button + Esc), hard auto-finish ≤11s
 * (< 12s), zero engine-file edits, node --check clean, deterministic rng
 * from ctx only, nothing here can end a run (positive hp only).
 * ============================================================================*/
(function () {
'use strict';
var root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

/* ---------- helpers ---------- */

function motionOK() {
  try {
    var v = root.localStorage && root.localStorage.getItem('IQB_MOTION');
    return v == null ? true : JSON.parse(v) !== false;
  } catch (e) { return true; }
}
function muted() {
  try {
    var v = root.localStorage && root.localStorage.getItem('IQB_MUTED');
    return v != null && JSON.parse(v) === true;
  } catch (e) { return false; }
}

/* ---------- injected CSS ---------- */
var styleDone = false;
function ensureStyle() {
  if (styleDone || typeof document === 'undefined') return;
  styleDone = true;
  var st = document.createElement('style');
  st.id = 'iqb-interludes-style';
  st.textContent =
    '@keyframes pxD{0%{left:-14%}100%{left:104%}}' +
    '@keyframes pxW{0%,100%{transform:translateY(0)}50%{transform:translateY(-16px)}}' +
    '@keyframes pxSpin{0%{transform:translateY(0)}100%{transform:translateY(-50%)}}' +
    '@keyframes pxFade{0%{opacity:0;transform:scale(.92)}100%{opacity:1;transform:scale(1)}}' +
    '.iqb-int{position:fixed;inset:0;z-index:75;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:10px;font-family:inherit;' +
    'background:rgba(4,6,12,.86);color:#eee;animation:pxFade .22s ease-out 1}' +
    '.iqb-int-title{font-weight:900;letter-spacing:.28em;font-size:clamp(16px,3vw,26px)}' +
    '.iqb-int-sub{opacity:.75;font-size:13px;text-align:center;max-width:min(560px,88vw)}' +
    '.iqb-int-x{position:absolute;top:10px;right:12px;z-index:5;width:34px;height:34px;' +
    'border-radius:50%;border:1px solid #888;background:#16181f;color:#ddd;' +
    'font-size:15px;cursor:pointer;line-height:1}' +
    '.iqb-int-x:hover{border-color:#fff;color:#fff}' +
    '.iqb-field{position:relative;width:min(760px,92vw);height:min(46vh,380px);' +
    'overflow:hidden;border:1px solid #333;border-radius:14px;background:#0a0d14}' +
    '.iqb-slime{position:absolute;top:18%;width:64px;height:64px;border-radius:50% 50% 46% 46%;' +
    'border:0;padding:0;cursor:crosshair;font-size:26px;line-height:64px;text-align:center;' +
    'background:radial-gradient(circle at 32% 28%,#b6ff7a,#3fae2a 62%,#1d6b17);' +
    'box-shadow:0 0 18px rgba(96,240,80,.45)}' +
    '.iqb-slime.splat{background:radial-gradient(circle at 50% 50%,#2c5,#14501a);' +
    'cursor:default;transform:scale(1.15)}' +
    '.iqb-reels{display:flex;gap:14px;padding:16px 22px;border:2px solid #6b4a1f;border-radius:16px;' +
    'background:linear-gradient(#241105,#3a1c08)}' +
    '.iqb-reel{width:84px;height:96px;border-radius:10px;overflow:hidden;background:#0d0602;' +
    'border:1px solid #7a5a26;display:flex;align-items:center;justify-content:center;' +
    'font-size:44px;color:#ffd75e;text-shadow:0 0 12px rgba(255,200,60,.6)}' +
    '.iqb-strip{display:flex;flex-direction:column;gap:8px;will-change:transform}' +
    '.iqb-strip.spin{animation:pxSpin .5s linear infinite}' +
    '.iqb-hud{font-size:14px;letter-spacing:.14em;opacity:.9}' +
    '#iqb-scope-layer{position:fixed;inset:0;z-index:58;pointer-events:none}' +
    '.iqb-scope-dim{position:fixed;inset:0;background:rgba(3,7,10,.74);' +
    '-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);' +
    '-webkit-mask-image:radial-gradient(circle 150px at var(--sx,50%) var(--sy,50%),transparent 0 96px,black 150px);' +
    'mask-image:radial-gradient(circle 150px at var(--sx,50%) var(--sy,50%),transparent 0 96px,black 150px)}' +
    '.iqb-scope-ring{position:fixed;left:0;top:0;width:220px;height:220px;margin:-110px 0 0 -110px;' +
    'border:2px solid rgba(127,255,159,.85);border-radius:50%;' +
    'box-shadow:0 0 22px rgba(127,255,159,.25),inset 0 0 30px rgba(127,255,159,.12)}' +
    '.iqb-scope-ring i{position:absolute;background:rgba(127,255,159,.7)}' +
    '.iqb-scope-ring i:nth-child(1){left:50%;top:6%;width:1px;height:88%}' +
    '.iqb-scope-ring i:nth-child(2){top:50%;left:6%;height:1px;width:88%}' +
    '.iqb-scope-ring b{position:absolute;left:50%;top:50%;width:5px;height:5px;margin:-2px 0 0 -2px;' +
    'border-radius:50%;background:rgba(127,255,159,.95)}' +
    '.iqb-scope-x{position:fixed;top:10px;right:12px;z-index:59;pointer-events:auto;' +
    'padding:6px 10px;border-radius:999px;border:1px solid #4f8;font-size:12px;' +
    'background:rgba(6,16,10,.8);color:#bfe;font-family:inherit}';
  var head = document.head || document.getElementsByTagName('head')[0];
  head.appendChild(st);
}

/* ---------- WebAudio (best-effort, IQB_MUTED respected) ---------- */
var actx = null;
function tone(freq, dur, type, gain, delay) {
  if (muted()) return;
  try {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    if (!actx) actx = new AC();
    if (actx.state === 'suspended' && actx.resume) actx.resume();
    var t0 = actx.currentTime + (delay || 0);
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.06, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  } catch (e) { /* audio is best-effort */ }
}
var SFX = {
  shot:   function () { tone(720, 0.09, 'square', 0.05); },
  splat:  function () { tone(140, 0.18, 'sawtooth', 0.07); },
  stop:   function () { tone(340, 0.08, 'triangle', 0.06); },
  win:    function () { tone(392, 0.12); tone(494, 0.12, 'sine', 0.06, 0.12); tone(659, 0.2, 'sine', 0.07, 0.24); },
  jackpot:function () { tone(523, 0.1); tone(659, 0.1, 'sine', 0.06, 0.1); tone(784, 0.1, 'sine', 0.06, 0.2); tone(1047, 0.28, 'sine', 0.08, 0.3); },
  cash:   function () { tone(880, 0.09); tone(1175, 0.16, 'sine', 0.06, 0.09); },
  close:  function () { tone(260, 0.07, 'triangle', 0.04); }
};

/* ---------- per-match state (prefixed, wiped at beginRun) ---------- */
var P = 'pack-interludes:';
function st(k, v) {
  var H = root.IQ.Hooks;
  if (!H || !H.state) return undefined;
  return v === undefined ? H.state.get(P + k) : H.state.set(P + k, v);
}
function stDel(k) { try { root.IQ.Hooks.state.del(P + k); } catch (e) {} }

/* latest interlude ctx (for round math when banking next-round pendings) */
var lastCtx = null;
function nextRoundOf(ctx) { return ((ctx && ctx.round) || (lastCtx && lastCtx.round) || 0) + 1; }

/* ---------- live interlude bookkeeping ---------- */
var live = { kind: null, iv: 0, hard: 0, seen: false, bornAt: 0 };
var HARD_CAP_MS = 11000; /* acceptance: never blocks > 12s */

function el(id) { return typeof document !== 'undefined' ? document.getElementById(id) : null; }
function killTimers() {
  if (live.iv) { clearInterval(live.iv); live.iv = 0; }
  if (live.hard) { clearTimeout(live.hard); live.hard = 0; }
}
function removeNode(id) { var n = el(id); if (n && n.parentNode) n.parentNode.removeChild(n); }

function startClock(spanSel, deadline) {
  live.iv = setInterval(function () {
    var n = el(live.nodeId);
    if (!n) {
      /* engine hasn't mounted our overlayHTML yet — grace, then abort */
      if (Date.now() - live.bornAt > 2500) finish(live.kind, 'unmounted');
      return;
    }
    live.seen = true;
    var s = n.querySelector(spanSel);
    if (s) s.textContent = Math.max(0, (deadline - Date.now()) / 1000).toFixed(1) + 's';
  }, 120);
}

/* Generic finish: banks results, tears the overlay down. Idempotent.
 * The ENGINE mounts our returned overlayHTML; if it never appears we
 * abort without banking (an unplayed minigame grants nothing). */
function finish(kind, reason) {
  if (live.kind !== kind) return;
  killTimers();
  live.kind = null;
  removeNode('iqb-int-' + kind);
  var played = live.seen === true;
  live.seen = false;
  if (kind === 'slime' && played) {
    var hits = st('slimeHits') || 0;
    stDel('slimeHits');
    var mul = Math.min(0.5, hits * 0.1); /* cap +0.5 */
    if (mul > 0) st('slimePending', { mul: mul, round: nextRoundOf(null), label: 'SLIME BOOST ×' + (1 + mul).toFixed(2) });
  } else if (kind === 'luck' && played) {
    evalLuck();
  }
  /* 'brief' banks at open time (scopeNext armed); unshown briefs are
   * disarmed below so a fog never ambushes a player who saw nothing */
  if (!played && kind === 'brief') stDel('scopeNext');
  void reason;
}


/* ============================================================
 * [1] SLIME GUN GALLERY — world: arcade-gallery
 * ============================================================ */
function openSlime(ctx) {
  var motion = motionOK();
  var targets = '';
  var r = ctx.rng;
  var n = motion ? 5 : 3; /* motion-off: static row of 3 */
  for (var i = 0; i < n; i++) {
    var top = motion ? (8 + Math.floor(r() * 66)) : 34;
    var dur = (2.6 + r() * 2.6).toFixed(2);
    var delay = (-r() * 3).toFixed(2);
    /* single animation declaration — drift + bob (a second 'animation:'
       shorthand would overwrite the first) */
    var anim = motion
      ? 'animation:pxD ' + dur + 's linear ' + delay + 's infinite normal, pxW ' + (1.1 + r()).toFixed(2) + 's ease-in-out infinite alternate;'
      : 'left:' + (18 + i * 26) + '%;';
    targets += '<button type="button" class="iqb-slime" data-pi-slime="' + i + '" style="top:' + top + '%;' + anim + '">🟢</button>';
  }
  st('slimeHits', 0);
  var html =
    '<div class="iqb-int" id="iqb-int-slime" data-pi-root style="pointer-events:auto">' +
     '<button type="button" class="iqb-int-x" data-pi-x title="Close (Esc)">✕</button>' +
     '<div class="iqb-int-title">SLIME GUN GALLERY</div>' +
     '<div class="iqb-int-sub">Pop the slimes — every hit banks an essence token. Next round: +10% score each (max +50%). Misses cost nothing.</div>' +
     '<div class="iqb-field">' + targets + '</div>' +
     '<div class="iqb-hud">TOKENS <b data-pi-tokens>0</b> · <span data-pi-clock></span></div>' +
    '</div>';
  begin('slime', html, ctx, 9000);
}

/* ============================================================
 * [2] FRUIT MACHINE — world: luck-den ('essence', never money)
 * ============================================================ */
var GLYPHS = ['✦', '◈', '●', '▲', '✿', '★'];
var luck = { sym: [0, 0, 0], blessMul: true, stopped: [false, false, false] };

function openLuck(ctx) {
  var r = ctx.rng; /* seeded: outcomes identical on host + clients */
  for (var i = 0; i < 3; i++) luck.sym[i] = Math.floor(r() * GLYPHS.length);
  luck.blessMul = r() < 0.5; /* seeded blessing pool */
  luck.stopped = [false, false, false];
  var reels = '';
  for (var k = 0; k < 3; k++) {
    var strip = '';
    if (motionStrip()) {
      for (var s = 0; s < 10; s++) strip += '<span>' + GLYPHS[(s * 3 + k) % GLYPHS.length] + '</span>';
      strip += '<span>?</span>';
    } else strip = '<span>?</span>';
    reels += '<div class="iqb-reel" data-pi-reel="' + k + '">' +
             '<div class="iqb-strip' + (motionStrip() ? ' spin' : '') + '" style="height:96px">' + strip + '</div></div>';
  }
  var stops = '';
  for (var b = 0; b < 3; b++) stops += '<button type="button" class="iqb-stop" data-pi-stop="' + b + '">STOP ' + (b + 1) + '</button>';
  var html =
    '<div class="iqb-int" id="iqb-int-luck" data-pi-root style="pointer-events:auto">' +
     '<button type="button" class="iqb-int-x" data-pi-x title="Close (Esc)">✕</button>' +
     '<div class="iqb-int-title">ESSENCE REELS</div>' +
     '<div class="iqb-int-sub">Stop each reel. A pair channels a blessing (+25% score or +10 HP) — three of a kind is a JACKPOT: +25 HP.</div>' +
     '<div class="iqb-reels">' + reels + '</div>' +
     '<div style="display:flex;gap:10px">' + stops + '</div>' +
     '<div class="iqb-hud"><span data-pi-luckmsg>pull the essence…</span> · <span data-pi-clock></span></div>' +
    '</div>';
  begin('luck', html, ctx, 9000);
}
function motionStrip() { return motionOK(); }

function stopReel(idx) {
  if (live.kind !== 'luck' || idx < 0 || idx > 2 || luck.stopped[idx]) return;
  luck.stopped[idx] = true;
  SFX.stop();
  var n = el('iqb-int-luck');
  if (n) {
    var reel = n.querySelector('[data-pi-reel="' + idx + '"]');
    if (reel) reel.innerHTML = GLYPHS[luck.sym[idx]];
    var btn = n.querySelector('[data-pi-stop="' + idx + '"]');
    if (btn) btn.disabled = true;
  }
  if (luck.stopped[0] && luck.stopped[1] && luck.stopped[2]) finish('luck', 'done');
}

function evalLuck() {
  var s = luck.sym;
  var msg = 'the reels sleep';
  var triple = s[0] === s[1] && s[1] === s[2];
  var pair = !triple && (s[0] === s[1] || s[1] === s[2] || s[0] === s[2]);
  if (triple) {
    st('luckPending', { hp: 25, round: nextRoundOf(null), label: 'JACKPOT +25 HP' });
    SFX.jackpot();
    msg = '★ JACKPOT — +25 HP next round ★';
  } else if (pair) {
    if (luck.blessMul) st('luckPending', { mul: 1.25, round: nextRoundOf(null), label: 'BLESSING ×1.25 SCORE' });
    else st('luckPending', { hp: 10, round: nextRoundOf(null), label: 'BLESSING +10 HP' });
    SFX.win();
    msg = luck.blessMul ? 'pair — blessing: ×1.25 score next round' : 'pair — blessing: +10 HP next round';
  } else {
    msg = 'no essence aligned — next round is plain';
  }
  var n = el('iqb-int-luck');
  if (n) {
    var m = n.querySelector('[data-pi-luckmsg]');
    if (m) m.textContent = msg;
  }
}

/* ============================================================
 * [3] SNIPER SCOPE — world: scope-range
 * ============================================================ */
function openBrief(ctx) {
  var html =
    '<div class="iqb-int" id="iqb-int-brief" data-pi-root style="pointer-events:auto">' +
     '<button type="button" class="iqb-int-x" data-pi-x title="Close (Esc)">✕</button>' +
     '<div class="iqb-int-title">SCOPE RANGE</div>' +
     '<div class="iqb-int-sub">Next board deploys fogged. Sweep your pointer to sweep the scope — tiles are only true inside the glass. You MAY answer blind, but unscoped answers score ×0.8.</div>' +
     '<div style="font-size:52px;line-height:1">⊹ ◎ ⊹</div>' +
     '<div class="iqb-hud"><span data-pi-clock></span></div>' +
    '</div>';
  st('scopeNext', nextRoundOf(ctx));
  begin('brief', html, ctx, 5200);
}

var scope = { layer: null, ring: null, moved: 0 };
function mountScopeLayer() {
  if (typeof document === 'undefined' || el('iqb-scope-layer')) return;
  ensureStyle();
  var d = document.createElement('div');
  d.id = 'iqb-scope-layer';
  d.innerHTML =
    '<div class="iqb-scope-dim"></div>' +
    '<div class="iqb-scope-ring"><i></i><i></i><b></b></div>' +
    '<button type="button" class="iqb-scope-x" data-pi-scope-x title="Dismiss scope (Esc)">✕ scope</button>';
  d.style.setProperty('--sx', '50%');
  d.style.setProperty('--sy', '40%');
  document.body.appendChild(d);
  scope.layer = d;
  scope.ring = d.querySelector('.iqb-scope-ring');
  placeScope(window.innerWidth * 0.5, window.innerHeight * 0.4);
  scope.moved = 0;
}
function placeScope(x, y) {
  var layer = el('iqb-scope-layer');
  if (!layer) return;
  layer.style.setProperty('--sx', x + 'px');
  layer.style.setProperty('--sy', y + 'px');
  if (scope.ring) scope.ring.style.transform = 'translate(' + x + 'px,' + y + 'px)';
}
function removeScopeLayer() {
  removeNode('iqb-scope-layer');
  scope.layer = null;
  stDel('scopeLive');
  stDel('scoped');
}

/* ---------- shared interlude bootstrap ---------- */
function begin(kind, html, ctx, windowMs) {
  lastCtx = ctx || lastCtx;
  killTimers();
  removeNode('iqb-int-' + kind); /* stale twin guard */
  live.kind = kind;
  live.nodeId = 'iqb-int-' + kind;
  live.html = html;
  live.seen = false;
  live.bornAt = Date.now();
  /* The ENGINE mounts overlayHTML inside its pointer-events:none rail;
     our root re-enables pointer events for the panel only. Timers start
     now — the clock grants a mount grace before aborting unbanked. */
  var deadline = live.bornAt + windowMs;
  if (typeof document !== 'undefined') {
    ensureStyle();
    startClock('[data-pi-clock]', deadline);
  }
  live.hard = setTimeout(function () { finish(kind, 'deadline'); }, Math.min(HARD_CAP_MS, windowMs + 400));
}

/* ---------- delegated input (survives engine mount timing) ---------- */
if (typeof document !== 'undefined' && !root.__iqPackInterludesWired) {
  root.__iqPackInterludesWired = true;

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-pi-x]')) { SFX.close(); finish(live.kind, 'x'); return; }
    if (t.closest('[data-pi-scope-x]')) { SFX.close(); removeScopeLayer(); return; }
    var sl = t.closest('[data-pi-slime]');
    if (sl && sl.dataset.hit !== '1') {
      sl.dataset.hit = '1';
      sl.classList.add('splat');
      sl.textContent = '💥';
      st('slimeHits', (st('slimeHits') || 0) + 1);
      SFX.shot(); SFX.splat();
      var n = el('iqb-int-slime');
      if (n) { var tk = n.querySelector('[data-pi-tokens]'); if (tk) tk.textContent = String(st('slimeHits')); }
      var field = sl.parentNode;
      if (field && !field.querySelector('[data-pi-slime]:not([data-hit="1"])')) finish('slime', 'clear');
      return;
    }
    var sp = t.closest('[data-pi-stop]');
    if (sp) { stopReel(parseInt(sp.getAttribute('data-pi-stop'), 10)); return; }
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (live.kind) { SFX.close(); finish(live.kind, 'esc'); }
    else if (el('iqb-scope-layer')) { SFX.close(); removeScopeLayer(); }
  }, true);

  document.addEventListener('pointermove', function (e) {
    if (!el('iqb-scope-layer')) return;
    placeScope(e.clientX, e.clientY);
    scope.moved += 1;
    if (scope.moved > 6) st('scoped', true); /* swept the glass at least once */
  }, { passive: true });
}

/* ============================================================
 * [4] COLLECTIBLES BANK — flavor by world tag
 * ============================================================ */
function pickKind(world, rng) {
  var w = String(world == null ? '' : world);
  if (/arcade/.test(w)) return 'ring';
  if (/jungle|banana|vine|wild|retro/.test(w)) return 'banana';
  if (/gold|coin|luck|den|heaven|fortune|vault/.test(w)) return 'coin';
  var pool = ['ring', 'coin', 'banana'];
  return pool[Math.floor(rng() * pool.length)];
}

/* ============================================================
 * HOOKS PACK
 * ============================================================ */
function onInterlude(ctx) {
  lastCtx = ctx || null;
  var w = String((ctx && ctx.world) || '');
  if (w === 'arcade-gallery') { openSlime(ctx); }
  else if (w === 'luck-den') { openLuck(ctx); }
  else if (w === 'scope-range') { openBrief(ctx); }
  else return undefined; /* not one of ours */
  return { overlayHTML: live.html };
}

function onRoundStart(ctx) {
  lastCtx = ctx || lastCtx;
  var round = (ctx && ctx.round) || 0;
  var mods = {};
  var labels = [];

  var slime = st('slimePending');
  if (slime && round >= slime.round) {
    mods.scoreMul = (mods.scoreMul || 1) + slime.mul; /* additive on our side; engine multiplies */
    labels.push(slime.label);
    stDel('slimePending');
  }
  var luckP = st('luckPending');
  if (luckP && round >= luckP.round) {
    if (luckP.mul) mods.scoreMul = (mods.scoreMul || 1) * luckP.mul;
    if (luckP.hp) mods.hpDelta = (mods.hpDelta || 0) + luckP.hp;
    labels.push(luckP.label);
    stDel('luckPending');
  }
  var sn = st('scopeNext');
  if (sn && round >= sn) {
    stDel('scopeNext');
    st('scopeLive', round);
    setTimeout(mountScopeLayer, 60); /* let renderBoard paint first */
    labels.push('SCOPE FOG — sweep to reveal');
  } else if (el('iqb-scope-layer')) {
    removeScopeLayer(); /* stale layer from a previous round */
  }
  if (!labels.length) return undefined;
  mods.bannerText = labels.join(' · ');
  return mods;
}

function onPreAnswer(ctx) {
  if (st('scopeLive') != null && !st('scoped')) {
    return { scoreMul: 0.8, bannerText: 'BLIND SHOT — unscoped ×0.8' };
  }
  void ctx;
  return undefined;
}

function onAnswer(ctx) {
  var c = ctx || {};
  if (st('scopeLive') != null) { /* round decided — fold the scope */
    removeScopeLayer();
  }
  var correct = c.correct === true || c.isCorrect === true || c.ok === true || c.result === 'correct';
  if (!correct) return undefined;
  var r = c.rng;
  if (typeof r !== 'function') return undefined;
  if (r() >= 0.30) return undefined; /* occasional spawn */
  var count = (st('coll') || 0) + 1;
  st('coll', count);
  if (count % 10 === 0) { /* auto-cashout: +20 score & tiny heal */
    SFX.cash();
    return {
      pickup: { kind: 'coin', value: 20 },
      hpDelta: 5,
      sfx: 'cash',
      bannerText: 'BANK ×' + count + ' — cashed +20 score, +5 HP'
    };
  }
  SFX.stop();
  return { pickup: { kind: pickKind(c.world, r), value: 1 }, sfx: 'stop' };
}

function onReveal() {
  if (st('scopeLive') != null) removeScopeLayer();
  return undefined;
}

var Hooks = root.IQ.Hooks;
if (Hooks && typeof Hooks.add === 'function') {
  /* interlude takeovers + scope fog: bound to our three worlds */
  Hooks.add({
    id: 'pack-interludes',
    worlds: ['arcade-gallery', 'luck-den', 'scope-range'],
    weight: 1,
    handlers: {
      onInterlude: onInterlude,
      onRoundStart: onRoundStart,
      onPreAnswer: onPreAnswer,
      onReveal: onReveal
    }
  });
  /* [4] collectibles bank spawns in ANY world (rings/coins/bananas by
     world tag) — separate always-on registration so Hooks routing
     reaches it outside the three interlude homes */
  Hooks.add({
    id: 'pack-interludes-bank',
    always: true,
    weight: 1,
    handlers: { onAnswer: onAnswer }
  });
}

/* ============================================================
 * WORLDS — theme backdrops for the three interlude homes
 * ============================================================ */
var Worlds = root.IQ.Worlds;
if (Worlds && typeof Worlds.register === 'function') {
  Worlds.register({
    id: 'arcade-gallery', align: 'good',
    pal: ['#ff2e88', '#00e5ff', '#ffe14d', '#7cff4d', '#b04dff', '#ff7a1a', '#12121c', '#f2f2f2'],
    draw: function (c, w, h, t) {
      var g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0a0a14'); g.addColorStop(1, '#141024');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      /* perspective grid horizon */
      c.strokeStyle = 'rgba(0,229,255,.16)'; c.lineWidth = 1;
      var hy = h * 0.42;
      for (var i = 0; i < 9; i++) {
        var f = ((t * 0.35 + i) % 9) / 9;
        var y = hy + f * f * (h - hy);
        c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
      }
      for (var k = -6; k <= 6; k++) {
        c.beginPath(); c.moveTo(w * 0.5 + k * w * 0.06, hy); c.lineTo(w * 0.5 + k * w * 0.34, h); c.stroke();
      }
      /* neon marquees */
      var cols = ['#ff2e88', '#7cff4d', '#ffe14d', '#b04dff'];
      for (var m = 0; m < 8; m++) {
        var mx = (m * 173 + Math.sin(t * 0.8 + m) * 12) % w;
        var my = h * (0.12 + 0.06 * (m % 4));
        c.fillStyle = cols[m % 4];
        c.globalAlpha = 0.5 + 0.4 * Math.sin(t * 2 + m * 1.7);
        c.fillRect(mx, my, 26, 8);
      }
      c.globalAlpha = 1;
    }
  });
  Worlds.register({
    id: 'luck-den', align: 'neutral',
    pal: ['#ffd75e', '#c98a2d', '#7a4a12', '#2a1508', '#ffefb0', '#a06428', '#4a2c0c', '#fff3d0'],
    draw: function (c, w, h, t) {
      var g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#170a04'); g.addColorStop(1, '#30160a');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      /* velvet curtains */
      for (var s = 0; s < 2; s++) {
        c.fillStyle = 'rgba(120,26,26,.5)';
        c.beginPath();
        c.moveTo(s ? w : 0, 0);
        for (var y = 0; y <= h; y += 18) c.lineTo((s ? w : 0) + (s ? -1 : 1) * (w * 0.09 + Math.sin(y * 0.03 + s) * 10), y);
        c.lineTo(s ? w : 0, h); c.closePath(); c.fill();
      }
      /* swinging essence bulb */
      var bx = w * 0.5 + Math.sin(t * 0.9) * w * 0.04;
      var by = h * 0.2;
      c.strokeStyle = 'rgba(255,215,94,.4)';
      c.beginPath(); c.moveTo(bx, 0); c.lineTo(bx, by); c.stroke();
      var rg = c.createRadialGradient(bx, by, 2, bx, by, 130);
      rg.addColorStop(0, 'rgba(255,239,176,.9)'); rg.addColorStop(1, 'rgba(255,215,94,0)');
      c.fillStyle = rg; c.beginPath(); c.arc(bx, by, 130, 0, 7); c.fill();
      /* rising gold motes */
      for (var i = 0; i < 22; i++) {
        var f = (t * 0.12 + i * 0.61) % 1;
        c.fillStyle = 'rgba(255,215,94,' + (0.5 * (1 - f)).toFixed(3) + ')';
        c.fillRect((i * 149) % w, h - f * h, 2, 2);
      }
    }
  });
  Worlds.register({
    id: 'scope-range', align: 'bad',
    pal: ['#7fff9f', '#2fae5c', '#0f4d26', '#04120a', '#baffcf', '#1d6b38', '#63d98c', '#0a2415'],
    draw: function (c, w, h, t) {
      c.fillStyle = '#04120a'; c.fillRect(0, 0, w, h);
      /* drifting fog bands */
      for (var i = 0; i < 5; i++) {
        c.fillStyle = 'rgba(127,255,159,.05)';
        c.beginPath();
        c.ellipse(((i * 211 + t * 26) % (w + 320)) - 160, h * (0.3 + 0.14 * i), 190, 30, 0, 0, 7);
        c.fill();
      }
      /* distant range silhouettes */
      c.fillStyle = 'rgba(10,36,21,.9)';
      for (var s = 0; s < 4; s++) {
        var sx = w * (0.16 + 0.22 * s), sw = w * 0.05;
        c.beginPath();
        c.moveTo(sx - sw, h * 0.72); c.lineTo(sx, h * 0.72 - sw * 1.4); c.lineTo(sx + sw, h * 0.72);
        c.closePath(); c.fill();
        c.fillRect(sx - 1, h * 0.72 - sw * 1.4, 2, sw * 1.4);
      }
      /* slow scanlines */
      c.fillStyle = 'rgba(127,255,159,.045)';
      for (var l = 0; l < h; l += 4) c.fillRect(0, (l + (t * 8) % 4), w, 1);
      /* vignette */
      var vg = c.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.85);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(1,8,4,.8)');
      c.fillStyle = vg; c.fillRect(0, 0, w, h);
    }
  });
}

/* node parity shim (mirrors sibling packs) */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { id: 'pack-interludes', worlds: ['arcade-gallery', 'luck-den', 'scope-range'] };
}
})();
