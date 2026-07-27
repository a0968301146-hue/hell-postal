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
 * bounded cells (spec: "收納櫃仍放在包裹整理區牆邊，不要移回前台房間") — same
 * wall anchor position as the old shelf, just a real fixture now. See
 * lost-found-cabinet-system.ts for the mesh/collider/slot-bounds this
 * config drives. */
export const LOST_FOUND_CABINET_COLUMNS = 4;
export const LOST_FOUND_CABINET_ROWS = 3;
/** One cell's outer footprint (before subtracting divider thickness for the
 * usable interior — see lost-found-cabinet-system.ts). Width runs along Z
 * (across the cabinet's face), height along Y, depth along X (into the
 * wall). Sized generously enough that most LOST_ITEM_PRESETS fit with no
 * shrinking at all; LostItemPreviewRenderer's/lost-found-system.ts's
 * auto-fit scaling (spec六) only kicks in for anything that would still
 * exceed 85% of the interior. */
export const LOST_FOUND_CABINET_CELL_WIDTH = 0.5;
export const LOST_FOUND_CABINET_CELL_HEIGHT = 0.5;
export const LOST_FOUND_CABINET_CELL_DEPTH = 0.4;
/** Divider panel thickness — subtracted from each cell's outer footprint to
 * get its usable interior (spec四: "明確隔板/獨立內部空間"). */
export const LOST_FOUND_CABINET_DIVIDER_THICKNESS = 0.04;
/** Cabinet's own anchor position — reuses the old shelf's exact spot. */
export const LOST_FOUND_CABINET_POS = { x: -9.65, z: 12.0 };
