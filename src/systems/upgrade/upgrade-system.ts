import { LocalStorageAdapter } from '../../adapters/local-storage/local-storage-adapter';
import { DepartureSettlement } from '../scoring';
import { PickupSystem } from '../interaction/pickup-system';
import { PlayerController } from '../player';
import { UpgradeId, UpgradeSaveState, UpgradeDefinition } from './upgrade-types';
import {
  UPGRADE_DEFINITIONS, getUpgradeDefinition, CARGO_POINT_REWARD_PER_SHIPPED_ITEM, MAIL_POINT_REWARD_PER_SHIPPED_ITEM,
  ENVELOPE_CARRY_CAPACITY_BY_LEVEL,
} from './upgrade-data';
import { PalletSize, PALLET_SIZE_ORDER } from '../pallet/pallet-data';
import { isSkillUnlockedOnDay } from '../../data/daily-unlock-data';

/** Narrow push-target for `envelopeCarryLevel` — the real class is
 * EnvelopeStackSystem (src/systems/mail/envelope-stack-system.ts), matched
 * structurally rather than imported by name so this file's own import graph
 * never has to reach into systems/mail at all. */
export interface EnvelopeCarryCapacityTarget {
  setMaxCapacity(n: number): void;
}

/** Narrow push-target for `palletInventoryLevel` — the real class is
 * PalletSystem, which already holds a live UpgradeSystem reference of its
 * own (constructor-injected, spec: "使用現有PalletSystem多實例架構"). Since
 * pallet-system.ts imports UpgradeSystem, UpgradeSystem importing
 * PalletSystem back would be circular — wired late via setPalletSystem()
 * instead (mirrors pickupSystem.setMailBoxHooks/setPalletThrowHooks' own
 * "avoid a constructor-time circular dependency" convention in
 * create-game-systems.ts), matched structurally the same way as
 * EnvelopeCarryCapacityTarget above. */
export interface PalletInventoryExpansionTarget {
  unlockSecondSet(): void;
  /** Reverses unlockSecondSet() — tears down/clears the second pallet set
   * entirely (spec十二/十三: new-playthrough reset must clear the second
   * set's Cargo/rope/rack-occupancy without touching the first). Called
   * whenever applyEffect resolves palletInventoryLevel back down to 0 (only
   * ever happens via resetUpgradesForNewRun — purchases only ever move a
   * level UP). Must be a safe no-op if the second set was never built. */
  lockSecondSet(): void;
}

/** Narrow push-target shared by cargoHookLevel (CargoHookSystem) and
 * envelopeVacuumLevel (EnvelopeVacuumSystem) — "貨物工具與技能升級系統修改"
 * round. Both tools already derive their own cooldown/range/category-unlock
 * effects fresh from this ONE pushed level every time they're needed
 * (cargo-hook-system.ts's own cooldownDuration/maxRange/
 * isCargoCategoryUnlocked getters, envelope-vacuum-system.ts's own
 * cooldownDuration getter) — this class never computes those effects
 * itself, matching every other upgrade's "UpgradeSystem owns the level,
 * the target system owns what the level DOES" split. Wired late via
 * setCargoHookSystem/setEnvelopeVacuumSystem below (both classes are
 * constructed well after UpgradeSystem in create-game-systems.ts — same
 * "avoid a constructor-time circular dependency" reasoning as
 * PalletInventoryExpansionTarget/setPalletSystem above), matched
 * structurally rather than imported by name for the same reason. */
export interface UpgradeLevelPushTarget {
  setUpgradeLevel(level: number): void;
}

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

/** "每日結算流程修改" round spec二: removed the old TEMPORARY_TEST_GRANT
 * (a one-time 1000-score starting balance) — a brand-new save now starts
 * with genuinely 0 spendable score, matching a normal playthrough where
 * every point is actually earned via a day's own departure settlement. */
function createDefaultUpgradeSaveState(): UpgradeSaveState {
  return {
    availableSettlementScore: 0,
    levels: {
      multiCarry: 0, heavyHandling: 0, moveSpeed: 0, similarCargoSense: 0, ropeStrap: 0, powerGlovesUpgrade: 0,
      envelopeCarryLevel: 0, palletInventoryLevel: 0, cargoHookLevel: 0, envelopeVacuumLevel: 0,
    },
    settledDayId: null,
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

  return {
    availableSettlementScore,
    levels,
    settledDayId: typeof saved.settledDayId === 'number' ? saved.settledDayId : base.settledDayId,
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
  private envelopeCarrySystem: EnvelopeCarryCapacityTarget;
  /** See PalletInventoryExpansionTarget's own doc comment above — null until
   * create-game-systems.ts wires it via setPalletSystem() once PalletSystem
   * exists (constructed after this class, to avoid a circular import). */
  private palletSystem: PalletInventoryExpansionTarget | null = null;
  /** See UpgradeLevelPushTarget's own doc comment above — both null until
   * create-game-systems.ts wires them via setCargoHookSystem/
   * setEnvelopeVacuumSystem once those tools exist. */
  private cargoHookSystem: UpgradeLevelPushTarget | null = null;
  private envelopeVacuumSystem: UpgradeLevelPushTarget | null = null;
  /** This day's accumulated (shipped*reward - penalties) tally across
   * however many departures settle before the day actually ends — consumed
   * exactly once by settleDay() and reset to 0 immediately after (spec四). */
  private pendingDayScore = 0;
  /** "Day 1～7 每日內容與解鎖規格" round — optional day-number source, wired
   * from create-game-systems.ts once DailyFlowSystem exists (this class is
   * constructed BEFORE it — same "avoid a constructor-time circular
   * dependency" reasoning as PalletInventoryExpansionTarget/setPalletSystem
   * above). Defaults to "always day 1" if never wired. */
  private getCurrentDay: () => number = () => 1;

  constructor(pickupSystem: PickupSystem, playerController: PlayerController, envelopeCarrySystem: EnvelopeCarryCapacityTarget) {
    this.pickupSystem = pickupSystem;
    this.playerController = playerController;
    this.envelopeCarrySystem = envelopeCarrySystem;
    const rawSaved = this.storage.getJSON<UpgradeSaveState>(UPGRADE_STORAGE_KEY);
    this.state = mergeUpgradeSaveState(rawSaved);
    this.applyAllEffects();
  }

  /** See PalletInventoryExpansionTarget's own doc comment above — called
   * once from create-game-systems.ts right after PalletSystem is
   * constructed. */
  setPalletSystem(palletSystem: PalletInventoryExpansionTarget): void {
    this.palletSystem = palletSystem;
  }

  /** See getCurrentDay's own doc comment above — called once from
   * create-game-systems.ts right after DailyFlowSystem is constructed. */
  setDayUnlockProvider(fn: () => number): void {
    this.getCurrentDay = fn;
  }

  /** Read by UpgradeMenuUI to grey out / label a skill that isn't open yet
   * today (daily-unlock-data.ts, the single source of truth) — purchase
   * itself is ALSO blocked directly in purchaseUpgrade() below, so the two
   * can never disagree (same "one judgment, two callers" pattern as
   * isMaxed()/getNextCost()). */
  isUnlockedToday(id: UpgradeId): boolean {
    return isSkillUnlockedOnDay(id, this.getCurrentDay());
  }

  /** See UpgradeLevelPushTarget's own doc comment above — called once from
   * create-game-systems.ts right after CargoHookSystem is constructed;
   * immediately re-pushes the CURRENT cargoHookLevel so a mid-session wire-
   * up (this class already applied every effect once at construction, well
   * before CargoHookSystem existed) doesn't leave the tool sitting at its
   * own internal default (Lv.0) despite a real save already at a higher
   * level. */
  setCargoHookSystem(target: UpgradeLevelPushTarget): void {
    this.cargoHookSystem = target;
    this.cargoHookSystem.setUpgradeLevel(this.state.levels.cargoHookLevel);
  }

  /** See setCargoHookSystem's own doc comment above — same reasoning, for
   * EnvelopeVacuumSystem/envelopeVacuumLevel. */
  setEnvelopeVacuumSystem(target: UpgradeLevelPushTarget): void {
    this.envelopeVacuumSystem = target;
    this.envelopeVacuumSystem.setUpgradeLevel(this.state.levels.envelopeVacuumLevel);
  }

  /** The ONLY entry point for wiping this playthrough's upgrade progress
   * back to a brand-new save ("Reset upgrades when starting day one" round)
   * — never called from the constructor, page load, or loadSave() (spec:
   * "不要在UpgradeSystem建構、頁面載入或loadSave()時自動執行重置"), only from
   * the explicit "重新開始第1天" new-run trigger (see pause-menu-ui.ts's
   * Data tab). Every skill level back to 0, spendable score back to 0
   * (see createDefaultUpgradeSaveState), settledDayId cleared so a stale dayId
   * left over from the PREVIOUS playthrough can never suppress this new
   * run's own first day-settlement (spec五), persisted immediately (spec
   *六) so even a refresh a moment later reads the clean state back, and
   * every downstream effect re-applied right away (spec七) —
   * multiCarry/heavyHandling/moveSpeed via the same setter-based
   * applyAllEffects() every purchase/load already goes through;
   * similarCargoSense/ropeStrap/powerGlovesUpgrade need no separate push
   * since their own callers (similar-cargo-highlight.ts / pallet-system.ts)
   * always read isSimilarCargoSenseUnlocked()/isRopeStrapUnlocked()/
   * getMaxCarryablePalletSize() live off this.state rather than a cached
   * copy, so resetting this.state alone already reflects everywhere those
   * are read — same reasoning UpgradeMenuUI's own render() relies on for
   * showing current levels on open(). */
  resetUpgradesForNewRun(): void {
    this.state = createDefaultUpgradeSaveState();
    this.pendingDayScore = 0;
    this.applyAllEffects();
    this.save();
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
    if (!this.isUnlockedToday(id)) return false;
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

  /** TEMPORARY TEST CHEAT — remove before public demo. The settlement half
   * of the new "+1000 分" cheat button (complete-day-cheat-system.ts) — adds
   * straight onto availableSettlementScore, the SAME currency
   * purchaseUpgrade() spends and UpgradeMenuUI displays, so a press is
   * immediately visible/spendable with no separate test currency invented. */
  grantTestScore(amount: number): void {
    this.state.availableSettlementScore += amount;
    this.save();
  }

  /** Wired (via ScoringSystem's own onSettlement callback, see
   * create-game-systems.ts) to fire once per departure settlement —
   * accumulates purely from the numbers ScoringSystem already computed for
   * THIS departure, never re-scanning cargo/vehicle state itself (spec:
   * "不得自行掃描場景"). */
  recordDepartureSettlement(settlement: DepartureSettlement): void {
    // "每日貨物數量與結算分數/技能價格" round spec一: cargo and mail now earn
    // at DIFFERENT per-item rates (5 vs the unchanged 1) — no longer a
    // single shippedTotal * one shared constant.
    const penaltyTotal = settlement.penalty + settlement.lostFoundPenalty + settlement.lostItemPenalty + settlement.mailPenalty;
    this.pendingDayScore +=
      settlement.shipped * CARGO_POINT_REWARD_PER_SHIPPED_ITEM +
      settlement.mailShipped * MAIL_POINT_REWARD_PER_SHIPPED_ITEM -
      penaltyTotal;
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
      case 'envelopeCarryLevel':
        this.envelopeCarrySystem.setMaxCapacity(ENVELOPE_CARRY_CAPACITY_BY_LEVEL[level]);
        break;
      case 'palletInventoryLevel':
        // Push, but only once unlocked — PalletSystem's OWN constructor
        // independently checks getLevel('palletInventoryLevel') to decide
        // whether to build the second set immediately on a fresh page load
        // (this.palletSystem is still null at that point, since PalletSystem
        // is constructed AFTER this class — see setPalletSystem's own doc
        // comment); this push only matters for the "purchased mid-session"
        // case, once setPalletSystem() has wired a live reference.
        if (level >= 1) this.palletSystem?.unlockSecondSet();
        else this.palletSystem?.lockSecondSet();
        break;
      case 'cargoHookLevel':
        // Push, same "may still be null at construction time" reasoning as
        // palletInventoryLevel above — setCargoHookSystem() itself already
        // re-pushes the current level the instant CargoHookSystem exists, so
        // this call only matters for the "purchased mid-session" case.
        this.cargoHookSystem?.setUpgradeLevel(level);
        break;
      case 'envelopeVacuumLevel':
        this.envelopeVacuumSystem?.setUpgradeLevel(level);
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
