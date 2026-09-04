import { hash, wash, softBlob, wrap, type WorldDef } from './kit.ts';

export const WORLD: WorldDef = {
  id: 'serpent-pit',
  align: 'bad',
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const minDim = Math.min(w, h);
    const maxDim = Math.max(w, h);
    wash(c, w, h, '#2a1810', '#050304');
    softBlob(c, w * 0.05, -h * 0.08, w * 0.48, h * 0.38, '255,122,48', 0.30);
    softBlob(c, w * 0.95, -h * 0.08, w * 0.48, h * 0.38, '255,132,58', 0.30);
    softBlob(c, cx, -h * 0.04, w * 0.72, h * 0.24, '255,172,92', 0.13);
    softBlob(c, w * 0.0, h * 0.88, w * 0.36, h * 0.46, '128,34,64', 0.16);
    softBlob(c, w * 1.0, h * 0.88, w * 0.36, h * 0.46, '128,34,64', 0.16);
    softBlob(c, cx, h * 1.08, w * 0.85, h * 0.42, '46,10,22', 0.32);
    const topGlow = c.createLinearGradient(0, 0, 0, h * 0.55);
    topGlow.addColorStop(0, 'rgba(255,150,80,0.16)');
    topGlow.addColorStop(1, 'rgba(255,150,80,0)');
    c.fillStyle = topGlow;
    c.fillRect(0, 0, w, h * 0.55);
    for (let i = 0; i < 16; i++) {
      const a1 = hash(i * 5 + 3);
      const a2 = hash(i * 5 + 7);
      const a3 = hash(i * 5 + 11);
      const a4 = hash(i * 5 + 19);
      const frac = i / 15;
      const yBase = h * (0.05 + 0.90 * frac) + (a2 - 0.5) * 26;
      const thick = 12 + minDim * (0.035 + 0.060 * a1);
      const dir = a1 > 0.5 ? 1 : -1;
      const period = 5200 + a2 * 7800;
      const drift = (t / period) * Math.PI * 2 * dir + a3 * Math.PI * 2;
      const amp = 12 + minDim * 0.055 + a4 * 48;
      const wl = w * (0.30 + 0.55 * a3);
      const r = Math.round(40 + a1 * 36 + a4 * 20);
      const g = Math.round(26 + a2 * 22);
      const b = Math.round(20 + a3 * 20);
      const r2 = Math.min(255, r + 58);
      const g2 = Math.min(255, g + 38);
      const b2 = Math.min(255, b + 20);
      c.save();
      c.beginPath();
      let first = true;
      for (let x = -80; x <= w + 80; x += 22) {
        const y = yBase + Math.sin((x / wl) * Math.PI * 2 + drift) * amp + Math.sin((x / wl) * 6.3 + a4 * 6.28 + drift * 0.6) * amp * 0.28;
        if (first) {
          c.moveTo(x, y);
          first = false;
        } else {
          c.lineTo(x, y);
        }
      }
      c.strokeStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      c.lineWidth = thick;
      c.stroke();
      c.globalAlpha = 0.24;
      c.strokeStyle = 'rgb(' + r2 + ',' + g2 + ',' + b2 + ')';
      c.lineWidth = Math.max(1.5, thick * 0.18);
      c.stroke();
      c.restore();
      for (let k = 0; k < 4; k++) {
        const gi = 500 + i * 23 + k * 97;
        const gxSeed = hash(gi);
        const gzSeed = hash(gi + 1);
        const gpSeed = hash(gi + 2);
        const gx = -40 + gxSeed * (w + 80);
        const gyOn = yBase + Math.sin((gx / wl) * Math.PI * 2 + drift) * amp + Math.sin((gx / wl) * 6.3 + a4 * 6.28 + drift * 0.6) * amp * 0.28;
        const gy = gyOn - thick * 0.18 + (gzSeed - 0.5) * thick * 0.55;
        const pPeriod = 2500 + gpSeed * 3800;
        const pulse = 0.5 + 0.5 * Math.sin((t / pPeriod) * Math.PI * 2 + gpSeed * 6.28 + frac * 5);
        const ndx = (gx - cx) / (w * 0.5 || 1);
        const ndy = (gy - cy) / (h * 0.5 || 1);
        const edge = Math.min(1, ndx * ndx + ndy * ndy);
        const boost = 0.18 + 0.82 * edge;
        const alpha = (0.04 + 0.24 * pulse) * boost;
        const rx = 5 + gzSeed * 13 + pulse * 5;
        const ry = 1.6 + gzSeed * 2.4;
        const rot = (gpSeed - 0.5) * 0.9 + (gx / wl) * 0.6;
        c.save();
        c.translate(gx, gy);
        c.rotate(rot);
        c.globalAlpha = alpha;
        c.fillStyle = '#ffcf96';
        c.beginPath();
        c.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }
    }
    const veil = c.createRadialGradient(cx, cy, minDim * 0.1, cx, cy, maxDim * 0.72);
    veil.addColorStop(0, 'rgba(4,2,5,0.80)');
    veil.addColorStop(0.52, 'rgba(6,3,6,0.44)');
    veil.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = veil;
    c.fillRect(0, 0, w, h);
    for (let m = 0; m < 34; m++) {
      const m1 = hash(2000 + m * 4);
      const m2 = hash(2000 + m * 4 + 1);
      const m3 = hash(2000 + m * 4 + 2);
      const m4 = hash(2000 + m * 4 + 3);
      const speed = 7 + m2 * 17;
      const span = h + 100;
      const y = h + 50 - wrap(m1 * span + (t / 1000) * speed, span);
      const swayPeriod = 3800 + m3 * 5400;
      const swayAmp = 10 + m3 * 36;
      const x = m1 * w + Math.sin((t / swayPeriod) * Math.PI * 2 + m1 * 6.28) * swayAmp;
      const twPeriod = 2200 + m4 * 3600;
      const tw = 0.5 + 0.5 * Math.sin((t / twPeriod) * Math.PI * 2 + m4 * 6.28);
      const ndx2 = (x - cx) / (w * 0.5 || 1);
      const ndy2 = (y - cy) / (h * 0.5 || 1);
      const edge2 = Math.min(1, ndx2 * ndx2 + ndy2 * ndy2);
      const alpha2 = (0.05 + 0.26 * tw) * (0.25 + 0.75 * edge2);
      const sz = 1 + m2 * 2.4 + tw * 1.2;
      c.save();
      c.globalAlpha = alpha2;
      c.fillStyle = m4 > 0.5 ? '#ffb377' : '#c98a5a';
      c.beginPath();
      c.arc(x, y, sz, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    c.globalAlpha = 1;
  },
};
