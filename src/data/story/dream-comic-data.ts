// "夢境卡死修正＋純插槽版本" round — Day1~7 dream SLOTS only (spec七: "把目前
// Day1～Day7的正式夢境文字先移除／清空...不要自行創作劇情"). The previous
// round's own real narrative content (drawn from after-work-story-data.ts's
// established NPC lines) is intentionally removed here, not just hidden —
// every panel is a genuinely empty `{ id, image: null, text: '' }` slot,
// exactly the shape spec七 asks for. The system architecture around this
// data (DreamComicSystem's trigger/lock/teleport/advance/persistence,
// DreamComicUi's black-overlay/panel-box/text-area layout) is completely
// unchanged by this round — filling real content back in later is a
// pure data-only edit to this one file.
//
// 3 panels per day (spec七's own suggested count) — enough to exercise
// Panel 1 -> 2 -> 3 -> end via E/Space/left-click in testing, without
// implying any real scene count once real art/writing arrives.
//
// Day7 gets a slot too this round (unlike the previous round, which omitted
// it pending clarification about AFTER_WORK_STORIES[7]'s absent-NPC letter
// day) — that clarification still applies once real CONTENT is written, but
// an empty slot carries no content to be wrong about, so there's no reason
// to withhold it while every other day gets one (spec: "Day1～Day7都保留夢境
// 系統插槽").
//
// Day8 has NO entry here (spec十五) — it already has its own distinct
// entrance (AfterWorkStorySystem.checkGiantCakeDayStart, driven directly by
// currentDay===8, independent of this file/DreamComicSystem entirely), and
// DreamComicSystem's own checkDreamStart() explicitly excludes day>7 besides.
import { DreamComicDay } from '../../systems/dream-comic/dream-comic-types';

function emptyDay(day: number): DreamComicDay {
  return {
    day,
    panels: [
      { id: `day${day}-panel1`, image: null, text: '' },
      { id: `day${day}-panel2`, image: null, text: '' },
      { id: `day${day}-panel3`, image: null, text: '' },
    ],
  };
}

export const DREAM_COMICS: Record<number, DreamComicDay> = {
  1: emptyDay(1),
  2: emptyDay(2),
  3: emptyDay(3),
  4: emptyDay(4),
  5: emptyDay(5),
  6: emptyDay(6),
  7: emptyDay(7),
};
