import { hash, wash, softBlob, wrap, type WorldDef } from './kit.ts';

void wash;
void softBlob;
void wrap;

export const WORLD: WorldDef = {
  id: 'acid-rain',
  align: 'bad',
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const ww = Math.max(w, 1);
    const hh = Math.max(h, 1);
    const cx = ww * 0.5;
    const cy = hh * 0.48;
    const horizon = hh * 0.66;
    const bg = c.createLinearGradient(0, 0, 0, hh);
    bg.addColorStop(0, '#0b1005');
    bg.addColorStop(0.45, '#131c0a');
    bg.addColorStop(0.68, '#1a2310');
    bg.addColorStop(1, '#050704');
    c.globalAlpha = 1;
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    const hz = c.createLinearGradient(0, horizon - hh * 0.22, 0, horizon + hh * 0.12);
    hz.addColorStop(0, 'rgba(120,150,40,0)');
    hz.addColorStop(0.55, 'rgba(140,170,55,0.20)');
    hz.addColorStop(1, 'rgba(60,80,25,0)');
    c.fillStyle = hz;
    c.fillRect(0, horizon - hh * 0.22, w, hh * 0.34);
    const gr = c.createLinearGradient(0, horizon, 0, hh);
    gr.addColorStop(0, '#101507');
    gr.addColorStop(1, '#040604');
    c.fillStyle = gr;
    c.fillRect(0, horizon, w, hh - horizon);
    for (let m = 0; m < 12; m++) {
      const hx = hash(15000 + m) * ww;
      const hw = ww * (0.12 + hash(15200 + m) * 0.18);
      const drift = Math.sin((t / 7000) * Math.PI * 2 + hash(15400 + m) * 6.28) * ww * 0.03;
      const x = hx + drift;
      const y = horizon - hh * 0.04 + (hash(15600 + m) - 0.5) * hh * 0.1;
      const edge = Math.abs(x - cx) / (ww * 0.5);
      const a = 0.05 + 0.12 * Math.min(1, edge);
      const col = hash(15800 + m) > 0.5 ? '190,210,80' : '130,160,50';
      const rg = c.createRadialGradient(x, y, 0, x, y, hw);
      rg.addColorStop(0, 'rgba(' + col + ',' + a.toFixed(3) + ')');
      rg.addColorStop(1, 'rgba(' + col + ',0)');
      c.globalAlpha = 1;
      c.fillStyle = rg;
      c.fillRect(x - hw, y - hw, hw * 2, hw * 2);
    }
    c.lineWidth = 1;
    for (let i = 0; i < 70; i++) {
      const bx = hash(100 + i) * (ww + 200) - 100;
      const off = hash(1100 + i);
      const period = 1900 + hash(2100 + i) * 2200;
      const prog = (off + t / period) % 1;
      const len = hh * (0.05 + hash(3100 + i) * 0.09);
      const slant = len * 0.28;
      const sway = Math.sin((t / 6200) * Math.PI * 2 + hash(4100 + i) * 6.28) * 12;
      const x = bx + sway * prog + prog * 24;
      const y = prog * (hh + 220) - 110;
      const ex = (x - cx) / (ww * 0.5);
      const ey = (y - cy) / (hh * 0.5);
      const dist = Math.sqrt(ex * ex + ey * ey);
      const fade = Math.max(0.12, Math.min(1, (dist - 0.2) / 0.8));
      const baseA = 0.06 + hash(6100 + i) * 0.12;
      c.globalAlpha = 1;
      c.strokeStyle = 'rgba(170,200,70,' + (baseA * fade).toFixed(3) + ')';
      c.beginPath();
      c.moveTo(x - slant, y - len);
      c.lineTo(x, y);
      c.stroke();
    }
    for (let k = 0; k < 26; k++) {
      const px = hash(10000 + k) * ww;
      const py = horizon + hash(10200 + k) * (hh - horizon - 6);
      const pr = 3 + hash(10400 + k) * 10;
      const period = 2600 + hash(10600 + k) * 3000;
      const ph = hash(10800 + k) * 6.28;
      const pulse = 0.5 + 0.5 * Math.sin((t / period) * Math.PI * 2 + ph);
      const ex = (px - cx) / (ww * 0.5);
      const ey = (py - cy) / (hh * 0.5);
      const dist = Math.sqrt(ex * ex + ey * ey);
      const fade = Math.max(0.15, Math.min(1, (dist - 0.15) / 0.7));
      c.globalAlpha = 0.55 * fade;
      c.fillStyle = 'rgba(6,9,3,0.9)';
      c.beginPath();
      c.ellipse(px, py, pr, pr * 0.45, 0, 0, Math.PI * 2);
      c.fill();
      const rr = pr * (0.6 + pulse * 0.9);
      c.globalAlpha = (0.05 + pulse * 0.22) * fade;
      c.strokeStyle = 'rgba(200,230,90,0.9)';
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(px, py, rr, rr * 0.45, 0, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;
    }
    for (let j = 0; j < 32; j++) {
      const bx = hash(5000 + j) * (ww + 160) - 80;
      const off = hash(5200 + j);
      const period = 1700 + hash(5400 + j) * 2000;
      const prog = (off + t / period) % 1;
      const len = hh * (0.08 + hash(5600 + j) * 0.12);
      const slant = len * 0.26;
      const sway = Math.sin((t / 4800) * Math.PI * 2 + hash(5800 + j) * 6.28) * 14;
      const x = bx + sway * prog + prog * 18;
      const y = prog * (hh + 200) - 100;
      const ex = (x - cx) / (ww * 0.5);
      const ey = (y - cy) / (hh * 0.5);
      const dist = Math.sqrt(ex * ex + ey * ey);
      const fade = Math.max(0.1, Math.min(1, (dist - 0.25) / 0.75));
      const baseA = 0.14 + hash(5900 + j) * 0.2;
      c.globalAlpha = 1;
      c.strokeStyle = 'rgba(205,225,85,' + (baseA * fade).toFixed(3) + ')';
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(x - slant, y - len);
      c.lineTo(x, y);
      c.stroke();
    }
    for (let n = 0; n < 22; n++) {
      const bx = hash(17000 + n) * ww;
      const by = hash(17200 + n) * hh;
      const dx = Math.sin((t / 5400) * Math.PI * 2 + hash(17400 + n) * 6.28) * 10;
      const dy = Math.cos((t / 6800) * Math.PI * 2 + hash(17600 + n) * 6.28) * 8;
      const x = bx + dx;
      const y = by + dy;
      const r = 0.8 + hash(17800 + n) * 2.2;
      const ex = (x - cx) / (ww * 0.5);
      const ey = (y - cy) / (hh * 0.5);
      const dist = Math.sqrt(ex * ex + ey * ey);
      const fade = Math.max(0.12, Math.min(1, (dist - 0.2) / 0.7));
      c.save();
      c.translate(x, y);
      c.globalAlpha = (0.1 + hash(17900 + n) * 0.25) * fade;
      c.fillStyle = 'rgba(190,215,95,0.9)';
      c.beginPath();
      c.arc(0, 0, r, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    const shade = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(ww, hh) * 0.58);
    shade.addColorStop(0, 'rgba(4,6,3,0.62)');
    shade.addColorStop(0.6, 'rgba(4,6,3,0.38)');
    shade.addColorStop(1, 'rgba(4,6,3,0)');
    c.globalAlpha = 1;
    c.fillStyle = shade;
    c.fillRect(0, 0, w, h);
    const glowA = 0.1 + 0.06 * (0.5 + 0.5 * Math.sin((t / 5200) * Math.PI * 2));
    const left = c.createLinearGradient(0, 0, ww * 0.18, 0);
    left.addColorStop(0, 'rgba(160,190,60,' + glowA.toFixed(3) + ')');
    left.addColorStop(1, 'rgba(160,190,60,0)');
    c.fillStyle = left;
    c.fillRect(0, 0, ww * 0.18, hh);
    const right = c.createLinearGradient(ww, 0, ww * 0.82, 0);
    right.addColorStop(0, 'rgba(160,190,60,' + glowA.toFixed(3) + ')');
    right.addColorStop(1, 'rgba(160,190,60,0)');
    c.fillStyle = right;
    c.fillRect(ww * 0.82, 0, ww * 0.18, hh);
    c.globalAlpha = 1;
  },
};
