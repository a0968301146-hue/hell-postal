// Minimal cargo data for the logistics vertical-slice prototype.
// Intentionally does NOT reuse PackageData — normal cargo has no address,
// stamp, weight or destination concept yet.

export type CargoType = 'normal' | 'large';

export interface CargoData {
  id: string;
  cargoType: CargoType;
  displayName: string;
  isShipped: boolean;
}

const CARGO_TYPE_DISPLAY_NAME: Record<CargoType, string> = {
  normal: '普通貨物',
  large: '大型貨物',
};

export function createCargoData(id: string, cargoType: CargoType = 'normal'): CargoData {
  return {
    id,
    cargoType,
    displayName: CARGO_TYPE_DISPLAY_NAME[cargoType],
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
