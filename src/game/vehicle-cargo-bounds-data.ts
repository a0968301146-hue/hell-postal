// Centralized cargo-bay DETECTION-volume tuning ("Expand land entrance and
// cargo capacity" round section二) — separate from each VehicleConfig's own
// cargoAreaWidth/cargoAreaLength/cargoAreaHeight (vehicle-data.ts, which
// govern the vehicle's real cargo-bed SIZE/geometry and the visible bed
// walls) and separate from the built bed's own physical wall height. This
// only tunes how TALL the loaded-cargo DETECTION zone extends above the
// bed — read once by VehicleSystem's constructor when it builds
// cargoBayBounds, never hardcoded inline there or re-derived in update().

/** How many times taller the cargo-bay detection zone is than its original
 * height (spec: "只增加高度，長度與寬度不變" — width/length untouched, only
 * this). The zone's BOTTOM stays exactly flush with the cargo bed floor
 * (unchanged); only the TOP extends further upward, so cargo stacked well
 * above the vehicle's own visual model height still counts as loaded
 * (spec: "讓貨物可堆疊超過載具模型高度並仍被計入裝載") — the bottom is never
 * lowered, so the zone can't extend down through the floor either. */
export const CARGO_BOUNDS_HEIGHT_MULTIPLIER = 3;
