// Spatial config for the new modular mail/envelope-stamping loop ("Add
// modular envelope stamping and regional mail bag system" round). Kept
// entirely separate from logistics-layout-data.ts/daily-flow-data.ts, same
// convention as lost-found-layout-data.ts — this feature's own furniture
// positions never scatter into scene/system files. Sits in BACK_AREA's own
// west work-furniture cluster (WORK_FURNITURE_X=-8 area), well clear of the
// unload debris zone (z<=14.3), the lost-found cabinet (x -9.85..-9.16,
// z 10.48..13.52), the pallet (x=-4, z=15.5) and the dolly's parked spot
// (x=7, z=16) — a literal Z anchor rather than importing PACKAGE_WORK_ZONE,
// to keep this file a leaf with no dependency on logistics-layout-data.ts.
export const MAIL_WORK_AREA_X = -8;
export const MAIL_WORK_AREA_Z = 17.0;

export const STAMP_TABLE = {
  posX: MAIL_WORK_AREA_X,
  posZ: MAIL_WORK_AREA_Z,
  width: 1.6,
  depth: 1.0,
  height: 0.9,
  legWidth: 0.08,
};

/** Empty-bag supply rack — press E here to spawn a new open MailBag (spec
 * 六). East of the stamp table, its own footprint. */
export const BAG_RACK = {
  posX: MAIL_WORK_AREA_X + 2.1,
  posZ: MAIL_WORK_AREA_Z,
  width: 0.7,
  depth: 0.5,
  height: 1.1,
};

/** Open floor south of the rack/table where newly-spawned bags naturally
 * land/get placed while being worked on (spec六: "分類袋暫放區") — purely a
 * suggested staging spot, not a hard placement requirement; bags are
 * ordinary physical InteractableObjects once spawned. */
export const BAG_STAGING_AREA = {
  minX: MAIL_WORK_AREA_X + 0.3, maxX: MAIL_WORK_AREA_X + 3.2,
  minZ: MAIL_WORK_AREA_Z + 1.2, maxZ: MAIL_WORK_AREA_Z + 3.0,
};

/** Envelope physical footprint — a thin flat box (spec三: "薄型3D模型"), same
 * general thinness convention the old envelope-data.ts used (height<=0.05
 * reads as "thin/envelope-like" elsewhere in this codebase). */
export const ENVELOPE_SIZE = {
  width: 0.24,
  height: 0.02,
  depth: 0.17,
};

/** Bag physical footprint — large enough to plausibly hold up to `capacity`
 * envelopes, small enough to stay a normal hand-held/throwable prop. Count/
 * capacity constants (DAILY_ENVELOPE_COUNT, MAX_OPEN_BAGS, MAIL_BAG_CAPACITY)
 * live in mail-data.ts instead — this file stays pure spatial config. */
export const MAIL_BAG_SIZE = {
  width: 0.34,
  height: 0.4,
  depth: 0.22,
};
