// Spatial config for the new modular mail/envelope-stamping loop ("Add
// modular envelope stamping and regional mail bag system" round). Kept
// entirely separate from logistics-layout-data.ts/daily-flow-data.ts, same
// convention as lost-found-layout-data.ts — this feature's own furniture
// positions never scatter into scene/system files. BAG_STAGING_AREA (an
// unused/decorative suggested-spot constant — nothing actually reads it,
// bag spawn position is computed straight from BAG_RACK below) stays
// anchored to the original west work-furniture cluster (WORK_FURNITURE_X=-8
// area); it's untouched by either the "Improve mail table placement and
// open mail bags" round (which relocated STAMP_TABLE to the north wall) or
// this "Move mail bag supply beside stamp table" round (which relocated
// BAG_RACK next to it) — a literal Z anchor rather than importing
// PACKAGE_WORK_ZONE, to keep this file mostly a leaf with no dependency on
// logistics-layout-data.ts beyond the one explicit BACK_AREA/WALL_THICKNESS
// import below.
import { BACK_AREA, WALL_THICKNESS } from '../../systems/world-layout/logistics-layout-data';
import { CARGO_BOX_PRESETS } from '../../systems/cargo/cargo-data';

export const MAIL_WORK_AREA_X = -8;
export const MAIL_WORK_AREA_Z = 17.0;

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

/** Empty-bag supply rack — press E here to spawn a new open MailBag (spec
 * 六). "Move mail bag supply beside stamp table" round: relocated next to
 * STAMP_TABLE, on its EAST side — the table's own front faces south/+Z (the
 * player approaches from the open floor south of the wall), so the player
 * faces north/-Z while interacting with it, making east/+X their own right
 * hand (spec: "放在工作桌右側"). Both pieces' BACK faces share the exact
 * same north-wall clearance line (northWallInnerFaceZ +
 * STAMP_TABLE_WALL_CLEARANCE) — "沿北牆排列，背面方向一致" — and the gap
 * between the table's east edge and the rack's west edge is computed (not
 * hand-picked) to land inside the requested 0.4-0.6m range. The rack sits
 * entirely east of the table (never in front of it — spec: "不要放在工作桌
 * 正前方"), and its whole footprint (x -5.7..-5.0) stays well clear of the
 * 開始卸貨/結束今天 button posts (x=-4, ~0.9m gap), the north-a unload gate
 * (x -2..2, ~3m gap), UNLOAD_ZONE's own drop path (x -1.7..6.7), and the
 * lost-found cabinet (x -9.85..-9.16, on the table's OTHER side) — no
 * overlap with any of them, and no blocking of the player's own corridor
 * (footprint stays tucked against the wall, z 10.18..10.68). */
const BAG_RACK_TABLE_GAP = 0.5;
const BAG_RACK_WIDTH = 0.7;
const BAG_RACK_DEPTH = 0.5;
const BAG_RACK_HEIGHT = 1.1;
export const BAG_RACK = {
  posX: STAMP_TABLE.posX + STAMP_TABLE_WIDTH / 2 + BAG_RACK_TABLE_GAP + BAG_RACK_WIDTH / 2,
  posZ: northWallInnerFaceZ + STAMP_TABLE_WALL_CLEARANCE + BAG_RACK_DEPTH / 2,
  width: BAG_RACK_WIDTH,
  depth: BAG_RACK_DEPTH,
  height: BAG_RACK_HEIGHT,
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

/** Mail bag sizing ("Resize mail bags and fix supply rack interaction" round
 * 一: "外部尺寸至少等同現有中型貨物...直接讀取中型貨物尺寸設定，不另外寫死
 * 一套數值") — reads CARGO_BOX_PRESETS.mediumBox.dimensions directly (the
 * SAME preset UnloadingSystem/CargoSystem already spawn as regular daily
 * cargo) rather than a separate hand-picked bag-size constant. Interior is
 * back-derived so mail-bag-system.ts's own existing TOTAL_WIDTH/HEIGHT/DEPTH
 * reconstruction (interior + wall thickness) lands EXACTLY on the medium
 * box's own exterior dimensions — width/depth lose thickness on BOTH sides
 * (left+right / front+back walls), height loses it on ONE side only (the
 * open top has no wall, spec: "袋口與內部必須保持鏤空"). Comfortably still
 * clears the earlier round's own 1.25x-envelope-plane and 12-envelope-
 * stack-height minimums (this only ever grew those margins, never shrank
 * them). */
/** "Enlarge mail bags and add E key letter placement" round 一: "再加大信封
 * 袋，整體尺寸放大為現有的1.5倍" — a single scale factor applied to both the
 * base exterior footprint AND the wall thickness, so the interior/collider/
 * insertion-bounds/pickup-size derivations below (already parameterized off
 * these two constants since the previous round) all grow together with zero
 * further code changes. */
const MAIL_BAG_SCALE = 1.5;
const MAIL_BAG_EXTERIOR = {
  width: CARGO_BOX_PRESETS.mediumBox.dimensions.width * MAIL_BAG_SCALE,
  depth: CARGO_BOX_PRESETS.mediumBox.dimensions.depth * MAIL_BAG_SCALE,
  height: CARGO_BOX_PRESETS.mediumBox.dimensions.height * MAIL_BAG_SCALE,
};

/** Single source of truth for every mail box measurement ("Align mail box
 * colliders with visible mesh" round二: "建立單一MailBoxDimensions設定...
 * 不可再各自寫死不同數值") — the Mesh (mail-data.ts buildBoxGeometry), all
 * 5 Colliders, the box-mouth footprint, interiorBounds, the E-key drop
 * point, Q-throw acceptance, and a boxed envelope's own stacking position
 * (all in mail-bag-system.ts) now read exclusively from this one object
 * instead of separately reconstructing width/height/depth from
 * MAIL_BAG_EXTERIOR/wall-thickness math in more than one place. Exterior
 * footprint is UNCHANGED from before this round (spec: "不要修改信封箱外觀
 * 設計") — still MAIL_BAG_EXTERIOR's own numbers, still scaled off the same
 * medium-cargo preset. `wallThickness` (side walls) and `bottomThickness`
 * (bottom board) are kept as two independently-named fields per spec's own
 * requested shape, but deliberately share the SAME numeric value here (the
 * box's real wall/bottom boards were always built at one uniform thickness
 * — this is a naming/shape change only, not a visual one). */
export interface MailBoxDimensions {
  outerWidth: number;
  outerDepth: number;
  outerHeight: number;
  wallThickness: number;
  bottomThickness: number;
  innerWidth: number;
  innerDepth: number;
  innerHeight: number;
}

const MAIL_BOX_WALL_THICKNESS = 0.03 * MAIL_BAG_SCALE;
const MAIL_BOX_BOTTOM_THICKNESS = MAIL_BOX_WALL_THICKNESS;

export const MAIL_BOX_DIMENSIONS: MailBoxDimensions = {
  outerWidth: MAIL_BAG_EXTERIOR.width,
  outerDepth: MAIL_BAG_EXTERIOR.depth,
  outerHeight: MAIL_BAG_EXTERIOR.height,
  wallThickness: MAIL_BOX_WALL_THICKNESS,
  bottomThickness: MAIL_BOX_BOTTOM_THICKNESS,
  innerWidth: MAIL_BAG_EXTERIOR.width - MAIL_BOX_WALL_THICKNESS * 2,
  innerDepth: MAIL_BAG_EXTERIOR.depth - MAIL_BOX_WALL_THICKNESS * 2,
  innerHeight: MAIL_BAG_EXTERIOR.height - MAIL_BOX_BOTTOM_THICKNESS,
};
