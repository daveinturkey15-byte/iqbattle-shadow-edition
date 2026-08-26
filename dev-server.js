/* Dev server: serves the V2 BUILD (v2/dist) at the root, legacy V1 under /v1/.
 * no-store everywhere so agent iterations are never shadowed by browser cache. */
const root = __dirname;
const v2dist = root + '/v2/dist';
const NO_STORE = { 'Cache-Control': 'no-store, must-revalidate', 'Pragma': 'no-cache' };
Bun.serve({
  port: 8791,
  async fetch(req) {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || p === '') p = '/index.html';
    /* legacy v1: /v1/<path> -> old root files */
    if (p.startsWith('/v1/')) {
      const f = Bun.file(root + p.slice(3));
      if (await f.exists()) return new Response(f, { headers: NO_STORE });
      return new Response('not found', { status: 404 });
    }
    /* v2 build first */
    const f2 = await Bun.file(v2dist + p);
    if (await f2.exists()) return new Response(f2, { headers: NO_STORE });
    /* SPA fallback: any html-ish route gets the v2 shell */
    if (p === '/index.html' || p.endsWith('.html') || !p.includes('.')) {
      return new Response(Bun.file(v2dist + '/index.html'), { headers: NO_STORE });
    }
    const f = Bun.file(root + p);
    if (await f.exists()) return new Response(f, { headers: NO_STORE });
    return new Response('not found', { status: 404 });
  }
});
console.log('iqbattle dev server on :8791 — root=v2/dist, legacy=/v1/ (no-store)');
