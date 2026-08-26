/**
 * accolades.ts — END-SCREEN accolade engine, pure port of v1 IQ.Accolades
 * (root accolades.js, semantics frozen per research/w1-original-recon.md §19).
 *
 * PURE: computes from a completed match record. No DOM, no Pixi, no timers,
 * no Math.random / Date.now — fully deterministic derivations from stats.
 * TIES SHARE: every accolade may be awarded to several players at once.
 *
 * MatchStats shape:
 *   players: [{ uid, name? }, ...]
 *   rounds:  [{ n, picks: { [uid]: { correct, timeMs? } }, winnerUid? }, ...]
 *
 * The eight accolades (v1 parity, exact semantics):
 *   King of the Hill   — held cumulative 1st place after the most rounds
 *                        (proxy points: k-th fastest of c correct solvers
 *                        scores 100+(c-1-k); tied leaders ALL hold)
 *   Not of this Earth  — won EVERY round (winnerUid if valid&correct,
 *                        else fastest correct pick)
 *   Front Runner       — most round wins
 *   Lone Wolf          — ONLY correct solver of a round, and the match had
 *                        >= 4 players (with 3 players nobody can earn it)
 *   Lightning Strike   — single fastest correct answer of the match (ties share)
 *   Hot Streak         — longest consecutive-correct streak (ties share)
 *   Flawless           — correct in every round
 *   Rapid Response     — lowest average timeMs over correct answers;
 *                        needs >= ceil(rounds/2) correct answers (anti
 *                        one-lucky-pick); ties share
 */

export interface AccoladePick {
  correct: boolean;
  /** response clock in ms; missing/invalid treated as Infinity */
  timeMs?: number;
}

export interface AccoladeRound {
  /** 1-based round number */
  n: number;
  picks: Record<string, AccoladePick>;
  /** authoritative round winner (host override); must also be correct to count */
  winnerUid?: string | null;
}

export interface AccoladePlayer {
  uid: string;
  name?: string;
}

export interface MatchStats {
  players: AccoladePlayer[];
  rounds: AccoladeRound[];
}

export interface AccoladeDef {
  id: string;
  label: string;
}

/** Frozen display order + labels (v1 DEFS table). */
export const ACCOLADE_DEFS: readonly AccoladeDef[] = [
  { id: 'king-hill', label: 'King of the Hill' },
  { id: 'not-earth', label: 'Not of this Earth' },
  { id: 'front-runner', label: 'Front Runner' },
  { id: 'lone-wolf', label: 'Lone Wolf' },
  { id: 'lightning', label: 'Lightning Strike' },
  { id: 'hot-streak', label: 'Hot Streak' },
  { id: 'flawless', label: 'Flawless' },
  { id: 'rapid', label: 'Rapid Response' },
];

/** One computed accolade: who earned it (sorted uids — ties share). */
export interface AwardedAccolade {
  id: string;
  label: string;
  earned: boolean;
  uids: string[];
}

function ms(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : Infinity;
}

/** Keys whose value is strictly > 0 and maximal; insertion order of `uids`. */
function maxKeys(uids: string[], map: Record<string, number>): string[] {
  let bv = 0;
  let bu: string[] = [];
  for (const u of uids) {
    const v = map[u] || 0;
    if (v > bv) { bv = v; bu = [u]; }
    else if (v === bv && v > 0) bu.push(u);
  }
  return bu;
}

/**
 * Compute every accolade with its full winner set. Pure; ties share every
 * accolade. Empty/broken records yield all-eight earned:false.
 */
export function computeAwards(stats: MatchStats | null | undefined): AwardedAccolade[] {
  const defs = ACCOLADE_DEFS.map((d) => ({ ...d, earned: false, uids: [] as string[] }));
  if (!stats || !Array.isArray(stats.players) || !Array.isArray(stats.rounds) || !stats.rounds.length) {
    return defs;
  }
  const uids = stats.players.map((p) => String(p.uid));
  if (!uids.length) return defs;
  const R = stats.rounds.length;

  const wins: Record<string, number> = {};
  const correct: Record<string, number> = {};
  const sumT: Record<string, number> = {};
  const best: Record<string, number> = {};
  const holds: Record<string, number> = {};
  const cur: Record<string, number> = {};
  const lone: Record<string, true> = {};
  let lightUids: string[] | null = null;
  let fastT = Infinity;
  const cum: Record<string, number> = {};

  const rounds = stats.rounds.slice().sort((a, b) => a.n - b.n);
  for (const rd0 of rounds) {
    const rd = rd0 || ({} as AccoladeRound);
    const picks = rd.picks || {};
    const corr: Array<{ u: string; tm: number }> = [];
    for (const u of uids) {
      const p = picks[u];
      if (p && p.correct) corr.push({ u, tm: ms(p.timeMs) });
    }
    corr.sort((a, b) => a.tm - b.tm);

    // streaks / totals
    for (const u of uids) {
      const p = picks[u];
      if (p && p.correct) {
        correct[u] = (correct[u] || 0) + 1;
        sumT[u] = (sumT[u] || 0) + ms(p.timeMs);
        cur[u] = (cur[u] || 0) + 1;
        if (cur[u] > (best[u] || 0)) best[u] = cur[u];
      } else {
        cur[u] = 0;
      }
    }

    if (corr.length) {
      // lightning: global fastest single correct (ties share)
      for (const e of corr) {
        if (e.tm < fastT) { fastT = e.tm; lightUids = [e.u]; }
        else if (e.tm === fastT && lightUids && !lightUids.includes(e.u)) lightUids.push(e.u);
      }
      // round winner: authoritative winnerUid, else fastest correct
      const w =
        rd.winnerUid != null && picks[rd.winnerUid] && picks[rd.winnerUid].correct
          ? rd.winnerUid
          : corr[0].u;
      wins[w] = (wins[w] || 0) + 1;
      if (corr.length === 1) lone[corr[0].u] = true;
    }

    // king of the hill: proxy points -> cumulative leader(s) hold the hill
    const c = corr.length;
    corr.forEach((e, k) => { cum[e.u] = (cum[e.u] || 0) + 100 + (c - 1 - k); });
    let top = -Infinity;
    let topU: string[] = [];
    for (const u of uids) {
      const v = cum[u] || 0;
      if (v > top) { top = v; topU = [u]; }
      else if (v === top) topU.push(u);
    }
    if (top > 0) for (const u of topU) holds[u] = (holds[u] || 0) + 1;
  }

  const minQual = Math.ceil(R / 2);
  // lowest average correct-answer time wins; ties share; Infinity never wins
  let rBv = Infinity;
  let rBu: string[] = [];
  for (const u of uids) {
    const n = correct[u] || 0;
    const v = n >= minQual && n > 0 ? sumT[u] / n : Infinity;
    if (v < rBv) { rBv = v; rBu = [u]; }
    else if (v === rBv) rBu.push(u);
  }
  if (rBv === Infinity) rBu = [];

  const winners: Record<string, string[]> = {
    'king-hill': maxKeys(uids, holds),
    'not-earth': uids.filter((u) => (wins[u] || 0) === R),
    'front-runner': maxKeys(uids, wins),
    'lone-wolf': stats.players.length >= 4 ? Object.keys(lone) : [],
    lightning: lightUids || [],
    'hot-streak': maxKeys(uids, best),
    flawless: uids.filter((u) => (correct[u] || 0) === R),
    rapid: rBu,
  };

  for (const d of defs) {
    d.uids = (winners[d.id] || []).sort();
    d.earned = d.uids.length > 0;
  }
  return defs;
}

/**
 * Flat view for the end-screen accolades strip: always all eight accolades
 * in frozen order, each flagged earned/unearned for this match.
 */
export function computeAccolades(
  stats: MatchStats | null | undefined,
): Array<{ id: string; label: string; earned: boolean }> {
  return computeAwards(stats).map(({ id, label, earned }) => ({ id, label, earned }));
}

/* ------------------------------------------------------------------ */
/* Self-test                                                           */
/* ------------------------------------------------------------------ */

interface Fail { name: string; got: unknown; want: unknown }

function mk(players: string[]): MatchStats {
  return {
    players: players.map((u) => ({ uid: u, name: u })),
    rounds: [
      { n: 1, picks: { A: { correct: true, timeMs: 120 }, B: { correct: true, timeMs: 120 }, C: { correct: false, timeMs: 900 }, D: { correct: false, timeMs: 950 } } },
      { n: 2, picks: { A: { correct: false, timeMs: 300 }, B: { correct: false, timeMs: 310 }, C: { correct: true, timeMs: 500 }, D: { correct: false, timeMs: 800 } } },
      { n: 3, picks: { A: { correct: true, timeMs: 130 }, B: { correct: true, timeMs: 140 }, C: { correct: false, timeMs: 700 }, D: { correct: false, timeMs: 750 } } },
    ],
  };
}

/**
 * Seeded deterministic self-test: exercises every accolade condition,
 * tie-sharing on lightning/hot-streak/rapid-style maxima, the Lone Wolf
 * >=4-player threshold, clean sweeps and empty records. Returns {ok, failures}.
 */
export function selfTest(): { ok: boolean; failures: string[]; checks: number } {
  const fails: Fail[] = [];
  function eq(name: string, got: unknown, want: unknown): void {
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push({ name, got, want });
  }
  /** uids earning `id`, sorted */
  function ids(ac: AwardedAccolade[], id: string): string[] {
    const d = ac.find((a) => a.id === id);
    return d ? d.uids.slice().sort() : [];
  }
  function earnedIds(ac: Array<{ id: string; label: string; earned: boolean }>): string[] {
    return ac.filter((a) => a.earned).map((a) => a.id);
  }

  /* Scenario 1 — 4 players, 3 rounds: tie-sharing + lone-wolf threshold. */
  const ac = computeAwards(mk(['A', 'B', 'C', 'D']));
  eq('tie lightning shares', ids(ac, 'lightning'), ['A', 'B']); // both 120ms
  eq('lone wolf 4p', ids(ac, 'lone-wolf'), ['C']);             // sole solver of R2
  eq('front runner', ids(ac, 'front-runner'), ['A']);          // won R1+R3
  eq('no flawless', ids(ac, 'flawless'), []);
  eq('hot streak tie shares', ids(ac, 'hot-streak'), ['A', 'B', 'C']); // best=1 each
  eq('rapid', ids(ac, 'rapid'), ['A']);                        // avg 125 vs B 130
  eq('not earth never swept', ids(ac, 'not-earth'), []);
  // king-hill proxy: R1 c=2 -> A 101,B 100 ; R2 c=1 -> C 100 ; R3 -> A 101,B 100
  // cumulative: A202 B200 C100 -> A holds after R1,R3 (leader both times) = 2 holds
  eq('king hill', ids(ac, 'king-hill'), ['A']);

  const ac3 = computeAwards(mk(['A', 'B', 'C']));              // identical picks, 3 players
  eq('lone wolf player-count gate', ids(ac3, 'lone-wolf'), []); // <4 players: never

  /* Scenario 2 — clean sweep: A correct+fastest every round. */
  const sw = computeAwards({
    players: [{ uid: 'A' }, { uid: 'B' }],
    rounds: [
      { n: 1, picks: { A: { correct: true, timeMs: 200 }, B: { correct: false, timeMs: 400 } } },
      { n: 2, picks: { A: { correct: true, timeMs: 250 }, B: { correct: false, timeMs: 300 } } },
    ],
  });
  eq('sweep not-earth', ids(sw, 'not-earth'), ['A']);
  eq('sweep flawless', ids(sw, 'flawless'), ['A']);
  eq('sweep lightning', ids(sw, 'lightning'), ['A']);
  eq('sweep king-hill', ids(sw, 'king-hill'), ['A']);
  eq('sweep front-runner', ids(sw, 'front-runner'), ['A']);
  eq('sweep hot-streak', ids(sw, 'hot-streak'), ['A']);
  eq('sweep rapid', ids(sw, 'rapid'), ['A']);

  /* Scenario 3 — hot streak longer than 1 beats scattered correctness. */
  const hs = computeAwards({
    players: [{ uid: 'A' }, { uid: 'B' }],
    rounds: [
      { n: 1, picks: { A: { correct: false }, B: { correct: true, timeMs: 100 } } },
      { n: 2, picks: { A: { correct: true, timeMs: 100 }, B: { correct: false } } },
      { n: 3, picks: { A: { correct: true, timeMs: 110 }, B: { correct: false } } },
      { n: 4, picks: { A: { correct: true, timeMs: 120 }, B: { correct: false } } },
      { n: 5, picks: { A: { correct: false }, B: { correct: true, timeMs: 90 } } },
    ],
  });
  eq('hot streak length 3', ids(hs, 'hot-streak'), ['A']);
  eq('broken streak kills flawless', ids(hs, 'flawless'), []);

  /* Scenario 4 — winnerUid override decides round wins (still must be correct). */
  const wv = computeAwards({
    players: [{ uid: 'A' }, { uid: 'B' }],
    rounds: [
      { n: 1, picks: { A: { correct: true, timeMs: 999 }, B: { correct: true, timeMs: 100 } }, winnerUid: 'A' },
      { n: 2, picks: { A: { correct: true, timeMs: 100 }, B: { correct: true, timeMs: 999 } }, winnerUid: 'B' },
    ],
  });
  eq('winner override splits wins', ids(wv, 'front-runner'), ['A', 'B']);
  eq('bogus winner ignored falls back', (() => {
    const g = computeAwards({
      players: [{ uid: 'A' }, { uid: 'B' }],
      rounds: [{ n: 1, picks: { A: { correct: true, timeMs: 100 }, B: { correct: false, timeMs: 5 } }, winnerUid: 'B' }],
    });
    return ids(g, 'front-runner');
  })(), ['A']);

  /* Scenario 5 — empty / degenerate records. */
  eq('empty record all unearned', computeAccolades({ players: [], rounds: [] }).every((a) => !a.earned), true);
  eq('null stats safe', computeAccolades(null).length, 8);
  eq('computeAwards empty uids', computeAwards({ players: [], rounds: [{ n: 1, picks: {} }] }).every((a) => !a.earned), true);

  /* Scenario 6 — flat view flags exactly the right set. */
  eq('flat view sweep', earnedIds(computeAccolades({
    players: [{ uid: 'A' }, { uid: 'B' }],
    rounds: [
      { n: 1, picks: { A: { correct: true, timeMs: 150 }, B: { correct: false, timeMs: 300 } } },
      { n: 2, picks: { A: { correct: true, timeMs: 160 }, B: { correct: false, timeMs: 280 } } },
    ],
  })).sort(), ['flawless', 'front-runner', 'hot-streak', 'king-hill', 'lightning', 'not-earth', 'rapid']);

  const failures = fails.map((f) => `${f.name}: got ${JSON.stringify(f.got)} want ${JSON.stringify(f.want)}`);
  return { ok: failures.length === 0, failures, checks: 24 };
}

/** Direct-run harness: `node --experimental-strip-types src/meta/accolades.ts`.
 *  Inert in the browser bundle (no `process` there). */
const invokedDirectly =
  typeof process !== 'undefined' && process.argv.some((a) => a.endsWith('accolades.ts'));
if (invokedDirectly) {
  const r = selfTest();
  for (const f of r.failures) console.error(`  - ${f}`);
  console.log(`[accolades-selftest] ${r.checks} checks: ${r.ok ? 'ALL PASS' : 'FAILED'}`);
  if (!r.ok) process.exitCode = 1;
}
