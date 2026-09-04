import { hash, wash, softBlob, wrap, type WorldDef } from './kit.ts';

export const WORLD: WorldDef = {
  id: 'dolphin-pod',
  align: 'good',
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    wash(c, w, h, '#174f61', '#061d29');
    const mi = Math.min(w, h);
    const TAU = Math.PI * 2;
    const u = mi / 600;
    softBlob(c, w * 0.08, h * -0.05, w * 0.35, h * 0.28, '120,210,225', 0.32);
    softBlob(c, w * 0.92, h * -0.05, w * 0.35, h * 0.28, '120,210,225', 0.32);
    softBlob(c, w * 0.06, h * 0.94, w * 0.30, h * 0.22, '232,205,150', 0.20);
    softBlob(c, w * 0.94, h * 0.94, w * 0.30, h * 0.22, '232,205,150', 0.20);
    softBlob(c, w * 0.5, h * 0.05, w * 0.45, h * 0.20, '170,235,245', 0.18);
    for (let i = 0; i < 4; i++) {
      const hh = hash(50 + i);
      const left = i < 2;
      const bx = left ? w * (0.06 + hh * 0.16) : w * (0.78 + hh * 0.16);
      const sway = Math.sin(t * TAU / 9000 + hh * TAU) * w * 0.02;
      const topW = (30 + hh * 40) * u, botW = (90 + hh * 70) * u;
      c.save();
      c.globalAlpha = 0.10 + hh * 0.08;
      c.fillStyle = '#bfe9f2';
      c.beginPath();
      c.moveTo(bx - topW, -10);
      c.lineTo(bx + topW, -10);
      c.lineTo(bx + sway + botW, h * 0.75);
      c.lineTo(bx + sway - botW, h * 0.75);
      c.closePath();
      c.fill();
      c.restore();
    }
    softBlob(c, w * 0.12, h * 0.42, w * 0.20, h * 0.22, '32,110,132', 0.35);
    softBlob(c, w * 0.88, h * 0.46, w * 0.20, h * 0.24, '32,110,132', 0.35);
    const breathe = Math.sin(t * TAU / 12000) * h * 0.008;
    const sandTop = h * 0.80 + breathe;
    const sg = c.createLinearGradient(0, sandTop, 0, h);
    sg.addColorStop(0, '#7a6a4d');
    sg.addColorStop(1, '#1e1a11');
    c.fillStyle = sg;
    c.beginPath();
    c.moveTo(0, h);
    c.lineTo(0, sandTop);
    c.bezierCurveTo(w * 0.25, sandTop - h * 0.03, w * 0.35, sandTop + h * 0.03, w * 0.5, sandTop);
    c.bezierCurveTo(w * 0.65, sandTop - h * 0.025, w * 0.78, sandTop + h * 0.025, w, sandTop - h * 0.01);
    c.lineTo(w, h);
    c.closePath();
    c.fill();
    for (let i = 0; i < 26; i++) {
      const h1 = hash(200 + i), h2 = hash(500 + i), h3 = hash(800 + i);
      const bx = h1 * w;
      const edge = Math.abs(bx / w - 0.5) * 2;
      const by = h * 0.84 + h2 * h * 0.14;
      const rx = (18 + h3 * 52) * u, ry = (6 + h2 * 14) * u;
      const wob = Math.sin(t * TAU / 4500 + h1 * TAU + by * 0.05) * 6 * u;
      const rot = (h2 - 0.5) * 0.7 + Math.sin(t * TAU / 7000 + h3 * TAU) * 0.15;
      c.save();
      c.translate(bx + wob, by);
      c.rotate(rot);
      c.globalAlpha = 0.07 + edge * 0.30;
      c.strokeStyle = '#c9f2ff';
      c.lineWidth = 1 + edge * 1.6;
      c.beginPath();
      c.ellipse(0, 0, rx, ry, 0, 0, TAU);
      c.stroke();
      c.restore();
    }
    for (let i = 0; i < 16; i++) {
      const h1 = hash(1100 + i), h2 = hash(1300 + i);
      const bx = h1 * w;
      const edge = Math.abs(bx / w - 0.5) * 2;
      const by = h * 0.88 + h2 * h * 0.10;
      const r = (10 + h1 * 26) * u;
      const a0 = h2 * TAU + Math.sin(t * TAU / 6000 + h1 * TAU) * 0.4;
      c.save();
      c.globalAlpha = 0.06 + edge * 0.22;
      c.strokeStyle = '#e8fbff';
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(bx, by, r, a0, a0 + 1.4);
      c.stroke();
      c.restore();
    }
    for (let col = 0; col < 4; col++) {
      const hc = hash(1500 + col);
      const baseX = w * (0.10 + col * 0.26 + hc * 0.06);
      const speed = 0.022 + hc * 0.022;
      const range = h + 80;
      for (let j = 0; j < 10; j++) {
        const h1 = hash(1600 + col * 40 + j), h2 = hash(1800 + col * 40 + j);
        const prog = wrap(h1 * range + t * speed * (0.7 + h2 * 0.6), range);
        const by = h + 20 - prog;
        const wob = Math.sin(t * TAU / 3800 + h1 * TAU + by * 0.02) * 10 * u;
        const r = (1.5 + h2 * 4.5) * u;
        const edge = Math.abs(baseX / w - 0.5) * 2;
        c.save();
        c.globalAlpha = 0.12 + edge * 0.18 + h1 * 0.10;
        c.fillStyle = '#d8f4fa';
        c.beginPath();
        c.arc(baseX + wob + (h2 - 0.5) * 18 * u, by, r, 0, TAU);
        c.fill();
        c.restore();
      }
    }
    for (let d = 0; d < 3; d++) {
      const hd = hash(2200 + d), hd2 = hash(2300 + d);
      const period = 21000 + hd * 9000;
      const span = w + 500;
      const px = wrap(hd * span + t * (span / period), span) - 250;
      const lane = d === 2 ? 0.78 : 0.20 + d * 0.10 + hd2 * 0.06;
      const py = h * lane + Math.sin((px / span) * Math.PI * 2 + hd * TAU) * h * 0.06;
      const dir = 0.08 + Math.cos((px / span) * Math.PI * 2 + hd * TAU) * 0.18;
      const len = mi * (0.09 + hd2 * 0.05), wid = len * 0.26;
      c.save();
      c.translate(px, py);
      c.rotate(dir);
      c.globalAlpha = 0.60;
      c.fillStyle = '#cfe2e8';
      c.beginPath();
      c.ellipse(0, 0, len, wid, 0, 0, TAU);
      c.fill();
      c.beginPath();
      c.moveTo(-len * 0.85, 0);
      c.lineTo(-len * 1.45, -len * 0.38);
      c.lineTo(-len * 1.22, 0);
      c.lineTo(-len * 1.45, len * 0.38);
      c.closePath();
      c.fill();
      c.beginPath();
      c.moveTo(-len * 0.05, -wid * 0.85);
      c.quadraticCurveTo(len * 0.05, -wid * 2.0, len * 0.32, -wid * 0.9);
      c.closePath();
      c.fill();
      c.restore();
    }
    for (let i = 0; i < 22; i++) {
      const h1 = hash(2600 + i), h2 = hash(2800 + i), h3 = hash(3000 + i);
      const mx = wrap(h1 * w + t * (0.008 + h3 * 0.012), w);
      const my = wrap(h2 * h + t * (0.006 + h1 * 0.010), h);
      const r = (0.8 + h3 * 1.8) * u;
      c.save();
      c.globalAlpha = 0.10 + h2 * 0.18;
      c.fillStyle = '#cdeef5';
      c.beginPath();
      c.arc(mx, my, r, 0, TAU);
      c.fill();
      c.restore();
    }
    softBlob(c, w / 2, h / 2, w * 0.42, h * 0.40, '4,15,24', 0.58);
    softBlob(c, w / 2, h / 2, w * 0.28, h * 0.26, '5,20,31', 0.42);
    c.globalAlpha = 1;
  },
};
