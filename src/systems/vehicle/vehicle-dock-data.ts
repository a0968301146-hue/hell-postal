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
// "Update vehicle cargo compatibility and capacity" round (六台載具統一放大
// 1.5x — see vehicle-data.ts's VEHICLE_VISUAL_SCALE): every slot below is
// recomputed against each vehicle's SCALED footprint (base size *1.5), not
// the old pre-scale sizes — the comments at each slot spell out the actual
// scaled half-width/half-length used and the resulting clearance.
//
// Land lanes vary along X (BACK_AREA's own width, x: -10..10) — a row of 3
// parking spots hugging the south wall. Sea lanes vary along Z instead
// (across PIER's own width — PIER's Z-span was widened from 14..22 to
// 12..24 this round, logistics-layout-data.ts, to fit the scaled sea
// roster), all sharing the same dock X (14, PIER's own depth center — same
// X every sea vehicle already used before this round).
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

// Moved 2m further from the south wall (was 29.5) than the pre-scale
// layout — 石頭巨人's scaled length (6.9, half 3.45) no longer leaves room
// for both a wall margin AND a front (north-side) margin at the old Z; see
// per-slot comments below for the actual resulting spans.
const LAND_DOCK_Z = 28.0;
const LAND_SPAWN_Z = 49; // south, beyond the back-area wall + view

/** Land docking slots — one per land creature, id-keyed so vehicle-data.ts
 * can look each one up by the VehicleConfig it belongs to.
 *
 * Scaled half-widths (VEHICLE_VISUAL_SCALE=1.5): 青蛙 1.125, 石頭巨人 1.95,
 * 蝸牛 1.5. Scaled half-lengths: 青蛙 1.95, 石頭巨人 3.45, 蝸牛 2.55.
 *
 * "Expand land entrance and cargo capacity" round: spawnPosition/
 * exitPosition.x are back to each vehicle's OWN dock X (not a single shared
 * entrance X) — now that LAND_GATE has been widened (logistics-layout-
 * data.ts) to comfortably cover all three vehicles' own lanes at once, a
 * straight spawn-to-dock interpolation at each vehicle's own constant X
 * never crosses a solid wall segment, so the "funnel through one shared
 * point" waypoint bend a previous round added is no longer needed — see
 * vehicle-route-data.ts, simplified back to a direct single-leg route
 * matching sea vehicles' pattern. This is also strictly SAFER for
 * inter-vehicle clearance than a shared entrance: three vehicles each
 * holding a constant, distinct X for their entire journey never converge,
 * so their paths are non-overlapping at every instant, not just at the
 * final dock. */
export const LAND_DOCK_SLOTS: Record<string, VehicleDockSlot> = {
  // 青蛙 — scaled half-width 1.125 at x=-3.7: spans -4.825..-2.575.
  // LAND_GATE now spans -6.0..6.0, leaving 1.175m clearance past this
  // lane's outer (west) edge. At z=28.0±1.95 (half-length): spans
  // 26.05..29.95, comfortably inside BACK_AREA's south wall (32).
  'land-frog-01': {
    vehicleConfigId: 'land-frog-01',
    dockPosition: { x: -3.7, z: LAND_DOCK_Z },
    spawnPosition: { x: -3.7, z: LAND_SPAWN_Z },
    exitPosition: { x: -3.7, z: LAND_SPAWN_Z },
  },
  // 石頭巨人 — scaled half-width 1.95 at x=0: spans -1.95..1.95. Gap to
  // frog's right edge (-2.575): 0.625m. At z=28.0±3.45 (half-length): spans
  // 24.55..31.45 — 0.55m clear of the south wall (32), the tightest margin
  // of the three. VEHICLE_CONTROL_POS (logistics-layout-data.ts) was moved
  // off to x=-4.5 this round specifically because it used to sit at x=0,
  // z=25.5 — squarely inside this slot's enlarged footprint.
  'land-rockgiant-01': {
    vehicleConfigId: 'land-rockgiant-01',
    dockPosition: { x: 0, z: LAND_DOCK_Z },
    spawnPosition: { x: 0, z: LAND_SPAWN_Z },
    exitPosition: { x: 0, z: LAND_SPAWN_Z },
  },
  // 蝸牛 — scaled half-width 1.5 at x=4.0: spans 2.5..5.5. Gap to
  // rockgiant's right edge (1.95): 0.55m. LAND_GATE's right edge (6.0)
  // leaves 0.5m clearance past this lane's outer (east) edge. At
  // z=28.0±2.55 (half-length): spans 25.45..30.55, clear of the south wall.
  'land-snail-01': {
    vehicleConfigId: 'land-snail-01',
    dockPosition: { x: 4.0, z: LAND_DOCK_Z },
    spawnPosition: { x: 4.0, z: LAND_SPAWN_Z },
    exitPosition: { x: 4.0, z: LAND_SPAWN_Z },
  },
};

const SEA_DOCK_X = 14; // unchanged — PIER.minX(10) + 4, same depth-along-X every sea vehicle already used
const SEA_SPAWN_X = 40; // east, beyond the pier + view

/** Sea docking slots — one per sea creature. PIER's Z-span was widened
 * from 14..22 (8m) to 12..24 (12m) this round (logistics-layout-data.ts) —
 * the pre-scale 8m depth can't fit three sea vehicles' scaled widths side
 * by side even with zero gaps (2*(1.35+1.65+1.95) = 9.9m alone).
 *
 * Scaled half-widths (across Z, since sea vehicles use axis:'x'): 魟魚
 * 1.35, 海龜 1.65, 克拉肯 1.95. Scaled half-lengths (along X, into/out of
 * the pier): 魟魚 2.4, 海龜 2.85, 克拉肯 3.45 — all comfortably within
 * PIER's unchanged 8m X-depth (10..18) at SEA_DOCK_X=14, see per-slot
 * comments. */
export const SEA_DOCK_SLOTS: Record<string, VehicleDockSlot> = {
  // 魟魚 — half-width 1.35 at z=13.8: spans 12.45..15.15 (0.45m clear of
  // PIER's new minZ=12). Half-length 2.4 at x=14: spans 11.6..16.4, well
  // inside PIER's 10..18 X-depth.
  'sea-ray-01': {
    vehicleConfigId: 'sea-ray-01',
    dockPosition: { x: SEA_DOCK_X, z: 13.8 },
    spawnPosition: { x: SEA_SPAWN_X, z: 13.8 },
    exitPosition: { x: SEA_SPAWN_X, z: 13.8 },
  },
  // 海龜 — half-width 1.65 at z=17.0: spans 15.35..18.65. Gap to ray's
  // right edge (15.15): 0.2m. Half-length 2.85 at x=14: spans 11.15..16.85,
  // inside PIER's X-depth.
  'sea-turtle-01': {
    vehicleConfigId: 'sea-turtle-01',
    dockPosition: { x: SEA_DOCK_X, z: 17.0 },
    spawnPosition: { x: SEA_SPAWN_X, z: 17.0 },
    exitPosition: { x: SEA_SPAWN_X, z: 17.0 },
  },
  // 克拉肯 — half-width 1.95 at z=21.0: spans 19.05..22.95 (1.05m clear of
  // PIER's new maxZ=24). Gap to turtle's right edge (18.65): 0.4m.
  // Half-length 3.45 at x=14: spans 10.55..17.45, inside PIER's X-depth.
  'sea-kraken-01': {
    vehicleConfigId: 'sea-kraken-01',
    dockPosition: { x: SEA_DOCK_X, z: 21.0 },
    spawnPosition: { x: SEA_SPAWN_X, z: 21.0 },
    exitPosition: { x: SEA_SPAWN_X, z: 21.0 },
  },
};

export const ALL_DOCK_SLOTS: Record<string, VehicleDockSlot> = {
  ...LAND_DOCK_SLOTS,
  ...SEA_DOCK_SLOTS,
};
