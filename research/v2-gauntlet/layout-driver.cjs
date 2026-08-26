/* layout-driver.cjs - READ-ONLY visual audit driver for IQ Versus v2 (rev2)
 * Drives landing->lobby->game d1-6->interlude->end at three viewports.
 */
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const http = require('http');

const URL_APP = 'http://127.0.0.1:8792';
const DEBUG_PORT = 9339;
const OUT = 'C:/Users/david/Desktop/stuff/iqbattle/research/v2-gauntlet';
const SHOTS = OUT + '/shots';
const LOG = OUT + '/layout-log.jsonl';
const VIEWPORTS = [[1024, 576], [1920, 1080], [2560, 1440]];
const GLOBAL_DEADLINE = Date.now() + 900000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
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
      to = setTimeout(() => { this.pend.delete(id); rej(new Error('cdp-timeout ' + method)); }, 12000);
      try { this.ws.send(JSON.stringify({ id: id, method: method, params: params || {} })); } catch (e) { clearTimeout(to); this.pend.delete(id); rej(e); } });
  }
}
async function connectWS(u) {
  const ws = new WebSocket(u);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  return new CDP(ws);
}

function pngPixels(buf) {
  let off = 8, idat = [], w = 0, ct = 6;
  while (off + 8 < buf.length) {
    const len = buf.readUInt32BE(off), typ = buf.toString('ascii', off + 4, off + 8), data = buf.slice(off + 8, off + 8 + len);
    if (typ === 'IHDR') { w = data.readUInt32BE(0); ct = data[9]; }
    else if (typ === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp + 1, ft = raw[0];
  const row = raw.slice(1, stride), out = Buffer.alloc(w * bpp), prev = Buffer.alloc(w * bpp);
  for (let i = 0; i < w * bpp; i++) {
    const a = i >= bpp ? out[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
    let v = row[i];
    if (ft === 1) v = (v + a) & 255;
    else if (ft === 2) v = (v + b) & 255;
    else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
    else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
    out[i] = v;
  }
  const px = [];
  for (let x = 0; x < w; x++) px.push([out[x * bpp], out[x * bpp + 1], out[x * bpp + 2], bpp === 4 ? out[x * bpp + 3] : 255]);
  return px;
}

class Tab {
  constructor(cdp, tag) { this.c = cdp; this.tag = tag; this.rect = null; this.depth = 0; this.shots = []; this.done = false; }
  async ev(expr) {
    const r = await this.c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
    return r && r.result ? r.result.value : undefined;
  }
  async refreshRect() {
    this.rect = await this.ev('(function(){var c=document.querySelector("#app canvas");if(!c)return null;var r=c.getBoundingClientRect();return{l:r.left,t:r.top,w:r.width,h:r.height,iw:window.innerWidth,ih:window.innerHeight,dpr:window.devicePixelRatio};})()');
    return this.rect;
  }
  map(sx, sy) {
    const r = this.rect || { l: 0, t: 0, w: 1024, h: 576 };
    return [r.l + sx * (r.w / 1600), r.t + sy * (r.h / 900)];
  }
  async click(sx, sy) {
    await this.refreshRect();
    const p = this.map(sx, sy);
    const base = { x: p[0], y: p[1], button: 'left', clickCount: 1, pointerType: 'mouse' };
    await this.c.send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseMoved' }, base));
    await this.c.send('Input.dispatchMouseEvent', Object.assign({ type: 'mousePressed' }, base));
    await sleep(60);
    await this.c.send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseReleased' }, base));
  }
  async shotRaw(clip) {
    const params = { format: 'png', captureBeyondViewport: false };
    if (clip) params.clip = { x: clip[0], y: clip[1], width: clip[2], height: clip[3], scale: 1 };
    let r = null;
    for (let i = 0; i < 3; i++) {
      r = await this.c.send('Page.captureScreenshot', params);
      if (r && r.data) return Buffer.from(r.data, 'base64');
      await sleep(350);
    }
    throw new Error('captureScreenshot failed');
  }
  async sig() { const b = await this.shotRaw(); return b.length; }
  async dbg() {
    return (await this.ev('(function(){var d=window.__DBG||{};return{rounds:d.rounds|0,mounts:d.mounts|0,startRuns:d.startRuns|0,errs:(d.errors||[]).length};})()')) || {};
  }
  async waitOverlay(budget) {
    const t0 = Date.now();
    let hit = false;
    while (Date.now() - t0 < budget) {
      const has = await this.ev('!!document.querySelector("vite-error-overlay")');
      if (!has) return hit ? 'cleared' : null;
      hit = true;
      await sleep(2000);
    }
    return 'stuck';
  }
  async shot(name, meta) {
    const ov = await this.waitOverlay(90000);
    if (ov) { jlog({ tag: this.tag, overlay: ov, near: name }); say('[overlay] ' + ov + ' near ' + name); if (ov === 'stuck') throw new Error('vite-overlay-stuck'); }
    await this.refreshRect();
    const buf = await this.shotRaw();
    const dir = SHOTS + '/' + this.tag;
    fs.mkdirSync(dir, { recursive: true });
    const file = dir + '/' + name + '.png';
    fs.writeFileSync(file, buf);
    this.shots.push(name);
    let dbg = {}; try { dbg = await this.dbg(); } catch (e) {}
    jlog(Object.assign({ tag: this.tag, scene: name, file: file, bytes: buf.length, rect: this.rect, dbg: dbg }, meta || {}));
    say('[shot] ' + this.tag + '/' + name + ' bytes=' + buf.length);
    return buf.length;
  }
  near(v, hex, tol) {
    if (!v) return false;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return Math.abs(v[0] - r) <= tol && Math.abs(v[1] - g) <= tol && Math.abs(v[2] - b) <= tol;
  }
  async pixel(sx, sy) {
    await this.refreshRect();
    const p = this.map(sx, sy);
    const buf = await this.shotRaw([Math.max(0, Math.floor(p[0])), Math.max(0, Math.floor(p[1])), 1, 1]);
    try { return pngPixels(buf)[0]; } catch (e) { return null; }
  }
  async classify() {
    const BG = '#04070f', PANEL = '#0a1220';
    const g1 = await this.pixel(800, 326), g2 = await this.pixel(770, 326), g3 = await this.pixel(800, 406);
    const goldHit = [g1, g2, g3].some(v => v && v[0] > 110 && v[1] > 80 && v[2] < 110 && (v[0] - v[2]) > 40);
    if (goldHit) return 'interlude';
    const m1 = await this.pixel(20, 450), m2 = await this.pixel(1580, 450);
    if (this.near(m1, BG, 8) || this.near(m2, BG, 8)) return 'inrun';
    const grad = v => !!v && ((v[0] > 130 && (v[0] - v[2]) > 25) || (v[2] > 130 && (v[2] - v[0]) > 25));
    const c1 = await this.pixel(700, 767), c2 = await this.pixel(900, 767);
    if (grad(c1) || grad(c2)) return 'landing';
    const s1 = await this.pixel(880, 692), s2 = await this.pixel(1050, 692);
    if (grad(s1) || grad(s2)) return 'lobby';
    return 'end';
  }
  async stablePair(budget, gap) {
    const t0 = Date.now(); let last = await this.sig();
    while (Date.now() - t0 < budget) {
      await sleep(gap || 420);
      const s = await this.sig();
      if (s === last) return true;
      last = s;
    }
    return false;
  }
  async waitClassify(want, budget, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < budget) {
      const c = await this.classify();
      if (want.indexOf(c) >= 0) return c;
      await sleep(400);
    }
    say('[warn] waitClassify timeout: ' + label);
    return null;
  }
  async waitSigLeave(base, budget) {
    const t0 = Date.now();
    while (Date.now() - t0 < budget) {
      const s = await this.sig();
      if (Math.abs(s - base) > 400) {
        await sleep(380);
        const s2 = await this.sig();
        if (Math.abs(s2 - base) > 400) return true;
      }
      await sleep(240);
    }
    return false;
  }
  async answerRound(ff, depthLabel) {
    const probes = [[302, 695], [302, 627], [302, 431], [302, 827], [302, 763]];
    const before = await this.sig();
    for (let i = 0; i < probes.length; i++) {
      await this.click(probes[i][0], probes[i][1]);
      const changed = await this.waitSigLeave(before, ff ? 2000 : 2400);
      jlog({ tag: this.tag, probe: probes[i], i: i, round: depthLabel, changed: changed });
      if (changed) return 'answered';
    }
    if (!ff) {
      const xs = [302, 434, 566, 698], ys = [695, 627, 763, 827, 431, 563];
      for (const y of ys) { for (const x of xs) {
        await this.click(x, y);
        const changed = await this.waitSigLeave(before, 1300);
        jlog({ tag: this.tag, sweep: [x, y], round: depthLabel, changed: changed });
        if (changed) return 'swept';
      } }
    }
    const later = await this.waitSigLeave(before, 14000);
    if (!later) { await this.shot('STUCK-d' + depthLabel); return 'stuck'; }
    return 'self';
  }
  async run() {
    await this.shot('landing');
    await this.click(800, 767);
    const lob = await this.waitClassify(['lobby'], 14000, 'lobby-after-create');
    if (!lob) { await this.shot('ERROR-not-lobby'); return; }
    await sleep(700);
    await this.shot('lobby');
    for (let i = 0; i < 14; i++) { await this.click(718, 686); await sleep(110); }
    await this.click(968, 692);
    const started = await this.waitClassify(['inrun', 'interlude'], 12000, 'start');
    if (!started) { await this.shot('ERROR-not-started'); return; }
    await sleep(1300);
    let depth = 1, ff = false, idle = 0;
    while (depth <= 42 && !this.done) {
      if (Date.now() > GLOBAL_DEADLINE) { say('[warn] global deadline'); break; }
      let cls = await this.classify();
      if (cls === 'interlude') {
        await this.shot(depth <= 4 ? 'interlude-d4' : 'interlude-d' + depth);
        await this.click(800, 430);
        await sleep(1900);
        depth++;
        idle = 0;
        continue;
      }
      if (cls === 'end') {
        await sleep(650);
        if ((await this.classify()) === 'end') { await this.shot('end'); this.done = true; break; }
        continue;
      }
      if (cls === 'landing' || cls === 'lobby') { await this.shot('EJECTED-' + cls + '-d' + depth); return; }
      const stable = await this.stablePair(1600, 420);
      if (stable) {
        await this.shot('game-d' + depth);
        if (depth === 6) ff = true;
        const how = await this.answerRound(ff, depth);
        if (how === 'stuck') { if (++idle >= 2) break; } else idle = 0;
        await sleep(how === 'answered' ? 2400 : (ff ? 1500 : 1000));
        depth++;
      } else {
        await this.shot('takeover-d' + depth);
        if (depth === 6) ff = true;
        let settled = false;
        const t0 = Date.now();
        while (Date.now() - t0 < 21000) {
          if (await this.stablePair(2400, 420)) { settled = true; break; }
        }
        depth++;
        if (!settled) { if (++idle >= 2) break; } else idle = 0;
      }
    }
    if (!this.done) {
      await sleep(2000);
      const fin = await this.classify();
      await this.shot(fin === 'end' ? 'end' : 'final-' + fin);
    }
    say('[flow-done] ' + this.tag + ' shots=' + this.shots.length);
  }
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  try { fs.unlinkSync(LOG); } catch (e) {}
  let ver = null;
  for (let i = 0; i < 60 && !ver; i++) { try { ver = await getJSON('/json/version'); } catch (e) { await sleep(250); } }
  if (!ver) { say('FATAL: no CDP endpoint'); process.exit(2); }
  say('CDP up: ' + ver.Browser);
  async function openTab(W, H, tag) {
    let tgt = null;
    try { tgt = await getJSON('/json/new?' + URL_APP, 'PUT'); } catch (e) { tgt = await getJSON('/json/new?' + URL_APP); }
    const c = await connectWS(tgt.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Fetch.enable', { patterns: [{ urlPattern: 'https://unpkg.com/*' }] });
    c.on('Fetch.requestPaused', e => { c.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'Failed' }).catch(() => {}); });
    await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.navigate', { url: URL_APP });
    await sleep(2800);
    return { tgt: tgt, c: c, tab: new Tab(c, tag) };
  }
  for (const vw of VIEWPORTS) {
    const W = vw[0], H = vw[1], tag = W + 'x' + H;
    for (let attempt = 1; attempt <= 4 && Date.now() < GLOBAL_DEADLINE; attempt++) {
      say('[attempt] ' + tag + ' #' + attempt);
      let session = null;
      try { session = await openTab(W, H, tag); } catch (e) { say('[open-fail] ' + e.message); continue; }
      const tStart = Date.now();
      try { await Promise.race([session.tab.run(), sleep(175000).then(() => { throw new Error('attempt-watchdog'); })]); }
      catch (e) { say('[flow-error] ' + tag + ': ' + (e && e.message)); }
      say('[attempt-done] ' + tag + ' #' + attempt + ' took ' + Math.round((Date.now() - tStart) / 1000) + 's done=' + session.tab.done);
      try { session.c.ws.close(); } catch (e) {}
      try { await getJSON('/json/close/' + session.tgt.id); } catch (e) {}
      jlog({ tag: tag, attempt: attempt, flowComplete: session.tab.done, shots: session.tab.shots });
      if (session.tab.done) break;
      await sleep(4000);
    }
  }
  say('ALL FLOWS COMPLETE');
  process.exit(0);
})().catch(e => { say('FATAL ' + (e && e.stack || e)); process.exit(1); });
