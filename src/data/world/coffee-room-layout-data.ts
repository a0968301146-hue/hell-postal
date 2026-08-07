import * as THREE from 'three';

/** "每日特殊劇情系統" round — the Day2/Day4 coffee room (spec: "在失物招領房
 * 間南方，新增一間中型休息室，尺寸約6m×6m"), sharing LOST_FOUND_ROOM's own
 * south wall as this room's own north boundary (exactly mirroring how
 * LOST_FOUND_ROOM itself reuses BACK_AREA's west wall rather than building a
 * redundant second one) — a new door gap is cut into THAT wall
 * (COFFEE_ROOM_DOOR below), not a separate one here. X-range overlaps
 * LOST_FOUND_ROOM's own (-15..-10) so the shared wall segment is real,
 * structural continuity, not two disjoint walls happening to touch. */
export const COFFEE_ROOM = {
  minX: -16, maxX: -10, // width 6
  minZ: 19, maxZ: 25,   // depth 6 — minZ = LOST_FOUND_ROOM.maxZ (shared wall)
  floorY: -1.5,
  ceilingHeight: 3.0,
};

/** Gap cut into LOST_FOUND_ROOM's own south wall (world-layout-system.ts's
 * buildLostFoundRoom) — the ONLY route between the two rooms, same
 * solid-before/gap/solid-after convention as LOST_FOUND_DOOR/
 * LOST_FOUND_NPC_GATE. centerX sits within BOTH rooms' shared X-overlap
 * (-15..-10). */
export const COFFEE_ROOM_DOOR = {
  centerX: -12.5,
  halfWidth: 1.0, // door width 2m
};

const roomCx = (COFFEE_ROOM.minX + COFFEE_ROOM.maxX) / 2;

/** Table + two chairs, roughly centered (spec: "咖啡桌、兩張椅子、桌上兩杯
 * 咖啡"), facing each other across the table — reused by both Day2 (咖啡
 * 時間) and Day4 (投影機回憶, same room, different furniture focus). */
export const COFFEE_TABLE_CENTER = new THREE.Vector3(roomCx, COFFEE_ROOM.floorY, 22.2);
export const COFFEE_CHAIR_PLAYER = new THREE.Vector3(roomCx, COFFEE_ROOM.floorY, 23.0);
export const COFFEE_CHAIR_NPC = new THREE.Vector3(roomCx, COFFEE_ROOM.floorY, 21.4);
export const COFFEE_LOOK_TARGET = new THREE.Vector3(roomCx, COFFEE_ROOM.floorY + 1.2, 21.4);

/** Day2/4 story NPC's own spawn/wait — both inside the room already (no
 * outside-the-building void anchor needed, unlike the lost-found NPC), a
 * short 2m walk-in from just past the door to the NPC's own chair, entirely
 * over open floor. */
export const COFFEE_NPC_SPAWN = { x: roomCx, z: 20.2 };
export const COFFEE_NPC_WAIT_SPOT = { x: COFFEE_CHAIR_NPC.x, z: COFFEE_CHAIR_NPC.z };

/** Day4-only: a small projector + screen against the room's own south wall
 * (spec: "投影布幕、投影機，播放照片/短影片") — built as permanent room
 * furniture (simpler than conditionally spawning it just for one day), a
 * plain colored plane standing in for a screen (no real video asset
 * pipeline in this prototype) that Day4's own story step swaps a few solid-
 * color "slide" textures on with a caption, purely via material color +
 * label text, matching this codebase's own established whitebox-prototype
 * convention elsewhere (no new asset/video system). */
export const COFFEE_PROJECTOR_SCREEN_CENTER = new THREE.Vector3(roomCx, COFFEE_ROOM.floorY + 1.6, COFFEE_ROOM.maxZ - 0.15);
export const COFFEE_PROJECTOR_POS = new THREE.Vector3(roomCx, COFFEE_ROOM.floorY + 2.6, COFFEE_ROOM.minZ + 0.6);
