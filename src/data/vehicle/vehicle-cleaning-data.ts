// "載具夜間清潔互動" round — plain data only (matches this codebase's own
// established "data file, system reads it" convention: vehicle-data.ts/
// vehicle-dock-data.ts are the identical precedent for vehicle-control-
// system.ts itself). Reuses the SAME six real VehicleConfig ids
// vehicle-data.ts already defines (spec二十四: "工具ID如果現有系統已有對應名
// 稱，請沿用...不要建立重複工具系統") — no second vehicle roster.
//
// Cleaning TOOLS are deliberately NOT added to core/game-state.ts's own
// `ActiveTool` union or wired into ToolSystem/the hotbar/day-unlock-data.ts
// (spec二十五: "不要自行發明新的遊戲工具模型"; spec二十四's own kraken note:
// "先建立工具需求資料欄位/插槽即可") — `CleaningToolId` below is a small,
// self-contained id set read only by vehicle-night-cleaning-system.ts's own
// dedicated tool-select UI, entirely independent of the player's real
// carried-item/hotbar state. This keeps the whole feature additive: nothing
// in tool-system.ts, game-state.ts, or the hotbar UI needs to change.
import { VehicleConfig, LAND_VEHICLE_CONFIGS, SEA_VEHICLE_CONFIGS } from '../../systems/vehicle/vehicle-data';

export type CleaningToolId = 'brush' | 'waterJet' | 'waxTool' | 'cloth' | 'shovel' | 'tentacleBrush';

export const CLEANING_TOOL_LABELS: Record<CleaningToolId, string> = {
  brush: '刷子',
  waterJet: '強力水柱',
  waxTool: '打蠟工具',
  cloth: '布',
  shovel: '鏟子',
  tentacleBrush: '觸手清潔工具',
};

/** One CANDIDATE cleaning spot on a vehicle's body (spec六/九) — `position`
 * is a LOCAL offset added to the vehicle's own `vehicleGroup.position`
 * (mirrors CargoBayBounds' own "relative to vehicleGroup" convention in
 * vehicle-system.ts), so a marker/collider built from this never needs to
 * know the vehicle's own world position or rotation logic itself. Never
 * placed by hand as raw numbers — see `buildPoints` below — so retuning a
 * vehicle's own footprint later automatically keeps every point sitting on
 * its (possibly resized) body instead of floating off it. */
export interface CleaningPointDefinition {
  id: string;
  position: { x: number; y: number; z: number };
  label?: string;
}

export interface VehicleCleaningDefinition {
  vehicleId: string;
  toolId: CleaningToolId;
  cleaningTarget: string;
  /** Exactly 10 candidates (spec六: "最多10個可清潔位置") — the NIGHTLY
   * random draw of 4-5 (vehicle-night-cleaning-system.ts's own
   * pickNightlyCleaningPoints) always samples from this fixed pool, never
   * regenerates it. */
  cleaningPoints: CleaningPointDefinition[];
}

const ALL_VEHICLE_CONFIGS: VehicleConfig[] = [...LAND_VEHICLE_CONFIGS, ...SEA_VEHICLE_CONFIGS];

function getVehicleConfig(vehicleId: string): VehicleConfig {
  const config = ALL_VEHICLE_CONFIGS.find((c) => c.id === vehicleId);
  if (!config) throw new Error(`vehicle-cleaning-data: no VehicleConfig for "${vehicleId}"`);
  return config;
}

/** Resolves a (lateral, longitudinal, height) fraction triple into a real
 * local {x,y,z} offset, honoring each VehicleConfig's own `axis` field
 * (vehicle-data.ts: axis 'z'/undefined = length runs along world Z, width
 * along X — land vehicles; axis 'x' = the whole layout is rotated 90°,
 * length along X, width along Z — sea vehicles). Fractions are in -1..1
 * (lateral/longitudinal, relative to each half-extent) and 0..1 (height,
 * relative to the full chassis height) — this is what lets a single spread
 * pattern below work correctly for both axis conventions without the
 * caller needing to know which one a given vehicle uses. */
function axisOffset(config: VehicleConfig, lateralFrac: number, longitudinalFrac: number, heightFrac: number) {
  const halfLateral = (config.width / 2) * lateralFrac;
  const halfLongitudinal = (config.length / 2) * longitudinalFrac;
  const y = config.height * heightFrac;
  return config.axis === 'x'
    ? { x: halfLongitudinal, y, z: halfLateral }
    : { x: halfLateral, y, z: halfLongitudinal };
}

/** Builds this vehicle's own 10 candidate points from a list of (lateral,
 * longitudinal, height, label) spreads — kept as short fraction tuples
 * rather than 10 raw world-offset literals per vehicle, so the actual
 * spread pattern is easy to read/re-tune per vehicle (spec: "讓未來可以很容
 * 易調整位置"). */
function buildPoints(
  vehicleId: string, config: VehicleConfig,
  spreads: [lateral: number, longitudinal: number, height: number, label: string][]
): CleaningPointDefinition[] {
  return spreads.map(([lateral, longitudinal, height, label], i) => ({
    id: `${vehicleId}-clean-${String(i + 1).padStart(2, '0')}`,
    position: axisOffset(config, lateral, longitudinal, height),
    label,
  }));
}

const FROG_CONFIG = getVehicleConfig('land-frog-01');
const ROCKGIANT_CONFIG = getVehicleConfig('land-rockgiant-01');
const SNAIL_CONFIG = getVehicleConfig('land-snail-01');
const RAY_CONFIG = getVehicleConfig('sea-ray-01');
const TURTLE_CONFIG = getVehicleConfig('sea-turtle-01');
const KRAKEN_CONFIG = getVehicleConfig('sea-kraken-01');

export const VEHICLE_CLEANING_DEFINITIONS: Record<string, VehicleCleaningDefinition> = {
  // 青蛙 — 幫牠清潔嘴巴 (spec五1): 10 candidates clustered around the FRONT
  // (mouth/basin) end, matching "嘴巴" being one specific feature rather
  // than the whole body.
  'land-frog-01': {
    vehicleId: 'land-frog-01',
    toolId: 'brush',
    cleaningTarget: '嘴巴',
    cleaningPoints: buildPoints('frog', FROG_CONFIG, [
      [-0.5, -0.85, 0.55, '嘴角左側'], [0.5, -0.85, 0.55, '嘴角右側'],
      [0, -0.95, 0.7, '上唇'], [0, -0.9, 0.35, '下唇'],
      [-0.3, -0.75, 0.5, '牙齒左側'], [0.3, -0.75, 0.5, '牙齒右側'],
      [0, -0.8, 0.85, '鼻頭'], [-0.6, -0.6, 0.6, '左臉頰'],
      [0.6, -0.6, 0.6, '右臉頰'], [0, -1.0, 0.5, '嘴巴中央'],
    ]),
  },
  // 石頭巨人 — 清除身上的青苔 (spec五2): moss can grow anywhere on a stone
  // body, so candidates spread evenly across the whole chassis surface.
  'land-rockgiant-01': {
    vehicleId: 'land-rockgiant-01',
    toolId: 'waterJet',
    cleaningTarget: '青苔',
    cleaningPoints: buildPoints('golem', ROCKGIANT_CONFIG, [
      [-0.7, -0.6, 0.75, '左肩'], [0.7, -0.6, 0.75, '右肩'],
      [-0.7, 0, 0.55, '左側身'], [0.7, 0, 0.55, '右側身'],
      [-0.6, 0.6, 0.4, '左腳邊'], [0.6, 0.6, 0.4, '右腳邊'],
      [0, -0.8, 0.9, '頭頂'], [0, 0, 0.95, '背部中央'],
      [-0.3, 0.3, 0.2, '左下方'], [0.3, 0.3, 0.2, '右下方'],
    ]),
  },
  // 蝸牛 — 幫牠的殼打蠟 (spec五3): candidates spread across the (assumed
  // dome-shaped, high) shell area — the top/back half of the chassis.
  'land-snail-01': {
    vehicleId: 'land-snail-01',
    toolId: 'waxTool',
    cleaningTarget: '殼',
    cleaningPoints: buildPoints('snail', SNAIL_CONFIG, [
      [0, 0.5, 0.9, '殼頂'], [-0.4, 0.6, 0.75, '殼左上'],
      [0.4, 0.6, 0.75, '殼右上'], [-0.5, 0.3, 0.6, '殼左側'],
      [0.5, 0.3, 0.6, '殼右側'], [0, 0.7, 0.5, '殼後方'],
      [-0.3, 0.2, 0.85, '殼中央左'], [0.3, 0.2, 0.85, '殼中央右'],
      [0, 0.3, 0.95, '殼最高點'], [0, 0.5, 0.4, '殼底緣'],
    ]),
  },
  // 魟魚 — 擦拭背部 (spec五4): candidates spread across the top (back)
  // surface only.
  'sea-ray-01': {
    vehicleId: 'sea-ray-01',
    toolId: 'cloth',
    cleaningTarget: '背部',
    cleaningPoints: buildPoints('ray', RAY_CONFIG, [
      [0, -0.6, 0.9, '背部前方'], [0, 0, 0.95, '背部中央'],
      [0, 0.6, 0.9, '背部後方'], [-0.5, -0.3, 0.85, '背部左前'],
      [0.5, -0.3, 0.85, '背部右前'], [-0.5, 0.3, 0.85, '背部左後'],
      [0.5, 0.3, 0.85, '背部右後'], [-0.7, 0, 0.8, '左翼緣'],
      [0.7, 0, 0.8, '右翼緣'], [0, 0, 1.0, '背鰭附近'],
    ]),
  },
  // 海龜 — 清理背上的藤壺 (spec五5): candidates spread across the whole
  // shell surface (barnacles cluster anywhere on a broad shell).
  'sea-turtle-01': {
    vehicleId: 'sea-turtle-01',
    toolId: 'shovel',
    cleaningTarget: '藤壺',
    cleaningPoints: buildPoints('turtle', TURTLE_CONFIG, [
      [0, -0.6, 0.9, '殼前緣'], [0, 0.6, 0.9, '殼後緣'],
      [-0.6, 0, 0.85, '殼左側'], [0.6, 0, 0.85, '殼右側'],
      [-0.4, -0.4, 0.95, '殼左前'], [0.4, -0.4, 0.95, '殼右前'],
      [-0.4, 0.4, 0.95, '殼左後'], [0.4, 0.4, 0.95, '殼右後'],
      [0, 0, 1.0, '殼頂中央'], [0, 0, 0.6, '殼邊緣下方'],
    ]),
  },
  // 克拉肯 — 清理觸手 (spec五6): candidates spread low/around the sides,
  // matching tentacles trailing off the body rather than sitting on top.
  'sea-kraken-01': {
    vehicleId: 'sea-kraken-01',
    toolId: 'tentacleBrush',
    cleaningTarget: '觸手',
    cleaningPoints: buildPoints('kraken', KRAKEN_CONFIG, [
      [-0.8, -0.5, 0.3, '左前觸手'], [0.8, -0.5, 0.3, '右前觸手'],
      [-0.8, 0, 0.25, '左側觸手'], [0.8, 0, 0.25, '右側觸手'],
      [-0.8, 0.5, 0.3, '左後觸手'], [0.8, 0.5, 0.3, '右後觸手'],
      [-0.5, -0.7, 0.2, '前方觸手根部'], [0.5, -0.7, 0.2, '前方觸手根部'],
      [-0.5, 0.7, 0.2, '後方觸手根部'], [0.5, 0.7, 0.2, '後方觸手根部'],
    ]),
  },
};

// Module-load sanity check — every entry must have exactly 10 candidates
// (spec六), mirroring this codebase's own established "throw at import time
// on a data-authoring mistake" convention (e.g. stamp-collection-data.ts's
// own per-region count check).
for (const def of Object.values(VEHICLE_CLEANING_DEFINITIONS)) {
  if (def.cleaningPoints.length !== 10) {
    throw new Error(`vehicle-cleaning-data: "${def.vehicleId}" has ${def.cleaningPoints.length} candidate points, expected 10`);
  }
}

export function getVehicleCleaningDefinition(vehicleId: string): VehicleCleaningDefinition | undefined {
  return VEHICLE_CLEANING_DEFINITIONS[vehicleId];
}

/** Fisher-Yates shuffle + take-first-N — the "不重複抽取" requirement
 * (spec七) falls out naturally from shuffling the whole 10-item pool once
 * and slicing, rather than repeatedly rolling a random index and checking
 * for collisions. */
function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Tonight's actual cleaning points for one vehicle (spec七) — 4 or 5,
 * picked uniformly, then that many DISTINCT points drawn from the fixed
 * 10-candidate pool. Never mutates VEHICLE_CLEANING_DEFINITIONS itself. */
export function pickNightlyCleaningPoints(vehicleId: string): CleaningPointDefinition[] {
  const def = getVehicleCleaningDefinition(vehicleId);
  if (!def) return [];
  const count = Math.random() < 0.5 ? 4 : 5;
  return shuffle(def.cleaningPoints).slice(0, count);
}
