// Standalone spatial config for the west-side lost & found room and its
// related BACK_AREA furniture ("Expand modular lost found NPC flow" round).
// Kept entirely separate from logistics-layout-data.ts so this feature's own
// position/size/furniture/route spots aren't scattered across scene/system
// files.
//
// floorY/ceilingHeight below are plain literals rather than importing
// BACK_AREA from logistics-layout-data.ts — BACK_AREA.floorY is -1.5, so
// this room sits at the same level with no ramp/stairs needed — the literal
// avoids a circular import, since logistics-layout-data.ts's own
// WORLD_BOUNDS needs to import LOST_FOUND_ROOM from THIS file (see below).
//
// minX/maxX below are also literals: this room's east edge (x=-10) must
// match BACK_AREA.minX exactly, since scene-manager.ts's buildBackArea()
// cuts this room's own east door directly into BACK_AREA's own west wall
// rather than building a second wall on top of it. If BACK_AREA.minX ever
// changes, this room's minX/maxX must be updated to match.
export const LOST_FOUND_ROOM = {
  minX: -15, maxX: -10, // width 5, west of BACK_AREA's own west wall (x=-10)
  minZ: 14, maxZ: 19,   // depth 5
  floorY: -1.5,
  ceilingHeight: 3.2,   // a small room — shorter than BACK_AREA's own 6m hall
};

/** Gap cut into BACK_AREA's west wall (x = BACK_AREA.minX = this room's own
 * maxX) connecting the two rooms — the PLAYER's own route in/out. */
export const LOST_FOUND_DOOR = {
  centerZ: 16.5,
  halfWidth: 1.0, // door width 2m
};

/** Gap cut into THIS room's own west wall (x = LOST_FOUND_ROOM.minX) — the
 * outward-facing NPC gate ("Expand modular lost found NPC flow" round 二:
 * 西側NPC大門). The player never uses this one; it exists purely so the
 * daily NPC has somewhere to walk in/out from that isn't the player's own
 * BACK_AREA doorway. centerZ matches LOST_FOUND_NPC_SPAWN/
 * LOST_FOUND_NPC_WAIT_SPOT's own Z exactly, so the NPC's whole walk is one
 * straight line along X (see lost-found-npc-system.ts) that's guaranteed to
 * pass through this opening without needing intermediate waypoints. */
export const LOST_FOUND_NPC_GATE = {
  centerZ: 15.5,
  halfWidth: 0.9, // gate width 1.8m
};

/** Where the daily NPC spawns/despawns — outside the building, west of the
 * NPC gate (spec二: NPC從西側門外生成). Purely a void-space anchor point,
 * same convention as vehicle spawn/exit points sitting just outside their
 * own gates. */
export const LOST_FOUND_NPC_SPAWN = { x: -17.5, z: 15.5 };

/** Where the NPC stops and waits once arrived — WEST of the counter now
 * ("Expand lost found return storage and scoring" round 一: 櫃檯旋轉180度,
 * NPC等待位置同步旋轉到西側). Mirrored across LOST_FOUND_COUNTER.x from the
 * old east-side spot (was centerX+1.0, now centerX-1.0) — the player already
 * enters this room from the EAST (LOST_FOUND_DOOR, on BACK_AREA's own west
 * wall), so this rotation puts the NPC on the far side from the player's
 * natural approach, counter in between, exactly as spec requires ("玩家站在
 * 櫃檯另一側，雙方中間隔著櫃檯"). */
export const LOST_FOUND_NPC_WAIT_SPOT = { x: -13.5, z: 15.2 };

/** Intermediate waypoints the NPC walks through between LOST_FOUND_NPC_SPAWN
 * and LOST_FOUND_NPC_WAIT_SPOT (in that order for arrival; reversed, then
 * ending at LOST_FOUND_NPC_SPAWN, for departure). Empty this round — now
 * that the NPC's wait spot sits on the SAME (west) side of the room as its
 * own spawn/gate, a direct single-leg line from spawn to wait spot never
 * crosses the counter's footprint (counter spans x -12.85..-12.15; the
 * NPC's entire path stays at x <= -13.5, clear of it entirely), so the old
 * "duck around the counter's north end" detour is no longer needed. */
export const LOST_FOUND_NPC_ROUTE_WAYPOINTS: { x: number; z: number }[] = [];

/** Counter — a long north-south bar, rotated 180 degrees this round ("Expand
 * lost found return storage and scoring" round 一: 將目前失物招領櫃檯旋轉
 * 180度 — 若目前正面朝東，旋轉後應朝西). A plain symmetric box has no
 * visually distinct "facing" on its own — see lost-found-system.ts
 * buildCounter()'s raised back panel (now on the WEST edge, backing the
 * NPC's new west-side position) for the actual visual "facing west" cue;
 * the FUNCTIONAL orientation (who stands where) is enforced purely
 * positionally: LOST_FOUND_NPC_WAIT_SPOT.x < LOST_FOUND_COUNTER.x <
 * wherever the player is standing when
 * LostFoundSystem.isPlayerNearCounter() returns true — flipped from "< " to
 * "west of" this round, see that method. */
export const LOST_FOUND_COUNTER = { x: -12.5, z: 16.5 };
/** Counter footprint half-extents (X depth, Y height, Z length) — shared by
 * both the physics collider and the visual mesh (lost-found-system.ts).
 * Unchanged by the 180-degree rotation — a symmetric box's own footprint is
 * identical either way; only the back panel/NPC/interaction side flip. */
export const LOST_FOUND_COUNTER_HALF_EXTENTS = { x: 0.35, y: 0.45, z: 1.4 };

/** Lost-item storage cabinet — OUT of the small front room and into
 * BACK_AREA's own package-sorting area, against its west wall, north of the
 * player spawn/pallet cluster with open floor on every other side ("Expand
 * modular lost found NPC flow" round 一: 靠牆位置、保留足夠通道、不阻擋玩家
 * 整理貨物). "Expand lost found return storage and scoring" round 四: rebuilt
 * from a single themed-landmark shelf into a genuine grid of individually
 * bounded cells. "Fix lost found cabinet storage space" round: that grid's
 * cells previously had NO real open interior (a full-depth solid back panel
 * silently filled the whole footprint) — column count dropped 4->3 (still
 * comfortably ≥ the 6 lost items generated daily, at 3x3=9 cells) and each
 * cell's interior size is now DERIVED from the largest actual
 * LostItemPreset collider (see lost-found-cabinet-system.ts's
 * computeCellInteriorSize()) instead of a hand-picked constant. Only
 * columns/rows/structural-panel-thickness/wall-clearance stay here as plain
 * spatial config; the derived interior size intentionally lives in
 * lost-found-cabinet-system.ts since it needs LOST_ITEM_PRESETS (this file
 * stays pure spatial data, no preset/business knowledge). */
export const LOST_FOUND_CABINET_COLUMNS = 3;
export const LOST_FOUND_CABINET_ROWS = 3;
/** Thickness of the real structural panels a cell is actually built from —
 * left/right dividers, horizontal shelves, and the single rear back panel
 * ("Fix lost found cabinet storage space" round 一: Collider只能建立在外框/
 * 隔板/層板/背板；每一格正面入口必須完全沒有碰撞體). */
export const LOST_FOUND_CABINET_DIVIDER_THICKNESS = 0.05;
export const LOST_FOUND_CABINET_SHELF_THICKNESS = 0.05;
export const LOST_FOUND_CABINET_BACK_THICKNESS = 0.05;
/** Gap left between the cabinet's own back panel and the shared BACK_AREA/
 * LOST_FOUND_ROOM wall behind it (spec三: "將櫃子稍微離開牆面，避免背板或
 * 失物Collider卡進牆壁") — lost-found-cabinet-system.ts positions the
 * cabinet's back panel this far off that wall's own physical inner face. */
export const LOST_FOUND_CABINET_WALL_CLEARANCE = 0.15;
/** Cabinet's own Z anchor (center) — reuses the old shelf/cabinet's exact
 * spot, comfortably clear of the north wall (BACK_AREA.minZ=10) behind it
 * and PACKAGE_WORK_ZONE (z 14-19) ahead of it even at the cabinet's new,
 * larger footprint (see lost-found-cabinet-system.ts for the exact computed
 * span). X is no longer a fixed anchor — it's derived from
 * LOST_FOUND_CABINET_WALL_CLEARANCE plus the cabinet's own (data-derived)
 * depth, computed in lost-found-cabinet-system.ts. */
export const LOST_FOUND_CABINET_ANCHOR_Z = 12.0;
