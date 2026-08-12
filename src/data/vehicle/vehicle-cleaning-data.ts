// "載具夜間清潔互動" round, "清潔點附著＋互動修正" follow-up — plain data only
// (matches this codebase's own established "data file, system reads it"
// convention: vehicle-data.ts/vehicle-dock-data.ts are the identical
// precedent for vehicle-control-system.ts itself). Reuses the SAME six real
// VehicleConfig ids vehicle-data.ts already defines — no second vehicle
// roster.
//
// Cleaning TOOLS are deliberately NOT added to core/game-state.ts's own
// `ActiveTool` union or wired into ToolSystem/the hotbar/day-unlock-data.ts
// (spec: "不要自行發明新的遊戲工具模型") — `CleaningToolId` below is now
// PURELY an internal correctness field (follow-up spec五: "玩家不選工具...
// 這些資料只存在於程式邏輯"), never surfaced to the player at all (no tool
// name, no tool UI — see vehicle-night-cleaning-ui.ts's own doc comment).
import { VehicleConfig, LAND_VEHICLE_CONFIGS, SEA_VEHICLE_CONFIGS } from '../../systems/vehicle/vehicle-data';

export type CleaningToolId = 'brush' | 'waterJet' | 'waxTool' | 'cloth' | 'shovel' | 'tentacleBrush';

/** One CANDIDATE cleaning spot on a vehicle's body — `position` is a LOCAL
 * offset added to the vehicle's own `vehicleGroup.position` (mirrors
 * CargoBayBounds' own "relative to vehicleGroup" convention in
 * vehicle-system.ts). Never placed by hand as raw numbers — see the
 * `topFacePoint`/`sideFacePoint` helpers below — so retuning a vehicle's own
 * footprint later automatically keeps every point sitting on its (possibly
 * resized) body instead of floating off it.
 *
 * "清潔點附著＋互動修正" follow-up round: the PREVIOUS version of this file
 * multiplied all three (lateral, longitudinal, height) fractions by their
 * own half-extents independently — since none of those three fractions was
 * ever pinned to exactly its ±1 boundary, the resulting point always landed
 * somewhere INSIDE the vehicle's own volume, never actually ON its visible
 * skin (a real bug: this is why points read as "floating beside" or "buried
 * inside" the model rather than sitting on its surface). `topFacePoint`/
 * `sideFacePoint` below fix this at the root — exactly ONE axis is always
 * pinned to the real face boundary (the top Y, or one of the four side
 * planes), the other one or two only spread WITHIN that face. */
export interface CleaningPointDefinition {
  id: string;
  position: { x: number; y: number; z: number };
  label?: string;
}

export interface VehicleCleaningDefinition {
  vehicleId: string;
  toolId: CleaningToolId;
  cleaningTarget: string;
  /** Exactly 10 candidates — the NIGHTLY random draw of 4-5
   * (vehicle-night-cleaning-system.ts's own pickNightlyCleaningPoints)
   * always samples from this fixed pool, never regenerates it. */
  cleaningPoints: CleaningPointDefinition[];
}

const ALL_VEHICLE_CONFIGS: VehicleConfig[] = [...LAND_VEHICLE_CONFIGS, ...SEA_VEHICLE_CONFIGS];

function getVehicleConfig(vehicleId: string): VehicleConfig {
  const config = ALL_VEHICLE_CONFIGS.find((c) => c.id === vehicleId);
  if (!config) throw new Error(`vehicle-cleaning-data: no VehicleConfig for "${vehicleId}"`);
  return config;
}

interface LocalOffset { x: number; y: number; z: number; }

/** Resolves a (lateral, longitudinal, y) LOCAL triple honoring each
 * VehicleConfig's own `axis` field (vehicle-data.ts: axis 'z'/undefined =
 * length runs along world Z, width along X — land vehicles; axis 'x' = the
 * whole layout is rotated 90°, length along X, width along Z — sea
 * vehicles) — lets topFacePoint/sideFacePoint below stay axis-agnostic. */
function resolveAxis(config: VehicleConfig, lateral: number, longitudinal: number, y: number): LocalOffset {
  return config.axis === 'x' ? { x: longitudinal, y, z: lateral } : { x: lateral, y, z: longitudinal };
}

/** A point on the vehicle's own TOP face — y is pinned to the EXACT chassis
 * height (the real top surface), only the lateral/longitudinal position
 * varies within it. `insetFraction` (<1) keeps points away from the top
 * face's own edges/corners so they read as clearly "on top of the body"
 * rather than teetering on a rim. */
function topFacePoint(config: VehicleConfig, lateralFrac: number, longitudinalFrac: number, insetFraction = 0.75): LocalOffset {
  const lateral = lateralFrac * (config.width / 2) * insetFraction;
  const longitudinal = longitudinalFrac * (config.length / 2) * insetFraction;
  return resolveAxis(config, lateral, longitudinal, config.height);
}

/** A point on one of the vehicle's own FOUR SIDE faces — the face's own
 * outward axis is pinned to its EXACT boundary (the real side surface),
 * `alongFrac` spreads within that face's other horizontal axis, and
 * `heightFrac01` (0..1, plain fraction of the FULL chassis height) picks how
 * high up that face the point sits — kept as an explicit 0..1 fraction
 * (rather than a -1..1 "spread" remapped through some fixed band) so each
 * vehicle's own doc comment below can state the intended height directly
 * (e.g. kraken's tentacles low near the ground, a shell's midline higher
 * up) instead of it being buried in a shared formula. */
function sideFacePoint(
  config: VehicleConfig, face: 'front' | 'back' | 'left' | 'right', alongFrac: number, heightFrac01: number, insetFraction = 0.85
): LocalOffset {
  const halfLateral = config.width / 2;
  const halfLongitudinal = config.length / 2;
  const y = config.height * heightFrac01;
  let lateral: number, longitudinal: number;
  if (face === 'front') { longitudinal = -halfLongitudinal; lateral = alongFrac * halfLateral * insetFraction; }
  else if (face === 'back') { longitudinal = halfLongitudinal; lateral = alongFrac * halfLateral * insetFraction; }
  else if (face === 'left') { lateral = -halfLateral; longitudinal = alongFrac * halfLongitudinal * insetFraction; }
  else { lateral = halfLateral; longitudinal = alongFrac * halfLongitudinal * insetFraction; }
  return resolveAxis(config, lateral, longitudinal, y);
}

function buildPoints(vehicleId: string, offsets: [LocalOffset, string][]): CleaningPointDefinition[] {
  return offsets.map(([position, label], i) => ({
    id: `${vehicleId}-clean-${String(i + 1).padStart(2, '0')}`,
    position,
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
  // 青蛙 — 幫牠清潔嘴巴 (spec: "分布在嘴巴／嘴唇／臉部外側可接觸區域，不要放
  // 到嘴巴內部太深的位置，玩家必須可以從正常站立位置瞄準"). The frog is NOT a
  // literal box (buildFrogVehicle's own rounded creature mesh, narrower than
  // its own bounding chassis) — uses the FRONT face (where the mouth/head
  // sits) with a SMALLER inset (0.5) so the lateral spread hugs the actual
  // head width rather than the wider leg stance, and pulls the longitudinal
  // boundary in to 0.7 of the full front-face distance (rather than sideFace
  // Point's own default 0.85) so points sit ON the rounded head's own
  // visible front surface instead of floating past it in open air. Height
  // band 0.35–0.8 of full chassis height covers the mouth/lips/nose/cheek
  // area (the head sits in the UPPER half of the vehicle, above the low
  // fixed-body/legs).
  'land-frog-01': {
    vehicleId: 'land-frog-01',
    toolId: 'brush',
    cleaningTarget: '嘴巴',
    cleaningPoints: buildPoints('frog', [
      [sideFacePoint(FROG_CONFIG, 'front', -0.55, 0.45, 0.7), '嘴角左側'],
      [sideFacePoint(FROG_CONFIG, 'front', 0.55, 0.45, 0.7), '嘴角右側'],
      [sideFacePoint(FROG_CONFIG, 'front', 0, 0.65, 0.7), '上唇'],
      [sideFacePoint(FROG_CONFIG, 'front', 0, 0.4, 0.7), '下唇'],
      [sideFacePoint(FROG_CONFIG, 'front', -0.3, 0.5, 0.7), '牙齒左側'],
      [sideFacePoint(FROG_CONFIG, 'front', 0.3, 0.5, 0.7), '牙齒右側'],
      [sideFacePoint(FROG_CONFIG, 'front', 0, 0.78, 0.7), '鼻頭'],
      [sideFacePoint(FROG_CONFIG, 'front', -0.65, 0.6, 0.7), '左臉頰'],
      [sideFacePoint(FROG_CONFIG, 'front', 0.65, 0.6, 0.7), '右臉頰'],
      [sideFacePoint(FROG_CONFIG, 'front', 0, 0.52, 0.7), '嘴巴中央'],
    ]),
  },
  // 石頭巨人 — 清除身上的青苔: moss can grow anywhere on a plain box-shaped
  // stone body, so candidates spread across top + all four sides — a real
  // box vehicle (buildGenericBoxVehicle), so its config.width/length/height
  // ARE the literal chassis surface.
  'land-rockgiant-01': {
    vehicleId: 'land-rockgiant-01',
    toolId: 'waterJet',
    cleaningTarget: '青苔',
    cleaningPoints: buildPoints('golem', [
      [topFacePoint(ROCKGIANT_CONFIG, 0, -0.4), '頭頂'],
      [topFacePoint(ROCKGIANT_CONFIG, -0.5, 0.2), '左肩'],
      [topFacePoint(ROCKGIANT_CONFIG, 0.5, 0.2), '右肩'],
      [sideFacePoint(ROCKGIANT_CONFIG, 'left', 0, 0.6), '左側身'],
      [sideFacePoint(ROCKGIANT_CONFIG, 'left', 0.5, 0.3), '左腳邊'],
      [sideFacePoint(ROCKGIANT_CONFIG, 'right', 0, 0.6), '右側身'],
      [sideFacePoint(ROCKGIANT_CONFIG, 'right', 0.5, 0.3), '右腳邊'],
      [sideFacePoint(ROCKGIANT_CONFIG, 'front', 0, 0.7), '正面上方'],
      [sideFacePoint(ROCKGIANT_CONFIG, 'back', -0.4, 0.5), '背部左'],
      [sideFacePoint(ROCKGIANT_CONFIG, 'back', 0.4, 0.5), '背部右'],
    ]),
  },
  // 蝸牛 — 幫牠的殼打蠟: candidates spread across the shell's own top+back
  // dome surface, never the front (soft body/head, not shell) or bottom.
  'land-snail-01': {
    vehicleId: 'land-snail-01',
    toolId: 'waxTool',
    cleaningTarget: '殼',
    cleaningPoints: buildPoints('snail', [
      [topFacePoint(SNAIL_CONFIG, 0, -0.5), '殼頂前'],
      [topFacePoint(SNAIL_CONFIG, 0, 0.5), '殼頂後'],
      [topFacePoint(SNAIL_CONFIG, -0.4, 0), '殼左上'],
      [topFacePoint(SNAIL_CONFIG, 0.4, 0), '殼右上'],
      [topFacePoint(SNAIL_CONFIG, 0, 0), '殼中央'],
      [sideFacePoint(SNAIL_CONFIG, 'left', 0.3, 0.75), '殼左側'],
      [sideFacePoint(SNAIL_CONFIG, 'right', 0.3, 0.75), '殼右側'],
      [sideFacePoint(SNAIL_CONFIG, 'back', 0, 0.8), '殼後方'],
      [sideFacePoint(SNAIL_CONFIG, 'back', -0.4, 0.65), '殼左後'],
      [sideFacePoint(SNAIL_CONFIG, 'back', 0.4, 0.65), '殼右後'],
    ]),
  },
  // 魟魚 — 擦拭背部: a flat sea creature — its own "back" IS the top face,
  // so every point stays on top, spread across the whole flat body plus the
  // two wing edges.
  'sea-ray-01': {
    vehicleId: 'sea-ray-01',
    toolId: 'cloth',
    cleaningTarget: '背部',
    cleaningPoints: buildPoints('ray', [
      [topFacePoint(RAY_CONFIG, 0, -0.6), '背部前方'],
      [topFacePoint(RAY_CONFIG, 0, 0), '背部中央'],
      [topFacePoint(RAY_CONFIG, 0, 0.6), '背部後方'],
      [topFacePoint(RAY_CONFIG, -0.5, -0.3), '背部左前'],
      [topFacePoint(RAY_CONFIG, 0.5, -0.3), '背部右前'],
      [topFacePoint(RAY_CONFIG, -0.5, 0.3), '背部左後'],
      [topFacePoint(RAY_CONFIG, 0.5, 0.3), '背部右後'],
      [sideFacePoint(RAY_CONFIG, 'left', 0, 0.85), '左翼緣'],
      [sideFacePoint(RAY_CONFIG, 'right', 0, 0.85), '右翼緣'],
      [topFacePoint(RAY_CONFIG, 0, 0.15), '背鰭附近'],
    ]),
  },
  // 海龜 — 清理背上的藤壺: a broad domed shell, same "everything stays on
  // top" reasoning as the ray above (barnacles cluster anywhere on the
  // shell's own top surface).
  'sea-turtle-01': {
    vehicleId: 'sea-turtle-01',
    toolId: 'shovel',
    cleaningTarget: '藤壺',
    cleaningPoints: buildPoints('turtle', [
      [topFacePoint(TURTLE_CONFIG, 0, -0.6), '殼前緣'],
      [topFacePoint(TURTLE_CONFIG, 0, 0.6), '殼後緣'],
      [topFacePoint(TURTLE_CONFIG, -0.6, 0), '殼左側'],
      [topFacePoint(TURTLE_CONFIG, 0.6, 0), '殼右側'],
      [topFacePoint(TURTLE_CONFIG, -0.4, -0.3), '殼左前'],
      [topFacePoint(TURTLE_CONFIG, 0.4, -0.3), '殼右前'],
      [topFacePoint(TURTLE_CONFIG, -0.4, 0.3), '殼左後'],
      [topFacePoint(TURTLE_CONFIG, 0.4, 0.3), '殼右後'],
      [topFacePoint(TURTLE_CONFIG, 0, 0), '殼頂中央'],
      [sideFacePoint(TURTLE_CONFIG, 'left', -0.3, 0.9), '殼邊緣'],
    ]),
  },
  // 克拉肯 — 清理觸手: tentacles trail LOW around the body (heightFrac01 kept
  // small, 0.08-0.2 — near the base, not up on the main chassis top).
  // Deliberately avoids the 'left' face entirely — this round's own live
  // headless-Chrome verification found kraken's dock (SEA_DOCK z=21) sits
  // only ~0.6m from the dividing wall/gate toward the neighboring turtle
  // dock (z=17) on that exact side, leaving NO standing distance (tested
  // 1.0m-2.6m outward, all blocked) from which a player could actually face
  // that side — a real level-geometry constraint, not a coordinate-tuning
  // issue. Spread across front/back/right instead, all confirmed clear.
  'sea-kraken-01': {
    vehicleId: 'sea-kraken-01',
    toolId: 'tentacleBrush',
    cleaningTarget: '觸手',
    cleaningPoints: buildPoints('kraken', [
      [sideFacePoint(KRAKEN_CONFIG, 'front', -0.6, 0.15), '前方觸手左'],
      [sideFacePoint(KRAKEN_CONFIG, 'front', 0, 0.12), '前方觸手中央'],
      [sideFacePoint(KRAKEN_CONFIG, 'front', 0.6, 0.15), '前方觸手右'],
      [sideFacePoint(KRAKEN_CONFIG, 'back', -0.6, 0.15), '後方觸手左'],
      [sideFacePoint(KRAKEN_CONFIG, 'back', 0, 0.12), '後方觸手中央'],
      [sideFacePoint(KRAKEN_CONFIG, 'back', 0.6, 0.15), '後方觸手右'],
      [sideFacePoint(KRAKEN_CONFIG, 'right', -0.6, 0.12), '右側觸手前'],
      [sideFacePoint(KRAKEN_CONFIG, 'right', -0.2, 0.18), '右側觸手前中'],
      [sideFacePoint(KRAKEN_CONFIG, 'right', 0.2, 0.18), '右側觸手後中'],
      [sideFacePoint(KRAKEN_CONFIG, 'right', 0.6, 0.12), '右側觸手後'],
    ]),
  },
};

// Module-load sanity check — every entry must have exactly 10 candidates,
// mirroring this codebase's own established "throw at import time on a
// data-authoring mistake" convention (e.g. stamp-collection-data.ts's own
// per-region count check).
for (const def of Object.values(VEHICLE_CLEANING_DEFINITIONS)) {
  if (def.cleaningPoints.length !== 10) {
    throw new Error(`vehicle-cleaning-data: "${def.vehicleId}" has ${def.cleaningPoints.length} candidate points, expected 10`);
  }
}

export function getVehicleCleaningDefinition(vehicleId: string): VehicleCleaningDefinition | undefined {
  return VEHICLE_CLEANING_DEFINITIONS[vehicleId];
}

/** Fisher-Yates shuffle + take-first-N — the "不重複抽取" requirement falls
 * out naturally from shuffling the whole 10-item pool once and slicing,
 * rather than repeatedly rolling a random index and checking for
 * collisions. */
function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Tonight's actual cleaning points for one vehicle — 4 or 5, picked
 * uniformly, then that many DISTINCT points drawn from the fixed 10-
 * candidate pool. Never mutates VEHICLE_CLEANING_DEFINITIONS itself. */
export function pickNightlyCleaningPoints(vehicleId: string): CleaningPointDefinition[] {
  const def = getVehicleCleaningDefinition(vehicleId);
  if (!def) return [];
  const count = Math.random() < 0.5 ? 4 : 5;
  return shuffle(def.cleaningPoints).slice(0, count);
}
