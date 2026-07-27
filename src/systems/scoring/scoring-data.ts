/** Score deducted PER unshipped (or wrong-vehicle) today's-cargo item at
 * departure settlement ("Add six cargo vehicles and unrestricted departure
 * scoring" round section二) — the ONE place this number is defined;
 * scoring-system.ts reads it rather than hardcoding a value inline. */
export const UNSHIPPED_PENALTY_PER_ITEM = 1;

/** Flat, one-time score deduction applied at 載具出發 if the player never
 * talked to today's lost-found NPC at all ("Spawn lost found NPC during
 * unloading and penalize missed interaction" round — 失物招領未處理扣分).
 * A single flat penalty, not per-item like UNSHIPPED_PENALTY_PER_ITEM above
 * — missing the whole daily NPC is one event, not N. scoring-system.ts is
 * the ONE place this is applied (spec: "接入現有ScoringSystem，不要在UI、
 * DailyFlowSystem和LostFoundSystem各寫一份扣分"); LostFoundSystem only
 * decides WHETHER it applies, never touches score itself. */
export const LOST_FOUND_MISSED_PENALTY = 5;

/** Score deducted PER lost item that's neither handed to its NPC nor
 * resting in a valid cabinet slot by 載具出發 settlement time ("Expand lost
 * found return storage and scoring" round 七: 失物招領收納扣分). Per-item
 * like UNSHIPPED_PENALTY_PER_ITEM above, independent of
 * LOST_FOUND_MISSED_PENALTY (spec: "失物收納扣分與『未與NPC互動』扣分是兩
 *條獨立項目") — scoring-system.ts is the ONE place this is applied;
 * LostFoundSystem only counts stored/unstored, never touches score itself. */
export const LOST_ITEM_UNSTORED_PENALTY_PER_ITEM = 2;
