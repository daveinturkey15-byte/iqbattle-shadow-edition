import { Container } from 'pixi.js';
import { T, STAGE_W } from '../theme.ts';
import { panel, text } from './game.ts';
import {
  edgeRect, fmtClock, headerBar, makeButton, playerCard, statusStrip,
  type PlayerCardHandle,
} from './shell.ts';

/**
 * The invite code, given its own object on the screen: caption, the code in
 * accent at display size with the letters spaced so they can be read out
 * loud, and click-to-copy. Sits in the free band between the header bar and
 * the roster panel, so it disturbs no existing row.
 */
function inviteCodeChip(root: Container, code: string): void {
  const cw = 460, ch = 62;
  const cx = (STAGE_W - cw) / 2, cy = 72;

  const chip = panel(root, cx, cy, cw, ch);
  edgeRect(root, cx, cy, cw, ch, 12);
  chip.eventMode = 'static';
  chip.cursor = 'pointer';

  const cap = text(root, 'INVITE CODE', cx + 22, cy + 24, 10, T.muted, true);
  cap.style.letterSpacing = 2;

  const val = text(root, code, cx + 140, cy + 17, 26, T.accentA, true);
  val.style.letterSpacing = 8;

  const hint = text(root, 'CLICK TO COPY', cx + cw - 116, cy + 25, 10, T.muted, true);
  hint.style.letterSpacing = 2;

  /* Legacy path for anything without an async Clipboard API (insecure
   * context, in-app webviews, older mobile browsers). Returns whether the
   * copy actually happened — the caller must not claim success blindly. */
  const execCopy = (t: string): boolean => {
    try {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, t.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  };

  chip.on('pointerdown', () => {
    const nav = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator;
    const write = nav?.clipboard?.writeText;
    /* Clipboard is best-effort: it needs a secure context and a user
     * gesture, and this is a game, not a form. Two rules the old version
     * broke: never report a copy that did not happen (a missing
     * clipboard API made `Promise.resolve(undefined)` resolve, so the
     * chip said COPIED while the buffer was empty and the joiner got
     * nothing), and always try the legacy path before giving up. */
    if (!write) {
      hint.text = execCopy(code) ? 'COPIED' : 'COPY FAILED';
      return;
    }
    void write.call(nav.clipboard, code)
      .then(() => { hint.text = 'COPIED'; })
      .catch(() => { hint.text = execCopy(code) ? 'COPIED' : 'COPY FAILED'; });
  });
}

/** DNA lobby: the room NAME in the header, the INVITE CODE on its own
 * click-to-copy chip beneath it, player cards, Round Timer input (1-120,
 * default 60), START + LEAVE. */

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

  /* The header carries the room's NAME only. It used to read
   * '<name> · <CODE>' as one run-on string, which is how a room called
   * "Friday Night" and a code like K7QXA ended up looking like one label
   * nobody could split. The code now has its own captioned chip below, and
   * is called an INVITE CODE so it shares no word with the room's name. */
  headerBar(root, { logo: true, title: opts.roomName });
  inviteCodeChip(root, opts.code);

  // central panel
  const pw = 720, ph = 620;
  const px = (STAGE_W - pw) / 2, py = 140;
  panel(root, px, py, pw, ph);
  edgeRect(root, px, py, pw, ph, T.radius);

  const countLabel = text(root, opts.players.length === 1 ? 'PLAYER 1 · SOLO' : 'PLAYERS ' + opts.players.length,
    px + 32, py + 28, 14, T.muted, true);
  countLabel.style.letterSpacing = 2;

  let cardY = py + 64;
  opts.players.forEach((name, i) => {
    const tags = i === 0 ? ['you', 'host'] : [];
    const h = playerCard(root, px + 32, cardY, pw - 64, name, tags);
    h.setClock(null); /* lobby: everyone is waiting */
    h.setRank(i + 1); /* seat-order diamond badge: gold host, silver, bronze */
    cardY += 84;
  });

  // Round Timer row: label + [-] value [+]
  const timerY = cardY + 24;
  const timerLabel = text(root, 'ROUND TIMER (S)', px + 32, timerY + 14, 13, T.muted, true);
  timerLabel.style.letterSpacing = 2;

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
    code: 'K7QXA',
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
