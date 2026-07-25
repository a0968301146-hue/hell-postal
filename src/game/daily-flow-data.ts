// Centralized spatial + count data for the "每日貨品清空核心流程" loop
// (unload -> sort -> ship -> end day). Kept separate from
// logistics-layout-data.ts (which owns the older counter/vehicle-era zones)
// so this round's new geometry isn't scattered across scene/system files.
// NORTH_GATE is the one exception — it lives in logistics-layout-data.ts
// because scene-manager.ts's buildBackArea() needs it alongside the
// existing LAND_GATE/SEA_GATE constants it already imports from there.
//
// "刪除北邊房間" round: the separate front-office room the unload dock used
// to sit inside has been removed entirely — the back area is now the whole
// building, and the unload dock is mounted directly on ITS OWN north wall
// (all positions below are now BACK_AREA-relative). PALLET_CONFIG/
// ROLLER_RACK_CONFIG stay unchanged (still back-area furniture, untouched
// by this round).
import { BACK_AREA, NORTH_GATE } from './logistics-layout-data';

const FLOOR_Y = BACK_AREA.floorY;

/** How many cargo items spawn each day, fixed (spec "貨品外型與比例有更多
 * 變化" round section二: no infinite spawn, no per-day variation of the
 * total or the box/roller/large ratio). This is the ONE place the daily
 * total is defined — UnloadingSystem builds its spawn plan from these
 * counts, and DailyFlowSystem/HUD/vehicle-shipment counting/departure-time
 * scoring/next-day cleanup all read the ACTUAL number of ids
 * UnloadingSystem registers (registerDailyCargo), never this constant
 * directly, so nothing else needed to change when this round scaled the
 * total ×10 (spec "北側到貨量 ×10": 18→180, exact same 12:4:2 box:roller:
 * large ratio, now 120:40:20 — 不要在多個系統中分別寫死180). */
export const DAILY_CARGO_CONFIG = {
  total: 180,
  boxCount: 120,
  rollerCount: 40,
  largeCount: 20,
};

/** Wall opening + short slide the gate sits in front of. Chute runs along Z
 * (north->south, into the back area) — gentle slope (rise 0.35 over run
 * 1.8, ~11°) — steep enough to visibly "slide" cargo into the room,
 * shallow enough that CCD-enabled dynamic boxes/rollers don't build up
 * enough speed to tunnel or fly on landing. */
export const UNLOAD_CHUTE = {
  topX: NORTH_GATE.centerX,
  topY: FLOOR_Y + 0.35,
  topZ: BACK_AREA.minZ + 0.15,
  bottomX: NORTH_GATE.centerX,
  bottomZ: BACK_AREA.minZ + 1.95,
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
  centerZ: BACK_AREA.minZ,
  width: NORTH_GATE.halfWidth * 2 - 0.1,
  height: BACK_AREA.ceilingHeight,
  thickness: 0.15,
  openOffsetY: BACK_AREA.ceilingHeight, // raises it fully clear of the opening
  openDuration: 0.8, // seconds, within spec's 0.6-1s window
};

/** Several distinct spawn points spread across the gate's own width (spec
 * "貨品外型與比例有更多變化" round section四: "必要時使用數個不同噴射生成
 * 點，而不是所有貨物共用完全相同座標") — each still comfortably inside the
 * physical chute (chute half-width ~1.7, these stay within ±0.8). */
export const UNLOAD_SPAWN_POINTS = [
  { x: UNLOAD_CHUTE.topX - 0.8, z: UNLOAD_CHUTE.topZ + 0.2 },
  { x: UNLOAD_CHUTE.topX, z: UNLOAD_CHUTE.topZ + 0.3 },
  { x: UNLOAD_CHUTE.topX + 0.8, z: UNLOAD_CHUTE.topZ + 0.2 },
];
/** Small per-item spawn-point jitter on top of whichever UNLOAD_SPAWN_POINTS
 * entry is used, so consecutive items from the same point still don't spawn
 * exactly stacked. */
export const UNLOAD_SPAWN_JITTER_X = 0.3;
export const UNLOAD_SPAWN_JITTER_Z = 0.25;

/** Burst/jet unload performance (spec section三/四/五) — replaces the old
 * one-at-a-time gentle slide. All spawn-sequence timing/velocity tuning
 * lives here, not scattered across UnloadingSystem's methods. */
export const UNLOAD_BURST_CONFIG = {
  /** How many waves the day's cargo splits into, and a brief charge-up
   * before the first wave fires (spec 三: "裝置短暫蓄力"). Scaled ×10
   * alongside DAILY_CARGO_CONFIG.total (spec "北側到貨量 ×10" section:
   * "仍分批噴出，不要一次生成180件，避免物理卡頓") so each wave still only
   * drops 6 items at a time (180/30 — same per-wave batch size the
   * original 18/3 config used), rather than 60 items landing in the same
   * small drop zone within one wave. */
  waveCount: 30,
  chargeUpDuration: 0.4,
  /** Pause between waves (spec四: "每波之間短暫停頓"). */
  waveGapMin: 0.5,
  waveGapMax: 0.7,
  /** Per-item spacing within one wave (spec四: "0.08~0.18秒"). */
  itemIntervalMin: 0.08,
  itemIntervalMax: 0.18,
  /** Launch velocity ranges (spec四). Forward = +Z (into the room), up = +Y,
   * lateral = world X. */
  forwardSpeedMin: 4, forwardSpeedMax: 7,
  upSpeedMin: 0.5, upSpeedMax: 2,
  lateralSpeedMin: -1.5, lateralSpeedMax: 1.5,
  /** Angular velocity range applied at launch (rad/s per axis) — spec: "貨
   * 物在空中帶有不同角度與旋轉". */
  angularSpeedMax: 4,
  /** How long after the last item launches before the gate starts closing
   * (lets the burst finish settling — spec三 step7 "最後一件噴出後，閘門關
   * 閉" — a short buffer avoids clipping the last item's flight). */
  settleAfterLastItem: 0.8,
};

/** Open floor where the pile lands and gets broken apart — the back area's
 * own north end, well clear of the player spawn (z=14.8, see
 * logistics-layout-data.ts PLAYER_SPAWN) and the pallet (z=15.5). */
export const UNLOAD_ZONE = {
  minX: NORTH_GATE.centerX - NORTH_GATE.halfWidth + 0.3, maxX: NORTH_GATE.centerX + NORTH_GATE.halfWidth - 0.3,
  minZ: BACK_AREA.minZ + 0.3, maxZ: BACK_AREA.minZ + 4.3,
};

/** Wall-side pos for the two unloading-control buttons — off to the west
 * side of the gate opening (clear of NORTH_GATE's own X range and the
 * chute/drop path), spaced apart from each other in Z. Both sit just inside
 * the back area's own north wall (spec section 十九: grouped under "北側卸
 * 貨區"). */
export const UNLOAD_BUTTON_POS = { x: NORTH_GATE.centerX - NORTH_GATE.halfWidth - 2.0, z: BACK_AREA.minZ + 1.2 };
export const END_DAY_BUTTON_POS = { x: NORTH_GATE.centerX - NORTH_GATE.halfWidth - 2.0, z: BACK_AREA.minZ + 2.8 };

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

// Daily box/roller/large size+shape+color+label presets moved to
// cargo-data.ts (CARGO_BOX_PRESETS/CARGO_ROLLER_PRESETS/CARGO_LARGE_PRESETS,
// spec "貨品外型與比例有更多變化" round section六/七/八) — cargo identity is
// now bound together in ONE place alongside its subtype/label, rather than
// living here as a bare size list.

/** Score deducted PER unshipped (or wrong-vehicle) today's-cargo item at
 * departure settlement ("Add six cargo vehicles and unrestricted departure
 * scoring" round section二) — the ONE place this number is defined;
 * vehicle-control-system.ts reads it rather than hardcoding a value inline. */
export const UNSHIPPED_PENALTY_PER_ITEM = 1;
