import { SCENE_CONFIG } from '../world-layout/world-layout-system';

/** "活物貨物系統修改" round — the ONE place calmValue's own constants/tier
 * math live, shared by LivingCargoSystem (per-frame drain/soothe), the real
 * departure scan (vehicle-control-system.ts), and the test-cheat's own
 * equivalent scan (complete-day-cheat-system.ts) — never duplicated across
 * those call sites. spec一: "UI與結算統一使用三個階段" — a SINGLE canonical
 * 3-tier boundary set (75/50) drives both the held-item slider's color AND
 * the departure settlement multiplier, never two separate boundary sets. */

export const CALM_VALUE_MIN = 0;
export const CALM_VALUE_MAX = 100;

/** spec三: 玩家手持活物時的移動速度分級 — reuses the game's OWN already-
 * established speed constants (SCENE_CONFIG.playerSpeed/sprintMultiplier)
 * as the tier boundaries, rather than inventing new numbers: "一般速度"
 * is ordinary WASD movement (<= playerSpeed), "開始衝刺" is Shift-sprint
 * (<= playerSpeed * sprintMultiplier), and "高速移動" is anything faster
 * still (e.g. the movement-speed upgrade stacking on top of sprint). */
export const CALM_VALUE_SPRINT_SPEED_THRESHOLD = SCENE_CONFIG.playerSpeed;
export const CALM_VALUE_HIGH_SPEED_THRESHOLD = SCENE_CONFIG.playerSpeed * SCENE_CONFIG.sprintMultiplier;
export const CALM_VALUE_SPRINT_DRAIN_PER_SECOND = 0.5;
export const CALM_VALUE_HIGH_SPEED_DRAIN_PER_SECOND = 1;

/** spec③: 撞擊扣除安撫值 — 三個等級，數值已由使用者指定（-2/-5/-10），非自
 * 行決定. Keyed by the impact speed (m/s) a live-cargo rigid body's OWN
 * linear velocity drops by across one physics step (a cheap, already-
 * available signal — no separate contact force/impulse query needed). The
 * THRESHOLDS themselves (how many m/s of drop counts as small/medium/large)
 * are this file's own calibration, tuned against spec③'s worked examples
 * (輕撞牆壁/輕撞貨架 -> small; 掉下托盤/撞擊大型貨物 -> medium; 丟出/高處
 * 摔落/高速撞擊 -> large). */
export const CALM_VALUE_IMPACT_SMALL_THRESHOLD = 2;
export const CALM_VALUE_IMPACT_MEDIUM_THRESHOLD = 5;
export const CALM_VALUE_IMPACT_LARGE_THRESHOLD = 9;
export const CALM_VALUE_IMPACT_SMALL_PENALTY = 2;
export const CALM_VALUE_IMPACT_MEDIUM_PENALTY = 5;
export const CALM_VALUE_IMPACT_LARGE_PENALTY = 10;

/** spec四: 按住 F 安撫，每秒 +5%，最大100%，沒有冷卻. */
export const CALM_VALUE_SOOTHE_PER_SECOND = 5;

/** spec一: 三個統一階段 — 75~100 舒服(綠)／50~74 焦慮(黃)／0~49 害怕(紅). */
export type CalmValueTier = 'comfortable' | 'anxious' | 'scared';

export function getCalmValueTier(calmValue: number): CalmValueTier {
  if (calmValue >= 75) return 'comfortable';
  if (calmValue >= 50) return 'anxious';
  return 'scared';
}

/** spec二: Slider 顏色 — 同一個三階段邊界. */
export function calmValueTierColor(calmValue: number): string {
  switch (getCalmValueTier(calmValue)) {
    case 'comfortable': return '#4caf50'; // green — 舒服
    case 'anxious': return '#ffc107'; // yellow — 焦慮
    case 'scared': return '#f44336'; // red — 害怕
  }
}

/** spec七: 出貨加成倍率 — 固定三階段（75~100% -> 110%／50~74% -> 100%／
 * 0~49% -> 85%），"只保留三個階段，請不要另外再做五階段倍率". 100%以下的
 * 階段（85%）本身就是一種扣分，不是"獎勵變小"而已 — settleDeparture 據此
 * 直接允許負值. */
export function calmValueSettlementMultiplier(calmValue: number): number {
  switch (getCalmValueTier(calmValue)) {
    case 'comfortable': return 1.10;
    case 'anxious': return 1.00;
    case 'scared': return 0.85;
  }
}

/** One departure's worth of live-cargo tier tallies — the contract
 * ScoringSystem.settleDeparture() takes in, mirroring FrozenSettlementInput's
 * own "caller tallies, scoring system only computes the bonus math" split.
 * Only CORRECTLY-shipped live items are ever tallied here — an unshipped
 * live item is already penalized by the normal per-item unshipped penalty,
 * same as any other unshipped cargo, never double-counted here too. */
export interface LiveSettlementInput {
  total: number;
  comfortableCount: number;
  anxiousCount: number;
  scaredCount: number;
}

export function createEmptyLiveSettlementInput(): LiveSettlementInput {
  return { total: 0, comfortableCount: 0, anxiousCount: 0, scaredCount: 0 };
}

/** Mutates `tally` in place — the ONE place a calmValue reading turns into a
 * tier bucket increment, called from both the real departure scan
 * (vehicle-control-system.ts) and the test-cheat's own equivalent scan
 * (complete-day-cheat-system.ts), so the two can never disagree about
 * bucket boundaries. */
export function tallyLiveCalmValue(tally: LiveSettlementInput, calmValue: number): void {
  tally.total++;
  switch (getCalmValueTier(calmValue)) {
    case 'comfortable': tally.comfortableCount++; break;
    case 'anxious': tally.anxiousCount++; break;
    case 'scared': tally.scaredCount++; break;
  }
}
