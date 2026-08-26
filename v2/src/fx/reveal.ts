/* ============================================================================
 * fx/reveal.ts — V2 REVEAL JUICE (port of the v1 engine's answer-reveal beat)
 * ----------------------------------------------------------------------------
 * One call, `playReveal(parent, kind, streak, opts)`, layers the full verdict
 * feedback over the game frame:
 *
 *   correct    -> green wash flash + streak flame ticks (streak >= 3)
 *                 + 'COMBO xN' floating text
 *   wrong      -> red wash + decaying screen shake + 'crack' sfx hook
 *   impossible -> purple shimmer wash (nobody-wins ladder), 'shimmer' sfx hook
 *   milestone  -> every 5th streak: screen-edge ember burst (motion-gated)
 *   always     -> floating score text ('+240', rises & fades over exactly 1 s)
 *
 * RAILS (DNA.md):
 *   - Flashes <= 200 ms, <= 3 Hz; one reveal per round so frequency is safe.
 *   - Motion-gated behind IQB_MOTION / prefers-reduced-motion: static variant
 *     shows the same information (wash at fixed alpha, pinned embers, no
 *     shake, no rise/flicker) with identical cleanup.
 *   - Never recolors or animates question/answer glyphs — everything lives in
 *     an own overlay container removed on finish (auto-cleanup guaranteed).
 *   - Text >= 11 px. Sfx are HOOKS ONLY (`opts.sfx`) — audio/ owns real sound.
 *
 * DETERMINISM: zero Math.random / Date.now. Scatter derives from an own
 * mulberry32 seeded from opts.seed ^ kind ^ streak in FIXED DRAW ORDER.
 *
 * TESTABILITY: the effect core is layer-agnostic (`startReveal` over a tiny
 * FxLayer interface). The Pixi adapter is a thin shell; selfTest() drives a
 * memory stub with a manual clock — no renderer needed.
 * ==========================================================================*/
import { Container, Graphics, Sprite, Text, Texture, Ticker } from 'pixi.js';
import { T, STAGE_W, STAGE_H } from '../theme.ts';
import { mulberry32 } from '../scenes/takeovers/redlight.ts';

export type RevealKind = 'correct' | 'wrong' | 'impossible';

export interface RevealOpts {
  /** Floating score value ('+N'). 0/undefined hides it. */
  points?: number;
  /** Stage-space anchor for floating texts (default: board center). */
  x?: number;
  y?: number;
  /** Deterministic scatter seed (default: derived from streak). */
  seed?: number;
  /** Sfx hooks — audio/ owns the real sounds. */
  sfx?: (name: 'sting' | 'crack' | 'shimmer') => void;
  /** Container jittered on 'wrong' (default: only the fx overlay moves). */
  shakeTarget?: Container;
  /** Override the motion gate (selftests). */
  motion?: boolean;
}

/** Result handle: poll `done`, or force-cleanup early with `destroy()`. */
export interface RevealHandle {
  readonly done: boolean;
  destroy(): void;
}

/* ------------------------------------------------------------------ */
/* layer abstraction                                                   */
/* ------------------------------------------------------------------ */

export interface FxNode {
  move(x: number, y: number): void;
  alpha(a: number): void;
  remove(): void;
}

export interface FxLayer {
  /** Full-stage tinted rect anchored at (0,0). */
  wash(color: number): FxNode;
  label(str: string, size: number, color: string, x: number, y: number): FxNode;
  ember(x: number, y: number, r: number, color: number): FxNode;
  flame(x: number, y: number, h: number, color: number): FxNode;
  /** Positional shake offset applied to the layer root (+ shake target). */
  offset(x: number, y: number): void;
  /** Called exactly once when the effect finishes — fully detaches the layer. */
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* timing constants                                                    */
/* ------------------------------------------------------------------ */

const FLASH_MS = 180;      // wash flash — hard rail <= 200 ms
const SHAKE_MS = 240;      // wrong-answer shake decay
const EMBER_MS = 700;      // milestone burst lifetime
const TEXT_MS = 1000;      // floating score text — spec: rising/fading 1 s
const COMBO_MS = 900;      // COMBO xN / flame tick lifetime
const EMBERS = 16;         // dots on the milestone perimeter ring

const WASH_COLOR: Record<RevealKind, number> = {
  correct: 0x00e68a,
  wrong: 0xff2038,
  impossible: 0xa78bfa,
};
const KIND_SALT: Record<RevealKind, number> = { correct: 245521, wrong: 47829, impossible: 733891 };
const FLAME_COLOR = 0xff7a1a;
const EMBER_COLOR = 0xffb01e;

/* ------------------------------------------------------------------ */
/* motion gate                                                         */
/* ------------------------------------------------------------------ */

/** IQB_MOTION === '0' or prefers-reduced-motion -> static variant. */
export function revealMotionEnabled(): boolean {
  const g = globalThis as unknown as {
    IQB_MOTION?: string;
    localStorage?: { getItem(k: string): string | null };
    matchMedia?: (q: string) => { matches: boolean };
  };
  if (g.IQB_MOTION === '0') return false;
  try {
    if (g.localStorage && g.localStorage.getItem('IQB_MOTION') === '0') return false;
  } catch { /* opaque storage */ }
  try {
    if (g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  } catch { /* opaque media query */ }
  return true;
}

/* ------------------------------------------------------------------ */
/* effect core (layer-agnostic, manually clocked)                      */
/* ------------------------------------------------------------------ */

interface Step {
  node: FxNode;
  age: number;
  life: number;
  step(t01: number, ageMs: number): void;
}

interface Shake {
  ampPx: number;
}

interface ActiveFx {
  steps: Step[];
  age: number;
  life: number;              // max of all step lives
  shake: Shake | null;
  layer: FxLayer;
  tornDown: boolean;
  done: boolean;
}

const active: ActiveFx[] = [];
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

function teardown(fx: ActiveFx): void {
  if (fx.tornDown) return;
  fx.tornDown = true;
  fx.layer.offset(0, 0);
  for (const s of fx.steps) s.node.remove();
  fx.layer.dispose();
}

/** Advance every live reveal by dtMs (driven by the shared ticker in play,
 *  by selftests directly). Exposed for tests as __driveReveals(). */
export function drive(dtMs: number): void {
  for (const fx of active) {
    fx.age += dtMs;
    if (fx.shake != null) {
      const st = Math.min(1, fx.age / SHAKE_MS);
      if (st < 1) {
        const amp = fx.shake.ampPx * (1 - st);
        fx.layer.offset(Math.sin(fx.age / 28) * amp, Math.cos(fx.age / 23) * amp * 0.6);
      } else {
        fx.shake = null; // decay finished — restore, never shake again
        fx.layer.offset(0, 0);
      }
    }
    for (const s of fx.steps) {
      if (s.age >= s.life) continue;
      s.age += dtMs;
      s.step(Math.min(1, s.age / s.life), s.age);
      if (s.age >= s.life) s.node.remove();
    }
    if (!fx.done && fx.age >= fx.life) {
      fx.done = true;
      teardown(fx);
    }
  }
  for (let i = active.length - 1; i >= 0; i--) {
    if (active[i].done) active.splice(i, 1);
  }
  unbindIfIdle();
}

/** Number of reveals still animating (leak probe for selfTest). */
export function activeReveals(): number {
  return active.length;
}

/** Core scheduler. Layers the verdict effect onto any FxLayer. */
export function startReveal(layer: FxLayer, kind: RevealKind, streak: number,
  opts: RevealOpts = {}): RevealHandle {
  const motion = opts.motion ?? revealMotionEnabled();
  const rng = mulberry32(((opts.seed ?? 0) ^ (streak * 2654435761) ^ KIND_SALT[kind]) >>> 0);
  const ax = opts.x ?? STAGE_W / 2;
  const ay = opts.y ?? STAGE_H * 0.42;
  const steps: Step[] = [];
  let shakeAmpPx = 0;

  const add = (node: FxNode, life: number, stepFn: (t01: number, ageMs: number) => void): void => {
    steps.push({ node, age: 0, life, step: stepFn });
  };

  /* ---- wash flash (all kinds; <= 200 ms rail; static variant holds fixed alpha) ---- */
  const washPeak = kind === 'wrong' ? 0.16 : 0.13;
  const wash = layer.wash(WASH_COLOR[kind]);
  if (motion) {
    add(wash, FLASH_MS, (t) => wash.alpha(washPeak * (1 - t)));
  } else {
    wash.alpha(0.1);
    add(wash, FLASH_MS, () => { /* static hold, then removed */ });
  }

  /* ---- sfx hooks ---- */
  if (kind === 'correct') opts.sfx?.('sting');
  else if (kind === 'wrong') opts.sfx?.('crack');
  else opts.sfx?.('shimmer');

  /* ---- correct + hot streak: flame ticks + COMBO xN floating text ---- */
  if (kind === 'correct' && streak >= 3) {
    const n = Math.min(streak, 8);
    const rowW = n * 22;
    for (let i = 0; i < n; i++) {
      // fixed draw order scatter: x jitter, y jitter, height, flicker phase
      const jx = rng() * 6 - 3;
      const jy = rng() * 4;
      const h = 12 + rng() * 6;
      const f = layer.flame(ax - rowW / 2 + 11 + i * 22 + jx, ay - 46 + jy, h, FLAME_COLOR);
      if (motion) {
        const phase = rng() * Math.PI * 2;
        add(f, COMBO_MS, (_t, ageMs) => {
          f.alpha(ageMs < 600 ? 0.85 + 0.15 * Math.sin(ageMs / 60 + phase)
            : Math.max(0, 0.85 * (1 - (ageMs - 600) / 300)));
        });
      } else {
        f.alpha(0.8);
        add(f, COMBO_MS, () => { /* static hold */ });
      }
    }
    const combo = layer.label(`COMBO x${streak}`, 26, '#ffb01e', ax, ay - 78);
    if (motion) {
      add(combo, COMBO_MS, (t) => {
        combo.move(ax, ay - 78 - 18 * t);
        combo.alpha(t < 0.55 ? 1 : Math.max(0, 1 - (t - 0.55) / 0.45));
      });
    } else {
      combo.alpha(1);
      add(combo, COMBO_MS, () => { /* static hold */ });
    }
  }

  /* ---- wrong: decaying shake (reduced motion: none, rules identical) ---- */
  if (kind === 'wrong' && motion) shakeAmpPx = 10;

  /* ---- impossible: purple shimmer only — nothing extra ---- */

  /* ---- milestone every 5: screen-edge ember burst ---- */
  if (streak > 0 && streak % 5 === 0) {
    for (let i = 0; i < EMBERS; i++) {
      // fixed draw order: edge pick -> position along edge -> radius
      const edge = i % 4;
      const along = rng();
      const r = 2 + rng() * 2.5;
      let ex: number;
      let ey: number;
      if (edge === 0) { ex = along * STAGE_W; ey = 0; }
      else if (edge === 1) { ex = STAGE_W; ey = along * STAGE_H; }
      else if (edge === 2) { ex = along * STAGE_W; ey = STAGE_H; }
      else { ex = 0; ey = along * STAGE_H; }
      const vx = (STAGE_W / 2 - ex) * 0.0006;
      const vy = (ay - ey) * 0.0006 - 0.05;
      const e = layer.ember(ex, ey, r, EMBER_COLOR);
      if (motion) {
        add(e, EMBER_MS, (_t, ageMs) => {
          e.move(ex + vx * ageMs, ey + vy * ageMs);
          e.alpha(0.9 * (1 - ageMs / EMBER_MS));
        });
      } else {
        e.alpha(0.5); // static variant: pinned perimeter ring, brief hold
        add(e, FLASH_MS, () => { /* static hold */ });
      }
    }
  }

  /* ---- floating score text ('+240', rises & fades over exactly 1 s) ---- */
  const points = Math.round(opts.points ?? 0);
  if (points > 0) {
    const sc = layer.label(`+${points}`, 30, kind === 'correct' ? '#00e68a' : '#f5f8ff', ax, ay);
    if (motion) {
      add(sc, TEXT_MS, (t) => {
        sc.move(ax, ay - 34 * t);
        sc.alpha(t < 0.08 ? t / 0.08 : Math.max(0, 1 - (t - 0.08) / 0.92));
      });
    } else {
      sc.alpha(1);
      add(sc, TEXT_MS, () => { /* static hold */ });
    }
  }

  const life = steps.reduce((m, s) => Math.max(m, s.life), 0);
  const fx: ActiveFx = { steps, age: 0, life, shake: shakeAmpPx > 0 ? { ampPx: shakeAmpPx } : null, layer, tornDown: false, done: false };
  active.push(fx);

  ensureTicker();
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
/* Pixi adapter                                                        */
/* ------------------------------------------------------------------ */

class PixiLayer implements FxLayer {
  private root: Container;
  private parent: Container;
  private targetBase: { x: number; y: number } | null = null;
  private target: Container | null;
  private dead = false;

  constructor(parent: Container, shakeTarget?: Container) {
    this.parent = parent;
    this.target = shakeTarget ?? null;
    this.root = new Container();
    parent.addChild(this.root);
  }

  wash(color: number): FxNode {
    const s = new Sprite(Texture.WHITE);
    s.width = STAGE_W;
    s.height = STAGE_H;
    s.tint = color;
    s.alpha = 0;
    this.root.addChild(s);
    return this.node(s);
  }

  label(str: string, size: number, color: string, x: number, y: number): FxNode {
    const t = new Text({
      text: str,
      style: { fontFamily: T.font, fontSize: size, fill: color, fontWeight: '800', letterSpacing: 2 },
    });
    t.anchor.set(0.5);
    t.x = x;
    t.y = y;
    this.root.addChild(t);
    return this.node(t);
  }

  ember(x: number, y: number, r: number, color: number): FxNode {
    const g = new Graphics();
    g.circle(0, 0, r).fill(color);
    g.x = x;
    g.y = y;
    this.root.addChild(g);
    return this.node(g);
  }

  flame(x: number, y: number, h: number, color: number): FxNode {
    const g = new Graphics();
    g.moveTo(-h * 0.3, 0)
      .quadraticCurveTo(-h * 0.05, -h * 0.6, 0, -h)
      .quadraticCurveTo(h * 0.3, -h * 0.5, h * 0.3, 0)
      .closePath()
      .fill(color);
    g.x = x;
    g.y = y;
    this.root.addChild(g);
    return this.node(g);
  }

  offset(x: number, y: number): void {
    this.root.x = x;
    this.root.y = y;
    if (this.target != null) {
      if (this.targetBase == null) this.targetBase = { x: this.target.x, y: this.target.y };
      this.target.x = this.targetBase.x + x;
      this.target.y = this.targetBase.y + y;
    }
  }

  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    if (this.target != null && this.targetBase != null) {
      this.target.x = this.targetBase.x;
      this.target.y = this.targetBase.y;
    }
    this.root.removeChildren();
    this.parent.removeChild(this.root);
  }

  private node(d: { x: number; y: number; alpha: number; destroy(opts?: { texture?: boolean }): void; parent: Container | null }): FxNode {
    return {
      move: (nx, ny) => { d.x = nx; d.y = ny; },
      alpha: (a) => { d.alpha = a; },
      remove: () => {
        if (d.parent) (d.parent as unknown as { removeChild(c: unknown): void }).removeChild(d);
        d.destroy();
      },
    };
  }
}

/**
 * Play the full reveal-juice stack over `parent` (the game scene container).
 * Auto-cleans: when the last animation ages out, the overlay detaches itself;
 * `destroy()` forces the same teardown immediately. Main wires this after the
 * existing wash in scenes/game.ts — it is a strict superset of that beat.
 */
export function playReveal(parent: Container, kind: RevealKind, streak: number,
  opts: RevealOpts = {}): RevealHandle {
  const layer = new PixiLayer(parent, opts.shakeTarget);
  return startReveal(layer, kind, streak, opts);
}

/* ------------------------------------------------------------------ */
/* selftest — memory-stub layer, manual clock, leak probe              */
/* ------------------------------------------------------------------ */

export interface MemoryNode extends FxNode {
  tag: string;
  x: number;
  y: number;
  a: number;
  removed: boolean;
}

export interface MemoryLayer extends FxLayer {
  nodes: MemoryNode[];
  offsets: Array<{ x: number; y: number }>;
  disposed: boolean;
  byTag(tag: string): MemoryNode[];
}

export function createMemoryLayer(seedTag = ''): MemoryLayer {
  const nodes: MemoryNode[] = [];
  const offsets: Array<{ x: number; y: number }> = [];
  let disposed = false;
  const mk = (tag: string, x: number, y: number): MemoryNode => {
    const n: MemoryNode = { tag, x, y, a: 0, removed: false, move(px, py) { n.x = px; n.y = py; }, alpha(a) { n.a = a; }, remove() { n.removed = true; } };
    nodes.push(n);
    return n;
  };
  const layer: MemoryLayer = {
    nodes,
    offsets,
    get disposed(): boolean { return disposed; },
    wash(color: number): FxNode { return mk(`wash:${color}`, 0, 0); },
    label(str: string, size: number, color: string, x: number, y: number): FxNode {
      return mk(`label:${str}:${size}:${color}`, x, y);
    },
    ember(x: number, y: number, r: number, color: number): FxNode { return mk(`ember:${color}:${r}`, x, y); },
    flame(x: number, y: number, h: number, color: number): FxNode { return mk(`flame:${h}`, x, y); },
    offset(x: number, y: number): void { offsets.push({ x, y }); },
    dispose(): void { disposed = true; },
    byTag(tag: string): MemoryNode[] { return nodes.filter((n) => n.tag.startsWith(tag)); },
  };
  void seedTag;
  return layer;
}

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const ok = (cond: boolean, msg: string): void => { if (!cond) failures.push(msg); };

  /* ---- 1. correct + streak flames + combo + score text ---- */
  {
    const L = createMemoryLayer();
    let sfxName = '';
    const h = startReveal(L, 'correct', 4, { points: 240, seed: 7, motion: true, sfx: (n) => { sfxName = n; } });
    ok(sfxName === 'sting', `correct should hook 'sting', got '${sfxName}'`);
    ok(L.byTag('wash').length === 1, 'one green wash');
    ok(L.byTag('flame:').length === 4, `streak 4 -> 4 flame ticks, got ${L.byTag('flame:').length}`);
    ok(L.byTag('label:COMBO x4').length === 1, 'COMBO x4 label present');
    ok(L.byTag('label:+240').length === 1, '+240 score text present');
    ok(L.byTag('ember:').length === 0, 'streak 4 is not a milestone');
    drive(TEXT_MS + 50);
    ok(h.done, 'handle reports done after max lifetime');
    ok(L.nodes.every((n) => n.removed), 'cleanup removed ALL children');
    ok(L.disposed, 'layer disposed');
    ok(activeReveals() === 0, 'no active reveals left');
  }

  /* ---- 2. wrong: crack hook + shake then restore ---- */
  {
    const L = createMemoryLayer();
    let sfxName = '';
    startReveal(L, 'wrong', 0, { seed: 11, motion: true, sfx: (n) => { sfxName = n; } });
    ok(sfxName === 'crack', `wrong should hook 'crack', got '${sfxName}'`);
    drive(60);
    const moved = L.offsets.some((o) => o.x !== 0 || o.y !== 0);
    ok(moved, 'shake produces non-zero offsets mid-decay');
    drive(SHAKE_MS);
    const last = L.offsets[L.offsets.length - 1];
    ok(last != null && last.x === 0 && last.y === 0, 'shake restores origin after decay');
    ok(L.byTag('flame:').length === 0 && L.byTag('label:COMBO').length === 0, 'wrong carries no combo dressing');
    drive(TEXT_MS + 50);
    ok(L.nodes.every((n) => n.removed) && L.disposed, 'wrong cleans up fully');
  }

  /* ---- 3. impossible: purple shimmer ---- */
  {
    const L = createMemoryLayer();
    let sfxName = '';
    startReveal(L, 'impossible', 9, { seed: 3, motion: true, sfx: (n) => { sfxName = n; } });
    ok(sfxName === 'shimmer', `impossible should hook 'shimmer', got '${sfxName}'`);
    const washes = L.byTag('wash:');
    ok(washes.length === 1 && washes[0] !== undefined && washes[0].tag === `wash:${WASH_COLOR.impossible}`,
      'purple shimmer wash present');
    drive(TEXT_MS + 50);
    ok(L.nodes.every((n) => n.removed), 'impossible cleans up');
  }

  /* ---- 4. milestone every 5: ember burst ---- */
  {
    const L = createMemoryLayer();
    startReveal(L, 'correct', 5, { points: 320, seed: 42, motion: true });
    ok(L.byTag('ember:').length === EMBERS, `milestone spawns ${EMBERS} embers, got ${L.byTag('ember:').length}`);
    const first = L.byTag('ember:')[0];
    const x0 = first != null ? first.x : -1;
    drive(200);
    const x1 = first != null ? first.x : -1;
    ok(x1 !== x0, 'embers animate inward under motion');
    drive(TEXT_MS + 50); // score text outlives the burst — full reveal drains at 1 s
    ok(activeReveals() === 0, 'milestone reveal finishes');
  }

  /* ---- 5. motion gate: static variant exists, identical cleanup ---- */
  {
    const L = createMemoryLayer();
    startReveal(L, 'wrong', 5, { points: 100, seed: 5, motion: false });
    ok(L.nodes.every((n) => n.removed === false), 'static variant starts visible');
    const before = L.byTag('ember:').map((n) => `${n.x},${n.y}`).join('|');
    drive(400);
    ok(L.offsets.every((o) => o.x === 0 && o.y === 0), 'reduced motion NEVER shakes');
    const after = L.byTag('ember:').map((n) => `${n.x},${n.y}`).join('|');
    ok(before === after, 'static embers stay pinned');
    drive(TEXT_MS + 50);
    ok(L.nodes.every((n) => n.removed) && L.disposed, 'static variant still auto-cleans');
    ok(revealMotionEnabled() === true || revealMotionEnabled() === false, 'gate export exists');
  }
  /* ---- 6. determinism: same seed/kind/streak -> identical node set ---- */
  {
    const A = createMemoryLayer();
    const B = createMemoryLayer();
    startReveal(A, 'correct', 7, { points: 99, seed: 1234, motion: true });
    startReveal(B, 'correct', 7, { points: 99, seed: 1234, motion: true });
    const sig = (M: MemoryLayer): string => M.nodes.map((n) => `${n.tag}@${Math.round(n.x)},${Math.round(n.y)}`).join(';');
    ok(sig(A) === sig(B), 'same inputs produce byte-identical layouts');
    drive(TEXT_MS + 50);
  }
  /* ---- 7. leak probe: 100 mixed cycles, interleaved clock ---- */
  {
    const kinds: RevealKind[] = ['correct', 'wrong', 'impossible'];
    const layers: MemoryLayer[] = [];
    let created = 0;
    for (let c = 0; c < 100; c++) {
      const L = createMemoryLayer();
      layers.push(L);
      startReveal(L, kinds[c % 3], (c % 11) + 1, { points: 40 + c, seed: c * 7919, motion: c % 4 !== 0 });
      created += L.nodes.length;
      drive(90); // interleave: several overlaps live at once
    }
    drive(TEXT_MS + SHAKE_MS + 100); // drain everything still live
    const removed = layers.reduce((sum, L) => sum + L.nodes.filter((n) => n.removed).length, 0);
    ok(activeReveals() === 0, `no leaks over 100 cycles (${activeReveals()} still active)`);
    ok(removed === created, `every created node was removed over 100 cycles (${created - removed} orphaned)`);
    ok(layers.every((L) => L.disposed), 'every layer disposed itself');
  }

  return { ok: failures.length === 0, failures };
}

if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/reveal.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] REVEAL-FX OK' : `[selftest] REVEAL-FX FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
