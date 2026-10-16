import { planArc, type ArcPlan } from '../arc-data.ts';

export interface EncounterMemory {
  depth: number;
  worldId: string;
  eventId: string;
  personaId: string | null;
  objectId: string | null;
}

export interface Callback extends EncounterMemory {
  fromDepth: number;
  line: string;
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

function shortId(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, ' ').trim().toUpperCase().slice(0, 8) || 'UNKNOWN';
}

function callbackLine(memory: EncounterMemory): string {
  const identity = [
    ...(memory.personaId ? [`P:${shortId(memory.personaId)}`] : []),
    ...(memory.objectId ? [`O:${shortId(memory.objectId)}`] : []),
    `E:${shortId(memory.eventId)}`,
    `W:${shortId(memory.worldId)}`,
    `D${memory.depth}`,
  ];
  return `RETURN: ${identity.join(' · ')}`;
}

export function redemptionCallback(
  seed: number,
  depth: number,
  plan: readonly ArcPlan[],
  memories: readonly EncounterMemory[],
): Callback | null {
  if (!Number.isInteger(depth) || depth < 1 || depth > plan.length) return null;
  const cur = plan[depth - 1];
  if (!cur || cur.align !== 'good') return null;

  const eligible: number[] = [];
  for (let fromDepth = depth - 7; fromDepth <= depth - 4; fromDepth++) {
    if (fromDepth < 1 || fromDepth > plan.length) continue;
    const beat = plan[fromDepth - 1];
    const memory = memories.find((m) => m.depth === fromDepth);
    if (
      beat?.align === 'good' &&
      memory &&
      memory.worldId.trim().length > 0 &&
      memory.eventId.trim().length > 0
    ) eligible.push(fromDepth);
  }
  if (eligible.length === 0) return null;

  const rnd = mulberry32(hashSeedDepth(seed, depth));
  const fromDepth = eligible[Math.floor(rnd() * eligible.length)] as number;
  const memory = memories.find((m) => m.depth === fromDepth);
  if (!memory) return null;
  const line = callbackLine(memory);
  if (line.length === 0 || line.length > 90) return null;
  return { ...memory, fromDepth, line };
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
    const memories: EncounterMemory[] = [];
    for (let i = 0; i < plan.length; i++) {
      if (plan[i]?.align !== 'good') continue;
      memories.push({
        depth: i + 1,
        worldId: `world-${seed}-${i + 1}`,
        eventId: `event-${seed}-${i + 1}`,
        personaId: `persona-${i + 1}`,
        objectId: `object-${i + 1}`,
      });
    }

    for (let d = 0; d < plan.length; d++) {
      const depth = d + 1;
      const first = redemptionCallback(seed, depth, plan, memories);
      const second = redemptionCallback(seed, depth, plan, memories);
      if (JSON.stringify(first) !== JSON.stringify(second)) {
        push('seed ' + seed + ' depth ' + depth + ': not deterministic');
      }

      const cur = plan[d] as ArcPlan | undefined;
      if (!cur) continue;
      if (cur.align !== 'good') {
        if (first !== null) push('seed ' + seed + ' depth ' + depth + ': expected null on ' + cur.align + ' beat');
      } else if (first !== null) {
        if (!(first.fromDepth < depth)) {
          push('seed ' + seed + ' depth ' + depth + ': source ' + first.fromDepth + ' is not earlier');
        }
        const gap = depth - first.fromDepth;
        if (!(gap >= 4 && gap <= 7)) push('seed ' + seed + ' depth ' + depth + ': gap ' + gap + ' outside 4-7 window');

        const source = plan[first.fromDepth - 1] as ArcPlan | undefined;
        const memory = memories.find((m) => m.depth === first.fromDepth);
        if (!source || source.align !== 'good') push('seed ' + seed + ' depth ' + depth + ': source is not good');
        if (!memory || memory.worldId !== first.worldId || memory.eventId !== first.eventId ||
            memory.personaId !== first.personaId || memory.objectId !== first.objectId) {
          push('seed ' + seed + ' depth ' + depth + ': callback identity is not the remembered encounter');
        }
        if (typeof first.line !== 'string' || first.line.length === 0 || first.line.length > 90) {
          push('seed ' + seed + ' depth ' + depth + ': callback line missing or too long');
        } else {
          if (first.line !== first.line.toUpperCase()) push('seed ' + seed + ' depth ' + depth + ': line not uppercase');
          if (!first.line.endsWith('D' + String(first.fromDepth))) {
            push('seed ' + seed + ' depth ' + depth + ': line does not reference its source depth');
          }
          distinct.add(first.line);
        }
      }
    }
  }

  if (distinct.size < 10) push('expected at least 10 distinct memory callbacks, got ' + distinct.size);
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
