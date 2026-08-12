// "每日獲得道具" round — the reward popup's own full-screen DOM overlay,
// mirroring dream-comic-ui.ts's own established shape byte-for-byte (black
// full-screen background, a centered content box, a text area, an advance
// hint) — this codebase's own standing convention for a "standalone UI
// builder separate from the owning system" module (dream-comic-ui.ts /
// letter-reading-ui.ts / after-work-story-bubble-ui.ts are the identical
// precedent). ItemRewardSystem owns show/hide/advance timing; this file
// only ever builds/updates plain HTMLElements.
import { NewItemReward } from '../../data/daily-item-reward-data';

export interface ItemRewardUiHandle {
  root: HTMLDivElement;
  imageBoxEl: HTMLDivElement;
  nameEl: HTMLDivElement;
  descriptionEl: HTMLDivElement;
}

/** Builds the whole overlay once at construction — reused for every day's
 * reward, never rebuilt per-item or per-day. */
export function createItemRewardUi(): ItemRewardUiHandle {
  const root = document.createElement('div');
  root.style.cssText = [
    'position:fixed', 'inset:0', 'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center',
    'background:rgba(0,0,0,0.82)', 'opacity:0', 'pointer-events:none',
    'transition:opacity 0.3s ease',
    // Same tier as dream-comic-ui.ts's own root (9700) — the two never show
    // simultaneously in practice (this popup only ever appears from the
    // daily-settlement confirm callback, well before that day's own night
    // sequence or the FOLLOWING day's dream could start), but a distinct,
    // equally-high z-index keeps it unambiguously above ordinary HUD/game
    // UI regardless.
    'z-index:9700',
    'font-family:"Noto Serif TC","Noto Serif","serif"',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = '今日獲得';
  title.style.cssText = 'color:#e8e2d0;font-size:20px;letter-spacing:0.2em;margin-bottom:22px;';
  root.appendChild(title);

  // Image placeholder box — spec三/四: "[道具圖片／placeholder]", always the
  // generic box this round since every NewItemReward.image is null; a
  // future round filling in real art only needs to edit the data file, see
  // updateItemRewardCard below.
  const imageBox = document.createElement('div');
  imageBox.style.cssText = [
    'width:160px', 'height:160px',
    'background:#2a2a2a', 'border:1px solid #555', 'border-radius:6px',
    'display:flex', 'align-items:center', 'justify-content:center',
    'color:#777', 'font-size:13px', 'letter-spacing:0.1em',
  ].join(';');
  root.appendChild(imageBox);

  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'margin-top:18px;color:#f5ead0;font-size:22px;font-weight:bold;letter-spacing:0.08em;';
  root.appendChild(nameEl);

  const descriptionEl = document.createElement('div');
  descriptionEl.style.cssText = [
    'width:min(480px,80vw)', 'margin-top:10px',
    'color:#c9c2ae', 'font-size:15px', 'line-height:1.7',
    'white-space:pre-line', 'text-align:center',
  ].join(';');
  root.appendChild(descriptionEl);

  const hint = document.createElement('div');
  hint.textContent = '▶ 按 E／Space／滑鼠左鍵 繼續';
  hint.style.cssText = 'margin-top:26px;color:#666;font-size:12px;letter-spacing:0.08em;';
  root.appendChild(hint);

  document.body.appendChild(root);
  return { root, imageBoxEl: imageBox, nameEl, descriptionEl };
}

export function showItemRewardUi(handle: ItemRewardUiHandle): void {
  handle.root.style.opacity = '1';
  handle.root.style.pointerEvents = 'auto';
}

export function hideItemRewardUi(handle: ItemRewardUiHandle): void {
  handle.root.style.opacity = '0';
  handle.root.style.pointerEvents = 'none';
}

/** `item.image` is always null this round (daily-item-reward-data.ts's own
 * doc comment) — the generic placeholder box always shows. Once a real
 * image URL is supplied there, this switches the box to render it as a
 * background-image instead, with no other code needing to change (same
 * pattern dream-comic-ui.ts's own updateDreamComicPanel already
 * establishes for panel art). */
export function updateItemRewardCard(handle: ItemRewardUiHandle, item: NewItemReward): void {
  if (item.image) {
    handle.imageBoxEl.textContent = '';
    handle.imageBoxEl.style.backgroundImage = `url(${item.image})`;
    handle.imageBoxEl.style.backgroundSize = 'cover';
    handle.imageBoxEl.style.backgroundPosition = 'center';
  } else {
    handle.imageBoxEl.style.backgroundImage = 'none';
    handle.imageBoxEl.textContent = '道具圖片';
  }
  handle.nameEl.textContent = item.name;
  handle.descriptionEl.textContent = item.description;
}
