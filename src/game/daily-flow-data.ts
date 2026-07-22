// Centralized spatial + count data for the "每日貨品清空核心流程 v0.1" loop
// (unload -> sort -> ship -> end day). Kept separate from
// logistics-layout-data.ts (which owns the older counter/vehicle-era zones)
// so this round's new geometry isn't scattered across scene/system files.
// WEST_GATE is the one exception — it lives in logistics-layout-data.ts
// because scene-manager.ts's buildBackArea() needs it alongside the
// existing LAND_GATE/SEA_GATE constants it already imports from there.
import { BACK_AREA, WEST_GATE } from './logistics-layout-data';

const FLOOR_Y = BACK_AREA.floorY;

/** How many cargo items spawn each day, fixed (spec 八: no infinite spawn,
 * no per-day variation of the total or the box/roller ratio). */
export const DAILY_BOX_COUNT = 8;
export const DAILY_ROLLER_COUNT = 2;
export const DAILY_CARGO_COUNT = DAILY_BOX_COUNT + DAILY_ROLLER_COUNT;

/** Wall opening + short slide the gate sits in front of. Chute is a gentle
 * slope (rise 0.35 over run 1.8, ~11°) — steep enough to visibly "slide"
 * cargo into the room, shallow enough that CCD-enabled dynamic boxes/rollers
 * don't build up enough speed to tunnel or fly on landing. */
export const UNLOAD_CHUTE = {
  topX: BACK_AREA.minX + 0.15,
  topY: FLOOR_Y + 0.35,
  topZ: WEST_GATE.centerZ,
  bottomX: BACK_AREA.minX + 1.95,
  bottomZ: WEST_GATE.centerZ,
  width: WEST_GATE.halfWidth * 2 - 0.6,
  thickness: 0.12,
};

/** Gate door — a single flat panel filling the wall opening floor-to-
 * ceiling (matching the flanking wall segments' full height, so "closed"
 * genuinely seals the gap, not just its lower portion), translated straight
 * up to "open" (spec 五: simple translation, no real mechanism). The panel
 * itself is purely visual — see UnloadingSystem.buildGate()'s permanent
 * invisible collider (spec 五 "防止貨品飛出場景的隱藏安全碰撞") which stays
 * solid across the WHOLE opening regardless of the panel's animation state,
 * so nothing can ever physically cross this wall plane either way. */
export const UNLOAD_GATE = {
  centerX: BACK_AREA.minX,
  centerZ: WEST_GATE.centerZ,
  width: WEST_GATE.halfWidth * 2 - 0.1,
  height: BACK_AREA.ceilingHeight,
  thickness: 0.15,
  openOffsetY: BACK_AREA.ceilingHeight, // raises it fully clear of the opening
  openDuration: 0.8, // seconds, within spec's 0.6-1s window
};

/** Where newly-spawned cargo appears, one at a time, sliding down the
 * chute — small per-item X/Z jitter (spec 九) keeps them from spawning
 * exactly stacked on each other. */
export const UNLOAD_SPAWN_POINT = {
  x: UNLOAD_CHUTE.topX + 0.3,
  z: UNLOAD_CHUTE.topZ,
};
export const UNLOAD_SPAWN_INTERVAL = 0.22; // seconds between each item, spec 九: 0.15-0.3
export const UNLOAD_SPAWN_JITTER_X = 0.35;
export const UNLOAD_SPAWN_JITTER_Z = 0.5;
/** Light nudge toward the room interior (+X) — spec 九: "輕微朝卸貨區方向的初速度". */
export const UNLOAD_SPAWN_IMPULSE_X = 1.1;

/** Open floor where the pile lands and gets broken apart — no walls/props
 * placed here deliberately (spec 四B: "不要在中央放置會阻擋搬運的工作桌"). */
export const UNLOAD_ZONE = {
  minX: BACK_AREA.minX + 0.3, maxX: BACK_AREA.minX + 4.3,
  minZ: WEST_GATE.centerZ - WEST_GATE.halfWidth, maxZ: WEST_GATE.centerZ + WEST_GATE.halfWidth,
};

/** Wall-side pos for the two unloading-control buttons — just inside the
 * unload zone's south edge, clear of the chute's landing spot and the main
 * aisle running east toward the sorting area. */
export const UNLOAD_BUTTON_POS = { x: BACK_AREA.minX + 1.2, z: UNLOAD_ZONE.maxZ + 1.1 };
export const END_DAY_BUTTON_POS = { x: BACK_AREA.minX + 2.6, z: UNLOAD_ZONE.maxZ + 1.1 };

/** Central sorting platform — a wooden pallet, sized within spec's 1.0-1.2m
 * range. Positioned east of the unload zone, well clear of the doorway/
 * stairs (centerX 3.5) and the old vehicle-control posts' footprint. */
export const PALLET_CONFIG = {
  posX: -4.0,
  posZ: 15.5,
  width: 1.1,
  depth: 1.1,
  height: 0.15,
  /** Half-height above the pallet TOP a box's center must sit within to
   * count as "on" it — generous enough for stacked boxes (spec 十三). */
  detectHeight: 1.0,
};

/** Wall-mounted roller rack — against the west wall, south of the unload
 * gate (clear of the gate's own halfWidth), an easy carry from the unload
 * zone without blocking the gate, the stairs, or the outbound zone. */
export const ROLLER_RACK_CONFIG = {
  posX: BACK_AREA.minX + 0.55,
  posZ: WEST_GATE.centerZ + WEST_GATE.halfWidth + 3.0,
  width: 1.6,
  depth: 0.7,
  baseHeight: 0.18,
  slotCount: 2,
  /** Horizontal half-extent (along the rack's width axis) of each slot's
   * valid catch zone, and the vertical window above the base a roller's
   * center must sit within. */
  slotHalfWidth: 0.32,
  detectHeight: 0.9,
};

/** East-side outbound zone — reuses the hall-center real estate the old
 * vehicle-control buttons used to occupy (now disabled, see feature-flags.ts),
 * clear of the sea gate's pier opening (Z 14-22) and the land dock marker
 * (Z 29.5) on the south wall. */
export const OUTBOUND_ZONE = {
  minX: 5.5, maxX: 9.2,
  minZ: 23.5, maxZ: 28.0,
};

/** Fixed size presets for daily box cargo — same overall bounds discipline
 * as the old CARGO_SIZE_PRESETS (cargo-data.ts) so nothing is too flat/thin
 * to grab or too big for the doorway/stairs, but a distinct list (spec 十:
 * "不需要...載具相容性" — this round's boxes are a separate concern). */
export const DAILY_BOX_SIZE_PRESETS = [
  { width: 0.32, height: 0.30, depth: 0.32 },
  { width: 0.40, height: 0.28, depth: 0.34 },
  { width: 0.30, height: 0.42, depth: 0.30 },
  { width: 0.44, height: 0.32, depth: 0.38 },
  { width: 0.34, height: 0.36, depth: 0.44 },
];

/** Fixed size presets for daily roller cargo — {radius, length}. Kept
 * modest so a barrel can pass through the doorway (opening 1.6m) lying on
 * its side. */
export const DAILY_ROLLER_SIZE_PRESETS = [
  { radius: 0.22, length: 0.55 },
  { radius: 0.19, length: 0.62 },
];

export const DAILY_BOX_COLOR = 0x9a7a4a;
export const DAILY_ROLLER_COLOR = 0x6b5638;
