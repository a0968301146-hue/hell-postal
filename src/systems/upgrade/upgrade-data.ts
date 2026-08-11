import { UpgradeDefinition, UpgradeId } from './upgrade-types';

/** Point value awarded per successfully shipped CARGO item when converting
 * a day's departure settlement into spendable score ("每日貨物數量與結算分
 * 數/技能價格" round spec一: "每件成功出貨貨物 = 5分", up from the previous
 * flat 1-point rate every shipped item — cargo or mail — used to share).
 * Never applied to the real running settingsManager.progress.score; only
 * drives UpgradeSystem's own settlement-score award (see upgrade-system.ts
 * recordDepartureSettlement/settleDay), computed purely from the
 * DepartureSettlement numbers ScoringSystem already produced for that
 * departure (spec: "不得自行掃描場景，只讀取Scoring/Vehicle System提供的狀
 * 態"). */
export const CARGO_POINT_REWARD_PER_SHIPPED_ITEM = 5;

/** Point value awarded per successfully shipped MAIL envelope — explicitly
 * UNCHANGED this round (spec一: "信件目前的分數規則先維持原本設定，不要自行
 * 修改"), kept as its own constant (rather than reusing
 * CARGO_POINT_REWARD_PER_SHIPPED_ITEM) specifically so cargo's reward can
 * move independently of mail's. */
export const MAIL_POINT_REWARD_PER_SHIPPED_ITEM = 1;

/** envelopeCarryLevel's own numeric effect (spec十一: Lv.0-3 -> 5/10/15/20
 *封) — a lookup table rather than a formula since the steps aren't a fixed
 * arithmetic progression tied to `level` alone in a way worth deriving. */
export const ENVELOPE_CARRY_CAPACITY_BY_LEVEL: readonly number[] = [5, 10, 15, 20];

/**
 * "每日貨物數量與結算分數/技能價格" round spec三/五 — every cost below was
 * re-derived from THREE factors together (spec: "價格由總可取得分數＋技能解
 * 鎖時間＋技能等級三者共同決定"), never a flat multiplier on the old prices:
 *
 *   cost(level i of maxLevel L) = dayTierBase(unlockDay) × levelFactor(i, L) × powerWeight(skill)
 *
 * - dayTierBase grows with the skill's own daily-unlock-data.ts unlock day
 *   (40/60/80/100/130 for Day1/2/3/4/5) — later-unlocked skills sit on a
 *   higher price floor even at their own Lv.1, so price naturally tracks
 *   "解鎖時間".
 * - levelFactor climbs within a skill (maxLevel 2: ×1.0/×2.0; maxLevel 3:
 *   ×1.0/×1.8/×3.0), so Lv.2 is always meaningfully pricier than Lv.1 and
 *   Lv.3 pricier still (spec: "越後面的等級...價格必須明顯高於前一級") — a
 *   maxLevel-1 skill (a single all-or-nothing toggle rather than a ladder)
 *   instead gets its own flat ×1.3/×1.6/×2.5 weight reflecting how strong
 *   that one purchase is (ropeStrap/similarCargoSense minor QoL vs
 *   palletInventoryLevel's inventory-doubling unlock).
 * - powerWeight nudges a couple of same-day/same-shape skills apart where
 *   their actual gameplay impact clearly differs (powerGlovesUpgrade gates
 *   pallet size, weighted above heavyHandling's pure QoL; cargoHookLevel's
 *   broad multi-category unlock weighted above envelopeVacuumLevel's
 *   narrower cooldown-only effect), rather than letting two unrelated
 *   skills land on identical numbers purely by coincidence of day+maxLevel.
 *
 * Every result is rounded to the nearest 5 points. Total across all 21
 * levels is 3,010 — about 91% of the 3,310 points a Day1-7 perfect,
 * zero-penalty playthrough can earn (cargoTotal×5 + mailTotal×1 per day,
 * daily-unlock-data.ts) — enough to fully max every skill by the END of
 * Day7 with a modest ~300-point buffer for real-world penalties, but NOT
 * enough to clear even just the Day1+Day2 skill subset within Day1-2's own
 * income (765 needed vs 630 earned by Day2), satisfying spec五's "不應該在
 * Day1～2就能把所有技能買完" without needing an explicit early-game cap.
 */
export const UPGRADE_DEFINITIONS: UpgradeDefinition[] = [
  {
    id: 'moveSpeed',
    displayName: '移動速度',
    description: '提升玩家的基礎移動速度，衝刺倍率、跳躍高度與重力皆不受影響。',
    maxLevel: 3,
    costs: [40, 70, 120],
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
    costs: [80, 160],
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
    costs: [65],
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
    costs: [40, 80],
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
    costs: [130],
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
    costs: [90, 185],
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
    costs: [60, 110, 180],
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
    costs: [250],
    levelEffects: [
      { level: 0, description: '小／中／大型托盤各 1 張' },
      { level: 1, description: '小／中／大型托盤各 2 張（立即生成第二組）' },
    ],
  },
  {
    id: 'cargoHookLevel',
    displayName: '勾貨勾升級',
    description: '縮短捕貨鉤冷卻時間、增加勾取距離，並逐級解鎖可勾取的物件種類（信件／失物招領／大型／冷凍／活物貨物）。',
    maxLevel: 3,
    costs: [145, 255, 430],
    levelEffects: [
      { level: 0, description: '冷卻 9 秒／基礎距離／可勾取小型與中型貨物' },
      { level: 1, description: '冷卻 7 秒／距離 +1／新增可勾取信件' },
      { level: 2, description: '冷卻 5 秒／距離 +2／新增可勾取失物招領物品' },
      { level: 3, description: '冷卻 3 秒／距離 +3／可勾取全部貨物（含大型／冷凍／活物）' },
    ],
  },
  {
    id: 'envelopeVacuumLevel',
    displayName: '信封吸塵器升級',
    description: '縮短信封吸塵器的使用冷卻時間，其餘吸取/吹風方式與信封系統維持不變。',
    maxLevel: 3,
    costs: [90, 160, 270],
    levelEffects: [
      { level: 0, description: '冷卻 9 秒' },
      { level: 1, description: '冷卻 7 秒' },
      { level: 2, description: '冷卻 5 秒' },
      { level: 3, description: '冷卻 3 秒' },
    ],
  },
];

export function getUpgradeDefinition(id: UpgradeId): UpgradeDefinition {
  const def = UPGRADE_DEFINITIONS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown upgrade id: ${id}`);
  return def;
}
