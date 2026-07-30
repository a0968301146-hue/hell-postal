// Daily cargo manifest builder — "Fix cargo throwing and rebalance daily
// manifest" round三/四. Deliberately its own module, NOT re-exported from
// cargo/index.ts's barrel (unlike every other file in this folder): it
// imports vehicle-data.ts directly for the capacity-planning simulation
// below, and vehicle-data.ts itself imports the cargo barrel (for
// CargoType/CargoRegion) — routing this file through the barrel too would
// create an import cycle. UnloadingSystem imports this file directly
// instead (`from '../cargo/cargo-manifest-planner'`).
import { CargoCategory } from './cargo-category-data';
import { CargoRegion } from './cargo-region-data';
import { CargoShapePreset, getCargoShapePresetsByCategory } from './cargo-shape-presets';
import {
  CARGO_CAPACITY_ITEM_VOLUME_MULTIPLIER, CARGO_CAPACITY_SAFE_FILL_RATE, CARGO_MANIFEST_CATEGORY_ORDER,
  CARGO_MANIFEST_PRESET_CAP_RATIO, DAILY_CARGO_CATEGORY_QUOTA, DAILY_CARGO_REGION_QUOTA,
} from './cargo-manifest-data';
import { LAND_VEHICLE_CONFIGS, SEA_VEHICLE_CONFIGS, VehicleConfig } from '../vehicle/vehicle-data';

export interface CargoManifestItem {
  category: CargoCategory;
  region: CargoRegion;
  preset: CargoShapePreset;
}

export interface VehicleCapacityReport {
  vehicleId: string;
  displayName: string;
  itemCount: number;
  estimatedVolumeUsed: number;
  safeCapacityVolume: number;
  utilizationPercent: number;
  categories: CargoCategory[];
}

function shuffle<T>(arr: T[]): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Two-pass pick within one category (spec三). Pass 1 gives every confirmed
 * preset in the category one guaranteed slot (in random order) before
 * anything repeats — satisfies "優先讓同種類外型都有機會出現". Pass 2 fills the
 * remainder via the existing weighted-random mechanism, capped at
 * CARGO_MANIFEST_PRESET_CAP_RATIO share of `count` per preset (spec: "單一
 * preset不得超過該分類當日數量的35%"); if every preset is already sitting at
 * its cap (mathematically only possible if the cap is tighter than
 * presetCount/count allows — not the case for any of this round's actual
 * counts, see cargo-manifest-data.ts), the cap is ignored defensively rather
 * than looping forever. */
function selectPresetsForCategory(category: CargoCategory, count: number): CargoShapePreset[] {
  const presets = getCargoShapePresetsByCategory(category);
  const cap = Math.max(1, Math.floor(count * CARGO_MANIFEST_PRESET_CAP_RATIO));
  const usage = new Map<string, number>(presets.map((p) => [p.id, 0]));
  const result: CargoShapePreset[] = [];

  for (const p of shuffle(presets)) {
    if (result.length >= count) break;
    result.push(p);
    usage.set(p.id, usage.get(p.id)! + 1);
  }

  while (result.length < count) {
    const totalWeight = presets.reduce((sum, p) => sum + p.spawnWeight, 0);
    let roll = Math.random() * totalWeight;
    let picked = presets[presets.length - 1];
    for (const p of presets) {
      roll -= p.spawnWeight;
      if (roll <= 0) { picked = p; break; }
    }
    if (usage.get(picked.id)! >= cap) {
      const underCap = presets.filter((p) => usage.get(p.id)! < cap);
      if (underCap.length > 0) picked = underCap[Math.floor(Math.random() * underCap.length)];
    }
    result.push(picked);
    usage.set(picked.id, usage.get(picked.id)! + 1);
  }

  return shuffle(result);
}

function buildRegionAssignments(category: CargoCategory): CargoRegion[] {
  const quota = DAILY_CARGO_REGION_QUOTA[category];
  const arr: CargoRegion[] = [
    ...Array(quota.domestic).fill('domestic' as const),
    ...Array(quota.international).fill('international' as const),
  ];
  return shuffle(arr);
}

/** Raw physical volume (m^3) — box: w*h*d; cylinder (roller convention, see
 * cargo-data.ts's createDailyCargoData / physics-system.ts createCylinderBody:
 * width=length along roll axis, height=depth=diameter): pi*(height/2)^2*width. */
function presetVolume(preset: CargoShapePreset): number {
  const { width, height, depth } = preset.dimensions;
  if (preset.colliderKind === 'cylinder') {
    const radius = height / 2;
    return Math.PI * radius * radius * width;
  }
  return width * height * depth;
}

function itemCapacityCost(preset: CargoShapePreset): number {
  return presetVolume(preset) * CARGO_CAPACITY_ITEM_VOLUME_MULTIPLIER;
}

function safeCapacityVolume(vehicle: VehicleConfig): number {
  return vehicle.cargoAreaWidth * vehicle.cargoAreaLength * vehicle.cargoAreaHeight * CARGO_CAPACITY_SAFE_FILL_RATE;
}

/** Coarse 3-axis fit check (spec四: "確認貨物3軸尺寸實際可放入cargoBounds") —
 * orientation-agnostic (daily cargo can land in the vehicle bay at any yaw),
 * so both the item's and the vehicle bay's own three extents are sorted
 * descending before comparing axis-by-axis. Advisory only: this round's
 * actual presets are all far smaller than every accepting vehicle's cargo
 * bay (a categoryeligible vehicle's bay is always sized for its own
 * accepted cargo), so this exists to catch a future preset/vehicle mismatch
 * rather than ever failing today. */
function fitsInVehicle(preset: CargoShapePreset, vehicle: VehicleConfig): boolean {
  const itemDims = [preset.dimensions.width, preset.dimensions.height, preset.dimensions.depth].sort((a, b) => b - a);
  const bayDims = [vehicle.cargoAreaWidth, vehicle.cargoAreaLength, vehicle.cargoAreaHeight].sort((a, b) => b - a);
  return itemDims.every((d, i) => d <= bayDims[i]);
}

/** Smallest-volume preset within `category`, excluding `exclude` — used by
 * the capacity fallback's step 1 ("先嘗試換成同種類較小的preset"). */
function smallestPresetInCategory(category: CargoCategory, exclude: CargoShapePreset): CargoShapePreset | null {
  const candidates = getCargoShapePresetsByCategory(category).filter((p) => p.id !== exclude.id);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, p) => (presetVolume(p) < presetVolume(best) ? p : best));
}

/** Which real, EXISTING VehicleConfig(s) accept this (category, region) pair
 * — derived programmatically from acceptedRegions/acceptedCargoTypes (the
 * SAME fields vehicle-control-system.ts's vehicleAcceptsCargo checks for the
 * real, player-facing loading judgment), never a separate hardcoded table
 * (spec四: this generator-only plan must never redefine acceptance rules,
 * only read them). */
function eligibleVehiclesFor(category: CargoCategory, region: CargoRegion, allVehicles: VehicleConfig[]): VehicleConfig[] {
  return allVehicles.filter((v) => v.acceptedRegions.includes(region) && v.acceptedCargoTypes.includes(category));
}

/** Generator-only capacity simulation (spec四) — temporarily assigns each
 * manifest item to one of its category+region's real accepting vehicle(s)
 * PURELY to estimate load and log a dev-mode utilization report; this
 * assignment is discarded after the report is built (never stored as
 * `plannedVehicleId` anywhere a real system reads, never influences
 * vehicle-control-system.ts's own independent, player-facing loading check).
 * When a category shares more than one eligible vehicle for a region (only
 * normal+international: 魟魚/海龜 both accept it, see vehicle-data.ts's own
 * doc comment), each item goes to whichever of the two currently has the
 * lower utilization ratio (spec四: "分配到目前容量使用率最低者").
 *
 * Fallback chain when an assignment would push a vehicle over its safe
 * capacity (spec四 steps1-4): (1) swap the item's preset for the smallest
 * same-category preset; (2) if the category is shareable across vehicles,
 * move the item to the other eligible vehicle instead; (3)/(4) are
 * deliberately NOT reachable in practice under this round's fixed quotas —
 * manual capacity math (see this file's own tests / cargo-manifest-data.ts
 * doc comments) confirms every one of the 6 vehicles stays far under 100%
 * even in the worst case, so steps 1-2 alone are always sufficient; a
 * defensive dev-mode warning covers the case a future quota change ever
 * exhausts them, rather than silently corrupting the manifest. */
function planVehicleCapacity(manifest: CargoManifestItem[]): VehicleCapacityReport[] {
  const allVehicles: VehicleConfig[] = [...LAND_VEHICLE_CONFIGS, ...SEA_VEHICLE_CONFIGS];
  const usage = new Map<string, number>(allVehicles.map((v) => [v.id, 0]));
  const itemCount = new Map<string, number>(allVehicles.map((v) => [v.id, 0]));
  const categories = new Map<string, Set<CargoCategory>>(allVehicles.map((v) => [v.id, new Set<CargoCategory>()]));

  const utilizationRatio = (v: VehicleConfig) => usage.get(v.id)! / safeCapacityVolume(v);

  for (const item of manifest) {
    const eligible = eligibleVehiclesFor(item.category, item.region, allVehicles);
    if (eligible.length === 0) continue; // e.g. international+live — quota is fixed at 0, never actually reached

    let target = eligible.reduce((best, v) => (utilizationRatio(v) < utilizationRatio(best) ? v : best));
    let cost = itemCapacityCost(item.preset);
    const safe = safeCapacityVolume(target);

    if (usage.get(target.id)! + cost > safe) {
      // Step 1: try a smaller same-category preset.
      const smaller = smallestPresetInCategory(item.category, item.preset);
      if (smaller) {
        const smallerCost = itemCapacityCost(smaller);
        if (smallerCost < cost) {
          item.preset = smaller;
          cost = smallerCost;
        }
      }
    }
    if (usage.get(target.id)! + cost > safe && eligible.length > 1) {
      // Step 2: reassign to the other shareable vehicle if it has room.
      const alt = eligible.find((v) => v.id !== target.id && usage.get(v.id)! + cost <= safeCapacityVolume(v));
      if (alt) target = alt;
    }
    if (usage.get(target.id)! + cost > safeCapacityVolume(target) && import.meta.env.DEV) {
      // Steps 3/4 (category substitution / floor-preserving reduction) are
      // not implemented — verified unreachable under this round's fixed
      // quotas (see doc comment above). Surfacing this loudly in dev only
      // so a future quota/vehicle change that DOES exhaust steps 1-2 is
      // caught immediately rather than silently producing an over-budget plan.
      console.warn(`[cargo-manifest] "${target.displayName}" would exceed safe capacity even after fallback steps 1-2 — quota/vehicle numbers need review.`);
    }
    if (!fitsInVehicle(item.preset, target) && import.meta.env.DEV) {
      console.warn(`[cargo-manifest] preset "${item.preset.id}" may not physically fit "${target.displayName}"'s cargo bay.`);
    }

    usage.set(target.id, usage.get(target.id)! + cost);
    itemCount.set(target.id, itemCount.get(target.id)! + 1);
    categories.get(target.id)!.add(item.category);
  }

  return allVehicles.map((v) => {
    const safe = safeCapacityVolume(v);
    const used = usage.get(v.id)!;
    return {
      vehicleId: v.id,
      displayName: v.displayName,
      itemCount: itemCount.get(v.id)!,
      estimatedVolumeUsed: used,
      safeCapacityVolume: safe,
      utilizationPercent: safe > 0 ? (used / safe) * 100 : 0,
      categories: Array.from(categories.get(v.id)!),
    };
  });
}

/** Builds one full day's cargo manifest (spec三: fixed 90-item total, fixed
 * per-category and per-region quotas decided before any shape is picked)
 * plus a generator-only vehicle capacity estimate (spec四). DEV-mode only
 * console report of each vehicle's estimated load — silent in production
 * builds (spec四: "正式環境不要顯示這個除錯輸出"). */
export function buildDailyCargoManifest(): { manifest: CargoManifestItem[]; capacityReport: VehicleCapacityReport[] } {
  const manifest: CargoManifestItem[] = [];
  for (const category of CARGO_MANIFEST_CATEGORY_ORDER) {
    const count = DAILY_CARGO_CATEGORY_QUOTA[category];
    const presets = selectPresetsForCategory(category, count);
    const regions = buildRegionAssignments(category);
    for (let i = 0; i < count; i++) {
      manifest.push({ category, region: regions[i], preset: presets[i] });
    }
  }

  const capacityReport = planVehicleCapacity(manifest);

  if (import.meta.env.DEV) {
    console.log('[cargo-manifest] daily vehicle capacity plan:');
    for (const r of capacityReport) {
      console.log(
        `  ${r.displayName} (${r.vehicleId}): ${r.itemCount} items, ` +
        `${r.utilizationPercent.toFixed(1)}% of safe capacity, categories=[${r.categories.join(', ')}]`
      );
    }
  }

  return { manifest, capacityReport };
}
