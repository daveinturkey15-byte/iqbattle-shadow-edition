import { hash, wash, softBlob, wrap, type WorldDef } from './kit.ts';

export const WORLD: WorldDef = {
  id: 'arena-lights',
  align: 'chaotic',
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    wash(c, w, h, '#0a1122', '#020409');
    const cx = w * 0.5;
    const u = Math.min(w, h) / 100;
    const seatTop = h * 0.04;
    const seatBot = h * 0.7;
    const seatH = seatBot - seatTop;
    for (let j = 0; j < 6; j++) {
      const f = j / 6;
      const y = seatTop + f * seatH;
      const bh = seatH / 6;
      const r = Math.floor(12 + f * 9 + hash(j + 11) * 6);
      const g = Math.floor(17 + f * 11 + hash(j + 21) * 6);
      const b = Math.floor(30 + f * 15 + hash(j + 31) * 8);
      c.fillStyle = `rgb(${r},${g},${b})`;
      c.fillRect(0, y, w, bh + 1);
      c.fillStyle = 'rgba(120,150,200,0.16)';
      c.fillRect(0, y, w, Math.max(1, u * 0.22));
      c.fillStyle = 'rgba(255,190,120,0.10)';
      c.fillRect(0, y + bh - Math.max(1, u * 0.18), w, Math.max(1, u * 0.18));
    }
    c.fillStyle = '#05080f';
    c.fillRect(0, 0, w, h * 0.045);
    for (let i = 0; i < 26; i++) {
      const px = (i + 0.5) * (w / 26) + (hash(i + 501) - 0.5) * u * 2;
      const py = h * 0.028 + hash(i + 502) * u * 0.8;
      const tw = 0.5 + 0.5 * Math.sin((t / 4200) * 6.2832 + hash(i + 503) * 6.2832);
      const al = 0.25 + tw * 0.55;
      c.fillStyle = `rgba(200,215,255,${al.toFixed(3)})`;
      c.beginPath();
      c.arc(px, py, u * 0.32, 0, 6.2832);
      c.fill();
      c.fillStyle = 'rgba(160,180,220,0.12)';
      c.fillRect(px - u * 0.1, py + u * 0.3, u * 0.2, u * 1.1);
    }
    for (let i = 0; i < 340; i++) {
      const px = hash(i * 3 + 101) * w;
      const py = seatTop + hash(i * 3 + 102) * seatH;
      const dx = (px - cx) / (w * 0.5);
      const dy = (py - h * 0.42) / (h * 0.5);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const mask = Math.min(1, 0.18 + dist * 1.15);
      const pick = hash(i * 3 + 103);
      if (pick > 0.9) {
        const per = 2600 + hash(i + 901) * 3800;
        const ph = hash(i + 1401) * 6.2832;
        const tw = 0.5 + 0.5 * Math.sin((t / per) * 6.2832 + ph);
        const fl = Math.pow(tw, 10);
        const al = (0.12 + fl * 0.9) * mask;
        c.fillStyle = `rgba(226,238,255,${al.toFixed(3)})`;
        const rr = u * (0.35 + hash(i + 1501) * 0.55);
        c.beginPath();
        c.arc(px, py, rr, 0, 6.2832);
        c.fill();
      } else {
        const sh = hash(i + 1601);
        const r = Math.floor(15 + sh * 22);
        const g = Math.floor(21 + sh * 26);
        const b = Math.floor(33 + sh * 30);
        c.globalAlpha = (0.35 + hash(i + 1701) * 0.4) * mask;
        c.fillStyle = `rgb(${r},${g},${b})`;
        const rr = u * (0.3 + hash(i + 1801) * 0.6);
        c.beginPath();
        c.arc(px, py, rr, 0, 6.2832);
        c.fill();
        c.globalAlpha = 1;
      }
    }
    for (let k = 0; k < 2; k++) {
      const sx = k === 0 ? w * 0.07 : w * 0.93;
      const sy = h * 0.02;
      const per = k === 0 ? 9000 : 12700;
      const ph = k === 0 ? 0.6 : 2.4;
      const base = k === 0 ? 0.5 : -0.5;
      const th = base + 0.48 * Math.sin((t / per) * 6.2832 + ph);
      const dx = Math.sin(th);
      const dy = Math.cos(th);
      const len = h * 1.35;
      const ex = sx + dx * len;
      const ey = sy + dy * len;
      const hw = w * 0.075;
      const qx = Math.cos(th);
      const qy = -Math.sin(th);
      const grad = c.createLinearGradient(sx, sy, ex, ey);
      grad.addColorStop(0, 'rgba(180,200,255,0.20)');
      grad.addColorStop(1, 'rgba(180,200,255,0)');
      c.fillStyle = grad;
      c.beginPath();
      c.moveTo(sx, sy);
      c.lineTo(ex + qx * hw, ey + qy * hw);
      c.lineTo(ex - qx * hw, ey - qy * hw);
      c.closePath();
      c.fill();
      const grad2 = c.createLinearGradient(sx, sy, ex, ey);
      grad2.addColorStop(0, 'rgba(255,226,170,0.13)');
      grad2.addColorStop(1, 'rgba(255,226,170,0)');
      c.fillStyle = grad2;
      c.beginPath();
      c.moveTo(sx, sy);
      c.lineTo(ex + qx * hw * 0.35, ey + qy * hw * 0.35);
      c.lineTo(ex - qx * hw * 0.35, ey - qy * hw * 0.35);
      c.closePath();
      c.fill();
      for (let j = 0; j < 3; j++) {
        const f = 0.28 + j * 0.24;
        const hx = sx + (ex - sx) * f;
        const hy = sy + (ey - sy) * f;
        softBlob(c, hx, hy, w * 0.055 * (0.6 + f), u * 6, '180,200,255', 0.05);
      }
      softBlob(c, sx, sy, w * 0.07, u * 10, '195,212,255', 0.4);
    }
    softBlob(c, w * 0.04, h * 0.42, w * 0.12, h * 0.2, '255,170,90', 0.1);
    softBlob(c, w * 0.96, h * 0.42, w * 0.12, h * 0.2, '255,170,90', 0.1);
    softBlob(c, w * 0.5, h * 0.06, w * 0.4, h * 0.12, '120,150,220', 0.12);
    const fg = c.createLinearGradient(0, h * 0.64, 0, h);
    fg.addColorStop(0, '#111829');
    fg.addColorStop(0.35, '#0a0f1e');
    fg.addColorStop(1, '#04060c');
    c.fillStyle = fg;
    c.fillRect(0, h * 0.64, w, h * 0.36);
    const shade = c.createRadialGradient(cx, h * 0.58, u * 4, cx, h * 0.58, Math.max(w, h) * 0.72);
    shade.addColorStop(0, 'rgba(2,4,10,0.6)');
    shade.addColorStop(0.55, 'rgba(2,4,10,0.35)');
    shade.addColorStop(1, 'rgba(2,4,10,0)');
    c.fillStyle = shade;
    c.fillRect(0, 0, w, h);
    c.save();
    c.strokeStyle = 'rgba(150,170,210,0.2)';
    c.lineWidth = Math.max(1, u * 0.35);
    c.beginPath();
    c.moveTo(0, h * 0.88);
    c.lineTo(w, h * 0.83);
    c.stroke();
    c.strokeStyle = 'rgba(150,170,210,0.13)';
    c.beginPath();
    c.moveTo(0, h * 0.95);
    c.lineTo(w, h * 0.9);
    c.stroke();
    c.restore();
    for (let i = 0; i < 70; i++) {
      const sp = 15000 + hash(i + 2001) * 9000;
      const yy = wrap(hash(i + 2002) + t / sp, 1) * h;
      const xx = hash(i + 2003) * w + Math.sin((t / 7000) * 6.2832 + hash(i + 2004) * 6.2832) * u * 3;
      const dx = (xx - cx) / (w * 0.5);
      const dy = (yy - h * 0.55) / (h * 0.5);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const mask = Math.min(1, 0.25 + dist * 1.0);
      c.globalAlpha = (0.05 + hash(i + 2005) * 0.12) * mask;
      c.fillStyle = '#cdd8ee';
      c.beginPath();
      c.arc(xx, yy, u * (0.14 + hash(i + 2006) * 0.22), 0, 6.2832);
      c.fill();
      c.globalAlpha = 1;
    }
    c.globalAlpha = 1;
  },
};
