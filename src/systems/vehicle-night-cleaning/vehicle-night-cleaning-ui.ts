// "載具夜間清潔互動" round — the night phase's own two small DOM pieces
// (spec三/十): a full-screen black fade (mirrors AfterWorkStorySystem's own
// `fadeEl`/DreamComicUi's own black overlay — same "position:fixed;
// inset:0; background:#000; opacity 0→1→0 transition" shape, just this
// feature's own dedicated element rather than sharing one across systems),
// and a small always-simple tool-select strip (spec二十五: "不要自行發明新的
// 遊戲工具模型" — plain text buttons, no icons/art). Deliberately its own
// small DOM-only module, mirroring letter-reading-ui.ts's/dream-comic-ui.ts's
// own "UI builder separate from the owning system" convention — the actual
// per-vehicle dialogue popup reuses after-work-story-bubble-ui.ts's own
// functions directly (imported by vehicle-night-cleaning-system.ts itself,
// not re-wrapped here) rather than building a third dialogue-bubble
// implementation.
import { CleaningToolId, CLEANING_TOOL_LABELS } from '../../data/vehicle/vehicle-cleaning-data';

export interface NightCleaningUiHandle {
  fadeEl: HTMLDivElement;
  toolBarEl: HTMLDivElement;
  toolButtons: Record<CleaningToolId, HTMLButtonElement>;
}

const FADE_TRANSITION_SECONDS = 0.6;

export function createNightCleaningUi(onSelectTool: (toolId: CleaningToolId) => void): NightCleaningUiHandle {
  const fadeEl = document.createElement('div');
  fadeEl.style.cssText = [
    'position:fixed', 'inset:0', 'background:#000', 'opacity:0', 'pointer-events:none',
    `transition:opacity ${FADE_TRANSITION_SECONDS}s ease`, 'z-index:9500',
  ].join(';');
  document.body.appendChild(fadeEl);

  // Tool-select strip — visible only during the 'cleaning' state (spec十:
  // "確認玩家持有正確工具"). Plain text buttons, no 3D held-item model of
  // any kind (spec二十五) — this is a self-contained selector scoped
  // entirely to this feature, never touching ToolSystem/the real hotbar.
  const toolBarEl = document.createElement('div');
  toolBarEl.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:90px', 'transform:translateX(-50%)',
    'display:flex', 'gap:8px', 'opacity:0', 'pointer-events:none', 'transition:opacity 0.3s ease',
    'z-index:9400', 'font-family:sans-serif',
  ].join(';');
  document.body.appendChild(toolBarEl);

  const toolButtons = {} as Record<CleaningToolId, HTMLButtonElement>;
  (Object.keys(CLEANING_TOOL_LABELS) as CleaningToolId[]).forEach((toolId, i) => {
    const btn = document.createElement('button');
    btn.textContent = `${i + 1}. ${CLEANING_TOOL_LABELS[toolId]}`;
    btn.style.cssText = [
      'padding:6px 10px', 'font-size:13px', 'border-radius:4px', 'border:1px solid #888',
      'background:rgba(20,20,20,0.75)', 'color:#e8e2d0', 'cursor:pointer', 'pointer-events:auto',
    ].join(';');
    btn.addEventListener('click', () => onSelectTool(toolId));
    toolBarEl.appendChild(btn);
    toolButtons[toolId] = btn;
  });

  return { fadeEl, toolBarEl, toolButtons };
}

export function setFadeOpacity(handle: NightCleaningUiHandle, opacity: 0 | 1): void {
  handle.fadeEl.style.opacity = String(opacity);
}

export function showToolBar(handle: NightCleaningUiHandle): void {
  handle.toolBarEl.style.opacity = '1';
  handle.toolBarEl.style.pointerEvents = 'auto';
}

export function hideToolBar(handle: NightCleaningUiHandle): void {
  handle.toolBarEl.style.opacity = '0';
  handle.toolBarEl.style.pointerEvents = 'none';
}

/** Highlights whichever tool is currently selected (spec十: player must
 * hold the CORRECT one) so it's visually obvious at a glance without any
 * extra text. */
export function highlightSelectedTool(handle: NightCleaningUiHandle, selected: CleaningToolId | null): void {
  for (const [toolId, btn] of Object.entries(handle.toolButtons) as [CleaningToolId, HTMLButtonElement][]) {
    btn.style.outline = toolId === selected ? '2px solid #ffcc00' : 'none';
  }
}
