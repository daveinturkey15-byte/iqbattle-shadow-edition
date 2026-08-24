/* ============================================================================
 * IQ.Worlds — W1 theme registry (contracts: research/w1-contracts.md C3)
 *
 * Asset-free themed rounds: every world is procedural canvas + a palette row
 * + a body class. No images, no fonts, no network. All animation honors
 * IQB_MOTION (static frame when off). Question/answer glyphs are never
 * touched — themes paint the room, never the puzzle text.
 *
 * API:
 *   Worlds.register({id, align:'bad'|'good'|'chaotic'|'neutral', pal:[8], draw(ctx,w,h,t)})
 *   Worlds.list(align) -> [themeId,...]
 *   Worlds.apply(themeId|null)   // null == clear back to base shadow look
 *   Worlds.clear()
 *   Worlds.palRow() -> [8 colors] | null   // consulted by the renderer
 * ============================================================================*/
(function () {
'use strict';
const root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

const REG = {};
let cur = null, cv = null, cx = null, raf = 0, t0 = 0;

function motionOK(){ try{ return !!localStorage.getItem('IQB_MOTION') ? JSON.parse(localStorage.getItem('IQB_MOTION')) : true; }catch(e){ return true; } }

function mount(){
 if (cv) return;
 cv = document.createElement('canvas');
 cv.id = 'world-canvas';
 cv.setAttribute('aria-hidden', 'true');
 cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:0;pointer-events:none;display:none';
 const app = document.getElementById('app');
 if (app){ app.style.position = 'relative'; app.style.zIndex = '1'; document.body.insertBefore(cv, app); }
 else document.body.appendChild(cv);
 cx = cv.getContext('2d');
 resize();
 window.addEventListener('resize', resize);
}
function resize(){
 if (!cv) return;
 cv.width = Math.max(320, window.innerWidth | 0);
 cv.height = Math.max(320, window.innerHeight | 0);
}

function frame(now){
 if (!cur || !cx) { raf = 0; return; }
 const t = (now - t0) / 1000;
 try{ cur.draw(cx, cv.width, cv.height, t); }catch(e){}
 raf = requestAnimationFrame(frame);
}
function startLoop(){
 if (!cv) mount();
 if (!motionOK()){ try{ cur && cur.draw(cx, cv.width, cv.height, 0); }catch(e){} return; }
 if (!raf){ t0 = performance.now(); raf = requestAnimationFrame(frame); }
}
function stopLoop(){
 if (raf){ cancelAnimationFrame(raf); raf = 0; }
 if (cx && cv){ cx.clearRect(0, 0, cv.width, cv.height); }
 cv && (cv.style.display = 'none');
}

/* ---------- built-in worlds (asset-free) ---------- */
function silhouettes(c, w, h, t, cols, base, sway){
 c.fillStyle = base;
 c.beginPath(); c.moveTo(0, h);
 for (let x = 0; x <= w; x += 24){
  const y = h * (0.72 + 0.08 * Math.sin(x * 0.011 + cols * 9) * sway + cols * 0.03 * Math.sin(t * 0.3 + cols));
  c.lineTo(x, y);
 }
 c.lineTo(w, h); c.closePath(); c.fill();
}
const THEMES = [
 { id:'jungle', align:'bad',
   pal:['#39d353','#2ea043','#8b5a2b','#116329','#a4f04a','#e3b341','#1f6feb','#f0883e'],
   draw(c,w,h,t){
    const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#02120a');g.addColorStop(1,'#06281a');c.fillStyle=g;c.fillRect(0,0,w,h);
    for(let i=0;i<14;i++){c.fillStyle='rgba(57,211,83,'+(0.05+0.03*(i%3))+')';
     const x=(i*137+t*6*(i%2?1:-1))%w;c.beginPath();c.ellipse(x,h*0.75+Math.sin(i)*h*0.05,60+i*7,18,i,0,7);c.fill();}
    for(let i=0;i<26;i++){const f=(t*0.4+i*0.37)%1;c.fillStyle='rgba(163,240,74,'+(0.55*(1-f))+')';
     c.fillRect((i*97)%w,(h*0.2+((i*53)%Math.floor(h*0.6)))+f*30%40,2,2);}
    silhouettes(c,w,h,t,1,'rgba(3,26,16,.9)',1);silhouettes(c,w,h,t,2,'rgba(2,16,10,.95)',0.6);
   }},
 { id:'volcano', align:'bad',
   pal:['#ff6b35','#f7c548','#d7263d','#451804','#ff9f1c','#6a040f','#10002b','#e07a1f'],
   draw(c,w,h,t){
    const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#160b06');g.addColorStop(0.7,'#3d1206');g.addColorStop(1,'#7a1e09');c.fillStyle=g;c.fillRect(0,0,w,h);
    c.fillStyle='rgba(255,107,53,.12)';c.beginPath();c.moveTo(w*0.5,h*0.28);c.lineTo(w*0.86,h);c.lineTo(w*0.14,h);c.closePath();c.fill();
    for(let i=0;i<34;i++){const f=(t*0.22+i*0.61)%1;const ex=w*0.5+Math.sin(i*7.3)*(w*0.3)*f;
     c.fillStyle='rgba(255,'+(120+((i*31)%90))+',40,'+(0.8*(1-f))+')';c.fillRect(ex,h*0.3-f*h*0.45*f-(i%5)*3,3,3);}
    c.fillStyle='rgba(255,159,28,.85)';c.beginPath();c.ellipse(w*0.5,h*0.295,46,10,0,0,7);c.fill();
   }},
 { id:'hell', align:'bad',
   pal:['#ff2038','#8a0315','#ff5a1e','#2b0002','#e01030','#ffb01e','#4a040f','#ff3d5e'],
   draw(c,w,h,t){
    const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#050001');g.addColorStop(1,'#260208');c.fillStyle=g;c.fillRect(0,0,w,h);
    for(let i=0;i<3;i++){c.fillStyle='rgba(255,32,56,'+(0.05+0.02*i)+')';
     c.beginPath();c.arc(w*(0.3+0.2*i),h*(0.85-0.05*Math.sin(t+i)),140-i*30,0,7);c.fill();}
    for(let i=0;i<40;i++){const f=(t*0.13+i*0.41)%1;c.fillStyle='rgba(224,16,48,'+(0.5*(1-f))+')';
     c.fillRect((i*127)%w,h-((t*22+i*67)%h),2,2);}
   }},
 { id:'riot', align:'bad',
   pal:['#ffb703','#fb8500','#bc3908','#1b1b1e','#ffd166','#6c757d','#343a40','#e85d04'],
   draw(c,w,h,t){
    c.fillStyle='#0c0c10';c.fillRect(0,0,w,h);
    for(let i=0;i<9;i++){const bw=w/9;c.fillStyle='rgba(255,183,3,'+(0.05+0.05*((i+Math.floor(t*2))%3))/1+')';c.fillRect(i*bw,0,bw,h);}
    for(let i=0;i<60;i++){const f=((t*0.9)+i*0.13)%1;c.strokeStyle='rgba(200,210,230,'+(0.25*(1-f))+')';
     c.beginPath();const rx=(i*89)%w;const ry=(f*h);c.moveTo(rx,ry);c.lineTo(rx-6,ry+16);c.stroke();}
    c.fillStyle='rgba(12,12,16,.55)';for(let i=0;i<5;i++){c.fillRect(0,h*(0.62+i*0.07),w,10);}
   }},
 { id:'ocean', align:'good',
   pal:['#4cc9f0','#48cae4','#00b4d8','#0096c7','#90e0ef','#caf0f8','#0077b6','#ade8f4'],
   draw(c,w,h,t){
    const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#023e63');g.addColorStop(1,'#012a45');c.fillStyle=g;c.fillRect(0,0,w,h);
    for(let i=0;i<5;i++){c.fillStyle='rgba(202,240,248,'+(0.05+0.02*(i%2))+')';
     c.save();c.translate(w*0.2*i+w*0.1,0);c.rotate(0.22+0.04*Math.sin(t*0.5+i));c.fillRect(-30,-h,w*0.12,h*2);c.restore();}
    for(let i=0;i<30;i++){const f=(t*0.3+i*0.27)%1;c.strokeStyle='rgba(144,224,239,'+(0.4*(1-f))+')';
     c.beginPath();c.arc((i*113)%w,h-((t*30+i*47)%h),2+(i%3)*2,0,7);c.stroke();}
   }},
 { id:'heaven', align:'good',
   pal:['#ffd700','#fff3b0','#e6c86e','#fffdf5','#f4d35e','#faf0ca','#cdb4db','#ffe5ec'],
   draw(c,w,h,t){
    const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#fdf6d8');g.addColorStop(1,'#c9b98a');c.fillStyle=g;c.fillRect(0,0,w,h);
    for(let i=0;i<7;i++){c.fillStyle='rgba(255,244,214,.5)';
     c.beginPath();c.ellipse((i*167+t*8)%(w+200)-100,h*(0.25+0.09*Math.sin(t*0.4+i)),110,26,0,0,7);c.fill();}
    c.strokeStyle='rgba(255,215,0,.35)';c.lineWidth=3;
    for(let i=0;i<4;i++){c.beginPath();c.moveTo(w*0.5,h*0.1+i*8);c.lineTo(w*0.5+(i-1.5)*w*0.16,h);c.stroke();}
   }},
 { id:'cave', align:'chaotic',
   pal:['#b8f2e6','#aed9e0','#5390d9','#1b263b','#64dfdf','#80ffdb','#5e60ce','#48bfe3'],
   draw(c,w,h,t){
    const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#070b14');g.addColorStop(1,'#0d1524');c.fillStyle=g;c.fillRect(0,0,w,h);
    for(let i=0;i<12;i++){const gx=(i*151)%w,gy=h*(0.15+((i*37)%60)/100);
     const gl=0.25+0.25*Math.sin(t*1.4+i*2.1);
     c.strokeStyle='rgba(100,223,223,'+gl.toFixed(3)+')';c.beginPath();
     c.moveTo(gx,gy);c.lineTo(gx-8,gy+26+(i%4)*8);c.lineTo(gx+2,gy+52);c.stroke();}
    for(let i=0;i<8;i++){c.fillStyle='rgba(94,96,206,.12)';
     c.beginPath();c.arc((i*211)%w,(i*97)%h,60+20*Math.sin(t+i),0,7);c.fill();}
   }},
 { id:'limbo', align:'neutral',
   pal:['#adb5bd','#ced4da','#495057','#6c757d','#dee2e6','#343a40','#868e96','#f8f9fa'],
   draw(c,w,h,t){
    c.fillStyle='#14171c';c.fillRect(0,0,w,h);
    for(let i=0;i<6;i++){c.fillStyle='rgba(173,181,189,'+(0.05+0.02*(i%3))+')';
     c.beginPath();c.ellipse((w*0.5)+Math.sin(t*0.2+i*1.7)*w*0.35,h*(0.3+0.11*i),220,42,0,0,7);c.fill();}
   }}
];

const Worlds = {
 register(def){ if(def&&def.id&&!REG[def.id]) REG[def.id]=def; },
 list(align){
  const out=[];for(const k in REG) if(REG[k].align===align) out.push(k);return out;
 },
 palRow(){ return cur ? cur.pal : null; },
 current(){ return cur ? cur.id : null; },
 apply(id){
  mount();
  const next = id && REG[id] ? REG[id] : null;
  if (document.body){
   document.body.className = document.body.className.replace(/world-\S+/g,'').trim();
   if (next) document.body.classList.add('world-' + next.id);
  }
  cur = next;
  if (!next){ stopLoop(); return; }
  cv.style.display = 'block';
  startLoop();
 },
 clear(){ this.apply(null); }
};
THEMES.forEach(t => Worlds.register(t));

root.IQ.Worlds = Worlds;
if (typeof module !== 'undefined' && module.exports) module.exports = Worlds;
})();
