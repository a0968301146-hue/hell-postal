import { UpgradeDefinition, UpgradeId } from './upgrade-types';

/** Point value awarded per successfully shipped item (regular cargo or
 * mail) when converting a day's departure settlement into spendable score
 * (spec一). Deliberately the SAME numeric scale as the existing per-item
 * shipping penalties (UNSHIPPED_PENALTY_PER_ITEM etc., scoring-data.ts) so
 * a day's net settlement score — shippedTotal * this constant minus that
 * SAME departure's penalty total — reads naturally against those existing
 * numbers instead of inventing an unrelated second scale. This is never
 * applied to the real running settingsManager.progress.score; it only
 * drives UpgradeSystem's own settlement-score award (see upgrade-system.ts
 * recordDepartureSettlement/settleDay), computed purely from the
 * DepartureSettlement numbers ScoringSystem already produced for that
 * departure (spec: "不得自行掃描場景，只讀取Scoring/Vehicle System提供的狀
 * 態").
 *
 * A normal day currently spawns 90 daily cargo + 20 mail envelopes (see
 * daily-flow-data.ts DAILY_CARGO_CONFIG.total / mail-data.ts
 * DAILY_ENVELOPE_COUNT) — a solidly-played day shipping most of that with
 * modest penalties nets roughly 40-90 points at this reward rate, which is
 * the scale the prices below are tuned against (unchanged this round —
 * spec: "升級價格維持目前數值，不在本回合重新平衡"). */
export const UPGRADE_POINT_REWARD_PER_SHIPPED_ITEM = 1;

/** envelopeCarryLevel's own numeric effect (spec十一: Lv.0-3 -> 5/10/15/20
 *封) — a lookup table rather than a formula since the steps aren't a fixed
 * arithmetic progression tied to `level` alone in a way worth deriving. */
export const ENVELOPE_CARRY_CAPACITY_BY_LEVEL: readonly number[] = [5, 10, 15, 20];

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
  {
    id: 'ropeStrap',
    displayName: '固定繩索',
    description: '力量手套搬運托盤時，可在放置預覽狀態按F，將托盤上的貨物用固定繩綁住。綁住後即使丟出托盤，貨物也不會散落。',
    maxLevel: 1,
    costs: [60],
    levelEffects: [
      { level: 0, description: '未啟用' },
      { level: 1, description: '搬運托盤時可按 F 綁定／解除固定繩，綁定後投擲托盤不會使貨物散落' },
    ],
  },
  {
    id: 'powerGlovesUpgrade',
    displayName: '力量手套強化',
    description: '強化力量手套的負重能力，解鎖搬運更大尺寸的整理托盤（小型／中型／大型三種掛牆托盤）。',
    maxLevel: 2,
    costs: [60, 100],
    levelEffects: [
      { level: 0, description: '只能搬運小型托盤' },
      { level: 1, description: '可搬運小型與中型托盤' },
      { level: 2, description: '可搬運小型、中型與大型托盤' },
    ],
  },
  {
    id: 'envelopeCarryLevel',
    displayName: '信封搬運',
    description: '增加一次可拿取與搬運的單封信封數量（僅影響信封堆疊，不影響Cargo多件搬運、信封袋或信封吸塵器捕捉上限）。',
    maxLevel: 3,
    costs: [30, 55, 85],
    levelEffects: [
      { level: 0, description: '最多同時搬運 5 封' },
      { level: 1, description: '最多同時搬運 10 封' },
      { level: 2, description: '最多同時搬運 15 封' },
      { level: 3, description: '最多同時搬運 20 封' },
    ],
  },
  {
    id: 'palletInventoryLevel',
    displayName: '托盤庫存擴充',
    description: '解鎖第二組小／中／大型整理托盤與對應掛架，購買後立即生成。',
    maxLevel: 1,
    costs: [120],
    levelEffects: [
      { level: 0, description: '小／中／大型托盤各 1 張' },
      { level: 1, description: '小／中／大型托盤各 2 張（立即生成第二組）' },
    ],
  },
];

export function getUpgradeDefinition(id: UpgradeId): UpgradeDefinition {
  const def = UPGRADE_DEFINITIONS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown upgrade id: ${id}`);
  return def;
}
