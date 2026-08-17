// "新增兔子吉祥物" round — pure DOM builder for the rabbit's own small
// floating guide panel (spec三: 小型浮動導覽UI，位於兔子正上方，不使用底部
// 字幕條也不套用一般NPC頭頂3D泡泡). Owns no category/entry state, no
// highlight index, no read-progress — mascot-guide-system.ts owns all of
// that and calls the render* functions below with plain data each time
// something changes. Mirrors this codebase's own established "system owns
// timing/state, satellite file only builds/shows/hides plain HTMLElements"
// convention (after-work-story-bubble-ui.ts, dialogue-choice-ui.ts, etc.).
export interface MascotGuideUiHandle {
  root: HTMLDivElement;
  panel: HTMLDivElement;
  bodyEl: HTMLDivElement;
}

export function createMascotGuideUi(): MascotGuideUiHandle {
  const root = document.createElement('div');
  root.id = 'mascot-guide';

  const panel = document.createElement('div');
  panel.className = 'mascot-guide-panel';
  root.appendChild(panel);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'mascot-guide-body';
  panel.appendChild(bodyEl);

  document.body.appendChild(root);
  return { root, panel, bodyEl };
}

export function showMascotGuideUi(handle: MascotGuideUiHandle): void {
  handle.root.classList.add('visible');
}

export function hideMascotGuideUi(handle: MascotGuideUiHandle): void {
  handle.root.classList.remove('visible');
}

/** Repositions the panel each frame to track the rabbit's own projected
 * screen position (spec三: "UI必須位於兔子的正上方") — `anchorX`/`anchorY`
 * are already-computed CSS pixel coordinates (see mascot-guide-system.ts's
 * own camera-projection math); this function only ever writes them into
 * inline styles, no projection math of its own. */
export function positionMascotGuideUi(handle: MascotGuideUiHandle, anchorX: number, anchorY: number): void {
  // #mascot-guide (root) is what carries position:fixed + the
  // translate(-50%,-100%) anchor transform in style.css — .mascot-guide-panel
  // itself is a plain statically-positioned child, so left/top must be
  // written on `root`, not `panel`.
  handle.root.style.left = `${anchorX}px`;
  handle.root.style.top = `${anchorY}px`;
}

/** "兔子吉祥物第三階段修改" round — one line only, no title (spec五: 縮小到
 * 適合單句文字, 感覺像"NPC路過聊天/小提示"而不是"正式劇情對話"), no
 * "E 繼續" state since a single line always closes on the next press. */
export function renderMascotContent(handle: MascotGuideUiHandle, line: string): void {
  handle.bodyEl.innerHTML = `
    <div class="mascot-guide-text">${line}</div>
    <div class="mascot-guide-hint">E／Space 關閉</div>
  `;
}
