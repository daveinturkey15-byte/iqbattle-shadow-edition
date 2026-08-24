/* ============================================================================
 * IQ.Review — W1 per-round Question Review recorder
 * (surface parity: research/w1-original-recon.md §Match flow step 5 —
 *  "Per-round review and accolades render on player cards (multiplayer)")
 *
 * PURE-ISH recorder module: all state mutation is data-in/data-out with zero
 * DOM/timer/network access. The ONLY DOM-adjacent work happens inside
 * renderFor(), which composes an HTML STRING (never writes to the document).
 *
 * ── HOST INTEGRATION POINTS (exact call sites, for Main) ────────────────────
 *  MATCH START    host, right after room config locks totalRounds:
 *                   IQ.Review.beginMatch(totalRounds);
 *                 Resets the recorder. Safe to call again mid-match (fresh
 *                 record). No frame changes needed — this is host-private.
 *  EVERY REVEAL   host, ONCE per round AFTER the reveal frame is built
 *                 (answers are public at that point, so passing correctIdx /
 *                 pickedIdxByUid here leaks nothing):
 *                   IQ.Review.snap({
 *                     round,                       // 1-based round number
 *                     boardSVGString,              // optional board SVG markup
 *                     options,                     // [svgString x8] as shown
 *                     ord,                         // option shuffle order
 *                     correctIdx,                  // 0-7
 *                     pickedIdxByUid,              // {uid: idx|-1 if none}
 *                     timesMsByUid                 // {uid: ms}
 *                   });
 *                 snap stores sanitized COPIES; later mutation of the caller's
 *                 objects cannot corrupt the record. It performs no scoring
 *                 and strips nothing scoring-related.
 *  MATCH END      final scoreboard / player cards:
 *                   Accolades.compute(IQ.Review.matchRecord());
 *                   card.innerHTML += IQ.Review.renderFor(uid);
 *
 * ── RECORD SHAPE (what matchRecord() hands Accolades) ───────────────────────
 *   {
 *     totalRounds: Number,
 *     rounds: [ {                        // one entry per snapped round,
 *       round: Number,                   // sorted ascending by round
 *       boardSVG: String|'',             // optional board markup
 *       options: [String x ≤8],          // option tile markup, shown order
 *       ord: [Number x ≤8],              // shuffle order snapshot
 *       correctIdx: Number,              // -1 if generator gave none
 *       picks:  {uid: idx},              // idx -1 = never answered
 *       timesMs:{uid: Number}            // response clock in ms
 *     } ]
 *   }
 *
 * SECURITY NOTE: snap() is only ever called WITH the answer (post-reveal), so
 * storing correctIdx/picks is safe. Nothing here ever reads pre-reveal state.
 *
 * STYLE: rendered markup is inline-styled to the live-original luxe tokens
 * (research/w1-original-recon.md §Visual tokens): near-black panels
 * rgb(2,14,32), text rgb(245,248,255), muted rgb(154,167,186), accent border
 * rgba(64,137,238,.16), 22px panel radius, Oxanium inherited. Static markup
 * only — no animation, so IQB_MOTION needs no gating.
 * ============================================================================*/
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  /* ── state ─────────────────────────────────────────────────────────────── */

  let totalRounds = 0;
  /** @type {Array<Object>} sanitized round snapshots */
  let rounds = [];

  /* ── sanitize helpers ──────────────────────────────────────────────────── */

  function isFiniteInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

  function cleanIdx(v) {
    // Option index 0..7, or -1 sentinel ("no answer" / "none given").
    if (!isFiniteInt(v)) return -1;
    return v < -1 ? -1 : (v > 7 ? -1 : v);
  }

  function cleanStr(v, max) {
    if (typeof v !== 'string') return '';
    return v.length > max ? v.slice(0, max) : v;
  }

  function copyUidNumMap(src) {
    const out = {};
    if (!src || typeof src !== 'object') return out;
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (isFinite(v) && v >= 0) out[String(k)] = v;
    }
    return out;
  }

  function copyUidIdxMap(src) {
    const out = {};
    if (!src || typeof src !== 'object') return out;
    for (const k of Object.keys(src)) out[String(k)] = cleanIdx(src[k]);
    return out;
  }

  function copyStrArray(src, max, strMax) {
    if (!Array.isArray(src)) return [];
    const out = [];
    for (let i = 0; i < src.length && i < max; i++) out.push(cleanStr(src[i], strMax));
    return out;
  }

  function snapshotRound(snap) {
    return {
      round: isFiniteInt(snap.round) ? snap.round : rounds.length + 1,
      boardSVG: cleanStr(snap.boardSVGString || snap.boardSVG || '', 262144),
      options: copyStrArray(snap.options, 8, 131072),
      ord: copyStrArray(snap.ord, 8, 4096).map(Number).filter(isFiniteInt),
      correctIdx: cleanIdx(snap.correctIdx),
      picks: copyUidIdxMap(snap.pickedIdxByUid),
      timesMs: copyUidNumMap(snap.timesMsByUid)
    };
  }

  /* ── recording API (host-only) ─────────────────────────────────────────── */

  /**
   * Reset the recorder for a fresh match. Host calls once when the match starts.
   * @param {number} n Total rounds configured for this match.
   */
  function beginMatch(n) {
    totalRounds = isFiniteInt(n) && n > 0 ? n : 0;
    rounds = [];
  }

  /**
   * Record one finished round. Host calls ONCE per reveal, after answers are
   * public. Stores sanitized copies; never mutates the input object.
   * @param {{round:number, boardSVGString?:string, options:string[], ord:number[],
   *          correctIdx:number, pickedIdxByUid:Object<string,number>,
   *          timesMsByUid:Object<string,number>}} snap
   */
  function snap(snapObj) {
    if (!snapObj || typeof snapObj !== 'object') return null;
    const rec = snapshotRound(snapObj);
    // Keep one entry per round; a late re-snap replaces the earlier entry.
    for (let i = 0; i < rounds.length; i++) {
      if (rounds[i].round === rec.round) { rounds[i] = rec; return rec; }
    }
    rounds.push(rec);
    rounds.sort(function (a, b) { return a.round - b.round; });
    return rec;
  }

  /**
   * Full match record for Accolades.compute(). Returns a defensive copy —
   * callers can't corrupt the recorder's state.
   */
  function matchRecord() {
    return {
      totalRounds: totalRounds,
      rounds: rounds.map(function (r) {
        return {
          round: r.round,
          boardSVG: r.boardSVG,
          options: r.options.slice(),
          ord: r.ord.slice(),
          correctIdx: r.correctIdx,
          picks: Object.assign({}, r.picks),
          timesMs: Object.assign({}, r.timesMs)
        };
      })
    };
  }

  /* ── rendering (returns an HTML STRING; never touches the document) ────── */

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var T = {
    text: 'rgb(245,248,255)',
    muted: 'rgb(154,167,186)',
    disabled: 'rgb(111,127,150)',
    panel: 'rgb(2,14,32)',
    panelDeep: 'rgb(2,12,29)',
    border: 'rgba(64,137,238,.16)',
    borderActive: 'rgba(72,191,255,.38)',
    ok: 'rgb(96,211,148)',
    bad: 'rgb(235,87,87)'
  };

  function fmtTime(ms) {
    if (!isFinite(ms) || ms < 0) return '—';
    return (ms / 1000).toFixed(3) + 's';
  }

  function chip(label, color, bg) {
    return '<span style="display:inline-block;padding:2px 10px;border-radius:999px;'
      + 'font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;'
      + 'color:' + color + ';background:' + bg + ';border:1px solid ' + bg + '">'
      + esc(label) + '</span>';
  }

  function tile(svg, mark, markColor) {
    var style = 'width:64px;height:64px;border-radius:12px;background:' + T.panelDeep
      + ';border:1px solid ' + (markColor || T.border)
      + ';overflow:hidden;display:flex;align-items:center;justify-content:center'
      + (mark ? ';position:relative' : '');
    var inner = svg
      ? '<span style="display:block;width:100%;height:100%">' + svg + '</span>'
      : '<span style="color:' + T.disabled + ';font-size:18px">?</span>';
    var badge = mark
      ? '<span style="position:absolute;top:-6px;right:-6px;width:16px;height:16px;'
        + 'border-radius:50%;background:' + markColor + ';color:#04121e;font-size:11px;'
        + 'font-weight:900;line-height:16px;text-align:center">' + esc(mark) + '</span>'
      : '';
    return '<span style="' + style + '">' + inner + badge + '</span>';
  }

  /**
   * Build the per-player "Question review" surface as an HTML string.
   * Lists every recorded round with that player's result, response time, and
   * an expandable (<details>) strip showing the board, the eight options
   * (correct + this player's pick marked), and every player's guess.
   * @param {string|number} uid Player whose card this renders for.
   * @returns {string} HTML fragment (caller inserts it into the player card).
   */
  function renderFor(uid) {
    var key = String(uid);

    var head = '<div style="font-size:12.8px;font-weight:700;letter-spacing:.14em;'
      + 'text-transform:uppercase;color:' + T.muted + ';margin-bottom:8px">'
      + esc('Question review') + '</div>';

    if (!rounds.length) {
      return head + '<div style="color:' + T.disabled + ';font-size:12.8px">'
        + esc('No rounds recorded.') + '</div>';
    }

    var body = '';
    for (var i = 0; i < rounds.length; i++) {
      body += renderRound(rounds[i], key);
    }

    return head
      + '<div style="background:' + T.panel + ';border:1px solid ' + T.border
      + ';border-radius:22px;padding:12px;display:flex;flex-direction:column;gap:8px">'
      + body + '</div>';
  }

  function renderRound(r, me) {
    var pick = (r.picks && me in r.picks) ? r.picks[me] : undefined;
    var myTime = (r.timesMs && me in r.timesMs) ? r.timesMs[me] : undefined;

    var resultChip, resultColor;
    if (pick === undefined || pick === -1) {
      resultChip = chip('no answer', T.muted, 'rgba(154,167,186,.12)');
    } else if (pick === r.correctIdx) {
      resultChip = chip('correct', T.ok, 'rgba(96,211,148,.14)');
    } else {
      resultChip = chip('wrong', T.bad, 'rgba(235,87,87,.14)');
    }

    var summaryLeft = '<span style="font-weight:700;letter-spacing:.1em;'
      + 'text-transform:uppercase;color:' + T.text + ';font-size:12.8px">Round '
      + esc(r.round) + '</span> ' + resultChip;

    var summaryRight = '<span style="margin-left:auto;color:' + T.muted
      + ';font-size:12px;font-variant-numeric:tabular-nums">'
      + esc(fmtTime(myTime)) + '</span>';

    var guesses = renderGuesses(r, me);
    var boardStrip = r.boardSVG
      ? '<div style="border-radius:12px;background:' + T.panelDeep
        + ';border:1px solid ' + T.border + ';padding:8px;margin-bottom:8px;'
        + 'max-width:220px">' + r.boardSVG + '</div>'
      : '';

    var opts = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">';
    for (var oi = 0; oi < r.options.length; oi++) {
      var mark = '', mc = '';
      if (oi === r.correctIdx) { mark = '\u2713'; mc = T.ok; }
      if (pick === oi && oi !== r.correctIdx) { mark = '\u2715'; mc = T.bad; }
      else if (pick === oi && oi === r.correctIdx) { mc = T.borderActive; }
      opts += tile(r.options[oi], mark, mc || T.border);
    }
    opts += '</div>';

    var detail = boardStrip + opts + guesses;

    return '<details style="background:' + T.panelDeep + ';border:1px solid '
      + T.border + ';border-radius:12px;padding:8px 12px"'
      + ' open>' // expanded by default on the final scoreboard, collapsible
      + '<summary style="cursor:pointer;display:flex;align-items:center;gap:8px;'
      + 'list-style:none;outline:none">' + summaryLeft + summaryRight + '</summary>'
      + '<div style="margin-top:10px;color:' + T.text + ';font-size:12.8px">'
      + detail + '</div></details>';
  }

  function renderGuesses(r, me) {
    var keys = Object.keys(r.picks || {}).sort();
    if (!keys.length) {
      return '<div style="color:' + T.disabled + ';font-size:12px">No responses.</div>';
    }
    var rows = '';
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var p = r.picks[k];
      var t = (k in r.timesMs) ? fmtTime(r.timesMs[k]) : '—';
      var mine = k === me;
      var verdict = p === r.correctIdx
        ? '<span style="color:' + T.ok + ';font-weight:700">\u2713</span>'
        : '<span style="color:' + T.bad + ';font-weight:700">\u2715</span>';
      var stripe = mine ? 'background:rgba(43,116,235,.14);'
        : (i % 2 ? 'background:rgba(255,255,255,.02);' : '');
      rows += '<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;'
        + 'border-radius:8px;' + stripe + '">'
        + '<span style="flex:1;color:' + (mine ? T.text : T.muted)
        + (mine ? ';font-weight:700' : '') + '">' + esc(k) + '</span>'
        + '<span style="color:' + T.muted + ';font-variant-numeric:tabular-nums">'
        + esc(t) + '</span><span style="min-width:52px;text-align:right;color:'
        + T.text + '">Option ' + esc(p === -1 ? '—' : String(p)) + '</span>'
        + verdict + '</div>';
    }
    return '<div style="font-size:11px;font-weight:700;letter-spacing:.12em;'
      + 'text-transform:uppercase;color:' + T.muted + ';margin-bottom:4px">'
      + esc('Guesses') + '</div><div>' + rows + '</div>';
  }

  /* ── export ────────────────────────────────────────────────────────────── */

  const Review = {
    beginMatch: beginMatch,
    snap: snap,
    matchRecord: matchRecord,
    renderFor: renderFor
  };

  root.IQ.Review = Review;
  if (typeof module !== 'undefined' && module.exports) module.exports = Review;
})();
