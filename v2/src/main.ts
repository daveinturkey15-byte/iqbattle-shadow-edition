import { Application, Container, Text } from 'pixi.js';
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
import { playReveal } from './fx/reveal.ts';
import { goalCardForIndex, maybeShowLegend, resetLegendRun } from './meta/onboard.ts';
import { MPHost, MPJoin, setActiveSession, wireMain, parseStg, roundPlan, hueIndexForDepth, type MpSession, type MpEvent, type RoundPlan } from './scenes/mp.ts';
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
const app = new Application();
await app.init({
  width: Math.max(1, Math.round(window.innerWidth)),
  height: Math.max(1, Math.round(window.innerHeight)),
  background: T.bg, antialias: true,
  resolution: Math.min(3, window.devicePixelRatio || 1),
  autoDensity: true,
});
document.getElementById('app')!.appendChild(app.canvas);

/** Screen-space layer carrying world backdrop art on >16:9 aspect (full-bleed sides). */
const bleedHolder = new Container();
/** Logical 1600x900 world; every scene mounts here and fit() scales + centers it. */
const view = new Container();
app.stage.addChild(bleedHolder, view);

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
window.addEventListener('resize', fit);
fit();

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
  if (!run) startRun(myName, 'Room', e.timerLen, sd);
  run!.seed = sd; /* clients derive every board from the HOST's seed */
  const r0 = run!;
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
let shell: Shell | null = null;
let lastLayer = 0;

function startRun(name: string, roomName: string, timerLen: number, seed?: number): void {
  seed = (seed ?? ((Date.now() & 0xffff) ^ (Math.floor(Math.random() * 0xffff) + 1))) >>> 0;
  run = { name, roomName, timerLen, seed, plan: planArc(seed, 2000), depth: 1, depthStartedAt: performance.now(), hp: 100, score: 0, streak: 0, prevAlign: null, emeralds: [], lastTakeover: -99, prevSanctuary: false, fateScoreMul: 1, curKind: 'puzzle', curAnswer: -1 };
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
  const plan = r.plan[r.depth - 1];
  r.fateScoreMul = 1; /* curses last exactly one depth */
  const root = new Container();
  /* Banners, curse lines and toasts are emitted BEFORE the board is built,
   * so they used to be painted under it — the sidebar panel sliced the layer
   * banner in half mid-sentence (owner, 2026-08-26: "issues with text having
   * other things over it or in front"). They now go into an overlay that is
   * parented LAST, so nothing can ever cover them again. */
  const overlay = new Container();

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
      if (cm.bannerText) toastNow(overlay, cm.bannerText, T.gold);
    }
  } catch { /* fate optional */ }

  /* Resolve the round shape FIRST: the atmosphere layer needs to know
   * whether a chaos header is about to claim the banner row. */
  const rp = roundPlan(r.seed, r.depth, ALL_FAMILIES.length, TAKEOVERS.length, (d) =>
    plan.align !== 'good' && d >= 4 && d - r.lastTakeover >= 3 && ((r.seed ^ Math.imul(d, 2654435761)) >>> 0) % 100 < 42);
  const chaosRound = (remote ? remote.rp.kind : rp.kind) === 'takeover';

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
    if (fa && fa.bannerText) toastNow(overlay, fa.bannerText, T.gold);
    const fb = maybeFlavorB({ depth: r.depth, align: plan.align, rng: mulberry((r.seed ^ Math.imul(r.depth, 0xFB2B3 % 65536)) >>> 0), hp: r.hp, seed: r.seed });
    if (fb && fb.bannerText) toastNow(overlay, fb.bannerText, T.muted);
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
       * have swept the whole table for a depth nobody could answer). */
      stopTick();
      shell.setTimer(1, fmtClock(r.timerLen));
      const pickRoot = buildInterlude(offers, (id) => {
        r.emeralds.push(id);
        toastNow(root, 'THE ' + id.toUpperCase().replace('_', ' ') + ' IS YOURS', T.gold);
        sfx('levelup');
        try { onEmerald(); } catch {}
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
    if (fate.bannerText) toastNow(overlay, fate.bannerText, T.gold);
    if (typeof fate.timerDelta === 'number' && fate.timerDelta < 0) r.hp -= 0; // timer handled per-scene
  }

  if (!remote && mp && mpRole === 'host') mp.round(r.depth, rp.kind === 'takeover' ? 'tk:' + rp.index : 'pz:' + rp.index, rp.seed, r.timerLen);
  /* A client with no round frame yet shows the chrome and waits. */
  if (mpRole === 'client' && !remote) { r.curKind = 'puzzle'; r.curAnswer = -1; root.addChild(overlay); startTick(root); show(root); return; }
  const useRp = remote ? remote.rp : rp;
  const useSeed = remote ? remote.seed : rp.seed;
  r.curKind = useRp.kind;
  r.curAnswer = -1;
  if (useRp.kind === 'takeover') { r.lastTakeover = r.depth; setPresence('hidden'); dealTakeover(root, useRp.index, useSeed, overlay); }
  else dealPuzzle(root, useRp.index, useSeed, r.depth);
  root.addChild(overlay); /* banners on top of the board, always */
  startTick(root);
  show(root);
}

/* ONE tick for the whole run — per-deal intervals accumulated into ghost
 * storms (BugSweep BUG 1/3/4/5). The tick self-cancels when the run dies. */
let tickId: ReturnType<typeof setInterval> | null = null;
function stopTick(): void { if (tickId !== null) { clearInterval(tickId); tickId = null; } }
function startTick(root: Container): void {
  stopTick();
  const r = run!;
  tickId = setInterval(() => {
    if (run !== r) { stopTick(); return; }
    const left = Math.max(0, r.timerLen - (performance.now() - r.depthStartedAt) / 1000);
    shell?.setTimer(left / r.timerLen, fmtClock(Math.ceil(left)));
    if (left <= 0) {
      stopTick();
      if (lms && mp) {
        /* MP: the host owns the clock. It punishes every seat that never
         * answered and closes the depth; clients just stop and wait for the
         * reveal so two screens can never disagree about who timed out. */
        r.streak = 0;
        toastNow(root, 'TIME DROWNED YOU', T.bad);
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

function dealPuzzle(root: Container, famIdx: number, planSeed: number, depth: number): void {
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

/* Dev-only browser-driver surface (gauntlet gate G4). Stripped from builds. */
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
