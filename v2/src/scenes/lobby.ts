import { Container } from 'pixi.js';
import { T, STAGE_W } from '../theme.ts';
import { panel, text } from './game.ts';
import {
  edgeRect, fmtClock, headerBar, makeButton, playerCard, statusStrip,
  type PlayerCardHandle,
} from './shell.ts';

/** DNA lobby: room title '<name> · <CODE>' in the header, player cards,
 * Round Timer input (1-120, default 60), START + LEAVE. */

export interface LobbyCallbacks {
  /** START pressed; seconds = current Round Timer value (1..120) */
  onStart(seconds: number): void;
  onLeave(): void;
}

export interface LobbyOpts extends LobbyCallbacks {
  roomName: string;
  code: string;
  /** seat order; players[0] is host (tagged "you · host") */
  players: string[];
}

const TIMER_MIN = 1;
const TIMER_MAX = 120;
const TIMER_DEFAULT = 60;

export function buildLobby(opts: LobbyOpts): Container {
  const root = new Container();

  panel(root, 0, 0, STAGE_W, 900);

  headerBar(root, { logo: true, title: opts.roomName + ' · ' + opts.code });

  // central panel
  const pw = 720, ph = 620;
  const px = (STAGE_W - pw) / 2, py = 140;
  panel(root, px, py, pw, ph);
  edgeRect(root, px, py, pw, ph, T.radius);

  text(root, 'PLAYERS ' + opts.players.length, px + 32, py + 28, 14, T.muted, true);

  let cardY = py + 64;
  opts.players.forEach((name, i) => {
    const tags = i === 0 ? ['you', 'host'] : [];
    playerCard(root, px + 32, cardY, pw - 64, name, tags);
    cardY += 84;
  });

  // Round Timer row: label + [-] value [+]
  const timerY = cardY + 24;
  text(root, 'ROUND TIMER (S)', px + 32, timerY + 14, 13, T.muted, true);

  let seconds = TIMER_DEFAULT;
  const valueLabel = text(root, String(seconds), 0, timerY + 8, 18, T.ink, true);
  const setSeconds = (v: number): void => {
    seconds = Math.max(TIMER_MIN, Math.min(TIMER_MAX, v));
    valueLabel.text = String(seconds);
    valueLabel.x = stepperCx - valueLabel.width / 2;
  };

  const stepperW = 46, stepperH = 44;
  const stepperGap = 14;
  const groupW = stepperW * 2 + 90 + stepperGap * 2;
  const stepperCx = px + pw / 2;
  const gx = stepperCx - groupW / 2;
  makeButton(root, gx, timerY, stepperW, stepperH, '−', () => setSeconds(seconds - 5), 'ghost');
  makeButton(root, gx + stepperW + 90 + stepperGap * 2, timerY, stepperW, stepperH, '+', () => setSeconds(seconds + 5), 'ghost');
  edgeRect(root, gx + stepperW + stepperGap, timerY, 90, stepperH, 22);
  valueLabel.x = stepperCx - valueLabel.width / 2;

  // START + LEAVE
  const btnY = py + ph - 96;
  makeButton(root, px + 32, btnY, 200, 56, 'LEAVE', () => { opts.onLeave(); }, 'danger');
  makeButton(root, px + pw - 32 - 320, btnY, 320, 56, 'START', () => { opts.onStart(seconds); }, 'primary');

  return root;
}

export function __preview(): Container {
  const scene = buildLobby({
    roomName: 'Friday Night',
    code: 'K7QX',
    players: ['OxAlpha', 'Dave', 'shadow awaits'],
    onStart: (seconds) => console.log('[preview] start:', seconds),
    onLeave: () => console.log('[preview] leave'),
  });
  // exercise the shared chrome handles so previews show live state
  const strip = statusStrip(scene, 40, 70, 920);
  strip.setTimer(0.5, fmtClock(30));
  strip.setDepth(1);
  const me: PlayerCardHandle = playerCard(scene, 40, 126, 360, 'OxAlpha', ['you', 'host']);
  me.setClock(12.226);
  me.setScore(3);
  me.setRank(1);
  return scene;
}
