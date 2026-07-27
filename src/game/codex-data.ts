// Codex (圖鑑) data. Vehicle entries are DERIVED from VehicleConfig (spec:
// "圖鑑資料可以從 VehicleConfig 產生") — never hand-duplicated — so any future
// vehicle added to vehicle-data.ts automatically gets a codex entry. Species
// entries are a static placeholder list (spec section 十三): no species
// system exists yet, every entry is unlocked-only-by-future-work.

import { LAND_VEHICLE_CONFIGS, SEA_VEHICLE_CONFIGS, VehicleConfig } from '../systems/vehicle';
import { CargoType, CARGO_REGION_DISPLAY } from '../systems/cargo';

const CARGO_TYPE_LABEL: Record<CargoType, string> = {
  normal: '普通', large: '大型', fragile: '易碎', frozen: '冷凍', live: '活體',
};

export interface VehicleCodexEntry {
  id: string;
  displayName: string;
  transportLabel: string; // '陸運' | '海運'
  dimensions: { width: number; length: number; height: number };
  cargoArea: { width: number; length: number; height: number };
  /** Directly from VehicleConfig — this round's test configuration, not a
   * formal world-building rule (spec section十一: "不要寫成正式圖鑑介紹"). */
  acceptedRegionLabels: string[];
  acceptedCargoLabels: string[];
  /** World-building/creature-flavor fields — not written yet this round. */
  traits: string;
  description: string;
}

function toCodexEntry(config: VehicleConfig): VehicleCodexEntry {
  return {
    id: config.id,
    displayName: config.displayName,
    transportLabel: config.vehicleType === 'sea' ? '海運' : '陸運',
    dimensions: { width: config.width, length: config.length, height: config.height },
    cargoArea: { width: config.cargoAreaWidth, length: config.cargoAreaLength, height: config.cargoAreaHeight },
    acceptedRegionLabels: config.acceptedRegions.map((r) => CARGO_REGION_DISPLAY[r]),
    acceptedCargoLabels: config.acceptedCargoTypes.map((c) => CARGO_TYPE_LABEL[c]),
    traits: '尚未收錄',
    description: '尚未收錄',
  };
}

export function buildVehicleCodexEntries(): VehicleCodexEntry[] {
  return [...LAND_VEHICLE_CONFIGS, ...SEA_VEHICLE_CONFIGS].map(toCodexEntry);
}

export interface SpeciesCodexEntry {
  id: string;
  displayName: string;
}

/** Five reserved customer species — the prototype's NPCs are still the
 * plain oval test model, so none of these are discoverable yet this round
 * (spec section 十三: "不要把目前的橢圓測試 NPC 誤認為其中任何一種種族"). */
export const SPECIES_CODEX_ENTRIES: SpeciesCodexEntry[] = [
  { id: 'dwarf', displayName: '矮人' },
  { id: 'elf', displayName: '精靈' },
  { id: 'goblin', displayName: '哥布林' },
  { id: 'skeleton', displayName: '骷髏' },
  { id: 'cyclops', displayName: '獨眼人' },
];
