import { Container, Graphics, Rectangle, Text } from 'pixi.js';
import { T } from '../theme.ts';

export type RewardId = 'lollipop' | 'sticker' | 'coin';
export type RewardShape = 'lollipop' | 'sticker' | 'coin';

export interface RewardObject {
  id: RewardId;
  label: string;
  shape: RewardShape;
  color: number;
  hpDelta: number;
  scoreDelta: number;
}

const REWARDS: Record<RewardId, RewardObject> = {
  lollipop: {
    id: 'lollipop', label: 'LOLLIPOP', shape: 'lollipop', color: 0xff9ecf,
    hpDelta: 0, scoreDelta: 0,
  },
  sticker: {
    id: 'sticker', label: 'STICKER', shape: 'sticker', color: 0xfff2a8,
    hpDelta: 0, scoreDelta: 0,
  },
  coin: {
    id: 'coin', label: 'COIN', shape: 'coin', color: 0xffd700,
    hpDelta: 0, scoreDelta: 10,
  },
};

export function rewardFor(id: string): RewardObject | null {
  if (!Object.prototype.hasOwnProperty.call(REWARDS, id)) return null;
  return REWARDS[id as RewardId];
}

/** Create a labeled, board-safe Pixi collectible; the caller positions and parents it. */
export function drawRewardObject(spec: RewardObject, size = 64): Container {
  const extent = Math.max(40, size);
  const root = new Container();
  root.label = `reward-${spec.id}`;
  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.hitArea = new Rectangle(0, 0, extent, extent + 20);

  const art = new Graphics();
  const cx = extent / 2;
  if (spec.shape === 'lollipop') {
    art.roundRect(cx - extent * 0.045, extent * 0.48, extent * 0.09, extent * 0.38, extent * 0.045)
      .fill({ color: T.ink });
    art.circle(cx, extent * 0.34, extent * 0.28)
      .fill({ color: spec.color })
      .stroke({ color: T.ink, width: Math.max(2, extent * 0.035) });
    art.moveTo(cx - extent * 0.13, extent * 0.34)
      .lineTo(cx + extent * 0.13, extent * 0.34)
      .stroke({ color: T.ink, width: Math.max(2, extent * 0.045) });
  } else if (spec.shape === 'sticker') {
    art.roundRect(extent * 0.14, extent * 0.13, extent * 0.72, extent * 0.68, extent * 0.13)
      .fill({ color: spec.color })
      .stroke({ color: T.ink, width: Math.max(2, extent * 0.035) });
    art.circle(cx - extent * 0.13, extent * 0.39, extent * 0.055).fill({ color: T.panel });
    art.circle(cx + extent * 0.13, extent * 0.39, extent * 0.055).fill({ color: T.panel });
    art.moveTo(cx - extent * 0.14, extent * 0.55)
      .lineTo(cx, extent * 0.64)
      .lineTo(cx + extent * 0.14, extent * 0.55)
      .stroke({ color: T.panel, width: Math.max(2, extent * 0.04) });
  } else {
    art.circle(cx, extent * 0.42, extent * 0.31)
      .fill({ color: spec.color })
      .stroke({ color: T.ink, width: Math.max(2, extent * 0.035) });
    art.circle(cx, extent * 0.42, extent * 0.22)
      .stroke({ color: T.panel, width: Math.max(2, extent * 0.035) });
    art.moveTo(cx, extent * 0.27)
      .lineTo(cx, extent * 0.57)
      .stroke({ color: T.panel, width: Math.max(2, extent * 0.045) });
  }
  root.addChild(art);

  const label = new Text({
    text: spec.label,
    style: {
      fontFamily: T.font,
      fontSize: Math.max(11, Math.round(extent * 0.15)),
      fill: T.ink,
      fontWeight: '700',
      align: 'center',
    },
  });
  label.x = (extent - label.width) / 2;
  label.y = extent + 2;
  root.addChild(label);
  return root;
}
