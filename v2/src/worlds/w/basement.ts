import { hash, wash, softBlob, wrap, type WorldDef } from './kit.ts';

export const WORLD: WorldDef = {
  id: 'basement',
  align: 'bad',
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const cx = w * 0.5;
    const p1 = (t / 4200) * Math.PI * 2;
    const p2 = (t / 7300) * Math.PI * 2;
    const sway = Math.sin(p1) * 0.26 + Math.sin(p2) * 0.07;
    const horizon = h * 0.74;
    wash(c, w, h, '#232931', '#060709');
    softBlob(c, w * 0.07, h * 0.28, w * 0.32, h * 0.42, '62,72,86', 0.20);
    softBlob(c, w * 0.93, h * 0.28, w * 0.32, h * 0.42, '62,72,86', 0.20);
    softBlob(c, w * 0.5, h * 1.02, w * 0.7, h * 0.3, '10,12,15', 0.55);
    for (let i = 0; i < 14; i++) {
      const hx = hash(101 + i * 2);
      const hy = hash(102 + i * 2);
      const sx = hx * w;
      const sy = hy * h * 0.7;
      const rx = (0.08 + hx * 0.14) * w;
      const ry = (0.06 + hy * 0.10) * h;
      const tone = Math.floor(28 + hx * 22);
      softBlob(c, sx, sy, rx, ry, tone + ',' + (tone + 4) + ',' + (tone + 9), 0.16);
    }
    c.save();
    c.globalAlpha = 0.28;
    c.strokeStyle = '#0a0c10';
    c.lineWidth = Math.max(1, h * 0.003);
    for (let i = 0; i < 4; i++) {
      const y = h * (0.22 + i * 0.14);
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    c.globalAlpha = 0.16;
    for (let i = 0; i < 5; i++) {
      const x = w * (0.12 + i * 0.19 + hash(210 + i) * 0.03);
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, horizon);
      c.stroke();
    }
    c.restore();
    const fg = c.createLinearGradient(0, horizon, 0, h);
    fg.addColorStop(0, '#171a1f');
    fg.addColorStop(0.25, '#101318');
    fg.addColorStop(1, '#040507');
    c.fillStyle = fg;
    c.fillRect(0, horizon, w, h - horizon);
    c.save();
    c.globalAlpha = 0.35;
    c.strokeStyle = '#05070a';
    c.lineWidth = Math.max(2, w * 0.004);
    for (let i = 0; i < 5; i++) {
      const z = hash(300 + i);
      const y = horizon + (h - horizon) * (0.15 + z * 0.75);
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    c.restore();
    for (let p = 0; p < 3; p++) {
      const py = h * (0.07 + p * 0.045);
      const pr = h * (0.012 + hash(340 + p) * 0.008);
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.fillRect(0, py + pr * 0.9, w, pr * 1.1);
      c.fillStyle = p === 1 ? '#3a414c' : '#2e343d';
      c.fillRect(0, py - pr, w, pr * 2);
      c.fillStyle = 'rgba(255,255,255,0.08)';
      c.fillRect(0, py - pr, w, Math.max(1, pr * 0.35));
      c.fillStyle = '#14171c';
      const vx = w * (0.2 + hash(350 + p) * 0.6);
      c.fillRect(vx - 2, py - pr - h * 0.02, 4, pr * 2 + h * 0.04);
    }
    for (let b = 0; b < 6; b++) {
      const left = b < 3;
      const hb = hash(400 + b);
      const hb2 = hash(410 + b);
      const bw = w * (0.10 + hb * 0.07);
      const bh = h * (0.09 + hb2 * 0.08);
      const bx = left ? w * 0.015 + hb2 * w * 0.03 : w - bw - w * 0.015 - hb * w * 0.03;
      const by = horizon - bh - (b % 3) * h * 0.045 + h * 0.02;
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(bx + 4, by + 6, bw, bh);
      const tone = Math.floor(38 + hb * 18);
      c.fillStyle = 'rgb(' + tone + ',' + (tone - 2) + ',' + (tone - 6) + ')';
      c.fillRect(bx, by, bw, bh);
      c.save();
      c.globalAlpha = 0.5;
      c.strokeStyle = '#0b0d11';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(bx, by);
      c.lineTo(bx + bw, by);
      c.lineTo(bx + bw, by + bh);
      c.lineTo(bx, by + bh);
      c.closePath();
      c.stroke();
      c.restore();
      c.fillStyle = 'rgba(255,255,255,0.05)';
      c.fillRect(bx, by, bw, 3);
    }
    const pivotX = cx;
    const pivotY = -h * 0.02;
    const cordLen = h * 0.22;
    const bulbX = pivotX + Math.sin(sway) * cordLen;
    const bulbY = pivotY + Math.cos(sway) * cordLen + h * 0.02;
    c.save();
    c.translate(bulbX, bulbY);
    c.rotate(sway);
    const coneLen = h * 0.78;
    const coneTop = w * 0.035;
    const coneBot = w * 0.22 + Math.abs(Math.sin(sway)) * w * 0.05;
    const cg = c.createLinearGradient(0, 0, 0, coneLen);
    cg.addColorStop(0, 'rgba(255,196,110,0.30)');
    cg.addColorStop(0.5, 'rgba(255,176,90,0.12)');
    cg.addColorStop(1, 'rgba(255,170,80,0.0)');
    c.fillStyle = cg;
    c.beginPath();
    c.moveTo(-coneTop, 0);
    c.lineTo(coneTop, 0);
    c.lineTo(coneBot, coneLen);
    c.lineTo(-coneBot, coneLen);
    c.closePath();
    c.fill();
    c.restore();
    softBlob(c, bulbX, bulbY, w * 0.16, h * 0.12, '255,190,110', 0.28);
    softBlob(c, bulbX, bulbY, w * 0.06, h * 0.05, '255,220,160', 0.45);
    c.save();
    c.strokeStyle = '#05060a';
    c.lineWidth = Math.max(1.5, w * 0.003);
    c.beginPath();
    c.moveTo(pivotX, pivotY);
    c.quadraticCurveTo(cx + Math.sin(sway) * cordLen * 0.5, cordLen * 0.6, bulbX, bulbY);
    c.stroke();
    c.restore();
    c.fillStyle = '#0d0e12';
    c.beginPath();
    c.arc(bulbX, bulbY - h * 0.012, Math.max(2, w * 0.008), 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ffd9a0';
    c.beginPath();
    c.arc(bulbX, bulbY, Math.max(2, w * 0.011), 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#fff2d8';
    c.beginPath();
    c.arc(bulbX, bulbY, Math.max(1, w * 0.005), 0, Math.PI * 2);
    c.fill();
    const poolX = bulbX + Math.sin(sway) * w * 0.18;
    c.save();
    c.globalAlpha = 0.5;
    c.fillStyle = 'rgba(255,185,100,0.18)';
    c.beginPath();
    c.ellipse(poolX, horizon + (h - horizon) * 0.32, w * 0.17, h * 0.035, 0, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 0.7;
    c.fillStyle = 'rgba(255,205,130,0.12)';
    c.beginPath();
    c.ellipse(poolX, horizon + (h - horizon) * 0.30, w * 0.09, h * 0.02, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
    const figX = w * 0.875;
    const figBase = h * 0.985;
    const figS = Math.min(w, h);
    softBlob(c, figX, figBase - figS * 0.12, figS * 0.22, figS * 0.20, '0,0,0', 0.75);
    c.fillStyle = '#010204';
    c.beginPath();
    c.ellipse(figX, figBase - figS * 0.20, figS * 0.055, figS * 0.068, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(figX - figS * 0.11, figBase);
    c.quadraticCurveTo(figX - figS * 0.10, figBase - figS * 0.16, figX - figS * 0.045, figBase - figS * 0.145);
    c.lineTo(figX + figS * 0.045, figBase - figS * 0.145);
    c.quadraticCurveTo(figX + figS * 0.10, figBase - figS * 0.16, figX + figS * 0.11, figBase);
    c.closePath();
    c.fill();
    c.fillStyle = 'rgba(120,140,160,0.06)';
    c.beginPath();
    c.ellipse(figX - figS * 0.02, figBase - figS * 0.21, figS * 0.012, figS * 0.02, -0.4, 0, Math.PI * 2);
    c.fill();
    for (let i = 0; i < 26; i++) {
      const hx = hash(600 + i * 3);
      const hy = hash(601 + i * 3);
      const hz = hash(602 + i * 3);
      const fall = wrap(hy * h + t * (h * 0.000012 + hz * h * 0.00002), h * 0.85);
      const dx = (hx - 0.5) * w * 0.3 + Math.sin(t / 3800 + hx * 6.28) * w * 0.02;
      const mx = bulbX + dx * (0.3 + fall / h);
      const my = bulbY + fall * 0.7;
      const mr = 1 + hz * 2.2;
      c.save();
      c.globalAlpha = 0.10 + hz * 0.22;
      c.fillStyle = '#ffdcb0';
      c.beginPath();
      c.arc(mx, my, mr, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    const vg = c.createRadialGradient(cx, h * 0.52, Math.min(w, h) * 0.18, cx, h * 0.52, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0.62)');
    vg.addColorStop(0.55, 'rgba(0,0,0,0.38)');
    vg.addColorStop(1, 'rgba(0,0,0,0.12)');
    c.fillStyle = vg;
    c.fillRect(0, 0, w, h);
    c.globalAlpha = 1;
  },
};
