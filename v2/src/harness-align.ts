/* ============================================================================
 * harness-align — layout-verification harness (dev-only, not in the app flow).
 * Serves deterministic puzzle/takeover scenes for screenshot QA:
 *   /harness-align.html?s=3row      3x3 count-grid puzzle (Shell chrome on)
 *   /harness-align.html?s=2row      2x2 accretion puzzle
 *   /harness-align.html?s=demo      3x3 with a 2-player live sidebar
 *   /harness-align.html?s=takeover  serpent mounted in the CURRENT deal box
 * ==========================================================================*/
import { Application, Container } from 'pixi.js';
import { T, STAGE_W, STAGE_H } from './theme.ts';
import { buildGameScene } from './scenes/game.ts';
import { Shell, fmtClock } from './scenes/shell.ts';
import { countGrid, accretion } from './puzzles/families.ts';
import { mountSerpent } from './scenes/takeovers/serpent.ts';
import type { StageResult } from './scenes/takeovers/redlight.ts';
import { rngFrom } from './puzzles/types.ts';

const app = new Application();
const DPR = Math.min(2, window.devicePixelRatio || 1);
await app.init({ width: STAGE_W, height: STAGE_H, background: T.bg, antialias: true, resolution: DPR, autoDensity: true });
document.getElementById('app')!.appendChild(app.canvas);
function fit(): void {
  const el = app.canvas as HTMLCanvasElement;
  const s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  el.style.width = Math.round(STAGE_W * s) + 'px';
  el.style.height = Math.round(STAGE_H * s) + 'px';
}
window.addEventListener('resize', fit); fit();

const s = new URLSearchParams(location.search).get('s') ?? '3row';
const demo = s === 'demo';

const root = app.stage;
const shell = Shell.attach(root, { roomTitle: 'PRIVATE ROOM · DEPTH 1', onLeave: () => undefined, onLobby: () => undefined });
shell.setDepth(1);
shell.setTimer(0.62, fmtClock(37));

if (s === 'takeover') {
  /* mirror main.dealTakeover's CURRENT box placement (40,164) so the shot
   * documents the offset Main is asked to fix via takeoverBoxSpec(). */
  const box = new Container();
  root.addChild(box);
  box.x = 40; box.y = 164;
  mountSerpent({
    depth: 5, seed: 0xBEEF, timerLen: 60,
    container: box, rng: rngFrom(0xBEEF),
    onDone: (_res: StageResult) => undefined,
  });
} else {
  const fam = s === '2row' ? accretion : countGrid;
  const p = fam.generate(0xC0FFEE, 1, T.gold);
  const scene = buildGameScene(p, () => undefined, 1, demo
    ? {
        score: () => 4217,
        players: () => [
          { name: 'DAVE', you: true, score: 4217, clock: 12.402, rank: 1 },
          { name: 'SHADOW AWAITS', score: 3801, clock: null, rank: 2 },
        ],
      }
    : {
        score: () => 4217,
        players: () => [{ name: 'DAVE', you: true, score: 4217, clock: 12.402, rank: 1 }],
      });
  root.addChild(scene);
}
