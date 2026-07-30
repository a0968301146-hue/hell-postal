/**
 * Owns ONLY the DOM element for the lost & found wrong-item hint ("Reduce
 * daily cargo and add lost found desk" round 三, still used by "Expand
 * modular lost found NPC flow" round 七: ID錯誤時顯示提示). Same "build once
 * in the constructor, show()/hide() just toggle display + text" pattern as
 * cargo-inspection-ui.ts — entirely independent of hud.ts's own DOM tree.
 * Success feedback moved to the NPC's own head bubble (lost-found-bubble-
 * ui.ts) as of the NPC-flow round — this module now only ever shows the
 * wrong-item message. */
export class LostFoundUI {
  private el: HTMLDivElement;
  private hideTimer: number | null = null;
  private statusEl: HTMLDivElement;

  constructor() {
    const el = document.createElement('div');
    el.id = 'lost-found-ui';
    Object.assign(el.style, {
      position: 'fixed',
      bottom: '18%',
      left: '50%',
      transform: 'translateX(-50%)',
      maxWidth: '480px',
      padding: '10px 18px',
      background: 'rgba(20, 20, 20, 0.82)',
      border: '1px solid rgba(255, 255, 255, 0.25)',
      borderRadius: '6px',
      color: '#ffffff',
      fontFamily: 'sans-serif',
      fontSize: '15px',
      textAlign: 'center',
      whiteSpace: 'pre-line',
      pointerEvents: 'none',
      userSelect: 'none',
      textShadow: '0 0 4px rgba(0, 0, 0, 0.9)',
      zIndex: '100',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
    this.el = el;

    // Persistent daily-queue status ("Add sequential lost-found visitors
    // and held cargo feedback" round一: "今日顧客：完成X／3"／"目前顧客：第X
    // 位") — a SEPARATE, non-auto-hiding element from the wrong-item toast
    // above, since this one stays up the whole day rather than flashing
    // briefly.
    const statusEl = document.createElement('div');
    statusEl.id = 'lost-found-status';
    Object.assign(statusEl.style, {
      position: 'fixed',
      top: '86px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '4px 16px',
      background: 'rgba(20, 20, 20, 0.6)',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      borderRadius: '6px',
      color: '#e8e0c8',
      fontFamily: 'sans-serif',
      fontSize: '13px',
      textAlign: 'center',
      lineHeight: '1.4',
      pointerEvents: 'none',
      userSelect: 'none',
      textShadow: '0 0 4px rgba(0, 0, 0, 0.9)',
      zIndex: '90',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(statusEl);
    this.statusEl = statusEl;
  }

  /** `currentPosition` is 1-based (第1位/第2位/第3位), null while no NPC is
   * currently entering/waiting/leaving (between visitors, or the whole
   * queue finished/not yet started). Hidden entirely once no case has been
   * prepared yet today (totalToday===0). */
  updateQueueStatus(completed: number, totalToday: number, currentPosition: number | null): void {
    if (totalToday === 0) {
      this.statusEl.style.display = 'none';
      return;
    }
    const currentLine = currentPosition !== null ? `<br>目前顧客：第 ${currentPosition} 位` : '';
    this.statusEl.innerHTML = `今日顧客：完成 ${completed}／${totalToday}${currentLine}`;
    this.statusEl.style.display = 'block';
  }

  hideQueueStatus(): void {
    this.statusEl.style.display = 'none';
  }

  /** Wrong-item hint — no score/fail implied by styling (spec: "不扣分、不失
   * 敗"), just a neutral warm color. */
  showWrong(text: string): void {
    this.setText(text, '#e0a05a');
  }

  hide(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.el.style.display = 'none';
  }

  private setText(text: string, color: string): void {
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    this.el.textContent = text;
    this.el.style.color = color;
    this.el.style.display = 'block';
    this.hideTimer = window.setTimeout(() => {
      this.el.style.display = 'none';
      this.hideTimer = null;
    }, 4500);
  }
}
