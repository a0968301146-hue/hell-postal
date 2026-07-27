/** One departure's scored outcome, computed once at 載具出發 press time
 * (spec: "按下發車時，建立當日結算快照") and displayed once all six vehicles
 * finish their departure animation. lostFoundMissed/lostFoundPenalty added
 * ("Spawn lost found NPC during unloading and penalize missed interaction"
 * round) — also computed once at the same press-time moment (see
 * vehicle-control-system.ts's pressDepartButton), not re-derived later. */
/** LostFoundSystem.settleAtDeparture()'s own frozen-at-press-time snapshot
 * ("Expand lost found return storage and scoring" round 七/八) — the
 * contract ScoringSystem.settleDeparture() takes in, so LostFoundSystem
 * never needs to import anything from scoring itself (avoids a
 * lost-found <-> scoring circular import; scoring-types.ts has no deps of
 * its own, so it's the neutral home for this shape). */
export interface LostFoundSettlementInput {
  /** Today's NPC was never talked to at all before 載具出發 (spec八) — a
   * separate flat penalty from lostItemUnstoredCount below. */
  missed: boolean;
  /** How many lost items (target + decoys) were spawned today. */
  total: number;
  /** Whether today's target item was successfully handed to its NPC. */
  handedOver: 0 | 1;
  stored: number;
  unstored: number;
}

/** MailSystem.settleAtDeparture()'s own frozen-at-press-time snapshot ("Add
 * modular envelope stamping and regional mail bag system" round 十一) —
 * counted PER ENVELOPE (spec: "結算以每封信計算"), never per-bag (spec:
 * "分類袋本身不可再額外扣一次"). */
export interface MailSettlementInput {
  total: number;
  shipped: number;
  unshipped: number;
}

export interface DepartureSettlement {
  total: number;
  shipped: number;
  unshipped: number;
  penalty: number;
  lostFoundMissed: boolean;
  lostFoundPenalty: number;
  /** Lost-item storage settlement fields (spec七: 今日失物總數/成功交還0或1/
   * 已收納數量/未收納數量/失物收納扣分) — independent of lostFoundMissed/
   * lostFoundPenalty above (spec: "兩條獨立項目"). */
  lostItemTotal: number;
  lostItemHandedOver: 0 | 1;
  lostItemStoredCount: number;
  lostItemUnstoredCount: number;
  lostItemPenalty: number;
  /** Mail settlement fields (spec十一: 今日信件總數/已寄出信件數/未寄出信件
   * 數/信件扣分) — each unshipped envelope uses the SAME
   * UNSHIPPED_PENALTY_PER_ITEM as regular cargo (spec: "使用現有「每件未出
   * 貨扣分值」"), not a separate constant. */
  mailTotal: number;
  mailShipped: number;
  mailUnshipped: number;
  mailPenalty: number;
  finalScore: number;
}
