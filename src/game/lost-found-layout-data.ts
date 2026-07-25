// Standalone spatial config for the west-side lost & found room ("Reduce
// daily cargo and add lost found desk" round 二: 西側新增小型前台房間). Kept
// entirely separate from logistics-layout-data.ts so the new room's own
// position/size/furniture spots aren't scattered across scene/system files.
//
// floorY/ceilingHeight below are plain literals rather than importing
// BACK_AREA from logistics-layout-data.ts — BACK_AREA.floorY is -1.5, so
// this room sits at the same level with no ramp/stairs needed — the literal
// avoids a circular import, since logistics-layout-data.ts's own
// WORLD_BOUNDS needs to import LOST_FOUND_ROOM from THIS file (see below).
//
// minX/maxX below are also literals: this room's east edge (x=-10) must
// match BACK_AREA.minX exactly, since scene-manager.ts's buildBackArea()
// cuts this room's door directly into BACK_AREA's own west wall rather than
// building a second wall on top of it (see buildLostFoundRoom's doc comment
// for why). If BACK_AREA.minX ever changes, this room's minX/maxX must be
// updated to match.
export const LOST_FOUND_ROOM = {
  minX: -15, maxX: -10, // width 5, west of BACK_AREA's own west wall (x=-10)
  minZ: 14, maxZ: 19,   // depth 5
  floorY: -1.5,
  ceilingHeight: 3.2,   // a small room — shorter than BACK_AREA's own 6m hall
};

/** Gap cut into BACK_AREA's west wall (x = BACK_AREA.minX = this room's own
 * maxX) connecting the two rooms — the ONLY opening into this room. */
export const LOST_FOUND_DOOR = {
  centerZ: 16.5,
  halfWidth: 1.0, // door width 2m
};

/** Counter desk — near the room's north wall. Player brings the correct
 * shelf item here and presses E to confirm a case (spec三). */
export const LOST_FOUND_COUNTER = { x: -12.4, z: 14.6 };

/** Where the customer NPC stands — just inside the doorway, so it's the
 * first thing the player sees on entering. */
export const LOST_FOUND_CUSTOMER_SPOT = { x: -11.2, z: 16.5 };

/** Lost-item shelf — against the room's west wall. Half-extents 0.2 (X) by
 * 0.9 (Z), so it spans x -14.8..-14.4 (clear of the west wall's own inner
 * face at -14.9) and z 16.7..18.5 (clear of the south wall at 19) — see
 * lost-found-system.ts buildShelf(). */
export const LOST_FOUND_SHELF = { x: -14.6, z: 17.6 };

/** Fixed slots ON TOP of the shelf, one per LOST_FOUND_ITEMS entry
 * (lost-found-data.ts) — spaced along Z within the shelf's own 16.7..18.5
 * span so items don't overlap or hang off the edge. */
export const LOST_FOUND_ITEM_SLOTS = [
  { x: -14.6, z: 17.0 },
  { x: -14.6, z: 17.6 },
  { x: -14.6, z: 18.2 },
];
