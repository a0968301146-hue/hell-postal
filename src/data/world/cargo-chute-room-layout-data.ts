// North cargo-chute room ("重製出貨口" round) — replaces the old dual
// NORTH_GATES wall-mounted unload docks entirely (spec一: "完全移除目前既有
// 的出貨口結構"). A single medium room north of BACK_AREA's own wall, with a
// single vertical chute mounted above it: cargo spawns invisibly at the top
// of the chute (HIGH_CARGO_SPAWN_POINT) and falls, under real physics, down
// into the room below (spec三/四).
//
// Room footprint reuses coffee-room-layout-data.ts's own documented "中型休
// 息室，尺寸約6m×6m" precedent verbatim (spec二: "如果專案內已有中型房間的標
// 準尺寸，直接沿用，不要自行創造新的尺寸") — only position and ceilingHeight
// differ (floorY/ceilingHeight match BACK_AREA for continuity with the hall
// this room extends, since it's functionally part of the same logistics
// building rather than a separate small side room like the coffee room).
//
// floorY/ceilingHeight/minZ/maxZ below are plain literals rather than
// importing BACK_AREA from logistics-layout-data.ts — mirrors lost-found-
// layout-data.ts's own identical reasoning: logistics-layout-data.ts's own
// WORLD_BOUNDS needs to import THIS room's footprint, so this file must not
// import back from it (would create a real circular import). BACK_AREA.minZ
// is 12, BACK_AREA.floorY is -1.5, BACK_AREA.ceilingHeight is 6 — if any of
// those ever change, this room's own numbers below must be updated to match.
export const CARGO_CHUTE_ROOM = {
  minX: -3, maxX: 3, // width 6 (medium-room precedent)
  minZ: 6, maxZ: 12,  // depth 6, directly north of BACK_AREA's own wall (minZ=12)
  floorY: -1.5,        // matches BACK_AREA.floorY — same level, no ramp/stairs needed
  ceilingHeight: 6,    // matches BACK_AREA.ceilingHeight, for continuity with the hall
};

/** Doorway connecting BACK_AREA's own north wall to this room — the ONLY
 * opening between the two (spec: player must be able to walk from the
 * existing hall straight into the new room). Replaces NORTH_GATES' old
 * dual-gap wall entirely; BACK_AREA's own north wall is gapped here (see
 * world-layout-system.ts's buildBackArea), and this room's own south side
 * deliberately builds NO separate wall of its own (mirrors
 * buildLostFoundRoom's established "shared wall, only one side actually
 * builds it" convention for two adjoining rooms). */
export const CARGO_CHUTE_DOORWAY = {
  centerX: 0,
  halfWidth: 1.8, // 3.6m wide opening
};

/** The vertical pipe/chute mounted on the room's own roofline, extending
 * well above its ceilingHeight — this IS the spec's "不可視區域" (spec三):
 * from inside the room, standing on the floor, the pipe's interior sits
 * well above the visible room (its own opaque housing walls, built in
 * unloading-system.ts, occlude it from any normal standing/looking angle).
 * Interior footprint (4.2×4.2) is comfortably larger than every cargo
 * preset including the Day8 giant cake (2.4×2.0×2.4, cargo-shape-
 * presets.ts's GIANT_CAKE_BOX_PRESET) — same "generous safety margin"
 * reasoning the old NORTH_GATES opening (~3.9m) used. wallThickness (0.2)
 * duplicates logistics-layout-data.ts's own WALL_THICKNESS literal — same
 * "avoid a circular import" reasoning as this file's own header comment. */
const PIPE_BASE_Y = CARGO_CHUTE_ROOM.floorY + CARGO_CHUTE_ROOM.ceilingHeight; // where the pipe meets the room's own roofline
const PIPE_HEIGHT = 5.0;
export const CARGO_CHUTE_PIPE = {
  centerX: CARGO_CHUTE_DOORWAY.centerX,
  centerZ: (CARGO_CHUTE_ROOM.minZ + CARGO_CHUTE_ROOM.maxZ) / 2,
  baseY: PIPE_BASE_Y,
  topY: PIPE_BASE_Y + PIPE_HEIGHT,
  width: 4.2,
  depth: 4.2,
  wallThickness: 0.2,
};

/** THE single cargo/mail/lost-item spawn location (spec四: "所有貨物統一由
 * HIGH_CARGO_SPAWN_POINT 之類的單一生成位置控制...生成點位於管道最高處／玩
 * 家正常視角不可見的位置") — sits 1m below the pipe's own top, safely inside
 * its opaque housing. unloading-system.ts/mail-system.ts/lost-found-
 * system.ts all read this ONE point (with small per-item jitter for visual
 * variety, never a second independent spawn location). */
export const HIGH_CARGO_SPAWN_POINT = {
  x: CARGO_CHUTE_PIPE.centerX,
  y: CARGO_CHUTE_PIPE.topY - 1.0,
  z: CARGO_CHUTE_PIPE.centerZ,
};

/** Horizontal hatch/trapdoor at the pipe's base (spec: the visual "gate"
 * open/close cue, reusing the exact same open/close animation timing the
 * old vertical wall-gate used — see unloading-system.ts's own gateAnimT
 * lerp, unchanged, just applied to a horizontal panel's Y position instead
 * of a vertical panel's Y position). Purely cosmetic — floats well above
 * player height (PIPE_BASE_Y = room floor + 6), so unlike the old vertical
 * wall-gate (which sat in a passable opening a player could otherwise walk
 * through) this needs no permanent player-blocking safety collider. */
export const CARGO_CHUTE_HATCH = {
  centerX: CARGO_CHUTE_PIPE.centerX,
  centerZ: CARGO_CHUTE_PIPE.centerZ,
  closedY: PIPE_BASE_Y,
  openOffsetY: 1.5, // slides straight up into the pipe when open
  width: CARGO_CHUTE_PIPE.width - 0.4,
  depth: CARGO_CHUTE_PIPE.depth - 0.4,
  thickness: 0.12,
  openDuration: 0.8, // matches the old gate's own timing (spec's own 0.6-1s window)
};

/** 開始卸貨／結束今天 button posts — relocated from their old position
 * (west of the west-most NORTH_GATES gate) to just west of this room's own
 * single doorway, still inside BACK_AREA itself (same "buttons live in the
 * hall, not inside the drop room" convention as before). z values duplicate
 * BACK_AREA.minZ (12) + fixed offsets — same "avoid a circular import"
 * reasoning as this file's own header comment. */
export const CARGO_CHUTE_BUTTON_POS = { x: -(CARGO_CHUTE_DOORWAY.halfWidth + 1.5), z: 12 + 1.2 };
export const CARGO_CHUTE_END_DAY_BUTTON_POS = { x: -(CARGO_CHUTE_DOORWAY.halfWidth + 1.5), z: 12 + 2.8 };
