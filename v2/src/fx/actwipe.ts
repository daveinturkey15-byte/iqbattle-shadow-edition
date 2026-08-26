/* ============================================================================
 * fx/actwipe.ts — V2 ACT-TRANSITION WIPE (corruption-ramp scene beat)
 * ----------------------------------------------------------------------------
 * One call per beat, both auto-cleaning full-stage overlays that sit ABOVE the
 * chrome while the arc director flips acts:
 *
 *   playActWipe(parent, toAct)  -> crimson->black gradient sweep, left to
 *                                  right, exactly 600 ms total: a bright
 *                                  crimson leading edge drags a black curtain
 *                                  across the stage, holds one beat on full
 *                                  cover (hiding the act re-tint underneath),
 *                                  then fades out revealing the new act.
 *   playSanctuaryWash(parent)   -> gentle pale-blue light wash (sanctuary /
 *                                  good rounds), soft rise-hold-fall envelope,
 *                                  460 ms. No sweep, never fully covers.
 *
 * RAILS (DNA.md):
 *   - Hard rail: every variant <= 600 ms, one shot per act flip — single
 *     flight per (layer, kind): a second call while a wipe of that kind is
 *     live on the same parent returns the existing handle instead of
 *     stacking overlays.
 *   - Motion-gated behind IQB_MOTION / prefers-reduced-motion (shared gate
 *     from fx/reveal.ts): static variant shows the SAME information — a dark
 *     veil with a faint crimson cast (or fixed pale-blue wash) held for the
 *     same duration — with zero movement and identical cleanup.
 *   - Never recolors or animates question/answer glyphs; the overlay lives in
 *     its own container (eventMode 'none') removed on finish — auto-cleanup
 *     guaranteed, input never blocked.
 *   - Determinism: pure functions of (toAct, clock). No Math.random,
 *     no Date.now, no rng draws at all.
 *
 * TESTABILITY: the beat is layer-agnostic (`startWipe` over a tiny
 * WipeLayer interface). The Pixi adapter is a thin shell; selfTest()
 * drives a memory stub with a manual clock — no renderer needed.
 * ==========================================================================*/
import { Container, Sprite, Ticker, Texture } from 'pixi.js';
import { STAGE_W, STAGE_H } from '../theme.ts';
import { revealMotionEnabled } from './reveal.ts';

export type WipeKind = 'act' | 'sanctuary';

/** Result handle: poll `done`, or force-cleanup early with `destroy()`. */
export interface WipeHandle {
  readonly done: boolean;
  destroy(): void;
}

/* ------------------------------------------------------------------ */
/* timing + palette rails                                              */
/* ------------------------------------------------------------------ */

/** Total act-wipe budget — hard rail <= 600 ms. */
export const WIPE_MS = 600;
const SWEEP_MS = 380;   // curtain covers the stage
const HOLD_MS = 100;    // full cover hides the act re-tint swap
const FADE_MS = 120;    // reveal the new act

/** Sanctuary light-wash budget (gentle, well under the wipe rail). */
export const SANCTUARY_MS = 460;
const SANCT_RISE_MS = 160;
const SANCT_HOLD_UNTIL = 300;

const CURTAIN_COLOR = 0x05070d;   // near-black trailing curtain (bg-family)
const EDGE_COLOR = 0xff2038;      // crimson leading edge (ABYSS accent family)
const MID_COLOR = 0xe0245e;       // deep-crimson falloff band (INFERNO accent)
const SANCTUARY_BLUE = 0xaedcff;  // pale-blue light wash (sanctuary border family)

const EDGE_W = 64;                // solid leading-edge bar width
const MID_W = 150;                // gradient falloff band width behind it
const CURTAIN_STATIC_A = 0.78;    // static fallback veil darkness
const SANCT_PEAK = 0.2;           // motion peak alpha — gentle by design
const SANCT_STATIC_A = 0.16;

/* ------------------------------------------------------------------ */
/* layer abstraction                                                   */
/* ------------------------------------------------------------------ */

interface WipeNode {
  place(x: number, y: number): void;
  size(w: number, h: number): void;
  alpha(a: number): void;
  remove(): void;
}

interface WipeLayer {
  /** Full-stage-capable tinted rect anchored at (0,0), alpha 0 until driven. */
  rect(color: number): WipeNode;
  /** Whole-overlay fade (root container alpha). */
  rootAlpha(a: number): void;
  /** Called exactly once when the effect finishes — fully detaches the layer. */
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* effect core (layer-agnostic, manually clocked)                      */
/* ------------------------------------------------------------------ */

interface WipeNodes {
  curtain: WipeNode;
  mid: WipeNode;
  edge: WipeNode;
}

interface ActiveWipe {
  kind: WipeKind;
  act: number;
  motion: boolean;
  nodes: WipeNodes | null;   // act wipe: curtain + gradient band + edge
  veil: WipeNode | null;     // sanctuary wash: single pale-blue node
  age: number;
  life: number;
  layer: WipeLayer;
  tornDown: boolean;
  done: boolean;
}

const active: ActiveWipe[] = [];
/** Single flight per (layer, kind): rapid double-fire cannot stack overlays. */
const liveHandles = new Map<object, Partial<Record<WipeKind, WipeHandle>>>();
let tickerBound = false;

function tick(tk: Ticker): void {
  drive(tk.deltaMS);
}

function unbindIfIdle(): void {
  if (tickerBound && active.length === 0) {
    Ticker.shared.remove(tick);
    tickerBound = false;
  }
}

/** Headless runtimes (selftest) have no rAF — they drive `drive()` manually. */
function ensureTicker(): void {
  if (tickerBound || typeof globalThis.requestAnimationFrame !== 'function') return;
  Ticker.shared.add(tick);
  tickerBound = true;
}

function teardown(fx: ActiveWipe): void {
  if (fx.tornDown) return;
  fx.tornDown = true;
  const slot = liveHandles.get(fx.layer);
  if (slot != null) {
    if (fx.kind === 'act') delete slot.act;
    else delete slot.sanctuary;
    if (slot.act === undefined && slot.sanctuary === undefined) liveHandles.delete(fx.layer);
  }
  for (const n of fx.nodes ? [fx.nodes.curtain, fx.nodes.mid, fx.nodes.edge] : []) n.remove();
  fx.veil?.remove();
  fx.layer.dispose();
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Crimson intensity ramps with descent depth (act 0..3). */
function depthBoost(act: number): number {
  return 0.12 * clamp01(Math.max(0, Math.min(3, act)) / 3);
}

/** Advance every live wipe by dtMs (shared ticker in play, selftests direct). */
export function drive(dtMs: number): void {
  for (const fx of active) {
    if (!fx.done) {
      fx.age += dtMs;
      stepWipe(fx);
      if (fx.age >= fx.life) {
        fx.done = true;
        teardown(fx);
      }
    }
  }
  for (let i = active.length - 1; i >= 0; i--) {
    if (active[i].done) active.splice(i, 1);
  }
  unbindIfIdle();
}

function stepWipe(fx: ActiveWipe): void {
  const age = Math.min(fx.age, fx.life);
  if (fx.kind === 'sanctuary') {
    const veil = fx.veil;
    if (veil == null || !fx.motion) return; // static: placed once, held, cleaned identically
    const a = age < SANCT_RISE_MS
      ? SANCT_PEAK * (age / SANCT_RISE_MS)
      : age < SANCT_HOLD_UNTIL
        ? SANCT_PEAK
        : Math.max(0, SANCT_PEAK * (1 - (age - SANCT_HOLD_UNTIL) / (fx.life - SANCT_HOLD_UNTIL)));
    veil.alpha(a);
    return;
  }
  const n = fx.nodes;
  if (n == null || !fx.motion) return; // static: placed once, held, cleaned identically
  const ct = clamp01(age / SWEEP_MS);          // smoothstep ease
  const cover = ct * ct * (3 - 2 * ct);
  const head = cover * (STAGE_W + EDGE_W + MID_W);
  const curtainW = Math.max(0, Math.min(STAGE_W, head - EDGE_W - MID_W));
  n.curtain.size(curtainW, STAGE_H);
  n.mid.place(head - EDGE_W - MID_W, 0);
  n.edge.place(head - EDGE_W, 0);
  if (age > SWEEP_MS + HOLD_MS) {
    fx.layer.rootAlpha(clamp01(1 - (age - SWEEP_MS - HOLD_MS) / FADE_MS));
  }
}

/** Core scheduler: layers one wipe beat onto any WipeLayer. */
function startWipe(layer: WipeLayer, kind: WipeKind, toAct: number,
  opts: { motion?: boolean } = {}): WipeHandle {
  const existing = liveHandles.get(layer)?.[kind];
  if (existing != null) return existing; // plays ONCE per layer per kind
  const motion = opts.motion ?? revealMotionEnabled();

  let nodes: WipeNodes | null = null;
  let veil: WipeNode | null = null;
  let life: number;
  let boost = 0;
  if (kind === 'sanctuary') {
    veil = layer.rect(SANCTUARY_BLUE);
    veil.size(STAGE_W, STAGE_H);
    veil.place(0, 0);
    veil.alpha(motion ? 0 : SANCT_STATIC_A);
    life = SANCTUARY_MS;
  } else {
    boost = depthBoost(toAct);
    const curtain = layer.rect(CURTAIN_COLOR);
    curtain.place(0, 0);
    curtain.size(motion ? 0 : STAGE_W, STAGE_H);
    const mid = layer.rect(MID_COLOR);
    const edge = layer.rect(EDGE_COLOR);
    if (motion) {
      mid.size(MID_W, STAGE_H);
      edge.size(EDGE_W, STAGE_H);
    } else {
      // Static fallback: same information — dark veil + faint crimson cast.
      mid.size(STAGE_W, STAGE_H);
      edge.size(STAGE_W, STAGE_H);
    }
    mid.alpha(motion ? Math.min(1, 0.5 + boost) : Math.min(0.5, 0.18 + boost / 2));
    edge.alpha(motion ? 0.95 : 0.08);
    curtain.alpha(motion ? 1 : CURTAIN_STATIC_A);
    nodes = { curtain, mid, edge };
    life = WIPE_MS;
  }

  const fx: ActiveWipe = {
    kind, act: toAct, motion, nodes, veil,
    age: 0, life, layer, tornDown: false, done: false,
  };
  active.push(fx);

  let slot = liveHandles.get(layer);
  if (slot == null) {
    slot = {};
    liveHandles.set(layer, slot);
  }

  let destroyed = false;
  const handle: WipeHandle = {
    get done(): boolean { return fx.done || fx.tornDown; },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      const i = active.indexOf(fx);
      if (i >= 0) active.splice(i, 1);
      fx.done = true;
      teardown(fx);
      unbindIfIdle();
    },
  };
  if (kind === 'act') slot.act = handle;
  else slot.sanctuary = handle;

  ensureTicker();
  return handle;
}

/** Number of wipes still animating (leak probe for selfTest). */
export function activeWipes(): number {
  return active.length;
}

/* ------------------------------------------------------------------ */
/* Pixi adapter                                                        */
/* ------------------------------------------------------------------ */

class PixiWipeLayer implements WipeLayer {
  private root: Container;
  private parent: Container;
  private dead = false;

  constructor(parent: Container) {
    this.parent = parent;
    this.root = new Container();
    this.root.eventMode = 'none';           // decor only — never eats input
    this.root.interactiveChildren = false;
    parent.addChild(this.root);
  }

  rect(color: number): WipeNode {
    const s = new Sprite(Texture.WHITE);
    s.tint = color;
    s.alpha = 0;
    s.x = 0;
    s.y = 0;
    this.root.addChild(s);
    return {
      place: (x, y) => { s.x = x; s.y = y; },
      size: (w, h) => { s.width = w; s.height = h; },
      alpha: (a) => { s.alpha = a; },
      remove: () => {
        if (s.parent) s.parent.removeChild(s);
        s.destroy();
      },
    };
  }

  rootAlpha(a: number): void {
    this.root.alpha = a;
  }

  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    this.root.removeChildren();
    this.parent.removeChild(this.root);
    this.root.destroy();
  }
}

/**
 * Play the act-transition wipe over `parent` (the scene container) when the
 * arc director flips to act `toAct` (0..3). Auto-cleans at 600 ms; a second
 * call while a wipe is already playing on this parent returns the live handle
 * instead of stacking. Wire it right before scenes/arc.ts appliesArc() so the
 * re-tint happens under full cover.
 */
export function playActWipe(parent: Container, toAct: number,
  opts: { motion?: boolean } = {}): WipeHandle {
  return startWipe(new PixiWipeLayer(parent), 'act', toAct, opts);
}

/**
 * Gentle pale-blue sanctuary light wash over `parent` (good rounds). Same
 * auto-cleanup and single-flight rules; never fully covers the stage.
 */
export function playSanctuaryWash(parent: Container,
  opts: { motion?: boolean } = {}): WipeHandle {
  return startWipe(new PixiWipeLayer(parent), 'sanctuary', 0, opts);
}

/* ------------------------------------------------------------------ */
/* selftest — memory-stub layer, manual clock, leak probe              */
/* ------------------------------------------------------------------ */

export interface MemoryWipeNode extends WipeNode {
  tag: string;
  x: number;
  y: number;
  w: number;
  h: number;
  a: number;
  removed: boolean;
}

export interface MemoryWipeLayer extends WipeLayer {
  nodes: MemoryWipeNode[];
  rootAlphas: number[];
  disposed: boolean;
  byTag(tag: string): MemoryWipeNode[];
}

export function createMemoryWipeLayer(): MemoryWipeLayer {
  const nodes: MemoryWipeNode[] = [];
  const rootAlphas: number[] = [];
  let disposed = false;
  const mk = (tag: string): MemoryWipeNode => {
    const n: MemoryWipeNode = {
      tag, x: 0, y: 0, w: 0, h: 0, a: 0, removed: false,
      place(px, py) { n.x = px; n.y = py; },
      size(pw, ph) { n.w = pw; n.h = ph; },
      alpha(pa) { n.a = pa; },
      remove() { n.removed = true; },
    };
    nodes.push(n);
    return n;
  };
  const layer: MemoryWipeLayer = {
    nodes,
    rootAlphas,
    get disposed(): boolean { return disposed; },
    rect(color: number): WipeNode { return mk(`rect:${color}`); },
    rootAlpha(a: number): void { rootAlphas.push(a); },
    dispose(): void { disposed = true; },
    byTag(tag: string): MemoryWipeNode[] { return nodes.filter((n) => n.tag.startsWith(tag)); },
  };
  return layer;
}

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const ok = (cond: boolean, msg: string): void => { if (!cond) failures.push(msg); };

  /* ---- 1. act wipe plays ONCE per layer; sweep animates left -> right ---- */
  {
    const L = createMemoryWipeLayer();
    const h1 = startWipe(L, 'act', 3, { motion: true });
    const created = L.nodes.length;
    const h2 = startWipe(L, 'act', 3, { motion: true });
    ok(h1 === h2, 'double-fire while live returns the SAME handle (plays once)');
    ok(created === 3, `overlay is curtain+gradient-band+edge (3 rects), got ${created}`);
    ok(activeWipes() === 1, 'one live wipe');
    const curtain = L.byTag(`rect:${CURTAIN_COLOR}`)[0];
    const edge = L.byTag(`rect:${EDGE_COLOR}`)[0];
    const w0 = curtain != null ? curtain.w : -1;
    const x0 = edge != null ? edge.x : -1;
    drive(190);
    const w1 = curtain != null ? curtain.w : -1;
    const x1 = edge != null ? edge.x : -1;
    ok(w1 > w0 && w1 > 0, `curtain sweeps open (${w0} -> ${w1})`);
    ok(x1 > x0, `crimson edge travels right (${x0} -> ${x1})`);
    ok(x1 <= STAGE_W, 'edge stays on-stage mid-sweep');

    /* ---- 2. completes at the 600 ms rail, full cleanup ---- */
    drive(WIPE_MS + 60);
    ok(h1.done, 'handle reports done at the 600 ms rail');
    ok(L.nodes.every((n) => n.removed), 'cleanup removed ALL children');
    ok(L.disposed, 'layer disposed');
    ok(activeWipes() === 0, 'no active wipes left');
  }

  /* ---- 3. full-cover hold hides the swap, then fades out ---- */
  {
    const L = createMemoryWipeLayer();
    startWipe(L, 'act', 2, { motion: true });
    drive(SWEEP_MS + HOLD_MS / 2);
    const curtain = L.byTag(`rect:${CURTAIN_COLOR}`)[0];
    ok(curtain != null && curtain.w >= STAGE_W, 'full cover reached before the hold ends');
    ok(L.rootAlphas.every((a) => a >= 1), 'no fade before the hold finishes');
    drive(HOLD_MS);
    const last = L.rootAlphas[L.rootAlphas.length - 1];
    ok(last != null && last < 1, 'root fades out to reveal the new act');
    drive(WIPE_MS + 60);
    ok(L.nodes.every((n) => n.removed) && L.disposed, 'post-fade cleanup complete');
  }

  /* ---- 4. motion-gated STATIC variant exists: pinned, same cleanup ---- */
  {
    const L = createMemoryWipeLayer();
    startWipe(L, 'act', 3, { motion: false });
    ok(L.nodes.every((n) => !n.removed && n.a > 0), 'static veil starts visible');
    const before = L.nodes.map((n) => `${n.tag}@${n.x},${n.y},${n.w},${n.h},${n.a}`).join('|');
    ok(before.includes(String(CURTAIN_STATIC_A)), 'static veil holds the dark curtain alpha');
    drive(300);
    const after = L.nodes.map((n) => `${n.tag}@${n.x},${n.y},${n.w},${n.h},${n.a}`).join('|');
    ok(before === after, 'static variant NEVER moves or flickers');
    ok(L.rootAlphas.every((a) => a === 1), 'static variant never fades mid-life');
    drive(WIPE_MS + 60);
    ok(L.nodes.every((n) => n.removed) && L.disposed, 'static variant still auto-cleans');
  }

  /* ---- 5. sanctuary light wash: gentle, pale blue, <= 600 ms ---- */
  {
    const L = createMemoryWipeLayer();
    const h = startWipe(L, 'sanctuary', 0, { motion: true });
    ok(L.byTag(`rect:${SANCTUARY_BLUE}`).length === 1, 'one pale-blue wash node');
    ok(L.nodes.length === 1, 'wash carries no sweep dressing');
    let peak = 0;
    for (let i = 0; i < 24; i++) {
      drive(SANCTUARY_MS / 24);
      const v = L.byTag(`rect:${SANCTUARY_BLUE}`)[0];
      if (v != null && v.a > peak) peak = v.a;
    }
    ok(peak <= 0.25 && peak > 0.1, `gentle envelope peaks low (${peak.toFixed(3)})`);
    drive(SANCTUARY_MS + 60);
    ok(h.done, 'wash completes inside its budget');
    ok(L.nodes.every((n) => n.removed) && L.disposed, 'wash cleans up fully');
    const again = createMemoryWipeLayer();
    const h2 = startWipe(again, 'sanctuary', 0, { motion: true });
    const h3 = startWipe(again, 'sanctuary', 0, { motion: true });
    ok(h2 === h3, 'sanctuary wash also single-flight per layer');
    h2.destroy();
    ok(again.nodes.every((n) => n.removed) && again.disposed, 'destroy() forces identical teardown');
  }

  /* ---- 6. determinism: same inputs -> byte-identical trajectory ---- */
  {
    const sample = (): string => {
      const L = createMemoryWipeLayer();
      startWipe(L, 'act', 2, { motion: true });
      const frames: string[] = [];
      for (let i = 0; i < 10; i++) {
        drive(60);
        frames.push(L.nodes.map((n) => `${n.tag}@${Math.round(n.x)},${Math.round(n.w)},${n.a.toFixed(3)}`).join(';'));
      }
      drive(WIPE_MS);
      return frames.join('\n');
    };
    ok(sample() === sample(), 'same toAct/clock produce byte-identical trajectories');
  }

  /* ---- 7. leak probe: 60 interleaved wipes + washes, shared clock ---- */
  {
    const layers: MemoryWipeLayer[] = [];
    let created = 0;
    for (let c = 0; c < 60; c++) {
      const L = createMemoryWipeLayer();
      layers.push(L);
      if (c % 3 === 2) startWipe(L, 'sanctuary', 0, { motion: c % 4 !== 0 });
      else startWipe(L, 'act', c % 4, { motion: c % 5 !== 0 });
      created += L.nodes.length;
      drive(85); // interleave: several overlaps live at once
    }
    drive(WIPE_MS + 100); // drain everything still live
    const removed = layers.reduce((sum, L) => sum + L.nodes.filter((n) => n.removed).length, 0);
    ok(activeWipes() === 0, `no leaks over 60 cycles (${activeWipes()} still active)`);
    ok(removed === created, `every created node was removed over 60 cycles (${created - removed} orphaned)`);
    ok(layers.every((L) => L.disposed), 'every layer disposed itself');
  }

  /* ---- 8. rails: budgets are compile-time honest ---- */
  ok(WIPE_MS === SWEEP_MS + HOLD_MS + FADE_MS, 'wipe phases sum exactly to the 600 ms rail');
  ok(SANCTUARY_MS <= WIPE_MS, 'sanctuary wash stays under the wipe rail');

  return { ok: failures.length === 0, failures };
}

if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/actwipe.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] ACT-WIPE OK' : `[selftest] ACT-WIPE FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
