// "載具夜間清潔互動" round, "清潔點附著＋互動修正" follow-up — the night
// phase's own full-screen black fade (mirrors AfterWorkStorySystem's own
// `fadeEl`/DreamComicUi's own black overlay — same "position:fixed; inset:0;
// background:#000; opacity 0→1→0 transition" shape, just this feature's own
// dedicated element rather than sharing one across systems). Deliberately its
// own small DOM-only module, mirroring letter-reading-ui.ts's/
// dream-comic-ui.ts's own "UI builder separate from the owning system"
// convention.
//
// "載具對話框位置" round — this file now ALSO owns the vehicle dialogue box
// itself (showVehicleDialogueText/hideVehicleDialogueBox below), no longer
// after-work-story-bubble-ui.ts's own world-space sprite functions (see
// showVehicleDialogueText's own doc comment for the full root-cause
// writeup on why that was hard to see and why a fixed screen-space DOM
// panel fixes it categorically).
//
// "載具對話框跟隨載具" round — the fixed top:30%/left:50% screen position that
// round produced turned out to be its own problem the other way: EVERY
// vehicle's dialogue showed in the exact same spot regardless of which
// vehicle was actually talking, easy to lose track of during a 6-vehicle
// night. updateVehicleDialoguePosition below now re-projects a genuine
// WORLD-space anchor (that specific vehicle's own position + its own
// height + its own dock→exit facing direction, never the player's
// position/camera direction) into screen space every frame, so the box
// visibly sits just above and in front of whichever vehicle is actually
// mid-dialogue, and snaps to the new vehicle's own position immediately
// when dialogue moves on to a different one (dialogueEl still just a plain
// `position:fixed` DOM panel — only its left/top now come from a live
// per-frame calculation instead of a static CSS value).
//
// Follow-up round spec三/四: the tool-select strip this file used to build
// has been removed entirely — the player never picks a tool at all anymore
// (vehicle-night-cleaning-system.ts's own tryStartCharge() now resolves the
// correct tool internally from CleaningPointDefinition/toolId, purely as a
// backend correctness field never surfaced here). The only remaining
// player-facing text during cleaning is the SHARED `hud.showInteractionPrompt`
// generic prompt (owned by hud.ts, not this file) showing a plain "按住 E
// 清潔" — no tool name, no tool list, no tool icon, no "current tool"
// indicator of any kind.

import * as THREE from 'three';
import type { VehicleSystem } from '../vehicle/vehicle-system';

export interface NightCleaningUiHandle {
  fadeEl: HTMLDivElement;
  dialogueEl: HTMLDivElement;
  dialogueTextEl: HTMLDivElement;
}

const FADE_TRANSITION_SECONDS = 0.6;

export function createNightCleaningUi(): NightCleaningUiHandle {
  const fadeEl = document.createElement('div');
  fadeEl.style.cssText = [
    'position:fixed', 'inset:0', 'background:#000', 'opacity:0', 'pointer-events:none',
    `transition:opacity ${FADE_TRANSITION_SECONDS}s ease`, 'z-index:9500',
  ].join(';');
  document.body.appendChild(fadeEl);

  // "載具對話框跟隨載具" round — still a fixed screen-space DOM panel (NOT a
  // world-space THREE.Sprite parented to the vehicle — that was the ORIGINAL
  // approach this codebase already tried and moved away from, see this
  // file's own top-of-file doc comment: a sprite anchored to a tall
  // vehicle's own local frame sits far overhead of wherever the player is
  // actually looking, easy to miss). `left`/`top` below are just SAFE
  // DEFAULTS for the one frame between display:block and the first real
  // updateVehicleDialoguePosition() call (beginDialogue() below always
  // calls that synchronously right after showing the box, so in practice
  // these defaults are never actually visible) — every subsequent frame
  // overwrites them with a genuine world→screen projection of that
  // specific vehicle's own position (see updateVehicleDialoguePosition's
  // own doc comment). `transform:translate(-50%,-100%)` anchors the box's
  // own BOTTOM-CENTER to the computed point, so the box reads as "floating
  // just above" the vehicle rather than being centered on it.
  const dialogueEl = document.createElement('div');
  dialogueEl.id = 'vehicle-dialogue-box';
  dialogueEl.style.cssText = [
    'position:fixed', 'top:30%', 'left:50%', 'transform:translate(-50%,-100%)',
    'max-width:480px', 'padding:14px 26px', 'background:rgba(20,15,10,0.88)',
    'border:1px solid rgba(255,225,160,0.35)', 'border-radius:8px',
    'color:#f5ead0', 'font-family:sans-serif', 'font-size:16px', 'line-height:1.7',
    'text-align:center', 'text-shadow:0 0 4px rgba(0,0,0,0.9)', 'word-break:break-word',
    'pointer-events:none', 'z-index:400', 'display:none',
  ].join(';');
  const dialogueTextEl = document.createElement('div');
  dialogueEl.appendChild(dialogueTextEl);
  const dialogueHintEl = document.createElement('div');
  dialogueHintEl.textContent = '按 E 繼續';
  dialogueHintEl.style.cssText = 'margin-top:8px;color:#c9b98a;font-size:12px;letter-spacing:0.08em;';
  dialogueEl.appendChild(dialogueHintEl);
  document.body.appendChild(dialogueEl);

  return { fadeEl, dialogueEl, dialogueTextEl };
}

export function setFadeOpacity(handle: NightCleaningUiHandle, opacity: 0 | 1): void {
  handle.fadeEl.style.opacity = String(opacity);
}

/** "載具對話框位置" round — replaces the old after-work-story-bubble-ui.ts-
 * based world-space sprite (createStoryBubble/showStoryBubbleText/
 * hideStoryBubble) this system used to attach as a child of each vehicle's
 * own vehicleGroup, floating at `floorY + config.height + 0.6`. That height
 * formula put the bubble WAY above where the player is actually looking for
 * a tall vehicle (rockgiant/kraken) — the player aims at a cleaning point on
 * the vehicle's own BODY, often well below eye level, while the bubble sat
 * far overhead, easy to miss entirely. A fixed screen-space panel sidesteps
 * this categorically: same on-screen spot every time, independent of vehicle
 * height, camera angle, or occluding scene geometry. Deliberately a
 * SEPARATE small DOM module from after-work-story-bubble-ui.ts (that one
 * still serves AfterWorkStorySystem's own NPC dialogue, unchanged this
 * round — spec: "保持目前整體UI風格，不需要重新設計整套UI" was scoped to the
 * VEHICLE dialogue box specifically). */
export function showVehicleDialogueText(handle: NightCleaningUiHandle, text: string): void {
  handle.dialogueTextEl.textContent = text;
  handle.dialogueEl.style.display = 'block';
}

export function hideVehicleDialogueBox(handle: NightCleaningUiHandle): void {
  handle.dialogueEl.style.display = 'none';
}

/** How far above the vehicle's own roof (config.height, already the real
 * scaled height every vehicle type reports — rockgiant/kraken genuinely
 * report a taller `height` than the frog/snail, so this naturally clears a
 * tall vehicle's own roofline without any per-vehicle special-casing). */
const DIALOGUE_UP_MARGIN = 0.55;
/** How far toward the vehicle's own front the anchor sits, off its exact
 * center — small on purpose (this is "in front of", not "far away from",
 * the vehicle; a large offset would drift the box away from whichever
 * vehicle it belongs to when several are docked close together). */
const DIALOGUE_FORWARD_OFFSET = 0.4;
/** Keeps the box fully on-screen (spec: "UI 不可以跑到畫面外") regardless of
 * how close to an edge the underlying world anchor projects to. */
const SCREEN_EDGE_MARGIN = 16;

const worldAnchor = new THREE.Vector3();
const cameraForward = new THREE.Vector3();
const toAnchor = new THREE.Vector3();

/** "載具對話框跟隨載具" round — the ONE place the dialogue box's screen
 * position is computed, called every frame while a dialogue is showing
 * (vehicle-night-cleaning-system.ts's own update(), plus once synchronously
 * from beginDialogue() so there's no stale-position flash on the very first
 * frame). Deliberately derives "front" from the VEHICLE's own dock→exit
 * direction (a real, static, per-vehicle-slot property already sitting in
 * VehicleConfig — never the player's position or camera facing, per spec:
 * "『正前方』請以載具自身朝向為基準，不要用玩家位置猜測"). This is necessary
 * rather than reading `vehicleGroup.rotation.y` because that field is only
 * ever animated for the frog (see VehicleSystem.moveToward's own `if
 * (this.isFrog)` block) — every other vehicle's rotation.y sits frozen at
 * whatever the constructor left it (0, since only the frog's build path
 * ever touches it), which would silently point "front" the same fixed
 * direction for every non-frog vehicle regardless of which way its own dock
 * actually faces. dockPosition→exitPosition is genuinely static and vehicle-
 * specific, and true for the entire dialogue window too (vehicles spawned
 * for the night sit motionless at their own dock position throughout
 * return/point/thank-you dialogue — movement only starts once
 * beginDeparture() fires, well after any dialogue this function is ever
 * called during has already ended). */
export function updateVehicleDialoguePosition(handle: NightCleaningUiHandle, camera: THREE.Camera, vehicle: VehicleSystem): void {
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

  // "如果載具暫時不在鏡頭內，可以隱藏UI" — checked via a genuine in-front-of-
  // camera dot product (NOT the projected NDC z alone, which stays
  // deceptively "in range" for some behind-camera cases with a perspective
  // projection) rather than a fabricated timeout/guess.
  camera.getWorldDirection(cameraForward);
  toAnchor.copy(worldAnchor).sub(camera.position);
  if (toAnchor.dot(cameraForward) <= 0) {
    handle.dialogueEl.style.visibility = 'hidden';
    return;
  }

  const ndc = worldAnchor.clone().project(camera);
  const w = window.innerWidth;
  const h = window.innerHeight;
  let sx = (ndc.x * 0.5 + 0.5) * w;
  let sy = (1 - (ndc.y * 0.5 + 0.5)) * h;

  const rect = handle.dialogueEl.getBoundingClientRect();
  const halfW = Math.max(rect.width / 2, 40);
  const boxH = Math.max(rect.height, 30);
  sx = THREE.MathUtils.clamp(sx, SCREEN_EDGE_MARGIN + halfW, w - SCREEN_EDGE_MARGIN - halfW);
  sy = THREE.MathUtils.clamp(sy, SCREEN_EDGE_MARGIN + boxH, h - SCREEN_EDGE_MARGIN);

  handle.dialogueEl.style.visibility = 'visible';
  handle.dialogueEl.style.left = `${sx}px`;
  handle.dialogueEl.style.top = `${sy}px`;
}
