// Full-screen "電視媒體播放器" UI ("Add television media playlist" round
// spec三, extended with a 內建音樂/網路媒體 tab split in "Add built-in BGM
// tab to television player" round). Display + input only — every actual
// state change goes through MediaPlayerSystem's own public methods, never
// touched directly here (mirrors UpgradeMenuUI/UpgradeSystem's own split
// exactly). All dynamic text is set via textContent/element.value, never
// interpolated into innerHTML (spec六: "所有文字顯示使用textContent，URL
// 不可當作HTML插入") — the only innerHTML use in this file is the fixed,
// static shell markup built once in the constructor, which never contains
// any player-supplied string (a built-in slot's own filePath is likewise
// NEVER rendered anywhere in this UI — spec三: "不要顯示檔案路徑給玩家").
import { PauseManager } from '../../core/pause-manager';
import { PlayerController } from '../player';
import { MediaPlayerSystem } from './media-player-system';
import { MEDIA_SLOT_COUNT, MediaTab, PlaybackMode, SlotMediaKind } from './media-player-types';

function kindLabel(kind: SlotMediaKind): string {
  switch (kind) {
    case 'youtube': return 'YouTube';
    case 'audio': return '音訊';
    case 'video': return '影片';
    default: return '';
  }
}

export class MediaPlayerUI {
  private pauseManager: PauseManager;
  private playerController: PlayerController;
  private mediaPlayerSystem: MediaPlayerSystem;

  private overlayEl: HTMLElement;
  private builtinPanelEl: HTMLElement;
  private urlPanelEl: HTMLElement;
  private builtinSlotsEl: HTMLElement;
  private urlSlotsEl: HTMLElement;
  private statusTextEl: HTMLElement;
  private errorEl: HTMLElement;
  private playPauseBtn: HTMLButtonElement;
  private volumeInput: HTMLInputElement;
  private videoEl: HTMLVideoElement;
  private youtubeContainerEl: HTMLElement;
  private _isOpen = false;

  constructor(pauseManager: PauseManager, playerController: PlayerController, mediaPlayerSystem: MediaPlayerSystem) {
    this.pauseManager = pauseManager;
    this.playerController = playerController;
    this.mediaPlayerSystem = mediaPlayerSystem;

    this.overlayEl = document.createElement('div');
    this.overlayEl.id = 'media-player-overlay';
    this.overlayEl.innerHTML = `
      <div class="media-player-backdrop"></div>
      <div class="media-player-panel">
        <button id="media-player-close-btn" aria-label="關閉媒體播放器">✕</button>
        <h2 class="media-player-title">電視媒體播放器</h2>
        <div class="media-player-tabs">
          <button class="mp-tab-btn" data-tab="builtin">內建音樂</button>
          <button class="mp-tab-btn" data-tab="url">網路媒體</button>
        </div>
        <div class="media-player-video-area">
          <video id="media-player-video" playsinline></video>
          <div id="media-player-youtube-container"></div>
        </div>
        <p class="media-player-status">狀態：<span id="media-player-status-text">尚未播放</span></p>
        <p class="media-player-error" id="media-player-error"></p>

        <div class="mp-tab-panel" id="mp-tab-panel-builtin">
          <div class="media-player-slots" id="mp-builtin-slots"></div>
          <div class="media-player-mode-row">
            <label><input type="radio" name="mp-builtin-mode" value="single"> 單曲循環</label>
            <label><input type="radio" name="mp-builtin-mode" value="playlist"> 清單循環</label>
          </div>
        </div>

        <div class="mp-tab-panel" id="mp-tab-panel-url">
          <div class="media-player-slots" id="mp-url-slots"></div>
          <div class="media-player-mode-row">
            <label><input type="radio" name="mp-url-mode" value="single"> 單曲循環</label>
            <label><input type="radio" name="mp-url-mode" value="playlist"> 清單循環</label>
          </div>
        </div>

        <div class="media-player-transport">
          <button id="mp-prev" aria-label="上一首">⏮ 上一首</button>
          <button id="mp-playpause" aria-label="播放／暫停">▶ 播放</button>
          <button id="mp-next" aria-label="下一首">⏭ 下一首</button>
          <label class="mp-volume-label">音量 <input type="range" id="mp-volume" min="0" max="1" step="0.01"></label>
        </div>
      </div>
    `;
    document.body.appendChild(this.overlayEl);

    this.builtinPanelEl = this.overlayEl.querySelector('#mp-tab-panel-builtin')!;
    this.urlPanelEl = this.overlayEl.querySelector('#mp-tab-panel-url')!;
    this.builtinSlotsEl = this.overlayEl.querySelector('#mp-builtin-slots')!;
    this.urlSlotsEl = this.overlayEl.querySelector('#mp-url-slots')!;
    this.statusTextEl = this.overlayEl.querySelector('#media-player-status-text')!;
    this.errorEl = this.overlayEl.querySelector('#media-player-error')!;
    this.playPauseBtn = this.overlayEl.querySelector('#mp-playpause')!;
    this.volumeInput = this.overlayEl.querySelector('#mp-volume')!;
    this.videoEl = this.overlayEl.querySelector('#media-player-video')!;
    this.youtubeContainerEl = this.overlayEl.querySelector('#media-player-youtube-container')!;

    this.mediaPlayerSystem.attachDom(this.videoEl, this.youtubeContainerEl);
    this.mediaPlayerSystem.setOnStateChange(() => this.render());

    this.overlayEl.querySelector('#media-player-close-btn')!.addEventListener('click', () => this.close());
    this.overlayEl.querySelector('.media-player-backdrop')!.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (e) => this.onKeyDown(e));

    // Tab switching is a pure view-state change (spec一: "切換Tab不可停止
    // 目前正在播放的內容") — never touches playback, just which panel/mode
    // controls are visible.
    this.overlayEl.querySelectorAll<HTMLButtonElement>('.mp-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.mediaPlayerSystem.setActiveTab(btn.dataset.tab as MediaTab);
        this.render();
      });
    });

    this.overlayEl.querySelectorAll<HTMLInputElement>('input[name="mp-builtin-mode"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) this.mediaPlayerSystem.setBuiltinMode(radio.value as PlaybackMode);
      });
    });
    this.overlayEl.querySelectorAll<HTMLInputElement>('input[name="mp-url-mode"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) this.mediaPlayerSystem.setMode(radio.value as PlaybackMode);
      });
    });

    // Shared transport — always visible regardless of which tab is being
    // viewed, and always acts on whichever source is actually loaded into
    // the player (MediaPlayerSystem's own currentSourceType), not
    // necessarily the currently-viewed tab.
    this.overlayEl.querySelector('#mp-prev')!.addEventListener('click', () => this.mediaPlayerSystem.previous());
    this.playPauseBtn.addEventListener('click', () => this.mediaPlayerSystem.togglePlayPause());
    this.overlayEl.querySelector('#mp-next')!.addEventListener('click', () => this.mediaPlayerSystem.next());
    this.volumeInput.addEventListener('input', () => this.mediaPlayerSystem.setVolume(Number(this.volumeInput.value)));

    this.render();
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  open(): void {
    if (this._isOpen) return;
    this._isOpen = true;
    this.pauseManager.add('mediaPlayerMenu');
    document.exitPointerLock();
    document.body.style.cursor = '';
    this.overlayEl.classList.add('open');
    this.render();
  }

  close(): void {
    if (!this._isOpen) return;
    this._isOpen = false;
    this.overlayEl.classList.remove('open');
    this.pauseManager.remove('mediaPlayerMenu');
    // Playback is intentionally untouched here — MediaPlayerSystem's own
    // video element / YouTube player live entirely outside this open/close
    // toggle (spec三: "關閉UI後...音樂或影片繼續播放，再次打開時保留目前播
    // 放進度"). Pointer lock re-acquires immediately, same deliberate
    // deviation from the manual/stamp-minigame convention that
    // UpgradeMenuUI's own close() already uses (this call is always the
    // direct result of a user gesture — ESC or a click — so the browser's
    // fresh-gesture rule is satisfied).
    this.playerController.requestLock();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this._isOpen) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  private render(): void {
    const activeTab = this.mediaPlayerSystem.getActiveTab();
    this.overlayEl.querySelectorAll<HTMLButtonElement>('.mp-tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === activeTab);
    });
    this.builtinPanelEl.classList.toggle('active', activeTab === 'builtin');
    this.urlPanelEl.classList.toggle('active', activeTab === 'url');

    this.renderBuiltinSlots();
    this.renderUrlSlots();

    const builtinMode = this.mediaPlayerSystem.getBuiltinMode();
    this.overlayEl.querySelectorAll<HTMLInputElement>('input[name="mp-builtin-mode"]').forEach((radio) => {
      radio.checked = radio.value === builtinMode;
    });
    const urlMode = this.mediaPlayerSystem.getMode();
    this.overlayEl.querySelectorAll<HTMLInputElement>('input[name="mp-url-mode"]').forEach((radio) => {
      radio.checked = radio.value === urlMode;
    });

    this.statusTextEl.textContent = this.mediaPlayerSystem.getStatusLine();
    this.playPauseBtn.textContent = this.mediaPlayerSystem.getStatus() === 'playing' ? '⏸ 暫停' : '▶ 播放';
    this.volumeInput.value = String(this.mediaPlayerSystem.getVolume());

    const err = this.mediaPlayerSystem.getLastError();
    this.errorEl.textContent = err ?? '';
    this.errorEl.style.display = err ? 'block' : 'none';
  }

  /** Every slot always renders (no filePath ever shown, spec三) — a slot
   * without a real file just shows "尚未加入音樂" with its own play button
   * disabled. */
  private renderBuiltinSlots(): void {
    this.builtinSlotsEl.textContent = '';
    const slots = this.mediaPlayerSystem.getBuiltinSlots();
    const currentId = this.mediaPlayerSystem.getCurrentBuiltinId();
    const status = this.mediaPlayerSystem.getStatus();
    const isActive = this.mediaPlayerSystem.getCurrentSourceType() === 'builtin' && (status === 'playing' || status === 'paused');

    slots.forEach((slot, i) => {
      const row = document.createElement('div');
      row.className = 'mp-slot-row';
      if (isActive && slot.id === currentId) row.classList.add('mp-slot-active');

      const indexLabel = document.createElement('span');
      indexLabel.className = 'mp-slot-index';
      indexLabel.textContent = `槽位 ${i + 1}`;
      row.appendChild(indexLabel);

      const nameLabel = document.createElement('span');
      nameLabel.className = 'mp-slot-name';
      nameLabel.textContent = slot.displayName;
      row.appendChild(nameLabel);

      const playBtn = document.createElement('button');
      playBtn.className = 'mp-slot-play-btn';
      playBtn.textContent = '播放';
      const hasFile = slot.enabled && !!slot.filePath;
      playBtn.disabled = !hasFile;
      playBtn.addEventListener('click', () => {
        void this.mediaPlayerSystem.playBuiltin(slot.id);
      });
      row.appendChild(playBtn);

      const statusEl = document.createElement('span');
      statusEl.className = 'mp-slot-status';
      if (hasFile) {
        statusEl.textContent = '可播放';
        statusEl.classList.add('mp-slot-status-valid');
      } else {
        statusEl.textContent = '尚未加入音樂';
      }
      row.appendChild(statusEl);

      this.builtinSlotsEl.appendChild(row);
    });
  }

  /** Rebuilds the 5 URL slot rows from scratch each render — every dynamic
   * piece of text/value is assigned via textContent/.value (never
   * interpolated into a template-string innerHTML), so a URL the player
   * typed can never be parsed as markup (spec六). */
  private renderUrlSlots(): void {
    this.urlSlotsEl.textContent = '';
    const slots = this.mediaPlayerSystem.getSlots();
    const currentIndex = this.mediaPlayerSystem.getCurrentSlotIndex();
    const status = this.mediaPlayerSystem.getStatus();
    const isActive = this.mediaPlayerSystem.getCurrentSourceType() === 'url' && (status === 'playing' || status === 'paused');

    for (let i = 0; i < MEDIA_SLOT_COUNT; i++) {
      const row = document.createElement('div');
      row.className = 'mp-slot-row';
      if (isActive && i === currentIndex) row.classList.add('mp-slot-active');

      const indexLabel = document.createElement('span');
      indexLabel.className = 'mp-slot-index';
      indexLabel.textContent = `槽位 ${i + 1}`;
      row.appendChild(indexLabel);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'mp-slot-input';
      input.placeholder = 'https://...';
      input.value = slots[i];
      input.addEventListener('change', () => {
        this.mediaPlayerSystem.setSlotUrl(i, input.value);
        this.render();
      });
      row.appendChild(input);

      const playBtn = document.createElement('button');
      playBtn.className = 'mp-slot-play-btn';
      playBtn.textContent = '播放此槽位';
      playBtn.addEventListener('click', () => {
        void this.mediaPlayerSystem.playSlot(i);
      });
      row.appendChild(playBtn);

      const clearBtn = document.createElement('button');
      clearBtn.className = 'mp-slot-clear-btn';
      clearBtn.textContent = '清除';
      clearBtn.addEventListener('click', () => {
        this.mediaPlayerSystem.clearSlot(i);
      });
      row.appendChild(clearBtn);

      const statusEl = document.createElement('span');
      statusEl.className = 'mp-slot-status';
      const validation = this.mediaPlayerSystem.getSlotValidation(i);
      if (!slots[i]) {
        statusEl.textContent = '空白';
      } else if (validation.valid) {
        statusEl.textContent = `有效（${kindLabel(validation.kind)}）`;
        statusEl.classList.add('mp-slot-status-valid');
      } else {
        statusEl.textContent = '格式錯誤';
        statusEl.classList.add('mp-slot-status-invalid');
      }
      row.appendChild(statusEl);

      this.urlSlotsEl.appendChild(row);
    }
  }
}
