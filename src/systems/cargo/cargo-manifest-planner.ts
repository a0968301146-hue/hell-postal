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
import { CargoShapePreset, getCargoShapePresetsByCategory, GIANT_CAKE_BOX_PRESET } from './cargo-shape-presets';
import {
  CARGO_CAPACITY_ITEM_VOLUME_MULTIPLIER, CARGO_CAPACITY_SAFE_FILL_RATE, CARGO_MANIFEST_CATEGORY_ORDER,
  CARGO_MANIFEST_PRESET_CAP_RATIO,
} from './cargo-manifest-data';
import { LAND_VEHICLE_CONFIGS, SEA_VEHICLE_CONFIGS, VehicleConfig } from '../vehicle/vehicle-data';
import { getEffectiveDayUnlockConfig } from '../../data/daily-unlock-data';

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

interface CargoCombo {
  category: CargoCategory;
  region: CargoRegion;
}

/** Every (category, region) pair the given day's own unlock config allows
 * (daily-unlock-data.ts, the single source of truth) — the pool
 * drawCargoCombos() below draws uniformly at random from (spec五: "從當日已
 * 解鎖貨物種類中隨機生成", no per-combo ratio was ever specified, so an even
 * draw across whatever's unlocked is the actual implementation).
 *
 * 'live'+'international' WAS excluded here (no vehicle accepted it) — "Day
 * 1～7 每日系統完整實作" round follow-up resolved that by reassigning 海龜
 * (sea-turtle-01) from 大型+一般 to 大型+活物 (vehicle-data.ts), so this
 * combination is now a real, shippable draw like any other. */
function unlockedCargoCombos(day: number): CargoCombo[] {
  const cfg = getEffectiveDayUnlockConfig(day);
  const combos: CargoCombo[] = [];
  for (const category of cfg.cargoCategoriesByRegion.domestic) combos.push({ category, region: 'domestic' });
  for (const category of cfg.cargoCategoriesByRegion.international) combos.push({ category, region: 'international' });
  return combos;
}

/** Draws `total` items uniformly at random from `combos` (spec五). Returns
 * them already shuffled (the draw itself is independent per item, so the
 * resulting order is already random — shuffle is just defensive, matching
 * every other list this file hands off). */
function drawCargoCombos(combos: CargoCombo[], total: number): CargoCombo[] {
  const draws: CargoCombo[] = [];
  for (let i = 0; i < total; i++) {
    draws.push(combos[Math.floor(Math.random() * combos.length)]);
  }
  return draws;
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
 * When a category shares more than one eligible vehicle for a region, each
 * item goes to whichever of the two currently has the lower utilization
 * ratio (spec四: "分配到目前容量使用率最低者") — no category currently shares
 * more than one accepting sea vehicle (魟魚/海龜/克拉肯 each own a disjoint
 * international category set, see vehicle-data.ts's own doc comment), so
 * this branch is dormant in practice today but stays correct if a future
 * roster change reintroduces overlap.
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
    if (eligible.length === 0) continue; // defensive — every currently-unlockable combo has a real accepting vehicle

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

/** Day8 finale's own cargo day (spec: "今天的貨物：只有一項") — the ONE day
 * this file's normal day-scaled generation (see buildDailyCargoManifest
 * below) is overridden entirely, per after-work-story-data.ts's own day-8
 * finale entry. Kept as a local constant rather than importing the story
 * data file
 * (systems/cargo has no other reason to depend on systems/story) — the day
 * number itself is the one piece of coupling that already exists implicitly
 * via DailyFlowSystem.currentDay, same as every other day-numbered special
 * case in this codebase. */
const GIANT_CAKE_DAY = 8;

/** Builds one full day's cargo manifest — "Day 1～7 每日系統完整實作" round:
 * total item count AND which (category, region) combinations may appear are
 * both read from `daily-unlock-data.ts`'s `getEffectiveDayUnlockConfig(
 * currentDay)` (spec五/十八), replacing the old fixed-90-item/fixed-quota
 * system entirely. Each of the day's `total` items independently draws one
 * of that day's unlocked combos uniformly at random (unlockedCargoCombos/
 * drawCargoCombos above), then `selectPresetsForCategory` picks presets
 * per-category exactly as before (preset-variety-first pass + 35% cap),
 * fed the ACTUAL count each category happened to draw rather than a fixed
 * quota. Also builds a generator-only vehicle capacity estimate (from the
 * earlier "rebalance daily manifest" round spec四), DEV-mode only console
 * report (spec four: "正式環境不要顯示這個除錯輸出").
 *
 * "每日特殊劇情系統" round — `currentDay` is optional and defaults to a
 * normal day (undefined never matches GIANT_CAKE_DAY, and
 * getEffectiveDayUnlockConfig(undefined as unknown as number) is never
 * called in that branch) so every existing caller/test keeps working
 * unchanged; only UnloadingSystem's own buildSpawnPlan passes the real day,
 * giving day8 its single-item override AND every normal day its own
 * day-scaled total. */
export function buildDailyCargoManifest(currentDay?: number): { manifest: CargoManifestItem[]; capacityReport: VehicleCapacityReport[] } {
  if (currentDay === GIANT_CAKE_DAY) {
    const manifest: CargoManifestItem[] = [{ category: 'large', region: 'domestic', preset: GIANT_CAKE_BOX_PRESET }];
    return { manifest, capacityReport: planVehicleCapacity(manifest) };
  }

  const day = currentDay ?? 1;
  const total = getEffectiveDayUnlockConfig(day).dailyTotals.cargoTotal;
  const combos = unlockedCargoCombos(day);
  const draws = combos.length > 0 ? drawCargoCombos(combos, total) : [];

  const countByCategory = new Map<CargoCategory, number>();
  for (const d of draws) countByCategory.set(d.category, (countByCategory.get(d.category) ?? 0) + 1);

  const manifest: CargoManifestItem[] = [];
  for (const category of CARGO_MANIFEST_CATEGORY_ORDER) {
    const count = countByCategory.get(category);
    if (!count) continue;
    const presets = selectPresetsForCategory(category, count);
    const regionsForCategory = shuffle(draws.filter((d) => d.category === category).map((d) => d.region));
    for (let i = 0; i < count; i++) {
      manifest.push({ category, region: regionsForCategory[i], preset: presets[i] });
    }
  }
  const shuffledManifest = shuffle(manifest);

  const capacityReport = planVehicleCapacity(shuffledManifest);

  if (import.meta.env.DEV) {
    console.log(`[cargo-manifest] day ${day}: ${shuffledManifest.length}/${total} items drawn from ${combos.length} unlocked combos.`);
    console.log('[cargo-manifest] daily vehicle capacity plan:');
    for (const r of capacityReport) {
      console.log(
        `  ${r.displayName} (${r.vehicleId}): ${r.itemCount} items, ` +
        `${r.utilizationPercent.toFixed(1)}% of safe capacity, categories=[${r.categories.join(', ')}]`
      );
    }
  }

  return { manifest: shuffledManifest, capacityReport };
}
