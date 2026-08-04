import * as THREE from 'three';
import { BACK_AREA, WALL_THICKNESS } from '../world-layout';
// Imported directly from pallet-data.ts, NOT the '../pallet' barrel (which
// also re-exports the heavier PalletSystem class) — matches
// tool-system.ts's own reasoning for importing isPalletId the narrow way
// elsewhere in this codebase, keeping this a pure data-only dependency.
import { PALLET_WALL_SLOTS } from '../pallet/pallet-data';

/** "Add ladder tool station and envelope vacuum" round一, reshaped into a
 * genuine A-frame by "Add regional envelope dispatch machine" round二 —
 * a single foldable ladder, NOT disguised as Cargo. Placement/dimension
 * constants live here, mirroring pallet-data.ts's own convention: nothing
 * hardcoded in ladder-system.ts, every wall coordinate DERIVED from
 * BACK_AREA/the pallet rack cluster it must clear rather than a bare
 * literal.
 *
 * FOLDED (stored on the wall) — spec: "折疊掛牆", flat slab profile: height
 *   1.8m / width 0.9m / thickness ~0.20-0.24m (a genuine A-frame's folded
 *   front+back legs sit slightly thicker than the old single-face design).
 * UNFOLDED — a real A-frame: front (climbing) legs + rear (support) legs
 *   hinged together at the top apex, spreader bars holding the splay open,
 *   NOT a single ramp/staircase leaning against anything. Standing height
 *   1.8m / width 0.9m / front-to-back footprint ~1.25-1.40m / front 8 steps
 *   @ 0.225m each (8*0.225=1.8m, matching the apex height exactly) / top
 *   platform depth ~0.40-0.45m. The footprint splits into frontRun (front
 *   legs' own horizontal projection, base to apex) + backRun (rear legs'
 *   own horizontal projection, apex to their own foot) — the front steps'
 *   own local frame (climb along +Z from the front foot at the origin) is
 *   UNCHANGED from the previous single-ramp design, just re-scaled to the
 *   new frontRun, so the walkable-step-collider logic in ladder-system.ts
 *   barely changes; only the rear legs (blocking, not climbable — spec:
 *   "不能從後側像走樓梯一樣直接走上去") are genuinely new geometry. */
export const LADDER_ID = 'ladder-01';
export const LADDER_RACK_ID = 'ladder-rack-01';
export const LADDER_DISPLAY_NAME = 'A字梯';

export const LADDER_FOLDED = {
  height: 1.8,
  width: 0.9,
  thickness: 0.22,
};

export const LADDER_STEP_COUNT = 8;
export const LADDER_STEP_HEIGHT = 0.225; // 8 * 0.225 = 1.8m total rise, matches the apex height
export const LADDER_UNFOLDED = {
  width: 0.9,
  standHeight: LADDER_STEP_COUNT * LADDER_STEP_HEIGHT, // 1.8m, the apex/hinge height
  /** Front legs' own horizontal projection, base foot to apex — replaces
   * the old single-ramp design's LADDER_RAMP_RUN, same role (the front
   * steps' own local Z frame is built from this exactly as before). */
  frontRun: 0.70,
  /** Rear (support) legs' own horizontal projection, apex to their own
   * foot — genuinely NEW this round (the old design had no rear leg at
   * all). Steeper than the front run by design (a real A-frame's rear
   * brace is usually shorter/steeper than its climbing side). */
  backRun: 0.60,
  platformDepth: 0.42,
};
/** Total front-foot-to-back-foot footprint depth (spec二: "前後腳底總深度：
 * 約1.25～1.40m") — frontRun + backRun = 0.70 + 0.60 = 1.30m, within range. */
export const LADDER_TOTAL_DEPTH = LADDER_UNFOLDED.frontRun + LADDER_UNFOLDED.backRun;

export const LADDER_FRONT_LEG_LENGTH = Math.sqrt(LADDER_UNFOLDED.standHeight ** 2 + LADDER_UNFOLDED.frontRun ** 2);
/** Tilt angle of the front legs/steps off horizontal — steeper than the
 * old single-ramp design since the footprint is now much more compact
 * (spec二's own A-frame proportions), but this no longer matters for
 * walkability the way it used to: the front is climbed via discrete Fixed
 * step colliders (autostep), never a continuous sloped collider, so no
 * max-slope-climb-angle concern here regardless of how steep this reads. */
export const LADDER_FRONT_LEG_ANGLE = Math.atan2(LADDER_UNFOLDED.standHeight, LADDER_UNFOLDED.frontRun);

export const LADDER_BACK_LEG_LENGTH = Math.sqrt(LADDER_UNFOLDED.standHeight ** 2 + LADDER_UNFOLDED.backRun ** 2);
export const LADDER_BACK_LEG_ANGLE = Math.atan2(LADDER_UNFOLDED.standHeight, LADDER_UNFOLDED.backRun);

/** How far above the floor the folded ladder's own BOTTOM edge hangs while
 * wall-mounted — kept small (near the ground, same spirit as the pallet
 * racks' own "玩家站在地面即可瞄準並拿取") but non-zero so it doesn't visually
 * clip into the floor. */
const LADDER_BOTTOM_CLEARANCE = 0.1;
/** How far the folded ladder's own thin edge stands off the wall's inner
 * face — mirrors RACK_WALL_STANDOFF's role for the pallet racks. */
const LADDER_WALL_STANDOFF = 0.05;
/** Minimum gap between the ladder's own folded footprint (along the wall)
 * and the nearest pallet rack bracket's own footprint (spec一: "與最近掛架
 * 至少保留0.25m間距"). */
const LADDER_RACK_CLEARANCE = 0.25;

const eastWallInnerFaceX = BACK_AREA.maxX - WALL_THICKNESS / 2;

/** South edge (along-wall Z) of the large pallet rack's own bracket
 * footprint — the southernmost/closest existing wall fixture on this same
 * wall, so the ladder slot is anchored directly off IT rather than a bare
 * literal (matches this codebase's "derive every wall coordinate from the
 * structure it's relative to" convention — see pallet-data.ts's own
 * buildWallSlots doc comment). Position unchanged this round (spec二:
 * "保留目前掛架位置，除非新模型會穿牆" — the A-frame's folded footprint
 * (0.9m wide x 0.22m thick) is barely different from the old design's
 * (0.9m x 0.18m), so the existing slot stays clear of the wall/rack either
 * way — no repositioning needed). */
const largeRackSlot = PALLET_WALL_SLOTS.large;
const largeRackBracketSouthZ = largeRackSlot.position.z + largeRackSlot.bracketWidth / 2;

/** Wall-mount quaternion for the FOLDED ladder — a pure yaw (no tip needed,
 * unlike the pallet racks' own WALL_MOUNT_QUAT): the folded slab's own local
 * +Z axis (its thin/front face) is designed to already be its wall-normal
 * axis, so rotating -90° about world Y alone points that face into the room
 * (west, out of the east wall) with the slab's local +Y (height) and +X
 * (width) staying naturally vertical/along-wall — no separate tip rotation
 * required. */
export const LADDER_WALL_MOUNT_QUAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);

export const LADDER_WALL_SLOT = {
  id: LADDER_RACK_ID,
  position: new THREE.Vector3(
    eastWallInnerFaceX - LADDER_WALL_STANDOFF - LADDER_FOLDED.thickness / 2,
    BACK_AREA.floorY + LADDER_BOTTOM_CLEARANCE + LADDER_FOLDED.height / 2,
    largeRackBracketSouthZ + LADDER_RACK_CLEARANCE + LADDER_FOLDED.width / 2
  ),
  quaternion: LADDER_WALL_MOUNT_QUAT.clone(),
};

/** Manual wheel-controlled yaw step, matching pallet-system.ts's own
 * PLACEMENT_YAW_STEP exactly (spec二: "滾輪每格旋轉15°"). */
export const LADDER_PLACEMENT_YAW_STEP = THREE.MathUtils.degToRad(15);
