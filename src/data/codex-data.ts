// Codex (圖鑑) data. Vehicle entries are DERIVED from VehicleConfig (spec:
// "圖鑑資料可以從 VehicleConfig 產生") — never hand-duplicated — so any future
// vehicle added to vehicle-data.ts automatically gets a codex entry. Species
// entries are a static placeholder list (spec section 十三): no species
// system exists yet, every entry is unlocked-only-by-future-work.

import { LAND_VEHICLE_CONFIGS, SEA_VEHICLE_CONFIGS, VehicleConfig } from '../systems/vehicle';
import {
  CargoType, CARGO_REGION_DISPLAY, CargoShapePreset, CargoCategory,
  CARGO_CATEGORY_DISPLAY, CARGO_SIZE_CLASS_DISPLAY, getCargoShapePresetsByCategory,
} from '../systems/cargo';
import { MAIL_ENVELOPE_VISUAL_PRESETS } from '../systems/mail';

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

// --- Cargo codex ("Organize and expand cargo shape presets" round) --------
//
// Reads CARGO_SHAPE_PRESETS (via getCargoShapePresetsByCategory) directly —
// the SAME data cargo-system.ts spawns daily cargo from — so this page can
// never drift into a second, hand-written description of what a given
// preset looks like (spec十: "圖鑑與生成池讀同一份 CargoShapePreset，不要另外
// 手寫一張會過期的清單").

export interface CargoCodexEntry {
  id: string;
  displayName: string;
  categoryLabel: string;
  sizeLabel: string;
  /** "搬運特性" (spec八) — a short human-readable summary of
   * stackable/throwable/uprightRequired, not a re-statement of raw booleans. */
  carryTraits: string;
  palletLabel: string;
  /** CSS hex string derived from the preset's own mesh base color — doubles
   * as the codex's "簡易圖示" (spec八: "外觀預覽或簡易圖示") without needing
   * an actual rendered thumbnail. */
  colorHex: string;
}

function toCargoCodexEntry(preset: CargoShapePreset): CargoCodexEntry {
  const traits: string[] = [preset.stackable ? '可堆疊' : '不可堆疊'];
  // "Fix cargo throwing and rebalance daily manifest" round一: every
  // pickupable cargo item is throwable now (large/live just at reduced
  // speed, never fully blocked) — preset.throwable no longer drives any
  // actual gameplay behavior (see cargo-system.ts's own doc comment), so
  // this trait always reads '可投擲' rather than echoing that now-inert
  // per-preset field.
  traits.push('可投擲');
  if (preset.uprightRequired) traits.push('需保持正向');
  return {
    id: preset.id,
    displayName: preset.displayName,
    categoryLabel: CARGO_CATEGORY_DISPLAY[preset.category],
    sizeLabel: CARGO_SIZE_CLASS_DISPLAY[preset.sizeClass],
    carryTraits: traits.join('、'),
    palletLabel: preset.palletAllowed ? '可放托盤' : '不可放托盤',
    colorHex: '#' + preset.color.toString(16).padStart(6, '0'),
  };
}

const CARGO_CODEX_CATEGORY_ORDER: CargoCategory[] = ['normal', 'fragile', 'large', 'frozen', 'live'];

export interface CargoCodexGroup {
  category: CargoCategory;
  label: string;
  entries: CargoCodexEntry[];
}

/** Grouped by category, in the same fixed order as spec八's own list
 * (一般/易碎/大型貨物/冷凍/活物) — cargo-shape-presets.ts's own per-category
 * arrays already keep every preset within a category in a stable order, so
 * nothing here needs its own sort. */
export function buildCargoCodexGroups(): CargoCodexGroup[] {
  return CARGO_CODEX_CATEGORY_ORDER.map((category) => ({
    category,
    label: CARGO_CATEGORY_DISPLAY[category],
    entries: getCargoShapePresetsByCategory(category).map(toCargoCodexEntry),
  }));
}

// --- Mail envelope codex ("Add playable envelope visual presets" round) ---
//
// Reads MAIL_ENVELOPE_VISUAL_PRESETS (mail-data.ts) directly — the SAME data
// mail-system.ts now actually spawns daily envelopes from — rather than a
// second, hand-written description (spec: "圖鑑改為讀取同一份
// MailEnvelopeVisualPreset，不保留另一份手寫信件外型清單").

export interface MailEnvelopeCodexEntry {
  id: string;
  displayName: string;
  note: string;
}

export function buildMailEnvelopeCodexEntries(): MailEnvelopeCodexEntry[] {
  return MAIL_ENVELOPE_VISUAL_PRESETS.map((p) => ({ id: p.id, displayName: p.displayName, note: p.note }));
}
