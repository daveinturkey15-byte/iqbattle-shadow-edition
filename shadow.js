/* IQ.Shadow — corruption persona for IQ VERSUS (degrades into IQ VERSUS: SHADOW).
   Text quips + original abstract SVG silhouette only. No copyrighted assets. */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var IQ = root.IQ || (root.IQ = {});

  // ---------- quip pools ----------
  var POOLS = {
    appear: [
      "Welcome to the shadow realm.",
      "The ultimate lifeform has opinions about your answers.",
      "This is who I am.",
      "I'm the coolest.",
      "You wanted a quiz. You got me.",
      "Where there's light, there's my shadow. And my trivia."
    ],
    zap: [
      "Zap. That's the sound of your streak dying.",
      "Chaos lightning. Very on-brand.",
      "Feel the power of darkness. And static electricity.",
      "I didn't even try that hard.",
      "Consider that a warning shot from the void.",
      "BZZT. Ultimate lifeform, ultimate voltage."
    ],
    subtle: [
      "Did the walls just flicker? No? Hm.",
      "Nothing happened. Keep going.",
      "That glitch was a coincidence. Probably.",
      "I'm barely doing anything. Barely.",
      "Reality is negotiable. Scores are not.",
      "You saw nothing. This is who I am."
    ],
    wrong: [
      "Wrong. The shadows laugh with me.",
      "Even the ultimate lifeform knew that one.",
      "Your brain lagged. Mine doesn't.",
      "Darkness claims another point.",
      "Pitiful. Try thinking in black and crimson.",
      "That answer was a bad fan theory."
    ],
    right: [
      "Lucky guess. The void is watching.",
      "Fine. That one was acceptable.",
      "Hmph. Don't get comfortable.",
      "Correct. Chaos approves, reluctantly.",
      "Even broken clocks. Even you.",
      "A point for you. A debt for later."
    ],
    round3: [
      "Round three. Now it gets dark. Literally.",
      "Halfway to nowhere. My favorite place.",
      "The palette bends to my will now.",
      "Round three: welcome to the shadow realm, again.",
      "I've decided this round belongs to me.",
      "Three rounds deep. Still the coolest."
    ],
    round6: [
      "Round six. The final form approaches.",
      "Six rounds in and reality's getting thin.",
      "My questions now. My rules now.",
      "The endgame wears black.",
      "Round six. Do you feel it? The dread?",
      "Almost over. Almost mine."
    ],
    relic: [
      "A relic of pure chaos. Handle with dread.",
      "That artifact hums with my frequency.",
      "Relics remember. So do I.",
      "Grab it before the darkness reclaims it.",
      "One relic. Infinite attitude.",
      "It chose you. Poor relic."
    ],
    impossible: [
      "This question has no right answer. Like my backstory.",
      "Impossible mode. You're welcome.",
      "Even I don't know this one. And I'm perfect.",
      "Good luck, mortal. Sincerely.",
      "This one came straight from the void.",
      "No hints. No mercy. No logic."
    ],
    win: [
      "You won. I allowed it.",
      "Victory suits you. It would look better in black.",
      "The ultimate lifeform concedes. Once.",
      "Enjoy it. Shadows have long memories.",
      "You beat the darkness. Bold.",
      "This is who I am. Gracious. Rarely."
    ],
    lose: [
      "Losing to me is a rite of passage.",
      "The shadow realm has excellent snacks. Stay a while.",
      "Skill issue. Void issue. Same thing.",
      "Come back when you glow harder.",
      "Darkness wins. As scheduled.",
      "Don't cry. It fogs up my aura."
    ]
  };

  function pick(pool, rng) {
    if (!pool || !pool.length) return '';
    var i = rng ? Math.floor(rng() * pool.length) : Math.floor(Math.random() * pool.length);
    return pool[Math.min(i, pool.length - 1)];
  }

  // Deterministic PRNG (mulberry32).
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- public API ----------
  var Shadow = {};

  Shadow.quip = function (ctx) {
    return pick(POOLS[ctx] || POOLS.subtle, null);
  };

  // Original abstract silhouette: black hedgehog-ish head, 3 crimson
  // streak spikes, glowing red eyes. Pure geometry, not traced.
  Shadow.avatarSVG = function (size) {
    size = size || 44;
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
      '" viewBox="0 0 64 64" role="img" aria-label="shadow persona">' +
      '<defs><radialGradient id="iqshGlow" cx="50%" cy="50%" r="60%">' +
      '<stop offset="0%" stop-color="#ff2038" stop-opacity=".9"/>' +
      '<stop offset="100%" stop-color="#ff2038" stop-opacity="0"/>' +
      '</radialGradient></defs>' +
      // three back-swept crimson streak spikes (abstract)
      '<path d="M30 26 L2 10 L24 32 Z" fill="#c01028"/>' +
      '<path d="M34 22 L14 -2 L38 24 Z" fill="#e01830"/>' +
      '<path d="M38 20 L36 -6 L46 22 Z" fill="#a00c22"/>' +
      // head: angular dark mass
      '<path d="M18 34 C16 48 24 58 33 59 C44 60 52 52 53 42 C54 33 49 25 41 23 C40 17 35 13 29 15 C24 17 21 21 21 26 C19 28 18 31 18 34 Z" fill="#0a0a0f" stroke="#1a1a26" stroke-width="1.5"/>' +
      // muzzle hint (darker facet)
      '<path d="M33 47 L45 45 L41 55 Z" fill="#141420"/>' +
      // eyes: glowing red slants
      '<ellipse cx="27" cy="36" rx="5.5" ry="3.4" transform="rotate(-18 27 36)" fill="url(#iqshGlow)"/>' +
      '<ellipse cx="43" cy="34" rx="5.5" ry="3.4" transform="rotate(12 43 34)" fill="url(#iqshGlow)"/>' +
      '<ellipse cx="27" cy="36" rx="2.6" ry="1.7" transform="rotate(-18 27 36)" fill="#ff3040"/>' +
      '<ellipse cx="43" cy="34" rx="2.6" ry="1.7" transform="rotate(12 43 34)" fill="#ff3040"/>' +
      '</svg>'
    );
  };

  // Styled speech bubble, fixed bottom-right, max 2 stacked, auto-fade 4s.
  Shadow.say = function (text, opts) {
    opts = opts || {};
    if (typeof document === 'undefined') return;
    var wrap = document.getElementById('iq-shadow-bubbles');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'iq-shadow-bubbles';
      wrap.style.cssText =
        'position:fixed;right:18px;bottom:18px;display:flex;flex-direction:column;' +
        'gap:10px;z-index:9999;pointer-events:none;font-family:sans-serif;';
      document.body.appendChild(wrap);
    }
    // keep at most 2 stacked bubbles
    while (wrap.children.length >= 2) wrap.removeChild(wrap.firstChild);

    var b = document.createElement('div');
    b.style.cssText =
      'display:flex;align-items:center;gap:10px;background:#050508;' +
      'border:1px solid #c01028;border-radius:12px;padding:10px 14px;' +
      'color:#ff9aa6;font-size:13px;line-height:1.35;max-width:300px;' +
      'box-shadow:0 0 18px rgba(255,32,56,.25);opacity:0;' +
      'transition:opacity .3s ease;';
    b.innerHTML = Shadow.avatarSVG(44);

    var t = document.createElement('span');
    t.textContent = text || '';
    b.appendChild(t);
    wrap.appendChild(b);

    requestAnimationFrame(function () { b.style.opacity = '1'; });
    setTimeout(function () {
      b.style.opacity = '0';
      setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 350);
    }, 4000);

    // dark rumble voice
    if (opts.voice && typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined') {
      try {
        window.speechSynthesis.cancel();
        var u = new window.SpeechSynthesisUtterance(text || '');
        u.rate = 0.82;
        u.pitch = 0.35;
        window.speechSynthesis.speak(u);
      } catch (e) { /* voice unavailable */ }
    }
  };

  // Per-round corruption effects. Deterministic via mulberry32(round*7919)
  // unless an explicit rng is supplied.
  Shadow.TIMELINE = function (round, totalRounds, rng) {
    var rand = rng || mulberry32((round | 0) * 7919);
    var r = round | 0;

    // zapAtFraction: only round 1 gets an exact mid-round zap moment.
    var zapAtFraction = null;
    if (r === 1) {
      zapAtFraction = 0.45 + rand() * 0.10; // 0.45–0.55
    }

    var paletteLevel = 0;
    if (r >= 7) paletteLevel = 3;
    else if (r >= 5) paletteLevel = 2;
    else if (r >= 3) paletteLevel = 1;

    var corruptChance = 0;
    if (r >= 4) corruptChance = Math.min(0.15 + 0.05 * (r - 4), 0.35);

    var impossibleChance = 0;
    if (r >= 6) impossibleChance = Math.min(0.12, 0.2);

    return {
      zapAtFraction: zapAtFraction,
      subtleGlitch: r === 2,
      paletteLevel: paletteLevel,
      corruptChance: corruptChance,
      shadowTalks: r >= 3,
      impossibleChance: impossibleChance
    };
  };

  IQ.Shadow = Shadow;

  // Node guard export.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { IQ: IQ, Shadow: Shadow };
  }
})();
