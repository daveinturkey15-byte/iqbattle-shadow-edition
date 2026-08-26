import { Container, Text } from 'pixi.js';
import { T, STAGE_W } from '../theme.ts';
import { panel, text } from './game.ts';
import { edgeRect, headerBar, makeButton, makeTextInput, richLine } from './shell.ts';

/** Faithful iqversus landing (per DNA + recon): header (logo · HOW TO PLAY · SIGN IN),
 * hero H1 with accent "IQ-style", three feature cards, Create-A-Room card.
 * No navigation logic inside — everything routes through the callbacks. */

export interface LandingCallbacks {
  /** CREATE ROOM pressed; name = trimmed display name ('Player' fallback), roomName = trimmed room input ('' if left blank) */
  onCreateRoom(name: string, roomName: string): void;
  /** JOIN pressed with a room code (uppercased, 3-12 chars) */
  onJoin(code: string, name: string): void;
  onHowToPlay(): void;
  onSignIn(): void;
}

const FEATURES = [
  { title: 'RANDOM PUZZLE GENERATION', blurb: 'Every board is procedurally generated — you will never see the same puzzle twice.' },
  { title: 'NO REGISTRATION REQUIRED', blurb: 'Pick a display name and play. No accounts, no emails, nothing to remember.' },
  { title: 'INVITE FRIENDS EASILY', blurb: 'Host a room and share the code. Friends join in seconds — or face the demons alone.' },
] as const;

export function buildLanding(cb: LandingCallbacks): Container {
  const root = new Container();

  // background
  panel(root, 0, 0, STAGE_W, 900);

  // header: logo left · HOW TO PLAY + SIGN IN right
  headerBar(root, {
    logo: true,
    actions: [
      { label: 'SIGN IN', onClick: cb.onSignIn, quiet: true },
      { label: 'HOW TO PLAY', onClick: cb.onHowToPlay },
    ],
  });

  // hero H1 — two centered lines, "IQ-style" in accent blue
  richLine(root, STAGE_W / 2, 150, [
    { str: 'Challenge your friends with ', color: T.ink },
    { str: 'IQ-style', color: T.accentB },
    { str: ' logic and', color: T.ink },
  ], 34);
  richLine(root, STAGE_W / 2, 196, [
    { str: 'abstract reasoning puzzles.', color: T.ink },
  ], 34);

  // three feature cards
  const featW = 320, featH = 168, gap = 24;
  const rowW = 3 * featW + 2 * gap;
  FEATURES.forEach((f, i) => {
    const x = (STAGE_W - rowW) / 2 + i * (featW + gap);
    const y = 268;
    const card = panel(root, x, y, featW, featH);
    edgeRect(card, 0, 0, featW, featH, 12);
    const title = text(card, f.title, 0, 24, 11, T.accentA, true);
    title.style.letterSpacing = 2;
    title.x = (featW - title.width) / 2;
    const blurb = new Text({
      text: f.blurb,
      style: {
        fontFamily: T.font, fontSize: 12, fill: T.muted, fontWeight: '500',
        wordWrap: true, breakWords: true, wordWrapWidth: featW - 48,
        lineHeight: 18, align: 'center',
      },
    });
    blurb.x = 24;
    blurb.y = 54;
    card.addChild(blurb);
  });

  // Create-A-Room card
  const cw = 480, ch = 380;
  const cx = (STAGE_W - cw) / 2;
  const cy = 486;
  const card = panel(root, cx, cy, cw, ch);
  edgeRect(card, 0, 0, cw, ch, T.radius);

  richLine(card, cw / 2, 28, [
    { str: 'IQ ', color: T.accentB },
    { str: 'VERSUS', color: T.accentA },
  ], 32);
  const sub = text(card, 'abstract reasoning · corrupted', 0, 72, 10, T.muted);
  sub.style.letterSpacing = 2;
  sub.x = (cw - sub.width) / 2;

  const inW = cw - 80;
  const nameIn = makeTextInput(card, 40, 110, inW, 50, 'Display name', 16);
  const roomIn = makeTextInput(card, 40, 176, inW, 50, 'Room name (optional)', 24);

  makeButton(card, 40, 246, inW, 54, 'CREATE ROOM', () => {
    cb.onCreateRoom(nameIn.value.trim() || 'Player', roomIn.value.trim());
  }, 'primary');

  /* join-by-code row (MP) */
  const codeIn = makeTextInput(card, 40, 318, 276, 46, 'Room code', 24);
  makeButton(card, 332, 318, 108, 46, 'JOIN', () => {
    const code = codeIn.value.trim().toUpperCase();
    if (code.length >= 3) cb.onJoin(code, nameIn.value.trim() || 'Player');
  }, 'ghost');

  return root;
}

export function __preview(): Container {
  return buildLanding({
    onJoin: () => undefined,
    onCreateRoom: (name, room) => console.log('[preview] createRoom:', JSON.stringify({ name, room })),
    onHowToPlay: () => console.log('[preview] howToPlay'),
    onSignIn: () => console.log('[preview] signIn'),
  });
}
