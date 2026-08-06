/** "Add freezer shelves and frozen cargo freshness system" round — the ONE
 * place coldValue's own constants/tier math live, shared by FreezerSystem
 * (per-frame decay/recovery + HUD color), VehicleControlSystem (real
 * departure settlement tallying), and CompleteDayCheatSystem (test-cheat
 * settlement tallying) — never duplicated across those call sites. */

export const COLD_VALUE_MIN = 0;
export const COLD_VALUE_MAX = 100;
/** spec三: "每秒 0.25%" (~400 real seconds from 100% to 0%) — applied whenever
 * a frozen item's own `isInsideFreezerShelf` is false, regardless of WHERE
 * it currently is (floor/pallet/held/vehicle — spec三's own exhaustive
 * list). */
export const COLD_VALUE_DECAY_PER_SECOND = 0.25;
/** spec四: "每秒 1%", capped at COLD_VALUE_MAX — applied whenever
 * `isInsideFreezerShelf` is true. */
export const COLD_VALUE_RECOVERY_PER_SECOND = 1;

/** spec六: four FIXED stages, never a continuous ratio ("不是連續比例，採固定
 * 四階段") — the exact boundaries spec六's own worked examples confirm:
 * coldValue=68 (in [50,75)) -> 75%; coldValue=31 (in [25,50)) -> 50%;
 * coldValue=8 (in [0,25)) -> 25%. */
export type ColdValueTier = 100 | 75 | 50 | 25;

export function getColdValueTier(coldValue: number): ColdValueTier {
  if (coldValue >= 75) return 100;
  if (coldValue >= 50) return 75;
  if (coldValue >= 25) return 50;
  return 25;
}

/** The settlement-score MULTIPLIER for a tier (spec六's own "原本100分...得到
 * 75分" wording expressed as a fraction of whatever the item's own full
 * value would have been). */
export function coldValueTierMultiplier(coldValue: number): number {
  return getColdValueTier(coldValue) / 100;
}

/** spec七 UI color tiers — same four boundaries as getColdValueTier above
 * (100~75 綠, 75~50 黃, 50~25 橘, 25以下 紅), kept as its own function (rather
 * than a tier->color lookup keyed on getColdValueTier's return value) only
 * because 100~75 and 75~50 both map to different colors than 50~25/25以下
 * despite the SCORE tiers treating 100~75 as a single "full value" bracket —
 * the UI is a finer-grained warning signal, the score payout is a coarser
 * one; they intentionally read the same underlying number two different
 * ways rather than sharing one lookup. */
export function coldValueColor(coldValue: number): string {
  if (coldValue > 75) return '#4CAF50'; // green
  if (coldValue > 50) return '#FFEB3B'; // yellow
  if (coldValue > 25) return '#FF9800'; // orange
  return '#F44336'; // red
}

/** One departure's worth of frozen-cargo tier tallies (spec六) — the
 * contract ScoringSystem.settleDeparture() takes in, mirroring
 * LostFoundSettlementInput/MailSettlementInput's own "caller tallies, scoring
 * system only computes the penalty math" split (scoring-types.ts). Only
 * CORRECTLY-shipped frozen items are ever tallied here — an unshipped frozen
 * item is already penalized by the normal per-item unshipped penalty, same
 * as any other unshipped cargo, never double-counted here too. */
export interface FrozenSettlementInput {
  total: number;
  tier100: number;
  tier75: number;
  tier50: number;
  tier25: number;
}

export function createEmptyFrozenSettlementInput(): FrozenSettlementInput {
  return { total: 0, tier100: 0, tier75: 0, tier50: 0, tier25: 0 };
}

/** Mutates `tally` in place — the ONE place a coldValue reading turns into a
 * tier bucket increment, called from both the real departure scan
 * (vehicle-control-system.ts) and the test-cheat's own equivalent scan
 * (complete-day-cheat-system.ts), so the two can never disagree about
 * bucket boundaries. */
export function tallyFrozenColdValue(tally: FrozenSettlementInput, coldValue: number): void {
  tally.total++;
  switch (getColdValueTier(coldValue)) {
    case 100: tally.tier100++; break;
    case 75: tally.tier75++; break;
    case 50: tally.tier50++; break;
    case 25: tally.tier25++; break;
  }
}
