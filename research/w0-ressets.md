# W0 Deep-Capture Report — Set-Completion / Shade-Step / Latin Variants (ResSets)

Live target: the original site (solo gauntlets, CDP raw-WebSocket + page-injected canvas decoder).
Gauntlets played: 3 (g1 dead-room, a1 partial, b1 1 round, **c1 full 10/10**). Ground-truth rounds captured: **11** (10 c1 + 1 b1), every one with server reveal (-correct-reveal) recorded.
Raw data: research/w0-ressets-data.json (per-tile pixel features: alpha mask stats, connected components, enclosed-hole flood-fill, image moments θ/aspect, centroid, dominant hex + HSL). localStorage mirror: rsh3_ressets_{c1,b1,a1,g1} on the original site origin.

## 1. Shape-class taxonomy (pixel signatures, 220×220 tiles)

| class | holes | med fill(bbox) | med extent | med asp | notes |
|---|---|---|---|---|---|
| solid | 0 | 0.354 | 0.91 | 0.93 | filled triangle/square/diamond; rotations vary |
| hollow | ≥1 | 0.63 | 0.43 | 0.99 | STROKED outline shape, drawn ~43% of cell |
| ring | ≥1 | 0.135 | 0.88 | 1.00 | thin annulus, near full-cell diameter |
| small | 0 | 0.73 | 0.145 | 0.99 | tiny solid dot, bw≈32px constant |

Classifier used: holes==0 && ext<0.45 → small; holes==0 → solid; holes≥1 && asp>0.85 && fill<0.35 → ring; else hollow. Hole detection = background components not touching tile border (anti-aliasing splits thin strokes into multiple hole components — count is noisy, presence is reliable).

## 2. Round-type inventory observed this run (c1 gauntlet, in order)

R1 3×3 MIXED CLASS: [ring,hollow,ring / ring,hollow,ring / solid,hollow,?], single hue #1cbc3c; correct=ring.
R2 3×3 all-ring single-hue #7c8494, MICRO-VARIANT rings (stroke Δ≈2px @R97: thick ×6, thin ×3 at cells {2,3,7}); correct = thick variant.
R3 3×3 LATIN COLOR SQUARE (rings): rows [teal,pink,yellow]/[yellow,teal,pink]/[pink,yellow,?] → answer teal #049cac. Exact Latin property.
R4 2×2 all-small purple #841cdc; decoys include teal smalls → color-set completion among dots.
R5 2×2 hollow purple/yellow mix; correct completes color pair.
R6 2×2 cells {green,pink,yellow} all distinct + answer introduces 4TH HUE purple #841cdc → >3-hue set-completion (color-cycle) on 2×2.
R7 FUSED single-image 660×660 (class -single-image, '?' cut-out panel); options are a SHADE TRIAD of red-orange: dark #64140c(L22)/base #e43c24(L52)/light #f4a49c(L78); correct = dark.
R8 FUSED 660×660; options span 3 distinct hues {teal,purple,red}; correct red.
R9 3×3 all-solid #e43c24 with PARAMETRIC VARIANT FAMILY: θ∈{77,51,-65,-77,-51}, aspect .58-.93, ext .55-.94, centroids drift; cells repeat family members; correct extends the set.
R10 3×3 all-hollow light-yellow #f4e494 (L77 pastel); correct hollow.

b1-R1: 3×3 all-ring #7c8494 micro-variants again (thin at cells {5,7}), correct = majority-thickness ring.

## 3. Distribution rules (observed)

- Grid sizes: 3×3 and 2×2 matrix mode; separate fused single-image mode (660×660 composite, hole panel marked '?'). Hole position was ALWAYS last cell (idx 8 / idx 3) in every captured round — no mid-grid holes seen.
- Class distribution: either ALL-SAME-CLASS board (discriminator moves to color/shade/micro-geometry) or ONE mixed-class board per gauntlet where each column tends to a consistent class and the hole completes a column/row pattern.
- Color: single-hue boards use saturated brand hues (#1cbc3c,#7c8494,#e43c24,#841cdc,#049bac,#d4bc14); latin rounds use exactly the 3-hue triad teal/pink/yellow; 2×2 cycle round uses a 4-hue set incl. purple.
- Decoys: same-class same-hue NEAR-DUPLICATES for geometry rounds (Δstroke ≈2px, Δsize small); wrong-color or wrong-shade twins for color/shade rounds. Options always n=8.
- Timers: 3×3 matrix = 60s; 2×2 = 60s here (v1 saw 18-31s on easier boards); fused = 60s. Difficulty scales with pattern subtlety, not grid size alone.

## 4. Key discoveries

1. MICRO-VARIANT COMPLETION: the hardest-looking rounds use visually identical tiles that differ only by ~2px stroke thickness (rings) or small parametric jitter (solid family: rotation/squash/extent with repeated family members). The engine must support parametric decoy twins, not just categorical decoys.
2. SHADE-STEP CONFIRMED IN FUSED MODE: options form base/light/dark triads of one hue (L 22/52/78, ΔH≤3°, ΔS≤2) — shade axis is a first-class puzzle dimension, delivered both as fused panels (v1 rsh2#2 orange triad) and option sets.
3. LATIN GENERALIZES BEYOND 3-HUE: exact 3×3 hue-latin with uniform class (rings), plus a 2×2 four-hue color-cycle completion where the answer INTRODUCES a color absent from the board — rules are "complete the permutation/cycle", not "copy nearest neighbor".

## 5. Operational notes for future runs
- Headless tab MUST be foreground (Target.activateTarget) or lazy puzzle images never load (board renders empty).
- Answering while timer is live advances rounds; answering after expiry freezes progression.
- Shared profile localStorage identity (iqv.displayName) races between sibling researchers' tabs — expect room-name/display-name cross-talk.
- Full driver source embedded in session log; core = alpha-mask + component + hole + moment analysis at 220×220, fused segmentation at 660×660.
