import { LocalStorageAdapter } from '../../adapters/local-storage/local-storage-adapter';
import { DepartureSettlement } from '../scoring';
import { PickupSystem } from '../interaction/pickup-system';
import { PlayerController } from '../player';
import { UpgradeId, UpgradeSaveState, UpgradeDefinition } from './upgrade-types';
import {
  UPGRADE_DEFINITIONS, getUpgradeDefinition, UPGRADE_POINT_REWARD_PER_SHIPPED_ITEM,
  TEST_STARTING_UPGRADE_POINTS, TEST_GRANT_VERSION,
} from './upgrade-data';

const UPGRADE_STORAGE_KEY = 'hp_manual_upgrades_v1';

function createDefaultUpgradeSaveState(): UpgradeSaveState {
  return {
    // TEMPORARY TEST GRANT — remove before public demo (spec六: "新存檔／
    // 清除存檔後，初始 upgradePoints 為 1000"). testGrantVersion is already
    // current here, so applyTestGrantIfNeeded() below is a no-op for a
    // brand-new save — it only ever does anything for a save that predates
    // this field.
    upgradePoints: TEST_STARTING_UPGRADE_POINTS,
    levels: { multiCarry: 0, heavyHandling: 0, moveSpeed: 0, similarCargoSense: 0 },
    settledDayId: null,
    testGrantVersion: TEST_GRANT_VERSION,
  };
}

/** Field-by-field fallback to defaults for any missing/corrupt field —
 * mirrors settings-manager.ts's own mergeProgress/mergeSettings pattern
 * exactly (spec六: "舊存檔沒有升級資料時，需以預設值安全fallback，不能報
 * 錯"). Levels are additionally clamped against each definition's own
 * maxLevel so a hand-edited or stale save can never apply an out-of-range
 * level. */
function mergeUpgradeSaveState(saved: Partial<UpgradeSaveState> | null): UpgradeSaveState {
  const base = createDefaultUpgradeSaveState();
  if (!saved) return base;

  const savedLevels = saved.levels ?? {};
  const levels = { ...base.levels };
  for (const def of UPGRADE_DEFINITIONS) {
    const lvl = (savedLevels as Record<string, unknown>)[def.id];
    levels[def.id] = typeof lvl === 'number' && lvl >= 0 && lvl <= def.maxLevel ? lvl : 0;
  }

  return {
    upgradePoints: typeof saved.upgradePoints === 'number' && saved.upgradePoints >= 0 ? saved.upgradePoints : base.upgradePoints,
    levels,
    settledDayId: typeof saved.settledDayId === 'number' ? saved.settledDayId : base.settledDayId,
    // TEMPORARY TEST GRANT — remove before public demo. A save written
    // before this field existed has `saved.testGrantVersion === undefined`,
    // which falls through to null here — applyTestGrantIfNeeded() reads
    // exactly that null as "not yet applied to this save".
    testGrantVersion: typeof saved.testGrantVersion === 'number' ? saved.testGrantVersion : null,
  };
}

/**
 * Owns upgrade points, per-upgrade levels, purchasing, and their save state
 * (spec七: "UpgradeSystem 擁有點數/等級/購買/效果套用/存讀檔"). Applies each
 * upgrade's gameplay effect ONLY through the narrow public setters
 * PickupSystem/PlayerController already expose for this purpose — never
 * reaches into their private state (spec三: "UI與升級系統都不得直接修改
 * PlayerSystem或PickupSystem的私有狀態"). Effects are always recomputed
 * fresh from the CURRENT level (never incremented on top of a previous
 * application), so re-applying on load or after every purchase can never
 * compound across page refreshes (spec六).
 */
export class UpgradeSystem {
  private storage = new LocalStorageAdapter();
  private state: UpgradeSaveState;
  private pickupSystem: PickupSystem;
  private playerController: PlayerController;
  /** This day's accumulated (shipped*reward - penalties) tally across
   * however many departures settle before the day actually ends — consumed
   * exactly once by settleDay() and reset to 0 immediately after (spec四). */
  private pendingDayScore = 0;

  constructor(pickupSystem: PickupSystem, playerController: PlayerController) {
    this.pickupSystem = pickupSystem;
    this.playerController = playerController;
    this.state = mergeUpgradeSaveState(this.storage.getJSON<UpgradeSaveState>(UPGRADE_STORAGE_KEY));
    this.applyTestGrantIfNeeded();
    this.applyAllEffects();
  }

  // TEMPORARY TEST GRANT — remove before public demo. One-time migration
  // (spec六): a save that predates TEST_GRANT_VERSION gets bumped up to at
  // least TEST_STARTING_UPGRADE_POINTS, exactly once — saved immediately so
  // a later reload's testGrantVersion check already matches and skips this
  // entirely (spec: "之後重新整理不得重複補點"; unrelated to settledDayId's
  // own once-per-DAY gate, this is once-per-SAVE). A brand-new save is
  // already at TEST_STARTING_UPGRADE_POINTS with testGrantVersion already
  // current (see createDefaultUpgradeSaveState), so this is a no-op for it.
  private applyTestGrantIfNeeded(): void {
    if (this.state.testGrantVersion === TEST_GRANT_VERSION) return;
    this.state.upgradePoints = Math.max(this.state.upgradePoints, TEST_STARTING_UPGRADE_POINTS);
    this.state.testGrantVersion = TEST_GRANT_VERSION;
    this.save();
  }

  get upgradePoints(): number {
    return this.state.upgradePoints;
  }

  getLevel(id: UpgradeId): number {
    return this.state.levels[id];
  }

  getDefinitions(): UpgradeDefinition[] {
    return UPGRADE_DEFINITIONS;
  }

  /** Cost of the NEXT level, or null once maxed. */
  getNextCost(id: UpgradeId): number | null {
    const def = getUpgradeDefinition(id);
    const level = this.state.levels[id];
    if (level >= def.maxLevel) return null;
    return def.costs[level];
  }

  isMaxed(id: UpgradeId): boolean {
    const def = getUpgradeDefinition(id);
    return this.state.levels[id] >= def.maxLevel;
  }

  /** The ONLY way UpgradeMenuUI (or anything else) may change a level —
   * deducts points, blocks on insufficient points or an already-maxed
   * upgrade, and never touches any historical settlement record (spec四). */
  purchaseUpgrade(id: UpgradeId): boolean {
    const def = getUpgradeDefinition(id);
    const level = this.state.levels[id];
    if (level >= def.maxLevel) return false;
    const cost = def.costs[level];
    if (this.state.upgradePoints < cost) return false;

    this.state.upgradePoints -= cost;
    this.state.levels[id] = level + 1;
    this.applyEffect(id);
    this.save();
    return true;
  }

  /** Wired (via ScoringSystem's own onSettlement callback, see
   * create-game-systems.ts) to fire once per departure settlement —
   * accumulates purely from the numbers ScoringSystem already computed for
   * THIS departure, never re-scanning cargo/vehicle state itself (spec:
   * "不得自行掃描場景"). */
  recordDepartureSettlement(settlement: DepartureSettlement): void {
    const shippedTotal = settlement.shipped + settlement.mailShipped;
    const penaltyTotal = settlement.penalty + settlement.lostFoundPenalty + settlement.lostItemPenalty + settlement.mailPenalty;
    this.pendingDayScore += shippedTotal * UPGRADE_POINT_REWARD_PER_SHIPPED_ITEM - penaltyTotal;
  }

  /** Wired to DailyFlowSystem's own onDayCompleted(finishedDay) hook —
   * converts this.pendingDayScore into points exactly once per finishedDay
   * (spec四: "每日結算後只發放一次，重新整理頁面不能重複發放"), guarded by
   * state.settledDayId so a stale/duplicate fire for a day already
   * processed is a no-op. Actual increase is max(0, dayScore) — a bad day
   * never deducts previously-earned points (spec四). */
  settleDay(finishedDay: number): void {
    if (this.state.settledDayId === finishedDay) {
      this.pendingDayScore = 0;
      return;
    }
    const awarded = Math.max(0, this.pendingDayScore);
    this.state.upgradePoints += awarded;
    this.state.settledDayId = finishedDay;
    this.pendingDayScore = 0;
    this.save();
  }

  isSimilarCargoSenseUnlocked(): boolean {
    return this.state.levels.similarCargoSense >= 1;
  }

  private applyEffect(id: UpgradeId): void {
    const level = this.state.levels[id];
    switch (id) {
      case 'multiCarry':
        this.pickupSystem.setMaxCarryCapacity(1 + level);
        break;
      case 'heavyHandling':
        this.playerController.setHeavyHandlingLevel(level as 0 | 1 | 2);
        break;
      case 'moveSpeed':
        // +5% per level, computed fresh from the level each call — never
        // re-multiplies an already-boosted value (spec: "必須從原始
        // baseMoveSpeed計算，不能在重複開關UI或重新載入存檔時疊加").
        this.playerController.setMoveSpeedBonus(level * 0.05);
        break;
      case 'similarCargoSense':
        // No setter to call — read directly via isSimilarCargoSenseUnlocked()
        // by whoever drives the highlight (see similar-cargo-highlight.ts).
        break;
    }
  }

  /** Re-applies every upgrade's effect fresh from its CURRENT level — run
   * once at construction (after loading the save), so effects are applied
   * exactly once per level and never compound across a page refresh
   * (spec六). */
  private applyAllEffects(): void {
    for (const def of UPGRADE_DEFINITIONS) this.applyEffect(def.id);
  }

  private save(): void {
    this.storage.setJSON(UPGRADE_STORAGE_KEY, this.state);
  }
}
