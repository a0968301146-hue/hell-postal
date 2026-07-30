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

// The old flat 50/50 pickCargoRegion() coin-flip ("if 目前沒有地區生成設定,
// 先以國內／海外各半隨機生成") was replaced by "Fix cargo throwing and
// rebalance daily manifest" round三's fixed per-category region quota
// (cargo-manifest-data.ts DAILY_CARGO_REGION_QUOTA) — region is now decided
// by cargo-manifest-planner.ts's buildDailyCargoManifest() alongside the
// category quota, before any shape is picked, never rolled per-item anymore.
