/* Dev-only static server: serves iqbattle/ with Cache-Control: no-store
   so agent iterations are never shadowed by browser heuristics. */
const root = __dirname;
Bun.serve({
  port: 8791,
  async fetch(req) {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const f = Bun.file(root + p);
    if (await f.exists()) {
      return new Response(f, { headers: { 'Cache-Control': 'no-store, must-revalidate', 'Pragma': 'no-cache' } });
    }
    return new Response('not found', { status: 404 });
  }
});
console.log('iqbattle dev server on :8791 (no-store)');
