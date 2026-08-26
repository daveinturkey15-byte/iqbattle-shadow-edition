'use strict';
const fs = require('fs'); const zlib = require('zlib'); const http = require('http');
const DEBUG_PORT = 9339;
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function getJSON(path,method){return new Promise((res,rej)=>{const q=http.request({host:'127.0.0.1',port:DEBUG_PORT,path:path,method:method||'GET'},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>{try{res(JSON.parse(b));}catch(e){rej(e);}});});q.on('error',rej);q.end();});}
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pend=new Map();this.ev=new Map();ws.addEventListener('message',e=>{let m;try{m=JSON.parse(e.data);}catch(x){return;}if(m.id!==undefined){const p=this.pend.get(m.id);if(p){this.pend.delete(m.id);m.error?p[1](new Error(m.error.message)):p[0](m.result);}}else{const hs=this.ev.get(m.method);if(hs)hs.forEach(h=>h(m.params));}});}
send(method,params){return new Promise((res,rej)=>{const id=++this.id;this.pend.set(id,[res,rej]);this.ws.send(JSON.stringify({id:id,method:method,params:params||{}}));});}}
async function connectWS(u){const ws=new WebSocket(u);await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});return new CDP(ws);}
function pngPixels(buf){let off=8,idat=[],w=0,ct=6;while(off+8<buf.length){const len=buf.readUInt32BE(off),typ=buf.toString('ascii',off+4,off+8),data=buf.slice(off+8,off+8+len);if(typ==='IHDR'){w=data.readUInt32BE(0);ct=data[9];}else if(typ==='IDAT')idat.push(data);off+=12+len;}
const bpp=ct===6?4:ct===2?3:1;const raw=zlib.inflateSync(Buffer.concat(idat));const stride=w*bpp+1;const out=[];const prev=Buffer.alloc(w*bpp);
for(let y=0;y<1;y++){const ft=raw[y*stride];const row=raw.slice(y*stride+1,y*stride+stride);const unb=Buffer.alloc(w*bpp);
for(let i=0;i<w*bpp;i++){const a=i>=bpp?unb[i-bpp]:0,b=prev[i],c=i>=bpp?prev[i-bpp]:0;let v=row[i];
if(ft===1)v=(v+a)&255;else if(ft===2)v=(v+b)&255;else if(ft===3)v=(v+((a+b)>>1))&255;else if(ft===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);v=(v+(pa<=pb&&pa<=pc?a:pb<=pc?b:c))&255;}
unb[i]=v;}for(let x=0;x<w;x++)out.push([unb[x*bpp],unb[x*bpp+1],unb[x*bpp+2]]);}
return out;}
(async()=>{
let tgt=null;try{tgt=await getJSON('/json/new?http://127.0.0.1:8792','PUT');}catch(e){tgt=await getJSON('/json/new?http://127.0.0.1:8792');}
const c=await connectWS(tgt.webSocketDebuggerUrl);
await c.send('Page.enable');await c.send('Runtime.enable');
await c.send('Emulation.setDeviceMetricsOverride',{width:1024,height:576,deviceScaleFactor:1,mobile:false});
await c.send('Page.navigate',{url:'http://127.0.0.1:8792'});
await sleep(2600);
async function ev(x){const r=await c.send('Runtime.evaluate',{expression:x,returnByValue:true});return r&&r.result?r.result.value:undefined;}
const rect=await ev('(function(){var c=document.querySelector("#app canvas");var r=c.getBoundingClientRect();return{l:r.left,t:r.top,w:r.width,h:r.height,iw:innerWidth,ih:innerHeight};})()');
console.log('rect',JSON.stringify(rect));
async function raw(clip){const r=await c.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,clip:{x:clip[0],y:clip[1],width:clip[2],height:clip[3],scale:1}});return Buffer.from(r.data,'base64');}
async function pix(sx,sy){const p=[rect.l+sx*(rect.w/1600),rect.t+sy*(rect.h/900)];const b=await raw([Math.floor(p[0]),Math.floor(p[1]),1,1]);return pngPixels(b)[0];}
// click CREATE ROOM
async function click(sx,sy){const p=[rect.l+sx*(rect.w/1600),rect.t+sy*(rect.h/900)];const base={x:p[0],y:p[1],button:'left',clickCount:1,pointerType:'mouse'};await c.send('Input.dispatchMouseEvent',Object.assign({type:'mouseMoved'},base));await c.send('Input.dispatchMouseEvent',Object.assign({type:'mousePressed'},base));await sleep(60);await c.send('Input.dispatchMouseEvent',Object.assign({type:'mouseReleased'},base));}
// landing probes first
for(const pt of [[628,350],[800,660],[500,90]]) console.log('LANDING px',pt.join(','),JSON.stringify(await pix(pt[0],pt[1])));
await click(800,767);
await sleep(4500);
const rect2=await ev('(function(){var c=document.querySelector("#app canvas");var r=c.getBoundingClientRect();return{l:r.left,t:r.top,w:r.width,h:r.height,iw:innerWidth,ih:innerHeight};})()');
console.log('rect2',JSON.stringify(rect2));
const full=await raw();require('fs').writeFileSync('C:/Users/david/Desktop/stuff/iqbattle/research/v2-gauntlet/shots/PROBE-lobby.png',full);
for(const pt of [[500,90],[800,326],[770,326],[800,406],[628,350],[800,455],[800,660],[960,300]]) console.log('LOBBY px',pt.join(','),JSON.stringify(await pix(pt[0],pt[1])));
const b33=await raw([Math.floor(rect.l+628*(rect.w/1600))-1,Math.floor(rect.t+350*(rect.h/900))-1,3,3]);
try{console.log('3x3@628,350',JSON.stringify(pngPixels(b33)));}catch(e){console.log('3x3 err',e.message);}
await getJSON('/json/close/'+tgt.id);
process.exit(0);
})().catch(e=>{console.error('FATAL',e&&(e.stack||e.message));process.exit(1);});
