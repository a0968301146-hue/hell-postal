import { UpgradeDefinition, UpgradeId } from './upgrade-types';

/** Point value awarded per successfully shipped item (regular cargo or
 * mail) when converting a day's departure settlement into upgrade points
 * (spec四). Deliberately the SAME numeric scale as the existing per-item
 * shipping penalties (UNSHIPPED_PENALTY_PER_ITEM etc., scoring-data.ts) so
 * a day's net "upgrade score" — shippedTotal * this constant minus that
 * SAME departure's penalty total — reads naturally against those existing
 * numbers instead of inventing an unrelated second scale. This is never
 * applied to the real running settingsManager.progress.score; it only
 * drives UpgradeSystem's own point award (see upgrade-system.ts
 * recordDepartureSettlement/settleDay), computed purely from the
 * DepartureSettlement numbers ScoringSystem already produced for that
 * departure (spec: "不得自行掃描場景，只讀取Scoring/Vehicle System提供的狀
 * 態").
 *
 * A normal day currently spawns 90 daily cargo + 20 mail envelopes (see
 * daily-flow-data.ts DAILY_CARGO_CONFIG.total / mail-data.ts
 * DAILY_ENVELOPE_COUNT) — a solidly-played day shipping most of that with
 * modest penalties nets roughly 40-90 points at this reward rate, which is
 * the scale the prices below are tuned against (spec四: "第一個便宜升級：約
 * 半天至一天正常分數；高級升級：約一至兩天正常分數"). */
export const UPGRADE_POINT_REWARD_PER_SHIPPED_ITEM = 1;

export const UPGRADE_DEFINITIONS: UpgradeDefinition[] = [
  {
    id: 'moveSpeed',
    displayName: '移動速度',
    description: '提升玩家的基礎移動速度，衝刺倍率、跳躍高度與重力皆不受影響。',
    maxLevel: 3,
    costs: [25, 45, 70],
    levelEffects: [
      { level: 0, description: '基礎移動速度（未升級）' },
      { level: 1, description: '基礎移動速度 +5%' },
      { level: 2, description: '基礎移動速度 +10%' },
      { level: 3, description: '基礎移動速度 +15%' },
    ],
  },
  {
    id: 'heavyHandling',
    displayName: '重物適應',
    description: '降低搬運大型貨物時的移動減速，僅影響大型貨物，不影響活體、中型貨物或基礎速度。',
    maxLevel: 2,
    costs: [35, 65],
    levelEffects: [
      { level: 0, description: '搬運大型貨物時維持原有減速' },
      { level: 1, description: '搬運大型貨物的減速幅度降低 50%' },
      { level: 2, description: '搬運大型貨物時不再減速' },
    ],
  },
  {
    id: 'similarCargoSense',
    displayName: '同類感知',
    description: '瞄準貨物時，自動高亮附近同種類、同地區的貨物，方便集中整理與裝載。',
    maxLevel: 1,
    costs: [55],
    levelEffects: [
      { level: 0, description: '未啟用' },
      { level: 1, description: '瞄準貨物時，高亮約 12 公尺內同種類同地區的貨物，持續約 2.5 秒' },
    ],
  },
  {
    id: 'multiCarry',
    displayName: '多件搬運',
    description: '提升可同時持有的物品上限（大型貨物與活體鐵籠仍需獨自佔滿容量）。',
    maxLevel: 2,
    costs: [45, 85],
    levelEffects: [
      { level: 0, description: '最多同時持有 1 件' },
      { level: 1, description: '最多同時持有 2 件' },
      { level: 2, description: '最多同時持有 3 件' },
    ],
  },
];

export function getUpgradeDefinition(id: UpgradeId): UpgradeDefinition {
  const def = UPGRADE_DEFINITIONS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown upgrade id: ${id}`);
  return def;
}
