/**
 * large.ts — SHADOW LARGE presence channel for v2 (DemonSay-style major-beat
 * announcements; extends src/shadow/shadow.ts via import — shadow.ts is
 * untouched).
 *
 * What "LARGE" means (ported mechanic, original implementation):
 *   - Major beats speak BIG: layer crossings, sanctuary arrivals, impossible
 *     rounds, death. Text scales by tier across 24-40 px (>= v2 text rails),
 *     and the silhouette avatar grows with emphasis (1.15x .. 1.7x).
 *   - Priority preemption: a LARGE beat instantly replaces an equal-or-lower
 *     LARGE line already on stage (after a 1.2 s readability floor), and it
 *     SUPPRESSES ambient quips: while a LARGE line holds (+ fade margin) the
 *     shared ShadowBrain is wrapped so say()/tick() flushes are dropped —
 *     no small talk over a big moment.
 *   - Screen-edge presence: pairs of crimson eyes watch from the stage
 *     corners whenever the arc reaches act >= 2 (layers 4+) and no sanctuary
 *     is active. Sanctuary light banishes the Shadow: presence collapses to
 *     'hidden' regardless of mode while sanctuary > 0.
 *
 * Presence modes ('hidden' | 'watching' | 'large'):
 *   hidden   — nothing on stage
 *   watching — corner eyes only (act >= 2)
 *   large    — eyes brighter + LARGE channel armed (announcements allowed)
 * Driven by arc state: noteRound() (mirrored through the ambient gate)
 * recomputes derivePresence(layer, sanctuary) unless Main forced a mode via
 * setPresence(); the next round clears any manual override.
 *
 * Motion gating: IQB_MOTION=0 / prefers-reduced-motion disables the grow
 * animation, eye pulse and fade — hard cuts only, alpha constant. Flash
 * rails respected everywhere (fades <= 500 ms, no strobing).
 *
 * Determinism: the LARGE brain has no randomness at all (text is supplied by
 * the caller; decisions are pure functions of injected time) — zero
 * Math.random / Date.now anywhere.
 *
 * Integration: Main calls initShadow(stage) then initLarge(stage) once,
 * noteRound(align, layer, sanctuary) per round (also drives presence), and
 * announceLarge(kind, text) on major beats. Self-test:
 *   node --experimental-strip-types src/shadow/large.ts
 */
import { Container, Graphics, Text, Ticker } from 'pixi.js';
import {
  ShadowBrain,
  PRIO,
  __brain,
  __setBrain,
  type SayDecision,
} from './shadow.ts';
import { T, STAGE_W, STAGE_H } from '../theme.ts';

/* ------------------------------------------------------------------ */
/* Pure LARGE brain (self-tested — no Pixi objects constructed here)   */
/* ------------------------------------------------------------------ */

export type LargeKind = 'layer' | 'sanctuary' | 'impossible' | 'death';
export type Presence = 'hidden' | 'watching' | 'large';

/** LARGE outranks every ambient tier; death outranks everything. */
export const LARGE_PRIO: Record<LargeKind, number> = {
  death: 5,
  impossible: 4,
  layer: 3,
  sanctuary: 2,
};

/** Text tier per kind — always inside the 24..40 px band. */
export const MIN_PX = 24;
export const MAX_PX = 40;

/** Readability floor: equal-priority refresh blocked this long. */
export const LARGE_MIN_HOLD_MS = 1200;
/** How long a LARGE line owns the stage. */
export const LARGE_HOLD_MS = 4200;
/** Ambient quips stay suppressed until this long after onset. */
export const AMBIENT_SUPPRESS_MS = 4800;

const SIZES: Record<LargeKind, number> = {
  layer: 24,
  sanctuary: 28,
  impossible: 34,
  death: 40,
};

/** Avatar grows with the beat's emphasis. */
const EMPHASIS: Record<LargeKind, number> = {
  layer: 1.15,
  sanctuary: 1.25,
  impossible: 1.45,
  death: 1.7,
};

export function sizeFor(kind: LargeKind): number {
  const s = SIZES[kind];
  return Math.min(MAX_PX, Math.max(MIN_PX, s));
}

export function emphasisScale(kind: LargeKind): number {
  return EMPHASIS[kind];
}

/** Arc act from depth layer — mirrors ShadowBrain.act (layers 1-3/4-6/7+). */
export function actForLayer(layer: number): 1 | 2 | 3 {
  if (layer <= 3) return 1;
  if (layer <= 6) return 2;
  return 3;
}

/**
 * Presence derived from arc state. Sanctuary > 0 always wins: the light of a
 * sanctuary banishes the Shadow entirely.
 */
export function derivePresence(layer: number, sanctuary: number): Presence {
  if (sanctuary > 0) return 'hidden';
  const act = actForLayer(layer);
  if (act >= 3) return 'large';
  if (act >= 2) return 'watching';
  return 'hidden';
}

/** Manual modes collapse to 'hidden' while sanctuary light is up. */
export function effectivePresence(mode: Presence, layer: number, sanctuary: number): Presence {
  if (sanctuary > 0) return 'hidden';
  return mode;
}

/** Corner eyes exist only from act >= 2, never during sanctuary. */
export function eyesVisible(mode: Presence, layer: number, sanctuary: number): boolean {
  return effectivePresence(mode, layer, sanctuary) !== 'hidden' && actForLayer(layer) >= 2;
}

export interface MotionPolicy {
  grow: boolean;
  fade: boolean;
  pulse: boolean;
}

/** Motion gate: reduced motion => hard cuts only, zero animation. */
export function motionPolicy(on: boolean): MotionPolicy {
  return on ? { grow: true, fade: true, pulse: true } : { grow: false, fade: false, pulse: false };
}

export interface LargeDecision {
  shown: boolean;
  kind: LargeKind;
  prio: number;
  size: number;
  reason?: 'held' | 'outranked';
}

interface LiveLine {
  kind: LargeKind;
  prio: number;
  shownAt: number;
}

/**
 * Time-injected arbitration brain for LARGE beats. No RNG: identical call
 * sequences produce identical decisions.
 */
export class LargeBrain {
  t = 0;
  motion = true;
  private current: LiveLine | null = null;
  private suppressUntil = -Infinity;

  tick(dtMs: number): void {
    this.t += dtMs;
  }

  /** Ask to show a LARGE beat. Higher priority preempts instantly. */
  announce(kind: LargeKind): LargeDecision {
    const prio = LARGE_PRIO[kind];
    const cur = this.current;
    if (cur && this.t - cur.shownAt < LARGE_HOLD_MS) {
      const fresh = this.t - cur.shownAt < LARGE_MIN_HOLD_MS;
      if (prio < cur.prio || (prio === cur.prio && fresh)) {
        return {
          shown: false,
          kind,
          prio,
          size: sizeFor(kind),
          reason: prio < cur.prio ? 'outranked' : 'held',
        };
      }
      // higher priority (or equal after the floor): instant preemption
    }
    this.current = { kind, prio, shownAt: this.t };
    this.suppressUntil = this.t + AMBIENT_SUPPRESS_MS;
    return { shown: true, kind, prio, size: sizeFor(kind) };
  }

  /** True while the current LARGE line still owns the stage. */
  active(): boolean {
    return this.current !== null && this.t - this.current.shownAt < LARGE_HOLD_MS;
  }

  /** Ambient gate: no quip may talk over a LARGE beat or its aftermath. */
  allowsAmbient(): boolean {
    return this.t >= this.suppressUntil;
  }

  get live(): LiveLine | null {
    return this.current;
  }
}

/* ------------------------------------------------------------------ */
/* Ambient gate — wraps the shared ShadowBrain WITHOUT touching it     */
/* ------------------------------------------------------------------ */

type ArcMirror = (align: string, layer: number, sanctuary: number) => void;

/**
 * Delegating brain installed via shadow.ts's __setBrain hook. While a LARGE
 * beat holds, ambient say() calls are suppressed ('suppressed') and pending
 * flushes emerging from tick() are silently dropped — the quip dies instead
 * of talking over the big moment. Everything else delegates 1:1.
 */
export class AmbientGateBrain extends ShadowBrain {
  private inner: ShadowBrain;
  private allow: () => boolean;
  private mirror: ArcMirror;

  constructor(allow: () => boolean, mirror: ArcMirror, seed?: number) {
    super(seed);
    this.inner = new ShadowBrain(seed);
    this.allow = allow;
    this.mirror = mirror;
  }

  override get act(): 1 | 2 | 3 {
    return this.inner.act;
  }

  override noteRound(align: string, layer: number, sanctuary: number): void {
    this.inner.noteRound(align, layer, sanctuary);
    this.mirror(align, layer, sanctuary);
  }

  override tick(dtMs: number): SayDecision | null {
    const f = this.inner.tick(dtMs);
    if (f && !this.allow()) return null; // drop the flush mid-suppression
    return f;
  }

  override say(kind: Parameters<ShadowBrain['say']>[0], ctx?: { layer?: number; sanctuary?: number }): SayDecision {
    if (!this.allow()) {
      return { shown: false, text: '', prio: PRIO.ambient, reason: 'suppressed' };
    }
    return this.inner.say(kind, ctx);
  }

  override drawLine(
    kind: Parameters<ShadowBrain['drawLine']>[0],
    ctx?: { layer?: number; sanctuary?: number },
  ): string {
    return this.inner.drawLine(kind, ctx);
  }
}

/* ------------------------------------------------------------------ */
/* Renderer (Pixi)                                                     */
/* ------------------------------------------------------------------ */

interface LargeUi {
  root: Container;
  panel: Container;
  bubble: Graphics;
  avatar: Graphics;
  body: Text;
  eyes: Container[];
  holdLeftMs: number;
  fading: boolean;
  growT: number;
  targetScale: number;
}

let lui: LargeUi | null = null;
let hostContainer: Container | null = null;
let largeBrain = new LargeBrain();
let tickerFnL: ((ticker: Ticker) => void) | null = null;
let gateBrain: AmbientGateBrain | null = null;
let restoreBrain: ShadowBrain | null = null;

const ARC_DEFAULT: { layer: number; sanctuary: number } = { layer: 1, sanctuary: 0 };
let arcLayer = ARC_DEFAULT.layer;
let arcSanctuary = ARC_DEFAULT.sanctuary;
let mode: Presence = 'hidden';
let manualMode = false;

function motionOn(): boolean {
  const g = globalThis as unknown as { IQB_MOTION?: string; matchMedia?: (q: string) => MediaQueryList };
  if (g.IQB_MOTION === '0') return false;
  try { return !(g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch { return true; }
}

const BANNER_W = 1080;
const BANNER_MARGIN_TOP = 72;
const PANEL_PAD = 34;
const AV_BASE = 96;
const EYE_INSET = 30;
const CRIMSON = 0xc8102e;
const GLOW = 0xe01030;
const FADE_MS = 450;
const GROW_MS = 260;

function cornerPositions(): Array<[number, number]> {
  return [
    [EYE_INSET, EYE_INSET],
    [STAGE_W - EYE_INSET, EYE_INSET],
    [EYE_INSET, STAGE_H - EYE_INSET],
    [STAGE_W - EYE_INSET, STAGE_H - EYE_INSET],
  ];
}

/** Original abstract silhouette — larger, angrier variant (pure geometry). */
function drawLargeAvatar(av: Graphics, base: number): void {
  const s = base / 44;
  av.clear();
  // tall back spikes
  const spikes: Array<[number, number, number, number, number, number]> = [
    [2, 22, 16, 2, 20, 20],
    [10, 10, 28, 0, 26, 14],
    [24, 2, 44, 4, 36, 13],
  ];
  for (const tri of spikes) {
    av.poly([tri[0] * s, tri[1] * s, tri[2] * s, tri[3] * s, tri[4] * s, tri[5] * s])
      .fill({ color: 0x14101a }).stroke({ width: 1.6 * s, color: CRIMSON });
  }
  // head
  av.circle(25 * s, 30 * s, 15 * s).fill({ color: 0x14101a }).stroke({ width: 1.6 * s, color: CRIMSON });
  // burning eyes
  av.circle(19 * s, 27 * s, 3 * s).fill({ color: GLOW });
  av.circle(31 * s, 27 * s, 3 * s).fill({ color: GLOW });
  av.circle(19 * s, 27 * s, 1.1 * s).fill({ color: 0xffffff });
  av.circle(31 * s, 27 * s, 1.1 * s).fill({ color: 0xffffff });
}

function drawEyes(c: Container): void {
  const g = new Graphics();
  g.circle(-8, 0, 4.6).fill({ color: GLOW, alpha: 0.9 });
  g.circle(8, 0, 4.6).fill({ color: GLOW, alpha: 0.9 });
  g.circle(-8, 0, 1.7).fill({ color: 0xffffff });
  g.circle(8, 0, 1.7).fill({ color: 0xffffff });
  c.addChild(g);
}

function ensureLarge(container: Container): LargeUi {
  if (lui && lui.root.parent === container) return lui;
  const root = new Container();

  const eyes: Container[] = [];
  for (const [x, y] of cornerPositions()) {
    const e = new Container();
    e.position.set(x, y);
    e.alpha = 0.55;
    e.visible = false;
    drawEyes(e);
    root.addChild(e);
    eyes.push(e);
  }

  const panel = new Container();
  panel.position.set((STAGE_W - BANNER_W) / 2, BANNER_MARGIN_TOP);

  const bubble = new Graphics();
  const avatar = new Graphics();
  const body = new Text({
    text: '',
    style: {
      fontFamily: T.font, fontSize: MIN_PX, fill: '#f5f8ff', fontWeight: '800',
      wordWrap: true, wordWrapWidth: BANNER_W - 220, breakWords: true, lineHeight: 30,
    },
  });
  panel.addChild(bubble, avatar, body);
  panel.visible = false;

  root.visible = false;
  container.addChild(root);

  lui = { root, panel, bubble, avatar, body, eyes, holdLeftMs: 0, fading: false, growT: 1, targetScale: 1 };
  return lui;
}

/** Redraw the banner for the current text size + emphasis. */
function layoutPanel(b: LargeUi, size: number, kind: LargeKind): void {
  b.body.style.fontSize = size;
  b.body.style.lineHeight = Math.round(size * 1.22);
  b.body.style.wordWrapWidth = BANNER_W - 220;
  b.body.text = b.body.text; // force reflow for measurement

  const em = emphasisScale(kind);
  const avSize = Math.round(AV_BASE * em);
  const textH = Math.max(b.body.height, size * 1.22);
  const h = Math.max(Math.round(textH + PANEL_PAD * 2), avSize + PANEL_PAD);

  b.bubble.clear();
  b.bubble.roundRect(0, 0, BANNER_W, h, 18)
    .fill({ color: 0x0a1220, alpha: 0.95 })
    .stroke({ width: 3, color: CRIMSON, alpha: 0.9 });

  drawLargeAvatar(b.avatar, avSize);
  b.avatar.x = PANEL_PAD;
  b.avatar.y = Math.round((h - avSize) / 2);

  b.body.x = PANEL_PAD + avSize + 30;
  b.body.y = Math.round((h - b.body.height) / 2);

  b.targetScale = em;
}

function applyPresence(): void {
  if (!lui) return;
  const eff = effectivePresence(mode, arcLayer, arcSanctuary);
  const showEyes = eff !== 'hidden' && actForLayer(arcLayer) >= 2;
  for (const e of lui.eyes) e.visible = showEyes;
  const bright = eff === 'large' ? 0.85 : 0.55;
  for (const e of lui.eyes) if (!lui.fading) e.alpha = bright;
}

function renderLarge(text: string, size: number, kind: LargeKind): void {
  if (!hostContainer) return; // headless-safe: decision ran, nothing to draw
  const b = ensureLarge(hostContainer);
  b.body.text = text;
  layoutPanel(b, size, kind);
  b.panel.visible = true;
  b.root.visible = true;
  b.root.alpha = 1;
  b.fading = false;
  b.holdLeftMs = LARGE_HOLD_MS;
  const m = motionOn();
  b.growT = m ? 0 : 1; // motion-gated grow: snap to full when off
  applyScale(b);
  applyPresence();
}

function applyScale(b: LargeUi): void {
  const ease = 0.85 + 0.15 * b.growT; // subtle grow from 85% to 100%
  const base = Math.min(STAGE_W, STAGE_H) / 900;
  const s = b.targetScale * ease * base;
  b.panel.scale.set(s);
  // keep the panel centred while it breathes
  b.panel.x = (STAGE_W - BANNER_W * s) / 2;
  b.panel.y = BANNER_MARGIN_TOP;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Mount the LARGE presence into a stage-space container. Safe to re-call. */
export function initLarge(container: Container): void {
  hostContainer = container;
  ensureLarge(container);
  applyPresence();
  if (!gateBrain) {
    const prior = __brain();
    gateBrain = new AmbientGateBrain(
      () => !largeBrain.allowsAmbient(),
      (_align, layer, sanctuary) => {
        arcLayer = layer;
        arcSanctuary = sanctuary;
        if (!manualMode) mode = derivePresence(layer, sanctuary);
        applyPresence();
      },
    );
    restoreBrain = prior === gateBrain ? null : prior;
    __setBrain(gateBrain);
  }
  if (!tickerFnL) {
    tickerFnL = (ticker: Ticker) => {
      const dt = Math.min(ticker.deltaMS, 250);
      largeBrain.tick(dt);
      const b = lui;
      if (!b) return;
      const pol = motionPolicy(motionOn());
      if (b.root.visible && b.panel.visible) {
        if (pol.grow && b.growT < 1) {
          b.growT = Math.min(1, b.growT + dt / GROW_MS);
          applyScale(b);
        }
        if (!pol.fade) {
          b.holdLeftMs -= dt;
          if (b.holdLeftMs <= 0) { b.panel.visible = false; syncRootVisible(b); }
        } else if (b.fading) {
          b.root.alpha -= dt / FADE_MS;
          if (b.root.alpha <= 0) { b.root.alpha = 1; b.panel.visible = false; b.fading = false; syncRootVisible(b); }
        } else {
          b.holdLeftMs -= dt;
          if (b.holdLeftMs <= 0) b.fading = true; // <= 500 ms fade, flash-safe
        }
      }
      if (pol.pulse) {
        const eff = effectivePresence(mode, arcLayer, arcSanctuary);
        if (eff !== 'hidden') {
          const bright = eff === 'large' ? 0.85 : 0.55;
          for (const e of b.eyes) e.alpha = bright + 0.12 * Math.sin(largeBrain.t / 650);
        }
      }
      applyPresence();
    };
    Ticker.shared.add(tickerFnL);
  }
}

function syncRootVisible(b: LargeUi): void {
  b.root.visible = b.panel.visible || b.eyes.some((e) => e.visible);
}

/**
 * LARGE beat announcement (layer crossings, sanctuary arrivals, impossible
 * rounds, death). Preempts equal/lower LARGE lines and suppresses ambient
 * quips for the hold window. Returns true when the line actually showed.
 */
export function announceLarge(kind: LargeKind, text: string): boolean {
  const d = largeBrain.announce(kind);
  if (d.shown) renderLarge(text, d.size, kind);
  return d.shown;
}

/** Force a presence mode (e.g. takeover scenes hiding the persona). */
export function setPresence(m: Presence): void {
  mode = m;
  manualMode = true;
  applyPresence();
}

/** Current derived/effective presence (test + debug aid). */
export function currentPresence(): Presence {
  return effectivePresence(mode, arcLayer, arcSanctuary);
}

/** Test hooks: swap the brain without touching Pixi. */
export function __setLargeBrain(b: LargeBrain): void { largeBrain = b; }
export function __largeBrain(): LargeBrain { return largeBrain; }
export function __detachLarge(): void {
  if (tickerFnL) { Ticker.shared.remove(tickerFnL); tickerFnL = null; }
  if (gateBrain && restoreBrain !== null) __setBrain(restoreBrain);
  else if (gateBrain) __setBrain(new ShadowBrain());
  gateBrain = null;
  restoreBrain = null;
  if (lui) { lui.root.destroy({ children: true }); lui = null; }
  hostContainer = null;
  arcLayer = ARC_DEFAULT.layer;
  arcSanctuary = ARC_DEFAULT.sanctuary;
  mode = 'hidden';
  manualMode = false;
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const kinds: LargeKind[] = ['layer', 'sanctuary', 'impossible', 'death'];

  /* size tiers: monotone with priority, inside the 24..40 px band */
  {
    const sizes = kinds.map(sizeFor);
    for (const s of sizes) {
      if (s < MIN_PX || s > MAX_PX) failures.push(`size ${s} outside ${MIN_PX}..${MAX_PX}`);
    }
    for (let i = 1; i < sizes.length; i++) {
      if (!(sizes[i] > sizes[i - 1])) failures.push(`size tier not increasing at ${kinds[i]}`);
    }
    if (sizes[0] !== MIN_PX) failures.push('layer beat should sit at the 24 px floor');
    if (sizes[sizes.length - 1] !== MAX_PX) failures.push('death beat should hit the 40 px ceiling');
    const ems = kinds.map(emphasisScale);
    for (let i = 1; i < ems.length; i++) {
      if (!(ems[i] > ems[i - 1])) failures.push(`emphasis not growing at ${kinds[i]}`);
    }
  }

  /* preemption among LARGE beats */
  {
    const b = new LargeBrain();
    if (!b.announce('layer').shown) failures.push('first LARGE beat should show');
    const low = b.announce('sanctuary');
    if (low.shown || low.reason !== 'outranked') failures.push('lower-priority beat must be outranked');
    if (!b.active()) failures.push('stage should still be held after blocked beat');
    if (!b.announce('impossible').shown) failures.push('higher priority must preempt instantly');
    const eq = b.announce('impossible');
    if (eq.shown || eq.reason !== 'held') failures.push('equal priority inside floor must be held');
    b.tick(LARGE_MIN_HOLD_MS + 1);
    if (!b.announce('impossible').shown) failures.push('equal priority after floor should replace');
    // lower priority may follow once the hold expired
    b.tick(LARGE_HOLD_MS + 1);
    if (!b.announce('layer').shown) failures.push('beat should show after hold expiry');

    // death outranks a fresh impossible instantly
    const b2 = new LargeBrain();
    b2.announce('impossible');
    if (!b2.announce('death').shown) failures.push('death must preempt a fresh impossible');
    // determinism: identical op sequence -> identical decisions
    const run = (): boolean[] => {
      const bb = new LargeBrain();
      return ['layer', 'sanctuary', 'impossible', 'impossible', 'death'].map(
        (k) => bb.announce(k as LargeKind).shown,
      );
    };
    if (JSON.stringify(run()) !== JSON.stringify(run())) failures.push('LARGE arbitration nondeterministic');
  }

  /* preemption OVER ambient quips (gate wraps a real ShadowBrain) */
  {
    let allow = true;
    const gate = new AmbientGateBrain(() => allow, () => undefined, 4242);
    gate.noteRound('bad', 7, 0); // act 3: quota open, throttle-only gating
    const first = gate.say('wrong');
    if (!first.shown) failures.push('ambient quip should show while LARGE idle');
    const queued = gate.say('right');
    if (queued.shown || queued.reason !== 'queued') failures.push('second ambient quip should queue in throttle');
    // LARGE fires -> gate slams shut even on the queued flush (the dropped
    // flush still burns its throttle slot inside the wrapped brain)
    allow = false;
    gate.tick(9000); // would flush the queued quip
    if (gate.tick(0) !== null) failures.push('queued quip flushed during LARGE suppression');
    const swallowed = gate.say('appear');
    if (swallowed.shown || swallowed.reason !== 'suppressed') failures.push('ambient quip must be suppressed during LARGE');
    // once suppression lifts, ambience flows again (queue then flush)
    allow = true;
    const again = gate.say('appear');
    if (!again.shown && again.reason !== 'queued') {
      failures.push(`ambience should resume after suppression (got ${String(again.reason)})`);
    } else if (!again.shown) {
      const flushed = gate.tick(9000);
      if (!flushed || !flushed.shown) failures.push('queued post-suppression quip should flush');
    }
  }

  /* motion gates */
  {
    const on = motionPolicy(true);
    const off = motionPolicy(false);
    if (!on.grow || !on.fade || !on.pulse) failures.push('motion-on policy lost animations');
    if (off.grow || off.fade || off.pulse) failures.push('reduced-motion policy must disable grow/fade/pulse');
    // brain-level: reduced motion is a flag, decisions unchanged
    const b = new LargeBrain();
    b.motion = false;
    if (!b.announce('death').shown) failures.push('reduced motion must not block LARGE decisions');
  }

  /* sanctuary hides: presence derivation + effective collapse */
  {
    if (derivePresence(1, 0) !== 'hidden') failures.push('act 1 should be hidden');
    if (derivePresence(4, 0) !== 'watching') failures.push('act 2 should be watching');
    if (derivePresence(7, 0) !== 'large') failures.push('act 3 should be large');
    for (const layer of [1, 4, 7]) {
      if (derivePresence(layer, 1) !== 'hidden') failures.push(`sanctuary must hide presence at layer ${layer}`);
      if (effectivePresence('large', layer, 1) !== 'hidden') failures.push(`forced large must collapse under sanctuary (layer ${layer})`);
      if (eyesVisible('large', layer, 1)) failures.push(`eyes must hide during sanctuary (layer ${layer})`);
    }
    if (eyesVisible('watching', 3, 0)) failures.push('eyes require act >= 2');
    if (!eyesVisible('watching', 4, 0)) failures.push('eyes expected at act 2 watching');
    if (!eyesVisible('large', 7, 0)) failures.push('eyes expected at act 3 large');
    if (actForLayer(3) !== 1 || actForLayer(4) !== 2 || actForLayer(7) !== 3) failures.push('act ladder broken');
  }

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/shadow/large.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/large.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] SHADOW-LARGE OK' : `[selftest] SHADOW-LARGE FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
