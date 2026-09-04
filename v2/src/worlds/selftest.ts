/* ============================================================================
 * selftest-worlds.ts — node harness for src/worlds/registry.ts + backdrops.ts.
 *
 *   cd v2 && node src/worlds/selftest.ts     (exit 0 = PASS)
 *
 * Acceptance criteria (wave-2 Worlds/Breadth ticket):
 *   1. registry: exactly 12 worlds, unique ids.
 *   2. align coverage: bad / chaotic / neutral / good each have >= 2.
 *   3. all 12 draw() run on a RECORDING STUB ctx at t = 0, 1000, 10000
 *      without throwing and issue a non-empty op stream.
 *   4. determinism: same world + same t => byte-identical call/property-op
 *      sequence across two independent runs; different t => differs
 *      (proves f(t), catches accidental time-independence).
 *   5. pick(align, rng) consumes EXACTLY ONE variate and is seed-reproducible;
 *      unknown align throws.
 *   6. applyBackdrop returns an immediately-callable, idempotent cleanup even
 *      before the pixi dynamic import resolves (headless-safe).
 *
 * The stub ctx is a Proxy: every method call / property set is serialized into
 * an op string (numbers rounded to 1e-4) — that stream IS the determinism
 * fingerprint. No Math.random anywhere in the harness either.
 * ==========================================================================*/

import { list, pick, byId, ALIGNS, type Align } from './registry.ts';
import { applyBackdrop } from './backdrops.ts'; // side-effect: registers all 12 worlds

/* --------------------------- recording stub ctx -------------------------- */

function fmt(v: unknown): string {
  if (typeof v === 'number') return String(Math.round(v * 10000) / 10000);
  if (typeof v === 'string') return v;
  if (typeof v === 'function') return '<fn>';
  try {
    return JSON.stringify(v) ?? 'null';
  } catch {
    return '<unserializable>';
  }
}


/* The real CanvasRenderingContext2D surface a world may touch. Anything else
 * throws — see the note in the stub's get trap. */
const CTX_METHODS = new Set<string>([
  'save', 'restore', 'scale', 'rotate', 'translate', 'transform', 'setTransform', 'resetTransform',
  'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo',
  'bezierCurveTo', 'quadraticCurveTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect',
  'fill', 'stroke', 'clip', 'isPointInPath', 'createLinearGradient', 'createRadialGradient',
  'createConicGradient', 'measureText', 'fillText', 'strokeText', 'setLineDash', 'getLineDash',
  'ops',
]);

/* Readable/writable properties. Reading one a world never set is legal (a real
 * ctx has defaults), so the get trap returns the default rather than throwing;
 * only genuinely unknown names are a defect. */
const CTX_PROPS: Readonly<Record<string, unknown>> = {
  globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000000',
  strokeStyle: '#000000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
  miterLimit: 10, lineDashOffset: 0, font: '10px sans-serif', textAlign: 'start',
  textBaseline: 'alphabetic', direction: 'inherit', imageSmoothingEnabled: true,
  filter: 'none', shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)', shadowOffsetX: 0, shadowOffsetY: 0,
};

/* A colour built out of undefined/NaN parses as nothing on a real canvas and
 * throws. Catching it here is the whole point of the stub being strict. */
function assertColor(where: string, v: unknown): void {
  /* A gradient object is a perfectly legal fillStyle/strokeStyle — only a
   * STRING colour can be malformed, so only strings are checked here. */
  if (v !== null && typeof v === 'object' && 'addColorStop' in (v as object)) return;
  if (typeof v !== 'string') {
    throw new Error(`${where}: colour must be a string or gradient, got ${fmt(v)}`);
  }
  if (/undefined|NaN|null/.test(v)) {
    throw new Error(`${where}: unparseable colour "${v}"`);
  }
}

interface StubCtx { ops(): string[] }

/** Draw a world onto a fresh strict stub, turning any throw into a message. */
export function tryDraw(wd: { id: string; draw: (c: CanvasRenderingContext2D, w: number, h: number, t: number) => void }, t: number): { ok: true; ops: string[] } | { ok: false; why: string } {
  const ctx = makeStubCtx();
  try {
    wd.draw(ctx, 1600, 900, t);
    return { ok: true, ops: ctx.ops() };
  } catch (e) {
    return { ok: false, why: `${wd.id}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function makeStubCtx(): CanvasRenderingContext2D & StubCtx {
  const ops: string[] = [];
  const props = new Map<string, unknown>();
  return new Proxy({}, {
    get(_t, rawProp): unknown {
      const prop = String(rawProp);
      if (prop === 'ops') return (): string[] => ops;
      if (props.has(prop)) return props.get(prop);
      /* The stub used to answer to ANY property with a recording function, so
       * a world could call a method that does not exist on a real canvas — or
       * build a colour string out of undefined — and the gate would record it
       * happily and pass. Thirteen bulk-authored worlds shipped that way and
       * every one threw the moment a real CanvasRenderingContext2D saw them.
       * A stub that accepts more than the real thing is not a test. */
      if (prop in CTX_PROPS) return CTX_PROPS[prop];
      if (!CTX_METHODS.has(prop)) {
        throw new Error(`ctx.${prop} is not a CanvasRenderingContext2D member`);
      }
      return (...args: unknown[]): unknown => {
        ops.push(`m:${prop}(${args.map(fmt).join(',')})`);
        if (/Gradient$/.test(prop)) {
          return { addColorStop: (o: number, col: unknown): void => {
            assertColor(`addColorStop`, col);
            ops.push(`m:addColorStop(${fmt(o)},${fmt(col)})`);
          } };
        }
        return undefined;
      };
    },
    set(_t, rawProp, v): boolean {
      const prop = String(rawProp);
      if (prop === 'fillStyle' || prop === 'strokeStyle') assertColor(prop, v);
      if (prop === 'globalAlpha' && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)) {
        throw new Error(`globalAlpha set to ${fmt(v)}`);
      }
      props.set(prop, v);
      ops.push(`p:${prop}=${fmt(v)}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D & StubCtx;
}

function mulberry32(a: number): () => number {
  let s = a >>> 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/** mulberry32 that also counts how many variates were consumed. */
function countingRng(seed: number): { rng: () => number; consumed: () => number } {
  let calls = 0;
  const base = mulberry32(seed);
  return {
    rng: (): number => {
      calls++;
      return base();
    },
    consumed: (): number => calls,
  };
}

/* -------------------------------- checks --------------------------------- */

let failures = 0;

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) console.log('  ok  ' + name);
  else {
    failures++;
    console.error('FAIL  ' + name + (detail ? ' — ' + detail : ''));
  }
}

/* -------------------------------- suite ---------------------------------- */

console.log('== iqbattle v2 · worlds/backdrops self-test ==');

const all = list();
/* This asserted the literal 12 — a snapshot of the roster, which is the same
 * hardcoded-roster trap that has now bitten this project four times. What
 * matters is that the roster never shrinks and every alignment stays stocked. */
{
  const broken: string[] = [];
  for (const wd of list()) {
    for (const t of [0, 1000, 10000]) {
      const r = tryDraw(wd, t);
      if (!r.ok) { broken.push(r.why); break; }
    }
  }
  check('every world survives a real-shaped canvas ctx', broken.length === 0, broken.slice(0, 6).join(' | '));
}

check('roster has not shrunk below the P5 wave', all.length >= 34, `got ${all.length}`);
check('unique ids', new Set(all.map((d) => d.id)).size === all.length);

for (const a of ALIGNS as readonly Align[]) {
  const n = all.filter((d) => d.align === a).length;
  check(`align coverage ${a} >= 2`, n >= 2, `got ${n}`);
}

const TS = [0, 1000, 10000];
const fingerprints = new Map<string, string[]>();

let drewClean = true;
let detail = '';
for (const def of all) {
  for (const t of TS) {
    const ctx = makeStubCtx();
    try {
      def.draw(ctx, 1600, 900, t);
      const ops = ctx.ops();
      if (ops.length === 0) {
        drewClean = false;
        detail = `${def.id}@t=${t} produced zero calls`;
      }
      fingerprints.set(`${def.id}@${t}`, ops);
    } catch (e) {
      drewClean = false;
      detail = `${def.id}@t=${t} threw: ${String(e)}`;
    }
  }
}
check('all 12 draw on stub ctx at t=0/1000/10000 without throw', drewClean, detail);

let deterministic = true;
let detDetail = '';
for (const def of all) {
  for (const t of TS) {
    const ctx = makeStubCtx();
    def.draw(ctx, 1600, 900, t);
    if (ctx.ops().join('\n') !== fingerprints.get(`${def.id}@${t}`)!.join('\n')) {
      deterministic = false;
      detDetail = `${def.id}@t=${t} not reproducible`;
    }
  }
}
check('deterministic: same t = identical call streams', deterministic, detDetail);

let timeVaries = true;
let tvDetail = '';
for (const def of all) {
  if (fingerprints.get(`${def.id}@0`)!.join() === fingerprints.get(`${def.id}@1000`)!.join()) {
    timeVaries = false;
    tvDetail = `${def.id} ignores t (f(0) == f(1000))`;
  }
}
check('every backdrop is genuinely f(t)', timeVaries, tvDetail);

// pick: one variate, seed-reproducible, throws on empty align
{
  const counter = countingRng(99);
  const w = pick('bad', counter.rng);
  check('pick consumes exactly ONE rng variate', counter.consumed() === 1, `consumed ${counter.consumed()}`);
  check('picked a bad-aligned world', w.align === 'bad');
  check(
    'pick same-seed reproducible',
    pick('good', mulberry32(7)).id === pick('good', mulberry32(7)).id &&
      pick(w.align, mulberry32(2026)).id === pick(w.align, mulberry32(2026)).id,
  );
  check('byId round-trip', byId(w.id)?.id === w.id);

  let threw = false;
  try {
    pick('cosmic' as Align, mulberry32(1));
  } catch {
    threw = true;
  }
  check('pick unknown align throws', threw);
}

// applyBackdrop: cleanup callable before pixi resolves (headless node)
{
  let ok = false;
  try {
    const stop = applyBackdrop({ addChildAt: (child) => child, removeChild: (child) => child }, 'volcano');
    stop();
    stop(); // double-stop must be safe
    ok = true;
  } catch {
    ok = false;
  }
  check('applyBackdrop cleanup immediately callable + idempotent', ok);
}

/* --- cross-world distinctness -------------------------------------------
 * 22 of these worlds were authored in one bulk wave. The failure mode that
 * matters there is not a crash, it is two worlds that paint the same thing.
 * Two worlds whose op stream is byte-identical at the same t are the same
 * world wearing two names. */
{
  const streams = new Map<string, string>();
  let dupes = 0;
  let firstDupe = '';
  for (const wd of list()) {
    const ctx = makeStubCtx();
    wd.draw(ctx, 1600, 900, 1000);
    const key = ctx.ops().join('|');
    const prev = streams.get(key);
    if (prev !== undefined) {
      dupes++;
      if (!firstDupe) firstDupe = `${wd.id} paints exactly what ${prev} paints`;
    } else {
      streams.set(key, wd.id);
    }
  }
  check('every world paints something distinct', dupes === 0, firstDupe);
  /* A world that draws almost nothing is the other bulk-authoring failure. */
  let thin = '';
  for (const wd of list()) {
    const ctx = makeStubCtx();
    wd.draw(ctx, 1600, 900, 1000);
    if (ctx.ops().length < 12) { thin = `${wd.id} issued only ${ctx.ops().length} ops`; break; }
  }
  check('no world is a near-empty frame', thin === '', thin);
}

/* ------------------------------- runner ---------------------------------- */

if (failures > 0) {
  console.error('\nSELFTEST FAILED — ' + failures + ' failing check(s)');
  process.exit(1);
}
console.log('\nSELFTEST PASSED — worlds distinct + non-empty, full align coverage, pure f(t), seeded pick');
process.exit(0);
