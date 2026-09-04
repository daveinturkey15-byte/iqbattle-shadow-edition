import { hash, wash, softBlob, wrap, type WorldDef } from './kit.ts';
export const WORLD: WorldDef = {
  id: 'ant-tide',
  align: 'chaotic',
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const s = Math.min(w, h);
    const ww = (x: number, m: number): number => {
      const f = wrap as unknown as (a: number, b: number) => number;
      const v = f(x, m);
      return Number.isFinite(v) ? v : ((x % m) + m) % m;
    };
    const blob = (x: number, y: number, r: number, col: string, a: number): void => {
      const prev = c.globalAlpha;
      c.globalAlpha = a;
      try {
        (softBlob as unknown as (...q: unknown[]) => void)(c, x, y, r, col);
      } catch { /* retain frame */ }
      c.globalAlpha = prev;
    };
    const bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#1c140c');
    bg.addColorStop(0.5, '#120d07');
    bg.addColorStop(1, '#20160d');
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    try {
      (wash as unknown as (...q: unknown[]) => void)(c, w, h, '#120d07', '#20160d');
    } catch { /* retain frame */ }
    const vg = c.createRadialGradient(w / 2, h / 2, s * 0.08, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0.62)');
    vg.addColorStop(0.55, 'rgba(0,0,0,0.26)');
    vg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = vg;
    c.fillRect(0, 0, w, h);
    for (let e = 0; e < 10; e++) {
      const e1 = hash(5000 + e * 3 + 1);
      const e3 = hash(5000 + e * 3 + 3);
      const ex = e1 * w;
      const ey = (e % 2 === 0) ? e3 * h * 0.2 : h - e3 * h * 0.2;
      const er = s * (0.1 + e1 * 0.12);
      const pulse = 0.1 + 0.07 * Math.sin(t * 6.28318 / 8500 + e1 * 6.28318);
      blob(ex, ey, er, '#6a4a28', pulse);
    }
    const oxs: number[] = [];
    const oys: number[] = [];
    const ors: number[] = [];
    for (let j = 0; j < 5; j++) {
      const ja = hash(900 + j * 13 + 1);
      const jb = hash(900 + j * 13 + 2);
      const jc = hash(900 + j * 13 + 3);
      const jd = hash(900 + j * 13 + 4);
      const bx = (0.12 + 0.76 * ja) * w;
      const by = (0.14 + 0.72 * jb) * h;
      const br = s * (0.07 + 0.1 * jc);
      const dx = Math.sin(t * 6.28318 / 11000 + jd * 6.28318) * 12;
      const dy = Math.cos(t * 6.28318 / 13000 + ja * 6.28318) * 10;
      oxs.push(bx + dx);
      oys.push(by + dy);
      ors.push(br);
    }
    for (let j = 0; j < 5; j++) {
      const ox = oxs[j];
      const oy = oys[j];
      const orr = ors[j];
      const tilt = hash(950 + j) * 3.14;
      c.globalAlpha = 0.92;
      c.fillStyle = '#0e0a06';
      c.beginPath();
      c.ellipse(ox, oy, orr, orr * 0.72, tilt, 0, 6.28318);
      c.fill();
      c.globalAlpha = 0.22;
      c.strokeStyle = '#6a4e2e';
      c.lineWidth = 1.5;
      c.beginPath();
      c.ellipse(ox, oy, orr, orr * 0.72, tilt, -0.6, 1.8);
      c.stroke();
      c.globalAlpha = 1;
      blob(ox, oy - orr * 0.3, orr * 1.1, 'rgba(120,86,48,0.35)', 0.15);
    }
    for (let b = 0; b < 3; b++) {
      const hb1 = hash(1200 + b * 7 + 1);
      const hb2 = hash(1200 + b * 7 + 2);
      const yb = h * (0.22 + 0.28 * hb1) + Math.sin(t * 6.28318 / 8000 + hb2 * 6.28318) * 18;
      c.globalAlpha = 0.12 + hb2 * 0.06;
      c.strokeStyle = b === 1 ? '#4a3520' : '#382917';
      c.lineWidth = s * (0.05 + 0.03 * hb1);
      c.beginPath();
      c.moveTo(-80, yb);
      c.bezierCurveTo(w * 0.25, yb + Math.sin(t * 6.28318 / 6500 + hb1 * 6.28) * 60, w * 0.55, yb - Math.sin(t * 6.28318 / 7200 + hb2 * 6.28) * 60, w + 80, yb + Math.cos(t * 6.28318 / 9000 + hb1 * 6.28) * 30);
      c.stroke();
      c.globalAlpha = 1;
    }
    const pal: string[] = ['#3d2c18', '#5d4426', '#8a6a3e', '#c49a5a'];
    const N = 720;
    for (let i = 0; i < N; i++) {
      const h1 = hash(i * 7 + 1);
      const h2 = hash(i * 7 + 2);
      const h3 = hash(i * 7 + 3);
      const h4 = hash(i * 7 + 4);
      const h5 = hash(i * 7 + 5);
      const dir = h5 < 0.22 ? -1 : 1;
      const spd = 0.016 + h2 * 0.03;
      const span = w + 240;
      const xx = ww(h1 * span + dir * t * spd, span) - 120;
      const ph1 = t * 6.28318 / 7200 + h4 * 6.28318;
      const ph2 = t * 6.28318 / 5100 + h1 * 6.28318;
      let yy = h3 * h + Math.sin(xx * 0.012 + ph1) * (14 + 24 * h2) + Math.sin(xx * 0.027 + ph2) * 9;
      for (let j = 0; j < 5; j++) {
        const dxo = xx - oxs[j];
        const dyo = yy - oys[j];
        const rr = ors[j] + 16;
        if (dxo * dxo + dyo * dyo < rr * rr) {
          const d = Math.sqrt(dxo * dxo + dyo * dyo) + 0.001;
          const push = (rr - d) / rr;
          yy += (dyo >= 0 ? 1 : -1) * push * rr * 1.15;
        }
      }
      const nx = (xx - w * 0.5) / (w * 0.5 + 1);
      const ny = (yy - h * 0.5) / (h * 0.5 + 1);
      const ed = Math.min(1, Math.sqrt(nx * nx + ny * ny) * 0.7071);
      c.globalAlpha = 0.1 + ed * 0.62 * (0.35 + 0.65 * h5);
      c.fillStyle = pal[Math.floor(h4 * 4) % 4];
      c.fillRect(xx, yy, 2 + h2 * 5 + ed * 3.5, 1 + h5 * 1.6);
    }
    c.globalAlpha = 1;
    const M = 160;
    for (let k = 0; k < M; k++) {
      const base = 20000 + k * 7;
      const a1 = hash(base + 1);
      const a2 = hash(base + 2);
      const a3 = hash(base + 3);
      const a4 = hash(base + 4);
      const a5 = hash(base + 5);
      const span2 = w + 240;
      const xx2 = ww(a1 * span2 + t * (0.02 + a2 * 0.028), span2) - 120;
      const ph = t * 6.28318 / 6800 + a4 * 6.28318;
      let yy2 = a3 * h + Math.sin(xx2 * 0.01 + ph) * (18 + 26 * a2) + Math.cos(xx2 * 0.022 - t * 6.28318 / 5900) * 10;
      for (let j = 0; j < 5; j++) {
        const dxo = xx2 - oxs[j];
        const dyo = yy2 - oys[j];
        const rr = ors[j] + 18;
        if (dxo * dxo + dyo * dyo < rr * rr) {
          const d = Math.sqrt(dxo * dxo + dyo * dyo) + 0.001;
          yy2 += (dyo >= 0 ? 1 : -1) * ((rr - d) / rr) * rr * 1.2;
        }
      }
      const nx2 = (xx2 - w * 0.5) / (w * 0.5 + 1);
      const ny2 = (yy2 - h * 0.5) / (h * 0.5 + 1);
      const ed2 = Math.min(1, Math.sqrt(nx2 * nx2 + ny2 * ny2) * 0.7071);
      const ang = Math.cos(xx2 * 0.012 + ph) * 0.45 + (a2 - 0.5) * 0.5;
      const blen = 3.2 + a5 * 3.4 + ed2 * 1.6;
      c.globalAlpha = 0.18 + ed2 * 0.65;
      c.fillStyle = a4 < 0.5 ? '#2b1f10' : '#7a5a34';
      c.save();
      c.translate(xx2, yy2);
      c.rotate(ang);
      c.beginPath();
      c.ellipse(0, 0, blen, blen * 0.38, 0, 0, 6.28318);
      c.fill();
      c.globalAlpha = 0.2 + ed2 * 0.6;
      c.fillStyle = '#d8b07a';
      c.beginPath();
      c.arc(blen * 0.85, 0, blen * 0.22, 0, 6.28318);
      c.fill();
      c.restore();
    }
    c.globalAlpha = 1;
    for (let mi = 0; mi < 48; mi++) {
      const q1 = hash(30000 + mi * 5 + 1);
      const q2 = hash(30000 + mi * 5 + 2);
      const q3 = hash(30000 + mi * 5 + 3);
      const mx = ww(q1 * (w + 100) + t * (0.006 + q2 * 0.01), w + 100) - 50;
      const my = ww(q2 * (h + 100) + t * (0.004 + q3 * 0.008) + q1 * 80, h + 100) - 50;
      const nx3 = (mx - w * 0.5) / (w * 0.5 + 1);
      const ny3 = (my - h * 0.5) / (h * 0.5 + 1);
      const ed3 = Math.min(1, Math.sqrt(nx3 * nx3 + ny3 * ny3) * 0.7071);
      c.globalAlpha = 0.05 + ed3 * 0.22;
      c.fillStyle = q3 < 0.5 ? '#8a6a44' : '#5a4126';
      c.beginPath();
      c.arc(mx, my, 0.8 + q2 * 2 + ed3 * 1.2, 0, 6.28318);
      c.fill();
    }
    c.globalAlpha = 1;
  },
};
