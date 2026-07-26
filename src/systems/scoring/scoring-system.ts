import { SettingsManager } from '../settings';
import { UNSHIPPED_PENALTY_PER_ITEM } from './scoring-data';
import { DepartureSettlement } from './scoring-types';

/**
 * Owns the departure settlement math (spec四-10: 成功出貨數量/未出貨數量/未
 * 出貨扣分/每日結算結果) — deliberately takes the already-scanned tallies as
 * plain numbers rather than scanning CargoSystem/VehicleSystem itself (spec:
 * "不得自行掃描場景。只讀取Cargo System與Vehicle System提供的狀態"); the
 * caller (VehicleControlSystem, which already walks dailyFlowSystem.
 * dailyCargoIds to physically pin shipped cargo) is the one that produces
 * those tallies.
 */
export class ScoringSystem {
  private settingsManager: SettingsManager;

  constructor(settingsManager: SettingsManager) {
    this.settingsManager = settingsManager;
  }

  /** Applies the unshipped penalty to the running score and returns the
   * settlement snapshot shown once all vehicles finish departing. */
  settleDeparture(total: number, shippedCorrect: number, unshipped: number): DepartureSettlement {
    const penalty = unshipped * UNSHIPPED_PENALTY_PER_ITEM;
    if (penalty > 0) this.settingsManager.addScore(-penalty);
    return {
      total,
      shipped: shippedCorrect,
      unshipped,
      penalty,
      finalScore: this.settingsManager.progress.score,
    };
  }
}
