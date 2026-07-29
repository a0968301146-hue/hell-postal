import { BuiltinBgmSlot } from './media-player-types';

/** Centralized built-in BGM slot data ("Add built-in BGM tab to television
 * player" round二) — 5 placeholder slots, all currently empty/disabled.
 * Deliberately NEVER fabricate a fake/blank/base64 audio file to fill these
 * (spec二: "不要生成假的MP3、空白音訊檔或Base64音訊") — the UI shows "尚未
 * 加入音樂" for every slot until real files exist.
 *
 * To actually enable a slot later: drop the real file at
 * `public/audio/bgm/<filename>.mp3` (or wherever `filePath` points — served
 * as a static asset, same convention as any other public/ file) and flip
 * that one slot's own `filePath`/`enabled` here, e.g.:
 *   { id: 'bgm-01', displayName: '內建音樂 1', filePath: './audio/bgm/lobby-loop.mp3', enabled: true }
 * Nothing else in this file, MediaPlayerSystem, or MediaPlayerUI needs to
 * change — every consumer already reads `enabled`/`filePath` fresh off this
 * array. */
export const BUILTIN_BGM_SLOTS: BuiltinBgmSlot[] = [
  { id: 'bgm-01', displayName: '內建音樂 1', filePath: null, enabled: false },
  { id: 'bgm-02', displayName: '內建音樂 2', filePath: null, enabled: false },
  { id: 'bgm-03', displayName: '內建音樂 3', filePath: null, enabled: false },
  { id: 'bgm-04', displayName: '內建音樂 4', filePath: null, enabled: false },
  { id: 'bgm-05', displayName: '內建音樂 5', filePath: null, enabled: false },
];
