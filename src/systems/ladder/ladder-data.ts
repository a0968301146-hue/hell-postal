import * as THREE from 'three';
import { BACK_AREA, WALL_THICKNESS } from '../world-layout';
// Imported directly from pallet-data.ts, NOT the '../pallet' barrel (which
// also re-exports the heavier PalletSystem class) — matches
// tool-system.ts's own reasoning for importing isPalletId the narrow way
// elsewhere in this codebase, keeping this a pure data-only dependency.
import { PALLET_WALL_SLOTS } from '../pallet/pallet-data';

/** "Add ladder tool station and envelope vacuum" round — a single foldable
 * ladder (spec一), NOT disguised as Cargo. Placement/dimension constants
 * live here, mirroring pallet-data.ts's own convention: nothing hardcoded in
 * ladder-system.ts, every wall coordinate DERIVED from BACK_AREA/the pallet
 * rack cluster it must clear rather than a bare literal.
 *
 * FOLDED (stored on the wall) — spec: "折疊掛牆", flat slab profile:
 *   height 1.8m / width 0.9m / thickness ~0.18m.
 * UNFOLDED (preview/placed on the floor) — spec: "最高站立高度約1.8m /
 *   寬約0.9m / 展開深度約2.0m / 約8階 / 每階高度約0.225m / 頂部平台深度約0.45m".
 * 8 steps * 0.225m rise = 1.8m total rise, matching the standing platform
 * height exactly. Total footprint depth (2.0m) minus the platform's own
 * depth (0.45m) leaves 1.55m of horizontal run for that 1.8m rise — the
 * ramp collider below is sized/tilted from these two numbers directly. */
export const LADDER_ID = 'ladder-01';
export const LADDER_RACK_ID = 'ladder-rack-01';
export const LADDER_DISPLAY_NAME = '木梯';

export const LADDER_FOLDED = {
  height: 1.8,
  width: 0.9,
  thickness: 0.18,
};

export const LADDER_STEP_COUNT = 8;
export const LADDER_STEP_HEIGHT = 0.225; // 8 * 0.225 = 1.8m total rise
export const LADDER_UNFOLDED = {
  width: 0.9,
  totalDepth: 2.0,
  platformDepth: 0.45,
  standHeight: LADDER_STEP_COUNT * LADDER_STEP_HEIGHT, // 1.8m
};
/** Horizontal run covered by the sloped ramp portion alone (excludes the
 * flat top platform's own depth). */
export const LADDER_RAMP_RUN = LADDER_UNFOLDED.totalDepth - LADDER_UNFOLDED.platformDepth; // 1.55m
export const LADDER_RAMP_LENGTH = Math.sqrt(LADDER_UNFOLDED.standHeight ** 2 + LADDER_RAMP_RUN ** 2);
/** Tilt angle of the ramp collider/visual rails off horizontal. */
export const LADDER_RAMP_ANGLE = Math.atan2(LADDER_UNFOLDED.standHeight, LADDER_RAMP_RUN);

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
 * buildWallSlots doc comment). */
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
