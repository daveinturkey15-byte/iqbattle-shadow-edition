/* ============================================================================
 * IQ.Worlds.pop — W1 pop-culture world pack (contracts: research/w1-contracts.md C3)
 *
 * Eight asset-free themed rounds registered into window.IQ.Worlds. Parody ids
 * only ('cyber-hunter', not the movie name); Dave's flavor lives in the
 * visuals/audio-free canvas work. Same rules as worlds.js builtins:
 *   - procedural canvas only, no images/fonts/network
 *   - never recolor/animate question or answer glyphs
 *   - ambient motion honors IQB_MOTION via the shared Worlds loop (t=0 static)
 *   - no fullscreen flashes >3Hz; tints ramp gradually
 *   - deterministic: all motion derived from t and fixed per-index constants,
 *     zero Math.random
 *
 * API (same shape as builtins):
 *   Worlds.register({id, align:'bad'|'good'|'chaotic'|'neutral', pal:[8], draw(ctx,w,h,t)})
 * ============================================================================*/
(function () {
'use strict';
var root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

var TAU = Math.PI * 2;

/* ---------- golden-mastermind hostility tap -------------------------------
 * Silent lasers go hostile red after a wrong answer LAST round. We piggyback
 * the existing window.IQ.Fun.onAnswer hook (fun.js) without changing its
 * behavior; if Fun is absent we simply stay calm-gold forever.
 * ------------------------------------------------------------------------*/
var mmWrongLast = false;
function mmTapFun(){
  var F = root.IQ && root.IQ.Fun;
  if (!F || typeof F.onAnswer !== 'function' || F.__mmTapped) return;
  var orig = F.onAnswer;
  F.onAnswer = function (correct) {
    try { mmWrongLast = correct === false; } catch (e) {}
    return orig.apply(this, arguments);
  };
  F.__mmTapped = true;
}

/* ---------- shared helpers ------------------------------------------------ */
function vgrad(c, h, stops){
  var g = c.createLinearGradient(0, 0, 0, h);
  for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
  c.fillStyle = g;
}
function tri(c, x0,y0,x1,y1,x2,y2){ c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y1);c.lineTo(x2,y2);c.closePath(); }

/* ==========================================================================
 * THEMES
 * ========================================================================*/
var POP = [

/* --- cyber-hunter (bad): red scanning eye-beam sweep --------------------- */
{ id:'cyber-hunter', align:'bad',
  pal:['#ff2244','#8b0318','#ff5a76','#12041a','#ff8095','#3a0a4f','#00e5ff','#1a0530'],
  draw:function(c,w,h,t){
    vgrad(c,h,[[0,'#0a0416'],[0.55,'#150829'],[1,'#05020c']]); c.fillRect(0,0,w,h);
    /* floor grid, recedes */
    c.strokeStyle='rgba(255,34,68,.10)'; c.lineWidth=1; c.beginPath();
    var hy=h*0.72;
    for(var i=0;i<=8;i++){ var y=hy+(h-hy)*Math.pow(i/8,1.7); c.moveTo(0,y); c.lineTo(w,y); }
    for(i=-6;i<=6;i++){ c.moveTo(w*0.5+i*w*0.09,hy); c.lineTo(w*0.5+i*w*0.34,h+40); }
    c.stroke();
    /* scanning beam: pivots down from the eye, ~4s period */
    var ph=(t%4)/4, ang=ph*Math.PI*0.9+0.06;
    var ex=w*0.5, ey=h*0.16;
    var bx=ex+Math.cos(ang)*w*1.4, by=ey+Math.sin(ang)*w*1.4;
    var lx=ex-Math.cos(ang)*w*1.4, ly=ey-Math.sin(ang)*w*1.4;
    c.fillStyle='rgba(255,34,68,'+(0.10+0.06*Math.sin(t*6)).toFixed(3)+')';
    tri(c, ex-14,ey, ex+14,ey, bx,by); c.fill();
    tri(c, ex-14,ey, ex+14,ey, lx,ly); c.fill();
    c.strokeStyle='rgba(255,90,118,.85)'; c.lineWidth=2.5;
    c.beginPath(); c.moveTo(ex,ey); c.lineTo(bx,by); c.moveTo(ex,ey); c.lineTo(lx,ly); c.stroke();
    /* the hunter eye */
    var blink=Math.abs(Math.sin(t*1.3));           /* slow lid */
    c.fillStyle='#0d0218'; c.beginPath(); c.ellipse(ex,ey,64,26*(0.25+0.75*blink),0,0,TAU); c.fill();
    c.strokeStyle='rgba(255,128,149,.9)'; c.lineWidth=3; c.stroke();
    c.fillStyle='rgba(255,34,68,'+(0.75+0.25*Math.sin(t*5)).toFixed(3)+')';
    c.beginPath(); c.arc(ex+18*Math.sin(t*0.9),ey,13*(0.25+0.75*blink)+4,0,TAU); c.fill();
  }},

/* --- wasteland-roads (bad): dusty orange heat-shimmer + tire tracks ------ */
{ id:'wasteland-roads', align:'bad',
  pal:['#e8871e','#c96a10','#f2b134','#4a2c12','#ffb85c','#7a4a1e','#2b1608','#ffd98a'],
  draw:function(c,w,h,t){
    vgrad(c,h,[[0,'#8a4a12'],[0.45,'#c96a10'],[0.62,'#e8871e'],[1,'#5a3414']]); c.fillRect(0,0,w,h);
    /* low sun disc, hazy */
    c.fillStyle='rgba(255,216,138,.30)'; c.beginPath(); c.arc(w*0.72,h*0.42,54,0,TAU); c.fill();
    c.fillStyle='rgba(255,232,180,.55)'; c.beginPath(); c.arc(w*0.72,h*0.42,26,0,TAU); c.fill();
    var hy=h*0.60;
    /* cracked ground plane */
    c.fillStyle='#4a2c12'; c.fillRect(0,hy,w,h-hy);
    /* twin tire tracks converging to the vanishing point, gentle S-sway */
    c.strokeStyle='rgba(24,12,4,.75)'; c.lineWidth=Math.max(6,h*0.02);
    for(var s=-1;s<=1;s+=2){
      c.beginPath();
      for(var y=hy;y<=h;y+=18){
        var f=(y-hy)/(h-hy);
        var x=w*0.5+s*(14+f*f*w*0.16)+Math.sin(f*4+t*0.15+s)*10*f;
        if(y===hy)c.moveTo(x,y); else c.lineTo(x,y);
      }
      c.stroke();
    }
    /* dust motes drifting sideways */
    for(var i=0;i<18;i++){ var fy=(t*14+i*53)%h; c.fillStyle='rgba(255,184,92,'+(0.16*(1-fy/h)).toFixed(3)+')';
      c.fillRect((i*127+t*26)%w,fy*0.9+h*0.08,3,3); }
    /* heat shimmer blobs hugging the horizon */
    for(i=0;i<6;i++){
      var sx=(i*0.19+0.06)*w + Math.sin(t*1.6+i*2.2)*14;
      var sy=hy-6+Math.sin(t*2.3+i)*3;
      c.fillStyle='rgba(255,232,180,'+(0.07+0.05*Math.sin(t*3+i)).toFixed(3)+')';
      c.beginPath(); c.ellipse(sx,sy,46,7,0,0,TAU); c.fill();
    }
  }},

/* --- golden-mastermind (neutral): velvet purple + judgment lasers -------- */
{ id:'golden-mastermind', align:'neutral',
  pal:['#ffd700','#b28fd8','#6b2fa0','#2a0a45','#ffe98a','#4a1a78','#c9a0f0','#fff3c4'],
  draw:function(c,w,h,t){
    mmTapFun();
    /* velvet: layered purple vignette */
    vgrad(c,h,[[0,'#170527'],[0.6,'#2a0a45'],[1,'#10031c']]); c.fillRect(0,0,w,h);
    c.fillStyle='rgba(107,47,160,.14)';
    for(var i=0;i<5;i++){ c.beginPath(); c.arc(w*0.5,h*1.15,h*(0.35+i*0.16),Math.PI,TAU); c.fill(); }
    /* throne silhouette behind the board */
    c.fillStyle='rgba(20,5,36,.85)';
    c.fillRect(w*0.44,h*0.30,w*0.12,h*0.34);
    tri(c,w*0.42,h*0.34, w*0.58,h*0.34, w*0.5,h*0.20); c.fill();
    /* silent lasers — gold while calm, hostile red after last-round miss */
    var hot=mmWrongLast, n=5;
    for(i=0;i<n;i++){
      var ph=((t*0.06)+(i/n))%1;
      var x=w*(0.08+0.84*ph), tilt=Math.sin(t*0.4+i*1.9)*h*0.10;
      var col=hot?'255,32,56':'255,215,0';
      var a=(0.22+0.10*Math.sin(t*1.2+i*2.1))*(hot?1.6:1); if(a>0.55)a=0.55;
      c.strokeStyle='rgba('+col+','+a.toFixed(3)+')'; c.lineWidth=hot?2.5:1.5;
      c.beginPath(); c.moveTo(x,0); c.lineTo(x+tilt,h); c.stroke();
    }
    /* slow ember sparks rising toward the mastermind */
    for(i=0;i<10;i++){ var f=(t*0.11+i*0.43)%1;
      c.fillStyle='rgba(255,233,138,'+(0.4*(1-f)).toFixed(3)+')';
      c.fillRect((i*151)%w,h-f*h*0.5,2,2); }
  }},

/* --- sky-laser (good): blue beam-column spectacle, ~9s grand sweep ------- */
{ id:'sky-laser', align:'good',
  pal:['#66e0ff','#3aa0ff','#bfeaff','#0b1e4a','#8af0ff','#123a7a','#ffffff','#275fb0'],
  draw:function(c,w,h,t){
    vgrad(c,h,[[0,'#050d26'],[0.65,'#0b1e4a'],[1,'#10295c']]); c.fillRect(0,0,w,h);
    /* fixed stars */
    for(var i=0;i<40;i++){ var tw=0.35+0.35*Math.sin(t*1.1+i*1.7);
      c.fillStyle='rgba(191,234,255,'+tw.toFixed(3)+')';
      c.fillRect((i*97)%w,(i*211)%Math.floor(h*0.55),2,2); }
    /* aurora ribbons */
    for(i=0;i<3;i++){ c.fillStyle='rgba(102,224,255,.05)';
      c.beginPath(); c.moveTo(0,h*0.3);
      for(var x=0;x<=w;x+=32) c.lineTo(x,h*(0.26+0.05*i)+Math.sin(x*0.008+t*0.5+i*2)*22);
      c.lineTo(w,h*0.55); c.lineTo(0,h*0.55); c.closePath(); c.fill(); }
    /* grand column sweep every ~9s: one bright fan travels left->right */
    var P=9, ph=(t%P)/P, cxp=w*(-0.15+1.3*ph);
    for(i=0;i<7;i++){
      var off=(i-3)*(0.055+0.012*Math.sin(t*0.7+i));
      c.strokeStyle='rgba(102,224,255,'+(0.16-0.018*Math.abs(i-3)).toFixed(3)+')';
      c.lineWidth=Math.max(2,h*0.006);
      c.beginPath(); c.moveTo(cxp,-10); c.lineTo(cxp+off*h*1.4,h+10); c.stroke();
      if(i===3){ c.strokeStyle='rgba(255,255,255,.30)'; c.lineWidth=Math.max(1,h*0.002);
        c.beginPath(); c.moveTo(cxp,-10); c.lineTo(cxp,h+10); c.stroke(); }
    }
    /* crowd-light horizon glow where the fan lands */
    var gl=0.20+0.10*Math.sin(t*2);
    c.fillStyle='rgba(138,240,255,'+(gl*Math.max(0,1-Math.abs(ph-0.5)*2)).toFixed(3)+')';
    c.fillRect(0,h*0.94,w,h*0.06);
  }},

/* --- symbiote-party (chaotic): b/w pulsing web + jagged white eyes ------- */
{ id:'symbiote-party', align:'chaotic',
  pal:['#ffffff','#e8e8f0','#111116','#000000','#cfcfe0','#2a2a33','#8888a0','#ffffff'],
  draw:function(c,w,h,t){
    c.fillStyle='#07070b'; c.fillRect(0,0,w,h);
    /* pulsing radial web */
    var pu=0.5+0.5*Math.sin(t*1.6);
    c.strokeStyle='rgba(232,232,240,'+(0.10+0.08*pu).toFixed(3)+')'; c.lineWidth=1;
    c.beginPath();
    for(var i=0;i<14;i++){ var a=i/14*TAU+t*0.05;
      c.moveTo(w*0.5,h*0.45); c.lineTo(w*0.5+Math.cos(a)*w,h*0.45+Math.sin(a)*w); }
    for(i=1;i<=5;i++){ var r=i*w*0.09*(1+0.05*Math.sin(t*1.6+i));
      for(var k=0;k<60;k+=2){ var a0=k/60*TAU,a1=(k+1)/60*TAU;
        var j0=r*(1+0.04*Math.sin(a0*3+t*2)), j1=r*(1+0.04*Math.sin(a1*3+t*2));
        c.moveTo(w*0.5+Math.cos(a0)*j0,h*0.45+Math.sin(a0)*j0);
        c.lineTo(w*0.5+Math.cos(a1)*j1,h*0.45+Math.sin(a1)*j1); } }
    c.stroke();
    /* goo drips from the top edge */
    for(i=0;i<8;i++){ var dx=(i*0.13+0.05)*w, dl=h*(0.10+0.07*((i*37)%5)/5)+6*Math.sin(t+i*2);
      c.fillStyle='rgba(0,0,0,.9)';
      tri(c,dx-14,-4,dx+14,-4,dx,dl); c.fill();
      c.beginPath(); c.arc(dx,dl,14,0,Math.PI); c.fill();
    }
    /* jagged white eyes that snap open/shut out of phase */
    for(i=0;i<4;i++){
      var ex=w*(0.2+0.2*i), ey=h*(0.3+0.18*((i*29)%3)/3);
      var open=Math.max(0,Math.min(1,Math.sin(t*2.2+i*2.6)*1.6-0.3));
      if(open>0.02){
        c.fillStyle='rgba(255,255,255,'+(0.75+0.2*open).toFixed(3)+')';
        c.beginPath(); c.moveTo(ex-34,ey);
        for(k=0;k<=6;k++){ var fx=ex-34+k*11.3;
          c.lineTo(fx,ey-open*(14+6*((k*17)%3))*(k%2?-1:1)); }
        c.lineTo(ex+34,ey); c.closePath(); c.fill();
        c.fillStyle='#000';
        c.beginPath(); c.ellipse(ex,ey,5,7*open,0,0,TAU); c.fill();
      }
    }
  }},

/* --- doll-game (bad): pastel arena, giant doll, slow stop/go rhythm ------ */
{ id:'doll-game', align:'bad',
  pal:['#ff9ec7','#b8f2c0','#ffe3ee','#7ad48f','#ffc2da','#3f8f57','#f6f2e9','#e56a99'],
  draw:function(c,w,h,t){
    /* stop/go rhythm: ~7s cycle, tint RAMPs (no hard flash) */
    var cyc=t%7, going=cyc<4.2;
    var mix=going?1:Math.max(0,Math.min(1,(cyc-4.2)/1.2));   /* ease out of green */
    var g=c.createLinearGradient(0,0,0,h);
    g.addColorStop(0,mix>0.5?'#bfe8cf':'#caa2b8');
    g.addColorStop(1,mix>0.5?'#8fd6a2':'#7c4a63');
    c.fillStyle=g; c.fillRect(0,0,w,h);
    if(mix<0.5){ c.fillStyle='rgba(214,40,80,'+(0.16*(1-mix)).toFixed(3)+')'; c.fillRect(0,0,w,h); }
    /* arena walls */
    c.fillStyle='rgba(246,242,233,.55)';
    c.fillRect(0,h*0.62,w,h*0.38);
    c.fillStyle='rgba(229,106,153,.35)'; c.fillRect(0,h*0.60,w,6);
    /* giant doll silhouette at the far end */
    var dx=w*0.82, dy=h*0.60, s=h*0.0016;
    c.fillStyle='rgba(40,20,34,.82)';
    c.beginPath(); c.arc(dx,dy-260*s,86*s,0,TAU); c.fill();                 /* head */
    c.beginPath(); c.arc(dx-84*s,dy-300*s,30*s,0,TAU); c.arc(dx+84*s,dy-300*s,30*s,0,TAU); c.fill(); /* pigtails */
    tri(c,dx-110*s,dy, dx+110*s,dy, dx,dy-190*s); c.fill();                 /* dress */
    c.fillRect(dx-52*s,dy,20*s,70*s); c.fillRect(dx+32*s,dy,20*s,70*s);     /* legs */
    /* doll head turns with the rhythm: faces player during STOP */
    var face=going?0:Math.min(1,(cyc-4.2)/0.8);
    c.fillStyle=going?'#281422':'#d62850';
    c.beginPath(); c.ellipse(dx-30*s,dy-262*s,16*s,10*s,0,0,TAU);
    c.ellipse(dx+30*s,dy-262*s,16*s,10*s,0,0,TAU); c.fill();
    if(face>0.05){ c.fillStyle='rgba(255,60,90,'+(0.5*face).toFixed(3)+')';
      c.beginPath(); c.ellipse(dx-30*s,dy-262*s,20*s,13*s,0,0,TAU);
      c.ellipse(dx+30*s,dy-262*s,20*s,13*s,0,0,TAU); c.fill(); }
    /* drifting petals */
    for(var i=0;i<12;i++){ var f=(t*0.09+i*0.31)%1;
      c.fillStyle='rgba(255,158,199,'+(0.5*(1-f)).toFixed(3)+')';
      c.save(); c.translate((i*137+f*w*0.4)%w,f*h); c.rotate(t+i);
      c.beginPath(); c.ellipse(0,0,5,2.4,0,0,TAU); c.fill(); c.restore(); }
  }},

/* --- sharks (bad): dark water, fin silhouettes circling ------------------ */
{ id:'sharks', align:'bad',
  pal:['#9fd8e8','#3d7ea6','#16324a','#04101c','#6db3cc','#0a2136','#cdeef8','#274e66'],
  draw:function(c,w,h,t){
    vgrad(c,h,[[0,'#0a2136'],[0.5,'#0a2a42'],[1,'#04101c']]); c.fillRect(0,0,w,h);
    /* god rays */
    for(var i=0;i<5;i++){ c.fillStyle='rgba(157,216,232,.05)';
      c.save(); c.translate(w*(0.1+0.2*i),0);
      c.rotate(0.25+0.05*Math.sin(t*0.4+i)); c.fillRect(-24,-h,w*0.07,h*2); c.restore(); }
    /* three sharks on nested circular orbits, banking through the turn */
    var ccx=w*0.5, ccy=h*0.52;
    for(i=0;i<3;i++){
      var R=w*(0.16+0.11*i), sp=(0.35-i*0.06)*(i%2?1:-1);
      var a=t*sp+i*2.1, sx=ccx+Math.cos(a)*R, sy=ccy+Math.sin(a)*R*0.55;
      var dir=Math.cos(a+(sp>0?Math.PI/2:-Math.PI/2))>=0?1:-1;
      var bob=4*Math.sin(t*1.3+i);
      c.save(); c.translate(sx,sy+bob); c.scale(dir,1);
      c.fillStyle='rgba(6,18,28,.92)';
      c.beginPath(); c.moveTo(-46,0);
      c.quadraticCurveTo(-10,-16,40,-4);                                  /* back */
      c.lineTo(58,0);                                                     /* tail tip */
      c.quadraticCurveTo(-10,14,-46,0); c.closePath(); c.fill();
      tri(c,-6,-8, 14,-8, 4,-30); c.fill();                               /* dorsal */
      tri(c,30,4, 44,4, 40,16); c.fill();                                 /* pelvic */
      /* wake ripple ring behind the fin */
      c.strokeStyle='rgba(205,238,248,'+(0.10+0.06*Math.sin(t*3+i)).toFixed(3)+')';
      c.lineWidth=1.5; c.beginPath(); c.ellipse(0,10,54,12,0,0,TAU); c.stroke();
      c.restore();
    }
    /* bubbles rising past the pack */
    for(i=0;i<22;i++){ var f=(t*0.25+i*0.19)%1;
      c.strokeStyle='rgba(109,179,204,'+(0.3*(1-f)).toFixed(3)+')';
      c.beginPath(); c.arc(((i*113)%w)+6*Math.sin(t*2+i),h-(f*h),(1+i%3)*2.2,0,TAU); c.stroke(); }
  }},

/* --- dolphins (good): leaping arcs + sparkle trails ---------------------- */
{ id:'dolphins', align:'good',
  pal:['#7fe3f0','#39b8d8','#c8f4fa','#0b5e7a','#aef0ff','#12688a','#ffffff','#4fc3e8'],
  draw:function(c,w,h,t){
    vgrad(c,h,[[0,'#bfeef8'],[0.48,'#7fd8ec'],[0.52,'#1a8ab0'],[1,'#0b5e7a']]); c.fillRect(0,0,w,h);
    /* sun glitter on the swell */
    c.fillStyle='rgba(255,255,255,.35)';
    for(var i=0;i<16;i++){ c.fillRect(w*0.55+((i*37)%140)-70+Math.sin(t*2+i)*6,h*(0.49+0.008*i),8,2); }
    /* surface waves */
    c.strokeStyle='rgba(200,244,250,.5)'; c.lineWidth=2; c.beginPath();
    for(var x=0;x<=w;x+=24){ var wy=h*0.5+Math.sin(x*0.02+t*1.1)*6;
      if(!x)c.moveTo(x,wy); else c.lineTo(x,wy); } c.stroke();
    /* dolphins leap along parabolic arcs, staggered in time and space */
    for(i=0;i<3;i++){
      var P=4+i*1.3, ph=((t+i*P/3)%P)/P;
      var x0=w*(0.12+0.3*i)-w*0.1, span=w*0.26, apex=h*(0.16+0.06*i);
      var px=x0+span*ph, py=h*0.5-(h*0.5-apex)*4*ph*(1-ph);
      var vy=1-2*ph, ang=Math.atan2(-(1-8*ph*(1-ph))*0.5,1)*(vy>=0?1:-1);
      if(ph>0.02&&ph<0.98){
        c.save(); c.translate(px,py); c.rotate(ang);
        c.fillStyle='rgba(11,60,84,.9)';
        c.beginPath(); c.moveTo(-26,0);
        c.quadraticCurveTo(0,-12,26,-2); c.lineTo(34,0);
        c.quadraticCurveTo(0,10,-26,0); c.closePath(); c.fill();
        tri(c,-2,-6, 10,-6, 5,-18); c.fill();
        c.restore();
        /* sparkle trail along the recent path */
        for(var k=1;k<=7;k++){
          var tp=Math.max(0,ph-k*0.03);
          var tx=x0+span*tp, ty=h*0.5-(h*0.5-apex)*4*tp*(1-tp);
          c.fillStyle='rgba(174,240,255,'+(0.55*(1-k/8)).toFixed(3)+')';
          c.beginPath(); c.arc(tx,ty,2.4*(1-k/9)+0.6,0,TAU); c.fill();
        }
      }
      /* splash crown at entry/exit */
      if(ph<0.08||ph>0.92){
        var inten=ph<0.08?(0.08-ph)/0.08:(ph-0.92)/0.08;
        c.fillStyle='rgba(255,255,255,'+(0.5*inten).toFixed(3)+')';
        for(k=0;k<5;k++){ c.beginPath();
          c.ellipse(x0+(k-2)*10,h*0.49-inten*(10+6*((k*13)%3)),2.5,7*inten+1,0,0,TAU); c.fill(); }
      }
    }
  }}
];

/* ---------- late-safe registration ----------------------------------------
 * worlds.js may load after us depending on script order; poll briefly so the
 * pack always lands in the same registry the engine reads.
 * ------------------------------------------------------------------------*/
(function reg(attempt){
  var W = root.IQ && root.IQ.Worlds;
  if (W && typeof W.register === 'function'){
    POP.forEach(function(d){ W.register(d); });
    return;
  }
  if (attempt < 40 && typeof setTimeout === 'function'){
    setTimeout(function(){ reg(attempt + 1); }, 50);
  }
})(0);

if (typeof module !== 'undefined' && module.exports) module.exports = POP;
})();
