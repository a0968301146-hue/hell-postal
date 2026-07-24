// Centralized per-vehicle movement ROUTES ("Fix land vehicle routes and add
// cargo region UI" round) — the ONE place waypoint sequences are defined;
// vehicle-control-system.ts's update loop only ever reads
// VEHICLE_ROUTES[slot.config.id], never hardcodes a coordinate.
//
// Distinct from vehicle-dock-data.ts (which owns each vehicle's own fixed
// dockPosition/spawnPosition/exitPosition) — this module describes the PATH
// between those points. Land routes bend through one shared waypoint (the
// real wall opening); sea routes stay a direct two-point line, unchanged
// from before this round (spec: "海運路線不要修改").
import { LAND_DOCK_SLOTS, SEA_DOCK_SLOTS } from './vehicle-dock-data';
import { LAND_GATE, BACK_AREA } from './logistics-layout-data';

export interface Waypoint {
  x: number;
  z: number;
}

export interface VehicleRoute {
  vehicleConfigId: string;
  /** Ordered stops from spawnPosition to fully docked — does NOT include
   * spawnPosition itself (VehicleSystem is created directly there, see
   * VehicleControlSystem.spawnSlot). Last entry is always this vehicle's
   * own dockPosition (vehicle-dock-data.ts). */
  arrivalWaypoints: Waypoint[];
  /** Ordered stops from docked to fully exited/despawned. Last entry is
   * always this vehicle's own exitPosition. */
  departureWaypoints: Waypoint[];
}

/** The real physical gap in the back area's south wall (scene-manager.ts
 * buildBackArea, built from LAND_GATE) — every land vehicle's arrival and
 * departure now funnels through here, so none of them ever cross a solid
 * wall segment (spec: "陸運載具不得從生成點直線插值到停靠點" /
 * "spawnPoint → entranceWaypoint → dockPoint"). Z sits 1m south of the
 * wall itself (BACK_AREA.maxZ) — since vehicle-dock-data.ts's land
 * spawnPosition/exitPosition.x now ALSO sit at LAND_GATE.centerX, a land
 * vehicle travels the ENTIRE spawn→entrance leg at a constant X, passing
 * straight through the middle of the real opening, before ever starting to
 * diverge toward its own dock slot on the second leg (which happens
 * entirely south of/inside the wall, no further wall to cross). */
const LAND_ENTRANCE: Waypoint = { x: LAND_GATE.centerX, z: BACK_AREA.maxZ - 1 };

function buildLandRoute(vehicleConfigId: string): VehicleRoute {
  const slot = LAND_DOCK_SLOTS[vehicleConfigId];
  return {
    vehicleConfigId,
    arrivalWaypoints: [LAND_ENTRANCE, slot.dockPosition],
    // Reverse of the arrival path (spec: "離場時反向行駛：dockPoint →
    // entranceWaypoint → exitPoint").
    departureWaypoints: [LAND_ENTRANCE, slot.exitPosition],
  };
}

/** Sea route unchanged — direct spawn→dock / dock→exit, no waypoint (spec:
 * "海運路線不要修改"). Kept as an explicit single-element route (rather than
 * a special-cased "no route" path) so VehicleControlSystem's update loop
 * can treat every slot identically regardless of vehicleType. */
function buildSeaRoute(vehicleConfigId: string): VehicleRoute {
  const slot = SEA_DOCK_SLOTS[vehicleConfigId];
  return {
    vehicleConfigId,
    arrivalWaypoints: [slot.dockPosition],
    departureWaypoints: [slot.exitPosition],
  };
}

export const VEHICLE_ROUTES: Record<string, VehicleRoute> = {
  'land-frog-01': buildLandRoute('land-frog-01'),
  'land-rockgiant-01': buildLandRoute('land-rockgiant-01'),
  'land-snail-01': buildLandRoute('land-snail-01'),
  'sea-ray-01': buildSeaRoute('sea-ray-01'),
  'sea-turtle-01': buildSeaRoute('sea-turtle-01'),
  'sea-kraken-01': buildSeaRoute('sea-kraken-01'),
};
