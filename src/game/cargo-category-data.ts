// Cargo category — a lightweight classification used ONLY by the crosshair
// cargo-inspection UI ("貨物種類準心檢視 UI" round). Deliberately independent
// of the pre-existing CargoType/CargoLabel system in cargo-data.ts (that
// system belongs to the older domestic/overseas/label flow and is unused by
// daily cargo, which always spawns with cargoType:'normal'/labels:[] as
// harmless defaults) — this module owns CargoCategory end to end so the two
// concepts never get coupled or confused with each other.

export type CargoCategory = 'normal' | 'fragile';

/** Display text for the inspection UI. */
export const CARGO_CATEGORY_DISPLAY: Record<CargoCategory, string> = {
  normal: '一般',
  fragile: '易碎品',
};

/** Deterministic cyclic assignment (every 3rd call is fragile) rather than
 * independent per-item randomness — guarantees BOTH categories appear
 * within any batch of 3+ daily cargo items (spec: "當日貨物中同時生成一般與
 * 易碎品") without needing to track day-boundary state or batch size here.
 * A purely random per-item pick could (rarely but non-zero probability)
 * produce an all-normal day; this can't. Call once per spawned daily cargo
 * item, in the order items are created — see cargo-data.ts
 * createDailyCargoData(). */
let cycleIndex = 0;
export function pickCargoCategory(): CargoCategory {
  const category: CargoCategory = cycleIndex % 3 === 0 ? 'fragile' : 'normal';
  cycleIndex++;
  return category;
}
