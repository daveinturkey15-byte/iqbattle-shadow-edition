/* smoke-sanctuary.js — node harness for ../sanctuary.js against the REAL
 * hooks.js. Run: node research/smoke-sanctuary.js   (exit 0 = pass)
 *
 * Covers:
 *  - apply() adds .iqv-sanctuary to body; clear() removes it; isActive()
 *  - <style id="iqv-sanctuary-css"> injected exactly once across rounds
 *  - continuation banner fires once with the stored prev depth, then
 *    'sanctuary:lastDepth' updates; 'sanctuary:count' accumulates
 *  - clear on onReveal / onInterlude / non-good onRoundStart
 */
'use strict';
const path = require('path');

/* ---- minimal DOM stub ---- */
const styleEls = [];
const bodyClass = new Set();
global.document = {
  head: { appendChild(el) { styleEls.push(el); } },
  body: {
    classList: {
      add(c) { bodyClass.add(c); },
      remove(c) { bodyClass.delete(c); },
      contains(c) { return bodyClass.has(c); }
    }
  },
  createElement() { return { id: '', textContent: '' }; },
  getElementById(id) { return styleEls.find(s => s.id === id) || null; }
};
global.window = globalThis;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

require(path.join(__dirname, '..', 'hooks.js'));
require(path.join(__dirname, '..', 'sanctuary.js'));

const IQ = global.IQ;
let failures = 0, passes = 0;
function ok(cond, msg) {
  if (!cond) { failures++; console.error('FAIL: ' + msg); }
  else { passes++; console.log('pass: ' + msg); }
}

ok(!!IQ.Hooks, 'real hooks.js loaded');
ok(!!IQ.Sanctuary && typeof IQ.Sanctuary.apply === 'function', 'IQ.Sanctuary exported with apply/clear/isActive');

/* ---- 1. apply / clear / isActive ---- */
ok(IQ.Sanctuary.isActive() === false, 'inactive before apply');
ok(IQ.Sanctuary.apply() === true, 'apply() reports newly applied');
ok(IQ.Sanctuary.isActive() === true, 'isActive() after apply');
ok(bodyClass.has('iqv-sanctuary'), 'body has .iqv-sanctuary');
ok(IQ.Sanctuary.apply() === false, 'apply() idempotent');
ok(IQ.Sanctuary.clear() === true, 'clear() reports newly cleared');
ok(IQ.Sanctuary.isActive() === false, 'isActive() after clear');
ok(IQ.Sanctuary.clear() === false, 'clear() idempotent');

/* ---- 2. hook dispatch: first sanctuary round (no banner yet) ---- */
IQ.Hooks.beginRun('smoke-run-1', 1234);
let mods = IQ.Hooks.dispatch('onRoundStart', { world: 'heaven', align: 'good', depth: 5 });
ok(IQ.Sanctuary.isActive(), 'sanctuary active after heaven round start');
ok(Array.isArray(mods) && mods.length === 1 && mods[0].flag === 'sanctuary',
  'modifier {flag:"sanctuary"} emitted while active');
ok(mods[0].bannerText === undefined, 'no bannerText on FIRST sanctuary round');
ok(IQ.Hooks.state.get('sanctuary:lastDepth') === 5, "lastDepth stored as 5");
ok(IQ.Hooks.state.get('sanctuary:count') === 1, 'count is 1');

/* ---- 3. continuation banner fires with correct prev depth ---- */
mods = IQ.Hooks.dispatch('onRoundStart', { world: 'some-shadow-world', align: 'good', depth: 9 });
ok(mods.length === 1 && mods[0].flag === 'sanctuary', 'align:good also triggers sanctuary');
ok(mods[0].bannerText === 'THE LIGHT REMEMBERS YOU \u00B7 LAST REFUGE \u00B7 DEPTH 5',
  'continuation banner uses PREVIOUS depth (5), not current (9)');
ok(IQ.Hooks.state.get('sanctuary:lastDepth') === 9, 'lastDepth updated to current round (9)');
ok(IQ.Hooks.state.get('sanctuary:count') === 2, 'count accumulates to 2');

/* third sanctuary round: banner now says DEPTH 9 */
mods = IQ.Hooks.dispatch('onRoundStart', { world: 'heaven', align: 'neutral', depth: 12 });
ok(mods.length === 1 && mods[0].flag === 'sanctuary' &&
   mods[0].bannerText === 'THE LIGHT REMEMBERS YOU \u00B7 LAST REFUGE \u00B7 DEPTH 9',
  'third round banners previous depth 9');
ok(IQ.Hooks.state.get('sanctuary:count') === 3, 'count accumulates to 3');

/* ---- 4. clears ---- */
IQ.Hooks.dispatch('onReveal', { world: 'heaven', align: 'good', depth: 12 });
ok(!IQ.Sanctuary.isActive(), 'onReveal clears the skin');
IQ.Hooks.dispatch('onRoundStart', { world: 'heaven', align: 'good', depth: 13 });
ok(IQ.Sanctuary.isActive(), 're-applied on next sanctuary round');
IQ.Hooks.dispatch('onInterlude', { world: 'heaven', align: 'good', depth: 13 });
ok(!IQ.Sanctuary.isActive(), 'onInterlude clears the skin');
IQ.Hooks.dispatch('onRoundStart', { world: 'heaven', align: 'good', depth: 14 });
mods = IQ.Hooks.dispatch('onRoundStart', { world: 'shark-trench', align: 'bad', depth: 15 });
ok(!IQ.Sanctuary.isActive(), 'non-good onRoundStart clears the skin');
ok(mods.every(m => !m || m.flag !== 'sanctuary'), 'no sanctuary modifier on bad round');

/* ---- 5. style element injected exactly once ---- */
const cssEls = styleEls.filter(s => s.id === 'iqv-sanctuary-css');
ok(cssEls.length === 1, 'style#iqv-sanctuary-css injected exactly once');
ok(/rgb\(4, 8, 18\)|rgb\(4,8,18\)/.test(cssEls[0].textContent) &&
   cssEls[0].textContent.indexOf('linear-gradient(135deg, rgba(43,116,235,.14), transparent 36%)') !== -1,
  'injected CSS carries recon tokens');

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
