/** Design tokens extracted from live iqversus.com (see DNA.md). Single source of truth. */
export const T = {
  bg: '#04070f',
  panel: '#0a1220',
  panelEdge: 'rgba(64,137,238,0.16)',
  tile: '#0a0d14',
  tileEdge: 'rgba(255,255,255,0.06)',
  ink: '#f5f8ff',
  muted: '#9aa7ba',
  accentA: '#ff2e7e',
  accentB: '#2d7cff',
  good: '#00e68a',
  bad: '#ff2038',
  gold: '#d4a017',
  orange: '#ff7a1a',
  crimson: '#e0245e',
  /** one hue per board — the hue WHEEL rotates per puzzle, never varies within one */
  boardHues: ['#d4a017', '#ff7a1a', '#e0245e', '#38bdf8', '#a78bfa', '#34d399'],
  radius: 14,
  font: 'Oxanium, Eurostile, "Segoe UI", sans-serif',
} as const;

/** Logical stage: everything is laid out in this space, letterboxed to the viewport. */
export const STAGE_W = 1600;
export const STAGE_H = 900;
