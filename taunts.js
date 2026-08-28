/* taunts.js — IQ.Taunts: CONTEXTUAL demon taunts for IQ Battle: Shadow.
   The shell feeds failure/streak events; demons mock the SPECIFIC mistake.
   Hooks: onWrong(round, kind) | onStreak(n) | onImpossible.
   Renders through IQ.DemonSay.say when present; console-safe no-op otherwise.
   All lines <80 chars. Original fan-art persona: Shadow's court. */
(function () {
  'use strict';

  /* --- pools ---------------------------------------------------------- */
  var WRONG = {
    timeout: [
      "Too slow. BEELZEBOT solved that before the timer loaded.",
      "The clock won. It always wins. Ask MALGORATH.",
      "Time expired. So did my patience, rounds ago.",
      "You hesitated. LILITH.EXE logged it. Forever.",
      "Slow. Glacial. A rock would've at least guessed.",
      "That timer wasn't a suggestion. Too slow.",
    ],
    matrix: [
      "Patterns are hard. BEELZEBOT does them in his sleep.",
      "A grid defeated you. MALGORATH is laughing in binary.",
      "It was literally right there. In a pattern. Alas.",
      "LILITH.EXE predicts your next matrix fail. She's never wrong.",
      "Shapes. You were beaten by shapes.",
      "Pattern recognition: pending update. Check back never.",
    ],
    sequence: [
      "Order matters. MALGORATH ordered you to fail. Done.",
      "You shuffled chaos. BEELZEBOT files things alphabetically.",
      "Sequence broken. So was your concentration.",
      "LILITH.EXE replayed that order perfectly. You? Adorable.",
      "One step out of place. One ego deflated.",
      "The sequence was simple. Your plan was simpler.",
    ],
    count: [
      "Miscounted. BEELZEBOT counts your failures nightly.",
      "Math. On tiny tiles. MALGORATH weeps with joy.",
      "The total was small. Your miss was enormous.",
      "LILITH.EXE counted faster. She doesn't even have fingers.",
      "Numbers betrayed you. As prophesied.",
      "Close. In the way zero is close to one.",
    ],
    fallback: [
      "Wrong. The court expected nothing less.",
      "BEELZEBOT bet on you failing. He just got richer.",
      "MALGORATH carved your error into the throne room floor.",
      "Incorrect. LILITH.EXE is adding it to your file.",
      "Bold guess. Deeply, historically wrong.",
      "Even my shadow saw that one coming.",
    ]
  };

  var STREAK = {
    low: [ /* streak 1-2 */
      "A streak? Of one or two. BEELZEBOT isn't worried.",
      "Two right. Coin-flip territory. Keep flapping.",
      "MALGORATH calls this a warm-up. He's being polite.",
      "Small streaks amuse the court. Briefly.",
      "LILITH.EXE rates your odds of continuing: laughable.",
      "Don't preen. Even broken clocks score twice.",
    ],
    mid: [ /* streak 3-4 */
      "Three-plus. MALGORATH has stopped laughing. Slightly.",
      "This streak offends BEELZEBOT. He's recalculating.",
      "Consistent. Suspicious. LILITH.EXE is investigating.",
      "Four straight. I'm watching now. Don't enjoy it.",
      "The court whispers your name. With confusion.",
      "A real streak. I hate that it's mildly interesting.",
    ],
    high: [ /* streak 5-7 */
      "Five or more. Fine. MALGORATH nods. That's rare.",
      "BEELZEBOT has stopped betting against you. He hates it.",
      "LILITH.EXE upgraded your file from 'snack' to 'concern'.",
      "This streak is becoming an inconvenience. Well played.",
      "Respect. Grudging, minimal, but issued by the crown.",
      "Keep going and I'll admit you exist. Almost there.",
    ],
    epic: [ /* streak 8+ */
      "Eight-plus. The court stands. Sit back down anyway.",
      "BEELZEBOT is refunding bets. This is your fault.",
      "MALGORATH requests an alliance. Denied. But requested.",
      "LILITH.EXE has archived your streak under 'legends'.",
      "Ultimate? No. Getting closer than I'd like though.",
      "Fine. FINE. You're not entirely hopeless. Tell no one.",
    ]
  };

  var IMPOSSIBLE = [
    "IMPOSSIBLE MODE! Finally. MALGORATH, fetch popcorn.",
    "Impossible chosen. BEELZEBOT is already mourning you.",
    "Oh HO. Impossible? LILITH.EXE, roll the tape on this fool.",
    "The impossible path. I picked it for you. Enjoy doom.",
    "Impossible mode. My favorite flavor of mortal regret.",
    "Bold. Doomed. Delicious. The court applauds your demise.",
  ];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* --- rendering ------------------------------------------------------ */
  function show(text) {
    if (window.IQ && window.IQ.DemonSay && typeof window.IQ.DemonSay.say === 'function') {
      try { window.IQ.DemonSay.say(text); } catch (e) { /* stay silent */ }
    }
    /* else: console-safe no-op */
  }

  function wrongPool(kind) {
    if (kind && WRONG[kind]) return WRONG[kind];
    return WRONG.fallback;
  }

  function streakBucket(n) {
    if (n >= 8) return STREAK.epic;
    if (n >= 5) return STREAK.high;
    if (n >= 3) return STREAK.mid;
    return STREAK.low;
  }

  /* --- public API (mirrors shell hooks) ------------------------------- */
  window.IQ = window.IQ || {};

  window.IQ.Taunts = {
    /** Mock a SPECIFIC failure. kind: 'timeout' | 'matrix' | ... */
    onWrong: function (round, kind) {
      void round; // reserved: round-scaled venom later
      show(pick(wrongPool(kind)));
    },
    /** Escalating respect as streak grows. */
    onStreak: function (n) {
      show(pick(streakBucket(n)));
    },
    /** Player chose the impossible path. Demons delight. */
    onImpossible: function () {
      show(pick(IMPOSSIBLE));
    }
  };
})();
