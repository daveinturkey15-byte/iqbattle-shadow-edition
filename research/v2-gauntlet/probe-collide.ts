/** Detail probe: identify exact colliding option/cell glyphs per family. */
import { FAMILIES } from '../../v2/src/puzzles/families.ts';
import { FAMILIES2 } from '../../v2/src/puzzles/families2.ts';
import { FAMILIES3 } from '../../v2/src/puzzles/families3.ts';
import type { Family } from '../../v2/src/puzzles/types.ts';
import type { Prim } from '../../v2/src/glyphs.ts';

const ALL: Family[] = [...FAMILIES, ...FAMILIES2, ...FAMILIES3];
const HUE = '#d4a017';
const r2 = (v: number): number => Math.round(v * 100) / 100;
function glyphKey(prims: Prim[]): string {
  const norm = prims.map((p) => {
    switch (p.k) {
      case 'tri': return { k: 'tri', x: r2(p.x), y: r2(p.y), s: r2(p.s) };
      case 'dot': return { k: 'dot', x: r2(p.x), y: r2(p.y), r: r2(p.r) };
      case 'diamond': return { k: 'diamond', x: r2(p.x), y: r2(p.y), s: r2(p.s) };
      case 'line': return { k: 'line', x1: r2(p.x1), y1: r2(p.y1), x2: r2(p.x2), y2: r2(p.y2) };
    }
  });
  return JSON.stringify(norm.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

// --- line-reflection: find a seed where a decoy renders identical to answer
{
  const fam = ALL.find(f => f.id === 'line-reflection')!;
  const RES = 128;
  const mask = (prims: Prim[]): Uint8Array => {
    const m = new Uint8Array(RES * RES);
    const put = (x: number, y: number): void => {
      const px = Math.round(x), py = Math.round(y);
      if (px >= 0 && px < RES && py >= 0 && py < RES) m[py * RES + px] = 1;
    };
    const scale = RES / 100;
    for (const p of prims) {
      if (p.k !== 'line') continue;
      const steps = Math.max(2, Math.ceil(Math.hypot(p.x2 - p.x1, p.y2 - p.y1) * scale));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const cx = (p.x1 + (p.x2 - p.x1) * t) * scale, cy = (p.y1 + (p.y2 - p.y1) * t) * scale;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
          if (dx * dx + dy * dy <= 4) put(cx + dx, cy + dy);
      }
    }
    return m;
  };
  const iou = (a: Uint8Array, b: Uint8Array): number => {
    let i = 0, u = 0;
    for (let k = 0; k < a.length; k++) { if (a[k] && b[k]) i++; if (a[k] || b[k]) u++; }
    return u ? i / u : 1;
  };
  console.log('--- line-reflection collisions (decoy IoU==1 vs answer) ---');
  let shown = 0;
  for (let s = 0; s < 400 && shown < 3; s++) {
    const seed = ((s + 1) * 2654435761) >>> 0;
    const p = fam.generate(seed, 3, HUE);
    const am = mask(p.options[p.answer]);
    p.options.forEach((o, oi) => {
      if (oi === p.answer || shown >= 3) return;
      if (iou(am, mask(o)) >= 0.999) {
        shown++;
        console.log(`seed=${seed} answerOpt=${p.answer} collidingOpt=${oi}`);
        console.log(`  answer prims : ${glyphKey(p.options[p.answer])}`);
        console.log(`  collide prims: ${glyphKey(o)}`);
        console.log(`  keys equal? ${glyphKey(p.options[p.answer]) === glyphKey(o)}`);
        // which board cell does the collider equal, if any?
        p.cells.forEach((c, ci) => { if (glyphKey(c) === glyphKey(o)) console.log(`  == board cell ${ci}`); });
      }
    });
  }

  // --- how often does the answer glyph ALSO appear as a visible board cell?
  let ansDup = 0;
  for (let s = 0; s < 400; s++) {
    const seed = ((s + 1) * 2654435761) >>> 0;
    const p = fam.generate(seed, 3, HUE);
    const ak = glyphKey(p.options[p.answer]);
    if (p.cells.some(c => glyphKey(c) === ak)) ansDup++;
  }
  console.log(`line-reflection: answer identical to a visible cell in ${ansDup}/400 seeds`);

  console.log('\n--- per-family: which option indexes equal which board cells (sample) ---');
  for (const fid of ['position-orbit', 'missing-section', 'dot-matrix-rotate', 'count-positions', 'size-ladder']) {
    const fam2 = ALL.find(f => f.id === fid)!;
    const seed = 2654463878;
    const p = fam2.generate(seed, 1, HUE);
    const cellKeys = p.cells.map(glyphKey);
    p.options.forEach((o, oi) => {
      if (oi === p.answer) return;
      const ci = cellKeys.indexOf(glyphKey(o));
      if (ci >= 0) console.log(`${fid} seed=${seed}: option ${oi} === board cell ${ci} (answer=${p.answer})`);
    });
  }
}
