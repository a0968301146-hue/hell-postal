import { LocalStorageAdapter } from '../../adapters/local-storage/local-storage-adapter';
import { DepartureSettlement } from '../scoring';
import { PickupSystem } from '../interaction/pickup-system';
import { PlayerController } from '../player';
import { UpgradeId, UpgradeSaveState, UpgradeDefinition } from './upgrade-types';
import { UPGRADE_DEFINITIONS, getUpgradeDefinition, UPGRADE_POINT_REWARD_PER_SHIPPED_ITEM } from './upgrade-data';
import { PalletSize, PALLET_SIZE_ORDER } from '../pallet/pallet-data';

/** "Rebuild pallet storage and reset upgrade progression" round八: bumped
 * from v1 — a genuine schema/rebalance reset (spec: "本次為技能重製版本...
 * bump upgrade schema version...對目前prototype舊技能存檔執行一次性乾淨重
 * 置"). Since a v1 save simply doesn't exist under this new key,
 * mergeUpgradeSaveState(null) below naturally returns clean defaults (0
 * score, every level 0) the FIRST time this loads post-update — and because
 * every purchase/settlement immediately re-saves under THIS key, every
 * subsequent reload reads real v2 data back correctly, so the reset only
 * ever happens once, never on every page load (spec: "只重置一次...之後重
 * 新整理必須正常保存"). No separate "have I reset yet" flag needed — a
 * versioned storage key already IS a one-time migration by construction. */
const UPGRADE_STORAGE_KEY = 'hp_manual_upgrades_v2';

// TEMPORARY TEST GRANT — remove before public demo.
// A brand-new save starts with this much spendable score (skills all still
// Lv.0, purchases still deduct normally) instead of 0, so testers have
// something to actually spend without needing to play a full day first.
// TEMPORARY_TEST_GRANT_VERSION is a one-time-migration stamp (mirrors this
// file's own upgradePoints->availableSettlementScore migration just below)
// — bump it if this grant amount ever needs to be re-applied to saves that
// already received an earlier version; leave it alone otherwise, or every
// reload would hand out another 1000.
const TEMPORARY_TEST_STARTING_SCORE = 1000;
const TEMPORARY_TEST_GRANT_VERSION = 1;

function createDefaultUpgradeSaveState(): UpgradeSaveState {
  return {
    availableSettlementScore: TEMPORARY_TEST_STARTING_SCORE, // TEMPORARY TEST GRANT — remove before public demo
    levels: { multiCarry: 0, heavyHandling: 0, moveSpeed: 0, similarCargoSense: 0, ropeStrap: 0, powerGlovesUpgrade: 0 },
    settledDayId: null,
    testGrantVersion: TEMPORARY_TEST_GRANT_VERSION, // TEMPORARY TEST GRANT — remove before public demo
  };
}

/** Field-by-field fallback to defaults for any missing/corrupt field —
 * mirrors settings-manager.ts's own mergeProgress/mergeSettings pattern
 * (spec: "舊存檔沒有升級資料時，需以預設值安全fallback，不能報錯"). Levels
 * are additionally clamped against each definition's own maxLevel so a
 * hand-edited or stale save can never apply an out-of-range level.
 *
 * One-time migration ("Revise score upgrades and fix frog walkable
 * colliders" round spec一: "舊存檔中的upgradePoints一次性遷移到
 * availableSettlementScore"): a save written before this round has
 * `upgradePoints` but no `availableSettlementScore` — `saved` is typed
 * loosely enough to still read that old field for exactly this one-time
 * carry-over, without ever writing a second storage key or resetting the
 * player's already-purchased levels. */
function mergeUpgradeSaveState(saved: (Partial<UpgradeSaveState> & { upgradePoints?: number }) | null): UpgradeSaveState {
  const base = createDefaultUpgradeSaveState();
  if (!saved) return base;

  const savedLevels = saved.levels ?? {};
  const levels = { ...base.levels };
  for (const def of UPGRADE_DEFINITIONS) {
    const lvl = (savedLevels as Record<string, unknown>)[def.id];
    levels[def.id] = typeof lvl === 'number' && lvl >= 0 && lvl <= def.maxLevel ? lvl : 0;
  }

  let availableSettlementScore = 0;
  if (typeof saved.availableSettlementScore === 'number' && saved.availableSettlementScore >= 0) {
    availableSettlementScore = saved.availableSettlementScore;
  } else if (typeof saved.upgradePoints === 'number' && saved.upgradePoints >= 0) {
    // Pre-rename save — migrate the old currency value over exactly once;
    // the very next save() call writes it back out under the new field
    // name, so this branch never fires again for this save.
    availableSettlementScore = saved.upgradePoints;
  }

  // TEMPORARY TEST GRANT — remove before public demo. A save that predates
  // this grant (testGrantVersion missing or behind the current stamp) gets
  // topped up ONCE — never below whatever it already had (spec: "使用
  // testGrantVersion避免重複發放" / "availableSettlementScore =
  // max(currentScore, 1000)") — and stamped so this branch can never fire
  // again for the same save.
  const savedTestGrantVersion = typeof saved.testGrantVersion === 'number' ? saved.testGrantVersion : 0;
  if (savedTestGrantVersion < TEMPORARY_TEST_GRANT_VERSION) {
    availableSettlementScore = Math.max(availableSettlementScore, TEMPORARY_TEST_STARTING_SCORE);
  }
  const testGrantVersion = Math.max(savedTestGrantVersion, TEMPORARY_TEST_GRANT_VERSION);

  return {
    availableSettlementScore,
    levels,
    settledDayId: typeof saved.settledDayId === 'number' ? saved.settledDayId : base.settledDayId,
    testGrantVersion,
  };
}

/**
 * Owns available settlement score, per-upgrade levels, purchasing, and
 * their save state ("UpgradeSystem 擁有分數/等級/購買/效果套用/存讀檔").
 * There is no separate "upgrade points" currency — availableSettlementScore
 * IS a day's own net settlement outcome, accumulated once per day (spec
 * 一). Applies each
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
    const rawSaved = this.storage.getJSON<UpgradeSaveState>(UPGRADE_STORAGE_KEY);
    this.state = mergeUpgradeSaveState(rawSaved);
    this.applyAllEffects();

    // TEMPORARY TEST GRANT — remove before public demo. An existing save
    // that just received the one-time top-up above must be persisted RIGHT
    // NOW — otherwise a refresh before the player's next organic save()
    // (a purchase or a day settling) would still read the old, un-stamped
    // save from storage and grant it again (spec: "不可每次重新整理重新補
    // 1000分"). A brand-new save (rawSaved === null) needs no such write —
    // there's nothing on disk yet to desync from.
    if (rawSaved && (typeof rawSaved.testGrantVersion !== 'number' || rawSaved.testGrantVersion < this.state.testGrantVersion)) {
      this.save();
    }
  }

  get availableSettlementScore(): number {
    return this.state.availableSettlementScore;
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
   * deducts available settlement score, blocks on insufficient score or an
   * already-maxed upgrade, and never touches any historical settlement
   * record (spec一: "歷史每日結算紀錄保留，不因購買而被修改"). */
  purchaseUpgrade(id: UpgradeId): boolean {
    const def = getUpgradeDefinition(id);
    const level = this.state.levels[id];
    if (level >= def.maxLevel) return false;
    const cost = def.costs[level];
    if (this.state.availableSettlementScore < cost) return false;

    this.state.availableSettlementScore -= cost;
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
   * converts this.pendingDayScore into availableSettlementScore exactly
   * once per finishedDay (spec一: "每個dayId只能加入一次"), guarded by
   * state.settledDayId so a stale/duplicate fire for a day already
   * processed is a no-op. Actual increase is max(0, dayScore) — a bad day
   * never deducts previously-earned score (spec一: "availableSettlementScore
   * += max(0, dayFinalScore)"). */
  settleDay(finishedDay: number): void {
    if (this.state.settledDayId === finishedDay) {
      this.pendingDayScore = 0;
      return;
    }
    const awarded = Math.max(0, this.pendingDayScore);
    this.state.availableSettlementScore += awarded;
    this.state.settledDayId = finishedDay;
    this.pendingDayScore = 0;
    this.save();
  }

  isSimilarCargoSenseUnlocked(): boolean {
    return this.state.levels.similarCargoSense >= 1;
  }

  /** "Add placement rotation and pallet cargo straps" round — read directly
   * by pallet-system.ts's own F-key rope-bind gate, same pattern as
   * isSimilarCargoSenseUnlocked() above (no setter to apply, since this
   * upgrade unlocks a player ACTION rather than continuously modifying some
   * other system's behavior). */
  isRopeStrapUnlocked(): boolean {
    return this.state.levels.ropeStrap >= 1;
  }

  /** "Rebuild pallet storage and reset upgrade progression" round七: power
   * gloves' own base carry capability — Lv.0 small only, Lv.1 adds medium,
   * Lv.2 adds large (spec七). Read directly by pallet-system.ts's own
   * take-from-rack gate, same no-setter pattern as isRopeStrapUnlocked
   * above. */
  getMaxCarryablePalletSize(): PalletSize {
    const level = this.state.levels.powerGlovesUpgrade;
    if (level >= 2) return 'large';
    if (level >= 1) return 'medium';
    return 'small';
  }

  canCarryPalletSize(size: PalletSize): boolean {
    return PALLET_SIZE_ORDER.indexOf(size) <= PALLET_SIZE_ORDER.indexOf(this.getMaxCarryablePalletSize());
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
      case 'ropeStrap':
        // No setter to call — read directly via isRopeStrapUnlocked() by
        // pallet-system.ts's own F-key handler.
        break;
      case 'powerGlovesUpgrade':
        // No setter to call — read directly via getMaxCarryablePalletSize()/
        // canCarryPalletSize() by pallet-system.ts's own take-from-rack gate.
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
