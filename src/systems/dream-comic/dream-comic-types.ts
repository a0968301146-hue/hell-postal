// "每日起床＋夢境漫畫" round — pure data shapes only (matches this codebase's
// own established "data types separate from the system that plays them"
// convention: after-work-story-data.ts's AfterWorkStoryDay vs.
// after-work-story-system.ts). Kept deliberately minimal (spec三: "請將漫畫
// 內容與UI播放系統分離") — `DreamComicUi` (dream-comic-ui.ts) only ever reads
// a `DreamPanel`'s two fields, never anything about which day/NPC it belongs
// to; that context exists purely for content-authoring readability and this
// round's own completion report, not for playback logic.

/** One "frame" of a day's dream comic (spec三/十五: "可替換漫畫素材的UI系
 * 統...第一階段先使用placeholder"). `placeholderLabel` stands in for the real
 * comic image asset a future round will swap in — DreamComicUi renders it as
 * plain centered text inside the panel box, never anything image-specific,
 * so swapping in real art later only ever means adding an `imageUrl`-style
 * field here and branching DreamComicUi's own render on its presence —
 * DreamComicSystem's own control flow (trigger/advance/persistence) would
 * need zero changes (spec十五: "未來只需要替換圖片資料，不需要重新修改系統程
 * 式"). */
export interface DreamPanel {
  /** Shown inside the panel box itself until real art exists — e.g. "DAY 1 ·
   * PANEL 1" (spec十五's own suggested placeholder shape). */
  placeholderLabel: string;
  /** Narration/dialogue line shown in the text area below the panel. */
  text: string;
}

/** One day's full dream sequence (spec八). `relatedNpcName` and `theme` are
 * never read by DreamComicUi/DreamComicSystem's own playback logic — purely
 * documentation for whoever authors/edits this data (spec六: "夢境內容要與
 * 當天特殊NPC產生關聯"), so a future content pass can see at a glance which
 * NPC each day's dream is meant to foreshadow without re-deriving it from
 * after-work-story-data.ts each time. */
export interface DreamComicDay {
  day: number;
  relatedNpcName: string;
  theme: string;
  panels: DreamPanel[];
}
