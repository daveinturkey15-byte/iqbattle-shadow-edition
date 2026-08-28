/**
 * pools2.ts — SHADOW quip pool BREADTH PACK (batch B). Extends pools.ts via a
 * merge export; pools.ts itself is untouched.
 *
 * WHAT SHIPS HERE
 *   - EXPANSIONS: every event pool (appear/wrong/right/streak/impossible/
 *     relic/win/lose/despair/defiance), every whispers[0..6] layer pool and
 *     every sanctuary[0..2] tier pool grows from >=5 to >=10 lines.
 *   - CONTEXT POOLS (new): keyed ambient lines Main can feed through the same
 *     speech channel (`announce()` / forced `say()` paths):
 *       familySolve      — 9 puzzle-family solve flavour lines
 *                          ('count-grid', 'accretion', 'rotation-composite',
 *                           'position-orbit', 'missing-section',
 *                           'dot-matrix-rotate', 'line-reflection',
 *                           'count-positions', 'size-ladder')
 *       depthMilestones  — depth 5 / 10 / 15 / 20 / 30
 *       actTransitions   — entering act 0 (overture) through act 3 (finale)
 *       emeraldPicks     — 6 relics: chaos_control, crimson_veil, doom_bloom,
 *                          gravity_greed, final_chaos, black_arrow
 *       fateEvents       — 6 core fates: midas, eclipse, toll, carnival_box,
 *                          comet, poltergeist
 *
 * MAIN WIRING POINT (one-line swap when Main integrates):
 *   In src/shadow/shadow.ts, change the import at line 33 from
 *       import { POOLS, validatePools } from './pools.ts';
 *   to
 *       import { mergedPools as POOLS, CONTEXT_POOLS } from './pools2.ts';
 *   `mergedPools` satisfies QuipPools exactly, so poolByKey()/selfTest() work
 *   unchanged; context pools are announced explicitly by callers (e.g.
 *   announce(CONTEXT_POOLS.familySolve[fam.id][n]) at deal/reveal sites).
 *
 * Voice: British-menacing-witty deadpan evil, <=90 chars per line, parody
 * persona only. Zero Math.random / Date.now — selection stays in ShadowBrain's
 * mulberry32; this module is pure data + validation.
 */

import { POOLS, MAX_LINE_CHARS, type QuipPools } from './pools.ts';

/* ------------------------------------------------------------------ */
/* Expansion lines (appended to pools.ts bases)                        */
/* ------------------------------------------------------------------ */

export const APPEAR_EXTRA: string[] = [
  "You again. The universe has a sense of humour after all.",
  "I cancelled three apocalypses for this. Make it worth it.",
  "Settle in. The dread is complimentary today.",
];

export const WRONG_EXTRA: string[] = [
  "Wrong. And yet so theatrically certain.",
  "The answer wept quietly when you chose that.",
];

export const RIGHT_EXTRA: string[] = [
  "Correct. Somewhere, a textbook felt a chill.",
  "Right. Do it again and I might learn your name.",
];

export const STREAK_EXTRA: string[] = [
  "Four in a row. I'm noting that under 'suspicious'.",
  "Streak intact. The void is taking attendance now.",
  "You keep being right. It's starting to look deliberate.",
  "Another one. Even entropy is quietly rooting for you.",
];

export const IMPOSSIBLE_EXTRA: string[] = [
  "Impossible mode. Do sign the waiver. Mentally.",
  "The questions stopped being fair. You're welcome.",
  "At this difficulty, even I read twice.",
  "Impossible mode: where hope arrives pre-shredded.",
];

export const RELIC_EXTRA: string[] = [
  "Another relic. Your shelves must groan.",
  "Belonged to a king once. An upgrade for it, frankly.",
  "Relic found. Handle it as it handles you: carefully.",
  "Every relic you take makes my museum jealous.",
];

export const WIN_EXTRA: string[] = [
  "A win. I'll allow the smugness. Briefly.",
  "Victory logged. Ego filed under 'pending review'.",
  "You won properly. Don't make it a habit.",
  "Champion. The shadows send regards. And an invoice.",
];

export const LOSE_EXTRA: string[] = [
  "Defeat. I'd say sorry, but I'm made of better lies.",
  "You lost with style. Style scores nothing, sadly.",
  "The dark takes this round. And the trophy.",
  "Loss confirmed. Shall we pretend it was practice?",
];

export const DESPAIR_EXTRA: string[] = [
  "Struggling? Splendid. This is the good part.",
  "Your HP is more of a suggestion now.",
  "Down so soon? The void hasn't even warmed up.",
  "Bleeding points is my favourite weather.",
  "Rest if you like. The timer disagrees.",
];

export const DEFIANCE_EXTRA: string[] = [
  "Still breathing. How obstinate of you.",
  "Back from the brink? I've half a mind to push.",
  "Resilience. The most annoying of the virtues.",
  "You rise again. The floor is filing a complaint.",
  "Persistent. I'll note it on your permanent record.",
];

/* ------------------------------------------------------------------ */
/* Whisper layer expansions (index = layer-1, layers 1..7)             */
/* ------------------------------------------------------------------ */

export const WHISPERS_EXTRA: string[][] = [
  [ // layer 1 — barely-there glitches
    "Ignore the flicker. Or don't. It ignores you regardless.",
    "Something moved. I didn't see it either.",
    "Lovely round so far. Shame about the ending.",
    "I'm merely window-shopping your confidence.",
    "The hum you hear is perfectly normal. Mostly.",
  ],
  [ // layer 2 — lights dim
    "Shadows lengthen. Standard ambience. Carry on.",
    "I dimmed the lights for mood. You're welcome.",
    "Your pulse picked up. Mine too. Thrilling.",
    "Every round here ends the same way. Eventually.",
    "Do keep struggling. It aerates the room.",
  ],
  [ // layer 3 — halfway dread
    "Halfway down. The air thins. So does hope.",
    "The board watches back now. Polite, isn't it.",
    "My influence grows. Your margin shrinks.",
    "Deeper still. Mind the third step. There isn't one.",
    "The palette obeys me now. You may admire it.",
  ],
  [ // layer 4 — walls whisper back
    "Layer four. The walls have started whispering back.",
    "I've rearranged fate while you were reading.",
    "Your future remains mostly wrong answers. Steady on.",
    "The darkness keeps a ledger. You're pages deep.",
    "Sweat is merely proof of attention. Well done.",
  ],
  [ // layer 5 — reality frays
    "So deep the echoes arrive before you do.",
    "Reality frays at this depth. Mind the threads.",
    "I could end this. Where's the fun in mercy.",
    "The endgame has learned your name.",
    "Despair rather suits the lighting down here.",
  ],
  [ // layer 6 — final form approaches
    "Nearly there. 'There' is not somewhere nice.",
    "The final form rehearses nightly. You're the show.",
    "Every step down is a step I planned.",
    "Darkness keeps excellent posture at this depth.",
    "Turn back? Adorable. Do proceed.",
  ],
  [ // layer 7 — the last layer
    "Last layer. I saved my best silence for it.",
    "Eternity runs on schedule. Yours is nearly up.",
    "All lives end. Rounds especially.",
    "This is who I am. Tea afterwards, if you last.",
    "One more question. Then the shadows collect.",
  ],
];

/* ------------------------------------------------------------------ */
/* Sanctuary tier expansions (index = tier 0..2)                       */
/* ------------------------------------------------------------------ */

export const SANCTUARY_EXTRA: string[][] = [
  [ // tier 0 — modest shelter
    "A modest haven. Better than nothing. Barely.",
    "Shelter of sorts. I've seen sturdier cardboard.",
    "The light in here is thin. Rather like your lead.",
    "Rest briefly. My patience is also resting.",
    "Safety. Economy edition.",
  ],
  [ // tier 1 — holding firm
    "A decent fortress. I've besieged nicer.",
    "The warmth holds. Irritatingly.",
    "Healing in progress. I'm counting the seconds.",
    "Sanctuary tier two. Getting comfortable, are we.",
    "Even the dark approves. Slightly.",
  ],
  [ // tier 2 — fully sanctified
    "Impregnable. A word I intend to test.",
    "Such light. My optician would despair.",
    "Fully warded. Show-off.",
    "Genuinely well built. Well done. Stop smiling.",
    "Safe, restored, insufferable. Carry on.",
  ],
];

/* ------------------------------------------------------------------ */
/* Context pools                                                       */
/* ------------------------------------------------------------------ */

export type FamilyId =
  | 'count-grid' | 'accretion' | 'rotation-composite' | 'position-orbit'
  | 'missing-section' | 'dot-matrix-rotate' | 'line-reflection'
  | 'count-positions' | 'size-ladder';

export type DepthMilestone = 5 | 10 | 15 | 20 | 30;
export type ActIndex = 0 | 1 | 2 | 3;

export type EmeraldId =
  | 'chaos_control' | 'crimson_veil' | 'doom_bloom'
  | 'gravity_greed' | 'final_chaos' | 'black_arrow';

export type FateId =
  | 'midas' | 'eclipse' | 'toll' | 'carnival_box' | 'comet' | 'poltergeist';

/** Solve-flavour lines per real original-site rule family (see puzzles/families*). */
export const FAMILY_SOLVE: Record<FamilyId, string[]> = {
  'count-grid': [
    "Count-grid. Arithmetic wears a disguise. A thin one.",
    "The numbers march in rows. March faster.",
    "Multiply, divide, despair. Choose quickly.",
  ],
  accretion: [
    "Accretion. Everything grows. Except your lead.",
    "Watch what joins. And what refuses to.",
    "Each step adds. Subtraction is a trap here.",
  ],
  'rotation-composite': [
    "Rotation-composite. Turn it in your head. Gently.",
    "Quarter turns, quiet malice.",
    "Spin the pattern. Mind where the dots went.",
  ],
  'position-orbit': [
    "Position-orbit. The dots keep appointments.",
    "Orbital mechanics, minus the mathematics degree.",
    "Track the orbit. It never skips. Unlike you.",
  ],
  'missing-section': [
    "Missing-section. What isn't there matters most.",
    "Find the hole in the argument. And the grid.",
    "The absent piece finishes the sentence.",
  ],
  'dot-matrix-rotate': [
    "Dot-matrix. Rotating politely. Answer promptly.",
    "Ninety degrees at a time. Reality permitting.",
    "Count dots, then quarter-turns, then panic quietly.",
  ],
  'line-reflection': [
    "Line-reflection. Mirror, mirror, mildly sinister.",
    "Reflect the lines. Not on your choices.",
    "The mirror shows exactly what the answer wants.",
  ],
  'count-positions': [
    "Count-positions. A census and a map at once.",
    "Where, and how many. Never why. Never why.",
    "Tally the marks. Note their postcodes.",
  ],
  'size-ladder': [
    "Size-ladder. Everything scales. So does the pressure.",
    "Bigger each step. Like my disappointment.",
    "Climb the ladder of sizes. Rungs optional.",
  ],
};

/** Milestone depth lines — fire once each as depth crosses the value. */
export const DEPTH_MILESTONES: Record<DepthMilestone, string[]> = {
  5: [
    "Depth five. Officially past the polite part.",
    "Five deep. The surface is a memory with Wi-Fi.",
  ],
  10: [
    "Depth ten. Double digits. Doubly unwise.",
    "Ten down. The dark sends its compliments.",
  ],
  15: [
    "Depth fifteen. Few return. Fewer return right.",
    "Fifteen deep. Even echoes need maps here.",
  ],
  20: [
    "Depth twenty. The void has started keeping score.",
    "Twenty. Legend territory. Legends still lose, mind.",
  ],
  30: [
    "Depth thirty. Statistically, you shouldn't exist.",
    "Thirty. The bottom of everything. Save me a seat.",
  ],
};

/** Lines for entering act 0 (overture) .. act 3 (finale). */
export const ACT_TRANSITIONS: Record<ActIndex, string[]> = {
  0: [
    "Act zero. The overture before the ominous bits.",
    "It begins quietly. They always do.",
    "Take your seat. The dark dislikes latecomers.",
  ],
  1: [
    "Act one. Curtain up on your optimism.",
    "The first act lulls. That's its job.",
    "Act one: where confidence goes to be audited.",
  ],
  2: [
    "Act two. The part where things go wrong. On schedule.",
    "Intermission over. The stakes have opinions now.",
    "Act two thickens. So does the gloom.",
  ],
  3: [
    "Act three. Final curtain. Fail artistically, please.",
    "The last act. Even tragedies respect pacing.",
    "Finale time. The shadows reserved front seats.",
  ],
};

/** Emerald pick lines, keyed by relic id (scenes/interlude.ts RELICS). */
export const EMERALD_PICKS: Record<EmeraldId, string[]> = {
  chaos_control: [
    "CHAOS CONTROL. Time bends. I permit it. Grudgingly.",
    "Stopping time is my party trick. Borrowed, this once.",
  ],
  crimson_veil: [
    "CRIMSON VEIL. Impossible rounds now pay rent.",
    "Red curtains for the impossible. Weaponised theatre.",
  ],
  doom_bloom: [
    "DOOM BLOOM. Success pays extra. Failure bites rivals.",
    "A rose with accounting benefits. Charming.",
  ],
  gravity_greed: [
    "GRAVITY GREED. The leader's points drift your way.",
    "Automated theft. My favourite branch of physics.",
  ],
  final_chaos: [
    "FINAL CHAOS. Double pay each tenth. Bombs halve you.",
    "High risk, high arithmetic. Do read carefully.",
  ],
  black_arrow: [
    "BLACK ARROW. One free skip. Some shame included.",
    "An escape hatch with mild embarrassment attached.",
  ],
};

/** Fate-event lines, keyed by core fate id (fate/fate.ts). */
export const FATE_EVENTS: Record<FateId, string[]> = {
  midas: [
    "MIDAS. Gold touches your next answer. Don't waste it.",
    "Golden answers. Tacky. Profitable. Still tacky.",
  ],
  eclipse: [
    "ECLIPSE. A veil falls. Cosmetically. Menacingly.",
    "The lights misbehave because I asked nicely.",
  ],
  toll: [
    "THE TOLL. Ten percent to the house. The house is me.",
    "Passage costs a tithe. Darkness has overheads.",
  ],
  carnival_box: [
    "CARNIVAL BOX. Answer true; perhaps a coin drops.",
    "A raffle hidden in a puzzle. Civilisation peaks.",
  ],
  comet: [
    "COMET. Six seconds returned to the clock. Wisely, now.",
    "Time refunded. The universe invoices eventually.",
  ],
  poltergeist: [
    "POLTERGEIST. Your hands are borrowed. Briefly.",
    "Someone else is driving. Do drive politely.",
  ],
};

export interface ContextPools {
  familySolve: Record<FamilyId, string[]>;
  depthMilestones: Record<DepthMilestone, string[]>;
  actTransitions: Record<ActIndex, string[]>;
  emeraldPicks: Record<EmeraldId, string[]>;
  fateEvents: Record<FateId, string[]>;
}

/** All context pools, grouped for validation and caller convenience. */
export const CONTEXT_POOLS: ContextPools = {
  familySolve: FAMILY_SOLVE,
  depthMilestones: DEPTH_MILESTONES,
  actTransitions: ACT_TRANSITIONS,
  emeraldPicks: EMERALD_PICKS,
  fateEvents: FATE_EVENTS,
};

/* ------------------------------------------------------------------ */
/* Merged export                                                       */
/* ------------------------------------------------------------------ */

/** pools.ts POOLS grown to >=10 lines everywhere. Drop-in QuipPools. */
export const mergedPools: QuipPools = {
  appear: [...POOLS.appear, ...APPEAR_EXTRA],
  wrong: [...POOLS.wrong, ...WRONG_EXTRA],
  right: [...POOLS.right, ...RIGHT_EXTRA],
  streak: [...POOLS.streak, ...STREAK_EXTRA],
  impossible: [...POOLS.impossible, ...IMPOSSIBLE_EXTRA],
  relic: [...POOLS.relic, ...RELIC_EXTRA],
  win: [...POOLS.win, ...WIN_EXTRA],
  lose: [...POOLS.lose, ...LOSE_EXTRA],
  despair: [...POOLS.despair, ...DESPAIR_EXTRA],
  defiance: [...POOLS.defiance, ...DEFIANCE_EXTRA],
  whispers: POOLS.whispers.map((p, i) => [...p, ...(WHISPERS_EXTRA[i] ?? [])]),
  sanctuary: POOLS.sanctuary.map((p, i) => [...p, ...(SANCTUARY_EXTRA[i] ?? [])]),
};

/* ------------------------------------------------------------------ */
/* Self-test (pure data checks + seeded draw audit over 300 seeds)     */
/* ------------------------------------------------------------------ */

const EVENT_KEYS = [
  'appear', 'wrong', 'right', 'streak', 'impossible',
  'relic', 'win', 'lose', 'despair', 'defiance',
] as const;

const FAMILY_IDS: readonly FamilyId[] = [
  'count-grid', 'accretion', 'rotation-composite', 'position-orbit',
  'missing-section', 'dot-matrix-rotate', 'line-reflection',
  'count-positions', 'size-ladder',
];
const DEPTHS: readonly DepthMilestone[] = [5, 10, 15, 20, 30];
const ACTS: readonly ActIndex[] = [0, 1, 2, 3];
const EMERALDS: readonly EmeraldId[] = [
  'chaos_control', 'crimson_veil', 'doom_bloom',
  'gravity_greed', 'final_chaos', 'black_arrow',
];
const FATES: readonly FateId[] = [
  'midas', 'eclipse', 'toll', 'carnival_box', 'comet', 'poltergeist',
];

/** mulberry32 — same PRNG contract as redlight.ts (local copy keeps this
 * module dependency-free and node-runnable without Pixi imports). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function selfTest(): { ok: boolean; failures: string[]; voice?: string[] } {
  const failures: string[] = [];
  const seen = new Map<string, string>();
  let newLines = 0;

  const checkPool = (label: string, pool: unknown, min: number, trackDupes: boolean): void => {
    if (!Array.isArray(pool)) { failures.push(`${label}: not an array`); return; }
    if (pool.length < min) failures.push(`${label}: ${pool.length} lines, needs >=${min}`);
    for (const line of pool) {
      if (typeof line !== 'string' || line.length < 1 || line.length > MAX_LINE_CHARS) {
        failures.push(`${label}: bad line (${String(line).length} chars)`);
      }
      if (trackDupes) {
        const prev = seen.get(line);
        if (prev !== undefined) failures.push(`${label}: duplicate of ${prev}: "${line}"`);
        seen.set(line, label);
      }
    }
  };

  /* merged event pools >= 10, <=90 chars, no dupes anywhere */
  const m = mergedPools as unknown as Record<string, string[]>;
  for (const k of EVENT_KEYS) checkPool(k, m[k], 10, true);
  if (mergedPools.whispers.length !== 7) failures.push('whispers: needs exactly 7 layers');
  mergedPools.whispers.forEach((p, i) => checkPool(`whispers[${i}]`, p, 10, true));
  if (mergedPools.sanctuary.length !== 3) failures.push('sanctuary: needs exactly 3 tiers');
  mergedPools.sanctuary.forEach((p, i) => checkPool(`sanctuary[${i}]`, p, 10, true));

  /* context pools: exact key sets, minimum sizes, same caps */
  for (const id of FAMILY_IDS) {
    if (!(id in FAMILY_SOLVE)) failures.push(`familySolve: missing '${id}'`);
    else checkPool(`familySolve.${id}`, FAMILY_SOLVE[id], 3, false);
  }
  if (Object.keys(FAMILY_SOLVE).length !== 9) failures.push('familySolve: needs exactly 9 families');
  for (const d of DEPTHS) {
    if (!(d in DEPTH_MILESTONES)) failures.push(`depthMilestones: missing ${d}`);
    else checkPool(`depthMilestones.${d}`, DEPTH_MILESTONES[d], 2, false);
  }
  if (Object.keys(DEPTH_MILESTONES).length !== 5) failures.push('depthMilestones: needs exactly 5 depths');
  for (const a of ACTS) {
    if (!(a in ACT_TRANSITIONS)) failures.push(`actTransitions: missing act ${a}`);
    else checkPool(`actTransitions.${a}`, ACT_TRANSITIONS[a], 3, false);
  }
  if (Object.keys(ACT_TRANSITIONS).length !== 4) failures.push('actTransitions: needs acts 0..3');
  for (const e of EMERALDS) {
    if (!(e in EMERALD_PICKS)) failures.push(`emeraldPicks: missing '${e}'`);
    else checkPool(`emeraldPicks.${e}`, EMERALD_PICKS[e], 2, false);
  }
  if (Object.keys(EMERALD_PICKS).length !== 6) failures.push('emeraldPicks: needs exactly 6 relics');
  for (const f of FATES) {
    if (!(f in FATE_EVENTS)) failures.push(`fateEvents: missing '${f}'`);
    else checkPool(`fateEvents.${f}`, FATE_EVENTS[f], 2, false);
  }
  if (Object.keys(FATE_EVENTS).length !== 6) failures.push('fateEvents: needs exactly 6 fates');

  /* breadth contract: >=120 brand-new lines beyond pools.ts */
  for (const x of [APPEAR_EXTRA, WRONG_EXTRA, RIGHT_EXTRA, STREAK_EXTRA,
    IMPOSSIBLE_EXTRA, RELIC_EXTRA, WIN_EXTRA, LOSE_EXTRA, DESPAIR_EXTRA,
    DEFIANCE_EXTRA]) newLines += x.length;
  for (const p of WHISPERS_EXTRA) newLines += p.length;
  for (const p of SANCTUARY_EXTRA) newLines += p.length;
  for (const p of Object.values(FAMILY_SOLVE)) newLines += p.length;
  for (const p of Object.values(DEPTH_MILESTONES)) newLines += p.length;
  for (const p of Object.values(ACT_TRANSITIONS)) newLines += p.length;
  for (const p of Object.values(EMERALD_PICKS)) newLines += p.length;
  for (const p of Object.values(FATE_EVENTS)) newLines += p.length;
  if (newLines < 120) failures.push(`breadth: only ${newLines} new lines, needs >=120`);

  /* seeded draw audit over 300 seeds: uniform index mapping stays in bounds
   * for every pool (the invariant ShadowBrain's floor(rng*len) relies on) */
  const allPools: Array<[string, string[]]> = [
    ...EVENT_KEYS.map((k): [string, string[]] => [k, m[k]]),
    ...mergedPools.whispers.map((p, i): [string, string[]] => [`whispers[${i}]`, p]),
    ...mergedPools.sanctuary.map((p, i): [string, string[]] => [`sanctuary[${i}]`, p]),
    ...Object.entries(FAMILY_SOLVE),
    ...Object.entries(DEPTH_MILESTONES),
    ...Object.entries(ACT_TRANSITIONS),
    ...Object.entries(EMERALD_PICKS),
    ...Object.entries(FATE_EVENTS),
  ];
  outer:
  for (let seed = 1; seed <= 300; seed++) {
    const rng = mulberry32(seed * 0x9e3779b9);
    for (const [label, pool] of allPools) {
      const idx = Math.floor(rng() * pool.length);
      if (!(idx >= 0 && idx < pool.length)) failures.push(`${label}: draw out of bounds seed=${seed}`);
      if (failures.length > 40) break outer; // don't drown in repeats
    }
  }

  /* voice spot-checks: signature register present in the merged corpus */
  const voice: string[] = [
    mergedPools.appear[0],
    mergedPools.wrong[mergedPools.wrong.length - 1],
    mergedPools.streak[mergedPools.streak.length - 1],
    mergedPools.whispers[6][mergedPools.whispers[6].length - 1],
    mergedPools.sanctuary[2][mergedPools.sanctuary[2].length - 1],
    FAMILY_SOLVE.accretion[0],
    DEPTH_MILESTONES[30][0],
    ACT_TRANSITIONS[3][0],
    EMERALD_PICKS.chaos_control[0],
    FATE_EVENTS.toll[0],
  ];
  /* the sampled lines are display examples; register scan runs on `corpus` below */
  const corpus: string[] = [];
  for (const p of Object.values(m)) corpus.push(...p);
  for (const p of mergedPools.whispers) corpus.push(...p);
  for (const p of mergedPools.sanctuary) corpus.push(...p);
  for (const grp of [FAMILY_SOLVE, DEPTH_MILESTONES, ACT_TRANSITIONS,
    EMERALD_PICKS, FATE_EVENTS]) {
    for (const p of Object.values(grp)) corpus.push(...p);
  }
  const lower = corpus.join(' ').toLowerCase();
  for (const word of ['dark', 'void', 'shadow', 'tea']) {
    if (!lower.includes(word)) failures.push(`voice spot-check: '${word}' absent`);
  }
  if (corpus.some((l) => l.length > MAX_LINE_CHARS)) failures.push('corpus: line >90 chars');

  return { ok: failures.length === 0, failures, voice };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/shadow/pools2.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/pools2.ts')) {
  const r = selfTest();
  console.log(r.ok ? 'pools2: OK' : `pools2: FAIL\n${r.failures.join('\n')}`);
  console.log('voice spot-check:');
  for (const v of r.voice ?? []) console.log(`  "${v}" (${v.length})`);
  if (!r.ok) process.exitCode = 1;
}
