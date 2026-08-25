import { Application, Container } from 'pixi.js';
import { T, STAGE_W, STAGE_H } from './theme.ts';
import { buildGameScene, panel, text } from './scenes/game.ts';
import { FAMILIES } from './puzzles/families.ts';
import { FAMILIES2 } from './puzzles/families2.ts';
import { FAMILIES3 } from './puzzles/families3.ts';
import { buildLanding } from './scenes/landing.ts';
import { buildLobby } from './scenes/lobby.ts';
import { Shell } from './scenes/shell.ts';
import { planArc, type ArcPlan } from './arc-data.ts';
import { applyArc, sanctuaryOn, sanctuaryOff, layerBanner } from './scenes/arc.ts';
import { initAudio, sfx } from './audio/audio.ts';
import { setAlignment, setLayer, sting } from './audio/beds.ts';
import { setLayer as setDreadLayer } from './audio/beds.ts';
import { initShadow, say, announce, noteRound } from './shadow/shadow.ts';
import { maybeFate } from './fate/fate.ts';
import { emeraldPick, buildInterlude } from './scenes/interlude.ts';
import { mountRedLight, type StageResult } from './scenes/takeovers/redlight.ts';
import { mountTidePool } from './scenes/takeovers/tidepool.ts';
import { mountSerpent } from './scenes/takeovers/serpent.ts';
import { mountFloorFall } from './scenes/takeovers/floorfall.ts';
import { mountHunterDodge } from './scenes/takeovers/hunterdodge.ts';
import { mountLaserStorm } from './scenes/takeovers/laserstorm.ts';
import { mountDroneDodge } from './scenes/takeovers/dronedodge.ts';
import { mountSaberClash } from './scenes/takeovers/saberclash.ts';
import { mountSlots } from './scenes/takeovers/slots.ts';
import { mountSlimeGallery } from './scenes/takeovers/slimegallery.ts';
import { mountWell } from './scenes/takeovers/well.ts';

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

const ALL_FAMILIES = [...FAMILIES, ...FAMILIES2, ...FAMILIES3];
const TAKEOVERS = [mountRedLight, mountTidePool, mountSerpent, mountFloorFall, mountHunterDodge, mountLaserStorm, mountDroneDodge, mountSaberClash, mountSlots, mountSlimeGallery, mountWell];

function code5(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
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

type Screen = Container | null;
let current: Screen = null;
function show(s: Screen): void {
  if (current) { app.stage.removeChild(current); current.destroy({ children: true }); }
  current = s;
  if (s) app.stage.addChild(s);
}
function toastNow(root: Container, msg: string, color: string): void {
  const bar = panel(root, 40, 820, 920, 40);
  text(bar, msg.slice(0, 90), 16, 10, 15, color, true);
}

/* ---------- landing / lobby ---------- */
function toLanding(): void {
  initAudio();
  show(buildLanding({
    onCreateRoom: (name, roomName) => toLobby(name || 'PLAYER', roomName),
    onHowToPlay: () => toastNow(current ?? new Container(), 'Spot the rule across rows and columns; one tile completes it. Speed pays.', T.accentB),
    onSignIn: () => toastNow(current ?? new Container(), 'NO ACCOUNTS. NO MERCY.', T.muted),
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
  prevAlign: string | null; emeralds: string[]; lastTakeover: number;
}
let run: Run | null = null;
let lastLayer = 0;

function startRun(name: string, roomName: string, timerLen: number): void {
  const seed = ((Date.now() & 0xffff) ^ (Math.floor(Math.random() * 0xffff) + 1)) >>> 0;
  run = { name, roomName, timerLen, seed, plan: planArc(seed), depth: 1, hp: 100, score: 0, streak: 0, prevAlign: null, emeralds: [], lastTakeover: -99 };
  lastLayer = 0;
  initShadow(app.stage);
  deal();
}

function endRun(): void {
  const r = run!;
  sfx(r.hp > 0 ? 'laugh' : 'scream');
  const root = new Container();
  panel(root, 0, 0, STAGE_W, STAGE_H);
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
  if (r.hp <= 0 || r.depth > r.plan.length) { endRun(); return; }
  const plan = r.plan[r.depth - 1];
  const root = new Container();

  Shell.attach(root, {
    onLobby: () => { run = null; toLanding(); },
    roomTitle: (r.roomName || 'PRIVATE ROOM') + ' · DEPTH ' + r.depth,
    onLeave: () => { run = null; toLanding(); },
  });

  applyArc(root, plan);
  if (plan.sanctuary) sanctuaryOn(root); else sanctuaryOff(root);

  if (plan.align !== 'good' && plan.layer > lastLayer && plan.layer >= 2) {
    const spec = layerBanner(root, plan.layer);
    text(root, spec.text, spec.x - 160, 120, 26, T.bad, true);
    say('whisper', {});
  }
  setDreadLayer(plan.align === 'good' ? 0 : plan.layer);
  if (plan.align !== r.prevAlign && r.prevAlign !== null) sting(plan.align === 'good' ? 'heal' : 'pain');
  setAlignment(plan.align === 'chaotic' ? 'chaotic' : plan.align);
  noteRound(plan.align, plan.layer, plan.sanctuary ? 1 : 0);
  r.prevAlign = plan.align;

  // emerald interlude every 4th depth
  if (r.depth % 4 === 0 && r.depth > 1) {
    const offers = emeraldPick((r.seed ^ Math.imul(r.depth, 7919)) >>> 0, r.emeralds);
    if (offers.length) {
      const pickRoot = buildInterlude(offers, (id) => {
        r.emeralds.push(id);
        toastNow(root, 'THE ' + id.toUpperCase().replace('_', ' ') + ' IS YOURS', T.gold);
        sfx('levelup');
        setTimeout(() => { r.depth++; deal(); }, 900);
      });
      root.addChild(pickRoot);
      show(root);
      return;
    }
  }

  // fate roll (hostile/neutral flavor events)
  const fate = maybeFate({ depth: r.depth, align: plan.align, rng: mulberry((r.seed ^ Math.imul(r.depth, 0xFA7E)) >>> 0), hp: r.hp, seed: r.seed });
  if (fate) {
    if (fate.bannerText) toastNow(root, fate.bannerText, T.gold);
    if (typeof fate.timerDelta === 'number' && fate.timerDelta < 0) r.hp -= 0; // timer handled per-scene
  }

  const takeoverDue = plan.align !== 'good' && r.depth >= 4 && r.depth - r.lastTakeover >= 3 && ((r.seed ^ Math.imul(r.depth, 2654435761)) >>> 0) % 100 < 42;
  if (takeoverDue) { r.lastTakeover = r.depth; dealTakeover(root, plan); }
  else dealPuzzle(root, plan);
  show(root);
}

function dealTakeover(root: Container, plan: ArcPlan): void {
  const r = run!;
  const idx = ((r.seed ^ Math.imul(r.depth, 97)) >>> 0) % TAKEOVERS.length;
  announce(TAKEOVER_NAMES[idx]);
  const box = new Container();
  box.x = 40; box.y = 164;
  root.addChild(box);
  const mount = TAKEOVERS[idx];
  mount({
    depth: r.depth, seed: (r.seed ^ Math.imul(r.depth, 0x9E37)) >>> 0, timerLen: r.timerLen,
    container: box, rng: mulberry((r.seed ^ Math.imul(r.depth, 0x9E37)) >>> 0),
    onDone: (res: StageResult) => {
      r.score = Math.max(0, r.score + res.points);
      r.hp = Math.max(0, Math.min(100, r.hp + res.hpDelta));
      if (res.correct === true) { r.streak++; say('right', {}); } else if (res.correct === false) { r.streak = 0; say('wrong', {}); }
      toastNow(root, res.summary, res.correct === true ? T.good : res.correct === false ? T.bad : T.gold);
      setTimeout(() => { r.depth++; deal(); }, 1500);
    },
  });
}
const TAKEOVER_NAMES = ['RED LIGHT', 'TIDE POOL', 'SERPENT', 'FLOOR-FALL', 'HUNTER-DODGE', 'LASER-STORM', 'DRONE SWARM', 'SABER CLASH', 'ONE-ARMED GOD', 'SLIME GALLERY', 'THE WELL'];

function dealPuzzle(root: Container, plan: ArcPlan): void {
  const r = run!;
  const fam = ALL_FAMILIES[(r.depth - 1) % ALL_FAMILIES.length];
  const hue = T.boardHues[(r.depth - 1) % T.boardHues.length];
  const diff = Math.min(5, 1 + Math.floor(r.depth / 6));
  const p = fam.generate((r.seed ^ Math.imul(r.depth, 7919)) >>> 0, diff, hue);
  if (plan.sanctuary) sanctuaryOn(root);

  const scene = buildGameScene(p, (idx, correct) => {
    const diffV = diff;
    const midas = fateMidasActive();
    if (correct) {
      r.streak++;
      let pts = 100 * diffV + 40 + (r.streak - 1) * 20;
      if (midas) pts = Math.round(pts * 1.5);
      r.score += pts;
      if (plan.sanctuary) r.hp = Math.min(100, r.hp + 20);
      sfx('chime');
      say('right', {});
      toastNow(root, (midas ? 'MIDAS · ' : '') + '+' + pts + ' — ' + p.rule, T.good);
    } else {
      r.streak = 0;
      r.score = Math.max(0, r.score - 40);
      r.hp = Math.max(0, r.hp - 12);
      sting('pain');
      say('wrong', {});
      toastNow(root, 'WRONG — answer ' + (p.answer + 1) + ' · ' + p.rule, T.bad);
    }
    setTimeout(() => { r.depth++; deal(); }, 1400);
  }, r.depth);
  root.addChild(scene);
}

function fateMidasActive(): boolean {
  // fate.ts owns its state; midas is expressed as a banner in v2 port —
  // treat the most recent hostile round's fate as active for one answer.
  return false; // wired via fate modifiers in a later gauntlet pass
}

toLanding();
