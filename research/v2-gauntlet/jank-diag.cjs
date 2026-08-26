/* jank-diag.cjs — stepwise diagnosis: boot, screenshot each stage, verify clicks. */
'use strict';
const fs = require('fs');
const SHOTS = 'C:/Users/david/Desktop/stuff/iqbattle/research/v2-gauntlet/shots/jank';
const { sleep, getJSON, connectWS, Tab, launchChrome, boot } = require('./jank-cdp.cjs');
(async () => {
  const { chrome, ver } = await launchChrome(9338, 'diag');
  console.log('CDP up', ver.Browser);
  let tgt = null;
  try { tgt = await getJSON(9338, '/json/new?about:blank', 'PUT'); } catch (e) { tgt = await getJSON(9338, '/json/new?about:blank'); }
  const c = await connectWS(tgt.webSocketDebuggerUrl);
  const t = new Tab(c);
  await boot(c, t);
  console.log('booted; rect', JSON.stringify(t.rect));
  console.log('q', JSON.stringify(await t.q()), 'solve', await t.ev('typeof window.__SOLVE').catch(e => 'ERR'));
  console.log('shot-a', await t.shot('diag-1-landing', SHOTS));
  await t.click(840, 767); await sleep(1800);
  console.log('shot-b', await t.shot('diag-2-after-create', SHOTS));
  console.log('q-after-create', JSON.stringify(await t.q()));
  await t.click(968, 692); await sleep(2600);
  console.log('shot-c', await t.shot('diag-3-after-start', SHOTS));
  console.log('q-after-start', JSON.stringify(await t.q()));
  console.log('dbg', await t.ev('(function(){var d=window.__DBG||{};return JSON.stringify({rounds:d.rounds,startRuns:d.startRuns,errs:(d.errors||[]).length})})()').catch(e => 'ERR ' + e.message));
  console.log('pageErrs', JSON.stringify(t.errs.slice(0, 5)));
  try { c.ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  process.exit(0);
})().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });
