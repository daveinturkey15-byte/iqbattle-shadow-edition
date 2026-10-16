import type { Application, Container } from 'pixi.js';
import { Text } from 'pixi.js';
import { STAGE_W, STAGE_H } from './theme.ts';

/* ============================================================================
 * QA HOOKS — dev-build only.
 *
 * Gauntlet gate G4 is a browser checklist a human has to click through, which
 * is why it is the one gate that keeps going unverified between waves. Pixi
 * draws to a canvas, so nothing outside the app can see a label or press a
 * button — this exposes the minimum surface a browser driver needs to do it:
 * read the live text, click a LOGICAL stage coordinate (letterbox maths
 * included), type, and snapshot the match state.
 *
 * Read-only plus synthetic input: it exposes no way to move a score, and it
 * is installed only when import.meta.env.DEV is true, so `vite build` output
 * carries none of it.
 * ==========================================================================*/

export interface QaSnapshot {
  depth: number;
  score: number;
  hp: number;
  role: string | null;
  /** LMS table as "name:pts" rows, or null in solo. */
  table: string[] | null;
  /** Round-modifier ids active on the depth currently on screen, in the order
   *  they were applied. Every seat in a room must report the SAME list for the
   *  same depth — that equality is the multiplayer variation-layer contract,
   *  and it is the cheapest way to see a seed desync from a browser console. */
  mods: string[];
  /** Dev-only: index of the correct option on the board on screen, or -1. */
  answer: number;
  /** The run seed every seat derives its variation layers from. Identical
   *  across a room, or the seats are not playing the same descent. */
  seed: number;
  phases: Record<string, string> | null;
  over: boolean;
  winner: string | null;
}

export interface QaSources {
  app: Application;
  /** The letterboxed logical-world container every scene mounts into. */
  view: Container;
  snapshot(): QaSnapshot;
}

/** True only under `vite dev` — production bundles skip the install. */
export function isDevBuild(): boolean {
  return (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
}

function collectText(node: Container, out: string[]): void {
  if (node instanceof Text && node.text) out.push(node.text);
  for (const child of node.children) collectText(child as Container, out);
}

export function installQaHooks(src: QaSources): void {
  const canvas = src.app.canvas as HTMLCanvasElement;

  /** Logical stage point -> viewport client point (matches main.fit()). */
  const toClient = (lx: number, ly: number): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    const s = Math.min(r.width / STAGE_W, r.height / STAGE_H);
    return {
      x: r.left + Math.round((r.width - STAGE_W * s) / 2) + lx * s,
      y: r.top + Math.round((r.height - STAGE_H * s) / 2) + ly * s,
    };
  };

  const pointer = (type: string, x: number, y: number): void => {
    canvas.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse',
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
      isPrimary: true, bubbles: true, cancelable: true,
    }));
  };

  (window as unknown as Record<string, unknown>).__QA = {
    /** Every string currently on the stage, in draw order. */
    texts(): string[] {
      const out: string[] = [];
      collectText(src.view, out);
      return out;
    },
    /** True when any live label contains `needle` (case-insensitive). */
    sees(needle: string): boolean {
      const n = needle.toUpperCase();
      const out: string[] = [];
      collectText(src.view, out);
      return out.some((t) => t.toUpperCase().includes(n));
    },
    /** Click a LOGICAL stage coordinate (1600x900 space). */
    click(lx: number, ly: number): void {
      const p = toClient(lx, ly);
      pointer('pointerdown', p.x, p.y);
      pointer('pointerup', p.x, p.y);
    },
    /** Type into the focused text input (one window keydown per character). */
    type(str: string): void {
      for (const ch of str) window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
    },
    key(k: string): void {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    },
    /** Click the centre of the labelled node (e.g. 'opt3'). */
    clickLabel(label: string): boolean {
      const found: Container[] = [];
      const walk = (n: Container): void => {
        if (n.label === label) found.push(n);
        for (const c of n.children) walk(c as Container);
      };
      walk(src.view);
      if (!found.length) return false;
      const b = found[0].getBounds();
      const r = canvas.getBoundingClientRect();
      const cx = r.left + b.x + b.width / 2;
      const cy = r.top + b.y + b.height / 2;
      pointer('pointerdown', cx, cy);
      pointer('pointerup', cx, cy);
      return true;
    },
    state: (): QaSnapshot => src.snapshot(),
    /** What Pixi believes is under a logical point (hit-test diagnosis). */
    hit(lx: number, ly: number): string {
      const p = toClient(lx, ly);
      const ev = src.app.renderer.events;
      const pt = { x: 0, y: 0 };
      ev.mapPositionToPoint(pt, p.x, p.y);
      const target = ev.rootBoundary.hitTest(pt.x, pt.y);
      return target ? (target.label || target.constructor.name) + '@' + Math.round(pt.x) + ',' + Math.round(pt.y) : 'MISS@' + Math.round(pt.x) + ',' + Math.round(pt.y);
    },
    app: src.app,
  };
}
