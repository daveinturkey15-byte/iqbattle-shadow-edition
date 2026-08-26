/**
 * CORRIDOR 2 — raycast-lite corridor-crawl takeover scene (v2 port of
 * modes/doom.js, mechanic not code). Exclusive new file — owns nothing shared.
 *
 * MECHANIC — reach the exit tile before the timer:
 *   A straight rail corridor of LEN tiles rendered pseudo-3D: demons, medkits
 *   and shell packs are DNA-primitive SPRITES ON THE RAIL, scaled by distance
 *   (no true raycasting — perspective is a divide). W/S (or Up/Down) advance/
 *   retreat; SPACE fires down the rail (range 7 tiles, 1 shell). Demons spawn
 *   ahead on seeded schedules and shamble toward you; contact costs 10 of an
 *   internal 30-point pool and knocks them back. Medkits bank +8 hpDelta,
 *   shell packs add +4 shells. The exit gate glows at LEN.
 *     reached exit            -> correct true
 *     pool hit 0              -> false (-40 pts)
 *     cap fired while short   -> neutral partial (kills pay, exit bonus lost)
 *
 * POINTS CURVE vs puzzle par 100*diff+40 (diff = clamp(1+floor(depth/6),1,5)):
 *   kill       = 20 + 5*diff        (demons 4..8 by diff)
 *   exit bonus = 60 + 15*diff
 *   miss       = -5 (firing with no demon on the rail in range)
 *   hpDelta    = clamp(medkits*8 - hitsTaken*5, -15, +15)
 *   Wins land ~100-125% of par at d1 (3-4 kills typical) easing to ~70-80%
 *   at d5 where eight demons outscale the flat exit bonus — documented mercy,
 *   engine parity still beats failing.
 *
 * DETERMINISM: demon schedule (distance/lane/speed), pickup schedule and
 * NOTHING ELSE come from an own mulberry32 (salted) in FIXED draw order at
 * creation; combat resolution is pure positional math. No Math.random, no
 * Date.now — the clock is Pixi's shared ticker delta. The full simulation
 * lives in exported pure functions (createRun/stepRun) so replays are exact.
 *
 * FAIRNESS RAILS: every demon is slower than the runner by >= 1.2 tiles/s —
 * you can ALWAYS outrun the corridor; muzzle flash is a <=90 ms weapon-local
 * bloom (never fullscreen); damage is a red edge-vignette RAMP (~600 ms decay,
 * no strobe); the distance meter to the exit renders above everything at all
 * times (the compass never hides); shells guaranteed: start 6 + drops >=
 * demons + 4; Esc bails NEUTRAL; every text >= 11 px; self-resolves inside
 * ctx.timerLen; StageResult settles exactly once via onceResolve.
 */
import { Container, Graphics, Sprite, Texture, Ticker } from 'pixi.js';

import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import type { Prim } from '../../glyphs.ts';
import { tileCanvas } from '../../glyphs.ts';
import { text } from '../game.ts';
import { mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested)                                            */
/* ------------------------------------------------------------------ */

const DOOM_SALT = 0x0d001c02;

export const CSPEED_MS = 0.0032;      // player tiles per ms (3.2 tiles/s)
export const DEMON_SPEED_CAP = 0.002; // fairness: demons never exceed 2 tiles/s
export const RANGE = 7;               // shot reach in tiles
export const CONTACT = 0.9;           // touch distance
export const KNOCKBACK = 4.5;         // tiles of reprieve after a hit
export const POOL_MAX = 30;
export const HIT_DMG = 10;
export const START_SHELLS = 6;
export const AMMO_PACK = 4;
export const MEDKIT_HP = 8;
export const MISS_COST = 5;

export function diffFor(depth: number): number {
  return Math.min(5, Math.max(1, 1 + Math.floor(Math.max(0, depth) / 6)));
}
export const killPts = (diff: number): number => 20 + 5 * diff;
export const exitBonus = (diff: number): number => 60 + 15 * diff;


export interface Demon {
  dist: number; lane: number; speed: number; alive: boolean;
}
export interface Pickup {
  dist: number; lane: number; kind: 'med' | 'ammo'; taken: boolean;
}
export interface RunState {
  diff: number; len: number;
  pos: number; pool: number; shells: number;
  kills: number; misses: number; hitsTaken: number; medkits: number;
  demons: Demon[]; pickups: Pickup[];
  clockMs: number;
  exited: boolean; deadDone: boolean;
}
/** Corridor length scales so pure walking eats ~60% of the round timer. */
export function corridorLen(timerLenSec: number): number {
  return Math.min(110, Math.max(20, Math.round(timerLenSec * CSPEED_MS * 1000 * 0.6)));
}
/** Seeded world: demons spread across the middle 60% of the rail, pickups
 *  interleaved between them in a fixed med/ammo alternation. FIXED draw order:
 *  per demon (jitter, lane, speed-roll), then per pickup (lane). */
export function createRun(seed: number, depth: number, timerLenSec: number): RunState {
  const rng = mulberry32((seed ^ DOOM_SALT) >>> 0);
  const diff = diffFor(depth);
  const len = corridorLen(timerLenSec);
  const nDem = 3 + diff;
  const demons: Demon[] = [];
  for (let i = 0; i < nDem; i++) {
    const base = len * (0.30 + (nDem > 1 ? (0.60 * i) / (nDem - 1) : 0));
    const jitter = (rng() - 0.5) * len * 0.06;
    const lane = Math.floor(rng() * 3) - 1;
    const roll = 0.9 + 0.2 * rng();
    const speed = Math.min(DEMON_SPEED_CAP, (0.55 + 0.09 * diff) * roll / 1000);
    demons.push({ dist: Math.min(len - 2, Math.max(4, base + jitter)), lane, speed, alive: true });
  }
  demons.sort((a, b) => b.dist - a.dist);
  const nMed = 2;
  const nAmmo = 2 + (diff >= 4 ? 1 : 0);
  const pickups: Pickup[] = [];
  const slots = [...demons.map((d) => d.dist), len].sort((a, b) => a - b);
  let flip = 0;
  const wanted: Array<'med' | 'ammo'> = [];
  for (let i = 0; i < nMed; i++) wanted.push('med');
  for (let i = 0; i < nAmmo; i++) wanted.push('ammo');
  for (let i = 0; i < wanted.length; i++) {
    const lo = slots[i % slots.length];
    const hi = slots[(i + 1) % slots.length];
    const mid = (lo + hi) / 2;
    const lane = Math.floor(rng() * 3) - 1;
    pickups.push({ dist: Math.min(len - 1, Math.max(3, mid)), lane, kind: wanted[(flip++) % wanted.length], taken: false });
  }
  pickups.sort((a, b) => a.dist - b.dist);
  // reassign kinds in sorted order so the alternation stays deterministic
  pickups.forEach((p, i) => { p.kind = i % 2 === 0 ? 'med' : 'ammo'; });
  return {
    diff, len,
    pos: 0, pool: POOL_MAX, shells: START_SHELLS,
    kills: 0, misses: 0, hitsTaken: 0, medkits: 0,
    demons, pickups,
    clockMs: 0,
    exited: false, deadDone: false,
  };
}

export interface StepEvents {
  kill: boolean; hit: boolean; miss: boolean; med: boolean; ammo: boolean; exited: boolean; died: boolean;
}

/** Advance one frame. fire consumes at most one shell. */
export function stepRun(s: RunState, dtMs: number, fire: boolean, fwd: boolean, back: boolean): StepEvents {
  const ev: StepEvents = { kill: false, hit: false, miss: false, med: false, ammo: false, exited: false, died: false };
  if (s.exited || s.deadDone) return ev;
  s.clockMs += dtMs;

  const mv = (fwd ? 1 : 0) - (back ? 1 : 0);
  s.pos = Math.min(s.len, Math.max(0, s.pos + mv * CSPEED_MS * dtMs));
  if (s.pos >= s.len) {
    s.exited = true;
    ev.exited = true;
    return ev;
  }

  for (const p of s.pickups) {
    if (!p.taken && p.dist - s.pos < 0.5) {
      p.taken = true;
      if (p.kind === 'med') { s.medkits++; ev.med = true; }
      else { s.shells += AMMO_PACK; ev.ammo = true; }
    }
  }

  for (const d of s.demons) {
    if (!d.alive) continue;
    d.dist -= d.speed * dtMs;
    if (Math.abs(d.dist - s.pos) <= CONTACT) {
      s.hitsTaken++;
      s.pool -= HIT_DMG;
      d.dist = s.pos + KNOCKBACK;
      ev.hit = true;
      if (s.pool <= 0) {
        s.deadDone = true;
        ev.died = true;
        return ev;
      }
    }
  }

  if (fire) {
    if (s.shells > 0) {
      s.shells--;
      let best: Demon | null = null;
      let bestRel = Infinity;
      for (const d of s.demons) {
        if (!d.alive) continue;
        const rel = d.dist - s.pos;
        if (rel > 0.35 && rel <= RANGE && rel < bestRel) {
          best = d;
          bestRel = rel;
        }
      }
      if (best) {
        best.alive = false;
        s.kills++;
        ev.kill = true;
      } else {
        s.misses++;
        ev.miss = true;
      }
    }
  }
  return ev;
}

export interface DoomTally {
  kills: number; misses: number; medkits: number; hitsTaken: number;
  exited: boolean; died: boolean;
}

export function doomHpDelta(t: DoomTally): number {
  return Math.max(-15, Math.min(15, t.medkits * MEDKIT_HP - t.hitsTaken * 5));
}

/** Verdict ladder — see header curve. */
export function doomVerdict(
  t: DoomTally, diff: number,
): { correct: boolean | null; points: number; hpDelta: number; summary: string } {
  const hp = doomHpDelta(t);
  if (t.exited) {
    return {
      correct: true,
      points: t.kills * killPts(diff) + exitBonus(diff) - t.misses * MISS_COST,
      hpDelta: hp,
      summary: `EXITED — ${t.kills} DEMONS DOWN`,
    };
  }
  if (t.died) {
    return { correct: false, points: -40, hpDelta: hp, summary: 'CONSUMED BY THE CORRIDOR' };
  }
  return {
    correct: null,
    points: Math.max(0, t.kills * killPts(diff) - t.misses * MISS_COST),
    hpDelta: hp,
    summary: 'LOST IN THE CORRIDOR',
  };
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const HORIZON_Y = 452;
const ROAD_BOTTOM_Y = 812;

function demonPrims(): Prim[] {
  return [
    { k: 'tri', x: 50, y: 44, s: 20 },
    { k: 'dot', x: 42, y: 34, r: 4 },
    { k: 'dot', x: 58, y: 34, r: 4 },
  ];
}
function medPrims(): Prim[] {
  return [
    { k: 'line', x1: 50, y1: 32, x2: 50, y2: 68 },
    { k: 'line', x1: 32, y1: 50, x2: 68, y2: 50 },
  ];
}
function ammoPrims(): Prim[] {
  return [
    { k: 'dot', x: 40, y: 46, r: 6 },
    { k: 'dot', x: 60, y: 46, r: 6 },
    { k: 'line', x1: 34, y1: 62, x2: 66, y2: 62 },
  ];
}
function gatePrims(): Prim[] {
  return [
    { k: 'line', x1: 26, y1: 22, x2: 26, y2: 78 },
    { k: 'line', x1: 74, y1: 22, x2: 74, y2: 78 },
    { k: 'line', x1: 26, y1: 24, x2: 74, y2: 24 },
  ];
}

/** Rail perspective: bigger as relDist shrinks. */
function persp(rel: number): number {
  return 240 / (Math.max(0.05, rel) + 1.7);
}

export function mountDoom2(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const hue = T.boardHues[(ctx.seed >>> 11) % T.boardHues.length];
  const settle = onceResolve(ctx.onDone);
  const run = createRun(ctx.seed, ctx.depth, ctx.timerLen);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W; bg.height = STAGE_H; bg.tint = T.bg;
  root.addChild(bg);

  // road trapezoid
  const road = new Graphics();
  road.moveTo(STAGE_W / 2 - 60, HORIZON_Y);
  road.lineTo(STAGE_W / 2 + 60, HORIZON_Y);
  road.lineTo(STAGE_W / 2 + 420, ROAD_BOTTOM_Y);
  road.lineTo(STAGE_W / 2 - 420, ROAD_BOTTOM_Y);
  road.closePath();
  road.fill({ color: 0x10192b });
  root.addChild(road);
  const railLine = new Graphics();
  railLine.moveTo(STAGE_W / 2 - 14, HORIZON_Y);
  railLine.lineTo(STAGE_W / 2 - 96, ROAD_BOTTOM_Y);
  railLine.moveTo(STAGE_W / 2 + 14, HORIZON_Y);
  railLine.lineTo(STAGE_W / 2 + 96, ROAD_BOTTOM_Y);
  railLine.stroke({ width: 2, color: 0x27334d, alpha: 0.9 });
  root.addChild(railLine);

  text(root, 'CORRIDOR 2', STAGE_W / 2 - 76, 88, 30, hue, true);
  const status = text(root, 'REACH THE GATE BEFORE THE DARK DOES', STAGE_W / 2 - 168, HORIZON_Y - 44, 19, T.ink, true);
  text(root, 'W/S MOVE · SPACE FIRE · PICKUPS AUTO-TAKE · GLOWING PILLARS ARE THE EXIT',
    STAGE_W / 2 - 250, ROAD_BOTTOM_Y + 56, 13, T.muted);

  /* ---- HUD ---- */
  const poolBarBg = new Sprite(Texture.WHITE);
  poolBarBg.width = 320; poolBarBg.height = 10;
  poolBarBg.x = STAGE_W / 2 - 160; poolBarBg.y = 132;
  poolBarBg.tint = 0x1a2334;
  root.addChild(poolBarBg);
  const poolBar = new Sprite(Texture.WHITE);
  poolBar.height = 10; poolBar.y = 132;
  poolBar.tint = T.good;
  root.addChild(poolBar);

  const hudLeft = text(root, '', 48, HORIZON_Y - 120, 16, T.ink, true);
  const meter = new Sprite(Texture.WHITE);
  meter.width = 300; meter.height = 6;
  meter.x = STAGE_W / 2 - 150; meter.y = HORIZON_Y - 22;
  meter.tint = hue;
  root.addChild(meter);
  const vignette = new Sprite(Texture.WHITE);
  vignette.width = STAGE_W; vignette.height = STAGE_H;
  vignette.tint = T.bad;
  vignette.alpha = 0;
  root.addChild(vignette);

  /* ---- sprites ---- */
  const demonTex = Texture.from(tileCanvas(demonPrims(), hue, 96));
  const medTex = Texture.from(tileCanvas(medPrims(), '#34d399', 72));
  const ammoTex = Texture.from(tileCanvas(ammoPrims(), hue, 72));
  const gateTex = Texture.from(tileCanvas(gatePrims(), '#ffffff', 128));
  const gunSpr = new Sprite(Texture.from(tileCanvas([{ k: 'diamond', x: 50, y: 58, s: 16 }, { k: 'line', x1: 50, y1: 40, x2: 50, y2: 74 }], hue, 120)));
  gunSpr.x = STAGE_W / 2 - 60;
  gunSpr.y = ROAD_BOTTOM_Y - 118;
  root.addChild(gunSpr);
  const flash = new Sprite(tileCanvasTex([{ k: 'diamond', x: 50, y: 50, s: 26 }], '#ffffff', 96));
  flash.width = 96; flash.height = 96;
  flash.x = STAGE_W / 2 - 48;
  flash.y = ROAD_BOTTOM_Y - 200;
  flash.visible = false;
  root.addChild(flash);

  function tileCanvasTex(prims: Prim[], col: string, size: number): Texture {
    return Texture.from(tileCanvas(prims, col, size));
  }

  const demonSprites = run.demons.map(() => {
    const sp = new Sprite(demonTex);
    sp.anchor.set(0.5, 1);
    root.addChild(sp);
    return sp;
  });
  const pickupSprites = run.pickups.map((p) => {
    const sp = new Sprite(p.kind === 'med' ? medTex : ammoTex);
    sp.anchor.set(0.5, 1);
    root.addChild(sp);
    return sp;
  });
  const gateSprite = new Sprite(gateTex);
  gateSprite.anchor.set(0.5, 1);
  root.addChild(gateSprite);

  /* ---- state ---- */
  let dead = false;
  let fwdDown = false;
  let backDown = false;
  let fireQueued = false;
  let vignetteMs = 0;
  let flashMs = 0;

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function tallyOf(): Parameters<typeof doomVerdict>[0] {
    return {
      kills: run.kills, misses: run.misses, medkits: run.medkits, hitsTaken: run.hitsTaken,
      exited: run.exited, died: run.deadDone,
    };
  }

  function refresh(): void {
    poolBar.width = 320 * Math.max(0, run.pool / POOL_MAX);
    hudLeft.text = `SHELLS ${run.shells} · KILLS ${run.kills} · MEDKITS ${run.medkits}`;
    const remaining = Math.max(0, run.len - run.pos);
    meter.width = 300 * (1 - remaining / run.len);
  }

  function render(): void {
    const placeOnRail = (sp: Sprite, rel: number, lane: number, basePx: number): void => {
      const k = persp(rel);
      const scale = k / 150;
      sp.scale.set(scale);
      sp.x = STAGE_W / 2 + lane * 130 * scale;
      sp.y = HORIZON_Y + k * 1.28;
      void basePx;
    };
    run.demons.forEach((d, i) => {
      const sp = demonSprites[i];
      sp.visible = d.alive;
      if (d.alive) {
        placeOnRail(sp, d.dist - run.pos, d.lane, 96);
        sp.tint = d.dist - run.pos < 2.5 ? 0xffffff : 0xdfe6f2;
      }
    });
    run.pickups.forEach((p, i) => {
      const sp = pickupSprites[i];
      sp.visible = !p.taken;
      if (!p.taken) placeOnRail(sp, p.dist - run.pos, p.lane, 72);
    });
    const gateRel = run.len - run.pos;
    placeOnRail(gateSprite, Math.max(0.4, gateRel), 0, 128);
    gateSprite.visible = gateRel > 0.3;
    vignette.alpha = Math.min(0.38, vignetteMs / 600 * 0.38);
  }

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    switch (e.key) {
      case 'Escape': finish(escaped(doomHpDelta(tallyOf()) / 2, 'BACKED OUT OF THE CORRIDOR')); return;
      case 'w': case 'W': case 'ArrowUp': fwdDown = true; e.preventDefault(); return;
      case 's': case 'S': case 'ArrowDown': backDown = true; e.preventDefault(); return;
      case ' ': fireQueued = true; e.preventDefault(); return;
      default: return;
    }
  }
  function onKeyUp(e: KeyboardEvent): void {
    switch (e.key) {
      case 'w': case 'W': case 'ArrowUp': fwdDown = false; return;
      case 's': case 'S': case 'ArrowDown': backDown = false; return;
      default: return;
    }
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);

  const onTick = (tk: Ticker): void => {
    if (dead) return;
    const dt = Math.min(100, tk.deltaMS);
    const ev = stepRun(run, dt, fireQueued, fwdDown, backDown);
    fireQueued = false;
    if (flashMs > 0 || ev.kill || ev.miss) {
      flashMs = ev.kill || ev.miss ? 90 : flashMs - dt;
    }
    vignetteMs = ev.hit ? 600 : Math.max(0, vignetteMs - dt);
    flash.visible = flashMs > 0;
    if (ev.died) {
      finish(doomVerdict(tallyOf(), run.diff));
      return;
    }
    if (ev.exited) {
      finish(doomVerdict(tallyOf(), run.diff));
      return;
    }
    if (run.clockMs >= ctx.timerLen * 1000) {
      finish(doomVerdict(tallyOf(), run.diff));
      return;
    }
    if (ev.med) status.text = 'MEDKIT — THE FLESH IS WILLING (+8 HP)';
    else if (ev.ammo) status.text = 'SHELL PACK (+4)';
    else if (ev.kill) status.text = 'DEMON DOWN';
    else if (ev.miss) status.text = 'SHELL WASTED (-5 AT SETTLEMENT)';
    else if (ev.hit) status.text = 'CLAWED — BACK OFF';
    render();
    refresh();
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  refresh();
  render();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // corridor length rails
  for (const tl of [15, 30, 60]) {
    const l = corridorLen(tl);
    if (l < 20 || l > 110) failures.push(`corridorLen out of band tl=${tl}`);

    // walking must fit well inside the timer
    if (l / CSPEED_MS > tl * 1000 * 0.65) failures.push(`corridor unwalkable tl=${tl}`);
  }
  if (!(corridorLen(60) > corridorLen(30))) failures.push('corridorLen not monotone');

  // world rails + determinism over 300 seeds
  for (let seed = 1; seed <= 300; seed++) {
    const depth = ((seed * 5) % 29) + 1;
    const a = createRun(seed, depth, 30);
    const b = createRun(seed, depth, 30);
    if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`run nondeterministic seed=${seed}`);
    for (const d of a.demons) {
      if (d.dist < 4 || d.dist > a.len - 2) failures.push(`demon off-rail seed=${seed}`);
      if (d.speed > DEMON_SPEED_CAP) failures.push(`demon too fast seed=${seed}`);
      if (d.lane < -1 || d.lane > 1) failures.push(`bad lane seed=${seed}`);
    }
    if (a.demons.length !== 3 + diffFor(depth)) failures.push(`wrong demon count seed=${seed}`);
    for (const p of a.pickups) {
      if (p.dist < 3 || p.dist > a.len - 1) failures.push(`pickup off-rail seed=${seed}`);
    }
    const shellSupply = a.shells + a.pickups.filter((p) => p.kind === 'ammo').length * AMMO_PACK;
    if (shellSupply < a.demons.length + 4) failures.push(`shell supply short seed=${seed}`);
  }

  // scripted-run determinism + verdict ladder
  const script: Array<[number, boolean, boolean, boolean]> = [];
  const srng = mulberry32(0xcafe);
  for (let i = 0; i < 4000; i++) {
    script.push([16, srng() < 0.75, srng() < 0.05, srng() < 0.12]);
  }
  const ra = createRun(77, 8, 30);
  const rb = createRun(77, 8, 30);
  for (const [dt, f, bk, fr] of script) {
    stepRun(ra, dt, f, f, bk);
    void fr;
    stepRun(rb, dt, f, f, bk);
    if (ra.pos !== rb.pos || ra.kills !== rb.kills) { failures.push('scripted run nondeterministic'); break; }
  }

  const winT: DoomTally = { kills: 3, misses: 1, medkits: 1, hitsTaken: 1, exited: true, died: false };
  const vWin = doomVerdict(winT, 1);
  if (vWin.correct !== true || vWin.points !== 3 * 25 + 75 - 5) failures.push('win verdict wrong');
  const dieT: DoomTally = { kills: 1, misses: 0, medkits: 0, hitsTaken: 3, exited: false, died: true };
  const vDie = doomVerdict(dieT, 2);
  if (vDie.correct !== false || vDie.points !== -40) failures.push('death verdict wrong');
  const lostT: DoomTally = { kills: 2, misses: 0, medkits: 0, hitsTaken: 0, exited: false, died: false };
  const vLost = doomVerdict(lostT, 3);
  if (vLost.correct !== null || vLost.points !== 2 * 35) failures.push('lost verdict wrong');
  if (doomHpDelta({ kills: 0, misses: 0, medkits: 2, hitsTaken: 0, exited: true, died: false }) !== 15) failures.push('hp clamp high wrong');
  if (doomHpDelta({ kills: 0, misses: 0, medkits: 0, hitsTaken: 5, exited: false, died: true }) !== -15) failures.push('hp clamp low wrong');

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
