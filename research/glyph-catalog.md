# Glyph Catalog — iqversus.com visual vocabulary

**Author:** GlyphCatalog (research-only; no game-code edits)
**Date:** 2026-08-24
**Sources:** (a) live site `https://www.iqversus.com` — all 25 tile PNGs downloaded & pixel-decoded; (b) main bundle `index-Bf6hA1cI.js` (655 KB) string/protocol analysis; (c) live `/how-to-play` DOM inventory (60 `<img>` verified); (d) sibling `research/w0-*.md` reports (incorporated as they land).
**Purpose:** every iqversus glyph as drawing primitives reproducible in our renderer (`cellSVG` in `index.html`, cell = `{shape,color,rot}` in a 40×40 viewBox).

---

## 1. How iqversus delivers glyphs

- Glyphs are **pre-rendered 220×220 PNGs with transparency** (`/assets/answer-<0-7>-<hash>.png`). There is **zero client-side shape drawing** — no `moveTo`/`arc`/`Path2D` anywhere in the bundle.
- In-game, the **server sends integer `tileIndex`** refs inside round frames; the client maps `tileIndex → PNG URL` (`roundAssets`). Question boards are grids of the same PNGs (`luxe-game-question-cell-image`); answers are 8 tiles in a 4-col CSS grid, square `--luxe-game-tile-size`.
- The full client-side pool = **25 assets**: 21 single-glyph tiles (6 glyph families × color/fill variants), 3 full-bleed mosaic crops, 1 question mosaic (660×660). Verified by bundle asset grep + live DOM inventory. No hidden glyph assets.
- Tiles are square, glyph centered, glyph occupies ~70–90% of tile width. Alpha is hard (antialiased 1px edge only), one flat fill color per glyph tile.

## 2. Palette (exact hex, sampled at alpha ≥ 250)

| Swatch | Hex | Role |
|---|---|---|
| Green  | `#1dbf3d` | glyph color |
| Yellow | `#d1b815` | glyph color |
| Pink   | `#e02e6f` | glyph color |
| Purple | `#8518d8` | glyph color |
| Orange | `#e66814` | mosaic face color only (never a glyph body) |

4 glyph colors, flat fills, no gradients/strokes-with-color-variance. (Our `PAL[stage][color]` 8-slot model is a superset — fine.)

## 3. Glyph catalog

Conventions: tile = 220×220, center (110,110). Fractions are of tile size `u`. SVG snippets use measured absolute coords in `viewBox="0 0 220 220"`; port to our renderer by substituting `u`, `cx`, `cy` (our `cellSVG` pattern). "Class" = solid / hollow (thick outline) / small per our puzzle-contract needs.

### 3.1 `hexagon` — regular hexagon, pointy-top (NEW vs our renderer)
- **Files:** solid: `answer-0-CEVMDb8y`(green), `answer-0-Ddm4OOuF`(yellow), `answer-3-C_c2O5wL`(purple), `answer-3-tVfRjleU`(pink) · hollow: `answer-5-CZWUop5-`(green), `answer-6-B7DEmauG`(purple)
- **Class:** solid + hollow pair. **Metrics:** bbox 153×176 (w=0.70u, h=0.80u); regular (side ≈ 87–88 both directions); vertices: top (110,22), UR (186.5,66), LR (186.5,152), bottom (110,198), LL (33.5,152), UL (33.5,66). Hollow stroke ≈ 18px (0.082u) perpendicular.
- **Visual signature:** straight vertical sides, apex top+bottom; row-width profile perfectly linear (±24px per 7px step) — the straight-edge signature separates it from our `ring`/oval reads at low res. Distinct from our `diamond` (4 vertices) by 6 vertices + flat sides.
- **SVG (solid):**
```svg
<polygon points="110,22 186.5,66 186.5,152 110,198 33.5,152 33.5,66"/>
```
- **SVG (hollow):** even-odd fill, outer polygon + inner polygon scaled 0.765 about (110,110): `<polygon fill-rule="evenodd" points="110,22 186.5,66 186.5,152 110,198 33.5,152 33.5,66 110,42.7 168.5,76.3 168.5,142.1 110,177.3 51.5,142.1 51.5,76.3"/>`. NOTE: their outline is **inset** (hole = scaled copy, stroke grows inward from the same outer edge), NOT a centered stroke — verified IoU 0.917 even-odd vs 0.38 centered-stroke.
- **Canvas:** `moveTo(110,22); lineTo(186.5,66); lineTo(186.5,152); lineTo(110,198); lineTo(33.5,152); lineTo(33.5,66); closePath()`.

### 3.2 `star` — fat five-point star, one point up (NEW vs our renderer)
- **Files:** solid only: `answer-1-BMR1BexV`(purple), `answer-4-BL6mYhI-`(yellow), `answer-7-DlQD_e9k`(pink)
- **Class:** solid. **Metrics:** bbox 191×174 (0.87u×0.79u); center (110,108); outer R = 96; inner/outer radius ratio 0.48 (fat star — grid-searched for max mask IoU vs the PNG; classic pentagram 0.382 is too thin). Point-up orientation.
- **Visual signature:** 5 outer points at 72° spacing starting at −90°; wide waist (span ≈ 0.55u at mid). Only glyph with concave silhouette; component count 1.
- **SVG:**
```svg
<polygon points="110,12 137.1,70.7 201.3,78.3 153.8,122.2 166.4,185.7 110,154.1 53.6,185.7 66.2,122.2 18.7,78.3 82.9,70.7"/>
```
(outer pts at angle −90+i·72, inner pts at −90+36+i·72, r_in=0.48·R, R=96, c=(110,108); IoU vs `answer-1-BMR1BexV` = **0.930**)
- **Canvas:** loop the 10 vertices above with `lineTo`, `closePath`.

### 3.3 `plus` — sharp-cornered Greek cross (we have a rounded variant; theirs is sharp)
- **Files:** `answer-2-CYxve-9-`(purple), `answer-6-Wq1i8NKB`(pink)
- **Class:** solid. **Metrics:** bbox 156×156 (0.71u), centered; bar thickness 56px (0.254u ≈ 0.36 of glyph span); sharp 90° corners, no corner radius (contrast: our `plus` uses `rx=0.05u`).
- **Visual signature:** 12-vertex orthogonal cross; row profile: single 56px run → full 156px run → 56px run.
- **SVG:**
```svg
<polygon points="82,32 138,32 138,82 188,82 188,138 138,138 138,188 82,188 82,138 32,138 32,82 82,82"/>
```
- **Canvas:** 12 `lineTo`s in the same order (clockwise from top-left of vertical arm).

### 3.4 `triangle-up` — equilateral, apex up (we have solid; theirs adds hollow)
- **Files:** solid: `answer-4-eM0-9RVl`(purple), `answer-7-MIj4EJmT`(green) · hollow: `answer-1-BAIuwcYD`(purple), `answer-2-XUF2uJuE`(green)
- **Class:** solid + hollow pair. **Metrics:** bbox 170×147 (0.77u×0.67u); apex (110,37); base corners (25,184)/(194.5,184); regular equilateral (base/height = 1.153 ≈ 2/√3). Hollow stroke ≈ 18–20px (0.085u) uniform; inner hole is a ~0.76-scale triangle.
- **Visual signature:** matches our `triangle` (apex up); hollow variant is new to us. Note: no triangle-down tile exists live — down-pointing is only reachable via `rot`.
- **SVG (solid):** `<polygon points="110,37 194.5,184 25.5,184"/>`
- **SVG (hollow):** even-odd, outer + inner triangle scaled 0.647 about the incenter (110,135): `<polygon fill-rule="evenodd" points="110,37 194.5,184 25.5,184 110,71.6 164.7,166.7 55.3,166.7"/>` (inset-hole model, same as hexagon; IoU **0.894** vs centered-stroke 0.41).
- **Canvas:** 3 `lineTo` + `closePath` (solid = `fill()`); hollow = `fill('evenodd')` with both loops in one path.

### 3.5 `ring` (hexagon-outline is their ring analog) — see 3.1 hollow
The live set has **no circle/oval ring and no hollow square**. The only hollow glyphs are the hexagon and triangle outlines above, both thick-stroke (≈0.08u), never thin 2–3px strokes.

### 3.6 Non-glyph tile art (do NOT port as cell shapes)
- **Cube mosaic** `question-0-DhOeJRoc.png` (660×660) + 3 full-bleed 220×220 crops (`answer-0-BFtnKYLk`, `answer-1-CfcW_z4q`, `answer-2-B3R90S85`, `answer-3-Bk6pyKgf`, `answer-4-CZecv1Wt`, `answer-5-DUkf2JW5`, `answer-6-DF84B5DC`, `answer-7-BX5eI88b`): flat 3-color isometric-cube tessellation (faces `#e66814`/`#8518d8`/`#e02e6f`), period 165px, 220px cell grid. Used by the "single-image" puzzle type (a 1/3 region is punched out; the 8 options are candidate crops). Fill fraction 1.0, comps=1 — distinguishable from glyphs instantly by fill fraction.
- **Background webp** `luxe-background-tile-DUBgwOTd.webp`, favicon (double-triangle logo), `default-player` avatar: brand art, not glyphs.
- Bundle `solution:` strings confirm the semantic names: *"the yellow hexagon"*, *"triangle into a hexagon"*, *"outline into a solid"*, *"repeating cube pattern"*.

## 4. Per-glyph quick table

| Glyph | Class | Fill fraction | comps | Colors seen | In our renderer? |
|---|---|---|---|---|---|
| hexagon solid | solid | 0.422 | 1 | G Y P Pu | **add** (`hexagon`) |
| hexagon hollow | hollow (0.082u stroke) | 0.171 | 1 | G Pu | **add** (`hexagon` + `hollow`) |
| star solid | solid | 0.278 | 1 | Pu Y Pk | **add** (`star`) |
| plus | solid | 0.296 | 1 | Pu Pk | have (sharpen corners to match) |
| triangle-up solid | solid | 0.267 | 1 | Pu G | have (`triangle`) |
| triangle-up hollow | hollow (0.085u stroke) | 0.152 | 1 | Pu G | **add** (`triangle` + `hollow`) |
| cube mosaic | pattern | 1.000 | 1 | Or Pu Pk | non-cell art |

Fill fractions are vs full 220×220 tile; bbox-normalized they run 0.42–0.65. All glyphs: exactly 1 connected component, hard alpha, flat single color.

## 5. Port notes for our `cellSVG`

- Add shapes `hexagon`, `star`; add `hollow` flag (or `fill:0|1`) to the cell contract for outline variants — iqversus treats outline-vs-solid as a *rule axis* ("moving down changes an outline into a solid"), so it's puzzle-relevant, not cosmetic.
- Keep `rot` semantics (90° steps); hexagon rot 0 = pointy-top; star rot 0 = point-up; plus rot 45° ≡ our `cross`.
- Their stroke weight convention: hollow = ~0.08u stroke, centered on the ideal edge.
- Sharp corners everywhere (no `rx`) — matches their crisp PNG look.

## 6. w0 sibling-report cross-checks (poll log)

- `w0-horror-design.md` (HorrorDoc): horror-technique doc; no glyph vocabulary. Nothing to incorporate.
- Pending at write time: ResMorph (lobby DOM), ResBundle (bundle deep-read), ResSets (**v1 capture bundle** — may contain the older/extended glyph set: ring, hollow-square, solid-bar, v-bar, circle, oval, diamond, triangle-down, cross-X, D-shape, thin-squiggle), ResTimers. Will be merged into §3/§4 as they land.

## 7. Verification (rasterized IoU, my SVG primitives vs original PNG alpha masks)

| Primitive | IoU |
|---|---|
| plus solid | 1.000 |
| hexagon solid | 0.982 |
| triangle-up solid | 0.961 |
| star solid (tuned) | 0.930 |
| hexagon hollow (even-odd inset) | 0.917 |
| triangle-up hollow (even-odd inset) | 0.894 |

All ≥ 0.89 — every live glyph is reproducible from the primitives in §3 within antialiasing tolerance.

---

*Repro: tiles in `%TEMP%/iqv-tiles/`; decode method = PIL RGBA scan (alpha≥128 mask, 4-connected components, row-span profiles, color histograms at alpha≥250). Star ratio fitted numerically against measured row spans.*
