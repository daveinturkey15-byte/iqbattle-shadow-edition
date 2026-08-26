'use strict';
const http = require('http'); const zlib = require('zlib'); const fs = require('fs');
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function getJSON(path){return new Promise((res,rej)=>{const q=http.request({host:'127.0.0.1',port:9339,path:path},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>{try{res(JSON.parse(b));}catch(e){rej(e);}});});q.on('error',rej);q.end();});}
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pend=new Map();ws.addEventListener('message',e=>{let m;try{m=JSON.parse(e.data);}catch(x){return;}if(m.id!==undefined){const p=this.pend.get(m.id);if(p){this.pend.delete(m.id);m.error?p[1](new Error(m.error.message)):p[0](m.result);}}});}
send(method,params){return new Promise((res,rej)=>{const id=++this.id;let to=null;this.pend.set(id,[v=>{clearTimeout(to);res(v);},e=>{clearTimeout(to);rej(e);}]);to=setTimeout(()=>{this.pend.delete(id);rej(new Error('to '+method));},9000);try{this.ws.send(JSON.stringify({id:id,method:method,params:params||{}}));}catch(e){rej(e);}});}}
function pngPixels(buf){let off=8,idat=[],w=0,ct=6;while(off+8<buf.length){const len=buf.readUInt32BE(off),typ=buf.toString('ascii',off+4,off+8),data=buf.slice(off+8,off+8+len);if(typ==='IHDR'){w=data.readUInt32BE(0);ct=data[9];}else if(typ==='IDAT')idat.push(data);off+=12+len;}
const bpp=ct===6?4:3;const raw=zlib.inflateSync(Buffer.concat(idat));const stride=w*bpp+1;const out=[];for(let y=0;y<1;y++){const ft=raw[y*stride];const row=raw.slice(y*stride+1,y*stride+stride);const unb=Buffer.alloc(w*bpp);
for(let i=0;i<w*bpp;i++){const a=i>=bpp?unb[i-bpp]:0,b=0,c=0;let v=row[i];
if(ft===1)v=(v+a)&255;else if(ft===2)v=v&255;else if(ft===3)v=(v+((a+0)>>1))&255;else if(ft===4){const p=a,pa=Math.abs(p-a),pb=Math.abs(p),pc=Math.abs(p);v=(v+(pa<=pb&&pa<=pc?a:pb<=pc?0:0))&255;}
unb[i]=v;}for(let x=0;x<w;x++)out.push([unb[x*bpp],unb[x*bpp+1],unb[x*bpp+2]]);}
return out;}
(async()=>{
const list=await getJSON('/json');
const pages=list.filter(t=>t.type==='page'&&t.url.indexOf('127.0.0.1:8792')>=0);
console.log('pages:',pages.map(p=>p.url));
for(const pg of pages){
 const ws=new WebSocket(pg.webSocketDebuggerUrl);
 await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
 const c=new CDP(ws);
 const r=await c.send('Runtime.evaluate',{expression:'(function(){var cc=document.querySelector("#app canvas");var rr=cc.getBoundingClientRect();return{l:rr.left,t:rr.top,w:rr.width,h:rr.height,iw:innerWidth,ih:innerHeight};})()',returnByValue:true});
 console.log('rect',JSON.stringify(r.result.value));
 const shot=await c.send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('C:/Users/david/Desktop/stuff/iqbattle/research/v2-gauntlet/shots/OBS-'+pg.id+'.png',Buffer.from(shot.data,'base64'));
 console.log('saved OBS-'+pg.id+'.png bytes='+shot.data.length);
 ws.close();
}
process.exit(0);
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
