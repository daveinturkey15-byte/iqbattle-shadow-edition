/**
 * HYPERCUBE2 — 606D takeover scene (v2 port of modes/hypercube606.js,
 * mechanic not code).
 *
 * MECHANIC — the joke that fights back:
 *   A real tesseract (16 vertices / 32 edges) rotates about two planes
 *   (XW + YZ) and is projected to 2D in closed form (w-perspective then a
 *   fixed tilt). The QUESTION glyph hangs in the header: "the answer wears N
 *   marks". The four OPTION tiles CLING TO PROJECTED VERTICES and ride the
 *   rotation — click the one wearing N marks.
 *   DRAG steers the rotation (angular velocity from drag, damped).
 *   H GOGGLES: press H to UNFOLD the tesseract into its flat net for 5 s —
 *   options snap to readable static net slots, rotation pauses. Two uses.
 *
 * GEOMETRY (pure, self-tested): vertices are the 16 sign vectors of R^4;
 * edges connect pairs differing in exactly one coordinate (32 edges, every
 * vertex degree 4). Projection is closed-form — no matrices, no state.
 *
 * DETERMINISM: question counts + vertex assignment drawn once from
 * mulberry32(seed ^ SALT) in FIXED order. No Math.random, no Date.now —
 * rotation advances by Pixi shared ticker delta. StageResult settles exactly
 * once via onceResolve; container emptied on done; self-limits to
 * ctx.timerLen.
 *
 * POINTS CURVE vs par(diff) = 100*diff + 40 (parFor imported from floorfall.ts):
 *   single solve = round(par(diff)) — exactly on par · wrong answer = -40
 *
 * FAIRNESS RAILS: IQB_MOTION=0 -> static net layout, no rotation, goggles
 * inert but unnecessary (identical vocabulary); tiles stay clickable at every
 * projected position; wire-frame only behind tiles (nothing occludes an
 * option); Esc bails NEUTRAL; text >=11px.
 */
import { Container, Graphics, Sprite, Texture, Ticker } from 'pixi.js';
import type { Text } from 'pixi.js';

import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import { tileCanvas } from '../../glyphs.ts';
import type { Prim } from '../../glyphs.ts';
import { text, spriteFrom } from '../game.ts';
import { mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';
import { parFor } from './floorfall.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested)                                            */
/* ------------------------------------------------------------------ */

export const SALT = 0x7e55ba11;
export const GOGGLES_MS = 5000;
export const MAX_GOGGLES = 2;

/** The 16 vertices of the 4-cube as ±1 sign vectors. */
export function verts4(): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < 16; i++) {
    out.push([(i & 1 ? 1 : -1), (i & 2 ? 1 : -1), (i & 4 ? 1 : -1), (i & 8 ? 1 : -1)]);
  }
  return out;
}

/** Edge list: pairs differing in exactly one coordinate -> 32 edges. */
export function edges4(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < 16; i++) {
    for (let b = 0; b < 4; b++) {
      const j = i ^ (1 << b);
      if (j > i) out.push([i, j]);
    }
  }
  return out;
}

/** Closed-form rotation in the XW plane by axw, then YZ plane by ayz. */
export function rotate4(v: number[], axw: number, ayz: number): number[] {
  const [x, y, z, w] = v;
  const c1 = Math.cos(axw);
  const s1 = Math.sin(axw);
  const x2 = x * c1 - w * s1;
  const w2 = x * s1 + w * c1;
  const c2 = Math.cos(ayz);
  const s2 = Math.sin(ayz);
  const y2 = y * c2 - z * s2;
  const z2 = y * s2 + z * c2;
  return [x2, y2, z2, w2];
}

const DIST4 = 3.2;
const TILT = 0.38;

/** Project 4D -> 2D closed form: w-perspective, then fixed X tilt. */
export function project4(v: number[]): { x: number; y: number; s: number } {
  const [x, y, z, w] = v;
  const f1 = DIST4 / (DIST4 - w);
  const X = x * f1;
  const Y = y * f1;
  const Z = z * f1;
  const cy = Math.cos(TILT);
  const sy = Math.sin(TILT);
  const ty = Y * cy - Z * sy;
  const tz = Y * sy + Z * cy;
  const f2 = 1 + tz * 0.12;
  return { x: X * f2, y: ty * f2, s: f1 * f2 };
}

/**
 * Flat-net slot positions (logical stage space) for goggle mode / static
 * fallback: the classic unfolded cross of cube cells around a centre.
 */
export function netSlots(): Array<{ x: number; y: number }> {
  const cell = 210;
  const cx = STAGE_W / 2;
  const cy = STAGE_H / 2 - 40;
  return [
    { x: cx - cell * 1.5, y: cy }, // west arm
    { x: cx, y: cy - cell }, // north arm
    { x: cx + cell * 1.5, y: cy }, // east arm
    { x: cx, y: cy + cell }, // south arm
  ];
}

/** Option vertex assignment: four mutually far-apart vertices, seeded order. */
export function pickOptionVerts(rng: () => number): number[] {
  // geometrically spread candidates, shuffled draw order via rng
  const cands = [0, 7, 10, 13, 5, 2, 8, 14];
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cands[i], cands[j]] = [cands[j], cands[i]];
  }
  return cands.slice(0, 4);
}

export interface CubeQ {
  count: number;
  options: number[];
  correctIdx: number;
}

/** Header count 3..7; three distinct distractors within +-2 (clamped 1..9). */
export function makeQuestion(rng: () => number): CubeQ {
  const n = 3 + Math.floor(rng() * 5);
  const deltas = [-2, -1, 1, 2];
  for (let i = deltas.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deltas[i], deltas[j]] = [deltas[j], deltas[i]];
  }
  const options = [n];
  for (const d of deltas) {
    if (options.length >= 4) break;
    const v = n + d;
    if (v >= 1 && v <= 9 && !options.includes(v)) options.push(v);
  }
  let pad = 3;
  while (options.length < 4) {
    const v = n + pad++;
    if (!options.includes(v)) options.push(v);
  }
  return { count: n, options, correctIdx: options.indexOf(n) };
}

/** Shared difficulty ladder: min(5, max(1, 1 + floor(depth/6))). */
export function diffFor(depth: number): number {
  return Math.min(5, Math.max(1, 1 + Math.floor(Math.max(0, depth) / 6)));
}

/** Wrong-answer penalty, matching the puzzle engine's -40. */
export const WRONG_PTS = -40;

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const TILE = 96;

interface OptTile {
  sp: Sprite;
  vert: number;
}

export function mountHypercube2(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const MOTION = typeof localStorage === 'undefined' || localStorage.getItem('IQB_MOTION') !== '0';
  const rng = mulberry32((ctx.seed ^ SALT) >>> 0);
  const settle = onceResolve(ctx.onDone);
  const hue = T.boardHues[(ctx.seed >>> 6) % T.boardHues.length];

  const q = makeQuestion(rng);
  const optVerts = pickOptionVerts(rng);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  const title = text(root, '606D', 0, 40, 28, hue, true);
  title.anchor.set(0.5, 0);
  title.x = STAGE_W / 2;
  const status = text(root, `THE ANSWER WEARS ${q.count} MARKS`, 0, 84, 17, T.gold, true);
  status.anchor.set(0.5, 0);
  status.x = STAGE_W / 2;
  const hint = text(root, MOTION ? 'DRAG STEERS · H GOGGLES UNFOLDS THE NET' : 'MOTION OFF — THE CUBE SITS STILL', 0, 116, 13, T.muted);
  hint.anchor.set(0.5, 0);
  hint.x = STAGE_W / 2;

  /* ---- question glyph (header, never animates/recolors) ---- */
  const qPrims: Prim[] = [
    { k: 'diamond', x: 50, y: 70, s: 10 },
    ...Array.from({ length: q.count }, (_, i): { k: 'dot'; x: number; y: number; r: number } =>
      ({ k: 'dot', x: 26 + (48 * i) / Math.max(1, q.count - 1), y: 34, r: 6 })),
  ];
  const qTile = spriteFrom(tileCanvas(qPrims, hue, 110));
  qTile.x = STAGE_W / 2 + 190;
  qTile.y = 62;
  root.addChild(qTile);

  /* ---- tesseract wire ---- */
  const wire = new Graphics();
  root.addChild(wire);

  /* ---- option tiles cling to vertices ---- */
  const tileLayer = new Container();
  root.addChild(tileLayer);
  const opts: OptTile[] = [];
  let answered = false;
  for (let i = 0; i < 4; i++) {
    const sp = spriteFrom(tileCanvas(cubeCountPrims(q.options[i]), hue, TILE));
    sp.eventMode = 'static';
    sp.cursor = 'pointer';
    const idx = i;
    sp.on('pointerdown', () => answer(idx));
    tileLayer.addChild(sp);
    opts.push({ sp, vert: optVerts[i] });
  }

  /** Count glyph: n dots over a base diamond — structure carries the answer. */
  function cubeCountPrims(n: number): Prim[] {
    return [
      ...Array.from({ length: n }, (_, i): { k: 'tri'; x: number; y: number; s: number } =>
        ({ k: 'tri', x: 24 + (52 * i) / Math.max(1, n - 1), y: 36, s: 11 })),
      { k: 'diamond', x: 50, y: 72, s: 9 },
    ];
  }

  /* ---- rotation state ---- */
  let axw = ((ctx.seed >>> 3) % 628) / 100;
  let ayz = ((ctx.seed >>> 9) % 628) / 100;
  const BASE_W = 0.22; // rad/s ambient spin
  let velW = 0;
  let velY = 0;
  let elapsedMs = 0;
  let dead = false;
  let gogglesLeft = MAX_GOGGLES;
  let gogglesMs = 0;
  let dragging = false;
  let dragLast: { x: number; y: number } | null = null;

  const verts = verts4();
  const edges = edges4();

  function projected(vertIdx: number, axwV: number, ayzV: number): { x: number; y: number } {
    const p = project4(rotate4(verts[vertIdx], axwV, ayzV));
    return { x: STAGE_W / 2 + p.x * 170, y: STAGE_H / 2 - 20 + p.y * 170 };
  }

  function layout(gogglesOn: boolean): void {
    if (gogglesOn || !MOTION) {
      const slots = netSlots();
      for (let i = 0; i < opts.length; i++) {
        opts[i].sp.x = slots[i].x - TILE / 2;
        opts[i].sp.y = slots[i].y - TILE / 2;
      }
      return;
    }
    for (const o of opts) {
      const p = projected(o.vert, axw, ayz);
      o.sp.x = p.x - TILE / 2;
      o.sp.y = p.y - TILE / 2;
    }
  }

  function drawWire(): void {
    wire.clear();
    const pts = verts.map((v) => project4(rotate4(v, axw, ayz)));
    for (const [a, b] of edges) {
      wire.moveTo(STAGE_W / 2 + pts[a].x * 170, STAGE_H / 2 - 20 + pts[a].y * 170)
        .lineTo(STAGE_W / 2 + pts[b].x * 170, STAGE_H / 2 - 20 + pts[b].y * 170)
        .stroke({ color: hue, width: 1.5, alpha: 0.35 });
    }
  }

  function settleNow(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function answer(idx: number): void {
    if (answered || dead) return;
    const right = idx === q.correctIdx;
    settleNow({
      correct: right,
      points: right ? Math.round(parFor(diffFor(ctx.depth))) : WRONG_PTS,
      hpDelta: right ? 0 : -8,
      summary: right ? 'SEEN THROUGH ALL FOUR DIMENSIONS' : 'THE HYPERCUBE KEPT IT FOLDED',
    });
  }

  function toggleGoggles(): void {
    if (!MOTION || gogglesLeft <= 0 || gogglesMs > 0) return;
    gogglesLeft--;
    gogglesMs = GOGGLES_MS;
    status.text = `GOGGLES ON — NET UNFOLDED ${gogglesMs / 1000 | 0}s`;
  }

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      settleNow(escaped(0, 'YOU FOLDED BACK TO 3D'));
      return;
    }
    if (e.key === 'h' || e.key === 'H') toggleGoggles();
  }
  function onDown(e: { globalX: number; globalY: number }): void {
    dragging = true;
    dragLast = { x: e.globalX, y: e.globalY };
  }
  function onMove(e: { globalX: number; globalY: number }): void {
    if (!dragging || !dragLast || !MOTION) return;
    const dx = e.globalX - dragLast.x;
    const dy = e.globalY - dragLast.y;
    dragLast = { x: e.globalX, y: e.globalY };
    velY += dx * 0.00004;
    velW += dy * 0.00004;
  }
  function onUp(): void {
    dragging = false;
    dragLast = null;
  }
  window.addEventListener('keydown', onKey);
  root.eventMode = 'static';
  root.on('pointerdown', onDown);
  root.on('pointermove', onMove);
  root.on('pointerup', onUp);
  root.on('pointerupoutside', onUp);

  const onTick = (tk: Ticker): void => {
    if (dead) return;
    elapsedMs += tk.deltaMS;
    const gogglesOn = gogglesMs > 0;
    if (MOTION && !answered) {
      if (gogglesOn) {
        gogglesMs -= tk.deltaMS;
        if (gogglesMs <= 0) {
          gogglesMs = 0;
          status.text = `THE ANSWER WEARS ${q.count} MARKS`;
          hint.text = 'DRAG STEERS · H GOGGLES UNFOLDS THE NET';
        }
      } else {
        axw += (BASE_W + velW) * tk.deltaMS / 1000;
        ayz += (BASE_W * 0.6 + velY) * tk.deltaMS / 1000;
        velW *= Math.pow(0.02, tk.deltaMS / 1000);
        velY *= Math.pow(0.02, tk.deltaMS / 1000);
        drawWire();
      }
    }
    layout(gogglesOn);
    if (elapsedMs >= ctx.timerLen * 1000) {
      settleNow(escaped(0, 'TIME — STILL ROTATING'));
    }
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.off('pointerdown', onDown);
    root.off('pointermove', onMove);
    root.off('pointerup', onUp);
    root.off('pointerupoutside', onUp);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  if (!MOTION) drawWire();
  layout(false);
}

/* ------------------------------------------------------------------ */
/* Self-test (pure)                                                    */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const vs = verts4();
  const es = edges4();
  if (vs.length !== 16) failures.push('tesseract must have 16 vertices');
  if (es.length !== 32) failures.push(`tesseract must have 32 edges, got ${es.length}`);
  const deg = new Array(16).fill(0);
  for (const [a, b] of es) {
    deg[a]++;
    deg[b]++;
    let diff = 0;
    for (let k = 0; k < 4; k++) if (vs[a][k] !== vs[b][k]) diff++;
    if (diff !== 1) failures.push(`edge ${a}-${b} differs in ${diff} coords`);
  }
  if (deg.some((d) => d !== 4)) failures.push('every tesseract vertex must have degree 4');
  // projection finite & bounded everywhere
  for (let i = 0; i < 16; i++) {
    for (let t = 0; t < 12; t++) {
      const p = project4(rotate4(vs[i], t * 0.53, t * 0.31));
      if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.s)) failures.push(`projection non-finite v=${i} t=${t}`);
      if (Math.abs(p.x) > 4 || Math.abs(p.y) > 4) failures.push(`projection runaway v=${i} t=${t}`);
    }
  }
  // rotation is a proper isometry-ish: rotating twice != identity generally, but norm preserved
  for (let i = 0; i < 16; i++) {
    const r = rotate4(vs[i], 0.7, 1.3);
    const n2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2] + r[3] * r[3];
    if (Math.abs(n2 - 4) > 1e-9) failures.push(`rotate4 does not preserve norm v=${i}`);
  }
  for (let seed = 1; seed <= 400; seed++) {
    const qa = makeQuestion(mulberry32((seed ^ SALT) >>> 0));
    const qb = makeQuestion(mulberry32((seed ^ SALT) >>> 0));
    if (JSON.stringify(qa) !== JSON.stringify(qb)) failures.push(`makeQuestion nondeterministic seed=${seed}`);
    if (qa.options.length !== 4 || new Set(qa.options).size !== 4) failures.push(`options not 4 distinct seed=${seed}`);
    if (qa.options[qa.correctIdx] !== qa.count) failures.push(`correctIdx mismatch seed=${seed}`);
    const va = pickOptionVerts(mulberry32((seed ^ SALT) >>> 5));
    const vb = pickOptionVerts(mulberry32((seed ^ SALT) >>> 5));
    if (JSON.stringify(va) !== JSON.stringify(vb)) failures.push(`pickOptionVerts nondeterministic seed=${seed}`);
    if (new Set(va).size !== 4) failures.push(`option vertices not distinct seed=${seed}`);
  }
  // net slots are separated and inside the stage
  const slots = netSlots();
  if (slots.length !== 4) failures.push('net must offer 4 slots');
  for (const s of slots) {
    if (s.x < 0 || s.x > 1600 || s.y < 0 || s.y > 900) failures.push('net slot outside stage');
  }
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const dx = slots[i].x - slots[j].x;
      const dy = slots[i].y - slots[j].y;
      if (Math.hypot(dx, dy) < 180) failures.push('net slots overlap');
    }
  }
  // payout band: single solve pays exactly ladder par at every depth window
  for (let d = 1; d <= 5; d++) {
    const depth = 6 * d - 5;
    if (diffFor(depth) !== d) failures.push(`diffFor ladder broken at window ${d}`);
    const pts = Math.round(parFor(diffFor(depth)));
    if (pts !== parFor(d)) failures.push(`hypercube solve must pay par(${d}) = ${parFor(d)}, got ${pts}`);
    if (pts <= WRONG_PTS) failures.push('a correct solve must out-pay the wrong-answer penalty');
  }
  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
