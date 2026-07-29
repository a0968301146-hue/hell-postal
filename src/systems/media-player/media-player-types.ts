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

export interface MediaPlayerSaveState {
  /** Always exactly MEDIA_SLOT_COUNT entries, raw URL text or ''. */
  slots: string[];
  mode: PlaybackMode;
  /** 0..1 */
  volume: number;
  lastSlotIndex: number;
}
