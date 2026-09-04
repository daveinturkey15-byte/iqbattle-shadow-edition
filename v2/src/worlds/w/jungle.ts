import { hash, wash, softBlob, wrap, type WorldDef } from './kit.ts';

function leaf(c: CanvasRenderingContext2D, x: number, y: number, s: number, ang: number, col: string, alpha: number): void {
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.globalAlpha = alpha;
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(0, -s * 0.55);
  c.bezierCurveTo(s * 0.55, -s * 0.35, s * 0.45, s * 0.35, 0, s * 0.55);
  c.bezierCurveTo(-s * 0.45, s * 0.35, -s * 0.55, -s * 0.35, 0, -s * 0.55);
  c.fill();
  c.globalAlpha = alpha * 0.5;
  c.strokeStyle = '#081b10';
  c.lineWidth = Math.max(1, s * 0.05);
  c.beginPath();
  c.moveTo(0, -s * 0.42);
  c.quadraticCurveTo(s * 0.07, 0, 0, s * 0.42);
  c.stroke();
  c.restore();
}

export const WORLD: WorldDef = {
  id: 'jungle',
  align: 'neutral',
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const maxR = Math.sqrt(w * w + h * h) * 0.5;
    const minD = Math.min(w, h);
    try {
      const washAny = wash as unknown as (ctx: CanvasRenderingContext2D, ww: number, hh: number, top: string, bot: string) => void;
      washAny(c, w, h, '#123620', '#040c07');
    } catch {
      c.fillStyle = '#07150e';
      c.fillRect(0, 0, w, h);
    }
    const bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#163b24');
    bg.addColorStop(0.42, '#0a1e13');
    bg.addColorStop(1, '#040c07');
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    const blob = softBlob as unknown as (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, al: number) => void;
    for (let i = 0; i < 8; i++) {
      const hx = hash(11 + i * 5);
      const hy = hash(12 + i * 5);
      const hr = hash(13 + i * 5);
      const side = hash(14 + i * 5);
      let bx = hx * w;
      let by = hy * h;
      if (side < 0.4) by = hy * h * 0.24;
      else if (side < 0.75) bx = hx < 0.5 ? hx * w * 0.3 : w - (1 - hx) * w * 0.3;
      else by = h - hy * h * 0.26;
      const br = minD * (0.16 + hr * 0.22);
      const drift = Math.sin((Math.PI * 2 * t) / 16000 + hx * 6.28) * 14;
      try {
        blob(c, bx + drift, by, br, '#2d6b3a', 0.32);
      } catch {
        c.globalAlpha = 0.32;
        c.fillStyle = '#2d6b3a';
        c.beginPath();
        c.arc(bx + drift, by, br, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
      }
    }
    for (let k = 0; k < 5; k++) {
      const hk = hash(301 + k * 4);
      const hk2 = hash(302 + k * 4);
      const baseX = w * (0.08 + 0.21 * k) + (hk - 0.5) * w * 0.12;
      const sway = Math.sin((Math.PI * 2 * t) / 13000 + hk * 6.28) * 26;
      const tilt = 0.26 + Math.sin((Math.PI * 2 * t) / 17000 + hk2 * 6.28) * 0.035;
      const bw = 34 + hk2 * 62;
      const sh = h * 1.25;
      c.save();
      c.translate(baseX + sway, -30);
      c.rotate(tilt);
      const g = c.createLinearGradient(0, 0, 0, sh);
      g.addColorStop(0, 'rgba(214,242,170,0.6)');
      g.addColorStop(0.6, 'rgba(190,230,150,0.16)');
      g.addColorStop(1, 'rgba(190,230,150,0)');
      c.fillStyle = g;
      c.globalAlpha = 0.09 + hk * 0.05;
      c.fillRect(-bw * 0.5, 0, bw, sh);
      c.restore();
    }
    for (let i = 0; i < 24; i++) {
      const b = 501 + i * 5;
      const px = hash(b) * (w + 160) - 80;
      const py = hash(b + 1) * h;
      const nx = (px - cx) / (w * 0.34);
      const ny = (py - cy) / (h * 0.34);
      if (nx * nx + ny * ny < 1) continue;
      const sp = 0.004 + hash(b + 2) * 0.007;
      const dx = wrap(px + t * sp, w + 160) - 80;
      const dy = py + Math.sin((Math.PI * 2 * t) / 11000 + hash(b + 3) * 6.28) * 9;
      const s = 11 + hash(b + 2) * 15;
      const ang = hash(b + 4) * 6.28 + Math.sin((Math.PI * 2 * t) / 9000 + hash(b + 3) * 6.28) * 0.18;
      const col = hash(b + 1) > 0.5 ? '#14402a' : '#1a4d2d';
      leaf(c, dx, dy, s, ang, col, 0.82);
    }
    for (let i = 0; i < 20; i++) {
      const b = 901 + i * 5;
      const px = hash(b) * (w + 200) - 100;
      const py = hash(b + 1) * h;
      const nx = (px - cx) / (w * 0.32);
      const ny = (py - cy) / (h * 0.32);
      if (nx * nx + ny * ny < 0.72) continue;
      const sp = 0.003 + hash(b + 2) * 0.005;
      const dx = wrap(px - t * sp, w + 200) - 100;
      const dy = py + Math.cos((Math.PI * 2 * t) / 14000 + hash(b + 3) * 6.28) * 11;
      const s = 22 + hash(b + 2) * 22;
      const ang = hash(b + 4) * 6.28 + Math.sin((Math.PI * 2 * t) / 10000 + hash(b) * 6.28) * 0.14;
      const col = hash(b + 1) > 0.5 ? '#1e5c33' : '#256b3a';
      leaf(c, dx, dy, s, ang, col, 0.88);
    }
    for (let i = 0; i < 12; i++) {
      const b = 1301 + i * 5;
      const edge = hash(b);
      let px = hash(b + 1) * w;
      let py = hash(b + 2) * h;
      if (edge < 0.42) py = hash(b + 2) * h * 0.2;
      else if (edge < 0.72) px = hash(b + 1) < 0.5 ? hash(b + 1) * w * 0.22 : w - (1 - hash(b + 1)) * w * 0.22;
      else py = h - hash(b + 2) * h * 0.22;
      const dx = px + Math.sin((Math.PI * 2 * t) / 12000 + hash(b + 3) * 6.28) * 12;
      const dy = py + Math.cos((Math.PI * 2 * t) / 15000 + hash(b + 4) * 6.28) * 10;
      const s = 46 + hash(b + 3) * 44;
      const ang = hash(b + 4) * 6.28 + Math.sin((Math.PI * 2 * t) / 18000) * 0.1;
      leaf(c, dx, dy, s, ang, '#08170f', 0.94);
    }
    for (let i = 0; i < 34; i++) {
      const b = 1701 + i * 6;
      const bx = hash(b) * w;
      const fall = 0.006 + hash(b + 1) * 0.01;
      const by = wrap(hash(b + 2) * h - t * fall, h);
      const sx = bx + Math.sin((Math.PI * 2 * t) / 7000 + hash(b + 3) * 6.28) * 18;
      const sy = by + Math.cos((Math.PI * 2 * t) / 5000 + hash(b + 4) * 6.28) * 8;
      const tw = 0.5 + 0.5 * Math.sin((Math.PI * 2 * t) / 3600 + hash(b + 5) * 6.28);
      const dxn = (sx - cx) / maxR;
      const dyn = (sy - cy) / maxR;
      const edgeF = Math.min(1, 0.25 + (dxn * dxn + dyn * dyn) * 1.6);
      const r = 0.9 + hash(b + 3) * 1.9;
      c.globalAlpha = (0.12 + tw * 0.34) * edgeF;
      c.fillStyle = hash(b + 4) > 0.5 ? '#d2eba6' : '#a8d68a';
      c.beginPath();
      c.arc(sx, sy, r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    const vg = c.createRadialGradient(cx, cy, minD * 0.16, cx, cy, maxR * 0.78);
    vg.addColorStop(0, 'rgba(2,8,5,0.62)');
    vg.addColorStop(0.55, 'rgba(2,8,5,0.26)');
    vg.addColorStop(1, 'rgba(2,8,5,0)');
    c.fillStyle = vg;
    c.fillRect(0, 0, w, h);
    c.globalAlpha = 1;
  },
};
