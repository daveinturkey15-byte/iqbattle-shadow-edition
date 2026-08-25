/**
 * DRONE-DODGE — takeover scene (v2 port of modes/dronedodge.js, mechanic not code).
 *
 * Spawn TIMES/edges are seeded from ctx.seed (fixed draw order); drones home
 * on YOUR cursor with turn-rate-limited steering (circling defeats them).
 * A hit costs −7 hp, breaks your dodge streak and grants 0.6 s invulnerability.
 * Every 3 consecutive drones dodged banks a STREAK GUARD (max 2 held); a
 * guard absorbs the next wrong-answer break (−10 hp instead of losing the
 * stage). Depth ≥7: surviving drones split into two slower shards (same hp
 * rules). Click the matching option tile to win (keys 1–8 too). WASD/arrows
 * nudge a virtual cursor (keyboard-evader fairness rail). Esc bails NEUTRAL.
 *
 * POINTS CURVE vs par(d) = 100*d + 40 (parFor imported from floorfall.ts):
 *   win   = round(par * min(1, 0.45 + 0.55 * leftFrac))
 *           [+15 per guard banked this stage]
 *   fail  = 0 pts ("THE SWARM WON")
 *   absorbed = wrong pick while holding a guard: stage continues, −10 hp
 *   timeo = neutral (correct:null), 0 pts, hpDelta - 5
 *
 * Determinism: spawn schedule is a pure function of ctx.seed via an own
 * mulberry32 in FIXED DRAW ORDER (edge, ox, oy, jitter); homing/dodging is
 * local skill off Pixi's shared ticker clock. No Math.random, no Date.now.
 * Self-limits to ctx.timerLen; StageResult settles exactly once via
 * onceResolve; container emptied on done.
 *
 * Fairness rails: damage feedback is a localized vignette (<200 ms,
 * never fullscreen strobe); motion gated behind localStorage IQB_MOTION
 * ('0' = off → drones advance in discrete 400 ms steps, no shake — rules
 * identical); keyboard evader parity; overlays escapable; text >= 11 px.
 */
import { Container, Graphics, Rectangle, Sprite, Texture, Ticker } from 'pixi.js';
import type { Chip } from './redlight.ts';
import { CHIP_KINDS, chipPrims } from './redlight.ts';
import { mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';
import { tileCanvas } from '../../glyphs.ts';
import { panel, text, spriteFrom } from '../game.ts';
import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import { parFor } from './floorfall.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested below)                                      */
/* ------------------------------------------------------------------ */

const DD_SALT = 0xddc0de;
const SETTLE_MS = 700;

export function paramsFor(depth: number): {
  spawnInt: number; jitter: number; life: number; shardLife: number;
  splitAt: number; maxTurn: number; hitR: number; shardR: number; cursorR: number;
  invulnMs: number; maxAlive: number; splitters: boolean; speedPx: number;
} {
  const d = Math.max(1, Math.min(10, Math.floor(depth)));
  const u = (d - 1) / 9;
  return {
    spawnInt: Math.round(2200 - 1300 * u), // 2.2 s → 0.9 s
    jitter: 0.3,
    life: 7000,
    shardLife: 3500,
    splitAt: 6000,
    maxTurn: 2.4, // rad/s — circling defeats them
    hitR: 13,
    shardR: 9,
    cursorR: 9,
    invulnMs: 600,
    maxAlive: 14,
    splitters: d >= 7,
    speedPx: 130 * speedMult(d),
  };
}

export function speedMult(depth: number): number {
  return 1 + 0.1 * Math.min(Math.max(1, Math.floor(depth)) - 1, 12);
}

export interface Spawn {
  t: number;
  /** 0 top · 1 right · 2 bottom · 3 left */
  edge: number;
  /** normalized offset along the edge */
  ox: number;
  oy: number;
}

/**
 * Seeded spawn schedule — FIXED DRAW ORDER (do not reorder):
 * per drone: edge, ox, oy, then gap jitter around spawnInt (±30%).
 */
export function buildSpawns(seed: number, depth: number, timerLenSec: number): Spawn[] {
  const p = paramsFor(depth);
  const rng = mulberry32((seed ^ DD_SALT) >>> 0);
  const budget = Math.max(5, timerLenSec) * 1000 - SETTLE_MS;
  const spawns: Spawn[] = [];
  let t = 1200;
  while (t < budget) {
    spawns.push({ t, edge: Math.floor(rng() * 4), ox: rng(), oy: rng() });
    t += Math.round(p.spawnInt * (1 - p.jitter + 2 * p.jitter * rng()));
  }
  return spawns;
}

export function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= 2 * Math.PI;
  while (r < -Math.PI) r += 2 * Math.PI;
  return r;
}

/** Turn-rate-limited homing steering. */
export function steer(heading: number, targetAngle: number, dtSec: number, maxTurn: number): number {
  const diff = wrapAngle(targetAngle - heading);
  const step = Math.max(-maxTurn * dtSec, Math.min(maxTurn * dtSec, diff));
  return heading + step;
}

export const GUARD_MAX = 2;

/** Every 3 consecutive dodges banks +1 guard, capped. Streak count is input. */
export function onDodgeBank(consecutiveDodges: number, held: number): number {
  if (consecutiveDodges > 0 && consecutiveDodges % 3 === 0) return Math.min(GUARD_MAX, held + 1);
  return held;
}

function makeBoard(rng: () => number): { opts: Chip[]; answerIdx: number } {
  const key = (c: Chip): string => `${c.kind}:${c.n}`;
  const ans: Chip = { kind: Math.floor(rng() * CHIP_KINDS), n: 2 + Math.floor(rng() * 6) };
  const opts: Chip[] = [{ ...ans }];
  while (opts.length < 8) {
    const c: Chip = { kind: Math.floor(rng() * CHIP_KINDS), n: 2 + Math.floor(rng() * 6) };
    if (!opts.some((o) => key(o) === key(c))) opts.push(c);
  }
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return { opts, answerIdx: opts.findIndex((o) => key(o) === key(ans)) };
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const OPT_SIZE = 150;
const GAP = 22;
const COLS = 4;
const GRID_Y = 520;
const KB_STEP = 48;

interface Drone {
  spr: Sprite;
  x: number;
  y: number;
  h: number;
  born: number;
  shard: boolean;
}

export function mountDroneDodge(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const MOTION = typeof localStorage === 'undefined' || localStorage.getItem('IQB_MOTION') !== '0';
  const rng = mulberry32((ctx.seed ^ 0xbeef77) >>> 0);
  const hue = T.boardHues[ctx.seed % T.boardHues.length];
  const settle = onceResolve(ctx.onDone);
  const p = paramsFor(ctx.depth);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  panel(root, STAGE_W / 2 - 330, 60, 660, 320);
  text(root, 'DRONE SWARM', STAGE_W / 2 - 78, 74, 24, T.gold, true);

  const board = makeBoard(rng);
  const targetChip = board.opts[board.answerIdx];
  const tgt = spriteFrom(tileCanvas(chipPrims(targetChip.kind, targetChip.n), hue, 150));
  tgt.x = STAGE_W / 2 - 75;
  tgt.y = 140;
  root.addChild(tgt);
  text(root, 'OUTFLY THE SWARM · CLICK THE MATCHING TILE', STAGE_W / 2 - 160, 112, 13, T.muted);

  const vignette = new Sprite(Texture.WHITE);
  vignette.width = STAGE_W;
  vignette.height = STAGE_H;
  vignette.tint = 0xff2038;
  vignette.alpha = 0;
  root.addChild(vignette);

  const status = text(root, '', 40, 868, 16, T.ink, true);
  text(root, 'CIRCLE TO BEAT THEIR TURN RATE · EVERY 3 DODGES BANKS A GUARD (MAX 2)', STAGE_W / 2 - 250, 838, 12, T.muted);

  /* ---- options ---- */
  const rowW = COLS * OPT_SIZE + (COLS - 1) * GAP;
  const ox = (STAGE_W - rowW) / 2;
  board.opts.forEach((chip, i) => {
    const x = ox + (i % COLS) * (OPT_SIZE + GAP);
    const y = GRID_Y + Math.floor(i / COLS) * (OPT_SIZE + GAP);
    const spr = spriteFrom(tileCanvas(chipPrims(chip.kind, chip.n), hue, OPT_SIZE));
    spr.x = x;
    spr.y = y;
    spr.eventMode = 'static';
    spr.cursor = 'pointer';
    spr.on('pointerdown', () => pick(i));
    root.addChild(spr);
    text(root, String(i + 1), x + 8, y + OPT_SIZE - 24, 13, T.muted);
  });

  /* ---- dynamic layer ---- */
  const droneLayer = new Container();
  root.addChild(droneLayer);
  const crosshair = new Graphics();
  crosshair.circle(0, 0, 12).stroke({ width: 2, color: T.ink });
  droneLayer.addChild(crosshair);

  /* ---- state ---- */
  const spawns = buildSpawns(ctx.seed, ctx.depth, ctx.timerLen);
  const budgetMs = Math.max(5, ctx.timerLen) * 1000 - SETTLE_MS;
  let clock = 0;
  let spawnIdx = 0;
  let hpDelta = 0;
  let dodges = 0;
  let streak = 0;
  let guards = 0;
  let bankedThisStage = 0;
  let invulnUntil = -1;
  let vignetteAt = -1;
  let dead = false;
  const drones: Drone[] = [];
  let cursor: { x: number; y: number } | null = null;
  let kbCursor: { x: number; y: number } | null = null;

  const effCursor = (): { x: number; y: number } =>
    kbCursor ?? cursor ?? { x: STAGE_W / 2, y: STAGE_H / 2 };

  function refreshHud(): void {
    status.text = `DODGES ${dodges} · GUARDS ${'◆'.repeat(guards)}${'◇'.repeat(GUARD_MAX - guards)} · HP ${hpDelta}`;
    status.style.fill = hpDelta < 0 ? T.bad : T.ink;
  }

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function registerHit(): void {
    hpDelta -= 7;
    streak = 0;
    invulnUntil = clock + p.invulnMs;
    vignetteAt = clock;
    refreshHud();
  }

  function despawn(drone: Drone): void {
    const i = drones.indexOf(drone);
    if (i >= 0) drones.splice(i, 1);
    drone.spr.destroy();
    dodges++;
    streak++;
    const before = guards;
    guards = onDodgeBank(streak, guards);
    if (guards !== before) bankedThisStage++;
    refreshHud();
  }

  function pick(i: number): void {
    if (dead) return;
    if (i === board.answerIdx) {
      const leftFrac = Math.max(0, Math.min(1, (budgetMs - clock) / budgetMs));
      const base = Math.round(parFor(ctx.depth) * Math.min(1, 0.45 + 0.55 * leftFrac));
      finish({
        correct: true,
        points: base + 15 * bankedThisStage,
        hpDelta,
        summary: bankedThisStage >= 2 ? `SWARM OUTFLOWN ×${bankedThisStage} GUARDS` : 'SWARM OUTFLOWN',
      });
    } else if (guards > 0) {
      // guard absorbs the streak break — play continues
      guards--;
      hpDelta -= 10;
      streak = 0;
      refreshHud();
    } else {
      finish({ correct: false, points: 0, hpDelta, summary: 'THE SWARM WON' });
    }
  }

  /* ---- input ---- */
  root.eventMode = 'static';
  root.hitArea = new Rectangle(0, 0, STAGE_W, STAGE_H);
  root.on('pointermove', (e) => {
    cursor = { x: e.global.x, y: e.global.y };
    kbCursor = null;
  });

  function nudge(dx: number, dy: number): void {
    const c = kbCursor ?? cursor ?? { x: STAGE_W / 2, y: STAGE_H / 2 };
    kbCursor = {
      x: Math.max(0, Math.min(STAGE_W, c.x + dx)),
      y: Math.max(0, Math.min(STAGE_H, c.y + dy)),
    };
  }

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    switch (e.key) {
      case 'Escape':
        finish(escaped(hpDelta - 5, 'DODGED FOREVER, ANSWERED NEVER'));
        return;
      case 'w': case 'W': case 'ArrowUp': nudge(0, -KB_STEP); return;
      case 's': case 'S': case 'ArrowDown': nudge(0, KB_STEP); return;
      case 'a': case 'A': case 'ArrowLeft': nudge(-KB_STEP, 0); return;
      case 'd': case 'D': case 'ArrowRight': nudge(KB_STEP, 0); return;
    }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 8) pick(n - 1);
  }
  window.addEventListener('keydown', onKey);

  /* ---- spawning ---- */
  function spawnAt(s: Spawn): Drone {
    const m = 30;
    const x = s.edge === 0 ? s.ox * STAGE_W : s.edge === 1 ? STAGE_W - m : s.edge === 2 ? s.ox * STAGE_W : m;
    const y = s.edge === 0 ? m : s.edge === 1 ? s.oy * STAGE_H : s.edge === 2 ? STAGE_H - m : s.oy * STAGE_H;
    const spr = spriteFrom(tileCanvas(chipPrims(0, 1), hue, 26)); // outlined triangle
    spr.x = x;
    spr.y = y;
    droneLayer.addChild(spr);
    const d: Drone = { spr, x, y, h: Math.atan2(STAGE_H / 2 - y, STAGE_W / 2 - x), born: clock, shard: false };
    drones.push(d);
    return d;
  }

  /* ---- clock ---- */
  let motionAcc = 0;
  const onTick = (tk: Ticker): void => {
    if (dead) return;
    const dt = tk.deltaMS;
    clock += dt;
    if (clock >= budgetMs) {
      finish(escaped(hpDelta - 5, 'DODGED FOREVER, ANSWERED NEVER'));
      return;
    }

    while (spawnIdx < spawns.length && spawns[spawnIdx].t <= clock) {
      if (drones.length < p.maxAlive) spawnAt(spawns[spawnIdx]);
      spawnIdx++;
    }

    const cur = effCursor();

    // reduced motion: drones advance in discrete 400 ms steps, rules identical
    const stepMs = MOTION ? dt : 400;
    if (!MOTION) {
      motionAcc += dt;
      if (motionAcc < 400) { paint(); return; }
      motionAcc -= 400;
    }
    const dtSec = stepMs / 1000;

    for (let i = drones.length - 1; i >= 0; i--) {
      const d = drones[i];
      const age = clock - d.born;

      // splitter: depth ≥7 survivors split into two slower shards
      if (!d.shard && p.splitters && age > p.splitAt) {
        for (const turn of [0.9, -0.9]) {
          if (drones.length >= p.maxAlive) break;
          const s = spawnLike(d, turn);
          drones.push(s);
        }
        removeDrone(d, false); // splits are not dodges
        continue;
      }

      // homing steering toward the cursor
      d.h = steer(d.h, Math.atan2(cur.y - d.y, cur.x - d.x), dtSec, p.maxTurn);
      const spd = (d.shard ? p.speedPx * 0.7 : p.speedPx) * dtSec;
      d.x += Math.cos(d.h) * spd;
      d.y += Math.sin(d.h) * spd;
      d.spr.x = d.x;
      d.spr.y = d.y;
      d.spr.rotation = d.h;

      if (age > (d.shard ? p.shardLife : p.life)) {
        despawn(d);
        continue;
      }
      if (clock > invulnUntil && Math.hypot(d.x - cur.x, d.y - cur.y) < (d.shard ? p.shardR : p.hitR) + p.cursorR) {
        registerHit();
      }
    }
    paint();
  };

  function spawnLike(d: Drone, turn: number): Drone {
    const spr = spriteFrom(tileCanvas(chipPrims(0, 1), hue, 20));
    droneLayer.addChild(spr);
    const s: Drone = { spr, x: d.x, y: d.y, h: d.h + turn, born: clock, shard: true };
    s.spr.x = s.x;
    s.spr.y = s.y;
    return s;
  }

  function removeDrone(d: Drone, _countDodge: boolean): void {
    const i = drones.indexOf(d);
    if (i >= 0) drones.splice(i, 1);
    d.spr.destroy();
  }

  function paint(): void {
    const cur = effCursor();
    crosshair.x = cur.x;
    crosshair.y = cur.y;
    // invulnerability ring fades inside the fairness window
    crosshair.alpha = invulnUntil > clock ? 0.6 : 0.25;
    if (vignetteAt >= 0) {
      const k = (clock - vignetteAt) / 180;
      vignette.alpha = k >= 1 ? 0 : 0.14 * (1 - k);
      if (k >= 1) vignetteAt = -1;
    }
  }
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  refreshHud();
}


/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  // params curve bounds
  const p1 = paramsFor(1);
  const p10 = paramsFor(10);
  if (p1.spawnInt !== 2200 || p10.spawnInt !== 900) failures.push('spawn interval curve wrong');
  if (!p10.splitters || p1.splitters) failures.push('splitter gating wrong');
  if (speedMult(14) !== speedMult(13) || speedMult(1) !== 1) failures.push('speed mult curve wrong');

  // 500 seeds: determinism, monotone fit, sane edges/offsets
  for (let seed = 1; seed <= 500; seed++) {
    const depth = 1 + ((seed * 17) % 10);
    const timerLen = 15 + ((seed * 7) % 46);
    const a = buildSpawns(seed, depth, timerLen);
    const b = buildSpawns(seed, depth, timerLen);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failures.push(`spawns nondeterministic seed=${seed}`);
      break;
    }
    const budget = Math.max(5, timerLen) * 1000 - SETTLE_MS;
    if (a.some((s, i) => s.t > budget || s.t <= 0 || (i > 0 && s.t <= a[i - 1].t))) {
      failures.push(`bad spawn times seed=${seed}`);
      break;
    }
    if (a.some((s) => s.edge < 0 || s.edge > 3 || s.ox < 0 || s.ox > 1 || s.oy < 0 || s.oy > 1)) {
      failures.push(`bad spawn placement seed=${seed}`);
    }
    if (failures.length > 0) break;
  }
  if (buildSpawns(31, 1, 30).length < 5) failures.push('too few spawns for depth 1 / 30 s');

  if (Math.abs(wrapAngle(-Math.PI * 3) + Math.PI) > 1e-9) failures.push('wrapAngle broken');
  if (Math.abs(steer(0, Math.PI / 2, 0.5, 2.4) - 1.2) > 1e-9) failures.push('steer ignores turn cap');
  let h = Math.PI;
  for (let i = 0; i < 300; i++) h = steer(h, 0, 0.05, 2.4);
  if (Math.abs(wrapAngle(h)) > 0.01) failures.push('steer does not converge');

  // guard economy: every 3rd consecutive dodge banks, capped at 2
  let held = 0;
  for (let n = 1; n <= 9; n++) held = onDodgeBank(n, held);
  if (held !== GUARD_MAX) failures.push(`guard banking wrong held=${held}`);
  if (onDodgeBank(2, 0) !== 0 || onDodgeBank(4, 1) !== 1) failures.push('guard must bank only on multiples of 3');
  if (onDodgeBank(6, GUARD_MAX) !== GUARD_MAX) failures.push('guard cap broken');
  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/scenes/takeovers/dronedodge.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/dronedodge.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] DRONE-DODGE OK' : `[selftest] DRONE-DODGE FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
