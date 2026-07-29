import * as THREE from 'three';
import { LocalStorageAdapter } from '../../adapters/local-storage/local-storage-adapter';
import { updateFloatingLabel } from '../../adapters/three/world-label-system';
import {
  MediaPlayerSaveState, MEDIA_SLOT_COUNT, MediaSourceType, MediaTab, PlaybackMode, PlaybackStatus, SlotValidation,
  BuiltinBgmSlot,
} from './media-player-types';
import { MEDIA_PLAYER_STORAGE_KEY, classifySlotUrl, createDefaultMediaPlayerSaveState, mergeMediaPlayerSaveState } from './media-player-data';
import { BUILTIN_BGM_SLOTS } from './builtin-bgm-data';

// Minimal ambient shape for the parts of the YouTube IFrame Player API this
// file actually calls — the real global is untyped (loaded via a plain
// <script> tag, no @types package), so this is just enough surface to keep
// TypeScript honest without pulling in a dependency for one script tag.
interface YouTubePlayerLike {
  loadVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  setVolume(volume0to100: number): void;
  getPlayerState(): number;
}
interface YouTubeApi {
  Player: new (
    el: HTMLElement,
    opts: { height: string; width: string; videoId: string; playerVars: Record<string, number>; events: Record<string, (e: { data: number }) => void> }
  ) => YouTubePlayerLike;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
}
declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youTubeApiPromise: Promise<YouTubeApi> | null = null;

/** Loads the YouTube IFrame Player API script exactly once per page load
 * (spec四: "YouTube使用單一IFrame Player API播放器") — races against a
 * generous timeout so a network hiccup can't hang a playSlot() call
 * forever, and resets the cached promise on failure so a later attempt can
 * retry rather than being permanently stuck on one bad load. */
function loadYouTubeApi(): Promise<YouTubeApi> {
  if (youTubeApiPromise) return youTubeApiPromise;

  const loadPromise = new Promise<YouTubeApi>((resolve, reject) => {
    if (window.YT?.Player) { resolve(window.YT); return; }
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevCallback?.();
      if (window.YT) resolve(window.YT);
      else reject(new Error('YouTube API failed to initialize'));
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => reject(new Error('Failed to load YouTube IFrame API script'));
    document.head.appendChild(script);
  });

  const timeoutPromise = new Promise<YouTubeApi>((_, reject) => {
    setTimeout(() => reject(new Error('YouTube API load timed out')), 10000);
  });

  youTubeApiPromise = Promise.race([loadPromise, timeoutPromise]).catch((err) => {
    youTubeApiPromise = null;
    throw err;
  });
  return youTubeApiPromise;
}

/**
 * Owns the television's playback state (5 URL slots, mode, volume, current
 * slot/status), its localStorage persistence, and the two actual player
 * instances (a single shared `<video>` HTMLMediaElement for direct
 * audio/video, and a single shared YouTube IFrame Player) — never a second
 * player per slot (spec四: "切換槽位時先安全停止上一個播放器"). Completely
 * decoupled from MediaPlayerUI: the UI only ever calls this class's public
 * methods and reads its public getters, mirroring UpgradeSystem/
 * UpgradeMenuUI's own split (spec: "UI不得直接修改玩家資料"). Also
 * decoupled from open/close of the UI panel itself — playback is never
 * paused/resumed by opening or closing the overlay (spec三: "關閉UI後...音
 * 樂或影片繼續播放"), only PauseManager/pointer-lock are touched there, both
 * owned by MediaPlayerUI instead.
 */
export class MediaPlayerSystem {
  private storage = new LocalStorageAdapter();
  private state: MediaPlayerSaveState;
  private label: THREE.Sprite;
  private screenMaterial: THREE.MeshStandardMaterial;

  private currentSlotIndex: number;
  /** "Add built-in BGM tab to television player" round: which of the two
   * separate playlists (URL slots vs. built-in BGM slots) is currently
   * loaded into the shared player — independent of `state.activeTab` (the
   * UI's own currently-VIEWED tab, see MediaTab's own doc comment). Only
   * ever changes inside playSlot()/playBuiltin(). */
  private currentSourceType: MediaSourceType = 'url';
  private currentBuiltinId: string;
  private status: PlaybackStatus = 'stopped';
  private lastError: string | null = null;

  private videoEl: HTMLVideoElement | null = null;
  private youtubeContainerEl: HTMLElement | null = null;
  private ytPlayer: YouTubePlayerLike | null = null;

  private onStateChangeCb: (() => void) | null = null;

  constructor(televisionLabel: THREE.Sprite, televisionScreenMaterial: THREE.MeshStandardMaterial) {
    this.label = televisionLabel;
    this.screenMaterial = televisionScreenMaterial;
    this.state = mergeMediaPlayerSaveState(this.storage.getJSON<MediaPlayerSaveState>(MEDIA_PLAYER_STORAGE_KEY));
    this.currentSlotIndex = this.state.lastSlotIndex;
    this.currentBuiltinId = this.state.lastBuiltinBgmId;
    // Deliberately never calls playSlot()/play() here (spec六: "不可進入遊
    // 戲或讀檔後自動播放" / spec七: "重新整理後...不自動開始播放") — only
    // loads the saved slots/mode/volume/lastSlotIndex into memory, status
    // stays 'stopped' until an explicit user click.
    this.refreshWorldLabel();
  }

  /** Called once by MediaPlayerUI right after it builds its own DOM (mirrors
   * PickupSystem.setMailBoxHooks' own after-construction wiring pattern) —
   * this class never builds DOM itself. */
  attachDom(videoEl: HTMLVideoElement, youtubeContainerEl: HTMLElement): void {
    this.videoEl = videoEl;
    this.youtubeContainerEl = youtubeContainerEl;
    videoEl.volume = this.state.volume;
    videoEl.addEventListener('ended', () => this.onMediaEnded());
    videoEl.addEventListener('error', () => this.onMediaError());
  }

  setOnStateChange(cb: () => void): void {
    this.onStateChangeCb = cb;
  }

  // --- Getters (read-only surface for MediaPlayerUI) ---

  getSlots(): readonly string[] {
    return this.state.slots;
  }

  getMode(): PlaybackMode {
    return this.state.mode;
  }

  getVolume(): number {
    return this.state.volume;
  }

  getCurrentSlotIndex(): number {
    return this.currentSlotIndex;
  }

  getStatus(): PlaybackStatus {
    return this.status;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getSlotValidation(index: number): SlotValidation {
    return classifySlotUrl(this.state.slots[index] ?? '');
  }

  getActiveTab(): MediaTab {
    return this.state.activeTab;
  }

  getBuiltinSlots(): readonly BuiltinBgmSlot[] {
    return BUILTIN_BGM_SLOTS;
  }

  getBuiltinMode(): PlaybackMode {
    return this.state.builtinPlaybackMode;
  }

  getCurrentSourceType(): MediaSourceType {
    return this.currentSourceType;
  }

  getCurrentBuiltinId(): string {
    return this.currentBuiltinId;
  }

  /** Shared by both the TV's own world label and MediaPlayerUI's status line
   * (public so neither ever has to re-derive/duplicate this text itself). */
  getStatusLine(): string {
    switch (this.status) {
      case 'playing':
        return this.currentSourceType === 'builtin'
          ? `播放中：${this.builtinDisplayName(this.currentBuiltinId)}`
          : `播放中：網路媒體 槽位 ${this.currentSlotIndex + 1}`;
      case 'paused': return '已暫停';
      case 'error': return '播放失敗';
      default: return '尚未播放';
    }
  }

  // --- Mutating API ---

  /** Pure UI-view state — never touches playback (spec一: "切換Tab不可停止
   * 目前正在播放的內容"). */
  setActiveTab(tab: MediaTab): void {
    this.state.activeTab = tab;
    this.save();
    this.notify();
  }

  setSlotUrl(index: number, url: string): void {
    if (index < 0 || index >= MEDIA_SLOT_COUNT) return;
    this.state.slots[index] = url.trim();
    this.save();
    this.notify();
  }

  clearSlot(index: number): void {
    if (index < 0 || index >= MEDIA_SLOT_COUNT) return;
    this.state.slots[index] = '';
    if (this.currentSlotIndex === index && this.status !== 'stopped') {
      this.stopActivePlayback();
      this.setStatus('stopped');
    }
    this.save();
    this.notify();
  }

  setMode(mode: PlaybackMode): void {
    this.state.mode = mode;
    this.save();
    this.notify();
  }

  setBuiltinMode(mode: PlaybackMode): void {
    this.state.builtinPlaybackMode = mode;
    this.save();
    this.notify();
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.state.volume = clamped;
    if (this.videoEl) this.videoEl.volume = clamped;
    if (this.ytPlayer) {
      try { this.ytPlayer.setVolume(clamped * 100); } catch { /* player not fully ready yet */ }
    }
    this.save();
    this.notify();
  }

  /** Explicit, player-initiated playback of one specific URL slot (spec六:
   * "必須由玩家點擊播放按鈕後才開始") — also the SAME method auto-advance
   * (onMediaEnded) and auto-retry (onMediaError) call, since by that point
   * the browser already granted this tab an active media session from the
   * player's own earlier direct click. Always sets currentSourceType to
   * 'url' first (spec四) — the sibling playBuiltin() below is the ONLY
   * other place that ever changes it, so the two playlists can never bleed
   * into each other mid-playback. */
  async playSlot(index: number): Promise<void> {
    if (index < 0 || index >= MEDIA_SLOT_COUNT) return;
    const validation = classifySlotUrl(this.state.slots[index]);
    if (!validation.valid) {
      this.lastError = '此槽位網址無效或為空';
      this.currentSourceType = 'url';
      this.currentSlotIndex = index;
      this.setStatus('error');
      this.notify();
      return;
    }

    this.stopActivePlayback();
    this.currentSourceType = 'url';
    this.currentSlotIndex = index;
    this.state.lastSlotIndex = index;
    this.lastError = null;
    this.save();

    try {
      if (validation.kind === 'youtube' && validation.youtubeId) {
        await this.playYouTube(validation.youtubeId);
      } else {
        await this.playDirectMedia(this.state.slots[index]);
      }
      this.setStatus('playing');
    } catch {
      this.onMediaError();
    }
    this.notify();
  }

  /** Explicit, player-initiated playback of one built-in BGM slot ("Add
   * built-in BGM tab to television player" round spec三/四) — mirrors
   * playSlot() above exactly, just reading `filePath`/`enabled` from
   * BUILTIN_BGM_SLOTS instead of a URL slot, and always through the SAME
   * shared `<video>` element (spec四: "不要建立第二套播放器" — a built-in
   * BGM slot is never YouTube, so there's no ytPlayer branch here at all). */
  async playBuiltin(id: string): Promise<void> {
    const slot = BUILTIN_BGM_SLOTS.find((s) => s.id === id);
    if (!slot || !slot.enabled || !slot.filePath) {
      this.lastError = '此音樂尚未加入';
      this.currentSourceType = 'builtin';
      this.currentBuiltinId = id;
      this.setStatus('error');
      this.notify();
      return;
    }

    this.stopActivePlayback();
    this.currentSourceType = 'builtin';
    this.currentBuiltinId = id;
    this.state.lastBuiltinBgmId = id;
    this.lastError = null;
    this.save();

    try {
      await this.playDirectMedia(slot.filePath);
      this.setStatus('playing');
    } catch {
      this.onMediaError();
    }
    this.notify();
  }

  togglePlayPause(): void {
    if (this.status === 'stopped' || this.status === 'error') {
      if (this.currentSourceType === 'builtin') void this.playBuiltin(this.currentBuiltinId);
      else void this.playSlot(this.currentSlotIndex);
      return;
    }
    const isYoutube = this.currentSourceType === 'url' && classifySlotUrl(this.state.slots[this.currentSlotIndex]).kind === 'youtube';
    if (isYoutube) {
      if (!this.ytPlayer) return;
      if (this.status === 'playing') { this.ytPlayer.pauseVideo(); this.setStatus('paused'); }
      else { this.ytPlayer.playVideo(); this.setStatus('playing'); }
    } else {
      if (!this.videoEl) return;
      if (this.status === 'playing') {
        this.videoEl.pause();
        this.setStatus('paused');
      } else {
        this.videoEl.play().then(() => this.setStatus('playing')).catch(() => this.onMediaError());
      }
    }
    this.notify();
  }

  /** Skips empty/invalid slots (spec五: "上一首與下一首同樣跳過空槽位") —
   * source-aware: walks whichever playlist (URL or built-in) is currently
   * loaded, never the other one (spec四). */
  next(): void {
    if (this.currentSourceType === 'builtin') {
      const id = this.nextValidBuiltinId(this.currentBuiltinId, 1);
      if (id !== null) void this.playBuiltin(id);
      else this.reportNoBuiltinBgm();
    } else {
      const idx = this.nextValidIndex(this.currentSlotIndex, 1);
      if (idx !== null) void this.playSlot(idx);
    }
  }

  previous(): void {
    if (this.currentSourceType === 'builtin') {
      const id = this.nextValidBuiltinId(this.currentBuiltinId, -1);
      if (id !== null) void this.playBuiltin(id);
      else this.reportNoBuiltinBgm();
    } else {
      const idx = this.nextValidIndex(this.currentSlotIndex, -1);
      if (idx !== null) void this.playSlot(idx);
    }
  }

  /** spec四: "沒有任何有效槽位時顯示「尚無內建音樂」" — surfaced via the
   * same lastError slot the UI's own error line already reads, rather than
   * a new dedicated field, since it's the same "tell the player why nothing
   * happened" concern onMediaError already owns. */
  private reportNoBuiltinBgm(): void {
    this.lastError = '尚無內建音樂';
    this.notify();
  }

  // --- Internals ---

  private async playYouTube(videoId: string): Promise<void> {
    if (this.videoEl) this.videoEl.style.display = 'none';
    if (this.youtubeContainerEl) this.youtubeContainerEl.style.display = '';
    const player = await this.ensureYouTubePlayer();
    player.loadVideoById(videoId);
    player.setVolume(this.state.volume * 100);
    player.playVideo();
  }

  private async playDirectMedia(url: string): Promise<void> {
    if (!this.videoEl) throw new Error('video element not attached');
    if (this.youtubeContainerEl) this.youtubeContainerEl.style.display = 'none';
    this.videoEl.style.display = '';
    this.videoEl.src = url;
    this.videoEl.volume = this.state.volume;
    await this.videoEl.play();
  }

  /** Guards against `onReady` simply never firing (observed in at least one
   * headless/no-GPU environment during development — the IFrame API script
   * loads fine but the embedded player never initializes) — without this,
   * playSlot() would hang forever instead of surfacing an error (spec六:
   * "播放失敗時顯示錯誤，不可讓遊戲崩潰" — a permanent hang is just as bad
   * as a crash from the player's own perspective). A late `onReady` after
   * the timeout is a harmless no-op: it still assigns `this.ytPlayer`, but
   * by then playSlot() has already moved on via onMediaError(). */
  private ensureYouTubePlayer(): Promise<YouTubePlayerLike> {
    if (this.ytPlayer) return Promise.resolve(this.ytPlayer);
    if (!this.youtubeContainerEl) return Promise.reject(new Error('youtube container not attached'));
    const readyPromise = loadYouTubeApi().then(
      (YT) =>
        new Promise<YouTubePlayerLike>((resolve) => {
          const player = new YT.Player(this.youtubeContainerEl!, {
            height: '270',
            width: '480',
            videoId: '',
            playerVars: { autoplay: 0, controls: 1, rel: 0 },
            events: {
              onReady: () => { this.ytPlayer = player; resolve(player); },
              onStateChange: (e) => this.onYouTubeStateChange(e.data, YT),
              onError: () => this.onMediaError(),
            },
          });
        })
    );
    const timeoutPromise = new Promise<YouTubePlayerLike>((_, reject) => {
      setTimeout(() => reject(new Error('YouTube player failed to become ready')), 12000);
    });
    return Promise.race([readyPromise, timeoutPromise]);
  }

  private onYouTubeStateChange(data: number, YT: YouTubeApi): void {
    if (data === YT.PlayerState.ENDED) this.onMediaEnded();
    else if (data === YT.PlayerState.PLAYING) { this.setStatus('playing'); this.notify(); }
    else if (data === YT.PlayerState.PAUSED) { this.setStatus('paused'); this.notify(); }
  }

  private stopActivePlayback(): void {
    if (this.videoEl) this.videoEl.pause();
    if (this.ytPlayer) {
      try { this.ytPlayer.stopVideo(); } catch { /* not ready yet */ }
    }
  }

  /** Loop-back-to-start / skip-invalid logic shared by next()/previous() and
   * the playlist-mode branch of onMediaEnded (spec五: "槽位5播完後回到槽位
   * 1"/"若只有一個有效槽位，就循環該槽位" — walking all MEDIA_SLOT_COUNT
   * steps including back to `from` itself naturally covers the
   * single-valid-slot case too). Returns null only if NO slot is valid. */
  private nextValidIndex(from: number, direction: 1 | -1): number | null {
    for (let step = 1; step <= MEDIA_SLOT_COUNT; step++) {
      const idx = ((from + direction * step) % MEDIA_SLOT_COUNT + MEDIA_SLOT_COUNT) % MEDIA_SLOT_COUNT;
      if (classifySlotUrl(this.state.slots[idx]).valid) return idx;
    }
    return null;
  }

  /** Same loop-back-to-start / skip-invalid shape as nextValidIndex above,
   * just walking BUILTIN_BGM_SLOTS by id instead of the URL slots array
   * (spec四: "跳過disabled或filePath為空的槽位"/"最後一首播放完後回到第一
   * 個有效槽位"). Returns null only if NO built-in slot is enabled+has a
   * filePath (spec四: "沒有任何有效槽位時顯示「尚無內建音樂」" — surfaced by
   * the caller via onMediaEnded's own else-branch below). */
  private nextValidBuiltinId(fromId: string, direction: 1 | -1): string | null {
    const count = BUILTIN_BGM_SLOTS.length;
    const fromIdx = Math.max(0, BUILTIN_BGM_SLOTS.findIndex((s) => s.id === fromId));
    for (let step = 1; step <= count; step++) {
      const idx = ((fromIdx + direction * step) % count + count) % count;
      const slot = BUILTIN_BGM_SLOTS[idx];
      if (slot.enabled && slot.filePath) return slot.id;
    }
    return null;
  }

  private onMediaEnded(): void {
    if (this.currentSourceType === 'builtin') {
      if (this.state.builtinPlaybackMode === 'single') {
        void this.playBuiltin(this.currentBuiltinId);
        return;
      }
      const next = this.nextValidBuiltinId(this.currentBuiltinId, 1);
      if (next !== null) {
        void this.playBuiltin(next);
      } else {
        this.lastError = '尚無內建音樂';
        this.setStatus('stopped');
        this.notify();
      }
      return;
    }
    if (this.state.mode === 'single') {
      void this.playSlot(this.currentSlotIndex);
      return;
    }
    const next = this.nextValidIndex(this.currentSlotIndex, 1);
    if (next !== null) {
      void this.playSlot(next);
    } else {
      this.setStatus('stopped');
      this.notify();
    }
  }

  /** spec六: "播放失敗時顯示錯誤，不可讓遊戲崩潰" / "清單模式中某槽位失敗
   * 時，自動嘗試下一個有效槽位" — source-aware, mirrors onMediaEnded's own
   * branching so a failed built-in slot only ever advances within the
   * built-in list, never spills into the URL slots (spec四). */
  private onMediaError(): void {
    this.lastError = '播放失敗';
    if (this.currentSourceType === 'builtin') {
      if (this.state.builtinPlaybackMode === 'playlist') {
        const next = this.nextValidBuiltinId(this.currentBuiltinId, 1);
        if (next !== null && next !== this.currentBuiltinId) {
          void this.playBuiltin(next);
          return;
        }
      }
    } else if (this.state.mode === 'playlist') {
      const next = this.nextValidIndex(this.currentSlotIndex, 1);
      if (next !== null && next !== this.currentSlotIndex) {
        void this.playSlot(next);
        return;
      }
    }
    this.setStatus('error');
    this.notify();
  }

  private setStatus(status: PlaybackStatus): void {
    this.status = status;
    this.refreshWorldLabel();
  }

  private notify(): void {
    this.onStateChangeCb?.();
  }

  /** Updates the TV's own world-space label + screen glow (spec八) — this
   * class's only touch on the 3D scene, both handles handed in by whoever
   * constructed it (create-game-systems.ts), never built here. */
  private refreshWorldLabel(): void {
    updateFloatingLabel(this.label, `媒體播放器\n${this.getStatusLine()}`);
    this.screenMaterial.emissiveIntensity = this.status === 'playing' ? 0.9 : 0;
  }

  private builtinDisplayName(id: string): string {
    return BUILTIN_BGM_SLOTS.find((s) => s.id === id)?.displayName ?? id;
  }

  private save(): void {
    this.storage.setJSON(MEDIA_PLAYER_STORAGE_KEY, this.state);
  }
}

// Re-export for callers that only need the default-state shape (e.g. tests).
export { createDefaultMediaPlayerSaveState };
