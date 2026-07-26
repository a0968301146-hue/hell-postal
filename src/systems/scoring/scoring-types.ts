/** One departure's scored outcome, computed once at 載具出發 press time
 * (spec: "按下發車時，建立當日結算快照") and displayed once all six vehicles
 * finish their departure animation. */
export interface DepartureSettlement {
  total: number;
  shipped: number;
  unshipped: number;
  penalty: number;
  finalScore: number;
}
