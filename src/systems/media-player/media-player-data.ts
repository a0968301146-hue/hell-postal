import { MEDIA_SLOT_COUNT, MediaPlayerSaveState, MediaTab, PlaybackMode, SlotValidation } from './media-player-types';
import { BUILTIN_BGM_SLOTS } from './builtin-bgm-data';

export const MEDIA_PLAYER_STORAGE_KEY = 'hp_media_player_v1';

const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{6,}$/;
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg'];

/** https always allowed; http only for localhost/127.0.0.1 dev (spec四:
 * "正式網站只接受https URL；localhost開發可接受http") — everything else
 * (javascript:, data:, file:, ftp:, ...) is rejected by this ALLOWLIST
 * simply by never matching either branch, so there's no separate blocklist
 * to keep in sync (spec四: "禁止javascript:、data:等URL"). */
function isAllowedScheme(u: URL): boolean {
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
  return false;
}

function extractYouTubeId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return YOUTUBE_ID_RE.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (u.pathname === '/watch') {
      const id = u.searchParams.get('v');
      return id && YOUTUBE_ID_RE.test(id) ? id : null;
    }
    if (u.pathname.startsWith('/shorts/')) {
      const id = u.pathname.slice('/shorts/'.length).split('/')[0];
      return YOUTUBE_ID_RE.test(id) ? id : null;
    }
  }
  return null;
}

/** Classifies a single slot's raw URL text (spec四). Never throws — an
 * unparsable string just classifies as invalid, same as an empty one. */
export function classifySlotUrl(raw: string): SlotValidation {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: null, valid: false };

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { kind: null, valid: false };
  }
  if (!isAllowedScheme(u)) return { kind: null, valid: false };

  const youtubeId = extractYouTubeId(u);
  if (youtubeId) return { kind: 'youtube', valid: true, youtubeId };

  const pathname = u.pathname.toLowerCase();
  if (AUDIO_EXTENSIONS.some((ext) => pathname.endsWith(ext))) return { kind: 'audio', valid: true };
  if (VIDEO_EXTENSIONS.some((ext) => pathname.endsWith(ext))) return { kind: 'video', valid: true };

  return { kind: null, valid: false };
}

export function createDefaultMediaPlayerSaveState(): MediaPlayerSaveState {
  return {
    slots: ['', '', '', '', ''], mode: 'playlist', volume: 0.7, lastSlotIndex: 0,
    // "Add built-in BGM tab to television player" round: defaults to the
    // 內建音樂 tab (spec一: "預設開啟「內建音樂」") — playlist mode for
    // built-in BGM too, same default as URL mode.
    activeTab: 'builtin', lastBuiltinBgmId: BUILTIN_BGM_SLOTS[0].id, builtinPlaybackMode: 'playlist',
  };
}

/** Field-by-field fallback to defaults for any missing/corrupt field —
 * mirrors upgrade-system.ts's own mergeUpgradeSaveState pattern exactly.
 * "Add built-in BGM tab to television player" round五: a save written
 * before this round simply lacks activeTab/lastBuiltinBgmId/
 * builtinPlaybackMode entirely — falls through to defaults here exactly
 * like every other missing field, no special-cased migration needed
 * (spec五: "舊存檔缺少新欄位時使用預設值，不可報錯"). */
export function mergeMediaPlayerSaveState(saved: Partial<MediaPlayerSaveState> | null): MediaPlayerSaveState {
  const base = createDefaultMediaPlayerSaveState();
  if (!saved) return base;

  const savedSlots = Array.isArray(saved.slots) ? saved.slots : null;
  const slots = Array.from({ length: MEDIA_SLOT_COUNT }, (_, i) => {
    const v = savedSlots?.[i];
    return typeof v === 'string' ? v : '';
  });

  const mode: PlaybackMode = saved.mode === 'single' || saved.mode === 'playlist' ? saved.mode : base.mode;
  const volume = typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 1 ? saved.volume : base.volume;
  const lastSlotIndex =
    typeof saved.lastSlotIndex === 'number' && Number.isInteger(saved.lastSlotIndex) &&
    saved.lastSlotIndex >= 0 && saved.lastSlotIndex < MEDIA_SLOT_COUNT
      ? saved.lastSlotIndex
      : base.lastSlotIndex;

  const activeTab: MediaTab = saved.activeTab === 'builtin' || saved.activeTab === 'url' ? saved.activeTab : base.activeTab;
  const builtinPlaybackMode: PlaybackMode =
    saved.builtinPlaybackMode === 'single' || saved.builtinPlaybackMode === 'playlist' ? saved.builtinPlaybackMode : base.builtinPlaybackMode;
  const lastBuiltinBgmId =
    typeof saved.lastBuiltinBgmId === 'string' && BUILTIN_BGM_SLOTS.some((s) => s.id === saved.lastBuiltinBgmId)
      ? saved.lastBuiltinBgmId
      : base.lastBuiltinBgmId;

  return { slots, mode, volume, lastSlotIndex, activeTab, lastBuiltinBgmId, builtinPlaybackMode };
}
