export {}; // module marker: top-level await below needs it

/**
 * selftest-director.ts — node harness for the v2 audio extension pack
 * (sfx2.ts) and the act-reactive director (director.ts).
 *
 * Runs against recording WebAudio fakes (same harness shape as
 * selftest-audio.ts): every createGain/createOscillator/start/stop and every
 * param automation event is recorded, so the checks are behavioural:
 *
 *   1. mute gate at init — reveal/stinger requests schedule NOTHING;
 *      emerald fanfare rejected; crackle bus stays down.
 *   2. jingle shapes — win arpeggio (streak-scaled rate), lose crush fall,
 *      emerald fanfare; per-name throttle windows; <= 900 ms voices.
 *   3. act ramps 0..3 — layer bus rebuilt per act with crossfade ramps,
 *      idempotent repeat calls rejected, out-of-range clamped.
 *   4. corruption stingers under manual scheduler passes — glitch cascades
 *      fire during act >= 2 with >= 2.5 s spacing; demon chatter bursts only
 *      at act 3 within the 1-burst-per-8-s budget; ember crackle loop gated
 *      by IQB_MOTION.
 *   5. hp threshold rail — arms exactly once per crossing below 25, silent
 *      re-reports are no-ops, recovery re-arms; beat rate accelerates as hp
 *      falls; no beats above threshold.
 *
 * The scheduler interval is STOPPED for the whole run; timing is driven by
 * manually advancing fakeNow and calling directorPass(), so the assertions
 * are fully deterministic.
 * ========================================================================*/

/* ------------------------- recording fakes ------------------------ */

let fakeNow = 0; // seconds — backs ctx.currentTime

interface Ev { m: string; v: number; t: number }

class FakeParam {
  events: Ev[] = [];
  val: number;
  constructor(v: number) { this.val = v; }
  get value(): number { return this.val; }
  set value(x: number) { this.val = x; }
  setValueAtTime(v: number, t: number): void { this.events.push({ m: 'set', v, t }); this.val = v; }
  exponentialRampToValueAtTime(v: number, t: number): void { this.events.push({ m: 'exp', v, t }); }
  linearRampToValueAtTime(v: number, t: number): void { this.events.push({ m: 'lin', v, t }); }
  setTargetAtTime(v: number, t: number, _tc: number): void { this.events.push({ m: 'tgt', v, t }); }
  cancelScheduledValues(_t: number): void { /* noop */ }
}

interface Rec {
  sources: FakeSrc[];
  gains: Array<FakeNode & { gain: FakeParam }>;
  biquads: FakeBiquad[];
}

class FakeNode {
  connect(_d: unknown): unknown { return _d; }
  disconnect(): void { /* noop */ }
}

class FakeSrc extends FakeNode {
  type = 'sine';
  frequency = new FakeParam(440);
  detune = new FakeParam(0);
  buffer: unknown = null;
  loop = false;
  started: number | null = null;
  stopped: number | null = null;
  start(t?: number): void { this.started = t ?? fakeNow; rec.sources.push(this); }
  stop(t?: number): void { this.stopped = t ?? fakeNow; }
}

class FakeBiquad extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
}

class FakeShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample = 'none';
}

class FakeBuffer {
  length: number;
  sampleRate: number;
  constructor(len: number, sr: number) { this.length = len; this.sampleRate = sr; }
  getChannelData(): Float32Array { return new Float32Array(this.length); }
}

const rec: Rec = { sources: [], gains: [], biquads: [] };

class FakeCtx {
  destination = new FakeNode();
  state = 'running';
  resume = async (): Promise<void> => { this.state = 'running'; };
  get currentTime(): number { return fakeNow; }
  createGain(): FakeNode & { gain: FakeParam } {
    const n = new FakeNode() as FakeNode & { gain: FakeParam };
    n.gain = new FakeParam(1);
    rec.gains.push(n);
    return n;
  }
  createOscillator(): FakeSrc { return new FakeSrc(); }
  createBufferSource(): FakeSrc { return new FakeSrc(); }
  createBiquadFilter(): FakeBiquad { const b = new FakeBiquad(); rec.biquads.push(b); return b; }
  createWaveShaper(): FakeShaper { return new FakeShaper(); }
  createBuffer(_ch: number, len: number, sr: number): FakeBuffer { return new FakeBuffer(len, sr); }
}

// Minimal Storage so pref reads/writes work under node.
const store = new Map<string, string>();
const fakeStorage: Storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (_i: number) => null,
  length: 0,
};

// Test-only global injection: the modules under test read these globals,
// and the DOM lib types them as the real browser things.
const glb = globalThis as Record<string, unknown>;
glb.localStorage = fakeStorage;
glb.AudioContext = FakeCtx;

/* --------------------- load modules under test -------------------- */

const audio = await import('./audio.ts');
const sfx2 = await import('./sfx2.ts');
const director = await import('./director.ts');

const fails: string[] = [];
function ck(cond: boolean, msg: string): void {
  if (!cond) fails.push(msg);
}

function approx(a: number, b: number, eps: number): boolean {
  return Math.abs(a - b) <= eps;
}

/** Sources created after the given snapshot length was taken. */
function since(markLen: number): FakeSrc[] { return rec.sources.slice(markLen); }

/** New oscillators of a given wave type among the given sources. */
function oscillators(srcs: FakeSrc[], type: string): FakeSrc[] {
  return srcs.filter((s) => s.buffer === null && s.type === type);
}

/** True when every finite source in srcs stops within limit seconds. */
function allWithinLimit(srcs: FakeSrc[], limit: number): boolean {
  return srcs.every((s) => s.loop || (s.started != null && s.stopped != null && s.stopped - s.started <= limit));
}

/**
 * Drive the director manually: advance fakeNow in small steps, calling one
 * scheduler pass each step, and classify what each pass produced. Returns
 * cascade/chatter burst counts and their start times.
 */
interface BurstReport { cascades: number; chatters: number; cascadeTimes: number[]; chatterTimes: number[] }

function drive(seconds: number, step: number): BurstReport {
  const rep: BurstReport = { cascades: 0, chatters: 0, cascadeTimes: [], chatterTimes: [] };
  const end = fakeNow + seconds;
  while (fakeNow < end) {
    fakeNow += step;
    const mark = rec.sources.length;
    director.directorPass();
    const news = since(mark).filter((s) => s.type === 'square' && s.buffer === null);
    if (news.length >= 6) {
      rep.cascades++;
      rep.cascadeTimes.push(news[0].started ?? fakeNow);
    } else if (news.length === 3 && news.every((s) => s.frequency.value < 200)) {
      rep.chatters++;
      rep.chatterTimes.push(news[0].started ?? fakeNow);
    }
  }
  return rep;
}

/** Unique heartbeat thump times among sources recorded after `mark`. */
function heartBeats(mark: number): number[] {
  const beats = new Set<number>();
  for (const s of since(mark)) {
    if (s.type === 'sine' && s.buffer === null && s.frequency != null
      && Math.abs(s.frequency.value - 65) < 1 && s.started != null) {
      beats.add(Math.round(s.started * 100) / 100);
    }
  }
  return [...beats].sort((a, b) => a - b);
}

/* ------------- setup: init muted, freeze the live clock ----------- */

store.set('IQB_MUTED', 'true');
director.initDirector();
ck(audio.initAudio() === true, 'initAudio should succeed against the stub');
director.stopDirectorClocks(); // all timing below is manual directorPass()

const master = rec.gains.length > 0 ? rec.gains[0] : null;
ck(master !== null, 'master gain node exists');

/* -------- 1 — mute gate: reveals and stingers schedule nothing ---- */

ck(director.onAct(2) === true, 'onAct(2) accepted (choice remembered)');
ck(director.directorSnapshot().builtAct === 2, 'act layer applied even while muted (master sits at 0)');
ck(director.directorSnapshot().crackle === false, 'ember crackle stays down while muted');

const before = rec.sources.length;
ck(director.onReveal(true, 0) === false, 'muted -> win jingle rejected');
ck(director.onReveal(false, 0) === false, 'muted -> lose sting rejected');
ck(director.onEmerald() === false, 'muted -> emerald fanfare rejected');
ck(rec.sources.length === before, 'muted -> ZERO voices scheduled');
director.stopDirectorClocks();

/* ---------------------- 2 — unmute restores output ---------------- */

audio.setMuted(false);
const capEvents = master ? master.gain.events.filter((e) => e.m === 'tgt' && e.v === 0.15) : [];
ck(capEvents.length > 0, 'unmute ramps master toward MASTER_CAP 0.15');
if (master) ck(master.gain.value === 0.15 || capEvents.length > 0, 'master cap target is 0.15');

fakeNow += 1;
{
  const mark = rec.sources.length;
  ck(director.onReveal(true, 0) === true, 'win jingle plays when unmuted');
  const tri = oscillators(since(mark), 'triangle');
  ck(tri.length === 4, `win jingle = 4 arpeggio notes (got ${tri.length})`);
  const freqs = tri.map((o) => o.frequency.value).sort((a, b) => a - b);
  ck(JSON.stringify(freqs) === JSON.stringify([523.25, 659.25, 783.99, 1046.5]),
    'win arpeggio is C5-E5-G5-C6');
  ck(allWithinLimit(since(mark), 0.9), 'win jingle voices all <= 900 ms');
}

fakeNow += 1;
{
  const mark = rec.sources.length;
  ck(director.onReveal(true, 5) === true, 'streak-5 win jingle accepted after gap');
  // streak raises rate 1 + 5*0.05 = 1.25 -> note spacing shrinks from 90 ms
  const tri = oscillators(since(mark), 'triangle').sort((a, b) => (a.started ?? 0) - (b.started ?? 0));
  const spread = (tri[tri.length - 1].started ?? 0) - (tri[0].started ?? 0);
  ck(spread < 0.27 && spread > 0.15, `streak scales jingle rate (note spread ${spread.toFixed(3)} s)`);
}

fakeNow += 1;
{
  const mark = rec.sources.length;
  ck(director.onReveal(false, 0) === true, 'lose sting plays on wrong reveal');
  const saws = oscillators(since(mark), 'sawtooth');
  ck(saws.length === 2, `lose sting = falling saw pair (got ${saws.length})`);
  const falling = saws.every((s) => s.frequency.events.some((e) => e.m === 'exp' && e.v < s.frequency.value));
  ck(falling, 'lose saws pitch DOWN through the reveal');
  ck(allWithinLimit(since(mark), 0.9), 'lose sting voices all <= 900 ms');
}

fakeNow += 2;
{
  const mark = rec.sources.length;
  ck(director.onEmerald() === true, 'emerald fanfare plays');
  const oscs = since(mark).filter((s) => s.buffer === null);
  ck(oscs.length >= 7, `fanfare = stacked octave pair x3 + sparkle (got ${oscs.length})`);
  ck(allWithinLimit(since(mark), 0.9), 'fanfare voices all <= 900 ms');
  ck(director.onEmerald() === false, 'fanfare throttled inside its 1.2 s window');
}

/* -------------- 3 — act ramps: rebuild + crossfade ramps ---------- */

ck(director.onAct(3) === true, 'onAct(3) accepted');
ck(director.directorSnapshot().builtAct === 3, 'act 3 layer sounding');
ck(director.onAct(3) === false, 'repeat onAct(3) is a no-op');
{
  const mark = rec.sources.length;
  director.onAct(1);
  const news = since(mark);
  ck(director.directorSnapshot().builtAct === 1, 'act 1 layer swapped in');
  const oscs = news.filter((s) => s.buffer === null);
  ck(oscs.length === 3, `act 1 = hum pair + pulse LFO (got ${oscs.length})`);
  ck(oscs.filter((s) => s.frequency.value > 50).length === 2, 'act 1 hum = two detuned sines');
  ck(oscs.some((s) => s.frequency.value <= 0.5), 'act 1 carries the slow pulse LFO');
  const fadeTargets = rec.gains
    .flatMap((g) => g.gain.events)
    .filter((e) => e.m === 'lin' && approx(e.v, 0.18, 1e-9));
  ck(fadeTargets.length > 0, `act 1 bus fades up to its gain tier (0.18), got ${fadeTargets.length} ramps`);
}
ck(director.onAct(99) === true && director.directorSnapshot().wantAct === 3, 'out-of-range acts clamp to 3');

/* ---- 4 — corruption stingers: cascades, chatter budget, crackle --- */

// act is 3 here: both stinger families are eligible. Drive 30 s manually.
{
  const crackleBefore = director.directorSnapshot().crackle;
  ck(crackleBefore, 'ember crackle loop runs at act >= 2 with motion enabled');
  const loopSrcs = rec.sources.filter((s) => s.loop);
  ck(loopSrcs.length >= 2, `crackle + bed loops present (got ${loopSrcs.length})`);

  const rep = drive(30, 0.15);
  ck(rep.cascades >= 2, `glitch cascades fire during act 3 (got ${rep.cascades} in 30 s)`);
  let spaced = true;
  for (let i = 1; i < rep.cascadeTimes.length; i++) {
    if (rep.cascadeTimes[i] - rep.cascadeTimes[i - 1] < 2.4) spaced = false;
  }
  ck(spaced, `cascade spacing respects the 2.5 s gap (${JSON.stringify(rep.cascadeTimes)})`);
  ck(rep.chatters >= 1, `demon chatter bursts fire at act 3 (got ${rep.chatters})`);
  const budgetOk = rep.chatters <= Math.floor(30 / 8) + 1;
  ck(budgetOk, `chatter respects the 1-burst-per-8-s budget (got ${rep.chatters})`);

  // Drop to act 1: crackle tears down, chatter family goes dark.
  director.onAct(1);
  ck(director.directorSnapshot().crackle === false, 'ember crackle stops below act 2');
  const quiet = drive(10, 0.15);
  ck(quiet.cascades === 0 && quiet.chatters === 0, 'no corruption stingers below act 2');
}

// Motion gate: crackle must refuse to run with IQB_MOTION off.
{
  store.set('IQB_MOTION', 'false');
  director.onAct(3);
  ck(director.directorSnapshot().crackle === false, 'IQB_MOTION=false keeps the crackle loop down');
  store.set('IQB_MOTION', 'true');
  director.onAct(2);
  director.onAct(3);
  ck(director.directorSnapshot().crackle === true, 're-enabling motion restores crackle at act >= 2');
}

/* --------- 5 — hp threshold: once-per-crossing + acceleration ----- */

{
  ck(director.onHpThreshold(50) === false, 'above threshold: no trigger');
  ck(director.directorSnapshot().hpLow === false, 'rail unarmed above 25');
  const mark0 = rec.sources.length;
  drive(1, 0.05);
  ck(heartBeats(mark0).length === 0, 'no accelerated heartbeats above threshold');

  ck(director.onHpThreshold(20) === true, 'crossing BELOW 25 triggers exactly once');
  ck(director.onHpThreshold(20) === false, 'staying low: no second trigger');
  ck(director.onHpThreshold(10) === false, 'still low: still no trigger');

  // hp 10 -> beat interval ~0.663 s; drive 3 s and count thumps.
  const slowMark = rec.sources.length;
  drive(3, 0.05);
  const slowBeats = heartBeats(slowMark);
  ck(slowBeats.length >= 3 && slowBeats.length <= 6,
    `accelerated heartbeat cadence at hp 10 (got ${slowBeats.length} beats / 3 s)`);

  // Recovery re-arms silently; next crossing fires again.
  ck(director.onHpThreshold(80) === false, 'recovery crossing up: no trigger');
  ck(director.directorSnapshot().hpLow === false, 'rail re-armed above 25');
  const stillMark = rec.sources.length;
  drive(1, 0.05);
  ck(heartBeats(stillMark).length === 0, 'heartbeats stop after recovery');

  ck(director.onHpThreshold(2) === true, 'second crossing triggers again (once-per-crossing)');

  // hp 2 -> interval ~0.437 s; must clearly outpace the hp-10 cadence.
  const fastMark = rec.sources.length;
  drive(3, 0.05);
  const fastBeats = heartBeats(fastMark);
  ck(fastBeats.length > slowBeats.length,
    `heartbeat ACCELERATES as hp falls (fast ${fastBeats.length} > slow ${slowBeats.length} beats / 3 s)`);

  // Mute closes the whole director.
  audio.setMuted(true);
  const mutedMark = rec.sources.length;
  drive(1, 0.05);
  ck(rec.sources.length === mutedMark, 'muted -> scheduler schedules nothing');
  ck(director.directorSnapshot().crackle === false, 'muted -> crackle torn down');
  audio.setMuted(false);
}

/* ---------------- cleanup + report -------------------------------- */

director.stopDirectorClocks();
audio.stopAudioClocks();

if (fails.length === 0) {
  console.log('[director-selftest] ALL PASS');
} else {
  console.log(`[director-selftest] ${fails.length} FAILURE(S):`);
  for (const f of fails) console.log('  - ' + f);
}
process.exitCode = fails.length === 0 ? 0 : 1;
