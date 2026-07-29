// Shared type vocabulary for the television media player ("Add television
// media playlist" round). Kept self-contained (no import from any other
// gameplay system) — this feature is purely a standalone world prop, never
// touched by mail/cargo/vehicle/scoring logic.

export type PlaybackMode = 'single' | 'playlist';

export type PlaybackStatus = 'stopped' | 'playing' | 'paused' | 'error';

/** What a slot's URL was classified as — null means the URL is missing or
 * doesn't match any supported pattern (spec四: "不要將任意網頁直接放進
 * iframe"). `audio`/`video` both play through the SAME single
 * HTMLMediaElement (a `<video>` tag can play audio-only files fine; no
 * functional reason to keep two separate elements), so the distinction is
 * only ever used for the slot's own status label text. */
export type SlotMediaKind = 'youtube' | 'audio' | 'video' | null;

export interface SlotValidation {
  kind: SlotMediaKind;
  valid: boolean;
  /** Only set when kind === 'youtube'. */
  youtubeId?: string;
}

export const MEDIA_SLOT_COUNT = 5;

/** Which of the two top-level UI tabs is showing ("Add built-in BGM tab to
 * television player" round一) — a pure UI-view concern, decoupled from
 * which source is actually PLAYING (see MediaSourceType below): switching
 * tabs never stops or otherwise touches playback (spec一: "切換Tab不可停止
 * 目前正在播放的內容"). */
export type MediaTab = 'builtin' | 'url';

/** Which content is currently loaded into the shared player — set only by
 * an explicit playSlot()/playBuiltin() call, independent of `MediaTab`
 * above (spec四: "更新目前sourceType"). Determines which of the two
 * separate playlists (URL slots vs. built-in BGM slots) next()/previous()/
 * the ended-event auto-advance logic walks, so the two never blend into one
 * combined queue (spec四: "不要把URL與內建音樂混成同一份播放清單"). */
export type MediaSourceType = 'url' | 'builtin';

/** One built-in BGM slot ("Add built-in BGM tab to television player" round
 * 二) — `filePath`/`enabled` are plain data, never player-editable (spec三:
 * "玩家只能選擇並播放，不可修改檔案路徑"). */
export interface BuiltinBgmSlot {
  id: string;
  displayName: string;
  filePath: string | null;
  enabled: boolean;
}

export interface MediaPlayerSaveState {
  /** Always exactly MEDIA_SLOT_COUNT entries, raw URL text or ''. */
  slots: string[];
  mode: PlaybackMode;
  /** 0..1 */
  volume: number;
  lastSlotIndex: number;
  /** "Add built-in BGM tab to television player" round五. */
  activeTab: MediaTab;
  lastBuiltinBgmId: string;
  builtinPlaybackMode: PlaybackMode;
}
