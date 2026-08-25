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
import { MPHost, MPJoin, setActiveSession, wireMain, parseStg, roundPlan, foldScore, evaluateElimination, type MpSession, type MpEvent } from './scenes/mp.ts';
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
  clearCurrent();
  current = s;
  if (s) app.stage.addChild(s);
}
function clearCurrent(): void {
  if (current) { app.stage.removeChild(current); current.destroy({ children: true }); current = null; }
}
function toastNow(root: Container, msg: string, color: string): void {
  const bar = panel(root, 40, 820, 920, 40);
  text(bar, msg.slice(0, 90), 16, 10, 15, color, true);
}

/* ---------- landing / lobby / MP ---------- */
let mp: MpSession | null = null;
let mpRole: 'host' | 'client' | null = null;
let myName = 'PLAYER';
(window as any).__DBG = { begin: 0, rounds: 0, startRuns: 0, mounts: 0, errors: [] as string[] };
const DBG = (window as any).__DBG as any;
function advance(): void { if (!run) return; run.depth++; DBG.rounds++; deal(); }

function toLanding(): void {
  initAudio();
  mp?.leave(); mp = null; mpRole = null;
  show(buildLanding({
    onCreateRoom: (name, roomName) => { myName = name || 'PLAYER'; void toLobbyHost(myName, roomName); },
    onJoin: (code, name) => { myName = name || 'PLAYER'; void toLobbyJoin(code, myName); },
    onHowToPlay: () => toastNow(current ?? new Container(), 'Spot the rule across rows and columns; one tile completes it. Speed pays.', T.accentB),
    onSignIn: () => toastNow(current ?? new Container(), 'NO ACCOUNTS. NO MERCY.', T.muted),
  }));
}

async function toLobbyHost(name: string, roomName: string): Promise<void> {
  let res: Awaited<ReturnType<typeof MPHost.start>>;
  try {
    res = await MPHost.start(code5(), name, roomName, {
    onStart: (seconds) => {
      const sd = ((Date.now() & 0xffff) ^ (Math.floor(Math.random() * 0xffff) + 1)) >>> 0;
      mp?.begin(seconds, true, roomName, sd);
      startRun(myName, roomName, seconds, sd);
    },
      onLeave: () => { mp?.leave(); mp = null; toLanding(); },
    });
  } catch {
    toastNow(current ?? new Container(), 'ROOM HOST FAILED — THE BROKER BLINKED. TRY AGAIN.', T.bad);
    return;
  }
  mp = res.mp; mpRole = 'host'; setActiveSession(mp);
  wireMain({
    onRound: (e: MpEvent) => { if (mpRole === 'client') mountRemoteRound(e); },
    onReveal: () => { if (mpRole === 'client') advance(); },
    onBegin: (e: MpEvent) => {
      if (mpRole === 'client') {
        const ev = e as Extract<MpEvent, { t: 'begin'; timer: number; rn?: string; sd: number }>;
        startRun(myName, ev.rn || 'Room', ev.timer, ev.sd);
      }
    },
  });
  show(res.ui);
}

async function toLobbyJoin(code: string, name: string): Promise<void> {
  let res: Awaited<ReturnType<typeof MPJoin.start>>;
  try {
    res = await MPJoin.start(code, name, {
      onStart: () => undefined, // clients start on the host's begin frame
      onLeave: () => { mp?.leave(); mp = null; toLanding(); },
    });
  } catch {
    toastNow(current ?? new Container(), 'JOIN FAILED — CHECK THE CODE OR RETRY.', T.bad);
    return;
  }
  mp = res.mp; mpRole = 'client'; setActiveSession(mp);
  wireMain({
    onRound: (e: MpEvent) => { mountRemoteRound(e); },
    onReveal: () => { advance(); },
    onBegin: (e: MpEvent) => {
      const ev = e as Extract<MpEvent, { t: 'begin'; timer: number; rn?: string; sd: number }>;
      startRun(myName, ev.rn || 'Room', ev.timer, ev.sd);
    },
  });
  show(res.ui);
}

function mountPlan(rp: { kind: string; index: number }, seed: number): void {
  if (rp.kind === 'takeover') { if (run) run.lastTakeover = run.depth; dealTakeover(app.stage, rp.index, seed); }
  else dealPuzzle(app.stage, rp.index, seed, run?.depth ?? 1);
}

function mountRemoteRound(e: MpEvent): void {
  if (e.t !== 'round') return;
  const stgId = typeof e.stg === 'string' ? e.stg : e.stg.id;
  const rp = parseStg(stgId);
  if (!rp) return;
  const sd = (e as unknown as { seed: number }).seed ?? 0;
  if (!run) startRun(myName, 'Room', e.timerLen, sd);
  const r0 = run!;
  r0.depth = e.n; r0.timerLen = e.timerLen;
  DBG.mounts++;
  try {
    clearCurrent(); /* the MP lobby must not cover the mounted round */
    mountPlan(rp, sd);
  } catch (err) { DBG.errors.push('mount: ' + String(err).slice(0, 120)); }
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

function startRun(name: string, roomName: string, timerLen: number, seed?: number): void {
  seed = (seed ?? ((Date.now() & 0xffff) ^ (Math.floor(Math.random() * 0xffff) + 1))) >>> 0;
  run = { name, roomName, timerLen, seed, plan: planArc(seed), depth: 1, hp: 100, score: 0, streak: 0, prevAlign: null, emeralds: [], lastTakeover: -99 };
  DBG.startRuns++;
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
  const rp = roundPlan(r.seed, r.depth, ALL_FAMILIES.length, TAKEOVERS.length, (d) =>
    plan.align !== 'good' && d >= 4 && d - r.lastTakeover >= 3 && ((r.seed ^ Math.imul(d, 2654435761)) >>> 0) % 100 < 42);
  if (mp && mpRole === 'host') mp.round(r.depth, rp.kind === 'takeover' ? 't' + rp.index : 'p' + rp.index, rp.seed, r.timerLen);
  if (mpRole === 'client') { show(root); return; } /* clients mount on the round frame */
  if (rp.kind === 'takeover') { r.lastTakeover = r.depth; dealTakeover(root, rp.index, rp.seed); }
  else dealPuzzle(root, rp.index, rp.seed, r.depth);
  show(root);
}

function dealTakeover(root: Container, idx: number, planSeed: number): void {
  const r = run!;
  announce(TAKEOVER_NAMES[idx]);
  const box = new Container();
  box.x = 40; box.y = 164;
  root.addChild(box);
  const mount = TAKEOVERS[idx];
  mount({
    depth: r.depth, seed: planSeed, timerLen: r.timerLen,
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

function dealPuzzle(root: Container, famIdx: number, planSeed: number, depth: number): void {
  const r = run!;
  const plan = r.plan[depth - 1];
  const fam = ALL_FAMILIES[famIdx % ALL_FAMILIES.length];
  const hue = T.boardHues[(depth - 1) % T.boardHues.length];
  const diff = Math.min(5, 1 + Math.floor(depth / 6));
  const p = fam.generate((planSeed ^ Math.imul(depth, 7919)) >>> 0, diff, hue);
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
  });
  root.addChild(scene);
}

function fateMidasActive(): boolean {
  // fate.ts owns its state; midas is expressed as a banner in v2 port —
  // treat the most recent hostile round's fate as active for one answer.
  return false; // wired via fate modifiers in a later gauntlet pass
}

toLanding();
