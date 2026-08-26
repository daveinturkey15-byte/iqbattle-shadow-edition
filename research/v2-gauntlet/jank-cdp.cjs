/* jank-cdp.cjs — shared Chrome/CDP plumbing for the jank hunt (read-only). */
'use strict';
const http = require('http');
const { spawn } = require('child_process');
const os = require('os');
const SOLVER_SRC = require('./jank-solver.cjs');

const APP = 'http://127.0.0.1:8795/';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function getJSON(port, path, method) {
  return new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: method || 'GET' }, r => {
      let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }); req.on('error', rej); req.end();
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
  async shot(name, dir) {
    if (!(await this.refreshRect())) return null;
    const r = await this.c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = dir + '/' + name + '.png';
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
const fs = require('fs');

async function launchChrome(port, tag) {
  const profile = os.tmpdir() + '/jank-chrome-' + tag + '-' + Date.now();
  const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
     '--no-first-run', '--window-size=1600,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 60 && !ver; i++) { try { ver = await getJSON(port, '/json/version'); } catch (e) { await sleep(300); } }
  if (!ver) throw new Error('chrome CDP did not come up');
  return { chrome, ver };
}

async function attach(c) {
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Network.enable');
  await c.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
}

async function boot(c, t) {
  await attach(c);
  c.on('Runtime.exceptionThrown', (e) => { const d = e.exceptionDetails; t.errs.push(String(d && d.exception && d.exception.description || d && d.text).slice(0, 200)); });
  c.on('Runtime.consoleAPICalled', (e) => { if (e.type === 'error') t.errs.push((e.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 200)); });
  await c.send('Page.navigate', { url: APP });
  for (let i = 0; i < 30 && !(await t.refreshRect()); i++) await sleep(600);
  if (!t.rect) throw new Error('boot: no canvas');
  await sleep(1000);
  await t.ev(SOLVER_SRC, true);
  return t;
}

module.exports = { APP, sleep, getJSON, fetchDev, CDP, connectWS, Tab, launchChrome, attach, boot, SOLVER_SRC };
