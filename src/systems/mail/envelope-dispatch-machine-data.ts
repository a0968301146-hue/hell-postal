import * as THREE from 'three';
import { BACK_AREA, WALL_THICKNESS, WEST_WALL_SHELVES } from '../world-layout';
import { LOST_FOUND_DOOR } from '../../data/world/lost-found-layout-data';
import { MailDestination } from './mail-types';

/** "Add regional envelope dispatch machine" round, reshaped into a
 * basketball-arcade/chute silhouette by its own follow-up round — placement/
 * dimension constants for the four-region envelope dispatcher, mirroring
 * this codebase's own "never hardcode a wall coordinate" convention (see
 * pallet-data.ts/ladder-data.ts). Placed in the space freed by removing
 * `west-shelf-1` (logistics-layout-data.ts's own REMOVED_NORTH_SHELF_ID) —
 * that shelf's own Z-span is fully RE-DERIVABLE from what's still standing
 * around it: its north edge was the lost-found door's own south edge plus
 * clearance, its south edge was flush against `west-shelf-2` (now the
 * northmost survivor)'s own north edge. Deriving both bounds fresh here
 * (rather than hardcoding the old shelf's own former centerZ/width) means
 * this file automatically stays correct even if the shelf layout ever
 * changes again.
 *
 * NOTE ("北牆" substitution, unchanged from the previous round): the spec
 * text describes this machine's back as flush against the back area's "北牆"
 * (north wall). A repo-wide check (WEST_WALL_SHELVES is the only shelf/
 * general-cargo-storage data structure in the codebase) confirmed no shelf —
 * and no other general-cargo fixture — has ever existed on BACK_AREA's
 * actual north wall (minZ=10); every general shelf, the bulletin board, and
 * the TV all live on the WEST wall instead. This file treats "the freed
 * shelf-1 spot" (west wall) as authoritative over the literal "北牆" wording.
 *
 * Shape rework (this round): no more four separate boxes protruding across
 * the front-lower face. The new structure — a coin-op-basketball-machine
 * silhouette — is: a thick base plinth + open-front left/right side panels
 * (buildCabinet, in envelope-dispatch-machine-system.ts), ONE upright BACK
 * PANEL flush against the real wall carrying all four holes in a 2x2 grid
 * (buildBackPanel), and a single continuous RAMP rising from the open front
 * entry up to the base of that back panel (buildRamp) — an envelope that
 * misses every hole lands on this ramp and, thanks to its real slope and low
 * collider friction, slides back down toward the player under ordinary
 * gravity (no scripted "bounce" impulse needed — see
 * EnvelopeDispatchMachineSystem's own class doc comment). */
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

/** A 2x2 hole grid on a single back panel needs far less along-wall width
 * than the old "4 holes side by side" layout did — narrowed from the
 * previous round's 2.7m to a more genuinely arcade-cabinet-like proportion,
 * still comfortably inside the freed gap (see the dev-time guard below). */
export const DISPATCH_MACHINE_WIDTH = 2.0;
/** Within the spec's own 1.5-1.7m suggested depth range — needs real depth
 * to fit both the ramp's own run and the base plinth/back panel. */
export const DISPATCH_MACHINE_DEPTH = 1.6;
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

/** X of the machine's own back boundary (closest to the real wall) and front
 * boundary (open entry, facing the room/player) — every other X below is
 * derived from these two, never a second independent literal. */
const backFaceX = DISPATCH_MACHINE_CENTER.x - DISPATCH_MACHINE_DEPTH / 2;
const frontFaceX = DISPATCH_MACHINE_CENTER.x + DISPATCH_MACHINE_DEPTH / 2;

/** Thickness of the upright back panel the four holes are cut into. */
export const DISPATCH_BACK_PANEL_THICKNESS = 0.12;
/** The panel's own front (player-facing) surface X — where the ramp's own
 * top edge terminates and where each hole's sensor volume is centered. */
const backPanelFrontX = backFaceX + DISPATCH_BACK_PANEL_THICKNESS;

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
 * (south). Spec's own 2x2 layout (top-left 台中, top-right 日本, bottom-left
 * 台北, bottom-right 美國) is described from the PLAYER's own point of view,
 * so "left" columns sit at +Z (south) and "right" columns at -Z (north) in
 * world space. */
const REGION_GRID: { region: MailDestination; displayName: string; row: 'top' | 'bottom'; col: 'left' | 'right' }[] = [
  { region: 'taichung', displayName: '台中', row: 'top', col: 'left' },
  { region: 'japan', displayName: '日本', row: 'top', col: 'right' },
  { region: 'taipei', displayName: '台北', row: 'bottom', col: 'left' },
  { region: 'usa', displayName: '美國', row: 'bottom', col: 'right' },
];

const HOLE_WIDTH = 0.5;
const HOLE_HEIGHT = 0.45;
const HOLE_COL_GAP = 0.25;
const HOLE_ROW_GAP = 0.25;
/** Sensor volume's own X-extent — straddles the panel's own front face (see
 * backPanelFrontX above) so an envelope resting flush against the solid
 * panel (its own physics collider stops it right there) sits with its
 * CENTER comfortably inside this range, regardless of which hole it's
 * aimed at. */
const HOLE_DEPTH = 0.3;
/** Vertical/along-wall center of the whole 2x2 grid, above the floor. */
const GRID_CENTER_Y_ABOVE_FLOOR = 1.5;

const gridCenterY = BACK_AREA.floorY + GRID_CENTER_Y_ABOVE_FLOOR;
const holeCenterX = backPanelFrontX + HOLE_DEPTH / 2 - 0.05;
const colOffsetZ = HOLE_WIDTH / 2 + HOLE_COL_GAP / 2;
const rowOffsetY = HOLE_HEIGHT / 2 + HOLE_ROW_GAP / 2;

export const DISPATCH_HOLES: DispatchHoleConfig[] = REGION_GRID.map((cell) => ({
  region: cell.region,
  displayName: cell.displayName,
  centerX: holeCenterX,
  centerY: cell.row === 'top' ? gridCenterY + rowOffsetY : gridCenterY - rowOffsetY,
  // "col: left" is the PLAYER's own left (south, +Z) — see REGION_GRID's own doc comment above.
  centerZ: cell.col === 'left' ? DISPATCH_MACHINE_CENTER.z + colOffsetZ : DISPATCH_MACHINE_CENTER.z - colOffsetZ,
  width: HOLE_WIDTH,
  height: HOLE_HEIGHT,
  depth: HOLE_DEPTH,
}));

export function getDispatchHole(region: MailDestination): DispatchHoleConfig {
  return DISPATCH_HOLES.find((h) => h.region === region)!;
}

/** Each hole's own region+count display, mounted directly above/beside it on
 * the back panel's own front face (spec: "地區名稱顯示在洞口上方/附近"). */
export const DISPATCH_DISPLAY_HEIGHT_ABOVE_HOLE = 0.35;
export const DISPATCH_DISPLAY_X = backPanelFrontX + 0.05;

/** The lowest row of holes' own bottom edge — the ramp's top edge lines up
 * flush with this, so the ramp reads as one continuous surface leading
 * straight into the bottom-row hole openings (the top row is still
 * reachable by a slightly higher throw arc over the same ramp). */
const bottomRowHoleBottomY = gridCenterY - rowOffsetY - HOLE_HEIGHT / 2;

/** Ramp ("green zone" in the spec's own sketch) — a single tilted surface
 * spanning the machine's full open-front entry, from a low point just
 * inside the front opening up to the base of the back panel's own hole
 * grid. Exported as plain endpoints (not a precomputed quaternion) so
 * envelope-dispatch-machine-system.ts can build BOTH the visual mesh and the
 * physics collider from the exact same two points via
 * THREE.Quaternion.setFromUnitVectors, guaranteeing they can never drift
 * apart. */
export const DISPATCH_RAMP = {
  bottom: new THREE.Vector3(frontFaceX - 0.15, BACK_AREA.floorY + 0.2, DISPATCH_MACHINE_CENTER.z),
  top: new THREE.Vector3(holeCenterX, bottomRowHoleBottomY, DISPATCH_MACHINE_CENTER.z),
  /** Along-wall (Z) width of the ramp surface — the machine's own interior
   * usable width, inset from the two side panels. */
  crossWidth: DISPATCH_MACHINE_WIDTH - 0.24,
  thickness: 0.08,
};

/** Left-side pack button ("player-left" while facing the machine — mirrors
 * the hole grid's own facing-west derivation above: player-left = south
 * side of the machine). Spec: "距地約0.9-1.1m". */
const BUTTON_HEIGHT = 1.0;
export const DISPATCH_BUTTON_POSITION = new THREE.Vector3(
  DISPATCH_MACHINE_CENTER.x + DISPATCH_MACHINE_DEPTH / 2 - 0.3,
  BACK_AREA.floorY + BUTTON_HEIGHT,
  DISPATCH_MACHINE_CENTER.z + DISPATCH_MACHINE_WIDTH / 2 + 0.03
);

/** Spec: "距離不超過2.5m", "約0.5秒防止單次按下重複觸發". */
export const DISPATCH_BUTTON_INTERACT_DISTANCE = 2.5;
export const DISPATCH_BUTTON_DEBOUNCE_SECONDS = 0.5;

/** Four output positions (spec: "四個輸出位置對應四地區") — spread along the
 * machine's own front ledge, grouped left(south)/right(north) the same way
 * as their own hole's column, so a generated bag appears roughly under
 * where its envelopes went in. Independent of the hole grid's own Y/Z
 * layout — bags rest on the floor, not the wall. */
const OUTPUT_Z_OFFSET: Record<MailDestination, number> = {
  taichung: 0.6,
  taipei: 0.2,
  japan: -0.2,
  usa: -0.6,
};

export function getDispatchOutputPosition(region: MailDestination): THREE.Vector3 {
  return new THREE.Vector3(frontFaceX + 0.35, BACK_AREA.floorY, DISPATCH_MACHINE_CENTER.z + OUTPUT_Z_OFFSET[region]);
}
