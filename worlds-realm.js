/* ============================================================================
 * worlds-realm.js — Continuity realms (owner: ContinuityV2)
 * Registers FOUR new worlds consumed by the IQ.Align v2 continuity planner:
 *
 *   seed-garden  align 'neutral' — SPEC 4a seed->phoenix triptych, serene reset
 *                round (purge curses, hp +20, 'a small seed takes root').
 *   seed-fire    align 'bad'     — SPEC 4b burning-devils round (harsh x2).
 *   phoenix-rise align 'good'    — SPEC 4c rebirth round (scoreMul 1.5 + purge);
 *                draws rising fire streaks so stair-of-heaven ascents read as
 *                climb-out-of-the-ashes per ctx.arcDepth.
 *   abyss-void   align 'bad'     — SPEC 5 rare deep-arc zone; black-hole visual
 *                pull (spiral infall); planner emits allowNegativeHp=1 in ctx.
 *
 * Asset-free Canvas 2D only; motion is gated by worlds.js' IQB_MOTION loop;
 * no flashes >200ms / >3Hz; question/answer glyphs never touched.
 * Load AFTER worlds.js (needs window.IQ.Worlds.register).
 * ============================================================================*/
(function () {
'use strict';
const root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

function motionOK(){ try{ return localStorage.getItem('IQB_MOTION') != null ? !!JSON.parse(localStorage.getItem('IQB_MOTION')) : true; }catch(e){ return true; } }
function T(){ return motionOK() ? 1 : 0; } /* time scale: freeze drift when motion off */

/* deterministic per-index pseudo-random for star/seed scatter */
function h2(i){ const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

function register(id, align, pal, draw){
 try{
  if (!(root.IQ && IQ.Worlds && typeof IQ.Worlds.register === 'function')) return false;
  IQ.Worlds.register({ id: id, align: align, pal: pal, draw: draw });
  return true;
 }catch(e){ return false; }
}

let ok = 0;

/* ---------------- SPEC 4a · seed-garden — serene reset ---------------- */
ok += register('seed-garden', 'neutral',
 ['#7ce38b','#57d364','#a4f04a','#e3b341','#fff3b0','#2ea043','#1f6feb','#f8f9fa'],
 function(c,w,h,t){
  const m = T();
  const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#dff3e0');g.addColorStop(0.55,'#bfe8c2');g.addColorStop(1,'#6fae74');
  c.fillStyle=g;c.fillRect(0,0,w,h);
  /* sun haze */
  c.fillStyle='rgba(255,243,176,.55)';c.beginPath();c.arc(w*0.78,h*0.18,90+8*Math.sin(t*0.4*m),0,7);c.fill();
  /* drifting pollen motes */
  for(let i=0;i<26;i++){
   const f=(t*0.12*m+h2(i))%1;
   c.fillStyle='rgba(255,250,220,'+(0.5*(1-f))+')';
   c.fillRect((h2(i+9)*w+f*w*0.15)%w,(h2(i+3)*h)+Math.sin(t+i)*10,3,3);
  }
  /* soil band */
  c.fillStyle='#5d4037';c.fillRect(0,h*0.82,w,h*0.18);
  c.fillStyle='rgba(0,0,0,.12)';for(let i=0;i<20;i++)c.fillRect((i*97)%w,h*0.84+(i%4)*h*0.03,14,3);
  /* sprouts at varying growth — serene reset motif */
  for(let i=0;i<9;i++){
   const x=w*(0.06+0.11*i), grow=0.35+0.65*h2(i+21), sway=Math.sin(t*0.9*m+i*1.7)*4;
   const top=h*0.82-grow*h*0.09;
   c.strokeStyle='#2ea043';c.lineWidth=3;
   c.beginPath();c.moveTo(x,h*0.83);c.quadraticCurveTo(x+sway,(h*0.83+top)/2,x+sway*2,top);c.stroke();
   c.fillStyle='#7ce38b';
   c.beginPath();c.ellipse(x+sway*2,top,-9,5,-0.6,0,7);c.fill();
   c.beginPath();c.ellipse(x+sway*2,top,9,5,0.6,0,7);c.fill();
  }
 });

/* ---------------- SPEC 4b · seed-fire — burning devils ---------------- */
ok += register('seed-fire', 'bad',
 ['#ff2038','#ff5a1e','#ffb01e','#7a1e09','#d7263d','#451804','#10002b','#ff9f1c'],
 function(c,w,h,t){
  const m = T();
  const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#0d0103');g.addColorStop(0.6,'#3d0a04');g.addColorStop(1,'#7a1e09');
  c.fillStyle=g;c.fillRect(0,0,w,h);
  /* slow pulsing inferno glow (<=3Hz) */
  const pulse=0.16+0.07*Math.sin(t*1.8*m);
  c.fillStyle='rgba(255,90,30,'+pulse.toFixed(3)+')';
  c.beginPath();c.arc(w*0.5,h*0.95,h*0.55,0,7);c.fill();
  /* dense ember updraft */
  for(let i=0;i<46;i++){
   const f=(t*0.28*m+h2(i))%1;
   const ex=(h2(i+31)*w+Math.sin(t*1.3*m+i)*(w*0.02));
   c.fillStyle='rgba(255,'+(120+((i*37)%110))+',40,'+(0.85*(1-f))+')';
   c.fillRect(ex,h*0.95-f*h*0.92,2+(i%3),2+(i%3));
  }
  /* flame licks along the floor */
  for(let i=0;i<12;i++){
   const bx=w*(i/11), fh=h*(0.08+0.07*h2(i+51))*(0.85+0.15*Math.sin(t*2.2*m+i*2.1));
   c.fillStyle=i%2?'rgba(255,32,56,.5)':'rgba(255,159,28,.45)';
   c.beginPath();c.moveTo(bx-w*0.035,h);c.quadraticCurveTo(bx+Math.sin(t*3*m+i)*w*0.01,h-fh,bx+w*0.035,h);c.closePath();c.fill();
  }
 });

/* ---------------- SPEC 4c · phoenix-rise — rebirth ascent ---------------- */
ok += register('phoenix-rise', 'good',
 ['#ffd700','#ff9f1c','#ff5a1e','#e07a1f','#fff3b0','#d7263d','#00b4d8','#fffdf5'],
 function(c,w,h,t){
  const m = T();
  const g=c.createLinearGradient(0,0,0,h);
  g.addColorStop(0,'#1a0526');g.addColorStop(0.55,'#701a2b');g.addColorStop(1,'#ffb01e');
  c.fillStyle=g;c.fillRect(0,0,w,h);
  /* rising fire streaks — the climb out of ashes */
  for(let i=0;i<34;i++){
   const f=((t*0.22*m)+h2(i))%1;
   c.strokeStyle='rgba(255,'+(160+((i*23)%80))+',60,'+(0.5*(1-f))+')';
   c.lineWidth=1+2*h2(i+61);
   const sx=h2(i+71)*w;
   c.beginPath();c.moveTo(sx,h-f*h);c.lineTo(sx+6,h-f*h-26-h2(i)*30);c.stroke();
  }
  /* slow wing arcs above the horizon */
  for(let s=-1;s<=1;s+=2){
   for(let i=0;i<3;i++){
    c.strokeStyle='rgba(255,215,0,'+(0.22-i*0.06)+')';c.lineWidth=4-i;
    c.beginPath();
    c.arc(w*0.5+s*w*(0.12+0.05*i),h*0.32,w*(0.14+0.06*i),Math.PI*(s>0?1:0.15),Math.PI*(s>0?1.85:1),s<0);
    c.stroke();
   }
  }
  /* phoenix glow heart */
  const gl=0.5+0.12*Math.sin(t*1.5*m);
  const rg=c.createRadialGradient(w*0.5,h*0.42,4,w*0.5,h*0.42,h*0.2);
  rg.addColorStop(0,'rgba(255,253,245,'+gl.toFixed(3)+')');rg.addColorStop(1,'rgba(255,159,28,0)');
  c.fillStyle=rg;c.fillRect(w*0.3,h*0.22,w*0.4,h*0.4);
 });

/* ---------------- SPEC 5 · abyss-void — black-hole pull ---------------- */
ok += register('abyss-void', 'bad',
 ['#0b0014','#1a0533','#301b5e','#5e60ce','#b8b8ff','#050109','#48bfe3','#80ffdb'],
 function(c,w,h,t){
  const m=T();
  c.fillStyle='#050109';c.fillRect(0,0,w,h);
  /* distant stars being dragged inward: spiral infall toward the core */
  const cx=w*0.5, cy=h*0.46, R=Math.min(w,h)*0.42;
  for(let i=0;i<70;i++){
   const f=(t*0.05*m+h2(i))%1;                 /* 1 -> 0 : falling */
   const r=R*(0.06+0.94*f*f);
   const a=h2(i+81)*Math.PI*2+f*7*(0.5+h2(i+91)); /* spiral twist while falling */
   const x=cx+Math.cos(a)*r*1.15, y=cy+Math.sin(a)*r*0.85;
   c.fillStyle='rgba('+(184-(f*120|0))+','+(184-(f*140|0))+',255,'+(0.25+0.6*(1-f)).toFixed(3)+')';
   c.fillRect(x,y,1.5+(1-f)*2,1.5+(1-f)*2);
  }
  /* accretion ring — tilted, slowly rotating */
  c.save();c.translate(cx,cy);c.rotate(-0.35+0.05*Math.sin(t*0.2*m));
  for(let i=0;i<3;i++){
   c.strokeStyle='rgba(94,96,206,'+(0.30-i*0.08)+')';c.lineWidth=3-i*0.5;
   c.beginPath();c.ellipse(0,0,R*0.34+i*9,R*0.13+i*3,0,0,7);c.stroke();
  }
  c.restore();
  /* event horizon: pure void with a thin lensing rim */
  c.fillStyle='#000';c.beginPath();c.arc(cx,cy,R*0.16,0,7);c.fill();
  c.strokeStyle='rgba(72,191,232,.5)';c.lineWidth=2;
  c.beginPath();c.arc(cx,cy,R*0.165,0,7);c.stroke();
  /* faint gravitational lensing halo */
  const lg=c.createRadialGradient(cx,cy,R*0.17,cx,cy,R*0.3);
  lg.addColorStop(0,'rgba(184,184,255,.14)');lg.addColorStop(1,'rgba(5,1,9,0)');
  c.fillStyle=lg;c.fillRect(0,0,w,h);
 });

if (typeof module !== 'undefined' && module.exports){
 module.exports = { registered: ok };
}
})();
