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

/** Which physical shape this cargo item is — added for the "每日貨品清空
 * 核心流程" round (daily-flow-data.ts / cargo-system.ts spawnDailyBox/
 * spawnDailyRoller). 'box' and 'large' are both cuboid (built + collided
 * identically, see cargo-system.ts spawnDailyBox — 'large' is just a
 * bigger/heavier size class of the same shape), 'roller' is cylinder cargo
 * (see physics-system.ts createCylinderBody). */
export type CargoShapeType = 'box' | 'roller' | 'large';

/** Coarse size grouping, independent of shapeType — a 'box' can be small/
 * medium/large, while every 'large' shapeType item is itself large/
 * extraLarge (spec "貨品外型與比例有更多變化" round section 八). Used only
 * for display/reporting; nothing this round branches game logic on it. */
export type CargoSizeClass = 'small' | 'medium' | 'large' | 'extraLarge';

/** Every daily-cargo silhouette this round generates (spec section 六/七/
 * 八 — the exact identifiers double as the visible category-label text via
 * CARGO_SUBTYPE_PRESETS below, so "不要依 Mesh 名稱反向判定種類": the
 * subtype IS the source of truth, the mesh is just built to match it). */
export type CargoSubtype =
  | 'small-box' | 'medium-box' | 'reinforced-box' | 'long-crate' | 'tall-crate'
  | 'flat-case' | 'wide-box' | 'handled-box'
  | 'wooden-barrel' | 'metal-drum' | 'fabric-roll' | 'spool'
  | 'large-crate' | 'large-long-crate' | 'large-tall-crate';

export interface CargoData {
  id: string;
  cargoType: CargoType;
  routeType: RouteType;
  /** Fixed at spawn (see CARGO_LABEL_PRESETS) — the player never edits this
   * this round (no labeling desk/UI exists anymore). Single source of
   * truth for both the on-mesh visual badges (cargo-label-visuals.ts) and
   * the departure judgment (cargo-compliance.ts only reads
   * routeType/cargoType directly, never this array — labels are for the
   * PLAYER to read, not for the system to re-derive rules from). Unrelated
   * to the daily-flow subtype label below — this array stays empty for all
   * daily cargo (spec "貨品外型與比例有更多變化" round 九: 不要加入國內/海外/
   * 易碎/冷凍/活物/地址/郵票 this round). */
  labels: CargoLabel[];
  displayName: string;
  dimensions: CargoDimensions;
  /** Daily-flow round only: set true once this item has spent >=0.5s stable
   * inside a docked vehicle's cargoBounds while already organized (see
   * vehicle-control-system.ts's per-frame shipment scan). Cleared back to
   * false if the player pulls it back out of the vehicle (spec "北側卸貨口/
   * 重新啟用呼叫載具" section 十三). Pre-existing cargo never sets this. */
  shipped: boolean;
  /** Which route's vehicle this item is currently shipped under — null
   * whenever `shipped` is false. Set alongside `shipped` so a later re-scan
   * always knows which pinned-cargo list (land/sea) to destroy the item
   * from once that route actually departs (spec 十三: "只能歸屬一台載具"). */
  shippedVehicleType: 'land' | 'sea' | null;
  /** Defaults to 'box' for every pre-existing cargo item (createCargoData
   * below never sets it) — only daily cargo (createDailyCargoData) sets
   * 'roller'/'large'. */
  shapeType: CargoShapeType;
  /** Daily-flow round only: set true once this item has spent >=0.5s
   * stable on its matching sorting fixture (pallet for box/large, rack for
   * roller — see pallet-system.ts / roller-rack-system.ts). Persists after
   * leaving the fixture. Pre-existing cargo never sets this; it stays false
   * and unused for anything not spawned via createDailyCargoData. */
  organized: boolean;
  /** Daily-flow round only: which exact silhouette this item is (null for
   * pre-existing non-daily cargo). Drives both the decorative mesh built at
   * spawn (cargo-visuals.ts decorateCargoMesh) and the visible category
   * label text (cargo-visuals.ts attachCargoSubtypeLabel) — see
   * CARGO_SUBTYPE_PRESETS. */
  subtype: CargoSubtype | null;
  /** Coarse size grouping for `subtype` — null for pre-existing cargo. */
  sizeClass: CargoSizeClass | null;
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
    shipped: false,
    shippedVehicleType: null,
    shapeType: 'box',
    organized: false,
    subtype: null,
    sizeClass: null,
  };
}

/** A named daily-flow cargo silhouette — the ONE place shape/size/label/
 * color are bound together for a given subtype (spec "貨品外型與比例有更多
 * 變化" round section八: "資料必須集中，不要依 Mesh 名稱反向判定種類").
 * cargo-system.ts's spawnDailyBox/spawnDailyRoller take one of these
 * directly rather than a raw size, so every daily cargo item is fully
 * described by picking a preset, never by hand-assembling dimensions. */
export interface CargoSubtypePreset {
  subtype: CargoSubtype;
  shapeType: CargoShapeType;
  sizeClass: CargoSizeClass;
  /** Visible category-label text (spec section九/十) — e.g. "小型方箱". */
  label: string;
  /** Base material color for the main mesh. Decoration accent colors are
   * derived from this in cargo-visuals.ts, not hand-picked per subtype. */
  color: number;
  /** Box/large: width/height/depth. Roller: width=depth=diameter,
   * height=length (same "tipped AABB" convention cargo-system.ts already
   * uses for roller cargo). */
  dimensions: CargoDimensions;
}

/** Box-class silhouettes (spec section六: "方箱類至少加入7種"；section七
 * gives the visual-style names folded in here rather than as separate
 * subtypes — e.g. reinforced-box IS the "木條加固箱" style at a
 * medium-large size). */
export const CARGO_BOX_PRESETS: Record<string, CargoSubtypePreset> = {
  smallBox: { subtype: 'small-box', shapeType: 'box', sizeClass: 'small', label: '小型方箱', color: 0x9a7a4a, dimensions: { width: 0.28, height: 0.26, depth: 0.28 } },
  mediumBox: { subtype: 'medium-box', shapeType: 'box', sizeClass: 'medium', label: '中型方箱', color: 0xa8824f, dimensions: { width: 0.42, height: 0.38, depth: 0.40 } },
  reinforcedBox: { subtype: 'reinforced-box', shapeType: 'box', sizeClass: 'medium', label: '加固木箱', color: 0x8a6a3a, dimensions: { width: 0.48, height: 0.46, depth: 0.46 } },
  longCrate: { subtype: 'long-crate', shapeType: 'box', sizeClass: 'medium', label: '長型貨箱', color: 0x93733f, dimensions: { width: 0.35, height: 0.32, depth: 0.78 } },
  tallCrate: { subtype: 'tall-crate', shapeType: 'box', sizeClass: 'medium', label: '高型貨箱', color: 0x8f7248, dimensions: { width: 0.36, height: 0.74, depth: 0.36 } },
  flatCase: { subtype: 'flat-case', shapeType: 'box', sizeClass: 'small', label: '扁平貨箱', color: 0x6b6b6b, dimensions: { width: 0.56, height: 0.18, depth: 0.38 } },
  wideBox: { subtype: 'wide-box', shapeType: 'box', sizeClass: 'medium', label: '寬型貨箱', color: 0xa07f4a, dimensions: { width: 0.64, height: 0.34, depth: 0.42 } },
  handledBox: { subtype: 'handled-box', shapeType: 'box', sizeClass: 'small', label: '提把貨箱', color: 0x9c7c48, dimensions: { width: 0.32, height: 0.30, depth: 0.34 } },
};

/** Roller-class silhouettes (spec section六: 至少4種). */
export const CARGO_ROLLER_PRESETS: Record<string, CargoSubtypePreset> = {
  woodenBarrel: { subtype: 'wooden-barrel', shapeType: 'roller', sizeClass: 'small', label: '木桶', color: 0x7a5730, dimensions: { width: 0.52, height: 0.40, depth: 0.40 } },
  metalDrum: { subtype: 'metal-drum', shapeType: 'roller', sizeClass: 'medium', label: '金屬桶', color: 0x6b7278, dimensions: { width: 0.50, height: 0.54, depth: 0.54 } },
  fabricRoll: { subtype: 'fabric-roll', shapeType: 'roller', sizeClass: 'medium', label: '布料捲', color: 0x8a5a6a, dimensions: { width: 0.88, height: 0.34, depth: 0.34 } },
  spool: { subtype: 'spool', shapeType: 'roller', sizeClass: 'small', label: '線軸貨物', color: 0x5a6a4a, dimensions: { width: 0.36, height: 0.50, depth: 0.50 } },
};

/** Large-class silhouettes (spec section六: 至少3種，最大約寬1.2-1.7／高
 * 1.0-1.6／深1.0-1.8m — kept toward the smaller end of that range so at
 * least the bigger land/sea vehicles can still take one, spec: "仍有機會放
 * 入目前載具貨艙"). */
export const CARGO_LARGE_PRESETS: Record<string, CargoSubtypePreset> = {
  largeCrate: { subtype: 'large-crate', shapeType: 'large', sizeClass: 'large', label: '大型木箱', color: 0x4a6fa5, dimensions: { width: 1.2, height: 1.0, depth: 1.2 } },
  largeLongCrate: { subtype: 'large-long-crate', shapeType: 'large', sizeClass: 'large', label: '大型長箱', color: 0x3f6193, dimensions: { width: 1.3, height: 1.05, depth: 1.7 } },
  largeTallCrate: { subtype: 'large-tall-crate', shapeType: 'large', sizeClass: 'extraLarge', label: '大型高箱', color: 0x5a4a8f, dimensions: { width: 1.15, height: 1.55, depth: 1.15 } },
};

export const CARGO_SUBTYPE_PRESETS: Record<string, CargoSubtypePreset> = {
  ...CARGO_BOX_PRESETS, ...CARGO_ROLLER_PRESETS, ...CARGO_LARGE_PRESETS,
};

/** Category label background color (spec section十: "顏色必須集中設定，不
 * 要散落在生成函式") — read by cargo-visuals.ts's label-badge builder. */
export const CARGO_CATEGORY_LABEL_BG: Record<CargoShapeType, string> = {
  box: 'rgba(120, 90, 45, 0.92)',
  roller: 'rgba(50, 88, 108, 0.92)',
  large: 'rgba(70, 55, 130, 0.92)',
};

/** Daily-flow round cargo (spec "每日貨品清空核心流程") — deliberately
 * bypasses CARGO_LABEL_PRESETS entirely: this round's boxes/rollers/large
 * items spawn with no domestic/overseas/fragile labels, no route/cargo-type
 * distinction the player needs to read (spec "不需要...載具相容性").
 * cargoType/routeType are still populated with harmless defaults so
 * CargoData stays a single consistent shape, but nothing this round reads
 * them for daily cargo — the real identity is `subtype`/`sizeClass`. */
export function createDailyCargoData(id: string, preset: CargoSubtypePreset): CargoData {
  return {
    id,
    cargoType: 'normal',
    routeType: 'domestic',
    labels: [],
    displayName: preset.label,
    dimensions: preset.dimensions,
    shipped: false,
    shippedVehicleType: null,
    shapeType: preset.shapeType,
    organized: false,
    subtype: preset.subtype,
    sizeClass: preset.sizeClass,
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
