/**
 * OVERWATCH2 — takeover scene (v2 port of modes/sniperstage.js, mechanic not code).
 *
 * A dense far-field of tiny DNA-primitive figures is laid out under a dim
 * veil; YOUR SCOPE is the whole game. The scope circle (95 px lens) reveals
 * the marks crisply; everywhere else stays fogged. The target card names one
 * mark KIND — confirm the seeded quota of that kind before the clock dies.
 * Wrong-kind confirms sting (-20 pts each, two strikes fail the round);
 * empty-glass clicks are free. HOLD SHIFT/SPACE steadies the breath (sway
 * drops to 0, 2000 ms pool, then a forced 1200 ms exhale).
 *
 * Polish rails (Main checklist):
 *   - GOAL CARD covers the field for the first 2000 ms (title / controls /
 *     win condition / Esc hint); the round budget does NOT drain under it,
 *     and a click skips it. Input unlocks when it clears.
 *   - HUD lives in dedicated bands (top strip + right sidebar); nothing
 *     overlaps the field or its legend. All text >= 13 px.
 *   - Click-to-feedback is synchronous (ring recolor + pips update inside the
 *     handler); flashes are localized ring recolors <= 200 ms.
 *   - Esc resolves NEUTRAL ('SCOPE LOWERED') at any moment.
 * Determinism: everything derives from ctx.seed via an own mulberry32 with a
 * FIXED draw order — answer kind, slot shuffle, decoy kinds, position
 * jitters, sway phases. No Math.random, no Date.now (clock = Pixi shared
 * ticker delta). One hue per board (T.boardHues); structure carries the
 * rule, never color. Self-limits to ctx.timerLen (45 s cap, 500 ms settle
 * margin) and settles exactly once via onceResolve.
 */
import { Container, Graphics, Sprite, Texture, Ticker } from 'pixi.js';
import type { Prim } from '../../glyphs.ts';
import { tileCanvas } from '../../glyphs.ts';
import { panel, text, spriteFrom } from '../game.ts';
import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import {
  onceResolve,
  escaped,
  mulberry32,
  type StageResult,
  type TakeoverCtx,
} from './redlight.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested below)                                      */
/* ------------------------------------------------------------------ */

export const SALT = 0x0be2ca7;
export const SCOPE_R = 95;
export const BREATH_MS = 2000;
export const EXHALE_MS = 1200;
export const SWAY_AMP = 7;

/** Logical field rect inside the takeover box (main places it at 40,164). */
export const FIELD = { x: 30, y: 84, w: 1050, h: 552 };

/** Parody-kind ids — one primitive-mark family each, ONE board hue total. */
export const KIND_NAMES = [
  'TRI CLUSTER',
  'DIAMOND CORE',
  'DOT MATRIX',
  'PLUS CROSS',
  'X CROSS',
  'DASH PAIR',
] as const;

export const KIND_COUNT = KIND_NAMES.length;

const MISS_PTS = 20;
const MAX_STRIKES = 2;
const CARD_MS = 2000;
const BUDGET_CAP_MS = 45000;

export function quota(depth: number): number {
  return Math.min(6, Math.max(3, 3 + Math.floor((Math.max(1, depth) - 1) / 3)));
}

export function density(depth: number): number {
  return Math.min(48, 26 + Math.max(1, depth) * 2);
}

export interface Figure {
  x: number;
  y: number;
  kind: number;
}

/**
 * Seeded far-field: exactly `quota(d)` figures carry the answer kind, the
 * rest spread across the other five families. Positions come from a shuffled
 * 10x5 slot grid plus a seeded +/-12 px jitter, so no two figures ever
 * overlap and every one stays inside FIELD.
 */
export function makeField(rng: () => number, depth: number): { figures: Figure[]; answerKind: number } {
  const n = density(depth);
  const q = quota(depth);
  const answerKind = Math.floor(rng() * KIND_COUNT);
  const cols = 10;
  const rows = 5;
  const slots: number[] = [];
  for (let i = 0; i < cols * rows; i++) slots.push(i);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const figures: Figure[] = [];
  for (let i = 0; i < n; i++) {
    const slot = slots[i];
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    const kind =
      i < q ? answerKind : (answerKind + 1 + Math.floor(rng() * (KIND_COUNT - 1))) % KIND_COUNT;
    figures.push({
      x: FIELD.x + ((col + 0.5) * FIELD.w) / cols + (rng() * 24 - 12),
      y: FIELD.y + ((row + 0.5) * FIELD.h) / rows + (rng() * 24 - 12),
      kind,
    });
  }
  return { figures, answerKind };
}

/** Aim hit-test: centre distance within the confirm tolerance. */
export function hitTest(ax: number, ay: number, f: Figure, tol: number): boolean {
  return Math.hypot(ax - f.x, ay - f.y) <= tol;
}

/**
 * Seeded breath sway at time t (px), bounded by amp. Pure f(seed, t) — the
 * wall clock never touches it; IQB_MOTION=0 removes the sway entirely.
 */
export function swayOffset(seed: number, tMs: number, amp: number): { dx: number; dy: number } {
  const p1 = ((seed >>> 3) % 628) / 100;
  const p2 = ((seed >>> 9) % 628) / 100;
  const ts = tMs / 1000;
  const dx = amp * (Math.sin(ts * 1.7 + p1) * 0.6 + Math.sin(ts * 2.83 + p2) * 0.4);
  const dy = amp * (Math.sin(ts * 1.31 + p2) * 0.6 + Math.sin(ts * 2.17 + p1) * 0.4);
  return { dx, dy };
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const CONFIRM_TOL = SCOPE_R * 0.85;

/** Tiny primitive-mark figure for kind k, composed in a 100x100 cell space. */
function figurePrims(kind: number): Prim[] {
  switch (kind) {
    case 0: // TRI CLUSTER — four outlined triangles in a diamond layout
      return [
        { k: 'tri', x: 50, y: 26, s: 9 },
        { k: 'tri', x: 27, y: 58, s: 9 },
        { k: 'tri', x: 73, y: 58, s: 9 },
        { k: 'tri', x: 50, y: 82, s: 9 },
      ];
    case 1: // DIAMOND CORE — filled centre diamond + corner dots
      return [
        { k: 'diamond', x: 50, y: 50, s: 15 },
        { k: 'dot', x: 24, y: 24, r: 4 },
        { k: 'dot', x: 76, y: 24, r: 4 },
        { k: 'dot', x: 24, y: 76, r: 4 },
        { k: 'dot', x: 76, y: 76, r: 4 },
      ];
    case 2: // DOT MATRIX — five-dot quincunx
      return [
        { k: 'dot', x: 30, y: 30, r: 6 },
        { k: 'dot', x: 70, y: 30, r: 6 },
        { k: 'dot', x: 50, y: 50, r: 6 },
        { k: 'dot', x: 30, y: 70, r: 6 },
        { k: 'dot', x: 70, y: 70, r: 6 },
      ];
    case 3: // PLUS CROSS
      return [
        { k: 'line', x1: 20, y1: 50, x2: 80, y2: 50 },
        { k: 'line', x1: 50, y1: 20, x2: 50, y2: 80 },
      ];
    case 4: // X CROSS
      return [
        { k: 'line', x1: 28, y1: 28, x2: 72, y2: 72 },
        { k: 'line', x1: 28, y1: 72, x2: 72, y2: 28 },
      ];
    default: // DASH PAIR
      return [
        { k: 'line', x1: 28, y1: 38, x2: 72, y2: 38 },
        { k: 'line', x1: 28, y1: 62, x2: 72, y2: 62 },
      ];
  }
}

export function mountOverwatch2(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const MOTION = typeof localStorage === 'undefined' || localStorage.getItem('IQB_MOTION') !== '0';
  const settle = onceResolve(ctx.onDone);
  const hue = T.boardHues[(ctx.seed >>> 8) % T.boardHues.length];
  const rng = mulberry32((ctx.seed ^ SALT) >>> 0);

  const need = quota(ctx.depth);
  const { figures, answerKind } = makeField(rng, ctx.depth);
  const budgetMs = Math.max(3000, Math.min(ctx.timerLen * 1000, BUDGET_CAP_MS) - 500);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  panel(root, FIELD.x - 18, FIELD.y - 34, FIELD.w + 36, FIELD.h + 66);

  const status = text(root, '', FIELD.x, 14, 22, T.gold, true);
  status.text = `OVERWATCH — CONFIRM ${need} × ${KIND_NAMES[answerKind]} FIGURES`;
  const hint = text(root, '', FIELD.x, 46, 13, T.muted);
  hint.text = 'MOVE = SLEW · HOLD SHIFT/SPACE = STEADY · CLICK = FIRE · ESC = LOWER SCOPE';

  /* ---- fogged far-field ---- */
  const dimLayer = new Container();
  root.addChild(dimLayer);
  for (const f of figures) {
    const sp = spriteFrom(tileCanvas(figurePrims(f.kind), hue, 64));
    sp.x = f.x - 32;
    sp.y = f.y - 32;
    sp.alpha = 0.13;
    dimLayer.addChild(sp);
  }

  /* ---- crisp layer masked by the scope circle ---- */
  const kindTex = new Map<number, Texture>();
  for (let k = 0; k < KIND_COUNT; k++) kindTex.set(k, Texture.from(tileCanvas(figurePrims(k), hue, 64)));
  const brightLayer = new Container();
  root.addChild(brightLayer);
  for (const f of figures) {
    const sp = new Sprite(kindTex.get(f.kind)!);
    sp.x = f.x - 32;
    sp.y = f.y - 32;
    brightLayer.addChild(sp);
  }
  const scopeMask = new Graphics();
  root.addChild(scopeMask);
  brightLayer.mask = scopeMask;

  /* ---- scope ring + crosshair ---- */
  const ring = new Graphics();
  root.addChild(ring);

  /* ---- right sidebar (dedicated band — never overlaps the field) ---- */
  const SIDE_X = FIELD.x + FIELD.w + 40;
  const SIDE_W = STAGE_W - 40 - SIDE_X;
  panel(root, SIDE_X, FIELD.y - 34, SIDE_W, FIELD.h + 66);
  text(root, 'TARGET KIND', SIDE_X + 20, FIELD.y - 12, 15, T.ink, true);
  const tgt = spriteFrom(tileCanvas(figurePrims(answerKind), hue, 150));
  tgt.x = SIDE_X + (SIDE_W - 150) / 2;
  tgt.y = FIELD.y + 16;
  root.addChild(tgt);
  const kindCap = text(root, KIND_NAMES[answerKind], tgt.x + 75, tgt.y + 162, 15, hue, true);
  kindCap.anchor.set(0.5, 0);
  const caption = text(root, 'FIRE ON EVERY FIGURE OF THIS KIND', SIDE_X, tgt.y + 190, 13, T.muted);
  caption.anchor.set(0.5, 0);
  caption.x = tgt.x + 75;
  const pips = text(root, '', SIDE_X, tgt.y + 226, 19, T.good, true);
  const strikeTxt = text(root, '', SIDE_X, tgt.y + 256, 14, T.bad);
  const timeTxt = text(root, '', SIDE_X, tgt.y + 296, 16, T.ink, true);
  const barW = SIDE_W - 40;
  const bar = new Sprite(Texture.WHITE);
  bar.x = SIDE_X + 20;
  bar.y = tgt.y + 326;
  bar.height = 6;
  root.addChild(bar);
  text(root, 'ESC ALWAYS SETTLES NEUTRAL', SIDE_X, tgt.y + 352, 13, T.muted);

  /* ---- goal-card overlay (input locked beneath it) ---- */
  let locked = true;
  let cardGone = false;
  const card = new Container();
  const cardW = 620;
  const cardH = 264;
  card.x = FIELD.x + (FIELD.w - cardW) / 2;
  card.y = FIELD.y + (FIELD.h - cardH) / 2;
  root.addChild(card);
  const cardPanel = panel(card, 0, 0, cardW, cardH);
  cardPanel.alpha = 0.97;
  text(card, 'OVERWATCH · LONG RANGE', 30, 24, 24, T.gold, true);
  text(card, `WIN: CONFIRM ${need} ${KIND_NAMES[answerKind]} FIGURES BEFORE THE CLOCK DIES`, 30, 74, 15, T.ink);
  text(card, 'MOVE = SLEW THE SCOPE · CLICK = FIRE', 30, 110, 15, T.ink);
  text(card, 'HOLD SHIFT/SPACE = STEADY THE BREATH (2s POOL, THEN EXHALE)', 30, 140, 15, T.ink);
  text(card, 'WRONG-KIND SHOT = -20 PTS · TWO STRIKES FAIL THE ROUND', 30, 170, 15, T.bad);
  text(card, 'ESC = LOWER THE SCOPE (NEUTRAL)', 30, 214, 13, T.muted);

  function dismissCard(): void {
    if (cardGone) return;
    cardGone = true;
    locked = false;
    liveStartMs = elapsedMs;
    card.removeChildren().forEach((c) => c.destroy({ children: true }));
    root.removeChild(card);
  }

  /* ---- state ---- */
  let mouseX = FIELD.x + FIELD.w / 2;
  let mouseY = FIELD.y + FIELD.h / 2;
  let elapsedMs = 0;
  let liveStartMs = 0;
  let dead = false;
  let hits = 0;
  let strikes = 0;
  let bank = 0;
  let missPts = 0;
  const done = new Set<Figure>();
  let breathPool = BREATH_MS;
  let exhaleMs = 0;
  let holdingBreath = false;
  let amp = SWAY_AMP;
  let flashUntil = -1;
  let flashWrong = false;
  let flashX = 0;
  let flashY = 0;
  let pulseUntil = -1;
  let pulseText = '';

  function settleNow(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function refreshSidebar(): void {
    let pp = '';
    for (let i = 0; i < need; i++) pp += i < hits ? '\u25cf ' : '\u25cb ';
    pips.text = `${pp} ${hits}/${need}`;
    pips.style.fill = hits >= need ? T.good : T.ink;
    strikeTxt.text = strikes > 0 ? `STRIKES ${'\u25cf'.repeat(strikes)} \u2212${missPts} PTS` : `${MAX_STRIKES - strikes} STRIKES LEFT`;
  }

  function win(): void {
    settleNow({
      correct: true,
      points: bank - missPts + ctx.depth * 5,
      hpDelta: 0,
      summary: `QUOTA MET \u00b7 ${hits} CONFIRMED`,
    });
  }

  function failStrikes(): void {
    settleNow({
      correct: false,
      points: -missPts,
      hpDelta: 0,
      summary: 'TWO STRIKES WIDE \u00b7 STAND DOWN',
    });
  }

  /** Current aim point (pointer + live breath sway) — identical to rendering. */
  function aimNow(): { ax: number; ay: number } {
    const sway = MOTION && !holdingBreath && !locked ? swayOffset(ctx.seed, elapsedMs, amp) : { dx: 0, dy: 0 };
    return { ax: mouseX + sway.dx, ay: mouseY + sway.dy };
  }

  function fire(): void {
    if (dead || locked) return;
    const { ax, ay } = aimNow();
    let best: Figure | null = null;
    let bestD = Infinity;
    for (const f of figures) {
      if (done.has(f)) continue;
      const d = Math.hypot(ax - f.x, ay - f.y);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (!best || !hitTest(ax, ay, best, CONFIRM_TOL)) {
      pulseUntil = elapsedMs + 700; // free look — instant, no penalty
      pulseText = 'NOTHING IN THE GLASS';
      return;
    }
    flashX = best.x;
    flashY = best.y;
    if (best.kind === answerKind) {
      done.add(best);
      hits++;
      bank += 15 + ctx.depth * 2;
      flashUntil = elapsedMs + 200; // <=200 ms localized rail
      flashWrong = false;
      refreshSidebar(); // synchronous click-to-feedback
      if (hits >= need) win();
    } else {
      strikes++;
      missPts += MISS_PTS;
      flashUntil = elapsedMs + 160;
      flashWrong = true;
      refreshSidebar();
      if (strikes >= MAX_STRIKES) failStrikes();
    }
  }

  function onMove(e: { globalX: number; globalY: number }): void {
    mouseX = e.globalX;
    mouseY = e.globalY;
  }

  function onDown(): void {
    if (dead) return;
    if (locked) {
      dismissCard();
      return;
    }
    fire();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      settleNow(escaped(0, 'SCOPE LOWERED'));
      return;
    }
    if (e.key === 'Shift' || e.key === ' ') {
      e.preventDefault();
      if (!e.repeat && !holdingBreath && exhaleMs <= 0 && !locked) holdingBreath = true;
    }
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === 'Shift' || e.key === ' ') holdingBreath = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  root.eventMode = 'static';
  root.on('pointermove', onMove);
  root.on('pointerdown', onDown);

  const onTick = (tk: Ticker): void => {
    if (dead) return;
    elapsedMs += tk.deltaMS;
    if (locked && elapsedMs >= CARD_MS) dismissCard();

    // breath economy: hold up to BREATH_MS, then a forced EXHALE_MS lockout
    if (holdingBreath) {
      breathPool -= tk.deltaMS;
      if (breathPool <= 0) {
        breathPool = BREATH_MS;
        holdingBreath = false;
        exhaleMs = EXHALE_MS;
      }
    } else if (exhaleMs > 0) {
      exhaleMs -= tk.deltaMS;
    }

    // sway amplitude eases toward zero while steady (or motion-off)
    const wantAmp = holdingBreath || !MOTION || locked ? 0 : SWAY_AMP;
    amp += (wantAmp - amp) * Math.min(1, tk.deltaMS / 120);

    const { ax, ay } = aimNow();
    scopeMask.clear().circle(ax, ay, SCOPE_R).fill(0xffffff);
    ring.clear()
      .circle(ax, ay, SCOPE_R).stroke({ color: hue, width: 2, alpha: 0.9 })
      .moveTo(ax - 12, ay).lineTo(ax + 12, ay).stroke({ color: hue, width: 1, alpha: 0.7 })
      .moveTo(ax, ay - 12).lineTo(ax, ay + 12).stroke({ color: hue, width: 1, alpha: 0.7 });
    if (flashUntil > elapsedMs) {
      ring.circle(flashX, flashY, 32).stroke({ color: flashWrong ? T.bad : T.good, width: 3, alpha: 1 });
    }

    hint.text = holdingBreath
      ? `STEADY ${(Math.ceil(breathPool / 100) / 10).toFixed(1)}s`
      : exhaleMs > 0
        ? `EXHALE ${(exhaleMs / 1000).toFixed(1)}s`
        : pulseUntil > elapsedMs
          ? pulseText
          : 'MOVE = SLEW · HOLD SHIFT/SPACE = STEADY · CLICK = FIRE · ESC = LOWER SCOPE';

    // round clock — starts only after the goal card clears
    const liveLeft = Math.max(0, budgetMs - (elapsedMs - liveStartMs));
    timeTxt.text = `RANGE CLOCK ${(liveLeft / 1000).toFixed(1)}s`;
    bar.width = Math.max(2, barW * (liveLeft / budgetMs));
    bar.tint = liveLeft < 6000 ? T.bad : T.gold;

    if (!locked && elapsedMs - liveStartMs >= budgetMs) {
      settleNow({
        correct: null,
        points: bank - missPts,
        hpDelta: 0,
        summary: `TIME \u00b7 RANGE GOES COLD \u00b7 ${hits}/${need}`,
      });
    }
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    root.off('pointermove', onMove);
    root.off('pointerdown', onDown);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  refreshSidebar();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const TILE = 64; // rendered sprite edge; overlap guard uses centres vs pitch

  for (let depth = 1; depth <= 14; depth++) {
    const q = quota(depth);
    const n = density(depth);
    if (q < 3 || q > 6) failures.push(`quota out of band d=${depth} q=${q}`);
    if (n < 26 || n > 48) failures.push(`density out of band d=${depth} n=${n}`);
    if (q >= n) failures.push(`quota must be < density d=${depth}`);
  }

  for (let seed = 1; seed <= 300; seed++) {
    const rngA = mulberry32(seed);
    const a = makeField(rngA, 7);
    const b = makeField(mulberry32(seed), 7);
    if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`field nondeterministic seed=${seed}`);

    const q = quota(7);
    const targets = a.figures.filter((f) => f.kind === a.answerKind);
    if (targets.length !== q) failures.push(`target count ${targets.length} != quota ${q} seed=${seed}`);
    const others = new Set(a.figures.filter((f) => f.kind !== a.answerKind).map((f) => f.kind));
    if ([...others].some((k) => k < 0 || k >= KIND_COUNT)) failures.push(`decoy kind out of range seed=${seed}`);

    for (const f of a.figures) {
      if (f.x < FIELD.x - 12 || f.x > FIELD.x + FIELD.w + 12 || f.y < FIELD.y - 12 || f.y > FIELD.y + FIELD.h + 12) {
        failures.push(`figure out of bounds seed=${seed}`);
        break;
      }
    }
    let minD = Infinity;
    for (let i = 0; i < a.figures.length; i++) {
      for (let j = i + 1; j < a.figures.length; j++) {
        minD = Math.min(minD, Math.hypot(a.figures[i].x - a.figures[j].x, a.figures[i].y - a.figures[j].y));
      }
    }
    if (minD < TILE * 0.9) failures.push(`figures overlap seed=${seed} minD=${minD.toFixed(1)}`);

    for (const t of [0, 400, 1337, 9000]) {
      const s = swayOffset(seed, t, SWAY_AMP);
      if (Math.abs(s.dx) > SWAY_AMP || Math.abs(s.dy) > SWAY_AMP) failures.push(`sway unbounded seed=${seed} t=${t}`);
    }
  }

  // F9-style regression guard: fields must actually vary across seeds
  const variants = new Set<string>();
  for (let seed = 1; seed <= 300; seed++) variants.add(JSON.stringify(makeField(mulberry32(seed), 7)));
  if (variants.size < 250) failures.push(`field seed-blind: only ${variants.size} distinct layouts over 300 seeds`);

  // summary punch: every settled string stays <= 64 chars
  const summaries = [
    `QUOTA MET · 6 CONFIRMED`,
    'TWO STRIKES WIDE · STAND DOWN',
    `TIME · RANGE GOES COLD · 6/6`,
    'SCOPE LOWERED',
  ];
  if (summaries.some((s) => s.length > 64)) failures.push('summary exceeds 64 chars');
  if (KIND_NAMES.some((k) => k.length < 4)) failures.push('kind name too short');

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/scenes/takeovers/overwatch2.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/overwatch2.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] OVERWATCH2 OK' : `[selftest] OVERWATCH2 FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
