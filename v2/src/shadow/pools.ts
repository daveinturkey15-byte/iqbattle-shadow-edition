/**
 * pools.ts — SHADOW persona quip pools (v2 port of v1 shadow.js + demonsay.js +
 * content_quips.js tone; mechanic and voice ported, zero code copied verbatim
 * beyond the best lines).
 *
 * Voice: British-menacing-witty deadpan evil. Every line <= 90 chars.
 * Parody persona only (original abstract silhouette, no licensed assets).
 *
 * Pools (each >= 5 lines, enforced by selfTest()):
 *   appear / wrong / right / streak / impossible / relic / win / lose /
 *   despair / defiance          — event pools
 *   whispers[0..6]              — one ambient pool per depth layer (7 layers)
 *   sanctuary[0..2]             — safe-haven lines by sanctuary tier (3 tiers)
 *
 * Fairness rails: text-only flavour, never gates an answer; motion-gated at
 * the renderer level (shadow.ts). Deterministic selection lives in ShadowBrain
 * (shadow.ts) via its own mulberry32 — zero Math.random anywhere.
 */

export type EventPoolKey =
  | 'appear' | 'wrong' | 'right' | 'streak' | 'impossible'
  | 'relic' | 'win' | 'lose' | 'despair' | 'defiance';

export interface QuipPools {
  appear: string[];
  wrong: string[];
  right: string[];
  streak: string[];
  impossible: string[];
  relic: string[];
  win: string[];
  lose: string[];
  despair: string[];
  defiance: string[];
  /** index = layer-1 (depth layers 1..7) */
  whispers: string[][];
  /** index = sanctuary tier 0..2 */
  sanctuary: string[][];
}

export const POOLS: QuipPools = {
  appear: [
    'The ultimate lifeform has arrived. Try to look impressed.',
    'I sensed weakness. So I came.',
    'Behold. Perfection, with opinions.',
    'I was busy brooding. You interrupted.',
    'Fear not. Fear me.',
    'I brought darkness. And a timer.',
    'This is my good mood. Enjoy it.',
  ],

  wrong: [
    'Wrong. Shocking.',
    'Bold. Confident. Deeply incorrect.',
    'Even the rock guessed better.',
    'That answer had so much hope in it.',
    'Incorrect. As foretold by prophecy.',
    'Your brain buffered at the worst time.',
    "I've made better mistakes. Blindfolded.",
    'Somewhere, a genius felt a disturbance.',
  ],

  right: [
    'Correct. Don\u2019t get comfortable.',
    'Hmph. Lucky. Probably.',
    'Acceptable. The bar was on the floor anyway.',
    'Right answer. Wrong reasons, I assume.',
    'Impressive. For a mortal with Wi-Fi.',
    'One point closer to disappointing me less.',
    'Fine. That was fine. Barely fine.',
    'You may grovel now. Or continue.',
  ],

  streak: [
    'A streak. How quaint. It ends like all things.',
    'Three straight. I\u2019m pretending not to count.',
    'Keep going. Nothing lasts. Especially streaks.',
    'Undefeated this run. I despise that word.',
    'The streak grows heavier. So does my interest.',
    'On fire. Literally, if I had my way.',
  ],

  impossible: [
    'Impossible mode. I admire the poor decision.',
    'Now even I have to pay attention.',
    'Good luck. You will need all of it.',
    'The universe just sharpened its knives.',
    'Impossible? Finally. A genre of regret I enjoy.',
    'This one came straight from the void. No refunds.',
  ],

  relic: [
    'A relic. Even I collect those. Emotionally.',
    'Ooh. Shiny history. Take it before I change my mind.',
    'Relic acquired. It hums with ancient judgment.',
    'Some things survive eons. Unlike your streaks.',
    'That relic has seen empires fall. Now it has seen you.',
    'Ancient power. Slightly dusty. Yours.',
  ],

  win: [
    'You won. I\u2019m choosing to be unbothered.',
    'Victory. Savor it. It\u2019s temporary.',
    'Fine. You were adequate. Extremely adequate.',
    'Winner. The shadows applaud quietly.',
    'You beat me. Rematch pending. Forever.',
    'Congratulations. This changes nothing about us.',
  ],

  lose: [
    'Defeated. By me. As designed.',
    'Loss detected. Emotionally, nothing happened.',
    'The ultimate lifeform remains undefeated. Mostly.',
    'Better luck next timeline.',
    'You lost. I felt something. It wasn\u2019t sympathy.',
    'Darkness wins. Standard outcome.',
  ],

  despair: [
    'Bleeding out? Do sit down. Mind the void.',
    'Hope is a candle. I brought wind.',
    'At this rate, the floor will outlive your run.',
    'Down, but not yet interesting. Do try harder.',
    'Shall I fetch a mop, or will you manage?',
  ],

  defiance: [
    'Oh? Still standing? Rude of you.',
    'A comeback. How delightfully inconvenient.',
    'You refuse to die properly. Noted with irritation.',
    'Defiant to the last. I almost respect it.',
    'Keep rising. It makes the fall literary.',
  ],

  // Layer whispers — one ambient voice per depth layer (1..7). The deeper the
  // run, the thinner reality gets; the persona escalates accordingly.
  whispers: [
    [
      'Did the walls just flicker? No? Hm.',
      'Nothing happened. Keep going.',
      'That glitch was a coincidence. Probably.',
      'I\u2019m barely doing anything. Barely.',
      'Reality is negotiable. Scores are not.',
    ],
    [
      'You can\u2019t outrun a shadow. Statistically or otherwise.',
      'Struggle. It amuses me.',
      'I do love a quiet round. Shame about yours.',
      'The lights dimmed. That was me being subtle.',
      'Carry on. I\u2019m judging silently.',
    ],
    [
      'Where there is light, I am its end.',
      'Your heartbeat is my favourite metronome.',
      'Halfway to nowhere. My favourite place.',
      'The palette bends to my will now.',
      'Do you feel it? The dread?',
    ],
    [
      'Chaos is fair. You are not owed fairness.',
      'I\u2019ve read your future. It\u2019s mostly wrong answers.',
      'The walls remember everyone who failed here.',
      'Sweat now. It saves time later.',
      'My questions now. My rules now.',
    ],
    [
      'Your despair is my favourite rhythm.',
      'The endgame wears black.',
      'So deep, and reality is getting thin.',
      'I could help. I choose not to.',
      'Almost over. Almost mine.',
    ],
    [
      'Run home. Or run here. Either way you lose.',
      'The final form approaches. Stretch first.',
      'Darkness files its paperwork in triplicate.',
      'Every choice you make amuses the void.',
      'You\u2019ve done well. That was never the plan.',
    ],
    [
      'This is who I am. Remember it.',
      'I am all lives. And your deadline.',
      'The last layer hums my name. Listen.',
      'Nothing personal. Entirely personal, actually.',
      'One more round. Then eternity. Tea first.',
    ],
  ],

  // Sanctuary tiers — grudging respect for the good-aligned safe haven.
  sanctuary: [
    [
      'A sanctuary. Charming. It won\u2019t last.',
      'Peace, briefly. Don\u2019t get attached.',
      'The light in here is offensive. Effective, though.',
      'Rest if you must. I\u2019ll wait. I\u2019m good at it.',
      'Sanctuary granted. Consider it a leash.',
    ],
    [
      'This haven holds. Barely. Like your lead.',
      'Warm light. Ugh. Fine. Breathe.',
      'Even shadows respect a good fortress. Grudgingly.',
      'Healed, are we? I\u2019ll file that under \u2018temporary\u2019.',
      'Enjoy the calm. It\u2019s on my payroll.',
    ],
    [
      'Fully sanctified. Insufferably pleasant in here.',
      'The dark can\u2019t touch you here. Yet.',
      'A proper stronghold. Well played. Don\u2019t smirk.',
      'Safety this thorough borders on rude.',
      'Fine. This one\u2019s earned. Once.',
    ],
  ],
};

/** Max line length contract (fairness: readable bubbles, no walls of text). */
export const MAX_LINE_CHARS = 90;

/** Structural validation of every pool — used by selfTest(). */
export function validatePools(failures: string[], prefix = ''): void {
  const eventKeys = Object.keys(POOLS).filter((k) => k !== 'whispers' && k !== 'sanctuary');
  for (const k of eventKeys) {
    const pool = (POOLS as unknown as Record<string, string[]>)[k];
    if (!Array.isArray(pool) || pool.length < 5) failures.push(`${prefix}${k}: needs >=5 lines`);
    else for (const line of pool) {
      if (typeof line !== 'string' || line.length < 1 || line.length > MAX_LINE_CHARS) {
        failures.push(`${prefix}${k}: bad line (${line.length} chars)`);
      }
    }
  }
  if (POOLS.whispers.length !== 7) failures.push(`${prefix}whispers: needs exactly 7 layers`);
  POOLS.whispers.forEach((pool, i) => {
    if (pool.length < 5) failures.push(`${prefix}whispers[${i}]: needs >=5 lines`);
    else for (const line of pool) if (line.length > MAX_LINE_CHARS) failures.push(`${prefix}whispers[${i}]: line >90`);
  });
  if (POOLS.sanctuary.length !== 3) failures.push(`${prefix}sanctuary: needs exactly 3 tiers`);
  POOLS.sanctuary.forEach((pool, i) => {
    if (pool.length < 5) failures.push(`${prefix}sanctuary[${i}]: needs >=5 lines`);
    else for (const line of pool) if (line.length > MAX_LINE_CHARS) failures.push(`${prefix}sanctuary[${i}]: line >90`);
  });
}
