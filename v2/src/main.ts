import { Application, Container, Graphics, Sprite, Text } from 'pixi.js';
import { T, STAGE_W, STAGE_H } from './theme.ts';
import { buildGameScene, panel, text } from './scenes/game.ts';
import { FAMILIES } from './puzzles/families.ts';
import { FAMILIES2 } from './puzzles/families2.ts';
import { FAMILIES3 } from './puzzles/families3.ts';
import { buildLanding } from './scenes/landing.ts';
import { buildLobby } from './scenes/lobby.ts';
import { Shell, fmtClock } from './scenes/shell.ts';
import { planArc, type ArcPlan } from './arc-data.ts';
import { applyArc, sanctuaryOn, sanctuaryOff, layerBanner } from './scenes/arc.ts';
import { initAudio, sfx } from './audio/audio.ts';
import { setAlignment, sting } from './audio/beds.ts';
import { setLayer as setDreadLayer } from './audio/beds.ts';
import { initShadow, say, announce, noteRound, __detach as detachShadow } from './shadow/shadow.ts';
import { initLarge, announceLarge, setPresence, __detachLarge as detachLarge } from './shadow/large.ts';
import { initDirector, onAct, onReveal as dirOnReveal, onEmerald, onHpThreshold } from './audio/director.ts';
import { maybeFlavorA } from './fate/flavor-a.ts';
import { maybeFlavorB } from './fate/flavor-b.ts';
import { maybeFate } from './fate/fate.ts';
import { emeraldPick, buildInterlude } from './scenes/interlude.ts';
import { applyBackdrop } from './worlds/backdrops.ts';
import { pick as pickWorld } from './worlds/registry.ts';
import { maybeCurse } from './fate/cursepack.ts';
import { maybePack } from './fate/packs/registry.ts';
import { playReveal, revealMotionEnabled } from './fx/reveal.ts';
import { pickModifiers, type ModCtx } from './rounds/modifiers.ts';
import { createChaos, type ChaosBus } from './fx/chaos.ts';
import { pickCameos, ROSTER } from './fx/cameos.ts';
import { BOARD_PANEL, GRID_GAP, puzzleLayout } from './scenes/layouthelper.ts';
import { goalCardForIndex, maybeShowLegend, resetLegendRun } from './meta/onboard.ts';
import { MPHost, MPJoin, setActiveSession, wireMain, parseStg, roundPlan, runSeedFromRound, hueIndexForDepth, type MpSession, type MpEvent, type RoundPlan } from './scenes/mp.ts';
import { hpFor, pointsFor } from './scenes/lms.ts';
import { createDirector, type LmsDirector } from './scenes/lmsdirector.ts';
import { buildAttackMenu } from './scenes/attackmenu.ts';
import { mountRedLight, type StageResult } from './scenes/takeovers/redlight.ts';
import { mountTidePool } from './scenes/takeovers/tidepool.ts';
import { mountSerpent } from './scenes/takeovers/serpent.ts';
import { mountFloorFall } from './scenes/takeovers/floorfall.ts';
import { mountHunterDodge } from './scenes/takeovers/hunterdodge.ts';
import { mountLaserStorm } from './scenes/takeovers/laserstorm.ts';
import { mountDroneDodge } from './scenes/takeovers/dronedodge.ts';
import { mountSaberClash } from './scenes/takeovers/saberclash.ts';
import { mountPacman2 } from './scenes/takeovers/pacman2.ts';
import { mountTetris2 } from './scenes/takeovers/tetris2.ts';
import { mountBattleship2 } from './scenes/takeovers/battleship2.ts';
import { mountDoom2 } from './scenes/takeovers/doom2.ts';
import { mountPhoenix2 } from './scenes/takeovers/phoenix2.ts';
import { mountGauntlet2 } from './scenes/takeovers/gauntlet2.ts';
import { mountFractal2 } from './scenes/takeovers/fractal2.ts';
import { mountHypercube2 } from './scenes/takeovers/hypercube2.ts';
import { mountSniper2 } from './scenes/takeovers/sniper2.ts';
import { mountPopGlitter } from './scenes/takeovers/popglitter2.ts';
import { mountMetal } from './scenes/takeovers/metal2.ts';
import { mountTerminator2 } from './scenes/takeovers/terminator2.ts';
import { mountFury2 } from './scenes/takeovers/fury2.ts';
import { mountSkyFire2 } from './scenes/takeovers/skyfire2.ts';
import { mountSlots } from './scenes/takeovers/slots.ts';
import { mountSlimeGallery } from './scenes/takeovers/slimegallery.ts';
import { mountWell } from './scenes/takeovers/well.ts';
import { whenFontsReady } from './style/panelkit.ts';
import { installQaHooks, isDevBuild } from './qa.ts';

/* ---------- render/scaling: viewport-exact canvas, letterboxed world ---------- */
/* The Application and the two world containers are constructed at module
 * scope, but EVERYTHING that must await (renderer init, webfont race) runs
 * inside boot() at the end of this file. The built bundle shipped with
 * top-level awaits and hung forever on them (empty #app, no canvas, no error
 * thrown), so boot() is the only place main.ts is allowed to await. */
const app = new Application();
/** Screen-space layer carrying world backdrop art on >16:9 aspect (full-bleed sides). */
const bleedHolder = new Container();
/** Logical 1600x900 world; every scene mounts here and fit() scales + centers it. */
const view = new Container();

interface LayoutState { s: number; uw: boolean; lw: number; }
let layout: LayoutState = { s: 1, uw: false, lw: STAGE_W };

function fit(): void {
  const vw = Math.max(1, Math.round(window.innerWidth));
  const vh = Math.max(1, Math.round(window.innerHeight));
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  /* Backing store == viewport * DPR exactly: integer device pixels, zero rescale blur. */
  app.renderer.resize(vw, vh, dpr);
  const el = app.canvas as HTMLCanvasElement;
  el.style.width = vw + 'px';
  el.style.height = vh + 'px';
  /* Gameplay centered at max height (max width when the viewport is narrower than 16:9). */
  const s = Math.min(vw / STAGE_W, vh / STAGE_H);
  view.scale.set(s);
  view.position.set(Math.round((vw - STAGE_W * s) / 2), Math.round((vh - STAGE_H * s) / 2));
  const uw = vw / vh > STAGE_W / STAGE_H;
  bleedHolder.visible = uw;
  if (uw) {
    /* Ultrawide: backdrop art extends full-bleed; s is height-bound so art fills exactly. */
    bleedHolder.scale.set(s);
    bleedHolder.position.set(0, 0);
    layout = { s, uw, lw: Math.ceil(vw / s) };
  } else {
    layout = { s, uw, lw: STAGE_W };
  }
}

const ALL_FAMILIES = [...FAMILIES, ...FAMILIES2, ...FAMILIES3];
const TAKEOVERS = [mountRedLight, mountTidePool, mountSerpent, mountFloorFall, mountHunterDodge, mountLaserStorm, mountDroneDodge, mountSaberClash, mountSlots, mountSlimeGallery, mountWell, mountPacman2, mountTetris2, mountBattleship2, mountDoom2, mountPhoenix2, mountGauntlet2, mountFractal2, mountHypercube2, mountSniper2, mountPopGlitter, mountMetal, mountTerminator2, mountFury2, mountSkyFire2];

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
/** Cleanups owned by the LIVE scene (backdrop rAF loops, timers). */
let sceneStops: (() => void)[] = [];
/** Cleanups registered while the NEXT scene is being built, promoted on show(). */
let pendingStops: (() => void)[] = [];
/** Register a cleanup for the scene currently being built (safe before show()). */
function onSceneStop(stop: () => void): void { pendingStops.push(stop); }
function show(s: Screen): void {
  clearCurrent();
  current = s;
  if (s) view.addChild(s);
  /* Promote only AFTER clearCurrent so a freshly-registered stop survives. */
  sceneStops = pendingStops;
  pendingStops = [];
}
function clearCurrent(): void {
  for (const stop of sceneStops) { try { stop(); } catch { /* optional */ } }
  sceneStops = [];
  if (current) { view.removeChild(current); current.destroy({ children: true }); current = null; }
}
function toastNow(root: Container, msg: string, color: string): void {
  const bar = panel(root, 40, 820, 920, 40);
  text(bar, msg.slice(0, 90), 16, 10, 15, color, true);
}

/* ---------- landing / lobby / MP ---------- */
let mp: MpSession | null = null;
let mpRole: 'host' | 'client' | null = null;
let myName = 'PLAYER';
/** Match director — non-null for the whole of an MP run, null in solo. */
let lms: LmsDirector | null = null;
(window as any).__DBG = { begin: 0, rounds: 0, startRuns: 0, mounts: 0, errors: [] as string[] };
const DBG = (window as any).__DBG as any;
/**
 * Advance one depth. Clients do NOT deal: the host's next round frame is the
 * only thing allowed to mount their board, so they sit on the revealed one
 * (answer + updated ladder still readable) until it lands.
 */
function advance(): void {
  if (!run) return;
  run.depth++; DBG.rounds++;
  if (mpRole === 'client') return;
  deal();
}

/* ---------- LMS layer (host-authoritative multiplayer match) ---------- */

/** True while this run is a solo descent: no director, or a one-seat room. */
function soloRules(): boolean { return !lms || !lms.isContest(); }

/** Puzzle difficulty at a depth — identical on every screen (no wire trust). */
function diffAt(depth: number): number { return Math.min(5, 1 + Math.floor(depth / 6)); }
/** Sanctuary flag for a depth, read off the shared seeded arc plan. */
function sanctuaryAt(depth: number): boolean { return !!run?.plan[depth - 1]?.sanctuary; }

/** Mirror the authoritative table back onto the local run so the existing
 *  HUD, audio ramps and end screen keep reading one set of numbers. */
function mirrorLocal(): void {
  if (!lms || !run) return;
  const st = lms.state();
  const mine = st.table.find((row) => row.uid === st.myUid);
  if (mine) run.score = mine.pts;
  const hp = st.hp[st.myUid];
  if (typeof hp === 'number') { run.hp = hp; noteHp(hp); }
}

/** Feed the audio director's low-HP ramp. It was imported and never called,
 *  so the heartbeat under a dying run has never actually fired. */
function noteHp(hp: number): void {
  try { onHpThreshold(hp); } catch { /* audio optional */ }
}

/** Reveal juice (fx/reveal.ts) — motion-gated inside, torn down with the scene. */
function playRevealFx(root: Container, kind: 'correct' | 'wrong', streak: number, points: number): void {
  try {
    const h = playReveal(root, kind, streak, { points, shakeTarget: root });
    onSceneStop(() => { try { h.destroy(); } catch { /* already gone */ } });
  } catch { /* fx optional */ }
}

/** Build the match director for this run. Every wire call and every effect
 *  it is allowed to reach is spelled out here; the sequencing lives in
 *  scenes/lmsdirector.ts where a node gate can drive it. */
function makeDirector(role: 'host' | 'client', session: MpSession, seed: number): LmsDirector {
  const seats = session.rosterNow().map((p) => ({ uid: p.id, name: p.name }));
  return createDirector({
    role,
    myUid: session.myUid() ?? (role === 'host' ? 'HOST' : '?'),
    wire: {
      reveal: (n, a, scores, hp) => session.reveal(n, a, scores, hp),
      pushScores: (n, scores, hp, reason) => session.pushScores(n, scores, hp, reason),
      eliminate: (uids) => session.eliminate(uids),
      endMatch: (scores, reason) => session.endMatch(scores, reason),
      sendSr: (n, v) => session.sendSr(n, v),
      attack: (t, w, n) => session.attack(t, w, n),
      roster: () => session.rosterNow().map((p) => ({ id: p.id, name: p.name })),
    },
    depth: () => run?.depth ?? 0,
    kind: () => run?.curKind ?? 'puzzle',
    answerIdx: () => run?.curAnswer ?? -1,
    diffAt,
    sanctuaryAt,
    scoreMul: activeScoreMul,
    clockSec: () => (run ? (performance.now() - run.depthStartedAt) / 1000 : 0),
    toast: (msg, kind) => {
      toastCurrent(msg, kind === 'good' ? T.good : kind === 'bad' ? T.bad : T.gold);
      if (kind === 'bad') sfx('scream');
    },
    advance: (delayMs) => {
      if (!run) return;
      if (delayMs <= 0) { advance(); return; }
      scheduleAdvance(run, run.depth, delayMs);
    },
    finish: () => { stopTick(); endRun(); },
    changed: () => { mirrorLocal(); },
  }, seats, seed);
}

/** Both roles: the sidebar rows, with attack hooks on legal targets. */
function sidebarPlayers(): Array<{ name: string; score: number; you?: boolean; clock?: number | null; rank?: number; glyph?: string; hp?: number; phase?: 'alive' | 'spectator' | 'left'; onAttack?: () => void }> {
  if (!lms) {
    const r = run;
    return [{ name: r?.name || 'YOU', score: r?.score ?? 0, you: true, rank: 1 }];
  }
  const hp = lms.state().hp;
  return lms.rows().map((row) => ({
    name: row.name,
    score: row.score,
    you: row.you,
    clock: row.clock,
    rank: row.rank,
    glyph: row.glyph,
    hp: hp[row.uid],
    phase: row.phase,
    onAttack: row.targetable ? () => openAttackMenu(row.uid, row.name, row.score, hp[row.uid]) : undefined,
  }));
}

let attackOverlay: Container | null = null;
function closeAttackMenu(): void {
  const ov = attackOverlay;
  attackOverlay = null;
  if (!ov || ov.destroyed) return; /* show() may already have taken the scene */
  ov.parent?.removeChild(ov);
  ov.destroy({ children: true });
}

function openAttackMenu(targetUid: string, targetName: string, targetScore: number, targetHp?: number): void {
  const d = lms;
  if (!d || !current || !d.mayAttack()) return;
  closeAttackMenu();
  attackOverlay = buildAttackMenu({
    targetName,
    targetScore,
    targetHp,
    depth: d.state().depth,
    entries: d.attackMenu(),
    budget: d.budget(),
    onPick: (weapon) => { closeAttackMenu(); d.throwAt(targetUid, weapon); },
    onClose: closeAttackMenu,
  });
  current.addChild(attackOverlay);
}

/**
 * Tear down the Shadow bubble and the LARGE announce channel.
 *
 * Both mount into `view` rather than the scene root — deliberately, so they
 * survive show()/clearCurrent() and can speak across a depth change. The cost
 * is that nothing retires them when the RUN ends, so the last chaos-round
 * banner used to sit over the results screen and the landing page.
 */
function detachPersonas(): void {
  try { detachShadow(); } catch { /* optional */ }
  try { detachLarge(); } catch { /* optional */ }
}

/** Horizontal midpoint of the board column (the sidebar owns x >= 984). */
const BOARD_MID = 500;
/**
 * Top of the takeover stage box.
 *
 * Was 110, which put the scene straight over the chaos-round header: the
 * goal card was painted first and the stage covered it, so the one line
 * telling you what the round wants was hidden behind the round. The band
 * 110..178 is now reserved for title / win condition / controls, and the
 * scene starts below it (scaled to fit, aspect preserved).
 */
const TAKEOVER_TOP = 178;

/** Centred single line, measured after layout so it is never off-centre. */
function centreText(parent: Container, str: string, y: number, size: number, color: string): Text {
  const t = text(parent, str, 0, y, size, color, true);
  t.x = Math.round((STAGE_W - t.width) / 2);
  return t;
}

/** Toast onto whatever scene is live (LMS events fire outside deal()). */
function toastCurrent(msg: string, color: string): void {
  if (current) toastNow(current, msg, color);
}

/** Shared by both lobby paths: scene concerns stay here, match sequencing
 *  goes straight to the director. */
function wireLms(): void {
  wireMain({
    onRound: (e: MpEvent) => { if (mpRole === 'client') mountRemoteRound(e); },
    onBegin: (e: MpEvent) => {
      if (mpRole !== 'client') return;
      const ev = e as Extract<MpEvent, { t: 'begin'; timer: number; rn?: string; sd: number }>;
      startRun(myName, ev.rn || 'Room', ev.timer, ev.sd);
    },
    onSr: (e) => lms?.handle(e),
    onReveal: (e) => lms?.handle(e),
    onScores: (e) => lms?.handle(e),
    onElim: (e) => { closeAttackMenu(); lms?.handle(e); },
    onEnd: (e) => lms?.handle(e),
    onAttack: (e) => lms?.handle(e),
    onPeerLeave: (e) => lms?.handle(e),
  });
}

function toLanding(): void {
  stopTick();
  closeAttackMenu();
  initAudio();
  detachPersonas();
  lms = null;
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
  wireLms();
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
  wireLms();
  show(res.ui);
}

function mountRemoteRound(e: MpEvent): void {
  if (e.t !== 'round') return;
  const stgRef = typeof e.stg === 'string' ? { id: e.stg, seed: 0 } : e.stg;
  const rp = parseStg(stgRef.id);
  if (!rp) return;
  const sd = stgRef.seed >>> 0;
  /* `sd` is the BOARD seed for THIS depth, not the run seed. Storing it as
   * run.seed (what this used to do) left the client deriving modifiers,
   * worlds, curses, fate and emerald offers from a seed that changed every
   * round, while run.plan still came from the host's run seed — so no two
   * screens in a room agreed on the round's variation layers. Recover the
   * run seed instead, and keep seed and plan in lockstep. */
  const runSeed = runSeedFromRound(sd, e.n, rp.kind);
  if (!run) startRun(myName, 'Room', e.timerLen, runSeed);
  else if (run.seed !== runSeed) { run.seed = runSeed; run.plan = planArc(runSeed, 2000); }
  const r0 = run!;
  /* Clear before the depth moves, not inside deal(): between these two the
   * QA snapshot would otherwise report the NEW depth carrying the PREVIOUS
   * depth's modifiers, which is exactly the false desync signal the field
   * exists to rule out. */
  activeMods = [];
  r0.depth = e.n; r0.timerLen = e.timerLen;
  DBG.mounts++;
  try {
    /* deal() owns the scene lifecycle: it builds shell + backdrop + arc for
     * this depth and show()s it, which retires the previous round. Mounting
     * straight into `view` (the old path) left every client round parented to
     * an untracked container — chrome-less boards stacking up for the run. */
    deal({ rp, seed: sd });
  } catch (err) { DBG.errors.push('mount: ' + String(err).slice(0, 120)); }
}

/* ---------- run state ---------- */
interface Run {
  name: string; roomName: string; timerLen: number;
  seed: number; plan: ArcPlan[];
  depth: number; hp: number; score: number; streak: number;
  prevAlign: string | null; emeralds: string[]; lastTakeover: number; prevSanctuary: boolean; depthStartedAt: number;
  /** Score multiplier a curse imposed for the current depth (1 = none). */
  fateScoreMul: number;
  /** Shape of the depth currently on screen — the host scores inbound sr
   *  frames against THIS, never against anything the client claims. */
  curKind: 'puzzle' | 'takeover'; curAnswer: number;
}
/* Staleness is guarded by run IDENTITY (`run !== r`) throughout — a deferred
 * advance or tick from a dead run simply fails that check. */
let run: Run | null = null;
/* Which round modifiers the depth on screen is running. Read by the dev QA
 * snapshot so a driver (or a human with two tabs open) can assert that every
 * seat in a room is on the same variation layers. */
let activeMods: string[] = [];
let shell: Shell | null = null;
let lastLayer = 0;

function startRun(name: string, roomName: string, timerLen: number, seed?: number): void {
  seed = (seed ?? ((Date.now() & 0xffff) ^ (Math.floor(Math.random() * 0xffff) + 1))) >>> 0;
  run = { name, roomName, timerLen, seed, plan: planArc(seed, 2000), depth: 1, depthStartedAt: performance.now(), hp: 100, score: 0, streak: 0, prevAlign: null, emeralds: [], lastTakeover: -99, prevSanctuary: false, fateScoreMul: 1, curKind: 'puzzle', curAnswer: -1 };
  /* P2: one chaos bus per run. Pure logic — all time enters via tick(dtMs). */
  chaos = createChaos(seed, revealMotionEnabled());
  /* MP: the ladder, the attacks and the elimination sweep all hang off this. */
  lms = mp && mpRole ? makeDirector(mpRole, mp, seed) : null;
  closeAttackMenu();
  DBG.startRuns++;
  lastLayer = 0;
  initShadow(view);
  initLarge(view);
  initDirector();
  resetLegendRun();
  deal();
}

function endRun(): void {
  stopTick();
  chaos?.stop();
  chaos = null;
  closeAttackMenu();
  /* Same reason as toLanding(): the persona layers live in `view` so they can
   * outlive a depth, which meant the last chaos-round banner sat across the
   * results screen. startRun() re-inits them for DESCEND AGAIN. */
  detachPersonas();
  shell = null;
  const r = run!;
  sfx(r.hp > 0 ? 'laugh' : 'scream');
  const root = new Container();
  panel(root, 0, 0, STAGE_W, STAGE_H);

  if (lms && lms.isContest()) {
    /* LMS: the ladder IS the result. Winner first, then the full order with
     * every seat's fate spelled out, so nobody has to read the sidebar. */
    const st = lms.state();
    const won = st.winnerUid === st.myUid;
    const winner = st.table.find((row) => row.uid === st.winnerUid);
    text(root, 'LAST STANDING', STAGE_W / 2 - 96, 120, 15, T.muted, true);
    const head = winner ? winner.name.toUpperCase() : 'NOBODY';
    const headT = text(root, head, 0, 152, 44, won ? T.gold : T.ink, true);
    headT.x = Math.round((STAGE_W - headT.width) / 2);
    const sub = text(root, won ? 'THE SHADOW BLINKS FIRST' : 'DEPTH ' + (r.depth - 1) + ' · YOU SCORED ' + r.score, 0, 208, 16, T.muted, true);
    sub.x = Math.round((STAGE_W - sub.width) / 2);

    const rowsOut = lms.rows();
    const listW = 720, listX = Math.round((STAGE_W - listW) / 2);
    rowsOut.slice(0, 8).forEach((row, i) => {
      const y = 260 + i * 56;
      const card = panel(root, listX, y, listW, 48);
      text(card, String(row.rank), 20, 14, 16, row.rank <= 3 ? T.gold : T.muted, true);
      text(card, row.name.toUpperCase().slice(0, 16) + (row.you ? '  (YOU)' : ''), 62, 14, 16, T.ink, true);
      const fate = row.phase === 'alive' ? (row.uid === st.winnerUid ? 'SURVIVED' : 'STANDING') : row.phase === 'left' ? 'WALKED OUT' : 'DROWNED';
      const fateT = text(card, fate, 0, 16, 12, row.phase === 'alive' ? T.good : T.muted, true);
      fateT.x = listW - 140 - fateT.width;
      const ptsT = text(card, String(row.score), 0, 14, 16, T.gold, true);
      ptsT.x = listW - 20 - ptsT.width;
    });

    const home = panel(root, STAGE_W / 2 - 130, 760, 260, 64);
    home.eventMode = 'static'; home.cursor = 'pointer';
    text(home, 'BACK TO LANDING', 52, 20, 17, T.muted, true);
    home.on('pointerdown', () => { run = null; lms = null; toLanding(); });
    show(root);
    return;
  }

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
/**
 * Build and show one depth.
 * @param remote client only — the host's round frame, which names the stage
 *   and its seed. Absent = deal locally (solo, or the host's own deal).
 */
function deal(remote?: { rp: RoundPlan; seed: number }): void {
  const r = run!;
  /* A solo descent dies on HP. In a real match the elimination sweep is the
   * only authority on who is out, so a drained host keeps dealing until the
   * sweep says stop — but a one-seat room is not a match and must still die. */
  if ((soloRules() && r.hp <= 0) || r.depth > r.plan.length) { endRun(); return; }
  lms?.openDepth(r.depth);
  closeAttackMenu();
  activeMods = []; /* takeover depths run none; never report the last depth's */
  const plan = r.plan[r.depth - 1];
  r.fateScoreMul = 1; /* curses last exactly one depth */
  const root = new Container();
  /* Banners, curse lines and toasts are emitted BEFORE the board is built,
   * so they used to be painted under it — the sidebar panel sliced the layer
   * banner in half mid-sentence (owner, 2026-08-26: "issues with text having
   * other things over it or in front"). They now go into an overlay that is
   * parented LAST, so nothing can ever cover them again. */
  const overlay = new Container();
  /* P2: chaos juice overlays. The bus is pure; these are the only pixi it
   * ever touches. */
  chaosFlash = new Graphics();
  chaosScan = new Graphics();
  chaosMeltG = new Graphics();
  chaosEmberG = new Graphics();
  chaosGlitchG = new Graphics();
  chaosInvertG = new Graphics();
  /* Partial inversion via DIFFERENCE blend: it inverts whatever is already
   * drawn (the board); banners are drawn after it, so they stay clean. */
  chaosInvertG.blendMode = 'difference';
  /* P5: modifier scanline band — painted from the pure scanline-roll state
   * (same split as the chaos bus: modifiers.ts holds the numbers, the tick
   * paints them). Parented before the banners so it can never cover text. */
  modScanG = new Graphics();
  modInkG = new Graphics();
  modFogG = new Graphics();
  overlay.addChild(chaosFlash, chaosScan, modScanG, modInkG, modFogG, chaosMeltG, chaosEmberG, chaosGlitchG, chaosInvertG);
  modFx = [];
  modTickMs = 0;
  if (chaos) chaos.intensity(Math.min(1, plan.layer / 7)); /* corruption deepens with the descent */
  /* P4: round boundary — persistent cue state lasts exactly one round. melt is
   * a persistent bus value and cueScanlines is the flag the tick ORs into the
   * scanline condition; reset both here, before this round's cues run. The
   * time-limited cues (shake/glitch/flash/invert/embers) expire on the bus
   * clock, which only advances while the run tick is alive. */
  cueScanlines = false;
  if (chaos) chaos.melt(0);

  shell = Shell.attach(root, {
    onLobby: () => { run = null; toLanding(); },
    roomTitle: (r.roomName || 'PRIVATE ROOM') + ' · DEPTH ' + r.depth,
    onLeave: () => { run = null; toLanding(); },
  });
  shell.setDepth(r.depth);
  shell.setTimer(1, fmtClock(r.timerLen));
  r.depthStartedAt = performance.now();
  startTick(root);

  applyArc(root, plan);
  if (plan.sanctuary) sanctuaryOn(root); else sanctuaryOff(root);
  try {
    const wd = pickWorld(plan.align === 'chaotic' ? 'chaotic' : plan.align === 'good' ? 'good' : plan.align === 'neutral' ? 'neutral' : 'bad', mulberry((r.seed ^ Math.imul(r.depth, 0xBEEF)) >>> 0));
    if (layout.uw) onSceneStop(applyBackdrop(bleedHolder, wd.id, { w: layout.lw, h: STAGE_H }));
    else onSceneStop(applyBackdrop(root, wd.id));
  } catch { /* backdrop optional */ }
  try {
    const cm = maybeCurse({ depth: r.depth, align: plan.align, rng: mulberry((r.seed ^ Math.imul(r.depth, 0xCA75E)) >>> 0), hp: r.hp, seed: r.seed });
    if (cm) {
      if (typeof cm.hpDelta === 'number') r.hp = Math.max(0, Math.min(100, r.hp + cm.hpDelta));
      r.fateScoreMul = typeof cm.scoreMul === 'number' && cm.scoreMul > 0 ? cm.scoreMul : 1;
      performCue(cm.cue);
      if (cm.bannerText) toastNow(overlay, cm.bannerText, T.gold);
    }
  } catch { /* fate optional */ }

  /* Resolve the round shape FIRST: the atmosphere layer needs to know
   * whether a chaos header is about to claim the banner row. */
  const rp = roundPlan(r.seed, r.depth, ALL_FAMILIES.length, TAKEOVERS.length, (d) =>
    plan.align !== 'good' && d >= 4 && d - r.lastTakeover >= 3 && ((r.seed ^ Math.imul(d, 2654435761)) >>> 0) % 100 < 42);
  const chaosRound = (remote ? remote.rp.kind : rp.kind) === 'takeover';

  /* Announce the depth BEFORE anything that can return early. This used to
   * sit at the bottom of deal(), below the emerald interlude's `return` — so
   * on every 4th depth the host showed itself a power-up choice and sent the
   * room nothing at all. Clients sat on the previous screen and only the host
   * ever got a relic. `rp`, `r.depth` and `r.timerLen` are all final here;
   * nothing between this point and the old call site touched them. */
  if (!remote && mp && mpRole === 'host') mp.round(r.depth, rp.kind === 'takeover' ? 'tk:' + rp.index : 'pz:' + rp.index, rp.seed, r.timerLen);

  onAct(Math.min(3, Math.floor(plan.layer / 2)));
  if (plan.align !== 'good' && plan.layer > lastLayer && plan.layer >= 2) {
    const spec = layerBanner(overlay, plan.layer);
    /* Centre on the BOARD column, not the stage: the sidebar owns x >= 984,
     * so a stage-centred banner ran straight underneath it. On a chaos round
     * the goal card owns this row entirely — telling someone what to do beats
     * atmosphere, so the whisper stands down rather than crowding it. */
    if (!chaosRound) {
      const bt = text(overlay, spec.text, 0, 118, 26, T.bad, true);
      bt.x = Math.round(BOARD_MID - bt.width / 2);
    }
    say('whisper', {});
    announceLarge('layer', spec.text);
  }
  if (plan.sanctuary && !r.prevSanctuary) announceLarge('sanctuary', 'THE ORIGINAL LIGHT RETURNS');
  r.prevSanctuary = !!plan.sanctuary;
  try {
    const fa = maybeFlavorA({ depth: r.depth, align: plan.align, rng: mulberry((r.seed ^ Math.imul(r.depth, 0xFA1A7 % 65536)) >>> 0), hp: r.hp, seed: r.seed });
    if (fa) { performCue(fa.cue); if (fa.bannerText) toastNow(overlay, fa.bannerText, T.gold); }
    const fb = maybeFlavorB({ depth: r.depth, align: plan.align, rng: mulberry((r.seed ^ Math.imul(r.depth, 0xFB2B3 % 65536)) >>> 0), hp: r.hp, seed: r.seed });
    if (fb) { performCue(fb.cue); if (fb.bannerText) toastNow(overlay, fb.bannerText, T.muted); }
    /* P4 breadth: the pack layer (16 packs, one weighted picker). Its riders
     * are deliberately only the two this engine really applies — hpDelta and
     * scoreMul — so a pack event can never read mechanical and do nothing.
     * scoreMul MULTIPLIES into fateScoreMul so a curse in the same round is
     * not silently overwritten; fateScoreMul is reset to 1 each depth. */
    const pk = maybePack({ depth: r.depth, align: plan.align, rng: mulberry((r.seed ^ Math.imul(r.depth, 0x9C4A1 % 65536)) >>> 0), hp: r.hp, seed: r.seed });
    if (pk) {
      if (typeof pk.hpDelta === 'number') r.hp = Math.max(0, Math.min(100, r.hp + pk.hpDelta));
      if (typeof pk.scoreMul === 'number' && pk.scoreMul > 0) r.fateScoreMul *= pk.scoreMul;
      performCue(pk.cue);
      if (pk.bannerText) toastNow(overlay, pk.bannerText, T.gold);
    }
  } catch { /* flavor optional */ }
  setDreadLayer(plan.align === 'good' ? 0 : plan.layer);
  if (plan.align !== r.prevAlign && r.prevAlign !== null) sting(plan.align === 'good' ? 'heal' : 'pain');
  setAlignment(plan.align === 'chaotic' ? 'chaotic' : plan.align);
  noteRound(plan.align, plan.layer, plan.sanctuary ? 1 : 0);
  r.prevAlign = plan.align;

  // emerald interlude every 4th depth
  if (r.depth % 4 === 0 && r.depth > 1) {
    const offers = emeraldPick((r.seed ^ Math.imul(r.depth, 7919)) >>> 0, r.emeralds);
    if (offers.length) {
      /* No board, no clock: the round tick used to keep counting under the
       * emerald screen and "drown" a player mid-choice (and in MP it would
       * have swept the whole table for a depth nobody could answer). The
       * juice freezes with the tick, so clear it too. */
      stopTick();
      clearJuice();
      shell.setTimer(1, fmtClock(r.timerLen));
      const pickRoot = buildInterlude(offers, (id) => {
        r.emeralds.push(id);
        toastNow(root, 'THE ' + id.toUpperCase().replace('_', ' ') + ' IS YOURS', T.gold);
        sfx('levelup');
        try { onEmerald(); } catch {}
        /* Everyone in the room picks their own relic, but only the host paces
         * the match. A client that advanced itself here would deal a depth the
         * host never sent — the same class of divergence as the run seed. It
         * waits for the host's next round frame instead, exactly like it does
         * after answering a board. */
        if (mp && mpRole === 'client') return;
        scheduleAdvance(r, r.depth, 900);
      });
      root.addChild(pickRoot);
      root.addChild(overlay);
      show(root);
      return;
    }
  }

  // fate roll (hostile/neutral flavor events)
  const fate = maybeFate({ depth: r.depth, align: plan.align, rng: mulberry((r.seed ^ Math.imul(r.depth, 0xFA7E)) >>> 0), hp: r.hp, seed: r.seed });
  if (fate) {
    performCue(fate.cue);
    if (fate.bannerText) toastNow(overlay, fate.bannerText, T.gold);
    if (typeof fate.timerDelta === 'number' && fate.timerDelta < 0) r.hp -= 0; // timer handled per-scene
  }

  /* A client with no round frame yet shows the chrome and waits. */
  if (mpRole === 'client' && !remote) { r.curKind = 'puzzle'; r.curAnswer = -1; root.addChild(overlay); startTick(root); show(root); return; }
  const useRp = remote ? remote.rp : rp;
  const useSeed = remote ? remote.seed : rp.seed;
  r.curKind = useRp.kind;
  r.curAnswer = -1;
  if (useRp.kind === 'takeover') { r.lastTakeover = r.depth; setPresence('hidden'); dealTakeover(root, useRp.index, useSeed, overlay); }
  else { juiceW = BOARD_PANEL.x + BOARD_PANEL.w; /* keep the sidebar clean */ dealPuzzle(root, useRp.index, useSeed, r.depth, overlay); }
  root.addChild(overlay); /* banners on top of the board, always */
  startTick(root);
  show(root);
}

/* ONE tick for the whole run — per-deal intervals accumulated into ghost
 * storms (BugSweep BUG 1/3/4/5). The tick self-cancels when the run dies. */
let tickId: ReturnType<typeof setInterval> | null = null;
let chaos: ChaosBus | null = null;
let chaosFlash: Graphics | null = null;
let chaosScan: Graphics | null = null;
let chaosMeltG: Graphics | null = null;
let chaosEmberG: Graphics | null = null;
let chaosGlitchG: Graphics | null = null;
let chaosInvertG: Graphics | null = null;
let modScanG: Graphics | null = null;
let modInkG: Graphics | null = null;
let modFogG: Graphics | null = null;
/* P5: per-round modifier effect drivers. Each entry is a pure-ish painter
 * (tMs) => void built in dealPuzzle from a modifier's state; the run tick
 * drives them on the same 250 ms clock. Rebuilt every deal. */
let modFx: Array<(tMs: number) => void> = [];
let modTickMs = 0;
/* P4: true while a fate cue asked for scanlines this round. The tick ORs it
 * into the layer>=4 condition so a cue's scanlines survive the per-tick sync.
 * Reset at the top of every deal (round boundary). */
let cueScanlines = false;
/* Feel pass (15:00 build): the juice column. Puzzle rounds scope every juice
 * rect to the board column so the sidebar (player list, clock, x >= 984) is
 * never inverted, scanned or melted; takeover rounds hide the sidebar, so
 * their juice may run full-stage. Set at each deal() branch. */
let juiceW = STAGE_W;
let emberPts: Array<{ x: number; y: number; s: number }> | null = null;
let glitchBands: number[] | null = null;
function stopTick(): void { if (tickId !== null) { clearInterval(tickId); tickId = null; } }
/* P4: perform a fate event's declarative cue through the chaos bus. The bus
 * clamps/drops everything (flash <=200ms & <=3Hz, shake 0..1, embers <=64) and
 * selftest-fate.ts already proved every shipped cue is in limits, so nothing
 * is re-checked here. Persistent pieces (melt, scanlines) are scoped to the
 * round by the reset at the top of deal(). */
function performCue(cue: {
  shake?: { intensity: number; ms: number };
  glitch?: number;
  flash?: { color: number; ms: number };
  embers?: number;
  scanlines?: boolean;
  melt?: number;
  invert?: number;
} | null | undefined): void {
  if (!chaos || !cue) return;
  try {
    if (cue.shake) chaos.shake(cue.shake.intensity, cue.shake.ms);
    if (cue.glitch) chaos.glitch(cue.glitch);
    if (cue.flash) chaos.flash(cue.flash.color, cue.flash.ms);
    if (cue.embers !== undefined) chaos.embers(cue.embers);
    if (cue.scanlines) cueScanlines = true;
    if (cue.melt !== undefined) chaos.melt(cue.melt);
    if (cue.invert) chaos.invert(cue.invert);
  } catch { /* juice must never kill a round */ }
}
/* P4: wipe all juice overlays — used wherever the tick stops but the root
 * stays on screen (emerald interlude, MP timeout), so no frozen flash or
 * ember field lingers over a static screen. */
function clearJuice(): void {
  chaosFlash?.clear();
  chaosScan?.clear();
  modScanG?.clear();
  modInkG?.clear();
  modFogG?.clear();
  chaosMeltG?.clear();
  chaosEmberG?.clear();
  chaosGlitchG?.clear();
  chaosInvertG?.clear();
}
function startTick(root: Container): void {
  stopTick();
  const r = run!;
  tickId = setInterval(() => {
    if (run !== r) { stopTick(); return; }
    const left = Math.max(0, r.timerLen - (performance.now() - r.depthStartedAt) / 1000);
    shell?.setTimer(left / r.timerLen, fmtClock(Math.ceil(left)));
    /* P2: drive the chaos bus from the run tick and paint its state. The
     * ambient trigger rolls once per second from (runSeed, depth, second) —
     * no local randomness, so host and clients corrupt in step. */
    /* P5: drive modifier effects from the same 250 ms clock. modFx paints the
     * band/occlusion Graphics from the pure modifier state; modTickMs is the
     * accumulated clock those effects' step(tMs) was designed around. */
    modTickMs += 250;
    for (const fx of modFx) { try { fx(modTickMs); } catch { /* juice must never kill a round */ } }
    if (chaos) {
      chaos.tick(250);
      const st = chaos.state();
      const layer = r.plan[r.depth - 1].layer;
      const sec = Math.floor(st.timeMs / 1000);
      const roll = mulberry((r.seed ^ Math.imul(r.depth, 0xC0FFEE) ^ Math.imul(sec, 0x9E3779B9)) >>> 0)();
      if (roll < 0.25 * st.intensity) {
        chaos.shake(0.3 + 0.5 * st.intensity, 300);
        chaos.glitch(200);
        if (roll < 0.1 * st.intensity) chaos.flash(0xff2244, 150);
      }
      const scanOn = layer >= 4 || cueScanlines;
      if (st.scanlines !== scanOn) chaos.scanlines(scanOn);
      root.x = st.shakeX * 8;
      root.y = st.shakeY * 8;
      if (chaosFlash) {
        chaosFlash.clear();
        if (st.flashAlpha > 0) chaosFlash.rect(0, 0, juiceW, STAGE_H).fill({ color: st.flashColor, alpha: st.flashAlpha });
      }
      if (chaosScan) {
        chaosScan.clear();
        if (st.scanlines) {
          const off = Math.round(st.scanPhase * 4);
          for (let y = off; y < STAGE_H; y += 4) chaosScan.rect(0, y, juiceW, 1).fill({ color: 0x000000, alpha: 0.12 * st.intensity });
        }
      }
      /* P4: paint the rest of the cue state. Melt is a static tint; invert is
       * a partial DIFFERENCE-blend inversion (bus caps it at 0.4*dial so the
       * board stays legible); embers are a deterministic dot field (static —
       * no motion under motion=false); glitch bands are offset slices, only
       * active while the bus reports a glitch (0 under motion=false). */
      if (chaosMeltG) {
        chaosMeltG.clear();
        if (st.melt > 0) chaosMeltG.rect(0, 0, juiceW, STAGE_H).fill({ color: 0x2a0f00, alpha: 0.35 * st.melt });
      }
      if (chaosEmberG) {
        chaosEmberG.clear();
        if (st.embers > 0) {
          if (!emberPts) {
            const e = mulberry(0xE4B4);
            emberPts = Array.from({ length: 64 }, () => ({ x: e(), y: e(), s: 2 + Math.floor(e() * 3) }));
          }
          const pts = emberPts;
          for (let i = 0; i < st.embers && i < pts.length; i++) {
            const p = pts[i]!;
            chaosEmberG.rect(p.x * juiceW, p.y * STAGE_H, p.s, p.s).fill({ color: 0xffb84d, alpha: 0.7 });
          }
        }
      }
      if (chaosGlitchG) {
        chaosGlitchG.clear();
        if (st.glitch > 0) {
          if (!glitchBands) {
            const g = mulberry(0x4C17);
            glitchBands = Array.from({ length: 8 }, () => g());
          }
          const bands = glitchBands;
          for (let i = 0; i < 4; i++) {
            const y = bands[i]! * STAGE_H;
            const xoff = Math.sin(st.timeMs * 0.02 + i * 1.7) * 24 * st.glitch;
            chaosGlitchG.rect(xoff, y, juiceW, 3).fill({ color: 0x66ffee, alpha: 0.6 * st.glitch });
          }
        }
      }
      if (chaosInvertG) {
        chaosInvertG.clear();
        if (st.invert > 0) chaosInvertG.rect(0, 0, juiceW, STAGE_H).fill({ color: 0xffffff, alpha: st.invert });
      }
    }
    if (left <= 0) {
      stopTick();
      if (lms && mp) {
        /* MP: the host owns the clock. It punishes every seat that never
         * answered and closes the depth; clients just stop and wait for the
         * reveal so two screens can never disagree about who timed out. The
         * juice freezes with the tick, so clear it. */
        r.streak = 0;
        toastNow(root, 'TIME DROWNED YOU', T.bad);
        clearJuice();
        lms.timeout(); /* host sweeps + reveals; clients simply wait */
        return;
      }
      r.hp = Math.max(0, r.hp - 12); r.streak = 0;
      toastNow(root, 'TIME DROWNED YOU', T.bad);
      r.depth++; deal();
    }
  }, 250);
}
/* Guarded deferred advance: fires only if the SAME run is still on the SAME
 * depth (stale timers from a previous depth or after death are dropped). */
function scheduleAdvance(r: Run, fromDepth: number, delayMs: number): void {
  setTimeout(() => {
    if (run !== r || r.depth !== fromDepth) return;
    r.depth++; deal();
  }, delayMs);
}

function dealTakeover(root: Container, idx: number, planSeed: number, overlay: Container): void {
  const r = run!;
  announce('CHAOS ROUND — ' + TAKEOVER_NAMES[idx]);
  /* Title, WIN CONDITION and controls, each on its own line and centred on
   * the stage. All three used to collide at y=148-150 when a card existed at
   * all — and for 14 of the 25 takeovers no card existed, because main
   * indexed a hardcoded 11-entry id list. onboard.TAKEOVER_STAGE_IDS is now
   * the ordering contract and its selftest fails if any stage lacks a card. */
  const gc = goalCardForIndex(idx);
  const head = centreText(overlay, 'CHAOS ROUND · ' + (gc?.title ?? TAKEOVER_NAMES[idx]), 110, 16, T.gold);
  head.style.letterSpacing = 3;
  centreText(overlay, gc ? gc.goal : 'SURVIVE THE ROUND', 134, 15, T.ink);
  if (gc) centreText(overlay, gc.controls, 157, 12, T.muted);
  // Fit the full-stage (1600x900) takeover scene into the area below the
  // shell header AND the reserved goal-card band: uniform scale, aspect
  // preserved, centered horizontally. Scenes lay out for the whole stage; a
  // plain offset used to push their bottom HUD and second tile rows past the
  // stage edge.
  const box = new Container();
  const fitS = Math.min(1, (STAGE_H - TAKEOVER_TOP) / STAGE_H);
  box.scale.set(fitS);
  box.x = Math.round((STAGE_W - STAGE_W * fitS) / 2);
  box.y = TAKEOVER_TOP;
  root.addChild(box);
  const mount = TAKEOVERS[idx];
  mount({
    depth: r.depth, seed: planSeed, timerLen: r.timerLen,
    container: box, rng: mulberry((r.seed ^ Math.imul(r.depth, 0x9E37)) >>> 0),
    onDone: (res: StageResult) => {
      if (res.correct === true) { r.streak++; say('right', {}); } else if (res.correct === false) { r.streak = 0; say('wrong', {}); }
      toastNow(root, res.summary, res.correct === true ? T.good : res.correct === false ? T.bad : T.gold);
      if (lms && mp) { lms.answer(res.correct, res.points, res.hpDelta); return; }
      r.score = Math.max(0, r.score + res.points);
      r.hp = Math.max(0, Math.min(100, r.hp + res.hpDelta));
      scheduleAdvance(r, r.depth, 1500);
    },
  });
}
const TAKEOVER_NAMES = ['RED LIGHT', 'TIDE POOL', 'SERPENT', 'FLOOR-FALL', 'HUNTER-DODGE', 'LASER-STORM', 'DRONE SWARM', 'SABER CLASH', 'ONE-ARMED GOD', 'SLIME GALLERY', 'THE WELL', 'GLUTTON 2', 'THE WELL 2', 'SALVOS 2', 'CORRIDOR 2', 'SEED RITUAL', 'FOUR RIDERS', 'DEEP ZOOM', '606D', 'OVERWATCH', 'CHART TOPPER', 'FORGE SET', 'THE HUNT', 'FURY ROADRUN', 'SKY FIRE'];

function dealPuzzle(root: Container, famIdx: number, planSeed: number, depth: number, overlay: Container): void {
  const r = run!;
  const plan = r.plan[depth - 1];
  const fam = ALL_FAMILIES[famIdx % ALL_FAMILIES.length];
  const hue = T.boardHues[hueIndexForDepth(r.seed, depth, T.boardHues.length)];
  const diff = Math.min(5, 1 + Math.floor(depth / 6));
  const p = fam.generate((planSeed ^ Math.imul(depth, 7919)) >>> 0, diff, hue);
  if (plan.sanctuary) sanctuaryOn(root);

  r.curAnswer = p.answer;
  try {
    /* First sight of a family in the shallow depths gets one plain-language
     * line. onboard.ts already tracks "seen this run"; nothing was asking it. */
    const legend = maybeShowLegend(depth, fam.id);
    if (legend) {
      const band = panel(root, 40, 118, 920, 34);
      text(band, legend.text.slice(0, 110), 14, 8, 13, T.muted, true);
    }
  } catch { /* legend optional */ }
  let answered = false;
  const scene = buildGameScene(p, (idx, correct) => {
    if (answered) return; /* F2 lock: one answer per board */
    answered = true;
    const diffV = diff;
    const mul = activeScoreMul();
    const midas = mul > 1;
    if (correct) {
      r.streak++;
      const pts = pointsFor(diffV, r.streak, mul);
      sfx('chime');
      dirOnReveal(true, r.streak);
      say('right', {});
      playRevealFx(root, 'correct', r.streak, pts);
      toastNow(root, (midas ? 'MIDAS · ' : mul < 1 ? 'CURSED · ' : '') + '+' + pts + ' — ' + p.rule, T.good);
      if (!lms) { r.score += pts; if (plan.sanctuary) r.hp = Math.min(100, r.hp + 20); }
    } else {
      r.streak = 0;
      sting('pain');
      dirOnReveal(false, 0);
      say('wrong', {});
      playRevealFx(root, 'wrong', 0, 0);
      toastNow(root, 'WRONG — answer ' + (p.answer + 1) + ' · ' + p.rule, T.bad);
      if (!lms) { r.score = Math.max(0, r.score - 40); r.hp = Math.max(0, r.hp - 12); }
    }
    /* MP: the host re-derives the score from (diff, streak, sanctuary) —
     * the verdict below only reports WHAT happened, never what it is worth. */
    if (lms && mp) { lms.answer(correct, 0, hpFor(correct, !!plan.sanctuary, depth)); return; }
    scheduleAdvance(r, r.depth, 1400);
  }, depth, {
    score: () => r.score,
    players: sidebarPlayers,
    locked: () => !!lms && !lms.mayAnswer(),
  });
  root.addChild(scene);

  /* P1: round modifiers — pure function of (runSeed, depth) so host and every
   * client roll the SAME ones. Count scales with layer: shallow stays clean,
   * deep gets strange. Every teardown is registered with the scene. */
  const modMax = Math.min(3, Math.max(1, Math.floor(plan.layer / 2)));
  const mctx: ModCtx = { depth, seed: r.seed, layer: plan.layer, align: plan.align, motion: revealMotionEnabled() };
  /* Transform about the stage centre, not the container origin. Pixi rotates
   * and scales around (0,0) by default, so mirror-flip (scale.x = -1) and
   * rotate-90 swung the whole board clean off the 1600x900 stage — a black
   * screen. Pivot and position both at the centre leaves the board looking
   * exactly the same while making those transforms happen in place. */
  scene.pivot.set(STAGE_W / 2, STAGE_H / 2);
  scene.position.set(STAGE_W / 2, STAGE_H / 2);
  for (const mod of pickModifiers(mctx, modMax)) {
    activeMods.push(mod.id);
    const stop = mod.apply(mctx, scene);
    onSceneStop(stop);
    if (mod.id === 'scanline-roll') {
      /* P5: scanline-roll — main.ts is the only place the pure state touches
       * Pixi. The painter advances the pure clock (stop.step) and paints the
       * band from scene.scanline, scoped to the board column exactly like the
       * chaos juice. Teardown deletes scene.scanline, the band disappears,
       * and the scene teardown below wipes the Graphics. Static mode has no
       * step, so the band stays pinned — no movement reported. */
      const paint = (tMs: number): void => {
        if (stop.step) stop.step(tMs);
        const g = modScanG;
        if (!g) return;
        g.clear();
        const st = (scene as unknown as { scanline?: { f: number; bandH: number; alpha: number } }).scanline;
        if (st) {
          const y = BOARD_PANEL.y + st.f * BOARD_PANEL.h;
          g.rect(BOARD_PANEL.x, y - st.bandH / 2, BOARD_PANEL.w, st.bandH).fill({ color: 0xffffff, alpha: st.alpha });
        }
      };
      modFx.push(paint);
      onSceneStop(() => { modScanG?.clear(); });
    } else if (mod.id === 'ink-splatter') {
      /* P5: ink-splatter — main.ts is the only place the pure state touches
       * Pixi. The painter advances the pure clock (stop.step, absent in static
       * mode) and paints the blot from scene.ink: centre-relative x/y offsets
       * and radius r, alpha driven by the wipe. Scoped to the board column,
       * parented in the overlay so it can never cover banners. Static mode
       * has no step, so the blot stays pinned at its seeded mid-wipe alpha. */
      const paint = (tMs: number): void => {
        if (stop.step) stop.step(tMs);
        const g = modInkG;
        if (!g) return;
        g.clear();
        const st = (scene as unknown as { ink?: { alpha: number; x: number; y: number; r: number } }).ink;
        if (st) {
          const cx = BOARD_PANEL.x + BOARD_PANEL.w / 2 + st.x;
          const cy = BOARD_PANEL.y + BOARD_PANEL.h / 2 + st.y;
          g.circle(cx, cy, st.r).fill({ color: 0x0a0a14, alpha: st.alpha });
        }
      };
      modFx.push(paint);
      onSceneStop(() => { modInkG?.clear(); });
    } else if (mod.id === 'fog-bank') {
      /* P5: fog-bank — same split as ink-splatter: main.ts is the only place
       * the pure state touches Pixi. The painter advances the pure clock
       * (stop.step, absent in static mode) and paints the drifting bank from
       * scene.fog: centre-relative x/y offsets, radius r, alpha ≤ 0.4 so the
       * board stays ≥ 60% visible. Parented in the overlay after the ink so
       * it can never cover banners. Static mode has no step, so the bank
       * stays pinned at its seeded centre — no movement reported. */
      const paint = (tMs: number): void => {
        if (stop.step) stop.step(tMs);
        const g = modFogG;
        if (!g) return;
        g.clear();
        const st = (scene as unknown as { fog?: { alpha: number; x: number; y: number; r: number } }).fog;
        if (st) {
          const cx = BOARD_PANEL.x + BOARD_PANEL.w / 2 + st.x;
          const cy = BOARD_PANEL.y + BOARD_PANEL.h / 2 + st.y;
          g.circle(cx, cy, st.r).fill({ color: 0x9fb4cc, alpha: st.alpha });
        }
      };
      modFx.push(paint);
      onSceneStop(() => { modFogG?.clear(); });
    } else if (mod.id === 'piano-keys') {
      /* P5: piano-keys — main.ts is the only place the pure state touches
       * Pixi. Reads the static scene.pianoKeys flag (no step: the flag is
       * identical under motion and static, so no movement is ever reported)
       * and restyles the ACTUAL option tiles (the Sprites labelled opt0..
       * opt7 — board grid tiles are excluded by their label, found by
       * walking the scene) as piano keys: a dark key-stripe
       * across the top and a light rim, drawn as a child Graphics so the
       * option art underneath stays readable and the pointerdown handler
       * (which captures idx in closure) is untouched. The scene is
       * destroyed with the round, so no separate Pixi teardown is needed. */
      const st = (scene as unknown as { pianoKeys?: boolean }).pianoKeys;
      if (st === true) {
        const opts: Sprite[] = [];
        const collect = (c: Container): void => {
          for (const ch of c.children) {
            if (ch instanceof Sprite) {
              const lab = (ch as unknown as { label?: string }).label;
              if (lab !== undefined && lab.startsWith('opt')) opts.push(ch);
            } else if (ch instanceof Container) collect(ch);
          }
        };
        collect(scene);
        for (const s of opts) {
          const g = new Graphics();
          const w = s.width;
          const h = s.height;
          g.rect(0, 0, w, Math.max(8, Math.round(h * 0.2))).fill({ color: 0x101018 });
          g.rect(0, 0, w, h).stroke({ color: 0xffffff, width: 2 });
          s.addChild(g);
        }
      }
    } else if (mod.id === 'tilt-3d') {
      /* P5: tilt-3d — simplest honest perspective tilt, no real 3D: main.ts
       * is the only place the pure state touches Pixi. The painter advances
       * the pure clock (stop.step, absent in static mode) and reads
       * scene.tilt = { pitch } (radians). It squashes the scene vertically —
       * scale.y = cos(pitch) ∈ [0.92, 0.99] — and skews it by pitch around
       * the stage-centre pivot already set up above, so the board leans
       * without leaving the 1600x900 stage. Teardown restores the exact
       * original transform. */
      const origScaleX = scene.scale.x;
      const origScaleY = scene.scale.y;
      const paint = (tMs: number): void => {
        if (stop.step) stop.step(tMs);
        const st = (scene as unknown as { tilt?: { pitch: number } }).tilt;
        if (st) {
          scene.scale.y = Math.cos(st.pitch);
          scene.skew.y = -st.pitch;
        }
      };
      modFx.push(paint);
      paint(0); // apply immediately; don't wait for the first 250 ms tick
      onSceneStop(() => { scene.scale.x = origScaleX; scene.scale.y = origScaleY; scene.skew.y = 0; });
    } else if (mod.id === 'option-shuffle') {
      /* P5: option-shuffle — main.ts is the only place the pure state touches
       * Pixi. Reads the static scene.optionOrder (a seeded permutation of
       * 0..7, identical under motion and static — no step is ever exposed,
       * so no movement is ever reported) and moves each option Sprite
       * opt<idx> (and its optlabel<idx> number) to the permuted grid slot.
       * Only POSITIONS change: the pointerdown closure still captures idx,
       * so which option is correct is untouched. The banner tells the player
       * the options moved. Teardown restores the exact original x/y. */
      const order = (scene as unknown as { optionOrder?: number[] }).optionOrder;
      if (order !== undefined) {
        toastNow(overlay, mod.banner ?? 'OPTIONS HAVE MOVED', T.gold);
        const sl = puzzleLayout(p.cols, p.rows);
        const moves: Array<{ node: Sprite | Text; ox: number; oy: number }> = [];
        for (let slot = 0; slot < order.length; slot++) {
          const idx = order[slot]!;
          const find = (c: Container): Sprite | null => {
            for (const ch of c.children) {
              if (ch instanceof Sprite && (ch as unknown as { label?: string }).label === 'opt' + idx) return ch;
              if (ch instanceof Container) {
                const r = find(ch);
                if (r) return r;
              }
            }
            return null;
          };
          const sp = find(scene);
          if (!sp) continue;
          moves.push({ node: sp, ox: sp.x, oy: sp.y });
          sp.x = sl.ox + (slot % 4) * (sl.optSize + GRID_GAP);
          sp.y = sl.oy + Math.floor(slot / 4) * (sl.optSize + GRID_GAP);
          for (const ch of sp.parent ? sp.parent.children : []) {
            if (ch instanceof Text && ch.label === `optlabel${idx}`) {
              moves.push({ node: ch, ox: ch.x, oy: ch.y });
              ch.x = sp.x + 6;
              ch.y = sp.y + sl.optSize - 22;
            }
          }
        }
        onSceneStop(() => { for (const m of moves) { m.node.x = m.ox; m.node.y = m.oy; } });
      }
    } else if (mod.id === 'inverted-controls') {
      /* P5: inverted-controls — the last of the twelve that was still a silent
       * no-op. main.ts is the only place the pure state touches Pixi. It reads
       * scene.invertMap (a permutation: clicking slot i selects option
       * invertMap[i]) and re-routes the INPUT without touching the board:
       *
       *   - the option Sprite goes eventMode 'passive' — it stops being
       *     hit-testable itself, but its children still are;
       *   - a nearly-invisible proxy is added AS A CHILD of that sprite, so it
       *     follows the tile if option-shuffle moves it later in the same
       *     round (both modifiers can roll together);
       *   - the proxy emits 'pointerdown' on the MAPPED sprite, whose handler
       *     closes over its own idx — so the answer that gets scored, the tile
       *     that flashes green or red, and the single-fire guard are all the
       *     game's own, unmodified.
       *
       * Which option is correct never changes; the board never changes; every
       * option stays reachable from exactly one slot. The banner announces it
       * (P1 rail 5) because a control change the player cannot see is not a
       * modifier, it is a bug. Teardown restores eventMode and removes the
       * proxies. Identical under motion and static — an input mapping is not
       * an animation. */
      const map = (scene as unknown as { invertMap?: number[] }).invertMap;
      if (map !== undefined) {
        toastNow(overlay, mod.banner ?? 'CONTROLS INVERTED', T.bad);
        const opts = new Map<number, Sprite>();
        const collect = (c: Container): void => {
          for (const ch of c.children) {
            if (ch instanceof Sprite) {
              const lab = (ch as unknown as { label?: string }).label;
              const m = lab !== undefined ? /^opt(\d+)$/.exec(lab) : null;
              if (m) opts.set(Number(m[1]), ch);
            } else if (ch instanceof Container) collect(ch);
          }
        };
        collect(scene);
        const restore: Array<() => void> = [];
        const proxies: Graphics[] = [];
        for (const [slot, sp] of opts) {
          const dest = opts.get(map[slot] ?? slot);
          if (!dest) continue;
          const prevMode = sp.eventMode;
          const prevCursor = sp.cursor;
          sp.eventMode = 'passive';
          restore.push(() => { sp.eventMode = prevMode; sp.cursor = prevCursor; });
          const proxy = new Graphics();
          /* A hit target needs geometry; alpha 0.004 is invisible on screen
           * and still hit-tests. */
          proxy.rect(0, 0, sp.width, sp.height).fill({ color: 0xffffff, alpha: 0.004 });
          proxy.eventMode = 'static';
          proxy.cursor = 'pointer';
          /* game.ts's option handler takes no arguments, so the event object
           * Pixi's typings insist on is genuinely unused — hence the cast
           * rather than forging a FederatedPointerEvent. */
          const fire = (dest as unknown as { emit: (ev: string) => void });
          proxy.on('pointerdown', () => { fire.emit('pointerdown'); });
          sp.addChild(proxy);
          proxies.push(proxy);
        }
        onSceneStop(() => {
          for (const f of restore) f();
          for (const p2 of proxies) { p2.parent?.removeChild(p2); p2.destroy(); }
        });
      }
    }
  }

  /* P3: cameo silhouettes — pure function of (runSeed, depth), budgeted per
   * round, drawn into the overlay so they sit above the board. Every teardown
   * is registered with the scene, exactly like the modifiers above. */
  const cl = puzzleLayout(p.cols, p.rows);
  const answerArea = { x: BOARD_PANEL.x + cl.ox, y: BOARD_PANEL.y + cl.oy, w: cl.optW, h: cl.optH };
  const cameoHost = new Container();
  overlay.addChild(cameoHost);
  for (const c of pickCameos(r.seed, depth, answerArea)) {
    const sil = ROSTER.find((s) => s.id === c.id);
    if (!sil) continue;
    const node = new Container();
    node.x = c.x; node.y = c.y;
    const ink = sil.alignment === 'good' ? T.good : sil.alignment === 'bad' ? T.bad : T.muted;
    const g = new Graphics();
    for (const m of sil.marks) {
      const mx = m.x * c.size, my = m.y * c.size, ms = m.size * c.size;
      if (m.kind === 'line') {
        g.moveTo(mx, my).lineTo((m.x2 ?? m.x) * c.size, (m.y2 ?? m.y) * c.size).stroke({ width: Math.max(2, ms * 0.5), color: ink, alpha: 0.9 });
      } else if (m.kind === 'dot') {
        g.circle(mx, my, ms).fill(ink);
      } else if (m.kind === 'diamond') {
        g.poly([mx, my - ms, mx + ms, my, mx, my + ms, mx - ms, my]).fill(ink);
      } else {
        const pts: number[] = [];
        for (let i = 0; i < 3; i++) {
          const a = m.rot + (i * 2 * Math.PI) / 3;
          pts.push(mx + Math.cos(a) * ms, my + Math.sin(a) * ms);
        }
        g.poly(pts).fill(ink);
      }
    }
    node.addChild(g);
    cameoHost.addChild(node);
  }
  onSceneStop(() => { cameoHost.destroy({ children: true }); });
}

/**
 * Score multiplier in force for this depth (1 = none).
 *
 * Curses roll off the shared seed BUT also off the player's own hp, so two
 * screens can legitimately disagree about whether one fired. In a contest
 * everyone therefore scores on the same clean curve — a personal fate event
 * must never move a shared ladder. Solo, it applies.
 */
function activeScoreMul(): number {
  if (!run || !soloRules()) return 1;
  return run.fateScoreMul;
}

/**
 * Boot sequence — the ONLY place main.ts is allowed to await.
 *
 * Vite dev tolerates top-level await; the production bundle does not. The
 * built app used to stall forever at module scope with an empty #app, no
 * <canvas> and no thrown error, because one of these awaits never settled.
 * Everything that must wait therefore lives in here, invoked last with
 * `void boot();` — the shipped bundle now has ZERO top-level awaits.
 */
async function boot(): Promise<void> {
  await app.init({
    width: Math.max(1, Math.round(window.innerWidth)),
    height: Math.max(1, Math.round(window.innerHeight)),
    background: T.bg, antialias: true,
    resolution: Math.min(3, window.devicePixelRatio || 1),
    autoDensity: true,
  });
  document.getElementById('app')!.appendChild(app.canvas);
  app.stage.addChild(bleedHolder, view);

  window.addEventListener('resize', fit);
  fit();

  /* Dev-only browser-driver surface (gauntlet gate G4). Stripped from builds.
   * Installed AFTER init on purpose: installQaHooks captures app.canvas at
   * install time, and the canvas only exists once the renderer is up. */
  if (isDevBuild()) {
    installQaHooks({
      app,
      view,
      snapshot: () => {
        const st = lms?.state() ?? null;
        return {
          depth: run?.depth ?? 0,
          score: run?.score ?? 0,
          hp: run?.hp ?? 0,
          role: mpRole,
          table: st ? st.table.map((r) => r.name + ':' + r.pts) : null,
          mods: [...activeMods],
          seed: run?.seed ?? 0,
          phases: st ? { ...st.phases } : null,
          over: st?.over ?? false,
          winner: st?.winnerUid ?? null,
        };
      },
    });
  }

  /* Bake Text glyphs with the real Oxanium face: wait for the webfont (capped
   * at 1.5s so a slow CDN never blanks the boot) before the first scene builds. */
  await Promise.race([
    whenFontsReady(),
    new Promise<void>((res) => setTimeout(res, 1500)),
  ]);
  toLanding();
}

void boot();
