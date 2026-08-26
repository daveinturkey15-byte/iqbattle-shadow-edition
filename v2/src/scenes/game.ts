import { Container, Sprite, Texture, Text } from 'pixi.js';
import { T, STAGE_W, STAGE_H } from '../theme.ts';
import { tileCanvas } from '../glyphs.ts';
import type { Puzzle } from '../puzzles/types.ts';

/** Build the full game layout in the 1600x900 logical space, DNA-faithful:
 * header / status strip with gradient timer / board panel / 4x2 options / sidebar. */
export function buildGameScene(p: Puzzle, onAnswer: (idx: number, correct: boolean) => void, depth = 1): Container {
  const root = new Container();

  // background
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W; bg.height = STAGE_H; bg.tint = T.bg;
  root.addChild(bg);

  // header
  text(root, 'LOBBY', 40, 26, 15, T.muted);
  text(root, 'PRIVATE ROOM', STAGE_W / 2 - 90, 26, 17, T.ink, true);

  // status strip panel
  const strip = panel(root, 40, 70, 920, 74);
  text(strip, `DEPTH ${depth}`, 24, 12, 20, T.ink, true);
  const timer = text(strip, '01:00', 820, 12, 20, T.ink, true);
  (strip as any).__timer = timer;

  // board panel (board + options live here, centered in the left region)
  const boardPanel = panel(root, 40, 164, 920, 640);
  const cellSize = p.cols === 2 ? 150 : 118;
  const gap = 14;
  const boardW = p.cols * cellSize + (p.cols - 1) * gap;
  const bx = (920 - boardW) / 2;
  const by = 40;
  const totalTiles = Math.max(p.cells.length, p.cols * p.rows, p.holeIndex + 1);
  for (let i = 0; i < totalTiles; i++) {
    const col = i % p.cols, row = Math.floor(i / p.cols);
    const hole = i === p.holeIndex;
    const prims = p.cells[i];
    if (!hole && !prims && i >= p.cells.length) continue;
    const s = spriteFrom(tileCanvas(prims ?? [], p.hue, cellSize, { hole }));
    s.x = bx + col * (cellSize + gap); s.y = by + row * (cellSize + gap);
    boardPanel.addChild(s);
  }

  // options 4x2
  const optSize = 118;
  const optW = 4 * optSize + 3 * gap;
  const ox = (920 - optW) / 2;
  const oy = by + p.rows * (cellSize + gap) + 36;
  p.options.forEach((prims, idx) => {
    const s = spriteFrom(tileCanvas(prims, p.hue, optSize));
    s.x = ox + (idx % 4) * (optSize + gap);
    s.y = oy + Math.floor(idx / 4) * (optSize + gap);
    s.eventMode = 'static'; s.cursor = 'pointer';
    s.on('pointerdown', () => onAnswer(idx, idx === p.answer));
    boardPanel.addChild(s);
    const label = text(boardPanel, String(idx + 1), s.x + 6, s.y + optSize - 22, 12, T.muted);
    label.label = `optlabel${idx}`;
  });

  // sidebar
  const side = panel(root, 984, 70, 576, 734);
  text(side, 'YOU', 24, 20, 16, T.ink, true);
  text(side, '0', 500, 20, 16, T.ink, true);
  text(side, 'shadow awaits', 24, 48, 12, T.muted);

  /* rule sentence intentionally NOT shown during play — it is revealed in
   * the answer toast (DNA: the board teaches the rule, not a caption). */

  void timer;
  return root;
}

export function panel(parent: Container, x: number, y: number, w: number, h: number): Container {
  const c = new Container(); c.x = x; c.y = y;
  const g = new Sprite(Texture.WHITE);
  g.width = w; g.height = h; g.tint = T.panel; g.alpha = 1;
  c.addChild(g);
  parent.addChild(c);
  return c;
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
