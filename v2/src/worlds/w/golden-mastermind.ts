import { hash, wash, softBlob, wrap, type WorldDef } from './kit.ts';

const H = hash as unknown as (n: number) => number;
const WP = wrap as unknown as (x: number, m: number) => number;
const WB = wash as unknown as (c: CanvasRenderingContext2D, w: number, h: number, t: number) => void;
const SB = softBlob as unknown as (c: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, a: number) => void;

function sw(x: number, m: number): number {
  try {
    const v = WP(x, m);
    if (Number.isFinite(v)) return v;
  } catch { /* fall through */ }
  const r = x % m;
  return r < 0 ? r + m : r;
}

export const WORLD: WorldDef = {
  id: 'golden-mastermind',
  align: 'good',
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const m = Math.min(w, h);
    const D = Math.sqrt(w * w + h * h);
    c.globalAlpha = 1;
    c.fillStyle = '#0e0803';
    c.fillRect(0, 0, w, h);
    try { WB(c, w, h, t); } catch { /* base remains */ }
    const bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#2c1c07');
    bg.addColorStop(0.32, '#150d05');
    bg.addColorStop(0.5, '#0d0703');
    bg.addColorStop(0.68, '#150d05');
    bg.addColorStop(1, '#291a07');
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    const pulseA = 0.5 + 0.5 * Math.sin((t / 7000) * Math.PI * 2);
    const pulseB = 0.5 + 0.5 * Math.sin((t / 9000) * Math.PI * 2 + 2.1);
    try {
      SB(c, w * 0.06, h * 0.5, m * 0.42, '#8a4d12', 0.42 + pulseA * 0.1);
      SB(c, w * 0.94, h * 0.5, m * 0.42, '#8a4d12', 0.42 + pulseB * 0.1);
      SB(c, w * 0.5, h * 0.06, m * 0.38, '#a86a1c', 0.35 + pulseB * 0.1);
      SB(c, w * 0.5, h * 0.94, m * 0.38, '#a86a1c', 0.35 + pulseA * 0.1);
      SB(c, w * 0.1, h * 0.1, m * 0.3, '#c99a3a', 0.3);
      SB(c, w * 0.9, h * 0.9, m * 0.3, '#c99a3a', 0.3);
    } catch { /* manual glows below cover */ }
    c.save();
    c.globalAlpha = 0.5;
    const gl = c.createRadialGradient(w * 0.06, h * 0.5, 0, w * 0.06, h * 0.5, m * 0.55);
    gl.addColorStop(0, 'rgba(198,128,34,0.32)');
    gl.addColorStop(1, 'rgba(198,128,34,0)');
    c.fillStyle = gl;
    c.fillRect(0, 0, w, h);
    c.restore();
    c.save();
    c.globalAlpha = 0.5;
    const gr = c.createRadialGradient(w * 0.94, h * 0.5, 0, w * 0.94, h * 0.5, m * 0.55);
    gr.addColorStop(0, 'rgba(198,128,34,0.32)');
    gr.addColorStop(1, 'rgba(198,128,34,0)');
    c.fillStyle = gr;
    c.fillRect(0, 0, w, h);
    c.restore();
    c.save();
    c.translate(cx, cy);
    c.rotate(Math.sin((t / 16000) * Math.PI * 2) * 0.08);
    c.translate(-cx, -cy);
    const step = m / 11;
    const drift = sw(t / 16000, 1) * step;
    c.lineWidth = 1;
    for (let k = -12; k < 24; k++) {
      const f1 = H(600 + k + 12);
      const f2 = H(700 + k + 12);
      c.globalAlpha = 0.05 + f1 * 0.07;
      c.strokeStyle = '#9a6f24';
      c.beginPath();
      c.moveTo(k * step + drift - 20, -20);
      c.lineTo(k * step + drift - 20 + h * 0.5, h + 20);
      c.stroke();
      c.globalAlpha = 0.04 + f2 * 0.06;
      c.strokeStyle = '#7a551c';
      c.beginPath();
      c.moveTo(k * step - drift + w + 20, -20);
      c.lineTo(k * step - drift + w + 20 - h * 0.5, h + 20);
      c.stroke();
    }
    c.restore();
    c.save();
    c.translate(cx, cy);
    const rot = (t / 18000) * Math.PI * 2;
    c.rotate(rot);
    for (let i = 0; i < 14; i++) {
      const f1 = H(100 + i);
      const f2 = H(200 + i);
      const f3 = H(300 + i);
      const ang = (i / 14) * Math.PI * 2 + f1 * 0.6;
      const ox = Math.cos(ang) * w * 0.36;
      const oy = Math.sin(ang) * h * 0.36;
      const rr = m * (0.055 + f2 * 0.075);
      const tw = 0.5 + 0.5 * Math.sin((t / 6500) * Math.PI * 2 + f3 * Math.PI * 2);
      c.save();
      c.translate(ox, oy);
      c.rotate(ang + (t / 12000) * Math.PI * 2 * (f2 > 0.5 ? 1 : -1));
      c.globalAlpha = 0.18 + tw * 0.22;
      c.strokeStyle = f1 > 0.5 ? '#e8b64a' : '#a86f1f';
      c.lineWidth = 1 + f2 * 2.2;
      c.beginPath();
      c.arc(0, 0, rr, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = c.globalAlpha * 0.7;
      c.strokeStyle = '#f3d27a';
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(0, 0, rr * 0.62, rr * 0.92, 0, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }
    c.restore();
    for (let i = 0; i < 26; i++) {
      const fx = H(800 + i);
      const fy = H(900 + i);
      const fr = H(850 + i);
      const gx = fx * w;
      const gy = fy * h;
      const dx = (gx - cx) / w;
      const dy = (gy - cy) / h;
      const edge = Math.sqrt(dx * dx + dy * dy) * 2;
      if (edge < 0.55) continue;
      const s = 4 + fr * 10;
      const rot2 = fr * Math.PI + (t / 14000) * Math.PI * 2 * (i % 2 === 0 ? 1 : -1);
      c.save();
      c.translate(gx, gy);
      c.rotate(rot2);
      c.globalAlpha = 0.1 + fr * 0.18;
      c.strokeStyle = '#e0aa42';
      c.lineWidth = 1;
      c.beginPath();
      c.roundRect(-s * 0.5, -s * 0.5, s, s, 2);
      c.stroke();
      c.restore();
    }
    c.save();
    c.translate(cx, cy);
    for (let i = 0; i < 3; i++) {
      const f = H(1500 + i);
      const rr = m * (0.42 + f * 0.18);
      const a0 = (t / 20000) * Math.PI * 2 + f * Math.PI * 2;
      c.save();
      c.rotate(a0 * (i % 2 === 0 ? 1 : -1));
      c.globalAlpha = 0.1 + f * 0.12;
      c.strokeStyle = i === 1 ? '#f0c25e' : '#8f5f1e';
      c.lineWidth = 1 + f * 1.5;
      c.beginPath();
      c.ellipse(0, 0, rr, rr * 0.62, 0, 0.3, Math.PI * 1.4);
      c.stroke();
      c.restore();
    }
    c.restore();
    for (let i = 0; i < 42; i++) {
      const fx = H(1100 + i);
      const fy = H(1200 + i);
      const fs = H(1300 + i);
      const fa = H(1400 + i);
      const speed = 0.25 + fs * 0.6;
      const yy = (1 - sw(fy + (t / 22000) * speed, 1)) * h;
      const wob = Math.sin((t / 9000) * Math.PI * 2 + fy * 6.28) * 0.03;
      const xx = sw(fx + wob + (t / 60000) * (fa - 0.5), 1) * w;
      const twk = 0.5 + 0.5 * Math.sin((t / 3800) * Math.PI * 2 + fa * 6.28);
      const rad = 0.8 + fs * 2.1;
      const ex = (xx - cx) / (D * 0.5);
      const ey = (yy - cy) / (D * 0.5);
      const edge = Math.sqrt(ex * ex + ey * ey);
      c.globalAlpha = (0.08 + twk * 0.32) * (0.25 + edge * 0.9);
      c.fillStyle = fa > 0.4 ? '#ffcf6e' : '#c98f2e';
      c.beginPath();
      c.arc(xx, yy, rad, 0, Math.PI * 2);
      c.fill();
    }
    const vg = c.createRadialGradient(cx, cy, m * 0.04, cx, cy, D * 0.58);
    vg.addColorStop(0, 'rgba(7,4,1,0.82)');
    vg.addColorStop(0.42, 'rgba(9,5,2,0.58)');
    vg.addColorStop(0.72, 'rgba(9,5,2,0.18)');
    vg.addColorStop(1, 'rgba(9,5,2,0)');
    c.globalAlpha = 1;
    c.fillStyle = vg;
    c.fillRect(0, 0, w, h);
    c.globalAlpha = 1;
  },
};
