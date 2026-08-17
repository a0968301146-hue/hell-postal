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

/** Which simple procedural idle behavior a finale-party NPC plays while
 * standing at their own station (spec follow-up 二: "每位NPC都有簡單待機動
 * 作...不需要新增AI，只要播放不同Idle動作即可"). No skeletal animation
 * system exists anywhere in this codebase (every character is a plain
 * capsule primitive) — each kind below is a small, hand-scripted per-frame
 * position/rotation tweak in after-work-story-system.ts's own
 * updateFinaleStationIdle, not a real animation clip. */
export type FinaleIdleKind = 'sit' | 'drink' | 'lookAtSky' | 'lean' | 'chat' | 'roast';

/** One NPC "station" during Day8's own party free-roam phase (spec: "所有
 * NPC分散在不同地點...各自有獨立對話") — a fixed standing position plus its
 * own short E-to-talk line(s), reusing the exact same bubble/raycast/prompt
 * primitives AfterWorkStorySystem already drives for every other day's NPC,
 * just N simultaneous instances instead of one. */
export interface FinaleNpcStation {
  npcName: string;
  /** Shown in full the FIRST time the player talks to this NPC. */
  lines: string[];
  /** Shown instead of `lines` on every visit AFTER the first (spec follow-up
   * 三: "第一次顯示完整對話，之後改成較短的一兩句，避免玩家一直重複閱讀長
   * 對話"). */
  repeatLine: string;
  pos: THREE.Vector3;
  /** Initial facing yaw in radians (spec follow-up 六: "NPC不要全部面向同一
   * 方向") — every station otherwise defaults to identity rotation (all
   * facing the same way). */
  facingYaw?: number;
  idleKind?: FinaleIdleKind;
}

/** "男主角台詞系統＋特殊NPC劇情選擇" round — one entry in a story day's
 * `lines` script. A plain `string` means exactly what it always has: a line
 * spoken by the day's own NPC, shown in the shared 3D head-bubble
 * (after-work-story-bubble-ui.ts, untouched). Every existing day's
 * `lines: string[]` stays fully valid with zero rewrite (spec三: "不要重新
 * 編寫Day1～Day8現有台詞") — this union only ADDS expressive power on top.
 *
 * The two new object shapes let a day's script also include a line the
 * PROTAGONIST speaks (rendered in the separate screen-space subtitle bar,
 * see systems/dialogue/) or a Choice node (up to 3 options, spec: "第一版
 * 固定支援3個選項即可" — each with its own short response sub-script that
 * plays once picked, then rejoins the SAME `lines` array right after the
 * choice; see AfterWorkStorySystem's own beginChoice/resolveChoice). Neither
 * shape is used by any of the existing 8 days' data this round — the
 * capability is added, no existing day's content is touched. */
export type DialogueEntry = string | ProtagonistDialogueEntry | DialogueChoiceEntry;

export interface ProtagonistDialogueEntry {
  speaker: 'protagonist';
  /** Purely descriptive for now (spec: "speech/monologue/thought三種狀態可以
   * 先共用同一套視覺樣式，不要為了第一版過度設計三種不同UI") — every kind
   * renders identically in the subtitle bar this round; kept so a future
   * round can differentiate styling per kind without another data
   * migration. */
  kind: 'speech' | 'monologue' | 'thought';
  text: string;
}

export interface DialogueChoiceOption {
  label: string;
  /** Played once this option is picked, then the main `lines` script resumes
   * right after this choice node — never a second independent branch (spec
   * 五: "三個選項不應該改變後續大部分劇情...不需要做真正的多結局系統"). */
  response: DialogueEntry[];
}

export interface DialogueChoiceEntry {
  kind: 'choice';
  /** Up to 3 options (spec二: "第一版固定支援3個選項即可"). */
  options: DialogueChoiceOption[];
}

export interface AfterWorkStoryDay {
  npcName: string;
  lines: DialogueEntry[];
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
   * flow (cake unwrap -> free-roam party -> campfire ending) layered on top
   * of the SAME fade/lock/dialogue-bubble primitives every other day already
   * uses; see after-work-story-system.ts's dedicated updateFinale* methods.
   * Follow-up round: the player now walks up to the still-wrapped cake at
   * their own pace and presses F to open it (spec: "玩家需要主動拆開蛋糕")
   * — no NPCs are present yet at this point (spec: "開始時只生成：巨型蛋糕
   * 包裹×1"), so there is no more "everyone walks in and says open it"
   * dialogue beat to configure here. */
  isFinaleDay?: boolean;
  /** Shown once, briefly, in the cake's own bubble the instant it's unwrapped
   * (spec follow-up's own "播放拆包裝流程" beat) — a short flash of flavor
   * text, not a line-by-line E-advanced dialogue (nobody's there to have a
   * conversation with yet). Only the first entry is actually shown; kept as
   * an array for consistency with every other day's own lines shape. */
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
      { speaker: 'protagonist', kind: 'speech', text: '……聽你這麼說，我一時不知道該怎麼回答。' },
      {
        kind: 'choice',
        options: [
          { label: '我還記得爺爺常說的話。', response: ['記得就好，比什麼都重要。'] },
          { label: '希望我做得跟他一樣好。', response: ['你已經做得很好了。'] },
          { label: '老實說，我還在摸索中。', response: ['摸索著摸索著，就會像個樣子了。'] },
        ],
      },
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
      { speaker: 'protagonist', kind: 'speech', text: '（坐下，聞到咖啡香）這味道……讓人整個放鬆下來。' },
      {
        kind: 'choice',
        options: [
          { label: '謝謝，今天真的很累。', response: ['辛苦了，先喝一口再說。'] },
          { label: '這咖啡的味道好懷念。', response: ['是嗎？那我泡對味道了。'] },
          { label: '阿珠姨每天都在這裡等大家嗎？', response: ['只要還有人需要，我就在。'] },
        ],
      },
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
      { speaker: 'protagonist', kind: 'speech', text: '（抬頭）……星星比我想像中還要多。' },
      {
        kind: 'choice',
        options: [
          { label: '這片天空真的很漂亮。', response: ['是吧？值得留一點時間看看。'] },
          { label: '你常常一個人來這裡看星星嗎？', response: ['偶爾，一個人靜一靜也不錯。'] },
          { label: '感覺今天過得特別漫長。', response: ['那正好，就在這裡好好喘口氣。'] },
        ],
      },
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
      { speaker: 'protagonist', kind: 'speech', text: '（翻看照片）這些都是……很久以前的事了吧。' },
      {
        kind: 'choice',
        options: [
          { label: '這些照片都保存得真好。', response: ['都是些捨不得丟的回憶。'] },
          { label: '我想多了解一點以前的事。', response: ['那我們今天就慢慢聊。'] },
          { label: '看到這些，感覺很不真實。', response: ['時間過得快，但這些都是真的。'] },
        ],
      },
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
      { speaker: 'protagonist', kind: 'speech', text: '（望向海面）……好像有點久沒這樣放鬆了。' },
      {
        kind: 'choice',
        options: [
          { label: '好，我們走吧！', response: ['這才對嘛！'] },
          { label: '我好久沒下水了。', response: ['沒關係，我陪你慢慢來。'] },
          { label: '今天真的很想放鬆一下。', response: ['那就對了，今天什麼都別想。'] },
        ],
      },
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
      { speaker: 'protagonist', kind: 'speech', text: '（踏上浮台）……這裡的視野，跟平常完全不一樣。' },
      {
        kind: 'choice',
        options: [
          { label: '這裡的視野真好。', response: ['對吧？我最喜歡這個角度。'] },
          { label: '你常常一個人來這裡嗎？', response: ['偶爾，想事情的時候會來。'] },
          { label: '老實說，我有點怕水。', response: ['放心，浮台很穩，不會有事的。'] },
        ],
      },
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
    finaleRevealLines: [
      '生日快樂！',
    ],
    finaleNpcs: [
      {
        npcName: '老碼頭工人',
        lines: [
          '這麼多年了，能看到你把這裡撐到今天，我很高興。',
          '你爺爺要是在，一定也會這樣說。',
        ],
        repeatLine: '你爺爺會以你為榮的。',
        pos: fishingSeatAnchorA.clone(),
        facingYaw: 0.3,
        idleKind: 'sit',
      },
      {
        npcName: '阿珠姨',
        lines: ['今天不用煮咖啡了，換我陪你喝一杯。', '辛苦你了，這一整年。'],
        repeatLine: '今晚真的很開心。',
        pos: COFFEE_CHAIR_NPC.clone(),
        facingYaw: Math.PI * 0.6,
        idleKind: 'drink',
      },
      {
        npcName: '阿海',
        lines: ['等等晚一點，再一起去看星星吧。', '今天的星空應該會特別亮。'],
        repeatLine: '星星還在，慢慢看。',
        pos: new THREE.Vector3(starSeatNpc.x, starSeatNpc.y, starSeatNpc.z),
        facingYaw: Math.PI * 1.1,
        idleKind: 'lookAtSky',
      },
      {
        // Moved off COFFEE_CHAIR_PLAYER (which put him in the SAME room as
        // 阿珠姨, undermining the party's own "分散在不同房間" spread) into
        // the lost-found room — every day's own story NPC already gathers
        // there first, so it reads naturally as "somewhere he'd wait too".
        npcName: '陳伯',
        lines: ['我把今年的照片也洗出來了，之後放進相本裡。', '這裡的故事，還會繼續下去。'],
        repeatLine: '這裡的故事，還在繼續呢。',
        pos: new THREE.Vector3(AFTER_WORK_STORY_NPC_WAIT_SPOT.x, 0, AFTER_WORK_STORY_NPC_WAIT_SPOT.z),
        facingYaw: -Math.PI * 0.5,
        idleKind: 'lean',
      },
      {
        // Moved off fishingSeatAnchorB (SAME spot as 老碼頭工人) to the main
        // work floor — same "分散在不同房間/角落" spread reasoning as 陳伯
        // above (spec follow-up: "分布於不同房間...例如...工作區").
        npcName: '小夏',
        lines: ['夏天要來了，到時候再一起去游泳。', '別又只顧著工作，忘記約我。'],
        repeatLine: '記得也留點時間給自己。',
        pos: new THREE.Vector3(-3, 0, 15),
        facingYaw: Math.PI * 0.25,
        idleKind: 'chat',
      },
      {
        npcName: '阿古',
        lines: ['我的船，說不定明年就能出發了。', '到時候第一件貨，我想送來這裡。'],
        repeatLine: '總有一天，我會出發的。',
        pos: SEA_PLATFORM_NPC.clone(),
        facingYaw: -Math.PI * 0.8,
        idleKind: 'lookAtSky',
      },
      {
        npcName: '小柚',
        lines: ['失物招領的東西，這陣子少了很多迷路的呢。', '大概是大家都學會好好收拾了吧。'],
        repeatLine: '大家今天都很開心呢。',
        pos: CAMPFIRE_BENCH_WEST.clone(),
        facingYaw: Math.PI * 0.9,
        idleKind: 'roast',
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

// ============================================================================
// TEMPORARY_TEST — "男主角台詞系統＋特殊NPC劇情選擇" round scaffolding only.
// NOT referenced by AFTER_WORK_STORIES or any other real day's data, and NOT
// wired into any trigger path — exists purely to demonstrate the new
// DialogueEntry shapes (protagonist speech + a 3-option choice with distinct
// responses that rejoin the same script) compile and type-check correctly.
// Safe to delete entirely once a real day's data is authored to use these
// shapes, or once manually verified in-engine.
// ============================================================================
export const TEMPORARY_TEST_DIALOGUE_ENTRIES: DialogueEntry[] = [
  '你終於來了。',
  { speaker: 'protagonist', kind: 'speech', text: '嗯，我有點好奇你今天找我做什麼。' },
  {
    kind: 'choice',
    options: [
      { label: '直接問吧。', response: ['我就知道你會這麼直接。'] },
      { label: '先喝杯茶？', response: ['哈哈，你還是老樣子。'] },
      { label: '你看起來很緊張。', response: ['……有這麼明顯嗎？'] },
    ],
  },
  '總之，今天辛苦你了。',
];
