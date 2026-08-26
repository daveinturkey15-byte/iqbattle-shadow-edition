/**
 * SKY FIRE — takeover scene (v2 port of modes/skylaser.js, mechanic not code).
 *
 * GOOD-world no-fail stage: a caped sentinel circles overhead while hostile
 * recon drones hide among a civilian crowd below. YOU mark the hostiles
 * (click / keyboard), he threads heat-vision columns down YOUR marked lanes,
 * civilians misfired cost points (floored at -30), and every outcome ends in
 * a hover-salute heal (+10 hp). There is NO fail state — he still saves the
 * city.
 *
 * Flow: goal card -> 3 waves of {brief -> mark -> telegraph -> staggered
 * column-beam pass} -> salute -> resolve. Input stays locked behind the goal
 * card for its whole duration (<2 s); Esc bails neutral any time.
 * Self-resolves well inside ctx.timerLen (watchdog clamps the show clock).
 *
 * Determinism: every wave layout, star field, skyline and the hero's patrol
 * orbit are pure functions of an own mulberry32 seeded from ctx.seed, drawn
 * in a fixed order. Zero Math.random, zero Date.now — the clock is Pixi's
 * shared ticker delta only. Marking/scoring never depends on animation.
 *
 * Fairness rails: drones vs civilians differ by SILHOUETTE (angular chevron +
 * rotor dots vs round-headed figure), never hue alone; legend rendered every
 * wave. Heat-vision flashes are COLUMN-GUTTER-LOCALIZED only (never
 * fullscreen), white-hot core <150 ms — under the 200 ms / 3 Hz caps by
 * construction. Civilian misfire feedback is INSTANT (localized red ring
 * pulse <=200 ms + persistent caption; drone marks flip the gold reticle the
 * same frame). Marked lanes shimmer 350 ms before fire. IQB_MOTION off (or
 * prefers-reduced-motion) freezes the hero into a static hover with identical
 * judgment math. Text >= 11 px everywhere; ink-on-navy contrast throughout.
 * Summaries <= 48 chars (under the 64-char punch cap, never truncated).
 */
import { Container, Graphics, Sprite, Texture, Ticker } from 'pixi.js';
import type { Prim } from '../../glyphs.ts';
import { cellCanvas, tileCanvas } from '../../glyphs.ts';
import { panel, text } from '../game.ts';
import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import { mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested)                                            */
/* ------------------------------------------------------------------ */

const SKY_SALT = 0x5c47f1e3;

export const WAVE_COUNT = 3;
export const COLS = 5;
export const ROWS = 3;
export const SLOTS = COLS * ROWS;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Shared takeover difficulty ladder: 1..5 over depth. */
export function diffFor(depth: number): number {
  return Math.min(5, Math.max(1, 1 + Math.floor(Math.max(0, depth - 1) / 6)));
}
/** Hostiles per wave: 3 -> 6, linear to depth 7. */
export function droneCountFor(depth: number): number {
  return clamp(3 + Math.floor((Math.max(1, depth) - 1) / 2), 3, 6);
}
/** Civilians per wave: 2 -> 5, linear to depth 10. */
export function civCountFor(depth: number): number {
  return clamp(2 + Math.floor((Math.max(1, depth) - 1) / 3), 2, 5);
}
/** Comfortable marking window: 4400 -> 2600 ms, linear to depth 12. */
export function markMsFor(depth: number): number {
  return clamp(4400 - 160 * (Math.max(1, depth) - 1), 2600, 4400);
}

export type CellKind = 'drone' | 'civ' | null;
export interface SkyWave {
  cells: CellKind[];
  drones: number;
  civs: number;
}

/**
 * Seeded wave layouts: Fisher-Yates over the SLOTS grid positions in a fixed
 * rng-draw order — identical choreography for host and clients (seeded-sim).
 */
export function buildWaves(rng: () => number, depth: number): SkyWave[] {
  const drones = droneCountFor(depth);
  const civs = civCountFor(depth);
  const waves: SkyWave[] = [];
  for (let w = 0; w < WAVE_COUNT; w++) {
    const idx: number[] = [];
    for (let i = 0; i < SLOTS; i++) idx.push(i);
    for (let j = SLOTS - 1; j > 0; j--) {
      const k = Math.floor(rng() * (j + 1));
      const tmp = idx[j];
      idx[j] = idx[k];
      idx[k] = tmp;
    }
    const cells: CellKind[] = new Array<CellKind>(SLOTS).fill(null);
    for (let d = 0; d < drones; d++) cells[idx[d]] = 'drone';
    for (let c = 0; c < civs; c++) cells[idx[drones + c]] = 'civ';
    waves.push({ cells, drones, civs });
  }
  return waves;
}

/* ---- show timeline ---- */

/** Goal card dwell: under 2 s, input locked while it shows. */
export const INTRO_MS = 1500;
export const BRIEF_MS = 600;
export const SALUTE_MS = 1400;
export const TELEGRAPH_MS = 350; // lane shimmer before fire (fairness rail)
export const BEAM_GAP = 300; // stagger between lanes
export const BEAM_MS = 300; // per-lane beam lifetime
export const BEAM_TAIL = 480;
export const AUTO_DELAY = 400; // grace between full mark and auto-fire
export const HIT_AT = 135; // white-hot core window (<150 ms flash cap)
export const VAPOR_FADE_MS = 900;
const MIN_MARK_MS = 1100;

/** Longest possible beam pass (all 5 lanes staggered). */
export const BEAM_PASS_MAX = TELEGRAPH_MS + COLS * BEAM_GAP + BEAM_TAIL;

export interface SkyPlan {
  intro: number;
  brief: number;
  markMs: number;
  beamMax: number;
  salute: number;
  /** worst-case whole-show duration; fits inside timerLen for tl >= 18 s */
  total: number;
}

/**
 * Scale the per-wave marking window so the whole show fits the round timer
 * (for sane timerLen), never below MIN_MARK_MS and never above the depth
 * comfort curve. The scene's watchdog additionally guarantees resolution
 * before the engine timer for ANY timerLen.
 */
export function planShow(timerLenSec: number, depth: number): SkyPlan {
  const budget = Math.max(6, timerLenSec) * 1000 - 900;
  const fixed = INTRO_MS + WAVE_COUNT * (BRIEF_MS + BEAM_PASS_MAX) + SALUTE_MS;
  const markMs = clamp(Math.floor((budget - fixed) / WAVE_COUNT), MIN_MARK_MS, markMsFor(depth));
  return {
    intro: INTRO_MS,
    brief: BRIEF_MS,
    markMs,
    beamMax: BEAM_PASS_MAX,
    salute: SALUTE_MS,
    total: fixed + markMs * WAVE_COUNT,
  };
}

/* ---- scoring economics ---- */

export const CIV_PTS = 30;
export const POINTS_FLOOR = -30;
export const SALUTE_HP = 10;

/** Per-wave payout iff >=1 drone vaporized; perfect run stays under puzzle ceiling. */
export function wavePay(diff: number): number {
  return 20 + 18 * diff;
}

/** CLOSE CALL: at least one civilian misfire in EVERY wave. */
export function isCloseCall(civPerWave: readonly number[]): boolean {
  for (let i = 0; i < WAVE_COUNT; i++) if (!civPerWave[i]) return false;
  return true;
}

/**
 * Final tally: wavePay/wave cleared, -30 per civilian hit, HALVED on CLOSE
 * CALL, floored at -30 — a no-fail good world never bankrupts you ("he
 * covers the damages").
 */
export function tally(wavesScored: number, civHits: number, closeCall: boolean, diff: number): number {
  const raw = wavePay(diff) * wavesScored - CIV_PTS * civHits;
  const v = closeCall ? Math.round(raw / 2) : raw;
  return Math.max(POINTS_FLOOR, v);
}

export interface SkyVerdict {
  correct: boolean;
  points: number;
  hpDelta: number;
  summary: string;
}

/** Verdict ladder — ALWAYS a save; only flavor and the point total vary. */
export function verdictFor(wavesScored: number, civHits: number, closeCall: boolean, diff: number): SkyVerdict {
  let summary: string;
  if (closeCall) summary = 'CLOSE CALL · HE STILL SAVED IT';
  else if (civHits > 0) summary = 'CITY SAVED · CROWD SCATTERED';
  else if (wavesScored >= WAVE_COUNT) summary = 'CLEAN SWEEP · CITY SAVED';
  else if (wavesScored > 0) summary = 'CITY SAVED · SOME GOT AWAY';
  else summary = 'HE SAVED IT ALONE';
  return {
    correct: true,
    points: tally(wavesScored, civHits, closeCall, diff),
    hpDelta: SALUTE_HP,
    summary: summary.length <= 48 ? summary : summary.slice(0, 48),
  };
}

/* ------------------------------------------------------------------ */
/* Glyph primitives (DNA marks — silhouette carries the difference)     */
/* ------------------------------------------------------------------ */

/** Angular chevron hull + rotor dots + core dot. */
export function dronePrims(): Prim[] {
  return [
    { k: 'tri', x: 50, y: 54, s: 26 },
    { k: 'dot', x: 22, y: 32, r: 4 },
    { k: 'dot', x: 78, y: 32, r: 4 },
    { k: 'dot', x: 50, y: 58, r: 4 },
  ];
}

/** Round-headed figure: head dot + shoulder V + ground line. */
export function civPrims(): Prim[] {
  return [
    { k: 'dot', x: 50, y: 32, r: 12 },
    { k: 'line', x1: 32, y1: 72, x2: 50, y2: 52 },
    { k: 'line', x1: 50, y1: 52, x2: 68, y2: 72 },
    { k: 'line', x1: 30, y1: 74, x2: 70, y2: 74 },
  ];
}

/** Corner-bracket reticle drawn OVER a marked hostile. */
function reticlePrims(): Prim[] {
  return [
    { k: 'line', x1: 12, y1: 12, x2: 12, y2: 30 },
    { k: 'line', x1: 12, y1: 12, x2: 30, y2: 12 },
    { k: 'line', x1: 88, y1: 12, x2: 88, y2: 30 },
    { k: 'line', x1: 88, y1: 12, x2: 70, y2: 12 },
    { k: 'line', x1: 12, y1: 88, x2: 12, y2: 70 },
    { k: 'line', x1: 12, y1: 88, x2: 30, y2: 88 },
    { k: 'line', x1: 88, y1: 88, x2: 88, y2: 70 },
    { k: 'line', x1: 88, y1: 88, x2: 70, y2: 88 },
  ];
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

/* stage geometry (logical 1600x900 space) */
const GX = 200;
const GY = 340;
const GW = 1200;
const GH = 300;
const CW = GW / COLS;
const CH = GH / ROWS;
const GROUND_Y = GY + GH + 16;
const TILE = 92;
const HERO_Y = 178;

interface LaneBeam {
  col: number;
  start: number;
  hit: number;
  done: boolean;
}

function motionOn(): boolean {
  try {
    const v = localStorage.getItem('IQB_MOTION');
    if (v != null && JSON.parse(v) === false) return false;
  } catch { /* gate optional */ }
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  } catch { /* gate optional */ }
  return true;
}

export function mountSkyFire2(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const settle = onceResolve(ctx.onDone);
  const motion = motionOn();
  const depth = Math.max(1, Math.floor(ctx.depth));
  const diff = diffFor(depth);
  const hue = T.boardHues[(ctx.seed >>> 11) % T.boardHues.length];
  const plan = planShow(ctx.timerLen, depth);

  /* seeded world — fixed draw order: waves, stars, skyline, orbit */
  const rng = mulberry32((ctx.seed ^ SKY_SALT) >>> 0);
  const waves = buildWaves(rng, depth);
  const stars: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 46; i++) stars.push({ x: rng(), y: rng() * 0.24 });
  const buildings: Array<{ h: number; w: number }> = [];
  for (let i = 0; i < 14; i++) buildings.push({ h: 24 + rng() * 62, w: 80 + rng() * 96 });
  const orbit = { rx: 210 + rng() * 130, omega: 0.55 + rng() * 0.4, phase: rng() * Math.PI * 2 };

  /* ---- ambience ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = 0x050d26;
  root.addChild(bg);

  const skyG = new Graphics();
  skyG.rect(0, 0, STAGE_W, GROUND_Y).fill({ color: 0x0b1e4a, alpha: 0.55 });
  for (const st of stars) skyG.rect(st.x * STAGE_W, st.y * STAGE_H, 2, 2).fill({ color: 0xbfeaff, alpha: 0.7 });
  root.addChild(skyG);

  let bx = 0;
  const cityG = new Graphics();
  for (const b of buildings) {
    cityG.rect(bx, GROUND_Y - b.h, b.w, b.h).fill(0x08122e);
    bx += b.w;
    if (bx > STAGE_W) break;
  }
  cityG.rect(0, GROUND_Y, STAGE_W, STAGE_H - GROUND_Y).fill(0x061027);
  root.addChild(cityG);

  const guideG = new Graphics();
  for (let c = 0; c < COLS; c++) {
    const cx = GX + (c + 0.5) * CW;
    guideG.moveTo(cx, GY - 10).lineTo(cx, GROUND_Y).stroke({ width: 1, color: 0x66e0ff, alpha: 0.1 });
  }
  root.addChild(guideG);

  /* ---- chrome (HUD band above the grid; nothing overlaps the tiles) ---- */
  text(root, 'SKY FIRE', STAGE_W / 2 - 82, 44, 30, hue, true);
  text(root, `A FRIEND IS UP THERE · DEPTH ${depth}`, STAGE_W / 2 - 150, 86, 13, T.muted);
  const hud = text(root, '', 60, 118, 15, hue, true);
  const pips = text(root, '', STAGE_W - 190, 118, 15, T.gold, true);
  const foot = text(root, '', STAGE_W / 2 - 280, 772, 17, T.ink, true);
  text(
    root,
    'CLICK ANGLER DRONES TO MARK · SPARE THE ROUND HEADS · SPACE/F EARLY · ESC BAILS',
    STAGE_W / 2 - 310,
    812,
    13,
    T.muted,
  );

  /* ---- dynamic layers ---- */
  const beamsG = new Graphics();
  const ringsG = new Graphics();
  root.addChild(beamsG, ringsG);

  const droneTex = Texture.from(tileCanvas(dronePrims(), hue, TILE));
  const civTex = Texture.from(tileCanvas(civPrims(), '#ffd9a0', TILE));
  const emptyTex = Texture.from(tileCanvas([], hue, TILE));
  const reticleTex = Texture.from(cellCanvas(reticlePrims(), T.gold, TILE));

  const tiles: Sprite[] = [];
  const reticles: Sprite[] = [];
  for (let s = 0; s < SLOTS; s++) {
    const sp = new Sprite(emptyTex);
    sp.anchor.set(0.5, 0.5);
    sp.x = GX + ((s % COLS) + 0.5) * CW;
    sp.y = GY + (Math.floor(s / COLS) + 0.5) * CH;
    sp.eventMode = 'static';
    sp.cursor = 'pointer';
    const slot = s;
    sp.on('pointerdown', () => markSlot(slot));
    root.addChild(sp);
    tiles.push(sp);

    const rt = new Sprite(reticleTex);
    rt.anchor.set(0.5, 0.5);
    rt.x = sp.x;
    rt.y = sp.y;
    rt.visible = false;
    root.addChild(rt);
    reticles.push(rt);
  }

  const cursorG = new Graphics();
  root.addChild(cursorG);

  /* hero: caped sentinel built once, moved per tick */
  const heroC = new Container();
  const heroG = new Graphics();
  const HS = 46;
  heroG.moveTo(-HS * 0.28, -HS * 0.3)
    .quadraticCurveTo(-HS * 0.95, HS * 0.2, -HS * 0.3, HS * 1.05)
    .lineTo(HS * 0.3, HS * 1.05)
    .quadraticCurveTo(HS * 0.95, HS * 0.2, HS * 0.28, -HS * 0.3)
    .closePath()
    .fill(0xff2038);
  heroG.rect(-HS * 0.24, -HS * 0.25, HS * 0.48, HS).fill(0x275fb0);
  heroG.circle(0, -HS * 0.48, HS * 0.26).fill(0xf0c896);
  const armG = new Graphics();
  armG.moveTo(HS * 0.2, HS * 0.1)
    .lineTo(HS * 0.62, -HS * 0.72)
    .stroke({ width: Math.max(3, HS * 0.16), color: 0x275fb0 });
  armG.circle(HS * 0.64, -HS * 0.82, HS * 0.13).fill(0xf0c896);
  armG.visible = false;
  heroC.addChild(heroG, armG);
  root.addChild(heroC);

  /* ---- goal card: title / controls / win condition, input locked under it ---- */
  const card = panel(root, STAGE_W / 2 - 400, 300, 800, 190);
  text(card, 'SKY FIRE', 330, 22, 26, hue, true);
  text(card, 'HOSTILE RECON DRONES HIDE IN THE CROWD BELOW.', 96, 68, 16, T.ink, true);
  text(card, 'MARK THE ANGLER DRONES — HE FIRES YOUR LANES.', 96, 98, 16, T.ink, true);
  text(card, 'SPARE THE ROUND HEADS (-30 EACH) · CITY SAVED = +10 HP', 96, 128, 16, T.good, true);
  text(card, 'CLICK / ARROWS + ENTER · SPACE FIRES EARLY · ESC BAILS', 96, 158, 13, T.muted);

  /* ---- state machine ---- */
  let dead = false;
  let phase: 'intro' | 'brief' | 'mark' | 'beam' | 'salute' = 'intro';
  let waveIdx = 0;
  let phaseMs = 0;
  let clockMs = 0;
  const marked: boolean[] = new Array<boolean>(SLOTS).fill(false);
  const vaporized: boolean[] = new Array<boolean>(SLOTS).fill(false);
  const vaporBorn: number[] = new Array<number>(SLOTS).fill(0);
  const warns: Array<{ slot: number; born: number }> = [];
  let beams: LaneBeam[] = [];
  let beamEndAt = 0;
  let autoFireAt: number | null = null;
  let sel = 0;
  let wavesScored = 0;
  let civHits = 0;
  const civPerWave = [0, 0, 0];

  const curWave = (): SkyWave => waves[waveIdx];
  const colOf = (slot: number): number => slot % COLS;
  const markedCount = (): number => marked.reduce((n, m) => n + (m ? 1 : 0), 0);
  const vaporizedCount = (): number => vaporized.reduce((n, v) => n + (v ? 1 : 0), 0);

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function refreshHud(): void {
    let pipStr = '';
    for (let i = 0; i < WAVE_COUNT; i++) pipStr += i < wavesScored ? '\u25C6' : '\u25C7';
    pips.text = pipStr;
    hud.text =
      phase === 'mark'
        ? `WAVE ${waveIdx + 1}/${WAVE_COUNT} · MARKED ${markedCount()}/${curWave().drones}`
        : `WAVE ${Math.min(waveIdx + 1, WAVE_COUNT)}/${WAVE_COUNT}`;
  }

  function dismissCard(): void {
    card.visible = false;
  }

  function startBrief(i: number): void {
    if (dead) return;
    waveIdx = i;
    phaseMs = 0;
    phase = 'brief';
    marked.fill(false);
    vaporized.fill(false);
    warns.length = 0;
    beams = [];
    autoFireAt = null;
    for (let s = 0; s < SLOTS; s++) {
      const kind = curWave().cells[s];
      tiles[s].texture = kind === 'drone' ? droneTex : kind === 'civ' ? civTex : emptyTex;
      tiles[s].visible = true;
      reticles[s].visible = false;
    }
    foot.text = `WAVE ${i + 1}/${WAVE_COUNT} — MARK THE ANGLERS · SPARE THE ROUND HEADS`;
    refreshHud();
  }

  function startMark(): void {
    if (dead) return;
    phaseMs = 0;
    phase = 'mark';
    foot.text = 'CLICK THE HOSTILES · SPACE/F WHEN READY';
    refreshHud();
  }

  /** Toggle a mark (drone) or register a misfire (civilian). Instant feedback. */
  function markSlot(slot: number): boolean {
    if (dead || phase !== 'mark') return false;
    const s = clamp(Math.floor(slot), 0, SLOTS - 1);
    const kind = curWave().cells[s];
    if (kind === 'drone') {
      marked[s] = !marked[s]; // reticle flips THIS frame — sub-100 ms feedback
      reticles[s].visible = marked[s];
      if (marked[s] && markedCount() >= curWave().drones) autoFireAt = phaseMs + AUTO_DELAY;
      refreshHud();
      return true;
    }
    if (kind === 'civ') {
      civHits++;
      civPerWave[waveIdx]++;
      warns.push({ slot: s, born: clockMs }); // ring pulse renders next frame
      foot.text = 'INNOCENTS BELOW! — WATCH YOUR FIRE (-30)';
      return false;
    }
    return false;
  }

  /** Lane telegraph -> staggered column beams -> vaporize -> next wave. */
  function fireWave(): void {
    if (dead || phase !== 'mark') return;
    phase = 'beam';
    phaseMs = 0;
    autoFireAt = null;
    const laneSet = new Set<number>();
    for (let s = 0; s < SLOTS; s++) if (marked[s]) laneSet.add(colOf(s));
    const cols = [...laneSet].sort((a, b) => a - b);
    beams = cols.map((col, i) => ({
      col,
      start: TELEGRAPH_MS + i * BEAM_GAP,
      hit: TELEGRAPH_MS + i * BEAM_GAP + HIT_AT,
      done: false,
    }));
    beamEndAt = cols.length > 0 ? TELEGRAPH_MS + cols.length * BEAM_GAP + BEAM_TAIL : 700;
    foot.text = cols.length > 0 ? 'HOLD ON — HE SEES YOUR MARKS' : 'NO MARKS — THE DRONES SLIP AWAY';
  }

  function vaporizeCol(col: number): void {
    for (let s = 0; s < SLOTS; s++) {
      if (marked[s] && colOf(s) === col) {
        marked[s] = false;
        vaporized[s] = true;
        vaporBorn[s] = clockMs;
        reticles[s].visible = false;
        tiles[s].visible = false;
      }
    }
    refreshHud();
  }

  function endWave(): void {
    if (vaporizedCount() > 0) wavesScored++;
    if (waveIdx + 1 >= WAVE_COUNT) {
      phaseMs = 0;
      phase = 'salute';
      armG.visible = true;
      const cc = isCloseCall(civPerWave);
      foot.text = cc ? 'CLOSE CALL — BUT HE CAUGHT EVERY ONE. SALUTE.' : 'THE CITY BREATHES. HE SALUTES YOU. (+10)';
    } else {
      startBrief(waveIdx + 1);
    }
    refreshHud();
  }

  /* ---- input ---- */
  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish(escaped(0, 'THE WATCH ENDS EARLY'));
      return;
    }
    if (phase !== 'mark') return;
    let move = 0;
    switch (e.key) {
      case 'ArrowRight': case 'd': case 'D': move = 1; break;
      case 'ArrowLeft': case 'a': case 'A': move = -1; break;
      case 'ArrowDown': case 's': case 'S': move = COLS; break;
      case 'ArrowUp': case 'w': case 'W': move = -COLS; break;
      default: break;
    }
    if (move !== 0) {
      e.preventDefault();
      sel = clamp(sel + move, 0, SLOTS - 1);
      return;
    }
    if (e.key === 'Enter' || e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      markSlot(sel);
    } else if (e.key === ' ' || e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      fireWave();
    }
  }
  window.addEventListener('keydown', onKey);

  /* ---- render helpers (per tick) ---- */

  function heroPos(): { x: number; y: number } {
    if (!motion || phase === 'salute') return { x: STAGE_W / 2, y: HERO_Y };
    const t = clockMs / 1000;
    return {
      x: STAGE_W / 2 + Math.cos(t * orbit.omega + orbit.phase) * orbit.rx,
      y: HERO_Y + Math.sin(t * orbit.omega * 1.7 + orbit.phase) * 22,
    };
  }

  function drawBeams(): void {
    beamsG.clear();
    if (phase !== 'beam') return;
    if (phaseMs < TELEGRAPH_MS) {
      // pre-fire shimmer on armed lanes (fairness telegraph)
      const a = motion ? 0.05 + 0.05 * Math.sin(clockMs / 55) : 0.07;
      for (const lane of lanesMarked()) {
        const cx = GX + (lane + 0.5) * CW;
        beamsG.rect(cx - CW * 0.28, GY - 8, CW * 0.56, GH + 24).fill({ color: 0x66e0ff, alpha: a });
      }
      return;
    }
    for (const bm of beams) {
      const ageB = phaseMs - bm.start;
      if (ageB < 0 || ageB > BEAM_MS + 150) continue;
      const cx = GX + (bm.col + 0.5) * CW;
      const hot = ageB < HIT_AT ? 1 : Math.max(0, 1 - (ageB - HIT_AT) / (BEAM_MS - 65));
      const coreW = CW * (0.1 + 0.06 * hot);
      const haloW = CW * 0.3;
      beamsG.rect(cx - haloW / 2, HERO_Y + 18, haloW, GROUND_Y - HERO_Y - 18)
        .fill({ color: 0x3aa0ff, alpha: 0.22 * hot });
      beamsG.rect(cx - coreW / 2, HERO_Y + 18, coreW, GROUND_Y - HERO_Y - 18)
        .fill({ color: 0xbfeaff, alpha: 0.85 * hot });
      beamsG.rect(cx - coreW * 0.18, HERO_Y + 18, coreW * 0.36, GROUND_Y - HERO_Y - 18)
        .fill({ color: 0xffffff, alpha: 0.95 * hot });
    }
  }

  function lanesMarked(): number[] {
    const set = new Set<number>();
    for (let s = 0; s < SLOTS; s++) if (marked[s]) set.add(colOf(s));
    return [...set].sort((a, b) => a - b);
  }

  function drawRings(): void {
    ringsG.clear();
    for (const w of warns) {
      const age = clockMs - w.born;
      if (age > 200) continue; // localized pulse, never fullscreen, <=200 ms
      const sp = tiles[w.slot];
      ringsG.circle(sp.x, sp.y, TILE * (0.5 + age / 200))
        .stroke({ width: 3, color: 0xff2038, alpha: 1 - age / 200 });
    }
    for (let s = 0; s < SLOTS; s++) {
      if (!vaporized[s]) continue;
      const age = clockMs - vaporBorn[s];
      if (age > VAPOR_FADE_MS) continue;
      const sp = tiles[s];
      ringsG.circle(sp.x, sp.y, TILE * 0.5)
        .stroke({ width: 2, color: T.gold, alpha: 0.35 * (1 - age / VAPOR_FADE_MS) });
    }
  }

  function drawCursor(): void {
    cursorG.clear();
    if (phase !== 'mark') return;
    const sp = tiles[sel];
    cursorG.rect(sp.x - TILE * 0.58, sp.y - TILE * 0.58, TILE * 1.16, TILE * 1.16)
      .stroke({ width: 1.5, color: 0xbfeaff, alpha: 0.7 });
  }

  /* ---- clock: Pixi ticker only, never Date.now ---- */
  const onTick = (tk: Ticker): void => {
    if (dead) return;
    const dt = Math.min(100, tk.deltaMS);
    clockMs += dt;
    phaseMs += dt;

    /* watchdog: good-world save settles BEFORE the engine timer, always */
    if (clockMs >= Math.min(ctx.timerLen * 1000 - 250, 32000)) {
      finish(verdictFor(wavesScored, civHits, isCloseCall(civPerWave), diff));
      return;
    }

    switch (phase) {
      case 'intro':
        if (phaseMs >= plan.intro) {
          dismissCard();
          startBrief(0);
        }
        break;
      case 'brief':
        if (phaseMs >= plan.brief) startMark();
        break;
      case 'mark':
        if ((autoFireAt != null && phaseMs >= autoFireAt) || phaseMs >= plan.markMs) fireWave();
        break;
      case 'beam': {
        for (const bm of beams) {
          if (!bm.done && phaseMs >= bm.hit) {
            bm.done = true;
            vaporizeCol(bm.col);
          }
        }
        if (phaseMs >= beamEndAt) endWave();
        break;
      }
      case 'salute':
        if (phaseMs >= plan.salute) {
          finish(verdictFor(wavesScored, civHits, isCloseCall(civPerWave), diff));
          return;
        }
        break;
    }

    const hp = heroPos();
    heroC.x = hp.x;
    heroC.y = hp.y;
    skyG.alpha = motion ? 0.75 + 0.15 * Math.sin(clockMs / 500) : 0.85;
    drawBeams();
    drawRings();
    drawCursor();
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  foot.text = 'HE CIRCLES… WATCH THE SKY';
  refreshHud();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // helper rails
  for (let d = 1; d <= 24; d++) {
    if (droneCountFor(d) < 3 || droneCountFor(d) > 6) failures.push(`droneCount out of band depth=${d}`);
    if (civCountFor(d) < 2 || civCountFor(d) > 5) failures.push(`civCount out of band depth=${d}`);
    if (markMsFor(d) < 2600 || markMsFor(d) > 4400) failures.push(`markMs out of band depth=${d}`);
    if (!(markMsFor(d + 1) <= markMsFor(d))) failures.push(`markMs not monotone depth=${d}`);
    if (diffFor(d) < 1 || diffFor(d) > 5) failures.push(`diff out of band depth=${d}`);
  }

  // goal-card rail: input locked long enough to read, never past 2 s
  if (INTRO_MS > 2000) failures.push('goal card exceeds 2 s');

  // 300-seed probe: determinism, counts, disjoint placement, timeline fit
  const seenLayouts = new Set<string>();
  for (let seed = 1; seed <= 300; seed++) {
    const depth = ((seed * 7) % 24) + 1;
    const timerLen = [18, 25, 30, 45][seed % 4];
    const mk = (): SkyWave[] => buildWaves(mulberry32((seed ^ SKY_SALT) >>> 0), depth);
    const a = mk();
    const b = mk();
    if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`waves nondeterministic seed=${seed}`);
    if (a.length !== WAVE_COUNT) failures.push(`wrong wave count seed=${seed}`);
    for (const w of a) {
      if (w.cells.length !== SLOTS) failures.push(`bad cell count seed=${seed}`);
      const nd = w.cells.filter((c) => c === 'drone').length;
      const nc = w.cells.filter((c) => c === 'civ').length;
      if (nd !== droneCountFor(depth) || nc !== civCountFor(depth)) failures.push(`bad composition seed=${seed}`);
      if (nd + nc > SLOTS) failures.push(`overflowing grid seed=${seed}`);
    }
    seenLayouts.add(JSON.stringify(a));

    const p = planShow(timerLen, depth);
    if (p.markMs < MIN_MARK_MS || p.markMs > markMsFor(depth)) failures.push(`markMs off-plan seed=${seed} tl=${timerLen}`);
    if (p.total > timerLen * 1000 - 500) failures.push(`show overflows timerLen=${timerLen} depth=${depth} total=${p.total}`);
    if (p.total !== p.intro + WAVE_COUNT * (p.brief + p.beamMax) + p.salute + WAVE_COUNT * p.markMs) {
      failures.push(`plan arithmetic broken seed=${seed}`);
    }
  }
  if (seenLayouts.size < 280) failures.push(`layout seed-blind: only ${seenLayouts.size} distinct over 300 seeds`);

  // short-timer safety: the plan floors markMs so the watchdog margin holds
  for (const tl of [6, 10, 15]) {
    const p = planShow(tl, 1);
    if (p.markMs !== MIN_MARK_MS) failures.push(`short timer should floor markMs tl=${tl}`);
  }

  // scoring economics: floor, halving, always-win verdict
  if (tally(3, 0, false, 3) !== 3 * wavePay(3)) failures.push('clean sweep tally wrong');
  if (tally(0, 3, true, 1) !== POINTS_FLOOR) failures.push('floor breached');
  if (tally(3, 3, true, 5) !== Math.round((wavePay(5) * 3 - 90) / 2)) failures.push('close-call halving wrong');
  if (tally(1, 1, false, 2) !== wavePay(2) - CIV_PTS) failures.push('mixed tally wrong');
  if (isCloseCall([1, 1, 1]) !== true || isCloseCall([1, 0, 1]) !== false) failures.push('close-call detection wrong');
  for (let ws = 0; ws <= 3; ws++) {
    for (let ch = 0; ch <= 9; ch++) {
      for (const cc of [true, false]) {
        for (const d of [1, 3, 5]) {
          const v = verdictFor(ws, ch, cc, d);
          if (v.correct !== true) failures.push('good world must always be correct');
          if (v.hpDelta !== SALUTE_HP) failures.push('salute heal missing');
          if (v.points !== tally(ws, ch, cc, d)) failures.push('verdict/tally divergence');
          if (v.points < POINTS_FLOOR) failures.push('verdict below floor');
          if (v.summary.length > 48) failures.push('summary over 48 chars');
        }
      }
    }
  }
  if (verdictFor(3, 0, false, 1).summary !== 'CLEAN SWEEP · CITY SAVED') failures.push('clean sweep flavor wrong');
  if (verdictFor(0, 0, false, 1).summary !== 'HE SAVED IT ALONE') failures.push('zero-wave flavor wrong');

  // glyph silhouettes are structurally distinct (never hue-alone)
  if (JSON.stringify(dronePrims()) === JSON.stringify(civPrims())) {
    failures.push('drone/civilian glyphs identical');
  }

  // flash-cap rail: white-hot core lands inside the 150 ms window
  if (HIT_AT >= 150) failures.push('white-hot core exceeds 150 ms flash cap');
  if (BEAM_PASS_MAX !== TELEGRAPH_MS + COLS * BEAM_GAP + BEAM_TAIL) failures.push('beam pass math wrong');

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
