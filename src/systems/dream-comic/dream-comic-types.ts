// "夢境卡死修正＋純插槽版本" round — pure data shapes only (matches this
// codebase's own established "data types separate from the system that
// plays them" convention: after-work-story-data.ts's AfterWorkStoryDay vs.
// after-work-story-system.ts). Kept deliberately minimal (spec三: "請將漫畫
// 內容與UI播放系統分離") — `DreamComicUi` (dream-comic-ui.ts) only ever reads
// a `DreamPanel`'s own fields, never anything about which day it belongs to.
//
// This round strips real narrative content back down to empty slots (spec
//七: "不要自行創作劇情...保留DreamComicDay/DreamPanel等資料結構") — the
// previous round's own `relatedNpcName`/`theme` fields are dropped entirely
// rather than kept-but-blanked, since neither was ever read by any playback
// code (pure content-authoring metadata) and the caller's own requested slot
// shape (`{ day, panels: [{ id, image, text }] }`) doesn't call for them;
// re-adding them later alongside real content is a small, additive change
// whenever that round happens.

/** One "frame" of a day's dream comic — currently always an EMPTY slot this
 * round (spec七/八: placeholder-only, no real art or writing yet). `image`
 * stands in for the real comic artwork a future round will provide — `null`
 * this round means "use DreamComicUi's own generic placeholder box" (spec
 *八); once real art exists, filling this in with a URL is the ONLY change
 * needed here — DreamComicSystem's own control flow (trigger/advance/
 * persistence) never needs to change alongside it (spec十五, carried over
 * from the previous round's own design). */
export interface DreamPanel {
  id: string;
  image: string | null;
  text: string;
}

/** One day's full dream sequence (spec十二). */
export interface DreamComicDay {
  day: number;
  panels: DreamPanel[];
}
