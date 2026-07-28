import {
  CargoCategory, CARGO_CATEGORY_DISPLAY, CargoRegion, CARGO_REGION_DISPLAY,
  CargoSizeClass, CARGO_SIZE_CLASS_DISPLAY,
} from '../cargo';

/**
 * Owns ONLY the DOM element for the floating "外型：...\n種類：一般/易碎品\n
 * 地區：國內/海外\n尺寸：小型/中型/大型" label shown above the crosshair
 * (spec: build once, never rebuild per frame — the element is created in the
 * constructor, `show()`/`hide()` after that just toggle a CSS display value
 * and update text). Entirely independent of hud.ts's own DOM tree —
 * appended straight to document.body with its own inline styles, so this
 * feature has zero footprint inside hud.ts. Every round that's extended this
 * line ("Fix land vehicle routes and add cargo region UI", "Organize and
 * expand cargo shape presets") reuses this SAME element/show()/hide() call
 * site rather than a second UI (spec: "沿用現有準心貨物檢視系統，不建立第二
 * 套...UI"／"不得建立第二套射線").
 */
export class CargoInspectionUI {
  private el: HTMLDivElement;
  private lastShapeName: string | null = null;
  private lastCategory: CargoCategory | null = null;
  private lastRegion: CargoRegion | null = null;
  private lastSizeClass: CargoSizeClass | null = null;

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

  /** `shapeName`/`sizeClass` are optional so this same call site still
   * works for anything that only ever set category/region (none currently
   * do, kept purely so a future non-shape-preset cargo source can't be
   * forced to fabricate a fake shape name just to call this). */
  show(category: CargoCategory, region: CargoRegion, shapeName: string | null, sizeClass: CargoSizeClass | null): void {
    if (
      this.lastShapeName !== shapeName || this.lastCategory !== category ||
      this.lastRegion !== region || this.lastSizeClass !== sizeClass
    ) {
      const lines = [
        shapeName ? `外型：${shapeName}` : null,
        `種類：${CARGO_CATEGORY_DISPLAY[category]}`,
        `地區：${CARGO_REGION_DISPLAY[region]}`,
        sizeClass ? `尺寸：${CARGO_SIZE_CLASS_DISPLAY[sizeClass]}` : null,
      ].filter((l): l is string => l !== null);
      this.el.textContent = lines.join('\n');
      this.lastShapeName = shapeName;
      this.lastCategory = category;
      this.lastRegion = region;
      this.lastSizeClass = sizeClass;
    }
    this.el.style.display = 'block';
  }

  hide(): void {
    this.el.style.display = 'none';
    this.lastShapeName = null;
    this.lastCategory = null;
    this.lastRegion = null;
    this.lastSizeClass = null;
  }
}
