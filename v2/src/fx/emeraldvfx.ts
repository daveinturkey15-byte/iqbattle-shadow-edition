/* ============================================================================
 * fx/emeraldvfx.ts — EMERALD PICKUP JUICE (v2 polish batch C)
 * ----------------------------------------------------------------------------
 * Four effects for the every-4th-depth Chaos-Emerald pick scene
 * (scenes/interlude.ts buildInterlude), one call per event:
 *
 *   playCardFlash     — emerald wash flashing over a hovered/picked card
 *                       (<= 160 ms, hard rail <= 200 ms)
 *   startIconSparkle  — relic icon sparkle LOOP while hovering; caller stops
 *                       it on pointerout / pick (per-sparkle <= 420 ms)
 *   playConfetti      — deterministic confetti burst on pick (exactly 600 ms)
 *   playChipFly       — gold score chip arcing from the card to the score
 *                       readout (<= 560 ms)
 *
 * RAILS (DNA.md / reveal.ts conventions):
 *   - Every autonomous effect <= 600 ms; flashes <= 200 ms. The ONLY looping
 *     effect is the hover sparkle, which lives exactly as long as the hover.
 *   - Motion-gated behind IQB_MOTION / prefers-reduced-motion (shared gate:
 *     revealMotionEnabled()): static variants show the same information —
 *     held wash, pinned sparkles, settled confetti ring, chip parked on the
 *     destination — with identical cleanup and ZERO per-frame mutation.
 *   - Never touches puzzle glyphs or scene text; everything lives in an own
 *     overlay container removed on finish (auto-cleanup guaranteed).
 *   - Sfx stay hooks owned by audio/ (director.onEmerald already fires).
 *
 * DETERMINISM: zero Math.random / Date.now. Scatter derives from an own
 * mulberry32 seeded from opts.seed ^ event-salt, consumed in FIXED DRAW
 * ORDER per particle (angle -> distance -> size -> colour -> spin -> phase).
 *
 * TESTABILITY: the effect core is layer-agnostic over the tiny EvLayer
 * interface. The Pixi adapter is a thin shell; selfTest() drives a memory
 * stub with a manual clock — no renderer needed.
 *
 * Selftest:  cd v2 && node --experimental-strip-types src/fx/emeraldvfx.ts
 * ==========================================================================*/
import { Container, Graphics, Sprite, Texture, Ticker } from 'pixi.js';
import { mulberry32 } from '../scenes/takeovers/redlight.ts';
import { revealMotionEnabled } from './reveal.ts';

/* ------------------------------------------------------------------ */
/* public surface                                                      */
/* ------------------------------------------------------------------ */

export interface EmeraldVfxOpts {
  /** Deterministic scatter seed (default 0 — pass the run/offer seed). */
  seed?: number;
  /** Override the motion gate (selftests). */
  motion?: boolean;
}

/** One-shot effect handle: poll `done`, or force-cleanup early with destroy(). */
export interface EmeraldVfxHandle {
  readonly done: boolean;
  destroy(): void;
}

/** Hover-loop handle. Call stop() on pointerout / pick — never leaks past it. */
export interface SparkleHandle {
  stop(): void;
  readonly alive: boolean;
  /** Sparkles spawned so far (leak probe for callers/selftests). */
  readonly spawned: number;
}

/* ------------------------------------------------------------------ */
/* layer abstraction                                                   */
/* ------------------------------------------------------------------ */

export interface EvNode {
  move(x: number, y: number): void;
  alpha(a: number): void;
  rotate(rad: number): void;
  stretch(sx: number, sy: number): void;
  /** Idempotent: detaches + frees the node exactly once. */
  remove(): void;
}

export interface EvLayer {
  /** Full-card tinted rect at (x,y,w,h). */
  panel(x: number, y: number, w: number, h: number, color: number): EvNode;
  /** Four-point sparkle diamond centred on (x,y), tip-to-tip `size` px. */
  star(x: number, y: number, size: number, color: number): EvNode;
  /** Confetti fleck rect centred on (x,y). */
  fleck(x: number, y: number, w: number, h: number, color: number): EvNode;
  /** Score chip disc of diameter `d` centred on (x,y). */
  chip(x: number, y: number, d: number, color: number, rim: number): EvNode;
  /** Called exactly once when the effect finishes — detaches the layer. */
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* timing constants                                                    */
/* ------------------------------------------------------------------ */

const FLASH_MS = 160;            // card select flash — hard rail <= 200 ms
const CONFETTI_MS = 600;         // burst lifetime — hard rail <= 600 ms
const CHIP_MS = 560;             // fly-to-score — hard rail <= 600 ms
const SPARKLE_MS = 420;          // per-sparkle life (loop is hover-scoped)
const SPARKLE_INTERVAL_MS = 110; // loop spawn cadence
const STATIC_SPARKLES = 4;       // pinned marks in the reduced-motion variant

const CONFETTI_N = 22;
const CONFETTI_GRAV = 0.0011;    // px/ms^2
const CHIP_ARC_PX = 64;

// Palette mirrors theme tokens (numeric forms): T.good / mint lift /
// T.gold / T.ink — emerald family plus the house gold accent.
const CONFETTI_COLORS = [0x00e68a, 0x7ef0c0, 0xd4a017, 0xf5f8ff] as const;
const FLASH_COLOR = 0x00e68a;
const SPARKLE_COLOR = 0xbaffdd;
const CHIP_COLOR = 0xd4a017;
const CHIP_RIM = 0xf5f8ff;

// Distinct salt streams so one seed never correlates across events.
const SPARKLE_SALT = 0x5ab0de >>> 0;
const CONFETTI_SALT = 0x0c0ffe >>> 0;

/* ------------------------------------------------------------------ */
/* engine (manually clocked; shared ticker in play)                    */
/* ------------------------------------------------------------------ */

interface Step {
  node: EvNode;
  age: number;
  life: number;
  step(t01: number, ageMs: number): void;
}

interface LoopSpec {
  intervalMs: number;
  sinceSpawn: number;
  stopped: boolean;
  /** Appends the next step; draws from the effect's own rng in fixed order. */
  spawn(): void;
}

interface Effect {
  steps: Step[];
  loop: LoopSpec | null;
  layer: EvLayer;
  tornDown: boolean;
  done: boolean;
}

const active: Effect[] = [];
let tickerBound = false;

function tick(tk: Ticker): void {
  drive(tk.deltaMS);
}

/** Headless runtimes (selftest) have no rAF — they drive drive() manually. */
function ensureTicker(): void {
  if (tickerBound || typeof globalThis.requestAnimationFrame !== 'function') return;
  Ticker.shared.add(tick);
  tickerBound = true;
}

function unbindIfIdle(): void {
  if (tickerBound && active.length === 0) {
    Ticker.shared.remove(tick);
    tickerBound = false;
  }
}

function teardown(fx: Effect): void {
  if (fx.tornDown) return;
  fx.tornDown = true;
  // steps that expired mid-drive were already removed there; sweep the rest
  for (const s of fx.steps) if (s.age < s.life) s.node.remove();
  fx.layer.dispose();
}

function allDead(fx: Effect): boolean {
  for (const s of fx.steps) if (s.age < s.life) return false;
  return true;
}

/** Advance every live effect by dtMs (ticker in play, selftests directly). */
export function drive(dtMs: number): void {
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  for (const fx of active) {
    const lp = fx.loop;
    if (lp != null && !lp.stopped) {
      lp.sinceSpawn += dt;
      while (lp.sinceSpawn >= lp.intervalMs) {
        lp.sinceSpawn -= lp.intervalMs;
        lp.spawn();
      }
    }
    for (const s of fx.steps) {
      if (s.age >= s.life) continue;
      s.age += dt;
      s.step(Math.min(1, s.age / s.life), s.age);
      if (s.age >= s.life) s.node.remove();
    }
    if (!fx.done && (fx.loop == null || fx.loop.stopped) && allDead(fx)) {
      fx.done = true;
      teardown(fx);
    }
  }
  for (let i = active.length - 1; i >= 0; i--) {
    if (active[i].done) active.splice(i, 1);
  }
  unbindIfIdle();
}

/** Number of effects still animating (leak probe for selfTest). */
export function activeEffects(): number {
  return active.length;
}

function register(layer: EvLayer, steps: Step[], loop: LoopSpec | null = null): Effect {
  const fx: Effect = { steps, loop, layer, tornDown: false, done: false };
  active.push(fx);
  ensureTicker();
  return fx;
}

function handleOf(fx: Effect): EmeraldVfxHandle {
  return {
    get done(): boolean { return fx.done || fx.tornDown; },
    destroy(): void {
      const i = active.indexOf(fx);
      if (i >= 0) active.splice(i, 1);
      fx.done = true;
      teardown(fx);
      unbindIfIdle();
    },
  };
}

/* ------------------------------------------------------------------ */
/* 1 — card select flash                                               */
/* ------------------------------------------------------------------ */

export function startCardFlash(layer: EvLayer, x: number, y: number,
  w: number, h: number, opts: EmeraldVfxOpts = {}): EmeraldVfxHandle {
  const motion = opts.motion ?? revealMotionEnabled();
  const panel = layer.panel(x, y, w, h, FLASH_COLOR);
  const peak = 0.22;
  if (motion) {
    // fast attack (25%), then decay — reads as one hard blink
    register(layer, [{
      node: panel, age: 0, life: FLASH_MS,
      step(t) { panel.alpha(t < 0.25 ? peak * (t / 0.25) : peak * (1 - (t - 0.25) / 0.75)); },
    }]);
  } else {
    panel.alpha(0.16); // static hold: same information, zero animation
    register(layer, [{ node: panel, age: 0, life: FLASH_MS, step() { /* hold */ } }]);
  }
  return handleOf(active[active.length - 1]);
}

/** Pixi entry: flashes an emerald wash over a picked/hovered card rect. */
export function playCardFlash(parent: Container, x: number, y: number,
  w: number, h: number, opts: EmeraldVfxOpts = {}): EmeraldVfxHandle {
  return startCardFlash(new PixiEvLayer(parent), x, y, w, h, opts);
}

/* ------------------------------------------------------------------ */
/* 2 — relic icon sparkle loop (hover-scoped)                          */
/* ------------------------------------------------------------------ */

export function startIconSparkleOn(layer: EvLayer, x: number, y: number,
  opts: EmeraldVfxOpts = {}): SparkleHandle {
  const motion = opts.motion ?? revealMotionEnabled();
  const rng = mulberry32(((opts.seed ?? 0) ^ SPARKLE_SALT) >>> 0);
  const steps: Step[] = [];

  const spawnOne = (): void => {
    // fixed draw order: angle -> distance -> size -> phase
    const ang = rng() * Math.PI * 2;
    const dist = 30 + rng() * 26;
    const size = 10 + rng() * 8;
    const sx = x + Math.cos(ang) * dist;
    const sy = y + Math.sin(ang) * dist;
    const star = layer.star(sx, sy, size, SPARKLE_COLOR);
    if (motion) {
      const phase = rng() * Math.PI * 2;
      const vx = Math.cos(ang) * 14;
      const vy = Math.sin(ang) * 14;
      steps.push({
        node: star, age: 0, life: SPARKLE_MS,
        step(_t, age) {
          const twinkle = 0.55 + 0.45 * Math.sin(age / 45 + phase);
          const grow = 0.35 + 0.85 * Math.min(1, age / 120);
          star.move(sx + vx * age, sy + vy * age);
          star.stretch(grow, grow);
          star.alpha(twinkle * (age < SPARKLE_MS * 0.8 ? 1 : (SPARKLE_MS - age) / (SPARKLE_MS * 0.2)));
        },
      });
    } else {
      star.alpha(0.65); // pinned mark, no twinkle, no drift
      steps.push({ node: star, age: 0, life: SPARKLE_MS, step() { /* hold */ } });
    }
  };

  let fx: Effect;
  let loop: LoopSpec | null = null;
  if (motion) {
    spawnOne(); // instant feedback at hover start
    loop = { intervalMs: SPARKLE_INTERVAL_MS, sinceSpawn: 0, stopped: false, spawn: spawnOne };
    fx = register(layer, steps, loop);
  } else {
    for (let i = 0; i < STATIC_SPARKLES; i++) spawnOne();
    fx = register(layer, steps, null);
  }

  return {
    stop(): void { if (loop != null) loop.stopped = true; },
    get alive(): boolean { return !fx.done && !fx.tornDown; },
    get spawned(): number { return steps.length; },
  };
}

/** Pixi entry: relic icon sparkle loop while the card is hovered. */
export function startIconSparkle(parent: Container, x: number, y: number,
  opts: EmeraldVfxOpts = {}): SparkleHandle {
  return startIconSparkleOn(new PixiEvLayer(parent), x, y, opts);
}

/* ------------------------------------------------------------------ */
/* 3 — confetti burst on pick                                          */
/* ------------------------------------------------------------------ */

export function startConfetti(layer: EvLayer, x: number, y: number,
  opts: EmeraldVfxOpts = {}): EmeraldVfxHandle {
  const motion = opts.motion ?? revealMotionEnabled();
  const rng = mulberry32(((opts.seed ?? 0) ^ CONFETTI_SALT) >>> 0);
  const steps: Step[] = [];

  for (let i = 0; i < CONFETTI_N; i++) {
    // fixed draw order: angle -> speed -> w -> h -> colour -> spin
    const ang = rng() * Math.PI * 2;
    const speed = 0.24 + rng() * 0.34;
    const fw = 5 + rng() * 6;
    const fh = 3 + rng() * 3;
    const color = CONFETTI_COLORS[Math.floor(rng() * CONFETTI_COLORS.length)];
    const spin = (rng() * 2 - 1) * 0.02;
    const vx = Math.cos(ang) * speed;
    const vy = Math.sin(ang) * speed - 0.12; // slight celebratory lift
    const fleck = layer.fleck(x, y, fw, fh, color);

    if (motion) {
      steps.push({
        node: fleck, age: 0, life: CONFETTI_MS,
        step(_t, age) {
          fleck.move(x + vx * age, y + vy * age + 0.5 * CONFETTI_GRAV * age * age);
          fleck.rotate(spin * age);
          // flutter squash keeps pieces reading as paper, not dots
          fleck.stretch(1, 0.45 + 0.55 * Math.abs(Math.sin(age / 70)));
          fleck.alpha(age < CONFETTI_MS * 0.6 ? 1 : 1 - (age - CONFETTI_MS * 0.6) / (CONFETTI_MS * 0.4));
        },
      });
    } else {
      // reduced motion: settled marks at the exact end-of-flight positions
      fleck.move(x + vx * CONFETTI_MS, y + vy * CONFETTI_MS + 0.5 * CONFETTI_GRAV * CONFETTI_MS * CONFETTI_MS);
      fleck.rotate(spin * CONFETTI_MS);
      fleck.alpha(0.5);
      steps.push({ node: fleck, age: 0, life: FLASH_MS, step() { /* hold */ } });
    }
  }
  return handleOf(register(layer, steps));
}

/** Pixi entry: deterministic confetti burst from the picked card centre. */
export function playConfetti(parent: Container, x: number, y: number,
  opts: EmeraldVfxOpts = {}): EmeraldVfxHandle {
  return startConfetti(new PixiEvLayer(parent), x, y, opts);
}

/* ------------------------------------------------------------------ */
/* 4 — chip fly-to-score                                               */
/* ------------------------------------------------------------------ */

export function startChipFly(layer: EvLayer, fromX: number, fromY: number,
  toX: number, toY: number, opts: EmeraldVfxOpts = {}): EmeraldVfxHandle {
  const motion = opts.motion ?? revealMotionEnabled();
  const d = 26;
  const chip = layer.chip(fromX, fromY, d, CHIP_COLOR, CHIP_RIM);

  if (motion) {
    register(layer, [{
      node: chip, age: 0, life: CHIP_MS,
      step(t) {
        const e = 1 - Math.pow(1 - t, 3); // ease-out cubic: fast launch, soft landing
        const cx = fromX + (toX - fromX) * e;
        const cy = fromY + (toY - fromY) * e - CHIP_ARC_PX * Math.sin(Math.PI * t);
        chip.move(cx, cy);
        chip.stretch(1 + 0.28 * Math.sin(Math.PI * t), 1 + 0.28 * Math.sin(Math.PI * t));
        chip.alpha(t < 0.08 ? t / 0.08 : t > 0.88 ? Math.max(0, (1 - t) / 0.12) : 1);
      },
    }]);
  } else {
    chip.move(toX, toY); // parked on the destination: score went up
    chip.alpha(0.95);
    register(layer, [{ node: chip, age: 0, life: CHIP_MS, step() { /* hold */ } }]);
  }
  return handleOf(active[active.length - 1]);
}

/** Pixi entry: gold score chip arcing from the card to the score readout. */
export function playChipFly(parent: Container, fromX: number, fromY: number,
  toX: number, toY: number, opts: EmeraldVfxOpts = {}): EmeraldVfxHandle {
  return startChipFly(new PixiEvLayer(parent), fromX, fromY, toX, toY, opts);
}

/* ------------------------------------------------------------------ */
/* Pixi adapter                                                        */
/* ------------------------------------------------------------------ */

class PixiNode implements EvNode {
  private g: Container;
  private gone = false;
  constructor(g: Container) { this.g = g; }
  move(x: number, y: number): void { this.g.x = x; this.g.y = y; }
  alpha(a: number): void { this.g.alpha = a; }
  rotate(rad: number): void { this.g.rotation = rad; }
  stretch(sx: number, sy: number): void { this.g.scale.set(sx, sy); }
  remove(): void {
    if (this.gone) return;
    this.gone = true;
    this.g.destroy({ children: true });
  }
}

class PixiEvLayer implements EvLayer {
  private root = new Container();
  private dead = false;
  constructor(parent: Container) { parent.addChild(this.root); }

  panel(x: number, y: number, w: number, h: number, color: number): EvNode {
    const s = new Sprite(Texture.WHITE);
    s.x = x; s.y = y; s.width = w; s.height = h;
    s.tint = color; s.alpha = 0;
    this.root.addChild(s);
    return new PixiNode(s);
  }

  star(x: number, y: number, size: number, color: number): EvNode {
    const g = new Graphics();
    const w = size * 0.31; // half-width of the diamond waist
    g.poly([0, -size / 2, w, 0, 0, size / 2, -w, 0]).fill(color);
    g.x = x; g.y = y; g.alpha = 0;
    this.root.addChild(g);
    return new PixiNode(g);
  }

  fleck(x: number, y: number, w: number, h: number, color: number): EvNode {
    const g = new Graphics();
    g.rect(-w / 2, -h / 2, w, h).fill(color);
    g.x = x; g.y = y; g.alpha = 0;
    this.root.addChild(g);
    return new PixiNode(g);
  }

  chip(x: number, y: number, d: number, color: number, rim: number): EvNode {
    const g = new Graphics();
    g.circle(0, 0, d / 2).fill(color).stroke({ width: 2, color: rim });
    g.x = x; g.y = y; g.alpha = 0;
    this.root.addChild(g);
    return new PixiNode(g);
  }

  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    this.root.destroy({ children: true });
  }
}

/* ------------------------------------------------------------------ */
/* selftest — memory stub layer, manual clock, leak probe              */
/* ------------------------------------------------------------------ */

interface MemTrace { op: 'move' | 'alpha' | 'rotate' | 'stretch'; args: number[] }
class MemNode implements EvNode {
  readonly kind: string;
  traces: MemTrace[] = [];
  removedCount = 0;
  x = 0; y = 0; a = 0;
  constructor(kind: string) { this.kind = kind; }
  move(x: number, y: number): void { this.traces.push({ op: 'move', args: [x, y] }); this.x = x; this.y = y; }
  alpha(a: number): void { this.traces.push({ op: 'alpha', args: [a] }); this.a = a; }
  rotate(r: number): void { this.traces.push({ op: 'rotate', args: [r] }); }
  stretch(sx: number, _sy: number): void { this.traces.push({ op: 'stretch', args: [sx] }); }
  remove(): void { this.removedCount++; }
  get removed(): boolean { return this.removedCount > 0; }
}

class MemLayer implements EvLayer {
  created: MemNode[] = [];
  disposedCount = 0;
  private add(n: MemNode): EvNode { this.created.push(n); return n; }
  panel(_x: number, _y: number, _w: number, _h: number, _color: number): EvNode {
    return this.add(new MemNode('panel'));
  }
  star(x: number, y: number, _size: number, _color: number): EvNode {
    const n = new MemNode('star'); n.move(x, y); return this.add(n);
  }
  fleck(x: number, y: number, _w: number, _h: number, _color: number): EvNode {
    const n = new MemNode('fleck'); n.move(x, y); return this.add(n);
  }
  chip(x: number, y: number, _d: number, _color: number, _rim: number): EvNode {
    const n = new MemNode('chip'); n.move(x, y); return this.add(n);
  }
  dispose(): void { this.disposedCount++; }
  byKind(kind: string): MemNode[] { return this.created.filter((n) => n.kind === kind); }
}

const EPS = 1e-6;
const near = (a: number, b: number, eps = EPS): boolean => Math.abs(a - b) <= eps;

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const ok = (cond: boolean, msg: string): void => { if (!cond) failures.push(msg); };
  /* ---- rails ---- */
  ok(FLASH_MS <= 200, `flash rail ${FLASH_MS} > 200ms`);
  ok(CONFETTI_MS <= 600, `confetti rail ${CONFETTI_MS} > 600ms`);
  ok(CHIP_MS <= 600, `chip rail ${CHIP_MS} > 600ms`);
  ok(SPARKLE_MS <= 600, `sparkle rail ${SPARKLE_MS} > 600ms`);

  /* ---- 1. card flash (motion) ---- */
  {
    const layer = new MemLayer();
    startCardFlash(layer, 100, 200, 340, 400, { motion: true, seed: 11 });
    const panels = layer.byKind('panel');
    ok(panels.length === 1, `flash creates one panel (got ${panels.length})`);
    drive(40); // inside the attack phase
    const alphas = panels[0].traces.filter((t) => t.op === 'alpha').map((t) => t.args[0]);
    ok(alphas.length >= 1 && alphas[alphas.length - 1] > 0, 'flash alpha rises above 0');
    const atAttack = alphas[alphas.length - 1];
    drive(FLASH_MS + 50); // past life
    ok(panels[0].removed && panels[0].removedCount === 1, 'flash node removed exactly once');
    ok(layer.disposedCount === 1, `flash layer disposed once (got ${layer.disposedCount})`);
    ok(activeEffects() === 0, 'flash leaves no active effects');
    ok(atAttack <= 0.22 + EPS, `flash alpha within peak rail (got ${atAttack.toFixed(3)})`);
  }

  /* ---- 1b. card flash (static gate) ---- */
  {
    const layer = new MemLayer();
    startCardFlash(layer, 0, 0, 10, 10, { motion: false });
    const p = layer.byKind('panel')[0];
    drive(30); drive(30);
    const alphas = p.traces.filter((t) => t.op === 'alpha');
    ok(alphas.length === 1, `static flash sets alpha exactly once (got ${alphas.length})`);
    ok(near(alphas[0].args[0], 0.16), `static flash holds fixed alpha (got ${alphas[0].args[0]})`);
    drive(FLASH_MS + 50);
    ok(p.removed && layer.disposedCount === 1 && activeEffects() === 0, 'static flash cleans up identically');
  }

  /* ---- 2. confetti: determinism + ballistic path ---- */
  const endPositions = (seed: number, motion: boolean): Array<[number, number]> => {
    const layer = new MemLayer();
    startConfetti(layer, 500, 300, { motion, seed });
    drive(motion ? CONFETTI_MS + 50 : FLASH_MS + 50);
    return layer.byKind('fleck').map((f) => [f.x, f.y] as [number, number]);
  };
  {
    const layer = new MemLayer();
    startConfetti(layer, 500, 300, { motion: true, seed: 42 });
    const flecks = layer.byKind('fleck');
    ok(flecks.length === CONFETTI_N, `confetti spawns ${CONFETTI_N} (got ${flecks.length})`);

    // recompute expected scatter independently from the documented draw order,
    // then advance the manual clock once to half-life and compare every fleck
    const rng = mulberry32((42 ^ CONFETTI_SALT) >>> 0);
    const expected: Array<[number, number]> = [];
    const seenColors = new Set<number>();
    for (let i = 0; i < CONFETTI_N; i++) {
      const ang = rng() * Math.PI * 2;
      const speed = 0.24 + rng() * 0.34;
      void (5 + rng() * 6); void (3 + rng() * 3);
      seenColors.add(Math.floor(rng() * CONFETTI_COLORS.length));
      void ((rng() * 2 - 1) * 0.02);
      const vx = Math.cos(ang) * speed;
      const vy = Math.sin(ang) * speed - 0.12;
      expected.push([500 + vx * CONFETTI_MS / 2, 300 + vy * CONFETTI_MS / 2 + 0.5 * CONFETTI_GRAV * (CONFETTI_MS / 2) ** 2]);
    }
    drive(CONFETTI_MS / 2);
    let ballisticsOk = true;
    for (let i = 0; i < CONFETTI_N; i++) {
      if (!near(flecks[i].x, expected[i][0]) || !near(flecks[i].y, expected[i][1])) ballisticsOk = false;
    }
    ok(ballisticsOk, 'confetti follows the documented ballistic curve exactly');
    ok(seenColors.size >= 2, 'confetti uses more than one palette colour');

    drive(CONFETTI_MS + 100);
    ok(flecks.every((f) => f.removed && f.removedCount === 1), 'all confetti removed exactly once');
    ok(layer.disposedCount === 1 && activeEffects() === 0, 'confetti cleanup verified');

    // determinism: identical seed -> identical scatter, different seed -> differs
    const a = endPositions(42, true);
    const b = endPositions(42, true);
    const c = endPositions(43, true);
    ok(JSON.stringify(a) === JSON.stringify(b), 'same seed reproduces identical scatter');
    ok(JSON.stringify(a) !== JSON.stringify(c), 'different seed scatters differently');
  }

  /* ---- 2b. confetti early destroy ---- */
  {
    const h = startConfetti(new MemLayer(), 0, 0, { motion: true, seed: 1 });
    drive(100);
    h.destroy();
    ok(h.done && activeEffects() === 0, 'early destroy removes the running burst');
  }

  /* ---- 2c. confetti static gate: settled marks, zero animation ---- */
  {
    const layer = new MemLayer();
    startConfetti(layer, 500, 300, { motion: false, seed: 42 });
    const flecks = layer.byKind('fleck');
    const movesBefore = flecks.reduce((n, f) => n + f.traces.filter((t) => t.op === 'move').length, 0);
    drive(50); drive(50);
    const movesAfter = flecks.reduce((n, f) => n + f.traces.filter((t) => t.op === 'move').length, 0);
    ok(movesAfter === movesBefore, 'static confetti never moves after placement');
    const got = flecks.map((f) => [f.x, f.y] as [number, number]);
    ok(JSON.stringify(endPositions(42, false)) === JSON.stringify(got),
      'static confetti sits at exact end-of-flight positions');
    drive(FLASH_MS + 50);
    ok(flecks.every((f) => f.removed) && activeEffects() === 0, 'static confetti cleans up');
  }

  /* ---- 3. chip fly ---- */
  {
    const layer = new MemLayer();
    startChipFly(layer, 300, 600, 1300, 80, { motion: true, seed: 7 });
    const chips = layer.byKind('chip');
    ok(chips.length === 1, 'chip fly creates one chip');
    const c = chips[0];
    drive(CHIP_MS / 2);
    const lineY = 600 + (80 - 600) * (1 - Math.pow(1 - 0.5, 3)); // eased straight path
    ok(c.x > 300 && c.x < 1300, `chip midway horizontally (x=${c.x.toFixed(1)})`);
    ok(c.y < lineY, `arc lifts above the straight path (${c.y.toFixed(1)} < ${lineY.toFixed(1)})`);
    drive(CHIP_MS / 2 + 1);
    ok(near(c.x, 1300, 0.5) && near(c.y, 80, 0.5),
      `chip lands on the score anchor (${c.x.toFixed(1)},${c.y.toFixed(1)})`);
    ok(c.removed && c.removedCount === 1, 'chip removed exactly once at arrival');
    ok(layer.disposedCount === 1 && activeEffects() === 0, 'chip cleanup verified');

    // static variant parks on the destination instantly
    const layer2 = new MemLayer();
    startChipFly(layer2, 0, 0, 900, 90, { motion: false });
    const c2 = layer2.byKind('chip')[0];
    ok(near(c2.x, 900) && near(c2.y, 90), 'static chip appears at destination');
    drive(CHIP_MS + 50);
    ok(c2.removed && activeEffects() === 0, 'static chip cleans up');
  }

  /* ---- 4. sparkle loop (motion): spawns while hovering, stops clean ---- */
  {
    const layer = new MemLayer();
    const sp = startIconSparkleOn(layer, 800, 326, { motion: true, seed: 99 });
    drive(SPARKLE_INTERVAL_MS * 3 + 1);
    ok(sp.alive, 'sparkle loop stays alive while hovering');
    ok(sp.spawned >= 4, `sparkles spawn on cadence (got ${sp.spawned})`);
    const stars = layer.byKind('star');
    ok(stars.length === sp.spawned, `spawned counter matches nodes (${stars.length} vs ${sp.spawned})`);
    const anchored = stars.every((s) =>
      Math.hypot(s.x - 800, s.y - 326) <= 30 + 26 + 14 * SPARKLE_MS + 1);
    ok(anchored, 'every sparkle orbits the icon anchor');
    sp.stop();
    drive(SPARKLE_MS + 100);
    ok(!sp.alive, 'sparkle handle dead after stop');
    ok(stars.every((s) => s.removed && s.removedCount === 1), 'all sparkles removed exactly once');
    ok(layer.disposedCount === 1 && activeEffects() === 0,
      'sparkle loop cleanup verified — nothing leaks past hover');
  }

  /* ---- 4b. sparkle static gate: pinned marks, no growth ---- */
  {
    const layer = new MemLayer();
    const sp = startIconSparkleOn(layer, 800, 326, { motion: false, seed: 99 });
    drive(2000);
    ok(layer.byKind('star').length === STATIC_SPARKLES,
      `static sparkle pins exactly ${STATIC_SPARKLES} marks (got ${layer.byKind('star').length})`);
    ok(sp.spawned === STATIC_SPARKLES, 'static variant never loops');
    const stars = layer.byKind('star');
    const moves = stars.reduce((n, s) => n + s.traces.filter((t) => t.op === 'move').length, 0);
    ok(moves === STATIC_SPARKLES, `static sparkles placed once, never animated (moves=${moves})`);
    sp.stop();
    drive(SPARKLE_MS + 50);
    ok(stars.every((s) => s.removed) && activeEffects() === 0, 'static sparkles clean up');
  }

  /* ---- 5. default gate honours IQB_MOTION=0 ---- */
  {
    const g = globalThis as unknown as { IQB_MOTION?: string };
    const prev = g.IQB_MOTION;
    g.IQB_MOTION = '0';
    try {
      const layer = new MemLayer();
      startConfetti(layer, 10, 10, { seed: 5 }); // no explicit motion -> gate decides
      const f = layer.byKind('fleck')[0];
      const rotatesAtRest = f.traces.filter((t) => t.op === 'rotate').length;
      drive(60); drive(60);
      const rotatesAfter = f.traces.filter((t) => t.op === 'rotate').length;
      ok(rotatesAfter === rotatesAtRest, 'IQB_MOTION=0 -> confetti never animates rotation');
      drive(FLASH_MS + 50);
      ok(activeEffects() === 0, 'gated confetti cleans up');
    } finally {
      g.IQB_MOTION = prev;
    }
  }

  /* ---- 6. final leak probe ---- */
  ok(activeEffects() === 0, 'engine fully idle after selftest');

  return { ok: failures.length === 0, failures };
}

/* Node smoke entry: cd v2 && node --experimental-strip-types src/fx/emeraldvfx.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/emeraldvfx.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] EMERALD-VFX OK' : `[selftest] EMERALD-VFX FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
