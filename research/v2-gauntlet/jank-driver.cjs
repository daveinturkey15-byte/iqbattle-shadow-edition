/* jank-driver.cjs — READ-ONLY live feel/jank hunt for IQ Versus v2 dev (:8791).
 * Own headless Chrome (:9337). Instruments main.ts in-flight (window.__Q run
 * state; repo untouched). Trusted CDP input. JSONL + screenshots + summary.
 */
'use strict';
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const os = require('os');
const SOLVER_SRC = require('./jank-solver.cjs');

const APP = 'http://127.0.0.1:8795/';
const DEBUG_PORT = 9337;
const OUT = 'C:/Users/david/Desktop/stuff/iqbattle/research/v2-gauntlet';
const SHOTS = OUT + '/shots/jank';
const LOG = OUT + '/jank-log.jsonl';
const TARGET_DEPTHS = 34;
const DEADLINE = Date.now() + 840000; // 14 min

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function pad(n) { return String(n).padStart(2, '0'); }
function jlog(obj) { try { fs.appendFileSync(LOG, JSON.stringify(obj) + '\n'); } catch (e) {} }
function say() { console.log.apply(console, [].slice.call(arguments)); }
function getJSON(path, method) {
  return new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port: DEBUG_PORT, path: path, method: method || 'GET' }, r => {
      let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    });
    req.on('error', rej); req.end();
  });
}
function fetchDev(pathname) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: 8791, path: pathname }, r => {
      const b = []; r.on('data', d => b.push(d)); r.on('end', () => res(Buffer.concat(b).toString('utf8')));
    }).on('error', rej);
  });
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pend = new Map(); this.ev = new Map();
    ws.addEventListener('message', e => {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.id !== undefined) { const p = this.pend.get(m.id); if (p) { this.pend.delete(m.id); m.error ? p[1](new Error(m.error.message)) : p[0](m.result); } }
      else { const hs = this.ev.get(m.method); if (hs) hs.forEach(h => { try { h(m.params); } catch (x) {} }); }
    });
  }
  on(method, fn) { let a = this.ev.get(method); if (!a) { a = []; this.ev.set(method, a); } a.push(fn); }
  send(method, params) {
    return new Promise((res, rej) => { const id = ++this.id; let to = null;
      this.pend.set(id, [(v) => { clearTimeout(to); res(v); }, (e) => { clearTimeout(to); rej(e); }]);
      to = setTimeout(() => { this.pend.delete(id); rej(new Error('cdp-timeout ' + method)); }, 20000);
      try { this.ws.send(JSON.stringify({ id: id, method: method, params: params || {} })); } catch (e) { clearTimeout(to); this.pend.delete(id); rej(e); } });
  }
}
async function connectWS(u) {
  const ws = new WebSocket(u);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  return new CDP(ws);
}

class Tab {
  constructor(c) { this.c = c; this.rect = null; this.errs = []; }
  async ev(expr, awaitPromise) {
    const r = await this.c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
    if (r && r.exceptionDetails) throw new Error('ev: ' + JSON.stringify(r.exceptionDetails).slice(0, 250));
    return r && r.result ? r.result.value : undefined;
  }
  async refreshRect() {
    this.rect = await this.ev('(function(){var c=document.querySelector("#app canvas");if(!c)return null;var r=c.getBoundingClientRect();return{l:r.left,t:r.top,w:r.width,h:r.height};})()').catch(() => null);
    return this.rect;
  }
  map(sx, sy) { const r = this.rect || { l: 0, t: 0, w: 1600, h: 900 }; return [r.l + sx * (r.w / 1600), r.t + sy * (r.h / 900)]; }
  async click(sx, sy) {
    await this.refreshRect(); if (!this.rect) throw new Error('no-canvas');
    const p = this.map(sx, sy);
    const base = { x: p[0], y: p[1], button: 'left', clickCount: 1, pointerType: 'mouse' };
    await this.c.send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseMoved' }, base));
    await this.c.send('Input.dispatchMouseEvent', Object.assign({ type: 'mousePressed' }, base));
    await sleep(50);
    await this.c.send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseReleased' }, base));
  }
  async esc() {
    await this.c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await sleep(40);
    await this.c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  }
  async shot(name) {
    if (!(await this.refreshRect())) return null;
    const r = await this.c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = SHOTS + '/' + name + '.png';
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
  async q() {
    const v = await this.ev('(function(){try{return JSON.stringify(window.__Q&&window.__Q.run())}catch(e){return "null"}})()').catch(() => null);
    try { return JSON.parse(v); } catch (e) { return null; }
  }
  async solve(seed, depth, lastTakeover) {
    const v = await this.ev('JSON.stringify(window.__SOLVE(' + (seed >>> 0) + ',' + depth + ',' + (lastTakeover >>> 0) + '))', true);
    return JSON.parse(v);
  }
  async probeMark() { await this.ev('window.__J&&window.__J.mark()').catch(() => {}); }
  async probeSnap() {
    const v = await this.ev('(function(){try{return JSON.stringify(window.__J?window.__J.snap():{maxGap:0,longtasks:[]})}catch(e){return "{}"}})()').catch(() => '{}');
    try { return JSON.parse(v); } catch (e) { return { maxGap: 0, longtasks: [] }; }
  }
  async waitDepthChange(from, budget) {
    const t0 = Date.now();
    while (Date.now() - t0 < budget) {
      const st = await this.q();
      if (!st || st.seed == null || st.depth !== from) return { st, dt: Date.now() - t0 };
      await sleep(40);
    }
    return { st: undefined, dt: Date.now() - t0 };
  }
}

async function boot(c) {
  const t = new Tab(c);
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Network.enable');
  await c.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await c.send('Fetch.enable', { patterns: [{ urlPattern: '*main.ts*', requestStage: 'Response' }] });
  const INJECT = ';window.__Q={run:()=>{try{return (typeof run!=="undefined"&&run)?{seed:run.seed,depth:run.depth,hp:run.hp,timerLen:run.timerLen,score:run.score,streak:run.streak,lastTakeover:run.lastTakeover}:null}catch(e){return null}}};';
  c.on('Fetch.requestPaused', async (e) => {
    try {
      const u = new URL(e.request.url);
      const body = await fetchDev(u.pathname + u.search);
      const nb = body.includes('__Q') ? body : body + INJECT;
      await c.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: 200,
        responseHeaders: [{ name: 'content-type', value: 'text/javascript' }],
        body: Buffer.from(nb, 'utf8').toString('base64') });
    } catch (x) { try { await c.send('Fetch.continueRequest', { requestId: e.requestId }); } catch (y) {} }
  });
  c.on('Runtime.exceptionThrown', (e) => { const d = e.exceptionDetails; t.errs.push(String(d && d.exception && d.exception.description || d && d.text).slice(0, 200)); });
  c.on('Runtime.consoleAPICalled', (e) => { if (e.type === 'error') t.errs.push((e.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 200)); });
  await c.send('Page.navigate', { url: APP });
  for (let i = 0; i < 30 && !(await t.refreshRect()); i++) await sleep(600);
  if (!t.rect) throw new Error('boot: no canvas');
  await sleep(1000);
  await t.ev(SOLVER_SRC, true);
  return t;
}

/* Re-enter a run from whatever screen we are on (landing / end / lobby). */
async function enterRun(t, why) {
  jlog({ ts: new Date().toISOString(), ev: 'enterRun', why: why });
  for (let a = 0; a < 6; a++) {
    if (!(await t.refreshRect())) {
      await t.c.send('Page.navigate', { url: APP }).catch(() => {});
      for (let i = 0; i < 30 && !(await t.refreshRect()); i++) await sleep(600);
      await sleep(800);
    }
    try { if ((await t.ev('typeof window.__SOLVE')) !== 'function') await t.ev(SOLVER_SRC, true); } catch (e) {}
    await t.ev('window.__START&&window.__START()').catch(() => {});
    await sleep(1800);
    const st = await t.q();
    if (st && st.seed != null) return st;
  }
  throw new Error('enterRun: could not start a run');
}

/* Option-tile stage coords, mirroring scenes/game.ts layout math. */
function optionCenter(sol, idx) {
  const rows = sol.rows || 3, cols = sol.cols || 3;
  const cell = cols === 2 ? 150 : 118, gap = 14;
  const optSize = rows >= 3 ? 88 : 108;
  const ox = (920 - (4 * optSize + 36)) / 2;
  const oy = 40 + rows * (cell + gap) + 30;
  return [40 + ox + (idx % 4) * (optSize + 12) + optSize / 2, 164 + oy + Math.floor(idx / 4) * (optSize + 12) + optSize / 2];
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  try { fs.unlinkSync(LOG); } catch (e) {}
  // launch chrome
  const profile = os.tmpdir() + '/jank-chrome-' + Date.now();
  const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new', '--remote-debugging-port=' + DEBUG_PORT, '--user-data-dir=' + profile,
     '--no-first-run', '--window-size=1600,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 60 && !ver; i++) { try { ver = await getJSON('/json/version'); } catch (e) { await sleep(300); } }
  if (!ver) { say('FATAL: chrome CDP did not come up'); process.exit(2); }
  say('CDP up: ' + ver.Browser);
  let tgt = null;
  try { tgt = await getJSON('/json/new?about:blank', 'PUT'); } catch (e) { tgt = await getJSON('/json/new?about:blank'); }
  const c = await connectWS(tgt.webSocketDebuggerUrl);
  let t = null;
  let total = 0, guard = 0, runRestarts = 0;
  const t0 = Date.now();
  try { t = await boot(c); } catch (e) { say('FATAL boot: ' + e.message); try { chrome.kill(); } catch (x) {} process.exit(2); }
  await enterRun(t, 'initial');
  runRestarts++;

  while (total < TARGET_DEPTHS && Date.now() < DEADLINE && guard++ < 400) {
    let st = await t.q();
    if (!st || st.seed == null) { try { await enterRun(t, 'run-lost'); runRestarts++; } catch (e) { say('enterRun fail: ' + e.message); break; } continue; }
    const depth = st.depth;
    let sol = null;
    try { sol = await t.solve(st.seed, depth, st.lastTakeover); }
    catch (e) { jlog({ ts: new Date().toISOString(), ev: 'solve-fail', depth, err: String(e).slice(0, 150) }); await sleep(600); continue; }
    await t.probeMark();
    const errsBefore = t.errs.length;
    const rec = { ts: new Date().toISOString(), depth, kind: sol.kind, align: sol.align, layer: sol.layer,
      sanctuary: sol.sanctuary, hp: st.hp, streak: st.streak, timerLen: st.timerLen };
    const shots = [];
    const f = await t.shot('d' + pad(depth) + '-a'); if (f) shots.push(['a', f]);

    /* ---- interlude overlay (every 4th depth) ---- */
    if (sol.interlude) {
      rec.kind = 'interlude';
      const mode = depth === 4 ? 'esc' : depth === 8 ? 'auto' : 'click';
      rec.mode = mode;
      if (mode === 'esc') {
        await sleep(1300); // past ESCAPE_AFTER_MS (1000)
        const fh = await t.shot('d' + pad(depth) + '-hint'); if (fh) shots.push(['hint', fh]);
        await t.esc();
      } else if (mode === 'auto') {
        await t.shot('d' + pad(depth) + '-pre-auto').catch(() => null);
        await sleep(8400); // AUTO_PICK_MS = 8000
      } else {
        await t.click(800, 430); // middle card
      }
      const r = await t.waitDepthChange(depth, 9000);
      rec.advanced = !!r.st || r.st === null;
      rec.dtToAdvance = r.dt;
      rec.hpAfter = (await t.q() || {}).hp;
      rec.probe = await t.probeSnap();
      rec.newErrs = t.errs.slice(errsBefore); rec.shots = shots;
      jlog(rec); total++;
      say('[d' + pad(depth) + '] interlude mode=' + mode + ' dt=' + r.dt + ' advanced=' + rec.advanced);
      continue;
    }

    /* ---- takeover stage ---- */
    if (sol.kind === 'takeover') {
      rec.name = sol.name;
      await sleep(300); // let goal card + first frame paint
      await t.esc();
      let r = await t.waitDepthChange(depth, 6000);
      if (!r.st) {
        rec.escLateRetry = true;
        await sleep(2100); // past any 2s input-lock window
        await t.shot('d' + pad(depth) + '-stage').catch(() => null);
        await t.esc();
        r = await t.waitDepthChange(depth, 68000); // timer fallback (timerLen <= 60s)
        if (!r.st) { rec.stuck = true; rec.hpAfter = (await t.q() || {}).hp; rec.shots = shots; jlog(rec); total++; say('[d' + pad(depth) + '] ' + sol.name + ' STUCK'); continue; }
        rec.escNoop = true;
      }
      rec.dtEscToAdvance = r.dt;
      rec.hpAfter = (await t.q() || {}).hp;
      rec.probe = await t.probeSnap();
      rec.newErrs = t.errs.slice(errsBefore); rec.shots = shots;
      jlog(rec); total++;
      say('[d' + pad(depth) + '] takeover ' + sol.name + ' dt=' + r.dt + ' noop=' + !!rec.escNoop);
      continue;
    }

    /* ---- puzzle depth ---- */
    const n = Math.max(4, sol.nOpts || 8);
    const wrong = st.hp >= 70 && depth % 6 === 0; // deliberate wrong-path sample at safe HP
    const idx = wrong ? (sol.answer + 1) % n : sol.answer;
    const ctr = optionCenter(sol, idx);
    const clickT = Date.now();
    await t.click(ctr[0], ctr[1]);
    setTimeout(() => { t.shot('d' + pad(depth) + '-b').then(x => { if (x) shots.push(['b', x]); }).catch(() => {}); }, 120);
    if (depth % 3 === 0) {
      setTimeout(() => { t.shot('d' + pad(depth) + '-c').then(x => { if (x) shots.push(['c', x]); }).catch(() => {}); }, 700);
      setTimeout(() => { t.shot('d' + pad(depth) + '-d').then(x => { if (x) shots.push(['d', x]); }).catch(() => {}); }, 1250);
    }
    const r = await t.waitDepthChange(depth, 9000);
    rec.wrong = wrong; rec.picked = idx;
    rec.dtAnswerToAdvance = r.dt;
    rec.runEnded = r.st === null;
    rec.hpAfter = (await t.q() || {}).hp;
    rec.probe = await t.probeSnap();
    rec.newErrs = t.errs.slice(errsBefore); rec.shots = shots;
    jlog(rec); total++;
    say('[d' + pad(depth) + '] puzzle ' + sol.famName + ' wrong=' + wrong + ' dt=' + r.dt + (r.st === null ? ' RUN-ENDED' : ''));
  }

  /* ---- summary ---- */
  let rows = [];
  try { rows = fs.readFileSync(LOG, 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean); } catch (e) {}
  const pz = rows.filter(r => r.kind === 'puzzle' && typeof r.dtAnswerToAdvance === 'number');
  const tk = rows.filter(r => r.kind === 'takeover');
  const il = rows.filter(r => r.kind === 'interlude');
  const gaps = pz.map(r => r.dtAnswerToAdvance).sort((a, b) => a - b);
  const pct = p => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] : null;
  const summary = {
    depths: total, runRestarts, wallSec: Math.round((Date.now() - t0) / 1000),
    puzzle: { n: pz.length, dtMedian: pct(0.5), dtP90: pct(0.9), dtMax: gaps.length ? gaps[gaps.length - 1] : null,
      over1600ms: pz.filter(r => r.dtAnswerToAdvance > 1600).length },
    takeover: { n: tk.length, escNoop: tk.filter(r => r.escNoop).length, stuck: tk.filter(r => r.stuck).length,
      names: tk.map(r => r.name + (r.escNoop ? '(esc-noop)' : '') + (r.stuck ? '(STUCK)' : '')) },
    interlude: { n: il.length, modes: il.map(r => r.mode + ':' + (r.advanced ? 'ok' : 'FAIL')) },
    maxFrameGap: Math.max(0, ...rows.map(r => r.probe && r.probe.maxGap || 0)),
    longtasks: rows.reduce((a, r) => a + ((r.probe && r.probe.longtasks || []).length), 0),
    pageErrors: t ? t.errs.slice(0, 20) : [],
  };
  fs.writeFileSync(OUT + '/jank-summary.json', JSON.stringify(summary, null, 2));
  say('SUMMARY ' + JSON.stringify(summary));
  try { c.ws.close(); } catch (e) {}
  try { await getJSON('/json/close/' + tgt.id); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  process.exit(0);
})().catch(e => { say('FATAL ' + (e && e.stack || e)); process.exit(1); });
