import { Container, Graphics, Sprite, Texture, Text } from 'pixi.js';
import type { TextStyleFontWeight } from 'pixi.js';
import { T, STAGE_W, STAGE_H } from '../theme.ts';

/** panelkit — the REFINED v1 ("luxe") style layer as Pixi primitives.
 *
 * Source of truth: root luxe.css tokens + research/refs captures.
 * Every factory here is canvas-texture backed (crisp, cached) so scenes get
 * the v1 treatment — sheen panels, accent hairline borders, blue-wash pills,
 * glowing black tiles, letterspaced labels, rank diamonds — without CSS.
 *
 * Adoption: game.ts panel()/text() delegate here; shell.ts chrome and any
 * scene can use the factories directly. */

/* ------------------------------------------------------------------ */
/* font readiness                                                      */
/* ------------------------------------------------------------------ */

let fontsPromise: Promise<void> | null = null;
/** Resolves once Oxanium (400/500/700/800) is really available, so Text
 * glyphs are baked with the true face instead of a fallback. */
export function whenFontsReady(): Promise<void> {
  if (!fontsPromise) {
    const fonts = (typeof document !== 'undefined' && document.fonts) || null;
    if (!fonts) { fontsPromise = Promise.resolve(); return fontsPromise; }
    const wanted = [400, 500, 700, 800].map((w) => fonts.load(`${w} 16px Oxanium`));
    fontsPromise = Promise.race([
      Promise.all(wanted).then(() => undefined),
      new Promise<void>((res) => setTimeout(res, 2500)),
    ]);
  }
  return fontsPromise;
}

/* ------------------------------------------------------------------ */
/* canvas texture plumbing                                             */
/* ------------------------------------------------------------------ */

const texCache = new Map<string, Texture>();

function canvasTex(key: string, w: number, h: number, scale: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): Texture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * scale));
  cv.height = Math.max(1, Math.round(h * scale));
  const ctx = cv.getContext('2d')!;
  ctx.scale(scale, scale);
  draw(ctx, w, h);
  const tex = Texture.from(cv);
  texCache.set(key, tex);
  return tex;
}

function roundPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* ------------------------------------------------------------------ */
/* signature gradient (the 4-stop iqversus accent)                     */
/* ------------------------------------------------------------------ */

const SIG_STOPS: Array<[number, string]> = [
  [0, '#2d7cff'], [0.42, '#9b6dff'], [0.72, '#ef4cc8'], [1, '#2ce8ff'],
];

function drawSig(ctx: CanvasRenderingContext2D, w: number, h: number, flip: boolean): void {
  const g = ctx.createLinearGradient(flip ? w : 0, 0, flip ? 0 : w, 0);
  for (const [o, c] of SIG_STOPS) g.addColorStop(flip ? 1 - o : o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Horizontal 4-stop accent gradient strip (header rules, timer fill).
 * flip=true runs pink→blue (the in-match timer direction). */
export function signatureStrip(parent: Container, x: number, y: number, w: number, h: number,
  flip = false): Sprite {
  const tex = canvasTex(`sig${flip ? '-flip' : ''}`, 256, 8, 1, (ctx, cw, ch) => drawSig(ctx, cw, ch, flip));
  const s = new Sprite(tex);
  s.x = x; s.y = y; s.width = w; s.height = h;
  parent.addChild(s);
  return s;
}

/* ------------------------------------------------------------------ */
/* page backdrop (body background of luxe.css)                         */
/* ------------------------------------------------------------------ */

/** Full-stage backdrop: base bg + 115deg hairline weave + twin radial glows. */
export function luxeBackdrop(parent: Container): Sprite {
  const tex = canvasTex('backdrop', STAGE_W, STAGE_H, 1, (ctx, w, h) => {
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, w, h);
    // hairline weave
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-65 * Math.PI / 180);
    ctx.strokeStyle = 'rgba(255,255,255,0.014)';
    ctx.lineWidth = 2;
    for (let d = -w; d < w; d += 7) {
      ctx.beginPath();
      ctx.moveTo(d, -h);
      ctx.lineTo(d, h);
      ctx.stroke();
    }
    ctx.restore();
    // radial glows
    const glow = (cx: number, cy: number, r: number, color: string): void => {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    };
    glow(w * 0.78, -h * 0.1, 1200, 'rgba(63,125,255,0.07)');
    glow(w * 0.08, h * 1.1, 900, 'rgba(255,46,136,0.05)');
  });
  const s = new Sprite(tex);
  parent.addChild(s);
  return s;
}

/* ------------------------------------------------------------------ */
/* panels — sheen fill + accent hairline + 22px radius                 */
/* ------------------------------------------------------------------ */

/** luxe.css .panel: linear-gradient(135deg, rgba(43,116,235,.14), transparent 36%)
 * over #020e20, 1px rgba(64,137,238,.16) border, 22px radius. */
export function luxePanel(parent: Container, x: number, y: number, w: number, h: number,
  opts: { radius?: number; border?: boolean } = {}): Container {
  const r = opts.radius ?? T.radiusPanel;
  const c = new Container();
  c.x = x; c.y = y;
  const tex = canvasTex(`panel|${w}x${h}|${r}`, w, h, 2, (ctx, cw, ch) => {
    roundPath(ctx, 0, 0, cw, ch, r);
    ctx.fillStyle = T.panel;
    ctx.fill();
    ctx.save();
    ctx.clip();
    const g = ctx.createLinearGradient(0, 0, cw, ch);
    g.addColorStop(0, 'rgba(43,116,235,0.14)');
    g.addColorStop(0.36, 'rgba(43,116,235,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  });
  const spr = new Sprite(tex);
  spr.width = w; spr.height = h;
  c.addChild(spr);
  if (opts.border !== false) {
    const b = new Graphics();
    b.roundRect(0.5, 0.5, w - 1, h - 1, r);
    b.stroke({ color: T.panelEdge, width: 1, alpha: 1 });
    c.addChild(b);
  }
  parent.addChild(c);
  return c;
}


/** v1 label voice: uppercase, .14–.34em tracking, muted or accent color. */
export function luxeLabel(parent: Container, str: string, x: number, y: number, size: number,
  color: string = T.muted, em = 0.18, weight: TextStyleFontWeight = '700'): Text {
  const t = new Text({
    text: str.toUpperCase(),
    style: {
      fontFamily: T.font, fontSize: size, fill: color, fontWeight: weight,
      letterSpacing: Math.round(size * em * 10) / 10,
    },
  });
  t.x = x; t.y = y;
  parent.addChild(t);
  return t;
}

/* ------------------------------------------------------------------ */
/* pill buttons — refined v1 .btn / .btn.pill                          */
/* ------------------------------------------------------------------ */

export type PillVariant = 'primary' | 'ghost' | 'danger';

/** Blue-wash primary / inset-stroke ghost / crimson danger. Uppercase
 * .18em label, hover lift + brighten, press sink — v1 button behavior. */
export function pillFillTexture(w: number, h: number, radius: number,
  variant: PillVariant): Texture {
  return canvasTex(`pill|${variant}|${w}x${h}|${radius}`, w, h, 2, (ctx, cw, ch) => {
    roundPath(ctx, 0, 0, cw, ch, radius);
    if (variant === 'primary') {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#061224';
      ctx.fillRect(0, 0, cw, ch);
      const g = ctx.createLinearGradient(0, 0, cw, 0);
      g.addColorStop(0, 'rgba(43,116,235,0.92)');
      g.addColorStop(1, 'rgba(53,125,244,0.72)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    } else if (variant === 'danger') {
      ctx.save();
      ctx.clip();
      const g = ctx.createLinearGradient(0, 0, cw, ch);
      g.addColorStop(0, '#e0245e');
      g.addColorStop(1, '#ff2e88');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(2,10,22,0.52)';
      ctx.fill();
    }
  });
}

export function luxePill(parent: Container, x: number, y: number, w: number, h: number,
  label: string, onClick: () => void, variant: PillVariant = 'primary',
  opts: { radius?: number; fontSize?: number } = {}): Container {
  const c = new Container();
  c.x = x; c.y = y;
  c.eventMode = 'static';
  c.cursor = 'pointer';
  const radius = opts.radius ?? Math.min(10, h / 2);

  const fillTex = pillFillTexture(w, h, radius, variant);
  const spr = new Sprite(fillTex);
  spr.width = w; spr.height = h;
  c.addChild(spr);

  const edge = new Graphics();
  if (variant === 'ghost') {
    edge.roundRect(0.5, 0.5, w - 1, h - 1, radius);
    edge.stroke({ color: '#ffffff', width: 2, alpha: 0.25 });
  } else if (variant === 'primary') {
    edge.roundRect(0.5, 0.5, w - 1, h - 1, radius);
    edge.stroke({ color: '#5ea0ff', width: 1, alpha: 0.35 });
  }
  c.addChild(edge);

  const fontSize = opts.fontSize ?? Math.max(12, Math.min(15, Math.round(h * 0.28)));
  const lab = new Text({
    text: label.toUpperCase(),
    style: { fontFamily: T.font, fontSize, fill: variant === 'ghost' ? T.ink : '#ffffff', fontWeight: '700', letterSpacing: fontSize * 0.18 },
  });
  lab.x = (w - lab.width) / 2;
  lab.y = (h - lab.height) / 2;
  lab.eventMode = 'none';
  c.addChild(lab);

  c.on('pointerover', () => { c.alpha = 0.88; c.y = y - 2; });
  c.on('pointerout', () => { c.alpha = 1; c.y = y; });
  c.on('pointerdown', onClick);
  parent.addChild(c);
  return c;
}

/* ------------------------------------------------------------------ */
/* tiles — near-black cells with accent hairline + inner glow          */
/* ------------------------------------------------------------------ */

/** Board/option tile: #000 fill, 1px rgba(64,137,238,.24) border, soft outer
 * shadow and a faint accent inner glow (luxe .opt-btn / .board-frame cells). */
export function luxeTile(parent: Container, x: number, y: number, w: number, h: number,
  r = 14): Container {
  const c = new Container();
  c.x = x; c.y = y;
  const tex = canvasTex(`tile|${w}x${h}|${r}`, w + 16, h + 16, 2, (ctx, cw, ch) => {
    ctx.save();
    // outer shadow
    ctx.shadowColor = 'rgba(0,10,40,0.45)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    roundPath(ctx, 8, 8, cw - 16, ch - 16, r);
    ctx.fillStyle = '#000000';
    ctx.fill();
    ctx.restore();
    // inner glow: blurred accent stroke clipped to the tile
    ctx.save();
    roundPath(ctx, 8, 8, cw - 16, ch - 16, r);
    ctx.clip();
    ctx.shadowColor = 'rgba(64,137,238,0.28)';
    ctx.shadowBlur = 7;
    ctx.strokeStyle = 'rgba(64,137,238,0.16)';
    ctx.lineWidth = 2;
    roundPath(ctx, 9, 9, cw - 18, ch - 18, Math.max(1, r - 1));
    ctx.stroke();
    ctx.stroke();
    ctx.restore();
    // crisp hairline
    roundPath(ctx, 8.5, 8.5, cw - 17, ch - 17, r);
    ctx.strokeStyle = 'rgba(64,137,238,0.24)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });
  const spr = new Sprite(tex);
  spr.width = w + 16; spr.height = h + 16;
  spr.x = -8; spr.y = -8;
  c.addChild(spr);
  parent.addChild(c);
  return c;
}

/* ------------------------------------------------------------------ */
/* rank diamond badge — gold / silver / bronze                         */
/* ------------------------------------------------------------------ */

export const RANK_COLORS: readonly string[] = [T.gold, '#c9d3e0', '#b0763b'];

export function rankColor(rank: number): string {
  return rank >= 1 && rank <= 3 ? RANK_COLORS[rank - 1] : T.muted;
}

/** Filled diamond with the rank number inset — v1 scoreboard badge.
 * Returns the view plus a setRank() handle for live scoreboard updates. */
export function rankDiamond(parent: Container, cx: number, cy: number, rank: number,
  size = 9): { view: Container; setRank(rank: number): void } {
  const c = new Container();
  c.x = cx; c.y = cy;
  const g = new Graphics();
  c.addChild(g);
  const draw = (r: number): void => {
    g.clear();
    g.moveTo(0, -size); g.lineTo(size, 0); g.lineTo(0, size); g.lineTo(-size, 0);
    g.fill({ color: rankColor(r) });
    g.stroke({ color: '#ffffff', width: 1, alpha: 0.3 });
    c.removeChildren();
    c.addChild(g);
    if (r >= 1 && r <= 3) {
      const n = new Text({
        text: String(r),
        style: { fontFamily: T.font, fontSize: size + 2, fill: '#0a0d14', fontWeight: '800' },
      });
      n.x = -n.width / 2;
      n.y = -n.height / 2 + 1;
      c.addChild(n);
    }
  };
  draw(rank);
  parent.addChild(c);
  return { view: c, setRank: draw };
}
