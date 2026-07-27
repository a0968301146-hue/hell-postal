// Spatial config for the new modular mail/envelope-stamping loop ("Add
// modular envelope stamping and regional mail bag system" round). Kept
// entirely separate from logistics-layout-data.ts/daily-flow-data.ts, same
// convention as lost-found-layout-data.ts — this feature's own furniture
// positions never scatter into scene/system files. BAG_RACK/BAG_STAGING_AREA
// stay anchored to the original west work-furniture cluster (WORK_FURNITURE_X
// =-8 area) — "Improve mail table placement and open mail bags" round only
// relocates STAMP_TABLE (below) to the north wall; nothing else here moved.
// A literal Z anchor for THIS anchor rather than importing PACKAGE_WORK_ZONE,
// to keep this file mostly a leaf with no dependency on logistics-layout-
// data.ts beyond the one explicit BACK_AREA/WALL_THICKNESS import below.
import { BACK_AREA, WALL_THICKNESS } from '../../systems/world-layout/logistics-layout-data';

export const MAIL_WORK_AREA_X = -8;
export const MAIL_WORK_AREA_Z = 17.0;

/** Empty-bag supply rack — press E here to spawn a new open MailBag (spec
 * 六). Its own footprint, unchanged by this round — only STAMP_TABLE moved. */
export const BAG_RACK = {
  posX: MAIL_WORK_AREA_X + 2.1,
  posZ: MAIL_WORK_AREA_Z,
  width: 0.7,
  depth: 0.5,
  height: 1.1,
};

/** Stamp table — moved to the north wall ("Improve mail table placement and
 * open mail bags" round 一: "工作桌貼齊北牆"). Sits in the solid wall segment
 * WEST of the north-a unload gate (gate span x -2..2) — clear of both north
 * unload ports/chutes and their UNLOAD_ZONE drop path (x -1.7..6.7,
 * z 10.3..14.3, see daily-flow-data.ts), and positioned between the
 * lost-found cabinet (x -9.85..-9.16, z 10.48..13.52) and the 開始卸貨/結束
 * 今天 button posts (x=-4, z 11.2/12.8) with clear standing gaps on both
 * sides (spec: "與左右其他設施保留明顯間距，不要連成一整排") — table spans
 * x -7.8..-6.2, leaving ~1.36m to the cabinet's east edge and ~1.8m to the
 * button posts. posZ is derived from the north wall's own physical inner
 * face (BACK_AREA.minZ + WALL_THICKNESS/2) plus a small real-world gap
 * (STAMP_TABLE_WALL_CLEARANCE) so the table's back never overlaps the wall's
 * own Mesh/Collider (spec: "保留約0.05~0.1m，避免Mesh／Collider重疊") —
 * computed here, the ONE place this position is defined (never hardcoded in
 * game-app.ts). */
const STAMP_TABLE_WALL_CLEARANCE = 0.08;
const STAMP_TABLE_WIDTH = 1.6;
const STAMP_TABLE_DEPTH = 1.0;
const northWallInnerFaceZ = BACK_AREA.minZ + WALL_THICKNESS / 2;
export const STAMP_TABLE = {
  posX: -7.0,
  posZ: northWallInnerFaceZ + STAMP_TABLE_WALL_CLEARANCE + STAMP_TABLE_DEPTH / 2,
  width: STAMP_TABLE_WIDTH,
  depth: STAMP_TABLE_DEPTH,
  height: 0.9,
  legWidth: 0.08,
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

/** Mail bag INTERIOR — a genuine open-top cavity now ("Improve mail table
 * placement and open mail bags" round二/四), not a solid box. width/depth
 * comfortably exceed 1.25x ENVELOPE_SIZE's own plane dims (spec四:
 * 0.24*1.25=0.30 / 0.17*1.25=0.2125 minimums — width=0.32/depth=0.24 here
 * both clear that with margin) and height leaves room to stack up to
 * MAIL_BAG_CAPACITY (12, mail-data.ts) envelopes (12 * ENVELOPE_SIZE.height
 * plus per-item spacing ≈ 0.3m, comfortably under height=0.35). Collider
 * walls (mail-bag-system.ts: bottom + left/right/front/back, no top) are
 * built THICKNESS beyond these interior bounds — see MAIL_BAG_WALL_THICKNESS.
 * Overall footprint (interior + 2*thickness on X/Z, + thickness on Y for the
 * bottom only) stays comfortably at/under a normal small cargo box's own
 * size (spec: "不要把袋子做得比一般貨箱更大" — cf. cargo-data.ts smallBox
 * 0.28x0.26x0.28). */
export const MAIL_BAG_INTERIOR = {
  width: 0.32,
  depth: 0.24,
  height: 0.35,
};
export const MAIL_BAG_WALL_THICKNESS = 0.03;
