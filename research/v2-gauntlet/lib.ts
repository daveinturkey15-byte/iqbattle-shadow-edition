/**
 * Shared plumbing for the v2 gauntlet runners (audit-runner.ts, soak.ts).
 * Pure node-side logic; no browser, no Pixi.
 */
import type { Family, Puzzle } from '../../v2/src/puzzles/types.ts';
import type { Prim } from '../../v2/src/glyphs.ts';

/* ------------------------------------------------------------------ */
/* Family module discovery                                             */
/* ------------------------------------------------------------------ */

export type LoadedModule =
  | { file: string; status: 'ok'; families: Family[] }
  | { file: string; status: 'missing'; error: string }
  | { file: string; status: 'error'; error: string };

export function isFamily(v: unknown): v is Family {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Partial<Family>;
  return (
    typeof f.id === 'string' &&
    typeof f.generate === 'function' &&
    typeof f.solve === 'function'
  );
}

/**
 * Pull every Family out of a module namespace. Accepts named Family consts
 * AND aggregate arrays (FAMILIES / FAMILIES2), deduped by family id — so
 * modules exporting both (the team convention) count each family once.
 */
export function extractFamilies(mod: Record<string, unknown>): Family[] {
  const byId = new Map<string, Family>();
  for (const value of Object.values(mod)) {
    if (isFamily(value)) {
      byId.set(value.id, value);
    } else if (Array.isArray(value)) {
      for (const v of value) if (isFamily(v)) byId.set(v.id, v);
    }
  }
  return [...byId.values()];
}

/** Dynamic-import a game module relative to this runner; never throws. */
export async function loadGameModule(
  label: string,
  relSpecifier: string,
): Promise<{ mod: Record<string, unknown> } | { status: 'missing' | 'error'; error: string }> {
  try {
    const mod = (await import(relSpecifier)) as Record<string, unknown>;
    return { mod };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const code = (e as { code?: string }).code;
    const missing =
      code === 'ERR_MODULE_NOT_FOUND' ||
      code === 'MODULE_NOT_FOUND' ||
      code === 'ERR_UNSUPPORTED_RESOLVABLE_MODULE_TYPE' ||
      code === 'ERR_UNKNOWN_FILE_EXTENSION';
    return {
      status: missing ? 'missing' : 'error',
      error: `${code ?? 'ERR_UNCAUGHT'}: ${err.message.split('\n')[0]}`,
    };
  }
}

export async function loadFamilyModule(file: string, relSpecifier: string): Promise<LoadedModule> {
  const res = await loadGameModule(file, relSpecifier);
  if ('mod' in res) {
    const families = extractFamilies(res.mod);
    if (families.length === 0) {
      return {
        file,
        status: 'error',
        error: 'module loaded but exported no Family-shaped objects (expected named consts or FAMILIES/FAMILIES2 array)',
      };
    }
    return { file, status: 'ok', families };
  }
  return { file, ...res };
}

/* ------------------------------------------------------------------ */
/* Deterministic seeds                                                 */
/* ------------------------------------------------------------------ */

/** FNV-1a over familyId/sample/diff — stable regardless of family order. */
export function seedFor(familyId: string, sample: number, diff: number): number {
  let h = 2166136261 >>> 0;
  const s = `${familyId}:${sample}:${diff}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ */
/* Prim invariants                                                     */
/* ------------------------------------------------------------------ */

/** Hard cap per cell (task rule); DNA's readable-density target is 24. */
export const MAX_MARKS_PER_CELL = 40;

function inCellSpace(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

/**
 * Render-prim invariants for one cell's glyph: everything lives inside the
 * 0..100 cell design space with sane sizes and at most MAX_MARKS_PER_CELL marks.
 */
export function checkCellPrims(prims: Prim[], where: string, fail: (msg: string) => void): void {
  if (!Array.isArray(prims)) {
    fail(`${where}: expected Prim[], got ${prims === null ? 'null' : typeof prims}`);
    return;
  }
  if (prims.length > MAX_MARKS_PER_CELL) {
    fail(`${where}: ${prims.length} marks exceeds cap of ${MAX_MARKS_PER_CELL}`);
  }
  prims.forEach((p, i) => {
    const at = `${where}[${i}](${p.k})`;
    switch (p.k) {
      case 'line':
        if (!inCellSpace(p.x1) || !inCellSpace(p.y1) || !inCellSpace(p.x2) || !inCellSpace(p.y2)) {
          fail(`${at}: endpoints (${p.x1},${p.y1})-(${p.x2},${p.y2}) outside 0..100`);
        }
        break;
      case 'tri':
      case 'diamond':
        if (!inCellSpace(p.x) || !inCellSpace(p.y)) {
          fail(`${at}: center (${p.x},${p.y}) outside 0..100`);
        }
        if (!(Number.isFinite(p.s) && p.s > 0 && p.s <= 50)) {
          fail(`${at}: size ${p.s} not in (0,50]`);
        }
        break;
      case 'dot':
        if (!inCellSpace(p.x) || !inCellSpace(p.y)) {
          fail(`${at}: center (${p.x},${p.y}) outside 0..100`);
        }
        if (!(Number.isFinite(p.r) && p.r > 0 && p.r <= 50)) {
          fail(`${at}: radius ${p.r} not in (0,50]`);
        }
        break;
    }
  });
}

/** Every glyph of a puzzle (cells + options) through the prim invariant check.
 *  `where` prefixes each violation with the puzzle/seed context. */
export function checkPuzzlePrims(p: Puzzle, where: string, fail: (msg: string) => void): void {
  p.cells.forEach((cell, i) => checkCellPrims(cell, `${where} cells[${i}]`, fail));
  p.options.forEach((opt, i) => checkCellPrims(opt, `${where} options[${i}]`, fail));
}
