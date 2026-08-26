import { Container, Graphics } from 'pixi.js';
import { T, STAGE_W, STAGE_H } from '../theme.ts';
import { text } from './game.ts';
import { luxePanel } from '../style/panelkit.ts';
import type { AttackMenuEntry, WeaponId } from './mpfeat.ts';

/**
 * LMS attack menu — the overlay a player gets after clicking a rival's
 * sidebar card. Renders the weapon rows mpfeat.attackMenu() priced for the
 * current depth; unaffordable rows say exactly how short you are rather than
 * greying out silently.
 *
 * Fairness rails (a11y-audit P1): escapable by click-outside AND Escape, no
 * flashes, every label >= 11px, and the overlay never steals the round timer.
 */
export interface AttackMenuOpts {
  targetName: string;
  targetScore: number;
  /** Target's remaining HP — the thing a curse actually threatens. */
  targetHp?: number;
  depth: number;
  entries: AttackMenuEntry[];
  /** Attacks the thrower has left this depth (0 => the menu is read-only). */
  budget: number;
  onPick(weapon: WeaponId): void;
  onClose(): void;
}

const PANEL_W = 520;
const ROW_H = 84;

/** Build the overlay. Caller adds it to the live scene root and removes it. */
export function buildAttackMenu(opts: AttackMenuOpts): Container {
  const root = new Container();

  /* Scrim: swallows every click that is not a weapon row, and closes. */
  const scrim = new Graphics();
  scrim.rect(0, 0, STAGE_W, STAGE_H).fill({ color: 0x040812, alpha: 0.72 });
  scrim.eventMode = 'static';
  scrim.cursor = 'default';
  scrim.on('pointerdown', () => opts.onClose());
  root.addChild(scrim);

  const panelH = 204 + opts.entries.length * ROW_H;
  const px = Math.round((STAGE_W - PANEL_W) / 2);
  const py = Math.round((STAGE_H - panelH) / 2);
  const card = luxePanel(root, px, py, PANEL_W, panelH);
  /* The panel itself absorbs clicks so a miss inside it does not close. */
  card.eventMode = 'static';
  card.on('pointerdown', (e) => e.stopPropagation());

  text(card, 'THROW SOMETHING', 32, 26, 13, T.muted, true);
  text(card, opts.targetName.toUpperCase().slice(0, 16), 32, 50, 26, T.ink, true);
  const stat = text(card, opts.targetScore + ' PTS · DEPTH ' + opts.depth, 32, 86, 12, T.muted);
  /* HP is the life bar, so it belongs on the weapon screen: a curse thrown at
   * a seat on 8 hp is a kill, and the thrower should be able to see that. */
  if (typeof opts.targetHp === 'number') {
    const hp = Math.max(0, Math.round(opts.targetHp));
    const dying = hp <= 25;
    text(card, ' · ' + hp + ' HP', stat.x + stat.width, 86, 12,
      dying ? T.bad : hp <= 50 ? T.gold : T.muted, dying);
    if (dying) text(card, 'ONE PUSH FROM THE DARK', 32, 104, 11, T.bad, true);
  }

  const budgetLine = text(
    card,
    opts.budget > 0 ? opts.budget + ' ATTACK' + (opts.budget === 1 ? '' : 'S') + ' LEFT THIS DEPTH' : 'NO ATTACKS LEFT THIS DEPTH',
    32, 122, 11, opts.budget > 0 ? T.gold : T.bad, true,
  );
  budgetLine.style.letterSpacing = 2;

  opts.entries.forEach((entry, i) => {
    const y = 154 + i * ROW_H;
    const usable = entry.affordable && opts.budget > 0;
    const row = new Graphics();
    row.roundRect(24, y, PANEL_W - 48, ROW_H - 12, T.radiusCard)
      .fill({ color: T.tile, alpha: usable ? 1 : 0.45 })
      .stroke({ color: usable ? T.bad : T.panelEdge, width: usable ? 2 : 1 });
    card.addChild(row);
    if (usable) {
      row.eventMode = 'static';
      row.cursor = 'pointer';
      row.on('pointerdown', (e) => { e.stopPropagation(); opts.onPick(entry.spec.id); });
    }
    text(card, entry.spec.label, 48, y + 14, 17, usable ? T.ink : T.muted, true);
    text(card, '−' + entry.spec.dmg + ' PTS' + (entry.spec.hpDelta ? '  ·  ' + entry.spec.hpDelta + ' HP' : ''),
      48, y + 40, 12, usable ? T.bad : T.muted, true);
    const cost = text(card, entry.affordable ? 'COSTS ' + entry.spec.cost : entry.reason,
      0, y + 40, 11, entry.affordable ? T.gold : T.muted, true);
    cost.x = PANEL_W - 48 - cost.width;
  });

  const close = new Graphics();
  close.roundRect(PANEL_W - 76, 22, 52, 34, 17).fill({ color: T.tile }).stroke({ color: T.panelEdge, width: 1 });
  close.eventMode = 'static';
  close.cursor = 'pointer';
  close.on('pointerdown', (e) => { e.stopPropagation(); opts.onClose(); });
  card.addChild(close);
  const cl = text(card, 'ESC', 0, 30, 12, T.muted, true);
  cl.x = PANEL_W - 76 + (52 - cl.width) / 2;

  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') opts.onClose(); };
  window.addEventListener('keydown', onKey);
  const origDestroy = root.destroy.bind(root);
  root.destroy = ((...a: Parameters<Container['destroy']>) => {
    window.removeEventListener('keydown', onKey);
    origDestroy(...a);
  }) as typeof root.destroy;

  return root;
}
