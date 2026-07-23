// Centralized spatial + count data for the "每日貨品清空核心流程" loop
// (unload -> sort -> ship -> end day). Kept separate from
// logistics-layout-data.ts (which owns the older counter/vehicle-era zones)
// so this round's new geometry isn't scattered across scene/system files.
// NORTH_GATE is the one exception — it lives in logistics-layout-data.ts
// because scene-manager.ts's buildNorthGateWall() needs it alongside the
// existing LAND_GATE/SEA_GATE constants it already imports from there.
//
// Follow-up round ("北側卸貨口/重新啟用呼叫載具"): the unload dock moved
// from the back area's west wall to the FRONT OFFICE's north wall, after
// the front-office counter/NPC area was removed — the whole front office
// room is now the "北側卸貨區". PALLET_CONFIG/ROLLER_RACK_CONFIG stay in
// the back area, unchanged (spec section 二十: "保持不變").
import { FRONT_OFFICE, NORTH_GATE } from './logistics-layout-data';

const FLOOR_Y = FRONT_OFFICE.floorY;

/** How many cargo items spawn each day, fixed (spec: no infinite spawn, no
 * per-day variation of the total or the box/roller ratio). */
export const DAILY_BOX_COUNT = 8;
export const DAILY_ROLLER_COUNT = 2;
export const DAILY_CARGO_COUNT = DAILY_BOX_COUNT + DAILY_ROLLER_COUNT;

/** Wall opening + short slide the gate sits in front of. Chute now runs
 * along Z (north->south, into the front office) instead of X. Gentle slope
 * (rise 0.35 over run 1.8, ~11°) — steep enough to visibly "slide" cargo
 * into the room, shallow enough that CCD-enabled dynamic boxes/rollers
 * don't build up enough speed to tunnel or fly on landing. */
export const UNLOAD_CHUTE = {
  topX: NORTH_GATE.centerX,
  topY: FLOOR_Y + 0.35,
  topZ: FRONT_OFFICE.minZ + 0.15,
  bottomX: NORTH_GATE.centerX,
  bottomZ: FRONT_OFFICE.minZ + 1.95,
  width: NORTH_GATE.halfWidth * 2 - 0.6,
  thickness: 0.12,
};

/** Gate door — a single flat panel filling the wall opening floor-to-
 * ceiling (matching the flanking wall segments' full height, so "closed"
 * genuinely seals the gap, not just its lower portion), translated straight
 * up to "open" (spec: simple translation, no real mechanism). The panel
 * itself is purely visual — see UnloadingSystem.buildGate()'s permanent
 * invisible collider (spec "防止貨品飛出場景的隱藏安全碰撞") which stays
 * solid across the WHOLE opening regardless of the panel's animation state,
 * so nothing can ever physically cross this wall plane either way. */
export const UNLOAD_GATE = {
  centerX: NORTH_GATE.centerX,
  centerZ: FRONT_OFFICE.minZ,
  width: NORTH_GATE.halfWidth * 2 - 0.1,
  height: FRONT_OFFICE.ceilingHeight,
  thickness: 0.15,
  openOffsetY: FRONT_OFFICE.ceilingHeight, // raises it fully clear of the opening
  openDuration: 0.8, // seconds, within spec's 0.6-1s window
};

/** Where newly-spawned cargo appears, one at a time, sliding down the
 * chute — small per-item X/Z jitter keeps them from spawning exactly
 * stacked on each other. */
export const UNLOAD_SPAWN_POINT = {
  x: UNLOAD_CHUTE.topX,
  z: UNLOAD_CHUTE.topZ + 0.3,
};
export const UNLOAD_SPAWN_INTERVAL = 0.22; // seconds between each item
export const UNLOAD_SPAWN_JITTER_X = 0.5;
export const UNLOAD_SPAWN_JITTER_Z = 0.35;
/** Light nudge toward the room interior (+Z, south) — "輕微朝卸貨區方向的
 * 初速度". */
export const UNLOAD_SPAWN_IMPULSE_Z = 1.1;

/** Open floor where the pile lands and gets broken apart — the front
 * office's north end, well clear of the player spawn (z=7, see
 * counter-layout-data.ts PLAYER_SPAWN) and the dividing wall/doorway at
 * FRONT_OFFICE.maxZ=10. */
export const UNLOAD_ZONE = {
  minX: NORTH_GATE.centerX - NORTH_GATE.halfWidth + 0.3, maxX: NORTH_GATE.centerX + NORTH_GATE.halfWidth - 0.3,
  minZ: FRONT_OFFICE.minZ + 0.3, maxZ: FRONT_OFFICE.minZ + 4.3,
};

/** Wall-side pos for the two unloading-control buttons — off to the west
 * side of the gate opening (clear of NORTH_GATE's own X range and the
 * chute/drop path), spaced apart from each other in Z. Both now sit inside
 * the front office (spec section 十九: grouped under "北側卸貨區"). */
export const UNLOAD_BUTTON_POS = { x: NORTH_GATE.centerX - NORTH_GATE.halfWidth - 2.0, z: FRONT_OFFICE.minZ + 1.2 };
export const END_DAY_BUTTON_POS = { x: NORTH_GATE.centerX - NORTH_GATE.halfWidth - 2.0, z: FRONT_OFFICE.minZ + 2.8 };

/** Central sorting platform — a wooden pallet, sized within spec's 1.0-1.2m
 * range. Unchanged from the previous round (spec section 二十: "保持不變") —
 * still in the back area, well clear of the doorway/stairs and the vehicle
 * control posts' footprint. */
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

/** Wall-mounted roller rack — unchanged from the previous round (spec
 * section 二十: "保持不變"). posZ is the literal value the old formula
 * (WEST_GATE.centerZ + WEST_GATE.halfWidth + 3.0, back when the unload gate
 * was on the back area's west wall) resolved to — kept as a plain literal
 * now that WEST_GATE no longer exists, so the rack's real-world position is
 * byte-for-byte the same as before. */
export const ROLLER_RACK_CONFIG = {
  posX: -9.45,
  posZ: 20.2,
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

/** East-side outbound zone — NOT used by the main flow this round (spec
 * "北側卸貨口/重新啟用呼叫載具" section 八: cargo now ships by riding along
 * with a vehicle, not by walking into a ground zone). Kept only so
 * outbound-zone-system.ts (uninitialized in game.ts, see feature-flags.ts
 * doc comment there) still compiles if it's reused in a future round. */
export const OUTBOUND_ZONE = {
  minX: 5.5, maxX: 9.2,
  minZ: 23.5, maxZ: 28.0,
};

/** Fixed size presets for daily box cargo — same overall bounds discipline
 * as the old CARGO_SIZE_PRESETS (cargo-data.ts) so nothing is too flat/thin
 * to grab or too big for the doorway/stairs, but a distinct list (this
 * round's boxes don't need label/route-compatibility concerns). */
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
