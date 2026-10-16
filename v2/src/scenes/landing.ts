import { Container, Text } from 'pixi.js';
import { T, STAGE_W } from '../theme.ts';
import { panel, text } from './game.ts';
import { edgeRect, headerBar, makeButton, makeTextInput, richLine } from './shell.ts';

/** Faithful original-site landing (per DNA + recon): header (logo · HOW TO PLAY · SIGN IN),
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

/** Invite codes are exactly 5 characters (main.code5). Capping the input at
 *  that length is half the "this is not a room name" signal. */
const CODE_LEN = 5;

/** Centred all-caps caption that owns the row beneath it. */
function sectionLabel(card: Container, y: number, str: string, cardW: number): Text {
  const t = text(card, str, 0, y, 10, T.accentA, true);
  t.style.letterSpacing = 2;
  t.x = (cardW - t.width) / 2;
  return t;
}

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
    { str: 'BATTLE', color: T.accentA },
  ], 32);
  const sub = text(card, 'abstract reasoning · corrupted', 0, 66, 11, T.muted);
  sub.style.letterSpacing = 2;
  sub.x = (cw - sub.width) / 2;

  const inW = cw - 80;

  /* Your display name belongs to YOU, not to either room flow, so it sits
   * above the split where neither section looks like it owns it. */
  const nameIn = makeTextInput(card, 40, 96, inW, 46, 'Display name', 16);

  /* A room's NAME and its invite CODE are different things, and they used to
   * be two near-identical inputs on this one card — "Room name (optional)"
   * and "Room code". People typed a friend's code into the name box and
   * created an empty room of their own. They are two captioned sections now,
   * and the code is an INVITE CODE everywhere so it shares no word with the
   * room's name. */
  sectionLabel(card, 156, 'HOST A ROOM  ·  NAME IT, THEN SHARE THE CODE', cw);
  const roomIn = makeTextInput(card, 40, 176, inW, 46, 'Room name (optional)', 24);

  makeButton(card, 40, 232, inW, 50, 'CREATE ROOM', () => {
    cb.onCreateRoom(nameIn.value.trim() || 'Player', roomIn.value.trim());
  }, 'primary');

  /* join-by-invite-code row (MP) */
  sectionLabel(card, 296, "JOIN A ROOM  ·  YOUR FRIEND'S 5-LETTER CODE", cw);
  const codeIn = makeTextInput(card, 40, 316, 276, 46, 'Invite code', CODE_LEN);
  makeButton(card, 332, 316, 108, 46, 'JOIN', () => {
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
