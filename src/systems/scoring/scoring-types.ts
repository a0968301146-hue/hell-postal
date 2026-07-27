/** One departure's scored outcome, computed once at 載具出發 press time
 * (spec: "按下發車時，建立當日結算快照") and displayed once all six vehicles
 * finish their departure animation. lostFoundMissed/lostFoundPenalty added
 * ("Spawn lost found NPC during unloading and penalize missed interaction"
 * round) — also computed once at the same press-time moment (see
 * vehicle-control-system.ts's pressDepartButton), not re-derived later. */
export interface DepartureSettlement {
  total: number;
  shipped: number;
  unshipped: number;
  penalty: number;
  lostFoundMissed: boolean;
  lostFoundPenalty: number;
  finalScore: number;
}
