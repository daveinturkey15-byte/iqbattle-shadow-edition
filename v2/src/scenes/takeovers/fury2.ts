/**
 * FURY ROADRUN — takeover scene (v2 port of modes/madmax.js, mechanic not code).
 *
 * Side-scrolling war-rig highway, 3 lanes. W/S · ARROW UP/DOWN · tap top/bottom
 * third · on-screen ▲▼ pads change lanes.
 *   - A goal card (first ~2 s, or TAP TO START) announces the seeded TRUE-SIGN
 *     sequence (DNA-primitive glyph chips, e.g. SKULL×3 → TEETH×5 → GEMS×2).
 *     Drive through skull signs in that order: each true pick pays
 *     (8+12·diff) + 5·combo and advances the lock; completing it pays
 *     +(12+24·diff) ("SEQUENCE LOCKED").
 *   - Spike-trap potholes telegraph (amber dashed ring ≥0.95 s out, spikes arm
 *     then): hit = integrity damage, hpDelta −8 per hit, floored −24, plus a
 *     brief engine slowdown.
 *   - Rival rig rams when your combo drops (false sign / missed sign), depth
 *     ladder diff≥2 only: horn telegraph 900 ms, then a charge down YOUR lane —
 *     change lanes inside the window to shake the tail (+15); eating it costs
 *     15+5·diff points.
 *   - Guzzoline canisters bank +6 s of cap time (up to +18 s, clamped so the
 *     scene ALWAYS self-resolves inside ctx.timerLen).
 *   - Sandstorm brownouts (≤2/run, announced 800 ms ahead): the road dims but
 *     the HUD — including the NEXT chip — sits ABOVE the dust layer and never
 *     dims (fairness rail).
 *   - Reach the citadel before the cap: +(60+44·diff), "WHAT A DAY". Otherwise
 *     resolve at the cap: correct iff the sequence locked.
 *
 * POINTS CURVE vs par — band reference parFor(diffFor(depth)) (the shared
 * ladder par, e.g. parFor(1..5) = 140..540):
 *   true pick   +(8+12·diff) + 5·combo        (combo resets on false/miss/ram)
 *   seq lock    +(12+24·diff)
 *   citadel     +(60+44·diff)
 *   dodge       +15
 *   false idol  −10 (decoy shades read like the needed family, ALWAYS false)
 *   ram         −(15+5·diff)
 *   Result points clamp [0,500]; correct = citadel || sequenceLocked.
 *   The smoke entry prints the bot-median ratio vs ladder par over 200 seeds
 *   (v1 balance-probe contract: band [0.60, 1.35]).
 *
 * DECOY SHADES (structure space): v1 used near-miss color shades; DNA rails
 * forbid per-cell hue changes, so the decoys here are chips that share the
 * needed chip's MARK FAMILY (same kind) but differ in COUNT — they read as the
 * right family at a glance and are always FALSE. Ladder diff≥3 enables them.
 * One board hue from T.boardHues carries all glyphs (glyphs.ts prims, never
 * recolored).
 *
 * DETERMINISM: the ENTIRE schedule (sequence chips, decoys, event times/lanes/
 * ids, storm times) derives from ctx.seed via an own mulberry32 in FIXED DRAW
 * ORDER (seq → decoys → events → storms). No Math.random, no Date.now — the
 * clock is Pixi's shared ticker delta. Inputs are local skill only.
 *
 * POLISH NOTES (per parent checklist):
 *   1. GOAL CARD — full goal/controls/win-condition card owns the first ~2 s;
 *      input unlocks on dismiss (auto or TAP TO START); nothing else overlaps.
 *   2. HUD CLEARANCE — status bottom-left, NEXT chip bottom-right, ▲▼ pads
 *      bottom-center (y 792–880), rule line at y 892: zero overlap; all HUD
 *      ≥12 px on dark backdrops.
 *   3. INPUT LATENCY — every lane change flashes an accent ring on the rig the
 *      SAME tick (<16 ms); pot hits flip the status strip red immediately.
 *   4. ESC PATH — the goal card carries "ESC — ABANDON (NEUTRAL)" and the
 *      footer repeats it; Esc always settles a neutral StageResult.
 *   5. CONTRAST — the toast strip rides its own dark backdrop panel.
 *   6. SUMMARY PUNCH — all summaries are short fixed templates (≤64 chars,
 *      no truncation possible at any timerLen).
 *
 * FAIRNESS RAILS: no fullscreen flashes — feedback is a localized toast +
 * rig flash; the pothole telegraph blinks at ~2.8 Hz (≤3 Hz), each phase
 * ≥180 ms; pause overlay escapable (ESC/P + RESUME button); touch parity via
 * tap thirds + ≥44 px pads; motion gated behind localStorage IQB_MOTION.
 */
import { Container, Graphics, Rectangle, Sprite, Texture, Ticker } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { Chip } from './redlight.ts';
import { CHIP_KINDS, chipPrims, mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';
import { tileCanvas } from '../../glyphs.ts';
import { text, spriteFrom } from '../game.ts';
import { T, STAGE_W, STAGE_H } from '../../theme.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested below)                                      */
/* ------------------------------------------------------------------ */

export const FURY_SEED_SALT = 0x3ad0ad;

export const LANES = 3;
export const CAP_MS = 40000;
export const MAX_BONUS_MS = 18000;
export const GAS_BONUS_MS = 6000;
export const POT_DMG_HP = 8;
export const POT_DMG_FLOOR = 24;
export const HORN_MS = 900;
export const POT_WARN_S = 0.95;
export const STORM_WARN_MS = 800;
export const SETTLE_MS = 700;
/** goal card owns this long before input unlocks (checklist #1) */
export const GOAL_CARD_MS = 2000;

/** Logical geometry (stage space 1600×900). */
export const RIG_X = 260;
export const SPAWN_X = STAGE_W + 60;
export const KILL_X = -90;
export const ROAD_TOP = 250;
export const ROAD_BOT = 780;

/** Parody sign families — indexes the 6 DNA mark kinds from redlight.chipPrims. */
export const KIND_NAMES = ['SKULL', 'TEETH', 'FLIES', 'WHEELS', 'BLADES', 'TRACKS'];

export function chipKey(c: Chip): string {
  return `${c.kind}:${c.n}`;
}

/** Shared difficulty ladder: min(5, 1+floor((depth−1)/6)). */
export function diffFor(depth: number): number {
  return Math.min(5, Math.max(1, 1 + (((depth | 0) - 1) / 6 | 0)));
}

export function seqLenFor(diff: number): number {
  return diff <= 1 ? 3 : diff <= 3 ? 4 : 5;
}

export function speedFor(diff: number): number {
  return 235 + diff * 42; // px/s world scroll
}

export function totalDistFor(diff: number): number {
  return speedFor(diff) * 33; // citadel at ~33 s of clean running
}

/* payouts — documented vs the ladder par, see header */
export const pickBaseFor = (diff: number): number => 8 + 12 * diff;
export const seqLockBonusFor = (diff: number): number => 12 + 24 * diff;
export const citadelBonusFor = (diff: number): number => 60 + 44 * diff;
export const ramPenaltyFor = (diff: number): number => 15 + 5 * diff;

export function laneCenter(ln: number): number {
  return ROAD_TOP + ((ROAD_BOT - ROAD_TOP) / LANES) * (ln + 0.5);
}

export function clampLane(l: number): number {
  return Math.max(0, Math.min(LANES - 1, l));
}

/** Effective cap: gas banks extend the run but NEVER past the settle margin. */
export function capNow(bonusMs: number, timerLenSec: number): number {
  return Math.min(CAP_MS + bonusMs, Math.max(5, timerLenSec) * 1000 - SETTLE_MS);
}

/** Seeded TRUE-SIGN sequence: distinct chips, FIXED DRAW ORDER. */
export function buildSequence(rng: () => number, len: number): Chip[] {
  const seq: Chip[] = [];
  const seen = new Set<string>();
  while (seq.length < len) {
    const c: Chip = { kind: Math.floor(rng() * CHIP_KINDS), n: 2 + Math.floor(rng() * 6) };
    const k = chipKey(c);
    if (!seen.has(k)) {
      seen.add(k);
      seq.push(c);
    }
  }
  return seq;
}

/**
 * Sign id palette = sequence chips (+ decoy shades at diff≥3). Decoys share a
 * sequence chip's kind but never its count — same family at a glance, always
 * false. One rng draw per decoy slot (bounded re-rolls), fixed order.
 */
export function buildPalette(rng: () => number, seq: Chip[], diff: number): Chip[] {
  const pal: Chip[] = seq.map((c) => ({ ...c }));
  if (diff >= 3) {
    for (const c of seq) {
      let n = 2 + Math.floor(rng() * 6);
      for (let guard = 0; n === c.n && guard < 8; guard++) n = 2 + Math.floor(rng() * 6);
      if (n !== c.n) pal.push({ kind: c.kind, n });
    }
  }
  return pal;
}

export interface FuryEv {
  /** ms from mount when the entity enters the road */
  t: number;
  kind: 'sign' | 'pot' | 'gas';
  lane: number;
  /** palette index (signs only) */
  ci: number;
}

export interface FuryWorld {
  seq: Chip[];
  palette: Chip[];
  evs: FuryEv[];
  /** sandstorm start times (ms) */
  storms: number[];
}

/**
 * Seeded world build — FIXED DRAW ORDER: sequence → palette decoys → event
 * stream (roll, lane, sign id, gap) → storm starts. Identical output for an
 * identical seed on every tab.
 */
export function buildWorld(seed: number, depth: number): FuryWorld {
  const rng = mulberry32((seed ^ FURY_SEED_SALT) >>> 0);
  const diff = diffFor(depth);
  const seq = buildSequence(rng, seqLenFor(diff));
  const palette = buildPalette(rng, seq, diff);

  const evs: FuryEv[] = [];
  const stepBase = Math.max(430, 720 - diff * 58);
  let t = 1600;
  while (t < 54000) {
    const roll = rng();
    const lane = (rng() * LANES) | 0;
    if (roll < 0.62) {
      evs.push({ t, kind: 'sign', lane, ci: (rng() * palette.length) | 0 });
    } else if (roll < 0.82) {
      evs.push({ t, kind: 'pot', lane, ci: -1 });
    } else if (roll < 0.91) {
      evs.push({ t, kind: 'gas', lane, ci: -1 });
    }
    t += stepBase * (0.75 + rng() * 0.5);
  }

  const storms: number[] = [];
  const nStorms = diff >= 2 ? 2 : 1;
  for (let s = 0; s < nStorms; s++) {
    const frac = 0.26 + 0.4 * s + rng() * 0.12;
    storms.push(CAP_MS * Math.min(0.85, frac));
  }
  return { seq, palette, evs, storms };
}

export interface FuryEnt {
  kind: 'sign' | 'pot' | 'gas';
  lane: number;
  ci: number;
  x: number;
  armed: boolean;
  hit: boolean;
}

export interface FuryRival {
  state: 'idle' | 'warn' | 'charge';
  at: number;
  coolUntil: number;
  x: number;
  laneAt: number;
}

export interface FuryState {
  simMs: number;
  dist: number;
  lane: number;
  pts: number;
  dmg: number;
  combo: number;
  seqIdx: number;
  seqDone: boolean;
  slowUntil: number;
  bonusMs: number;
  truePicks: number;
  falsePicks: number;
  rams: number;
  dodges: number;
  gasTaken: number;
  rival: FuryRival;
  ents: FuryEnt[];
  evPtr: number;
  citadelSeen: boolean;
  outcome: null | 'citadel' | 'cap';
  /** recent gameplay messages (toast feed), oldest first, capped */
  log: string[];
}

export function newFuryState(): FuryState {
  return {
    simMs: 0,
    dist: 0,
    lane: 1,
    pts: 0,
    dmg: 0,
    combo: 0,
    seqIdx: 0,
    seqDone: false,
    slowUntil: 0,
    bonusMs: 0,
    truePicks: 0,
    falsePicks: 0,
    rams: 0,
    dodges: 0,
    gasTaken: 0,
    rival: { state: 'idle', at: 0, coolUntil: 0, x: 0, laneAt: 1 },
    ents: [],
    evPtr: 0,
    citadelSeen: false,
    outcome: null,
    log: [],
  };
}

export function neededChip(world: FuryWorld, st: FuryState): Chip {
  return world.seq[Math.min(st.seqIdx, world.seq.length - 1)];
}

function say(st: FuryState, msg: string): void {
  st.log.push(msg);
  if (st.log.length > 10) st.log.shift();
}

function comboDrop(st: FuryState, diff: number, reason: string): void {
  st.combo = 0;
  if (diff >= 2 && st.rival.state === 'idle' && st.simMs >= st.rival.coolUntil) {
    st.rival.state = 'warn';
    st.rival.at = st.simMs;
    say(st, `${reason} — HORN! RIG ON YOUR TAIL`);
  } else {
    say(st, reason);
  }
}

function onSign(st: FuryState, world: FuryWorld, en: FuryEnt, diff: number): void {
  const pal = world.palette[en.ci];
  if (chipKey(pal) === chipKey(neededChip(world, st))) {
    st.truePicks++;
    st.combo++;
    st.pts += pickBaseFor(diff) + 5 * st.combo;
    if (!st.seqDone) {
      st.seqIdx++;
      if (st.seqIdx >= world.seq.length) {
        st.seqDone = true;
        st.pts += seqLockBonusFor(diff);
        say(st, `SEQUENCE LOCKED +${seqLockBonusFor(diff)}`);
      } else {
        say(st, `LOCK ${st.seqIdx}/${world.seq.length} — ${KIND_NAMES[pal.kind]}×${pal.n}`);
      }
    } else {
      say(st, `TRUE SKULL +${pickBaseFor(diff) + 5 * st.combo}`);
    }
  } else {
    st.falsePicks++;
    st.pts -= 10;
    comboDrop(st, diff, `FALSE IDOL — ${KIND_NAMES[pal.kind]}×${pal.n}?`);
  }
}

function onPot(st: FuryState): void {
  st.slowUntil = st.simMs + 900;
  st.dmg++;
  say(st, `SPIKES! INTEGRITY −${POT_DMG_HP}`);
}

function onGas(st: FuryState): void {
  st.gasTaken++;
  st.bonusMs = Math.min(MAX_BONUS_MS, st.bonusMs + GAS_BONUS_MS);
  say(st, `GUZZOLINE +${Math.round(GAS_BONUS_MS / 1000)}S`);
}

function updateRival(st: FuryState, dtSec: number, speed: number, diff: number): void {
  const r = st.rival;
  if (r.state === 'warn') {
    if (st.simMs - r.at >= HORN_MS) {
      r.state = 'charge';
      r.x = -60;
      r.laneAt = st.lane; // locks onto the lane AT charge time
    }
  } else if (r.state === 'charge') {
    r.x += speed * 1.45 * dtSec;
    if (r.x >= RIG_X - 46) {
      if (st.lane !== r.laneAt) {
        st.dodges++;
        st.pts += 15;
        say(st, 'SHOOK THE TAIL +15');
      } else {
        st.rams++;
        st.pts -= ramPenaltyFor(diff);
        say(st, `RAMMED −${ramPenaltyFor(diff)}`);
      }
      r.state = 'idle';
      r.coolUntil = st.simMs + 4500;
    }
  }
}

/** Fixed short templates — checklist #6: no truncation possible. */
export function summaryFor(st: FuryState, seqLen: number): string {
  if (st.outcome === 'citadel') return 'WHAT A DAY — CITADEL REACHED';
  if (st.seqDone) return `SEQUENCE LOCKED ${st.seqIdx}/${seqLen} · DMG ${st.dmg}`;
  return `STRANDED — SEQ ${st.seqIdx}/${seqLen} · DMG ${st.dmg}`;
}

/** Build the StageResult from a settled state (engine layers modifiers later). */
export function resultFor(st: FuryState, seqLen: number): StageResult {
  return {
    correct: st.outcome === 'citadel' || st.seqDone,
    points: Math.max(0, Math.min(500, st.pts | 0)),
    hpDelta: st.dmg > 0 ? -Math.min(POT_DMG_FLOOR, POT_DMG_HP * st.dmg) : 0,
    summary: summaryFor(st, seqLen).slice(0, 64),
  };
}

/**
 * Pure simulation step — the SAME math the scene ticks with. Mutates `st`,
 * sets `st.outcome` when the run settles (citadel reached — bonus paid HERE
 * exactly once — or cap: gas-extended run time clamped inside ctx.timerLen
 * minus the settle margin).
 */
export function advance(st: FuryState, world: FuryWorld, dtMs: number, depth: number, timerLenSec: number): void {
  if (st.outcome !== null) return;
  const diff = diffFor(depth);
  const speed = speedFor(diff);
  const dt = dtMs / 1000;

  st.simMs += dtMs;
  const v = speed * (st.simMs < st.slowUntil ? 0.55 : 1);
  st.dist += v * dt;

  while (st.evPtr < world.evs.length && world.evs[st.evPtr].t <= st.simMs) {
    const sp = world.evs[st.evPtr++];
    st.ents.push({ kind: sp.kind, lane: sp.lane, ci: sp.ci, x: SPAWN_X, armed: false, hit: false });
  }

  const warnDist = speed * POT_WARN_S;
  for (let i = st.ents.length - 1; i >= 0; i--) {
    const en = st.ents[i];
    en.x -= v * dt;
    if (en.kind === 'pot' && !en.armed && en.x - RIG_X < warnDist) en.armed = true;
    const overlap = en.x < RIG_X + 54 && en.x > RIG_X - 34 && en.lane === st.lane;
    if (overlap && !en.hit) {
      en.hit = true;
      if (en.kind === 'sign') onSign(st, world, en, diff);
      else if (en.kind === 'pot') onPot(st);
      else onGas(st);
    }
    if (en.x < KILL_X) {
      if (en.kind === 'sign' && !en.hit && chipKey(world.palette[en.ci]) === chipKey(neededChip(world, st))) {
        comboDrop(st, diff, `MISSED THE ${KIND_NAMES[world.palette[en.ci].kind]} SIGN`);
      }
      st.ents.splice(i, 1);
    }
  }

  updateRival(st, dt, v, diff);

  if (!st.citadelSeen && st.dist > totalDistFor(diff) * 0.82) {
    st.citadelSeen = true;
    say(st, 'CITADEL ON THE HORIZON');
  }
  if (st.dist >= totalDistFor(diff)) {
    st.outcome = 'citadel';
    st.pts += citadelBonusFor(diff);
    return;
  }
  if (st.simMs >= capNow(st.bonusMs, timerLenSec)) st.outcome = 'cap';
}

/** Greedy median-lane bot: dodge telegraphed spikes, chase the needed sign. */
export function botLane(st: FuryState, world: FuryWorld, depth: number): number {
  const speed = speedFor(diffFor(depth));
  const danger = (ln: number): boolean =>
    st.ents.some(
      (e) =>
        e.kind === 'pot' &&
        !e.hit &&
        e.lane === ln &&
        e.x > RIG_X - 60 &&
        e.x < RIG_X + 420 &&
        (e.armed || e.x - RIG_X < speed * POT_WARN_S * 1.6),
    );
  if (danger(st.lane)) {
    for (const ln of [st.lane - 1, st.lane + 1, st.lane - 2, st.lane + 2]) {
      if (ln >= 0 && ln < LANES && !danger(ln)) return ln;
    }
  }
  const need = chipKey(neededChip(world, st));
  let best = st.lane;
  let bestX = Number.POSITIVE_INFINITY;
  for (const e of st.ents) {
    if (e.kind !== 'sign' || e.hit || e.x < RIG_X) continue;
    if (chipKey(world.palette[e.ci]) !== need) continue;
    if (e.x < bestX) {
      bestX = e.x;
      best = e.lane;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

interface EntView {
  ent: FuryEnt;
  node: Container;
  g?: Graphics; // pots redraw while telegraphing
  armedDrawn?: boolean;
}

export function mountFury2(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const MOTION = typeof localStorage === 'undefined' || localStorage.getItem('IQB_MOTION') !== '0';
  const settle = onceResolve(ctx.onDone);
  const diff = diffFor(ctx.depth);
  const hue = T.boardHues[ctx.seed % T.boardHues.length];
  const world = buildWorld(ctx.seed, ctx.depth);
  const st = newFuryState();
  let dead = false;
  let paused = false;
  let armed = false; // goal card owns input until dismissed (checklist #1)

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = 0x120c06;
  root.addChild(bg);

  const sky = new Graphics();
  sky.rect(0, 0, STAGE_W, ROAD_TOP - 90).fill(0x3a1c0c);
  sky.rect(0, ROAD_TOP - 90, STAGE_W, 90).fill(0x57301a);
  sky.circle(STAGE_W * 0.78, ROAD_TOP - 130, 44).fill(0xff8c3a);
  root.addChild(sky);

  text(root, 'FURY ROADRUN · DEPTH ' + Math.max(1, ctx.depth | 0), STAGE_W / 2 - 190, 26, 24, T.gold, true);

  const road = new Graphics(); // redrawn per tick (dash scroll)
  root.addChild(road);

  const mesas = new Graphics(); // parallax silhouettes
  root.addChild(mesas);

  const entLayer = new Container();
  root.addChild(entLayer);

  const rivalG = new Graphics();
  const rigG = new Graphics();
  const citadelG = new Graphics();
  root.addChild(citadelG, rivalG, rigG);

  /* storm dust sits ABOVE the world but BELOW all HUD (NEXT chip never dims) */
  const dust = new Sprite(Texture.WHITE);
  dust.width = STAGE_W;
  dust.height = ROAD_BOT;
  dust.tint = 0x7a5a28;
  dust.alpha = 0;
  root.addChild(dust);

  /* ---- HUD (above dust; bottom band 784–900 reserved: pads center,
           status left, NEXT chip right, rule line lowest) ---- */
  const status = text(root, '', 40, 862, 16, T.ink, true);
  const toastBg = new Sprite(Texture.WHITE);
  toastBg.width = 860;
  toastBg.height = 42;
  toastBg.x = (STAGE_W - 860) / 2;
  toastBg.y = 340;
  toastBg.tint = 0x0a0602;
  toastBg.alpha = 0.82;
  toastBg.visible = false;
  root.addChild(toastBg);
  const toast = text(root, '', 0, 350, 15, '#ffd9a0', true);
  toast.anchor.set(0.5);
  toast.x = STAGE_W / 2;
  toast.visible = false;
  root.addChild(toast);
  text(root, 'COLLECT SIGNS IN ORDER · SPIKE TRAPS DAMAGE · ESC/P PAUSE · ESC QUITS NEUTRAL', STAGE_W / 2 - 320, 892, 12, T.muted);

  /* NEXT chip: glyph + family/count label — above the dust, never dimmed */
  const nextLabel = text(root, '', STAGE_W - 330, 852, 15, T.ink, true);
  let nextSpr: Sprite | null = null;
  let nextKeyDrawn = '';
  function drawNext(): void {
    const c = neededChip(world, st);
    const k = st.seqDone ? 'done' : chipKey(c);
    if (k === nextKeyDrawn) return;
    nextKeyDrawn = k;
    nextLabel.text = st.seqDone ? 'SEQUENCE ✓ LOCKED' : `NEXT: ${KIND_NAMES[c.kind]}×${c.n}`;
    nextLabel.style.fill = st.seqDone ? T.good : T.ink;
    if (nextSpr) {
      nextSpr.destroy();
      nextSpr = null;
    }
    if (!st.seqDone) {
      nextSpr = spriteFrom(tileCanvas(chipPrims(c.kind, c.n), hue, 44));
      nextSpr.x = STAGE_W - 382;
      nextSpr.y = 844;
      root.addChild(nextSpr);
    }
  }

  /* ---- entity views ---- */
  const views: EntView[] = [];
  const texCache = new Map<number, Sprite['texture']>();
  function signTexture(ci: number): Sprite['texture'] {
    let tx = texCache.get(ci);
    if (!tx) {
      const c = world.palette[ci];
      tx = spriteFrom(tileCanvas(chipPrims(c.kind, c.n), hue, 56)).texture;
      texCache.set(ci, tx);
    }
    return tx;
  }
  function spawnView(en: FuryEnt): void {
    const node = new Container();
    node.x = en.x;
    node.y = laneCenter(en.lane);
    const view: EntView = { ent: en, node };
    if (en.kind === 'sign') {
      const pole = new Graphics();
      pole.rect(25, 22, 6, 30).fill(0x241a10);
      node.addChild(pole);
      const spr = new Sprite(signTexture(en.ci));
      spr.x = 0;
      spr.y = -34;
      node.addChild(spr);
    } else if (en.kind === 'gas') {
      const g = new Graphics();
      g.rect(6, -14, 26, 22).fill(0x00e68a);
      g.rect(12, -19, 9, 6).fill(0x04361f);
      g.circle(19, -3, 4).fill(0x04361f);
      node.addChild(g);
    } else {
      const g = new Graphics();
      node.addChild(g);
      view.g = g;
    }
    entLayer.addChild(node);
    views.push(view);
  }
  function drawPotView(vw: EntView): void {
    const g = vw.g!;
    g.clear();
    g.circle(20, 8, 17).fill(0x0c0805);
    if (!vw.ent.armed) {
      // dashed amber telegraph ring, ~2.8 Hz blink (≤3 Hz rail)
      const on = ((st.simMs / 180) | 0) % 2 === 0;
      const col = on ? 0xffb01e : 0x7a5518;
      for (let a = 0; a < 12; a++) {
        const a0 = (a / 12) * Math.PI * 2;
        const a1 = a0 + Math.PI / 14;
        g.arc(20, 8, 23, a0, a1).stroke({ width: 3, color: col });
      }
    } else {
      for (let k = -1; k <= 1; k++) {
        g.moveTo(20 + k * 10, 12).lineTo(20 + k * 10, -6).stroke({ width: 2, color: 0xff2038 });
      }
    }
  }

  /* ---- toast ---- */
  let toastUntil = 0;
  function sayToast(msg: string, ms = 1600): void {
    toast.text = msg;
    toast.visible = true;
    toastBg.visible = true;
    toastUntil = st.simMs + ms;
  }

  /* ---- resolution ---- */
  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  /* ---- input ---- */
  function shiftLane(d: number): void {
    if (dead || paused || !armed || st.outcome !== null) return;
    st.lane = clampLane(st.lane + d);
    laneFlashUntil = st.simMs + 150; // checklist #3: same-tick feedback
  }
  function togglePause(): void {
    if (dead) return;
    paused = !paused;
    pauseCard.visible = paused;
  }

  const onKey = (e: KeyboardEvent): void => {
    if (dead) return;
    if (e.key === EscapeKey) {
      finish(escaped(resultFor(st, world.seq.length).hpDelta, 'ENGINE COOLS — ROAD ABANDONED'));
      return;
    }
    if (e.code === 'KeyP') {
      togglePause();
      return;
    }
    if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      shiftLane(-1);
    } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      shiftLane(1);
    }
  };
  window.addEventListener('keydown', onKey);

  root.eventMode = 'static';
  root.hitArea = new Rectangle(0, 0, STAGE_W, STAGE_H);
  const onTap = (e: FederatedPointerEvent): void => {
    if (!armed) return;
    if (e.global.y < ROAD_TOP + (ROAD_BOT - ROAD_TOP) / 3) shiftLane(-1);
    else if (e.global.y > ROAD_TOP + ((ROAD_BOT - ROAD_TOP) * 2) / 3) shiftLane(1);
  };
  root.on('pointerdown', onTap);

  /* on-screen pads (touch parity, ≥44 px, bottom-center band — no HUD overlap) */
  const PAD_Y = 792;
  const padUp = new Graphics();
  padUp.roundRect(STAGE_W / 2 - 110, PAD_Y, 88, 88, 12).fill(0x241708).stroke({ width: 2, color: 0x5c3d14 });
  padUp.moveTo(STAGE_W / 2 - 66, PAD_Y + 56).lineTo(STAGE_W / 2 - 52, PAD_Y + 32).lineTo(STAGE_W / 2 - 38, PAD_Y + 56).stroke({ width: 5, color: 0xffb01e });
  padUp.eventMode = 'static';
  padUp.cursor = 'pointer';
  padUp.on('pointerdown', () => shiftLane(-1));
  const padDown = new Graphics();
  padDown.roundRect(STAGE_W / 2 + 22, PAD_Y, 88, 88, 12).fill(0x241708).stroke({ width: 2, color: 0x5c3d14 });
  padDown.moveTo(STAGE_W / 2 + 66, PAD_Y + 32).lineTo(STAGE_W / 2 + 52, PAD_Y + 56).lineTo(STAGE_W / 2 + 38, PAD_Y + 32).stroke({ width: 5, color: 0xffb01e });
  padDown.eventMode = 'static';
  padDown.cursor = 'pointer';
  padDown.on('pointerdown', () => shiftLane(1));
  root.addChild(padUp, padDown);

  /* pause card (escapable overlay) */
  const pauseCard = new Container();
  const pcShade = new Sprite(Texture.WHITE);
  pcShade.width = STAGE_W;
  pcShade.height = STAGE_H;
  pcShade.tint = 0x0a0602;
  pcShade.alpha = 0.86;
  pauseCard.addChild(pcShade);
  text(pauseCard, 'PAUSED — ENGINE IDLES, NO TIME DIES', STAGE_W / 2 - 165, STAGE_H / 2 - 70, 17, '#ffd9a0', true);
  const resumeBtn = text(pauseCard, 'RESUME (ESC / P)', STAGE_W / 2 - 72, STAGE_H / 2, 15, T.gold, true);
  resumeBtn.eventMode = 'static';
  resumeBtn.cursor = 'pointer';
  resumeBtn.on('pointerdown', () => togglePause());
  pauseCard.visible = false;
  pauseCard.eventMode = 'static';
  root.addChild(pauseCard);

  /* ---- goal card (checklist #1/#4): title, controls, win condition, esc ---- */
  const goalCard = new Container();
  const gcShade = new Sprite(Texture.WHITE);
  gcShade.width = STAGE_W;
  gcShade.height = STAGE_H;
  gcShade.tint = 0x0a0602;
  gcShade.alpha = 0.88;
  goalCard.addChild(gcShade);
  const seqLine = world.seq.map((c) => `${KIND_NAMES[c.kind]}×${c.n}`).join(' → ');
  text(goalCard, 'FURY ROADRUN', STAGE_W / 2 - 92, STAGE_H / 2 - 170, 30, T.gold, true);
  text(goalCard, 'CONTROLS: W/S · ARROWS UP/DOWN · TAP TOP/BOTTOM · ▲▼ PADS', STAGE_W / 2 - 250, STAGE_H / 2 - 108, 15, T.ink);
  text(goalCard, `SEQUENCE: ${seqLine}`, STAGE_W / 2 - 190, STAGE_H / 2 - 76, 15, '#ffd9a0', true);
  text(goalCard, 'WIN: REACH THE CITADEL — OR LOCK THE FULL SEQUENCE BEFORE TIME', STAGE_W / 2 - 262, STAGE_H / 2 - 44, 15, T.good);
  text(goalCard, 'AVOID SPIKE TRAPS · GUZZOLINE BANKS +6S · FALSE SIGNS SUMMON THE RIVAL', STAGE_W / 2 - 292, STAGE_H / 2 - 12, 13, T.muted);
  text(goalCard, 'ESC — ABANDON (NEUTRAL)', STAGE_W / 2 - 96, STAGE_H / 2 + 28, 13, T.bad);
  const startBtn = text(goalCard, 'TAP TO START', STAGE_W / 2 - 56, STAGE_H / 2 + 72, 17, T.gold, true);
  startBtn.eventMode = 'static';
  startBtn.cursor = 'pointer';
  root.addChild(goalCard);
  function armNow(): void {
    if (armed) return;
    armed = true;
    goalCard.destroy({ children: true });
  }
  startBtn.on('pointerdown', () => armNow());

  /* ---- render helpers ---- */
  let laneFlashUntil = -1;
  let rigY: number | null = null;

  function drawRoad(): void {
    road.clear();
    road.rect(0, ROAD_TOP, STAGE_W, ROAD_BOT - ROAD_TOP).fill(0x1c150c);
    road.rect(0, ROAD_TOP - 4, STAGE_W, 4).fill(0x5c4a2a);
    road.rect(0, ROAD_BOT, STAGE_W, 4).fill(0x5c4a2a);
    const off = st.dist % 64;
    for (let ln = 1; ln < LANES; ln++) {
      const ly = ROAD_TOP + ((ROAD_BOT - ROAD_TOP) / LANES) * ln;
      for (let x = -off; x < STAGE_W; x += 64) {
        road.rect(x, ly - 1, 34, 2).fill(0x3a2d18);
      }
    }
    if (MOTION) {
      mesas.clear();
      const mo = (st.dist * 0.18) % 240;
      for (let m = -1; m < STAGE_W / 240 + 1; m++) {
        const mx = m * 240 - mo;
        mesas.moveTo(mx, ROAD_TOP).lineTo(mx + 60, ROAD_TOP - 46).lineTo(mx + 130, ROAD_TOP - 30).lineTo(mx + 190, ROAD_TOP).closePath().fill(0x241206);
      }
    }
  }

  function drawRigAt(g: Graphics, x: number, y: number, body: number, dark: number): void {
    g.rect(x - 44, y - 14, 58, 28).fill(dark);
    g.rect(x + 12, y - 11, 26, 22).fill(body);
    g.rect(x - 36, y + 12, 14, 8).fill(0x0c0805);
    g.rect(x + 14, y + 12, 14, 8).fill(0x0c0805);
    g.rect(x + 36, y - 6, 3, 4).fill(0xffe9c4);
  }

  function drawCitadel(): void {
    citadelG.clear();
    const frac = st.dist / totalDistFor(diff);
    if (frac <= 0.82) return;
    const ca = Math.min(1, (frac - 0.82) / 0.16);
    const cx0 = STAGE_W - ca * (STAGE_W * 0.42);
    citadelG.rect(cx0, ROAD_TOP - 70, STAGE_W - cx0, 70).fill({ color: 0xffb01e, alpha: 0.25 + 0.45 * ca });
    for (let tw = 0; tw < 5; tw++) {
      const tx = cx0 + (tw * (STAGE_W - cx0)) / 5;
      const th = tw % 2 ? 96 : 114;
      citadelG.rect(tx, ROAD_TOP - th, (STAGE_W - cx0) / 6, th).fill(0x241206);
    }
  }

  function stormAlpha(): number {
    const peak = 0.46 + diff * 0.04;
    let a = 0;
    for (const start of world.storms) {
      const dt = st.simMs - start;
      if (dt < 0) continue;
      if (dt < 800) a += peak * (dt / 800);
      else if (dt < 3000) a += peak;
      else if (dt < 3800) a += peak * (1 - (dt - 3000) / 800);
    }
    return Math.min(0.72, a);
  }

  const stormsWarned: boolean[] = world.storms.map(() => false);

  /* ---- clock ---- */
  let cardMs = 0;
  const onTick = (tk: Ticker): void => {
    if (dead) return;
    const dt = Math.min(64, tk.deltaMS);

    if (!armed) {
      // goal card window: sim frozen; auto-arm after GOAL_CARD_MS
      cardMs += dt;
      if (cardMs >= GOAL_CARD_MS) armNow();
      return;
    }

    if (!paused && st.outcome === null) {
      advance(st, world, dt, ctx.depth, ctx.timerLen);

      for (let si = 0; si < world.storms.length; si++) {
        if (!stormsWarned[si] && st.simMs >= world.storms[si] - STORM_WARN_MS) {
          stormsWarned[si] = true;
          sayToast('SANDSTORM INBOUND', 1200);
        }
      }
      if (st.log.length > 0) {
        sayToast(st.log[st.log.length - 1]);
      }

      if (st.outcome !== null) {
        finish(resultFor(st, world.seq.length));
        return;
      }
    }

    /* --- draw --- */
    drawRoad();
    drawCitadel();

    // entity views: spawn/despawn/refresh (spawn order == view order)
    while (views.length < st.ents.length) spawnView(st.ents[views.length]);
    for (let i = views.length - 1; i >= 0; i--) {
      const vw = views[i];
      if (!st.ents.includes(vw.ent)) {
        vw.node.destroy({ children: true });
        views.splice(i, 1);
        continue;
      }
      vw.node.x = vw.ent.x;
      vw.node.y = laneCenter(vw.ent.lane);
      if (vw.g && (!vw.armedDrawn || !vw.ent.armed)) {
        drawPotView(vw);
        vw.armedDrawn = vw.ent.armed;
      }
    }

    // rigs
    const targetY = laneCenter(st.lane);
    if (rigY === null) rigY = targetY;
    rigY += (targetY - rigY) * 0.28;
    rigG.clear();
    drawRigAt(rigG, RIG_X + 20, rigY, 0xb3402a, 0x571e10);
    if (st.simMs < laneFlashUntil) {
      rigG.circle(RIG_X + 27, rigY, 46).stroke({ width: 3, color: 0xffd9a0, alpha: 0.9 });
    }
    if (MOTION && ((st.simMs / 90) | 0) % 2 === 0) {
      rigG.circle(RIG_X - 32, rigY - 4, 7).fill({ color: 0xc8aa82, alpha: 0.18 });
    }
    rivalG.clear();
    if (st.rival.state === 'charge') {
      drawRigAt(rivalG, st.rival.x, laneCenter(st.rival.laneAt), 0x30160e, 0x180a05);
      if (((st.simMs / 160) | 0) % 2 === 0) {
        rivalG.circle(st.rival.x + 2, laneCenter(st.rival.laneAt) - 30, 3).fill(0xff2038);
      }
    } else if (st.rival.state === 'warn') {
      const on = ((st.simMs / 140) | 0) % 2 === 0;
      const cy = laneCenter(st.lane);
      rivalG.moveTo(RIG_X - 66, cy - 8).lineTo(RIG_X - 84, cy).lineTo(RIG_X - 66, cy + 8).stroke({ width: 4, color: on ? 0xff2038 : 0x7a2018 });
    }

    // dust + HUD
    dust.alpha = stormAlpha();
    const remain = Math.max(0, Math.ceil((capNow(st.bonusMs, ctx.timerLen) - st.simMs) / 1000));
    status.text =
      `TIME ${remain}S${st.bonusMs ? '+' + Math.round(st.bonusMs / 1000) : ''}` +
      ` · ROAD ${Math.min(99, Math.round((st.dist / totalDistFor(diff)) * 100))}%` +
      ` · COMBO x${st.combo} · DMG ${st.dmg}`;
    status.style.fill = st.dmg > 0 ? T.bad : T.ink;
    drawNext();

    if (st.simMs > toastUntil) {
      toast.visible = false;
      toastBg.visible = false;
    }
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.off('pointerdown', onTap);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  drawNext();
}

/* escape key name kept symbolic so the rail reads plainly */
const EscapeKey = 'Escape';

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // 1) schedule validity + determinism over 300 seeds × depths
  for (let seed = 1; seed <= 300; seed++) {
    const depth = 1 + ((seed * 7) % 21);
    const a = buildWorld(seed, depth);
    const b = buildWorld(seed, depth);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failures.push(`world nondeterministic seed=${seed}`);
      break;
    }
    const diff = diffFor(depth);
    if (a.seq.length !== seqLenFor(diff)) failures.push(`bad seq len seed=${seed}`);
    const keys = new Set(a.seq.map(chipKey));
    if (keys.size !== a.seq.length) failures.push(`duplicate seq chip seed=${seed}`);
    let lastT = 0;
    for (const e of a.evs) {
      if (e.t < lastT) {
        failures.push(`evs unsorted seed=${seed}`);
        break;
      }
      lastT = e.t;
      if (e.lane < 0 || e.lane >= LANES) failures.push(`bad lane seed=${seed}`);
      if (e.kind === 'sign' && (e.ci < 0 || e.ci >= a.palette.length)) failures.push(`bad ci seed=${seed}`);
    }
    // decoys only at diff>=3, and every decoy shares a family but never a key
    if (diff >= 3) {
      for (const p of a.palette) {
        if (keys.has(chipKey(p))) continue;
        if (!a.seq.some((s) => s.kind === p.kind && s.n !== p.n)) failures.push(`stray palette entry seed=${seed}`);
      }
    } else if (a.palette.length !== a.seq.length) {
      failures.push(`decoys before diff 3 seed=${seed}`);
    }
    if (failures.length > 0) break;
  }

  // 2) F9-style variance guard: schedules actually vary across seeds
  const variants = new Set<string>();
  for (let seed = 1; seed <= 300; seed++) variants.add(JSON.stringify(buildWorld(seed, 7)));
  if (variants.size < 290) failures.push(`world seed-blind: only ${variants.size} distinct over 300 seeds`);

  // 3) ladder + payout curves match the documented formulas, monotone in diff
  for (let d = 1; d <= 5; d++) {
    if (diffFor(1 + (d - 1) * 6) !== d) failures.push(`diffFor ladder broken at d=${d}`);
  }
  if (pickBaseFor(3) !== 44 || seqLockBonusFor(3) !== 84 || citadelBonusFor(3) !== 192 || ramPenaltyFor(3) !== 30) {
    failures.push('payout formulas drifted from documented curve');
  }
  if (!(pickBaseFor(1) < pickBaseFor(5) && citadelBonusFor(1) < citadelBonusFor(5))) {
    failures.push('payouts not monotone in diff');
  }

  // 4) lane clamp + cap arithmetic (gas can never push past timerLen)
  if (clampLane(-4) !== 0 || clampLane(2) !== 2 || clampLane(9) !== 2) failures.push('clampLane broken');
  if (capNow(MAX_BONUS_MS, 30) !== 30 * 1000 - SETTLE_MS) failures.push('cap ignores timerLen');
  if (capNow(0, 90) !== CAP_MS) failures.push('cap should be CAP_MS when budget allows');

  // 5) 300-seed bot play: determinism, budget fit, result invariants
  let citadels = 0;
  let locks = 0;
  const ratios: number[] = [];
  for (let seed = 1; seed <= 300; seed++) {
    const depth = 1 + ((seed * 11) % 42);
    const timerLen = 45;
    const w = buildWorld(seed, depth);
    const sa = newFuryState();
    while (sa.outcome === null && sa.simMs < 120000) {
      sa.lane = botLane(sa, w, depth);
      advance(sa, w, 16, depth, timerLen);
    }
    const sb = newFuryState();
    while (sb.outcome === null && sb.simMs < 120000) {
      sb.lane = botLane(sb, w, depth);
      advance(sb, w, 16, depth, timerLen);
    }
    if (JSON.stringify(sa) !== JSON.stringify(sb)) {
      failures.push(`sim nondeterministic seed=${seed}`);
      break;
    }
    if (sa.outcome === null) {
      failures.push(`sim never resolved seed=${seed}`);
      break;
    }
    const limit = capNow(sa.bonusMs, timerLen);
    if (sa.simMs > limit + 17) failures.push(`budget overflow seed=${seed} simMs=${sa.simMs} limit=${limit}`);
    const r = resultFor(sa, w.seq.length);
    if (r.points < 0 || r.points > 500) failures.push(`points out of band seed=${seed} pts=${r.points}`);
    if (r.hpDelta > 0 || r.hpDelta < -POT_DMG_FLOOR) failures.push(`hpDelta out of band seed=${seed} hp=${r.hpDelta}`);
    if (r.summary.length > 64) failures.push(`summary too long seed=${seed}`);
    if (typeof r.correct !== 'boolean') failures.push(`correct not settled seed=${seed}`);
    if (sa.outcome === 'citadel') citadels++;
    if (sa.seqDone) locks++;
    ratios.push(r.points / (100 * diffFor(depth) + 40));
    if (failures.length > 0) break;
  }
  // mechanics alive: the bot's median play must sometimes lock the sequence
  // and sometimes reach the citadel pre-cap (v1 balance-probe contract)
  if (locks < 30) failures.push(`sequence rarely locks under bot play (${locks}/300)`);
  if (citadels < 10) failures.push(`citadel rarely reached under bot play (${citadels}/300)`);

  // 6) short timer: cap clamp forces resolution well inside the engine timer
  for (let seed = 1; seed <= 40; seed++) {
    const w = buildWorld(seed, 7);
    const s = newFuryState();
    while (s.outcome === null && s.simMs < 60000) {
      s.lane = botLane(s, w, 7);
      advance(s, w, 16, 7, 15);
    }
    if (s.outcome === null || s.simMs > 15 * 1000 - SETTLE_MS + 17) {
      failures.push(`short-timer overrun seed=${seed} simMs=${s.simMs}`);
      break;
    }
  }

  // 7) exact payout walk-through: scripted true/decoy/lock picks
  {
    const w: FuryWorld = {
      seq: [{ kind: 0, n: 2 }, { kind: 1, n: 3 }],
      palette: [{ kind: 0, n: 2 }, { kind: 1, n: 3 }, { kind: 0, n: 5 }],
      evs: [],
      storms: [],
    };
    const diff = 2;
    const s = newFuryState();
    onSign(s, w, { kind: 'sign', lane: 1, ci: 0, x: 0, armed: false, hit: true }, diff); // true, combo 1
    if (s.pts !== pickBaseFor(diff) + 5 || s.seqIdx !== 1) failures.push('true pick payout wrong');
    onSign(s, w, { kind: 'sign', lane: 1, ci: 2, x: 0, armed: false, hit: true }, diff); // decoy shade
    if (s.pts !== pickBaseFor(diff) + 5 - 10 || s.combo !== 0 || s.falsePicks !== 1) failures.push('decoy penalty wrong');
    onSign(s, w, { kind: 'sign', lane: 1, ci: 1, x: 0, armed: false, hit: true }, diff); // completes lock
    const expect = pickBaseFor(diff) + 5 - 10 + pickBaseFor(diff) + 5 + seqLockBonusFor(diff);
    if (!s.seqDone || s.pts !== expect) failures.push('sequence lock payout wrong');
    if (resultFor(s, w.seq.length).correct !== true) failures.push('locked run should be correct');
    if (resultFor(s, w.seq.length).summary.includes('undefined')) failures.push('summary template broken');
  }

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/scenes/takeovers/fury2.ts
 * Also prints the bot-median points-vs-ladder-par band (balance probe). */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/fury2.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] FURY ROADRUN OK' : `[selftest] FURY ROADRUN FAIL\n  ${r.failures.join('\n  ')}`);
  const pts: number[] = [];
  for (let seed = 1; seed <= 200; seed++) {
    const depth = 1 + ((seed * 11) % 42);
    const w = buildWorld(seed, depth);
    const s = newFuryState();
    while (s.outcome === null && s.simMs < 120000) {
      s.lane = botLane(s, w, depth);
      advance(s, w, 16, depth, 45);
    }
    pts.push(resultFor(s, w.seq.length).points / (100 * diffFor(depth) + 40));
  }
  pts.sort((a, b) => a - b);
  const med = pts[Math.floor(pts.length / 2)];
  console.log(
    `[balance] bot points / ladder par: p10=${pts[Math.floor(pts.length * 0.1)].toFixed(2)} ` +
      `median=${med.toFixed(2)} p90=${pts[Math.floor(pts.length * 0.9)].toFixed(2)} (band target 0.60–1.35)`,
  );
  process.exitCode = r.ok ? 0 : 1;
}
