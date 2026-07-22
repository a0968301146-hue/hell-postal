// Minimal cargo data for the logistics vertical-slice prototype.
// Intentionally does NOT reuse PackageData — normal cargo has no address,
// stamp, weight or destination concept yet.

export type CargoType = 'normal' | 'large' | 'fragile' | 'frozen' | 'live';
export type RouteType = 'domestic' | 'overseas';

// 'domestic'/'overseas' double as CargoLabel values too — a label IS the
// route, just spelled the same way, so building a label list never needs a
// separate route->label mapping (see CARGO_LABEL_PRESETS below).
export type CargoLabel = 'domestic' | 'overseas' | 'fragile' | 'large' | 'frozen' | 'live';

export const ALL_CARGO_LABELS: CargoLabel[] = ['domestic', 'overseas', 'fragile', 'large', 'frozen', 'live'];

export interface CargoDimensions {
  width: number;
  height: number;
  depth: number;
}

export interface CargoData {
  id: string;
  cargoType: CargoType;
  routeType: RouteType;
  /** Fixed at spawn (see CARGO_LABEL_PRESETS) — the player never edits this
   * this round (no labeling desk/UI exists anymore). Single source of
   * truth for both the on-mesh visual badges (cargo-label-visuals.ts) and
   * the departure judgment (cargo-compliance.ts only reads
   * routeType/cargoType directly, never this array — labels are for the
   * PLAYER to read, not for the system to re-derive rules from). */
  labels: CargoLabel[];
  displayName: string;
  dimensions: CargoDimensions;
  isShipped: boolean;
}

const CARGO_TYPE_DISPLAY_NAME: Record<CargoType, string> = {
  normal: '普通貨物',
  large: '大型貨物',
  fragile: '易碎貨物',
  frozen: '冷凍貨物',
  live: '活體貨物',
};

/** A named cargoType+routeType+labels combination — the ONE place these
 * combos are defined (spec section 五: "不要把標籤組合散落在不同生成函式
 * 中"). cargo-system.ts spawns cargo by picking a preset here, never by
 * hand-assembling a labels array itself. Large+fragile combos need BOTH
 * labels even though cargoType can only hold one value — that's exactly
 * why `labels` is its own independent field on CargoData rather than
 * something derived purely from cargoType at read time. */
export interface CargoLabelPreset {
  id: string;
  cargoType: CargoType;
  routeType: RouteType;
  labels: CargoLabel[];
}

export const CARGO_LABEL_PRESETS: Record<string, CargoLabelPreset> = {
  normalDomestic: { id: 'normalDomestic', cargoType: 'normal', routeType: 'domestic', labels: ['domestic'] },
  normalOverseas: { id: 'normalOverseas', cargoType: 'normal', routeType: 'overseas', labels: ['overseas'] },
  fragileDomestic: { id: 'fragileDomestic', cargoType: 'fragile', routeType: 'domestic', labels: ['domestic', 'fragile'] },
  fragileOverseas: { id: 'fragileOverseas', cargoType: 'fragile', routeType: 'overseas', labels: ['overseas', 'fragile'] },
  largeDomestic: { id: 'largeDomestic', cargoType: 'large', routeType: 'domestic', labels: ['domestic', 'large'] },
  largeOverseas: { id: 'largeOverseas', cargoType: 'large', routeType: 'overseas', labels: ['overseas', 'large'] },
  largeFragileOverseas: { id: 'largeFragileOverseas', cargoType: 'large', routeType: 'overseas', labels: ['overseas', 'large', 'fragile'] },
  // Reserved for later rounds — NOT generated this round (spec section 三/十四).
  frozenDomestic: { id: 'frozenDomestic', cargoType: 'frozen', routeType: 'domestic', labels: ['domestic', 'frozen'] },
  liveOverseas: { id: 'liveOverseas', cargoType: 'live', routeType: 'overseas', labels: ['overseas', 'live'] },
};

export function createCargoData(id: string, preset: CargoLabelPreset, dimensions: CargoDimensions): CargoData {
  const routePrefix = preset.routeType === 'overseas' ? '海外' : '';
  return {
    id,
    cargoType: preset.cargoType,
    routeType: preset.routeType,
    labels: preset.labels,
    displayName: routePrefix + CARGO_TYPE_DISPLAY_NAME[preset.cargoType],
    dimensions,
    isShipped: false,
  };
}

export interface CargoSize {
  width: number;
  height: number;
  depth: number;
}

/** Hard bounds every preset (and any future size-generation logic) must
 * stay within — keeps cargo from ever being too flat/thin/large to pick
 * up, place, ride the conveyor, or fit in a vehicle's cargo bay. */
export const CARGO_SIZE_LIMITS = {
  minDim: 0.22,
  maxDim: 0.6,
};

/** Fixed preset (w,h,d) combinations — each axis varies independently, not
 * a uniform scale, while staying inside CARGO_SIZE_LIMITS by construction. */
export const CARGO_SIZE_PRESETS: CargoSize[] = [
  { width: 0.3, height: 0.3, depth: 0.3 },
  { width: 0.45, height: 0.28, depth: 0.35 },
  { width: 0.35, height: 0.5, depth: 0.35 },
  { width: 0.55, height: 0.35, depth: 0.4 },
  { width: 0.3, height: 0.3, depth: 0.55 },
  { width: 0.4, height: 0.4, depth: 0.4 },
  { width: 0.25, height: 0.45, depth: 0.25 },
];

/** Picked once per cargo instance at spawn time — never re-picked on pickup. */
export function pickCargoSize(): CargoSize {
  return CARGO_SIZE_PRESETS[Math.floor(Math.random() * CARGO_SIZE_PRESETS.length)];
}

/** Large cargo — clearly bigger than any normal-cargo preset (max dim 0.6)
 * on every axis, dominated by height so it reads as "big freight" rather
 * than just a bigger box. Three prototype silhouettes (wide/long/tall); the
 * "tall" preset's footprint (0.7×0.7) is deliberately sized to be the one
 * that fits the flatbed dolly's cargo bed (see dolly-data.ts) — the other
 * two are wider/longer than the dolly can hold but still fit land/sea cargo
 * bays comfortably, satisfying "at least one preset fits the dolly" without
 * requiring every preset to. */
export const LARGE_CARGO_SIZE_PRESETS: CargoSize[] = [
  { width: 1.1, height: 0.8, depth: 0.8 },   // wide
  { width: 0.8, height: 0.7, depth: 1.35 },  // long
  { width: 0.7, height: 1.25, depth: 0.7 },  // tall — dolly-compatible footprint
];

export function pickLargeCargoSize(index: number): CargoSize {
  return LARGE_CARGO_SIZE_PRESETS[index % LARGE_CARGO_SIZE_PRESETS.length];
}
