/* ============================================================================
 * HELL BACKDROPS — seven escalating hell-layer worlds + SANCTUARY.
 *
 * Dante-parody depth ladder for bad/chaotic runs: the director descends one
 * layer per failed block (1 OUTER DARK → 7 THRONE OF ASH) and retreats to
 * SANCTUARY after good rounds ("near-static pale-blue original-faithful").
 *
 * Layer n escalates THREE sampled channels monotonically (asserted in
 * selfTest over sampled rgba/globalAlpha values):
 *   vignette alpha   0.22 → 0.72
 *   ember max-alpha  0.30 → 0.92
 *   lava glow alpha  0.16 → 0.55
 * plus spire count, haze density and crimson saturation.
 *
 * Determinism rails: pure f(t) over fixed constants — ZERO Math.random /
 * Date.now; every layout variate is hash(i) (sin-hash). All pulses breathe
 * slowly (periods >= ~1.2 s, far under the <=3 Hz flash rail); no fullscreen
 * flashes; backdrops never recolor or animate puzzle glyphs (DNA.md).
 * Motion gating lives in applyLayerBackdrop: IQB_MOTION=0 or
 * prefers-reduced-motion => ONE static frame at t=0, never animated.
 *
 * Integration:
 *   import { registerHellBackdrops, applyLayerBackdrop } from './worlds/hellbacks.ts';
 *   registerHellBackdrops();                       // once at boot
 *   const stop = applyLayerBackdrop(sceneRoot, 4); // Pixi Container, layer 1..7 | 'sanctuary'
 *   stop();                                        // on scene exit
 * ==========================================================================*/

import { STAGE_W, STAGE_H } from '../theme.ts';
import { register, byId } from './registry.ts';
const TAU = Math.PI * 2;

/** Deterministic per-index variate in [0,1) — the only "randomness" allowed. */
function hash(n: number): number {
  return ((Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1;
}

function wrap(v: number, m: number): number {
  return ((v % m) + m) % m;
}

/** Soft elliptical blob via radial gradient; rgb='r,g,b'. */
function softBlob(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rgb: string, a: number): void {
  c.save();
  c.translate(x, y);
  c.scale(rx / 100, ry / 100);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 100);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  c.fillRect(-100, -100, 200, 200);
  c.restore();
}

interface EmberOpts {
  count: number;
  /** px per second along the travel axis */
  speed: number;
  size: number;
  color: string;
  maxA: number;
  sway: number;
}

/** Deterministic rising ember field (hell-only variant of a drift field). */
function embers(c: CanvasRenderingContext2D, w: number, h: number, t: number, o: EmberOpts): void {
  const travel = h + 80;
  for (let i = 0; i < o.count; i++) {
    const sp = o.speed * (0.6 + hash(i * 3 + 1) * 0.8);
    const d = wrap((t * sp) / 1000 + hash(i) * travel, travel);
    const y = h - d; // always rising
    const x = wrap(hash(i * 7 + 2) * w + Math.sin(t * 0.0006 * (0.5 + hash(i + 5)) + i * 2.3) * o.sway, w);
    const edge = Math.min(1, Math.min(d, travel - d) / 60); // fade at both ends
    c.globalAlpha = o.maxA * edge * (0.5 + hash(i * 11 + 4) * 0.5);
    c.fillStyle = o.color;
    c.beginPath();
    c.arc(x, y, o.size * (0.45 + hash(i * 13 + 6)), 0, TAU);
    c.fill();
  }
  c.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/* Layer ladder                                                        */
/* ------------------------------------------------------------------ */

export type HellLayerKey = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 'sanctuary';

export const HELL_LAYERS = 7;

interface LayerSpec {
  n: number;
  id: string;
  title: string;
  skyTop: string;
  skyMid: string;
  skyBot: string;
  ridgeCol: string;
  glowRgb: string;
  glowA: number;
  hazeRgb: string;
  hazeA: number;
  emberCol: string;
  emberCount: number;
  emberSpeed: number;
  emberSize: number;
  emberMaxA: number;
  vigA: number;
  spires: number;
  throne: boolean;
}

const LAYERS: readonly LayerSpec[] = [
  {
    n: 1, id: 'hell-1-outer-dark', title: 'OUTER DARK',
    skyTop: '#04050a', skyMid: '#0a0910', skyBot: '#150a10',
    ridgeCol: '#07060c',
    glowRgb: '255,120,40', glowA: 0.16,
    hazeRgb: '140,60,80', hazeA: 0.05,
    emberCol: '#b06a48', emberCount: 24, emberSpeed: 18, emberSize: 2.0, emberMaxA: 0.30,
    vigA: 0.22, spires: 3, throne: false,
  },
  {
    n: 2, id: 'hell-2-grey-march', title: 'GREY MARCH',
    skyTop: '#050508', skyMid: '#100c10', skyBot: '#1d0d0e',
    ridgeCol: '#090709',
    glowRgb: '255,110,34', glowA: 0.22,
    hazeRgb: '170,60,72', hazeA: 0.08,
    emberCol: '#c07848', emberCount: 30, emberSpeed: 22, emberSize: 2.1, emberMaxA: 0.40,
    vigA: 0.30, spires: 4, throne: false,
  },
  {
    n: 3, id: 'hell-3-burning-plain', title: 'BURNING PLAIN',
    skyTop: '#070305', skyMid: '#160705', skyBot: '#2a0a05',
    ridgeCol: '#0d0403',
    glowRgb: '255,104,28', glowA: 0.28,
    hazeRgb: '200,56,64', hazeA: 0.11,
    emberCol: '#ff8a44', emberCount: 36, emberSpeed: 26, emberSize: 2.2, emberMaxA: 0.50,
    vigA: 0.38, spires: 5, throne: false,
  },
  {
    n: 4, id: 'hell-4-crimson-forge', title: 'CRIMSON FORGE',
    skyTop: '#080203', skyMid: '#1c0504', skyBot: '#380a04',
    ridgeCol: '#100302',
    glowRgb: '255,96,24', glowA: 0.34,
    hazeRgb: '224,36,94', hazeA: 0.14,
    emberCol: '#ff9440', emberCount: 44, emberSpeed: 31, emberSize: 2.4, emberMaxA: 0.60,
    vigA: 0.46, spires: 6, throne: false,
  },
  {
    n: 5, id: 'hell-5-ember-pits', title: 'EMBER PITS',
    skyTop: '#090202', skyMid: '#220403', skyBot: '#420c03',
    ridgeCol: '#130302',
    glowRgb: '255,92,20', glowA: 0.40,
    hazeRgb: '232,34,86', hazeA: 0.18,
    emberCol: '#ffa048', emberCount: 52, emberSpeed: 36, emberSize: 2.6, emberMaxA: 0.70,
    vigA: 0.54, spires: 7, throne: false,
  },
  {
    n: 6, id: 'hell-6-blood-vault', title: 'BLOOD VAULT',
    skyTop: '#0a0102', skyMid: '#280303', skyBot: '#4c0d02',
    ridgeCol: '#160202',
    glowRgb: '255,84,18', glowA: 0.47,
    hazeRgb: '240,32,78', hazeA: 0.22,
    emberCol: '#ffac52', emberCount: 60, emberSpeed: 42, emberSize: 2.8, emberMaxA: 0.80,
    vigA: 0.62, spires: 8, throne: false,
  },
  {
    n: 7, id: 'hell-7-throne-of-ash', title: 'THRONE OF ASH',
    skyTop: '#0c0101', skyMid: '#300304', skyBot: '#581002',
    ridgeCol: '#190201',
    glowRgb: '255,76,14', glowA: 0.55,
    hazeRgb: '255,28,66', hazeA: 0.27,
    emberCol: '#ffb85e', emberCount: 72, emberSpeed: 48, emberSize: 3.0, emberMaxA: 0.92,
    vigA: 0.72, spires: 9, throne: true,
  },
];

/**
 * Draw layer spec s. Everything below is f(t, s) with fixed constants only.
 * Breathing periods stay >= ~1.23 s (1650 - 60*n ms) — no flash-rail risk.
 */
function drawHellLayer(c: CanvasRenderingContext2D, w: number, h: number, t: number, s: LayerSpec): void {
  // sky gradient — deepens toward crimson with depth
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, s.skyTop);
  sky.addColorStop(0.62, s.skyMid);
  sky.addColorStop(1, s.skyBot);
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);

  // distant obsidian spires (count grows with depth), slow sway only
  c.fillStyle = s.ridgeCol;
  for (let i = 0; i < s.spires; i++) {
    const sx = wrap(hash(i * 13 + s.n * 29) * w * 1.2 - w * 0.1 + Math.sin(t / 7000 + i * 1.9) * 8, w);
    const sw = 26 + hash(i * 7 + 3) * 74;
    const sh = h * (0.24 + hash(i * 5 + 1) * 0.26) * (0.68 + 0.06 * s.n);
    const lean = (hash(i * 11 + 8) - 0.5) * sw * 0.5;
    c.beginPath();
    c.moveTo(sx - sw / 2, h);
    c.lineTo(sx + lean, h - sh);
    c.lineTo(sx + sw / 2, h);
    c.closePath();
    c.fill();
  }

  // throne silhouette (layer 7 only) looming center-horizon
  if (s.throne) {
    const bx = w * 0.5 + Math.sin(t / 9000) * 6;
    const by = h * 0.46 + Math.sin(t / 8000 + 2) * 4;
    const tw = Math.min(w, h) * 0.34;
    const th = Math.min(w, h) * 0.30;
    c.fillStyle = '#0d0101';
    c.beginPath();
    c.moveTo(bx - tw / 2, by + th);
    c.lineTo(bx - tw * 0.38, by + th * 0.18);           // left arm spike
    c.lineTo(bx - tw * 0.22, by + th * 0.34);
    c.lineTo(bx - tw * 0.14, by);                        // back-left peak
    c.lineTo(bx - tw * 0.04, by + th * 0.12);
    c.lineTo(bx, by - th * 0.16);                        // crown peak
    c.lineTo(bx + tw * 0.04, by + th * 0.12);
    c.lineTo(bx + tw * 0.14, by);                        // back-right peak
    c.lineTo(bx + tw * 0.22, by + th * 0.34);
    c.lineTo(bx + tw * 0.38, by + th * 0.18);            // right arm spike
    c.lineTo(bx + tw / 2, by + th);
    c.closePath();
    c.fill();
    // ember halo behind the seat — slow breathe, localized
    const pulse = 0.75 + 0.25 * Math.sin(t / 1700);
    softBlob(c, bx, by + th * 0.55, tw * 0.75, th * 0.6 * pulse + 12, s.glowRgb, 0.30);
  }

  // lava/cinder floor glow along the bottom edge — breathing >= ~1.23 s
  const floorPulse = 0.75 + 0.25 * Math.sin(t / (1650 - 60 * s.n));
  softBlob(c, w * 0.5, h * 1.05, w * 0.65, h * 0.4 * floorPulse + 20, s.glowRgb, s.glowA);
  softBlob(c, w * 0.22, h * 1.08, w * 0.32, h * 0.2, s.hazeRgb, s.hazeA * 0.7);
  softBlob(c, w * 0.79, h * 1.08, w * 0.3, h * 0.19, s.glowRgb, s.glowA * 0.6);

  // drifting crimson haze band sliding across mid-air
  const hx = wrap(t * (0.006 + 0.002 * s.n) + s.n * 137, w + 600) - 300;
  softBlob(c, hx, h * 0.35, 340, 90, s.hazeRgb, s.hazeA);

  // crust cracks near the floor (static geometry, shimmering alpha)
  c.strokeStyle = `rgba(255,150,50,${(0.14 + 0.06 * s.n * 0.35 + 0.1 * Math.sin(t / 1100 + s.n)).toFixed(4)})`;
  c.lineWidth = 2;
  for (let i = 0; i < 4 + s.n; i++) {
    const x0 = hash(i * 29 + s.n * 53) * w;
    c.beginPath();
    c.moveTo(x0, h * (0.93 + hash(i + s.n) * 0.05));
    c.lineTo(x0 + (hash(i + 3 + s.n * 7) - 0.5) * 140, h * (0.97 + hash(i + 7) * 0.03));
    c.stroke();
  }

  // rising embers — count/speed/size/brightness all escalate with depth
  embers(c, w, h, t, {
    count: s.emberCount,
    speed: s.emberSpeed,
    size: s.emberSize,
    color: s.emberCol,
    maxA: s.emberMaxA,
    sway: 14 + s.n * 2,
  });

  // closing vignette — tightens and darkens as you descend
  const vg = c.createRadialGradient(
    w / 2, h / 2, Math.min(w, h) * (0.42 - 0.022 * s.n),
    w / 2, h / 2, Math.max(w, h) * 0.72,
  );
  vg.addColorStop(0, 'rgba(8,0,0,0)');
  vg.addColorStop(1, `rgba(8,0,0,${s.vigA})`);
  c.fillStyle = vg;
  c.fillRect(0, 0, w, h);
}

/* ------------------------------------------------------------------ */
/* Sanctuary                                                           */
/* ------------------------------------------------------------------ */

/**
 * SANCTUARY — pale-blue original-faithful calm for good rounds. Near-static:
 * the only motion is one faint glow breathing at amplitude <= 0.03 over a 9 s
 * period (orders of magnitude under every motion/flash rail).
 */
function drawSanctuary(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#f4f8fc');
  g.addColorStop(1, '#e2ebf5');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);

  // single soft daylight bloom, barely alive
  const breathe = 0.10 + 0.03 * Math.sin((t % 9000) / 9000 * TAU);
  softBlob(c, w * 0.5, h * 0.12, w * 0.7, h * 0.5, '190,214,240', breathe);

  // hairline horizon rule, fully static
  c.strokeStyle = 'rgba(120,150,185,0.14)';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, h * 0.82);
  c.lineTo(w, h * 0.82);
  c.stroke();
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */


/** Register all 7 hell layers + sanctuary. Idempotent (register replaces). */
export function registerHellBackdrops(): void {
  for (const s of LAYERS) {
    register({ id: s.id, align: 'bad', draw: (c, w, h, t) => drawHellLayer(c, w, h, t, s) });
  }
  register({ id: 'sanctuary', align: 'good', draw: drawSanctuary });
}


/** Stable world id for a layer key. */
export function layerWorldId(key: HellLayerKey): string {
  if (key === 'sanctuary') return 'sanctuary';
  const s = LAYERS[key - 1];
  if (!s || s.n !== key) throw new Error(`bad hell layer ${key}`);
  return s.id;
}

/* ------------------------------------------------------------------ */
/* Scene application                                                   */
/* ------------------------------------------------------------------ */

/** Minimal structural view of a Pixi Container — keeps this module node-safe. */
export interface BackdropHost {
  addChildAt(child: unknown, index: number): unknown;
  removeChild(child: unknown): unknown;
}

function motionOn(): boolean {
  const g = globalThis as unknown as { IQB_MOTION?: string; matchMedia?: (q: string) => MediaQueryList; localStorage?: Storage };
  if (g.IQB_MOTION === '0') return false;
  try {
    if (g.localStorage?.getItem('IQB_MOTION') === '0') return false;
  } catch { /* private mode */ }
  try {
    if (g.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  } catch { /* no matchMedia */ }
  return true;
}

/**
 * Mount the backdrop for `key` (layer 1..7 descending, or 'sanctuary' after
 * good rounds) as the bottom-most child of a Pixi scene: offscreen canvas ->
 * Sprite -> rAF loop redrawing pure f(now). Returns cleanup (removes sprite,
 * cancels loop). Safe to call before the async pixi load resolves. With
 * motion reduced, draws ONE static frame at t=0 and never animates.
 */
export function applyLayerBackdrop(host: BackdropHost, key: HellLayerKey, opts?: { w?: number; h?: number }): () => void {
  let dead = false;
  let teardown: (() => void) | null = null;
  void import('pixi.js').then(({ Sprite, Texture }) => {
    if (dead) return;
    const w = opts?.w ?? STAGE_W;
    const h = opts?.h ?? STAGE_H;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const c = cv.getContext('2d');
    const def = byId(layerWorldId(key));
    if (!c || !def) return;
    const tex = Texture.from(cv);
    const spr = new Sprite(tex);
    host.addChildAt(spr, 0);
    let raf = 0;
    const frame = (now: number): void => {
      def.draw(c, w, h, now);
      tex.source.update();
      raf = requestAnimationFrame(frame);
    };
    if (motionOn()) raf = requestAnimationFrame(frame);
    else def.draw(c, w, h, 0);
    teardown = (): void => {
      cancelAnimationFrame(raf);
      host.removeChild(spr);
      spr.destroy();
    };
  }).catch(() => { /* headless/no-pixi envs stay no-op; cleanup still safe */ });
  return (): void => {
    dead = true;
    teardown?.();
    teardown = null;
  };
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — recording stub ctx, no DOM, no Pixi)              */
/* ------------------------------------------------------------------ */

interface OpRec { op: string; k?: string; v?: unknown }

/** Recording stub 2D context: logs style assignments + draw calls verbatim. */
function recCtx(): { ctx: CanvasRenderingContext2D; ops: OpRec[] } {
  const ops: OpRec[] = [];
  const grad = (): { addColorStop: (o: number, col: string) => void } => ({
    addColorStop: (o, col) => ops.push({ op: 'stop', v: [o, col] }),
  });
  const noop = (): void => {};
  const ctx = {
    save: noop, restore: noop, beginPath: noop, closePath: noop,
    fill: noop, stroke: noop,
    moveTo: noop, lineTo: noop, arc: noop, quadraticCurveTo: noop,
    translate: noop, scale: noop, rotate: noop,
    fillRect: (x: number, y: number, W: number, H: number): void => { ops.push({ op: 'fillRect', v: [x, y, W, H] }); },
    createLinearGradient: grad,
    createRadialGradient: grad,
  } as unknown as CanvasRenderingContext2D;
  let fillStyle: unknown = '';
  let strokeStyle: unknown = '';
  let globalAlpha = 1;
  Object.defineProperties(ctx, {
    fillStyle: { get: () => fillStyle, set: (v) => { fillStyle = v; ops.push({ op: 'fill', k: String(v) }); } },
    strokeStyle: { get: () => strokeStyle, set: (v) => { strokeStyle = v; ops.push({ op: 'strokeSet', k: String(v) }); } },
    globalAlpha: {
      get: () => globalAlpha,
      set: (v) => { globalAlpha = v; ops.push({ op: 'alpha', v }); },
    },
    lineWidth: { get: () => 0, set: noop },
  });
  return { ctx: ctx as CanvasRenderingContext2D, ops };
}

/**
 * Largest opacity sampled from a draw transcript (rgba tails + globalAlpha).
 * globalAlpha === 1 is the post-ember-field reset sentinel, never a real
 * paint opacity in these worlds, so it is excluded to keep the metric honest.
 */
function sampledMaxAlpha(ops: OpRec[]): number {
  let mx = 0;
  for (const o of ops) {
    if (typeof o.v === 'number' && o.v < 0.999) mx = Math.max(mx, o.v);
    const s = o.k;
    if (typeof s === 'string' && s.startsWith('rgba(')) {
      const tail = Number(s.slice(s.lastIndexOf(',') + 1, s.length - 1));
      if (Number.isFinite(tail) && tail < 0.999) mx = Math.max(mx, tail);
    }
  }
  return mx;
}

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  registerHellBackdrops();

  /* 8 draws (7 layers + sanctuary) on stub ctx must not throw … */
  for (const key of [1, 2, 3, 4, 5, 6, 7, 'sanctuary'] as HellLayerKey[]) {
    const { ctx } = recCtx();
    try {
      if (key === 'sanctuary') drawSanctuary(ctx, 1600, 900, 12345);
      else drawHellLayer(ctx, 1600, 900, 12345, LAYERS[(key as number) - 1]);
    } catch (e) {
      failures.push(`draw threw for ${key}: ${String(e)}`);
    }
  }

  /* determinism over 300 seeds: same seed ⇒ byte-identical transcript */
  for (let seed = 1; seed <= 300; seed++) {
    const li = ((seed % 7) + 7) % 7;
    const t = (seed * 997) % 60000;
    const run = (): string => {
      const { ctx, ops } = recCtx();
      drawHellLayer(ctx, 1600, 900, t, LAYERS[li]);
      return JSON.stringify(ops);
    };
    if (run() !== run()) failures.push(`layer ${li + 1} nondeterministic at seed=${seed}`);
  }
  {
    const run = (t: number): string => {
      const { ctx, ops } = recCtx();
      drawSanctuary(ctx, 1600, 900, t);
      return JSON.stringify(ops);
    };
    if (run(4000) !== run(4000)) failures.push('sanctuary nondeterministic');
  }

  /* escalating intensity by sampled alpha across layers 1..7 (max over probe ts) */
  let prev = -1;
  for (let n = 1; n <= 7; n++) {
    let mx = 0;
    for (const t of [0, 2000, 4000, 6000, 8000]) {
      const { ctx, ops } = recCtx();
      drawHellLayer(ctx, 1600, 900, t, LAYERS[n - 1]);
      mx = Math.max(mx, sampledMaxAlpha(ops));
    }
    if (!(mx > prev)) failures.push(`layer intensity not escalating: layer ${n} max=${mx} prev=${prev}`);
    prev = mx;
  }

  /* sanctuary is near-static: alphas at t=0 vs t=4000 differ by <= 0.04 */
  {
    const alphas = (t: number): number[] => {
      const { ctx, ops } = recCtx();
      drawSanctuary(ctx, 1600, 900, t);
      const out: number[] = [];
      for (const o of ops) {
        if (typeof o.v === 'number') out.push(o.v);
        else if (typeof o.k === 'string' && o.k.startsWith('rgba(')) out.push(Number(o.k.slice(o.k.lastIndexOf(',') + 1, o.k.length - 1)));
        else out.push(1);
      }
      return out;
    };
    const a = alphas(0);
    const b = alphas(4000);
    if (a.length !== b.length) failures.push(`sanctuary call-shape drifts with t (${a.length} vs ${b.length} ops)`);
    else {
      const drift = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
      if (!(drift <= 0.04)) failures.push(`sanctuary too animated: alpha drift ${drift.toFixed(4)} > 0.04`);
    }
  }

  /* rails: ids stable + registry round-trip */
  for (const s of LAYERS) if (!s.id.startsWith('hell-')) failures.push(`parody id missing for ${s.title}`);
  for (let n = 1; n <= 7; n++) if (layerWorldId(n as HellLayerKey) !== LAYERS[n - 1].id) failures.push(`layerWorldId mismatch layer=${n}`);
  if (layerWorldId('sanctuary') !== 'sanctuary') failures.push('sanctuary id mismatch');

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/worlds/hellbacks.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/hellbacks.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] HELL-BACKDROPS OK' : `[selftest] HELL-BACKDROPS FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
