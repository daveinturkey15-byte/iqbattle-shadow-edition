/* ============================================================
   SANCTUARY — "the light remembers you" faithful-skin refuge
   ------------------------------------------------------------
   PURPOSE
     On good/heaven rounds the whole chrome reverts to the
     faithful original-site look (Dave's "swap back to the
     original sometimes" beat). Pure CSS toggle: no flashes,
     no motion, no gameplay mutation — fairness-safe by design.

   TRIGGER CONTRACT
     Hook (always:true, refines on ctx):
       onRoundStart  -> active when ctx.world === 'heaven'
                        OR ctx.align === 'good'; otherwise clears.
       onReveal      -> clear()
       onInterlude   -> clear()
     (next non-good onRoundStart also clears.)

   CONTINUATION LORE (IQ.Hooks.state keys)
     'sanctuary:lastDepth' : depth of the previous sanctuary round.
       When a sanctuary round starts and a stored depth > 0 exists,
       emits modifier.bannerText
         'THE LIGHT REMEMBERS YOU · LAST REFUGE · DEPTH <prev>'
       then stores the current round's depth.
     'sanctuary:count'     : number of sanctuary rounds this run.

   MODIFIERS EMITTED (onRoundStart, only while active)
     { flag:'sanctuary' } always,
     + bannerText above when continuation fires.

   VISUAL TOKEN SOURCE (exact values)
     research/w1-original-recon.md "Visual tokens" table — body bg
     rgb(4,8,18); panels rgb(2,14,32)/rgb(2,12,29); footer
     rgb(4,11,22)+border rgba(255,255,255,.075); text rgb(245,248,255),
     muted rgb(154,167,186), disabled rgb(111,127,150); accent panel
     gradient linear-gradient(135deg, rgba(43,116,235,.14),
     transparent 36%); active buttons 90deg rgba(43,116,235,.28)/
     rgba(53,125,244,.28); borders rgba(64,137,238,.16) & active
     rgba(72,191,255,.38); radii 22/16/12/8/6px; Oxanium font.
     Overrides are scoped to luxe.css class names (.panel, .btn,
     .opt-btn, ...) under body.iqv-sanctuary. Chaos-layer canvases
     (#iqChaosCanvas/#iqChaosFx/.iq-flash/.iq-vignette/.iq-scanlines)
     and shadow-persona visuals (#iq-shadow-bubbles, .iqsa-wrap,
     #iqDemonSay) are hidden by CSS only — chaos.js/shadow.js/
     shadow-avatar.js/demonsay.js untouched.

   EXPORTS
     window.IQ.Sanctuary = { apply, clear, isActive }
     Headless-safe (document access guarded; no-op in node).

   DETERMINISM: none needed (state-driven, zero RNG/clock).
   FAIRNESS RAILS: pure CSS, no flashes, no motion, never touches
     question/answer glyphs or scoring paths.
   ============================================================ */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;

  root.IQ = root.IQ || {};

  var CLASS_NAME = 'iqv-sanctuary';
  var CSS_ID = 'iqv-sanctuary-css';
  var HOOK_ID = 'sanctuary';
  var FLAG = 'sanctuary';
  var KEY_LAST_DEPTH = 'sanctuary:lastDepth';
  var KEY_COUNT = 'sanctuary:count';
  var BANNER_PREFIX = 'THE LIGHT REMEMBERS YOU \u00B7 LAST REFUGE \u00B7 DEPTH ';

  /* Exact tokens from research/w1-original-recon.md Visual tokens.
     Scoped to luxe.css class names; !important beats corruption skins. */
  var CSS = [
    /* --- shell: faithful body bg + Oxanium --- */
    'body.' + CLASS_NAME + '{',
    '  background:rgb(4,8,18)!important;',
    '  color:rgb(245,248,255)!important;',
    "  font-family:'Oxanium','Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif!important;",
    '}',
    'body.' + CLASS_NAME + ' #app{',
    '  animation:none!important;transform:none!important;filter:none!important;',
    '}',
    'body.' + CLASS_NAME + ' h1,body.' + CLASS_NAME + ' h2,body.' + CLASS_NAME + ' h3{',
    '  color:rgb(245,248,255)!important;',
    '}',
    /* --- panels: rgb(2,14,32) + accent gradient + accent border, radius 22 --- */
    'body.' + CLASS_NAME + ' .panel,',
    'body.' + CLASS_NAME + ' .score-card,',
    'body.' + CLASS_NAME + ' .side-panel,',
    'body.' + CLASS_NAME + ' .boot-card,',
    'body.' + CLASS_NAME + ' .update-modal{',
    '  background:',
    '    linear-gradient(135deg, rgba(43,116,235,.14), transparent 36%),',
    '    rgb(2,14,32)!important;',
    '  border:1px solid rgba(64,137,238,.16)!important;',
    '  border-radius:22px!important;',
    '}',
    /* --- round-status strip: rgb(2,12,29), radius 16 --- */
    'body.' + CLASS_NAME + ' .round-label,',
    'body.' + CLASS_NAME + ' .round-strip,',
    'body.' + CLASS_NAME + ' .stat-grid,',
    'body.' + CLASS_NAME + ' .opp-row{',
    '  background:rgb(2,12,29)!important;',
    '  border:1px solid rgba(64,137,238,.16)!important;',
    '  border-radius:16px!important;',
    '}',
    /* --- footer: rgb(4,11,22) + top border --- */
    'body.' + CLASS_NAME + ' footer{',
    '  background:rgb(4,11,22)!important;',
    '  border-top:1px solid rgba(255,255,255,.075)!important;',
    '}',
    /* --- buttons: radius 8, faithful washes/borders --- */
    'body.' + CLASS_NAME + ' .btn{',
    '  border-radius:8px!important;',
    '  background:rgba(2,10,22,.52)!important;',
    '  color:rgb(245,248,255)!important;',
    '}',
    'body.' + CLASS_NAME + ' .btn-primary{',
    '  background:linear-gradient(90deg, rgba(43,116,235,.28), rgba(53,125,244,.28))!important;',
    '  border:1px solid rgba(72,191,255,.38)!important;',
    '  box-shadow:none!important;',
    '}',
    'body.' + CLASS_NAME + ' .seg button.on{',
    '  background:linear-gradient(90deg, rgba(43,116,235,.28), rgba(53,125,244,.28))!important;',
    '  border-color:rgba(72,191,255,.38)!important;',
    '  color:rgb(245,248,255)!important;',
    '}',
    /* --- answer options: quiet panels, faithful disabled tone --- */
    'body.' + CLASS_NAME + ' .opt-btn{',
    '  border-radius:8px!important;',
    '  background:rgb(2,12,29)!important;',
    '  border:1px solid rgba(64,137,238,.16)!important;',
    '  color:rgb(245,248,255)!important;',
    '  box-shadow:none!important;',
    '}',
    'body.' + CLASS_NAME + ' .opt-btn:disabled,',
    'body.' + CLASS_NAME + ' .opt-btn[disabled]{',
    '  color:rgb(111,127,150)!important;',
    '  border-color:rgba(255,255,255,.075)!important;',
    '}',
    /* --- muted smalls + form controls (radii 12/6) --- */
    'body.' + CLASS_NAME + ' .fineprint,',
    'body.' + CLASS_NAME + ' .menu-sub,',
    'body.' + CLASS_NAME + ' .corrupt-note,',
    'body.' + CLASS_NAME + ' .ver-tag,',
    'body.' + CLASS_NAME + ' .stat-lbl,',
    'body.' + CLASS_NAME + ' .sc-sub{',
    '  color:rgb(154,167,186)!important;',
    '}',
    'body.' + CLASS_NAME + ' .sw{',
    '  border-radius:12px!important;',
    '}',
    'body.' + CLASS_NAME + ' input,',
    'body.' + CLASS_NAME + ' select{',
    '  border-radius:6px!important;',
    '  color:rgb(245,248,255)!important;',
    '  border:1px solid rgba(64,137,238,.16)!important;',
    '}',
    /* --- hide chaos-layer canvases + shadow persona visuals --- */
    'body.' + CLASS_NAME + ' #iqChaosCanvas,',
    'body.' + CLASS_NAME + ' #iqChaosFx,',
    'body.' + CLASS_NAME + ' .iq-flash,',
    'body.' + CLASS_NAME + ' .iq-vignette,',
    'body.' + CLASS_NAME + ' .iq-scanlines,',
    'body.' + CLASS_NAME + ' #iq-shadow-bubbles,',
    'body.' + CLASS_NAME + ' .iqsa-wrap,',
    'body.' + CLASS_NAME + ' #iqDemonSay{',
    '  display:none!important;',
    '}',
    /* corruption chrome off while in refuge */
    'body.' + CLASS_NAME + ' #fx-vignette,',
    'body.' + CLASS_NAME + ' #fx-scan{',
    '  opacity:0!important;',
    '}'
  ].join('\n');

  function doc() {
    return typeof document !== 'undefined' ? document : null;
  }

  function injectCss() {
    var d = doc();
    if (!d || !d.head || !d.createElement) return false;
    if (d.getElementById && d.getElementById(CSS_ID)) return false; /* once only */
    var s = d.createElement('style');
    s.id = CSS_ID;
    s.textContent = CSS;
    d.head.appendChild(s);
    return true;
  }

  /** Turn the sanctuary skin on. Idempotent. Returns true if newly applied. */
  function apply() {
    var d = doc();
    if (!d || !d.body || !d.body.classList) return false;
    injectCss();
    if (d.body.classList.contains(CLASS_NAME)) return false;
    d.body.classList.add(CLASS_NAME);
    return true;
  }

  /** Turn the sanctuary skin off. Idempotent. Returns true if newly cleared. */
  function clear() {
    var d = doc();
    if (!d || !d.body || !d.body.classList) return false;
    if (!d.body.classList.contains(CLASS_NAME)) return false;
    d.body.classList.remove(CLASS_NAME);
    return true;
  }

  function isActive() {
    var d = doc();
    if (!d || !d.body || !d.body.classList) return false;
    return d.body.classList.contains(CLASS_NAME);
  }

  function isSanctuaryCtx(ctx) {
    var c = ctx || {};
    return c.world === 'heaven' || c.align === 'good';
  }

  root.IQ.Sanctuary = {
    apply: apply,
    clear: clear,
    isActive: isActive
  };

  function registerHook(Hooks) {
    Hooks.add({
      id: HOOK_ID,
      always: true, /* binds everywhere; refines on ctx.world / ctx.align */
      handlers: {
        onRoundStart: function (ctx) {
          if (!isSanctuaryCtx(ctx)) {
            clear(); /* next non-good round reverts the chrome */
            return null;
          }
          apply();
          var st = Hooks.state;
          var prev = Number(st.get(KEY_LAST_DEPTH)) || 0;
          var mod = { flag: FLAG };
          if (prev > 0) {
            mod.bannerText = BANNER_PREFIX + prev;
          }
          st.set(KEY_LAST_DEPTH, (ctx.depth | 0));
          st.set(KEY_COUNT, (Number(st.get(KEY_COUNT)) || 0) + 1);
          return mod;
        },
        onReveal: function () {
          clear();
          return null;
        },
        onInterlude: function () {
          clear();
          return null;
        }
      }
    });
  }

  if (root.IQ.Hooks) {
    registerHook(root.IQ.Hooks);
  } else {
    /* Stage-style queue: main wires script order (after hooks.js ideally),
       but we survive loading first by parking registration. */
    (root.__sanctuaryPending = root.__sanctuaryPending || []).push(registerHook);
  }
})();
