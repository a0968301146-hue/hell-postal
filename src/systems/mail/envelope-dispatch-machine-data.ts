import * as THREE from 'three';
import { BACK_AREA, WALL_THICKNESS, WEST_WALL_SHELVES } from '../world-layout';
import { LOST_FOUND_DOOR } from '../../data/world/lost-found-layout-data';
import { MailDestination } from './mail-types';

/** "Add regional envelope dispatch machine" round, reshaped into a
 * basketball-arcade/chute silhouette by its first follow-up round, then
 * widened east-west with genuinely-recessed holes by this second follow-up
 * round — placement/dimension constants for the four-region envelope
 * dispatcher, mirroring this codebase's own "never hardcode a wall
 * coordinate" convention (see pallet-data.ts/ladder-data.ts). Placed in the
 * space freed by removing `west-shelf-1` (logistics-layout-data.ts's own
 * REMOVED_NORTH_SHELF_ID) — that shelf's own Z-span is fully RE-DERIVABLE
 * from what's still standing around it: its north edge was the lost-found
 * door's own south edge plus clearance, its south edge was flush against
 * `west-shelf-2` (now the northmost survivor)'s own north edge.
 *
 * NOTE ("北牆" substitution, unchanged from earlier rounds): the spec text
 * describes this machine's back as flush against the back area's "北牆"
 * (north wall). A repo-wide check confirmed no shelf/general-cargo fixture
 * has ever existed on BACK_AREA's actual north wall (minZ=10) — every
 * general shelf, the bulletin board, and the TV all live on the WEST wall
 * instead. This file treats "the freed shelf-1 spot" (west wall) as
 * authoritative over the literal "北牆" wording.
 *
 * Axis note (this round's own clarification): the requester's own "東西向"
 * (east-west) wording in this round's spec refers to the true compass X
 * axis (wall-to-room depth — BACK_AREA's own East=+X/West=-X convention),
 * NOT the along-wall Z axis (which runs north-south, holds the four-hole
 * grid, and is what the earlier rounds' own "width" reports described). This
 * round widens DISPATCH_MACHINE_DEPTH (X) substantially for a longer ramp/
 * throw distance; the along-wall Z extent (DISPATCH_MACHINE_WIDTH) stays at
 * the maximum SAFE size that still keeps real clearance from both the
 * lost-found door and west-shelf-2 (confirmed via the requester's own
 * explicit follow-up: "沿牆的南北向寬度維持目前安全尺寸...不可碰到
 * west-shelf-2、門口"). */
const doorSouthEdgeZ = LOST_FOUND_DOOR.centerZ + LOST_FOUND_DOOR.halfWidth;
/** Small but genuinely real clearance from the door's own south edge (down
 * from an earlier round's more conservative 0.5m) — the requester explicitly
 * asked for the maximum along-wall width that still keeps real, non-zero
 * separation from both neighbors, so this file now uses the smallest
 * clearance still worth calling "real" (matches DISPATCHER_WALL_STANDOFF's
 * own 0.08m precedent below) rather than a more generous hand-picked
 * number. */
const DISPATCHER_DOOR_CLEARANCE = 0.08;
const freedSpanNorthZ = doorSouthEdgeZ + DISPATCHER_DOOR_CLEARANCE;

/** WEST_WALL_SHELVES has already had west-shelf-1 filtered out by the time
 * this module loads (logistics-layout-data.ts's own module-init order), so
 * index 0 here is genuinely the new northmost SURVIVING shelf (west-shelf-2)
 * — its own north edge is the freed gap's south bound. */
const northmostRemainingShelf = WEST_WALL_SHELVES[0];
/** Same reduced-but-real clearance reasoning as DISPATCHER_DOOR_CLEARANCE
 * above. */
const DISPATCHER_SHELF_CLEARANCE = 0.08;
const freedSpanSouthZ = northmostRemainingShelf.centerZ - northmostRemainingShelf.width / 2 - DISPATCHER_SHELF_CLEARANCE;

/** Along-wall (Z, north-south) extent — DERIVED as the full freed span minus
 * the two clearances above, never a second independent hand-picked number
 * (spec's own follow-up: "~3.15-3.2m" — this lands at ~3.17m, squarely in
 * that range, purely as a consequence of the real freed-space math rather
 * than being separately hardcoded to match). */
export const DISPATCH_MACHINE_WIDTH = freedSpanSouthZ - freedSpanNorthZ;
/** Wall-to-room depth (X, true east-west) — widened substantially this round
 * (up from 1.6m) for a longer, more genuine "basketball machine" throw
 * distance between the open front entry and the back panel's own holes
 * (spec: "讓玩家與背板洞口之間有更完整的投遞距離"). Nothing on the east side of
 * this wall is anywhere near close enough to conflict — every other back-area
 * fixture (pallet racks, the ladder, the tool cart) lives on the far EAST
 * wall instead. */
export const DISPATCH_MACHINE_DEPTH = 2.8;
/** Unchanged this round (spec: "高度...可維持目前數值"). */
export const DISPATCH_MACHINE_HEIGHT = 2.4;

const westWallInnerFaceX = BACK_AREA.minX + WALL_THICKNESS / 2;
/** Mirrors SHELF_WALL_CLEARANCE's own role for the general shelves — the
 * back panel's own standoff from the real wall, UNCHANGED by this round's
 * depth increase (spec: "背板仍貼近西牆") — DISPATCH_MACHINE_CENTER's own
 * formula below keeps backFaceX pinned to this exact value regardless of
 * DISPATCH_MACHINE_DEPTH, since the center simply shifts east as depth
 * grows (center = wallFace + standoff + depth/2, so center - depth/2 =
 * wallFace + standoff always). */
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

/** Thickness of the upright back panel the four holes are recessed into. */
export const DISPATCH_BACK_PANEL_THICKNESS = 0.12;
/** The panel's own front (player-facing) surface X. */
const backPanelFrontX = backFaceX + DISPATCH_BACK_PANEL_THICKNESS;

export interface DispatchHoleConfig {
  region: MailDestination;
  displayName: string;
  /** Sensor volume's own center X — now INSIDE the visible recessed cavity
   * (see the class doc comment in envelope-dispatch-machine-system.ts),
   * never in front of the panel's own face. */
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
 * world space. Unchanged by this round's own explicit instruction ("不需要
 * 因為機台向東延伸而改變洞口配置"). */
const REGION_GRID: { region: MailDestination; displayName: string; row: 'top' | 'bottom'; col: 'left' | 'right' }[] = [
  { region: 'taichung', displayName: '台中', row: 'top', col: 'left' },
  { region: 'japan', displayName: '日本', row: 'top', col: 'right' },
  { region: 'taipei', displayName: '台北', row: 'bottom', col: 'left' },
  { region: 'usa', displayName: '美國', row: 'bottom', col: 'right' },
];

/** Genuinely-recessed hole sizing (spec二's own suggested ranges: width
 * 0.75-0.90m, height 0.45-0.55m, depth 0.20-0.35m, ≥0.20m spacing both
 * directions) — landed mid-range on every axis now that the wider panel
 * (~3.17m along-wall) has plenty of room for real spacing, unlike the
 * previous round's tighter 0.5x0.45 holes. */
const HOLE_WIDTH = 0.8;
const HOLE_HEIGHT = 0.5;
const HOLE_COL_GAP = 0.3;
const HOLE_ROW_GAP = 0.3;
const HOLE_DEPTH = 0.28;
/** Vertical/along-wall center of the whole 2x2 grid, above the floor. */
const GRID_CENTER_Y_ABOVE_FLOOR = 1.5;

const gridCenterY = BACK_AREA.floorY + GRID_CENTER_Y_ABOVE_FLOOR;
const colOffsetZ = HOLE_WIDTH / 2 + HOLE_COL_GAP / 2;
const rowOffsetY = HOLE_HEIGHT / 2 + HOLE_ROW_GAP / 2;

/** Sensor sits INSIDE the visible recessed cavity now (spec二: "Sensor尺寸
 * 需位於可視洞口內部...不可讓信封只碰背板表面就被收走") — the cavity itself
 * spans from the panel's own front face inward (toward the wall) by
 * HOLE_DEPTH, so the sensor's own center sits at the cavity's own midpoint. */
const holeCenterX = backPanelFrontX - HOLE_DEPTH / 2;

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

/** The back panel's own solid area, described as the boundary lines
 * envelope-dispatch-machine-system.ts's buildBackPanel() slices into six
 * frame segments (top / bottom / middle / outer-south / outer-north /
 * center — spec二: "上方橫條/中間橫條/左右直條/中央直條") that together seal
 * everything EXCEPT the four hole rectangles above, rather than one solid
 * slab that would seal the holes shut too. Every bound here is derived
 * directly from DISPATCH_HOLES/DISPATCH_MACHINE_WIDTH/HEIGHT — never a
 * second hand-picked set of numbers that could drift out of sync with the
 * holes' own actual position. */
export const DISPATCH_BACK_PANEL_BOUNDS = {
  halfWidth: DISPATCH_MACHINE_WIDTH / 2,
  halfHeight: DISPATCH_MACHINE_HEIGHT / 2,
  /** Y bounds of the row containing BOTH holes' own top/bottom edges. */
  topRowTopY: gridCenterY + rowOffsetY + HOLE_HEIGHT / 2,
  topRowBottomY: gridCenterY + rowOffsetY - HOLE_HEIGHT / 2,
  bottomRowTopY: gridCenterY - rowOffsetY + HOLE_HEIGHT / 2,
  bottomRowBottomY: gridCenterY - rowOffsetY - HOLE_HEIGHT / 2,
  /** Z bounds of the two hole columns (world Z — "outer" edges point away
   * from the grid center, "inner" edges face each other across the center
   * gap). Left column sits at +Z (south, player-left); right at -Z (north,
   * player-right). */
  leftColOuterZ: DISPATCH_MACHINE_CENTER.z + colOffsetZ + HOLE_WIDTH / 2,
  leftColInnerZ: DISPATCH_MACHINE_CENTER.z + colOffsetZ - HOLE_WIDTH / 2,
  rightColInnerZ: DISPATCH_MACHINE_CENTER.z - colOffsetZ + HOLE_WIDTH / 2,
  rightColOuterZ: DISPATCH_MACHINE_CENTER.z - colOffsetZ - HOLE_WIDTH / 2,
};

/** Each hole's own region+count display, mounted directly above it on the
 * back panel's own front face (spec三: "地區名稱顯示在洞口上方/附近...不可
 * 擋住洞口，也不可漂浮到機台外"). */
export const DISPATCH_DISPLAY_HEIGHT_ABOVE_HOLE = 0.34;
export const DISPATCH_DISPLAY_X = backPanelFrontX + 0.05;

/** Ramp ("green zone" in the spec's own sketch) — a single tilted surface
 * spanning the machine's full open-front entry, from a low point just
 * inside the front opening up to the base of the back panel's own hole
 * grid, right at the panel's own front face (spec四: "斜坡最高處仍接近背板
 * 洞口底部"). Exported as plain endpoints (not a precomputed quaternion) so
 * envelope-dispatch-machine-system.ts can build BOTH the visual mesh and the
 * physics collider from the exact same two points via
 * THREE.Quaternion.setFromUnitVectors, guaranteeing they can never drift
 * apart. This round's much deeper machine (DISPATCH_MACHINE_DEPTH 1.6->2.8m)
 * automatically lengthens this ramp's own run — bottom/top are both derived
 * from frontFaceX/backPanelFrontX, so nothing here needed a separate manual
 * change beyond the depth constant itself (spec四: "斜坡東西向...跟隨新機台
 * 寬度" together with 一's own "斜坡長度" increase). */
export const DISPATCH_RAMP = {
  bottom: new THREE.Vector3(frontFaceX - 0.15, BACK_AREA.floorY + 0.2, DISPATCH_MACHINE_CENTER.z),
  top: new THREE.Vector3(backPanelFrontX, gridCenterY - rowOffsetY - HOLE_HEIGHT / 2, DISPATCH_MACHINE_CENTER.z),
  /** Along-wall (Z) width of the ramp surface — the machine's own interior
   * usable width, inset from the two side panels. */
  crossWidth: DISPATCH_MACHINE_WIDTH - 0.24,
  thickness: 0.08,
};

/** Pack button — moved this round to the machine's NORTH side (spec五: "機台
 * 北側／玩家面向機器時的右側" — mirrors the hole grid's own facing-west
 * derivation above: player-right = north/-Z side, the exact opposite side
 * from where earlier rounds mounted it). Mounted on the OUTSIDE face of the
 * north side panel, positioned along X near the open front so it's reachable
 * from the main walkway without needing to walk deep into the throwing
 * chamber. Spec: "距地約0.9-1.1m". */
const BUTTON_HEIGHT = 1.0;
export const DISPATCH_BUTTON_POSITION = new THREE.Vector3(
  DISPATCH_MACHINE_CENTER.x + DISPATCH_MACHINE_DEPTH / 2 - 0.3,
  BACK_AREA.floorY + BUTTON_HEIGHT,
  DISPATCH_MACHINE_CENTER.z - DISPATCH_MACHINE_WIDTH / 2 - 0.03
);

/** Spec: "距離不超過2.5m", "約0.5秒防止單次按下重複觸發" — unchanged. */
export const DISPATCH_BUTTON_INTERACT_DISTANCE = 2.5;
export const DISPATCH_BUTTON_DEBOUNCE_SECONDS = 0.5;

/** Four output positions (spec: "四個輸出位置對應四地區") — spread along the
 * machine's own front ledge, grouped left(south)/right(north) the same way
 * as their own hole's column. Independent of the hole grid's own Y/Z layout
 * — bags rest on the floor, not the wall — and independent of the button's
 * own new north-side position. */
const OUTPUT_Z_OFFSET: Record<MailDestination, number> = {
  taichung: 0.6,
  taipei: 0.2,
  japan: -0.2,
  usa: -0.6,
};

export function getDispatchOutputPosition(region: MailDestination): THREE.Vector3 {
  return new THREE.Vector3(frontFaceX + 0.35, BACK_AREA.floorY, DISPATCH_MACHINE_CENTER.z + OUTPUT_Z_OFFSET[region]);
}
