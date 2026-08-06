// Minimal cargo data for the logistics vertical-slice prototype.
// Intentionally does NOT reuse PackageData — normal cargo has no address,
// stamp, weight or destination concept yet.

import { CargoCategory } from './cargo-category-data';
import { CargoRegion } from './cargo-region-data';
import { CargoShapePreset, CargoSizeClass, CargoDimensions } from './cargo-shape-presets';

export type CargoType = 'normal' | 'large' | 'fragile' | 'frozen' | 'live';
export type RouteType = 'domestic' | 'overseas';

// 'domestic'/'overseas' double as CargoLabel values too — a label IS the
// route, just spelled the same way, so building a label list never needs a
// separate route->label mapping (see CARGO_LABEL_PRESETS below).
export type CargoLabel = 'domestic' | 'overseas' | 'fragile' | 'large' | 'frozen' | 'live';

export const ALL_CARGO_LABELS: CargoLabel[] = ['domestic', 'overseas', 'fragile', 'large', 'frozen', 'live'];

// CargoDimensions/CargoSizeClass now live in cargo-shape-presets.ts (imported
// above) — NOT re-exported from here too, since the barrel (index.ts) already
// re-exports cargo-shape-presets.ts and a duplicate `export *` of the same
// name from two files is a compile error.

/** Which physical shape/collider this cargo item uses — 'box' and 'large'
 * are both cuboid (built + collided identically, see cargo-system.ts
 * spawnDailyBox — 'large' only differs in the vehicle-compatibility
 * derivation, see vehicle-control-system.ts's effectiveCargoKind, and the
 * category-badge color), 'roller' is a true rolling cylinder (see
 * physics-system.ts createCylinderBody). 'cage' ("Organize and expand cargo
 * shape presets" round) is ALSO a plain cuboid collider (spec四: "鐵籠: 外部
 * Cuboid") but deliberately its own value so pallet-system.ts's existing
 * `shapeType !== 'box' && shapeType !== 'large'` organize-scan filter
 * naturally excludes live cages with zero changes to that file (spec E: "不
 * 可放普通托盤"). */
export type CargoShapeType = 'box' | 'roller' | 'large' | 'cage';

export interface CargoData {
  id: string;
  cargoType: CargoType;
  routeType: RouteType;
  /** Fixed at spawn (see CARGO_LABEL_PRESETS) — the player never edits this
   * this round (no labeling desk/UI exists anymore). Single source of
   * truth for both the on-mesh visual badges (cargo-label-visuals.ts) and
   * the departure judgment (vehicle-control-system.ts's vehicleAcceptsCargo
   * only reads cargoType directly, never this array — labels are for the
   * PLAYER to read, not for the system to re-derive rules from). Unrelated
   * to the daily-flow subtype label below — this array stays empty for all
   * daily cargo (spec "貨品外型與比例有更多變化" round 九: 不要加入國內/海外/
   * 易碎/冷凍/活物/地址/郵票 this round). */
  labels: CargoLabel[];
  displayName: string;
  dimensions: CargoDimensions;
  /** Daily-flow round only (Phase 7: 修正貨物狀態語意): which SPECIFIC
   * vehicle (its VehicleConfig.id, e.g. 'land-frog-01') this item is
   * CURRENTLY resting stably inside (>=0.5s inside that vehicle's
   * cargoBounds — see vehicle-control-system.ts's per-frame shipment scan),
   * regardless of whether that vehicle actually accepts this item's kind —
   * null whenever it isn't physically settled in any docked vehicle right
   * now. Purely a PHYSICAL-PRESENCE fact, never a success judgment by
   * itself; use `correctlyShipped` (or CargoSystem.getShippingStatus) for
   * that. Cleared back to null if the player pulls the item back out of the
   * vehicle. Pre-existing cargo never sets this. */
  loadedVehicleId: string | null;
  /** True ONLY when `loadedVehicleId` is set AND that vehicle's
   * acceptedCargoTypes actually cover this item's effective kind (see
   * vehicle-control-system.ts's vehicleAcceptsCargo) — the ONE place this
   * check is computed; nothing else (ScoringSystem, HUD counts, departure
   * settlement) re-derives correctness independently, they all just read
   * this field (or CargoSystem.getShippingStatus). Sitting inside the WRONG
   * vehicle's cargoBounds sets `loadedVehicleId` but leaves this false —
   * such an item is NOT shipped, counts as unshipped at departure
   * settlement, and is penalized by the existing unshipped-cargo rule. */
  correctlyShipped: boolean;
  /** Defaults to 'box' for every pre-existing cargo item (createCargoData
   * below never sets it) — only daily cargo (createDailyCargoData) sets
   * 'roller'/'large'. */
  shapeType: CargoShapeType;
  /** Daily-flow round only: set true once a box/large item has spent
   * >=0.5s stable on the sorting pallet (see pallet-system.ts). Persists
   * after leaving the fixture. Roller-shaped cargo has no dedicated
   * organizing fixture ("移除滾筒架" round removed the wall-mounted roller
   * rack entirely — a roller item is just a normal special-shape item now,
   * freely placeable/loadable) so this never becomes true for shapeType
   * 'roller'; nothing gates shipping/loading on it either way (see
   * vehicle-control-system.ts's scanCargoForShipment). Pre-existing cargo
   * never sets this; it stays false and unused for anything not spawned
   * via createDailyCargoData. */
  organized: boolean;
  /** "Organize and expand cargo shape presets" round: which exact
   * CargoShapePreset.id this item was spawned from (null for pre-existing
   * non-daily cargo) — replaces the old free-floating `subtype` field.
   * Drives both the mesh built at spawn (cargo-visuals.ts
   * buildCargoShapeMesh) and the visible category-label badge
   * (attachCargoPresetLabel), and lets the crosshair inspection UI /codex
   * look the FULL preset back up via getCargoShapePreset() rather than
   * duplicating its displayName/dimensions here. */
  shapePresetId: string | null;
  /** Coarse size grouping, copied from the spawning preset — null for
   * pre-existing cargo. */
  sizeClass: CargoSizeClass | null;
  /** Fixed at spawn, copied directly from the spawning preset's own
   * `category` (cargo-shape-presets.ts) — every daily item has EXACTLY one
   * category, never independently re-rolled after its shape is picked (spec
   * 一: "每件貨物只能有一個主要種類"). Read by cargo-inspection-ui.ts for the
   * crosshair "種類：..." line and by vehicle-control-system.ts's
   * effectiveCargoKind for the departure-acceptance judgment (unchanged
   * derivation there — see cargo-data.ts's CargoShapeType doc comment).
   * Null for pre-existing non-daily cargo (createCargoData below never sets
   * it). */
  category: CargoCategory | null;
  /** "Fix land vehicle routes and add cargo region UI" round only: fixed at
   * spawn (see cargo-region-data.ts pickCargoRegion()), read by the same
   * crosshair inspection UI to show a floating "地區：國內/海外" line
   * alongside `category`'s own line. Null for pre-existing non-daily cargo
   * — unrelated to `routeType` above (the older domestic/overseas label
   * system, still hardcoded 'domestic' for every daily item) and unrelated
   * to VehicleConfig.acceptedRouteTypes (vehicle-data.ts) — this round does
   * not touch vehicle-loading compatibility at all. */
  region: CargoRegion | null;
  /** "Add freezer shelves and frozen cargo freshness system" round — ONLY
   * meaningful for `category === 'frozen'` items (spec二: "所有冷凍貨物新增
   * coldValue"); stays at its init value (0) for every other category,
   * never read by anything for them. 0~100, starts at 100 for a freshly
   * spawned frozen item (see createDailyCargoData below) and is ticked by
   * FreezerSystem's own per-frame update — never mutated anywhere else. */
  coldValue: number;
  /** "冷藏值系統修改" round三: permanent quality ceiling — starts at 100,
   * only ever LOWERED (never raised) the first time coldValue drops below
   * 75/50/25 (see cold-value-data.ts's own nextColdValueCap), and clamps how
   * high coldValue can ever recover back up to afterward, even after being
   * placed back in a freezer shelf. Same "only meaningful for frozen cargo"
   * caveat as coldValue above. */
  coldValueCap: number;
  /** Whether this item is CURRENTLY close enough to a freezer rack (a plain
   * freshly-computed bool FreezerSystem's own per-frame proximity check
   * writes here every frame — spec八: "維護 isInsideFreezerShelf bool") —
   * drives whether coldValue ticks up or down THIS frame. Same "only
   * meaningful for frozen cargo" caveat as coldValue above. */
  isInsideFreezerShelf: boolean;
}

/** Single-source-of-truth shipping status snapshot (Phase 7: 統一狀態來源)
 * — the shape CargoSystem.getShippingStatus() returns, mirroring exactly
 * the `loadedVehicleId`/`correctlyShipped` pair on CargoData so callers
 * never need to reach into CargoData's other, unrelated fields just to ask
 * "is this shipped, and correctly?". */
export interface ShippingStatus {
  loadedVehicleId: string | null;
  correctlyShipped: boolean;
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
    loadedVehicleId: null,
    correctlyShipped: false,
    shapeType: 'box',
    organized: false,
    shapePresetId: null,
    sizeClass: null,
    category: null,
    region: null,
    coldValue: 0,
    coldValueCap: 100,
    isInsideFreezerShelf: false,
  };
}

/** Back-compat for mail-layout-data.ts, which reads
 * CARGO_BOX_PRESETS.mediumBox.dimensions as the mail bag's own base exterior
 * size ("Organize and expand cargo shape presets" round spec十: "若為了相容
 * 舊存取仍需保留 shapeType：只能作為 CargoShapePreset.id 的相容別名"). Used to
 * be a thin derived view straight off getCargoShapePreset('medium-box'), but
 * "Enlarge small and medium cargo and add NPC dialogue stages" round doubled
 * every sizeClass 'small'/'medium' preset's dimensions INCLUDING 'medium-box'
 * itself — reading it live would have silently doubled mail bags too, which
 * is explicitly out of scope this round (spec: "不要修改...信封箱"). Frozen
 * here instead as the exact PRE-doubling {0.42, 0.38, 0.40} snapshot, so mail
 * bags keep their existing size regardless of any future cargo-shape-presets.ts
 * change to 'medium-box' itself. */
export const CARGO_BOX_PRESETS = {
  mediumBox: { dimensions: { width: 0.42, height: 0.38, depth: 0.40 } },
};

/** Daily-flow round cargo (spec "每日貨品清空核心流程") — deliberately
 * bypasses CARGO_LABEL_PRESETS entirely: daily items spawn with no
 * domestic/overseas/fragile labels, no route/cargo-type distinction the
 * player needs to read there. cargoType/routeType stay harmless defaults so
 * CargoData stays a single consistent shape, but nothing reads them for
 * daily cargo — the real identity is `shapePresetId`/`sizeClass`/`category`,
 * all copied directly from the CargoShapePreset that was picked ("Organize
 * and expand cargo shape presets" round: category/sizeClass are no longer
 * independently re-rolled after the shape is chosen — every preset now
 * carries its own fixed category, see cargo-shape-presets.ts). */
/** `region` is now decided by the caller (cargo-manifest-planner.ts's
 * buildDailyCargoManifest(), fed through spawnDailyBox/spawnDailyRoller —
 * see cargo-system.ts) as part of the day's fixed per-category region quota
 * (spec三), not rolled independently per item here anymore. 'live' cargo
 * still never receives 'international' — DAILY_CARGO_REGION_QUOTA.live.
 * international is fixed at 0 (no accepting vehicle, see vehicle-data.ts's
 * own doc comment on SEA_VEHICLE_BASE_CONFIGS), so callers naturally never
 * pass that combination; nothing here needs to re-guard it. */
export function createDailyCargoData(id: string, preset: CargoShapePreset, region: CargoRegion): CargoData {
  // Shape/collider family for the fields every OTHER system (pallet-system.ts,
  // vehicle-control-system.ts, physics collider choice in cargo-system.ts)
  // still reads — see CargoShapeType's own doc comment above for why each
  // branch matters.
  const shapeType: CargoShapeType =
    preset.colliderKind === 'cylinder' ? 'roller' :
    preset.category === 'large' ? 'large' :
    preset.visualKind === 'cage' ? 'cage' : 'box';
  return {
    id,
    cargoType: 'normal',
    routeType: 'domestic',
    labels: [],
    displayName: preset.displayName,
    dimensions: preset.dimensions,
    loadedVehicleId: null,
    correctlyShipped: false,
    shapeType,
    organized: false,
    shapePresetId: preset.id,
    sizeClass: preset.sizeClass,
    category: preset.category,
    region,
    // spec二: "生成時：100" — only frozen cargo ever actually decays/recovers
    // (FreezerSystem's own update() skips every non-frozen category), so 0
    // for everything else is just a harmless, never-read default.
    coldValue: preset.category === 'frozen' ? 100 : 0,
    // "冷藏值系統修改" round三: starts uncapped (100) — only ever lowered
    // once coldValue actually crosses a tier boundary for the first time.
    coldValueCap: 100,
    isInsideFreezerShelf: false,
  };
}

/** "Add freezer shelves and frozen cargo freshness system" round follow-up
 * — a save-ready snapshot of one cargo item's data, kept as its OWN named
 * type + an explicit serialize/deserialize pair (spec: "把coldValue納入
 * Cargo的序列化／反序列化架構，即使目前沒有localStorage，也要保證之後加入
 * 存檔時可以直接保存，不要等到未來再補").
 *
 * Every CargoData field is ALREADY a plain JSON-safe primitive, array, or
 * plain object today (no THREE.js instances, no circular references) — so
 * `serializeCargoData`/`deserializeCargoData` below are currently trivial
 * passthroughs. They exist anyway, as this ONE explicit conversion
 * boundary, so a future save system has a single already-defined contract
 * to call into (`cargoSystem.cargoDataMap.values()` -> serializeCargoData ->
 * JSON -> localStorage, and the reverse on load) rather than either
 * assuming CargoData itself is safe to JSON.stringify() directly (an
 * assumption that would silently break the moment CargoData ever gains a
 * non-serializable field) or having to retrofit coldValue/coldValueCap/
 * isInsideFreezerShelf into a save format invented later without this
 * round's own context. Every field is listed explicitly below (not just
 * `...data`) so adding a new CargoData field in the future forces a
 * conscious decision about whether it belongs in a save file too, rather
 * than silently riding along. */
export interface SerializedCargoData {
  id: string;
  cargoType: CargoType;
  routeType: RouteType;
  labels: CargoLabel[];
  displayName: string;
  dimensions: CargoDimensions;
  loadedVehicleId: string | null;
  correctlyShipped: boolean;
  shapeType: CargoShapeType;
  organized: boolean;
  shapePresetId: string | null;
  sizeClass: CargoSizeClass | null;
  category: CargoCategory | null;
  region: CargoRegion | null;
  coldValue: number;
  coldValueCap: number;
  isInsideFreezerShelf: boolean;
}

export function serializeCargoData(data: CargoData): SerializedCargoData {
  return {
    id: data.id,
    cargoType: data.cargoType,
    routeType: data.routeType,
    labels: [...data.labels],
    displayName: data.displayName,
    dimensions: { ...data.dimensions },
    loadedVehicleId: data.loadedVehicleId,
    correctlyShipped: data.correctlyShipped,
    shapeType: data.shapeType,
    organized: data.organized,
    shapePresetId: data.shapePresetId,
    sizeClass: data.sizeClass,
    category: data.category,
    region: data.region,
    coldValue: data.coldValue,
    coldValueCap: data.coldValueCap,
    isInsideFreezerShelf: data.isInsideFreezerShelf,
  };
}

export function deserializeCargoData(saved: SerializedCargoData): CargoData {
  return {
    id: saved.id,
    cargoType: saved.cargoType,
    routeType: saved.routeType,
    labels: [...saved.labels],
    displayName: saved.displayName,
    dimensions: { ...saved.dimensions },
    loadedVehicleId: saved.loadedVehicleId,
    correctlyShipped: saved.correctlyShipped,
    shapeType: saved.shapeType,
    organized: saved.organized,
    shapePresetId: saved.shapePresetId,
    sizeClass: saved.sizeClass,
    category: saved.category,
    region: saved.region,
    coldValue: saved.coldValue,
    coldValueCap: saved.coldValueCap,
    isInsideFreezerShelf: saved.isInsideFreezerShelf,
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
