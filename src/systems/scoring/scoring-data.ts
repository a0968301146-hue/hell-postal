/** Score deducted PER unshipped (or wrong-vehicle) today's-cargo item at
 * departure settlement ("Add six cargo vehicles and unrestricted departure
 * scoring" round section二) — the ONE place this number is defined;
 * scoring-system.ts reads it rather than hardcoding a value inline. */
export const UNSHIPPED_PENALTY_PER_ITEM = 1;
