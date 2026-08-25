/**
 * shadow.ts — SHADOW persona speech channel for v2 (port of v1 demonsay.js
 * budget + shadow.js bubble, rebuilt on Pixi).
 *
 * Budget (research/chaos-balance.md §5 semantics, ported):
 *   - 8 s throttle between any two counted speeches (~"never speak in the
 *     last 5 s of a round"), except a strictly higher-priority line may
 *     preempt after 1.5 s.
 *   - Round quota: max 1 speech per 2 rounds before act 3; every round
 *     allowed at act 3. Acts derive from layer: 1-3 / 4-6 / 7+.
 *   - Same-window priority arbitration: impossible(4) > relic(3) >
 *     streak(2) > ambient(1). Blocked candidates queue at their priority;
 *     the best pending line flushes as soon as budget allows; stale
 *     pendings clear on noteRound().
 *   - announce(text) is forced and UNCOUNTED (stage-entry lines).
 *
 * Rendering: rounded dark bubble bottom-right of the 1600x900 stage with a
 * 44 px original abstract silhouette avatar drawn via Graphics, body text
 * >= 14 px, auto-fade after 4 s. Motion-gated: IQB_MOTION=0 (or
 * prefers-reduced-motion) disables the fade animation — instant show/hide,
 * no flashes anywhere.
 *
 * Determinism: own mulberry32 (reused from the takeover contract module);
 * zero Math.random / Date.now in gameplay decisions — time advances via
 * injected tick(dtMs), fed by Pixi's shared ticker delta at runtime.
 *
 * Integration: Main calls initShadow(stageContainer) once, noteRound(align,
 * layer, sanctuary) per round, say('wrong'|'right'|...) on events, and
 * announce(text) for forced lines.
 */
import { Container, Graphics, Text, Ticker } from 'pixi.js';
import { mulberry32 } from '../scenes/takeovers/redlight.ts';
import { POOLS, validatePools } from './pools.ts';
import { T, STAGE_W, STAGE_H } from '../theme.ts';

/* ------------------------------------------------------------------ */
/* Pure budget brain (self-tested — no Pixi objects constructed here)  */
/* ------------------------------------------------------------------ */

export type SayKind =
  | 'appear' | 'wrong' | 'right' | 'streak' | 'impossible'
  | 'relic' | 'win' | 'lose' | 'despair' | 'defiance'
  | 'whisper' | 'sanctuary';

export type Priority = 'impossible' | 'relic' | 'streak' | 'ambient';

export const PRIO: Record<Priority, number> = { impossible: 4, relic: 3, streak: 2, ambient: 1 };

const THROTTLE_MS = 8000;
const PREEMPT_MS = 1500;
const SHADOW_SEED = 0x5e2d0a;

const KIND_PRIORITY: Record<SayKind, Priority> = {
  impossible: 'impossible',
  relic: 'relic',
  streak: 'streak',
  appear: 'ambient', wrong: 'ambient', right: 'ambient', win: 'ambient',
  lose: 'ambient', despair: 'ambient', defiance: 'ambient',
  whisper: 'ambient', sanctuary: 'ambient',
};

export interface SayDecision {
  /** true = the caller should render this line now */
  shown: boolean;
  text: string;
  prio: number;
  reason?: 'quota' | 'queued' | 'suppressed';
}

/** Resolve the pool key for a kind given current round state. */
export function poolKeyFor(kind: SayKind, layer: number, sanctuary: number): string {
  if (kind === 'whisper') return `whispers[${Math.min(Math.max(layer, 1), 7) - 1}]`;
  if (kind === 'sanctuary') return `sanctuary[${Math.min(Math.max(sanctuary, 0), 2)}]`;
  return kind;
}

function poolByKey(key: string): string[] {
  if (key.startsWith('whispers[')) {
    return POOLS.whispers[Number(key.slice(9, key.indexOf(']')))] ?? POOLS.whispers[0];
  }
  if (key.startsWith('sanctuary[')) {
    return POOLS.sanctuary[Number(key.slice(10, key.indexOf(']')))] ?? POOLS.sanctuary[0];
  }
  return (POOLS as unknown as Record<string, string[]>)[key] ?? POOLS.appear;
}

/**
 * Deterministic speech brain. Time is injected: advance with tick(dtMs)
 * (runtime: Pixi ticker delta; tests: manual). No Math.random, no Date.now.
 */
export class ShadowBrain {
  t = 0;
  round = 0;
  layer = 1;
  sanctuary = 0;
  align = 'neutral';
  private rng: () => number;
  private used = new Map<string, Set<number>>();
  private lastShownAt = -Infinity;
  private lastShownPrio = 0;
  private lastSpokenRound: number | null = null;
  private pending: { prio: number; text: string } | null = null;

  constructor(seed = SHADOW_SEED) {
    this.rng = mulberry32(seed >>> 0);
  }

  get act(): 1 | 2 | 3 {
    if (this.layer <= 3) return 1;
    if (this.layer <= 6) return 2;
    return 3;
  }

  /** One frame. Flushes any pending higher-priority line once budget allows. */
  tick(dtMs: number): SayDecision | null {
    this.t += dtMs;
    if (!this.pending) return null;
    const p = this.pending;
    if (this.tryShow(p.prio).ok) {
      this.pending = null;
      this.commit(p.prio);
      return { shown: true, text: p.text, prio: p.prio };
    }
    return null;
  }

  /** Per-round state from Main. Stale pendings die at the boundary. */
  noteRound(align: string, layer: number, sanctuary: number): void {
    this.round += 1;
    this.align = align;
    this.layer = layer;
    this.sanctuary = sanctuary;
    this.pending = null;
  }

  /**
   * Budgeted speech request. Returns whether the line shows NOW; blocked
   * higher-priority candidates wait in the pending slot.
   */
  say(kind: SayKind, ctx?: { layer?: number; sanctuary?: number }): SayDecision {
    const prioName = KIND_PRIORITY[kind] ?? 'ambient';
    const prio = PRIO[prioName];
    const text = this.drawLine(kind, ctx);
    const r = this.tryShow(prio);
    if (!r.ok) {
      this.offerPending(prio, text);
      return { shown: false, text, prio, reason: r.reason };
    }
    this.commit(prio);
    return { shown: true, text, prio };
  }


  /* --- internals --- */


  /**
   * Admission control. A fresh slot needs quota + an 8 s gap; a strictly
   * higher-priority line may instead PREEMPT the visible one (impossible
   * instantly, others after 1.5 s) — preemption replaces without consuming
   * a round slot.
   */
  private tryShow(prio: number): { ok: boolean; reason?: 'quota' | 'queued' } {
    const gap = this.t - this.lastShownAt;
    if (gap >= THROTTLE_MS) {
      return this.quotaAllows() ? { ok: true } : { ok: false, reason: 'quota' };
    }
    const preempt = prio > this.lastShownPrio &&
      (prio === PRIO.impossible || gap >= PREEMPT_MS);
    return preempt ? { ok: true } : { ok: false, reason: 'queued' };
  }

  private quotaAllows(): boolean {
    if (this.lastSpokenRound === null) return true;
    if (this.act === 3) return true; // every round allowed at act 3
    return this.round - this.lastSpokenRound >= 2;
  }

  private offerPending(prio: number, text: string): void {
    if (!this.pending || prio > this.pending.prio) this.pending = { prio, text };
  }

  private commit(prio: number): void {
    const freshSlot = this.t - this.lastShownAt >= THROTTLE_MS || this.lastSpokenRound === null;
    this.lastShownAt = this.t;
    this.lastShownPrio = prio;
    if (freshSlot) this.lastSpokenRound = this.round;
  }

  /** Shuffle-bag draw: no repeats within a run until the pool is exhausted. */
  drawLine(kind: SayKind, ctx?: { layer?: number; sanctuary?: number }): string {
    const key = poolKeyFor(kind, ctx?.layer ?? this.layer, ctx?.sanctuary ?? this.sanctuary);
    const pool = poolByKey(key);
    let bag = this.used.get(key);
    if (!bag) { bag = new Set(); this.used.set(key, bag); }
    if (bag.size >= pool.length) bag.clear(); // exhausted -> refill for the next run-cycle
    let idx = Math.floor(this.rng() * pool.length) % pool.length;
    while (bag.has(idx)) idx = (idx + 1) % pool.length;
    bag.add(idx);
    return pool[idx];
  }
}

/* ------------------------------------------------------------------ */
/* Renderer (Pixi)                                                     */
/* ------------------------------------------------------------------ */

interface BubbleUi {
  root: Container;
  bubble: Graphics;
  avatar: Graphics;
  tag: Text;
  body: Text;
  holdLeftMs: number;
  fading: boolean;
}

let ui: BubbleUi | null = null;
let hostContainer: Container | null = null;
let brain = new ShadowBrain();
let tickerFn: ((ticker: Ticker) => void) | null = null;

function motionOn(): boolean {
  const g = globalThis as unknown as { IQB_MOTION?: string; matchMedia?: (q: string) => MediaQueryList };
  if (g.IQB_MOTION === '0') return false;
  try { return !(g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch { return true; }
}

const BUBBLE_W = 380;
const BUBBLE_H = 104;
const MARGIN = 24;

/** Original abstract silhouette — pure geometry, not traced from any asset. */
function drawAvatar(av: Graphics, size: number): void {
  const s = size / 44;
  av.clear();
  // fanned back spikes (triangles)
  const spikes: Array<[number, number, number, number, number, number]> = [
    [6, 16, 20, 4, 22, 18],
    [14, 8, 30, 2, 28, 14],
    [26, 5, 42, 6, 34, 15],
  ];
  for (const tri of spikes) {
    av.poly(trie(tri, s)).fill({ color: 0x14101a }).stroke({ width: 1.4 * s, color: 0xc8102e });
  }
  // head
  av.circle(24 * s, 27 * s, 13 * s).fill({ color: 0x14101a }).stroke({ width: 1.4 * s, color: 0xc8102e });
  // crimson eye glow
  av.circle(19 * s, 25 * s, 2.4 * s).fill({ color: 0xe01030 });
  av.circle(29 * s, 25 * s, 2.4 * s).fill({ color: 0xe01030 });
  av.circle(19 * s, 25 * s, 0.9 * s).fill({ color: 0xffffff });
  av.circle(29 * s, 25 * s, 0.9 * s).fill({ color: 0xffffff });
}

function trie(t: [number, number, number, number, number, number], s: number): number[] {
  return [t[0] * s, t[1] * s, t[2] * s, t[3] * s, t[4] * s, t[5] * s];
}

function ensureBubble(container: Container): BubbleUi {
  if (ui && ui.root.parent === container) return ui;
  const root = new Container();
  root.x = STAGE_W - BUBBLE_W - MARGIN;
  root.y = STAGE_H - BUBBLE_H - MARGIN;

  const bubble = new Graphics();
  bubble.roundRect(0, 0, BUBBLE_W, BUBBLE_H, 14).fill({ color: 0x0a1220, alpha: 0.94 })
    .stroke({ width: 2, color: 0xc8102e, alpha: 0.85 });

  const avatar = new Graphics();
  drawAvatar(avatar, 44);
  avatar.x = 12;
  avatar.y = (BUBBLE_H - 44) / 2;

  const tag = new Text({
    text: 'SHADOW',
    style: { fontFamily: T.font, fontSize: 11, fill: '#c8102e', fontWeight: '800', letterSpacing: 3 },
  });
  tag.x = 68;
  tag.y = 12;

  const body = new Text({
    text: '',
    style: {
      fontFamily: T.font, fontSize: 15, fill: '#f5f8ff', fontWeight: '500',
      wordWrap: true, wordWrapWidth: BUBBLE_W - 84, breakWords: true, lineHeight: 19,
    },
  });
  body.x = 68;
  body.y = 30;

  root.addChild(bubble, avatar, tag, body);
  root.visible = false;
  container.addChild(root);

  ui = { root, bubble, avatar, tag, body, holdLeftMs: 0, fading: false };
  return ui;
}

function renderLine(text: string): void {
  if (!hostContainer) return; // headless-safe: logic ran, nothing to draw
  const b = ensureBubble(hostContainer);
  b.body.text = text;
  b.root.visible = true;
  b.root.alpha = 1;
  b.fading = false;
  b.holdLeftMs = 4000;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Mount the persona into a stage-space container. Safe to re-call. */
export function initShadow(container: Container): void {
  hostContainer = container;
  ensureBubble(container);
  if (!tickerFn) {
    tickerFn = (ticker: Ticker) => {
      const dt = Math.min(ticker.deltaMS, 250);
      const flushed = brain.tick(dt);
      if (flushed) renderLine(flushed.text);
      if (ui && ui.root.visible) {
        if (!motionOn()) {
          // motion-gated: no fade animation, hard cut after hold
          ui.holdLeftMs -= dt;
          if (ui.holdLeftMs <= 0) ui.root.visible = false;
        } else if (ui.fading) {
          ui.root.alpha -= dt / 500;
          if (ui.root.alpha <= 0) { ui.root.visible = false; ui.root.alpha = 1; ui.fading = false; }
        } else {
          ui.holdLeftMs -= dt;
          if (ui.holdLeftMs <= 0) ui.fading = true; // 500 ms fade, well under flash rails
        }
      }
    };
    Ticker.shared.add(tickerFn);
  }
}

/** Budgeted speech channel. Returns true when the line actually showed. */
export function say(kind: SayKind, ctx?: { layer?: number; sanctuary?: number }): boolean {
  const d = brain.say(kind, ctx);
  if (d.shown) renderLine(d.text);
  return d.shown;
}

/** Forced announcement (stage entry, "ACT 3" etc.). Uncounted by the budget. */
export function announce(text: string): void {
  renderLine(text);
}

/** Main calls once per round: alignment, depth layer, sanctuary tier (0..2). */
export function noteRound(align: string, layer: number, sanctuary: number): void {
  brain.noteRound(align, layer, sanctuary);
}

/** Test hook: swap the brain (deterministic seeds without touching Pixi). */
export function __setBrain(b: ShadowBrain): void { brain = b; }
export function __brain(): ShadowBrain { return brain; }
export function __detach(): void {
  if (tickerFn) { Ticker.shared.remove(tickerFn); tickerFn = null; }
  if (ui) { ui.root.destroy({ children: true }); ui = null; }
  hostContainer = null;
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  validatePools(failures);

  // determinism: same seed -> identical draw sequence
  const seqA: string[] = [];
  const seqB: string[] = [];
  for (const seq of [seqA, seqB]) {
    const b = new ShadowBrain(1234);
    for (let i = 0; i < 12; i++) seq.push(b.say(i % 2 ? 'wrong' : 'right').text);
  }
  if (JSON.stringify(seqA) !== JSON.stringify(seqB)) failures.push('draws nondeterministic');

  // no repeats until pool exhausted (per pool, across a long run)
  {
    const b = new ShadowBrain(77);
    const seenWrong = new Set<string>();
    for (let i = 0; i < POOLS.wrong.length; i++) {
      seenWrong.add(b.say('wrong').text);
    }
    if (seenWrong.size !== POOLS.wrong.length) failures.push('repeat within run before pool exhausted');
    // after exhaustion the bag refills and keeps drawing valid lines
    const after = b.say('wrong').text;
    if (!POOLS.wrong.includes(after)) failures.push('bag refill drew an unknown line');
  }

  // throttle enforced
  {
    const b = new ShadowBrain(9);
    b.noteRound('bad', 7, 0); // act 3: quota always open, only throttle gates
    if (!b.say('wrong').shown) failures.push('first speech should show');
    if (b.say('right').shown) failures.push('speech inside 8s throttle must be suppressed');
    const f = b.tick(THROTTLE_MS + 1); // queued ambient flushes once the gap clears
    if (!f || !f.shown) failures.push('speech after 8s should show');
  }

  // round quota: 1-per-2 rounds before act 3, every round at act 3
  {
    const b = new ShadowBrain(10);
    b.noteRound('bad', 1, 0); // round 1, act 1
    if (!b.say('wrong').shown) failures.push('act1 round1 speech should show');
    b.tick(THROTTLE_MS + 1);
    b.noteRound('bad', 1, 0); // round 2
    if (b.say('right').shown) failures.push('act1 round2 speech violates 1-per-2-rounds');
    if (b.say('right').reason !== 'quota') failures.push('expected quota reason');
    b.tick(THROTTLE_MS + 1);
    b.noteRound('bad', 1, 0); // round 3 -> allowed again
    if (!b.say('right').shown) failures.push('act1 round3 speech should show');
    // act 3: every round allowed
    b.tick(THROTTLE_MS + 1);
    for (let r = 0; r < 3; r++) {
      b.noteRound('bad', 7, 0);
      if (!b.say('appear').shown) failures.push(`act3 round+${r} speech should show`);
      b.tick(THROTTLE_MS + 1);
    }
  }

  // priority arbitration: impossible > relic > streak > ambient
  {
    const order = ['streak', 'relic', 'impossible'] as const;
    const prios = order.map((k) => PRIO[KIND_PRIORITY[k]]);
    if (!(prios[0] < prios[1] && prios[1] < prios[2])) failures.push('priority ladder broken');
    const b = new ShadowBrain(11);
    b.noteRound('bad', 1, 0);
    if (!b.say('whisper', { layer: 2 }).shown) failures.push('ambient should show first');
    b.tick(PREEMPT_MS + 1); // inside 8s throttle, above preempt floor
    if (!b.say('streak').shown) failures.push('higher priority should preempt within throttle');
    // immediate lower-priority candidate queues, then flushes via tick
    if (b.say('relic').shown) failures.push('lower/equal priority must not preempt instantly');
    const flushed = b.tick(THROTTLE_MS - PREEMPT_MS + 10);
    if (!flushed || !flushed.shown) failures.push('queued line should flush when budget allows');
    if (flushed && flushed.prio !== PRIO.relic) failures.push('flushed wrong priority');
    // impossible outranks queued relic
    const b2 = new ShadowBrain(12);
    b2.noteRound('bad', 1, 0);
    b2.say('whisper', { layer: 1 });
    b2.tick(PREEMPT_MS + 1);
    b2.say('streak'); // shows (preempt)
    b2.say('relic'); // queued
    if (!b2.say('impossible').shown) failures.push('impossible should preempt over queued relic');
  }

  // stale pendings clear at round boundary
  {
    const b = new ShadowBrain(13);
    b.noteRound('bad', 1, 0);
    b.say('impossible'); // shows
    if (b.say('relic').shown) failures.push('relic should queue');
    b.noteRound('bad', 1, 0);
    b.tick(THROTTLE_MS + 1);
    const f = b.tick(0);
    if (f && f.prio === PRIO.relic) failures.push('stale pending survived round boundary');
  }

  // sanctuary pool selection + budget untouched by forced lines (announce
  // lives at the renderer layer and never enters the brain's ledgers)
  {
    const b = new ShadowBrain(14);
    b.noteRound('good', 1, 1);
    const d = b.say('sanctuary', { sanctuary: 1 });
    if (!d.shown) failures.push('first counted speech should show');
    if (!POOLS.sanctuary[1].includes(d.text)) failures.push('sanctuary tier not respected');
  }

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
