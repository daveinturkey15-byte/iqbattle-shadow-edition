/* Smoke test for pack-realm.js against the real hooks.js contract (node). */
'use strict';
const path = 'C:/Users/david/Desktop/stuff/iqbattle/';
const H = require(path + 'hooks.js');
globalThis.IQ = globalThis.IQ || {};
globalThis.IQ.Hooks = H;
require(path + 'pack-realm.js');

let fails = 0;
function ok(cond, name) {
  if (cond) console.log('PASS', name);
  else { fails++; console.log('FAIL', name); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function mkRng(seed) { return H.makeRng(seed); }
const base = (over) => Object.assign({ round: 5, align: 'bad', optCount: 8, seed: 123, rng: mkRng(123) }, over);

(async () => {
  await sleep(120); /* let late-safe polls fire */

  /* registrations landed */
  const worldIds = (H._packs.find(p => p.id === 'pack-realm') || {}).worlds;
  ok(worldIds && ['hell-layer','sanctum-light','void-black','hazard-pit'].every(w => worldIds.has(w)), 'hook bound to 4 worlds');

  /* fake Worlds registry to capture register() */
  const registered = {};
  globalThis.IQ.Worlds = { register(d){ registered[d.id] = d; }, list(){ return Object.keys(registered); } };
  await sleep(80);
  ok(['hell-layer','sanctum-light','void-black','hazard-pit'].every(w => registered[w]), '4 worlds registered');

  H.beginRun('run-1', 999);

  /* [1r4] hell layer IV: web telegraph + 3s window */
  const ctxW = base({ world: 'hell-layer', hellLayer: 4 });
  let m = H.dispatch('roundStart', ctxW)[0];
  ok(m && m.bannerText.includes('IV') && m.bannerText.includes('WEBBED'), 'L4 roman-numeral telegraph banner');
  ok(m.disableOptionIdx && m.disableOptionIdx.length === 1 && m.disableOptionIdx[0] >= 0 && m.disableOptionIdx[0] < 8, 'L4 web disables exactly one option');
  const webbed = m.disableOptionIdx[0];
  m = H.dispatch('tick', ctxW)[0];
  ok(m && m.disableOptionIdx && m.disableOptionIdx[0] === webbed, 'web sustained during 3s window');
  const realNow = performance.now.bind(performance);
  performance.now = () => realNow() + 3500; /* jump past the window */
  m = H.dispatch('tick', ctxW)[0];
  performance.now = realNow;
  ok(m === undefined, 'web released after 3s');

  /* [1r6] nails: wrong picked answer bleeds -8; correct does not */
  const ctxN = base({ world: 'hell-layer', hellLayer: 6 });
  m = H.dispatch('roundStart', ctxN)[0];
  ok(m.bannerText.includes('VI') && m.bannerText.includes('\u22128') , 'L6 nails telegraphed before applying');
  m = H.dispatch('answer', base({ world:'hell-layer', hellLayer:6, res:{ correct:false, picked:2, correctIdx:0 } }))[0];
  ok(m && m.hpDelta === -8, 'nail bite is -8 hp');
  m = H.dispatch('answer', base({ world:'hell-layer', hellLayer:6, res:{ correct:true, picked:0, correctIdx:0 } }))[0];
  ok(!m, 'no nail bite on correct answer');
  m = H.dispatch('answer', base({ world:'hell-layer', hellLayer:6, res:{ correct:false, picked:-1, correctIdx:0 } }))[0];
  ok(!m, 'timeout (picked -1) is not a "wrong answer" pick — no nail bite');

  /* [1r3/r5/r7] cosmetic layers emit overlays + banners */
  for (const [layer, frag] of [[3,'III'],[5,'V'],[7,'VII']]) {
    m = H.dispatch('roundStart', base({ world:'hell-layer', hellLayer:layer }))[0];
    ok(m && m.bannerText.includes(frag), 'layer '+layer+' banner');
    if (layer === 7) ok(m.overlayHTML && !m.hpDelta && !m.disableOptionIdx, 'L7 fire is cosmetic overlay only');
  }

  /* fallback layer derivation when ContinuityV2 signal absent */
  m = H.dispatch('roundStart', base({ world:'hell-layer', round: 21 }))[0];
  ok(m && m.bannerText.includes('VII'), 'derived depth reaches VII at deep rounds');

  /* [2] sanctum: heal +8 on correct; god beam once per round via tick */
  const ctxS = base({ world:'sanctum-light', align:'good' });
  m = H.dispatch('roundStart', ctxS)[0];
  ok(m && m.bannerText.includes('+8'), 'halo heal telegraphed');
  ok(H.dispatch('tick', ctxS).length >= 0, 'god beam tick survives headless (no document)');
  m = H.dispatch('answer', base({ world:'sanctum-light', align:'good', res:{ correct:true, picked:1, correctIdx:1 } }))[0];
  ok(m && m.hpDelta === +8, 'correct answer heals +8');
  const ms = H.dispatch('answer', base({ world:'sanctum-light', align:'good', res:{ correct:false, picked:2, correctIdx:1 } }));
  ok(!ms.some(x => x.flag === 'halo-heal'), 'wrong answer in sanctum heals nothing (exemplar shield may still fire)');

  /* [3] void: quick answer banks token; 3 tokens -> lens spends on next void round */
  const ctxV = base({ world:'void-black', align:'chaotic' });
  m = H.dispatch('roundStart', ctxV)[0];
  ok(m && /EVENT HORIZON/.test(m.bannerText), 'void round announces token rule');
  const t0 = performance.now();
  performance.now = () => t0 + 3000; /* answered in 3s */
  m = H.dispatch('answer', base({ world:'void-black', align:'chaotic', res:{ correct:true, picked:3, correctIdx:3 } }))[0];
  performance.now = realNow;
  ok(m && m.flag === 'void-token' && H.state.get('pack-realm:voidTokens') === 1, 'quick correct answer banks token 1');
  performance.now = () => t0 + 6000; /* too slow */
  m = H.dispatch('answer', base({ world:'void-black', align:'chaotic', res:{ correct:true, picked:3, correctIdx:3 } }))[0];
  performance.now = realNow;
  ok(!m, 'slow correct answer banks nothing');

  H.state.set('pack-realm:voidTokens', 3);
  m = H.dispatch('roundStart', base({ world:'void-black', align:'chaotic' }))[0];
  ok(m && m.flag === 'void-lens' && m.disableOptionIdx.length === 1, 'lens spends 3 tokens, disables one option');
  ok(H.state.get('pack-realm:voidTokens') === 0, 'token balance drained to 0');

  /* [4] pit: roulette telegraphs one hazard; deterministic per seed */
  const p1 = H.dispatch('roundStart', base({ world:'hazard-pit', seed:77, rng:mkRng(77) }))[0];
  const p2 = H.dispatch('roundStart', base({ world:'hazard-pit', seed:77, rng:mkRng(77) }))[0];
  ok(p1 && p2 && p1.bannerText.startsWith('HAZARD PIT') && p1.bannerText === p2.bannerText && p1.flag === p2.flag, 'pit hazard seeded-deterministic + telegraphed');
  const kinds = new Set();
  for (let s = 0; s < 24; s++) {
    const mm = H.dispatch('roundStart', base({ world:'hazard-pit', seed:s, rng:mkRng(s), round:s+3 }))[0];
    kinds.add(mm.flag);
  }
  ok(kinds.size === 3, 'roulette covers all three mini-hazards (' + [...kinds].join(',') + ')');

  /* interlude cleanup is safe headless */
  H.dispatch('interlude', {});
  ok(true, 'interlude dispatched');

  /* no Math.random anywhere in our file */
  const src = require('fs').readFileSync(path + 'pack-realm.js', 'utf8');
  ok(!/Math\.random\s*\(/.test(src), 'zero Math.random usage');
  console.log(fails ? ('\n' + fails + ' FAILURES') : '\nALL SMOKE CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH', e); process.exit(2); });
