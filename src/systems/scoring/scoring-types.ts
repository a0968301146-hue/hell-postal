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
  /** How many of today's NPCs (DAILY_LOST_FOUND_NPC_COUNT, currently 3)
   * were NOT successfully completed before 載具出發 ("Add sequential
   * lost-found visitors and held cargo feedback" round一/六: "每位未接待NPC
   * 分別套用目前既有的漏接懲罰" — replaces the old single `missed: boolean`
   * now that more than one NPC can be outstanding at once; the PER-EVENT
   * penalty VALUE itself is unchanged, see scoring-data.ts). */
  missedCount: number;
  /** How many lost items (targets + decoys) were spawned today. */
  total: number;
  /** How many of today's NPCs were successfully handed their target item —
   * was a single 0|1, now 0..DAILY_LOST_FOUND_NPC_COUNT. */
  handedOver: number;
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
  /** How many of today's lost-found NPCs went uncompleted — was a single
   * boolean, now a count (0..DAILY_LOST_FOUND_NPC_COUNT), see
   * LostFoundSettlementInput.missedCount's own doc comment. */
  lostFoundMissedCount: number;
  lostFoundPenalty: number;
  /** Lost-item storage settlement fields (spec七: 今日失物總數/成功交還數/
   * 已收納數量/未收納數量/失物收納扣分) — independent of lostFoundMissedCount/
   * lostFoundPenalty above (spec: "兩條獨立項目"). */
  lostItemTotal: number;
  lostItemHandedOver: number;
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
