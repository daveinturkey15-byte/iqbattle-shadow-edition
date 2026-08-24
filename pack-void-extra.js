/* ============================================================================
 * pack-void-extra.js — REMAKE ARMY B4: black-hole/void EXTRAS (PackVoidExtra)
 * ============================================================================
 * Registers ONE thing (hooks.js contract JSDoc):
 *   IQ.Hooks.add({ id:'pack-void-extra', worlds:['void-black'], ... })
 *
 * This pack is an AMBIENCE/ECONOMY COMPLEMENT to the existing 'void-black'
 * world owned by pack-realm.js. It NEVER calls IQ.Worlds.register and never
 * re-registers 'void-black' — zero double-registration by construction; it
 * only binds hooks to the existing world id.
 *
 * SPEC -> MECHANIC MAP
 *   [1] VOID WHISPERS .. onRoundStart picks a flavor line with ctx.rng ONLY
 *                        (deterministic per runId+round+dispatch-seq) and
 *                        surfaces it via bannerText. Lines may carry a {NAME}
 *                        token, replaced by the player-name token from ctx
 *                        (ctx.playerName / ctx.name) when the engine enriches
 *                        it — otherwise a cosmetic best-effort DOM read of the
 *                        local scoreboard name, else neutral 'YOU'. Cosmetic
 *                        only; never affects scoring or answers.
 *   [2] GRAVITY WELL ... chaotic void rounds ONLY (ctx.align === 'chaotic').
 *                        MP PATH (ctx.mp === true): the round-start modifier
 *                        carries flag 'gravity-well' PLUS gravityWell:true —
 *                        a forward-compatible engine extension field the HOST
 *                        may interpret as score-pull-toward-leader; clients
 *                        never touch score math (host-authoritative).
 *                        SOLO FALLBACK: idle drain — every full 8s spent
 *                        without answering requests scoreDelta:-5 from
 *                        onTick, capped at -25 TOTAL per round AND floored at
 *                        (round-start score - 25, never below 0). The rule is
 *                        TELEGRAPHED once ~2.5s into every solo void round via
 *                        bannerText before the first drain can land.
 *   [3] EVENT HORIZON .. onAnswer: if the pick happened after >70% of the
 *                        round timer was consumed (elapsed tracked via the
 *                        dtSec accumulation convention used by pack-stones /
 *                        pack-wwe) → 'event horizon escape' bonus, requested
 *                        ONCE per round as scoreDelta:+30.
 *   [4] STARLIGHT ...... overlayHTML corner spirals (4 small SVGs, corners
 *                        only). Motion-gated: slow CSS rotation behind
 *                        IQB_MOTION; without motion the SAME frame renders
 *                        static. pointer-events:none, non-opaque, tiny
 *                        coverage, no flash/strobe at all.
 *
 * FAIRNESS RAILS: overlays are pointer-events:none, escapable (no focus trap,
 * no Escape capture), corners-only well under 30% coverage, question text
 * zones untouched; banners fire at most one per event (drains are >=8s apart,
 * far below the 3Hz cap; no flashes anywhere); randomness is ctx.rng
 * exclusively; scoring stays host-authoritative (flat scoreDelta REQUESTS
 * only, engine applies); one broken handler cannot kill a round (dispatch
 * wraps handlers in try/catch).
 * ============================================================================*/
(function () {
'use strict';
const root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

const Hooks = root.IQ && root.IQ.Hooks;
const PS = 'pack-void-extra:';

/* ---------- shared helpers (pack-wwe / curse-pack conventions) ------------ */
function motionOK() {
  try {
    const v = root.localStorage && root.localStorage.getItem('IQB_MOTION');
    return v == null ? true : JSON.parse(v) !== false;
  } catch (e) { return true; }
}

/* Best-effort display name for whisper personalization. ctx token first
 * (deterministic when the engine enriches it); DOM read is COSMETIC ONLY,
 * same precedent as pack-wwe's belt note. */
function nameToken(ctx) {
  const fromCtx = ctx && (ctx.playerName || ctx.name);
  if (fromCtx && String(fromCtx).trim()) return String(fromCtx).trim().slice(0, 18);
  try {
    if (typeof document !== 'undefined') {
      const el = document.querySelector('#side-panel .score-card.me .sc-name');
      if (el && el.textContent && el.textContent.trim()) return el.textContent.trim().slice(0, 18);
    }
  } catch (e) { /* cosmetic fallback only */ }
  return 'YOU';
}

/* ---------- [1] seeded whispers ------------------------------------------- */
const WHISPERS = [
  'the void remembers.',
  'you were faster here once.',
  '{NAME}. the dark kept your echo.',
  'it knew you before you had a name, {NAME}.',
  '{NAME} — silence answers too.',
  'the horizon blinks. it saw {NAME}.',
  'somewhere in here, {NAME} already lost. prove it wrong.',
  'light left this place. you stayed, {NAME}.'
];
function pickWhisper(ctx) {
  const i = Math.floor(ctx.rng() * WHISPERS.length) % WHISPERS.length;
  return String(WHISPERS[i]).split('{NAME}').join(nameToken(ctx));
}

/* ---------- [4] starlight spiral overlay (corners, motion-gated) ---------- */
function spiralSVG(size, hue) {
  /* archimedean spiral path, precomputed statically — no runtime cost */
  let d = 'M 45 45';
  for (let a = 0; a <= 720; a += 15) {
    const r = (a / 720) * 38;
    const rad = (a * Math.PI) / 180;
    d += ' L ' + (45 + r * Math.cos(rad)).toFixed(1) + ' ' + (45 + r * Math.sin(rad)).toFixed(1);
  }
  const spin = motionOK()
    ? '<style>@keyframes pvx-spin{to{transform:rotate(360deg)}}' +
      '.pvx-spiral{animation:pvx-spin 26s linear infinite}</style>'
    : '';
  const svg =
    '<svg class="pvx-spiral" width="' + size + '" height="' + size + '" viewBox="0 0 90 90" aria-hidden="true">' +
    '<path d="' + d + '" fill="none" stroke="hsla(' + hue + ',80%,82%,0.34)" stroke-width="1.6" stroke-linecap="round"/>' +
    '<circle cx="45" cy="45" r="2.2" fill="hsla(' + hue + ',85%,88%,0.5)"/></svg>';
  const corner = (pos) =>
    '<div style="position:absolute;' + pos + ';width:' + size + 'px;height:' + size +
    'px;opacity:.8">' + svg + '</div>';
  return '<style>.pvx-wrap{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:40}</style>' +
    spin +
    '<div class="pvx-wrap">' +
    corner('top:6px;left:6px') +
    corner('top:6px;right:6px') +
    corner('bottom:6px;left:6px') +
    corner('bottom:6px;right:6px') +
    '</div>';
}

/* ---------- per-round record (lazy, round-scoped keys reset on roundStart) */
function rec(ctx) {
  const k = PS + 'rec';
  let r = Hooks.state.get(k);
  if (!r || r.round !== ctx.round || r.runId !== ctx.runId) {
    r = { round: ctx.round | 0, runId: String(ctx.runId || ''),
          elapsed: 0, ruleShown: false, drains: 0, drainedTotal: 0,
          startScore: null, ehDone: false };
    Hooks.state.set(k, r);
  }
  return r;
}

const HANDLERS = {
  /* ---- [1][2][4]: whisper banner, MP flag, spiral overlay ---------------- */
  onRoundStart: function (ctx) {
    const r = rec(ctx);
    void r; /* fresh record installed above */

    const mod = {
      bannerText: pickWhisper(ctx),
      overlayHTML: spiralSVG(84, 265),
      sfx: 'sting',
      flag: 'pack-void-extra:whisper'
    };

    /* GRAVITY WELL — chaotic void rounds. MP: hand the host a pull flag;
     * gravityWell:true is a forward-compatible engine-extension field. */
    if (String(ctx.align || '') === 'chaotic' && ctx.mp === true) {
      mod.flag = 'gravity-well';
      mod.gravityWell = true;
    }
    return mod;
  },

  /* ---- [2] solo idle drain + rule telegraph; elapsed clock for [3] ------- */
  onTick: function (ctx) {
    const r = rec(ctx);

    const dt = (typeof ctx.dtSec === 'number' && isFinite(ctx.dtSec))
      ? Math.min(Math.max(ctx.dtSec, 0), 0.25) : (1 / 60);
    r.elapsed += dt;
    if (r.startScore == null) r.startScore = ctx.score | 0;

    if (ctx.mp === true) return undefined;           /* solo fallback only */
    if (String(ctx.align || '') !== 'chaotic') return undefined;

    /* TELEGRAPH the rule once, ~2.5s in — always precedes the first drain */
    if (!r.ruleShown && r.elapsed >= 2.5) {
      r.ruleShown = true;
      return {
        bannerText: 'GRAVITY WELL: every 8s idle pulls 5 score (max \u221225 this round)',
        flag: 'pack-void-extra:rule'
      };
    }

    /* drain each completed 8s idle window, hard-capped at -25/round and
     * floored at (startScore - 25), never below 0 — engine applies the flat
     * scoreDelta, we only ever request the signed adjustment. */
    if (r.drainedTotal < 25 && r.elapsed >= 8 * (r.drains + 1)) {
      const allowance = 25 - r.drainedTotal;
      const headroom = Math.max(0, (ctx.score | 0) - (r.startScore - 25));
      const delta = Math.min(5, allowance, headroom, Math.max(0, ctx.score | 0));
      r.drains += 1;
      if (delta <= 0) return undefined;
      r.drainedTotal += delta;
      return {
        scoreDelta: -delta,
        bannerText: 'THE VOID PULLS \u2212' + delta + ' SCORE',
        flag: 'pack-void-extra:idle-drain'
      };
    }
    return undefined;
  },

  /* ---- [3] event horizon escape: late answer bonus, once per round ------- */
  onAnswer: function (ctx) {
    const r = rec(ctx);
    if (r.ehDone) return undefined;
    if (String(ctx.world || '') !== 'void-black') return undefined;

    const res = ctx.res || {};
    if (!(typeof res.picked === 'number' && res.picked >= 0)) return undefined;

    const tl = (ctx.timerLen | 0) || 60;
    if (r.elapsed <= tl * 0.7) return undefined;     /* not past the horizon */

    r.ehDone = true;
    return {
      scoreDelta: 30,
      bannerText: 'EVENT HORIZON ESCAPE +30',
      sfx: 'chime',
      flag: 'pack-void-extra:event-horizon'
    };
  }
};

/* ---------- late-safe registration (hooks.js may load after us) ----------- */
(function regHook(attempt) {
  const H = root.IQ && root.IQ.Hooks;
  if (H && typeof H.add === 'function') {
    H.add({
      id: 'pack-void-extra',
      worlds: ['void-black'],
      weight: 1,
      handlers: HANDLERS
    });
    return;
  }
  if (attempt < 40 && typeof setTimeout === 'function') {
    setTimeout(function () { regHook(attempt + 1); }, 50);
  }
})(0);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { id: 'pack-void-extra', worlds: ['void-black'], handlers: HANDLERS };
}
})();
