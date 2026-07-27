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
