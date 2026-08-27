/* ============================================================================
 * CHAOS JUICE BUS — shared, budgeted, motion-gated chaos effects for v2.
 *
 * Pure and headless: no pixi.js, no DOM, no timers. Time arrives only via
 * tick(dtMs). state() returns a plain object that main.ts applies to Pixi
 * and the node gate (selftest-chaos.ts) asserts on.
 *
 * Rails (a11y — asserted in the gate, do not weaken):
 *   - flashes <= 200 ms: the bus clamps every requested duration
 *   - flashes <= 3 Hz: the bus drops excess requests; it never trusts the caller
 *   - shake amplitude bounded to 0..1 regardless of the argument passed
 *   - motion === false: no effect may report any movement at all
 *
 * Determinism: seeded mulberry32 (same implementation as rounds/modifiers.ts).
 * Zero Math.random / Date.now.
 * ==========================================================================*/

export interface ChaosState {
  /** Shake offset, bounded by shakeAmp. Always 0 under motion=false. */
  shakeX: number;
  shakeY: number;
  /** Effective shake amplitude, clamped 0..1. */
  shakeAmp: number;
  /** Active flash color (0xRRGGBB). 0 when no flash is active. */
  flashColor: number;
  /** Flash overlay alpha 0..1. 0 when no flash is active. */
  flashAlpha: number;
  /** Glitch displacement 0..1. Always 0 under motion=false. */
  glitch: number;
  /** Melt warp amount 0..1 (static tint-like effect). */
  melt: number;
  /** Invert overlay amount 0..1. */
  invert: number;
  /** Number of active embers. */
  embers: number;
  /** Whether the scanline overlay is on. */
  scanlines: boolean;
  /** Scanline scroll phase 0..1. Always 0 under motion=false. */
  scanPhase: number;
  /** Global corruption dial 0..1 (default 1). */
  intensity: number;
  /** Total elapsed bus time in ms. */
  timeMs: number;
}

export interface ChaosBus {
  shake(intensity: number, ms: number): void;
  glitch(ms: number): void;
  flash(color: number, ms: number): void;
  melt(amount: number): void;
  invert(ms: number): void;
  embers(n: number): void;
  scanlines(on: boolean): void;
  intensity(v: number): void;
  tick(dtMs: number): void;
  state(): ChaosState;
  stop(): void;
}

export const FLASH_MAX_MS = 200;
export const FLASH_MAX_HZ = 3;
export const SHAKE_MAX_AMP = 1;
const FLASH_MIN_GAP_MS = 1000 / FLASH_MAX_HZ;
const EMBER_BURST_MS = 1500;
const MAX_EMBERS = 64;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Pure mulberry32 32-bit PRNG generator (same as rounds/modifiers.ts). */
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (a >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createChaos(seed: number, motion: boolean): ChaosBus {
  const rand = mulberry32(seed | 0);
  const phase = rand() * Math.PI * 2; // per-seed shake phase offset

  let timeMs = 0;
  let dial = 1;

  let shakeDur = 0;
  let shakeUntil = -1;
  let shakeAmp = 0;

  let flashColor = 0;
  let flashDur = 0;
  let flashUntil = -1;
  let lastFlashStart = -Infinity;

  let glitchUntil = -1;
  let invertUntil = -1;
  let meltAmount = 0;
  let emberCount = 0;
  let emberUntil = -1;
  let scanOn = false;

  function shake(intensity: number, ms: number): void {
    const amp = clamp01(intensity);
    const dur = Number.isFinite(ms) && ms > 0 ? ms : 0;
    if (dur <= 0 || amp <= 0) return;
    shakeDur = dur;
    shakeUntil = timeMs + dur;
    shakeAmp = amp;
  }

  function glitch(ms: number): void {
    const dur = Number.isFinite(ms) && ms > 0 ? ms : 0;
    if (dur <= 0) return;
    glitchUntil = timeMs + dur;
  }

  function flash(color: number, ms: number): void {
    const dur = Math.min(Number.isFinite(ms) && ms > 0 ? ms : 0, FLASH_MAX_MS);
    if (dur <= 0) return;
    if (timeMs < flashUntil) return; // already flashing -> drop
    if (timeMs - lastFlashStart < FLASH_MIN_GAP_MS) return; // > 3 Hz -> drop
    flashColor = color >>> 0;
    flashDur = dur;
    flashUntil = timeMs + dur;
    lastFlashStart = timeMs;
  }

  function melt(amount: number): void {
    meltAmount = clamp01(amount);
  }

  function invert(ms: number): void {
    const dur = Number.isFinite(ms) && ms > 0 ? ms : 0;
    if (dur <= 0) return;
    invertUntil = timeMs + dur;
  }

  function embers(n: number): void {
    const count = Number.isFinite(n)
      ? Math.min(MAX_EMBERS, Math.max(0, Math.floor(n)))
      : 0;
    if (count <= 0) return;
    emberCount = count;
    emberUntil = timeMs + EMBER_BURST_MS;
  }

  function scanlines(on: boolean): void {
    scanOn = on;
  }

  function intensity(v: number): void {
    dial = clamp01(v);
  }

  function tick(dtMs: number): void {
    timeMs += Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  }

  function state(): ChaosState {
    let sx = 0;
    let sy = 0;
    let sAmp = 0;
    if (motion && timeMs < shakeUntil && shakeDur > 0) {
      const remaining = shakeUntil - timeMs;
      const env = Math.min(1, remaining / shakeDur);
      sAmp = shakeAmp * dial * env;
      sx = sAmp * Math.sin(timeMs * 0.045 + phase) * Math.cos(timeMs * 0.011);
      sy = sAmp * Math.cos(timeMs * 0.038) * Math.sin(timeMs * 0.017 + phase);
    }

    let fAlpha = 0;
    if (timeMs < flashUntil && flashDur > 0) {
      const remaining = flashUntil - timeMs;
      const elapsed = flashDur - remaining;
      // motion=true: 30 ms fade in/out. motion=false: static constant tint.
      const env = motion ? Math.min(1, elapsed / 30, remaining / 30) : 1;
      fAlpha = 0.5 * dial * env;
    }

    return {
      shakeX: sx,
      shakeY: sy,
      shakeAmp: sAmp,
      flashColor: timeMs < flashUntil ? flashColor : 0,
      flashAlpha: fAlpha,
      glitch: motion && timeMs < glitchUntil ? 0.3 * dial : 0,
      melt: meltAmount * dial,
      invert: timeMs < invertUntil ? 0.4 * dial : 0,
      embers: timeMs < emberUntil ? emberCount : 0,
      scanlines: scanOn,
      scanPhase: motion && scanOn ? (timeMs * 0.0005) % 1 : 0,
      intensity: dial,
      timeMs,
    };
  }

  function stop(): void {
    timeMs = 0;
    dial = 1;
    shakeDur = 0;
    shakeUntil = -1;
    shakeAmp = 0;
    flashColor = 0;
    flashDur = 0;
    flashUntil = -1;
    lastFlashStart = -Infinity;
    glitchUntil = -1;
    invertUntil = -1;
    meltAmount = 0;
    emberCount = 0;
    emberUntil = -1;
    scanOn = false;
  }

  return { shake, glitch, flash, melt, invert, embers, scanlines, intensity, tick, state, stop };
}
