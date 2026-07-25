// Centralized per-vehicle movement ROUTES — the ONE place waypoint
// sequences are defined; vehicle-control-system.ts's update loop only ever
// reads VEHICLE_ROUTES[slot.config.id], never hardcodes a coordinate.
//
// Distinct from vehicle-dock-data.ts (which owns each vehicle's own fixed
// dockPosition/spawnPosition/exitPosition) — this module describes the PATH
// between those points.
//
// "Expand land entrance and cargo capacity" round: land routes are back to
// a direct single-leg spawn->dock / dock->exit line, same shape as sea
// routes — the shared "funnel through one waypoint" bend a previous round
// added is no longer needed now that LAND_GATE (logistics-layout-data.ts)
// has been widened to cover all three land vehicles' own lanes at once
// (see vehicle-dock-data.ts's doc comment for the full reasoning). The
// Waypoint/VehicleRoute types and this per-vehicle lookup table stay in
// place either way, so a future round that needs a bent path again (or a
// vehicle whose lane genuinely isn't covered by the gate) can reintroduce
// one without restructuring VehicleControlSystem's update loop.
import { LAND_DOCK_SLOTS, SEA_DOCK_SLOTS } from './vehicle-dock-data';

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

/** Direct spawn->dock / dock->exit line — used by every vehicle (land and
 * sea alike) now that each land vehicle's spawn/exit already sits at its
 * own dock X, safely inside the widened LAND_GATE for the vehicle's entire
 * journey (see vehicle-dock-data.ts). Kept as an explicit single-element
 * route (rather than a special-cased "no route" path) so
 * VehicleControlSystem's update loop can treat every slot identically. */
function buildDirectRoute(vehicleConfigId: string, slots: Record<string, { dockPosition: Waypoint; exitPosition: Waypoint }>): VehicleRoute {
  const slot = slots[vehicleConfigId];
  return {
    vehicleConfigId,
    arrivalWaypoints: [slot.dockPosition],
    departureWaypoints: [slot.exitPosition],
  };
}

export const VEHICLE_ROUTES: Record<string, VehicleRoute> = {
  'land-frog-01': buildDirectRoute('land-frog-01', LAND_DOCK_SLOTS),
  'land-rockgiant-01': buildDirectRoute('land-rockgiant-01', LAND_DOCK_SLOTS),
  'land-snail-01': buildDirectRoute('land-snail-01', LAND_DOCK_SLOTS),
  'sea-ray-01': buildDirectRoute('sea-ray-01', SEA_DOCK_SLOTS),
  'sea-turtle-01': buildDirectRoute('sea-turtle-01', SEA_DOCK_SLOTS),
  'sea-kraken-01': buildDirectRoute('sea-kraken-01', SEA_DOCK_SLOTS),
};
