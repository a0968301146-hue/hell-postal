// Centralized spatial data for the "underworld logistics center" white-box
// prototype (v0.1 vertical slice). All zone positions/sizes for the new
// layout live here so they are not scattered as magic numbers across
// scene-manager / physics / vehicle / shipment systems.
//
// Coordinate convention: X = left/right, Z = depth (increasing Z = further
// from the front-office spawn, toward the back area and pier), Y = height.

export const WALL_THICKNESS = 0.2;

export const FRONT_OFFICE = {
  minX: -6, maxX: 6, // width 12
  minZ: -2, maxZ: 10, // depth 12
  floorY: 0,
  ceilingHeight: 4,
};

/** Black cargo window in the dividing wall — player throws cargo through here. */
export const CARGO_WINDOW = {
  centerX: 0,
  halfWidth: 0.8, // opening width 1.6
  bottomY: 0.9, // sill height above front floor
  topY: 2.3,
  z: FRONT_OFFICE.maxZ, // sits on the dividing wall plane
};

/** Red conveyor — cargo enters at the window sill (high) and is driven down
 * to the back-area floor (low). Run is deliberately gentle (angle keeps the
 * surface normal comfortably above PickupSystem's 0.9 flat-enough-to-place
 * threshold) so players can precisely place cargo on it, not just throw. */
export const CARGO_RAMP = {
  topX: CARGO_WINDOW.centerX,
  topY: CARGO_WINDOW.bottomY,
  topZ: FRONT_OFFICE.maxZ,
  bottomX: CARGO_WINDOW.centerX,
  bottomZ: FRONT_OFFICE.maxZ + 6,
  width: 1.6,
  thickness: 0.15,
};

/** Purple door opening + stairs — player path between front office and back area. */
export const DOORWAY = {
  centerX: 3.5,
  halfWidth: 0.8, // opening width 1.6
  height: 2.2,
  z: FRONT_OFFICE.maxZ,
};

export const STAIRS = {
  centerX: DOORWAY.centerX,
  width: 1.6,
  topZ: FRONT_OFFICE.maxZ,
  bottomZ: FRONT_OFFICE.maxZ + 4,
  stepCount: 6,
};

export const BACK_AREA = {
  minX: -10, maxX: 10, // width 20
  minZ: FRONT_OFFICE.maxZ, maxZ: 32, // depth 22
  floorY: -1.5,
  ceilingHeight: 6,
};

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

/** Land dock — hugs the back area's SOUTH wall (only dock-1 is active/wired
 * to a real vehicle this round; dock-2 is a white-box placeholder). */
export const LAND_DOCKS = [
  { id: 'land-dock-1', centerX: -6, centerZ: 29.5, width: 4, depth: 5, active: true },
  { id: 'land-dock-2', centerX: 6, centerZ: 29.5, width: 4, depth: 5, active: false },
];

/** Gap in the back area's south wall the land vehicle drives through. */
export const LAND_GATE = {
  centerX: LAND_DOCKS[0].centerX,
  halfWidth: 1.6,
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
export const WORLD_BOUNDS = {
  minX: Math.min(FRONT_OFFICE.minX, BACK_AREA.minX) - 1,
  maxX: Math.max(FRONT_OFFICE.maxX, BACK_AREA.maxX, PIER.maxX) + 40, // generous — land/sea vehicles travel well beyond the walls
  minZ: FRONT_OFFICE.minZ - 1,
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
