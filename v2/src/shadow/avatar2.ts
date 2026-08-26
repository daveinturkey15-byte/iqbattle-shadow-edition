/**
 * avatar2.ts — upgraded SHADOW silhouette renderer for v2.
 *
 * Replaces the flat 3-spike head-and-circle sketch (v1's 96 px SVG persona,
 * re-drawn in shadow.ts::drawAvatar) with a LAYERED procedural silhouette:
 *
 *   layer 0  wispy edge tendrils   — curved strands hanging off the cloak hem,
 *                                    swaying only while motion is on
 *   layer 1  hooded cloak          — sampled bezier outline, near-black fill,
 *                                    crimson rim stroke, dark hood void
 *   layer 2  glowing eyes          — two dot prims (halo + dot + white core),
 *                                    alpha/scale pulse driven by injected time
 *
 * Rails carried over from the persona channel (shadow.ts / large.ts):
 *   - Determinism: all geometry comes from rngFrom(seed) (mulberry32); zero
 *     Math.random. Animation time is INJECTED via tick(dtMs).
 *   - Motion gate: IQB_MOTION=0 / prefers-reduced-motion => zero animation
 *     (eyes hold full alpha, tendrils frozen); explicit opts.motion overrides
 *     for selftests.
 *   - Emphasis: LARGE beats grow the silhouette 1.15x .. 1.7x (mirrors
 *     large.ts EMPHASIS via emphasisFor()); base renders at 1.0.
 *   - Sanctuary pale variant: good rounds lift the palette out of crimson
 *     into the faithful SANCTUARY blue ("the light remembers you").
 *   - Fairness: pure decoration — never gates an answer, never flashes
 *     (pulse floor 0.55 alpha, well under any flash rail).
 *
 * Integration: buildAvatar(size, opts) returns a plain Container-sized node
 * laid out in a [0..size] box (visuals scale around the box centre under
 * emphasis). Callers drive it with avatar.tick(ticker.deltaMS). Existing
 * consumers: swap into shadow.ts's bubble (size 44) and large.ts's banner
 * (base 96 * emphasisScale(kind)) when those files are next owned.
 *
 * Self-test:
 *   node --experimental-strip-types src/shadow/avatar2.ts
 */
import { Container, Graphics } from 'pixi.js';
import { rngFrom } from '../puzzles/types.ts';
import { emphasisScale, type LargeKind } from './large.ts';

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

/** Hostile palette — matches the persona channel's crimson family. */
const CLOAK_FILL = 0x14101a;
const HOOD_VOID = 0x0a0d14;
const RIM = 0xc8102e;
const GLOW = 0xe01030;
const CORE = 0xffffff;
const TENDRIL = 0xc8102e;

/** Sanctuary pale variant — SANCTUARY_TOKENS accent (#2d7cff) family. */
export const PALE_CLOAK_FILL = 0x1c2740;
export const PALE_HOOD_VOID = 0x101828;
export const PALE_RIM = 0x2d7cff;
export const PALE_GLOW = 0x9ecbff;
export const PALE_CORE = 0xf5f8ff;
export const PALE_TENDRIL = 0x4888e8;

interface Palette {
  cloak: number;
  void: number;
  rim: number;
  glow: number;
  core: number;
  tendril: number;
}

const HOSTILE: Palette = { cloak: CLOAK_FILL, void: HOOD_VOID, rim: RIM, glow: GLOW, core: CORE, tendril: TENDRIL };
const PALE: Palette = { cloak: PALE_CLOAK_FILL, void: PALE_HOOD_VOID, rim: PALE_RIM, glow: PALE_GLOW, core: PALE_CORE, tendril: PALE_TENDRIL };

/* ------------------------------------------------------------------ */
/* Pure spec (self-tested — no Pixi objects needed here)               */
/* ------------------------------------------------------------------ */

/** LARGE beat emphasis band (large.ts ladder spans exactly this range). */
export const MIN_EMPHASIS = 1.15;
export const MAX_EMPHASIS = 1.7;

/**
 * Clamp a caller-supplied emphasis into the safe band. Base renders (no beat)
 * pass <= 1 and stay unscaled; LARGE beats land anywhere in 1.15..1.7.
 */
export function clampEmphasis(e: number): number {
  if (!Number.isFinite(e)) return 1;
  return Math.min(MAX_EMPHASIS, Math.max(1, e));
}

/** LARGE-beat emphasis for a kind, mirroring large.ts's EMPHASIS ladder. */
export function emphasisFor(kind: LargeKind): number {
  return Math.min(MAX_EMPHASIS, Math.max(MIN_EMPHASIS, emphasisScale(kind)));
}

/** Eyes pulse spec: alpha + uniform dot scale at a given animation age. */
export interface PulseSpec {
  alpha: number;
  scale: number;
}

export const PULSE_PERIOD_MS = 1600;
export const EYE_ALPHA_FLOOR = 0.55;
export const EYE_SCALE_CEIL = 1.18;

/**
 * Deterministic sinusoid pulse — one full cycle per PULSE_PERIOD_MS, phase 0
 * at age 0 (alpha floor, scale 1). Periodic, bounded, allocation-free.
 */
export function eyePulse(ageMs: number): PulseSpec {
  const t = (((ageMs % PULSE_PERIOD_MS) + PULSE_PERIOD_MS) % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
  const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
  return {
    alpha: EYE_ALPHA_FLOOR + (1 - EYE_ALPHA_FLOOR) * w,
    scale: 1 + (EYE_SCALE_CEIL - 1) * w,
  };
}

/** Shared motion gate (same policy as shadow.ts / large.ts renderers). */
export function motionOn(): boolean {
  const g = globalThis as unknown as { IQB_MOTION?: string; matchMedia?: (q: string) => MediaQueryList };
  if (g.IQB_MOTION === '0') return false;
  try { return !(g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch { return true; }
}

/* ------------------------------------------------------------------ */
/* Geometry (pure math — sampled once, scaled by size)                 */
/* ------------------------------------------------------------------ */

type Pt = [number, number];

function quadSample(p0: Pt, p1: Pt, p2: Pt, n: number, out: Pt[]): void {
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ]);
  }
}

/**
 * Hooded-figure outline in 44-unit design space: hood apex sweeping down both
 * sides into flared shoulders and a gently curved hem. Returned clockwise,
 * first point == last point (closed loop ready for poly()).
 */
function cloakOutline(): Pt[] {
  const pts: Pt[] = [[22, 4]];
  // left hood edge -> left shoulder
  quadSample([22, 4], [11, 8], [10, 19], 6, pts);
  quadSample([10, 19], [9, 32], [3, 41], 6, pts);
  // hem: shallow sag between the shoulders
  quadSample([3, 41], [22, 45.5], [41, 41], 8, pts);
  // right shoulder -> right hood edge -> apex
  quadSample([41, 41], [35, 32], [34, 19], 6, pts);
  quadSample([34, 19], [33, 8], [22, 4], 6, pts);
  return pts;
}

/** One tendril strand: anchor on the hem, droop length, sway amplitude, phase. */
interface TendrilSpec {
  ax: number; ay: number;
  len: number;
  amp: number;
  phase: number;
  speed: number;
  bend: number;
}

const TENDRIL_COUNT = 7;

function tendrilSpecs(rng: () => number): TendrilSpec[] {
  const specs: TendrilSpec[] = [];
  for (let i = 0; i < TENDRIL_COUNT; i++) {
    const ax = 6.5 + (31 * i) / (TENDRIL_COUNT - 1) + (rng() - 0.5) * 1.6;
    specs.push({
      ax,
      ay: 41.5 + rng() * 1.5,
      len: 6 + rng() * 6,
      amp: 1 + rng() * 1.6,
      phase: rng() * Math.PI * 2,
      speed: 0.0011 + rng() * 0.0009,
      bend: (rng() - 0.5) * 5,
    });
  }
  return specs;
}

function tendrilPath(sp: TendrilSpec, ageMs: number, s: number): Pt[] {
  const sway = sp.amp * Math.sin(ageMs * sp.speed + sp.phase);
  const tipX = sp.ax + sp.bend + sway;
  const tipY = sp.ay + sp.len;
  const cX = sp.ax + sp.bend * 0.35 + sway * 0.5;
  const cY = sp.ay + sp.len * 0.55;
  const pts: Pt[] = [];
  quadSample([sp.ax, sp.ay], [cX, cY], [tipX, tipY], 6, pts);
  return pts.map(([x, y]) => [x * s, y * s] as Pt);
}

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */

export interface AvatarOpts {
  /** Sanctuary pale variant (good rounds — the light remembers you). */
  sanctuary?: boolean;
  /** Beat emphasis; clamped by clampEmphasis (LARGE beats: emphasisFor()). */
  emphasis?: number;
  /** Override the shared motion gate (selftests). */
  motion?: boolean;
  /** Determinism seed for the tendril layout (default fixed). */
  seed?: number;
}

export interface AvatarLayout {
  eyeL: { x: number; y: number; r: number };
  eyeR: { x: number; y: number; r: number };
}

/** buildAvatar() result: a Container plus its driving knobs (read-only). */
export interface Avatar extends Container {
  readonly size: number;
  readonly sanctuary: boolean;
  readonly motion: boolean;
  readonly emphasis: number;
  readonly palette: Readonly<Palette>;
  readonly layout: AvatarLayout;
  /** Animated repaints performed (0 while motion-gated off). */
  readonly animFrames: number;
  /** Advance the pulse/tendril animation by dtMs (ticker or selftests). */
  tick(dtMs: number): void;
}

/** Design-space eye anchors (44-unit space) — mirrored by layout at size. */
const EYE_L: Pt = [17.5, 20.5];
const EYE_R: Pt = [26.5, 20.5];
const EYE_R_DOT = 2.2;

const DEFAULT_SEED = 0x51badea;

export function buildAvatar(size: number, opts: AvatarOpts = {}): Avatar {
  const s = size / 44;
  const sanctuary = opts.sanctuary === true;
  const pal = sanctuary ? PALE : HOSTILE;
  const motion = opts.motion ?? motionOn();
  const em = clampEmphasis(opts.emphasis ?? 1);
  const specs = tendrilSpecs(rngFrom((opts.seed ?? DEFAULT_SEED) >>> 0));

  const root = new Container() as Avatar;
  const content = new Container();
  // scale around the box centre so emphasized LARGE avatars stay centred
  content.pivot.set(size / 2, size / 2);
  content.position.set(size / 2, size / 2);
  content.scale.set(em);
  root.addChild(content);

  /* layer 0 — wispy edge tendrils (behind the cloak) */
  const tendrils = new Graphics();

  /* layer 1 — hooded cloak: outline fill + rim + hood void */
  const cloak = new Graphics();
  const outline = cloakOutline().map(([x, y]) => [x * s, y * s]);
  cloak.poly(outline.flat()).fill({ color: pal.cloak }).stroke({ width: 1.4 * s, color: pal.rim, alpha: 0.9 });
  cloak.ellipse(22 * s, 21 * s, 8 * s, 9.5 * s).fill({ color: pal.void });

  /* layer 2 — glowing eyes: halo + dot + core, two dot prims */
  const eyes = new Container();
  const eyeNodes: Graphics[] = [];
  for (const [ex, ey] of [EYE_L, EYE_R]) {
    const g = new Graphics();
    g.circle(ex * s, ey * s, 3.6 * s).fill({ color: pal.glow, alpha: 0.32 });
    g.circle(ex * s, ey * s, EYE_R_DOT * s).fill({ color: pal.glow });
    g.circle(ex * s, ey * s, 0.95 * s).fill({ color: pal.core });
    // pulse scales each dot around its own anchor
    g.pivot.set(ex * s, ey * s);
    g.position.set(ex * s, ey * s);
    eyes.addChild(g);
    eyeNodes.push(g);
  }

  content.addChild(tendrils, cloak, eyes);

  let age = 0;
  let frames = 0;
  const layout: AvatarLayout = {
    eyeL: { x: EYE_L[0] * s, y: EYE_L[1] * s, r: EYE_R_DOT * s },
    eyeR: { x: EYE_R[0] * s, y: EYE_R[1] * s, r: EYE_R_DOT * s },
  };

  function drawTendrils(nowMs: number): void {
    tendrils.clear();
    for (const sp of specs) {
      // wide soft under-stroke then thin bright core = cheap taper
      const path = tendrilPath(sp, nowMs, s);
      tendrils.poly(path.flat()).stroke({ width: 1.6 * s, color: pal.tendril, alpha: 0.28, cap: 'round' });
      tendrils.poly(path.flat()).stroke({ width: 0.7 * s, color: pal.tendril, alpha: 0.75, cap: 'round' });
    }
  }

  drawTendrils(0); // static frame: tendrils exist even when motion is gated off
  root.tick = (dtMs: number): void => {
    if (!motion) return; // reduced motion: hard-cut rails, zero animation
    age += dtMs;
    frames += 1;
    const p = eyePulse(age);
    for (let i = 0; i < eyeNodes.length; i++) {
      eyeNodes[i].alpha = p.alpha;
      eyeNodes[i].scale.set(p.scale); // pivot already at the eye anchor
    }
    drawTendrils(age);
  };

  Object.defineProperty(root, 'size', { value: size });
  Object.defineProperty(root, 'sanctuary', { value: sanctuary });
  Object.defineProperty(root, 'motion', { value: motion });
  Object.defineProperty(root, 'emphasis', { value: em });
  Object.defineProperty(root, 'palette', { value: pal });
  Object.defineProperty(root, 'layout', { value: layout });
  Object.defineProperty(root, 'animFrames', { get: () => frames });

  return root;
}

/* ------------------------------------------------------------------ */
/* Self-test (headless-safe: Pixi Graphics/Container construct fine     */
/* without a DOM; nothing is rendered to the GPU)                       */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

  /* emphasis band: LARGE beats land inside 1.15..1.7, base stays at 1.0 */
  {
    if (clampEmphasis(0.5) !== 1 || clampEmphasis(-3) !== 1) failures.push('clampEmphasis must floor at 1');
    if (clampEmphasis(2) !== MAX_EMPHASIS || clampEmphasis(MAX_EMPHASIS) !== MAX_EMPHASIS) {
      failures.push('clampEmphasis must cap at 1.7');
    }
    if (!Number.isFinite(clampEmphasis(NaN)) || clampEmphasis(NaN) !== 1) failures.push('clampEmphasis(NaN) must be 1');
    const kinds: LargeKind[] = ['layer', 'sanctuary', 'impossible', 'death'];
    const ems = kinds.map(emphasisFor);
    for (let i = 0; i < ems.length; i++) {
      const e = ems[i];
      if (e < MIN_EMPHASIS - 1e-9 || e > MAX_EMPHASIS + 1e-9) failures.push(`emphasisFor(${kinds[i]})=${e} outside ${MIN_EMPHASIS}..${MAX_EMPHASIS}`);
      if (i > 0 && !(e > ems[i - 1])) failures.push(`emphasis ladder not increasing at ${kinds[i]}`);
      if (!near(e, emphasisScale(kinds[i]))) failures.push(`emphasisFor must mirror large.ts at ${kinds[i]}`);
    }
  }

  /* sizes render: layered structure exists and geometry scales with size */
  {
    for (const size of [24, 44, 96, 140]) {
      const av = buildAvatar(size, { motion: false });
      // content + tendrils + cloak + eyes
      if (av.children.length !== 1) failures.push(`size ${size}: expected single content layer`);
      const content = av.children[0];
      if (content.children.length !== 3) failures.push(`size ${size}: expected tendrils/cloak/eyes layers`);
      if (near(av.layout.eyeL.x, (17.5 / 44) * size) === false) failures.push(`size ${size}: eye anchor not proportional`);
      if (!near(av.layout.eyeR.x - av.layout.eyeL.x, (9 / 44) * size)) failures.push(`size ${size}: eye gap not proportional`);
      if (!near(av.layout.eyeL.r, (2.2 / 44) * size)) failures.push(`size ${size}: eye radius not proportional`);
      if (av.emphasis !== 1) failures.push(`size ${size}: default emphasis must be 1`);
      av.destroy({ children: true });
    }
    // determinism: same seed -> identical tendril layout is implied by rngFrom,
    // but the built node graph shape must match too
    const a = buildAvatar(96, { motion: false, seed: 7 });
    const b = buildAvatar(96, { motion: false, seed: 7 });
    if (JSON.stringify(a.layout) !== JSON.stringify(b.layout)) failures.push('layout nondeterministic for same seed');
    a.destroy({ children: true });
    b.destroy({ children: true });
  }

  /* emphasis applied around the box centre */
  {
    const av = buildAvatar(96, { motion: false, emphasis: 5 });
    if (!near(av.emphasis, MAX_EMPHASIS)) failures.push('emphasis 5 must clamp to 1.7');
    const content = av.children[0];
    if (!near(content.scale.x, MAX_EMPHASIS) || !near(content.scale.y, MAX_EMPHASIS)) {
      failures.push('emphasis must scale the content layers');
    }
    if (!near(content.pivot.x, 48) || !near(content.pivot.y, 48)) failures.push('emphasis pivot must be the box centre');
    av.destroy({ children: true });
  }

  /* eyes pulse spec: periodic, bounded, deterministic */
  {
    for (const t of [0, 137, 999]) {
      if (JSON.stringify(eyePulse(t)) !== JSON.stringify(eyePulse(t + PULSE_PERIOD_MS))) {
        failures.push(`eyePulse not periodic at t=${t}`);
      }
    }
    let minA = 2; let maxA = -1; let minS = 9; let maxS = 0;
    for (let t = 0; t < PULSE_PERIOD_MS; t += 10) {
      const p = eyePulse(t);
      minA = Math.min(minA, p.alpha); maxA = Math.max(maxA, p.alpha);
      minS = Math.min(minS, p.scale); maxS = Math.max(maxS, p.scale);
    }
    if (!(minA >= EYE_ALPHA_FLOOR && maxA <= 1)) failures.push('pulse alpha out of band');
    if (!(minS >= 1 && maxS <= EYE_SCALE_CEIL)) failures.push('pulse scale out of band');
    if (!near(eyePulse(0).alpha, EYE_ALPHA_FLOOR) || !near(eyePulse(0).scale, 1)) {
      failures.push('pulse phase 0 must sit at floor alpha / scale 1');
    }
  }

  /* motion gate: reduced motion freezes everything; motion on animates */
  {
    const still = buildAvatar(44, { motion: false });
    still.tick(16); still.tick(PULSE_PERIOD_MS);
    if (still.animFrames !== 0) failures.push('motion-off avatar must never animate');
    const eyeG = ((still.children[0].children[2] as Container).children[0]);
    if (eyeG.alpha !== 1 || !near(eyeG.scale.x, 1)) failures.push('motion-off eyes must hold full alpha/scale');
    still.destroy({ children: true });

    const live = buildAvatar(44, { motion: true });
    live.tick(400); // quarter period: pulse rising
    const q = eyePulse(400);
    const eyeL1 = ((live.children[0].children[2] as Container).children[0]);
    if (!near(eyeL1.alpha, q.alpha)) failures.push('animated eyes must track eyePulse(age)');
    if (!near(eyeL1.scale.x, q.scale)) failures.push('animated eye scale must track eyePulse(age)');
    if (live.animFrames !== 1) failures.push('each tick with motion on counts one animated frame');
    live.tick(2000);
    const eyeL2 = ((live.children[0].children[2] as Container).children[0]);
    if (!near(eyeL2.alpha, eyePulse(2400).alpha)) failures.push('pulse must keep advancing with age');
    live.destroy({ children: true });
  }

  /* sanctuary pale variant: palette lifts out of crimson, geometry unchanged */
  {
    const dark = buildAvatar(64, { motion: false });
    const pale = buildAvatar(64, { motion: false, sanctuary: true });
    if (!pale.sanctuary || dark.sanctuary) failures.push('sanctuary flag not resolved');
    if (pale.palette.rim === dark.palette.rim) failures.push('sanctuary rim must differ from hostile crimson');
    if (pale.palette.glow === dark.palette.glow) failures.push('sanctuary eye glow must be pale');
    if (pale.palette.cloak === dark.palette.cloak) failures.push('sanctuary cloak must lift toward pale slate');
    if (JSON.stringify(pale.layout) !== JSON.stringify(dark.layout)) {
      failures.push('sanctuary variant must not move the geometry');
    }
    dark.destroy({ children: true });
    pale.destroy({ children: true });
  }

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/shadow/avatar2.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/avatar2.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] AVATAR2 OK' : `[selftest] AVATAR2 FAIL\n  ${r.failures.join('\n  ')}`);
}
