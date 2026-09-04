export {}; // module marker: top-level await below needs it

/**
 * selftest-audio.ts — node harness for the v2 audio core + beds director.
 *
 * Installs a RECORDING stub AudioContext BEFORE the modules load: audio.ts
 * captures the muted pref and AudioContext ctor at module-init time, and
 * beds.ts registers an onAudioReady callback at import time — so static
 * imports would observe the wrong world. These awaited imports ARE the
 * documented loading-boundary under test.
 *
 * Asserts (acceptance criteria):
 *   1. mute gate: IQB_MUTED at init -> master pinned at 0 AND sfx()
 *      schedules zero voices (double zero-output guarantee).
 *   2. all 10 SFX names play; every scheduled voice ends <= 900 ms.
 *   3. scream throttles for 6 s.
 *   4. cycling alignments builds exactly 4 beds; each switch schedules
 *      linear crossfade ramps landing ~2 s after the call.
 *   5. the director's lookahead pass schedules bed voices (heartbeats).
 *   6. setLayer maps depth -> dread lowpass brightness; 0 silences it.
 *   7. volume pref: IQB_VOL defaults to 0.5 (master = MASTER_CAP * 0.5),
 *      setVolume clamps 0..1 + persists, mute stays independent of the
 *      slider (muted -> 0 whatever the slider says), the 400 ms poll picks
 *      up an external IQB_VOL write, and a fresh read of a persisted value
 *      round-trips.
 *
 * Run from v2/:
 *   node --experimental-strip-types src/audio/selftest-audio.ts
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
const bedsMod = await import('./beds.ts');

const fails: string[] = [];
function ck(cond: boolean, msg: string): void {
  if (!cond) fails.push(msg);
}

/** Sources created after the given snapshot length was taken. */
function since(markLen: number): FakeSrc[] { return rec.sources.slice(markLen); }

function findMasterGain(): (FakeNode & { gain: FakeParam }) | null {
  return rec.gains.length > 0 ? rec.gains[0] : null;
}

/** All linear-ramp end times ever recorded, across every parameter. */
function linRampTimes(): number[] {
  const out: number[] = [];
  for (const g of rec.gains) {
    for (const e of g.gain.events) if (e.m === 'lin') out.push(e.t);
  }
  return out;
}

function approx(a: number, b: number, eps: number): boolean {
  return Math.abs(a - b) <= eps;
}

/* ------------- 1 — mute gate at init (zero output) ---------------- */

store.set('IQB_MUTED', 'true');
ck(audio.initAudio() === true, 'initAudio should succeed against the stub');
const master = findMasterGain();
ck(master !== null, 'master gain node exists');
if (master) {
  ck(master.gain.value === 0, `muted-at-init -> master.gain.value 0 (got ${master.gain.value})`);
}
const srcBefore = rec.sources.length;
ck(audio.sfx('click') === false, 'muted -> sfx rejected');
ck(rec.sources.length === srcBefore, 'muted -> ZERO voices scheduled');

/* ---------------------- unmute restores output -------------------- */

audio.setMuted(false);
ck(store.get('IQB_MUTED') === 'false', 'setMuted(false) persists IQB_MUTED=false');
/* No IQB_VOL was ever written, so the unmute target is the shipped default:
 * half the cap. Asserting the exact product keeps "half the volume" honest. */
ck(audio.getVolume() === audio.VOLUME_DEFAULT && audio.VOLUME_DEFAULT === 0.5,
  `default volume is 0.5 (got ${audio.getVolume()})`);
if (master) {
  const want = audio.MASTER_CAP * 0.5;
  const tgts = master.gain.events.filter((e) => e.m === 'tgt' && approx(e.v, want, 1e-12));
  ck(tgts.length > 0, `unmute targets master toward MASTER_CAP * 0.5 = ${want}`);
  const overCap = master.gain.events.some((e) => e.v > audio.MASTER_CAP + 1e-12);
  ck(!overCap, 'master never targeted above MASTER_CAP');
}

/* --------------- 2 — every SFX name, <= 900 ms -------------------- */

fakeNow += 1;
for (const name of audio.SFX_NAMES as readonly string[]) {
  const mk = rec.sources.length;
  const okPlay = audio.sfx(name as never) === true;
  ck(okPlay, `${name} should schedule`);
  const made = since(mk);
  if (made.length === 0) { fails.push(`${name} scheduled no voices`); continue; }
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of made) {
    if (s.started != null) lo = Math.min(lo, s.started);
    if (s.stopped != null) hi = Math.max(hi, s.stopped);
  }
  const dur = hi - lo;
  ck(dur <= 0.9001, `${name} voice <= 900 ms (got ${dur.toFixed(3)}s)`);
  fakeNow += 0.05;
}

/* --------------------- 3 — scream 6 s throttle -------------------- */

fakeNow += 6.5;
ck(audio.sfx('scream') === true, 'scream accepted after >= 6 s gap');
ck(audio.sfx('scream') === false, 'immediate second scream throttled');
fakeNow += 1.0;
ck(audio.sfx('scream') === false, 'scream still throttled inside the 6 s window');
fakeNow += 5.2; // cumulative 6.2 s since the accepted play
ck(audio.sfx('scream') === true, 'scream accepted once the window elapsed');

/* -------------- 4 — four beds + 2 s crossfades -------------------- */

for (const a of ['bad', 'good', 'chaotic', 'neutral'] as const) {
  fakeNow += 0.3;
  const T = fakeNow;
  ck(bedsMod.setAlignment(a) === true, `setAlignment(${a}) accepted`);
  const st = bedsMod.bedStates();
  ck(st.current === a, `current alignment is ${a}`);
  if (st.built.length < 4) continue;
  const landed = linRampTimes().some((t) => t >= T + 1.9 && t <= T + 2.15);
  ck(landed, `crossfade for ${a} lands ~2 s after the call`);
}
{
  const st = bedsMod.bedStates();
  ck(st.built.length === 4, `all 4 beds built (got [${st.built.join(',')}])`);
}

/* --------- 5 — director lookahead emits heartbeat voices ---------- */

{
  fakeNow += 0.4;
  bedsMod.setAlignment('bad');
  const before = rec.sources.length;
  for (let i = 0; i < 10; i++) {
    fakeNow += 0.12; // one TICK_MS slice
    bedsMod.schedulerPass();
  }
  ck(rec.sources.length > before, 'bad-bed scheduler passes schedule thump voices');
}

/* --------------- 6 — dread drone layer mapping -------------------- */

{
  bedsMod.setLayer(4);
  const mid = lastDreadFreqTarget();
  ck(mid != null && mid > 300 && mid < 900, `layer 4 -> mid brightness (got ${mid})`);

  bedsMod.setLayer(7);
  const hot = lastDreadFreqTarget();
  ck(hot != null && hot > 1500, `layer 7 -> max brightness (got ${hot})`);

  bedsMod.setLayer(0);
  const off = dreadGainLastTarget();
  ck(off != null && approx(off, 0.0001, 1e-9), `layer 0 silences dread (got ${off})`);
}

function lastDreadFreqTarget(): number | null {
  // The dread lowpass is the ONLY filter whose frequency receives tgt events.
  const cands = rec.biquads.filter((b) => b.frequency.events.some((e) => e.m === 'tgt'));
  const last = cands[cands.length - 1];
  if (!last) return null;
  const tgts = last.frequency.events.filter((e) => e.m === 'tgt');
  return tgts[tgts.length - 1]?.v ?? null;
}

function dreadGainLastTarget(): number | null {
  // Dread gain = the gain bus whose tgt history includes the layer-4 level
  // (0.09 + 0.012 * 3). Float-safe match.
  const target = 0.09 + 0.012 * 3;
  const cands = rec.gains.filter((g) =>
    g.gain.events.some((e) => e.m === 'tgt' && approx(e.v, target, 1e-9)));
  const last = cands[cands.length - 1];
  if (!last) return null;
  const tgts = last.gain.events.filter((e) => e.m === 'tgt');
  return tgts[tgts.length - 1]?.v ?? null;
}

/* -------------------------- stings -------------------------------- */

{
  const before = rec.sources.length;
  ck(bedsMod.sting('pain') === true, 'sting(pain) plays');
  fakeNow += 0.3; // clear the sting anti-spam window between the two
  ck(bedsMod.sting('heal') === true, 'sting(heal) plays');
  ck(rec.sources.length > before, 'stings schedule voices');
}

/* ------------- 7 — volume preference (IQB_VOL) -------------------- */

function lastMasterTarget(): number | null {
  const m = findMasterGain();
  if (!m) return null;
  const tgts = m.gain.events.filter((e) => e.m === 'tgt');
  return tgts.length ? tgts[tgts.length - 1].v : null;
}

{
  let notified = 0;
  const unsub = audio.onAudioPrefChange(() => { notified++; });

  // setVolume scales the cap, persists, ramps (tgt event, never a bare set)
  audio.setVolume(0.8);
  ck(audio.getVolume() === 0.8, 'setVolume(0.8) -> getVolume 0.8');
  ck(store.get('IQB_VOL') === '0.8', `setVolume persists IQB_VOL=0.8 (got ${store.get('IQB_VOL')})`);
  ck(approx(lastMasterTarget() ?? -1, audio.MASTER_CAP * 0.8, 1e-12),
    `setVolume(0.8) ramps master toward CAP*0.8 (got ${lastMasterTarget()})`);
  ck(notified === 1, `setVolume notifies pref listeners once (got ${notified})`);

  // clamping: above 1 pins to the cap, below 0 pins to silence, NaN -> default
  audio.setVolume(7);
  ck(audio.getVolume() === 1, `setVolume(7) clamps to 1 (got ${audio.getVolume()})`);
  ck(approx(lastMasterTarget() ?? -1, audio.MASTER_CAP, 1e-12), 'volume 1 -> master exactly MASTER_CAP, never above');
  audio.setVolume(-3);
  ck(audio.getVolume() === 0, `setVolume(-3) clamps to 0 (got ${audio.getVolume()})`);
  ck(lastMasterTarget() === 0, 'volume 0 -> master target 0');
  audio.setVolume(Number.NaN);
  ck(audio.getVolume() === audio.VOLUME_DEFAULT, `setVolume(NaN) falls back to the default (got ${audio.getVolume()})`);

  // mute independence: muted -> 0 regardless of slider; unmute -> slider level
  audio.setVolume(0.6);
  audio.setMuted(true);
  ck(lastMasterTarget() === 0, 'muted with slider at 0.6 -> master 0');
  ck(audio.getVolume() === 0.6, 'mute does not touch the volume pref');
  audio.setVolume(0.9);
  ck(lastMasterTarget() === 0, 'moving the slider while muted keeps master at 0');
  ck(store.get('IQB_VOL') === '0.9', 'slider move while muted still persists');
  audio.setMuted(false);
  ck(approx(lastMasterTarget() ?? -1, audio.MASTER_CAP * 0.9, 1e-12),
    `unmute lands on CAP * slider (got ${lastMasterTarget()})`);

  // persistence round-trip: an external write is picked up by the 400 ms poll
  const seen = notified;
  store.set('IQB_VOL', '0.25');
  await new Promise<void>((res) => setTimeout(res, 520));
  ck(audio.getVolume() === 0.25, `poll picks up external IQB_VOL=0.25 (got ${audio.getVolume()})`);
  ck(approx(lastMasterTarget() ?? -1, audio.MASTER_CAP * 0.25, 1e-12), 'poll ramps master to CAP*0.25');
  ck(notified > seen, 'poll-detected change notifies pref listeners');
  store.set('IQB_VOL', 'garbage');
  await new Promise<void>((res) => setTimeout(res, 520));
  ck(audio.getVolume() === audio.VOLUME_DEFAULT, `unparsable IQB_VOL reads as the default (got ${audio.getVolume()})`);

  unsub();
  const afterUnsub = notified;
  audio.setVolume(0.5);
  ck(notified === afterUnsub, 'unsubscribed listener no longer fires');
}

/* ---------------- cleanup + report -------------------------------- */

bedsMod.stopBedClocks();
audio.stopAudioClocks();

if (fails.length === 0) {
  console.log('[audio-selftest] ALL PASS');
} else {
  console.error(`[audio-selftest] ${fails.length} FAILURE(S):`);
  for (const f of fails) console.error(`  - ${f}`);
}
process.exitCode = fails.length === 0 ? 0 : 1;
