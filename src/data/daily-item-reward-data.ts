// "每日結算流程調整＋新道具內容" round — plain data only, mirroring
// daily-unlock-data.ts's own established "data file, system reads it"
// convention. Deliberately NOT an inventory/shop system — a NewItemReward
// is purely a display card (name/description/image), never granted into
// any real item/tool state; the player is only shown what's new, nothing
// here mutates game logic.
//
// Content source (spec五: "不要自行重新設計道具解鎖順序") — every entry below
// is derived DIRECTLY from daily-unlock-data.ts's own cumulative `tools`
// field (the authoritative, already-existing unlock schedule), scoped to
// TOOLS ONLY per this round's own explicit scope decision (skills are
// purchased with points via the upgrade menu, not auto-"obtained"; pallet/
// ladder unlocks have no existing icon/name convention to reuse). The
// day-by-day tools arrays there are:
//   Day1: ['empty']                                              — no new tool
//   Day2: ['empty','powerGloves']                                — +力量手套
//   Day3: ['empty','powerGloves']                                — no new tool
//   Day4: ['empty','powerGloves','sprayCan','envelopeVacuum']    — +噴漆罐, +信封吸塵器
//   Day5: ['empty','powerGloves','sprayCan','envelopeVacuum','cargoHook'] — +捕貨鉤
//   Day6/Day7: unchanged from Day5 (daily-unlock-data.ts's own DAY6/DAY7 spread `...DAY5`)
// Order within a day matches the array order in daily-unlock-data.ts
// verbatim (spec: "不要自行新增、刪除或交換道具").
//
// Descriptions are short, accurate functional summaries written from each
// tool's own real implemented behavior (pallet-system.ts's power-gloves
// weight gating, spray-paint-system.ts's floor-decal marking, envelope-
// vacuum-system.ts's suck/blow range, cargo-hook-system.ts's grapple
// pickup) — no existing standalone "tool description" string exists
// anywhere in the codebase to copy verbatim (only per-UPGRADE descriptions
// in upgrade-data.ts, which describe the enhancement, not the base tool).
//
// `image` reuses each tool's own EXISTING emoji from
// tool-loadout-data.ts's TOOL_DEFINITIONS — the same icon already shown to
// the player in the real hotbar/loadout UI today. This project has no
// binary image assets anywhere (confirmed: zero .png/.jpg/.svg files in
// the whole repo, no public/ directory) — emoji is this codebase's own
// actual, non-placeholder visual-identity convention for tools, not a
// stand-in for art that doesn't exist yet.

export interface NewItemReward {
  id: string;
  name: string;
  description: string;
  /** An emoji string today (see this file's own top doc comment) — never
   * null. item-reward-ui.ts renders it as large text unless it looks like
   * a real image URL (starts with '/', 'http', or 'data:'), so a future
   * round can drop in real art per-item with zero control-flow changes. */
  image: string;
}

export interface DailyItemReward {
  day: number;
  items: NewItemReward[];
}

const DAY2_ITEM_REWARD: DailyItemReward = {
  day: 2,
  items: [
    {
      id: 'powerGloves',
      name: '力量手套',
      description: '可以搬運更重的托盤與大型貨物。',
      image: '🧤',
    },
  ],
};

const DAY4_ITEM_REWARD: DailyItemReward = {
  day: 4,
  items: [
    {
      id: 'sprayCan',
      name: '噴漆罐',
      description: '在地板噴漆做記號，方便標示與分類貨物區域；對準已上色區域按 E 可更換顏色。',
      image: '🎨',
    },
    {
      id: 'envelopeVacuum',
      name: '信封吸塵器',
      description: '可以在一定距離內吸取或吹送信封，不需要親自碰觸即可整理信件。',
      image: '🌪️',
    },
  ],
};

const DAY5_ITEM_REWARD: DailyItemReward = {
  day: 5,
  items: [
    {
      id: 'cargoHook',
      name: '捕貨鉤',
      description: '發射勾爪抓取遠處的貨物並拉回身邊，等級提升後可勾取的貨物種類更多。',
      image: '🪝',
    },
  ],
};

/** Day1/Day3/Day6/Day7 have no entry (no new tool that day per
 * daily-unlock-data.ts) — getDailyItemReward() returns an empty array for
 * them, which is exactly what suppresses the popup entirely (spec:
 * "沒有獎勵 → 不顯示空白UI") rather than showing an empty card. */
const DAILY_ITEM_REWARDS: Record<number, DailyItemReward> = {
  2: DAY2_ITEM_REWARD,
  4: DAY4_ITEM_REWARD,
  5: DAY5_ITEM_REWARD,
};

/** THE one place a day's reward list is read (mirrors
 * daily-unlock-data.ts's own getEffectiveDayUnlockConfig as "the one
 * lookup every caller uses" convention) — returns an empty array for any
 * day with no configured reward, never undefined, so callers never need a
 * defensive `?? []` of their own. */
export function getDailyItemReward(day: number): NewItemReward[] {
  return DAILY_ITEM_REWARDS[day]?.items ?? [];
}
