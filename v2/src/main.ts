import { Application, Container } from 'pixi.js';
import { T, STAGE_W, STAGE_H } from './theme.ts';
import { buildGameScene, panel, text } from './scenes/game.ts';
import { FAMILIES } from './puzzles/families.ts';
import { FAMILIES2 } from './puzzles/families2.ts';
import { buildLanding } from './scenes/landing.ts';
import { buildLobby } from './scenes/lobby.ts';
import { Shell } from './scenes/shell.ts';
import { planArc, type ArcPlan } from './arc-data.ts';
import { applyArc, sanctuaryOn, sanctuaryOff, layerBanner } from './scenes/arc.ts';
import { mountRedLight, type StageResult } from './scenes/takeovers/redlight.ts';
import { mountTidePool } from './scenes/takeovers/tidepool.ts';
import { mountSerpent } from './scenes/takeovers/serpent.ts';

const app = new Application();
await app.init({ width: STAGE_W, height: STAGE_H, background: T.bg, antialias: true });
document.getElementById('app')!.appendChild(app.canvas);
function fit(): void {
  const el = app.canvas as HTMLCanvasElement;
  const s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  el.style.width = Math.round(STAGE_W * s) + 'px';
  el.style.height = Math.round(STAGE_H * s) + 'px';
}
window.addEventListener('resize', fit); fit();

const ALL_FAMILIES = [...FAMILIES, ...FAMILIES2];
const TAKEOVERS = [mountRedLight, mountTidePool, mountSerpent];

function code5(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

type Screen = Container | null;
let current: Screen = null;

function show(s: Screen): void {
  if (current) { app.stage.removeChild(current); current.destroy({ children: true }); }
  current = s;
  if (s) app.stage.addChild(s);
}

/* ---------- landing ---------- */
function toLanding(): void {
  show(buildLanding({
    onCreateRoom: (name, roomName) => toLobby(name || 'PLAYER', roomName),
    onHowToPlay: () => toast('HOW TO PLAY — spot the rule across rows and columns; one tile completes it. Pick fast: speed pays.'),
    onSignIn: () => toast('NO ACCOUNTS. NO MERCY.'),
  }));
}

function toLobby(name: string, roomName: string): void {
  show(buildLobby({
    roomName: roomName || (name + "'s Room"),
    code: code5(),
    players: [name],
    onStart: (seconds) => startRun(name, roomName, seconds),
    onLeave: () => toLanding(),
  }));
}

/* ---------- run state ---------- */
interface Run {
  name: string; roomName: string; timerLen: number;
  seed: number; plan: ArcPlan[];
  depth: number; hp: number; score: number; streak: number;
  prevAlign: string | null;
}
let run: Run | null = null;
let shell: Shell | null = null;
let lastLayer = 0;

function toast(msg: string): void {
  import('./scenes/shell.ts').then(m => { if (current) m.toast(current, msg, 'info'); });
}

function startRun(name: string, roomName: string, timerLen: number): void {
  const seed = (Date.now() & 0xffff) ^ (Math.floor(Math.random() * 0xffff) + 1);
  run = { name, roomName, timerLen, seed, plan: planArc(seed), depth: 1, hp: 100, score: 0, streak: 0, prevAlign: null };
  lastLayer = 0;
  deal();
}

function endRun(): void {
  const r = run!;
  const root = new Container();
  const bg = panel(root, 0, 0, STAGE_W, STAGE_H);
  text(root, 'MATCH TERMINATED', STAGE_W / 2 - 120, 260, 20, T.muted, true);
  text(root, `DEPTH ${r.depth - 1} · SCORE ${r.score}`, STAGE_W / 2 - 150, 320, 42, T.ink, true);
  const again = panel(root, STAGE_W / 2 - 260, 480, 240, 64);
  again.eventMode = 'static'; again.cursor = 'pointer';
  text(again, 'DESCEND AGAIN', 40, 20, 17, T.good, true);
  again.on('pointerdown', () => startRun(r.name, r.roomName, r.timerLen));
  const home = panel(root, STAGE_W / 2 + 20, 480, 240, 64);
  home.eventMode = 'static'; home.cursor = 'pointer';
  text(home, 'BACK TO LANDING', 44, 20, 17, T.muted, true);
  home.on('pointerdown', () => { run = null; toLanding(); });
  show(root);
}

/* ---------- depth dealing ---------- */
function deal(): void {
  const r = run!;
  if (r.hp <= 0) { endRun(); return; }
  if (r.depth > r.plan.length) { endRun(); return; }
  const plan = r.plan[r.depth - 1];
  const root = new Container();

  shell = Shell.attach(root,{
    onLobby: () => { run = null; toLanding(); },
    roomTitle: (r.roomName || 'PRIVATE ROOM') + ' · DEPTH ' + r.depth,
    onLeave: () => { run = null; toLanding(); },
  });

  // corruption arc tokens + sanctuary flip
  applyArc(root, plan);
  if (plan.sanctuary) sanctuaryOn(root); else sanctuaryOff(root);

  // layer banner on deepening
  if (plan.align !== 'good' && plan.layer > lastLayer && plan.layer >= 2) {
    const spec = layerBanner(root, plan.layer);
    text(root, spec.text, spec.x - 160, 120, 26, T.bad, true);
  }
  lastLayer = plan.layer;

  // pain beat on alignment flips
  if (r.prevAlign && plan.align !== r.prevAlign && plan.align !== 'good') {
    text(root, 'PAIN — THE PLAN SHIFTS', STAGE_W / 2 - 160, 140, 18, T.bad, true);
  }
  r.prevAlign = plan.align;

  const takeoverDue = plan.align !== 'good' && r.depth >= 4 && ((r.seed ^ (r.depth * 2654435761)) >>> 0) % 100 < 42;
  if (takeoverDue) {
    dealTakeover(root, plan);
  } else {
    dealPuzzle(root, plan);
  }
  show(root);
}

function dealTakeover(root: Container, plan: ArcPlan): void {
  const r = run!;
  const kind = ((r.seed ^ (r.depth * 97)) >>> 0) % 3;
  const mount = TAKEOVERS[kind];
  const box = new Container();
  box.x = 40; box.y = 164;
  root.addChild(box);
  const t0 = performance.now();
  mount({
    depth: r.depth, seed: (r.seed ^ (r.depth * 0x9E37)) >>> 0, timerLen: r.timerLen,
    container: box, rng: mulberry((r.seed ^ (r.depth * 0x9E37)) >>> 0),
    onDone: (res: StageResult) => {
      r.score = Math.max(0, r.score + res.points);
      r.hp = Math.max(0, Math.min(100, r.hp + res.hpDelta));
      toastNow(root, res.summary, res.correct === true ? T.good : res.correct === false ? T.bad : T.gold);
      setTimeout(() => { r.depth++; deal(); }, 1500);
      void t0;
    },
  });
}

function dealPuzzle(root: Container, plan: ArcPlan): void {
  const r = run!;
  const fam = ALL_FAMILIES[(r.depth - 1) % ALL_FAMILIES.length];
  const hue = T.boardHues[(r.depth - 1) % T.boardHues.length];
  const diff = Math.min(5, 1 + Math.floor(r.depth / 6));
  const p = fam.generate((r.seed ^ Math.imul(r.depth, 7919)) >>> 0, diff, hue);
  if (plan.sanctuary) sanctuaryOn(root);

  const scene = buildGameScene(p, (idx, correct) => {
    const diffV = diff;
    if (correct) {
      r.streak++;
      r.score += 100 * diffV + 40 + (r.streak - 1) * 20;
      if (plan.sanctuary) r.hp = Math.min(100, r.hp + 20);
      toastNow(root, 'CORRECT — ' + p.rule, T.good);
    } else {
      r.streak = 0;
      r.score = Math.max(0, r.score - 40);
      r.hp = Math.max(0, r.hp - 12);
      toastNow(root, 'WRONG — answer ' + (p.answer + 1) + ' · ' + p.rule, T.bad);
    }
    setTimeout(() => { r.depth++; deal(); }, 1400);
  }, r.depth);
  root.addChild(scene);
}

function toastNow(root: Container, msg: string, color: string): void {
  const bar = panel(root, 40, 820, 920, 40);
  text(bar, msg.slice(0, 90), 16, 10, 15, color, true);
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

toLanding();
