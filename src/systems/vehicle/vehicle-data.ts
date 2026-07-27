// Centralized, data-driven vehicle configuration. Every vehicle's mesh,
// collider and cargo-bay detection volume are built FROM these numbers —
// no vehicle's size is ever hardcoded in VehicleSystem/VehicleControlSystem/
// PickupSystem/Game.
import { CargoType, CargoRegion } from '../cargo';
import { MailRegion } from '../mail/mail-types';
import { LAND_DOCK_SLOTS, SEA_DOCK_SLOTS } from './vehicle-dock-data';

/** Uniform scale-up applied to every vehicle's chassis AND cargo-bay
 * dimensions ("Update vehicle cargo compatibility and capacity" round —
 * 六台載具統一放大). The ONE place this multiplier is defined — see
 * scaleVehicleDimensions below, applied identically to all six vehicles
 * rather than hand-multiplying each one's numbers inline. Applying it to
 * the CONFIG numbers themselves (not a THREE.js mesh.scale transform)
 * means VehicleSystem's existing chassis/bed/collider/cargoBayBounds
 * construction — already 100% derived from these fields, nothing
 * hardcoded — scales correctly everywhere with zero changes of its own:
 * colliders, the cargo detection volume, and the floating name label all
 * grow together automatically. */
export const VEHICLE_VISUAL_SCALE = 1.5;

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
  /** Which CargoData.region values this vehicle accepts ("Update vehicle
   * cargo compatibility and capacity" round — replaces the old, never-
   * actually-checked acceptedRouteTypes: RouteType[] field, which used the
   * unrelated/unused legacy label system's 'domestic'|'overseas' union.
   * Every land vehicle accepts only 'domestic', every sea vehicle only
   * 'international' — checked alongside acceptedCargoTypes by
   * vehicle-control-system.ts's vehicleAcceptsCargo, the ONE place this
   * pairing is evaluated; ScoringSystem/HUD/codex-data.ts all read the
   * result or these same fields directly rather than re-deriving their own
   * judgment. */
  acceptedRegions: CargoRegion[];
  /** Rule-level compatibility (spec section 十) — separate from cargo-bay
   * DIMENSIONS (which govern whether cargo physically fits): a cargo item
   * must satisfy BOTH the size check (isInCargoBay) AND this list (AND
   * acceptedRegions above) to count as a correctly-shipped item at
   * departure (see vehicle-control-system.ts's vehicleAcceptsCargo). */
  acceptedCargoTypes: CargoType[];
  /** Which MailBag.region values this vehicle accepts ("Add modular
   * envelope stamping and regional mail bag system" round 九) — a
   * completely independent field from acceptedRegions/acceptedCargoTypes
   * above (mail bags are never CargoData, never checked against cargo
   * rules). Every land vehicle: ['domestic']; every sea vehicle:
   * ['international'] — see vehicleAcceptsMailRegion below, the ONE place
   * this field is actually evaluated (spec: "所有信件袋裝載判定必須讀取同一
   * 份設定，不要在MailSystem、VehicleSystem、ScoringSystem各寫一份規則"). */
  acceptedMailRegions: MailRegion[];
}

/** The ONE place a sealed MailBag's region is checked against a vehicle's
 * own acceptance list (spec九) — VehicleControlSystem's departure-time scan
 * is the only caller; MailBagSystem/MailSystem/ScoringSystem never
 * duplicate this rule, they only ever read its result. Deliberately keyed
 * purely on region, never on vehicle id/displayName (spec: "只判斷國內／海
 * 外，不判斷特定載具名稱"). */
export function vehicleAcceptsMailRegion(config: VehicleConfig, region: MailRegion | null): boolean {
  return region !== null && config.acceptedMailRegions.includes(region);
}

/** Hard ceiling every VehicleConfig must stay under, so a badly-tuned
 * config can't produce a vehicle too big for the scene/dock to handle —
 * scaled by VEHICLE_VISUAL_SCALE alongside the roster itself, so it stays
 * a meaningful ceiling rather than becoming irrelevant once every vehicle
 * grew 1.5x. */
const BASE_VEHICLE_SIZE_LIMITS = {
  maxWidth: 3.2,
  maxLength: 5.8,
  maxHeight: 2.2,
};
export const VEHICLE_SIZE_LIMITS = {
  maxWidth: BASE_VEHICLE_SIZE_LIMITS.maxWidth * VEHICLE_VISUAL_SCALE,
  maxLength: BASE_VEHICLE_SIZE_LIMITS.maxLength * VEHICLE_VISUAL_SCALE,
  maxHeight: BASE_VEHICLE_SIZE_LIMITS.maxHeight * VEHICLE_VISUAL_SCALE,
};

/** Applies VEHICLE_VISUAL_SCALE to one config's chassis + cargo-bay
 * dimensions only — dock/spawn/exit positions, movementSpeed, and every
 * compatibility field are left untouched (positions are already tuned for
 * the SCALED footprint in vehicle-dock-data.ts, not something to multiply
 * again here). The one place this multiplication happens, applied
 * identically to all six configs below via .map() rather than hand-written
 * per vehicle. */
function scaleVehicleDimensions(base: VehicleConfig): VehicleConfig {
  return {
    ...base,
    width: base.width * VEHICLE_VISUAL_SCALE,
    length: base.length * VEHICLE_VISUAL_SCALE,
    height: base.height * VEHICLE_VISUAL_SCALE,
    cargoAreaWidth: base.cargoAreaWidth * VEHICLE_VISUAL_SCALE,
    cargoAreaLength: base.cargoAreaLength * VEHICLE_VISUAL_SCALE,
    cargoAreaHeight: base.cargoAreaHeight * VEHICLE_VISUAL_SCALE,
  };
}

/** Three land-route creatures — ALL SIX land+sea vehicles now dock
 * simultaneously every day ("Add six fixed vehicle docking slots" round —
 * no more round-robin cycling through this list one at a time), each at
 * its OWN fixed, non-overlapping dock/spawn/exit position from
 * vehicle-dock-data.ts (see that file for the exact clearance numbers,
 * already computed against these vehicles' SCALED footprints). Dimensions
 * below are BASE (pre-VEHICLE_VISUAL_SCALE) sizes — LAND_VEHICLE_CONFIGS
 * further down applies the 1.5x scale-up uniformly via
 * scaleVehicleDimensions, never hardcoded per vehicle.
 *
 * Cargo compatibility ("Update vehicle cargo compatibility and capacity"
 * round — 更新六台載具貨物對應): every land vehicle accepts ONLY
 * acceptedRegions:['domestic'] cargo; acceptedCargoTypes narrows further
 * per vehicle. 青蛙 takes 一般+易碎, 石頭巨人 takes 大型 only, 蝸牛 takes
 * 活體+冷凍 — see vehicle-control-system.ts's effectiveCargoKind() for how
 * a spawned item's category/shapeType resolve to one of these CargoType
 * values, and vehicleAcceptsCargo() for how this list combines with
 * acceptedRegions. All comfortably within VEHICLE_SIZE_LIMITS. */
const LAND_VEHICLE_BASE_CONFIGS: VehicleConfig[] = [
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
    acceptedRegions: ['domestic'],
    acceptedCargoTypes: ['normal', 'fragile'],
    acceptedMailRegions: ['domestic'],
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
    acceptedRegions: ['domestic'],
    acceptedCargoTypes: ['large'],
    acceptedMailRegions: ['domestic'],
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
    acceptedRegions: ['domestic'],
    acceptedCargoTypes: ['live', 'frozen'],
    acceptedMailRegions: ['domestic'],
  },
];
export const LAND_VEHICLE_CONFIGS: VehicleConfig[] = LAND_VEHICLE_BASE_CONFIGS.map(scaleVehicleDimensions);

/** Three sea-route creatures — same "all six dock simultaneously, every
 * one at its own fixed slot" design as LAND_VEHICLE_CONFIGS above (see
 * vehicle-dock-data.ts's SEA_DOCK_SLOTS for exact positions/clearances,
 * already computed against these vehicles' SCALED footprints). Sea
 * vehicles travel east-west (axis: 'x'). Dimensions below are BASE
 * (pre-VEHICLE_VISUAL_SCALE) sizes, scaled the same way as the land roster.
 *
 * Cargo compatibility: every sea vehicle accepts ONLY
 * acceptedRegions:['international'] cargo. 魟魚 takes 易碎+一般, 海龜 takes
 * 大型+一般 (so 海外一般 is correct under EITHER ray or turtle —
 * vehicleAcceptsCargo doesn't special-case this, it falls out naturally
 * from both configs independently listing 'normal'), 克拉肯 takes 冷凍
 * only. 海外活體 has no accepting vehicle this round — cargo-data.ts's
 * createDailyCargoData forces region:'domestic' whenever category:'live'
 * is picked, so that combination is never generated in the first place
 * rather than being an unshippable dead end. All comfortably within
 * VEHICLE_SIZE_LIMITS. */
const SEA_VEHICLE_BASE_CONFIGS: VehicleConfig[] = [
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
    acceptedRegions: ['international'],
    acceptedCargoTypes: ['fragile', 'normal'],
    acceptedMailRegions: ['international'],
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
    acceptedRegions: ['international'],
    acceptedCargoTypes: ['large', 'normal'],
    acceptedMailRegions: ['international'],
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
    acceptedRegions: ['international'],
    acceptedCargoTypes: ['frozen'],
    acceptedMailRegions: ['international'],
  },
];
export const SEA_VEHICLE_CONFIGS: VehicleConfig[] = SEA_VEHICLE_BASE_CONFIGS.map(scaleVehicleDimensions);

export function assertWithinSizeLimits(config: VehicleConfig): void {
  if (
    config.width > VEHICLE_SIZE_LIMITS.maxWidth ||
    config.length > VEHICLE_SIZE_LIMITS.maxLength ||
    config.height > VEHICLE_SIZE_LIMITS.maxHeight
  ) {
    throw new Error(`VehicleConfig "${config.id}" exceeds VEHICLE_SIZE_LIMITS`);
  }
}
