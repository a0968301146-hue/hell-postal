// Cargo category — the single classification every cargo item carries
// exactly one of (spec "簡易_貨物型態限制": 一般/易碎/大型貨物/冷凍/活物).
//
// "Organize and expand cargo shape presets" round: widened from the old
// 4-value inspection-only CargoCategory (normal/fragile/frozen/live) to also
// cover 'large' — previously "large" was a fact ONLY derivable from
// CargoData.shapeType==='large' (see vehicle-control-system.ts's
// effectiveCargoKind), completely separate from this category concept, and a
// daily item's category (fragile/frozen/live) was picked independently of
// its actual shape via the old cyclic pickCargoCategory() below — meaning a
// plain box silhouette could randomly end up "frozen" with no visual cue.
// Every CargoShapePreset (cargo-shape-presets.ts) now carries a FIXED
// category as one of its own defining fields, so a spawned item's category
// is simply copied from whichever preset was picked — never assigned
// independently, never re-derived from the mesh. CargoData.category keeps
// its old field name/shape (`CargoCategory | null`) so every existing
// external reader (vehicle-control-system.ts's effectiveCargoKind,
// codex-data.ts, cargo-inspection-ui.ts) keeps compiling untouched — it just
// now legitimately includes 'large' as a possible value.
export type CargoCategory = 'normal' | 'fragile' | 'large' | 'frozen' | 'live';

/** Display text for the inspection UI / codex — 'frozen' stays the internal
 * string (matches CargoType in cargo-data.ts, which vehicle-data.ts's
 * VehicleConfig.acceptedCargoTypes and every other vehicle-facing file
 * already keys on) even though the spec's own vocabulary calls it "cold" —
 * renaming the identifier would ripple into vehicle-data.ts and other
 * out-of-scope files for zero behavioral benefit; only the display word
 * ("冷凍貨物") needs to match the spec's naming, which it already does. */
export const CARGO_CATEGORY_DISPLAY: Record<CargoCategory, string> = {
  normal: '一般',
  fragile: '易碎品',
  large: '大型貨物',
  frozen: '冷凍',
  live: '活體',
};
