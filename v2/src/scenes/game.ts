import { Container, Sprite, Texture, Text } from 'pixi.js';
import { T, STAGE_W, STAGE_H } from '../theme.ts';
import { tileCanvas } from '../glyphs.ts';
import type { Puzzle } from '../puzzles/types.ts';

/** Build the full game layout in the 1600x900 logical space, DNA-faithful:
 * header / status strip with gradient timer / board panel / 4x2 options / sidebar. */
export function buildGameScene(p: Puzzle, onAnswer: (idx: number, correct: boolean) => void, depth = 1): Container {
  const root = new Container();

  /* Chrome (header, status strip, timer) is owned by Shell.attach in main.ts —
   * this scene renders ONLY the play surface so Shell chrome stays visible. */
  void depth;

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

  // options 4x2 — sized to fit inside the 640px board panel at every row count
  const optSize = p.rows >= 3 ? 88 : 108;
  const optW = 4 * optSize + 3 * 12;
  const ox = (920 - optW) / 2;
  const oy = by + p.rows * (cellSize + gap) + 30;
  p.options.forEach((prims, idx) => {
    const s = spriteFrom(tileCanvas(prims, p.hue, optSize));
    s.x = ox + (idx % 4) * (optSize + 12);
    s.y = oy + Math.floor(idx / 4) * (optSize + 12);
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
