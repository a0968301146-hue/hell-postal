// "每日起床＋夢境漫畫" round — the dream comic's own full-screen DOM overlay
// (spec十四/十五). Deliberately its own small DOM-only module, mirroring this
// codebase's own established convention: letter-reading-ui.ts is the
// equivalent standalone overlay-builder for AfterWorkStorySystem's Day7
// letter beat, after-work-story-bubble-ui.ts for its NPC dialogue bubble.
// DreamComicSystem owns creation/show/hide/panel-advance timing; this file
// only ever builds/updates plain HTMLElements, no scene-graph or physics —
// same split those two existing modules already establish.
import { DreamPanel } from './dream-comic-types';

export interface DreamComicUiHandle {
  root: HTMLDivElement;
  panelBoxEl: HTMLDivElement;
  textEl: HTMLDivElement;
  progressEl: HTMLDivElement;
}

/** Builds the whole overlay once at construction (DreamComicSystem's own
 * constructor) — reused for every day's dream, never rebuilt per-panel or
 * per-day (mirrors letter-reading-ui.ts's own createLetterReadingUi single-
 * build-then-reuse shape). Layout follows spec十四's own sketch: black full-
 * screen background, a centered "comic panel" box, a text area below it, and
 * a small advance hint. */
export function createDreamComicUi(): DreamComicUiHandle {
  const root = document.createElement('div');
  root.style.cssText = [
    'position:fixed', 'inset:0', 'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center',
    'background:#000', 'opacity:0', 'pointer-events:none',
    'transition:opacity 0.4s ease',
    // Above letter-reading-ui.ts's own 9600 — the two never show
    // simultaneously in practice (a dream only ever plays at a day's own
    // start, gated on AfterWorkStorySystem.isActive being false; the letter
    // overlay only ever shows while that system IS active), but picking a
    // higher, distinct z-index keeps the two full-screen story overlays
    // unambiguously ordered regardless.
    'z-index:9700',
    'font-family:"Noto Serif TC","Noto Serif","serif"',
  ].join(';');

  // Comic panel box — placeholder-only this round (spec八: "目前沒有圖片時可
  // 以顯示：DREAM PANEL"). updateDreamComicPanel below swaps this element's
  // own background-image in once a panel's `image` field is non-null — a
  // future round filling in real art only ever needs to edit
  // dream-comic-data.ts's own data, never this file's control flow.
  const panelBox = document.createElement('div');
  panelBox.style.cssText = [
    'width:min(640px,80vw)', 'height:min(360px,45vh)',
    'background:#2a2a2a', 'border:1px solid #555', 'border-radius:4px',
    'display:flex', 'align-items:center', 'justify-content:center',
    'color:#8a8a8a', 'font-size:15px', 'letter-spacing:0.12em',
  ].join(';');
  root.appendChild(panelBox);

  const textEl = document.createElement('div');
  textEl.style.cssText = [
    'width:min(640px,80vw)', 'margin-top:22px', 'min-height:64px',
    'color:#e8e2d0', 'font-size:17px', 'line-height:1.9',
    'white-space:pre-line', 'text-align:center',
  ].join(';');
  root.appendChild(textEl);

  const progressEl = document.createElement('div');
  progressEl.style.cssText = 'margin-top:16px;color:#777;font-size:12px;letter-spacing:0.15em;';
  root.appendChild(progressEl);

  const hint = document.createElement('div');
  hint.textContent = '▶ 按 E／Space／滑鼠左鍵 繼續';
  hint.style.cssText = 'margin-top:8px;color:#666;font-size:12px;letter-spacing:0.08em;';
  root.appendChild(hint);

  document.body.appendChild(root);
  return { root, panelBoxEl: panelBox, textEl, progressEl };
}

export function showDreamComicUi(handle: DreamComicUiHandle): void {
  handle.root.style.opacity = '1';
  handle.root.style.pointerEvents = 'auto';
}

/** Fades the black overlay out (spec五: "黑色夢境畫面淡出") — purely a CSS
 * opacity transition, same "instantaneous state flip, cosmetic transition
 * animates it" shape letter-reading-ui.ts's own hideLetterReadingUi already
 * uses; the caller restores player control in this same tick (see
 * DreamComicSystem.endDream), so the player sees the room reveal itself as
 * the overlay fades, reading naturally as "waking up". */
export function hideDreamComicUi(handle: DreamComicUiHandle): void {
  handle.root.style.opacity = '0';
  handle.root.style.pointerEvents = 'none';
}

/** `panel.image` is always null this round (see dream-comic-data.ts's own
 * doc comment) — the generic "DREAM PANEL" placeholder (spec八) always
 * shows. Once a real image URL is supplied there, this switches the box to
 * render it as a background-image instead, with no other code needing to
 * change. */
export function updateDreamComicPanel(handle: DreamComicUiHandle, panel: DreamPanel, index: number, total: number): void {
  if (panel.image) {
    handle.panelBoxEl.textContent = '';
    handle.panelBoxEl.style.backgroundImage = `url(${panel.image})`;
    handle.panelBoxEl.style.backgroundSize = 'cover';
    handle.panelBoxEl.style.backgroundPosition = 'center';
  } else {
    handle.panelBoxEl.style.backgroundImage = 'none';
    handle.panelBoxEl.textContent = 'DREAM PANEL';
  }
  handle.textEl.textContent = panel.text;
  handle.progressEl.textContent = `${index} / ${total}`;
}
