/* ============================================================================
 * CAMEOS — seeded parody silhouettes that appear inside puzzle rounds.
 *
 * Pure and headless: no pixi.js, no DOM, no timers, no Math.random, no
 * Date.now. Time arrives only as an argument (cameoBobOffset). main.ts turns
 * the returned placements into Pixi nodes and tears them down with the scene.
 *
 * A cameo is a SHAPE + a NAME + an ALIGNMENT it fits. Shapes are built from
 * DNA primitive marks ONLY (triangles, dots, diamonds, thin line segments) —
 * parody silhouettes, no scraped art, no licensed likenesses.
 *
 * Rails (asserted in the gate, do not weaken):
 *   - budgeted: at most CAMEO_BUDGET per round
 *   - NEVER overlaps the board's answer area (the "never obscure the answer"
 *     rail, same as P1)
 *   - deterministic: a pure function of (seed, depth)
 *   - torn down with the scene (main.ts destroys the nodes on scene stop)
 *
 * Determinism: seeded mulberry32 (same implementation as chaos.ts /
 * rounds/modifiers.ts). Zero Math.random / Date.now.
 * ==========================================================================*/

import { BOARD_PANEL, SIDEBAR } from '../scenes/layouthelper.ts';
import { STAGE_H, STAGE_W } from '../theme.ts';

export type Alignment = 'good' | 'bad' | 'neutral';

export type MarkKind = 'triangle' | 'dot' | 'diamond' | 'line';

/** A single DNA primitive mark in unit space (0..1, origin top-left of the
 *  cameo box). For `line` marks, (x,y) is the start and (x2,y2) the end; for
 *  the others (x,y) is the centre and `size` the radius (in unit space). */
export interface Mark {
  kind: MarkKind;
  x: number;
  y: number;
  /** dot/diamond/triangle: radius in unit space. line: 0 (use x2,y2). */
  size: number;
  /** Rotation in radians (triangle/diamond). line: 0 (direction from (x,y) to (x2,y2)). */
  rot: number;
  /** Line end point in unit space (only for kind === 'line'). */
  x2?: number;
  y2?: number;
}

export interface Silhouette {
  id: string;
  name: string;
  alignment: Alignment;
  /** Primitive marks in unit space. */
  marks: Mark[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CameoPlacement {
  id: string;
  name: string;
  alignment: Alignment;
  /** Stage-px top-left of the square cameo box. */
  x: number;
  y: number;
  /** Stage-px box size (square). */
  size: number;
  /** 0..1 phase offset for the bob. */
  bobPhase: number;
  /** Bob amplitude in stage px (applied only when motion is on). */
  bobAmp: number;
}

export const STAGE: Rect = { x: 0, y: 0, w: STAGE_W, h: STAGE_H };

/** Hard per-round budget. pickCameos clamps its `max` argument to this. */
export const CAMEO_BUDGET = 4;

const MIN_SIZE = 40;
const MAX_SIZE = 72;
const PLACE_ATTEMPTS = 12;

/* ----------------------------------------------------------------------------
 * The 10 named silhouettes (PLAN-RESTORE-THE-VISION §2.4). Parody only, built
 * from DNA primitive marks. Unit space: (0,0) top-left, (1,1) bottom-right.
 * --------------------------------------------------------------------------*/

export const ROSTER: Silhouette[] = [
  {
    id: 'terminator',
    name: 'Terminator',
    alignment: 'bad',
    marks: [
      { kind: 'diamond', x: 0.5, y: 0.2, size: 0.16, rot: 0 },
      { kind: 'dot', x: 0.56, y: 0.2, size: 0.03, rot: 0 }, // the red eye
      { kind: 'line', x: 0.5, y: 0.34, size: 0, rot: 0, x2: 0.5, y2: 0.62 },
      { kind: 'line', x: 0.5, y: 0.62, size: 0, rot: 0, x2: 0.36, y2: 0.9 },
      { kind: 'line', x: 0.5, y: 0.62, size: 0, rot: 0, x2: 0.64, y2: 0.9 },
      { kind: 'line', x: 0.5, y: 0.46, size: 0, rot: 0, x2: 0.82, y2: 0.46 }, // arm / gun
    ],
  },
  {
    id: 'jester',
    name: 'Jester',
    alignment: 'neutral',
    marks: [
      { kind: 'triangle', x: 0.3, y: 0.16, size: 0.12, rot: -0.5 },
      { kind: 'triangle', x: 0.7, y: 0.16, size: 0.12, rot: 0.5 },
      { kind: 'triangle', x: 0.5, y: 0.1, size: 0.12, rot: 0 },
      { kind: 'dot', x: 0.5, y: 0.38, size: 0.14, rot: 0 },
      { kind: 'line', x: 0.5, y: 0.5, size: 0, rot: 0, x2: 0.5, y2: 0.82 },
      { kind: 'dot', x: 0.3, y: 0.08, size: 0.03, rot: 0 }, // bells
      { kind: 'dot', x: 0.7, y: 0.08, size: 0.03, rot: 0 },
    ],
  },
  {
    id: 'wizard',
    name: 'Wizard',
    alignment: 'neutral',
    marks: [
      { kind: 'triangle', x: 0.5, y: 0.16, size: 0.16, rot: 0 }, // pointy hat
      { kind: 'dot', x: 0.5, y: 0.42, size: 0.12, rot: 0 },
      { kind: 'triangle', x: 0.5, y: 0.68, size: 0.2, rot: Math.PI }, // robe (points down)
      { kind: 'line', x: 0.82, y: 0.3, size: 0, rot: 0, x2: 0.82, y2: 0.9 }, // staff
      { kind: 'dot', x: 0.82, y: 0.24, size: 0.05, rot: 0 }, // staff orb
    ],
  },
  {
    id: 'undead',
    name: 'Undead',
    alignment: 'bad',
    marks: [
      { kind: 'diamond', x: 0.5, y: 0.2, size: 0.15, rot: 0 }, // skull
      { kind: 'line', x: 0.5, y: 0.34, size: 0, rot: 0, x2: 0.5, y2: 0.62 }, // spine
      { kind: 'line', x: 0.4, y: 0.42, size: 0, rot: 0, x2: 0.6, y2: 0.42 }, // ribs
      { kind: 'line', x: 0.4, y: 0.5, size: 0, rot: 0, x2: 0.6, y2: 0.5 },
      { kind: 'line', x: 0.4, y: 0.58, size: 0, rot: 0, x2: 0.6, y2: 0.58 },
      { kind: 'line', x: 0.5, y: 0.62, size: 0, rot: 0, x2: 0.4, y2: 0.9 },
      { kind: 'line', x: 0.5, y: 0.62, size: 0, rot: 0, x2: 0.6, y2: 0.9 },
    ],
  },
  {
    id: 'dolphin',
    name: 'Dolphin',
    alignment: 'good',
    marks: [
      { kind: 'line', x: 0.15, y: 0.58, size: 0, rot: 0, x2: 0.72, y2: 0.46 }, // body
      { kind: 'triangle', x: 0.42, y: 0.36, size: 0.1, rot: 0 }, // dorsal fin
      { kind: 'triangle', x: 0.8, y: 0.5, size: 0.1, rot: 0.6 }, // tail
      { kind: 'dot', x: 0.24, y: 0.52, size: 0.03, rot: 0 }, // eye
    ],
  },
  {
    id: 'shark',
    name: 'Shark',
    alignment: 'bad',
    marks: [
      { kind: 'line', x: 0.15, y: 0.5, size: 0, rot: 0, x2: 0.78, y2: 0.5 }, // body
      { kind: 'triangle', x: 0.48, y: 0.3, size: 0.12, rot: 0 }, // dorsal fin
      { kind: 'triangle', x: 0.84, y: 0.5, size: 0.1, rot: 0.6 }, // tail
      { kind: 'dot', x: 0.24, y: 0.45, size: 0.03, rot: 0 }, // eye
      { kind: 'line', x: 0.15, y: 0.56, size: 0, rot: 0, x2: 0.36, y2: 0.56 }, // jaw
    ],
  },
  {
    id: 'angel',
    name: 'Angel',
    alignment: 'good',
    marks: [
      { kind: 'line', x: 0.36, y: 0.1, size: 0, rot: 0, x2: 0.64, y2: 0.1 }, // halo
      { kind: 'dot', x: 0.5, y: 0.26, size: 0.12, rot: 0 },
      { kind: 'line', x: 0.5, y: 0.38, size: 0, rot: 0, x2: 0.5, y2: 0.72 },
      { kind: 'triangle', x: 0.24, y: 0.42, size: 0.14, rot: -0.4 }, // wings
      { kind: 'triangle', x: 0.76, y: 0.42, size: 0.14, rot: 0.4 },
    ],
  },
  {
    id: 'genie',
    name: 'Genie',
    alignment: 'neutral',
    marks: [
      { kind: 'dot', x: 0.5, y: 0.3, size: 0.12, rot: 0 },
      { kind: 'line', x: 0.5, y: 0.42, size: 0, rot: 0, x2: 0.5, y2: 0.72 },
      { kind: 'line', x: 0.5, y: 0.5, size: 0, rot: 0, x2: 0.3, y2: 0.62 }, // arms
      { kind: 'line', x: 0.5, y: 0.5, size: 0, rot: 0, x2: 0.7, y2: 0.62 },
      { kind: 'triangle', x: 0.5, y: 0.84, size: 0.16, rot: Math.PI }, // lamp
    ],
  },
  {
    id: 'cyclist',
    name: 'Cyclist',
    alignment: 'neutral',
    marks: [
      { kind: 'dot', x: 0.3, y: 0.72, size: 0.14, rot: 0 }, // rear wheel
      { kind: 'dot', x: 0.7, y: 0.72, size: 0.14, rot: 0 }, // front wheel
      { kind: 'line', x: 0.3, y: 0.72, size: 0, rot: 0, x2: 0.5, y2: 0.52 }, // frame
      { kind: 'line', x: 0.5, y: 0.52, size: 0, rot: 0, x2: 0.7, y2: 0.72 },
      { kind: 'line', x: 0.5, y: 0.52, size: 0, rot: 0, x2: 0.5, y2: 0.3 }, // body
      { kind: 'dot', x: 0.5, y: 0.22, size: 0.08, rot: 0 }, // head
    ],
  },
  {
    id: 'blobby',
    name: 'Mr Blobby',
    alignment: 'neutral',
    marks: [
      { kind: 'dot', x: 0.5, y: 0.56, size: 0.3, rot: 0 }, // the blob
      { kind: 'dot', x: 0.4, y: 0.46, size: 0.04, rot: 0 }, // eyes
      { kind: 'dot', x: 0.6, y: 0.46, size: 0.04, rot: 0 },
      { kind: 'line', x: 0.4, y: 0.66, size: 0, rot: 0, x2: 0.6, y2: 0.66 }, // mouth
    ],
  },
];

/* ----------------------------------------------------------------------------
 * Geometry helpers
 * --------------------------------------------------------------------------*/

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Safe zones = the stage minus the board panel, the sidebar, and the status
 *  strip (top). Derived from layouthelper so it stays in sync with the scene.
 *  Every slot is guaranteed to sit clear of the board's answer area. */
function safeSlots(): Rect[] {
  const top = Math.max(BOARD_PANEL.y, SIDEBAR.y);
  const bottom = Math.max(
    BOARD_PANEL.y + BOARD_PANEL.h,
    SIDEBAR.y + SIDEBAR.h,
  );
  return [
    // Bottom band, below both panels.
    { x: 0, y: bottom, w: STAGE_W, h: STAGE_H - bottom },
    // Left margin.
    { x: 0, y: top, w: BOARD_PANEL.x, h: bottom - top },
    // Gap between the board panel and the sidebar.
    {
      x: BOARD_PANEL.x + BOARD_PANEL.w,
      y: top,
      w: SIDEBAR.x - (BOARD_PANEL.x + BOARD_PANEL.w),
      h: bottom - top,
    },
    // Right margin.
    {
      x: SIDEBAR.x + SIDEBAR.w,
      y: top,
      w: STAGE_W - (SIDEBAR.x + SIDEBAR.w),
      h: bottom - top,
    },
  ];
}

/* ----------------------------------------------------------------------------
 * Determinism
 * --------------------------------------------------------------------------*/

/** Pure mulberry32 32-bit PRNG generator (same as chaos.ts / modifiers.ts). */
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fold (seed, depth) into a single 32-bit PRNG seed. Pure + deterministic. */
export function mixSeed(seed: number, depth: number): number {
  let a = (seed ^ 0x9e3779b1) | 0;
  a = Math.imul(a ^ (a >>> 15), 0x85ebca6b);
  a = (a ^ (depth | 0)) | 0;
  a = Math.imul(a ^ (a >>> 15), 0xc2b2ae35);
  return (a ^ (a >>> 16)) | 0;
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/* ----------------------------------------------------------------------------
 * Placement
 * --------------------------------------------------------------------------*/

function placeOne(
  sil: Silhouette,
  rand: () => number,
  answerArea: Rect,
  existing: CameoPlacement[],
): CameoPlacement | null {
  const slots = safeSlots();
  for (let attempt = 0; attempt < PLACE_ATTEMPTS; attempt++) {
    const size = MIN_SIZE + Math.floor(rand() * (MAX_SIZE - MIN_SIZE + 1));
    const fitting = slots.filter((s) => s.w >= size && s.h >= size);
    if (fitting.length === 0) continue;
    const slot = fitting[Math.floor(rand() * fitting.length)];
    const x = slot.x + rand() * (slot.w - size);
    const y = slot.y + rand() * (slot.h - size);
    const box: Rect = { x, y, w: size, h: size };
    // The rail: never overlap the board's answer area.
    if (rectsIntersect(box, answerArea)) continue;
    // Keep cameos from stacking on each other (cosmetic, not a rail).
    const overlapsExisting = existing.some((e) =>
      rectsIntersect(box, { x: e.x, y: e.y, w: e.size, h: e.size }),
    );
    if (overlapsExisting) continue;
    return {
      id: sil.id,
      name: sil.name,
      alignment: sil.alignment,
      x,
      y,
      size,
      bobPhase: rand(),
      bobAmp: 2 + rand() * 4,
    };
  }
  return null;
}

/** Pick this round's cameos. Pure function of (seed, depth, max, answerArea).
 *  Returns at most `max` (clamped to CAMEO_BUDGET) placements, none of which
 *  intersect `answerArea`. */
export function pickCameos(
  seed: number,
  depth: number,
  answerArea: Rect,
  max: number = CAMEO_BUDGET,
): CameoPlacement[] {
  const n = Math.max(
    0,
    Math.min(CAMEO_BUDGET, ROSTER.length, Math.floor(Number.isFinite(max) ? max : 0)),
  );
  if (n === 0) return [];
  const rand = mulberry32(mixSeed(seed, depth));
  const chosen = shuffle(ROSTER, rand).slice(0, n);
  const out: CameoPlacement[] = [];
  for (const sil of chosen) {
    const p = placeOne(sil, rand, answerArea, out);
    if (p) out.push(p);
  }
  return out;
}

/** Motion-gated bob offset in stage px. Always 0 under motion=false. */
export function cameoBobOffset(
  p: CameoPlacement,
  timeMs: number,
  motion: boolean,
): number {
  if (!motion) return 0;
  const t = (timeMs / 1000) * 0.5 + p.bobPhase; // ~0.5 Hz
  return p.bobAmp * Math.sin(2 * Math.PI * t);
}
