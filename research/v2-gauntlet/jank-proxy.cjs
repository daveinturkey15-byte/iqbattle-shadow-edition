/* jank-proxy.cjs — reverse proxy for the v2 dev server that patches
 * /src/main.ts in-flight (adds window.__Q / window.__START observation hooks)
 * and blocks the Vite HMR client so sibling saves cannot reload the page
 * mid-hunt. READ-ONLY toward the repo: nothing on disk is modified. */
'use strict';
const http = require('http');
const UPSTREAM = { host: '127.0.0.1', port: 8791 };
const LISTEN = 8795;
const INJECT = ';window.__Q={run:()=>{try{return (typeof run!=="undefined"&&run)?{seed:run.seed,depth:run.depth,hp:run.hp,timerLen:run.timerLen,score:run.score,streak:run.streak,lastTakeover:run.lastTakeover}:null}catch(e){return null}}};window.__START=(s)=>{try{startRun("JANK","JANK ROOM",60,(s>>>0)||20260828)}catch(e){}};';

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/@vite/client') || req.url.startsWith('/@vite/')) {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    res.end('/* vite client blocked by jank-proxy */');
    return;
  }
  const preq = http.get({ ...UPSTREAM, path: req.url, headers: { accept: '*/*' } }, pres => {
    const chunks = [];
    pres.on('data', d => chunks.push(d));
    pres.on('end', () => {
      let body = Buffer.concat(chunks);
      const headers = Object.assign({}, pres.headers);
      delete headers['content-length'];
      if (/^\/src\/main\.ts($|\?)/.test(req.url)) {
        let text = body.toString('utf8');
        if (!text.includes('__START')) text = INJECT + '\n' + text;
        body = Buffer.from(text, 'utf8');
        headers['content-type'] = 'text/javascript';
      }
      headers['cache-control'] = 'no-store';
      res.writeHead(pres.statusCode || 200, headers);
      res.end(body);
    });
  });
  preq.on('error', () => { try { res.writeHead(502); res.end('proxy up-error'); } catch (e) {} });
  req.on('error', () => preq.destroy());
});
server.on('error', e => { console.log('proxy error', e.message); process.exit(1); });
server.listen(LISTEN, '127.0.0.1', () => console.log('jank-proxy on :' + LISTEN + ' -> :' + UPSTREAM.port));
