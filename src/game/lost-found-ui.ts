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
