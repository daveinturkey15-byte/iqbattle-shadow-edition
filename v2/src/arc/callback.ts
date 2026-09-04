import { planArc, type ArcPlan } from '../arc-data.ts';

export interface Callback {
  fromDepth: number;
  line: string;
  worldId?: string;
}

function hashSeedDepth(seed: number, depth: number): number {
  let h = (Math.imul(seed | 0, 0x85EBCA6B) ^ Math.imul(depth | 0, 0xC2B2AE35) ^ 0x9E3779B9) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5BD1E995);
  h ^= h >>> 15;
  return h >>> 0;
}

function mulberry32(state: number): () => number {
  let s = state >>> 0;
  return function (): number {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CALLBACK_LINES: readonly string[] = [
  'THE GARDEN REMEMBERS YOU - YOU KNELT HERE AT DEPTH {D}',
  'YOU LIT THIS LIGHT AT DEPTH {D} - IT NEVER WENT OUT',
  'DEPTH {D} LEFT A DOOR OPEN - STEP BACK THROUGH',
  'THE SANCTUARY KEEPS YOUR SHADOW FROM DEPTH {D}',
  'WHAT HEALED YOU AT DEPTH {D} HAS BEEN WAITING',
  'YOU SANG HERE AT DEPTH {D} - THE WALLS SING BACK',
  'THE VOW YOU MADE AT DEPTH {D} STILL HOLDS',
  'THIS IS THE SAME LIGHT YOU FOUND AT DEPTH {D}',
  'DEPTH {D} REMEMBERED YOUR NAME - ANSWER IT',
  'YOU WERE FORGIVEN AT DEPTH {D} - REMEMBER HOW',
  'THE WELL YOU DRANK AT DEPTH {D} HAS NOT RUN DRY',
  'RETURN TO WHAT SAVED YOU AT DEPTH {D}',
  'THE FLAME FROM DEPTH {D} FOLLOWED YOU DOWN',
  'GRACE FOUND YOU AT DEPTH {D} - IT FOUND YOU AGAIN',
  'THIS GROUND IS HOLY - YOU BLED HERE AT DEPTH {D}',
  'THE CHOIR YOU JOINED AT DEPTH {D} CALLS YOU BACK',
];

function renderLine(template: string, fromDepth: number): string {
  return template.split('{D}').join(String(fromDepth));
}

export function redemptionCallback(seed: number, depth: number, plan: readonly ArcPlan[]): Callback | null {
  if (!Number.isInteger(depth)) return null;
  if (depth < 0 || depth >= plan.length) return null;
  const cur = plan[depth];
  if (!cur || cur.align !== 'good') return null;
  const eligible: number[] = [];
  for (let d = depth - 7; d <= depth - 4; d++) {
    if (d >= 0 && d < plan.length) {
      const p = plan[d];
      if (p && p.align === 'good') eligible.push(d);
    }
  }
  if (eligible.length === 0) return null;
  const rnd = mulberry32(hashSeedDepth(seed, depth));
  const echoIdx = Math.floor(rnd() * eligible.length);
  const fromDepth: number = eligible[echoIdx] as number;
  const tmplIdx = Math.floor(rnd() * CALLBACK_LINES.length);
  const template: string = CALLBACK_LINES[tmplIdx] as string;
  const line = renderLine(template, fromDepth);
  if (line.length === 0 || line.length > 90) return null;
  return {
    fromDepth,
    line,
    worldId: 'sanctuary-' + String(fromDepth),
  };
}

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const push = (msg: string): void => {
    if (failures.length < 100) failures.push(msg);
  };
  const distinct = new Set<string>();
  const MAX_DEPTH = 40;
  for (let seed = 0; seed < 500; seed++) {
    const plan = planArc(seed, MAX_DEPTH);
    for (let d = 0; d < plan.length; d++) {
      const first = redemptionCallback(seed, d, plan);
      const second = redemptionCallback(seed, d, plan);
      if (JSON.stringify(first) !== JSON.stringify(second)) {
        push('seed ' + seed + ' depth ' + d + ': not deterministic');
      }
      const cur = plan[d] as ArcPlan | undefined;
      if (!cur) continue;
      if (cur.align !== 'good') {
        if (first !== null) {
          push('seed ' + seed + ' depth ' + d + ': expected null on ' + cur.align + ' beat');
        }
      } else if (first !== null) {
        if (!(first.fromDepth < d)) {
          push('seed ' + seed + ' depth ' + d + ': fromDepth ' + first.fromDepth + ' not strictly less than depth');
        }
        const gap = d - first.fromDepth;
        if (!(gap >= 4 && gap <= 7)) {
          push('seed ' + seed + ' depth ' + d + ': gap ' + gap + ' outside 4-7 window');
        }
        const src = plan[first.fromDepth] as ArcPlan | undefined;
        if (!src || src.align !== 'good') {
          push('seed ' + seed + ' depth ' + d + ': echo source ' + first.fromDepth + ' is not a good beat');
        }
        if (typeof first.line !== 'string' || first.line.length === 0) {
          push('seed ' + seed + ' depth ' + d + ': line empty');
        } else {
          if (first.line.length > 90) {
            push('seed ' + seed + ' depth ' + d + ': line length ' + first.line.length + ' exceeds 90');
          }
          if (first.line !== first.line.toUpperCase()) {
            push('seed ' + seed + ' depth ' + d + ': line not uppercase');
          }
          if (first.line.indexOf(String(first.fromDepth)) < 0) {
            push('seed ' + seed + ' depth ' + d + ': line does not reference depth ' + first.fromDepth);
          }
          distinct.add(first.line);
        }
      }
    }
  }
  if (distinct.size < 10) {
    push('expected at least 10 distinct lines over 500 seeds, got ' + distinct.size);
  }
  if (CALLBACK_LINES.length < 14) {
    push('expected at least 14 line templates, got ' + CALLBACK_LINES.length);
  }
  return { ok: failures.length === 0, failures };
}

const __proc = (globalThis as unknown as { process?: { argv: string[]; exit: (code: number) => void } }).process;
const __isSmokeRun =
  !!__proc && Array.isArray(__proc.argv) && __proc.argv.some((a) => a.endsWith('callback.ts') || a.endsWith('callback.js'));
if (__isSmokeRun && __proc) {
  const __res = selfTest();
  const __con = (globalThis as unknown as { console?: { log: (m: string) => void; error: (m: string) => void } }).console;
  if (__res.ok) {
    __con?.log('callback selfTest OK');
  } else {
    __con?.error('callback selfTest FAILED: ' + __res.failures.join('; '));
    __proc.exit(1);
  }
}
