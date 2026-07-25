/**
 * Owns ONLY the DOM element for the lost & found dialogue/result box
 * ("Reduce daily cargo and add lost found desk" round 三/模組化: 描述與結果
 * 提示). Same "build once in the constructor, show()/hide() just toggle
 * display + text" pattern as cargo-inspection-ui.ts — entirely independent
 * of hud.ts's own DOM tree. Positioned lower on screen (rather than at the
 * crosshair like cargo-inspection-ui.ts) so it reads as dialogue rather
 * than a targeting readout.
 */
export class LostFoundUI {
  private el: HTMLDivElement;
  private hideTimer: number | null = null;

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
  }

  /** Customer's case description (spec三: 玩家按 E 互動後取得失物描述). */
  showDescription(customerName: string, text: string): void {
    this.setText(`${customerName}：\n${text}`, '#ffffff');
  }

  /** Case-complete confirmation. */
  showSuccess(text: string): void {
    this.setText(text, '#8fd88f');
  }

  /** Wrong-item hint — no score/fail implied by styling (spec三: "不扣分、不
   * 失敗"), just a neutral warm color distinct from the success green. */
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
