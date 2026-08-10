// Day 1～8 逐日解鎖資料架構 ("世界觀地區命名修正＋國家圖鑑＋Day 1～8 解鎖架構"
// round, spec四～六).
//
// Pure data structure only this round — NOT wired into DailyFlowSystem,
// ToolSystem, UpgradeSystem, or any spawn/manifest logic anywhere (spec七:
// "目前不要修改每日貨物生成數量／技能價格／技能數值／貨物比例／載具生成比
// 例／道具數值／每日詳細解鎖內容"). Every field beyond Day 1 is a genuinely
// empty placeholder ("待填") — the requester was explicit that specific
// content for Days 2～8 must NEVER be guessed, balanced, or invented here
// (spec六): no new skill/cargo/vehicle/tool may be invented to fill a slot,
// and Day 1's own skill specifics (which exact skills, their levels/costs/
// unlock method) are ALSO deliberately left as a free-text note rather than
// a concrete list, since the requester withheld those specifics too (spec
// 五: "技能種類/技能等級/費用/解鎖方式 暫時不要自行決定，等待後續資料").
//
// CargoCategory/ActiveTool/FROG_VEHICLE_CONFIG_ID are the SAME real,
// already-existing identifiers the live game itself uses (never a second
// hand-invented id scheme) — Day 1's own confirmed content (一般貨物/易碎貨
// 物/青蛙載具/空手) is expressed by referencing them directly, so this data
// can never silently drift from what those systems actually call the same
// things.
import { CargoCategory } from '../systems/cargo';
import { ActiveTool } from '../core/game-state';
import { FROG_VEHICLE_CONFIG_ID } from '../systems/vehicle';

export interface DayUnlockConfig {
  day: number;
  /** 貨物 — CargoCategory values that become available this day. */
  cargoTypes: CargoCategory[];
  /** 道具 — ActiveTool ids that become available ('empty' = 空手/no tool). */
  tools: ActiveTool[];
  /** 技能 — free-text note only (see file header doc comment for why this
   * is deliberately NOT a concrete UpgradeId list yet). */
  skillsNote: string;
  /** 載具 — VehicleConfig ids that become available. */
  vehicles: string[];
  /** 其他 — any other system unlocked this day, free text. */
  other: string[];
}

function emptyDay(day: number): DayUnlockConfig {
  return { day, cargoTypes: [], tools: [], skillsNote: '待填', vehicles: [], other: ['待填'] };
}

export const DAILY_UNLOCKS: Record<number, DayUnlockConfig> = {
  // Day 1 — the player's very first day of real logistics work (spec五).
  // Only ordinary/fragile cargo and the frog vehicle are unloadable at all
  // yet (matches vehicle-data.ts's own FROG_VEHICLE_CONFIG_ID acceptedCargo
  // Types, which already only accepts 'normal'+'fragile' — this Day 1 entry
  // is consistent with that existing configuration, not a new rule).
  1: {
    day: 1,
    cargoTypes: ['normal', 'fragile'],
    tools: ['empty'],
    skillsNote: '普通技能可以升級（因其他道具尚未解鎖，Day 1 可先讓玩家升級基本能力；不預先解鎖後期道具）。詳細技能種類／等級／費用／解鎖方式待補。',
    vehicles: [FROG_VEHICLE_CONFIG_ID],
    other: [],
  },
  2: emptyDay(2),
  3: emptyDay(3),
  4: emptyDay(4),
  5: emptyDay(5),
  6: emptyDay(6),
  7: emptyDay(7),
  8: emptyDay(8),
};

export function getDayUnlockConfig(day: number): DayUnlockConfig | undefined {
  return DAILY_UNLOCKS[day];
}
