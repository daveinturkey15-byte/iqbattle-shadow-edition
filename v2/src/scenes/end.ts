/**
 * end.ts — END SCREEN parity scene (v2 port of index.html endRun + review.js
 * renderFor + accolades chip strip; mechanic not code).
 *
 * Layout per DNA (1600x900 logical stage, one-hue accent discipline):
 *   - headline: MATCH TERMINATED + score/depth summary
 *   - left:  per-round REVIEW strip — "ROUND N · <stage name>" with a
 *            CORRECT/WRONG/NO ANSWER chip and signed points
 *   - right: ranked SCOREBOARD — rank badge / name / score; equal scores
 *            share a rank (competition ranking 1-2-2-4)
 *   - right, below: ACCOLADES chips computed from run.stats via
 *     computeAccolades() (ties share — a shared accolade shows once)
 *
 * Pure presentation: no timers, no Math.random, no Date.now, no network.
 * The caller owns buttons/lifecycle; this returns a Container ready to show.
 * Every text label is >= 14px (ticket floor; DNA brief floor is 11px).
 */
import { Container, Graphics, Text } from 'pixi.js';
import { panel, text } from './game.ts';
import { T, STAGE_W, STAGE_H } from '../theme.ts';
import { computeAccolades, type MatchStats } from '../meta/accolades.ts';

/* ------------------------------------------------------------------ */
/* Contracts                                                           */
/* ------------------------------------------------------------------ */

/** One row of the final scoreboard (already includes everyone who played). */
export interface EndScoreRow {
  uid: string;
  name: string;
  pts: number;
  /** highlight marker for the local player */
  you?: boolean;
}

/** One reviewed round, as recorded post-reveal (answers public — safe). */
export interface EndReviewEntry {
  /** 1-based round number */
  n: number;
  /** stage label shown in the strip, e.g. "COUNT GRID" or "RED LIGHT" */
  stage: string;
  /** true/false answered wrong/right; null = skipped or never answered */
  correct: boolean | null;
  /** signed points awarded for the round */
  points: number;
}

/** Run snapshot at match end (mirrors main.ts Run + MP final table). */
export interface EndRun {
  name: string;
  roomName?: string;
  seed?: number;
  /** rounds played (depth reached) */
  depth: number;
  hp?: number;
  score: number;
  /** final ranked table; omitted => solo run of `name` with `score` */
  scores?: EndScoreRow[];
  /** full match record for accolade computation; omitted => no accolade strip */
  stats?: MatchStats | null;
}

/* ------------------------------------------------------------------ */
/* Drawing helpers                                                     */
/* ------------------------------------------------------------------ */

function rect(parent: Container, x: number, y: number, w: number, h: number, r: number,
  fill: string, alpha = 1, strokeColor?: string, strokeAlpha = 1): Graphics {
  const g = new Graphics();
  g.roundRect(x, y, w, h, r);
  g.fill({ color: fill, alpha });
  if (strokeColor) g.stroke({ color: strokeColor, width: 1, alpha: strokeAlpha });
  parent.addChild(g);
  return g;
}

function centerText(parent: Container, str: string, cx: number, y: number,
  size: number, color: string, bold = false): Text {
  const t = text(parent, str, 0, y, size, color, bold);
  t.x = cx - t.width / 2;
  return t;
}

const RANK_COLORS = [T.gold, '#c9d3e0', '#b0763b'];
const ROW_BG = 'rgba(255,255,255,0.02)';
const CHIP_GOOD_BG = 'rgba(0,230,138,0.14)';
const CHIP_BAD_BG = 'rgba(255,32,56,0.14)';

interface ChipStyle { fg: string; bg: string }

function verdictChip(correct: boolean | null): { label: string; style: ChipStyle } {
  if (correct === true) return { label: 'CORRECT', style: { fg: T.good, bg: CHIP_GOOD_BG } };
  if (correct === false) return { label: 'WRONG', style: { fg: T.bad, bg: CHIP_BAD_BG } };
  return { label: 'NO ANSWER', style: { fg: T.muted, bg: ROW_BG } };
}

function fmtPoints(points: number, correct: boolean | null): string {
  if (correct === null) return '±0';
  const sign = points > 0 ? '+' : points < 0 ? '−' : '±';
  return `${sign}${Math.abs(Math.round(points))} PTS`;
}

/** Offscreen measure of a bold label at `size` (probe is destroyed). */
function labelWidth(label: string, size = 14): number {
  const probe = new Text({ text: label, style: { fontFamily: T.font, fontSize: size, fill: '#fff', fontWeight: '800', letterSpacing: 1 } });
  const w = Math.ceil(probe.width);
  probe.destroy();
  return w;
}

/** Rounded pill with left-padded label; returns total width for flow layout. */
function chip(parent: Container, x: number, y: number, label: string,
  fg: string, bg: string, padX = 12, h = 26): number {
  const w = labelWidth(label) + padX * 2;
  rect(parent, x, y, w, h, h / 2, bg, 1, fg, 0.35);
  text(parent, label, x + padX, y + (h - 14) / 2 - 1, 14, fg, true);
  return w;
}

/** Rank badge: rotated square (diamond) with the rank number inside. */
function rankBadge(parent: Container, x: number, y: number, rank: number): void {
  const color = RANK_COLORS[rank - 1] ?? T.muted;
  const s = 22;
  const g = new Graphics();
  g.moveTo(x, y - s / 2);
  g.lineTo(x + s / 2, y);
  g.lineTo(x, y + s / 2);
  g.lineTo(x - s / 2, y);
  g.closePath();
  g.fill({ color, alpha: 0.18 });
  g.stroke({ color, width: 1.5 });
  parent.addChild(g);
  const num = text(parent, String(rank), x, y, 14, color, true);
  num.x = x - num.width / 2;
  num.y = y - num.height / 2;
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

const MAX_REVIEW_ROWS = 9;

/** Left column: "ROUND N · STAGE" rows with verdict chips + signed points. */
function drawReview(root: Container, x: number, y: number, w: number, h: number,
  review: readonly EndReviewEntry[]): void {
  rect(root, x, y, w, h, T.radius, '#000000', 0, T.panelEdge);
  text(root, 'ROUND REVIEW', x + 20, y + 16, 15, T.muted, true);

  const ordered = review.slice().sort((a, b) => b.n - a.n); // latest first
  const shown = ordered.slice(0, MAX_REVIEW_ROWS);
  let ry = y + 48;

  for (const r of shown) {
    rect(root, x + 16, ry, w - 32, 44, 10, T.tile, 1, T.tileEdge);
    text(root, `ROUND ${r.n}`, x + 34, ry + 13, 15, T.ink, true);
    text(root, r.stage.toUpperCase(), x + 130, ry + 14, 14, T.muted);
    const v = verdictChip(r.correct);
    const pts = fmtPoints(r.points, r.correct);
    const ptsW = labelWidth(pts, 15);
    chip(root, x + w - 40 - ptsW - 16 - labelWidth(v.label) - 24, ry + 9,
      v.label, v.style.fg, v.style.bg);
    text(root, pts, x + w - 40 - ptsW, ry + 13, 15,
      r.correct === true ? T.good : r.correct === false ? T.bad : T.muted, true);
    ry += 52;
  }
  if (ordered.length > shown.length) {
    text(root, `+${ordered.length - shown.length} EARLIER ROUNDS`, x + 34, ry + 4, 14, T.muted);
  }
  if (!review.length) {
    text(root, 'NO ROUNDS RECORDED', x + 34, ry + 4, 14, T.muted);
  }
}

/** Right column top: ranked badge/name/score board; ties share a rank. */
function drawScoreboard(root: Container, x: number, y: number, w: number,
  run: EndRun): number {
  rect(root, x, y, w, 64, T.radius, '#000000', 0, T.panelEdge);
  text(root, 'SCOREBOARD', x + 20, y + 24, 15, T.muted, true);

  const rows = (run.scores && run.scores.length
    ? run.scores.slice()
    : [{ uid: 'you', name: run.name || 'YOU', pts: run.score, you: true }]
  ).sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));

  let ry = y + 76;
  let prevPts = NaN;
  let rank = 0;
  for (let i = 0; i < rows.length && i < 8; i++) {
    const row = rows[i];
    // competition ranking: equal scores share the earlier rank
    rank = row.pts === prevPts ? rank : i + 1;
    prevPts = row.pts;
    rect(root, x, ry, w, 50, 10, ROW_BG, 1, row.you ? T.good : T.panelEdge, row.you ? 0.4 : 1);
    rankBadge(root, x + 30, ry + 25, rank);
    const nameT = text(root, row.name.toUpperCase().slice(0, 14), x + 58, ry + 15, 16,
      row.you ? T.good : T.ink, true);
    if (row.you) text(root, '· YOU', x + 58 + nameT.width + 8, ry + 16, 14, T.good);
    const score = text(root, String(Math.round(row.pts)), 0, ry + 14, 18, T.gold, true);
    score.x = x + w - 24 - score.width;
    ry += 58;
  }
  return ry;
}

/** Right column bottom: accolade chips (earned only — v1 parity), ties share. */
function drawAccolades(root: Container, x: number, y: number, w: number,
  stats: MatchStats | null | undefined): number {
  rect(root, x, y, w, 150, T.radius, '#000000', 0, T.panelEdge);
  text(root, 'ACCOLADES', x + 20, y + 16, 15, T.muted, true);

  const awards = computeAccolades(stats).filter((a) => a.earned);
  if (!awards.length) {
    text(root, 'NONE EARNED THIS RUN', x + 20, y + 46, 14, T.muted);
    return y + 150;
  }
  let cx = x + 20;
  let cy = y + 44;
  for (const a of awards) {
    const label = a.label.toUpperCase();
    const cw = labelWidth(label) + 28;
    if (cx + cw > x + w - 20) { cx = x + 20; cy += 34; }
    chip(root, cx, cy, label, T.gold, 'rgba(212,160,23,0.12)');
    cx += cw + 10;
  }
  return y + 150;
}

/* ------------------------------------------------------------------ */
/* Scene assembly                                                      */
/* ------------------------------------------------------------------ */

/**
 * Build the full end screen. Returns a Container sized to the logical stage;
 * the caller adds action buttons (Descend Again / Landing) below y=780.
 */
export function buildEnd(run: EndRun, review: readonly EndReviewEntry[]): Container {
  const root = new Container();
  panel(root, 0, 0, STAGE_W, STAGE_H);

  centerText(root, 'MATCH TERMINATED', STAGE_W / 2, 36, 18, T.muted, true);
  const won = (run.hp ?? 100) > 0;
  centerText(root, `${run.name || 'YOU'} — SCORE ${Math.round(run.score)} · DEPTH ${run.depth}`,
    STAGE_W / 2, 66, 40, won ? T.good : T.bad, true);
  if (run.roomName) centerText(root, run.roomName.toUpperCase(), STAGE_W / 2, 122, 14, T.muted);

  drawReview(root, 60, 170, 880, 600, review);

  const sbBottom = drawScoreboard(root, 980, 170, 560, run);
  drawAccolades(root, 980, sbBottom + 16, 560, run.stats);

  if (typeof run.seed === 'number') {
    text(root, `RUN SEED ${run.seed >>> 0}`, 60, 800, 14, T.muted);
  }
  return root;
}
