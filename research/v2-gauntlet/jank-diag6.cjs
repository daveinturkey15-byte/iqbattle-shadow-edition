'use strict';
const { sleep, getJSON, connectWS, Tab, launchChrome } = require('./jank-cdp.cjs');
(async () => {
  const { chrome } = await launchChrome(9338, 'diag6');
  let tgt = null;
  try { tgt = await getJSON(9338, '/json/new?about:blank', 'PUT'); } catch (e) { tgt = await getJSON(9338, '/json/new?about:blank'); }
  const c = await connectWS(tgt.webSocketDebuggerUrl);
  const t = new Tab(c);
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await c.send('Page.navigate', { url: 'http://127.0.0.1:8795/' });
  for (let i = 0; i < 30 && !(await t.refreshRect()); i++) await sleep(600);
  await sleep(1500);
  console.log('href', await t.ev('location.href'));
  console.log('hooks', await t.ev('JSON.stringify({Q:typeof window.__Q,START:typeof window.__START})'));
  const probe = await t.ev('(async()=>{const r=await fetch("/src/main.ts");const x=await r.text();return JSON.stringify({len:x.length,hasSTART:x.includes("__START"),hasQ:x.includes("__Q")})})()', true);
  console.log('pageFetch', probe);
  await t.ev('window.__START&&window.__START()');
  await sleep(2500);
  console.log('q', JSON.stringify(await t.q()));
  try { c.ws.close(); } catch (e) {} try { chrome.kill(); } catch (e) {}
  process.exit(0);
})().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });
