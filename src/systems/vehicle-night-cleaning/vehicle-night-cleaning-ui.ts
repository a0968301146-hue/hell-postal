// "載具夜間清潔互動" round, "清潔點附著＋互動修正" follow-up — the night
// phase's own full-screen black fade (mirrors AfterWorkStorySystem's own
// `fadeEl`/DreamComicUi's own black overlay — same "position:fixed; inset:0;
// background:#000; opacity 0→1→0 transition" shape, just this feature's own
// dedicated element rather than sharing one across systems). Deliberately its
// own small DOM-only module, mirroring letter-reading-ui.ts's/
// dream-comic-ui.ts's own "UI builder separate from the owning system"
// convention.
//
// "每台載具獨立字幕" round — this file used to own exactly ONE shared
// dialogue box (`#vehicle-dialogue-box`), reused across whichever vehicle
// happened to be "the current one talking". That shared-box model was the
// direct cause of an earlier bug in this same feature: only the FIRST
// vehicle to arrive could show its own greeting immediately (it got to
// claim the one box); every other vehicle's greeting had no natural trigger
// left once the "show it the moment the player aims at it" fallback was
// removed as its OWN separate bug fix, so only that one vehicle (in
// practice, always whichever config sorts first — the frog) ever appeared
// to "auto-talk". The fix is structural, not a workaround: this module now
// owns a POOL of independent captions, one per vehicle, each following its
// OWN vehicle's world position — so all six vehicles in a Day 4 night can
// genuinely show their own greeting at the exact same instant, with zero
// per-vehicle special-casing anywhere (vehicle-night-cleaning-system.ts's
// own showGreeting() just calls showVehicleCaption(vehicleId) for whichever
// vehicle just arrived, identically for every one of them).

import * as THREE from 'three';
import type { VehicleSystem } from '../vehicle/vehicle-system';

/** One vehicle's own independent on-screen caption — structurally identical
 * to what the old single shared `#vehicle-dialogue-box` looked like, just
 * one instance per vehicle now instead of one instance total. */
interface VehicleCaptionHandle {
  el: HTMLDivElement;
  textEl: HTMLDivElement;
  hintEl: HTMLDivElement;
}

export interface NightCleaningUiHandle {
  fadeEl: HTMLDivElement;
  /** Keyed by vehicleId — created lazily the first time a given vehicle
   * needs to show anything (showVehicleCaption below), removed once that
   * vehicle's own dialogue is fully done (removeVehicleCaption, called
   * right before it departs). */
  captions: Map<string, VehicleCaptionHandle>;
}

const FADE_TRANSITION_SECONDS = 0.6;

export function createNightCleaningUi(): NightCleaningUiHandle {
  const fadeEl = document.createElement('div');
  fadeEl.style.cssText = [
    'position:fixed', 'inset:0', 'background:#000', 'opacity:0', 'pointer-events:none',
    `transition:opacity ${FADE_TRANSITION_SECONDS}s ease`, 'z-index:9500',
  ].join(';');
  document.body.appendChild(fadeEl);

  return { fadeEl, captions: new Map() };
}

export function setFadeOpacity(handle: NightCleaningUiHandle, opacity: 0 | 1): void {
  handle.fadeEl.style.opacity = String(opacity);
}

/** Builds ONE caption's own DOM, identical in shape/style to the old shared
 * box (`position:fixed`, same padding/colors/border, `pointer-events:none`
 * so it never blocks clicks/raycasts, `transform:translate(-50%,-100%)` so
 * its own bottom-center anchors to the computed world point). `left`/`top`
 * start at a safe on-screen default; showVehicleCaption always calls
 * updateVehicleCaptionPosition synchronously right after creating one, so
 * these defaults are never actually visible in practice. */
function createCaptionElement(): VehicleCaptionHandle {
  const el = document.createElement('div');
  el.className = 'vehicle-dialogue-caption';
  el.style.cssText = [
    'position:fixed', 'top:30%', 'left:50%', 'transform:translate(-50%,-100%)',
    'max-width:360px', 'padding:12px 20px', 'background:rgba(20,15,10,0.88)',
    'border:1px solid rgba(255,225,160,0.35)', 'border-radius:8px',
    'color:#f5ead0', 'font-family:sans-serif', 'font-size:15px', 'line-height:1.6',
    'text-align:center', 'text-shadow:0 0 4px rgba(0,0,0,0.9)', 'word-break:break-word',
    'pointer-events:none', 'z-index:400', 'display:none',
  ].join(';');
  const textEl = document.createElement('div');
  el.appendChild(textEl);
  const hintEl = document.createElement('div');
  hintEl.textContent = '按 E 繼續';
  hintEl.style.cssText = 'margin-top:6px;color:#c9b98a;font-size:11px;letter-spacing:0.08em;display:none';
  el.appendChild(hintEl);
  document.body.appendChild(el);
  return { el, textEl, hintEl };
}

function getOrCreateCaption(handle: NightCleaningUiHandle, vehicleId: string): VehicleCaptionHandle {
  let caption = handle.captions.get(vehicleId);
  if (!caption) {
    caption = createCaptionElement();
    handle.captions.set(vehicleId, caption);
  }
  return caption;
}

/** "每台載具獨立字幕" round — shows/updates ONE vehicle's own caption text,
 * completely independent of every other vehicle's. `showHint` controls the
 * small "按 E 繼續" line beneath the text — only ever true for a thank-you
 * message actually awaiting the player's own dismiss action (return
 * greetings and per-point reactions never need E at all any more, see
 * vehicle-night-cleaning-system.ts's own doc comment, so they never show
 * this hint). */
export function showVehicleCaption(handle: NightCleaningUiHandle, vehicleId: string, text: string, showHint: boolean): void {
  const caption = getOrCreateCaption(handle, vehicleId);
  caption.textEl.textContent = text;
  caption.hintEl.style.display = showHint ? 'block' : 'none';
  caption.el.style.display = 'block';
}

/** Hides (but does not destroy) one vehicle's own caption — used once its
 * thank-you is actually dismissed via E, right before it departs. */
export function hideVehicleCaption(handle: NightCleaningUiHandle, vehicleId: string): void {
  const caption = handle.captions.get(vehicleId);
  if (caption) caption.el.style.display = 'none';
}

/** Fully removes a vehicle's own caption DOM element — called once that
 * vehicle has actually departed (VehicleSystem.dispose() time), so a long
 * multi-day run doesn't quietly accumulate hidden-but-still-in-the-DOM
 * caption elements for every vehicle that's ever cleaned a night. Safe to
 * call even if hideVehicleCaption() already ran (idempotent — a vehicle's
 * own caption is always hidden well before it starts departing). */
export function removeVehicleCaption(handle: NightCleaningUiHandle, vehicleId: string): void {
  const caption = handle.captions.get(vehicleId);
  if (!caption) return;
  caption.el.remove();
  handle.captions.delete(vehicleId);
}

/** How far above the vehicle's own roof (config.height, already the real
 * scaled height every vehicle type reports — rockgiant/kraken genuinely
 * report a taller `height` than the frog/snail, so this naturally clears a
 * tall vehicle's own roofline without any per-vehicle special-casing). */
const DIALOGUE_UP_MARGIN = 0.55;
/** How far toward the vehicle's own front the anchor sits, off its exact
 * center — small on purpose (this is "in front of", not "far away from",
 * the vehicle; a large offset would drift the caption away from whichever
 * vehicle it belongs to when several are docked close together). */
const DIALOGUE_FORWARD_OFFSET = 0.4;
/** Keeps each caption fully on-screen (spec: "UI 不可以跑到畫面外")
 * regardless of how close to an edge its underlying world anchor projects
 * to. */
const SCREEN_EDGE_MARGIN = 16;

const worldAnchor = new THREE.Vector3();
const cameraForward = new THREE.Vector3();
const toAnchor = new THREE.Vector3();

/** "載具對話框跟隨載具" round, generalized by "每台載具獨立字幕" round to run
 * per-vehicle — the ONE place a given vehicle's own caption's screen
 * position is computed, called every frame (for every vehicle that
 * currently has a caption showing) from vehicle-night-cleaning-system.ts's
 * own update(). Deliberately derives "front" from the VEHICLE's own
 * dock→exit direction (a real, static, per-vehicle-slot property already
 * sitting in VehicleConfig — never the player's position or camera facing,
 * per spec: "『正前方』請以載具自身朝向為基準，不要用玩家位置猜測") — see the
 * original "載具對話框跟隨載具" round's own doc comment for the full
 * writeup on why `vehicleGroup.rotation.y` itself can't be used instead
 * (only the frog's own rotation is ever animated).
 *
 * Behind-the-camera handling, and the "never hide, just freeze position"
 * rule for it, are unchanged from the single-box version — a caption must
 * never disappear just because its own vehicle isn't currently in view
 * (spec: "不能因為...camera看不到載具而自動隱藏"). */
export function updateVehicleCaptionPosition(handle: NightCleaningUiHandle, vehicleId: string, camera: THREE.Camera, vehicle: VehicleSystem): void {
  const caption = handle.captions.get(vehicleId);
  if (!caption) return;

  const pos = vehicle.position;
  const { dockPosition, exitPosition, height } = vehicle.config;
  let fx = exitPosition.x - dockPosition.x;
  let fz = exitPosition.z - dockPosition.z;
  const flen = Math.hypot(fx, fz);
  if (flen < 1e-3) { fx = 0; fz = 1; } else { fx /= flen; fz /= flen; }

  worldAnchor.set(
    pos.x + fx * DIALOGUE_FORWARD_OFFSET,
    pos.y + height + DIALOGUE_UP_MARGIN,
    pos.z + fz * DIALOGUE_FORWARD_OFFSET
  );

  camera.getWorldDirection(cameraForward);
  toAnchor.copy(worldAnchor).sub(camera.position);
  if (toAnchor.dot(cameraForward) <= 0) return; // behind camera -- freeze at last position, never hide

  const ndc = worldAnchor.clone().project(camera);
  const w = window.innerWidth;
  const h = window.innerHeight;
  let sx = (ndc.x * 0.5 + 0.5) * w;
  let sy = (1 - (ndc.y * 0.5 + 0.5)) * h;

  const rect = caption.el.getBoundingClientRect();
  const halfW = Math.max(rect.width / 2, 40);
  const boxH = Math.max(rect.height, 30);
  sx = THREE.MathUtils.clamp(sx, SCREEN_EDGE_MARGIN + halfW, w - SCREEN_EDGE_MARGIN - halfW);
  sy = THREE.MathUtils.clamp(sy, SCREEN_EDGE_MARGIN + boxH, h - SCREEN_EDGE_MARGIN);

  caption.el.style.left = `${sx}px`;
  caption.el.style.top = `${sy}px`;
}
