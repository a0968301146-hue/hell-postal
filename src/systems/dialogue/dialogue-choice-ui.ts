// "男主角台詞系統＋特殊NPC劇情選擇" round — pure DOM builder for a generic
// (up to 3 options, spec: "第一版固定支援3個選項即可") dialogue choice
// prompt. Generalizes finale-confirm-ui.ts's own established pattern
// (full-screen dim overlay, keyboard-only button-styled option boxes — no
// mouse click, since pointer lock stays engaged throughout AfterWorkStory-
// System's whole flow, same reasoning as that file's own doc comment) to N
// dynamic option labels supplied by the caller instead of 2 hardcoded ones.
// Owns no selection state itself — AfterWorkStorySystem's own onKeyDown
// reads the keypress and calls setDialogueChoiceHighlight/resolves the pick,
// mirroring how that same class already owns finale-confirm-ui's own E/R
// handling rather than that file listening for input itself.
export interface DialogueChoiceUiHandle {
  root: HTMLDivElement;
  optionEls: HTMLDivElement[];
}

const MAX_OPTIONS = 3;

export function createDialogueChoiceUi(): DialogueChoiceUiHandle {
  const root = document.createElement('div');
  root.id = 'dialogue-choice';

  const box = document.createElement('div');
  box.className = 'dialogue-choice-box';
  root.appendChild(box);

  const hint = document.createElement('div');
  hint.className = 'dialogue-choice-hint';
  hint.textContent = '1/2/3 選擇．↑↓ 移動．E 確認';
  box.appendChild(hint);

  const optionEls: HTMLDivElement[] = [];
  for (let i = 0; i < MAX_OPTIONS; i++) {
    const optionEl = document.createElement('div');
    optionEl.className = 'dialogue-choice-option';
    box.appendChild(optionEl);
    optionEls.push(optionEl);
  }

  document.body.appendChild(root);
  return { root, optionEls };
}

/** Shows up to MAX_OPTIONS labels (spec: 第一版固定3個) — any option element
 * beyond `labels.length` stays hidden rather than showing an empty box. */
export function showDialogueChoiceUi(handle: DialogueChoiceUiHandle, labels: string[]): void {
  handle.optionEls.forEach((el, i) => {
    if (i < labels.length) {
      el.textContent = `${i + 1}. ${labels[i]}`;
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  });
  handle.root.classList.add('visible');
}

export function setDialogueChoiceHighlight(handle: DialogueChoiceUiHandle, index: number): void {
  handle.optionEls.forEach((el, i) => el.classList.toggle('highlighted', i === index));
}

export function hideDialogueChoiceUi(handle: DialogueChoiceUiHandle): void {
  handle.root.classList.remove('visible');
}
