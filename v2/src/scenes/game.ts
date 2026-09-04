import { Container, Graphics, Sprite, Texture, Text } from 'pixi.js';
import { T, STAGE_W, STAGE_H } from '../theme.ts';
import { tileCanvas } from '../glyphs.ts';
import type { Puzzle } from '../puzzles/types.ts';
import { BOARD_PANEL, SIDEBAR, GRID_GAP, puzzleLayout, type PuzzleLayout } from './layouthelper.ts';
import { luxeBackdrop, luxePanel } from '../style/panelkit.ts';

/** Live sidebar data hooks. main.dealPuzzle passes getters bound to run state;
 *  absent hooks fall back to a solo "YOU" row so the sidebar is never dead. */
export interface SidebarPlayer {
  name: string;
  score: number;
  you?: boolean;
  /** seconds since this player's last response; null = waiting */
  clock?: number | null;
  rank?: number;
  /** LMS rank swing since the last reveal ('▲2' / '▼1' / ''). */
  glyph?: string;
  /** LMS hp 0..100 — drives the card's health rail. Absent in solo. */
  hp?: number;
  /** Eliminated seats grey out; 'left' seats also carry the LEFT tag. */
  phase?: 'alive' | 'spectator' | 'left';
  /** Set by the LMS layer when this row is a legal attack target. */
  onAttack?: () => void;
}
export interface GameSceneOpts {
  score?: () => number;
  players?: () => SidebarPlayer[];
  /** LMS: block the option grid (spectators watch, they do not answer). */
  locked?: () => boolean;
}

/** Build the play surface in the 1600x900 logical space (Shell owns header /
 *  status strip chrome): board panel with fitted options grid + live sidebar. */
export function buildGameScene(
  p: Puzzle,
  onAnswer: (idx: number, correct: boolean) => void,
  depth = 1,
  opts: GameSceneOpts = {},
  /**
   * Where the live sidebar is parented. The round modifiers transform the
   * container this function RETURNS — mirror-flip negates its scale.x,
   * rotate-90 turns it a quarter turn about the stage centre, tilt-3d skews it.
   * The sidebar used to live inside that container, so every one of those
   * modifiers rotated and mirrored the player rail along with the board: the
   * owner hit a depth-9 round where his own name was printed sideways up the
   * left of the screen. The board is the thing the modifiers are meant to
   * corrupt; the chrome that tells you your score and who is still alive is
   * not. Pass an untransformed container (main.ts passes the round overlay)
   * and the rail stays upright through every modifier. Defaults to the scene
   * root so any other caller keeps the old behaviour.
   */
  chrome?: Container,
): Container {
  const root = new Container();
  void depth;

  const layout = puzzleLayout(p.cols, p.rows);
  const boardPanel = panel(root, BOARD_PANEL.x, BOARD_PANEL.y, BOARD_PANEL.w, BOARD_PANEL.h);

  // board block — horizontally centered per col count (DNA: generous padding)
  const totalTiles = Math.max(p.cells.length, p.cols * p.rows, p.holeIndex + 1);
  for (let i = 0; i < totalTiles; i++) {
    const col = i % p.cols, row = Math.floor(i / p.cols);
    const hole = i === p.holeIndex;
    const prims = p.cells[i];
    if (!hole && !prims && i >= p.cells.length) continue;
    const s = spriteFrom(tileCanvas(prims ?? [], p.hue, layout.cellSize, { hole }));
    s.x = layout.bx + col * (layout.cellSize + GRID_GAP);
    s.y = layout.by + row * (layout.cellSize + GRID_GAP);
    boardPanel.addChild(s);
  }

  // options 4x2 — sized by layouthelper so they ALWAYS fit inside the panel
  // with >=14px gaps at both 2-row and 3-row boards (layout-audit X3).
  let answered = false;
  p.options.forEach((prims, idx) => {
    const s = spriteFrom(tileCanvas(prims, p.hue, layout.optSize));
    s.label = 'opt' + idx; /* stable handle for the browser gate (qa.ts) */
    s.x = layout.ox + (idx % 4) * (layout.optSize + GRID_GAP);
    s.y = layout.oy + Math.floor(idx / 4) * (layout.optSize + GRID_GAP);
    s.eventMode = 'static'; s.cursor = 'pointer';
    s.on('pointerdown', () => {
      if (answered) return; /* single-fire: a second click must not re-deal */
      if (opts.locked?.()) return; /* LMS: the eliminated may look, not touch */
      answered = true;
      const correct = idx === p.answer;
      s.tint = correct ? GOOD_TINT : BAD_TINT; /* instant <100ms feedback */
      revealRule(boardPanel, p.rule, layout);
      onAnswer(idx, correct);
    });
    boardPanel.addChild(s);
    const label = text(boardPanel, String(idx + 1), s.x + 6, s.y + layout.optSize - 22, 12, T.muted);
    label.label = `optlabel${idx}`;
  });

  buildLiveSidebar(chrome ?? root, opts);

  return root;
}

const GOOD_TINT = 0x00e68a; /* T.good */
const BAD_TINT = 0xff2038; /* T.bad */

/** Rule sentence rendered INSIDE the board panel at reveal (layout-audit X4):
 *  a dark band across the board area, wrapped + centered for contrast. */
function revealRule(parent: Container, rule: string, l: PuzzleLayout): void {
  const bandH = 96;
  const bandY = l.by + Math.max(0, (l.boardH - bandH) / 2);
  const g = new Graphics();
  g.roundRect(0, bandY, BOARD_PANEL.w, bandH, T.radius)
    .fill({ color: T.bg, alpha: 0.92 })
    .stroke({ color: T.panelEdge, width: 1 });
  parent.addChild(g);

  const head = text(parent, 'THE RULE', 0, 0, 11, T.muted, true);
  head.x = Math.round((BOARD_PANEL.w - head.width) / 2);
  head.y = bandY + 12;
  const body = new Text({
    text: rule,
    style: {
      fontFamily: T.font, fontSize: 19, fill: T.ink, fontWeight: '700',
      letterSpacing: 1, wordWrap: true, wordWrapWidth: BOARD_PANEL.w - 80, align: 'center',
      breakWords: false,
    },
  });
  body.x = Math.round((BOARD_PANEL.w - body.width) / 2);
  body.y = Math.round(bandY + (bandH - body.height) / 2) + 8;
  parent.addChild(body);
}

/* ------------------------------------------------------------------ */
/* live sidebar (layout-audit X5): PLAYERS n · right-aligned score ·   */
/* rank/avatar/name/clock/score cards refreshed from opts callbacks    */
/* ------------------------------------------------------------------ */

const RANK_COLORS = [T.gold, '#c9d3e0', '#b0763b'];
const CARD_W = SIDEBAR.w - 48;
const CARD_H = 72;
const CARD_PITCH = 84;

function buildLiveSidebar(root: Container, opts: GameSceneOpts): void {
  const side = panel(root, SIDEBAR.x, SIDEBAR.y, SIDEBAR.w, SIDEBAR.h);
  const countT = text(side, 'PLAYERS 0', 24, 18, 13, T.muted, true);
  const scoreT = text(side, '0', 0, 10, 22, T.gold, true);
  const rowsC = new Container();
  rowsC.y = 52;
  side.addChild(rowsC);

  const refresh = (): void => {
    const score = opts.score?.() ?? 0;
    scoreT.text = String(score);
    scoreT.x = SIDEBAR.w - 24 - scoreT.width; /* right rail alignment */

    const players = opts.players?.() ?? [{ name: 'YOU', you: true, score }];
    countT.text = 'PLAYERS ' + players.length;

    rowsC.removeChildren().forEach((c) => c.destroy({ children: true }));
    players.slice(0, 7).forEach((pl, i) => rowsC.addChild(playerRow(pl, i * CARD_PITCH)));
    /* Score rail mirrors YOUR row once the LMS table is authoritative. */
    const mine = players.find((pl) => pl.you);
    if (mine) {
      scoreT.text = String(mine.score);
      scoreT.x = SIDEBAR.w - 24 - scoreT.width;
    }
  };
  refresh();
  const iv = window.setInterval(refresh, 200);
  const origDestroy = side.destroy.bind(side);
  side.destroy = ((...a: Parameters<Container['destroy']>) => {
    window.clearInterval(iv);
    origDestroy(...a);
  }) as typeof side.destroy;
}

function playerRow(pl: SidebarPlayer, y: number): Container {
  const card = new Container();
  card.y = y;
  const out = pl.phase === 'spectator' || pl.phase === 'left';
  const g = new Graphics();
  g.roundRect(0, 0, CARD_W, CARD_H, T.radius)
    .fill({ color: T.tile, alpha: out ? 0.5 : 1 })
    .stroke({ color: pl.onAttack ? T.bad : T.panelEdge, width: pl.onAttack ? 2 : 1 });
  card.addChild(g);
  if (out) card.alpha = 0.55;
  if (pl.onAttack) {
    /* Targetable rival: the whole card is the throw button. */
    card.eventMode = 'static';
    card.cursor = 'pointer';
    card.on('pointerdown', () => pl.onAttack?.());
  }

  const rank = pl.rank ?? (pl.you ? 1 : undefined);
  const diamond = new Graphics();
  diamond.moveTo(0, -8); diamond.lineTo(8, 0); diamond.lineTo(0, 8); diamond.lineTo(-8, 0);
  diamond.fill({ color: rank !== undefined && rank <= 3 ? RANK_COLORS[rank - 1] : T.muted });
  diamond.x = 26; diamond.y = CARD_H / 2;
  card.addChild(diamond);

  const avatarBg = new Graphics();
  avatarBg.circle(0, 0, 16).fill({ color: T.accentB, alpha: 0.22 }).stroke({ color: T.panelEdge, width: 1 });
  avatarBg.x = 58; avatarBg.y = CARD_H / 2;
  card.addChild(avatarBg);
  const initial = text(card, (pl.name[0] ?? '?').toUpperCase(), 0, 27, 14, T.ink, true);
  initial.x = 58 - initial.width / 2;

  const nameT = text(card, pl.name, 86, 11, 15, T.ink, true);
  let tagX = nameT.x + nameT.width + 8;
  if (pl.you) { const t0 = text(card, 'YOU', tagX, 14, 11, T.gold, true); tagX = t0.x + t0.width + 6; }
  if (pl.phase === 'spectator') { const t1 = text(card, 'OUT', tagX, 14, 11, T.bad, true); tagX = t1.x + t1.width + 6; }
  else if (pl.phase === 'left') { const t2 = text(card, 'LEFT', tagX, 14, 11, T.muted, true); tagX = t2.x + t2.width + 6; }
  if (pl.glyph) text(card, pl.glyph, tagX, 14, 11, pl.glyph.startsWith('▲') ? T.good : T.bad, true);

  /* LMS health rail. HP is the life bar — elimination is HP death — so this
   * is the single most important number on the card: it must be readable at
   * a glance AND exact, hence rail + numeral. */
  if (typeof pl.hp === 'number') {
    const railW = CARD_W - 86 - 130;
    const hp = Math.max(0, Math.round(pl.hp));
    const frac = Math.max(0, Math.min(1, hp / 100));
    const col = frac > 0.5 ? 0x22d3a5 : frac > 0.25 ? 0xd4a017 : 0xff2e88;
    const rail = new Graphics();
    rail.roundRect(86, 31, railW, 6, 3).fill({ color: 0xffffff, alpha: 0.08 });
    if (frac > 0) rail.roundRect(86, 31, Math.max(3, railW * frac), 6, 3).fill({ color: col });
    card.addChild(rail);
    const hpT = text(card, String(hp), 86 + railW + 8, 26, 12,
      frac > 0.5 ? T.muted : frac > 0.25 ? T.gold : T.bad, frac <= 0.25);
    hpT.style.fontFamily = 'ui-monospace, Consolas, monospace';
  }

  const clockStr = typeof pl.clock === 'number' ? pl.clock.toFixed(3) + 's' : 'waiting…';
  const clock = text(card, clockStr, 0, 46, 11, typeof pl.clock === 'number' ? T.ink : T.muted);
  clock.style.fontFamily = 'ui-monospace, Consolas, monospace';
  clock.x = CARD_W - 24 - clock.width;

  const score = text(card, String(pl.score), 0, 14, 15, T.ink, true);
  score.x = CARD_W - 24 - score.width;

  return card;
}

export function panel(parent: Container, x: number, y: number, w: number, h: number): Container {
  // full-stage call = page backdrop (luxe body background), not a card
  if (w >= STAGE_W - 1 && h >= STAGE_H - 1) {
    const c = new Container(); c.x = x; c.y = y;
    luxeBackdrop(c);
    parent.addChild(c);
    return c;
  }
  return luxePanel(parent, x, y, w, h);
}

export function text(parent: Container, str: string, x: number, y: number, size: number, color: string, bold = false): Text {
  const t = new Text({ text: str, style: { fontFamily: T.font, fontSize: size, fill: color, fontWeight: bold ? '800' : '500', letterSpacing: 1 } });
  t.x = x; t.y = y;
  parent.addChild(t);
  return t;
}

const cache = new Map<string, Texture>();
export function spriteFrom(cv: HTMLCanvasElement): Sprite {
  const key = cv.toDataURL();
  let tex = cache.get(key);
  if (!tex) { tex = Texture.from(cv); cache.set(key, tex); }
  const s = new Sprite(tex);
  s.width = cv.width; s.height = cv.height;
  return s;
}
