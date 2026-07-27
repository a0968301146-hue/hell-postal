import { SettingsManager } from '../settings';
import { UNSHIPPED_PENALTY_PER_ITEM, LOST_FOUND_MISSED_PENALTY, LOST_ITEM_UNSTORED_PENALTY_PER_ITEM } from './scoring-data';
import { DepartureSettlement, LostFoundSettlementInput, MailSettlementInput } from './scoring-types';

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

  /** Applies the unshipped penalty, the missed-lost-found-NPC penalty, and
   * the per-unstored-lost-item penalty (the ONE place any of the three is
   * actually applied to the running score — see scoring-data.ts) and
   * returns the settlement snapshot shown once all vehicles finish
   * departing. `lostFound` is LostFoundSystem's own frozen-at-press-time
   * snapshot (spec七/八: 兩條獨立項目, computed once, not re-derived here). */
  settleDeparture(
    total: number, shippedCorrect: number, unshipped: number,
    lostFound: LostFoundSettlementInput, mail: MailSettlementInput
  ): DepartureSettlement {
    const penalty = unshipped * UNSHIPPED_PENALTY_PER_ITEM;
    const lostFoundPenalty = lostFound.missed ? LOST_FOUND_MISSED_PENALTY : 0;
    const lostItemPenalty = lostFound.unstored * LOST_ITEM_UNSTORED_PENALTY_PER_ITEM;
    // Each unshipped envelope uses the SAME per-item penalty as regular
    // cargo (spec十一: "每封未寄出信件使用現有『每件未出貨扣分值』") — no
    // separate mail-specific constant, and the bag itself is never
    // penalized again on top (spec: "分類袋本身不可再額外扣一次").
    const mailPenalty = mail.unshipped * UNSHIPPED_PENALTY_PER_ITEM;
    const totalPenalty = penalty + lostFoundPenalty + lostItemPenalty + mailPenalty;
    if (totalPenalty > 0) this.settingsManager.addScore(-totalPenalty);
    return {
      total,
      shipped: shippedCorrect,
      unshipped,
      penalty,
      lostFoundMissed: lostFound.missed,
      lostFoundPenalty,
      lostItemTotal: lostFound.total,
      lostItemHandedOver: lostFound.handedOver,
      lostItemStoredCount: lostFound.stored,
      lostItemUnstoredCount: lostFound.unstored,
      lostItemPenalty,
      mailTotal: mail.total,
      mailShipped: mail.shipped,
      mailUnshipped: mail.unshipped,
      mailPenalty,
      finalScore: this.settingsManager.progress.score,
    };
  }
}
