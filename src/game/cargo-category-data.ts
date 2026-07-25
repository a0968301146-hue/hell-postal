// Cargo category — a lightweight classification used ONLY by the crosshair
// cargo-inspection UI ("貨物種類準心檢視 UI" round). Deliberately independent
// of the pre-existing CargoType/CargoLabel system in cargo-data.ts (that
// system belongs to the older domestic/overseas/label flow and is unused by
// daily cargo, which always spawns with cargoType:'normal'/labels:[] as
// harmless defaults) — this module owns CargoCategory end to end so the two
// concepts never get coupled or confused with each other.
//
// "Add dual elevated unloading ports and day-one special cargo" round:
// extended from normal/fragile to also cover frozen/live (spec 四), reading
// DAILY_CARGO_CATEGORY_POOL (daily-flow-data.ts) for which values are
// actually available rather than hardcoding the pool here.
import { DAILY_CARGO_CATEGORY_POOL } from './daily-flow-data';

export type CargoCategory = 'normal' | 'fragile' | 'frozen' | 'live';

/** Display text for the inspection UI. */
export const CARGO_CATEGORY_DISPLAY: Record<CargoCategory, string> = {
  normal: '一般',
  fragile: '易碎品',
  frozen: '冷凍',
  live: '活體',
};

/** Deterministic cyclic assignment rather than independent per-item
 * randomness — guarantees every category in DAILY_CARGO_CATEGORY_POOL
 * appears within a single day's ~180-item batch (spec: "每種類型第一天至少
 * 生成1件") without needing to track day-boundary state or batch size here.
 * A purely random per-item pick could (rarely but non-zero probability)
 * produce a batch missing a category; this can't. Preserves the original
 * every-3rd-is-fragile cadence exactly, and sprinkles frozen/live in at
 * their own periods (~1 in 20 each) rather than crowding out normal/fragile
 * — each check is gated on the category still being in the pool, so
 * removing a category from DAILY_CARGO_CATEGORY_POOL silently stops it from
 * being picked without touching this function. Call once per spawned daily
 * cargo item, in the order items are created — see cargo-data.ts
 * createDailyCargoData(). */
let cycleIndex = 0;
export function pickCargoCategory(): CargoCategory {
  const i = cycleIndex++;
  const pool = DAILY_CARGO_CATEGORY_POOL;
  if (pool.includes('frozen') && i % 20 === 5) return 'frozen';
  if (pool.includes('live') && i % 20 === 11) return 'live';
  if (pool.includes('fragile') && i % 3 === 0) return 'fragile';
  return 'normal';
}
