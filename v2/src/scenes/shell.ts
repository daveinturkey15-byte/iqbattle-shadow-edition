import { Container, Graphics, Rectangle, Sprite, Texture, Text, Ticker } from 'pixi.js';
import { T, STAGE_W } from '../theme.ts';
import { panel, text } from './game.ts';
import { luxeLabel, pillFillTexture, rankDiamond, signatureStrip } from '../style/panelkit.ts';

/** Shared chrome (header bar / status strip / player cards / toasts / widgets),
 * extracted so Landing, Lobby and Game all wear the same DNA skin. */

export const MONO = 'ui-monospace, "Cascadia Mono", Consolas, monospace';

/* ------------------------------------------------------------------ */
/* primitives                                                          */
/* ------------------------------------------------------------------ */


export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(s / 60);
  return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function rect(parent: Container, x: number, y: number, w: number, h: number, r: number,
  fill: string, alpha = 1, strokeColor?: string, strokeAlpha = 1): Graphics {
  const g = new Graphics();
  g.roundRect(x, y, w, h, r);
  g.fill({ color: fill, alpha });
  if (strokeColor) g.stroke({ color: strokeColor, width: 1, alpha: strokeAlpha });
  parent.addChild(g);
  return g;
}

/** DNA panel edge stroke over a game.panel fill. */
export function edgeRect(parent: Container, x: number, y: number, w: number, h: number,
  r: number): Graphics {
  return rect(parent, x, y, w, h, r, '#000000', 0, T.panelEdge);
}

/* ------------------------------------------------------------------ */
/* header bar                                                          */
/* ------------------------------------------------------------------ */

export interface HeaderAction { label: string; onClick: () => void; danger?: boolean; quiet?: boolean; }
export interface HeaderOpts {
  /** brand logo on the left */
  logo?: boolean;
  /** quiet text button on the left (e.g. LOBBY) */
  leftLabel?: string;
  onLeft?: () => void;
  /** centered bold title (room title) */
  title?: string;
  /** quiet links / buttons on the right */
  actions?: HeaderAction[];
}

export function headerBar(parent: Container, opts: HeaderOpts = {}): Container {
  const bar = new Container();
  parent.addChild(bar);
  rect(bar, 0, 0, STAGE_W, 64, 0, '#0b1120', 0.72, T.panelEdge, 1);
  signatureStrip(bar, 0, 62, STAGE_W, 2);

  if (opts.logo) {
    richLine(bar, 130, 18, [
      { str: 'IQ ', color: T.accentB },
      { str: 'BATTLE', color: T.accentA },
    ], 22);
  } else if (opts.leftLabel) {
    makePillLink(bar, 40, 18, opts.leftLabel, opts.onLeft ?? (() => undefined));
  }

  if (opts.title) {
    const t = text(bar, opts.title, 0, 19, 17, T.ink, true);
    t.x = STAGE_W / 2 - t.width / 2;
  }

  let rx = STAGE_W - 40;
  const acts = opts.actions ?? [];
  for (let i = acts.length - 1; i >= 0; i--) {
    const a = acts[i];
    const pill = makePillLink(bar, 0, 18, a.label, a.onClick, a.danger === true);
    pill.view.x = rx - pill.width;
    if (a.quiet) pill.view.alpha = 0.55; /* >=0.55 keeps muted ink readable on the near-black bar */
    rx -= pill.width + 14;
  }
  return bar;
}

/** v1 .btn.pill header link: dark pill, hairline border (red for danger),
 * letterspaced uppercase label, border brightens on hover. */
function makePillLink(parent: Container, x: number, y: number, label: string,
  onClick: () => void, danger = false): { view: Container; width: number } {
  const h = 28;
  const padX = 16;
  const lab = new Text({
    text: label.toUpperCase(),
    style: { fontFamily: T.font, fontSize: 10, fill: danger ? '#ff8ba6' : T.ink, fontWeight: '700', letterSpacing: 1.8 },
  });
  const w = lab.width + padX * 2;
  const c = new Container();
  c.x = x; c.y = y;
  c.eventMode = 'static';
  c.cursor = 'pointer';
  c.hitArea = new Rectangle(0, 0, w, h);
  const face = new Graphics();
  const draw = (hot: boolean): void => {
    face.clear();
    face.roundRect(0.5, 0.5, w - 1, h - 1, h / 2)
      .fill({ color: '#020a16', alpha: 0.6 })
      .stroke({
        color: danger ? T.bad : hot ? T.accentA : '#ffffff',
        width: 1.5, alpha: danger ? (hot ? 0.9 : 0.4) : hot ? 0.7 : 0.25,
      });
  };
  draw(false);
  c.addChild(face);
  lab.x = padX;
  lab.y = (h - lab.height) / 2;
  lab.eventMode = 'none';
  c.addChild(lab);
  c.on('pointerover', () => { draw(true); lab.style.fill = danger ? '#ffb3cd' : T.ink; });
  c.on('pointerout', () => { draw(false); lab.style.fill = danger ? '#ff8ba6' : T.ink; });
  c.on('pointerdown', onClick);
  parent.addChild(c);
  return { view: c, width: w };
}

/** Lay out several differently-colored text runs as one visually continuous line. */
export function richLine(parent: Container, centerX: number, y: number,
  parts: Array<{ str: string; color: string }>, size: number, bold = true): void {
  const texts = parts.map((pt) => new Text({
    text: pt.str,
    style: { fontFamily: T.font, fontSize: size, fill: pt.color, fontWeight: bold ? '800' : '500', letterSpacing: 1 },
  }));
  const total = texts.reduce((acc, t) => acc + t.width, 0);
  let x = centerX - total / 2;
  for (const t of texts) { t.x = x; t.y = y; parent.addChild(t); x += t.width; }
}

/* ------------------------------------------------------------------ */
/* status strip: DEPTH label + MM:SS + gradient timer bar              */
/* ------------------------------------------------------------------ */

export interface TimerHandle {
  /** fraction 0..1 remaining; optional fresh label (defaults keep old text) */
  setTimer(fraction: number, label?: string): void;
  setDepth(n: number): void;
}

export function statusStrip(parent: Container, x: number, y: number, w: number): TimerHandle {
  const strip = panel(parent, x, y, w, 74);
  const depthLabel = text(strip, 'DEPTH 1', 24, 12, 20, T.ink, true);
  const timeLabel = text(strip, '01:00', 0, 12, 20, T.ink, true);
  const trackW = w - 48;
  timeLabel.x = w - 24 - timeLabel.width;
  rect(strip, 24, 50, trackW, 6, 3, '#ffffff', 0.14);
  const fillSpr = signatureStrip(strip, 24, 50, trackW, 6, true);
  return {
    setTimer(fraction, label) {
      const f = Math.max(0, Math.min(1, fraction));
      fillSpr.width = trackW * f;
      fillSpr.visible = f > 0;
      if (label !== undefined) {
        timeLabel.text = label;
        timeLabel.x = w - 24 - timeLabel.width;
      }
    },
    setDepth(n) { depthLabel.text = 'DEPTH ' + n; },
  };
}

/* ------------------------------------------------------------------ */
/* sidebar player card                                                 */
/* ------------------------------------------------------------------ */

export interface PlayerCardHandle {
  /** live response clock; null switches to "waiting…" state */
  setClock(seconds: number | null): void;
  setScore(score: number): void;
  setRank(rank: number): void;
}

const RANK_COLORS = [T.gold, '#c9d3e0', '#b0763b'];

export function playerCard(parent: Container, x: number, y: number, w: number,
  name: string, tags: string[] = []): PlayerCardHandle {
  const card = new Container();
  card.x = x; card.y = y;
  parent.addChild(card);

  rect(card, 0, 0, w, 72, T.radiusCard, T.panel, 1, T.panelEdge);

  const badge = rankDiamond(card, 26, 36, 1, 9);

  const avatarBg = new Graphics();
  avatarBg.circle(0, 0, 16).fill({ color: T.accentB, alpha: 0.22 }).stroke({ color: T.panelEdge, width: 1 });
  avatarBg.x = 58; avatarBg.y = 36;
  card.addChild(avatarBg);
  const initial = text(card, (name[0] ?? '?').toUpperCase(), 0, 27, 14, T.ink, true);
  initial.x = 58 - initial.width / 2;

  const nameT = text(card, name, 86, 20, 15, T.ink, true);
  if (tags.length > 0) {
    text(card, tags.join(' · '), nameT.x + nameT.width + 8, 23, 11, T.gold);
  }

  const clock = text(card, 'waiting…', 0, 42, 11, T.muted);
  clock.style.fontFamily = MONO;
  clock.alpha = 0.75;
  clock.x = w - 24 - clock.width;
  const score = text(card, '0', 0, 18, 16, T.ink, true);
  score.x = w - 24 - score.width;

  return {
    setClock(secs) {
      if (secs === null) {
        clock.text = 'waiting…';
        clock.style.fill = T.muted;
        clock.alpha = 0.75;
      } else {
        clock.text = secs.toFixed(3) + 's';
        clock.style.fill = T.ink;
        clock.alpha = 1;
      }
      clock.style.fontFamily = MONO;
      clock.x = w - 24 - clock.width;
    },
    setScore(sc) {
      score.text = String(sc);
      score.x = w - 24 - score.width;
    },
    setRank(rank) {
      badge.setRank(rank);
    },
  };
}

/* ------------------------------------------------------------------ */
/* toast / banner (escapable, auto-fade after 1.4s)                    */
/* ------------------------------------------------------------------ */

export type ToastKind = 'good' | 'bad' | 'info';
const TOAST_COLOR: Record<ToastKind, string> = { good: T.good, bad: T.bad, info: T.accentB };

export function toast(stage: Container, message: string, kind: ToastKind = 'info'): Container {
  const holder = new Container();
  const color = TOAST_COLOR[kind];
  const label = new Text({
    text: message,
    style: { fontFamily: T.font, fontSize: 15, fill: T.ink, fontWeight: '800', letterSpacing: 1, wordWrap: true, wordWrapWidth: 720 },
  });
  const w = Math.min(STAGE_W - 120, label.width + 44);
  rect(holder, 0, 0, w, label.height + 24, T.radius, T.panel, 0.96, color, 0.5);
  label.x = (w - label.width) / 2;
  label.y = 12;
  holder.addChild(label);
  holder.x = (STAGE_W - w) / 2;
  holder.y = 108;
  holder.eventMode = 'static';
  stage.addChild(holder);

  let age = 0;
  let dead = false;
  const tick = (tk: Ticker): void => {
    age += tk.deltaMS;
    if (age > 1400) {
      holder.alpha = Math.max(0, 1 - (age - 1400) / 350);
      if (holder.alpha <= 0) dead = true;
    }
    if (dead) {
      Ticker.shared.remove(tick);
      holder.off('pointerdown', kill);
      holder.destroy({ children: true });
    }
  };
  const kill = (): void => { dead = true; };
  holder.on('pointerdown', kill);
  Ticker.shared.add(tick);
  return holder;
}

/* ------------------------------------------------------------------ */
/* widgets: button + text input                                        */
/* ------------------------------------------------------------------ */

export type ButtonVariant = 'primary' | 'ghost' | 'danger';

export function makeButton(parent: Container, x: number, y: number, w: number, h: number,
  label: string, onClick: () => void, variant: ButtonVariant = 'primary'): Container {
  const c = new Container();
  c.x = x; c.y = y;
  c.eventMode = 'static';
  c.cursor = 'pointer';
  /* Explicit hit area — do NOT rely on child geometry. `face` below doubles
   * as the sheen mask, and Pixi excludes masks from hit-testing, which left
   * ghost/danger buttons (landing JOIN, every LEAVE) visible but unclickable:
   * the whole join-by-code entry path was dead. Bounds still measured fine,
   * so nothing caught it until a hit-test gate went looking. */
  c.hitArea = new Rectangle(0, 0, w, h);

  /* luxe pill fill (panelkit); `face` doubles as mask + ghost/danger face */
  const radius = Math.min(10, h / 2);
  const face = new Graphics();
  face.roundRect(0, 0, w, h, radius);
  if (variant === 'primary') {
    const spr = new Sprite(pillFillTexture(w, h, radius, 'primary'));
    spr.width = w; spr.height = h;
    face.fill({ color: 0xffffff }); /* mask needs real geometry */
    spr.mask = face;
    c.addChild(face, spr);
    const edge = new Graphics();
    edge.roundRect(0.5, 0.5, w - 1, h - 1, radius);
    edge.stroke({ color: '#5ea0ff', width: 1, alpha: 0.35 });
    c.addChild(edge);
  } else {
    const edge = variant === 'danger'
      ? { color: T.bad, alpha: 0.5 }
      : { color: '#ffffff', alpha: 0.16 };
    face.fill({ color: T.panel, alpha: variant === 'danger' ? 0.4 : 0.25 })
      .stroke({ ...edge, width: 1.5 });
    c.addChild(face);
  }

  /* hover/press feedback: tinted sheen over the face (instant, <100ms) */
  const sheen = new Sprite(Texture.WHITE);
  sheen.width = w; sheen.height = h;
  sheen.mask = face;
  sheen.alpha = 0;
  sheen.eventMode = 'none';

  const lab = luxeLabel(c, label, 0, 0, Math.max(12, Math.min(15, Math.round(h * 0.28))), variant === 'ghost' ? T.ink : '#ffffff', 0.18);
  lab.x = (w - lab.width) / 2;
  lab.y = (h - lab.height) / 2;
  lab.eventMode = 'none';
  c.addChild(sheen);

  c.on('pointerover', () => { sheen.tint = 0x9cc2ff; sheen.alpha = 0.12; });
  c.on('pointerout', () => { sheen.alpha = 0; });
  c.on('pointerdown', () => { sheen.tint = 0xffffff; sheen.alpha = 0.22; });
  c.on('pointerup', () => { sheen.tint = 0x9cc2ff; sheen.alpha = 0.12; });
  c.on('pointerupoutside', () => { sheen.alpha = 0; });
  c.on('pointerdown', onClick);
  parent.addChild(c);
  return c;
}

/* ---- text input (click-to-focus, physical-keyboard entry, caret) --- */

let keyHookInstalled = false;

interface KeyTarget {
  insert(ch: string): void;
  backspace(): void;
  blur(): void;
}
let keyTarget: KeyTarget | null = null;

function ensureKeyHook(): void {
  if (keyHookInstalled) return;
  keyHookInstalled = true;
  window.addEventListener('keydown', (e) => {
    if (!keyTarget) return;
    if (e.key === 'Backspace') { e.preventDefault(); keyTarget.backspace(); }
    else if (e.key.length === 1 && e.key >= ' ') { e.preventDefault(); keyTarget.insert(e.key); }
    else if (e.key === 'Escape') { keyTarget.blur(); }
  });
}

export interface TextInputHandle {
  readonly value: string;
  focus(): void;
  blur(): void;
  setValue(v: string): void;
}

export function makeTextInput(parent: Container, x: number, y: number, w: number, h: number,
  placeholder: string, maxLength: number): TextInputHandle {
  ensureKeyHook();
  const c = new Container();
  c.x = x; c.y = y;
  c.eventMode = 'static';
  c.cursor = 'text';

  const frame = new Graphics();
  let focused = false;
  let hovered = false;
  const drawFrame = (): void => {
    frame.clear();
    frame.roundRect(0, 0, w, h, h / 2);
    frame.fill({ color: focused ? '#0c1630' : '#0a1224' });
    frame.stroke({
      color: focused ? T.accentA : '#ffffff',
      width: 2,
      alpha: focused ? 0.9 : hovered ? 0.24 : 0.1,
    });
  };
  drawFrame();
  c.addChild(frame);

  const valueT = text(c, '', 0, 0, 16, T.ink);
  const phT = text(c, placeholder, 0, 0, 14, '#5a6b92');
  const caret = new Graphics();
  caret.rect(0, 0, 2, 20).fill({ color: T.accentA });
  caret.visible = false;
  c.addChild(caret);

  let value = '';
  let blinkMs = 0;

  const relayout = (): void => {
    phT.visible = value.length === 0 && !focused;
    valueT.text = value;
    valueT.x = (w - valueT.width) / 2;
    valueT.y = (h - valueT.height) / 2;
    phT.x = (w - phT.width) / 2;
    phT.y = (h - phT.height) / 2;
    caret.x = Math.min(w - 20, valueT.x + valueT.width + 4);
    caret.y = (h - 20) / 2;
  };
  relayout();

  const impl: KeyTarget = {
    insert(ch) {
      if (value.length >= maxLength) return;
      value += ch;
      blinkMs = 0;
      relayout();
    },
    backspace() {
      value = value.slice(0, -1);
      blinkMs = 0;
      relayout();
    },
    blur() {
      focused = false;
      keyTarget = null;
      caret.visible = false;
      drawFrame();
      relayout();
    },
  };

  const onFocus = (): void => {
    if (keyTarget !== null && keyTarget !== impl) keyTarget.blur();
    keyTarget = impl;
    focused = true;
    drawFrame();
    caret.visible = true;
    relayout();
  };

  c.on('pointerover', () => { hovered = true; if (!focused) drawFrame(); });
  c.on('pointerout', () => { hovered = false; if (!focused) drawFrame(); });

  const tick = (tk: Ticker): void => {
    if (!focused) return;
    blinkMs += tk.deltaMS;
    caret.visible = Math.floor(blinkMs / 500) % 2 === 0;
  };
  Ticker.shared.add(tick);
  c.once('destroyed', () => {
    Ticker.shared.remove(tick);
    if (keyTarget === impl) keyTarget = null;
  });

  c.on('pointerdown', onFocus);
  parent.addChild(c);
  return {
    get value(): string { return value; },
    focus: onFocus,
    blur: impl.blur,
    setValue(v) { value = v.slice(0, maxLength); relayout(); },
  };
}

/* ------------------------------------------------------------------ */
/* Shell — adoptable game-scene chrome                                 */
/* ------------------------------------------------------------------ */

export interface ShellOpts {
  roomTitle?: string;
  onLobby?: () => void;
  onLeave?: () => void;
  /**
   * Draw the chrome's own player sidebar. Default OFF: the puzzle scene
   * builds a LIVE sidebar over the identical rect (layouthelper.SIDEBAR),
   * so leaving this on stacked two luxe panels and left a frozen
   * "PLAYERS 0" header showing through beneath the real one.
   */
  sidebar?: boolean;
}

/** Full-frame chrome per DNA: header (LOBBY · room title · LEAVE), status strip
 * with gradient timer, right sidebar with player cards. */
export class Shell {
  readonly root: Container;
  private strip: TimerHandle;
  private sidebar: Container;
  private countLabel: Text;
  private cardCount = 0;
  private nextCardY: number;
  private cardsByName = new Map<string, PlayerCardHandle>();

  private constructor(root: Container, opts: ShellOpts) {
    this.root = root;
    headerBar(root, {
      leftLabel: 'LOBBY',
      onLeft: opts.onLobby,
      title: opts.roomTitle ?? 'PRIVATE ROOM',
      actions: [{ label: 'LEAVE', onClick: opts.onLeave ?? (() => undefined), danger: true }],
    });

    this.strip = statusStrip(root, 40, 70, 920);

    if (opts.sidebar) {
      this.sidebar = panel(root, 984, 70, 576, 734);
      edgeRect(this.sidebar, 0, 0, 576, 734, T.radius);
    } else {
      /* Detached: card handles keep working for callers, nothing paints. */
      this.sidebar = new Container();
    }
    this.countLabel = text(this.sidebar, 'PLAYERS 0', 24, 20, 14, T.muted, true);
    this.nextCardY = 56;
  }

  static attach(root: Container, opts: ShellOpts = {}): Shell {
    return new Shell(root, opts);
  }

  /** timer fill: fraction 0..1 remaining; label defaults to keeping the current text */
  setTimer(fraction: number, label?: string): void {
    this.strip.setTimer(fraction, label);
  }

  setDepth(n: number): void {
    this.strip.setDepth(n);
  }

  addPlayerCard(name: string, tags: string[] = []): PlayerCardHandle {
    const handle = playerCard(this.sidebar, 24, this.nextCardY, 528, name, tags);
    this.nextCardY += 84;
    this.cardCount++;
    this.countLabel.text = this.cardCount === 1 ? 'PLAYER 1 · SOLO' : 'PLAYERS ' + this.cardCount;
    this.cardsByName.set(name, handle);
    return handle;
  }

  card(name: string): PlayerCardHandle | undefined {
    return this.cardsByName.get(name);
  }

  toast(message: string, kind: ToastKind = 'info'): Container {
    return toast(this.root.parent ?? this.root, message, kind);
  }
}

/** Standalone chrome demo: full game frame with live handles exercised. */
export function __preview(): Container {
  const root = new Container();
  panel(root, 0, 0, STAGE_W, 900);
  const shell = Shell.attach(root, { roomTitle: 'PREVIEW ROOM · DEMO', sidebar: true });
  shell.setDepth(2);
  shell.setTimer(0.62, fmtClock(37));
  const me = shell.addPlayerCard('OxAlpha', ['you', 'host']);
  me.setClock(12.226);
  me.setScore(3);
  me.setRank(1);
  const rival = shell.addPlayerCard('shadow awaits');
  rival.setClock(null);
  rival.setScore(1);
  rival.setRank(2);
  shell.toast('CORRECT — columns double the count', 'good');
  return root;
 }
