/* jank-diag4.cjs — verify __START hook presence and direct start. */
'use strict';
const SHOTS = 'C:/Users/david/Desktop/stuff/iqbattle/research/v2-gauntlet/shots/jank';
const { sleep, getJSON, connectWS, Tab, launchChrome, boot } = require('./jank-cdp.cjs');
(async () => {
  const { chrome } = await launchChrome(9338, 'diag4');
  let tgt = null;
  try { tgt = await getJSON(9338, '/json/new?about:blank', 'PUT'); } catch (e) { tgt = await getJSON(9338, '/json/new?about:blank'); }
  const c = await connectWS(tgt.webSocketDebuggerUrl);
  const t = new Tab(c);
  await boot(c, t);
  console.log('hooks', await t.ev('JSON.stringify({Q:typeof window.__Q, START:typeof window.__START, SOLVE:typeof window.__SOLVE})'));
  await t.ev('window.__START&&window.__START()');
  await sleep(2500);
  console.log('q', JSON.stringify(await t.q()));
  console.log('dbg', await t.ev('(function(){var d=window.__DBG||{};return JSON.stringify({startRuns:d.startRuns,errs:(d.errors||[]).slice(0,3)})})()').catch(e => 'ERR'));
  console.log('shot', await t.shot('diag4-1', SHOTS));
  console.log('errs', JSON.stringify(t.errs.slice(0, 5)));
  try { c.ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  process.exit(0);
})().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });
