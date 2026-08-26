/* ============================================================================
 * selftest-boardskins.ts — node harness for src/style/boardskins.ts.
 *
 * Run: npx tsx src/style/selftest-boardskins.ts
 * Covers the acceptance rails:
 *   - 4 act skins render distinct op streams (act0 clean / act1 crimson edge /
 *     act2 heavy edge + glow / act3 cracks)
 *   - hole variant paints the '?' mark and skips prims
 *   - determinism: identical inputs → byte-identical paint streams
 *     (incl. act3 crack PRNG), no Math.random anywhere in the module source
 * tileSkin() itself needs DOM canvas, so the suite drives the pure
 * f(ctx, …) layer through a recording stub context.
 * ==========================================================================*/

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { paintSkin, paintTile, paintCracks } from './boardskins.ts';
import type { Prim } from '../glyphs.ts';

/* --------------------------- recording stub ctx -------------------------- */

function fmt(v: unknown): string {
  if (typeof v === 'number') return String(Math.round(v * 10000) / 10000);
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? 'null';
  } catch {
    return '<unserializable>';
  }
}

interface StubCtx {
  ops(): string[];
}

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
        return undefined;
      };
    },
    set(_t, rawProp, v): boolean {
      props.set(String(rawProp), v);
      ops.push(`p:${String(rawProp)}=${fmt(v)}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D & StubCtx;
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

console.log('== iqbattle v2 · style/boardskins self-test ==');

const SIZE = 120;
const HUE = '#d4a017';
const PRIMS: Prim[] = [
  { k: 'diamond', x: 50, y: 50, s: 14 },
  { k: 'dot', x: 30, y: 30, r: 4 },
];

// every act draws on a stub ctx without throwing
let drewClean = true;
let detail = '';
for (const act of [0, 1, 2, 3]) {
  try {
    const c = makeStubCtx();
    paintTile(c, act, SIZE, HUE, { prims: PRIMS });
    if (c.ops().length === 0) {
      drewClean = false;
      detail = `act${act} painted nothing`;
    }
  } catch (e) {
    drewClean = false;
    detail = `act${act}: ${String(e)}`;
  }
}
check('all 4 acts paint without throw', drewClean, detail);

// distinctness: pairwise-different op streams across acts (same prims/hue)
const streams = [0, 1, 2, 3].map((act) => {
  const c = makeStubCtx();
  paintTile(c, act, SIZE, HUE, { prims: PRIMS });
  return JSON.stringify(c.ops());
});
let allDistinct = new Set(streams).size === 4;
if (!allDistinct) {
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++)
      if (streams[i] === streams[j]) detail += `act${i} == act${j}; `;
}
check('4 act skins render distinct', allDistinct, detail);

// per-act signatures
{
  const c1 = makeStubCtx();
  paintSkin(c1, 1, SIZE);
  const s1 = c1.ops().join('|');
  check('act1 carries the slight crimson edge', s1.includes('rgba(224,36,94,0.30'), s1.slice(-160));

  const c2 = makeStubCtx();
  paintSkin(c2, 2, SIZE);
  const s2 = c2.ops().join('|');
  check(
    'act2 heavier edge + inner glow',
    s2.includes('rgba(224,36,94,0.55') && s2.includes('rgba(224,36,94,0.10'),
    s2.slice(-160),
  );

  const c3 = makeStubCtx();
  paintSkin(c3, 3, SIZE);
  const strokes = c3.ops().filter((o) => o.startsWith('m:stroke()')).length;
  const c3b = makeStubCtx();
  paintSkin(c3b, 3, 40);
  const strokesSmall = c3b.ops().filter((o) => o.startsWith('m:stroke()')).length;
  check('act3 adds crack strokes beyond the baseline border', strokes > 2 && strokes !== strokesSmall, `${strokes} vs small-tile ${strokesSmall}`);

  const c0 = makeStubCtx();
  paintSkin(c0, 0, SIZE);
  const s0 = c0.ops().join('|');
  check('act0 is the clean baseline (white 6% border only)', s0.includes('rgba(255,255,255,0.06)') && !s0.includes('224,36,94'), '');
}

// hole variant: '?' mark painted, prims skipped
{
  const ch = makeStubCtx();
  paintTile(ch, 1, SIZE, HUE, { hole: true });
  const sh = JSON.stringify(ch.ops());
  check('hole variant paints the ? mark', sh.includes('m:fillText(?,60') || sh.includes('"?"'), sh.slice(-200));
  check('hole variant never paints glyph prims', !sh.includes('m:arc(30'), '');

  const cp = makeStubCtx();
  paintTile(cp, 1, SIZE, HUE, { prims: PRIMS });
  check('non-hole variant paints centered prims', JSON.stringify(cp.ops()).includes('m:arc(28.08,'), '');
}

// determinism: same inputs → identical streams, twice over, incl. cracks
let deterministic = true;
det: for (const size of [48, 96, 130]) {
  for (let act = 0; act < 4; act++) {
    const a = makeStubCtx();
    const b = makeStubCtx();
    paintTile(a, act, size, HUE, { prims: PRIMS });
    paintTile(b, act, size, HUE, { prims: PRIMS });
    if (JSON.stringify(a.ops()) !== JSON.stringify(b.ops())) {
      deterministic = false;
      detail = `act${act}@${size}`;
      break det;
    }
  }
}
check('deterministic: repeat renders are byte-identical', deterministic, detail);

{
  const a = makeStubCtx();
  const b = makeStubCtx();
  paintCracks(a, SIZE);
  paintCracks(b, SIZE);
  check('act3 crack layout is seed-stable', JSON.stringify(a.ops()) === JSON.stringify(b.ops()), '');
}

// act normalization: negative/oversized acts wrap to a valid skin, still deterministic
{
  const norm: string[] = [];
  for (const act of [-5, 7, 11, 3]) {
    const c = makeStubCtx();
    paintSkin(c, act, SIZE);
    norm.push(JSON.stringify(c.ops()));
  }
  check('acts wrap modulo 4 (-5→3, 7→3, 11→3)', norm[0] === norm[3] && norm[1] === norm[3] && norm[2] === norm[3], '');
}

// no stray nondeterminism in module source
{
  const src = readFileSync(fileURLToPath(new URL('./boardskins.ts', import.meta.url)), 'utf8');
  check('module uses no Math.random', !src.includes('Math.random'), '');
}

/* -------------------------------- runner ---------------------------------- */

if (failures > 0) {
  console.error(`\nSELFTEST FAILED — ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nSELFTEST PASSED — 4 distinct act skins, hole variant, deterministic paint');
process.exit(0);
