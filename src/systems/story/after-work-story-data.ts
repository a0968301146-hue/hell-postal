// "Add day one dock story event" round — plain data only, no scene-graph or
// gameplay logic (matches this codebase's own established convention:
// pallet-data.ts, lost-found-data.ts, etc.). Dialogue lives in ONE array per
// day so a future day2..7 continuation only ever means adding another entry
// here, never touching after-work-story-system.ts's own control flow.
//
// "每日特殊劇情系統" round — generalized from the original day-1-only shape
// (which hardcoded the lost-found NPC's own spawn/wait coordinates as module-
// level constants, and hardcoded the fishing-pier chairs as THE dialogue
// location for every day inside after-work-story-system.ts itself) into a
// per-day config object. Every day's own NPC spawn/wait spot and dialogue
// seating now lives HERE, read generically by AfterWorkStorySystem — adding a
// day only ever means adding another entry to AFTER_WORK_STORIES, never
// touching the system's own control flow (spec Claude注意事項1: "沿用Day1
// 劇情系統，不要建立第二套劇情框架").
import * as THREE from 'three';
import { LOST_FOUND_NPC_SPAWN, LOST_FOUND_NPC_WAIT_SPOT } from '../../data/world/lost-found-layout-data';
import { fishingSeatAnchorA, fishingSeatAnchorB, fishingLookTarget } from '../world-layout/fishing-pier-data';
import { BACK_AREA, MAIN_ROOM_CENTER_SPAWN } from '../world-layout/logistics-layout-data';
import {
  COFFEE_CHAIR_PLAYER, COFFEE_CHAIR_NPC, COFFEE_LOOK_TARGET,
} from '../../data/world/coffee-room-layout-data';
import {
  CAMPFIRE_BENCH_SOUTH, CAMPFIRE_BENCH_WEST,
} from '../../data/world/campfire-area-data';
import { SEA_PLATFORM_PLAYER, SEA_PLATFORM_NPC, SEA_LOOK_TARGET } from '../../data/world/sea-interaction-data';

/** Kept as the DEFAULT spawn/wait for every day whose NPC simply "walks in
 * from off-scene" rather than starting inside a day-specific new room (days
 * 1/3/5 below) — reuses the lost-found NPC's own established, already-safe-
 * to-share coordinates (see this file's own prior doc comment: LostFoundSystem
 * always clears its own daily NPC before onDayCompleted fires). */
export const AFTER_WORK_STORY_NPC_SPAWN = LOST_FOUND_NPC_SPAWN;
export const AFTER_WORK_STORY_NPC_WAIT_SPOT = LOST_FOUND_NPC_WAIT_SPOT;

/** One NPC "station" during Day8's own party free-roam phase (spec: "所有
 * NPC分散在不同地點...各自有獨立對話") — a fixed standing position plus its
 * own short E-to-talk line(s), reusing the exact same bubble/raycast/prompt
 * primitives AfterWorkStorySystem already drives for every other day's NPC,
 * just N simultaneous instances instead of one. */
export interface FinaleNpcStation {
  npcName: string;
  lines: string[];
  pos: THREE.Vector3;
}

export interface AfterWorkStoryDay {
  npcName: string;
  lines: string[];
  /** Omitted for isLetterDay (no NPC at all) and isFinaleDay (uses
   * finaleNpcs instead — a whole roster, not one). */
  npcSpawn?: { x: number; z: number };
  npcWaitSpot?: { x: number; z: number };
  /** Where the player+NPC pair teleport to for the seated dialogue beat
   * (generalizes the old hardcoded fishingSeatAnchorA/B/fishingLookTarget —
   * see after-work-story-system.ts's teleportToDialogueSpot). Omitted for
   * isLetterDay (no teleport at all — the letter is read right where it's
   * found) and isFinaleDay (its own multi-phase flow doesn't use a single
   * seat pair). */
  seatPlayer?: THREE.Vector3;
  seatNpc?: THREE.Vector3;
  lookTarget?: THREE.Vector3;

  /** Day7 only (spec: "沒有NPC...地上有一封信...E撿起→E打開"). No NPC walk-in
   * /wait/teleport phase at all — trigger() goes straight to a "letter on the
   * floor" pickup. Opening it shows the dedicated letter-reading overlay
   * (letter-reading-ui.ts) instead of the shared NPC dialogue bubble — spec
   * follow-up: "彈出信件閱讀UI...信件像貼在螢幕前展示". */
  isLetterDay?: boolean;
  /** Where the letter mesh sits (isLetterDay only). */
  letterPos?: THREE.Vector3;
  /** Letter-reading overlay content (isLetterDay only) — a standalone piece
   * of world-flavor mail, deliberately NOT connected to the player or any
   * later day (spec: "不需要連接後續任務"). */
  letterSender?: string;
  letterRecipient?: string;
  letterBody?: string[];

  /** Day8 only — the finale (spec: "第8天...生日派對"). Distinct multi-phase
   * flow (cake reveal -> free-roam party -> campfire ending) layered on top
   * of the SAME fade/lock/dialogue-bubble primitives every other day already
   * uses; see after-work-story-system.ts's dedicated updateFinale* methods. */
  isFinaleDay?: boolean;
  /** Said in sequence, one per E/Space press, before the cake can be opened
   * (spec: "NPC陸續出現...大家說『快打開！』"). */
  finaleOpeningLines?: string[];
  /** Said in sequence right after the player opens the cake (E again). */
  finaleRevealLines?: string[];
  /** The scattered party roster (spec: "所有NPC自由分散在不同地點"). */
  finaleNpcs?: FinaleNpcStation[];
  /** Said together once the player sits down at the campfire (spec: "玩家在
   * 營火區坐下才觸發結局...『歡迎回家。』"). */
  finaleEndingLines?: string[];
}

const starSeatPlayer = new THREE.Vector3(3.4, BACK_AREA.floorY, 20.2);
const starSeatNpc = new THREE.Vector3(4.6, BACK_AREA.floorY, 20.2);
const starLookTarget = new THREE.Vector3((BACK_AREA.minX + BACK_AREA.maxX) / 2, 40, (BACK_AREA.minZ + BACK_AREA.maxZ) / 2);

const letterSpot = new THREE.Vector3(MAIN_ROOM_CENTER_SPAWN.x + 1.2, MAIN_ROOM_CENTER_SPAWN.y, MAIN_ROOM_CENTER_SPAWN.z + 0.6);

/** Day8 finale — the cake sits exactly at the room's own center spawn point
 * (spec: "玩家...放置在物流中心房間中央"); the player stands a couple meters
 * south of it, facing north toward the cake, for the opening/reveal beat. */
export const FINALE_CAKE_POS = new THREE.Vector3(MAIN_ROOM_CENTER_SPAWN.x, MAIN_ROOM_CENTER_SPAWN.y, MAIN_ROOM_CENTER_SPAWN.z);
const finalePlayerSpot = new THREE.Vector3(MAIN_ROOM_CENTER_SPAWN.x, MAIN_ROOM_CENTER_SPAWN.y, MAIN_ROOM_CENTER_SPAWN.z + 2.2);

/** Keyed by the finished-day number that triggers it (spec: "第N天結束後的
 * 每日特殊劇情事件") — days 1-8, each entry swapping only NPC/scene/dialogue
 * per this round's own explicit constraint (Claude注意事項3: "每天只需要換
 * NPC、場景、對話"). */
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
    npcSpawn: AFTER_WORK_STORY_NPC_SPAWN,
    npcWaitSpot: AFTER_WORK_STORY_NPC_WAIT_SPOT,
    seatPlayer: fishingSeatAnchorA,
    seatNpc: fishingSeatAnchorB,
    lookTarget: fishingLookTarget,
  },

  2: {
    npcName: '阿珠姨',
    lines: [
      '今天辛苦了。坐吧，咖啡我剛煮好，還熱著。',
      '你爺爺以前每天收工，都會在這張桌子泡一壺咖啡，跟每個員工聊上幾句才放人回家。',
      '他說站著工作一整天，總得有個地方讓人先喘口氣，再帶著今天的疲憊回家。',
      '不管那天貨運得順不順，他從來不會只聊工作。他會問你家裡的事、問你累不累。',
      '有些新來的員工一開始還不習慣，後來卻變成每天最期待的時間。',
      '這間休息室，就是那時候留下來的。咖啡的味道，我盡量泡得跟他當年一樣。',
    ],
    npcSpawn: AFTER_WORK_STORY_NPC_SPAWN,
    npcWaitSpot: AFTER_WORK_STORY_NPC_WAIT_SPOT,
    seatPlayer: COFFEE_CHAIR_PLAYER,
    seatNpc: COFFEE_CHAIR_NPC,
    lookTarget: COFFEE_LOOK_TARGET,
  },

  3: {
    npcName: '阿海',
    lines: [
      '跟我來，今天想帶你看個東西。坐這裡，抬頭看。',
      '天窗是後來加裝的，晚上收工後，大廳的燈一暗，星星就這樣掛在頭頂上。',
      '你爺爺說過一句話，我一直記到現在：運送貨物，其實也是在把人跟人重新連在一起。',
      '一封信、一件包裹，看起來只是東西，但它連著寄的人跟等的人，中間隔著的就是我們。',
      '他以前也常一個人坐在這裡看星星，說忙了一整天，總要留一點時間給自己發呆。',
      '你看，那邊剛好有一顆流星。不用許願，能好好看到它劃過去，已經很難得了。',
    ],
    npcSpawn: AFTER_WORK_STORY_NPC_SPAWN,
    npcWaitSpot: { x: MAIN_ROOM_CENTER_SPAWN.x - 1, z: MAIN_ROOM_CENTER_SPAWN.z },
    seatPlayer: starSeatPlayer,
    seatNpc: starSeatNpc,
    lookTarget: starLookTarget,
  },

  4: {
    npcName: '陳伯',
    lines: [
      '坐，今天放點老照片給你看看，都是我這些年慢慢收集的。',
      '你看，這個扎著馬尾的小孩，那時候老在碼頭跑來跑去，誰都攔不住。',
      '這張是物流中心剛擴建完的樣子，那時候大家還興奮得睡不著，隔天照樣準時開工。',
      '這個坐在角落的人就是你爺爺，那時候他總說自己不上鏡，結果照片裡最多的就是他。',
      '還有這些，是以前一起扛貨、一起收工的大家，很多人現在都還在附近。',
      '那時候什麼都是手忙腳亂地做，但每個人幫每個人一把，日子反而過得踏實。',
    ],
    npcSpawn: AFTER_WORK_STORY_NPC_SPAWN,
    npcWaitSpot: AFTER_WORK_STORY_NPC_WAIT_SPOT,
    seatPlayer: COFFEE_CHAIR_PLAYER,
    seatNpc: COFFEE_CHAIR_NPC,
    lookTarget: COFFEE_LOOK_TARGET,
  },

  5: {
    npcName: '小夏',
    lines: [
      '走，下水吧，今天海況正好，不游太可惜了。',
      '以前一到夏天，收工鈴一響，大家就直接往海邊衝，連衣服都來不及換。',
      '你爺爺游得不快，但每次都最後一個上岸，說要等所有人都平安上來才安心。',
      '風一吹、海浪一拍，白天扛貨的疲憊好像就這樣被沖掉一半。',
      '有時候什麼都不聊，就這樣漂著看夕陽，也是很好的收工方式。',
      '聽，海鳥在叫了。今天也辛苦了，好好放鬆一下吧。',
    ],
    npcSpawn: AFTER_WORK_STORY_NPC_SPAWN,
    npcWaitSpot: AFTER_WORK_STORY_NPC_WAIT_SPOT,
    seatPlayer: fishingSeatAnchorA,
    seatNpc: fishingSeatAnchorB,
    lookTarget: fishingLookTarget,
  },

  6: {
    npcName: '阿古',
    lines: [
      '跟我來，今天想帶你去一個地方——就在海面上，走，別怕，這塊浮台很穩。',
      '今天想聊聊我自己的事——其實我一直有個夢想，想開一艘屬於自己的船，到處送貨、到處看看。',
      '不是想離開這裡，只是想帶著這裡教我的東西，走遠一點試試看。',
      '你爺爺聽我說過這件事，他沒有笑我，只說「準備好了就去，這裡會等你回來」。',
      '現在還在存錢、還在學怎麼看海圖，慢慢來，總有一天會出發，說不定第一件貨就是從這片海出去的。',
      '海浪輕輕拍著浮台，燈籠晃啊晃的，這種晚上聊心事最剛好了。',
    ],
    npcSpawn: AFTER_WORK_STORY_NPC_SPAWN,
    npcWaitSpot: AFTER_WORK_STORY_NPC_WAIT_SPOT,
    seatPlayer: SEA_PLATFORM_PLAYER,
    seatNpc: SEA_PLATFORM_NPC,
    lookTarget: SEA_LOOK_TARGET,
  },

  7: {
    npcName: '',
    lines: [
      '今天也辛苦了。記得早點休息。不要像以前那樣，總是工作到深夜。',
    ],
    isLetterDay: true,
    letterPos: letterSpot,
    letterSender: '阿元',
    letterRecipient: '故鄉的爹娘',
    letterBody: [
      '爹、娘，見信如晤。',
      '這裡的物流中心規矩雖然多，但大家都很照顧新來的人，不用擔心我在這裡受委屈。',
      '最近開始學著分辨貨物的種類，聽說有些是要送到很遠、很遠的地方，遠到連老員工都說不清楚確切在哪，只知道「交出去，總會到」。',
      '手頭寬裕了一些，附上一點錢，買些好吃的，別捨不得用。等我攢夠假期，就回去看你們。',
      '兒 阿元 敬上',
    ],
  },

  8: {
    npcName: '',
    lines: [],
    seatPlayer: finalePlayerSpot,
    lookTarget: FINALE_CAKE_POS,
    isFinaleDay: true,
    finaleOpeningLines: [
      '（大家陸續走了進來，圍在你搬回來的大箱子旁邊）',
      '欸？這什麼？也太大了吧！',
      '別問了，快打開快打開！',
      '快打開！',
    ],
    finaleRevealLines: [
      '是蛋糕！！',
      '生日快樂！',
      '這是大家一起準備的，慶祝這裡走到今天——也慶祝你回來的這一年。',
      '接下來不用急著做事了，今天就好好逛逛、跟大家聊聊天吧。',
    ],
    finaleNpcs: [
      {
        npcName: '老碼頭工人',
        lines: [
          '這麼多年了，能看到你把這裡撐到今天，我很高興。',
          '你爺爺要是在，一定也會這樣說。',
        ],
        pos: fishingSeatAnchorA.clone(),
      },
      {
        npcName: '阿珠姨',
        lines: ['今天不用煮咖啡了，換我陪你喝一杯。', '辛苦你了，這一整年。'],
        pos: COFFEE_CHAIR_NPC.clone(),
      },
      {
        npcName: '阿海',
        lines: ['等等晚一點，再一起去看星星吧。', '今天的星空應該會特別亮。'],
        pos: new THREE.Vector3(starSeatNpc.x, starSeatNpc.y, starSeatNpc.z),
      },
      {
        npcName: '陳伯',
        lines: ['我把今年的照片也洗出來了，之後放進相本裡。', '這裡的故事，還會繼續下去。'],
        pos: COFFEE_CHAIR_PLAYER.clone(),
      },
      {
        npcName: '小夏',
        lines: ['夏天要來了，到時候再一起去游泳。', '別又只顧著工作，忘記約我。'],
        pos: fishingSeatAnchorB.clone(),
      },
      {
        npcName: '阿古',
        lines: ['我的船，說不定明年就能出發了。', '到時候第一件貨，我想送來這裡。'],
        pos: SEA_PLATFORM_NPC.clone(),
      },
      {
        npcName: '小柚',
        lines: ['失物招領的東西，這陣子少了很多迷路的呢。', '大概是大家都學會好好收拾了吧。'],
        pos: CAMPFIRE_BENCH_WEST.clone(),
      },
    ],
    finaleEndingLines: ['歡迎回家。'],
  },
};

/** Day8's own campfire "sit down to end the game" trigger seat (spec: "玩家
 * 最後在營火區坐下") — the same south bench Day6's own player already sits
 * on. Kept separate from finaleNpcs (that's the roster the player walks up
 * to; this is the one seat that fires the ending instead of more dialogue). */
export const FINALE_ENDING_SEAT = CAMPFIRE_BENCH_SOUTH;
