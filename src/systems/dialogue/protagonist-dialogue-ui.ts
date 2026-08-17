// "男主角台詞系統＋特殊NPC劇情選擇" round — pure DOM builder for the
// protagonist's own screen-space subtitle bar (spec一: 畫面最下方約1/6高度、
// 半透明灰色底板、不使用NPC頭頂3D對話泡泡). Owns no story flow, no line
// index, no typewriter timer, no choice logic — that all lives in
// protagonist-dialogue-system.ts (spec: "不要讓UI自己持有劇情流程/台詞index/
// typewriter timer/選擇邏輯"). Mirrors this codebase's own established
// "system owns timing/state, satellite file only builds/shows/hides plain
// HTMLElements" convention (after-work-story-bubble-ui.ts/letter-reading-
// ui.ts/finale-confirm-ui.ts).
export interface ProtagonistDialogueUiHandle {
  root: HTMLDivElement;
  textEl: HTMLDivElement;
}

export function createProtagonistDialogueUi(): ProtagonistDialogueUiHandle {
  const root = document.createElement('div');
  root.id = 'protagonist-dialogue';

  const textEl = document.createElement('div');
  textEl.className = 'protagonist-dialogue-text';
  root.appendChild(textEl);

  document.body.appendChild(root);
  return { root, textEl };
}

export function showProtagonistDialogueText(handle: ProtagonistDialogueUiHandle, text: string): void {
  handle.textEl.textContent = text;
  handle.root.classList.add('visible');
}

export function hideProtagonistDialogueUi(handle: ProtagonistDialogueUiHandle): void {
  handle.root.classList.remove('visible');
}
