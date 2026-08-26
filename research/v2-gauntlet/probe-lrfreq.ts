/** Frequency probe: line-reflection rendered-identical decoy collisions. */
import { FAMILIES3 } from '../../v2/src/puzzles/families3.ts';
import type { Family } from '../../v2/src/puzzles/types.ts';
import type { Prim } from '../../v2/src/glyphs.ts';

const fam: Family = FAMILIES3.find(f => f.id === 'line-reflection')!;
const RES = 96;
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

for (const diff of [1, 3, 5]) {
  let puzzles = 0, withCollision = 0, totalCollisions = 0;
  for (let s = 0; s < 500; s++) {
    const seed = (((s + 1) * 2654435761) ^ ((diff * 40503) >>> 0)) >>> 0;
    const p = fam.generate(seed, diff, '#d4a017');
    puzzles++;
    const am = mask(p.options[p.answer]);
    let hit = false;
    p.options.forEach((o, oi) => {
      if (oi === p.answer) return;
      if (iou(am, mask(o)) >= 0.999) { hit = true; totalCollisions++; }
    });
    if (hit) withCollision++;
  }
  console.log(`diff=${diff}: ${withCollision}/${puzzles} puzzles ship a decoy pixel-identical to the answer (${totalCollisions} colliding options total)`);
}
