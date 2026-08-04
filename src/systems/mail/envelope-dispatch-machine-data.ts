import * as THREE from 'three';
import { BACK_AREA, WALL_THICKNESS, WEST_WALL_SHELVES } from '../world-layout';
import { LOST_FOUND_DOOR } from '../../data/world/lost-found-layout-data';
import { MailDestination } from './mail-types';

/** "Add regional envelope dispatch machine" round — placement/dimension
 * constants for the four-region envelope dispatcher, mirroring this
 * codebase's own "never hardcode a wall coordinate" convention (see
 * pallet-data.ts/ladder-data.ts). Placed in the space freed by removing
 * `west-shelf-1` (logistics-layout-data.ts's own REMOVED_NORTH_SHELF_ID) —
 * that shelf's own Z-span is fully RE-DERIVABLE from what's still standing
 * around it: its north edge was the lost-found door's own south edge plus
 * clearance, its south edge was flush against `west-shelf-2` (now the
 * northmost survivor)'s own north edge, with the shelf group's own
 * SHELF_GROUP_GAP between them. Deriving both bounds fresh here (rather than
 * hardcoding the old shelf's own former centerZ/width) means this file
 * automatically stays correct even if the shelf layout ever changes again.
 *
 * NOTE ("北牆" substitution): the spec text describes this machine's back as
 * flush against the back area's "北牆" (north wall). A repo-wide check
 * (WEST_WALL_SHELVES is the only shelf/general-cargo-storage data structure
 * in the codebase) confirmed no shelf — and no other general-cargo fixture —
 * has ever existed on BACK_AREA's actual north wall (minZ=10); every general
 * shelf, the bulletin board, and the TV all live on the WEST wall instead.
 * Since the spec's own instruction is to remove the genuinely northmost
 * EXISTING general shelf and place the dispatcher "in that freed spot", this
 * file treats "that freed spot" (west wall) as authoritative over the literal
 * "北牆" wording — flagged explicitly here and in the round's own report. */
const doorSouthEdgeZ = LOST_FOUND_DOOR.centerZ + LOST_FOUND_DOOR.halfWidth;
/** Clearance kept between the door's own south edge and the dispatcher's own
 * north edge — deliberately smaller than the general shelves' own 0.8m pick
 * (a plain open shelf's items can jut toward the walkway; this machine is a
 * single solid-sided cabinet with zero overhang, so a still-real but tighter
 * clearance is enough to keep the doorway's own landing space clear). */
const DISPATCHER_DOOR_CLEARANCE = 0.5;
const freedSpanNorthZ = doorSouthEdgeZ + DISPATCHER_DOOR_CLEARANCE;

/** WEST_WALL_SHELVES has already had west-shelf-1 filtered out by the time
 * this module loads (logistics-layout-data.ts's own module-init order), so
 * index 0 here is genuinely the new northmost SURVIVING shelf (west-shelf-2)
 * — its own north edge is the freed gap's south bound. */
const northmostRemainingShelf = WEST_WALL_SHELVES[0];
/** Real but tighter than the shelf-to-shelf SHELF_GROUP_GAP (0.5m) — a
 * finished cabinet doesn't need the same "player reaches into an open shelf
 * from the side" operating margin two adjacent open shelves need, just a
 * real non-zero separation so the two structures never visually/physically
 * touch. */
const DISPATCHER_SHELF_CLEARANCE = 0.1;
const freedSpanSouthZ = northmostRemainingShelf.centerZ - northmostRemainingShelf.width / 2 - DISPATCHER_SHELF_CLEARANCE;

const FREED_SPAN_WIDTH = freedSpanSouthZ - freedSpanNorthZ;

/** Four holes, spec: width 0.55-0.65m each, ≥0.12m gap between neighbors —
 * landed near the spec minimums (still fully within range) since the freed
 * gap left by a single shelf is narrower than the machine's own suggested
 * 3.4m external width; sized here so the whole machine's width fits the
 * freed span with real (if thin) clearance on every side — see the
 * dev-time guard below. */
const HOLE_WIDTH = 0.56;
const HOLE_GAP = 0.12;
const HOLE_SIDE_MARGIN = 0.05;

export const DISPATCH_MACHINE_WIDTH = HOLE_WIDTH * 4 + HOLE_GAP * 3 + HOLE_SIDE_MARGIN * 2;
/** Low end of the spec's own 1.5-1.7m suggested depth range, to conserve
 * interior floor space this close to the lost-found doorway. */
export const DISPATCH_MACHINE_DEPTH = 1.5;
/** Mid-range of the spec's own 2.3-2.5m suggested height. */
export const DISPATCH_MACHINE_HEIGHT = 2.4;

if (DISPATCH_MACHINE_WIDTH > FREED_SPAN_WIDTH) {
  // Same dev-time guard convention as pallet-data.ts's own wall-cluster
  // overflow check — never a hardcoded margin left unverified.
  console.error('[envelope-dispatch-machine-data] dispatcher width overflows the shelf-1 freed gap', {
    DISPATCH_MACHINE_WIDTH, FREED_SPAN_WIDTH,
  });
}

const westWallInnerFaceX = BACK_AREA.minX + WALL_THICKNESS / 2;
/** Mirrors SHELF_WALL_CLEARANCE's own role for the general shelves. */
const DISPATCHER_WALL_STANDOFF = 0.08;

export const DISPATCH_MACHINE_CENTER = new THREE.Vector3(
  westWallInnerFaceX + DISPATCHER_WALL_STANDOFF + DISPATCH_MACHINE_DEPTH / 2,
  BACK_AREA.floorY + DISPATCH_MACHINE_HEIGHT / 2,
  (freedSpanNorthZ + freedSpanSouthZ) / 2
);

const machineNorthEdgeZ = DISPATCH_MACHINE_CENTER.z - DISPATCH_MACHINE_WIDTH / 2;
const machineFrontFaceX = DISPATCH_MACHINE_CENTER.x + DISPATCH_MACHINE_DEPTH / 2;

export interface DispatchHoleConfig {
  region: MailDestination;
  displayName: string;
  centerX: number;
  centerY: number;
  centerZ: number;
  width: number;
  height: number;
  depth: number;
}

/** Player approaches from the room's interior (east of the west wall) and
 * faces WEST (-X) to aim at this machine — mirrors PALLET_WALL_SLOTS's own
 * verified reasoning for the opposite-facing east wall (there: facing +X,
 * left=-Z/north) — so facing -X, the player's own left hand points +Z
 * (south). Spec六's own "left to right: 台北/台中/日本/美國" therefore maps
 * to south-to-north in world space; laid out here north-to-south (matching
 * ascending Z) the physical order is the reverse: 美國/日本/台中/台北. */
const REGION_NORTH_TO_SOUTH_ORDER: { id: MailDestination; displayName: string }[] = [
  { id: 'usa', displayName: '美國' },
  { id: 'japan', displayName: '日本' },
  { id: 'taichung', displayName: '台中' },
  { id: 'taipei', displayName: '台北' },
];

/** Holes sit low on the machine's own front-facing throwing chamber (spec六:
 * "設在後下方牆面區域") — reachable by a thrown/placed/vacuum-blown envelope
 * from directly in front, near the bottom of the cabinet. */
const HOLE_HEIGHT = 0.4;
const HOLE_BOTTOM_CLEARANCE = 0.5;
const HOLE_DEPTH = 0.3;
/** Recessed inward from the machine's own front face — reads as "the back of
 * the open throwing chamber", not the true exterior wall-facing panel (which
 * would be unreachable from the front). */
const HOLE_FRONT_INSET = 0.4;

export const DISPATCH_HOLES: DispatchHoleConfig[] = (() => {
  const holes: DispatchHoleConfig[] = [];
  let cursorZ = machineNorthEdgeZ + HOLE_SIDE_MARGIN;
  for (const region of REGION_NORTH_TO_SOUTH_ORDER) {
    const centerZ = cursorZ + HOLE_WIDTH / 2;
    holes.push({
      region: region.id,
      displayName: region.displayName,
      centerX: machineFrontFaceX - HOLE_FRONT_INSET,
      centerY: BACK_AREA.floorY + HOLE_BOTTOM_CLEARANCE + HOLE_HEIGHT / 2,
      centerZ,
      width: HOLE_WIDTH,
      height: HOLE_HEIGHT,
      depth: HOLE_DEPTH,
    });
    cursorZ += HOLE_WIDTH + HOLE_GAP;
  }
  return holes;
})();

export function getDispatchHole(region: MailDestination): DispatchHoleConfig {
  return DISPATCH_HOLES.find((h) => h.region === region)!;
}

/** Each hole's own region+count display, mounted directly above it on the
 * machine's front face (spec六: "每個投入孔上方都有獨立顯示器"). */
export const DISPATCH_DISPLAY_HEIGHT_ABOVE_HOLE = 0.55;
export const DISPATCH_DISPLAY_X = machineFrontFaceX + 0.02;

/** Left-side pack button ("player-left" while facing the machine — mirrors
 * the hole ordering's own facing-west derivation above: player-left = south
 * side of the machine). Spec八: "距地約0.9-1.1m". */
const BUTTON_HEIGHT = 1.0;
export const DISPATCH_BUTTON_POSITION = new THREE.Vector3(
  DISPATCH_MACHINE_CENTER.x + DISPATCH_MACHINE_DEPTH / 2 - 0.3,
  BACK_AREA.floorY + BUTTON_HEIGHT,
  DISPATCH_MACHINE_CENTER.z + DISPATCH_MACHINE_WIDTH / 2 + 0.03
);

/** Spec八: "距離不超過2.5m", "約0.5秒防止單次按下重複觸發". */
export const DISPATCH_BUTTON_INTERACT_DISTANCE = 2.5;
export const DISPATCH_BUTTON_DEBOUNCE_SECONDS = 0.5;

/** Four output positions (spec九: "四個輸出位置對應四地區") — just outside the
 * machine's own front face, aligned with each region's own hole so a
 * generated bag appears directly below/in front of where its envelopes went
 * in. */
export function getDispatchOutputPosition(region: MailDestination): THREE.Vector3 {
  const hole = getDispatchHole(region);
  return new THREE.Vector3(machineFrontFaceX + 0.35, BACK_AREA.floorY, hole.centerZ);
}
