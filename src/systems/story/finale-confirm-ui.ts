// "每日特殊劇情系統" round follow-up — Day8's own campfire "sit down"
// confirmation (spec: "按E→顯示確認視窗...【坐下休息】【再逛一下】"). Matches
// this codebase's own established "small, isolated DOM-only helper" split
// (after-work-story-bubble-ui.ts, letter-reading-ui.ts) — AfterWorkStorySystem
// owns all timing/state, this file only ever builds/shows/hides plain
// HTMLElements.
//
// Deliberately keyboard-operated, NOT mouse-click — pointer lock stays
// engaged the whole time this shows (this system never calls PauseManager,
// same reasoning as every other beat in after-work-story-system.ts), so
// there is no visible OS cursor to click a DOM button with. The two options
// are rendered as button-styled boxes (matching the requested visual) but
// actually read E/R keydowns from AfterWorkStorySystem's own onKeyDown.
export interface FinaleConfirmUiHandle {
  root: HTMLDivElement;
}

export function createFinaleConfirmUi(): FinaleConfirmUiHandle {
  const root = document.createElement('div');
  root.style.cssText = [
    'position:fixed', 'inset:0', 'display:flex', 'align-items:center', 'justify-content:center',
    'background:rgba(0,0,0,0)', 'opacity:0', 'pointer-events:none',
    'transition:opacity 0.3s ease, background-color 0.3s ease',
    'z-index:9550', 'font-family:sans-serif',
  ].join(';');

  const box = document.createElement('div');
  box.style.cssText = [
    'background:linear-gradient(180deg,#3a2e22,#2c2219)', 'border-radius:10px', 'padding:30px 34px',
    'box-shadow:0 0 0 1px rgba(232,200,64,0.25) inset, 0 18px 50px rgba(0,0,0,0.6)',
    'max-width:380px', 'text-align:center', 'color:#f5f0e0',
  ].join(';');
  root.appendChild(box);

  const text = document.createElement('p');
  text.textContent = '今天就到這裡吧？';
  text.style.cssText = 'margin:0 0 22px 0;font-size:18px;line-height:1.6;';
  box.appendChild(text);

  const buttonRow = document.createElement('div');
  buttonRow.style.cssText = 'display:flex;gap:14px;justify-content:center;';
  box.appendChild(buttonRow);

  const buttonStyle = [
    'min-width:120px', 'padding:12px 16px', 'border:1px solid rgba(232,200,64,0.35)', 'border-radius:6px',
    'background:#6b4a2e', 'color:#f5f0e0', 'font-size:14px', 'line-height:1.5', 'white-space:pre-line',
  ].join(';');

  const sitOption = document.createElement('div');
  sitOption.textContent = '【E】坐下休息';
  sitOption.style.cssText = buttonStyle;
  buttonRow.appendChild(sitOption);

  const exploreOption = document.createElement('div');
  exploreOption.textContent = '【R】再逛一下';
  exploreOption.style.cssText = buttonStyle;
  buttonRow.appendChild(exploreOption);

  document.body.appendChild(root);
  return { root };
}

export function showFinaleConfirmUi(handle: FinaleConfirmUiHandle): void {
  handle.root.style.background = 'rgba(0,0,0,0.55)';
  handle.root.style.opacity = '1';
}

export function hideFinaleConfirmUi(handle: FinaleConfirmUiHandle): void {
  handle.root.style.background = 'rgba(0,0,0,0)';
  handle.root.style.opacity = '0';
}
