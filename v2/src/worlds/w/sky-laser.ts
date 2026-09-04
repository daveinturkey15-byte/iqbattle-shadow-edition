import { hash, wash, softBlob, wrap, type WorldDef } from './kit.ts';

export const WORLD: WorldDef = {
  id: 'sky-laser',
  align: 'bad',
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const groundY = h * 0.82;
    const minDim = Math.min(w, h);
    const sway = Math.sin(t / 7200) * w * 0.016;
    const bx = w * 0.76 + sway;
    const beamW = minDim * 0.055 + w * 0.008;
    wash(c, w, h, '#0a1226', '#020409');
    softBlob(c, w * 0.06, h * 0.42, w * 0.32, h * 0.42, '38,80,140', 0.22);
    softBlob(c, w * 0.94, h * 0.55, w * 0.30, h * 0.50, '52,120,180', 0.20);
    softBlob(c, bx, h * 0.02, w * 0.22, h * 0.20, '90,170,255', 0.28);
    softBlob(c, w * 0.12, h * 0.88, w * 0.30, h * 0.26, '20,50,90', 0.25);
    for (let i = 0; i < 70; i++) {
      const hx = hash(i * 2 + 1);
      const hy = hash(i * 2 + 501);
      const sx = hx * w;
      const sy = hy * h * 0.72;
      const tw = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t / 3400 + hx * 12.5));
      c.globalAlpha = 0.08 + tw * 0.30 * (1 - sy / h);
      c.fillStyle = '#9db8d8';
      const sr = 0.6 + hash(i + 901) * 1.4;
      c.beginPath();
      c.arc(sx, sy, sr, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    c.fillStyle = '#0a1322';
    c.beginPath();
    c.moveTo(0, groundY + minDim * 0.02);
    for (let i = 0; i <= 24; i++) {
      const px = (i / 24) * w;
      const ridge = hash(500 + i) * minDim * 0.09;
      const py = groundY - ridge + Math.sin(i * 1.7) * minDim * 0.012;
      c.lineTo(px, py);
    }
    c.lineTo(w, groundY + minDim * 0.02);
    c.lineTo(w, groundY);
    c.lineTo(0, groundY);
    c.closePath();
    c.fill();
    const gg = c.createLinearGradient(0, groundY, 0, h);
    gg.addColorStop(0, '#0d1626');
    gg.addColorStop(0.35, '#070c16');
    gg.addColorStop(1, '#020409');
    c.fillStyle = gg;
    c.fillRect(0, groundY, w, h - groundY);
    const pulse = 0.72 + 0.28 * Math.sin(t / 2300 + 1.2);
    const outer = beamW * 4.2;
    const og = c.createLinearGradient(bx - outer, 0, bx + outer, 0);
    og.addColorStop(0, 'rgba(70,150,230,0)');
    og.addColorStop(0.5, 'rgba(95,195,255,0.30)');
    og.addColorStop(1, 'rgba(70,150,230,0)');
    c.globalAlpha = pulse;
    c.fillStyle = og;
    c.fillRect(bx - outer, 0, outer * 2, groundY);
    c.globalAlpha = 1;
    const mid = beamW * 1.6;
    const mg = c.createLinearGradient(bx - mid, 0, bx + mid, 0);
    mg.addColorStop(0, 'rgba(120,200,255,0)');
    mg.addColorStop(0.5, 'rgba(165,225,255,0.55)');
    mg.addColorStop(1, 'rgba(120,200,255,0)');
    c.globalAlpha = 0.55 + 0.30 * pulse;
    c.fillStyle = mg;
    c.fillRect(bx - mid, 0, mid * 2, groundY);
    c.globalAlpha = 1;
    const core = beamW * 0.34;
    const cg = c.createLinearGradient(bx - core, 0, bx + core, 0);
    cg.addColorStop(0, 'rgba(190,225,255,0)');
    cg.addColorStop(0.5, 'rgba(205,235,255,0.90)');
    cg.addColorStop(1, 'rgba(190,225,255,0)');
    c.fillStyle = cg;
    c.fillRect(bx - core, 0, core * 2, groundY);
    for (let i = 0; i < 7; i++) {
      const band0 = hash(700 + i);
      const rise = wrap(band0 * groundY + t * (0.05 + band0 * 0.06), groundY + 80);
      const by = groundY - rise;
      c.globalAlpha = 0.10 + 0.12 * (1 - rise / (groundY + 80));
      c.fillStyle = '#bfe2ff';
      c.fillRect(bx - core * 0.9, by, core * 1.8, 2 + band0 * 5);
    }
    c.globalAlpha = 1;
    softBlob(c, bx, groundY, beamW * 5.2, minDim * 0.10, '110,200,255', 0.34);
    softBlob(c, bx, groundY - minDim * 0.02, beamW * 2.6, minDim * 0.05, '180,230,255', 0.40);
    c.fillStyle = 'rgba(150,210,255,0.20)';
    c.beginPath();
    c.ellipse(bx, groundY, beamW * 3.4, minDim * 0.028, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(200,235,255,0.28)';
    c.beginPath();
    c.ellipse(bx, groundY, beamW * 1.4, minDim * 0.014, 0, 0, Math.PI * 2);
    c.fill();
    for (let i = 0; i < 16; i++) {
      const h1 = hash(1000 + i);
      const h2 = hash(1100 + i);
      const h3 = hash(1200 + i);
      const spd = 0.030 + h2 * 0.055;
      const travel = groundY + 60;
      const prog = wrap(h1 * travel + t * spd, travel);
      const py = groundY - prog;
      const spread = (1 - prog / travel) * beamW * 1.2 + beamW * 2.6 * (prog / travel);
      const px = bx + (h3 - 0.5) * spread * 2 + Math.sin(t / 4200 + h1 * 9) * beamW * 0.5;
      const fade = Math.sin((prog / travel) * Math.PI);
      const warm = h3 > 0.62;
      c.globalAlpha = 0.0;
      softBlob(c, px, py, beamW * (0.8 + h2 * 1.4), beamW * (0.6 + h1 * 1.0), warm ? '255,150,80' : '120,195,255', 0.16 * fade + 0.02);
      c.globalAlpha = 1;
    }
    c.save();
    c.translate(bx, h * 0.015);
    c.rotate(t / 6500);
    c.globalAlpha = 0.70;
    c.strokeStyle = 'rgba(150,210,255,0.55)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.ellipse(0, 0, beamW * 1.7, beamW * 0.7, 0, 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = 0.35;
    c.strokeStyle = 'rgba(150,210,255,0.40)';
    c.beginPath();
    c.ellipse(0, 0, beamW * 2.6, beamW * 1.0, 0, 0, Math.PI * 2);
    c.stroke();
    c.restore();
    softBlob(c, bx, h * 0.015, beamW * 1.1, beamW * 0.8, '210,240,255', 0.85);
    c.globalAlpha = 1;
    for (let i = 0; i < 38; i++) {
      const h1 = hash(2000 + i);
      const h2 = hash(2100 + i);
      const h3 = hash(2200 + i);
      const spd = 0.045 + h2 * 0.075;
      const travel = groundY + 120;
      const prog = wrap(h1 * travel + t * spd, travel);
      const py = groundY + 20 - prog;
      const px = bx + (h3 - 0.5) * beamW * 5.5 + Math.sin(t / 3800 + h1 * 14) * minDim * 0.02;
      const len = 4 + h2 * 16;
      c.globalAlpha = 0.12 + h1 * 0.38 * Math.sin((prog / travel) * Math.PI);
      c.strokeStyle = h3 > 0.7 ? 'rgba(255,190,120,0.70)' : 'rgba(160,210,255,0.70)';
      c.lineWidth = 1 + h2 * 1.2;
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(px + Math.sin(t / 5000 + h1 * 8) * 3, py - len);
      c.stroke();
      if (h2 > 0.55) {
        c.fillStyle = '#cfe8ff';
        c.beginPath();
        c.arc(px, py - len, 1 + h1 * 1.6, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.globalAlpha = 1;
    for (let i = 0; i < 24; i++) {
      const h1 = hash(3000 + i);
      const h2 = hash(3100 + i);
      const dx = 0.004 + h1 * 0.010;
      const dy = 0.003 + h2 * 0.008;
      const px = wrap(h1 * w + t * dx, w);
      const py = wrap(h2 * h + t * dy * 0.6, h);
      c.globalAlpha = 0.05 + h1 * 0.12;
      c.fillStyle = '#8fb0d0';
      c.beginPath();
      c.arc(px, py, 0.8 + h2 * 1.3, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    const shade = c.createLinearGradient(0, 0, w, 0);
    shade.addColorStop(0, 'rgba(2,6,12,0)');
    shade.addColorStop(0.30, 'rgba(2,6,12,0.58)');
    shade.addColorStop(0.52, 'rgba(2,6,12,0.62)');
    shade.addColorStop(0.74, 'rgba(2,6,12,0.30)');
    shade.addColorStop(1, 'rgba(2,6,12,0)');
    c.fillStyle = shade;
    c.fillRect(0, 0, w, h);
    c.globalAlpha = 1;
  },
};
