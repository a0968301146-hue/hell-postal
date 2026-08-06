/** "Add freezer shelves and frozen cargo freshness system" round — the ONE
 * place coldValue's own constants/tier math live, shared by FreezerSystem
 * (per-frame decay/recovery), VehicleControlSystem (real departure
 * settlement tallying), and CompleteDayCheatSystem (test-cheat settlement
 * tallying) — never duplicated across those call sites. */

export const COLD_VALUE_MIN = 0;
export const COLD_VALUE_MAX = 100;
/** "冷凍貨物系統修改" round三: "不要所有地方都使用同一個下降速度" — replaces
 * the previous single COLD_VALUE_DECAY_PER_SECOND with one rate per
 * location, all applied whenever a frozen item's own `isInsideFreezerShelf`
 * is false. FreezerSystem's own resolveDecayRate() picks between these
 * based on the item's current held/vehicle/pallet/floor state each tick. */
export const COLD_VALUE_DECAY_HELD_PER_SECOND = 0.5;
export const COLD_VALUE_DECAY_FLOOR_PER_SECOND = 0.6;
export const COLD_VALUE_DECAY_PALLET_PER_SECOND = 0.5;
export const COLD_VALUE_DECAY_VEHICLE_PER_SECOND = 0.4;
/** spec四: "每秒 1%", capped at the item's own coldValueCap (see
 * nextColdValueCap below) — applied whenever `isInsideFreezerShelf` is
 * true. Recovery speed itself is unchanged this round. */
export const COLD_VALUE_RECOVERY_PER_SECOND = 1;

/** "冷藏值系統修改" round三: permanent quality cap — the first time coldValue
 * drops below a tier boundary (75/50/25), that boundary becomes the new
 * ceiling coldValue can ever recover back up to, even after being placed
 * back in a freezer shelf (spec: "只要貨物第一次掉過某個品質門檻，之後就算
 * 放回冷藏架，也只能恢復到該門檻"). Monotonically non-increasing — called
 * only on the decay path (never on recovery), with `currentCap` as the
 * floor so an already-lower cap is never raised back up by re-evaluating a
 * coldValue that hasn't dropped any further. */
export function nextColdValueCap(coldValue: number, currentCap: number): number {
  let cap = currentCap;
  if (coldValue < 75 && cap > 75) cap = 75;
  if (coldValue < 50 && cap > 50) cap = 50;
  if (coldValue < 25 && cap > 25) cap = 25;
  return cap;
}

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

/** "冷凍貨物系統修改" round一/二: the held-item slider's own warning-color
 * tiers (75以上 blue / 50~75 yellow / 25~50 orange / 25以下 red) — a
 * DIFFERENT, finer-grained boundary set than getColdValueTier's own
 * settlement-score tiers above (both happen to share the same 75/50/25
 * numbers, but this one is a pure UI concern, never read by scoring). */
export function coldValueTierColor(coldValue: number): string {
  if (coldValue >= 75) return '#2196f3'; // blue
  if (coldValue >= 50) return '#ffc107'; // yellow
  if (coldValue >= 25) return '#ff9800'; // orange
  return '#f44336'; // red
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
