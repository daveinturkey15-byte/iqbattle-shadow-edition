/* ============================================================================
 * CAMEOS SELFTEST — verifies the cameo rails over 200 seeded rounds:
 *   - NEVER overlaps the board's answer area (the hard rail)
 *   - budgeted: at most CAMEO_BUDGET per round
 *   - deterministic: a pure function of (seed, depth)
 *   - roster: all 10 named silhouettes present, valid alignment + marks
 *   - motion=false → zero bob
 *
 * Run from v2/:
 *   node --experimental-strip-types src/fx/selftest-cameos.ts
 * ==========================================================================*/

import {
  CAMEO_BUDGET,
  ROSTER,
  STAGE,
  cameoBobOffset,
  pickCameos,
  rectsIntersect,
  type CameoPlacement,
  type Rect,
} from './cameos.ts';
import { BOARD_PANEL, puzzleLayout } from '../scenes/layouthelper.ts';

const SEED_COUNT = 200;

/** The board's answer area (the options grid) in stage px, for a given board. */
function answerAreaFor(cols: number, rows: number): Rect {
  const l = puzzleLayout(cols, rows);
  return {
    x: BOARD_PANEL.x + l.ox,
    y: BOARD_PANEL.y + l.oy,
    w: l.optW,
    h: l.optH,
  };
}

function samePlacement(a: CameoPlacement, b: CameoPlacement): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.alignment === b.alignment &&
    a.x === b.x &&
    a.y === b.y &&
    a.size === b.size &&
    a.bobPhase === b.bobPhase &&
    a.bobAmp === b.bobAmp
  );
}

function sameList(a: CameoPlacement[], b: CameoPlacement[]): boolean {
  return a.length === b.length && a.every((p, i) => samePlacement(p, b[i]));
}

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  function check(name: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
  }

  // --- Roster: all 10 named silhouettes, valid alignment + marks -------------
  check('roster contains exactly the 10 named silhouettes', () => {
    const expected = [
      'terminator',
      'jester',
      'wizard',
      'undead',
      'dolphin',
      'shark',
      'angel',
      'genie',
      'cyclist',
      'blobby',
    ];
    assert(ROSTER.length === expected.length, `roster length ${ROSTER.length} != 10`);
    const ids = ROSTER.map((s) => s.id);
    for (const id of expected) {
      assert(ids.includes(id), `missing silhouette ${id}`);
    }
    for (const s of ROSTER) {
      assert(
        s.alignment === 'good' || s.alignment === 'bad' || s.alignment === 'neutral',
        `${s.id}: bad alignment ${s.alignment}`,
      );
      assert(s.name.length > 0, `${s.id}: empty name`);
      assert(s.marks.length > 0, `${s.id}: no marks`);
      for (const m of s.marks) {
        assert(
          m.kind === 'triangle' || m.kind === 'dot' || m.kind === 'diamond' || m.kind === 'line',
          `${s.id}: bad mark kind ${m.kind}`,
        );
        assert(Number.isFinite(m.x) && Number.isFinite(m.y), `${s.id}: non-finite mark pos`);
        if (m.kind === 'line') {
          assert(
            Number.isFinite(m.x2) && Number.isFinite(m.y2),
            `${s.id}: line mark missing x2/y2`,
          );
        } else {
          assert(m.size > 0, `${s.id}: ${m.kind} mark with size <= 0`);
        }
      }
    }
  });

  // --- THE RAIL: never overlap the board's answer area ------------------------
  check(`never overlaps the answer area over ${SEED_COUNT} seeds (2x2 and 3x3)`, () => {
    const areas = [answerAreaFor(2, 2), answerAreaFor(3, 3)];
    for (let s = 0; s < SEED_COUNT; s++) {
      for (const area of areas) {
        const cameos = pickCameos(s, s % 40, area);
        for (const p of cameos) {
          assert(
            !rectsIntersect({ x: p.x, y: p.y, w: p.size, h: p.size }, area),
            `seed ${s}: ${p.id} overlaps the answer area`,
          );
        }
      }
    }
  });

  // --- Budget: at most CAMEO_BUDGET per round ---------------------------------
  check(`budget <= ${CAMEO_BUDGET} over ${SEED_COUNT} seeds`, () => {
    const area = answerAreaFor(3, 3);
    for (let s = 0; s < SEED_COUNT; s++) {
      const cameos = pickCameos(s, s % 40, area);
      assert(
        cameos.length <= CAMEO_BUDGET,
        `seed ${s}: ${cameos.length} cameos > budget ${CAMEO_BUDGET}`,
      );
      // No duplicate ids in a single round.
      const ids = cameos.map((p) => p.id);
      assert(
        new Set(ids).size === ids.length,
        `seed ${s}: duplicate cameo ids`,
      );
    }
  });

  // --- max argument is clamped to the budget ----------------------------------
  check(`max argument clamped to budget over ${SEED_COUNT} seeds`, () => {
    const area = answerAreaFor(3, 3);
    for (let s = 0; s < SEED_COUNT; s++) {
      assert(
        pickCameos(s, 0, area, 99).length <= CAMEO_BUDGET,
        `seed ${s}: max=99 not clamped`,
      );
      assert(
        pickCameos(s, 0, area, 0).length === 0,
        `seed ${s}: max=0 should yield no cameos`,
      );
      assert(
        pickCameos(s, 0, area, -3).length === 0,
        `seed ${s}: negative max should yield no cameos`,
      );
    }
  });

  // --- Determinism: same (seed, depth) = identical placements -----------------
  check(`determinism over ${SEED_COUNT} seeds`, () => {
    const area = answerAreaFor(3, 3);
    for (let s = 0; s < SEED_COUNT; s++) {
      const depth = s % 40;
      const a = pickCameos(s, depth, area);
      const b = pickCameos(s, depth, area);
      assert(sameList(a, b), `seed ${s} depth ${depth}: placements diverged`);
      // Different depth must (almost always) change the draw.
      const c = pickCameos(s, depth + 1, area);
      if (sameList(a, c) && a.length > 0) {
        // Not a hard failure — just log; the PRNG fold makes this astronomically
        // unlikely, so treat it as a failure to keep the gate strict.
        throw new Error(`seed ${s}: depth ${depth} and ${depth + 1} identical (suspicious)`);
      }
    }
  });

  // --- Placements stay inside the stage ---------------------------------------
  check(`placements inside the stage over ${SEED_COUNT} seeds`, () => {
    const area = answerAreaFor(3, 3);
    for (let s = 0; s < SEED_COUNT; s++) {
      for (const p of pickCameos(s, s % 40, area)) {
        assert(
          p.x >= STAGE.x &&
            p.y >= STAGE.y &&
            p.x + p.size <= STAGE.x + STAGE.w &&
            p.y + p.size <= STAGE.y + STAGE.h,
          `seed ${s}: ${p.id} outside the stage`,
        );
      }
    }
  });

  // --- Motion gate: motion=false → zero bob ------------------------------------
  check(`motion=false yields zero bob over ${SEED_COUNT} seeds`, () => {
    const area = answerAreaFor(3, 3);
    for (let s = 0; s < SEED_COUNT; s++) {
      for (const p of pickCameos(s, s % 40, area)) {
        assert(cameoBobOffset(p, 1234, false) === 0, `seed ${s}: bob under motion=false`);
      }
    }
  });

  // --- Bob is bounded by the amplitude when motion is on ------------------------
  check(`bob bounded by amplitude over ${SEED_COUNT} seeds`, () => {
    const area = answerAreaFor(3, 3);
    for (let s = 0; s < SEED_COUNT; s++) {
      for (const p of pickCameos(s, s % 40, area)) {
        for (let t = 0; t < 5000; t += 16) {
          const off = cameoBobOffset(p, t, true);
          assert(
            Math.abs(off) <= p.bobAmp + 1e-9,
            `seed ${s}: bob ${off} exceeds amplitude ${p.bobAmp}`,
          );
        }
      }
    }
  });

  return { ok: failures.length === 0, failures };
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  Boolean(
    process.argv[1] &&
      /selftest-cameos(\.ts)?$/.test(process.argv[1].replace(/\\/g, '/')),
  );

if (isMain) {
  const res = selfTest();
  if (res.ok) {
    console.log('[cameos-selftest] ALL PASS');
    process.exit(0);
  } else {
    for (const f of res.failures) console.error('  FAIL ' + f);
    process.exit(1);
  }
}
