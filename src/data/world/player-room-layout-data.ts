import * as THREE from 'three';

// Player's private bedroom ("主角房間" round, spec: "位於物流中心東北方牆角，
// 朝北側延伸") — sits north of BACK_AREA's own north wall (BACK_AREA.minZ),
// flush against the line of BACK_AREA's own east wall (BACK_AREA.maxX),
// directly east of CARGO_CHUTE_ROOM (x -3..3) with open void space between
// the two (same loose-tolerance spacing every other room in this file
// already uses — e.g. CARGO_CHUTE_ROOM's own maxZ sits 2m past BACK_AREA's
// actual wall line, see that file's own doc comment).
//
// floorY/ceilingHeight/minX/maxX/maxZ below are plain literals rather than
// importing BACK_AREA from logistics-layout-data.ts — same "avoid a circular
// import" reasoning cargo-chute-room-layout-data.ts/lost-found-layout-
// data.ts both already document (logistics-layout-data.ts's own WORLD_BOUNDS
// needs to import THIS room's footprint below). BACK_AREA.maxX is 10,
// BACK_AREA.minZ is 10 — if either ever changes, this room's own
// maxX/maxZ must be updated to match, exactly like those two existing rooms
// already warn.
//
// This round is scene-only (spec: "只需要做場景空間＋基本家具配置...不要新增
// 睡覺、休息、時間推進、存檔或其他遊戲功能") — no interactable registration,
// no InteractionSystem wiring, purely static geometry + colliders, same as
// COFFEE_ROOM's own furniture (a plain static-cuboid collider per piece,
// nothing registered into the shared `interactables` map).
//
// Reuses the "medium room, 6m×6m" precedent COFFEE_ROOM/CARGO_CHUTE_ROOM both
// already established (spec: "如果專案內已有中型房間的標準尺寸，直接沿用，不
// 要自行創造新的尺寸").
export const PLAYER_ROOM = {
  minX: 4, maxX: 10, // width 6, flush with BACK_AREA's own east wall (x=10)
  minZ: 4, maxZ: 10, // depth 6, north of BACK_AREA's own north wall (z=10)
  floorY: -1.5,        // matches BACK_AREA.floorY — same level, no ramp/stairs needed
  ceilingHeight: 3.0,  // a cozy bedroom, not the full 6m hall height — mirrors COFFEE_ROOM's own 3.0
};

/** Gap cut into BACK_AREA's own north wall (world-layout-system.ts's
 * buildBackArea) — the ONLY route between the hall and this room, same
 * solid-before/gap/solid-after convention as CARGO_CHUTE_DOORWAY immediately
 * west of it on the same wall. Sits inside that wall's existing east solid
 * segment (x 1.8..10, i.e. entirely east of CARGO_CHUTE_DOORWAY's own gap),
 * with real solid wall remaining on both sides (4.2m to the west, 2.0m to
 * the northeast corner post at x=10). */
export const PLAYER_ROOM_DOOR = {
  centerX: 7,
  halfWidth: 1.0, // door width 2m
};

const roomCx = (PLAYER_ROOM.minX + PLAYER_ROOM.maxX) / 2; // 7
const roomCz = (PLAYER_ROOM.minZ + PLAYER_ROOM.maxZ) / 2; // 7

/** Bed — against the room's own north wall, west portion (spec: "床靠牆"),
 * clear of the door's own north-south sightline (PLAYER_ROOM_DOOR's gap
 * spans x 6..8) so it never blocks the entrance. `sizeX`/`sizeZ` are plain
 * world-space extents (matching THREE.BoxGeometry's own width/depth
 * parameter order directly) — not the wall-relative width/depth naming
 * WestWallShelfConfig uses, since this room's furniture sits against three
 * different wall orientations rather than just one. */
export const PLAYER_BED = {
  centerX: 5.0, centerZ: 5.2,
  sizeX: 1.4, sizeZ: 2.0, height: 0.5,
};

/** Wardrobe/cabinet — against the room's own west wall, just south of the
 * bed's own footprint (spec: "櫃子靠近床"), with real clearance between the
 * two (bed's own south edge at z=6.2, wardrobe's own north edge at z=6.8). */
export const PLAYER_WARDROBE = {
  centerX: 4.5, centerZ: 7.3,
  sizeX: 0.6, sizeZ: 1.0, height: 1.8,
};

/** Desk — against the room's own east wall (spec: "書桌靠牆"), north portion
 * so its own chair (below) has open floor toward the room's own center
 * rather than being wedged into a corner. */
export const PLAYER_DESK = {
  centerX: 9.5, centerZ: 5.0,
  sizeX: 0.6, sizeZ: 1.2, height: 0.75,
};

/** Chair — directly in front of the desk, facing west toward it (spec:
 * "椅子放在書桌前"). */
export const PLAYER_CHAIR = new THREE.Vector3(8.8, PLAYER_ROOM.floorY, 5.0);

export const PLAYER_ROOM_LABEL_POS = new THREE.Vector3(
  roomCx, PLAYER_ROOM.floorY + PLAYER_ROOM.ceilingHeight - 0.5, roomCz
);

/** "每日起床＋夢境漫畫" round — where the player teleports to at the start of
 * each day (spec二: "玩家出生在床的旁邊、面向房間內部、確保角色碰撞體不會與
 * 床、牆、家具重疊"). East of the bed's own footprint (PLAYER_BED spans x
 * 4.3..5.7) with real clearance (bed's east edge 5.7, this spot's x 6.2 — a
 * 0.5m gap), well clear of every other piece of furniture (PLAYER_WARDROBE
 * x 4.2..4.8/z 6.8..7.8, PLAYER_DESK x 9.2..9.8/z 4.4..5.6) and every wall
 * (PLAYER_ROOM spans x 4..10/z 4..10). `facingYaw` follows the same
 * convention MAIN_ROOM_CENTER_SPAWN (logistics-layout-data.ts) already
 * documents — THREE's own rotation.y, 0 = local -Z = Compass North — so
 * Math.PI faces south, toward the room's own open floor and door
 * (PLAYER_ROOM_DOOR sits on the south wall), i.e. "面向房間內部" (spec). `y`
 * is FLOOR-space (mirrors PLAYER_CHAIR/fishingSeatAnchorA's own convention,
 * not a baked-in eye-height) — the teleport code applies the same
 * body/camera Y offsets AfterWorkStorySystem.teleportToMainRoomCenter()
 * already uses (floorY + 0.9 body, +0.6 more for camera) for consistency. */
export const PLAYER_ROOM_BEDSIDE_SPAWN = {
  x: PLAYER_BED.centerX + PLAYER_BED.sizeX / 2 + 0.5,
  y: PLAYER_ROOM.floorY,
  z: PLAYER_BED.centerZ,
  facingYaw: Math.PI,
};
