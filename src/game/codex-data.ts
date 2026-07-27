// Codex (圖鑑) data. Vehicle entries are DERIVED from VehicleConfig (spec:
// "圖鑑資料可以從 VehicleConfig 產生") — never hand-duplicated — so any future
// vehicle added to vehicle-data.ts automatically gets a codex entry. Species
// entries are a static placeholder list (spec section 十三): no species
// system exists yet, every entry is unlocked-only-by-future-work.

import { LAND_VEHICLE_CONFIGS, SEA_VEHICLE_CONFIGS, VehicleConfig } from '../systems/vehicle';
import { CargoType, CARGO_REGION_DISPLAY } from '../systems/cargo';

/** Codex-specific display wording for CargoType ("Fix vehicle codex
 * compatibility display" round) — deliberately a SEPARATE mapping from
 * cargo-category-data.ts's CARGO_CATEGORY_DISPLAY (crosshair inspection UI,
 * different wording convention, and doesn't even cover 'large' since that
 * comes from shapeType there, not category) rather than reusing it; this
 * round only touches the vehicle codex, not any other codex/UI category
 * display. Record<CargoType, string> is exhaustive at the type level, so a
 * typo'd or renamed CargoType member (e.g. internal code ever using
 * 'living'/'cold' instead of 'live'/'frozen') fails to compile rather than
 * silently rendering blank/undefined. */
const CARGO_TYPE_LABEL: Record<CargoType, string> = {
  normal: '一般', large: '大型貨物', fragile: '易碎', frozen: '冷凍貨物', live: '活物',
};

/** The ONE place a VehicleConfig's accepted regions become display text —
 * codex-data.ts and pause-menu-ui.ts must never build their own separate
 * region/cargo-type mapping table (spec: "禁止在 codex-data.ts 或
 * pause-menu-ui.ts 再寫一份獨立的貨物對應表"); this and
 * formatVehicleAcceptedCargoTypes below read VehicleConfig.acceptedRegions/
 * acceptedCargoTypes directly, the same fields vehicle-control-system.ts's
 * vehicleAcceptsCargo() checks for the actual loading judgment. */
export function formatVehicleAcceptedRegions(config: VehicleConfig): string[] {
  return config.acceptedRegions.map((r) => CARGO_REGION_DISPLAY[r]);
}

export function formatVehicleAcceptedCargoTypes(config: VehicleConfig): string[] {
  return config.acceptedCargoTypes.map((c) => CARGO_TYPE_LABEL[c]);
}

/** Independent codex field for mail capability ("Add modular envelope
 * stamping and regional mail bag system" round 十: "載具圖鑑增加獨立欄位：
 * 可運送信件" — deliberately NOT folded into acceptedCargoLabels above,
 * since mail bags are never a CargoType). Reads VehicleConfig.
 * acceptedMailRegions directly — the same field vehicle-control-system.ts's
 * vehicleAcceptsMailRegion() checks — so this display can never drift from
 * the actual loading rule. */
export function formatVehicleMailCapability(config: VehicleConfig): string {
  return config.acceptedMailRegions.includes('domestic') ? '國內信件' : '海外信件';
}

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
  mailCapabilityLabel: string;
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
    acceptedRegionLabels: formatVehicleAcceptedRegions(config),
    acceptedCargoLabels: formatVehicleAcceptedCargoTypes(config),
    mailCapabilityLabel: formatVehicleMailCapability(config),
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
