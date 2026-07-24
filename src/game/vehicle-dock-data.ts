// Centralized per-vehicle dock/spawn/exit world positions ("Add six fixed
// vehicle docking slots" round) — the ONE place these coordinates are
// defined. vehicle-data.ts's six VehicleConfig entries each pull their
// dockPosition/spawnPosition/exitPosition from here rather than hand-rolling
// coordinates inline, and vehicle-control-system.ts never hardcodes a
// position anywhere in its update loop — it only ever reads
// config.dockPosition/spawnPosition/exitPosition (unchanged fields on
// VehicleConfig, just now sourced from six independent slots instead of one
// shared land position + one shared sea position).
//
// Land lanes vary along X (BACK_AREA's own width, x: -10..10) — a row of 3
// parking spots hugging the south wall, all at the SAME dock Z the single
// land dock used before this round (29.5), spaced far enough apart (7m
// center-to-center) that even the widest land vehicle (石頭巨人, width 2.6)
// leaves several meters of clearance on every side. Sea lanes vary along Z
// instead (across PIER's own width, z: 14..22 — only 8m deep, so spacing is
// tighter, sized exactly to each boat's own width plus a real but modest
// gap), all sharing the same dock X (14, PIER's own depth center — same X
// every sea vehicle already used before this round).
//
// Every combination below is checked against VEHICLE_SIZE_LIMITS/PIER/
// BACK_AREA bounds in vehicle-data.ts's own assertWithinSizeLimits() call
// plus the worked-out clearance numbers in the comments at each slot.

export interface VehicleDockSlot {
  vehicleConfigId: string;
  dockPosition: { x: number; z: number };
  spawnPosition: { x: number; z: number };
  exitPosition: { x: number; z: number };
}

const LAND_DOCK_Z = 29.5; // unchanged from the single-slot layout this replaces
const LAND_SPAWN_Z = 49; // south, beyond the back-area wall + view

/** Land docking slots — one per land creature, id-keyed so vehicle-data.ts
 * can look each one up by the VehicleConfig it belongs to. Spawn X matches
 * each slot's own dock X (not a single shared lane) so the arrival drive-in
 * is a straight shot up that vehicle's own lane, never crossing another
 * slot's footprint. */
export const LAND_DOCK_SLOTS: Record<string, VehicleDockSlot> = {
  // 青蛙 — width 1.5 (half 0.75) at x=-7: spans -7.75..-6.25.
  'land-frog-01': {
    vehicleConfigId: 'land-frog-01',
    dockPosition: { x: -7, z: LAND_DOCK_Z },
    spawnPosition: { x: -7, z: LAND_SPAWN_Z },
    exitPosition: { x: -7, z: LAND_SPAWN_Z },
  },
  // 石頭巨人 — width 2.6 (half 1.3) at x=0: spans -1.3..1.3. Gap to frog's
  // right edge (-6.25): 4.95m. Also clear of VEHICLE_CONTROL_POS (x=0,
  // z=25.5) — different Z row, 4m south of it.
  'land-rockgiant-01': {
    vehicleConfigId: 'land-rockgiant-01',
    dockPosition: { x: 0, z: LAND_DOCK_Z },
    spawnPosition: { x: 0, z: LAND_SPAWN_Z },
    exitPosition: { x: 0, z: LAND_SPAWN_Z },
  },
  // 蝸牛 — width 2.0 (half 1.0) at x=7: spans 6.0..8.0. Gap to rockgiant's
  // right edge (1.3): 4.7m. Right edge (8.0) stays inside BACK_AREA (maxX
  // 10) with 2m to spare.
  'land-snail-01': {
    vehicleConfigId: 'land-snail-01',
    dockPosition: { x: 7, z: LAND_DOCK_Z },
    spawnPosition: { x: 7, z: LAND_SPAWN_Z },
    exitPosition: { x: 7, z: LAND_SPAWN_Z },
  },
};

const SEA_DOCK_X = 14; // unchanged — PIER.minX(10) + 4, same depth-along-X every sea vehicle already used
const SEA_SPAWN_X = 40; // east, beyond the pier + view

/** Sea docking slots — one per sea creature. PIER only spans z 14..22 (8m),
 * so unlike the land row these three sit much closer together — still
 * fully non-overlapping (each gap below is the real remaining margin after
 * accounting for both neighbors' half-widths), just with less spare room
 * than the land lanes get. */
export const SEA_DOCK_SLOTS: Record<string, VehicleDockSlot> = {
  // 魟魚 — width 1.8 (half 0.9) at z=15.2: spans 14.3..16.1 (14.3 is 0.3m
  // inside PIER.minZ=14).
  'sea-ray-01': {
    vehicleConfigId: 'sea-ray-01',
    dockPosition: { x: SEA_DOCK_X, z: 15.2 },
    spawnPosition: { x: SEA_SPAWN_X, z: 15.2 },
    exitPosition: { x: SEA_SPAWN_X, z: 15.2 },
  },
  // 海龜 — width 2.2 (half 1.1) at z=17.8: spans 16.7..18.9. Gap to ray's
  // right edge (16.1): 0.6m.
  'sea-turtle-01': {
    vehicleConfigId: 'sea-turtle-01',
    dockPosition: { x: SEA_DOCK_X, z: 17.8 },
    spawnPosition: { x: SEA_SPAWN_X, z: 17.8 },
    exitPosition: { x: SEA_SPAWN_X, z: 17.8 },
  },
  // 克拉肯 — width 2.6 (half 1.3) at z=20.4: spans 19.1..21.7 (21.7 is 0.3m
  // inside PIER.maxZ=22). Gap to turtle's right edge (18.9): 0.2m.
  'sea-kraken-01': {
    vehicleConfigId: 'sea-kraken-01',
    dockPosition: { x: SEA_DOCK_X, z: 20.4 },
    spawnPosition: { x: SEA_SPAWN_X, z: 20.4 },
    exitPosition: { x: SEA_SPAWN_X, z: 20.4 },
  },
};

export const ALL_DOCK_SLOTS: Record<string, VehicleDockSlot> = {
  ...LAND_DOCK_SLOTS,
  ...SEA_DOCK_SLOTS,
};
