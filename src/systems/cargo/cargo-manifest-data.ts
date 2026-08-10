// Daily cargo manifest constants — "Fix cargo throwing and rebalance daily
// manifest" round三/四 originally introduced a fixed per-category+per-region
// quota here; "Day 1～7 每日系統完整實作" round removed it entirely (spec三:
// "不得再使用目前固定 90 件的邏輯") — the daily TOTAL and which (category,
// region) combinations are even allowed now come from
// `daily-unlock-data.ts`'s `getEffectiveDayUnlockConfig(currentDay)` (spec
// 十八: "單一資料來源"), with cargo-manifest-planner.ts drawing each of that
// day's items uniformly at random from the day's own unlocked combos (spec
// 五: "從當日已解鎖貨物種類中隨機生成" — no per-category ratio is specified by
// the requester, so an even random draw across unlocked combos is what's
// actually implemented, not a hand-tuned split). Only the preset-variety cap
// below survives from the old quota system — it's a per-manifest-run
// property, independent of how the day's total/category counts are decided.
import { CargoCategory } from './cargo-category-data';
import { CargoRegion } from './cargo-region-data';

/** No single CargoShapePreset may exceed this share of its own category's
 * daily count within one manifest (spec三 from the earlier "rebalance daily
 * manifest" round: "單一preset不得超過該分類當日數量的35%") — still applied by
 * cargo-manifest-planner.ts's selectPresetsForCategory, now against
 * whatever count each category actually drew for the day rather than a
 * fixed quota. */
export const CARGO_MANIFEST_PRESET_CAP_RATIO = 0.35;

/** Generator-only vehicle capacity planning constants (spec四 from the
 * earlier "rebalance daily manifest" round) — used EXCLUSIVELY by
 * cargo-manifest-planner.ts's capacity simulation, never by
 * vehicle-control-system.ts's real, player-facing loading/departure rules. */
export const CARGO_CAPACITY_SAFE_FILL_RATE = 0.55;
export const CARGO_CAPACITY_ITEM_VOLUME_MULTIPLIER = 1.35;

/** Canonical iteration order — used only to keep the dev-mode capacity-plan
 * console log's category grouping stable/readable; no longer drives actual
 * generation counts (see this file's own header doc comment). */
export const CARGO_MANIFEST_CATEGORY_ORDER: CargoCategory[] = ['normal', 'fragile', 'large', 'frozen', 'live'];

export type { CargoRegion };
