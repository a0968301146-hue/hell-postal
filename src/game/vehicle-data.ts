// Centralized, data-driven vehicle configuration. Every vehicle's mesh,
// collider and cargo-bay detection volume are built FROM these numbers —
// no vehicle's size is ever hardcoded in VehicleSystem/VehicleControlSystem/
// PickupSystem/Game.
import { CargoType, RouteType } from './cargo-data';

export interface VehicleConfig {
  id: string;
  vehicleType: 'land' | 'sea';
  displayName: string;
  /** Overall chassis footprint. */
  width: number;
  length: number;
  height: number;
  /** Interior cargo bay dimensions (used for the free-loading detection volume). */
  cargoAreaWidth: number;
  cargoAreaLength: number;
  cargoAreaHeight: number;
  /** Where it sits once docked. */
  dockPosition: { x: number; z: number };
  /** Where it's created, off-screen, before driving in. */
  spawnPosition: { x: number; z: number };
  /** Where it travels to (and is despawned) after departing. */
  exitPosition: { x: number; z: number };
  /** m/s, simple linear translation — no physics-driven driving. */
  movementSpeed: number;
  /** Which world axis is this vehicle's length/travel axis. 'z' (default,
   * omit for land vehicles) reproduces the original behavior: chassis
   * length along Z, open cargo front at -Z, closed wall at +Z, and the
   * vehicle drives along Z. 'x' rotates that whole layout 90° — length
   * along X, open front at -X, closed wall at +X, drives along X — used by
   * sea vehicles, which travel east-west and dock with their cargo opening
   * facing west (toward the player-accessible interior), not north. */
  axis?: 'x' | 'z';
  /** Rule-level compatibility (spec section 十) — separate from cargo-bay
   * DIMENSIONS (which govern whether cargo physically fits): a cargo item
   * must satisfy BOTH the size check (isInCargoBay) AND this list to count
   * as a correctly-shipped item at departure (see cargo-compliance.ts). */
  acceptedRouteTypes: RouteType[];
  acceptedCargoTypes: CargoType[];
}

/** Hard ceiling every VehicleConfig must stay under, so a badly-tuned
 * config can't produce a vehicle too big for the scene/dock to handle. */
export const VEHICLE_SIZE_LIMITS = {
  maxWidth: 3.2,
  maxLength: 5.8,
  maxHeight: 2.2,
};

// All land vehicles share one physical dock/gate (the south-wall gap built
// in scene-manager.ts) — that's a route, not a per-vehicle identity — so
// every entry below reuses the same dock/spawn/exit coordinates. What
// genuinely varies per vehicle is its own footprint, cargo bay and speed.
const LAND_DOCK_POS = { x: -6, z: 29.5 };
const LAND_SPAWN_POS = { x: -6, z: 49 }; // south, beyond the back-area wall + view
const LAND_EXIT_POS = { x: -6, z: 49 };

/** Three land-route creatures — cycled round-robin by VehicleControlSystem
 * each time the spawn button is pressed ("Add six cargo vehicles" round:
 * replaces the old generic van/truck/truck lineup with themed creature
 * haulers, each with its own EXCLUSIVE cargo specialty so "貨物放入正確
 * 載具才算成功出貨" has something real to check — see
 * vehicle-control-system.ts's effectiveCargoKind()/vehicleAcceptsCargo()).
 * All comfortably within VEHICLE_SIZE_LIMITS and the land dock's physical
 * footprint (LAND_DOCKS[0]: width 4, depth 5). */
export const LAND_VEHICLE_CONFIGS: VehicleConfig[] = [
  {
    id: 'land-frog-01',
    vehicleType: 'land',
    displayName: '青蛙',
    width: 1.5,
    length: 2.6,
    height: 1.3,
    cargoAreaWidth: 1.2,
    cargoAreaLength: 2.1,
    cargoAreaHeight: 1.15,
    dockPosition: LAND_DOCK_POS,
    spawnPosition: LAND_SPAWN_POS,
    exitPosition: LAND_EXIT_POS,
    movementSpeed: 4.2,
    acceptedRouteTypes: ['domestic'],
    // 國內一般貨物、國內信件 — CargoType has no separate "信件" variant, so
    // both map onto 'normal' (the same bucket ordinary daily-flow cargo's
    // effective kind resolves to — see effectiveCargoKind()).
    acceptedCargoTypes: ['normal'],
  },
  {
    id: 'land-rockgiant-01',
    vehicleType: 'land',
    displayName: '石頭巨人',
    width: 2.6,
    length: 4.6,
    height: 1.9,
    cargoAreaWidth: 2.2,
    cargoAreaLength: 4.0,
    cargoAreaHeight: 1.7,
    dockPosition: LAND_DOCK_POS,
    spawnPosition: LAND_SPAWN_POS,
    exitPosition: LAND_EXIT_POS,
    movementSpeed: 2.0,
    acceptedRouteTypes: ['domestic'],
    acceptedCargoTypes: ['large'],
  },
  {
    id: 'land-snail-01',
    vehicleType: 'land',
    displayName: '蝸牛',
    width: 2.0,
    length: 3.4,
    height: 1.5,
    cargoAreaWidth: 1.7,
    cargoAreaLength: 2.9,
    cargoAreaHeight: 1.3,
    dockPosition: LAND_DOCK_POS,
    spawnPosition: LAND_SPAWN_POS,
    exitPosition: LAND_EXIT_POS,
    movementSpeed: 1.4,
    acceptedRouteTypes: ['domestic'],
    acceptedCargoTypes: ['live'],
  },
];

// Sea vehicles travel east-west (axis: 'x'), docking at the existing
// SEA_DOCKS marker positions (logistics-layout-data.ts) — only ONE sea
// vehicle ever exists at a time (round-robin, like land), so all three
// configs safely share the same dock slot, exactly like every land config
// already shares ONE LAND_DOCK_POS above. Spawn/exit sit east of the pier
// (PIER.maxX = 18) and well beyond player view, mirroring how land's
// spawn/exit sit south of the back-area wall.
const SEA_DOCK_POS = { x: 14, z: 16 }; // matches SEA_DOCKS[0]
const SEA_SPAWN_POS = { x: 40, z: SEA_DOCK_POS.z }; // east, beyond the pier + view
const SEA_EXIT_POS = { x: 40, z: SEA_DOCK_POS.z };

/** Three sea-route creatures — same round-robin pattern and EXCLUSIVE-
 * specialty design as LAND_VEHICLE_CONFIGS above, with their own index (see
 * VehicleControlSystem). All comfortably within VEHICLE_SIZE_LIMITS and the
 * pier's physical footprint (PIER: x 10–18, z 14–22) — length along X stays
 * well under the pier's 8m depth, half-width along Z stays under ~1.5 so
 * the hull stays within the z 14–22 sea-gate opening. */
export const SEA_VEHICLE_CONFIGS: VehicleConfig[] = [
  {
    id: 'sea-ray-01',
    vehicleType: 'sea',
    displayName: '魟魚',
    width: 1.8,
    length: 3.2,
    height: 1.2,
    cargoAreaWidth: 1.5,
    cargoAreaLength: 2.6,
    cargoAreaHeight: 1.05,
    dockPosition: SEA_DOCK_POS,
    spawnPosition: SEA_SPAWN_POS,
    exitPosition: SEA_EXIT_POS,
    movementSpeed: 3.6,
    axis: 'x',
    acceptedRouteTypes: ['overseas'],
    acceptedCargoTypes: ['fragile'],
  },
  {
    id: 'sea-turtle-01',
    vehicleType: 'sea',
    displayName: '海龜',
    width: 2.2,
    length: 3.8,
    height: 1.5,
    cargoAreaWidth: 1.85,
    cargoAreaLength: 3.2,
    cargoAreaHeight: 1.35,
    dockPosition: SEA_DOCK_POS,
    spawnPosition: SEA_SPAWN_POS,
    exitPosition: SEA_EXIT_POS,
    movementSpeed: 2.6,
    axis: 'x',
    acceptedRouteTypes: ['overseas'],
    // 國外一般貨物、國外信件 — see land-frog-01's comment on why both map
    // onto 'normal'.
    acceptedCargoTypes: ['normal'],
  },
  {
    id: 'sea-kraken-01',
    vehicleType: 'sea',
    displayName: '克拉肯',
    width: 2.6,
    length: 4.6,
    height: 1.9,
    cargoAreaWidth: 2.2,
    cargoAreaLength: 3.9,
    cargoAreaHeight: 1.7,
    dockPosition: SEA_DOCK_POS,
    spawnPosition: SEA_SPAWN_POS,
    exitPosition: SEA_EXIT_POS,
    movementSpeed: 2.8,
    axis: 'x',
    acceptedRouteTypes: ['overseas'],
    acceptedCargoTypes: ['frozen'],
  },
];

export function assertWithinSizeLimits(config: VehicleConfig): void {
  if (
    config.width > VEHICLE_SIZE_LIMITS.maxWidth ||
    config.length > VEHICLE_SIZE_LIMITS.maxLength ||
    config.height > VEHICLE_SIZE_LIMITS.maxHeight
  ) {
    throw new Error(`VehicleConfig "${config.id}" exceeds VEHICLE_SIZE_LIMITS`);
  }
}
