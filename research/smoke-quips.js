/* research/smoke-quips.js — node harness for ../pack-quips-w4.js against the
 * REAL hooks.js. Run: node research/smoke-quips.js   (exit 0 = pass)
 *
 * Proves:
 *   1. registration lands (direct or via IQ.__hooksPending drain)
 *   2. once-per-run semantics for EVERY trigger (second occurrence is silent)
 *   3. rounds 1-2 stay fully inert (C8 parity rail)
 *   4. dragon-remembers fires only after burn-then-correct, exactly once
 *   5. critter-first / shrine-complete ride 'gs:critters' transitions, say()
 *      channel only (never bannerText — popcult-b owns that slot)
 *   6. nuke-survived: >50 hp start + <=3 reveal, once
 *   7. sanctuary-first returns bannerText once per run
 *   8. layer-five speaks once when IQ.HellHeaven.layer() >= 5
 *   9. a fresh beginRun() re-arms every trigger (per-run lifecycle)
 *  10. cosmetic-only emissions; pool hygiene <= 80 chars; determinism scan
 */
'use strict';
const path = require('path');

/* ---- minimal environment: no DOM needed; DemonSay stubbed as recorder ---- */
global.window = globalThis;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.document = undefined;

require(path.join(__dirname, '..', 'hooks.js'));

const IQ = global.IQ;
let failures = 0, passes = 0;
function ok(cond, msg) {
  if (cond) { passes++; console.log('  ok - ' + msg); }
  else { failures++; console.log('  FAIL - ' + msg); }
}

/* DemonSay recorder BEFORE loading the pack (pack resolves it lazily anyway). */
const spoken = [];
global.IQ.DemonSay = {
  say: function (text, opts) { spoken.push({ text: String(text), priority: opts && opts.priority }); }
};

/* Load pack AFTER hooks.js so registration goes the direct-add path. */
const pack = require(path.join(__dirname, '..', 'pack-quips-w4.js'));

ok(!!IQ.Hooks, 'real hooks.js loaded');
ok(!!IQ.Hooks._packs.find(p => p.id === 'quips-w4'), 'quips-w4 registered with real hooks.js');
ok(pack && typeof pack.selfTest === 'function', 'module exports selfTest');

/* helpers -------------------------------------------------------------- */
function ctxOf(round, extra) {
  const c = { round: round, world: 'cave', align: 'chaotic', hp: 80,
    score: 0, streak: 0, seed: 7,
    rng: (function () { let s = 12345; return function () { s = (s * 1103515245 + 12345) >>> 0; return (s % 10000) / 10000; }; })() };
  if (extra) for (const k in extra) c[k] = extra[k];
  return c;
}
function spokenSince(n) { return spoken.slice(n); }

console.log('\n[embedded selfTest]');
const st = pack.selfTest();
for (const c of st.checks) ok(c.ok, 'selfTest: ' + c.name + (c.ok ? '' : ' :: ' + c.detail));

/* ---- fresh run against real hooks.js ---------------------------------- */
IQ.Hooks.beginRun('smoke-quips-1', 42);
spoken.length = 0;

/* 3. parity: rounds 1-2 inert even on perfect trigger conditions */
{
  const before = spoken.length;
  IQ.Hooks.state.set('gs:critters', 63);
  IQ.Hooks.dispatch('onAnswer', ctxOf(2, { res: { correct: true } }));
  IQ.Hooks.dispatch('onRoundStart', ctxOf(1, { world: 'heaven', align: 'good', hp: 80 }));
  IQ.Hooks.dispatch('onReveal', ctxOf(2, { hp: 1 }));
  ok(spoken.length === before, 'rounds 1-2: zero speech');
  IQ.Hooks.state.del('gs:critters');   /* do not pre-spend the critter triggers */
}

/* 4. dragon-remembers */
{
  IQ.Hooks.state.set('pack-cavern:dragonRound', 5);
  IQ.Hooks.dispatch('onRoundStart', ctxOf(5));
  IQ.Hooks.dispatch('onReveal', ctxOf(5, { res: { correct: false }, hp: 70 }));
  let mods = IQ.Hooks.dispatch('onAnswer', ctxOf(6, { res: { correct: true } }));
  const banner = mods.find(m => m && typeof m.bannerText === 'string');
  ok(!!banner && /DRAGON REMEMBERS|DRAGON TELLS|SCORCHED/.test(banner.bannerText),
    'dragon quip rides bannerText after burn+correct: ' + (banner && banner.bannerText));

  /* second burn+correct in the same run: silent */
  IQ.Hooks.state.set('pack-cavern:dragonRound', 9);
  IQ.Hooks.dispatch('onRoundStart', ctxOf(9));
  IQ.Hooks.dispatch('onReveal', ctxOf(9, { res: { correct: false }, hp: 65 }));
  mods = IQ.Hooks.dispatch('onAnswer', ctxOf(10, { res: { correct: true } }));
  ok(!mods.some(m => m && typeof m.bannerText === 'string' && /DRAGON|SCORCHED/.test(m.bannerText)),
    'dragon quip is once-per-run');

  /* correct answer with NO preceding burn: silent */
  mods = IQ.Hooks.dispatch('onAnswer', ctxOf(11, { res: { correct: true } }));
  ok(!mods.some(m => m && typeof m.bannerText === 'string' && /DRAGON|SCORCHED/.test(m.bannerText)),
    'no dragon quip without a burn');
}

/* 5. critters + shrine */
{
  const n = spoken.length;
  IQ.Hooks.state.set('gs:critters', 1);
  IQ.Hooks.dispatch('onAnswer', ctxOf(12, { res: { correct: true } }));
  ok(spoken.length === n + 1 && /ADOPTED|BEAST|FOLLOWED/.test(spoken[n].text),
    'first critter catch speaks exactly one line: ' + (spoken[n] && spoken[n].text));
  ok(spoken[n].priority === 'ambient', 'critter line routed through DemonSay at ambient priority');

  /* more catches: silent */
  IQ.Hooks.state.set('gs:critters', 1 | 2 | 32);
  IQ.Hooks.dispatch('onAnswer', ctxOf(13, { res: { correct: true } }));
  ok(spoken.length === n + 1, 'subsequent catches stay silent (critter-first already spent)');

  /* shrine completes */
  IQ.Hooks.state.set('gs:critters', 63);
  IQ.Hooks.dispatch('onAnswer', ctxOf(14, { res: { correct: true } }));
  ok(spoken.length === n + 2 && /ALL SIX|FULL SET|MANTLEPIECE/.test(spoken[n + 1].text),
    'shrine completion speaks exactly one line: ' + (spoken[n + 1] && spoken[n + 1].text));
  let mods = IQ.Hooks.dispatch('onAnswer', ctxOf(15, { res: { correct: true } }));
  ok(spoken.length === n + 2 &&
     !mods.some(m => m && typeof m.bannerText === 'string' && /SHRINE WEEPS|FULL SET/.test(m.bannerText)),
    'post-completion answers are silent');
}

/* 6. nuke-survived */
{
  const n = spoken.length;
  IQ.Hooks.dispatch('onRoundStart', ctxOf(20, { hp: 80 }));
  IQ.Hooks.dispatch('onReveal', ctxOf(20, { hp: 1 }));
  ok(spoken.length === n + 1 && /UNTHINKABLE|FLASH|ATOM/.test(spoken[n].text),
    'nuke survival speaks exactly one line: ' + (spoken[n] && spoken[n].text));
  IQ.Hooks.dispatch('onRoundStart', ctxOf(21, { hp: 90 }));
  IQ.Hooks.dispatch('onReveal', ctxOf(21, { hp: 2 }));
  ok(spoken.length === n + 1, 'nuke quip is once-per-run');
  /* big damage but not <=3: never arms a false positive */
  IQ.Hooks.dispatch('onRoundStart', ctxOf(22, { hp: 60 }));
  IQ.Hooks.dispatch('onReveal', ctxOf(22, { hp: 40 }));
  ok(spoken.length === n + 1, 'non-lethal reveal stays quiet');
}

/* 7. sanctuary-first */
{
  let mods = IQ.Hooks.dispatch('onRoundStart', ctxOf(30, { world: 'heaven', align: 'good', hp: 90 }));
  const banner = mods.find(m => m && typeof m.bannerText === 'string');
  ok(!!banner && /NEVER TRULY LEFT|SEAT WARM|HYMNS/.test(banner.bannerText),
    'first sanctuary returns bannerText: ' + (banner && banner.bannerText));
  mods = IQ.Hooks.dispatch('onRoundStart', ctxOf(31, { world: 'heaven', align: 'good', hp: 90 }));
  ok(!mods.some(m => m && typeof m.bannerText === 'string' && /NEVER TRULY LEFT|SEAT WARM|HYMNS/.test(m.bannerText)),
    'sanctuary quip is once-per-run');
}

/* 8. layer-five */
{
  const realHH = global.IQ.HellHeaven;
  global.IQ.HellHeaven = { layer: () => 5 };
  const n = spoken.length;
  IQ.Hooks.dispatch('onRoundStart', ctxOf(40));
  ok(spoken.length === n + 1 && /FLOOR HAS OPINIONS|STAIRS JUDGE|REGRET/.test(spoken[n].text),
    'layer>=5 speaks exactly one line: ' + (spoken[n] && spoken[n].text));
  IQ.Hooks.dispatch('onRoundStart', ctxOf(41));
  ok(spoken.length === n + 1, 'layer-five quip is once-per-run');
  if (realHH) global.IQ.HellHeaven = realHH; else delete global.IQ.HellHeaven;
}

/* 10a. cosmetic-only audit across everything emitted this run */
{
  /* re-arm nothing; just verify no scoring field ever appeared on any mod we
   * produced by dispatching one of each event and scanning results */
  const mods = [].concat(
    IQ.Hooks.dispatch('onRoundStart', ctxOf(50)) || [],
    IQ.Hooks.dispatch('onAnswer', ctxOf(51, { res: { correct: true } })) || [],
    IQ.Hooks.dispatch('onReveal', ctxOf(52, { hp: 10 })) || []
  );
  ok(mods.every(m => !m || (m.points == null && m.hpDelta == null && m.scoreDelta == null &&
                            m.scoreMul == null && m.disableOptionIdx == null && m.timerDelta == null)),
    'all emitted modifiers are cosmetic-only');
}

/* ---- 9. fresh run re-arms every trigger -------------------------------- */
IQ.Hooks.beginRun('smoke-quips-2', 43);
spoken.length = 0;
{
  /* sanctuary fires again on the new run */
  let mods = IQ.Hooks.dispatch('onRoundStart', ctxOf(30, { world: 'heaven', align: 'good', hp: 90 }));
  ok(mods.some(m => m && typeof m.bannerText === 'string'),
    'fresh run: sanctuary-first armed again');

  /* dragon cycle again */
  IQ.Hooks.state.set('pack-cavern:dragonRound', 5);
  IQ.Hooks.dispatch('onRoundStart', ctxOf(5));
  IQ.Hooks.dispatch('onReveal', ctxOf(5, { res: { correct: false } }));
  mods = IQ.Hooks.dispatch('onAnswer', ctxOf(6, { res: { correct: true } }));
  ok(mods.some(m => m && typeof m.bannerText === 'string'), 'fresh run: dragon quip armed again');

  /* critter again */
  const n = spoken.length;
  IQ.Hooks.state.set('gs:critters', 1);
  IQ.Hooks.dispatch('onAnswer', ctxOf(7, { res: { correct: true } }));
  ok(spoken.length === n + 1, 'fresh run: critter-first armed again');

  /* nuke again */
  IQ.Hooks.dispatch('onRoundStart', ctxOf(8, { hp: 99 }));
  IQ.Hooks.dispatch('onReveal', ctxOf(8, { hp: 3 }));
  ok(spoken.some(s => /UNTHINKABLE|FLASH|ATOM/.test(s.text)), 'fresh run: nuke quip armed again');
}
{
  const fs = require('fs');
  const raw = fs.readFileSync(path.join(__dirname, '..', 'pack-quips-w4.js'), 'utf8');
  /* strip comments AND the embedded selfTest (whose own assertions quote the
   * banned tokens as string literals) — we audit live code only */
  const body = raw.slice(0, raw.indexOf('embedded self test'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ok(!/Math\.random|Date\.now|performance\.now/.test(body),
    'zero Math.random/Date.now/performance.now in pack source');
  const poolSrc = raw.match(/const POOLS = \{[\s\S]*?\n\};/)[0];
  const lines = poolSrc.split('\n').filter(l => /'/.test(l) && !/POOLS|: \[/.test(l));
  ok(lines.every(l => (l.match(/'[^']*'/g) || []).every(t => t.length - 2 <= 80)),
    'every quip variant is <= 80 chars');
}

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
