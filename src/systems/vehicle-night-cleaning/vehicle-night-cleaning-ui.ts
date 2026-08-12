// "載具夜間清潔互動" round, "清潔點附著＋互動修正" follow-up — the night
// phase's own full-screen black fade (mirrors AfterWorkStorySystem's own
// `fadeEl`/DreamComicUi's own black overlay — same "position:fixed; inset:0;
// background:#000; opacity 0→1→0 transition" shape, just this feature's own
// dedicated element rather than sharing one across systems). Deliberately its
// own small DOM-only module, mirroring letter-reading-ui.ts's/
// dream-comic-ui.ts's own "UI builder separate from the owning system"
// convention — the actual per-vehicle dialogue popup reuses
// after-work-story-bubble-ui.ts's own functions directly (imported by
// vehicle-night-cleaning-system.ts itself, not re-wrapped here).
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
}

const FADE_TRANSITION_SECONDS = 0.6;

export function createNightCleaningUi(): NightCleaningUiHandle {
  const fadeEl = document.createElement('div');
  fadeEl.style.cssText = [
    'position:fixed', 'inset:0', 'background:#000', 'opacity:0', 'pointer-events:none',
    `transition:opacity ${FADE_TRANSITION_SECONDS}s ease`, 'z-index:9500',
  ].join(';');
  document.body.appendChild(fadeEl);

  return { fadeEl };
}

export function setFadeOpacity(handle: NightCleaningUiHandle, opacity: 0 | 1): void {
  handle.fadeEl.style.opacity = String(opacity);
}
