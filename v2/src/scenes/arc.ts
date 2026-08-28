/**
 * Corruption ARC applier — token-driven chrome mutation for v2 scenes.
 *
 * Pure/token-driven: NO game logic. Scenes opt in by LABEL convention
 * (Pixi v8 `label` on any DisplayObject):
 *   'bg…'        background surface      -> tint = tokens.bg
 *   'panel…'     panel chrome            -> tint = tokens.panel
 *   'tile…'      puzzle cell tiles       -> tint = tokens.tile
 *   'shadow…'    shadow-flavored decor   -> hidden while SANCTUARY active
 *   'arc-banner' layer whisper banners   -> hidden while SANCTUARY active
 *   'arc-vignette' RESERVED — managed here (crimson pressure overlay).
 *
 * Lineage: v1 sanctuary.js (faithful-skin refuge: pure visual swap, never
 * touches glyphs or scoring — fairness-safe) + alignment.js descent arcs.
 */
import { Container, Graphics } from 'pixi.js';
import { ARC_TOKENS, LAYER_TOKENS, SANCTUARY_TOKENS, type ArcPlan } from '../arc-data.ts';
import { STAGE_W, STAGE_H, T } from '../theme.ts';

/** A display node carrying a tint (Sprite/Graphics/Text/ViewContainer in Pixi v8). */
type TintedNode = Container & { tint: number };

function isTinted(node: Container): node is TintedNode {
  return typeof (node as Partial<TintedNode>).tint === 'number';
}

function hexInt(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

interface ArcState {
  sanctuary: boolean;
  /** Tints captured when sanctuary swapped in, restored on sanctuaryOff. */
  saved: Map<TintedNode, number>;
  hidden: Container[];
  vignette: Graphics | null;
  plan: ArcPlan | null;
}

const states = new WeakMap<Container, ArcState>();

function ensureState(scene: Container): ArcState {
  let st = states.get(scene);
  if (!st) {
    st = { sanctuary: false, saved: new Map(), hidden: [], vignette: null, plan: null };
    states.set(scene, st);
  }
  return st;
}

/** Which token slot a labeled node maps to ('bg' | 'panel' | 'tile'), or null. */
function tokenSlot(label: string | undefined): 'bg' | 'panel' | 'tile' | null {
  if (!label) return null;
  if (label.startsWith('shadow') || label === 'arc-vignette' || label === 'arc-banner') return null;
  if (label.startsWith('bg')) return 'bg';
  if (label.startsWith('panel')) return 'panel';
  if (label.startsWith('tile')) return 'tile';
  return null;
}

function slotColor(slot: 'bg' | 'panel' | 'tile', act: number): string {
  const t = ARC_TOKENS[act];
  return slot === 'bg' ? t.bg : slot === 'panel' ? t.panel : t.tile;
}

function sanctuarySlotColor(slot: 'bg' | 'panel' | 'tile'): string {
  return slot === 'bg' ? SANCTUARY_TOKENS.bg : SANCTUARY_TOKENS.panel;
}

/**
 * Apply one depth's arc plan to a scene: act-tints backgrounds/panels/tiles,
 * mounts the crimson vignette for plan.layer, and swaps the whole chrome to
 * faithful original tokens when plan.sanctuary (good round).
 */
export function applyArc(scene: Container, plan: ArcPlan): void {
  const st = ensureState(scene);
  st.plan = plan;
  st.sanctuary = false;

  const act = plan.act;
  walk(scene, (node) => {
    if (node.label === 'arc-vignette') {
      st.vignette = node as Graphics;
      return;
    }
    const slot = tokenSlot(node.label);
    if (slot && isTinted(node)) node.tint = hexInt(slotColor(slot, act));
  });
  mountVignette(scene, st, plan.layer);
  if (plan.sanctuary) sanctuaryOn(scene);
}

/** Full-chrome revert to faithful original-site tokens ("the light remembers you"). */
export function sanctuaryOn(scene: Container): void {
  const st = ensureState(scene);
  if (!st.sanctuary) {
    st.saved.clear();
    st.hidden = [];
  }
  walk(scene, (node) => {
    const slot = tokenSlot(node.label);
    if (slot) {
      if (isTinted(node)) {
        if (!st.saved.has(node)) st.saved.set(node, node.tint);
        node.tint = hexInt(sanctuarySlotColor(slot));
      }
      return;
    }
    if ((node.label ?? '').startsWith('shadow') || node.label === 'arc-banner') {
      if (node.visible) {
        node.visible = false;
        st.hidden.push(node);
      }
    }
  });
  if (st.vignette) st.vignette.visible = false;
  st.sanctuary = true;
}

/** Restore the corrupted chrome captured before sanctuaryOn. */
export function sanctuaryOff(scene: Container): void {
  const st = states.get(scene);
  if (!st || !st.sanctuary) return;
  const act = st.plan?.act ?? 0;
  for (const [node, tint] of st.saved) node.tint = tint;
  st.saved.clear();
  for (const node of st.hidden) node.visible = true;
  st.hidden = [];
  if (st.vignette) {
    st.vignette.visible = true;
  } else if (st.plan) {
    mountVignette(scene, st, st.plan.layer);
  }
  // Re-assert act tints for nodes that had no captured tint yet.
  walk(scene, (node) => {
    const slot = tokenSlot(node.label);
    if (slot && isTinted(node) && !st.saved.has(node)) node.tint = hexInt(slotColor(slot, act));
  });
  st.sanctuary = false;
}

/* ------------------------------------------------------------------ */
/* Layer banner                                                        */
/* ------------------------------------------------------------------ */

export interface BannerSpec {
  text: string;
  x: number;
  y: number;
  anchor: { x: number; y: number };
  label: string; // suggested child label so sanctuary hides it
  style: {
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
    fill: string;
    letterSpacing: number;
  };
}

/**
 * Spec for the crimson-pressure whisper at `layer` (1..7). Pure data — feed
 * to `new Text(spec.text, spec.style)` and add under the label 'arc-banner'.
 */
export function layerBanner(container: Container, layer: number): BannerSpec {
  const l = Math.min(LAYER_TOKENS.length, Math.max(1, Math.round(layer)));
  const tok = LAYER_TOKENS[l - 1];
  const w = container.width > 0 ? container.width : STAGE_W;
  const h = container.height > 0 ? container.height : STAGE_H;
  return {
    text: tok.label.length > 0 ? tok.label : `LAYER ${l}`,
    x: w / 2,
    y: Math.round(h * 0.08),
    anchor: { x: 0.5, y: 0 },
    label: 'arc-banner',
    style: {
      fontFamily: T.font,
      fontSize: 22 + l * 2,
      fontWeight: '700',
      fill: l >= 5 ? '#ff2038' : '#e0245e',
      letterSpacing: 4 + l,
    },
  };
}

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

function walk(root: Container, visit: (node: Container) => void): void {
  visit(root);
  for (const child of root.children) walk(child, visit);
}

function mountVignette(scene: Container, st: ArcState, layer: number): void {
  const l = Math.min(LAYER_TOKENS.length, Math.max(1, Math.round(layer)));
  const tok = LAYER_TOKENS[l - 1];
  if (!st.vignette || st.vignette.destroyed) {
    st.vignette = new Graphics();
    st.vignette.label = 'arc-vignette';
  }
  const g = st.vignette;
  g.clear();
  g.rect(0, 0, STAGE_W, STAGE_H).fill({ color: hexInt(tok.color), alpha: tok.alpha });
  g.eventMode = 'none';
  scene.addChild(g); // keep on top
  g.visible = !st.sanctuary;
}
