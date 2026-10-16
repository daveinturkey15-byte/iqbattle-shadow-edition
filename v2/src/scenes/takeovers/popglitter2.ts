/**
 * POPGLITTER2 — takeover scene (v2 port of modes/pop-glitter-stage.js, mechanic not code).
 *
 * 'CHART TOPPER': a pop-music rhythm-tap set. Four lanes; notes fall toward the
 *   hit line; tap (D F J K / 1–4 / tap pads) inside a generous ±120 ms window.
 *   Combos pay DIRECTLY: +15 per new tier of 5. A miss breaks the combo ONLY —
 *   never costs hp or negative points mid-set. Set length: 35 s seeded chart
 *   (clamped inside ctx.timerLen so the scene always self-resolves).
 *
 * Determinism: the whole chart derives from ctx.seed via an own mulberry32 —
 *   FIXED DRAW ORDER (per beat: occupancy roll [forced on first/last beat],
 *   lane roll, then deep-chart off-beat roll + lane roll). No Math.random, no
 *   Date.now — the clock is Pixi's shared ticker delta. Judgment math ALWAYS
 *   uses real clock; IQB_MOTION='0' only switches rendering to stepped 110 ms
 *   quanta and disables shake (rules identical).
 *
 *   no fullscreen flashes; text >= 11 px; Esc ends the set early with the
 *   current tally; StageResult settles exactly once; ctx.container emptied.
 *
 * Result: correct=true at >= 35% hit-rate -> points = earned capped at the
 *   economy band top min(480, round((100*diff+40)*1.35)); otherwise
 *   correct=false, points -(10+10*diff), hpDelta -6.
 */
import { Container, Graphics, Rectangle, Sprite, Texture, Ticker } from 'pixi.js';
import type { Prim } from '../../glyphs.ts';
import { tileCanvas } from '../../glyphs.ts';
import { panel, text } from '../game.ts';
import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import { mulberry32, onceResolve } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested below)                                      */
/* ------------------------------------------------------------------ */

const PG_SALT = 0x70911e;
export const LANES = 4;
export const SET_MS = 35000; // the 35 s set
export const LEADIN_MS = 1200;
export const TRAVEL_MS = 1600; // fall time top -> hit line
export const WINDOW_MS = 120; // generous hit window (+/-)
export const PERFECT_MS = 55;
export const STEP_MS = 110; // motion-off render quantum
const SETTLE_MS = 900; // always resolve before the engine timer
export const BPM_POP = 118;
export const BEAT_MS_POP = 60000 / BPM_POP;
export const COMBO_TIER = 5;
export const TIER_BONUS = 15;

/** Puzzle-baseline difficulty from round depth (mirrors main.ts dealPuzzle). */
export function depthDiff(depth: number): number {
  return Math.min(5, Math.max(1, 1 + Math.floor(Math.max(1, depth) / 6)));
}

/** Takeover earnings cap: 135% of the puzzle baseline 100*diff+40, hard top 480. */
export function takeoverBandCap(diff: number): number {
  const d = Math.min(5, Math.max(1, Math.floor(diff)));
  return Math.min(480, Math.round((100 * d + 40) * 1.35));
}

/** Chart span: 35 s, clamped so set-end + settle fits inside the round timer. */
export function chartDurationMs(timerLen: number): number {
  return Math.max(4000, Math.min(SET_MS, Math.max(5, timerLen) * 1000 - SETTLE_MS));
}

export interface RNote {
  /** music time (ms after lead-in) the note crosses the hit line */
  t: number;
  lane: number;
}

/**
 * Seeded chart — FIXED DRAW ORDER (do not reorder): per beat, occupancy roll
 * (forced true on first/last beat), lane roll, then [depth >= 6] off-beat
 * sparkle roll + lane roll. Notes sorted by time; first beat always present.
 */
export function buildChart(seed: number, depth: number, timerLen: number): RNote[] {
  const rng = mulberry32((seed ^ PG_SALT) >>> 0);
  const diff = depthDiff(depth);
  const dens = Math.min(0.8, 0.42 + 0.09 * diff);
  const deep = depth >= 6;
  const dur = chartDurationMs(timerLen);
  const beats = Math.floor((dur - LEADIN_MS) / BEAT_MS_POP);
  const notes: RNote[] = [];
  for (let b = 0; b < beats; b++) {
    const t = Math.round(LEADIN_MS + b * BEAT_MS_POP);
    if (b === 0 || b === beats - 1 || rng() < dens) {
      notes.push({ t, lane: Math.floor(rng() * LANES) });
    }
    if (deep && b > 2 && rng() < 0.22) {
      notes.push({ t: t + Math.round(BEAT_MS_POP / 2), lane: Math.floor(rng() * LANES) });
    }
  }
  notes.sort((a, b) => a.t - b.t);
  if (notes.length === 0) notes.push({ t: LEADIN_MS, lane: 0 });
  return notes;
}

/**
 * Nearest unjudged note in `lane` with |n.t - now| <= windowMs, or -1.
 * Notes MUST be time-sorted (early break is load-bearing).
 */
export function pickNote(
  notes: readonly RNote[],
  judged: readonly boolean[],
  now: number,
  lane: number,
  windowMs = WINDOW_MS,
): number {
  let best = -1;
  let bestDt = Infinity;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n.lane !== lane || judged[i]) continue;
    const dt = n.t - now;
    if (dt > windowMs) break; // sorted: later notes only farther
    const ad = Math.abs(dt);
    if (ad <= windowMs && ad < bestDt) {
      bestDt = ad;
      best = i;
    }
  }
  return best;
}

/** Combo bonus paid when the current combo crosses into a NEW tier of 5. */
export function comboTierBonus(combo: number, lastTier: number): number {
  const tier = Math.floor(combo / COMBO_TIER);
  return tier > lastTier ? TIER_BONUS * (tier - lastTier) : 0;
}

export interface VerdictLabels {
  /** tally noun: NOTES / RIFFS */
  noun: string;
  /** win prefix, e.g. 'CHART TOPPER' */
  win: string;
  /** fail prefix, e.g. 'OFF BEAT' */
  fail: string;
}

/** Canonical takeover verdict: >= 35% hit-rate wins, misses never hurt mid-play. */
export function stageVerdict(
  hits: number,
  total: number,
  earned: number,
  diff: number,
  bestCombo: number,
  labels: VerdictLabels,
): StageResult {
  const rate = total > 0 ? hits / total : 0;
  if (rate >= 0.35) {
    return {
      correct: true,
      points: Math.min(takeoverBandCap(diff), earned),
      hpDelta: 0,
      summary: `${labels.win} ${hits}/${total} ${labels.noun} C${bestCombo}`.slice(0, 48),
    };
  }
  const d = Math.min(5, Math.max(1, Math.floor(diff)));
  return {
    correct: false,
    points: -(10 + 10 * d),
    hpDelta: -6,
    summary: `${labels.fail} ${hits}/${total} ${labels.noun}`.slice(0, 48),
  };
}

/** DNA primitive marks per lane (56 px cell space) — structure carries the lane. */
export function lanePrims(lane: number): Prim[] {
  switch (lane % 4) {
    case 0: // triangle outline trio
      return [
        { k: 'tri', x: 28, y: 18, s: 12 },
        { k: 'tri', x: 19, y: 38, s: 10 },
        { k: 'tri', x: 37, y: 38, s: 10 },
      ];
    case 1: // center diamond + corner dots
      return [
        { k: 'diamond', x: 28, y: 28, s: 15 },
        { k: 'dot', x: 10, y: 10, r: 4 },
        { k: 'dot', x: 46, y: 10, r: 4 },
        { k: 'dot', x: 10, y: 46, r: 4 },
        { k: 'dot', x: 46, y: 46, r: 4 },
      ];
    case 2: // dot quad
      return [
        { k: 'dot', x: 18, y: 18, r: 6 },
        { k: 'dot', x: 38, y: 18, r: 6 },
        { k: 'dot', x: 18, y: 38, r: 6 },
        { k: 'dot', x: 38, y: 38, r: 6 },
      ];
    default: // axis cross through a center dot
      return [
        { k: 'line', x1: 28, y1: 10, x2: 28, y2: 46 },
        { k: 'line', x1: 10, y1: 28, x2: 46, y2: 28 },
        { k: 'dot', x: 28, y: 28, r: 5 },
      ];
  }
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const FIELD_W = 740;
const FIELD_H = 600;
const FIELD_X = (STAGE_W - FIELD_W) / 2;
const FIELD_Y = 124;
const PAD_W = 172;
const PAD_H = 62;

interface JudgeFx {
  txt: string;
  color: number;
  lane: number;
  until: number;
}

export function mountPopGlitter(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const MOTION = typeof localStorage === 'undefined' || localStorage.getItem('IQB_MOTION') !== '0';
  const hue = T.boardHues[ctx.seed % T.boardHues.length];
  const HUE_NUM = Number.parseInt(hue.slice(1), 16);
  const settle = onceResolve(ctx.onDone);
  const diff = depthDiff(ctx.depth);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  panel(root, STAGE_W / 2 - 320, 30, 640, 66);
  text(root, 'CHART TOPPER · TAP THE BEAT', STAGE_W / 2 - 168, 48, 22, hue, true);
  text(root, 'MISS BREAKS THE COMBO ONLY — NEVER YOUR HP', STAGE_W / 2 - 178, 800, 13, T.muted);

  panel(root, FIELD_X, FIELD_Y, FIELD_W, FIELD_H);
  const hitY = FIELD_Y + FIELD_H * 0.82;
  const lanesG = new Graphics();
  const laneW = FIELD_W / LANES;
  for (let l = 1; l < LANES; l++) {
    lanesG.moveTo(FIELD_X + l * laneW, FIELD_Y + 8).lineTo(FIELD_X + l * laneW, FIELD_Y + FIELD_H - 8)
      .stroke({ color: HUE_NUM, width: 1, alpha: 0.22 });
  }
  lanesG.moveTo(FIELD_X + 6, hitY).lineTo(FIELD_X + FIELD_W - 6, hitY)
    .stroke({ color: Number.parseInt(T.gold.slice(1), 16), width: 3, alpha: 0.95 });
  root.addChild(lanesG);

  /* ---- tap pads ---- */
  const KEYS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
  const LABELS = ['D·1', 'F·2', 'J·3', 'K·4'];
  const pads: Sprite[] = [];
  const padsRowW = LANES * PAD_W + (LANES - 1) * 16;
  for (let i = 0; i < LANES; i++) {
    const p = new Sprite(Texture.WHITE);
    p.width = PAD_W;
    p.height = PAD_H;
    p.x = FIELD_X + (FIELD_W - padsRowW) / 2 + i * (PAD_W + 16);
    p.y = 752;
    p.tint = 0x10141f;
    p.eventMode = 'static';
    p.cursor = 'pointer';
    const idx = i;
    p.on('pointerdown', () => tap(idx));
    root.addChild(p);
    const lbl = text(root, LABELS[i], p.x + PAD_W / 2 - 15, p.y + 21, 16, hue, true);
    lbl.eventMode = 'none';
    pads.push(p);
  }

  /* ---- notes ---- */
  const notes = buildChart(ctx.seed, ctx.depth, ctx.timerLen);
  const judged: boolean[] = notes.map(() => false);
  const laneTex = Array.from({ length: LANES }, (_, l) => Texture.from(tileCanvas(lanePrims(l), hue, 56)));
  const noteLayer = new Container();
  root.addChild(noteLayer);
  const sprites = notes.map((n) => {
    const s = new Sprite(laneTex[n.lane]);
    s.anchor.set(0.5);
    s.x = FIELD_X + (n.lane + 0.5) * laneW;
    s.renderable = false;
    noteLayer.addChild(s);
    return s;
  });

  /* ---- hud ---- */
  const comboT = text(root, '', STAGE_W / 2, FIELD_Y + FIELD_H * 0.3, 26, T.gold, true);
  comboT.anchor.set(0.5, 0.5);
  const judgeT = text(root, '', STAGE_W / 2, hitY - 42, 17, T.ink, true);
  judgeT.anchor.set(0.5, 0.5);
  const readyT = text(root, 'GET READY…', STAGE_W / 2, FIELD_Y + FIELD_H * 0.55, 15, hue, true);
  readyT.anchor.set(0.5, 0.5);
  const status = text(root, '', FIELD_X, 838, 15, T.ink, true);
  text(root, 'ESC ENDS THE SET WITH THE CURRENT TALLY', FIELD_X, 866, 12, T.muted);

  /* ---- state ---- */
  let clock = 0; // scene ms; music time = clock - LEADIN_MS
  let earned = 0;
  let hits = 0;
  let misses = 0;
  let combo = 0;
  let bestCombo = 0;
  let lastTier = 0;
  let dead = false;
  let fx: JudgeFx | null = null;
  let shakeUntil = 0;
  let shakeMag = 0;
  const padLitUntil = [0, 0, 0, 0];

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function verdict(): StageResult {
    return stageVerdict(hits, notes.length, earned, diff, bestCombo, {
      noun: 'NOTES',
      win: 'CHART TOPPER',
      fail: 'OFF BEAT',
    });
  }

  function shake(mag: number, ms: number): void {
    if (!MOTION) return;
    shakeMag = Math.max(shakeMag, mag);
    shakeUntil = Math.max(shakeUntil, clock + ms);
  }

  function tap(lane: number): void {
    if (dead || lane < 0 || lane >= LANES) return;
    padLitUntil[lane] = clock + 90;
    const now = clock - LEADIN_MS;
    const i = pickNote(notes, judged, now, lane);
    if (i < 0) return; // stray tap: pad lights, nothing else
    judged[i] = true;
    sprites[i].renderable = false;
    const perfect = Math.abs(notes[i].t - now) <= PERFECT_MS;
    combo++;
    hits++;
    if (combo > bestCombo) bestCombo = combo;
    earned += comboTierBonus(combo, lastTier);
    lastTier = Math.floor(combo / COMBO_TIER);
    earned += perfect ? 15 : 10;
    fx = { txt: perfect ? 'PERFECT' : 'GOOD', color: perfect ? 0x7cffb2 : 0x7dd3fc, lane, until: clock + 320 };
    shake(5, 120);
  }

  function sweepMisses(now: number): void {
    for (let i = 0; i < notes.length; i++) {
      if (judged[i]) continue;
      if (notes[i].t + WINDOW_MS < now) {
        judged[i] = true;
        misses++;
        combo = 0; // combo break ONLY — no hp/score pain mid-set
        lastTier = 0;
        fx = { txt: 'MISS', color: 0xff2038, lane: notes[i].lane, until: clock + 260 };
      } else break;
    }
  }

  /* ---- input ---- */
  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish(verdict());
      return;
    }
    if (e.repeat) return;
    let lane = KEYS.indexOf(e.code);
    const m = /^Digit([1-4])$/.exec(e.code) ?? /^Numpad([1-4])$/.exec(e.code);
    if (lane < 0 && m) lane = Number(m[1]) - 1;
    if (lane >= 0) tap(lane);
  }
  window.addEventListener('keydown', onKey);
  root.eventMode = 'static';
  root.hitArea = new Rectangle(0, 0, STAGE_W, STAGE_H);

  /* ---- clock: Pixi ticker only, never Date.now ---- */
  const dur = chartDurationMs(ctx.timerLen);
  const lastT = notes[notes.length - 1].t;
  const onTick = (tk: Ticker): void => {
    if (dead) return;
    clock += tk.deltaMS;
    const now = clock - LEADIN_MS;

    sweepMisses(now);
    const endAt = Math.min(dur - LEADIN_MS, lastT + 800);
    if (now >= endAt) {
      finish(verdict());
      return;
    }

    // falling notes (stepped quanta when IQB_MOTION off; judgment stays real-time)
    const stepClock = MOTION ? now : Math.max(-LEADIN_MS, Math.floor(now / STEP_MS) * STEP_MS);
    for (let i = 0; i < notes.length; i++) {
      const s = sprites[i];
      if (judged[i]) {
        s.renderable = false;
        continue;
      }
      const prog = (stepClock - (notes[i].t - TRAVEL_MS)) / TRAVEL_MS;
      if (prog < -0.05 || prog > 1.25) {
        s.renderable = false;
        continue;
      }
      s.renderable = true;
      s.y = FIELD_Y + 16 + prog * (hitY - FIELD_Y - 16);
      s.alpha = prog > 1 ? Math.max(0, 1.25 - prog) * 4 : 1;
    }

    // shake (motion-gated, deterministic sine jitter — no Math.random)
    if (clock < shakeUntil) {
      root.x = Math.sin(clock * 0.131) * shakeMag;
      root.y = Math.cos(clock * 0.173) * shakeMag * 0.6;
    } else if (root.x !== 0 || root.y !== 0) {
      root.x = 0;
      root.y = 0;
      shakeMag = 0;
    }

    // pads lit
    for (let i = 0; i < LANES; i++) pads[i].tint = clock < padLitUntil[i] ? HUE_NUM : 0x10141f;

    // hud
    readyT.renderable = now < 0;
    comboT.text = combo > 1 ? `${combo}x COMBO` : '';
    if (fx && clock < fx.until) {
      judgeT.text = fx.txt;
      judgeT.style.fill = fx.color;
      judgeT.x = FIELD_X + (fx.lane + 0.5) * laneW;
      judgeT.renderable = true;
    } else {
      judgeT.renderable = false;
    }
    status.text =
      `HITS ${hits}/${notes.length} · MISSES ${misses} · SCORE ${earned} · ` +
      `${Math.max(0, Math.ceil((endAt - now) / 1000))}s`;
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // duration clamps
  if (chartDurationMs(60) !== SET_MS) failures.push('chartDurationMs should cap at 35 s');
  if (chartDurationMs(5) !== 5000 - SETTLE_MS) failures.push('chartDurationMs should fit tiny timers');
  if (chartDurationMs(0) < 4000) failures.push('chartDurationMs floor broken');

  // 300 seeds: chart determinism + structure + window math
  for (let seed = 1; seed <= 300; seed++) {
    const depth = 1 + ((seed * 7) % 36);
    const timerLen = 10 + ((seed * 11) % 51);
    const a = buildChart(seed, depth, timerLen);
    const b = buildChart(seed, depth, timerLen);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failures.push(`chart nondeterministic seed=${seed}`);
      break;
    }
    const dur = chartDurationMs(timerLen);
    if (a.some((n) => n.lane < 0 || n.lane >= LANES)) {
      failures.push(`bad lane seed=${seed}`);
      break;
    }
    if (a.some((n, i) => i > 0 && n.t < a[i - 1].t)) {
      failures.push(`chart unsorted seed=${seed}`);
      break;
    }
    if (a[0].t !== LEADIN_MS || a.some((n) => n.t >= dur) || a.some((n) => n.t < LEADIN_MS)) {
      failures.push(`chart span broken seed=${seed}`);
      break;
    }

    // window math against THIS seed's chart: every note is on-time hittable,
    // boundary-inclusive, and just-outside unhittable
    for (const at of [-WINDOW_MS, 0, WINDOW_MS]) {
      const j: boolean[] = a.map(() => false);
      const probe = a.map((n) => n.t + at);
      let bad = false;
      for (let i = 0; i < probe.length; i++) {
        const got = pickNote(a, j, probe[i], a[i].lane);
        if (got < 0 || Math.abs(a[got].t - probe[i]) > WINDOW_MS) {
          bad = true;
          break;
        }
        j[got] = true;
      }
      if (bad) {
        failures.push(`window math broken seed=${seed} offset=${at}`);
        break;
      }
    }
    if (failures.length > 0) break;
    const j0: boolean[] = a.map(() => false);
    const last = a[a.length - 1];
    if (pickNote(a, j0, last.t + WINDOW_MS + 1, last.lane) !== -1) {
      failures.push(`window not exclusive seed=${seed}`);
      break;
    }
  }
  if (failures.length > 0) return { ok: false, failures };

  // judging details on a synthetic chart
  const syn: RNote[] = [
    { t: 1000, lane: 0 },
    { t: 1060, lane: 0 },
    { t: 2000, lane: 1 },
  ];
  const J = (): boolean[] => [false, false, false];
  if (pickNote(syn, J(), 1060, 0) !== 1) failures.push('nearest-note selection wrong');
  if (pickNote(syn, J(), 1180, 0) !== 1) failures.push('window upper bound should be inclusive');
  if (pickNote(syn, J(), 1181, 0) !== -1) failures.push('window must be exclusive past +120 ms');
  if (pickNote(syn, J(), 880, 0) !== 0) failures.push('window lower bound should be inclusive');
  if (pickNote(syn, J(), 879, 0) !== -1) failures.push('window must be exclusive past -120 ms');
  {
    const j = J();
    j[1] = true;
    if (pickNote(syn, j, 1060, 0) !== 0) failures.push('judged notes must be skipped');
    if (pickNote(syn, J(), 1060, 2) !== -1) failures.push('wrong lane must never match');
  }

  // scoring math
  if (comboTierBonus(4, 0) !== 0 || comboTierBonus(5, 0) !== 15 || comboTierBonus(5, 1) !== 0) {
    failures.push('combo tier bonus wrong');
  }
  if (comboTierBonus(27, 4) !== 15) failures.push('multi-tier jump underpaid');
  if (takeoverBandCap(1) !== 189 || takeoverBandCap(5) !== 480 || takeoverBandCap(99) !== 480) {
    failures.push('band cap wrong');
  }
  {
    const win = stageVerdict(35, 100, 9999, 1, 20, { noun: 'NOTES', win: 'W', fail: 'F' });
    if (win.correct !== true || win.points !== 189 || win.hpDelta !== 0) failures.push('win verdict wrong');
    const lose = stageVerdict(34, 100, 500, 1, 4, { noun: 'NOTES', win: 'W', fail: 'F' });
    if (lose.correct !== false || lose.points !== -20 || lose.hpDelta !== -6) failures.push('fail verdict wrong');
    const zero = stageVerdict(0, 0, 0, 3, 0, { noun: 'NOTES', win: 'W', fail: 'F' });
    if (zero.correct !== false) failures.push('empty chart must not count as a win');
  }
  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/scenes/takeovers/popglitter2.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/popglitter2.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] POPGLITTER2 OK' : `[selftest] POPGLITTER2 FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
