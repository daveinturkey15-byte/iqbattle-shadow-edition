/**
 * volume.ts — the always-present volume control: speaker icon + short track.
 *
 * WIRING (main.ts is NOT edited here — the owner of main.ts adds this):
 *
 *   import { mountVolume } from './scenes/volume.ts';
 *   ...
 *   // in boot(), immediately after:
 *   //   app.stage.addChild(bleedHolder, view);
 *   mountVolume(view);
 *
 * Why `view` and not a scene root or the per-round `overlay`: show() /
 * clearCurrent() destroy the scene root every depth, and deal() re-creates
 * `overlay` inside it, so anything parented there dies with the round. `view`
 * is the module-scope 1600x900 logical container that fit() scales and
 * centres and that nothing ever clears — the same reason initShadow(view) /
 * initLarge(view) live there. mountVolume turns on view.sortableChildren and
 * gives the widget a huge zIndex, so every scene show() adds LATER still sorts
 * underneath it: no round overlay, takeover scene, or persona layer can cover
 * it. It is mounted once for the life of the page; the returned stop() is
 * for tests and hot-reload, not for scene changes.
 *
 * Placement: x 1052..1188, y 846..876 — the one pocket on the game shell
 * clear of every fixed piece of chrome: below the sidebar (ends y 804),
 * right of the toast bar (x 40..960) and the landing Create-A-Room card
 * (ends x 1040), left of the Shadow bubble (starts x 1196). Header LOBBY /
 * LEAVE pills and the DEPTH strip are all top-of-stage.
 *
 * Interaction:
 *   - click / drag anywhere on the track (generous hit zone) sets the level;
 *     mouse wheel over the widget steps it 5 %.
 *   - click the speaker to toggle mute; the icon shows the muted state
 *     (crossed, dimmed) and the track fill dims with it.
 *   - keyboard, without inventing a focus system: any pointer interaction
 *     with the widget ARMS it for 5 s (ring drawn); while armed
 *     Left/Down/Right/Up step 5 %, Home/End jump, M toggles mute, Escape
 *     disarms. Clicking anywhere else disarms at once, so a takeover's arrow
 *     keys or a text input's letters never fight it.
 *   - a 11 px readout ("50 %" / "MUTED") appears over the knob while hovered,
 *     dragged or armed. Nothing animates and nothing flashes: every visual
 *     change is a direct response to input or to a pref change.
 *   - the widget redraws off audio.onAudioPrefChange, so a mute/volume change
 *     from anywhere (another tab, a debug console) is reflected within the
 *     audio core's 400 ms poll.
 * ========================================================================*/

import {
  Container, Graphics, Rectangle, Text,
  type FederatedPointerEvent, type FederatedWheelEvent,
} from 'pixi.js';
import { T } from '../theme.ts';
import {
  getVolume, isMuted, onAudioPrefChange, setMuted, setVolume, sfx,
} from '../audio/audio.ts';

/* ---- geometry (logical stage px) ---- */
const X = 1052;
const Y = 846;
const W = 136;
const H = 30;
const ICON_W = 30;       // speaker hit zone: x 0..30
const TRACK_X = 40;
const TRACK_LEN = 84;    // track: x 40..124
const TRACK_Y = H / 2;
const KNOB_R = 5;

const STEP = 0.05;
const ARM_MS = 5000;
/** Above anything a scene will ever set; scenes default to zIndex 0. */
const Z_TOP = 1_000_000;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Snap to whole percent so localStorage never carries 0.4700000001. */
function snap(v: number): number {
  return Math.round(clamp01(v) * 100) / 100;
}

export function mountVolume(parent: Container): () => void {
  const hadSortable = parent.sortableChildren;
  parent.sortableChildren = true;

  const c = new Container();
  c.zIndex = Z_TOP;
  c.x = X; c.y = Y;
  c.eventMode = 'static';
  c.hitArea = new Rectangle(0, 0, W, H);
  parent.addChild(c);

  const bg = new Graphics();
  bg.eventMode = 'none';
  c.addChild(bg);

  const icon = new Graphics();
  icon.eventMode = 'static';
  icon.cursor = 'pointer';
  icon.hitArea = new Rectangle(0, 0, ICON_W, H);
  c.addChild(icon);

  const track = new Graphics();
  track.eventMode = 'static';
  track.cursor = 'pointer';
  track.hitArea = new Rectangle(TRACK_X - 8, 0, TRACK_LEN + 16, H);
  c.addChild(track);

  const label = new Text({
    text: '',
    style: { fontFamily: T.font, fontSize: 11, fill: T.ink, fontWeight: '800', letterSpacing: 1 },
  });
  label.eventMode = 'none';
  label.visible = false;
  c.addChild(label);

  /* ---- state ---- */
  let hovered = false;
  let dragging = false;
  let armedUntil = 0;
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  let hitThisEvent = false;
  let alive = true;

  const armed = (): boolean => performance.now() < armedUntil;

  const draw = (): void => {
    if (!alive) return;
    const vol = getVolume();
    const muted = isMuted();
    const isArmed = armed();
    const active = hovered || dragging || isArmed;

    bg.clear();
    bg.roundRect(0, 0, W, H, H / 2);
    bg.fill({ color: T.panel, alpha: active ? 0.85 : 0.6 });
    if (isArmed) bg.stroke({ color: T.accentA, width: 1.5, alpha: 0.9 });
    else bg.stroke({ color: active ? '#ffffff' : T.panelEdge, width: 1, alpha: active ? 0.22 : 1 });

    /* speaker: box + cone, then waves (or a cross when muted) */
    const inkC = muted ? T.muted : T.ink;
    icon.clear();
    icon.rect(6, 11, 5, 8).fill({ color: inkC });
    icon.poly([11, 11, 17, 6, 17, 24, 11, 19]).fill({ color: inkC });
    if (muted) {
      icon.moveTo(20, 11).lineTo(26, 19);
      icon.moveTo(26, 11).lineTo(20, 19);
      icon.stroke({ color: T.bad, width: 2, alpha: 0.95 });
    } else {
      const wave = (r: number, alpha: number): void => {
        icon.moveTo(17 + r * Math.cos(-0.9), 15 + r * Math.sin(-0.9));
        icon.arc(17, 15, r, -0.9, 0.9);
        icon.stroke({ color: inkC, width: 1.5, alpha });
      };
      if (vol > 0) wave(5, 0.95);
      wave(9, vol > 0.5 ? 0.95 : 0.25);
    }

    /* track: rail, fill, knob */
    const kx = TRACK_X + TRACK_LEN * vol;
    track.clear();
    track.roundRect(TRACK_X, TRACK_Y - 2, TRACK_LEN, 4, 2).fill({ color: '#ffffff', alpha: 0.14 });
    if (vol > 0) {
      track.roundRect(TRACK_X, TRACK_Y - 2, TRACK_LEN * vol, 4, 2)
        .fill({ color: T.accentA, alpha: muted ? 0.3 : 0.95 });
    }
    track.circle(kx, TRACK_Y, active ? KNOB_R + 1 : KNOB_R).fill({ color: muted ? T.muted : T.ink });
    if (isArmed) track.stroke({ color: T.accentA, width: 1.5, alpha: 0.9 });

    /* readout over the knob; only while the user is engaged with it */
    label.visible = active;
    if (active) {
      label.text = muted ? 'MUTED' : `${Math.round(vol * 100)} %`;
      label.x = Math.round(Math.min(W - label.width, Math.max(0, kx - label.width / 2)));
      label.y = -16;
    }
  };

  const arm = (): void => {
    armedUntil = performance.now() + ARM_MS;
    if (armTimer) clearTimeout(armTimer);
    armTimer = setTimeout(() => { armTimer = null; draw(); }, ARM_MS + 20);
  };

  const disarm = (): void => {
    if (armedUntil === 0) return;
    armedUntil = 0;
    if (armTimer) { clearTimeout(armTimer); armTimer = null; }
    draw();
  };

  const setFromPointer = (e: FederatedPointerEvent): void => {
    const p = c.toLocal(e.global);
    setVolume(snap((p.x - TRACK_X) / TRACK_LEN));
  };

  const stepBy = (d: number): void => {
    setVolume(snap(getVolume() + d));
    sfx('tick');
  };

  const toggleMute = (): void => {
    setMuted(!isMuted());
    sfx('click'); // audible only when this just UNmuted: proof the gate opened
  };

  /* ---- pointer ---- */
  c.on('pointerdown', () => { hitThisEvent = true; arm(); draw(); });
  c.on('pointerover', () => { hovered = true; draw(); });
  c.on('pointerout', () => { hovered = false; draw(); });
  icon.on('pointerdown', toggleMute);
  track.on('pointerdown', (e: FederatedPointerEvent) => { dragging = true; setFromPointer(e); });
  c.on('globalpointermove', (e: FederatedPointerEvent) => { if (dragging) setFromPointer(e); });
  const endDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    sfx('click'); // hear the level you just set
    draw();
  };
  c.on('pointerup', endDrag);
  c.on('pointerupoutside', endDrag);
  c.on('wheel', (e: FederatedWheelEvent) => {
    stepBy(e.deltaY < 0 ? STEP : -STEP);
    arm();
    draw();
  });

  /* ---- keyboard (armed window only) ---- */
  /* Pixi dispatches its pointerdown synchronously from the canvas listener,
   * which bubbles to document AFTER our handlers ran — so if this fires and
   * the widget did not flag the event, the click landed somewhere else. */
  const onDocPointerDown = (): void => {
    if (hitThisEvent) { hitThisEvent = false; return; }
    disarm();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!armed()) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': case 'ArrowDown': stepBy(-STEP); break;
      case 'ArrowRight': case 'ArrowUp': stepBy(STEP); break;
      case 'Home': setVolume(0); break;
      case 'End': setVolume(1); sfx('tick'); break;
      case 'm': case 'M': toggleMute(); break;
      case 'Escape': disarm(); return; // let Escape reach whoever else wants it
      default: handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    arm();
    draw();
  };
  document.addEventListener('pointerdown', onDocPointerDown);
  window.addEventListener('keydown', onKeyDown);

  const unsub = onAudioPrefChange(draw);
  draw();

  return () => {
    if (!alive) return;
    alive = false;
    unsub();
    document.removeEventListener('pointerdown', onDocPointerDown);
    window.removeEventListener('keydown', onKeyDown);
    if (armTimer) { clearTimeout(armTimer); armTimer = null; }
    c.removeAllListeners();
    icon.removeAllListeners();
    track.removeAllListeners();
    c.destroy({ children: true });
    parent.sortableChildren = hadSortable;
  };
}
