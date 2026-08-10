// Data shapes for the "公告欄升級系統" round. Kept separate from
// upgrade-data.ts (the actual numbers) the same way settings-data.ts and
// settings-manager.ts split shapes/defaults from the runtime owner.

export type UpgradeId =
  | 'multiCarry' | 'heavyHandling' | 'moveSpeed' | 'similarCargoSense' | 'ropeStrap' | 'powerGlovesUpgrade'
  // "Add envelope stacks and expand pallet inventory" round.
  | 'envelopeCarryLevel' | 'palletInventoryLevel'
  // "貨物工具與技能升級系統修改" round.
  | 'cargoHookLevel' | 'envelopeVacuumLevel';

export interface UpgradeLevelEffect {
  level: number;
  /** Human-readable effect text for this exact level — shown as both
   * "目前效果" (level) and "下一級效果" (level+1) in UpgradeMenuUI. */
  description: string;
}

export interface UpgradeDefinition {
  id: UpgradeId;
  displayName: string;
  description: string;
  maxLevel: number;
  /** Cost in upgrade points to go from level N-1 to level N — costs[0] is
   * the price of Lv.1, costs[1] the price of Lv.2, etc. Always length
   * maxLevel. Centralized here (spec四: "升級價格必須集中管理於
   * upgrade-data.ts，不能寫死在UI中") — UpgradeMenuUI only ever reads these
   * through UpgradeSystem, never hardcodes a number itself. */
  costs: number[];
  /** One entry per level, 0..maxLevel inclusive (length maxLevel + 1). */
  levelEffects: UpgradeLevelEffect[];
}

/** Persisted shape ("Revise score upgrades and fix frog walkable colliders"
 * round: 升級資源改為累積結算分數, replacing the old separate "upgrade
 * points" currency) — reuses the EXISTING LocalStorageAdapter
 * (adapters/local-storage/local-storage-adapter.ts), just under its own
 * key, the same way settings/progress already live under two separate keys
 * through that one adapter class rather than a second incompatible save
 * mechanism. */
export interface UpgradeSaveState {
  /** Accumulated, spendable daily-settlement score (spec一: "每日取得的結算
   * 分數，就是可消耗的升級資源") — the ONE currency upgrades cost against.
   * Never a second currency alongside score/money; purchases deduct
   * directly from this. */
  availableSettlementScore: number;
  levels: Record<UpgradeId, number>;
  /** The day number (DailyFlowSystem's own day id, as it was WHILE that day
   * was still current — i.e. `finishedDay` from DailyFlowSystem's
   * onDayCompleted hook) whose settlement has already been converted into
   * score. Guards against a page refresh re-awarding the same day's score
   * twice (spec一: "每個dayId只能加入一次"). `null` before any day has ever
   * completed. */
  settledDayId: number | null;
}
