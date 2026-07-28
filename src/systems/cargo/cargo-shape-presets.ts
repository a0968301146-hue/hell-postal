// Cargo shape presets — "Organize and expand cargo shape presets" round.
// Implements the Google Sheet "簡易_貨物型態限制" three-layer split:
//   CargoCategory (cargo-category-data.ts) x CargoSizeClass x CargoShapePreset
// A CargoShapePreset is the ONE place a specific silhouette's category,
// size, dimensions, physical behavior flags, and mesh/collider recipe are
// bound together — cargo-system.ts spawns cargo by picking a preset from
// here, the crosshair inspection UI reads preset.displayName, and the codex
// (codex-data.ts) lists these same presets — nobody hand-writes a second,
// divergent description of "what a 中型紙箱 is" anywhere else (spec 十:
// "圖鑑與生成池讀同一份 CargoShapePreset").
//
// Every preset declares EXACTLY one CargoCategory (spec一: "每件貨物只能有
//一個主要種類，不可同時是一般＋大型等複合分類") — there is no combinator
// that lets a preset claim two categories.
import { CargoCategory } from './cargo-category-data';

export type CargoSizeClass = 'small' | 'medium' | 'large';

export const CARGO_SIZE_CLASS_DISPLAY: Record<CargoSizeClass, string> = {
  small: '小型',
  medium: '中型',
  large: '大型',
};

export interface CargoDimensions {
  width: number;
  height: number;
  depth: number;
}

/** Which mesh-factory branch (cargo-visuals.ts buildShapePresetMesh) builds
 * this preset's silhouette. Deliberately far more granular than the old
 * CargoSubtype union (spec四: "每種 preset 必須在輪廓上有差異，不可只是同一個
 * 方塊換顏色/換文字/放大縮小") — every value maps to a visibly distinct
 * shape recipe, even where several share the same base parts (planks, metal
 * bands, rope, bottles — spec四: "可以共用零件，但每個外型需由不同組合與比例
 * 形成"). */
export type CargoVisualKind =
  | 'closed-box' | 'closed-box-fragile'
  | 'barrel' | 'spool'
  | 'hollow-crate-potion' | 'hollow-crate-milk' | 'hollow-crate-alchemy'
  | 'hollow-crate-lamp' | 'hollow-crate-ceramic' | 'hollow-crate-perfume'
  | 'large-crate' | 'carpet-roll' | 'furniture-rack' | 'statue-rack'
  | 'ore-crate' | 'timber-bundle'
  | 'frost-crate' | 'frost-crate-fish' | 'frost-metal-box' | 'frost-herb-box'
  | 'cage';

/** Which physics collider shape this preset uses (spec四: "Collider優先簡化"
 * — cuboid for everything except barrel/spool, which stay true rolling
 * cylinders exactly like before). No compound colliders are introduced for
 * any of the new large/cage/frost silhouettes — every decorative part
 * (planks, bars, ropes, bottles, ice shards, ...) is a plain visual child
 * with no collider of its own (spec四: "不要為裝飾物建立大量 Collider"). */
export type CargoColliderKind = 'box' | 'cylinder';

export interface CargoShapePreset {
  id: string;
  displayName: string;
  category: CargoCategory;
  sizeClass: CargoSizeClass;
  dimensions: CargoDimensions;
  /** Documentation/Unity-port metadata only (spec一) — does NOT drive the
   * Rapier collider density, which stays the existing fixed value for every
   * daily cargo item (cargo-system.ts) so this round never changes how any
   * EXISTING item's throw/carry physics feels. */
  mass: number;
  stackable: boolean;
  throwable: boolean;
  /** Documentation/codex metadata (spec八 "是否可放托盤") — the actual
   * runtime "can this rest stably pinned on the 整理托盤" rule stays
   * whatever pallet-system.ts already computes from the derived legacy
   * shapeType (box/large both qualify there, unchanged since before this
   * round — see cargo-data.ts's deriveLegacyShapeType) so today's daily-flow
   * organizing step for existing large cargo keeps working exactly as
   * before (round goal: "不改變目前每日流程"). Live cages get their own
   * distinct shapeType('cage'), which naturally fails that pre-existing
   * check with zero changes to pallet-system.ts. */
  palletAllowed: boolean;
  /** Live cages only (spec E: "生成與放置時保持正向") — cargo-system.ts
   * locks X/Z rotation on spawn so tumbling unload-burst physics can never
   * land one upside down. */
  uprightRequired: boolean;
  /** Relative weight for the within-category weighted-random pick (spec五:
   * "同一種類內的外型採權重隨機"). Uniform (1) across every confirmed preset
   * this round — the mechanism supports future tuning without code changes. */
  spawnWeight: number;
  visualKind: CargoVisualKind;
  colliderKind: CargoColliderKind;
  /** Base material color for the main mesh — decoration accent colors are
   * derived from this in cargo-visuals.ts, not hand-picked per preset. */
  color: number;
}

// --- A. Normal (4 confirmed) -------------------------------------------

export const NORMAL_CARGO_SHAPE_PRESETS: CargoShapePreset[] = [
  {
    id: 'small-box', displayName: '小型紙箱', category: 'normal', sizeClass: 'small',
    dimensions: { width: 0.28, height: 0.26, depth: 0.28 }, mass: 4, stackable: true, throwable: true,
    palletAllowed: true, uprightRequired: false, spawnWeight: 1, visualKind: 'closed-box', colliderKind: 'box', color: 0x9a7a4a,
  },
  {
    // Dimensions MUST stay exactly {0.42, 0.38, 0.40} — mail-layout-data.ts's
    // MAIL_BAG_EXTERIOR reads this exact preset's dimensions (see
    // cargo-data.ts's MEDIUM_BOX_DIMENSIONS compat export) as the mail bag's
    // own base size; changing this number would silently resize mail bags,
    // which is explicitly out of scope for this round.
    id: 'medium-box', displayName: '中型紙箱', category: 'normal', sizeClass: 'medium',
    dimensions: { width: 0.42, height: 0.38, depth: 0.40 }, mass: 8, stackable: true, throwable: true,
    palletAllowed: true, uprightRequired: false, spawnWeight: 1, visualKind: 'closed-box', colliderKind: 'box', color: 0xa8824f,
  },
  {
    id: 'wooden-barrel', displayName: '木桶', category: 'normal', sizeClass: 'medium',
    // width=length along roll axis, height=depth=diameter (roller convention).
    dimensions: { width: 0.52, height: 0.40, depth: 0.40 }, mass: 10, stackable: false, throwable: true,
    palletAllowed: false, uprightRequired: false, spawnWeight: 1, visualKind: 'barrel', colliderKind: 'cylinder', color: 0x7a5730,
  },
  {
    id: 'spool', displayName: '線軸貨物', category: 'normal', sizeClass: 'medium',
    dimensions: { width: 0.36, height: 0.50, depth: 0.50 }, mass: 9, stackable: false, throwable: true,
    palletAllowed: false, uprightRequired: false, spawnWeight: 1, visualKind: 'spool', colliderKind: 'cylinder', color: 0x5a6a4a,
  },
];

// --- B. Fragile (8 confirmed) -------------------------------------------

export const FRAGILE_CARGO_SHAPE_PRESETS: CargoShapePreset[] = [
  {
    id: 'small-fragile-box', displayName: '小型易碎紙箱', category: 'fragile', sizeClass: 'small',
    dimensions: { width: 0.26, height: 0.24, depth: 0.26 }, mass: 3, stackable: true, throwable: false,
    palletAllowed: true, uprightRequired: false, spawnWeight: 1, visualKind: 'closed-box-fragile', colliderKind: 'box', color: 0xb8b0a0,
  },
  {
    id: 'medium-fragile-box', displayName: '中型易碎紙箱', category: 'fragile', sizeClass: 'medium',
    dimensions: { width: 0.40, height: 0.36, depth: 0.38 }, mass: 6, stackable: true, throwable: false,
    palletAllowed: true, uprightRequired: false, spawnWeight: 1, visualKind: 'closed-box-fragile', colliderKind: 'box', color: 0xb0a890,
  },
  {
    id: 'potion-crate', displayName: '魔法藥劑瓶木箱', category: 'fragile', sizeClass: 'medium',
    dimensions: { width: 0.34, height: 0.36, depth: 0.34 }, mass: 7, stackable: true, throwable: false,
    palletAllowed: true, uprightRequired: false, spawnWeight: 1, visualKind: 'hollow-crate-potion', colliderKind: 'box', color: 0x8a6a3a,
  },
  {
    id: 'milk-bottle-crate', displayName: '牛奶玻璃瓶木箱', category: 'fragile', sizeClass: 'medium',
    dimensions: { width: 0.36, height: 0.34, depth: 0.36 }, mass: 7, stackable: true, throwable: false,
    palletAllowed: true, uprightRequired: false, spawnWeight: 1, visualKind: 'hollow-crate-milk', colliderKind: 'box', color: 0x8f7248,
  },
  {
    id: 'alchemy-glassware-crate', displayName: '煉金玻璃器皿木箱', category: 'fragile', sizeClass: 'medium',
    dimensions: { width: 0.38, height: 0.38, depth: 0.34 }, mass: 7, stackable: true, throwable: false,
    palletAllowed: true, uprightRequired: false, spawnWeight: 1, visualKind: 'hollow-crate-alchemy', colliderKind: 'box', color: 0x7a5f3a,
  },
  {
    id: 'magic-lamp-crate', displayName: '魔法玻璃燈木箱', category: 'fragile', sizeClass: 'medium',
    dimensions: { width: 0.34, height: 0.42, depth: 0.34 }, mass: 7, stackable: true, throwable: false,
    palletAllowed: true, uprightRequired: false, spawnWeight: 1, visualKind: 'hollow-crate-lamp', colliderKind: 'box', color: 0x8a6a3a,
  },
  {
    id: 'ceramic-crate', displayName: '陶瓷器皿木箱', category: 'fragile', sizeClass: 'medium',
    dimensions: { width: 0.38, height: 0.32, depth: 0.38 }, mass: 7, stackable: true, throwable: false,
    palletAllowed: true, uprightRequired: false, spawnWeight: 1, visualKind: 'hollow-crate-ceramic', colliderKind: 'box', color: 0x93733f,
  },
  {
    id: 'perfume-crate', displayName: '香水／魔法精油瓶木箱', category: 'fragile', sizeClass: 'small',
    dimensions: { width: 0.26, height: 0.24, depth: 0.24 }, mass: 4, stackable: true, throwable: false,
    palletAllowed: true, uprightRequired: false, spawnWeight: 1, visualKind: 'hollow-crate-perfume', colliderKind: 'box', color: 0x9c7c48,
  },
];

// --- C. Large (6 confirmed) -----------------------------------------------

export const LARGE_CARGO_SHAPE_PRESETS: CargoShapePreset[] = [
  {
    id: 'large-crate', displayName: '大型木箱', category: 'large', sizeClass: 'large',
    dimensions: { width: 1.2, height: 1.0, depth: 1.2 }, mass: 45, stackable: false, throwable: false,
    palletAllowed: false, uprightRequired: false, spawnWeight: 1, visualKind: 'large-crate', colliderKind: 'box', color: 0x4a6fa5,
  },
  {
    id: 'carpet-roll', displayName: '地毯捲', category: 'large', sizeClass: 'large',
    dimensions: { width: 0.55, height: 0.55, depth: 1.6 }, mass: 30, stackable: false, throwable: false,
    palletAllowed: false, uprightRequired: false, spawnWeight: 1, visualKind: 'carpet-roll', colliderKind: 'box', color: 0x9a4a4a,
  },
  {
    id: 'furniture-rack', displayName: '家具搬運木架', category: 'large', sizeClass: 'large',
    dimensions: { width: 1.1, height: 1.3, depth: 0.85 }, mass: 50, stackable: false, throwable: false,
    palletAllowed: false, uprightRequired: false, spawnWeight: 1, visualKind: 'furniture-rack', colliderKind: 'box', color: 0x6a5030,
  },
  {
    id: 'statue-rack', displayName: '石像運輸木架', category: 'large', sizeClass: 'large',
    dimensions: { width: 0.9, height: 1.6, depth: 0.9 }, mass: 60, stackable: false, throwable: false,
    palletAllowed: false, uprightRequired: false, spawnWeight: 1, visualKind: 'statue-rack', colliderKind: 'box', color: 0x8a8378,
  },
  {
    id: 'ore-crate', displayName: '巨型魔法礦石箱', category: 'large', sizeClass: 'large',
    dimensions: { width: 1.5, height: 0.7, depth: 1.3 }, mass: 70, stackable: false, throwable: false,
    palletAllowed: false, uprightRequired: false, spawnWeight: 1, visualKind: 'ore-crate', colliderKind: 'box', color: 0x5a4a8f,
  },
  {
    id: 'timber-bundle', displayName: '長型魔法木材束', category: 'large', sizeClass: 'large',
    dimensions: { width: 0.5, height: 0.5, depth: 1.8 }, mass: 40, stackable: false, throwable: false,
    palletAllowed: false, uprightRequired: false, spawnWeight: 1, visualKind: 'timber-bundle', colliderKind: 'box', color: 0x3f6193,
  },
];

// --- D. Cold / frozen (4 confirmed) ----------------------------------------

export const FROZEN_CARGO_SHAPE_PRESETS: CargoShapePreset[] = [
  {
    id: 'ice-cooler-crate', displayName: '冰晶保冷木箱', category: 'frozen', sizeClass: 'medium',
    dimensions: { width: 0.38, height: 0.36, depth: 0.38 }, mass: 9, stackable: true, throwable: false,
    palletAllowed: true, uprightRequired: false, spawnWeight: 1, visualKind: 'frost-crate', colliderKind: 'box', color: 0x9fc3d9,
  },
  {
    id: 'frozen-fish-crate', displayName: '冷凍魚貨木箱', category: 'frozen', sizeClass: 'medium',
    dimensions: { width: 0.34, height: 0.30, depth: 0.52 }, mass: 10, stackable: true, throwable: false,
    palletAllowed: true, uprightRequired: false, spawnWeight: 1, visualKind: 'frost-crate-fish', colliderKind: 'box', color: 0x8fb8d0,
  },
  {
    id: 'frost-metal-box', displayName: '霜封金屬箱', category: 'frozen', sizeClass: 'medium',
    dimensions: { width: 0.40, height: 0.36, depth: 0.38 }, mass: 12, stackable: true, throwable: false,
    palletAllowed: true, uprightRequired: false, spawnWeight: 1, visualKind: 'frost-metal-box', colliderKind: 'box', color: 0x8a97a0,
  },
  {
    id: 'frozen-herb-box', displayName: '冷凍藥草箱', category: 'frozen', sizeClass: 'small',
    dimensions: { width: 0.26, height: 0.24, depth: 0.26 }, mass: 4, stackable: true, throwable: false,
    palletAllowed: true, uprightRequired: false, spawnWeight: 1, visualKind: 'frost-herb-box', colliderKind: 'box', color: 0x7fae8a,
  },
];

// --- E. Live (4 confirmed) --------------------------------------------

export const LIVE_CARGO_SHAPE_PRESETS: CargoShapePreset[] = [
  {
    id: 'standard-cage', displayName: '標準活物鐵籠', category: 'live', sizeClass: 'medium',
    dimensions: { width: 0.44, height: 0.44, depth: 0.44 }, mass: 14, stackable: false, throwable: false,
    palletAllowed: false, uprightRequired: true, spawnWeight: 1, visualKind: 'cage', colliderKind: 'box', color: 0x707070,
  },
  {
    id: 'small-cage', displayName: '小型活物鐵籠', category: 'live', sizeClass: 'small',
    dimensions: { width: 0.30, height: 0.30, depth: 0.30 }, mass: 8, stackable: false, throwable: false,
    palletAllowed: false, uprightRequired: true, spawnWeight: 1, visualKind: 'cage', colliderKind: 'box', color: 0x707070,
  },
  {
    id: 'tall-cage', displayName: '高型活物鐵籠', category: 'live', sizeClass: 'medium',
    dimensions: { width: 0.36, height: 0.62, depth: 0.36 }, mass: 16, stackable: false, throwable: false,
    palletAllowed: false, uprightRequired: true, spawnWeight: 1, visualKind: 'cage', colliderKind: 'box', color: 0x707070,
  },
  {
    id: 'wide-cage', displayName: '寬型活物鐵籠', category: 'live', sizeClass: 'medium',
    dimensions: { width: 0.60, height: 0.36, depth: 0.42 }, mass: 16, stackable: false, throwable: false,
    palletAllowed: false, uprightRequired: true, spawnWeight: 1, visualKind: 'cage', colliderKind: 'box', color: 0x707070,
  },
];

/** The FULL confirmed generation pool (spec二: "只製作以下「已確認」型態") —
 * cargo-system.ts / unloading-system.ts only ever pick from here. */
export const CARGO_SHAPE_PRESETS: CargoShapePreset[] = [
  ...NORMAL_CARGO_SHAPE_PRESETS,
  ...FRAGILE_CARGO_SHAPE_PRESETS,
  ...LARGE_CARGO_SHAPE_PRESETS,
  ...FROZEN_CARGO_SHAPE_PRESETS,
  ...LIVE_CARGO_SHAPE_PRESETS,
];

const PRESETS_BY_CATEGORY: Record<CargoCategory, CargoShapePreset[]> = {
  normal: NORMAL_CARGO_SHAPE_PRESETS,
  fragile: FRAGILE_CARGO_SHAPE_PRESETS,
  large: LARGE_CARGO_SHAPE_PRESETS,
  frozen: FROZEN_CARGO_SHAPE_PRESETS,
  live: LIVE_CARGO_SHAPE_PRESETS,
};

export function getCargoShapePresetsByCategory(category: CargoCategory): CargoShapePreset[] {
  return PRESETS_BY_CATEGORY[category];
}

export function getCargoShapePreset(id: string): CargoShapePreset | undefined {
  return CARGO_SHAPE_PRESETS.find((p) => p.id === id);
}

/** Weighted-random pick within one category's confirmed preset list (spec
 * 五: "同一種類內的外型採權重隨機，避免一天90件全部生成同一種外觀" — with
 * every confirmed preset's spawnWeight currently equal, this reduces to a
 * uniform pick, but the mechanism itself is genuinely weighted so a future
 * rarity tweak needs no code change here). */
export function pickWeightedCargoShapePreset(category: CargoCategory): CargoShapePreset {
  const presets = PRESETS_BY_CATEGORY[category];
  const totalWeight = presets.reduce((sum, p) => sum + p.spawnWeight, 0);
  let roll = Math.random() * totalWeight;
  for (const p of presets) {
    roll -= p.spawnWeight;
    if (roll <= 0) return p;
  }
  return presets[presets.length - 1];
}

/** NOT part of the generation pool (spec五: "暫不進正式生成池...保留在資料
 * 註解或 future presets，不得生成") — kept only as a documented placeholder
 * list for future rounds. Nothing in cargo-system.ts / unloading-system.ts
 * reads this array; it exists purely so the reserved silhouettes' intended
 * category/size aren't lost between rounds. Deliberately typed as a plain
 * partial description (not a full CargoShapePreset) so it can never
 * accidentally be spread into CARGO_SHAPE_PRESETS and start generating. */
export const RESERVED_CARGO_SHAPE_NOTES: { displayName: string; category: CargoCategory; note: string }[] = [
  { displayName: '金屬桶', category: 'normal', note: '保留：normal roller 變體，暫不生成' },
  { displayName: '布料捲筒', category: 'normal', note: '保留：normal roller 變體，暫不生成' },
  { displayName: '魔法原料筒', category: 'normal', note: '保留：normal roller 變體，暫不生成' },
];
