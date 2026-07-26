// Centralized, data-driven vehicle configuration. Every vehicle's mesh,
// collider and cargo-bay detection volume are built FROM these numbers —
// no vehicle's size is ever hardcoded in VehicleSystem/VehicleControlSystem/
// PickupSystem/Game.
import { CargoType, RouteType } from '../cargo';
import { LAND_DOCK_SLOTS, SEA_DOCK_SLOTS } from './vehicle-dock-data';

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
   * as a correctly-shipped item at departure (see
   * vehicle-control-system.ts's vehicleAcceptsCargo). */
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

/** Three land-route creatures — ALL SIX land+sea vehicles now dock
 * simultaneously every day ("Add six fixed vehicle docking slots" round —
 * no more round-robin cycling through this list one at a time), each at
 * its OWN fixed, non-overlapping dock/spawn/exit position from
 * vehicle-dock-data.ts (see that file for the exact clearance numbers).
 * Each keeps its own EXCLUSIVE cargo specialty so "貨物放入正確載具才算成功
 * 出貨" has something real to check — see vehicle-control-system.ts's
 * effectiveCargoKind()/vehicleAcceptsCargo(). All comfortably within
 * VEHICLE_SIZE_LIMITS. */
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
    dockPosition: LAND_DOCK_SLOTS['land-frog-01'].dockPosition,
    spawnPosition: LAND_DOCK_SLOTS['land-frog-01'].spawnPosition,
    exitPosition: LAND_DOCK_SLOTS['land-frog-01'].exitPosition,
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
    dockPosition: LAND_DOCK_SLOTS['land-rockgiant-01'].dockPosition,
    spawnPosition: LAND_DOCK_SLOTS['land-rockgiant-01'].spawnPosition,
    exitPosition: LAND_DOCK_SLOTS['land-rockgiant-01'].exitPosition,
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
    dockPosition: LAND_DOCK_SLOTS['land-snail-01'].dockPosition,
    spawnPosition: LAND_DOCK_SLOTS['land-snail-01'].spawnPosition,
    exitPosition: LAND_DOCK_SLOTS['land-snail-01'].exitPosition,
    movementSpeed: 1.4,
    acceptedRouteTypes: ['domestic'],
    acceptedCargoTypes: ['live'],
  },
];

/** Three sea-route creatures — same "all six dock simultaneously, every
 * one at its own fixed slot" design as LAND_VEHICLE_CONFIGS above (see
 * vehicle-dock-data.ts's SEA_DOCK_SLOTS for exact positions/clearances).
 * Sea vehicles travel east-west (axis: 'x'). All comfortably within
 * VEHICLE_SIZE_LIMITS. */
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
    dockPosition: SEA_DOCK_SLOTS['sea-ray-01'].dockPosition,
    spawnPosition: SEA_DOCK_SLOTS['sea-ray-01'].spawnPosition,
    exitPosition: SEA_DOCK_SLOTS['sea-ray-01'].exitPosition,
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
    dockPosition: SEA_DOCK_SLOTS['sea-turtle-01'].dockPosition,
    spawnPosition: SEA_DOCK_SLOTS['sea-turtle-01'].spawnPosition,
    exitPosition: SEA_DOCK_SLOTS['sea-turtle-01'].exitPosition,
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
    dockPosition: SEA_DOCK_SLOTS['sea-kraken-01'].dockPosition,
    spawnPosition: SEA_DOCK_SLOTS['sea-kraken-01'].spawnPosition,
    exitPosition: SEA_DOCK_SLOTS['sea-kraken-01'].exitPosition,
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
