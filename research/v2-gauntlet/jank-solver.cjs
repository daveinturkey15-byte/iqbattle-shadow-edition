/* jank-solver.cjs — page-side source injected into the MAIN world of :8791.
 * Installs window.__SOLVE (deterministic round prediction from run seed —
 * mirrors main.ts deal()/dealPuzzle() exactly) and window.__J (frame-gap +
 * longtask probes). Pure observation: mutates nothing in the game. */
'use strict';
module.exports = `(async function(){
  const [arc, mpMod, f1, f2, f3, th] = await Promise.all([
    import('/src/arc-data.ts'), import('/src/scenes/mp.ts'),
    import('/src/puzzles/families.ts'), import('/src/puzzles/families2.ts'),
    import('/src/puzzles/families3.ts'), import('/src/theme.ts')]);
  const ALL = [...f1.FAMILIES, ...f2.FAMILIES2, ...f3.FAMILIES3];
  const imul = Math.imul;
  window.__SOLVE = function(seed, depth, lastTakeover) {
    if ((lastTakeover | 0) > 1000000) lastTakeover = -99; /* unsigned -99 artifact */
    const planArr = arc.planArc(seed >>> 0, 2000);
    const plan = planArr[depth-1] || {align:'bad', layer:1, sanctuary:false};
    const canTk = plan.align !== 'good' && depth >= 4 && depth - lastTakeover >= 3 &&
      (((seed ^ imul(depth, 2654435761)) >>> 0) % 100) < 42;
    const rp = mpMod.roundPlan(seed >>> 0, depth, ALL.length, 11, () => canTk);
    const out = {depth, align:plan.align, layer:plan.layer, sanctuary:!!plan.sanctuary,
      kind:rp.kind, interlude:(depth % 4 === 0 && depth > 1)};
    if (rp.kind === 'takeover') {
      out.index = rp.index; out.stageSeed = rp.seed;
      const names = ['RED LIGHT','TIDE POOL','SERPENT','FLOOR-FALL','HUNTER-DODGE','LASER-STORM','DRONE SWARM','SABER CLASH','ONE-ARMED GOD','SLIME GALLERY','THE WELL'];
      out.name = names[rp.index % 11];
    } else {
      const fam = ALL[rp.index % ALL.length];
      const hue = th.T.boardHues[(depth-1) % th.T.boardHues.length];
      const diff = Math.min(5, 1 + Math.floor(depth/6));
      const p = fam.generate((rp.seed ^ imul(depth, 7919)) >>> 0, diff, hue);
      out.answer = p.answer; out.rows = p.rows; out.cols = p.cols;
      out.nOpts = p.options.length; out.hole = p.holeIndex;
      out.famName = fam.name || fam.id || ('fam' + (rp.index % ALL.length));
    }
    return out;
  };
  const gaps = []; let lastF = performance.now();
  (function raf(){ const n = performance.now(); if (n - lastF > 34) gaps.push(Math.round(n - lastF)); lastF = n; requestAnimationFrame(raf); })();
  const lt = [];
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.duration > 50) { lt.push({s:Math.round(e.startTime), d:Math.round(e.duration)}); if (lt.length > 400) lt.splice(0, 200); } }).observe({entryTypes:['longtask']}); } catch (e) {}
  window.__J = {
    gaps: gaps, lt: lt,
    mark(){ this._g = this.gaps.length; this._l = this.lt.length; },
    snap(){ const g = this.gaps.slice(this._g || 0);
      return { maxGap: g.length ? Math.max.apply(null, g) : 0, longtasks: this.lt.slice(this._l || 0) }; },
  };
  return 'solver-ok';
})()`;
