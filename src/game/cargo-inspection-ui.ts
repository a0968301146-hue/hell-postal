import { CargoCategory, CARGO_CATEGORY_DISPLAY } from './cargo-category-data';

/**
 * Owns ONLY the DOM element for the floating "種類：一般/易碎品" label shown
 * above the crosshair (spec: build once, never rebuild per frame — the
 * element is created in the constructor, `show()`/`hide()` after that just
 * toggle a CSS display value and update text). Entirely independent of
 * hud.ts's own DOM tree — appended straight to document.body with its own
 * inline styles, so this feature has zero footprint inside hud.ts.
 */
export class CargoInspectionUI {
  private el: HTMLDivElement;
  private lastCategory: CargoCategory | null = null;

  constructor() {
    const el = document.createElement('div');
    el.id = 'cargo-inspection-ui';
    Object.assign(el.style, {
      position: 'fixed',
      top: '42%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      padding: '3px 12px',
      background: 'rgba(20, 20, 20, 0.72)',
      border: '1px solid rgba(255, 255, 255, 0.25)',
      borderRadius: '4px',
      color: '#ffffff',
      fontFamily: 'sans-serif',
      fontSize: '13px',
      textAlign: 'center',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      userSelect: 'none',
      textShadow: '0 0 4px rgba(0, 0, 0, 0.9)',
      zIndex: '100',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
    this.el = el;
  }

  show(category: CargoCategory): void {
    if (this.lastCategory !== category) {
      this.el.textContent = `種類：${CARGO_CATEGORY_DISPLAY[category]}`;
      this.lastCategory = category;
    }
    this.el.style.display = 'block';
  }

  hide(): void {
    this.el.style.display = 'none';
    this.lastCategory = null;
  }
}
