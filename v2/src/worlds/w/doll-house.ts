import { hash, wash, softBlob, wrap, type WorldDef } from './kit.ts';

export const WORLD: WorldDef = {
  id: 'doll-house',
  align: 'chaotic',
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    c.fillStyle = '#171019';
    c.fillRect(0, 0, w, h);
    wash(c, w, h, '#2b1c30', '#0e0b15');
    const cx = w / 2;
    const cy = h / 2;
    const m = Math.min(w, h);
    const drift = (wrap(t, 14000) / 14000) * Math.PI * 2;
    const sway = Math.sin((t * Math.PI * 2) / 6800);
    const sway2 = Math.cos((t * Math.PI * 2) / 9400);
    const wob = Math.sin((t * Math.PI * 2) / 5200 + 1.3);
    for (let i = 0; i < 6; i++) {
      const a = hash(31 + i);
      const b = hash(131 + i);
      const ex = (i % 3 === 0) ? a * w * 0.22 : (i % 3 === 1) ? w * (0.5 + (a - 0.5) * 0.4) : w * (0.82 + a * 0.18);
      const ey = (i < 3) ? b * h * 0.28 : h * (0.74 + b * 0.26);
      const er = m * (0.28 + b * 0.32);
      /* kit softBlob takes (rx, ry, 'r,g,b', alpha): the rgb triple and its
       * alpha are separate arguments, not one css colour string. */
      const cols = ['216,164,178', '178,186,214', '186,208,188', '224,196,158'];
      const alphas = [0.28, 0.26, 0.24, 0.26];
      softBlob(c, ex, ey, er, er, cols[i % 4]!, alphas[i % 4]!);
    }
    c.save();
    c.globalAlpha = 0.16;
    c.strokeStyle = '#c9a9bd';
    c.lineWidth = Math.max(1, m * 0.002);
    for (let i = 0; i < 12; i++) {
      const off = (hash(211 + i) - 0.5) * m * 0.4;
      c.beginPath();
      c.moveTo(-m * 0.2 + off + (i * w) / 11, 0);
      c.lineTo(-m * 0.2 + off + (i * w) / 11 + m * 0.35, h);
      c.stroke();
    }
    c.restore();
    const colsN = 7;
    const rowsN = 5;
    for (let gy = 0; gy < rowsN; gy++) {
      for (let gx = 0; gx < colsN; gx++) {
        const k = 400 + gy * 20 + gx;
        const jx = hash(k);
        const jy = hash(k + 100);
        const js = hash(k + 200);
        const jt = hash(k + 300);
        const px = (w * (gx + 0.5)) / colsN + (jx - 0.5) * m * 0.08;
        const py = (h * (gy + 0.5)) / rowsN + (jy - 0.5) * m * 0.08;
        const dx = (px - cx) / (w * 0.5);
        const dy = (py - cy) / (h * 0.5);
        const nd = Math.min(1, Math.sqrt(dx * dx + dy * dy));
        const ew = m * (0.045 + js * 0.05 + nd * 0.035);
        const eh = ew * (0.52 + jt * 0.22);
        const tilt = (jx - 0.5) * 0.5 + (gx % 2 === 0 ? 0.12 : -0.12);
        c.save();
        c.translate(px, py);
        c.rotate(tilt);
        c.globalAlpha = 0.14 + nd * 0.5;
        c.fillStyle = '#e4d5c4';
        c.beginPath();
        c.ellipse(0, 0, ew, eh, 0, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 0.2 + nd * 0.6;
        c.strokeStyle = '#4a3040';
        c.lineWidth = Math.max(1, m * 0.004);
        c.beginPath();
        c.ellipse(0, 0, ew, eh, 0, 0, Math.PI * 2);
        c.stroke();
        const irisCols = ['#7fa8b8', '#9a8fc2', '#8fb894', '#b88f6a'];
        const iris = irisCols[Math.floor(jt * 4) % 4];
        c.fillStyle = iris;
        c.beginPath();
        c.arc(0, 0, ew * 0.42, 0, Math.PI * 2);
        c.fill();
        let vx = cx - px;
        let vy = cy - py;
        const vl = Math.max(1, Math.sqrt(vx * vx + vy * vy));
        vx = (vx / vl) * ew * 0.18 + sway * ew * 0.08;
        vy = (vy / vl) * eh * 0.18 + wob * eh * 0.08;
        c.fillStyle = '#140f16';
        c.beginPath();
        c.arc(vx, vy, ew * 0.2, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 0.7;
        c.fillStyle = '#f2e8da';
        c.beginPath();
        c.arc(vx - ew * 0.06, vy - ew * 0.07, ew * 0.05, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }
    }
    c.save();
    c.translate(w * 0.05 + sway * m * 0.012, h * 0.32 + sway2 * m * 0.008);
    c.rotate(-0.07 + sway * 0.012);
    c.fillStyle = '#38233a';
    c.beginPath();
    c.roundRect(-m * 0.28, -m * 0.32, m * 0.36, m * 0.78, m * 0.07);
    c.fill();
    c.fillStyle = '#4d3148';
    c.beginPath();
    c.roundRect(-m * 0.24, -m * 0.28, m * 0.28, m * 0.68, m * 0.05);
    c.fill();
    c.fillStyle = '#c98fa3';
    for (let i = 0; i < 5; i++) {
      const by = -m * 0.18 + i * m * 0.12 + hash(601 + i) * m * 0.02;
      c.beginPath();
      c.arc(-m * 0.1 + (hash(651 + i) - 0.5) * m * 0.04, by, m * 0.016, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    c.save();
    c.translate(w * 0.94 + sway2 * m * 0.01, h * 0.52);
    c.rotate(0.05 + wob * 0.01);
    c.fillStyle = '#2e1f30';
    c.fillRect(-m * 0.3, -m * 0.04, m * 0.62, m * 0.07);
    c.fillStyle = '#3d2a3c';
    c.fillRect(-m * 0.22, m * 0.03, m * 0.06, m * 0.42);
    c.fillRect(m * 0.18, m * 0.03, m * 0.06, m * 0.42);
    c.fillStyle = '#d8b7c2';
    c.beginPath();
    c.ellipse(0, -m * 0.1, m * 0.14, m * 0.055, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#4a2f45';
    c.beginPath();
    c.ellipse(0, -m * 0.14, m * 0.1, m * 0.045, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#c98fa3';
    c.lineWidth = Math.max(1, m * 0.004);
    c.beginPath();
    c.ellipse(0, -m * 0.1, m * 0.14, m * 0.055, 0, 0.2, Math.PI * 1.4);
    c.stroke();
    c.restore();
    c.save();
    c.translate(cx + sway * m * 0.006, h * 0.1);
    c.rotate(-0.02 + sway2 * 0.008);
    c.fillStyle = '#241722';
    c.fillRect(-w * 0.42, -m * 0.08, w * 0.84, m * 0.03);
    for (let i = 0; i < 5; i++) {
      const bx = -w * 0.32 + i * w * 0.16 + (hash(751 + i) - 0.5) * w * 0.05;
      const bh = m * (0.05 + hash(801 + i) * 0.09);
      const bw = m * (0.04 + hash(851 + i) * 0.04);
      c.fillStyle = i % 2 === 0 ? '#5a3c52' : '#45565e';
      c.beginPath();
      c.roundRect(bx, -m * 0.06 - bh, bw, bh, m * 0.01);
      c.fill();
      c.fillStyle = 'rgba(233,201,190,0.5)';
      c.fillRect(bx + bw * 0.2, -m * 0.06 - bh + bh * 0.2, bw * 0.14, bh * 0.5);
    }
    c.restore();
    c.fillStyle = '#1d1420';
    c.fillRect(0, h * 0.82, w, h * 0.18);
    c.strokeStyle = 'rgba(200,150,165,0.18)';
    c.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const fy = h * 0.84 + (hash(951 + i) * h * 0.14);
      c.globalAlpha = 0.5;
      c.beginPath();
      c.moveTo(0, fy);
      c.lineTo(w, fy + (hash(981 + i) - 0.5) * 8);
      c.stroke();
    }
    c.globalAlpha = 1;
    c.fillStyle = 'rgba(122,74,94,0.35)';
    c.beginPath();
    c.ellipse(cx + m * 0.22, h * 0.9, m * 0.3, m * 0.07, -0.08, 0, Math.PI * 2);
    c.fill();
    for (let i = 0; i < 26; i++) {
      const hx = hash(1101 + i);
      const hy = hash(1401 + i);
      const hs = hash(1701 + i);
      const speed = 0.006 + hs * 0.014;
      const yy = wrap(hy * h + t * speed, h + 40) - 20;
      const xx = hx * w + Math.sin((t * Math.PI * 2) / 7200 + hx * 6.28 + drift * 0.4) * m * 0.04;
      const r = 0.8 + hs * 2.4;
      c.globalAlpha = 0.12 + hs * 0.28;
      c.fillStyle = hs > 0.5 ? '#e8c9b8' : '#b8c8d8';
      c.beginPath();
      c.arc(xx, yy, r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    const g = c.createRadialGradient(cx, cy, m * 0.08, cx, cy, m * 0.85);
    g.addColorStop(0, 'rgba(7,4,11,0.8)');
    g.addColorStop(0.52, 'rgba(10,7,15,0.45)');
    g.addColorStop(1, 'rgba(10,7,15,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.globalAlpha = 1;
  },
};
