/* ============================================================================
 * LMS DIRECTOR — the match orchestration that used to have nowhere to live.
 *
 * lms.ts holds the reducer (pure state transitions), mp.ts holds the wire,
 * main.ts holds the Pixi. The ORDER of operations between them — who folds a
 * verdict, when a depth closes, what a reveal carries, which frames a client
 * may act on — is the part that actually decides whether two screens agree,
 * and it is the part a node gate can never see while it sits inside main.ts.
 *
 * So it lives here, behind injected effects. Main supplies the scene facts
 * (depth, difficulty, correct index, clock) and the effects (toast, advance,
 * finish); the director supplies the sequencing. src/scenes/selftest-lms.ts
 * drives a full 3-seat match through this exact code over a loopback wire.
 *
 * SELFTEST:  node --experimental-strip-types src/scenes/selftest-lms.ts
 * ==========================================================================*/

import type { MpEvent, ScoreRec, SrVerdict } from './mp.ts';
import {
  addSeat,
  adoptScores,
  applyElim,
  attackRejectionText,
  beginDepth,
  closeDepth,
  createLms,
  dropSeat,
  everyoneAnswered,
  iMayAnswer,
  iMayAttack,
  myAttackMenu,
  myBudget,
  resolveAttack,
  rows,
  submitVerdict,
  timeoutMissing,
  type LmsRow,
  type LmsState,
  type Seat,
} from './lms.ts';
import type { AttackMenuEntry, WeaponId } from './mpfeat.ts';

/** The slice of MpSession the director is allowed to touch. */
export interface DirectorWire {
  reveal(n: number, answerIdx: number, scores: ScoreRec[], hp?: Record<string, number>): void;
  pushScores(n: number, scores: ScoreRec[], hp?: Record<string, number>, reason?: string): void;
  eliminate(uids: string[]): void;
  endMatch(scores: ScoreRec[], reason?: string): void;
  sendSr(n: number, v: SrVerdict): void;
  attack(targetUid: string, weapon: string, n: number): void;
  /** Live lobby roster — late joiners are seated from it every depth. */
  roster(): Array<{ id: string; name: string }>;
}

export type ToastKind = 'good' | 'bad' | 'info';

export interface DirectorDeps {
  role: 'host' | 'client';
  myUid: string;
  wire: DirectorWire;
  /** Depth currently on screen. */
  depth(): number;
  /** Shape of that depth — the host scores inbound verdicts against THIS. */
  kind(): 'puzzle' | 'takeover';
  /** Correct option index of that depth (-1 on takeover depths). */
  answerIdx(): number;
  diffAt(depth: number): number;
  sanctuaryAt(depth: number): boolean;
  /** Active score multiplier for this depth (1 = none). */
  scoreMul(): number;
  /** Seconds elapsed since the current depth started. */
  clockSec(): number;
  toast(msg: string, kind: ToastKind): void;
  /** Move to the next depth after `delayMs` (0 = immediately). */
  advance(delayMs: number): void;
  /** The match is over — show the end screen. */
  finish(): void;
  /** State moved: re-read rows(), mirror the score/hp onto the local run. */
  changed(): void;
}

/** How long the reveal sits on screen before the host deals the next depth. */
export const REVEAL_HOLD_MS = 1400;

export interface LmsDirector {
  state(): LmsState;
  /**
   * True once the room holds two or more seats. Every run in this game is a
   * hosted room, so a director exists even when nobody joined — but a
   * one-seat room is a solo descent, not a match: it keeps the solo HP-death
   * rule and the solo end screen, and end-when-one never fires.
   */
  isContest(): boolean;
  rows(): LmsRow[];
  mayAnswer(): boolean;
  mayAttack(): boolean;
  attackMenu(): AttackMenuEntry[];
  budget(): number;
  /** Start depth n: clear the per-depth ledgers, seat any late joiners. */
  openDepth(depth: number): void;
  /** This screen answered (or finished a takeover stage). */
  answer(correct: boolean | null, points: number, hpDelta: number): void;
  /** The round clock hit zero. */
  timeout(): void;
  /** Throw a weapon at a rival. */
  throwAt(targetUid: string, weapon: WeaponId): void;
  /** Every inbound MP event, both roles. */
  handle(e: MpEvent): void;
}

export function createDirector(deps: DirectorDeps, seats: Seat[], roomSeed: number | string): LmsDirector {
  let st = createLms(deps.role, deps.myUid, seats, roomSeed);

  const set = (next: LmsState): void => {
    st = next;
    deps.changed();
  };

  /** Seat every roster member the table has not met yet (late joins). */
  const syncSeats = (): void => {
    let next = st;
    for (const p of deps.wire.roster()) next = addSeat(next, p.id, p.name);
    if (next !== st) set(next);
  };

  /** Host: fold one verdict; close the depth if that was the last seat. */
  const hostVerdict = (uid: string, correct: boolean | null, points: number, hpDelta: number): void => {
    if (deps.role !== 'host') return;
    syncSeats();
    const res = submitVerdict(st, {
      uid,
      n: deps.depth(),
      correct,
      kind: deps.kind(),
      diff: deps.diffAt(deps.depth()),
      sanctuary: deps.sanctuaryAt(deps.depth()),
      scoreMul: deps.scoreMul(),
      points,
      hpDelta,
      clockSec: deps.clockSec(),
    });
    if (!res.accepted) return;
    set(res.state);
    if (everyoneAnswered(st)) closeAndReveal();
  };

  /** Host: rank, sweep, broadcast, then advance — or end the match. */
  const closeAndReveal = (): void => {
    if (deps.role !== 'host' || st.over) return;
    const close = closeDepth(st);
    set(close.state);
    deps.wire.reveal(deps.depth(), deps.answerIdx(), close.scores, st.hp);
    if (close.eliminated.length) deps.wire.eliminate(close.eliminated);
    if (close.matchOver) {
      deps.wire.endMatch(close.scores, 'last-standing');
      deps.finish();
      return;
    }
    deps.advance(REVEAL_HOLD_MS);
  };

  const applyAttackAsHost = (attackerUid: string, targetUid: string, weapon: WeaponId, quiet: boolean): void => {
    const out = resolveAttack(st, attackerUid, targetUid, weapon, deps.depth());
    if (!out.ok) {
      /* An inbound frame that fails the rails dies silently — telling a
       * client exactly which rail it hit just hands it a probe. */
      if (!quiet) deps.toast(attackRejectionText(out.reason), 'bad');
      return;
    }
    set(out.state);
    deps.wire.pushScores(deps.depth(), st.table, st.hp, 'attack');
    deps.toast(
      quiet
        ? out.targetName.toUpperCase() + ' TAKES −' + out.dmg
        : weapon.toUpperCase() + ' LANDS ON ' + out.targetName.toUpperCase() + ' — −' + out.dmg,
      quiet ? 'bad' : 'good',
    );
  };

  return {
    state: () => st,
    isContest: () => st.table.length >= 2,
    rows: () => rows(st),
    mayAnswer: () => iMayAnswer(st),
    mayAttack: () => iMayAttack(st),
    attackMenu: () => myAttackMenu(st),
    budget: () => myBudget(st),

    openDepth(depth) {
      set(beginDepth(st, depth));
      syncSeats();
    },

    answer(correct, points, hpDelta) {
      if (!iMayAnswer(st)) return;
      if (deps.role === 'host') { hostVerdict(st.myUid, correct, points, hpDelta); return; }
      if (st.answered.includes(st.myUid)) return;
      /* Optimistic local marks: they stop a second send and light up your own
       * response clock. The host's copy is the one that scores. */
      set({
        ...st,
        clocks: { ...st.clocks, [st.myUid]: deps.clockSec() },
        answered: [...st.answered, st.myUid],
      });
      deps.wire.sendSr(deps.depth(), { correct, points, hpDelta });
    },

    timeout() {
      if (deps.role !== 'host') return; /* clients wait for the host's reveal */
      const sweep = timeoutMissing(st);
      set(sweep.state);
      closeAndReveal();
    },

    throwAt(targetUid, weapon) {
      if (!iMayAttack(st)) return;
      if (deps.role === 'host') { applyAttackAsHost(st.myUid, targetUid, weapon, false); return; }
      if (myBudget(st) <= 0) { deps.toast(attackRejectionText('no-budget'), 'bad'); return; }
      set({ ...st, budget: { ...st.budget, [st.myUid]: Math.max(0, myBudget(st) - 1) } });
      deps.wire.attack(targetUid, weapon, deps.depth());
      deps.toast(weapon.toUpperCase() + ' THROWN', 'info');
    },

    handle(e) {
      switch (e.t) {
        case 'sr':
          if (deps.role !== 'host') return;
          hostVerdict(e.uid, e.sr.correct, e.sr.points, e.sr.hpDelta);
          return;

        case 'reveal': {
          if (deps.role !== 'client') return;
          let next = adoptScores(st, e.scores, true);
          if (e.hp) next = { ...next, hp: { ...next.hp, ...e.hp } };
          set(next);
          deps.advance(0);
          return;
        }

        case 'scores': {
          if (deps.role !== 'client') return;
          let next = adoptScores(st, e.scores, false);
          if (e.hp) next = { ...next, hp: { ...next.hp, ...e.hp } };
          set(next);
          if (e.reason === 'attack') deps.toast('SOMETHING WAS THROWN', 'info');
          return;
        }

        case 'elim': {
          if (!e.uids.length) return;
          /* Name them BEFORE applying, while the table still knows them. */
          const names = e.uids
            .map((uid) => st.table.find((r) => r.uid === uid)?.name ?? 'SOMEONE')
            .map((n) => n.toUpperCase());
          set(applyElim(st, e.uids));
          if (e.uids.includes(st.myUid)) deps.toast('YOU ARE OUT — WATCH THE REST DROWN', 'bad');
          else deps.toast(names.join(' AND ') + ' DROWNED', 'bad');
          return;
        }

        case 'end':
          if (deps.role !== 'client') return;
          set(adoptScores(st, e.scores, false));
          deps.finish();
          return;

        case 'attack': {
          if (deps.role !== 'host' || !e.targetUid) return;
          const weapon: WeaponId = e.weapon === 'curse' ? 'curse' : 'rotten';
          applyAttackAsHost(e.uid, e.targetUid, weapon, true);
          return;
        }

        case 'peer-leave':
          set(dropSeat(st, e.id));
          deps.toast('A SEAT EMPTIED', 'info');
          /* The room may have been waiting on the seat that just walked. */
          if (deps.role === 'host' && everyoneAnswered(st)) closeAndReveal();
          return;

        default:
          return;
      }
    },
  };
}
