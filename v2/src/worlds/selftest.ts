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

interface StubCtx { ops(): string[] }

function makeStubCtx(): CanvasRenderingContext2D & StubCtx {
  const ops: string[] = [];
  const props = new Map<string, unknown>();
  return new Proxy({}, {
    get(_t, rawProp): unknown {
      const prop = String(rawProp);
      if (prop === 'ops') return (): string[] => ops;
      if (props.has(prop)) return props.get(prop);
      return (...args: unknown[]): unknown => {
        ops.push(`m:${prop}(${args.map(fmt).join(',')})`);
        if (/Gradient$/.test(prop)) {
          return { addColorStop: (o: number, col: unknown): void => { ops.push(`m:addColorStop(${fmt(o)},${fmt(col)})`); } };
        }
        return undefined;
      };
    },
    set(_t, rawProp, v): boolean {
      const prop = String(rawProp);
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
check('12 worlds registered', all.length === 12, `got ${all.length}`);
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

/* ------------------------------- runner ---------------------------------- */

if (failures > 0) {
  console.error('\nSELFTEST FAILED — ' + failures + ' failing check(s)');
  process.exit(1);
}
console.log('\nSELFTEST PASSED — 12 worlds, full align coverage, pure f(t), seeded pick');
process.exit(0);
