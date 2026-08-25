/**
 * INTERLUDE — EMERALD pick-your-poison scene (v2 port of index.html's
 * emerald layer, mechanic not code).
 *
 * Every 4th depth a Chaos Emerald surfaces: three relic cards are offered,
 * seeded from the run seed. Picking one arms its modifier for the rest of
 * the run; the engine (Main) owns all mutation — this file is pure logic
 * plus a self-contained Pixi card scene that reports back via onPick(id).
 *
 * Relic table (frozen, mirrors live index.html EMERALDS):
 *   CHAOS CONTROL  skip an impossible round — banked as +150
 *   CRIMSON VEIL   impossible rounds pay +40 instead of -25
 *   DOOM BLOOM     correct answers x1.3; your wrongs sting rivals -20
 *   GRAVITY GREED  every correct answer steals 60 pts from the leader
 *   FINAL CHAOS    every 10th depth pays x2 — bomb one, score halves
 *   BLACK ARROW    one free skip per run. Some shame.
 *
 * Determinism: offers derive from the seed via the shared mulberry32; the
 * scene clock is Pixi's shared ticker delta. No Math.random, no Date.now.
 */
import { Container, Sprite, Text, Texture, Ticker } from 'pixi.js';
import { panel, text } from './game.ts';
import { T, STAGE_W, STAGE_H } from '../theme.ts';
import { mulberry32 } from './takeovers/redlight.ts';

/* ------------------------------------------------------------------ */
/* Relic table                                                         */
/* ------------------------------------------------------------------ */

export interface Relic {
  id: string;
  name: string;
  desc: string;
  icon: string;
}

export const RELICS: readonly Relic[] = [
  { id: 'chaos_control', name: 'CHAOS CONTROL', icon: '💠', desc: 'Skip an impossible round — banked as +150.' },
  { id: 'crimson_veil', name: 'CRIMSON VEIL', icon: '🩸', desc: 'Impossible rounds pay +40 instead of -25.' },
  { id: 'doom_bloom', name: 'DOOM BLOOM', icon: '🌹', desc: 'Correct answers pay x1.3; wrong answers sting rivals -20.' },
  { id: 'gravity_greed', name: 'GRAVITY GREED', icon: '🧲', desc: 'Every correct answer steals 60 pts from the leader.' },
  { id: 'final_chaos', name: 'FINAL CHAOS', icon: '🌀', desc: 'Every 10th depth pays x2 — bomb one and your score halves.' },
  { id: 'black_arrow', name: 'BLACK ARROW', icon: '🏹', desc: 'One free skip per run. Some shame.' },
];

const RELIC_BY_ID = new Map(RELICS.map((r) => [r.id, r]));

const PICK_SALT = 0x3e1a7d >>> 0;

/** Seeded distinct offer of up to 3 relics, excluding usedIds. */
export function emeraldPick(seed: number, usedIds: string[]): Relic[] {
  const used = new Set(usedIds);
  const pool = RELICS.filter((r) => !used.has(r.id));
  const rng = mulberry32((seed ^ PICK_SALT) >>> 0);
  // partial Fisher-Yates: draw 3 distinct without disturbing order semantics
  const picks: Relic[] = [];
  for (let i = pool.length - 1; i >= 0 && picks.length < 3; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
    picks.push(pool[i]);
  }
  return picks.map((r) => ({ ...r }));
}

/* ------------------------------------------------------------------ */
/* Pure effect application — Main mutates, this only describes         */
/* ------------------------------------------------------------------ */

/**
 * Run snapshot read by applyEmerald. `correct` is optional and only
 * consulted by FINAL CHAOS (a failed 10th depth halves the score);
 * undefined defaults to the headline x2 branch.
 */
export interface EmeraldRun {
  score: number;
  hp: number;
  depth: number;
  emeralds: string[];
  correct?: boolean | null;
}

/**
 * Plain-data effect for Main to layer onto the run:
 *   scoreMul   — multiply the pending points (FINAL CHAOS fail branch:
 *                Main multiplies the WHOLE run score by it instead)
 *   flatBonus  — add straight to run score
 *   hpDelta    — add to run hp
 *   note       — banner line; also carries the rival-sting / skip clauses
 *                that need opponent state Main owns
 * Pure: run is never mutated.
 */
export interface EmeraldEffect {
  scoreMul?: number;
  flatBonus?: number;
  hpDelta?: number;
  note: string;
}

export function applyEmerald(id: string, run: EmeraldRun): EmeraldEffect {
  if (!run.emeralds.includes(id)) return { note: '' };
  switch (id) {
    case 'chaos_control':
      return { flatBonus: 150, note: 'CHAOS CONTROL — THE IMPOSSIBLE IS FROZEN · +150' };
    case 'crimson_veil':
      return { flatBonus: 40, note: 'THE CRIMSON VEIL DRINKS THE CURSE · +40' };
    case 'doom_bloom':
      return { scoreMul: 1.3, note: 'DOOM BLOOM · CORRECT x1.3 · WRONGS STING RIVALS -20' };
    case 'gravity_greed':
      return { flatBonus: 60, note: 'GRAVITY GREED · 60 PULLED FROM THE LEADER' };
    case 'final_chaos': {
      if (run.depth % 10 !== 0) return { note: '' };
      if (run.correct === false) return { scoreMul: 0.5, note: 'FINAL CHAOS PUNISHES · SCORE HALVED' };
      return { scoreMul: 2, note: 'FINAL CHAOS · x2' };
    }
    case 'black_arrow':
      return { note: 'BLACK ARROW · ONE FREE SKIP' };
    default:
      return { note: '' };
  }
}

/* ------------------------------------------------------------------ */
/* Scene timing constants + deterministic auto-pick                    */
/* ------------------------------------------------------------------ */

/** Esc is honored only after this much scene time (ms). */
export const ESCAPE_AFTER_MS = 1000;
/** Middle card auto-picks itself after this much scene time (ms). */
export const AUTO_PICK_MS = 8000;

/** Deterministic auto-pick target: the middle offer. */
export function autoPickIndex(count: number): number {
  return Math.max(0, Math.floor((count - 1) / 2));
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

/**
 * Build the pick-your-poison overlay into a fresh Container. Cards are
 * eventMode static; Esc declines after 1 s; the middle card auto-picks
 * after 8 s. Exactly one onPick(id) ever fires; the caller destroys the
 * returned container afterwards.
 */
export function buildInterlude(offers: Relic[], onPick: (id: string) => void): Container {
  const root = new Container();

  /* ---- backdrop ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  bg.alpha = 0.92;
  root.addChild(bg);

  text(root, 'A CHAOS EMERALD SURFACES', STAGE_W / 2 - 190, 96, 30, T.gold, true);
  text(root, 'CHOOSE YOUR POISON', STAGE_W / 2 - 122, 148, 20, T.ink, true);

  /* ---- relic cards ---- */
  const cardW = 340;
  const cardH = 400;
  const gap = 36;
  const rowW = offers.length * cardW + Math.max(0, offers.length - 1) * gap;
  const ox = (STAGE_W - rowW) / 2;
  const oy = 230;

  let settled = false;
  function pick(idx: number): void {
    if (settled || idx < 0 || idx >= offers.length) return;
    settled = true;
    done();
    onPick(offers[idx].id);
  }

  offers.forEach((relic, i) => {
    const card = panel(root, ox + i * (cardW + gap), oy, cardW, cardH);
    card.eventMode = 'static';
    card.cursor = 'pointer';
    card.on('pointerdown', () => pick(i));

    const icon = new Text({
      text: relic.icon,
      style: { fontFamily: T.font, fontSize: 72, fill: T.gold },
    });
    icon.anchor.set(0.5);
    icon.x = cardW / 2;
    icon.y = 96;
    card.addChild(icon);

    const name = new Text({
      text: relic.name,
      style: { fontFamily: T.font, fontSize: 20, fill: T.gold, fontWeight: '800', letterSpacing: 2 },
    });
    name.anchor.set(0.5);
    name.x = cardW / 2;
    name.y = 176;
    card.addChild(name);

    const desc = new Text({
      text: relic.desc,
      style: {
        fontFamily: T.font,
        fontSize: 15,
        fill: T.muted,
        wordWrap: true,
        wordWrapWidth: cardW - 44,
        breakWords: true,
        align: 'center',
        lineHeight: 22,
      },
    });
    desc.anchor.set(0.5, 0);
    desc.x = cardW / 2;
    desc.y = 216;
    card.addChild(desc);
  });

  const hint = text(root, '', 0, 700, 14, T.muted);
  hint.x = STAGE_W / 2 - hint.width / 2;

  /* ---- clock: Pixi ticker only, never Date.now ---- */
  let elapsedMs = 0;
  const onTick = (tk: Ticker): void => {
    if (settled) return;
    elapsedMs += tk.deltaMS;
    const left = Math.max(0, Math.ceil((AUTO_PICK_MS - elapsedMs) / 1000));
    hint.text =
      elapsedMs < ESCAPE_AFTER_MS
        ? `AUTO-PICK IN ${left}s`
        : `ESC TO DECLINE · AUTO-PICK IN ${left}s`;
    hint.x = STAGE_W / 2 - hint.width / 2;
    if (elapsedMs >= AUTO_PICK_MS) pick(autoPickIndex(offers.length));
  };
  Ticker.shared.add(onTick);

  function onKey(e: KeyboardEvent): void {
    if (settled) return;
    if (e.key === 'Escape' && elapsedMs >= ESCAPE_AFTER_MS) {
      settled = true;
      done();
      onPick(''); // declined — neutral, no relic
    }
  }
  window.addEventListener('keydown', onKey);

  function done(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
  }

  return root;
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  /* offers: deterministic, distinct, exclude usedIds, valid relics */
  for (let seed = 1; seed <= 300; seed++) {
    const a = emeraldPick(seed, []);
    const b = emeraldPick(seed, []);
    if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`offers nondeterministic seed=${seed}`);
    if (a.length !== 3) failures.push(`expected 3 offers seed=${seed}`);
    const ids = a.map((r) => r.id);
    if (new Set(ids).size !== ids.length) failures.push(`duplicate offer seed=${seed}`);
    if (!ids.every((id) => RELIC_BY_ID.has(id))) failures.push(`unknown relic id seed=${seed}`);
  }
  const usedSets = [['chaos_control'], ['chaos_control', 'doom_bloom'], RELICS.map((r) => r.id), ['crimson_veil', 'black_arrow']];
  for (const used of usedSets) {
    for (let seed = 1; seed <= 50; seed++) {
      const picks = emeraldPick(seed, used);
      if (picks.some((r) => used.includes(r.id))) failures.push(`usedId leaked seed=${seed} used=${used.join(',')}`);
    }
  }
  // exhausting the table leaves fewer than 3 (v1 parity: pick what remains)
  const allUsed = emeraldPick(7, RELICS.map((r) => r.id));
  if (allUsed.length !== 0) failures.push('exhausted pool should offer nothing');

  /* applyEmerald: effects per table, pure over run */
  const held = (extra: Partial<EmeraldRun> = {}): EmeraldRun => ({
    score: 500,
    hp: 80,
    depth: 4,
    emeralds: RELICS.map((r) => r.id),
    ...extra,
  });

  const cc = applyEmerald('chaos_control', held());
  if (cc.flatBonus !== 150 || cc.scoreMul !== undefined) failures.push(`chaos_control effect ${JSON.stringify(cc)}`);

  const cv = applyEmerald('crimson_veil', held());
  if (cv.flatBonus !== 40) failures.push(`crimson_veil effect ${JSON.stringify(cv)}`);

  const db = applyEmerald('doom_bloom', held());
  if (db.scoreMul !== 1.3 || db.flatBonus !== undefined) failures.push(`doom_bloom effect ${JSON.stringify(db)}`);

  const gg = applyEmerald('gravity_greed', held());
  if (gg.flatBonus !== 60) failures.push(`gravity_greed effect ${JSON.stringify(gg)}`);

  const fcOn = applyEmerald('final_chaos', held({ depth: 20 }));
  if (fcOn.scoreMul !== 2) failures.push(`final_chaos 10th-depth bonus ${JSON.stringify(fcOn)}`);
  const fcOff = applyEmerald('final_chaos', held({ depth: 12 }));
  if (fcOff.scoreMul !== undefined) failures.push(`final_chaos fired off-schedule ${JSON.stringify(fcOff)}`);
  const fcFail = applyEmerald('final_chaos', held({ depth: 30, correct: false }));
  if (fcFail.scoreMul !== 0.5) failures.push(`final_chaos fail halving ${JSON.stringify(fcFail)}`);
  const fcWin = applyEmerald('final_chaos', held({ depth: 30, correct: true }));
  if (fcWin.scoreMul !== 2) failures.push(`final_chaos correct override ${JSON.stringify(fcWin)}`);

  const ba = applyEmerald('black_arrow', held());
  if (ba.flatBonus !== undefined || ba.hpDelta !== undefined || ba.scoreMul !== undefined || ba.note === '') {
    failures.push(`black_arrow effect ${JSON.stringify(ba)}`);
  }

  const notHeld = applyEmerald('doom_bloom', { score: 1, hp: 1, depth: 4, emeralds: [] });
  if (notHeld.scoreMul !== undefined || notHeld.flatBonus !== undefined) failures.push(`unheld relic applied ${JSON.stringify(notHeld)}`);

  const run = held({ depth: 10 });
  const snap = JSON.stringify(run);
  applyEmerald('final_chaos', run);
  if (JSON.stringify(run) !== snap) failures.push('applyEmerald mutated run');

  /* auto-pick determinism: middle offer, stable */
  for (let n = 1; n <= 6; n++) {
    const expected = Math.floor((n - 1) / 2);
    if (autoPickIndex(n) !== expected) failures.push(`autoPickIndex(${n}) != ${expected}`);
  }
  if (autoPickIndex(3) !== 1) failures.push('auto-pick must take the middle card of three');
  if (autoPickIndex(3) !== autoPickIndex(3)) failures.push('auto-pick nondeterministic');

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
