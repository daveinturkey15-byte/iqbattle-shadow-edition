#!/usr/bin/env node
/* ============================================================================
 * smoke-hellskin.js — headless lifecycle proof for hell-skin.js
 * Stubs a minimal DOM (body.classList, head.appendChild, createElement) and
 * drives HellSkin.apply() through the full round lifecycle:
 *   parity inert -> L4 escalation -> sanctuary calm -> hostile again
 * Also proves the <style> block is injected exactly once.
 * Run: node research/smoke-hellskin.js
 * ==========================================================================*/
'use strict';

/* ---- minimal DOM stub ---- */
function makeClassList() {
  var set = new Set();
  return {
    add: function (c) { set.add(c); },
    remove: function (c) { set.delete(c); },
    contains: function (c) { return set.has(c); },
    snapshot: function () { return Array.from(set).sort(); }
  };
}
var appendedStyles = [];
global.document = {
  head: {
    appendChild: function (el) {
      if (el && el.id === 'hh-skin-style') appendedStyles.push(el);
    }
  },
  body: { classList: makeClassList() },
  createElement: function () { return { id: '', textContent: '' }; },
  getElementById: function (id) {
    for (var i = 0; i < appendedStyles.length; i++) {
      if (appendedStyles[i].id === id) return appendedStyles[i];
    }
    return null;
  }
};

var skin = require('../hell-skin.js');
var api = skin.api;
var body = global.document.body.classList;

var failures = 0;
function check(name, cond) {
  if (!cond) failures++;
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name);
}

/* ---- 1. style injected exactly once across many applies ---- */
api.apply({ round: 3, align: 'bad' });
api.apply({ round: 4, align: 'bad' });
check('style block injected', appendedStyles.length === 1);
check('style defines all 7 layers',
  /hh-layer-7/.test(appendedStyles[0].textContent) &&
  /hh-layer-1\b/.test(appendedStyles[0].textContent));
check('vignette escalates to .55 at L7 and starts .15 at L1',
  appendedStyles[0].textContent.indexOf('rgba(8,2,10,0.15)') !== -1 &&
  appendedStyles[0].textContent.indexOf('rgba(8,2,10,0.55)') !== -1);
check('glyph containers never selected by injected css',
  !/hh-layer-\d[^{]*\.opt-btn/.test(appendedStyles[0].textContent) &&
  !/hh-layer-\d[^{]*\.board-frame/.test(appendedStyles[0].textContent));

/* ---- 2. parity rounds 1-2 fully inert ---- */
api.clear();
api.apply({ round: 1, align: 'bad' });
check('round 1 inert: no hh classes',
  body.snapshot().filter(function (c) { return c.indexOf('hh-') === 0; }).length === 0);

/* ---- 3. hostile round at layer 4 -> hh-layer-4 present ---- */
global.IQ = global.IQ || {};
global.IQ.HellHeaven = { layer: function () { return 4; } };
api.apply({ round: 5, align: 'chaotic' });
check('L4 hostile: hh-layer-4 present', body.contains('hh-layer-4'));
check('L4 hostile: no hh-calm', !body.contains('hh-calm'));

/* ---- 4. sanctuary round -> calm, layers stripped ---- */
delete global.IQ.HellHeaven; /* sanctuary must not need it */
api.apply({ round: 6, world: 'heaven' });
check('sanctuary: hh-calm present', body.contains('hh-calm'));
check('sanctuary: all hh-layer-* stripped',
  body.snapshot().filter(function (c) { return /^hh-layer-/.test(c); }).length === 0);

/* ---- 5. next hostile round -> calm removed, layer back on ---- */
global.IQ.HellHeaven = { layer: function () { return 2; } };
api.apply({ round: 7, align: 'bad' });
check('post-sanctuary hostile: hh-calm removed', !body.contains('hh-calm'));
check('post-sanctuary hostile: hh-layer-2 present', body.contains('hh-layer-2'));

/* ---- 6. defensive: missing/lying HellHeaven degrades to layer 1, no throw ---- */
delete global.IQ.HellHeaven;
api.apply({ round: 9, align: 'bad' });
check('missing HellHeaven api: falls back to hh-layer-1', body.contains('hh-layer-1'));

console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED'
  : '\n' + failures + ' SMOKE CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
