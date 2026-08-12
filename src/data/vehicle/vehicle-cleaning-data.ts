// "載具夜間清潔互動" round, "排查碰撞格/Geometry再修正" follow-up — plain data
// only (matches this codebase's own established "data file, system reads
// it" convention: vehicle-data.ts/vehicle-dock-data.ts are the identical
// precedent). Reuses the SAME six real VehicleConfig ids vehicle-data.ts
// already defines — no second vehicle roster.
//
// ROOT-CAUSE FIX this round: candidate points no longer carry a hand-
// computed LOCAL {x,y,z} offset at all — that was the actual bug. The
// previous round's offsets were authored against an IMAGINED coordinate
// system ("local Y=0 is the ground, local (0,0,0) is the visual center")
// that doesn't match how VehicleSystem actually builds its meshes: every
// vehicle's own vehicleGroup.position.y is ALWAYS 0 (see vehicle-system.ts
// constructor), while every real mesh is positioned at LOCAL Y =
// BACK_AREA.floorY (-1.5) + something — so every previous point sat
// ~1.5m above the real body, reading as "floating in front of/above the
// vehicle" exactly as reported. The frog's own 180° dock-facing rotation
// was ALSO never applied when converting a point's local offset to world
// position (plain addition ignores rotation entirely), compounding the
// mismatch for that one vehicle specifically.
//
// The fix: each candidate now references an `anchorName` — a key into
// that specific VehicleSystem INSTANCE's own `cleaningAnchors` record
// (vehicle-system.ts), which is populated from the EXACT SAME local
// variables (chassis/bed/wall extents, floorY, basin/body geometry) that
// build the real visible meshes, and resolved to world space via
// VehicleSystem.getSurfacePoint() (Object3D.localToWorld(), which
// correctly composes position + rotation). A cleaning point can now never
// drift out of sync with the actual rendered geometry the way a hand-
// duplicated coordinate formula in this file did before.
//
// Cleaning TOOLS are deliberately NOT added to core/game-state.ts's own
// `ActiveTool` union or wired into ToolSystem/the hotbar/day-unlock-data.ts
// (spec: "不要自行發明新的遊戲工具模型") — `CleaningToolId` below is now
// PURELY an internal correctness field (spec: "玩家不選工具...這些資料只
// 存在於程式邏輯"), never surfaced to the player at all (no tool name, no
// tool UI — see vehicle-night-cleaning-ui.ts's own doc comment).
export type CleaningToolId = 'brush' | 'waterJet' | 'waxTool' | 'cloth' | 'shovel' | 'tentacleBrush';

/** One CANDIDATE cleaning spot on a vehicle's body. `anchorName` must exist
 * in that vehicle's own live `VehicleSystem.cleaningAnchors` record (see
 * vehicle-system.ts's buildGenericBoxVehicle/buildFrogVehicle — the box
 * builder's own generic anchor names are shared across rockgiant/snail/
 * ray/turtle/kraken; the frog has its own distinct set matching its custom
 * creature mesh) — never a raw {x,y,z}, so a point can never silently
 * drift out of sync with the real geometry the way the previous round's
 * hand-computed offsets did. `KNOWN_*_ANCHOR_NAMES` below is a load-time
 * typo guard (a real VehicleSystem instance doesn't exist yet when this
 * module evaluates, so anchor EXISTENCE can't be checked against the real
 * geometry here — only the NAME itself, against a mirror of what
 * vehicle-system.ts is known to populate). */
export interface CleaningPointDefinition {
  id: string;
  anchorName: string;
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

function buildPoints(vehicleId: string, entries: [string, string][]): CleaningPointDefinition[] {
  return entries.map(([anchorName, label], i) => ({
    id: `${vehicleId}-clean-${String(i + 1).padStart(2, '0')}`,
    anchorName,
    label,
  }));
}

/** Mirrors the generic box-vehicle anchor names vehicle-system.ts's
 * buildGenericBoxVehicle populates (rockgiant/snail/ray/turtle/kraken all
 * share this exact set — see that method's own cleaningAnchors block). */
const KNOWN_BOX_ANCHOR_NAMES = new Set([
  'topFrontLeft', 'topFrontRight', 'topBackLeft', 'topBackRight', 'topCenter',
  'sideLeftFront', 'sideLeftBack', 'sideRightFront', 'sideRightBack', 'frontUpper', 'backUpper',
  'chassisFrontLeft', 'chassisFrontRight', 'chassisBackLeft', 'chassisBackRight',
  'chassisFrontCenter', 'chassisBackCenter', 'chassisLeftMid', 'chassisRightMid',
  'chassisLeftFront', 'chassisLeftBack', 'chassisRightFront', 'chassisRightBack',
]);

/** Mirrors the frog-specific anchor names vehicle-system.ts's
 * buildFrogVehicle populates. */
const KNOWN_FROG_ANCHOR_NAMES = new Set([
  'mouthLeft', 'mouthRight', 'mouthCenter', 'chin', 'cheekLeft', 'cheekRight',
  'templeLeft', 'templeRight', 'crownBack', 'bodyLeft', 'bodyRight', 'bodyBack', 'bodyBelly',
]);

export const VEHICLE_CLEANING_DEFINITIONS: Record<string, VehicleCleaningDefinition> = {
  // 青蛙 — 幫牠清潔嘴巴。全部10個候選點都附著在frog的「靜態」部位（嘴唇/臉頰
  // 外環rim + 固定身體fixedBody），刻意不使用會開合旋轉的upperHeadShell（見
  // vehicle-system.ts buildFrogVehicle自己cleaningAnchors區塊的doc comment
  // ——marker在onArrived()剛設定目標角度、嘴巴尚未真正動畫開啟前就已經同步
  // 生成，若附著在會轉動的部位上位置會直接過時）。
  'land-frog-01': {
    vehicleId: 'land-frog-01',
    toolId: 'brush',
    cleaningTarget: '嘴巴',
    cleaningPoints: buildPoints('frog', [
      ['mouthLeft', '嘴巴左側'],
      ['mouthRight', '嘴巴右側'],
      ['mouthCenter', '嘴巴中央'],
      ['chin', '下巴'],
      ['cheekLeft', '左臉頰'],
      ['cheekRight', '右臉頰'],
      ['templeLeft', '左臉'],
      ['templeRight', '右臉'],
      ['crownBack', '頭頂後方'],
      ['bodyLeft', '身體左側'],
    ]),
  },
  // 石頭巨人 — 清除身上的青苔: 一般箱型載具的通用anchor，涵蓋頂面四角+中央、
  // 上段左右前後、下段（底盤）左右中央，模擬肩／胸／背／手臂／腿的分布。
  'land-rockgiant-01': {
    vehicleId: 'land-rockgiant-01',
    toolId: 'waterJet',
    cleaningTarget: '青苔',
    cleaningPoints: buildPoints('golem', [
      ['topFrontLeft', '左肩'],
      ['topFrontRight', '右肩'],
      ['topBackLeft', '背部左上'],
      ['topBackRight', '背部右上'],
      ['topCenter', '頭頂'],
      ['sideLeftFront', '左手臂'],
      ['sideRightFront', '右手臂'],
      ['chassisLeftMid', '左腿'],
      ['chassisRightMid', '右腿'],
      ['backUpper', '背部'],
    ]),
  },
  // 蝸牛 — 幫牠的殼打蠟: 全部使用「上段」anchor（頂面+bed-wall高度側面），殼
  // 只在載具上半部，避免落到底盤（軟體部位）或殼內部。
  'land-snail-01': {
    vehicleId: 'land-snail-01',
    toolId: 'waxTool',
    cleaningTarget: '殼',
    cleaningPoints: buildPoints('snail', [
      ['topFrontLeft', '殼左上前'],
      ['topFrontRight', '殼右上前'],
      ['topBackLeft', '殼左後'],
      ['topBackRight', '殼右後'],
      ['topCenter', '殼中央'],
      ['sideLeftBack', '殼左側'],
      ['sideRightBack', '殼右側'],
      ['backUpper', '殼後方'],
      ['sideLeftFront', '殼左前側'],
      ['sideRightFront', '殼右前側'],
    ]),
  },
  // 魟魚 — 擦拭背部: 扁平的海洋生物，背部即頂面，兩側翼緣使用side anchor。
  'sea-ray-01': {
    vehicleId: 'sea-ray-01',
    toolId: 'cloth',
    cleaningTarget: '背部',
    cleaningPoints: buildPoints('ray', [
      ['topFrontLeft', '背部左前'],
      ['topFrontRight', '背部右前'],
      ['topCenter', '背部中央'],
      ['topBackLeft', '背部左後'],
      ['topBackRight', '背部右後'],
      ['sideLeftFront', '左翼'],
      ['sideRightFront', '右翼'],
      ['sideLeftBack', '左翼後'],
      ['sideRightBack', '右翼後'],
      ['frontUpper', '前部'],
    ]),
  },
  // 海龜 — 清理背上的藤壺: 廣闊龜殼頂面為主，四角+中央+左右側，前緣代表頭部
  // 附近。
  'sea-turtle-01': {
    vehicleId: 'sea-turtle-01',
    toolId: 'shovel',
    cleaningTarget: '藤壺',
    cleaningPoints: buildPoints('turtle', [
      ['topFrontLeft', '龜殼左前'],
      ['topFrontRight', '龜殼右前'],
      ['topBackLeft', '龜殼左後'],
      ['topBackRight', '龜殼右後'],
      ['topCenter', '龜殼中央'],
      ['sideLeftFront', '左側（前肢附近）'],
      ['sideRightFront', '右側'],
      ['sideLeftBack', '左後（後肢附近）'],
      ['sideRightBack', '右後'],
      ['frontUpper', '頭部附近'],
    ]),
  },
  // 克拉肯 — 清理觸手: 觸手垂在船身底盤附近（低段anchor），刻意只使用
  // across≥0（'Right'/'Center'系列）的anchor——這輪headless Chrome實測發現
  // 克拉肯船塢（z=21）與海龜船塢（z=17）之間的隔牆只距離克拉肯左側面約0.6m，
  // 1.0m～2.6m任何站立距離都無法看到該側，是真實關卡幾何限制，不是座標調
  // 整能解的問題，因此完全避開'Left'側anchor。
  'sea-kraken-01': {
    vehicleId: 'sea-kraken-01',
    toolId: 'tentacleBrush',
    cleaningTarget: '觸手',
    cleaningPoints: buildPoints('kraken', [
      ['chassisFrontRight', '右前觸手'],
      ['chassisFrontCenter', '前方觸手'],
      ['chassisBackRight', '右後觸手'],
      ['chassisBackCenter', '後方觸手'],
      ['chassisRightMid', '右側觸手'],
      ['chassisRightFront', '右側前觸手'],
      ['chassisRightBack', '右側後觸手'],
      ['sideRightFront', '右上前觸手'],
      ['sideRightBack', '右上後觸手'],
      ['frontUpper', '前方上段觸手'],
    ]),
  },
};

// Module-load sanity check — every entry must have exactly 10 candidates,
// AND every anchorName must be a recognized name for that vehicle's own
// anchor set (a typo guard — a real VehicleSystem instance doesn't exist
// at module-load time, so this can't check the anchor's actual computed
// position, only that the NAME itself is one vehicle-system.ts is known to
// populate for that vehicle category).
for (const def of Object.values(VEHICLE_CLEANING_DEFINITIONS)) {
  if (def.cleaningPoints.length !== 10) {
    throw new Error(`vehicle-cleaning-data: "${def.vehicleId}" has ${def.cleaningPoints.length} candidate points, expected 10`);
  }
  const knownNames = def.vehicleId === 'land-frog-01' ? KNOWN_FROG_ANCHOR_NAMES : KNOWN_BOX_ANCHOR_NAMES;
  for (const point of def.cleaningPoints) {
    if (!knownNames.has(point.anchorName)) {
      throw new Error(`vehicle-cleaning-data: "${def.vehicleId}" point "${point.id}" references unknown anchor "${point.anchorName}"`);
    }
  }
}

export function getVehicleCleaningDefinition(vehicleId: string): VehicleCleaningDefinition | undefined {
  return VEHICLE_CLEANING_DEFINITIONS[vehicleId];
}

/** Fisher-Yates shuffle. */
function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Minimum straight-line distance (meters) between two SIMULTANEOUSLY
 * active nightly points — enforced below so a random draw can't bunch
 * several candidates into the same small area even when all 10 candidates
 * are individually well-placed (spec五: "即使10個候選點都合理，抽出的4～5
 * 個點也不能全部集中在一起"). Chosen against this game's own actual vehicle
 * footprints (2.6-4.6m chassis span) — small enough that a genuinely
 * well-spread 10-point pool can still usually produce a valid 4-5 draw,
 * large enough to rule out two points landing on the same face corner. */
const MIN_CLEANING_POINT_DISTANCE = 0.5;

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Tonight's actual cleaning points for one vehicle — 4 or 5, picked from
 * the fixed 10-candidate pool with a minimum-spacing constraint (spec五):
 * shuffle the pool, walk it in order, skip any candidate closer than
 * `minDist` to an already-picked one, relax `minDist` and retry if that
 * doesn't yield enough, and fall back to an unconstrained slice (still
 * guaranteeing the right COUNT) if spacing genuinely can't be satisfied.
 * `anchors` are LOCAL positions read from the vehicle's own live
 * VehicleSystem.cleaningAnchors — distances are computed in local space,
 * which is exactly equal to world-space distance since vehicleGroup only
 * ever translates+rotates (never scales), so this never needs a live
 * world-position lookup. */
export function pickNightlyCleaningPoints(
  vehicleId: string, anchors: Record<string, { x: number; y: number; z: number }>
): CleaningPointDefinition[] {
  const def = getVehicleCleaningDefinition(vehicleId);
  if (!def) return [];
  const count = Math.random() < 0.5 ? 4 : 5;
  const shuffled = shuffle(def.cleaningPoints);

  let minDist = MIN_CLEANING_POINT_DISTANCE;
  for (let attempt = 0; attempt < 4; attempt++) {
    const picked: CleaningPointDefinition[] = [];
    for (const candidate of shuffled) {
      const pos = anchors[candidate.anchorName];
      if (!pos) continue; // defensive — every real anchorName resolves for a live instance
      const tooClose = picked.some((p) => distance(pos, anchors[p.anchorName]) < minDist);
      if (!tooClose) picked.push(candidate);
      if (picked.length >= count) break;
    }
    if (picked.length >= count) return picked.slice(0, count);
    minDist *= 0.6; // relax and retry
  }
  return shuffled.slice(0, count); // fallback — guarantees the right count even if spacing can't be satisfied
}
