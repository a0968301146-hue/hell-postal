// Centralized spatial data for the "underworld logistics center" white-box
// prototype (v0.1 vertical slice). All zone positions/sizes for the new
// layout live here so they are not scattered as magic numbers across
// scene-manager / physics / vehicle / shipment systems.
//
// Coordinate convention: X = left/right, Z = depth (increasing Z = further
// from the north unload dock, toward the docks and pier), Y = height.
// Direct file import (not the systems/lost-found barrel) — see world-
// layout-system.ts's identical import for why (avoids a circular import
// through LostFoundSystem, which depends on this system for SCENE_CONFIG).
import { LOST_FOUND_ROOM } from '../lost-found/lost-found-layout-data';

export const WALL_THICKNESS = 0.2;

/** Historical footprint of the old front-office room (counter/NPC area,
 * later the north unload dock) — the room itself was removed entirely in
 * the "刪除北邊房間" round (scene-manager.ts no longer builds any geometry
 * from this). Kept as plain data only because counter-layout-data.ts's
 * still-preserved (disabled) COUNTER/NPC_AREA/PLAYER_AREA/COUNTER_GLASS
 * definitions are expressed relative to it, and cargo-system.ts's disabled
 * legacy-test-cargo branch references FRONT_OFFICE.floorY — both are dead
 * code paths this round (ENABLE_LEGACY_COUNTER/ENABLE_LEGACY_TEST_CARGO are
 * false) that would otherwise fail to compile. Not used by WORLD_BOUNDS or
 * any real scene geometry anymore. */
export const FRONT_OFFICE = {
  minX: -6, maxX: 6, // width 12
  minZ: -2, maxZ: 10, // depth 12
  floorY: 0,
  ceilingHeight: 4,
};

export const BACK_AREA = {
  minX: -10, maxX: 10, // width 20
  minZ: FRONT_OFFICE.maxZ, maxZ: 32, // depth 22
  floorY: -1.5,
  ceilingHeight: 6,
};

/** Gaps in the back area's own NORTH wall (minZ) for the daily unloading
 * docks (spec "刪除北邊房間" round: the front-office room this used to sit
 * in was removed entirely — the back area is now the whole building, and
 * its own north wall carries the unload docks directly). Two independent
 * ports side by side ("Add dual elevated unloading ports and day-one
 * special cargo" round 二: 東方新增第二個到貨口) — scene-manager.ts's
 * buildBackArea() iterates this array to punch one gap per entry, with
 * solid wall segments before/between/after them. See daily-flow-data.ts
 * (UNLOAD_PORTS) for the gate/chute/spawn geometry built around each
 * opening. Port B (east, centerX 5, span [3,7]) sits 1m clear of Port A's
 * own span ([-2,2]) and 3m clear of BACK_AREA's east wall (maxX 10). */
export const NORTH_GATES = [
  { id: 'north-a', centerX: 0, halfWidth: 2.0 },
  { id: 'north-b', centerX: 5, halfWidth: 2.0 },
];

/** Player spawn point — inside the back area, a short distance south of
 * the north unload dock's drop zone (spec "刪除北邊房間" round: previously
 * inside the now-removed front-office room, at that room's own floor
 * height). `y` bakes in SCENE_CONFIG.playerEyeHeight (1.6, see
 * scene-manager.ts) on top of BACK_AREA's floor, since this is an absolute
 * world-space spawn height, not floor-relative. */
export const PLAYER_SPAWN = { x: 0, y: BACK_AREA.floorY + 1.6, z: 14.8 };

/** Where the conveyor drops cargo, and the open floor around it — the
 * player's main package-handling area, right behind the window. */
export const PACKAGE_WORK_ZONE = {
  minX: -3, maxX: 3,
  minZ: BACK_AREA.minZ + 4, maxZ: BACK_AREA.minZ + 9, // z: 14~19
};

/** Work furniture cluster (stamp tables, crate, sorting boxes) — back area, west side. */
export const WORK_FURNITURE_X = -8;

/** Reserved (white-box only, no function yet) cargo-type zones in a row
 * further back — space is claimed now so future systems have somewhere to go. */
export const CARGO_ZONES = [
  { id: 'zone-normal', label: '一般貨物區', centerX: -7.2, color: 0x8a8a8a },
  { id: 'zone-large', label: '大型貨物區', centerX: -3.6, color: 0x8a6a4a },
  { id: 'zone-frozen', label: '冷凍貨物區', centerX: 0, color: 0x4a90b8 },
  { id: 'zone-live', label: '活體貨物區', centerX: 3.6, color: 0x4a9a4a },
  { id: 'zone-lost-found', label: '失物招領區', centerX: 7.2, color: 0xb8a04a },
].map(z => ({ ...z, minZ: BACK_AREA.minZ + 10.5, maxZ: BACK_AREA.minZ + 13.5, halfWidth: 1.6 }));

// Compass convention (see compass-ui.ts): North = -Z, East = +X, South = +Z, West = -X.

/** Land docks — hugs the back area's SOUTH wall, one active slot per land
 * creature ("Expand land entrance and cargo capacity" round — see
 * vehicle-dock-data.ts for the exact per-vehicle world positions these
 * decorative floor markers echo). */
export const LAND_DOCKS = [
  { id: 'land-dock-frog', centerX: -7, centerZ: 29.5, width: 2.4, depth: 3.6, active: true },
  { id: 'land-dock-rockgiant', centerX: 0, centerZ: 29.5, width: 3.4, depth: 5.6, active: true },
  { id: 'land-dock-snail', centerX: 7, centerZ: 29.5, width: 3.0, depth: 4.6, active: true },
];

/** Gap in the back area's south wall the land vehicles drive through —
 * widened ("Expand land entrance and cargo capacity" round) so 青蛙／石頭
 * 巨人／蝸牛 can all pass through side by side, each in its own straight
 * lane (see vehicle-dock-data.ts/vehicle-route-data.ts) rather than
 * funneling through one narrow shared point. Span [-8.4, 8.4] comfortably
 * covers all three vehicles' own dock-lane footprints — frog (dock x=-7,
 * half-width 0.75, left edge -7.75, 0.65m clear of this gate's left edge)
 * out to snail (dock x=7, half-width 1.0, right edge 8.0, 0.4m clear of
 * this gate's right edge) — with real (non-zero) solid wall segments still
 * remaining at both back-area corners (1.6m each side, BACK_AREA spans
 * x -10..10). No longer derived from LAND_DOCKS[0] — a single dock's own X
 * isn't representative of a gate wide enough for all three lanes. */
export const LAND_GATE = {
  centerX: 0,
  halfWidth: 8.4,
};

/** Pier — now extends off the back area's EAST wall, over open water. */
export const PIER = {
  minX: BACK_AREA.maxX, maxX: BACK_AREA.maxX + 8, // depth 8, eastward
  minZ: 14, maxZ: 22, // width 8, within the back-area hall's depth
  floorY: BACK_AREA.floorY,
  waterY: BACK_AREA.floorY - 0.7,
};

/** Gap in the back area's east wall the pier connects through. */
export const SEA_GATE = {
  centerZ: (PIER.minZ + PIER.maxZ) / 2,
  halfWidth: (PIER.maxZ - PIER.minZ) / 2,
};

export const SEA_DOCKS = [
  { id: 'sea-dock-1', centerX: PIER.minX + 4, centerZ: PIER.minZ + 2, radius: 1.2 },
  { id: 'sea-dock-2', centerX: PIER.minX + 4, centerZ: PIER.maxZ - 2, radius: 1.2 },
];

/** Overall world bounds, used only for a distant backdrop / sanity checks. */
// NOTE (spec "刪除北邊房間" round): deliberately no longer folds in
// FRONT_OFFICE — that room's floor no longer exists, so including its old
// footprint here would let cargo/placement validation succeed in what is
// now empty void space north of BACK_AREA's own wall.
// "Reduce daily cargo and add lost found desk" round: folds in
// LOST_FOUND_ROOM's own footprint (lost-found-layout-data.ts) so item
// placement (PickupSystem.validatePlacement) isn't rejected just for being
// west of BACK_AREA's own wall, inside the new room.
export const WORLD_BOUNDS = {
  minX: Math.min(BACK_AREA.minX, LOST_FOUND_ROOM.minX) - 1,
  maxX: Math.max(BACK_AREA.maxX, PIER.maxX) + 40, // generous — land/sea vehicles travel well beyond the walls
  minZ: BACK_AREA.minZ - 1,
  maxZ: BACK_AREA.maxZ + 40,
};

/** Vehicle control post — hall center, reachable from the front-office door,
 * the package work zone and both dock areas without blocking the main
 * cargo-carrying paths (sits in the gap between the cargo-zone row and the
 * land dock). Two buttons sit side by side here: 呼叫載具 (centerX -
 * spacing/2, calls land AND sea together) / 載具出發 (centerX + spacing/2). */
export const VEHICLE_CONTROL_POS = { centerX: 0, centerZ: 25.5, spacing: 1.4 };

/** How many normal-cargo boxes to spawn in each area, and where — kept
 * central so counts/zones aren't scattered across scene/cargo setup code. */
export const CARGO_SPAWN_CONFIG = {
  frontOfficeCount: 6,
  backAreaCount: 10,
  // Front-office cargo: player-area side, near the window/conveyor start.
  // minZ kept clear of the player spawn point (z=7).
  frontZone: { minX: -2.2, maxX: 2.2, minZ: 7.6, maxZ: 9.3 },
  // Back-area cargo: the open package-work zone around the conveyor exit.
  backZone: { minX: -3.2, maxX: 3.2, minZ: 14.5, maxZ: 19.5 },
};

/** Fixed (non-random) spawn spots for large cargo, inside CARGO_ZONES'
 * "大型貨物區" (zone-large: centerX -3.6, z 20.5–23.5) — comfortably clear
 * of the front-office NPC area, player spawn, doorway/stairs, conveyor exit
 * and the vehicle control buttons. Spacing (1.6m) leaves margin against the
 * largest large-cargo footprint (1.35m) so the 4 items don't overlap at spawn. */
export const LARGE_CARGO_SPAWN_POSITIONS = [
  { x: -4.4, z: 21.1 },
  { x: -2.8, z: 21.1 },
  { x: -4.4, z: 22.7 },
  { x: -2.8, z: 22.7 },
];

/** Fixed spawn spots for the labeling-system test cargo (spec 九) — placed
 * in the open floor east of the large-cargo zone but west of the vehicle
 * control posts, clear of the NPC area, player spawn, doorway/stairs,
 * conveyor exit, control buttons and the dolly's parked position (7,16).
 * 0.9m spacing comfortably separates every footprint here (normal/fragile
 * cargo maxes out at 0.6m, the one large item at 1.35m — positioned with
 * extra room on its own row). */
export const LABELED_CARGO_SPAWN_POSITIONS = {
  domesticFragile: [{ x: -1.2, z: 21.4 }, { x: -0.2, z: 21.4 }],
  overseasNormal: [{ x: -1.2, z: 22.4 }, { x: -0.2, z: 22.4 }],
  overseasFragile: [{ x: -1.2, z: 23.4 }],
  overseasLarge: [{ x: 1.6, z: 22.0 }],
  overseasLargeFragile: [{ x: 1.6, z: 23.8 }],
};
