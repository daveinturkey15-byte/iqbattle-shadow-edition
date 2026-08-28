#!/usr/bin/env node
/* ============================================================
   smoke-landingpolish.js — headless smoke for landing-polish.js
   Stubbed DOM (no browser). Proves:
     S1  idempotent injection (style once, glyphs once, wrappers once)
     S2  HTP modal imperative roles + focus trap TAB cycle order
     S3  ESC closes modal and restores focus to #htp-link
     S4  room-name storage write path on #boot-host capture click,
         non-blocking, and restore-on-load
   Run: node research/smoke-landingpolish.js
   ============================================================ */
'use strict';
var fs = require('fs');
var path = require('path');

var SRC = fs.readFileSync(path.join(__dirname, '..', 'landing-polish.js'), 'utf8');
var failures = [];
function check(name, cond) {
  if (cond) { console.log('  ok  ' + name); }
  else { console.log('  FAIL ' + name); failures.push(name); }
}

/* ---------------- minimal DOM stub ---------------- */
function ClassList(el) {
  this._el = el; this._set = {};
}
ClassList.prototype.contains = function (c) { return !!this._set[c]; };
ClassList.prototype.add = function (c) { this._set[c] = 1; };
ClassList.prototype.remove = function (c) { delete this._set[c]; };
ClassList.prototype.toggle = function (c) { this._set[c] ? delete this._set[c] : (this._set[c] = 1); };

function El(tag, opts) {
  opts = opts || {};
  this.tagName = String(tag).toUpperCase();
  this.children = [];
  this.parentNode = null;
  this.attributes = {};
  this.style = {};
  this.listeners = {};
  this._class = new ClassList(this);
  this.classList = this._class;
  this._html = '';
  this.value = opts.value || '';
  this.disabled = false;
  if (opts.id) this.setAttribute('id', opts.id);
  if (opts.cls) this.setAttribute('class', opts.cls);
  if (opts.attrs) for (var k in opts.attrs) this.setAttribute(k, opts.attrs[k]);
}
Object.defineProperty(El.prototype, 'className', {
  get: function () { return Object.keys(this._class._set).join(' '); }
});
El.prototype.setAttribute = function (k, v) {
  this.attributes[k] = String(v);
  if (k === 'class') {
    this._class._set = {};
    String(v).split(/\s+/).forEach(function (c) { if (c) this._set[c] = 1; }, this._class);
  }
};
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); }
});
Object.defineProperty(El.prototype, 'textContent', {
  get: function () {
    var self = this;
    return this.children.map(function (c) { return c.textContent || ''; }).join('') ||
      self._html.replace(/<[^>]*>/g, '');
  },
  set: function (v) { this._html = String(v); }
});
El.prototype.appendChild = function (c) {
  c.parentNode = this; this.children.push(c); return c;
};
El.prototype.getAttribute = function (k) {
  return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
};
El.prototype.addEventListener = function (type, fn) {
  (this.listeners[type] = this.listeners[type] || []).push(fn);
};
El.prototype.click = function () {
  var fns = (this.listeners.click || []).slice();
  for (var i = 0; i < fns.length; i++) fns[i].call(this, { type: 'click' });
  if (typeof this.onclick === 'function') this.onclick.call(this, { type: 'click' });
};
El.prototype.focus = function () { DOC.activeElement = this; };

El.prototype.querySelector = function (s) { return qs(this, s); };
El.prototype.querySelectorAll = function (s) { return qsa(this, s); };
function matchCompound(el, c) {
  c = c.trim();
  if (!c) return false;
  var m = /^(.*?)(?::not\(\[([^\]]+)\]\))?$/.exec(c);
  var base = m[1], notAttr = m[2];
  if (notAttr && el.getAttribute(notAttr) != null) return false;
  var mm = /^(?:([a-z0-9]+))?(?:#([\w-]+))?((?:[.][\w-]+)*)(\[.+?\])?$/.exec(base);
  if (!mm || !base) return false;
  if (mm[1] && el.tagName !== mm[1].toUpperCase()) return false;
  if (mm[2] && el.getAttribute('id') !== mm[2]) return false;
  if (mm[3]) {
    var want = mm[3].split('.').filter(Boolean);
    var have = String(el.className || '').split(/\s+/).filter(Boolean);
    for (var i = 0; i < want.length; i++) if (have.indexOf(want[i]) < 0) return false;
  }
  if (mm[4]) {
    var am = /^\[(\w[-\w]*)(?:="?([^\]"]*)"?)?\]$/.exec(mm[4]);
    if (!am) return false;
    var av = el.getAttribute(am[1]);
    if (av == null) return false;
    if (am[2] !== undefined && av !== am[2]) return false;
  }
  return true;
}
function matchPart(el, part) {
  var steps = part.trim().split(/\s+/).filter(Boolean);
  if (!steps.length) return false;
  if (!matchCompound(el, steps[steps.length - 1])) return false;
  var anc = el.parentNode, i = steps.length - 2;
  while (i >= 0) {
    while (anc && !matchCompound(anc, steps[i])) anc = anc.parentNode;
    if (!anc) return false;
    anc = anc.parentNode; i--;
  }
  return true;
}
function matches(el, sel) {
  var parts = sel.split(',');
  for (var i = 0; i < parts.length; i++) if (matchPart(el, parts[i])) return true;
  return false;
}
function walkDescendants(root, out) {
  for (var i = 0; i < root.children.length; i++) {
    out.push(root.children[i]);
    walkDescendants(root.children[i], out);
  }
}
function qsa(root, sel) {
  var all = []; walkDescendants(root, all);
  return all.filter(function (e) { return matches(e, sel); });
}
function qs(root, sel) { var r = qsa(root, sel); return r.length ? r[0] : null; }

var DOC;
function makeDoc(withModalExtra) {
  var head = new El('head');
  var body = new El('body');
  var boot = new El('section', { id: 'scr-boot' });
  body.appendChild(boot);

  var link = new El('button', { id: 'htp-link', cls: 'link-quiet' }); link.textContent = 'HOW TO PLAY';
  boot.appendChild(link);

  var h1 = new El('h1', { cls: 'hero-h1' });
  h1.textContent = 'Challenge your friends with IQ-style logic.';
  boot.appendChild(h1);

  var row = new El('div', { cls: 'feat-row' });
  ['RANDOM PUZZLE GENERATION', 'NO REGISTRATION REQUIRED', 'INVITE FRIENDS EASILY'].forEach(function (t) {
    var card = new El('div', { cls: 'feat-card' });
    var b = new El('b'); b.textContent = t;
    var span = new El('span'); span.textContent = 'blurb';
    card.appendChild(b); card.appendChild(span); row.appendChild(card);
  });
  boot.appendChild(row);

  var cardBox = new El('div', { cls: 'boot-card' });
  cardBox.appendChild(new El('div', { cls: 'boot-logo' })).textContent = 'IQ BATTLE';
  cardBox.appendChild(new El('input', { id: 'boot-name' }));
  cardBox.appendChild(new El('input', { id: 'boot-room' }));
  cardBox.appendChild(new El('button', { id: 'boot-solo', cls: 'btn btn-primary boot-big' }));
  cardBox.appendChild(new El('button', { id: 'boot-host', cls: 'btn boot-big' }));
  boot.appendChild(cardBox);

  var modal = new El('div', { id: 'htp-modal', cls: 'hidden' });
  var panel = new El('div', { cls: 'panel htp-panel' });
  var h2 = new El('h2'); h2.textContent = 'HOW TO PLAY';
  panel.appendChild(h2);
  if (withModalExtra) {
    var wiki = new El('a', { id: 'htp-wiki', attrs: { href: '#' } });
    wiki.textContent = 'rules wiki';
    panel.appendChild(wiki);
  }
  var closeBtn = new El('button', { id: 'htp-close', cls: 'btn btn-primary' });
  closeBtn.textContent = 'GOT IT';
  panel.appendChild(closeBtn);
  modal.appendChild(panel);
  boot.appendChild(modal);

  var keyHandlers = [];
  var doc = {
    head: head, body: body,
    activeElement: null,
    addEventListener: function (t, fn) { if (t === 'keydown') keyHandlers.push(fn); },
    createElement: function (tag) { return new El(tag); },
    querySelector: function (s) { return qs(head, s) || qs(body, s); },
    querySelectorAll: function (s) { return qsa(head, s).concat(qsa(body, s)); }
  };
  doc._fireKey = function (ev) {
    ev.preventDefault = ev.preventDefault || function () {};
    keyHandlers.forEach(function (fn) { fn(ev); });
  };
  DOC = doc;
  return doc;
}

function install(doc, lsStore, grad) {
  global.window = undefined; // force module onto globalThis root path
  global.document = doc;
  global.localStorage = {
    _s: lsStore || {},
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null; },
    setItem: function (k, v) { this._s[k] = String(v); }
  };
  global.getComputedStyle = function () {
    return {
      backgroundImage: grad === undefined ? 'linear-gradient(90deg, rgb(45, 124, 255), rgb(239, 76, 200))' : grad,
      getPropertyValue: function () { return ''; }
    };
  };
  delete global.__IQB_LANDING_POLISH__;
  delete require.cache[require.resolve(path.join(__dirname, '..', 'landing-polish.js'))];
  // eslint-disable-next-line no-new-func
  new Function(SRC)();
}

/* ---------------- build world ---------------- */
var doc = makeDoc(true);
var lsStore = {};

var $ = function (s) { return doc.querySelector(s); };
var link = $('#htp-link'), closeBtn = $('#htp-close'), modal = $('#htp-modal');
var wiki = $('#htp-wiki');

// simulate Main's own wiring FIRST — on the real page the inline script
// assigns these onclicks before landing-polish.js loads at end of body
link.onclick = function () { modal.classList.remove('hidden'); };
closeBtn.onclick = function () { modal.classList.add('hidden'); };
var mainHostRuns = 0;
$('#boot-host').onclick = function () { mainHostRuns++; };

install(doc, lsStore);

console.log('S1: injection & idempotence');
check('style injected under #iqv-lp-style', !!$('#iqv-lp-style'));
var cssText = $('#iqv-lp-style').innerHTML || $('#iqv-lp-style').textContent;
check('entrance animation <=400ms', /\.38s/.test(cssText));
check('animation gated behind prefers-reduced-motion', cssText.indexOf('prefers-reduced-motion:no-preference') >= 0);
check('three feature cards glyphed', qsa(doc.body, '.feat-card b').every(function (b) {
  return b.getAttribute('data-lp-glyph') === '1' && b.innerHTML.indexOf('<svg') === 0 &&
    String(b.innerHTML).split('<svg').length - 1 === 1;
}));
check('modal got role=dialog + aria-modal', modal.getAttribute('role') === 'dialog' && modal.getAttribute('aria-modal') === 'true');
check('hero gradient applied from computed logo accents', /linear-gradient\(90deg,\s*rgb\(45,\s*124,\s*255\),\s*rgb\(239,\s*76,\s*200\)\)/.test($('.hero-h1').style.backgroundImage));

// second pass: wipe top-level guard, re-run whole source -> per-node guards hold
install(doc, lsStore);
check('re-run: still exactly one style node', qsa(doc.head, '#iqv-lp-style').length === 1);
check('re-run: glyphs not duplicated', qsa(doc.body, '.feat-card b').every(function (b) {
  return String(b.innerHTML).split('<svg').length - 1 === 1;
}));
check('re-run: trap not double-bound', qsa(doc.body, '#htp-modal[data-lp-trap]').length === 1);

console.log('S2: focus trap cycle order (open -> focus first, TAB cycles)');
doc.activeElement = link;
link.onclick();
check('modal opens', !modal.classList.contains('hidden'));
check('initial focus lands on first focusable (#htp-wiki)', doc.activeElement === wiki);

function tab(shift) { doc._fireKey({ key: 'Tab', shiftKey: !!shift }); }
tab(false);  check('TAB 1: wiki -> GOT IT', doc.activeElement === closeBtn);
tab(false);  check('TAB 2 wraps: GOT IT -> wiki', doc.activeElement === wiki);
tab(true);   check('SHIFT+TAB reverses: wiki -> GOT IT', doc.activeElement === closeBtn);
tab(true);   check('SHIFT+TAB wraps: GOT IT -> wiki', doc.activeElement === wiki);

console.log('S3: ESC closes and restores focus to #htp-link');
doc._fireKey({ key: 'Escape' });
check('modal closed', modal.classList.contains('hidden'));
check('focus returned to #htp-link', doc.activeElement === link);
tab(false);
check('no trap leakage while closed (focus untouched)', doc.activeElement === link);

console.log('S4: room-name storage write path');
var room = $('#boot-room');
room.value = '  Shadow Den  ';
$('#boot-host').click();
check("persisted trimmed value under IQB_ROOMNAME_V1", lsStore.IQB_ROOMNAME_V1 === 'Shadow Den');
check('capture listener did not block HOST (Main handler ran)', mainHostRuns === 1);
var docR = makeDoc(false); lsStore.IQB_ROOMNAME_V1 = 'Shadow Den';
docR.querySelector('#boot-host').onclick = function () {};
install(docR, lsStore);
check('restore-on-load refills empty input from storage', docR.querySelector('#boot-room').value === 'Shadow Den');
var doc2 = makeDoc(false), ls2 = {};
install(doc2, ls2);
check('no-op world without storage entry leaves input alone', doc2.querySelector('#boot-room').value === '');
var doc3 = makeDoc(false);
install(doc3, {}, ''); // computed style with no gradient -> fallback tokens
check('fallback hero tokens when computed style lacks gradient',
  doc3.querySelector('.hero-h1').style.backgroundImage.indexOf('#2b74eb') >= 0 &&
  doc3.querySelector('.hero-h1').style.backgroundImage.indexOf('#357df4') >= 0);

console.log('');
if (failures.length) { console.log('FAILED: ' + failures.length + ' -> ' + failures.join('; ')); process.exit(1); }
console.log('ALL SMOKE CHECKS PASSED');
