/* PolishA throwaway visual harness — deleted after batch C verification. */
import { Application, Container, Text } from 'pixi.js';
import { mountRedLight, type StageResult } from './scenes/takeovers/redlight.ts';
import { mountTidePool } from './scenes/takeovers/tidepool.ts';
import { mountSerpent } from './scenes/takeovers/serpent.ts';
import { mountFloorFall } from './scenes/takeovers/floorfall.ts';
import type { TakeoverCtx } from './scenes/takeovers/redlight.ts';

const app = new Application();
await app.init({ width: 1600, height: 900, background: '#111111' });
document.body.appendChild(app.canvas);
document.body.style.margin = '0';

const out = document.createElement('pre');
out.id = 'verify-log';
document.body.appendChild(out);
const log = (s: string): void => { out.textContent += s + '\n'; };

let lastResult: StageResult | null = null;
let introLeftMs = -1;

const MOUNTS: Record<string, (ctx: TakeoverCtx) => void> = {
  redlight: mountRedLight,
  tidepool: mountTidePool,
  serpent: mountSerpent,
  floorfall: mountFloorFall,
};

function mountScene(name: string, seed: number): void {
  app.stage.removeChildren().forEach((c: any) => c.destroy({ children: true }));
  lastResult = null;
  // EXACT replica of the new dealTakeover box geometry
  const box = new Container();
  const fitS = Math.min(1, (900 - 110) / 900);
  box.scale.set(fitS);
  box.x = Math.round((1600 - 1600 * fitS) / 2);
  box.y = 110;
  app.stage.addChild(box);
  MOUNTS[name]({
    depth: 5,
    seed,
    timerLen: 30,
    container: box,
    rng: () => 0.42,
    onDone: (r: StageResult) => { lastResult = r; log(`RESULT ${name}: ${r.correct} ${r.points} ${r.summary}`); },
  });
  log(`MOUNTED ${name}`);
}

function key(k: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
}

(window as any).__verify = {
  mountScene,
  key,
  result: (): StageResult | null => lastResult,
};
log('HARNESS READY');
