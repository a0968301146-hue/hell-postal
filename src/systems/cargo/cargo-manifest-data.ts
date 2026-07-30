// Daily cargo manifest quotas — "Fix cargo throwing and rebalance daily
// manifest" round三/四. Replaces the old pure-weighted-random daily
// generation (DAILY_CARGO_CONFIG's per-category counts + a flat 50/50
// domestic/international coin-flip, see cargo-region-data.ts's now-removed
// pickCargoRegion) with a fixed per-category AND per-region quota, decided
// BEFORE any shape/preset is picked (spec三: "先決定分類與地區配額，再挑選外
// 型"). cargo-manifest-planner.ts is the ONE place these quotas are consumed
// — nobody else hand-derives a daily count from these numbers.
//
// Category totals still sum to 90 (spec: "貨物總量維持90件，不再是單純加權隨
// 機") — unchanged from DAILY_CARGO_CONFIG.total, just re-split.
import { CargoCategory } from './cargo-category-data';
import { CargoRegion } from './cargo-region-data';

export const DAILY_CARGO_CATEGORY_QUOTA: Record<CargoCategory, number> = {
  normal: 20,
  fragile: 20,
  large: 14,
  frozen: 20,
  live: 16,
};

/** Region sub-quota per category (spec三). Every category's domestic +
 * international must sum to its own DAILY_CARGO_CATEGORY_QUOTA entry above —
 * asserted at module load below rather than trusted silently, since a typo
 * here would otherwise only surface as a subtly-wrong daily manifest.
 * 'live' international is deliberately 0 (spec九: "海外活物目前仍不生成" —
 * no vehicle accepts region:'international' + category:'live', see
 * vehicle-data.ts's own doc comment on SEA_VEHICLE_BASE_CONFIGS). */
export const DAILY_CARGO_REGION_QUOTA: Record<CargoCategory, { domestic: number; international: number }> = {
  normal: { domestic: 10, international: 10 },
  fragile: { domestic: 10, international: 10 },
  large: { domestic: 7, international: 7 },
  frozen: { domestic: 4, international: 16 },
  live: { domestic: 16, international: 0 },
};

(Object.keys(DAILY_CARGO_CATEGORY_QUOTA) as CargoCategory[]).forEach((category) => {
  const region = DAILY_CARGO_REGION_QUOTA[category];
  const sum = region.domestic + region.international;
  if (sum !== DAILY_CARGO_CATEGORY_QUOTA[category]) {
    throw new Error(`cargo-manifest-data: region quota for "${category}" sums to ${sum}, expected ${DAILY_CARGO_CATEGORY_QUOTA[category]}`);
  }
});

/** No single CargoShapePreset may exceed this share of its own category's
 * daily count (spec三: "單一preset不得超過該分類當日數量的35%"). */
export const CARGO_MANIFEST_PRESET_CAP_RATIO = 0.35;

/** Generator-only vehicle capacity planning constants (spec四) — used
 * EXCLUSIVELY by cargo-manifest-planner.ts's capacity simulation, never by
 * vehicle-control-system.ts's real, player-facing loading/departure rules. */
export const CARGO_CAPACITY_SAFE_FILL_RATE = 0.55;
export const CARGO_CAPACITY_ITEM_VOLUME_MULTIPLIER = 1.35;

/** Absolute floor on a category's ACTUAL daily generated count, even if the
 * capacity-planning fallback chain (spec四 steps1-5) ever had to shrink a
 * category to relieve an overflowing vehicle (spec四 step5: "永遠保留最低生成
 * 量"). All comfortably below this round's real quotas above (20/20/16), so
 * under the numbers this file defines the fallback chain is expected to
 * never actually need to invoke this floor — see cargo-manifest-planner.ts's
 * own doc comment for the capacity math that confirms this. */
export const CARGO_CATEGORY_MIN_FLOOR: Partial<Record<CargoCategory, number>> = {
  fragile: 18,
  frozen: 16,
  live: 12,
};

export const CARGO_MANIFEST_CATEGORY_ORDER: CargoCategory[] = ['normal', 'fragile', 'large', 'frozen', 'live'];

export type { CargoRegion };
