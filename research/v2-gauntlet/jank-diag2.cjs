/* jank-diag2.cjs — focused CREATE ROOM click test. */
'use strict';
const SHOTS = 'C:/Users/david/Desktop/stuff/iqbattle/research/v2-gauntlet/shots/jank';
const { sleep, getJSON, connectWS, Tab, launchChrome, boot } = require('./jank-cdp.cjs');
(async () => {
  const { chrome, ver } = await launchChrome(9338, 'diag2');
  let tgt = null;
  try { tgt = await getJSON(9338, '/json/new?about:blank', 'PUT'); } catch (e) { tgt = await getJSON(9338, '/json/new?about:blank'); }
  const c = await connectWS(tgt.webSocketDebuggerUrl);
  const t = new Tab(c);
  await boot(c, t);
  console.log('booted');
  await t.click(800, 765); // CREATE ROOM label center
  await sleep(1200);
  console.log('shot-1', await t.shot('diag2-1', SHOTS));
  await sleep(4000);
  console.log('shot-2', await t.shot('diag2-2', SHOTS));
  console.log('q', JSON.stringify(await t.q()), 'errs', JSON.stringify(t.errs.slice(0, 3)));
  try { c.ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  process.exit(0);
})().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });
