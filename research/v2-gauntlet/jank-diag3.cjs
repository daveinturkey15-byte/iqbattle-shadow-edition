/* jank-diag3.cjs — does Input.dispatchMouseEvent reach Pixi at all? */
'use strict';
const SHOTS = 'C:/Users/david/Desktop/stuff/iqbattle/research/v2-gauntlet/shots/jank';
const { sleep, getJSON, connectWS, Tab, launchChrome, boot } = require('./jank-cdp.cjs');
(async () => {
  const { chrome } = await launchChrome(9338, 'diag3');
  let tgt = null;
  try { tgt = await getJSON(9338, '/json/new?about:blank', 'PUT'); } catch (e) { tgt = await getJSON(9338, '/json/new?about:blank'); }
  const c = await connectWS(tgt.webSocketDebuggerUrl);
  const t = new Tab(c);
  await boot(c, t);
  // DOM-level probe: log pointer events on canvas
  await t.ev(`(function(){window.__PE=[];var cv=document.querySelector('#app canvas');
    ['pointerdown','pointerup','mousedown','click'].forEach(function(tn){cv.addEventListener(tn,function(e){window.__PE.push(tn+':'+Math.round(e.clientX)+','+Math.round(e.clientY));});});
    return 'probe-ok';})()`);
  await t.click(800, 620); // display name input
  await sleep(600);
  await t.click(800, 765); // CREATE ROOM
  await sleep(2500);
  console.log('PE', await t.ev('JSON.stringify(window.__PE)'));
  console.log('shot', await t.shot('diag3-1', SHOTS));
  console.log('q', JSON.stringify(await t.q()));
  try { c.ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  process.exit(0);
})().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });
