/**
 * FRACTAL2 — DEEP ZOOM takeover scene (v2 port of modes/fractalsolve.js,
 * mechanic not code).
 *
 * MECHANIC — find the answer inside the infinite zoom:
 *   A Julia-set deep zoom runs as a canvas-texture backdrop (low-res
 *   escape-time buffer upscaled; seeded c-point). ONE glyph island stays
 *   STABLE while the fractal streams past it — the island carries the
 *   question's mark count. Four option tiles below carry distinct counts;
 *   click the one matching the stable island.
 *   HOLD SPACE to STABILIZE: the zoom freezes while held, draining a 1.2 s
 *   pool per use, at most TWO uses. Answering with ZERO stabilizes earns the
 *   +30 DEEP READER bonus (motion-on only — with motion gated off there is
 *   nothing to brave).
 *
 * DEPTH CURVES (pure, self-tested):
 *   distractor spread widens with depth; zoom rate rises slightly.
 *
 * DETERMINISM: c-point, island glyph and option counts drawn once from
 * mulberry32(seed ^ SALT) in FIXED order; zoom phase is a pure function of
 * accumulated ticker delta. No Math.random, no Date.now. StageResult settles
 * exactly once via onceResolve; container emptied on done; self-limits to
 * ctx.timerLen.
 *
 * FAIRNESS RAILS: IQB_MOTION=0 renders ONE static keyframe (stabilize inert,
 * Deep Reader bonus disabled, identical vocabulary otherwise); the island and
 * options NEVER animate or recolor; Esc bails NEUTRAL; text >=11px.
 */
import { Container, Sprite, Texture, Ticker } from 'pixi.js';

import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import { tileCanvas } from '../../glyphs.ts';
import type { Prim } from '../../glyphs.ts';
import { panel, text, spriteFrom } from '../game.ts';
import { mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested)                                            */
/* ------------------------------------------------------------------ */

export const SALT = 0xd00dfe1;
export const BUF_W = 176;
export const BUF_H = 99;
export const ITER = 22;
export const STABILIZE_MS = 1200;
export const MAX_STABILIZES = 2;
export const DEEP_BONUS = 30;

/** Seeded c-point kept clear of the main cardioid so detail survives zoom. */
export function cPointFor(seed: number): { cx: number; cy: number } {
  const rng = mulberry32((seed ^ 0x51ab) >>> 0);
  let cx = rng() * 1.6 - 0.8;
  let cy = rng() * 1.6 - 0.8;
  if (Math.abs(cx) < 0.25 && Math.abs(cy) < 0.25) {
    cx += cx >= 0 ? 0.35 : -0.35;
  }
  return { cx: Math.round(cx * 1000) / 1000, cy: Math.round(cy * 1000) / 1000 };
}

/** Escape-time iteration count at (zx, zy) for the Julia set with constant c. */
export function juliaEscape(zx: number, zy: number, cx: number, cy: number, iter: number): number {
  let x = zx;
  let y = zy;
  for (let i = 0; i < iter; i++) {
    const x2 = x * x;
    const y2 = y * y;
    if (x2 + y2 > 4) return i;
    const xt = x2 - y2 + cx;
    y = 2 * x * y + cy;
    x = xt;
  }
  return iter;
}

export interface ZoomState {
  /** centre of view in the complex plane (fixed, seeded) */
  zx: number;
  zy: number;
  /** half-width of view at t=0; shrinks by rate^t */
  scale0: number;
  rate: number;
}

/** Seeded view: centre in the detail band; deeper rounds shrink faster
 *  (the per-beat divisor shrinks, so `rate` always stays below 1). */
export function makeZoom(rng: () => number, depth: number): ZoomState {
  const perBeat = 0.62 / (1 + Math.min(0.15, Math.max(1, depth) * 0.01));
  return {
    zx: -0.4 + rng() * 0.8,
    zy: -0.5 + rng() * 1.0,
    scale0: 1.4,
    rate: Math.pow(perBeat, 1 / 900),
  };
}

/** View half-width after t ms of zooming. */
export function scaleAt(z: ZoomState, tMs: number): number {
  return z.scale0 * Math.pow(z.rate, tMs);
}
export interface FractalQ {
  count: number; // island mark count = the answer
  options: number[]; // four DISTINCT counts, options[correctIdx] === count
  correctIdx: number;
}

/**
 * Island count 3..7; distractor spread widens with depth. Distractors are
 * taken alternately from the low/high ends in FIXED order, then the four
 * slots are Fisher-Yates-shuffled with rng draws.
 */
export function makeQuestion(rng: () => number, depth: number): FractalQ {
  const n = 3 + Math.floor(rng() * 5);
  const spread = Math.min(3, 1 + Math.floor(Math.max(1, depth) / 4));
  const pool = new Set<number>();
  for (let d = 1; d <= spread; d++) {
    pool.add(n - d);
    pool.add(n + d);
  }
  const opts = [n];
  const rest = [...pool].filter((v) => v >= 1 && v <= 9).sort((a, b) => a - b);
  let lo = 0;
  let hi = rest.length - 1;
  let turnLow = true;
  while (opts.length < 4 && lo <= hi) {
    const v = turnLow ? rest[lo++] : rest[hi--];
    if (!opts.includes(v)) opts.push(v);
    turnLow = !turnLow;
  }
  let pad = 1;
  while (opts.length < 4) {
    const v = n + spread + pad++;
    if (!opts.includes(v) && v <= 12) opts.push(v);
  }
  const ordered = opts.slice(0, 4);
  for (let i = ordered.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  }
  return { count: n, options: ordered, correctIdx: ordered.indexOf(n) };
}

/** Island glyph: a row of n triangles over a base diamond. */
export function islandPrims(n: number): Prim[] {
  const prims: Prim[] = [{ k: 'diamond', x: 50, y: 76, s: 9 }];
  for (let i = 0; i < n; i++) {
    prims.push({ k: 'tri', x: 22 + (56 * i) / Math.max(1, n - 1 || 1), y: 38, s: 11 });
  }
  return prims;
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const OPTION_SIZE = 110;

export function mountFractal2(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const MOTION = typeof localStorage === 'undefined' || localStorage.getItem('IQB_MOTION') !== '0';
  const rng = mulberry32((ctx.seed ^ SALT) >>> 0);
  const settle = onceResolve(ctx.onDone);
  const hue = T.boardHues[(ctx.seed >>> 4) % T.boardHues.length];

  const q = makeQuestion(rng, ctx.depth);
  const zoom = makeZoom(rng, ctx.depth);
  const { cx, cy } = cPointFor(ctx.seed);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  /* ---- fractal canvas texture ---- */
  const cv = document.createElement('canvas');
  cv.width = BUF_W;
  cv.height = BUF_H;
  const c2d = cv.getContext('2d')!;
  const img = c2d.createImageData(BUF_W, BUF_H);
  const tex = Texture.from(cv);
  const fSprite = new Sprite(tex);
  fSprite.width = STAGE_W;
  fSprite.height = STAGE_H;
  fSprite.alpha = 0.92;
  root.addChild(fSprite);

  function renderJulia(tMs: number): void {
    const s = scaleAt(zoom, tMs);
    const data = img.data;
    let di = 0;
    for (let py = 0; py < BUF_H; py++) {
      const zy0 = zoom.zy + ((py / BUF_H) * 2 - 1) * s;
      for (let px = 0; px < BUF_W; px++) {
        const zx0 = zoom.zx + ((px / BUF_W) * 2 - 1) * s;
        const it = juliaEscape(zx0, zy0, cx, cy, ITER);
        // one-hue shading: near-black tile -> muted ramp, never rainbow
        if (it === ITER) {
          data[di] = 4; data[di + 1] = 7; data[di + 2] = 15;
        } else {
          const f = it / ITER;
          data[di] = Math.round(10 + 60 * f);
          data[di + 1] = Math.round(13 + 40 * f);
          data[di + 2] = Math.round(20 + 30 * f);
        }
        data[di + 3] = 255;
        di += 4;
      }
    }
    c2d.putImageData(img, 0, 0);
    tex.source.update();
  }

  /* ---- HUD ---- */
  const title = text(root, 'DEEP ZOOM', 0, 40, 28, hue, true);
  title.anchor.set(0.5, 0);
  title.x = STAGE_W / 2;
  const status = text(root, 'MATCH THE STABLE ISLAND', 0, 86, 16, T.gold, true);
  status.anchor.set(0.5, 0);
  status.x = STAGE_W / 2;
  const stabText = text(root, `STABILIZE ${MAX_STABILIZES}/${MAX_STABILIZES} · HOLD SPACE`, 0, 118, 13, T.muted);
  stabText.anchor.set(0.5, 0);
  stabText.x = STAGE_W / 2;

  /* ---- stable island (never moves, never recolors) ---- */
  const island = spriteFrom(tileCanvas(islandPrims(q.count), hue, 150));
  island.x = STAGE_W / 2 - 75;
  island.y = 190;
  island.alpha = 0.97;
  root.addChild(island);

  /* ---- option panel BEHIND the tiles ---- */
  panel(root, STAGE_W / 2 - 330, STAGE_H - 240, 660, OPTION_SIZE + 40);

  /* ---- options ---- */
  const optRow = new Container();
  root.addChild(optRow);
  let answered = false;

  function answer(idx: number): void {
    if (answered || dead) return;
    answered = true;
    const right = idx === q.correctIdx;
    const deepReader = MOTION && stabsUsed === 0;
    const points = right ? 60 + ctx.depth * 5 + (deepReader ? DEEP_BONUS : 0) : -30;
    settleNow({
      correct: right,
      points,
      hpDelta: right ? 0 : -8,
      summary: right
        ? deepReader ? `DEEP READER · SOLVED RAW · +${points}` : `ISLAND MATCHED · +${points}`
        : 'THE ZOOM KEPT ITS SECRET',
    });
  }

  for (let i = 0; i < q.options.length; i++) {
    const sp = spriteFrom(tileCanvas(islandPrims(q.options[i]), hue, OPTION_SIZE));
    sp.x = STAGE_W / 2 - (q.options.length * (OPTION_SIZE + 18)) / 2 + i * (OPTION_SIZE + 18);
    sp.y = STAGE_H - 220;
    sp.eventMode = 'static';
    sp.cursor = 'pointer';
    const idx = i;
    sp.on('pointerdown', () => answer(idx));
    optRow.addChild(sp);
  }

  /* ---- state ---- */
  let zoomMs = 0;
  let stabPool = STABILIZE_MS;
  let stabsUsed = 0;
  let stabilizing = false;
  let dead = false;
  let frameParity = 0;

  function settleNow(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      settleNow(escaped(0, 'LOST IN THE ZOOM'));
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      if (!e.repeat && stabsUsed < MAX_STABILIZES && stabPool > 0) stabilizing = true;
    }
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === ' ') stabilizing = false;
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);

  renderJulia(0); // static keyframe also serves motion-off mode

  const onTick = (tk: Ticker): void => {
    if (dead) return;
    if (MOTION && !answered) {
      if (stabilizing) {
        const drain = Math.min(tk.deltaMS, stabPool);
        stabPool -= drain;
        if (stabPool <= 0) {
          stabilizing = false;
          stabPool = STABILIZE_MS;
          stabsUsed++;
          stabText.text = `STABILIZED ${stabsUsed}/${MAX_STABILIZES} · HOLD SPACE`;
        } else {
          stabText.text = `STABILIZED ${stabsUsed}/${MAX_STABILIZES} · ${Math.ceil(stabPool)}ms LEFT`;
        }
        // zoom frozen while stabilized — zoomMs does not advance
      } else {
        zoomMs += tk.deltaMS;
      }
      // ~30 fps fractal refresh is plenty for the stream effect
      frameParity ^= 1;
      if (frameParity === 0) renderJulia(zoomMs);
    }
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
    tex.destroy(true);
  }
}

/* ------------------------------------------------------------------ */
/* Self-test (pure)                                                    */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  for (let seed = 1; seed <= 400; seed++) {
    const a = cPointFor(seed);
    const b = cPointFor(seed);
    if (a.cx !== b.cx || a.cy !== b.cy) failures.push(`cPoint nondeterministic seed=${seed}`);
    if (Math.abs(a.cx) > 1 || Math.abs(a.cy) > 1) failures.push(`cPoint out of window seed=${seed}`);
    const qa = makeQuestion(mulberry32((seed ^ SALT) >>> 0), 5);
    const qb = makeQuestion(mulberry32((seed ^ SALT) >>> 0), 5);
    if (JSON.stringify(qa) !== JSON.stringify(qb)) failures.push(`makeQuestion nondeterministic seed=${seed}`);
    if (qa.options.length !== 4 || new Set(qa.options).size !== 4) failures.push(`options not 4 distinct seed=${seed}`);
    if (qa.options[qa.correctIdx] !== qa.count) failures.push(`correctIdx mismatch seed=${seed}`);
  }
  // Julia escape sanity: far points escape instantly, a known interior c persists
  if (juliaEscape(10, 10, -0.7269, 0.1889, 30) !== 0) failures.push('far point must escape at i=0');
  if (juliaEscape(0, 0, -0.7269, 0.1889, 60) !== 60) failures.push('known interior c should never escape');
  const esc = juliaEscape(0.31, -0.24, 0.37, 0.42, ITER);
  if (esc === 0) failures.push('generic point escaped immediately for a benign c');
  // zoom monotonic shrink, deep enough to feel like a real dive
  const z = makeZoom(mulberry32(99), 4);
  if (!(scaleAt(z, 2000) < scaleAt(z, 1000) && scaleAt(z, 1000) < scaleAt(z, 0))) {
    failures.push('zoom does not monotonically shrink scale');
  }
  if (scaleAt(z, 60000) > 0.0005) failures.push('zoom too slow: no deep-zoom feel within 60s');
  // depth widens minimum distractor distance
  const dist = (q: FractalQ): number =>
    Math.min(...q.options.filter((v) => v !== q.count).map((v) => Math.abs(v - q.count)));
  const shallow = makeQuestion(mulberry32(777), 1);
  const deep = makeQuestion(mulberry32(777), 12);
  if (dist(deep) < dist(shallow)) failures.push('deep depth should widen minimum distractor distance');
  // island glyphs encode the answer structurally
  const t3 = islandPrims(3).filter((p) => p.k === 'tri').length;
  const t7 = islandPrims(7).filter((p) => p.k === 'tri').length;
  if (t3 !== 3 || t7 !== 7) failures.push('island tri-count does not encode answer');
  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
