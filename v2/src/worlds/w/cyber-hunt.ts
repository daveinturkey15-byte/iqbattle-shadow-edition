import { hash, wash, softBlob, wrap, type WorldDef } from './kit.ts';

export const WORLD: WorldDef = {
  id: 'cyber-hunt',
  align: 'chaotic',
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const TAU = Math.PI * 2;
    const cx = w * 0.5;
    const cy = h * 0.52;
    const horizon = h * 0.46;
    const md = Math.min(w, h);
    const mx = Math.max(w, h);
    c.fillStyle = '#04070d';
    c.fillRect(0, 0, w, h);
    try {
      (wash as unknown as (...a: unknown[]) => void)(c, w, h, '#0c1a26', '#04070d');
    } catch {
      c.fillStyle = '#04070d';
      c.fillRect(0, 0, w, h);
    }
    const blob = softBlob as unknown as (cc: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, al: number) => void;
    const bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0d2233');
    bg.addColorStop(0.42, '#070d15');
    bg.addColorStop(0.62, '#05080e');
    bg.addColorStop(1, '#020409');
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    try {
      blob(c, 0, 0, md * 0.75, '#0e5a74', 0.5);
      blob(c, w, 0, md * 0.7, '#5a1e5e', 0.42);
      blob(c, 0, h, md * 0.8, '#0e4a5e', 0.5);
      blob(c, w, h, md * 0.75, '#7a2a3a', 0.36);
      blob(c, w * 0.5, h * 0.08, md * 0.5, '#123a4d', 0.35);
    } catch {
      c.globalAlpha = 1;
    }
    const fg = c.createLinearGradient(0, horizon, 0, h);
    fg.addColorStop(0, '#0a1a26');
    fg.addColorStop(0.35, '#071019');
    fg.addColorStop(1, '#03060c');
    c.fillStyle = fg;
    c.fillRect(0, horizon, w, h - horizon);
    c.lineWidth = 1;
    c.strokeStyle = '#1e4a5e';
    c.globalAlpha = 0.55;
    c.beginPath();
    for (let i = -12; i <= 12; i++) {
      const j = hash(200 + i * 11 + 500);
      const spread = 1 + (j - 0.5) * 0.12;
      const xb = cx + i * (w / 11) * spread;
      const xt = cx + i * (w / 90) * spread;
      c.moveTo(xt, horizon);
      c.lineTo(xb, h);
    }
    c.stroke();
    c.globalAlpha = 0.5;
    for (let j = 0; j < 11; j++) {
      const p = wrap(hash(300 + j * 17) + t / 5200, 1);
      const y = horizon + (h - horizon) * Math.pow(p, 2.1);
      const a = 0.06 + p * 0.4;
      c.globalAlpha = a;
      c.strokeStyle = j % 3 === 0 ? '#2a6a82' : '#1a3f52';
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    c.globalAlpha = 0.7;
    c.strokeStyle = '#35d0e8';
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(0, horizon);
    c.lineTo(w, horizon);
    c.stroke();
    c.lineWidth = 1;
    const sp1 = wrap(t / 9000, 1);
    const sx1 = sp1 * (w + 420) - 210;
    const g1 = c.createLinearGradient(sx1 - 110, 0, sx1 + 110, 0);
    g1.addColorStop(0, 'rgba(40,200,230,0)');
    g1.addColorStop(0.5, 'rgba(60,220,245,0.16)');
    g1.addColorStop(1, 'rgba(40,200,230,0)');
    c.globalAlpha = 1;
    c.fillStyle = g1;
    c.fillRect(sx1 - 110, 0, 220, h);
    c.globalAlpha = 0.8;
    c.strokeStyle = 'rgba(120,240,255,0.5)';
    c.beginPath();
    c.moveTo(sx1, 0);
    c.lineTo(sx1, h);
    c.stroke();
    const sp2 = wrap(0.6 - t / 13500, 1);
    const sx2 = sp2 * (w + 420) - 210;
    const g2 = c.createLinearGradient(sx2 - 80, 0, sx2 + 80, 0);
    g2.addColorStop(0, 'rgba(230,60,180,0)');
    g2.addColorStop(0.5, 'rgba(230,70,180,0.1)');
    g2.addColorStop(1, 'rgba(230,60,180,0)');
    c.globalAlpha = 1;
    c.fillStyle = g2;
    c.fillRect(sx2 - 80, 0, 160, h);
    c.save();
    c.translate(0, 0);
    c.rotate(0.12 + 0.05 * Math.sin(TAU * t / 12000));
    c.globalAlpha = 0.1;
    c.fillStyle = '#1ad0e8';
    c.fillRect(-w * 0.2, -h * 0.2, w * 0.5, h * 1.6);
    c.restore();
    for (let k = 0; k < 5; k++) {
      const ang = hash(500 + k * 13) * TAU;
      const rad = 0.58 + hash(501 + k * 13) * 0.42;
      const baseX = cx + Math.cos(ang) * w * 0.42 * rad;
      const baseY = cy + Math.sin(ang) * h * 0.42 * rad;
      const px = baseX + Math.sin(TAU * t / 7400 + hash(502 + k * 13) * TAU) * 12;
      const py = baseY + Math.cos(TAU * t / 6800 + hash(503 + k * 13) * TAU) * 10;
      const period = 4300 + hash(504 + k * 13) * 3800;
      const ph = wrap(t / period + hash(505 + k * 13), 1);
      const fade = Math.sin(ph * Math.PI);
      const rr = (14 + hash(506 + k * 13) * 26) * (1.25 - fade * 0.35);
      const al = 0.08 + fade * 0.62;
      c.globalAlpha = al;
      c.strokeStyle = k % 2 === 0 ? '#46e6ff' : '#ff5a9a';
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(px, py, rr, 0, TAU);
      c.stroke();
      c.beginPath();
      c.arc(px, py, rr * 0.28 + 2, -Math.PI * 0.5, -Math.PI * 0.5 + ph * TAU);
      c.stroke();
      const e = rr * 1.45;
      c.beginPath();
      c.moveTo(px - e, py - e);
      c.lineTo(px - e + 10, py - e);
      c.moveTo(px - e, py - e);
      c.lineTo(px - e, py - e + 10);
      c.moveTo(px + e, py - e);
      c.lineTo(px + e - 10, py - e);
      c.moveTo(px + e, py - e);
      c.lineTo(px + e, py - e + 10);
      c.moveTo(px - e, py + e);
      c.lineTo(px - e + 10, py + e);
      c.moveTo(px - e, py + e);
      c.lineTo(px - e, py + e - 10);
      c.moveTo(px + e, py + e);
      c.lineTo(px + e - 10, py + e);
      c.moveTo(px + e, py + e);
      c.lineTo(px + e, py + e - 10);
      c.stroke();
      c.globalAlpha = al * 0.9;
      c.fillStyle = '#bff2ff';
      c.beginPath();
      c.arc(px, py, 1.6, 0, TAU);
      c.fill();
    }
    for (let i = 0; i < 42; i++) {
      const y = hash(101 + i * 7) * h;
      const span = w + 260;
      const speed = 0.018 + hash(102 + i * 7) * 0.05;
      const x = wrap(hash(103 + i * 7) * span + t * speed, span) - 130;
      const len = 22 + hash(104 + i * 7) * 110;
      const edge = Math.abs(x - cx) / (w * 0.34) + Math.abs(y - cy) / (h * 0.62);
      const al = 0.03 + 0.34 * Math.min(1, Math.max(0, edge - 0.15));
      const pick = hash(105 + i * 7);
      c.globalAlpha = al;
      c.fillStyle = pick < 0.55 ? '#35d8f2' : pick < 0.8 ? '#ff5a9a' : '#ffb54d';
      c.fillRect(x - len * 0.5, y, len, 1.3);
      c.globalAlpha = al * 0.9;
      c.beginPath();
      c.arc(x + len * 0.5, y, 1.4, 0, TAU);
      c.fill();
    }
    for (let i = 0; i < 14; i++) {
      const x = hash(700 + i * 19) * w;
      const span = h + 200;
      const speed = 0.012 + hash(701 + i * 19) * 0.03;
      const y = wrap(hash(702 + i * 19) * span - t * speed, span) - 100;
      const len = 12 + hash(703 + i * 19) * 46;
      c.globalAlpha = 0.1 + hash(704 + i * 19) * 0.22;
      c.fillStyle = '#2ab8d2';
      c.fillRect(x, y, 1.2, len);
    }
    const vg = c.createRadialGradient(cx, cy, 0, cx, cy, mx * 0.72);
    vg.addColorStop(0, 'rgba(2,4,9,0.62)');
    vg.addColorStop(0.45, 'rgba(2,4,9,0.38)');
    vg.addColorStop(0.75, 'rgba(2,4,9,0.08)');
    vg.addColorStop(1, 'rgba(2,6,12,0)');
    c.globalAlpha = 1;
    c.fillStyle = vg;
    c.fillRect(0, 0, w, h);
    c.globalAlpha = 1;
  },
};
