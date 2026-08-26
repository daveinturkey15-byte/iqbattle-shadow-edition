/** Design tokens — REFINED v1 ("luxe") build. Source of truth: root luxe.css
 * tokens + research/refs captures (see DNA.md). Single source of truth. */
export const T = {
  bg: '#040812',
  panel: '#020e20',
  panelEdge: 'rgba(64,137,238,0.16)',
  tile: '#000000',
  tileEdge: 'rgba(255,255,255,0.06)',
  ink: '#f5f8ff',
  muted: '#9aa7ba',
  accentA: '#2d7cff',
  accentB: '#ef4cc8',
  good: '#22d3a5',
  bad: '#ff2e88',
  gold: '#d4a017',
  orange: '#ff7a1a',
  crimson: '#e0245e',
  /** one hue per board — the hue WHEEL rotates per puzzle, never varies within one */
  boardHues: ['#d4a017', '#ff7a1a', '#e0245e', '#38bdf8', '#a78bfa', '#34d399'],
  /** luxe panel radius (luxe.css --radius: 22px) */
  radius: 22,
  radiusPanel: 22,
  /** score-card / mid-size chrome radius (luxe .score-card: 16px) */
  radiusCard: 16,
  /** board & option tile radius (luxe .opt-btn: 14px) */
  radiusTile: 14,
  font: "'Oxanium', 'Segoe UI', system-ui, sans-serif",
} as const;

/** Logical stage: everything is laid out in this space, letterboxed to the viewport. */
export const STAGE_W = 1600;
export const STAGE_H = 900;
