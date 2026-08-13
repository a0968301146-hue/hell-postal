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
// Follow-up round spec三/四: the tool-select strip this file used to build
// has been removed entirely — the player never picks a tool at all anymore
// (vehicle-night-cleaning-system.ts's own tryStartCharge() now resolves the
// correct tool internally from CleaningPointDefinition/toolId, purely as a
// backend correctness field never surfaced here). The only remaining
// player-facing text during cleaning is the SHARED `hud.showInteractionPrompt`
// generic prompt (owned by hud.ts, not this file) showing a plain "按住 E
// 清潔" — no tool name, no tool list, no tool icon, no "current tool"
// indicator of any kind.

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

  // "載具對話框位置" round — a fixed screen-space DOM panel, NOT a
  // world-space THREE.Sprite following the vehicle (see this handle's own
  // doc comment / dialogueEl's own doc comment below for the full
  // root-cause writeup of why the old approach was hard to see). Fixed at
  // top:30% — clear of #crosshair/#interaction-prompt/#charge-bar-container
  // (all clustered around/below screen-center, top:50%+, where the player is
  // actually aiming at a cleaning point when this fires) and clear of
  // #daily-complete-banner (top:20%, only ever visible for a few seconds
  // right as a day ends — the two practically never show at once, but even
  // if they did, 30% vs 20% doesn't overlap) — comfortably "upper-middle",
  // always in the same on-screen spot regardless of how tall a given
  // vehicle is or which way the player's camera happens to be pointed.
  const dialogueEl = document.createElement('div');
  dialogueEl.id = 'vehicle-dialogue-box';
  dialogueEl.style.cssText = [
    'position:fixed', 'top:30%', 'left:50%', 'transform:translate(-50%,-50%)',
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
