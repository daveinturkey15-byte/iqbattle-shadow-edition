import { STAGE_H, STAGE_W } from '../theme.ts';
/* ============================================================================
 * layouthelper — single source of truth for puzzle-scene stage geometry.
 *
 * Everything here is in 1600x900 STAGE px (letterbox-fitted by main.fit()).
 * Derived from DNA.md's layout contract + research/v2-gauntlet/layout-audit.md
 * findings X3/X4/X5/T4:
 *   - options MUST fit inside the board panel with >=14px gaps at 2- and 3-row
 *     boards (X3);
 *   - the rule line renders INSIDE the panel at reveal (X4);
 *   - takeover boxes start at x=0 so scenes that center on a 1600-wide box
 *     space land true-center (T4) and never overflow the stage.
 * ==========================================================================*/

/** Board panel (board + options + rule band live here), left region. */
export const BOARD_PANEL = { x: 40, y: 164, w: 920, h: 640 } as const;

/** Right sidebar panel. */
export const SIDEBAR = { x: 984, y: 70, w: 576, h: 734 } as const;

const PAD_TOP = 20;
/** Minimum bottom padding below the options grid. */
const PAD_BOTTOM = 14;
/** Vertical gap between the board block and the options grid. */
export const BOARD_OPTIONS_GAP = 24;
/** Grid gap used by BOTH the board tiles and the option tiles (>=14 per audit). */
export const GRID_GAP = 14;

export interface PuzzleLayout {
  cellSize: number;
  /** Board tile origin + extent (panel-local). */
  bx: number;
  by: number;
  boardW: number;
  boardH: number;
  /** Option tile origin + extent (panel-local). Always two rows of four. */
  optSize: number;
  ox: number;
  oy: number;
  optW: number;
  optH: number;
}

/** Compute the full in-panel layout for a cols x rows board. Both the board
 *  block and the options grid are centered horizontally per col count; the
 *  options always fit with every gap >= 14px and bottom pad >= 14px. */
export function puzzleLayout(cols: number, rows: number): PuzzleLayout {
  const cellSize = cols === 2 ? 150 : 118;
  const boardW = cols * cellSize + (cols - 1) * GRID_GAP;
  const boardH = rows * cellSize + (rows - 1) * GRID_GAP;
  const bx = Math.round((BOARD_PANEL.w - boardW) / 2);
  const by = PAD_TOP;

  // Space available for [option row 1, gap, option row 2] after the board,
  // keeping PAD_BOTTOM clear at the panel's bottom edge.
  const avail = BOARD_PANEL.h - PAD_TOP - boardH - BOARD_OPTIONS_GAP - PAD_BOTTOM;
  // Clamp keeps DNA-ish proportions (~90-120px tiles); the math above already
  // guarantees fit for the real family range (2x2 and 3x3 boards).
  const optSize = Math.max(72, Math.min(120, Math.floor((avail - GRID_GAP) / 2)));
  const optW = 4 * optSize + 3 * GRID_GAP;
  const ox = Math.round((BOARD_PANEL.w - optW) / 2);
  const oy = by + boardH + BOARD_OPTIONS_GAP;
  return {
    cellSize, bx, by, boardW, boardH,
    optSize, ox, oy, optW,
    optH: 2 * optSize + GRID_GAP,
  };
}

/** Recommended dealTakeover box spec (Main to apply — NOT owned by game scene):
 *  x=0 kills the systematic 40px right bias (audit T4: scenes center their UI
 *  on a 1600-wide box space, so a box at x=40 centered everything at x=840);
 *  y=164 aligns with the puzzle panel top, safely below the status strip
 *  (bottom edge y=144); h is clipped to the stage so the old 900-tall box no
 *  longer overflows right/bottom (audit §6). */
export function takeoverBoxSpec(): { x: number; y: number; w: number; h: number } {
  return { x: 0, y: 164, w: STAGE_W, h: STAGE_H - 164 };
}
