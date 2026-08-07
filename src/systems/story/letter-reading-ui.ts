// "每日特殊劇情系統" round follow-up — Day7's own dedicated letter-reading
// overlay (spec: "彈出信件閱讀UI...信件像貼在螢幕前展示"), replacing the
// shared NPC dialogue bubble for this one day. Deliberately its own small
// DOM-only module (matching this codebase's own established convention:
// after-work-story-bubble-ui.ts is the equivalent helper for the shared
// bubble) — AfterWorkStorySystem owns creation/show/hide timing, this file
// only ever builds/updates plain HTMLElements, no scene-graph or physics.
export interface LetterReadingUiHandle {
  root: HTMLDivElement;
  senderEl: HTMLDivElement;
  recipientEl: HTMLDivElement;
  bodyEl: HTMLDivElement;
}

export function createLetterReadingUi(): LetterReadingUiHandle {
  const root = document.createElement('div');
  root.style.cssText = [
    'position:fixed', 'inset:0', 'display:flex', 'align-items:center', 'justify-content:center',
    'background:rgba(0,0,0,0)', 'opacity:0', 'pointer-events:none',
    'transition:opacity 0.35s ease, background-color 0.35s ease',
    'z-index:9600', 'font-family:"Noto Serif TC","Noto Serif","serif"',
  ].join(';');

  // Paper panel — a plain CSS-drawn sheet (spec: "先使用測試文字即可", no
  // real texture/image asset pipeline needed) styled to read as a letter
  // held up in front of the camera, not a UI dialog.
  const paper = document.createElement('div');
  paper.style.cssText = [
    'width:min(560px,84vw)', 'max-height:78vh', 'overflow-y:auto',
    'background:#f3e9d2', 'color:#3a2c18',
    'border-radius:2px', 'box-shadow:0 18px 50px rgba(0,0,0,0.65), inset 0 0 40px rgba(120,90,50,0.12)',
    'padding:40px 44px', 'line-height:2.0', 'font-size:17px',
    'transform:scale(0.94) translateY(8px)', 'transition:transform 0.35s ease',
  ].join(';');
  root.appendChild(paper);

  const recipientEl = document.createElement('div');
  recipientEl.style.cssText = 'font-size:18px;margin-bottom:18px;font-weight:600;';
  paper.appendChild(recipientEl);

  const bodyEl = document.createElement('div');
  bodyEl.style.cssText = 'white-space:pre-line;';
  paper.appendChild(bodyEl);

  const senderEl = document.createElement('div');
  senderEl.style.cssText = 'margin-top:22px;text-align:right;font-weight:600;';
  paper.appendChild(senderEl);

  const hint = document.createElement('div');
  hint.textContent = '按 E 關閉';
  hint.style.cssText = 'margin-top:28px;text-align:center;font-size:13px;color:#8a7658;letter-spacing:0.1em;';
  paper.appendChild(hint);

  document.body.appendChild(root);
  return { root, senderEl, recipientEl, bodyEl };
}

export function showLetterReadingUi(
  handle: LetterReadingUiHandle, sender: string, recipient: string, body: string[]
): void {
  handle.recipientEl.textContent = `致 ${recipient}：`;
  handle.bodyEl.textContent = body.join('\n\n');
  handle.senderEl.textContent = sender;
  handle.root.style.background = 'rgba(0,0,0,0.55)';
  handle.root.style.opacity = '1';
  handle.root.style.pointerEvents = 'auto';
  const paper = handle.root.firstElementChild as HTMLDivElement | null;
  if (paper) paper.style.transform = 'scale(1) translateY(0)';
}

export function hideLetterReadingUi(handle: LetterReadingUiHandle): void {
  handle.root.style.background = 'rgba(0,0,0,0)';
  handle.root.style.opacity = '0';
  handle.root.style.pointerEvents = 'none';
  const paper = handle.root.firstElementChild as HTMLDivElement | null;
  if (paper) paper.style.transform = 'scale(0.94) translateY(8px)';
}
