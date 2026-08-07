/** "活物貨物系統" round — the ONE place calmValue's own constants/tier math
 * live, shared by LivingCargoSystem (per-frame drain/soothe), the real
 * departure scan (vehicle-control-system.ts), and the test-cheat's own
 * equivalent scan (complete-day-cheat-system.ts) — never duplicated across
 * those call sites. Mirrors cold-value-data.ts's own established shape. */

export const CALM_VALUE_MIN = 0;
export const CALM_VALUE_MAX = 100;

/** spec①: 玩家拿著活物時，若移動速度超過此值（m/s），calmValue 持續下降。
 * Compared against the player rigid body's own horizontal speed — same unit
 * PlayerController already moves at (SCENE_CONFIG.playerSpeed=7,
 * sprintMultiplier=1.5 -> up to 10.5 m/s sprinting), so this sits comfortably
 * below sprint speed but above ordinary walk speed (7 m/s), meaning sprinting
 * while carrying a live animal is what actually triggers the drain. */
export const CALM_VALUE_FAST_MOVE_SPEED_THRESHOLD = 8;
export const CALM_VALUE_FAST_MOVE_DRAIN_PER_SECOND = 4;

/** spec②: 撞擊扣除安撫值 — 三個等級（數值可再調整）, keyed by the impact
 * speed (m/s) a live-cargo rigid body's OWN linear velocity drops by across
 * one physics step (a cheap, already-available signal — no separate contact
 * force/impulse query needed). */
export const CALM_VALUE_IMPACT_SMALL_THRESHOLD = 2;
export const CALM_VALUE_IMPACT_MEDIUM_THRESHOLD = 5;
export const CALM_VALUE_IMPACT_LARGE_THRESHOLD = 9;
export const CALM_VALUE_IMPACT_SMALL_PENALTY = 2;
export const CALM_VALUE_IMPACT_MEDIUM_PENALTY = 5;
export const CALM_VALUE_IMPACT_LARGE_PENALTY = 10;

/** spec⑤: 按住 F 安撫，每秒 +5%，直到 100。 */
export const CALM_VALUE_SOOTHE_PER_SECOND = 5;

/** spec四: UI 顏色分級（80~100 綠／舒服，40~79 黃／焦慮，0~39 紅／害怕）。 */
export function calmValueTierColor(calmValue: number): string {
  if (calmValue >= 80) return '#4caf50'; // green — 舒服
  if (calmValue >= 40) return '#ffc107'; // yellow — 焦慮
  return '#f44336'; // red — 害怕
}

/** spec六: 出貨加成倍率 — 5 個固定門檻（80以上100%／60→95%／40→90%／20→
 * 80%／0→70%），不是連續比例，鏡射 cold-value-data.ts 的 getColdValueTier
 * 邊界慣例（>= 門檻）。 */
export type CalmValueTier = 100 | 95 | 90 | 80 | 70;

export function getCalmValueTier(calmValue: number): CalmValueTier {
  if (calmValue >= 80) return 100;
  if (calmValue >= 60) return 95;
  if (calmValue >= 40) return 90;
  if (calmValue >= 20) return 80;
  return 70;
}

export function calmValueTierMultiplier(calmValue: number): number {
  return getCalmValueTier(calmValue) / 100;
}

/** One departure's worth of live-cargo tier tallies — the contract
 * ScoringSystem.settleDeparture() takes in, mirroring FrozenSettlementInput's
 * own "caller tallies, scoring system only computes the bonus math" split.
 * Only CORRECTLY-shipped live items are ever tallied here — an unshipped
 * live item is already penalized by the normal per-item unshipped penalty,
 * same as any other unshipped cargo, never double-counted here too. */
export interface LiveSettlementInput {
  total: number;
  tier100: number;
  tier95: number;
  tier90: number;
  tier80: number;
  tier70: number;
}

export function createEmptyLiveSettlementInput(): LiveSettlementInput {
  return { total: 0, tier100: 0, tier95: 0, tier90: 0, tier80: 0, tier70: 0 };
}

/** Mutates `tally` in place — the ONE place a calmValue reading turns into a
 * tier bucket increment, called from both the real departure scan
 * (vehicle-control-system.ts) and the test-cheat's own equivalent scan
 * (complete-day-cheat-system.ts), so the two can never disagree about
 * bucket boundaries. */
export function tallyLiveCalmValue(tally: LiveSettlementInput, calmValue: number): void {
  tally.total++;
  switch (getCalmValueTier(calmValue)) {
    case 100: tally.tier100++; break;
    case 95: tally.tier95++; break;
    case 90: tally.tier90++; break;
    case 80: tally.tier80++; break;
    case 70: tally.tier70++; break;
  }
}
