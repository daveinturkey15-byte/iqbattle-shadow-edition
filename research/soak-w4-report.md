# Soak W4 Report — headless soak triage (SoakRunner, 2026-08-25)

Subject: `research/soak-headless.js` run + W4-pack warning triage.
Method note: **zero repo files were modified.** All runs used byte-faithful copies of the
harness placed at repo root (see Finding H1), generated via `sed` from the committed file
and deleted after the run. Seed variants = textual substitution of the hardcoded
`IQ.Align.begin('<seed>',4096)` argument; W4 variants extend the `packs[]` array only.

## Verdict

**PASS on gameplay dispatch** (0 round errors, 0 NaN, 0 warnings from any W4 pack across
all runs) — **with 3 documented harness defects** (H1–H3) that Main should action:

| ID | Severity | Finding |
|----|----------|---------|
| H1 | defect (blocks as-committed) | Harness cannot run from its own location: its `require('./alignment.js')` etc. resolve against `research/`, but all modules live at repo root → `MODULE_NOT_FOUND`, exit 1. Runs only when the file is placed at repo root. Fix: `./` → `../` in requires (or move file to root). |
| H2 | gap | No CLI flags/seeds at all: seed string is hardcoded (`'soak-seed'`). Seed variants below were produced by sed on throwaway copies. Suggest `process.env.SOAK_SEED \|\| 'soak-seed'`. |
| H3 | gap vs assignment | The requested **per-depth stage census / takeover-rail check is not exercisable by this harness**. It dispatches IQ.Hooks events only; `IQ.Stage`, the director (`pick()`, `minDepth>=3`, ≤1 takeover per any 3 consecutive depths) and all `modes/*.js` takeovers are never loaded headless (director lives in index.html, Main-only). "Takeovers firing / puzzle dominant / minDepth rails" needs a director-level soak (extract director pick() or drive a browser). Nothing in this report speaks to takeover rails. |

## Standard config result (seed-a, solo, 0.72 answer rate)

Exit code **0**, `errs:0`, `deaths:1` (hp exhausted at depth 47).

```
maxDepthReached 47   hpLeft -4   score 4000   packsLoaded 36
picksFired: hell-layer 3, jungle 5, riot 14, phoenix-rise 3, jester-court 2,
  genie-den 1, cave 1, volcano 7, iran-bazaar 1, fractal-void 1, hell 2
modifierCounts: timerDelta 10, bannerText 26, sfx 17, flag 19, hpDelta 11,
  scoreMul 4, overlayHTML 3, overlayMs 1
```

Per-depth stage census does not exist in this harness (H3); the closest proxy above is the
per-world hook-fire census. Every world hit by the alignment plan received hook coverage;
no world went silent.

## Seed variance (3 seeds + committed default)

| Seed | maxDepth | score | hpLeft | worlds fired |
|------|---------:|------:|-------:|--------------|
| `soak-seed-a` (standard above) | 47 | 4000 | −4 | 11 worlds |
| `soak-seed-b` | 3 | 0 | −14 | hell-layer 3, symbiote-party 2, jungle 2 |
| `soak-seed-c` | 11 | 800 | −14 | hell-layer 3, jungle 2, riot 4, phoenix-rise 2, volcano 2, jester-court 2, limbo 1 |
| `soak-seed` (committed default) | 3 | 0 | −14 | hell-layer 3, jungle 4/5, riot 5 |

**Variance is extreme (depth 3 → 47) and the mechanism is identified, not noise:** the
pack-events NUKE (P=1/40 per hostile round, `hpDelta := 1 − ctx.hp`, flavor "EVERYONE LEFT
AT 1 HP") fires early on short seeds while the simulated answer streak is cold; hp:=1 then
the next wrong answer (−15) kills before the forced sanctum/heaven relief round can heal.
Instrumented trace (seed-a + W4 packs): rounds 1–3 mixed, round-4 roundStart emits
`{hpDelta:-81, flag:{nuke:true}, sfx:'siren'}` → hp 1 → wrong answer → −14 → death.

Two follow-ups for Main (not W4 regressions):
1. **NUKE vs engine clamp contract tension:** brief says engine clamps `hpDelta` to
   [−60,60]; NUKE legitimately emits `1 − hp`, i.e. −61..−99 whenever ctx.hp > 61. If the
   engine clamps it, "left at 1 HP" silently becomes "left at hp−60" — either exempt the
   nuke-flagged modifier from the clamp or rescale the mechanic.
2. **RNG-stream coupling:** W4 packs are `always:true`, so their registration shifts the
   shared `ctx.rng` draw order during roundStart fans — identical seeds produce different
   event rolls with vs without W4 packs (seed-a: depth 47 without W4 packs vs depth 3
   with, purely from a shifted NUKE roll). Determinism per-build is intact; cross-pack-set
   replay comparability is not. Fine for ship, worth knowing when diffing soaks.

## W4 pack load + warning inventory

Extended-config runs (all landed W4 files added to `packs[]`; `packsLoaded` 36 → 54,
no `LOADFAIL` lines): `hellheaven` ('hell-heaven'), `pack-hellaudio` ('hell-audio'),
`hell-skin`, `sanctuary`, `cameo-pack`, `pack-cavern`, `pack-popcult-a/b`,
`pack-story`, `pack-funny` ('dread-tracker' + 'funny-flashback'), `pack-onboard-w4`,
`pack-quips-w4`.

**[IQ.Hooks] swallow-warning census over every run — zero mention any W4 pack id**
(hell-heaven, hell-audio, hell-skin, sanctuary, cameo-pack, pack-cavern, dread-tracker,
funny-flashback, onboard-w4, quips-w4, popcult-*): clean.

Complete inventory of every `[IQ.Hooks]` warning observed (all one root cause):

| Thrower | Event(s) | Message | Assessment |
|---------|----------|---------|------------|
| `pack-realm` | roundStart, interlude | `document.body.classList.toggle is not a function` | Harness stub gap: soak's fake `document.body.classList` implements add/remove/contains but not toggle. Not a pack bug; browser-safe (swallowed exactly as designed, other handlers unaffected). Fix the stub (`toggle(){return true}`) to silence. |
| `pack-chaos` | roundStart | same | same cause; fires only on some seeds/plans. |

## NaN verification

`grep -c NaN` over full stdout+stderr of every run (baseline ×2 reruns, seeds b/c, W4,
W4-deep, final all-W4): **0 occurrences in all runs.** Census JSON carries raw numbers
throughout; hp/score stay finite integers even through the −81 nuke delta.

## Integration notes

- Soak exercises hooks.js dispatch, alignment plans, and 54 hook packs cleanly headless —
  swallow-isolation works (throwing pack-realm never poisoned a round's other handlers).
- `pack-quips-w4.js` landed mid-triage and was included in the final run: loads and
  registers clean, adds no warnings.
- Requested takeover-rail verification remains open until a director-level soak exists
  (H3) — recommend Main extract `pick()`/rails into a requireable module or add a
  browser-driven stage census to the QA pass.
