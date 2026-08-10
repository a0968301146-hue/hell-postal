// Day 1～7 逐日內容與解鎖資料架構 ("Day 1～7 每日內容與解鎖規格" round, extended
// by "Day 1～7 每日系統完整實作" round) — THE single source of truth every
// daily-content system reads from (spec十八: "優先讓每日設定集中在單一資料來
// 源，避免不同系統各自硬編碼Day1～7數值").
//
// Every number/list below is copied verbatim from the requester's own
// spec — never guessed, balanced, or invented (spec一/二/三). Day 8 is
// deliberately left untouched (spec十四: "Day 8 不應重新生成大量普通貨物／信
// 件／失物招領...不要破壞目前已完成的蛋糕流程") — getEffectiveDayUnlockConfig()
// below falls back to Day 7's own (already fully-unlocked-by-Day5) config for
// day>=8 purely so the EXISTING, already-working Day 8 giant-cake flow never
// regresses — this is not new Day 8 content, just "don't apply a Day1-7
// restriction to a day this round was told not to touch".
//
// "Day 1～7 每日系統完整實作" round: `dailyTotals.lostFoundNpcCount` below was
// REVISED from the previous round's separate, smaller "失物招領人數" figures
// (3/5/7/9/10/13/15) to this round's own explicit "每天按照指定人數" values
// (5/8/10/13/15/18/20, spec八) — the requester's new message frames these as
// the authoritative NPC-generation count (spec八 rule5: "不得因案例不足而少生
// 成失物招領", talking specifically about case/NPC draws, never about decoy
// items, which aren't drawn from LOST_FOUND_CASES at all), superseding the
// previous round's smaller numbers. `lostFoundTotal` is kept equal to
// `lostFoundNpcCount` for backward-informational consistency (the true daily
// total INCLUDING decoys is inherently dynamic — LostFoundSystem computes it
// live as `todaysQueue.length + todaysDecoyItemIds.length` — never a fixed
// config number).
//
// Cumulative-unlock rule (spec八): once something opens on day N it stays
// open every subsequent day, even if a LATER day's own bullet list happens
// to omit it (the requester's own spec text does this twice — 貨物托盤 is
// listed Day 2 only, omitted from Day 3/4's own lists; 固定繩索 is listed
// Day 4 only, omitted from Day 5/6/7's own lists). Every list below is
// therefore already the CUMULATIVE set for that day (i.e. what the day
// actually has open), not a transcription of that day's own literal bullet
// list — so nothing downstream needs to re-derive the union itself.
//
// Real, already-existing ids are used throughout (never a second hand-
// invented id scheme, spec九): CargoCategory/MailRegion/ActiveTool/UpgradeId/
// VehicleConfig ids are the SAME ones cargo/mail/tool/upgrade/vehicle
// systems already use — 石頭人=land-rockgiant-01 (石頭巨人), 托盤強化=
// palletInventoryLevel (托盤庫存擴充), 勾貨勾=cargoHookLevel, confirmed with
// the requester.
// Deliberately importing from each system's own narrow data file (never the
// barrel index.ts, and never a system CLASS file) — daily-unlock-data.ts is
// read by mail-system.ts/vehicle-control-system.ts/pallet-system.ts/
// upgrade-system.ts themselves, so pulling in a barrel that re-exports those
// same classes would create a real import cycle (confirmed via
// `npx madge --circular` during this round — fixed by switching every import
// below to its most specific source file).
import { CargoCategory } from '../systems/cargo/cargo-category-data';
import { ActiveTool } from '../core/game-state';
import { MailRegion } from '../systems/mail/mail-types';
import { UpgradeId } from '../systems/upgrade/upgrade-types';
import { FROG_VEHICLE_CONFIG_ID } from '../systems/vehicle/vehicle-data';

/** The other five VehicleConfig ids, spelled out here the same way
 * FROG_VEHICLE_CONFIG_ID already is (vehicle-data.ts's own literal-id
 * convention) — avoids importing the full VehicleConfig arrays just to read
 * five id strings. */
const ROCKGIANT_VEHICLE_CONFIG_ID = 'land-rockgiant-01';
const SNAIL_VEHICLE_CONFIG_ID = 'land-snail-01';
const RAY_VEHICLE_CONFIG_ID = 'sea-ray-01';
const TURTLE_VEHICLE_CONFIG_ID = 'sea-turtle-01';
const KRAKEN_VEHICLE_CONFIG_ID = 'sea-kraken-01';

export interface DailyTotals {
  /** 包裹總量 — today's full daily cargo count (spec六 from the previous
   * round: "每日總量是當天完整物流流程的總數"). "Day 1～7 每日系統完整實作"
   * round: wired for real into cargo-manifest-planner.ts's
   * buildDailyCargoManifest() — that day's total item count, drawn uniformly
   * at random across whatever (category, region) combos `cargoCategoriesByRegion`
   * below unlocks that day (spec五: no per-category ratio was ever specified,
   * so an even draw across unlocked combos is the actual implementation). */
  cargoTotal: number;
  /** 信件總量 — wired for real into mail-system.ts's spawnTodaysEnvelopes
   * (safe to parameterize: that method already does a pure even-split
   * across whichever destinations are open, no ratio to invent). */
  mailTotal: number;
  /** 失物招領 — informational only; see lostFoundNpcCount's own doc comment
   * for why this is kept numerically equal to it rather than separately
   * wired anywhere. */
  lostFoundTotal: number;
  /** 失物招領人數 — "Day 1～7 每日系統完整實作" round: wired for real into
   * lost-found-system.ts's prepareDailyCases() (draws this many DISTINCT
   * cases from the now-20-entry LOST_FOUND_CASES pool, spec八). */
  lostFoundNpcCount: number;
}

export interface DayUnlockConfig {
  day: number;
  dailyTotals: DailyTotals;
  /** 開放貨物種類 — per region (spec: 國內／國外 differ starting Day 3). Wired
   * for real into cargo-manifest-planner.ts (see dailyTotals.cargoTotal's own
   * doc comment) — every draw is uniform across whatever this list allows
   * that day, including 'live'+international (Day 5-7) — 海龜 (sea-turtle-01)
   * was reassigned from 大型+一般 to 大型+活物 specifically to make this
   * combination shippable (vehicle-data.ts's own SEA_VEHICLE_BASE_CONFIGS
   * doc comment). */
  cargoCategoriesByRegion: { domestic: CargoCategory[]; international: CargoCategory[] };
  /** 開放信封種類 — wired for real into mail-system.ts (see mailTotal's own
   * doc comment). */
  mailRegions: MailRegion[];
  /** 開放載具 — VehicleConfig ids, wired for real into
   * VehicleControlSystem.pressCallButton() (only spawns slots whose config
   * id appears here). */
  vehicles: string[];
  /** 開放道具 — ActiveTool ids (hotbar-configurable tools only; 'empty' is
   * always implicitly available and never gated). Wired for real into
   * ToolSystem.trySelect()/ToolLoadoutMenuUI (blocks equipping/selecting a
   * tool not yet in this list). */
  tools: ActiveTool[];
  /** 貨物托盤 — NOT part of ActiveTool (a separate, always-on-until-now
   * system, PalletSystem) — its own cumulative flag, wired for real into
   * PalletSystem.pickUp(). */
  palletUnlocked: boolean;
  /** 梯子 — same "separate system, own flag" treatment as palletUnlocked
   * above, wired for real into LadderSystem.pickUp()/canPickUp(). */
  ladderUnlocked: boolean;
  /** 開放技能 — UpgradeId list, wired for real into
   * UpgradeSystem.purchaseUpgrade() (blocks purchasing a skill not yet in
   * this list; existing costs/levelEffects are completely untouched,
   * spec十.8). */
  skills: UpgradeId[];
}

/** Day 1 — spec: 包裹20／信件10／失物招領5／人數3. */
const DAY1: DayUnlockConfig = {
  day: 1,
  dailyTotals: { cargoTotal: 20, mailTotal: 10, lostFoundTotal: 5, lostFoundNpcCount: 5 },
  cargoCategoriesByRegion: { domestic: ['normal', 'fragile'], international: [] },
  mailRegions: ['domestic'],
  vehicles: [FROG_VEHICLE_CONFIG_ID],
  tools: ['empty'],
  palletUnlocked: false,
  ladderUnlocked: false,
  skills: ['moveSpeed', 'similarCargoSense', 'multiCarry'],
};

/** Day 2 — spec: 包裹40／信件20／失物招領8／人數5. 新增：大型貨物、石頭人載
 * 具、貨物托盤／力量手套道具、信封搬運技能. */
const DAY2: DayUnlockConfig = {
  day: 2,
  dailyTotals: { cargoTotal: 40, mailTotal: 20, lostFoundTotal: 8, lostFoundNpcCount: 8 },
  cargoCategoriesByRegion: { domestic: ['normal', 'fragile', 'large'], international: [] },
  mailRegions: ['domestic'],
  vehicles: [FROG_VEHICLE_CONFIG_ID, ROCKGIANT_VEHICLE_CONFIG_ID],
  tools: ['empty', 'powerGloves'],
  palletUnlocked: true,
  ladderUnlocked: false,
  skills: ['moveSpeed', 'similarCargoSense', 'multiCarry', 'envelopeCarryLevel'],
};

/** Day 3 — spec: 包裹50／信件30／失物招領10／人數7. 新增：國外貨物／信封目
 * 的地、魟魚／海龜載具、梯子道具、重物適應／力量手套強化技能. 貨物托盤（Day
 * 2開放）在本日spec自身列表中被省略，依累積規則(spec八)持續保持開放。 */
const DAY3: DayUnlockConfig = {
  day: 3,
  dailyTotals: { cargoTotal: 50, mailTotal: 30, lostFoundTotal: 10, lostFoundNpcCount: 10 },
  cargoCategoriesByRegion: {
    domestic: ['normal', 'fragile', 'large'],
    international: ['normal', 'fragile', 'large'],
  },
  mailRegions: ['domestic', 'international'],
  vehicles: [FROG_VEHICLE_CONFIG_ID, ROCKGIANT_VEHICLE_CONFIG_ID, RAY_VEHICLE_CONFIG_ID, TURTLE_VEHICLE_CONFIG_ID],
  tools: ['empty', 'powerGloves'],
  palletUnlocked: true,
  ladderUnlocked: true,
  skills: ['moveSpeed', 'similarCargoSense', 'multiCarry', 'envelopeCarryLevel', 'heavyHandling', 'powerGlovesUpgrade'],
};

/** Day 4 — spec: 包裹60／信件30／失物招領13／人數9. 新增：冷凍貨物、蝸牛／克
 * 拉肯載具（六台載具集滿）、噴漆／信封吸塵器道具、托盤強化／固定繩索／信封吸
 * 塵器強化技能. */
const DAY4: DayUnlockConfig = {
  day: 4,
  dailyTotals: { cargoTotal: 60, mailTotal: 30, lostFoundTotal: 13, lostFoundNpcCount: 13 },
  cargoCategoriesByRegion: {
    domestic: ['normal', 'fragile', 'large', 'frozen'],
    international: ['normal', 'fragile', 'large', 'frozen'],
  },
  mailRegions: ['domestic', 'international'],
  vehicles: [
    FROG_VEHICLE_CONFIG_ID, ROCKGIANT_VEHICLE_CONFIG_ID, RAY_VEHICLE_CONFIG_ID, TURTLE_VEHICLE_CONFIG_ID,
    SNAIL_VEHICLE_CONFIG_ID, KRAKEN_VEHICLE_CONFIG_ID,
  ],
  tools: ['empty', 'powerGloves', 'sprayCan', 'envelopeVacuum'],
  palletUnlocked: true,
  ladderUnlocked: true,
  skills: [
    'moveSpeed', 'similarCargoSense', 'multiCarry', 'envelopeCarryLevel', 'heavyHandling', 'powerGlovesUpgrade',
    'palletInventoryLevel', 'ropeStrap', 'envelopeVacuumLevel',
  ],
};

/** Day 5 — spec: 包裹70／信件30／失物招領15／人數10. 新增：活物貨物、勾貨勾
 * 道具／技能（技能與道具集滿）. 固定繩索（Day 4開放）在本日spec自身列表中被
 * 省略，依累積規則(spec八)持續保持開放 — 累積技能集合在本日恰好等於現有全部
 * 10項UpgradeDefinition，驗證spec本身內部一致。 */
const DAY5: DayUnlockConfig = {
  day: 5,
  dailyTotals: { cargoTotal: 70, mailTotal: 30, lostFoundTotal: 15, lostFoundNpcCount: 15 },
  cargoCategoriesByRegion: {
    domestic: ['normal', 'fragile', 'large', 'frozen', 'live'],
    international: ['normal', 'fragile', 'large', 'frozen', 'live'],
  },
  mailRegions: ['domestic', 'international'],
  vehicles: [
    FROG_VEHICLE_CONFIG_ID, ROCKGIANT_VEHICLE_CONFIG_ID, RAY_VEHICLE_CONFIG_ID, TURTLE_VEHICLE_CONFIG_ID,
    SNAIL_VEHICLE_CONFIG_ID, KRAKEN_VEHICLE_CONFIG_ID,
  ],
  tools: ['empty', 'powerGloves', 'sprayCan', 'envelopeVacuum', 'cargoHook'],
  palletUnlocked: true,
  ladderUnlocked: true,
  skills: [
    'moveSpeed', 'similarCargoSense', 'multiCarry', 'envelopeCarryLevel', 'heavyHandling', 'powerGlovesUpgrade',
    'palletInventoryLevel', 'ropeStrap', 'envelopeVacuumLevel', 'cargoHookLevel',
  ],
};

/** Day 6 — spec: 包裹80／信件40／失物招領18／人數13；貨物／信封／載具／道具／
 * 技能皆與Day5相同列表. */
const DAY6: DayUnlockConfig = {
  ...DAY5,
  day: 6,
  dailyTotals: { cargoTotal: 80, mailTotal: 40, lostFoundTotal: 18, lostFoundNpcCount: 18 },
};

/** Day 7 — spec: 包裹90／信件50／失物招領20／人數15；貨物／信封／載具／道具／
 * 技能皆與Day5/6相同列表. */
const DAY7: DayUnlockConfig = {
  ...DAY5,
  day: 7,
  dailyTotals: { cargoTotal: 90, mailTotal: 50, lostFoundTotal: 20, lostFoundNpcCount: 20 },
};

export const DAILY_UNLOCKS: Record<number, DayUnlockConfig> = {
  1: DAY1, 2: DAY2, 3: DAY3, 4: DAY4, 5: DAY5, 6: DAY6, 7: DAY7,
};

export function getDayUnlockConfig(day: number): DayUnlockConfig | undefined {
  return DAILY_UNLOCKS[day];
}

/** THE lookup every gating system actually calls (never DAILY_UNLOCKS[day]
 * directly) — clamps day 8+ down to Day 7's own config (see this file's
 * header doc comment for why: Day 8 is out of this round's scope, spec八/
 * 九, and falling back to Day 7's already-fully-unlocked state is what keeps
 * the existing, already-working Day 8 giant-cake flow from regressing,
 * spec十.7). Also clamps a hypothetical day<1 down to Day 1, purely
 * defensive. */
export function getEffectiveDayUnlockConfig(day: number): DayUnlockConfig {
  const clamped = Math.max(1, Math.min(day, 7));
  return DAILY_UNLOCKS[clamped];
}

export function isMailRegionUnlockedOnDay(region: MailRegion, day: number): boolean {
  return getEffectiveDayUnlockConfig(day).mailRegions.includes(region);
}

export function getDailyMailTotal(day: number): number {
  return getEffectiveDayUnlockConfig(day).dailyTotals.mailTotal;
}

export function getDailyLostFoundNpcCount(day: number): number {
  return getEffectiveDayUnlockConfig(day).dailyTotals.lostFoundNpcCount;
}

export function isVehicleUnlockedOnDay(vehicleId: string, day: number): boolean {
  return getEffectiveDayUnlockConfig(day).vehicles.includes(vehicleId);
}

/** 'empty' (bare hands) is never gated — only the four ConfigurableTool ids
 * are ever checked against the day's own list. */
export function isToolUnlockedOnDay(tool: ActiveTool, day: number): boolean {
  if (tool === 'empty') return true;
  return getEffectiveDayUnlockConfig(day).tools.includes(tool);
}

export function isPalletUnlockedOnDay(day: number): boolean {
  return getEffectiveDayUnlockConfig(day).palletUnlocked;
}

export function isLadderUnlockedOnDay(day: number): boolean {
  return getEffectiveDayUnlockConfig(day).ladderUnlocked;
}

export function isSkillUnlockedOnDay(id: UpgradeId, day: number): boolean {
  return getEffectiveDayUnlockConfig(day).skills.includes(id);
}
