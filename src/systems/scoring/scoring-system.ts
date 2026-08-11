import { SettingsManager } from '../settings';
import { UNSHIPPED_PENALTY_PER_ITEM, LOST_FOUND_MISSED_PENALTY, LOST_ITEM_UNSTORED_PENALTY_PER_ITEM } from './scoring-data';
import { DepartureSettlement, LostFoundSettlementInput, MailSettlementInput } from './scoring-types';
import { FrozenSettlementInput } from '../cargo/cold-value-data';
import { LiveSettlementInput } from '../cargo/living-cargo-data';
// Imported directly from the concrete file (not the '../upgrade' barrel,
// which also pulls in UpgradeSystem/UpgradeMenuUI and their own much wider
// import graphs) — this file only needs the one pure formula, matching this
// codebase's established "avoid a barrel-cycle risk" convention elsewhere.
import { computeSettlementScoreDelta } from '../upgrade/upgrade-data';

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
    // "統一結算分數" round — the REAL settlement-score currency's own
    // penalty scope deliberately excludes frozenPenalty (matches
    // UpgradeSystem.recordDepartureSettlement's own penaltyTotal exactly —
    // frozen-freshness scoring stays entirely on the legacy progress.score
    // track above, untouched by this round's spec against changing scoring
    // RULES). Used below for `finalScore`, never for the addScore() call
    // above (that still applies the full totalPenalty, including
    // frozenPenalty, to progress.score exactly as before).
    const settlementPenaltyTotal = penalty + lostFoundPenalty + lostItemPenalty + mailPenalty;

    // "活物安撫值規格" round spec七 — THREE fixed tiers (75~100% "舒服"
    // ->110%／50~74% "焦慮"->100%／0~49% "害怕"->85%), unified with the UI's
    // own color boundaries. Each tier's multiplier is applied as a DELTA off
    // neutral (100%) against the SAME per-item unit reused everywhere else
    // in this file (UNSHIPPED_PENALTY_PER_ITEM) — 舒服 nets a small bonus,
    // 焦慮 nets exactly zero, 害怕 nets a small PENALTY (0.85 < 1.0), so
    // `liveBonus` can be negative and is applied unconditionally, never
    // gated to positive-only like the old 5-tier bonus-only design.
    const liveBonus = Math.round(
      (live.comfortableCount * 0.10 + live.anxiousCount * 0 + live.scaredCount * -0.15)
      * UNSHIPPED_PENALTY_PER_ITEM
    );
    if (liveBonus !== 0) this.settingsManager.addScore(liveBonus);

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
      liveComfortableCount: live.comfortableCount,
      liveAnxiousCount: live.anxiousCount,
      liveScaredCount: live.scaredCount,
      liveBonus,
      // "統一結算分數" round spec: the settlement UI's own "當日最終分數"
      // must read from the SAME currency purchaseUpgrade() spends
      // (availableSettlementScore), never the separate, never-reset-on-
      // new-game settingsManager.progress.score that used to back this
      // field — computeSettlementScoreDelta is the ONE formula this and
      // UpgradeSystem.recordDepartureSettlement both use, so the two can
      // never disagree. This is a PREVIEW of today's own net contribution
      // (floored at 0, matching settleDay's own floor) — it does not read
      // availableSettlementScore itself, since that only actually updates
      // later, once advanceToNextDay()'s settleDay() call runs (spec五's
      // own flow: 分數正式加入 availableSettlementScore happens AFTER 繼續,
      // not at this settlement-snapshot moment).
      finalScore: computeSettlementScoreDelta(shippedCorrect, mail.shipped, settlementPenaltyTotal),
    };
    this.onSettlement?.(settlement);
    return settlement;
  }
}
