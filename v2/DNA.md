# V2 PUZZLE DNA — extracted from live iqversus.com (2026-08-25, rounds 4-5 + refs)

This is the ground truth for the v2 puzzle engine. Deviations are DEFECTS.

## Visual grammar (per board)
1. **ONE hue per board.** The whole puzzle (all 8 cells + 8 options) uses a single accent hue (gold #d4a017-ish, orange #ff7a1a-ish, pink/crimson). Color NEVER varies within a board. The rule is carried by STRUCTURE (count / arrangement / accretion / rotation), never by hue changes.
2. **Cells are near-black rounded tiles** (#0a0d14-ish) with the glyph composed of SMALL PRIMITIVE MARKS:
   - triangles (outline, ~10px, arranged in grids/clusters)
   - dots (filled circles, corner/edge positions)
   - diamonds (filled, center)
   - line segments (thin, through/around the diamond)
3. **Glyph density is readable**: 1-24 marks per cell max; marks are evenly spaced; nothing overlaps.

## Rule families observed (real)
- R4 (accretion): 2×2. Base diamond → +1 diagonal line + corner dots → +both diagonals + more dots → ?. Options mutate WHICH elements/arrangements.
- R5 (count grid): 3×3 of triangle clusters. Counts form an arithmetic/geometric grid across rows and columns (2,6,12 / 4,9,18 / 6,12,?). Options differ ONLY in count.
- (from earlier live round): dot-matrix glyphs that rotate 90° per step with dot-count changes.

## Anti-patterns (why v1 failed Dave's play test)
- Rainbow palettes on every board (8 hues) → options indistinguishable.
- Generic plus/cross shapes with color-rotation rules → "made up", not iqversus.
- No whitespace discipline → wonky ultrawide layout.
- Rules that need the answer key to understand → "puzzles don't work".

## Layout contract (from live screenshots, 1706×960 ref)
- Header: room title center, LOBBY left, LEAVE right (~64px).
- Status strip: "Round N/M" left + MM:SS right + gradient timer bar (pink→blue) beneath, full panel width.
- Board panel: centered in left region (~60% width), 3×3 (or 2×2) tiles ~120px each with 12px gaps, generous padding.
- Options: 4×2 grid of ~100px tiles, 12px gaps, directly below board, same panel.
- Sidebar: right ~35%, player cards (rank diamond, avatar, name, response clock mm.mmmss, score).
- Everything letterboxed/centered on ultrawide; no element floats into empty space.

## V2 architecture
- Stack: Vite + TypeScript + PixiJS v8 (`v2/` folder; old build untouched at root until parity).
- Fixed logical stage 1600×900, letterbox-scaled to viewport (kills layout wonk forever).
- Scenes: Boot → Landing → Lobby → Game(puzzle | takeover) → Interlude → End.
- Puzzle engine: `families/` — each family = generate(seed,diff) + independent solve(puzzle) + render(glyphs). Families mirror REAL iqversus rules only: count-grid, accretion, rotation-composite, position-orbit, missing-section. NO color-rotation families. One hue per board from a rotating hue wheel.
- Chaos layer: takeover stages are SEPARATE scenes the director drops into between puzzle blocks (Dave: "main gameplay is only puzzles when it's like iqversus, then the chaotic themed modes"). Never mutates a puzzle round's board.
- Gauntlet: every family ships with a solver; gauntlet runs solver audits (0 wrong answers tolerable), screenshot-vs-DNA layout diff, and a soak.
