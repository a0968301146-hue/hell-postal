import { SettingsManager } from '../settings';
import { UNSHIPPED_PENALTY_PER_ITEM, LOST_FOUND_MISSED_PENALTY, LOST_ITEM_UNSTORED_PENALTY_PER_ITEM } from './scoring-data';
import { DepartureSettlement, LostFoundSettlementInput, MailSettlementInput } from './scoring-types';
import { FrozenSettlementInput } from '../cargo/cold-value-data';
import { LiveSettlementInput } from '../cargo/living-cargo-data';

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
  /** Fired once, right before returning, with the exact settlement snapshot
   * this call produced ("Add bulletin board upgrade system" round spec四) —
   * UpgradeSystem's own hook into "how did today's shipping actually go",
   * without duplicating any of the scanning/penalty math above (spec: "不得
   * 自行掃描場景，只讀取Cargo/Vehicle/Scoring System提供的狀態"). Optional so
   * every pre-existing construction site (none pass it) keeps compiling
   * unchanged. */
  private onSettlement?: (settlement: DepartureSettlement) => void;

  constructor(settingsManager: SettingsManager, onSettlement?: (settlement: DepartureSettlement) => void) {
    this.settingsManager = settingsManager;
    this.onSettlement = onSettlement;
  }

  /** Applies the unshipped penalty, the missed-lost-found-NPC penalty, and
   * the per-unstored-lost-item penalty (the ONE place any of the three is
   * actually applied to the running score — see scoring-data.ts) and
   * returns the settlement snapshot shown once all vehicles finish
   * departing. `lostFound` is LostFoundSystem's own frozen-at-press-time
   * snapshot (spec七/八: 兩條獨立項目, computed once, not re-derived here). */
  settleDeparture(
    total: number, shippedCorrect: number, unshipped: number,
    lostFound: LostFoundSettlementInput, mail: MailSettlementInput, frozen: FrozenSettlementInput,
    live: LiveSettlementInput
  ): DepartureSettlement {
    const penalty = unshipped * UNSHIPPED_PENALTY_PER_ITEM;
    // "Add sequential lost-found visitors and held cargo feedback" round
    // 六: applies the SAME existing per-event penalty value once PER missed
    // NPC (0..DAILY_LOST_FOUND_NPC_COUNT), not just once per day — the
    // penalty VALUE itself (LOST_FOUND_MISSED_PENALTY) is unchanged.
    const lostFoundPenalty = lostFound.missedCount * LOST_FOUND_MISSED_PENALTY;
    const lostItemPenalty = lostFound.unstored * LOST_ITEM_UNSTORED_PENALTY_PER_ITEM;
    // Each unshipped envelope uses the SAME per-item penalty as regular
    // cargo (spec十一: "每封未寄出信件使用現有『每件未出貨扣分值』") — no
    // separate mail-specific constant, and the bag itself is never
    // penalized again on top (spec: "分類袋本身不可再額外扣一次").
    const mailPenalty = mail.unshipped * UNSHIPPED_PENALTY_PER_ITEM;
    // "Add freezer shelves and frozen cargo freshness system" round spec六
    // — a correctly-shipped frozen item at full (100%) freshness costs
    // nothing extra, same as any other correctly-shipped item; each lower
    // tier costs a FRACTION of the SAME UNSHIPPED_PENALTY_PER_ITEM used
    // everywhere else in this file, proportional to how much value tier was
    // lost (75%->25% lost, 50%->50% lost, 25%->75% lost) — reuses the one
    // existing per-item penalty magnitude rather than inventing a second,
    // frozen-only constant.
    const frozenPenalty = Math.round(
      (frozen.tier75 * 0.25 + frozen.tier50 * 0.5 + frozen.tier25 * 0.75) * UNSHIPPED_PENALTY_PER_ITEM
    );
    const totalPenalty = penalty + lostFoundPenalty + lostItemPenalty + mailPenalty + frozenPenalty;
    if (totalPenalty > 0) this.settingsManager.addScore(-totalPenalty);

    // "活物貨物系統" round spec六 — a BONUS (added, never subtracted): each
    // correctly-shipped live item earns up to ONE UNSHIPPED_PENALTY_PER_ITEM
    // (the same per-item unit reused everywhere else in this file), scaled
    // by its own calmValue tier's percentage (living-cargo-data.ts's
    // getCalmValueTier: 80+->100%, 60->95%, 40->90%, 20->80%, else->70%) —
    // reuses the SAME per-item magnitude, never a second bonus-only constant.
    const liveBonus = Math.round(
      (live.tier100 * 1.0 + live.tier95 * 0.95 + live.tier90 * 0.9 + live.tier80 * 0.8 + live.tier70 * 0.7)
      * UNSHIPPED_PENALTY_PER_ITEM
    );
    if (liveBonus > 0) this.settingsManager.addScore(liveBonus);

    const settlement: DepartureSettlement = {
      total,
      shipped: shippedCorrect,
      unshipped,
      penalty,
      lostFoundMissedCount: lostFound.missedCount,
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
      frozenTotal: frozen.total,
      frozenTier100: frozen.tier100,
      frozenTier75: frozen.tier75,
      frozenTier50: frozen.tier50,
      frozenTier25: frozen.tier25,
      frozenPenalty,
      liveTotal: live.total,
      liveTier100: live.tier100,
      liveTier95: live.tier95,
      liveTier90: live.tier90,
      liveTier80: live.tier80,
      liveTier70: live.tier70,
      liveBonus,
      finalScore: this.settingsManager.progress.score,
    };
    this.onSettlement?.(settlement);
    return settlement;
  }
}
