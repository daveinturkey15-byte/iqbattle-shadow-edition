import { hash, wash, softBlob, wrap, type WorldDef } from './kit.ts';

export const WORLD: WorldDef = {
  id: 'symbiote-party',
  align: 'chaotic',
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const min = Math.min(w, h);
    const cx = w * 0.5;
    const cy = h * 0.5;
    wash(c, w, h, '#1a0e28', '#040307');
    for (let k = 0; k < 6; k++) {
      const p1 = hash(100 + k * 3);
      const p2 = hash(100 + k * 3 + 1);
      const p3 = hash(100 + k * 3 + 2);
      const ex = p1 < 0.5 ? w * (0.02 + p2 * 0.16) : w * (0.82 + p2 * 0.16);
      const ey = h * p3;
      const drift = Math.sin(t / 4200 + p2 * 6.2832) * 26;
      let rgb = '155,44,165';
      if (k % 3 === 1) rgb = '18,178,168';
      else if (k % 3 === 2) rgb = '255,96,44';
      softBlob(c, ex, ey + drift, min * 0.42, min * 0.34, rgb, 0.20);
    }
    softBlob(c, cx, cy, min * 0.58, min * 0.48, '0,0,0', 0.62);
    softBlob(c, cx, cy, min * 0.30, min * 0.26, '0,0,0', 0.45);
    for (let i = 0; i < 12; i++) {
      const h1 = hash(200 + i * 5);
      const h2 = hash(200 + i * 5 + 1);
      const h3 = hash(200 + i * 5 + 2);
      const h4 = hash(200 + i * 5 + 3);
      const h5 = hash(200 + i * 5 + 4);
      const side = i % 4;
      const sway = Math.sin(t / 2800 + h4 * 6.2832) * min * 0.07;
      const reach = min * (0.30 + h2 * 0.34) + Math.sin(t / 5200 + h1 * 6.2832) * min * 0.04;
      let ax = 0;
      let ay = 0;
      let tx = 0;
      let ty = 0;
      if (side === 0) { ax = -24; ay = h1 * h; tx = ax + reach + min * 0.18; ty = ay + sway; }
      else if (side === 1) { ax = w + 24; ay = h1 * h; tx = ax - reach - min * 0.18; ty = ay - sway; }
      else if (side === 2) { ax = h1 * w; ay = -24; tx = ax + sway; ty = ay + reach + min * 0.18; }
      else { ax = h1 * w; ay = h + 24; tx = ax - sway; ty = ay - reach - min * 0.18; }
      const dx = tx - ax;
      const dy = ty - ay;
      const len = Math.sqrt(dx * dx + dy * dy) + 0.001;
      const nx = -dy / len;
      const ny = dx / len;
      const wd = min * (0.055 + h3 * 0.075);
      const bend = (h5 - 0.5) * min * 0.22 + Math.cos(t / 3400 + h1 * 6.2832) * 14;
      const mx = (ax + tx) * 0.5 + nx * bend;
      const my = (ay + ty) * 0.5 + ny * bend;
      c.save();
      c.fillStyle = '#07060d';
      c.beginPath();
      c.moveTo(ax + nx * wd, ay + ny * wd);
      c.quadraticCurveTo(mx + nx * wd * 0.65, my + ny * wd * 0.65, tx, ty);
      c.quadraticCurveTo(mx - nx * wd * 0.65, my - ny * wd * 0.65, ax - nx * wd, ay - ny * wd);
      c.closePath();
      c.fill();
      c.beginPath();
      c.arc(tx, ty, wd * 0.38, 0, 6.2832);
      c.fill();
      c.beginPath();
      c.arc(ax + dx * 0.55 + nx * wd * 0.5, ay + dy * 0.55 + ny * wd * 0.5, wd * 0.42 * (0.6 + h2 * 0.6), 0, 6.2832);
      c.fill();
      c.globalAlpha = 0.24;
      c.strokeStyle = '#cdb8ff';
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(ax + nx * wd * 0.45, ay + ny * wd * 0.45);
      c.quadraticCurveTo(mx + nx * wd * 0.45, my + ny * wd * 0.45, tx, ty);
      c.stroke();
      const ph = wrap(h1 + t / 6000, 1);
      const hx = ax + (tx - ax) * ph + nx * wd * 0.35;
      const hy = ay + (ty - ay) * ph + ny * wd * 0.35;
      c.globalAlpha = 0.55;
      c.fillStyle = '#e9dcff';
      c.beginPath();
      c.ellipse(hx, hy, wd * 0.16, wd * 0.07, Math.atan2(dy, dx), 0, 6.2832);
      c.fill();
      c.restore();
    }
    for (let j = 0; j < 68; j++) {
      const q1 = hash(500 + j * 4);
      const q2 = hash(500 + j * 4 + 1);
      const q3 = hash(500 + j * 4 + 2);
      const q4 = hash(500 + j * 4 + 3);
      const spd = 0.018 + q2 * 0.042;
      const yy = wrap(q1 * (h + 40) + t * spd, h + 40) - 20;
      const xx = wrap(q3 * (w + 80) + t * 0.008 * (q2 - 0.5) + Math.sin(t / 2100 + q4 * 6.2832) * 14, w + 80) - 40;
      const rot = q4 * 6.2832 + (t / 1900) * (q1 - 0.5) * 2;
      const sx = 3 + q2 * 6;
      const sy = 2 + q3 * 5;
      let col = '#ff4d6d';
      if (q1 < 0.16) col = '#ff4d6d';
      else if (q1 < 0.33) col = '#ffd166';
      else if (q1 < 0.5) col = '#06d6a0';
      else if (q1 < 0.66) col = '#9b5de5';
      else if (q1 < 0.83) col = '#4cc9f0';
      else col = '#ff8c42';
      const nx2 = (xx - cx) / (w * 0.5);
      const ny2 = (yy - cy) / (h * 0.5);
      const d2 = nx2 * nx2 + ny2 * ny2;
      const al = 0.20 + 0.58 * Math.min(1, d2);
      c.save();
      c.translate(xx, yy);
      c.rotate(rot);
      c.globalAlpha = al;
      c.fillStyle = col;
      c.fillRect(-sx * 0.5, -sy * 0.5, sx, sy);
      c.globalAlpha = al * 0.7;
      c.fillStyle = '#0b0b12';
      c.fillRect(-sx * 0.5, 0, sx, sy * 0.5);
      c.restore();
    }
    for (let d = 0; d < 22; d++) {
      const r1 = hash(800 + d * 3);
      const r2 = hash(800 + d * 3 + 1);
      const r3 = hash(800 + d * 3 + 2);
      const px = wrap(r1 * w + Math.sin(t / 3600 + r2 * 6.2832) * 30, w);
      const py = wrap(r2 * h + Math.cos(t / 4400 + r3 * 6.2832) * 30, h);
      const rad = 2 + r3 * 7;
      c.save();
      c.globalAlpha = 0.85;
      c.fillStyle = '#060509';
      c.beginPath();
      c.arc(px, py, rad, 0, 6.2832);
      c.fill();
      c.globalAlpha = 0.4;
      c.fillStyle = '#bda8ff';
      c.beginPath();
      c.ellipse(px - rad * 0.25, py - rad * 0.3, rad * 0.28, rad * 0.14, -0.6, 0, 6.2832);
      c.fill();
      c.restore();
    }
    const g = c.createRadialGradient(cx, cy, min * 0.05, cx, cy, min * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.globalAlpha = 1;
  },
};
