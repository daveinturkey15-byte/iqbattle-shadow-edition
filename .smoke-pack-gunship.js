/* .smoke-pack-gunship.js — behavioral harness for pack-gunship.js against the
 * REAL hooks.js in node. Run: node .smoke-pack-gunship.js   (exit 0 = pass)
 *
 * Notes:
 *  - Strikes are RE-ASSERTED every tick of their 3s window (engine contract),
 *    so the harness collapses consecutive identical disables into strike
 *    EVENTS before checking targeting rules.
 *  - Expected event kind is derived by mirroring the documented rule set
 *    (every-3rd smoke, strike cap leaving >=2 selectable, forced mercy opener
 *    after a correct-column hit) — the harness replays the RULES, the pack
 *    owns the timing.
 *  - Each scenario calls Hooks.beginRun so cross-run memory starts clean. */
'use strict';
const path = require('path');
global.window = globalThis;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const H = require(path.join(__dirname, 'hooks.js'));
require(path.join(__dirname, 'pack-gunship.js'));
const IQ = global.IQ;

const WID = 'warzone-pavelow';
const DT = 1 / 30;
const FORBIDDEN = ['hpDelta', 'forceWrong', 'invertControlsMs', 'pickup', 'timerDelta'];
const OPTS = 8;

let failures = 0, passes = 0;
function ok(cond, msg) {
  if (!cond) { failures++; console.error('FAIL: ' + msg); }
  else { passes++; console.log('pass: ' + msg); }
}
ok(IQ.Hooks === H, 'pack registered into real IQ.Hooks');

/* Engine-like dispatcher: fresh seeded rng per call, seq increments. */
function mkSim(seedBase) {
  let seq = 0;
  return function send(evt, extra) {
    const rng = H.makeRng((seedBase ^ Math.imul(7, 0x9E3779B1) ^ (++seq)) >>> 0);
    return H.dispatch(evt, Object.assign({
      depth: 1, stage: 1, score: 0, streak: 0, lms: false, mp: false, rng
    }, extra || {}));
  };
}

/* Collapse per-tick disable re-assertions into distinct strike events. */
function strikeEvents(disables) {
  const evts = [];
  for (const d of disables) {
    const last = evts[evts.length - 1];
    if (last && last.idx === d.idx[0] && d.t - last.tEnd < 1.0) { last.tEnd = d.t; continue; }
    evts.push({ idx: d.idx[0], t: d.t, tEnd: d.t });
  }
  return evts;
}

/*
 * Run `roundsToRun` rounds of ticks; collect banners/disables/scoreMuls.
 * Mirrors the pack's documented decision rules to derive EXPECTED event kinds,
 * then compares against observed banners 1:1.
 */
function runRounds(opts) {
  const hp = opts.hp != null ? opts.hp : 100;
  const send = mkSim(opts.seed);
  const out = { events: [], disables: [], forbiddenHits: [], overlays: [], spotBanner: false };
  // per-round rule replay state
  let n = 0, strikes = 0, mercyOpen = false;

  for (let r = 1; r <= opts.rounds; r++) {
    n = 0; strikes = 0;
    const avoid = out['avoid_r' + r];
    mercyOpen = avoid != null;                    // previous round hit correct slot

    const resp = send('roundStart', { round: r, world: WID, align: 'bad', hp });
    for (const m of resp) {
      if (m && m.overlayHTML) out.overlays.push({ r });
      if (m && /SPOTTING/.test(m.bannerText || '')) out.spotBanner = true;
    }

    let t = 0, lastBanner = '';
    while (t < 90) {
      t += DT;
      for (const m of send('tick', { round: r, hp, dtSec: DT })) {
        if (!m || typeof m !== 'object') continue;
        for (const bad of FORBIDDEN)
          if (Object.prototype.hasOwnProperty.call(m, bad))
            out.forbiddenHits.push(bad + '@r' + r + 't' + t.toFixed(1));
        if (Array.isArray(m.disableOptionIdx))
          out.disables.push({ r, t, idx: m.disableOptionIdx.slice() });
        if (typeof m.scoreMul === 'number')
          out.events.push({ r, t, kind: 'scoreMul', v: m.scoreMul });
        if (m.bannerText && m.bannerText !== lastBanner &&
            /BARRAGE|SMOKE/.test(m.bannerText)) {
          lastBanner = m.bannerText;
          // --- rule replay ---
          n++;
          const wantSmoke = mercyOpen ? (mercyOpen = false, true)
            : strikes >= OPTS - 2 || n % 3 === 0;
          const gotSmoke = /SMOKE/.test(m.bannerText);
          if (!gotSmoke) strikes++;
          out.events.push({
            r, t, kind: gotSmoke ? 'smoke' : 'strike',
            wantKind: wantSmoke ? 'smoke' : 'strike', n
          });
        }
      }
    }

    /* tell the pack the truth about this round's correct slot */
    const evts = strikeEvents(out.disables.filter(d => d.r === r));
    const correctIdx = evts.length ? evts[evts.length - 1].idx : 0;
    send('answer', { round: r, res: { correct: false, picked: 2, correctIdx } });
    send('reveal', { round: r, correctIdx });
    out['correct_r' + r] = correctIdx;
    if (opts.rounds > r) out['avoid_r' + (r + 1)] =
      (evts.length && evts[evts.length - 1].idx === correctIdx) ? correctIdx : null;
  }
  return out;
}

/* ============================ scenarios ============================ */

/* --- 1. structure + fairness + targeting rules --- */
{
  H.beginRun('gunship-s1', 4242);
  const o = runRounds({ seed: 12345, rounds: 2 });

  ok(o.forbiddenHits.length === 0,
    'no forbidden modifiers ever (hpDelta/forceWrong/invertControlsMs/pickup/timerDelta)' +
    (o.forbiddenHits.length ? ' -> ' + o.forbiddenHits.slice(0, 3).join(', ') : ''));
  ok(o.spotBanner, 'SPOTTING banner fires at round start');
  ok(o.overlays.length === 2, 'exactly ONE spot overlay per roundStart (no node stacking)');

  ok(!o.disables.some(d => d.r === 1 && d.t < 3), 'SPOTTING telegraph touches no option for 3s');

  const evts = o.events.filter(e => e.kind === 'strike' || e.kind === 'smoke');
  ok(evts.length >= 8, 'enough events observed (' + evts.length + ')');
  evts.forEach(e =>
    ok(e.kind === e.wantKind,
      `round ${e.r} event #${e.n} expected ${e.wantKind}, got ${e.kind}`));

  for (const r of [1, 2]) {
    const se = strikeEvents(o.disables.filter(d => d.r === r));
    ok(se.length > 0, `round ${r}: at least one barrage fired`);
    ok(se.length <= OPTS - 2, `round ${r}: <= optCount-2 strikes (>=2 options stay selectable)`);
    ok(new Set(se.map(e => e.idx)).size === se.length, `round ${r}: strikes hit UNIQUE columns`);
    for (let i = 1; i < se.length; i++)
      ok(se[i].idx !== se[i - 1].idx, `round ${r}: never the same column twice in a row`);
    se.forEach(e => ok(e.idx >= 0 && e.idx < OPTS, `round ${r}: strike index in range`));

    /* every strike banner pairs with a disable assertion */
    const stBan = o.events.filter(e => e.r === r && e.kind === 'strike').map(e => e.t);
    stBan.forEach(bt =>
      ok(o.disables.some(d => d.r === r && Math.abs(d.t - bt) < DT * 1.5),
        `round ${r}: strike banner @${bt.toFixed(2)} carries disableOptionIdx`));
  }

  /* cross-round seeded mercy */
  const c1 = o['correct_r1'], avoid2 = o['avoid_r2'];
  const se2 = strikeEvents(o.disables.filter(d => d.r === 2));
  if (avoid2 != null) {
    ok(!se2.some(e => e.idx === avoid2),
      `round 2 never strafes the slot correct in round 1 (avoid ${avoid2})`);
    const firstEv = o.events.find(e => e.r === 2 && (e.kind === 'strike' || e.kind === 'smoke'));
    ok(firstEv && firstEv.kind === 'smoke',
      'after a correct-column hit, NEXT round opens with forced SMOKE');
  } else {
    ok(true, 'round 1 happened not to hit the correct slot (rule not exercised)');
  }
  ok(c1 != null, 'reveal bookkeeping recorded round 1 correct slot');
}

/* --- 2. under-fire scoring --- */
{
  H.beginRun('gunship-s2', 999);
  const send = mkSim(555);
  send('roundStart', { round: 1, world: WID, align: 'bad', hp: 100 });
  let got = null, t = 0, sawBarrage = false, sawSmoke = false, smokeLeak = false;
  while (t < 90) {
    t += DT;
    const mods = send('tick', { round: 1, hp: 100, dtSec: DT });
    const banner = mods.map(m => m && m.bannerText).join('');
    const isB = /BARRAGE/.test(banner), isS = /SMOKE/.test(banner);
    if (isB) sawBarrage = true;
    if (isS) sawSmoke = true;
    if ((isB || isS || (sawBarrage && got == null))) {
      const pm = send('preAnswer', { round: 1, hp: 100, pos: 3 });
      const mul = pm.find(m => m && m.scoreMul != null);
      if (isB && mul && got == null) got = mul.scoreMul;
      if (isS && mul) smokeLeak = true;
    }
  }
  ok(sawBarrage && sawSmoke, 'both barrages and smoke windows occurred in probe run');
  ok(got === 1.25, `answering DURING an active barrage returns scoreMul 1.25 (got ${got})`);
  ok(!smokeLeak, 'answering during a SMOKE safe window earns NO bonus');

  // spotting-phase answers earn nothing
  const send2 = mkSim(556);
  send2('roundStart', { round: 1, world: WID, align: 'bad', hp: 100 });
  let t2 = 0, leak = false;
  while (t2 < 1.5) { t2 += DT; send2('tick', { round: 1, hp: 100, dtSec: DT }); }
  for (const m of send2('preAnswer', { round: 1, hp: 100, pos: 3 }))
    if (m && m.scoreMul != null) leak = true;
  ok(!leak, 'no scoreMul outside barrage windows (spotting probe)');
}

/* --- 3. timeout answers never earn the bonus --- */
{
  H.beginRun('gunship-s3', 60);
  const send = mkSim(77);
  send('roundStart', { round: 1, world: WID, align: 'bad', hp: 100 });
  let t = 0, bad = false;
  while (t < 20) {
    t += DT;
    const mods = send('tick', { round: 1, hp: 100, dtSec: DT });
    if (mods.some(m => m && /BARRAGE/.test(m.bannerText || ''))) {
      for (const m of send('preAnswer', { round: 1, hp: 100, pos: -1 }))
        if (m && m.scoreMul != null) bad = true;
      break;
    }
  }
  ok(!bad, 'timeout answers (pos=-1) never earn the under-fire bonus');
}

/* --- 4. parity --- */
{
  H.beginRun('gunship-pa', 1);
  const a = JSON.stringify(runRounds({ seed: 888888, rounds: 2 }));
  H.beginRun('gunship-pb', 1);
  const b = JSON.stringify(runRounds({ seed: 888888, rounds: 2 }));
  ok(a === b, 'parity: identical seeds produce identical modifier streams');
}

/* --- 5. mercy cadence: low hp -> slower repeats --- */
{
  function avgGap(hp, seed) {
    const send = mkSim(seed);
    send('roundStart', { round: 1, world: WID, align: 'bad', hp });
    const starts = [];
    let t = 0;
    while (t < 150) {
      t += DT;
      for (const m of send('tick', { round: 1, hp, dtSec: DT }))
        if (m && /BARRAGE/.test(m.bannerText || '')) starts.push(t);
    }
    const gaps = [];
    for (let i = 1; i < starts.length; i++) gaps.push(starts[i] - starts[i - 1]);
    return gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
  }
  const gFull = avgGap(100, 31337), gLow = avgGap(12, 31337);
  ok(gLow > gFull + 0.5,
    `mercy cadence: avg repeat gap @hp12 (${gLow.toFixed(2)}s) > @hp100 (${gFull.toFixed(2)}s)`);
}

console.log(failures === 0 ? `\nALL ${passes} CHECKS PASSED` : `\n${failures} FAILURES / ${passes} passed`);
process.exit(failures === 0 ? 0 : 1);
