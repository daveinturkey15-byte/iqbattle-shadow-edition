/* jank-probe.cjs — fair Esc-path test on VISIBLE takeovers + interlude.
 * Seeds a run, answers puzzles cleanly, and when a takeover/interlude is
 * actually on screen: screenshot the goal-card window, press Esc, measure. */
'use strict';
const fs = require('fs');
const SHOTS = 'C:/Users/david/Desktop/stuff/iqbattle/research/v2-gauntlet/shots/jank';
const OUT = 'C:/Users/david/Desktop/stuff/iqbattle/research/v2-gauntlet';
const LOG = OUT + '/jank-probe.jsonl';
const { sleep, getJSON, connectWS, Tab, launchChrome, boot } = require('./jank-cdp.cjs');
function pad(n) { return String(n).padStart(2, '0'); }
function jlog(o) { try { fs.appendFileSync(LOG, JSON.stringify(o) + '\n'); } catch (e) {} }

function optionCenter(sol, idx) {
  const rows = sol.rows || 3, cols = sol.cols || 3;
  const GAP = 14, cell = cols === 2 ? 150 : 118;
  const boardH = rows * cell + (rows - 1) * GAP;
  const avail = 640 - 20 - boardH - 24 - 14;
  const optSize = Math.max(72, Math.min(120, Math.floor((avail - GAP) / 2)));
  const ox = Math.round((920 - (4 * optSize + 3 * GAP)) / 2);
  const oy = 20 + boardH + 24;
  return [40 + ox + (idx % 4) * (optSize + GAP) + optSize / 2, 164 + oy + Math.floor(idx / 4) * (optSize + GAP) + optSize / 2];
}

(async () => {
  try { fs.unlinkSync(LOG); } catch (e) {}
  const { chrome } = await launchChrome(9338, 'probe');
  let tgt = null;
  try { tgt = await getJSON(9338, '/json/new?about:blank', 'PUT'); } catch (e) { tgt = await getJSON(9338, '/json/new?about:blank'); }
  const c = await connectWS(tgt.webSocketDebuggerUrl);
  const t = new Tab(c);
  await boot(c, t);
  // enter run (seed 20260828 via __START default)
  for (let a = 0; a < 6; a++) {
    await t.ev('window.__START&&window.__START()').catch(() => {});
    await sleep(1800);
    if ((await t.q()) && (await t.q()).seed != null) break;
  }
  let tkTested = 0, ilTested = 0, guard = 0;
  const DEADLINE = Date.now() + 420000;
  while ((tkTested < 2 || ilTested < 1) && Date.now() < DEADLINE && guard++ < 120) {
    const st = await t.q();
    if (!st || st.seed == null) { await t.ev('window.__START&&window.__START()').catch(() => {}); await sleep(2000); continue; }
    let sol;
    try { sol = await t.solve(st.seed, st.depth, st.lastTakeover); } catch (e) { await sleep(500); continue; }
    const depth = st.depth;
    if (sol.kind === 'takeover' && tkTested < 2) {
      jlog({ ts: new Date().toISOString(), depth, ev: 'takeover-visible', name: sol.name, hp: st.hp });
      const f1 = await t.shot('tk' + pad(depth) + '-a', SHOTS);
      await sleep(2400); // past the 2s goal-card window
      const f2 = await t.shot('tk' + pad(depth) + '-b', SHOTS);
      await t.esc();
      const t0 = Date.now();
      let advanced = false, dt = -1;
      for (let i = 0; i < 50; i++) {
        await sleep(100);
        const q2 = await t.q();
        if (!q2 || q2.depth !== depth) { advanced = true; dt = Date.now() - t0; break; }
        if (Date.now() - t0 > 5000) break;
      }
      const q3 = await t.q();
      const hpLost = q3 ? st.hp - q3.hp : 0;
      jlog({ ts: new Date().toISOString(), depth, ev: 'takeover-esc', name: sol.name, advanced, dt, hpLost, shots: [f1, f2] });
      console.log('[tk' + depth + '] ' + sol.name + ' advanced=' + advanced + ' dt=' + dt + ' hpLost=' + hpLost);
      if (advanced && hpLost <= 0) tkTested++;
      if (!advanced) { await sleep(58000); } // timer fallback
      continue;
    }
    if (sol.interlude && ilTested < 1) {
      jlog({ ts: new Date().toISOString(), depth, ev: 'interlude-visible', hp: st.hp });
      await sleep(1300); // past ESCAPE_AFTER_MS
      const f1 = await t.shot('il' + pad(depth) + '-hint', SHOTS);
      await t.esc();
      const t0 = Date.now();
      let advanced = false, dt = -1;
      for (let i = 0; i < 50; i++) {
        await sleep(100);
        const q2 = await t.q();
        if (!q2 || q2.depth !== depth) { advanced = true; dt = Date.now() - t0; break; }
        if (Date.now() - t0 > 5000) break;
      }
      const q3 = await t.q();
      const hpLost = q3 ? st.hp - q3.hp : 0;
      jlog({ ts: new Date().toISOString(), depth, ev: 'interlude-esc', advanced, dt, hpLost, shots: [f1] });
      console.log('[il' + depth + '] esc advanced=' + advanced + ' dt=' + dt + ' hpLost=' + hpLost);
      if (advanced && hpLost <= 0) ilTested++;
      if (!advanced) { await sleep(58000); }
      continue;
    }
    // normal puzzle: answer correctly
    if (sol.kind === 'puzzle' && !sol.interlude) {
      const ctr = optionCenter(sol, sol.answer);
      await t.click(ctr[0], ctr[1]);
      const t0 = Date.now();
      for (let i = 0; i < 90; i++) {
        await sleep(100);
        const q2 = await t.q();
        if (!q2 || q2.depth !== depth) break;
      }
      await sleep(200);
      continue;
    }
    await sleep(500);
  }
  console.log('PROBE DONE tk=' + tkTested + ' il=' + ilTested);
  try { c.ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  process.exit(0);
})().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });
