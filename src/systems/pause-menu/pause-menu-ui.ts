// 異世界物流手冊 v0.1 — a DOM+CSS "book" that doubles as pause menu, tutorial
// reference, settings, and codex (spec section 二). Deliberately NOT a 3D
// hand-held model — a full-screen overlay is enough for this round.
import { PauseManager } from '../../core/pause-manager';
import { SettingsManager, DisplayMode, ResolutionPreset, QualityPreset, SubtitleSize, TextSpeed } from '../settings';
import { HUD } from '../hud';
import { TUTORIAL_ENTRIES, TutorialEntry } from '../../game/tutorial-data';
import { buildVehicleCodexEntries, SPECIES_CODEX_ENTRIES } from '../../game/codex-data';
import {
  ACTION_ORDER, ACTION_LABELS, InputAction, UNWIRED_ACTIONS,
} from '../../adapters/browser-input/input-binding-manager';

type Bookmark = 'tutorial' | 'controls' | 'display' | 'audio' | 'text' | 'data' | 'codex';
type CodexTab = 'vehicle' | 'species';

const BOOKMARKS: { id: Bookmark; label: string }[] = [
  { id: 'tutorial', label: '教學' },
  { id: 'controls', label: '操作' },
  { id: 'display', label: '畫面' },
  { id: 'audio', label: '音效' },
  { id: 'text', label: '文字' },
  { id: 'data', label: '資料' },
  { id: 'codex', label: '圖鑑' },
];

export class ManualUI {
  private pauseManager: PauseManager;
  private settingsManager: SettingsManager;
  private hud: HUD;
  private interruptPlayerActions: () => void;

  private overlayEl: HTMLElement;
  private leftPageEl: HTMLElement;
  private rightPageEl: HTMLElement;
  private bookmarksEl: HTMLElement;

  private _isOpen = false;
  private bookmark: Bookmark = 'tutorial';
  private selectedTutorialId: string | null = null;
  private codexTab: CodexTab = 'vehicle';
  private selectedVehicleId: string | null = null;
  private selectedSpeciesId: string | null = null;
  private capturingFor: InputAction | null = null;
  private captureConflictMsg: string | null = null;
  private noticeMsg: string | null = null;

  constructor(pauseManager: PauseManager, settingsManager: SettingsManager, hud: HUD, interruptPlayerActions: () => void) {
    this.pauseManager = pauseManager;
    this.settingsManager = settingsManager;
    this.hud = hud;
    this.interruptPlayerActions = interruptPlayerActions;

    this.overlayEl = document.createElement('div');
    this.overlayEl.id = 'manual-overlay';
    this.overlayEl.innerHTML = `
      <div class="manual-backdrop"></div>
      <div class="manual-book">
        <button id="manual-close-btn" aria-label="關閉手冊">✕</button>
        <div class="manual-bookmarks"></div>
        <div class="manual-codex-tabs hidden">
          <button data-codex-tab="vehicle">載具</button>
          <button data-codex-tab="species">種族</button>
        </div>
        <div class="manual-pages">
          <div class="manual-page manual-page-left"></div>
          <div class="manual-spine"></div>
          <div class="manual-page manual-page-right"></div>
        </div>
      </div>
    `;
    document.body.appendChild(this.overlayEl);

    this.leftPageEl = this.overlayEl.querySelector('.manual-page-left')!;
    this.rightPageEl = this.overlayEl.querySelector('.manual-page-right')!;
    this.bookmarksEl = this.overlayEl.querySelector('.manual-bookmarks')!;

    for (const bm of BOOKMARKS) {
      const btn = document.createElement('button');
      btn.dataset.bookmark = bm.id;
      btn.textContent = bm.label;
      this.bookmarksEl.appendChild(btn);
    }

    this.overlayEl.querySelector('#manual-close-btn')!.addEventListener('click', () => this.close());
    this.overlayEl.addEventListener('click', (e) => this.onOverlayClick(e));
    this.overlayEl.addEventListener('input', (e) => this.onOverlayInput(e));
    this.overlayEl.querySelector('.manual-backdrop')!.addEventListener('click', () => this.close());

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  toggle(): void {
    if (this._isOpen) this.close(); else this.open();
  }

  open(): void {
    if (this._isOpen) return;
    // Spec section 三: never open over the stamp minigame or a settlement
    // panel — Tab is a no-op in either case (checked here too, defensively,
    // not just at the keydown call site).
    if (this.pauseManager.has('stampMinigame') || this.pauseManager.has('settlement')) return;

    this._isOpen = true;
    this.interruptPlayerActions();
    this.pauseManager.add('manual');
    document.exitPointerLock();
    this.overlayEl.classList.add('open');
    document.body.style.cursor = '';
    this.render();
  }

  close(): void {
    if (!this._isOpen) return;
    this._isOpen = false;
    this.capturingFor = null;
    this.captureConflictMsg = null;
    this.overlayEl.classList.remove('open');
    this.pauseManager.remove('manual');
    // Same convention as ending the stamp minigame / vehicle settlement:
    // input re-enables immediately, but pointer lock itself waits for the
    // player to click the canvas again (browsers require a fresh user
    // gesture per lock request; re-showing this prompt is the existing
    // pattern elsewhere in this game, not a new one invented for the manual).
    this.hud.showInstructions();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.code === 'Tab') {
      event.preventDefault(); // never let the browser steal focus, open or not
      if (this.pauseManager.has('stampMinigame') || this.pauseManager.has('settlement')) return;
      this.toggle();
      return;
    }

    if (!this._isOpen) return;

    if (this.capturingFor) {
      event.preventDefault();
      this.handleCaptureKey(event.code);
      return;
    }

    if (event.code === 'Escape') {
      event.preventDefault();
      this.handleEscape();
    }
  }

  private handleEscape(): void {
    // "在子頁面時返回上一層" — a selected detail (tutorial/codex entry)
    // counts as a sub-page; clear the selection before falling back to
    // closing the whole book from the main bookmark view.
    if (this.selectedTutorialId || this.selectedVehicleId || this.selectedSpeciesId) {
      this.selectedTutorialId = null;
      this.selectedVehicleId = null;
      this.selectedSpeciesId = null;
      this.render();
      return;
    }
    this.close();
  }

  private handleCaptureKey(code: string): void {
    const action = this.capturingFor!;
    if (code === 'Escape') {
      this.capturingFor = null;
      this.render();
      return;
    }
    const result = this.settingsManager.inputBindings.rebind(action, code);
    if (!result.ok) {
      this.captureConflictMsg = `此按鍵已用於「${ACTION_LABELS[result.conflictWith!]}」，請選擇其他按鍵`;
      this.capturingFor = null;
      this.render();
      return;
    }
    this.settingsManager.syncKeyBindings();
    this.capturingFor = null;
    this.captureConflictMsg = null;
    this.render();
  }

  // ---- delegated event handlers ----

  private onOverlayClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;

    const bookmarkBtn = target.closest<HTMLElement>('[data-bookmark]');
    if (bookmarkBtn) {
      this.bookmark = bookmarkBtn.dataset.bookmark as Bookmark;
      this.selectedTutorialId = null;
      this.selectedVehicleId = null;
      this.selectedSpeciesId = null;
      this.captureConflictMsg = null;
      this.noticeMsg = null;
      this.render();
      return;
    }

    const codexTabBtn = target.closest<HTMLElement>('[data-codex-tab]');
    if (codexTabBtn) {
      this.codexTab = codexTabBtn.dataset.codexTab as CodexTab;
      this.render();
      return;
    }

    const tutorialRow = target.closest<HTMLElement>('[data-tutorial-id]');
    if (tutorialRow) {
      this.selectedTutorialId = tutorialRow.dataset.tutorialId!;
      this.render();
      return;
    }

    const vehicleRow = target.closest<HTMLElement>('[data-vehicle-id]');
    if (vehicleRow) {
      this.selectedVehicleId = vehicleRow.dataset.vehicleId!;
      this.render();
      return;
    }

    const speciesRow = target.closest<HTMLElement>('[data-species-id]');
    if (speciesRow) {
      this.selectedSpeciesId = speciesRow.dataset.speciesId!;
      this.render();
      return;
    }

    const rebindBtn = target.closest<HTMLElement>('[data-rebind-action]');
    if (rebindBtn) {
      this.capturingFor = rebindBtn.dataset.rebindAction as InputAction;
      this.captureConflictMsg = null;
      this.render();
      return;
    }

    if (target.closest('[data-reset-bindings]')) {
      this.settingsManager.inputBindings.resetToDefaults();
      this.settingsManager.syncKeyBindings();
      this.captureConflictMsg = null;
      this.render();
      return;
    }

    const displayModeBtn = target.closest<HTMLElement>('[data-display-mode]');
    if (displayModeBtn) {
      const mode = displayModeBtn.dataset.displayMode as DisplayMode;
      this.settingsManager.setDisplayMode(mode).then((err) => {
        this.noticeMsg = err;
        this.render();
      });
      return;
    }

    const qualityBtn = target.closest<HTMLElement>('[data-quality]');
    if (qualityBtn) {
      this.settingsManager.setQuality(qualityBtn.dataset.quality as QualityPreset);
      this.render();
      return;
    }

    const subtitleBtn = target.closest<HTMLElement>('[data-subtitle-size]');
    if (subtitleBtn) {
      this.settingsManager.setSubtitleSize(subtitleBtn.dataset.subtitleSize as SubtitleSize);
      this.render();
      return;
    }

    const textSpeedBtn = target.closest<HTMLElement>('[data-text-speed]');
    if (textSpeedBtn) {
      this.settingsManager.setTextSpeed(textSpeedBtn.dataset.textSpeed as TextSpeed);
      this.render();
      return;
    }

    if (target.closest('[data-toggle-autosave]')) {
      this.settingsManager.setAutoSave(!this.settingsManager.settings.data.autoSave);
      this.render();
      return;
    }

    if (target.closest('[data-save-now]')) {
      this.settingsManager.save();
      this.noticeMsg = '已儲存目前的原型進度';
      this.render();
      return;
    }

    if (target.closest('[data-report-issue]') || target.closest('[data-privacy-policy]')) {
      this.noticeMsg = '尚未設定連結';
      this.render();
      return;
    }
  }

  private onOverlayInput(e: Event): void {
    const target = e.target as HTMLInputElement;
    if (target.dataset.mouseSensitivity !== undefined) {
      this.settingsManager.setMouseSensitivity(parseFloat(target.value));
      this.updateLiveValueLabel('mouse-sensitivity-value', target.value);
    } else if (target.dataset.invertY !== undefined) {
      this.settingsManager.setInvertY(target.checked);
    } else if (target.dataset.fov !== undefined) {
      this.settingsManager.setFov(parseFloat(target.value));
      this.updateLiveValueLabel('fov-value', target.value);
    } else if (target.dataset.brightness !== undefined) {
      this.settingsManager.setBrightness(parseFloat(target.value));
      this.updateLiveValueLabel('brightness-value', target.value);
    } else if (target.dataset.resolution !== undefined) {
      this.settingsManager.setResolution(target.value as ResolutionPreset);
    } else if (target.dataset.volume !== undefined) {
      const channel = target.dataset.volume as 'master' | 'sfx' | 'ambient' | 'music';
      this.settingsManager.setVolume(channel, parseFloat(target.value));
      this.updateLiveValueLabel(`volume-${channel}-value`, target.value);
    }
  }

  private updateLiveValueLabel(id: string, value: string): void {
    const el = this.overlayEl.querySelector(`#${id}`);
    if (el) el.textContent = value;
  }

  // ---- rendering ----

  private render(): void {
    this.bookmarksEl.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.bookmark === this.bookmark);
    });
    this.overlayEl.querySelector('.manual-codex-tabs')!.classList.toggle('hidden', this.bookmark !== 'codex');
    this.overlayEl.querySelectorAll('[data-codex-tab]').forEach((btn) => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.codexTab === this.codexTab);
    });

    switch (this.bookmark) {
      case 'tutorial': this.renderTutorial(); break;
      case 'controls': this.renderControls(); break;
      case 'display': this.renderDisplay(); break;
      case 'audio': this.renderAudio(); break;
      case 'text': this.renderText(); break;
      case 'data': this.renderData(); break;
      case 'codex': this.renderCodex(); break;
    }
  }

  private isTutorialUnlocked(entry: TutorialEntry): boolean {
    if (entry.forceLocked) return false;
    return this.settingsManager.isTutorialUnlocked(entry.id);
  }

  private renderTutorial(): void {
    const rows = TUTORIAL_ENTRIES.map((entry) => {
      const unlocked = this.isTutorialUnlocked(entry);
      const active = entry.id === this.selectedTutorialId ? 'active' : '';
      return `
        <div class="manual-list-row ${unlocked ? '' : 'locked'} ${active}" data-tutorial-id="${entry.id}">
          <span class="manual-list-icon">${unlocked ? '📖' : '❔'}</span>
          <span>${unlocked ? entry.title : '尚未解鎖'}</span>
        </div>`;
    }).join('');
    this.leftPageEl.innerHTML = `<h2 class="manual-page-title">教學目錄</h2><div class="manual-list">${rows}</div>`;

    const selected = TUTORIAL_ENTRIES.find((e) => e.id === this.selectedTutorialId) ?? TUTORIAL_ENTRIES.find((e) => this.isTutorialUnlocked(e));
    if (!selected) {
      this.rightPageEl.innerHTML = `<div class="manual-placeholder"><div class="manual-placeholder-icon">❔</div><p>尚未解鎖任何教學項目</p><p class="manual-hint">在遊戲中實際操作即可解鎖</p></div>`;
      return;
    }
    const unlocked = this.isTutorialUnlocked(selected);
    this.rightPageEl.innerHTML = unlocked
      ? `<h2 class="manual-page-title">${selected.title}</h2><p class="manual-body-text">${selected.body}</p>`
      : `<div class="manual-placeholder"><div class="manual-placeholder-icon">❔</div><p>尚未解鎖</p></div>`;
  }

  private renderControls(): void {
    const m = this.settingsManager.settings.mouse;
    this.leftPageEl.innerHTML = `
      <h2 class="manual-page-title">操作設定</h2>
      <p class="manual-body-text">調整滑鼠與按鍵操作。變更會立即套用。</p>
      <div class="manual-field">
        <label>滑鼠靈敏度</label>
        <input type="range" min="0.2" max="3" step="0.1" value="${m.sensitivity}" data-mouse-sensitivity>
        <span id="mouse-sensitivity-value" class="manual-value">${m.sensitivity}</span>
      </div>
      <div class="manual-field manual-field-row">
        <label>垂直視角反轉</label>
        <input type="checkbox" ${m.invertY ? 'checked' : ''} data-invert-y>
      </div>
      ${this.captureConflictMsg ? `<p class="manual-notice manual-notice-warn">${this.captureConflictMsg}</p>` : ''}
    `;

    const bindings = this.settingsManager.inputBindings;
    const rows = ACTION_ORDER.map((action) => {
      const isCapturing = this.capturingFor === action;
      const keyLabel = isCapturing ? '請按下新的按鍵' : bindings.getLabel(action);
      const unwired = UNWIRED_ACTIONS.has(action) ? '<span class="manual-tag">尚未接線</span>' : '';
      return `
        <div class="manual-key-row ${isCapturing ? 'capturing' : ''}">
          <span class="manual-key-label">${ACTION_LABELS[action]} ${unwired}</span>
          <button class="manual-key-btn" data-rebind-action="${action}">${keyLabel}</button>
        </div>`;
    }).join('');

    this.rightPageEl.innerHTML = `
      <h3 class="manual-subheading">按鍵設定</h3>
      <div class="manual-key-list">${rows}</div>
      <button class="manual-btn" data-reset-bindings>恢復預設按鍵</button>
    `;
  }

  private renderDisplay(): void {
    const d = this.settingsManager.settings.display;
    this.leftPageEl.innerHTML = `
      <h2 class="manual-page-title">畫面設定</h2>
      <p class="manual-body-text">解析度為固定輸出選項（瀏覽器原型無法強制改變視窗尺寸，畫布仍會以 CSS 縮放至目前視窗）。</p>
      <div class="manual-field">
        <label>顯示模式</label>
        <div class="manual-btn-group">
          <button class="manual-btn ${d.displayMode === 'windowed' ? 'active' : ''}" data-display-mode="windowed">視窗化</button>
          <button class="manual-btn ${d.displayMode === 'fullscreen' ? 'active' : ''}" data-display-mode="fullscreen">全螢幕</button>
        </div>
      </div>
      <div class="manual-field">
        <label>解析度</label>
        <select data-resolution>
          <option value="native" ${d.resolution === 'native' ? 'selected' : ''}>原生（跟隨視窗）</option>
          <option value="1920x1080" ${d.resolution === '1920x1080' ? 'selected' : ''}>1920 × 1080</option>
          <option value="1280x720" ${d.resolution === '1280x720' ? 'selected' : ''}>1280 × 720</option>
        </select>
      </div>
      ${this.noticeMsg ? `<p class="manual-notice">${this.noticeMsg}</p>` : ''}
    `;

    this.rightPageEl.innerHTML = `
      <div class="manual-field">
        <label>畫質</label>
        <div class="manual-btn-group">
          <button class="manual-btn ${d.quality === 'low' ? 'active' : ''}" data-quality="low">低</button>
          <button class="manual-btn ${d.quality === 'medium' ? 'active' : ''}" data-quality="medium">中</button>
          <button class="manual-btn ${d.quality === 'high' ? 'active' : ''}" data-quality="high">高</button>
        </div>
      </div>
      <div class="manual-field">
        <label>畫面亮度</label>
        <input type="range" min="0" max="100" step="1" value="${d.brightness}" data-brightness>
        <span id="brightness-value" class="manual-value">${d.brightness}</span>
      </div>
      <div class="manual-field">
        <label>FOV（視野角度）</label>
        <input type="range" min="60" max="100" step="1" value="${d.fov}" data-fov>
        <span id="fov-value" class="manual-value">${d.fov}</span>
      </div>
    `;
  }

  private renderAudio(): void {
    const a = this.settingsManager.settings.audio;
    const slider = (label: string, channel: 'master' | 'sfx' | 'ambient' | 'music') => `
      <div class="manual-field">
        <label>${label}</label>
        <input type="range" min="0" max="100" step="1" value="${a[channel]}" data-volume="${channel}">
        <span id="volume-${channel}-value" class="manual-value">${a[channel]}</span>
      </div>`;
    this.leftPageEl.innerHTML = `
      <h2 class="manual-page-title">音效設定</h2>
      <p class="manual-body-text">目前原型尚未實作完整音效系統，數值會保存供未來的音效系統直接讀取。</p>
      ${slider('主音量', 'master')}
      ${slider('特效音', 'sfx')}
    `;
    this.rightPageEl.innerHTML = `${slider('環境音', 'ambient')}${slider('音樂', 'music')}`;
  }

  private renderText(): void {
    const t = this.settingsManager.settings.text;
    const sizes: { id: SubtitleSize; label: string }[] = [{ id: 'small', label: '小' }, { id: 'medium', label: '中' }, { id: 'large', label: '大' }];
    const speeds: { id: TextSpeed; label: string }[] = [{ id: 'slow', label: '慢' }, { id: 'standard', label: '標準' }, { id: 'fast', label: '快' }, { id: 'instant', label: '立即顯示' }];
    this.leftPageEl.innerHTML = `
      <h2 class="manual-page-title">文字設定</h2>
      <div class="manual-field">
        <label>字幕大小</label>
        <div class="manual-btn-group">
          ${sizes.map((s) => `<button class="manual-btn ${t.subtitleSize === s.id ? 'active' : ''}" data-subtitle-size="${s.id}">${s.label}</button>`).join('')}
        </div>
      </div>
    `;
    this.rightPageEl.innerHTML = `
      <div class="manual-field">
        <label>文字顯示速度</label>
        <div class="manual-btn-group">
          ${speeds.map((s) => `<button class="manual-btn ${t.textSpeed === s.id ? 'active' : ''}" data-text-speed="${s.id}">${s.label}</button>`).join('')}
        </div>
      </div>
      <p class="manual-hint">顧客對話尚未製作完整文字系統，此設定將供未來使用。字幕大小已套用於手冊與系統提示文字。</p>
    `;
  }

  private renderData(): void {
    const d = this.settingsManager.settings.data;
    this.leftPageEl.innerHTML = `
      <h2 class="manual-page-title">資料設定</h2>
      <div class="manual-data-row"><span>語言</span><span>繁體中文</span></div>
      <div class="manual-data-row">
        <span>自動儲存</span>
        <button class="manual-btn" data-toggle-autosave>${d.autoSave ? '開啟' : '關閉'}</button>
      </div>
      <div class="manual-data-row"><span>遊戲版本</span><span>v0.1.0</span></div>
    `;
    this.rightPageEl.innerHTML = `
      <div class="manual-data-row"><span>儲存遊戲</span><button class="manual-btn" data-save-now>立即儲存</button></div>
      <div class="manual-data-row"><span>回報問題</span><button class="manual-btn" data-report-issue>前往回報</button></div>
      <div class="manual-data-row"><span>隱私政策</span><button class="manual-btn" data-privacy-policy>查看</button></div>
      ${this.noticeMsg ? `<p class="manual-notice">${this.noticeMsg}</p>` : ''}
    `;
  }

  private renderCodex(): void {
    if (this.codexTab === 'vehicle') { this.renderVehicleCodex(); return; }
    this.renderSpeciesCodex();
  }

  /** Rebuilds the vehicle codex list from VehicleConfig fresh on every
   * render ("Fix vehicle codex cargo list rendering" round) — rather than
   * a snapshot cached once in the constructor, so there is no cached
   * object for a hot-reload/long-lived-tab edge case to ever leave stale.
   * VehicleConfig is immutable static data, so this costs nothing
   * meaningful (six small objects) and always reflects whatever
   * vehicle-data.ts currently exports. */
  private renderVehicleCodex(): void {
    const vehicleCodex = buildVehicleCodexEntries();
    const rows = vehicleCodex.map((v) => {
      const discovered = this.settingsManager.isVehicleDiscovered(v.id);
      const active = v.id === this.selectedVehicleId ? 'active' : '';
      return `
        <div class="manual-list-row ${discovered ? '' : 'locked'} ${active}" data-vehicle-id="${v.id}">
          <span class="manual-list-icon">${discovered ? '🚚' : '❔'}</span>
          <span>${discovered ? v.displayName : '尚未發現'}</span>
        </div>`;
    }).join('');
    this.leftPageEl.innerHTML = `<h2 class="manual-page-title">已發現載具</h2><div class="manual-list">${rows}</div>`;

    const selected = vehicleCodex.find((v) => v.id === this.selectedVehicleId && this.settingsManager.isVehicleDiscovered(v.id))
      ?? vehicleCodex.find((v) => this.settingsManager.isVehicleDiscovered(v.id));
    if (!selected) {
      this.rightPageEl.innerHTML = `<div class="manual-placeholder"><div class="manual-placeholder-icon">❔</div><p>尚未發現任何載具</p><p class="manual-hint">在大廳按下呼叫載具即可發現</p></div>`;
      return;
    }
    this.rightPageEl.innerHTML = `
      <h2 class="manual-page-title">${selected.displayName}</h2>
      <div class="manual-vehicle-preview">${selected.transportLabel === '海運' ? '⛵' : '🚚'}</div>
      <div class="manual-data-row"><span>運輸方式</span><span>${selected.transportLabel}</span></div>
      <div class="manual-data-row"><span>可受理路線</span><span>${selected.acceptedRegionLabels.join('、')}</span></div>
      <div class="manual-data-row"><span>可受理貨物</span><span>${selected.acceptedCargoLabels.join('、')}</span></div>
      <div class="manual-data-row"><span>可運送信件</span><span>${selected.mailCapabilityLabel}</span></div>
      <div class="manual-data-row"><span>大致裝載空間</span><span>${selected.cargoArea.width.toFixed(1)} × ${selected.cargoArea.length.toFixed(1)} × ${selected.cargoArea.height.toFixed(1)} m</span></div>
      <div class="manual-data-row"><span>特性</span><span>${selected.traits}</span></div>
      <p class="manual-body-text">${selected.description}</p>
    `;
  }

  private renderSpeciesCodex(): void {
    const rows = SPECIES_CODEX_ENTRIES.map((s) => {
      const active = s.id === this.selectedSpeciesId ? 'active' : '';
      // All five are undiscovered this round — see codex-data.ts doc comment.
      return `
        <div class="manual-list-row locked ${active}" data-species-id="${s.id}">
          <span class="manual-list-icon">❔</span>
          <span>尚未發現</span>
        </div>`;
    }).join('');
    this.leftPageEl.innerHTML = `<h2 class="manual-page-title">顧客種族</h2><div class="manual-list">${rows}</div>`;
    this.rightPageEl.innerHTML = `<div class="manual-placeholder"><div class="manual-placeholder-icon">❔</div><p>尚未發現</p><p class="manual-hint">顧客種族系統尚未實作</p></div>`;
  }
}
