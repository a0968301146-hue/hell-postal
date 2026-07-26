// Cargo region — a lightweight classification used ONLY by the crosshair
// cargo-inspection UI ("Fix land vehicle routes and add cargo region UI"
// round), exactly mirroring cargo-category-data.ts's own scope and
// reasoning. Deliberately independent of the pre-existing
// CargoData.routeType ('domestic'|'overseas' — the older domestic/overseas/
// label system, unused by daily cargo, which always spawns with
// routeType:'domestic' as a harmless default, and also independent of
// vehicle-data.ts's VehicleConfig.acceptedRouteTypes, which stays
// untouched — spec: "不修改載具裝載相容判定") — this module owns
// CargoRegion end to end so it never gets coupled or confused with either.

export type CargoRegion = 'domestic' | 'international';

/** Display text for the inspection UI. */
export const CARGO_REGION_DISPLAY: Record<CargoRegion, string> = {
  domestic: '國內',
  international: '海外',
};

/** Ratio of daily cargo assigned 'domestic' — centralized here (spec: "比例
 * 集中於 cargo region data/config"). No unlock/route-generation system
 * exists yet to drive this from real game state, so it defaults to a flat
 * 50/50 random split (spec: "若目前沒有地區生成設定，先以國內／海外各半隨機
 * 生成") — unlike cargo-category-data.ts's deterministic cyclic pick, this
 * one is a genuine per-item coin flip since the spec explicitly asks for
 * "隨機生成" here, not a hard per-batch guarantee. */
export const DOMESTIC_REGION_RATIO = 0.5;

export function pickCargoRegion(): CargoRegion {
  return Math.random() < DOMESTIC_REGION_RATIO ? 'domestic' : 'international';
}
