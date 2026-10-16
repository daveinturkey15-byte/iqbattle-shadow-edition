/**
 * METAL2 — takeover scene (v2 port of modes/metal-stage.js, mechanic not code).
 *
 * 'FORGE SET': the heavier twin of CHART TOPPER. Same 4-lane tap model
 *   (D F J K / 1–4 / tap pads) but: slower chart (BPM 92 vs 118), a bigger
 *   motion-gated shake on every hit, DOUBLE POINTS on downbeat accents
 *   (every 4th beat — drawn gold with a telegraph ring so they are readable
 *   before they land), and a deterministic scream-along banner pool
 *   ('WHOA-OH', 'HEY!', 'RAAAGH', …) fired on scheduled bars. Miss = combo
 *   break ONLY.
 *
 * Determinism: chart AND scream schedule each derive from ctx.seed via an own
 *   mulberry32 (separate salts, fixed draw orders documented at the builders).
 *   No Math.random, no Date.now — clock is Pixi's shared ticker delta; shake
 *   jitter is sine-of-clock. Judgment math ALWAYS real-time; IQB_MOTION='0'
 *   only steps rendering to 110 ms quanta, freezes telegraph pulses and
 *   disables shake (rules identical).
 *
 * Fairness rails: one hue accent per board (DNA primitive-mark note sprites;
 *   T.gold is reserved for the ticketed x2 accents); no fullscreen flashes;
 *   text >= 11 px; Esc ends the set with the current tally; StageResult
 *   settles exactly once; ctx.container emptied.
 *
 * Result: correct=true at >= 35% hit-rate -> points = earned (base 11/16,
 *   accents x2, +15 per combo tier) capped at min(480, round((100*diff+40)*1.35));
 *   otherwise correct=false, points -(10+10*diff), hpDelta -6.
 */
import { Container, Graphics, Rectangle, Sprite, Texture, Ticker } from 'pixi.js';
import type { Prim } from '../../glyphs.ts';
import { tileCanvas } from '../../glyphs.ts';
import { panel, text } from '../game.ts';
import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import { mulberry32, onceResolve } from './redlight.ts';
import { comboTierBonus } from './popglitter2.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';
import {
  BEAT_MS_POP,
  BPM_POP,
  COMBO_TIER,
  LANES,
  STEP_MS,
  depthDiff,
  lanePrims,
  pickNote,
  stageVerdict,
  takeoverBandCap,
} from './popglitter2.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested below)                                      */
/* ------------------------------------------------------------------ */

const MG_SALT = 0xf049e;
export const SET_MS_METAL = 35000;
export const LEADIN_MS_METAL = 1400;
export const TRAVEL_MS_METAL = 2100; // slower, heavier fall
export const WINDOW_MS_METAL = 130; // even more generous on the heavy kit
export const PERFECT_MS_METAL = 60;
export const BPM_METAL = 92;
export const BEAT_MS_METAL = 60000 / BPM_METAL;
export const GOOD_PTS = 11;
export const PERFECT_PTS = 16;
export const ACCENT_MULT = 2;

const SETTLE_MS_METAL = 900;
export const SCREAMS = ['WHOA-OH', 'HEY!', 'RAAAGH', 'LOUDER!', 'BREAK IT DOWN!', 'ONE MORE TIME!'];

/** Chart span: 35 s, clamped inside the round timer minus settle margin. */
export function chartDurationMsMetal(timerLen: number): number {
  return Math.max(4000, Math.min(SET_MS_METAL, Math.max(5, timerLen) * 1000 - SETTLE_MS_METAL));
}

export interface MNote {
  /** music time (ms after lead-in) the note crosses the hit line */
  t: number;
  lane: number;
  /** downbeat accent: pays double, drawn gold with a telegraph ring */
  accent: boolean;
}

/**
 * Seeded chart — FIXED DRAW ORDER (do not reorder): per beat, accent is
 * structural (b % 4 === 0, never rolled); occupancy roll (forced when accent),
 * then lane roll. Sparser than the pop chart.
 */
export function buildChartMetal(seed: number, depth: number, timerLen: number): MNote[] {
  const rng = mulberry32((seed ^ MG_SALT) >>> 0);
  const diff = depthDiff(depth);
  const dens = Math.min(0.7, 0.32 + 0.08 * diff);
  const dur = chartDurationMsMetal(timerLen);
  const beats = Math.floor((dur - LEADIN_MS_METAL) / BEAT_MS_METAL);
  const notes: MNote[] = [];
  for (let b = 0; b < beats; b++) {
    const t = Math.round(LEADIN_MS_METAL + b * BEAT_MS_METAL);
    const accent = b % 4 === 0;
    if (accent || rng() < dens) {
      notes.push({ t, lane: Math.floor(rng() * LANES), accent });
    }
  }
  notes.sort((a, b) => a.t - b.t);
  if (notes.length === 0) notes.push({ t: LEADIN_MS_METAL, lane: 0, accent: true });
  return notes;
}

export interface Scream {
  at: number;
  txt: string;
}

/**
 * Seeded scream-along pool — FIXED DRAW ORDER: one roll per scheduled bar
 * (b % 8 === 4) picking the banner text. Own salt: independent of the chart.
 */
export function buildScreams(seed: number, timerLen: number): Scream[] {
  const rng = mulberry32((seed ^ (MG_SALT ^ 0x5c3aa1)) >>> 0);
  const dur = chartDurationMsMetal(timerLen);
  const beats = Math.floor((dur - LEADIN_MS_METAL) / BEAT_MS_METAL);
  const out: Scream[] = [];
  for (let b = 0; b < beats; b++) {
    if (b % 8 === 4) out.push({ at: Math.round(LEADIN_MS_METAL + b * BEAT_MS_METAL), txt: SCREAMS[Math.floor(rng() * SCREAMS.length)] });
  }
  return out;
}

/** Points for one judged note: base good/perfect, accents double. */
export function metalHitPoints(perfect: boolean, accent: boolean): number {
  return (perfect ? PERFECT_PTS : GOOD_PTS) * (accent ? ACCENT_MULT : 1);
}

/** Gold accent marks (56 px cell space): diamond + strike lines. */
export function accentPrims(): Prim[] {
  return [
    { k: 'diamond', x: 28, y: 28, s: 18 },
    { k: 'line', x1: 12, y1: 12, x2: 44, y2: 44 },
    { k: 'line', x1: 44, y1: 12, x2: 12, y2: 44 },
  ];
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
  lane: number; // -1 = centered scream card
  until: number;
}

export function mountMetal(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const MOTION = typeof localStorage === 'undefined' || localStorage.getItem('IQB_MOTION') !== '0';
  const hue = T.boardHues[ctx.seed % T.boardHues.length];
  const HUE_NUM = Number.parseInt(hue.slice(1), 16);
  const GOLD_NUM = Number.parseInt(T.gold.slice(1), 16);
  const settle = onceResolve(ctx.onDone);
  const diff = depthDiff(ctx.depth);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  panel(root, STAGE_W / 2 - 320, 30, 640, 66);
  text(root, 'FORGE SET · HIT THE HEAVY BEAT', STAGE_W / 2 - 176, 48, 22, T.orange, true);
  text(root, 'GOLD ACCENTS PAY DOUBLE · MISS BREAKS THE COMBO ONLY', STAGE_W / 2 - 208, 800, 13, T.muted);

  panel(root, FIELD_X, FIELD_Y, FIELD_W, FIELD_H);
  const hitY = FIELD_Y + FIELD_H * 0.82;
  const lanesG = new Graphics();
  const laneW = FIELD_W / LANES;
  for (let l = 1; l < LANES; l++) {
    lanesG.moveTo(FIELD_X + l * laneW, FIELD_Y + 8).lineTo(FIELD_X + l * laneW, FIELD_Y + FIELD_H - 8)
      .stroke({ color: HUE_NUM, width: 1, alpha: 0.22 });
  }
  lanesG.moveTo(FIELD_X + 6, hitY).lineTo(FIELD_X + FIELD_W - 6, hitY)
    .stroke({ color: GOLD_NUM, width: 4, alpha: 0.95 });
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
    p.tint = 0x14100e;
    p.eventMode = 'static';
    p.cursor = 'pointer';
    const idx = i;
    p.on('pointerdown', () => tap(idx));
    root.addChild(p);
    const lbl = text(root, LABELS[i], p.x + PAD_W / 2 - 15, p.y + 21, 16, T.orange, true);
    lbl.eventMode = 'none';
    pads.push(p);
  }

  /* ---- notes ---- */
  const notes = buildChartMetal(ctx.seed, ctx.depth, ctx.timerLen);
  const screams = buildScreams(ctx.seed, ctx.timerLen);
  const judged: boolean[] = notes.map(() => false);
  const laneTex = Array.from({ length: LANES }, (_, l) => Texture.from(tileCanvas(lanePrims(l), hue, 56)));
  const accentTex = Texture.from(tileCanvas(accentPrims(), T.gold, 56));
  const noteLayer = new Container();
  root.addChild(noteLayer);

  interface NoteUi {
    spr: Sprite;
    ring: Graphics | null;
  }
  const uis: NoteUi[] = notes.map((n) => {
    const s = new Sprite(n.accent ? accentTex : laneTex[n.lane]);
    s.anchor.set(0.5);
    s.x = FIELD_X + (n.lane + 0.5) * laneW;
    s.renderable = false;
    noteLayer.addChild(s);
    let ring: Graphics | null = null;
    if (n.accent) {
      // telegraph ring: readable well before the accent lands
      ring = new Graphics().circle(0, 0, 30).stroke({ color: GOLD_NUM, width: 2, alpha: 0.55 });
      ring.x = s.x;
      ring.renderable = false;
      noteLayer.addChild(ring);
    }
    return { spr: s, ring };
  });

  /* ---- hud ---- */
  const comboT = text(root, '', STAGE_W / 2, FIELD_Y + FIELD_H * 0.28, 28, T.orange, true);
  comboT.anchor.set(0.5, 0.5);
  const screamT = text(root, '', STAGE_W / 2, FIELD_Y + FIELD_H * 0.46, 30, '#ffe9c8', true);
  screamT.anchor.set(0.5, 0.5);
  const judgeT = text(root, '', STAGE_W / 2, hitY - 42, 17, T.ink, true);
  judgeT.anchor.set(0.5, 0.5);
  const readyT = text(root, 'TUNE UP…', STAGE_W / 2, FIELD_Y + FIELD_H * 0.55, 15, T.orange, true);
  readyT.anchor.set(0.5, 0.5);
  const status = text(root, '', FIELD_X, 838, 15, T.ink, true);
  text(root, 'ESC ENDS THE SET WITH THE CURRENT TALLY', FIELD_X, 866, 12, T.muted);

  /* ---- state ---- */
  let clock = 0; // scene ms; music time = clock - LEADIN_MS_METAL
  let earned = 0;
  let hits = 0;
  let misses = 0;
  let combo = 0;
  let bestCombo = 0;
  let lastTier = 0;
  let screamIdx = 0;
  let dead = false;
  let fx: JudgeFx | null = null;
  let screamUntil = 0;
  let shakeUntil = 0;
  let shakeMag = 0;
  const padLitUntil = [0, 0, 0, 0];

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function shake(mag: number, ms: number): void {
    if (!MOTION) return;
    shakeMag = Math.max(shakeMag, mag);
    shakeUntil = Math.max(shakeUntil, clock + ms);
  }

  function tap(lane: number): void {
    if (dead || lane < 0 || lane >= LANES) return;
    padLitUntil[lane] = clock + 110;
    const now = clock - LEADIN_MS_METAL;
    const i = pickNote(notes, judged, now, lane, WINDOW_MS_METAL);
    if (i < 0) return; // stray tap
    judged[i] = true;
    const n = notes[i];
    uis[i].spr.renderable = false;
    if (uis[i].ring) uis[i].ring!.renderable = false;
    const adt = Math.abs(n.t - now);
    const perfect = adt <= PERFECT_MS_METAL;
    combo++;
    hits++;
    if (combo > bestCombo) bestCombo = combo;
    earned += comboTierBonus(combo, lastTier);
    lastTier = Math.floor(combo / COMBO_TIER);
    earned += metalHitPoints(perfect, n.accent);
    fx = n.accent
      ? { txt: 'CRUSHED x2', color: GOLD_NUM, lane, until: clock + 340 }
      : { txt: perfect ? 'PERFECT' : 'GOOD', color: perfect ? 0x7cffb2 : 0xf2ddc8, lane, until: clock + 340 };
    shake(n.accent ? 18 : 13, 280); // BIGGER than the pop twin
  }


  function sweepMisses(now: number): void {
    for (let i = 0; i < notes.length; i++) {
      if (judged[i]) continue;
      if (notes[i].t + WINDOW_MS_METAL < now) {
        judged[i] = true;
        misses++;
        combo = 0; // combo break ONLY
        lastTier = 0;
        uis[i].spr.renderable = false;
        if (uis[i].ring) uis[i].ring!.renderable = false;
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
  const dur = chartDurationMsMetal(ctx.timerLen);
  const lastT = notes[notes.length - 1].t;
  const onTick = (tk: Ticker): void => {
    if (dead) return;
    clock += tk.deltaMS;
    const now = clock - LEADIN_MS_METAL;

    // scream-along banners fire exactly once per scheduled bar
    while (screamIdx < screams.length && screams[screamIdx].at <= now) {
      screamT.text = screams[screamIdx].txt;
      screamIdx++;
      screamUntil = clock + 700;
      shake(6, 200);
    }

    sweepMisses(now);
    const endAt = Math.min(dur - LEADIN_MS_METAL, lastT + 800);
    if (now >= endAt) {
      finish(verdict());
      return;
    }

    // falling notes (stepped quanta when IQB_MOTION off; judgment stays real-time)
    const stepClock = MOTION ? now : Math.max(-LEADIN_MS_METAL, Math.floor(now / STEP_MS) * STEP_MS);
    for (let i = 0; i < notes.length; i++) {
      const ui = uis[i];
      if (judged[i]) continue;
      const prog = (stepClock - (notes[i].t - TRAVEL_MS_METAL)) / TRAVEL_MS_METAL;
      if (prog < -0.05 || prog > 1.25) {
        ui.spr.renderable = false;
        if (ui.ring) ui.ring.renderable = false;
        continue;
      }
      ui.spr.renderable = true;
      ui.spr.y = FIELD_Y + 16 + prog * (hitY - FIELD_Y - 16);
      ui.spr.alpha = prog > 1 ? Math.max(0, 1.25 - prog) * 4 : 1;
      if (ui.ring) {
        ui.ring.renderable = true;
        ui.ring.y = ui.spr.y;
        // ~2 Hz pulse under motion; static outline when motion is off
        ui.ring.alpha = MOTION ? 0.4 + 0.25 * Math.sin(clock / 80) : 0.45;
      }
    }

    // shake (motion-gated, deterministic sine jitter — no Math.random)
    if (clock < shakeUntil) {
      root.x = Math.sin(clock * 0.113) * shakeMag;
      root.y = Math.cos(clock * 0.157) * shakeMag * 0.6;
    } else if (root.x !== 0 || root.y !== 0) {
      root.x = 0;
      root.y = 0;
      shakeMag = 0;
    }

    // pads lit
    for (let i = 0; i < LANES; i++) pads[i].tint = clock < padLitUntil[i] ? HUE_NUM : 0x14100e;

    // hud
    readyT.renderable = now < 0;
    comboT.text = combo > 1 ? `${combo}x COMBO` : '';
    screamT.renderable = clock < screamUntil;
    if (fx && clock < fx.until) {
      judgeT.text = fx.txt;
      judgeT.style.fill = fx.color;
      judgeT.x = fx.lane >= 0 ? FIELD_X + (fx.lane + 0.5) * laneW : STAGE_W / 2;
      judgeT.renderable = true;
    } else {
      judgeT.renderable = false;
    }
    status.text =
      `RIFFS ${hits}/${notes.length} · MISSES ${misses} · SCORE ${earned} · ` +
      `${Math.max(0, Math.ceil((endAt - now) / 1000))}s`;
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  function verdict(): StageResult {
    return stageVerdict(hits, notes.length, earned, diff, bestCombo, {
      noun: 'RIFFS',
      win: 'FORGE SET',
      fail: 'OUT OF TUNE',
    });
  }
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  if (BPM_METAL >= BPM_POP || BEAT_MS_METAL <= BEAT_MS_POP) failures.push('metal must be slower than pop');
  if (chartDurationMsMetal(60) !== SET_MS_METAL) failures.push('metal duration should cap at 35 s');
  if (chartDurationMsMetal(5) !== 5000 - SETTLE_MS_METAL) failures.push('metal duration clamp broken');

  // 300 seeds: chart + scream determinism, structure, accent rails
  for (let seed = 1; seed <= 300; seed++) {
    const depth = 1 + ((seed * 13) % 36);
    const timerLen = 10 + ((seed * 17) % 51);
    const a = buildChartMetal(seed, depth, timerLen);
    const b = buildChartMetal(seed, depth, timerLen);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failures.push(`metal chart nondeterministic seed=${seed}`);
      break;
    }
    const sa = buildScreams(seed, timerLen);
    const sb = buildScreams(seed, timerLen);
    if (JSON.stringify(sa) !== JSON.stringify(sb)) {
      failures.push(`screams nondeterministic seed=${seed}`);
      break;
    }
    const dur = chartDurationMsMetal(timerLen);
    if (
      a.some((n) => n.lane < 0 || n.lane >= LANES) ||
      a.some((n, i) => i > 0 && n.t < a[i - 1].t) ||
      a[0].t !== LEADIN_MS_METAL ||
      a.some((n) => n.t >= dur || n.t < LEADIN_MS_METAL)
    ) {
      failures.push(`metal chart span broken seed=${seed}`);
      break;
    }
    // every accent sits on a 4th beat; every 4th-beat note present is an accent
    const beatOf = (n: MNote): number => Math.round((n.t - LEADIN_MS_METAL) / BEAT_MS_METAL);
    if (a.some((n) => n.accent !== (beatOf(n) % 4 === 0 && Number.isInteger(beatOf(n))))) {
      failures.push(`accent structure broken seed=${seed}`);
      break;
    }
    // screams only on scheduled bars, texts from the pool, ordered
    if (
      sa.some((s, i) => i > 0 && s.at < sa[i - 1].at) ||
      sa.some((s) => s.at < LEADIN_MS_METAL || s.at >= dur) ||
      sa.some((s) => !SCREAMS.includes(s.txt))
    ) {
      failures.push(`scream schedule broken seed=${seed}`);
      break;
    }

    // window math against THIS seed's chart (±130 inclusive, exclusive beyond)
    for (const at of [-WINDOW_MS_METAL, 0, WINDOW_MS_METAL]) {
      const j: boolean[] = a.map(() => false);
      let bad = false;
      for (let i = 0; i < a.length; i++) {
        const got = pickNote(a, j, a[i].t + at, a[i].lane, WINDOW_MS_METAL);
        if (got < 0 || Math.abs(a[got].t - (a[i].t + at)) > WINDOW_MS_METAL) {
          bad = true;
          break;
        }
        j[got] = true;
      }
      if (bad) {
        failures.push(`metal window math broken seed=${seed} offset=${at}`);
        break;
      }
    }
    if (failures.length > 0) break;
  }
  if (failures.length > 0) return { ok: false, failures };

  // scoring math
  if (metalHitPoints(false, false) !== 11 || metalHitPoints(true, false) !== 16) failures.push('base points wrong');
  if (metalHitPoints(false, true) !== 22 || metalHitPoints(true, true) !== 32) failures.push('accent doubling wrong');
  if (takeoverBandCap(3) !== Math.min(480, Math.round(340 * 1.35))) failures.push('band cap drift');
  {
    const win = stageVerdict(35, 100, 9999, 1, 20, { noun: 'RIFFS', win: 'FORGE SET', fail: 'OUT OF TUNE' });
    if (win.correct !== true || win.points !== 189) failures.push('metal win verdict wrong');
    const lose = stageVerdict(34, 100, 500, 1, 4, { noun: 'RIFFS', win: 'FORGE SET', fail: 'OUT OF TUNE' });
    if (lose.correct !== false || lose.points !== -20 || lose.hpDelta !== -6) failures.push('metal fail verdict wrong');
  }
  // scream pool sanity
  if (SCREAMS.length < 4 || SCREAMS.some((s) => s.length > 20)) failures.push('scream pool wrong');
  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/scenes/takeovers/metal2.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/metal2.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] METAL2 OK' : `[selftest] METAL2 FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
