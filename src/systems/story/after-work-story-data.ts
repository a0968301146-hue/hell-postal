// "Add day one dock story event" round — plain data only, no scene-graph or
// gameplay logic (matches this codebase's own established convention:
// pallet-data.ts, lost-found-data.ts, etc.). Dialogue lives in ONE array per
// day so a future day2..7 continuation only ever means adding another entry
// here, never touching after-work-story-system.ts's own control flow.
//
// Reuses the lost-found NPC's own established spawn/waiting-area coordinates
// (LOST_FOUND_NPC_SPAWN/LOST_FOUND_NPC_WAIT_SPOT) — read-only import, never
// modifying lost-found-layout-data.ts itself. Safe to share the exact same
// spot: LostFoundSystem's own daily NPC is always cleared by
// lostFoundSystem.resetDaily() (DailyFlowSystem's resetTools callback) BEFORE
// onDayCompleted fires, so no real lost-found NPC is ever present when this
// story's own NPC spawns.
import { LOST_FOUND_NPC_SPAWN, LOST_FOUND_NPC_WAIT_SPOT } from '../../data/world/lost-found-layout-data';

export const AFTER_WORK_STORY_NPC_SPAWN = LOST_FOUND_NPC_SPAWN;
export const AFTER_WORK_STORY_NPC_WAIT_SPOT = LOST_FOUND_NPC_WAIT_SPOT;

export interface AfterWorkStoryDay {
  npcName: string;
  lines: string[];
}

/** Keyed by the finished-day number that triggers it (spec: "第1天結束後的
 * 碼頭故事事件") — only day 1 exists so far; a future day gets its own entry
 * here, never a restructuring of this file or the system driving it. */
export const AFTER_WORK_STORIES: Record<number, AfterWorkStoryDay> = {
  1: {
    npcName: '老碼頭工人',
    lines: [
      '你果然還是回來了。你站在這裡的樣子，和你爺爺年輕時很像。',
      '這座物流中心最早只有一間木屋、一座小碼頭，連能遮雨的屋頂都不完整。',
      '你爺爺常說，送到這裡的不是貨物，而是一個人交給另一個人的承諾。',
      '他會親自記住每條路線，也記得每一位來取貨的客人，連那些脾氣古怪的載具都願意聽他的。',
      '遇到暴風雨時，其他地方都關了門，只有他還點著燈，讓無處可去的旅人把東西暫時留在這裡。',
      '他從不催大家趕快做完，只要求每一封信、每一件包裹，都要確實送到應該抵達的地方。',
      '後來這裡慢慢擴建，新的貨架、碼頭和運輸路線一個接著一個出現，但他的規矩一直沒有改。',
      '他年紀大了以後，常坐在這張椅子上，看著載具離港，嘴裡還會念著今天少了哪一件貨。',
      '有一次他告訴我，總有一天你會回來。只是到那時，這裡應該由你決定要變成什麼模樣。',
      '你不需要成為第二個他。照自己的方式經營吧，只要別忘了，這裡承載的從來不只是箱子。',
    ],
  },
};
