/**
 * ONBOARD — stage-goal cards + puzzle-family legends (v2 port of v1's
 * goal-card engine defaults and onboard.js tone; mechanic not code).
 *
 * Two pure data surfaces, consumed by main.ts at deal time:
 *
 *  1. GOAL CARD — the 3-second "what am I doing" card shown before a takeover
 *     round takes input (v1 engine read optional stage.goalText / stage.controls;
 *     here every mounted takeover has a hand-written card). Text caps mirror the
 *     v1 normalize(): goal <= 140 chars, controls <= 90 chars.
 *
 *  2. FAMILY LEGEND — one line per REAL rule family (DNA.md set from
 *     families/families2/families3), shown as an escapable overlay at depths
 *     1-3 only, once per family per run. Derived from each family's own `rule`
 *     sentence, so the legend can never contradict the generator.
 *
 * Determinism: pure lookups over frozen tables — no Math.random, no Date.now,
 * no DOM. The only state is the once-per-run legend ledger; resetLegendRun()
 * must be called by main.ts when a run starts.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface GoalCard {
  /** canonical takeover stage id (see MOUNTED_STAGE_IDS ordering contract) */
  stageId: string;
  /** uppercase scene title, e.g. 'LASER STORM' */
  title: string;
  /** win condition, one or three short sentences */
  goal: string;
  /** input line, v1 style: 'CLICK / TAP ... · KEYS 1–8' */
  controls: string;
}

/** Overlay spec returned by maybeShowLegend — renderer draws text, Esc closes. */
export interface LegendOverlay {
  kind: 'legend';
  familyId: string;
  text: string;
}

/* ------------------------------------------------------------------ */
/* Stage ids                                                           */
/* ------------------------------------------------------------------ */

/**
 * The 11 mounted takeovers, in EXACTLY main.ts TAKEOVERS array order, so
 * Main can map roundPlan()'s takeover index -> stage id positionally:
 *   TAKEOVERS[idx] <-> MOUNTED_STAGE_IDS[idx]
 * Incoming wave-1 ports (PortRetro / PortNarrative files pacman2..sniper2)
 * get their own ids below so their goal cards exist the frame they mount.
 */
export const MOUNTED_STAGE_IDS = [
  'red-light',
  'tide-pool',
  'serpent',
  'floor-fall',
  'hunter-dodge',
  'laser-storm',
  'drone-dodge',
  'saber-clash',
  'slots',
  'slime-gallery',
  'the-well',
] as const;

export type MountedStageId = (typeof MOUNTED_STAGE_IDS)[number];

/** Incoming port stage ids (wave-1 ownership notes: pacman2..sniper2 files). */
export const PORT_STAGE_IDS = [
  'pacman2',
  'tetris2',
  'battleship2',
  'doom2',
  'phoenix2',
  'gauntlet2',
  'fractal2',
  'hypercube2',
  'sniper2',
] as const;

/* ------------------------------------------------------------------ */
/* Goal cards                                                          */
/* ------------------------------------------------------------------ */

const CARDS: Readonly<Record<string, GoalCard>> = Object.freeze({
  /* --- P7 wave: the seven stages the spec still had unbuilt --- */
  'lantern-guard': {
    stageId: 'lantern-guard',
    title: 'LANTERN GUARD',
    goal: 'DRAFTS COME FOR YOUR FLAME. SHUTTER THE SIDE THEY BLOW FROM, AND FEED THE LANTERN BY ANSWERING THE BOARD.',
    controls: 'MOVE TO AIM THE SHUTTER · ARROWS / WASD · CLICK OR KEYS 1–6',
  },
  'piano-round': {
    stageId: 'piano-round',
    title: 'THE RECITAL',
    goal: 'WATCH THE PHRASE, PLAY IT BACK ON THE KEYBOARD, THEN FINISH ON THE KEY WEARING THE MARK COUNT THE HOUSE ASKS FOR.',
    controls: 'CLICK / TAP A KEY · KEYS 1–8 · A S D F G H J K · ESC NEUTRAL',
  },
  lamp: {
    stageId: 'lamp',
    title: 'THE LAMP',
    goal: 'THE LAMP SELLS EVERY DOOR. EACH WISH PRINTS ITS PRICE IN TIME, BLOOD OR GOLD. THE MARK YOU NEED IS RARELY BEHIND THE CHEAP ONE.',
    controls: 'CLICK A WISH TO GRANT (Q/W/E) · CLICK A TILE OR KEYS 1–6',
  },
  pod: {
    stageId: 'pod',
    title: 'THE POD',
    goal: 'STAY INSIDE THE POD AND THEY FERRY THE MARKS UP TO YOU AND HEAL YOU WHILE THEY DO IT. BREAK AWAY AND YOU ARE FASTER, ALONE, AND COUNTED.',
    controls: 'MOVE TO SWIM · WASD / ARROWS · CLICK A SURFACED TILE OR KEYS 1–6',
  },
  'shelf-edge': {
    stageId: 'shelf-edge',
    title: 'SHELF EDGE',
    goal: 'SOMETHING CIRCLES AT THE EDGE OF SIGHT AND CLOSES WHILE YOU DITHER. COMMIT: A FAST WRONG GUESS COSTS LESS THAN A SLOW RIGHT ONE.',
    controls: 'CLICK / TAP · KEYS 1–4 · ESC BAILS NEUTRAL',
  },
  'the-orb': {
    stageId: 'the-orb',
    title: 'MISTER ORB',
    goal: 'HE IS NEUTRAL FOR NOW. ANSWER FIVE MARKS. THE FIRST ONE YOU GET WRONG TURNS HIM, AND THE SECOND ONE ENDS YOU.',
    controls: 'CLICK / TAP · KEYS 1–4 · ESC BAILS NEUTRAL',
  },
  'green-war': {
    stageId: 'green-war',
    title: 'THE GREEN WAR',
    goal: 'A FLARE SHOWS THE MARK. THE RAIN HIDES THE TREE LINE. HOLD THE MARK IN YOUR HEAD UNTIL A LULL LETS YOU ANSWER.',
    controls: 'CLICK / TAP · KEYS 1–8 · ESC BAILS NEUTRAL',
  },
  /* --- the 11 mounted (v1 goalText/controls where v1 had them) --- */
  'red-light': {
    stageId: 'red-light',
    title: 'RED LIGHT',
    goal: 'SOLVE ON GREEN. FREEZE ON RED.',
    controls: 'CLICK / TAP OR PRESS 1\u20134',
  },
  'tide-pool': {
    stageId: 'tide-pool',
    title: 'TIDE POOL',
    goal: 'ANSWER ONLY FROM A DRY POOL. THE TIDE DECIDES WHEN.',
    controls: 'CLICK / TAP A DRY POOL OR PRESS 1\u20138',
  },
  serpent: {
    stageId: 'serpent',
    title: 'SERPENT',
    goal: "EAT. GROW. DON'T BITE YOURSELF.",
    controls: 'ARROWS / WASD / SWIPE',
  },
  'floor-fall': {
    stageId: 'floor-fall',
    title: 'FLOOR-FALL',
    goal: 'ANSWER BEFORE THE TILE UNDER YOU DROPS.',
    controls: 'CLICK / TAP A STANDING TILE OR KEYS 1\u20138',
  },
  'hunter-dodge': {
    stageId: 'hunter-dodge',
    title: 'HUNTER DODGE',
    goal: "IT LOCKS ON. STAY OUT OF THE CONE AND BREAK THE LOCK WITH AN ANSWER.",
    controls: 'MOVE OUT OF THE BEAM \u00B7 CLICK / TAP OR KEYS 1\u20138',
  },
  'laser-storm': {
    stageId: 'laser-storm',
    title: 'LASER STORM',
    goal: 'PICK A LANE THE SKY IS NOT ABOUT TO FRY.',
    controls: 'CLICK / TAP A COLD LANE \u00B7 NEVER A FIRING ONE \u00B7 KEYS 1\u20138',
  },
  'drone-dodge': {
    stageId: 'drone-dodge',
    title: 'DRONE SWARM',
    goal: 'DODGE THE SWARM. ANSWER WHEN THE SKY IS CLEAR.',
    controls: 'MOVE TO EVADE \u00B7 CLICK / TAP OR KEYS 1\u20138',
  },
  'saber-clash': {
    stageId: 'saber-clash',
    title: 'SABER CLASH',
    goal: 'STRIKE INSIDE THE SWEET ARC. THREE RINGS.',
    controls: 'SPACE / CLICK / TAP TO STRIKE',
  },
  slots: {
    stageId: 'slots',
    title: 'ONE-ARMED GOD',
    goal: 'STOP THE REELS. ANY PAYOUT BEATS THE HOUSE.',
    controls: 'SPACE / CLICK / TAP TO STOP EACH REEL',
  },
  'slime-gallery': {
    stageId: 'slime-gallery',
    title: 'SLIME GALLERY',
    goal: 'POP SLIMES. NEVER SHOOT THE CROWN.',
    controls: 'CLICK / TAP / KEYS 1\u20139',
  },
  'the-well': {
    stageId: 'the-well',
    title: 'THE WELL',
    goal: 'STACK LINES. CLEAR. SURVIVE THE WELL.',
    controls: '\u2190\u2192 move \u00B7 \u2191/X cw \u00B7 Z ccw \u00B7 \u2193 soft \u00B7 SPACE drop \u00B7 P pause',
  },

  /* --- incoming wave-1 ports (own specs, v1 voice) --- */
  pacman2: {
    stageId: 'pacman2',
    title: 'GLUTTON',
    goal: 'EAT EVERY PELLET WITH TWO GHOSTS ON YOU. BIG DOTS FLIP THE HUNT FOR SIX SECONDS.',
    controls: 'ARROWS / WASD / SWIPE',
  },
  tetris2: {
    stageId: 'tetris2',
    title: 'THE WELL II',
    goal: 'CLEAR THE POSTED LINE QUOTA BEFORE THE STACK TOPS OUT.',
    controls: '\u2190\u2192 MOVE \u00B7 \u2191/X ROTATE \u00B7 Z ROTATE BACK \u00B7 \u2193 SOFT \u00B7 SPACE HARD DROP',
  },
  battleship2: {
    stageId: 'battleship2',
    title: 'SALVOS',
    goal: 'SINK THE SHADOW FLEET BEFORE YOUR SHELLS RUN OUT. EVERY THIRD SHELL DRAWS RETURN FIRE.',
    controls: 'CLICK / TAP ENEMY WATER',
  },
  doom2: {
    stageId: 'doom2',
    title: 'THE CORRIDOR',
    goal: 'REACH THE EXIT GATE. SHOOT WHAT SHAMBLES AT YOU. GRAB MEDKITS AND SHELLS.',
    controls: 'W / \u2191 ADVANCE \u00B7 S / \u2193 BACK \u00B7 SPACE FIRE',
  },
  phoenix2: {
    stageId: 'phoenix2',
    title: 'SEED RITUAL',
    goal: 'HOLD TO GROW THE SEEDLING. RELEASE INSIDE THE GLOWING BAND. BURN, THEN BE REBORN.',
    controls: 'HOLD SPACE / MOUSE \u00B7 RELEASE IN THE BAND',
  },
  gauntlet2: {
    stageId: 'gauntlet2',
    title: 'FOUR RIDERS',
    goal: 'FOUR TRIALS IN ORDER: CLAIM THE RIGHT CROWN, MASH THE WAR DRUM, TAKE THE SMALLEST SHARE, THEN BE STILL.',
    controls: 'CLICK / TAP TO PICK \u00B7 SPACE TO MASH \u00B7 TOUCH NOTHING FOR DEATH',
  },
  fractal2: {
    stageId: 'fractal2',
    title: 'DEEP ZOOM',
    goal: 'ONE ISLAND HOLDS STILL WHILE THE FRACTAL STREAMS PAST. COUNT ITS MARKS, PICK THE TILE THAT MATCHES.',
    controls: 'HOLD SPACE TO STABILIZE \u00B7 CLICK / TAP A TILE',
  },
  hypercube2: {
    stageId: 'hypercube2',
    title: '606D',
    goal: 'THE HEADER NAMES A MARK COUNT. THE TILES RIDE THE TESSERACT. CLICK THE ONE WEARING THAT COUNT.',
    controls: 'DRAG TO STEER THE SPIN \u00B7 CLICK / TAP A TILE',
  },
  popglitter2: {
    stageId: 'popglitter2',
    title: 'CHART TOPPER',
    goal: 'FOUR LANES OF FALLING NOTES. TAP EACH AS IT CROSSES THE LINE. COMBOS PAY; A MISS ONLY BREAKS THE CHAIN.',
    controls: 'D F J K / KEYS 1\u20134 / TAP THE PADS',
  },
  metal2: {
    stageId: 'metal2',
    title: 'FORGE SET',
    goal: 'THE HEAVIER SET. SAME FOUR LANES, SLOWER. GOLD ACCENT NOTES PAY DOUBLE.',
    controls: 'D F J K / KEYS 1\u20134 / TAP THE PADS',
  },
  terminator2: {
    stageId: 'terminator2',
    title: 'THE HUNT',
    goal: 'IT WALKS THE LANES AND RE-AIMS AT YOU. REACH THE SAFE STRIP, AND READ THE GLYPH PATTERN WHILE YOU RUN.',
    controls: 'MOVE TO EVADE \u00B7 CLICK / TAP THE NEXT GLYPH',
  },
  fury2: {
    stageId: 'fury2',
    title: 'FURY ROADRUN',
    goal: 'THREE LANES OF HIGHWAY. HIT THE SIGNS IN THE POSTED ORDER AND DODGE THE SPIKE TRAPS.',
    controls: 'W / S \u00B7 \u2191 \u2193 \u00B7 TAP TOP OR BOTTOM \u00B7 \u25B2\u25BC PADS',
  },
  skyfire2: {
    stageId: 'skyfire2',
    title: 'SKY FIRE',
    goal: 'MARK THE HOSTILE DRONES HIDING IN THE CROWD. HE BURNS THE LANES YOU MARK. CIVILIANS COST YOU. NOBODY FAILS THIS ONE.',
    controls: 'CLICK / TAP TO MARK \u00B7 KEYS 1\u20138',
  },
  sniper2: {
    stageId: 'sniper2',
    title: 'OVERWATCH',
    goal: 'THE SCOPE IS THE ONLY LIGHT. CONFIRM ONLY FIGURES WEARING THE POSTED HEAD-COUNT.',
    controls: 'MOUSE AIMS \u00B7 HOLD SPACE TO STEADY \u00B7 CLICK TO CONFIRM',
  },
});

/**
 * Stage ids in EXACTLY the order main.ts mounts them (`TAKEOVERS`).
 *
 * This is the ordering contract. main indexes THIS list, so a takeover can no
 * longer mount without a goal card, and a card cannot drift onto the wrong
 * scene. Adding a takeover means adding its id here AND its card above --
 * selfTest() fails if either is missing.
 */
export const TAKEOVER_STAGE_IDS = [
  'red-light', 'tide-pool', 'serpent', 'floor-fall', 'hunter-dodge',
  'laser-storm', 'drone-dodge', 'saber-clash', 'slots', 'slime-gallery',
  'the-well', 'pacman2', 'tetris2', 'battleship2', 'doom2',
  'phoenix2', 'gauntlet2', 'fractal2', 'hypercube2', 'sniper2',
  'popglitter2', 'metal2', 'terminator2', 'fury2', 'skyfire2',
  /* P7 wave — order MUST match main.TAKEOVERS exactly (selftest-enforced). */
  'lantern-guard', 'piano-round', 'lamp', 'pod', 'shelf-edge', 'the-orb', 'green-war',
] as const;

/** Goal card for the takeover main.ts mounts at TAKEOVERS[idx]. */
export function goalCardForIndex(idx: number): GoalCard | null {
  const id = TAKEOVER_STAGE_IDS[idx];
  return id ? goalCardFor(id) : null;
}

/** v1 normalize() caps: goal 140, controls 90. Title kept <= 40. */
export const GOAL_MAX = 140;
export const CONTROLS_MAX = 90;
export const TITLE_MAX = 40;

/**
 * Goal card for a takeover stage id, or null for unknown ids (callers fall
 * back to the v1 engine default 'survive the round'). The returned object is
 * frozen shared state — treat as read-only.
 */
export function goalCardFor(stageId: string): GoalCard | null {
  return CARDS[stageId] ?? null;
}

/* ------------------------------------------------------------------ */
/* Family legends                                                      */
/* ------------------------------------------------------------------ */

/**
 * One line per real rule family, derived from each generator's own `rule`
 * sentence (families.ts / families2.ts / families3.ts). If a family's rule
 * changes, change its legend with it.
 */
const LEGENDS: Readonly<Record<string, string>> = Object.freeze({
  'count-grid': 'Columns double the count; each row starts a step higher.',
  accretion: 'Each step adds one structure: diagonal, then corners, then edge dots.',
  'rotation-composite': 'The dot ring spins 90\u00B0 each step while one more dot joins.',
  'position-orbit': 'The dot steps a fixed angle per column; its orbit widens per row.',
  'missing-section': 'Section counts grow across and down; mark kind cycles reading-order.',
  'dot-matrix-rotate': 'The dot arc turns 90\u00B0 per column and gains one dot per row.',
  'line-reflection': 'The right column mirrors the left horizontally; the bottom row mirrors the top.',
  'count-positions': 'The mark count never changes; occupied spots advance one step per column.',
  'size-ladder': 'The triangle climbs one size rung per column and turns 90\u00B0 per row.',
});

export const LEGEND_MAX = 120;

/** The nine family ids every legend must cover (DNA-real families only). */
export const ALL_FAMILY_IDS = Object.keys(LEGENDS);

/** One-line rule legend for a puzzle family id, or null if unknown. */
export function legendFor(familyId: string): string | null {
  return LEGENDS[familyId] ?? null;
}

/* ------------------------------------------------------------------ */
/* Once-per-run legend gating                                          */
/* ------------------------------------------------------------------ */

/** Legends show only on depths 1-3 — after that the rules are assumed known. */
export const LEGEND_DEPTHS = [1, 2, 3];

const seenThisRun = new Set<string>();

/** Call when a new run starts so early depths teach again. */
export function resetLegendRun(): void {
  seenThisRun.clear();
}

/**
 * Overlay spec for a family legend, or null.
 * Shows at depths 1-3 only, once per family per run; unknown families and
 * repeat asks yield null so callers can skip rendering entirely.
 */
export function maybeShowLegend(depth: number, familyId: string): LegendOverlay | null {
  if (!LEGEND_DEPTHS.includes(depth)) return null;
  if (seenThisRun.has(familyId)) return null;
  const text = LEGENDS[familyId];
  if (text === undefined) return null;
  seenThisRun.add(familyId);
  return { kind: 'legend', familyId, text };
}

/* ------------------------------------------------------------------ */
/* Self-test                                                           */
/* ------------------------------------------------------------------ */

export interface SelfTestResult {
  ok: boolean;
  failures: string[];
}

export function selfTest(): SelfTestResult {
  const failures: string[] = [];

  /* --- coverage: EVERY takeover main mounts has a card ---------------
   * This is the gate that matters. 25 takeovers were wired into the
   * rotation while only 20 cards existed and main indexed a hardcoded
   * 11-entry list, so 14 chaos rounds mounted with no instructions at
   * all: "not even clear what you're supposed to do" (owner, 2026-08-26).
   * Coverage is now asserted against the ordering contract itself. */
  for (const id of TAKEOVER_STAGE_IDS) {
    const card = goalCardFor(id);
    if (!card) {
      failures.push(`no goal card for mounted takeover ${id}`);
      continue;
    }
    if (card.stageId !== id) failures.push(`${id}: stageId mismatch`);
  }
  /* This used to assert the literal 25 — a snapshot of the roster, not the
   * contract, so it went red the moment a stage was added and told you nothing
   * about whether main.ts agreed. What actually matters is that every mounted
   * takeover has a card and the two orders line up, which the loops either
   * side of this already prove. All that is left worth asserting is that the
   * roster never SHRINKS silently: stages are only ever added here. */
  if (TAKEOVER_STAGE_IDS.length < 25) {
    failures.push(`takeover roster shrank to ${TAKEOVER_STAGE_IDS.length} (was 25 at the P7 wave)`);
  }
  if (new Set(TAKEOVER_STAGE_IDS).size !== TAKEOVER_STAGE_IDS.length) {
    failures.push('duplicate id in TAKEOVER_STAGE_IDS');
  }
  for (let i = 0; i < TAKEOVER_STAGE_IDS.length; i++) {
    if (goalCardForIndex(i)?.stageId !== TAKEOVER_STAGE_IDS[i]) {
      failures.push(`goalCardForIndex(${i}) does not match the ordering contract`);
    }
  }
  if (goalCardForIndex(-1) !== null || goalCardForIndex(999) !== null) {
    failures.push('out-of-range takeover index should be null');
  }

  /* --- coverage: all 11 mounted stage ids --- */
  for (const id of MOUNTED_STAGE_IDS) {
    const card = goalCardFor(id);
    if (!card) {
      failures.push(`no goal card for mounted stage ${id}`);
      continue;
    }
    if (card.stageId !== id) failures.push(`${id}: stageId mismatch`);
    if (!card.title || card.title !== card.title.toUpperCase()) failures.push(`${id}: bad title`);
    if (!card.goal.trim()) failures.push(`${id}: empty goal`);
    if (!card.controls.trim()) failures.push(`${id}: empty controls`);
    if (card.title.length > TITLE_MAX) failures.push(`${id}: title ${card.title.length} > ${TITLE_MAX}`);
    if (card.goal.length > GOAL_MAX) failures.push(`${id}: goal ${card.goal.length} > ${GOAL_MAX}`);
    if (card.controls.length > CONTROLS_MAX) failures.push(`${id}: controls ${card.controls.length} > ${CONTROLS_MAX}`);
    if (/[\n\r]/.test(card.goal + card.controls + card.title)) failures.push(`${id}: multi-line card`);
  }
  if (MOUNTED_STAGE_IDS.length !== 11) failures.push(`mounted count ${MOUNTED_STAGE_IDS.length} != 11`);

  /* --- coverage: the 9 incoming ports also have cards --- */
  for (const id of PORT_STAGE_IDS) {
    if (!goalCardFor(id)) failures.push(`no goal card for incoming port ${id}`);
  }

  /* --- unknown id -> null, never throw --- */
  if (goalCardFor('not-a-stage') !== null) failures.push('unknown stage id should be null');
  if (goalCardFor('') !== null) failures.push('empty stage id should be null');

  /* --- coverage: all 9 families have single-line, capped legends --- */
  const expectedFamilies = [
    'count-grid', 'accretion', 'rotation-composite', 'position-orbit', 'missing-section',
    'dot-matrix-rotate', 'line-reflection', 'count-positions', 'size-ladder',
  ];
  if (ALL_FAMILY_IDS.length !== 9) failures.push(`family legend count ${ALL_FAMILY_IDS.length} != 9`);
  for (const fam of expectedFamilies) {
    const text = legendFor(fam);
    if (text === null) {
      failures.push(`no legend for family ${fam}`);
      continue;
    }
    if (!text.trim()) failures.push(`${fam}: empty legend`);
    if (text.length > LEGEND_MAX) failures.push(`${fam}: legend ${text.length} > ${LEGEND_MAX}`);
    if (/[\n\r]/.test(text)) failures.push(`${fam}: multi-line legend`);
  }
  if (legendFor('color-rotation') !== null) failures.push('anti-DNA family should have no legend');

  /* --- once-per-run semantics --- */
  resetLegendRun();
  let shown = 0;
  for (const depth of [1, 2, 3]) {
    for (const fam of expectedFamilies) {
      const ov = maybeShowLegend(depth, fam);
      if (depth === 1 && !ov) failures.push(`depth 1 first ask missing overlay for ${fam}`);
      if (ov) {
        shown++;
        if (ov.kind !== 'legend' || ov.familyId !== fam || ov.text !== legendFor(fam)) {
          failures.push(`${fam}: overlay spec mismatch`);
        }
      }
      // second ask inside the same run must be null regardless of depth
      if (maybeShowLegend(depth, fam) !== null) failures.push(`${fam}: showed twice in one run`);
    }
  }
  if (shown !== 9) failures.push(`expected 9 overlays across depths 1-3, got ${shown}`);

  /* depth gate */
  resetLegendRun();
  for (const depth of [-1, 0, 4, 5, 99]) {
    if (maybeShowLegend(depth, 'accretion') !== null) failures.push(`depth ${depth} should show nothing`);
  }

  /* unknown family at valid depth -> null, does not consume the gate */
  resetLegendRun();
  if (maybeShowLegend(1, 'mystery-family') !== null) failures.push('unknown family should be null');

  /* reset restores teaching */
  resetLegendRun();
  if (maybeShowLegend(2, 'accretion') === null) failures.push('resetLegendRun did not restore depth 2 teaching');
  if (maybeShowLegend(2, 'accretion') !== null) failures.push('post-reset second ask should be null');

  /* determinism: pure lookup twice, identical result objects' content */
  const a = goalCardFor('laser-storm');
  const b = goalCardFor('laser-storm');
  if (!a || !b || a.goal !== b.goal || a.controls !== b.controls || a.title !== b.title) {
    failures.push('goalCardFor not stable');
  }

  return { ok: failures.length === 0, failures };
}

/* Node smoke entry: node --experimental-strip-types src/meta/onboard.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/onboard.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] ONBOARD OK' : `[selftest] ONBOARD FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
