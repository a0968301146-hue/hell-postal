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

/** Where the NPC stops and waits once arrived — east of the counter ("Adjust
 * lost found counter orientation" round 一: NPC站在櫃檯東側). Sits near the
 * counter's own NORTH end (see LOST_FOUND_COUNTER's own doc comment for why
 * the counter is now a long north-south bar) — reachable from
 * LOST_FOUND_NPC_ROUTE_WAYPOINTS below without crossing the counter's own
 * footprint. */
export const LOST_FOUND_NPC_WAIT_SPOT = { x: -11.5, z: 15.2 };

/** Intermediate waypoints the NPC walks through between LOST_FOUND_NPC_SPAWN
 * and LOST_FOUND_NPC_WAIT_SPOT (in that order for arrival; reversed, then
 * ending at LOST_FOUND_NPC_SPAWN, for departure — spec二: "離開時沿相同路線
 * 走出" — see lost-found-npc-system.ts). Both waypoints sit at z=14.5,
 * north of the counter's own north edge (LOST_FOUND_COUNTER.z -
 * LOST_FOUND_COUNTER_HALF_EXTENTS.z = 15.1), so the whole route ducks around
 * the counter's north end instead of cutting straight through its now much
 * longer footprint ("Adjust lost found counter orientation" round 驗證: 互動
 * 不穿模). */
export const LOST_FOUND_NPC_ROUTE_WAYPOINTS = [
  { x: -13.3, z: 14.5 },
  { x: -11.5, z: 14.5 },
];

/** Counter — a long north-south bar ("Adjust lost found counter orientation"
 * round 二: 左右拉長，做成像之前前櫃那種長條型櫃檯), rotated so its face
 * opens EAST/WEST instead of north/south (round一: 正面朝向東方). A plain
 * symmetric box has no visually distinct "facing" on its own — see
 * lost-found-system.ts buildCounter()'s raised east-edge back panel for the
 * actual visual "facing east" cue; the FUNCTIONAL orientation (who stands
 * where) is enforced purely positionally: LOST_FOUND_NPC_WAIT_SPOT.x >
 * LOST_FOUND_COUNTER.x > wherever the player is standing when
 * LostFoundSystem.isPlayerNearCounter() returns true. */
export const LOST_FOUND_COUNTER = { x: -12.5, z: 16.5 };
/** Counter footprint half-extents (X depth, Y height, Z length) — shared by
 * both the physics collider and the visual mesh (lost-found-system.ts). Long
 * along Z (length 2.8m, "明顯比目前窄短版本更長" — was 0.5m), thin along X
 * (the east/west-facing depth). */
export const LOST_FOUND_COUNTER_HALF_EXTENTS = { x: 0.35, y: 0.45, z: 1.4 };

/** Relocated lost-item shelf — OUT of the small front room and into
 * BACK_AREA's own package-sorting area, against its west wall, north of the
 * player spawn/pallet/roller-rack cluster with open floor on every other
 * side ("Expand modular lost found NPC flow" round 一: 靠牆位置、保留足夠通
 * 道、不阻擋玩家整理貨物). Purely a themed landmark now — see
 * lost-found-system.ts buildShelf() — it no longer holds pre-placed decoy
 * items; the day's one real lost item instead bursts in from a north
 * unload port along with the regular cargo (spec六). */
export const LOST_FOUND_SHELF = { x: -9.65, z: 12.0 };
export const LOST_FOUND_SHELF_HALF_EXTENTS = { x: 0.25, y: 0.45, z: 0.9 };
