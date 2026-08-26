/* jank-diag5.cjs — log interception pipeline in detail. */
'use strict';
const SHOTS = 'C:/Users/david/Desktop/stuff/iqbattle/research/v2-gauntlet/shots/jank';
const { sleep, getJSON, connectWS, Tab, launchChrome, attach, SOLVER_SRC } = require('./jank-cdp.cjs');
const { fetchDev } = require('./jank-cdp.cjs');
(async () => {
  const { chrome } = await launchChrome(9338, 'diag5');
  let tgt = null;
  try { tgt = await getJSON(9338, '/json/new?about:blank', 'PUT'); } catch (e) { tgt = await getJSON(9338, '/json/new?about:blank'); }
  const c = await connectWS(tgt.webSocketDebuggerUrl);
  const t = new Tab(c);
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Network.enable');
  await c.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await c.send('Fetch.enable', { patterns: [{ urlPattern: '*main.ts*', requestStage: 'Response' }] });
  const INJECT = ';window.__Q={run:()=>1};window.__MARK=1;';
  c.on('Fetch.requestPaused', async (e) => {
    console.log('PAUSED', e.request.url, 'hasBody', !!e.responseBody, 'status', e.responseStatusCode);
    try {
      const u = new URL(e.request.url);
      const body = await fetchDev(u.pathname + u.search);
      console.log('FETCHED len', body.length, 'hasQ', body.includes('__Q'));
      const nb = body.includes('__Q') ? body : body + INJECT;
      await c.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: 200,
        responseHeaders: [{ name: 'content-type', value: 'text/javascript' }],
        body: Buffer.from(nb, 'utf8').toString('base64') });
      console.log('FULFILLED');
    } catch (x) { console.log('HANDLER-ERR', String(x).slice(0, 120)); try { await c.send('Fetch.continueRequest', { requestId: e.requestId }); } catch (y) {} }
  });
  await c.send('Page.navigate', { url: 'http://127.0.0.1:8791/' });
  for (let i = 0; i < 30 && !(await t.refreshRect()); i++) await sleep(600);
  await sleep(1500);
  console.log('MARK', await t.ev('JSON.stringify({mark:window.__MARK||0, q:typeof window.__Q})'));
  try { c.ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  process.exit(0);
})().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });
