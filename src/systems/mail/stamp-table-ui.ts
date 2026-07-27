// Drag-and-drop stamp-selection overlay ("Add modular envelope stamping and
// regional mail bag system" round 五) — ported the drag/drop MECHANIC from
// the old, now-dead src/game/stamp-minigame.ts (spec: "舊信封程式可以局部移
// 植"), rebuilt against this module's own EnvelopeRecord/MailDestination
// shapes rather than PackageData, and never touching PauseManager itself —
// game-app.ts's own minimal wiring owns pause/pointer-lock around this.
import { MAIL_DESTINATIONS, getMailDestination } from './mail-data';
import { EnvelopeRecord, MailDestination } from './mail-types';

export type StampUiResult = 'completed' | 'cancelled';

export class StampTableUi {
  private overlay: HTMLElement | null = null;
  private envelope: EnvelopeRecord;
  private onApply: (stamp: MailDestination) => void;
  private onComplete: (result: StampUiResult) => void;
  private draggedStamp: MailDestination | null = null;
  private dragEl: HTMLElement | null = null;

  /** `onApply` fires exactly once, the moment the CORRECT stamp is
   * confirmed (before the completion delay) — the caller (game-app.ts)
   * applies it via MailSystem.applyStamp, the single source of truth for
   * envelope state; this class only ever judges correctness for its own
   * UI feedback, never mutates MailSystem's registry directly. */
  constructor(envelope: EnvelopeRecord, onApply: (stamp: MailDestination) => void, onComplete: (result: StampUiResult) => void) {
    this.envelope = envelope;
    this.onApply = onApply;
    this.onComplete = onComplete;
    this.createUI();
  }

  private createUI(): void {
    const dest = getMailDestination(this.envelope.destination);
    this.overlay = document.createElement('div');
    this.overlay.id = 'stamp-minigame-overlay';
    this.overlay.innerHTML = `
      <div class="stamp-game-container">
        <div class="stamp-game-header">
          <h2>信封貼郵票工作桌</h2>
          <p class="stamp-instruction">查看目的地，選擇正確郵票拖到貼票區</p>
        </div>
        <div class="stamp-game-body">
          <div class="address-panel">
            <div class="address-card">
              <p class="address-recipient">${dest.icon} ${dest.displayName}</p>
              <p class="address-dest">${dest.region === 'domestic' ? '國內' : '海外'}</p>
            </div>
            <div class="stamp-target" id="stamp-drop-zone">
              <span>將郵票拖到此處</span>
            </div>
          </div>
          <div class="stamps-panel">
            ${MAIL_DESTINATIONS.map((s) => `
              <div class="stamp-item" data-stamp-id="${s.id}" draggable="false">
                <span class="stamp-icon">${s.icon}</span>
                <span class="stamp-name">${s.displayName}郵票</span>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="stamp-game-footer">
          <p>Esc：取消</p>
          <p id="stamp-feedback"></p>
        </div>
      </div>
    `;
    document.body.appendChild(this.overlay);

    this.overlay.querySelectorAll('.stamp-item').forEach((el) => {
      el.addEventListener('mousedown', (e) => this.onStampMouseDown(e as MouseEvent, el as HTMLElement));
    });
    document.addEventListener('keydown', this.onKeyDown);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') this.close('cancelled');
  };

  private onStampMouseDown(e: MouseEvent, el: HTMLElement): void {
    e.preventDefault();
    const stampId = el.dataset.stampId as MailDestination;
    this.draggedStamp = stampId ?? null;
    if (!this.draggedStamp) return;

    this.dragEl = el.cloneNode(true) as HTMLElement;
    this.dragEl.classList.add('stamp-dragging');
    this.dragEl.style.position = 'fixed';
    this.dragEl.style.pointerEvents = 'none';
    this.dragEl.style.zIndex = '10001';
    document.body.appendChild(this.dragEl);
    this.moveDragEl(e.clientX, e.clientY);

    const onMove = (ev: MouseEvent) => this.moveDragEl(ev.clientX, ev.clientY);
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      this.onStampDrop(ev);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  private moveDragEl(x: number, y: number): void {
    if (!this.dragEl) return;
    this.dragEl.style.left = `${x - 30}px`;
    this.dragEl.style.top = `${y - 30}px`;
  }

  private onStampDrop(e: MouseEvent): void {
    if (this.dragEl) {
      this.dragEl.remove();
      this.dragEl = null;
    }
    if (!this.draggedStamp) return;

    const dropZone = document.getElementById('stamp-drop-zone');
    if (!dropZone) return;
    const rect = dropZone.getBoundingClientRect();
    if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
      if (this.draggedStamp === this.envelope.requiredStamp) this.onCorrectStamp(this.draggedStamp);
      else this.onWrongStamp();
    }
    this.draggedStamp = null;
  }

  private onCorrectStamp(stamp: MailDestination): void {
    const feedback = this.overlay?.querySelector('#stamp-feedback') as HTMLElement;
    const dropZone = document.getElementById('stamp-drop-zone');
    const stampInfo = getMailDestination(stamp);
    if (feedback) {
      feedback.textContent = '✓ 貼票完成！';
      feedback.style.color = '#44ff44';
    }
    if (dropZone) {
      dropZone.style.borderColor = '#44ff44';
      dropZone.style.background = 'rgba(0,255,0,0.1)';
      dropZone.innerHTML = `<span class="stamp-icon">${stampInfo.icon}</span>`;
    }
    this.onApply(stamp);
    setTimeout(() => this.close('completed'), 800);
  }

  /** Wrong stamp — spec五: "不完成/不扣分/可移除或重新選擇", so this is purely
   * a visual shake, no score/state mutation of any kind. */
  private onWrongStamp(): void {
    const feedback = this.overlay?.querySelector('#stamp-feedback') as HTMLElement;
    const dropZone = document.getElementById('stamp-drop-zone');
    if (feedback) {
      feedback.textContent = '✗ 郵票與目的地不符，請重新選擇';
      feedback.style.color = '#ff4444';
    }
    if (dropZone) {
      dropZone.classList.add('shake');
      dropZone.style.borderColor = '#ff4444';
      setTimeout(() => {
        dropZone.classList.remove('shake');
        dropZone.style.borderColor = '';
      }, 500);
    }
    setTimeout(() => { if (feedback) feedback.textContent = ''; }, 2000);
  }

  private close(result: StampUiResult): void {
    document.removeEventListener('keydown', this.onKeyDown);
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    if (this.dragEl) { this.dragEl.remove(); this.dragEl = null; }
    this.onComplete(result);
  }
}
