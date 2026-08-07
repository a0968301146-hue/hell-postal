import * as THREE from 'three';

/** "每日特殊劇情系統" round — Day6 (營火晚會) and Day8's finale ending both
 * happen here (spec: "陸運出口外側，延伸一塊戶外空地"). Sits south of
 * BACK_AREA's own south wall (LAND_GATE, z=BACK_AREA.maxZ=32) in the open
 * void space between the wall and the far land-vehicle spawn/exit point
 * (LAND_SPAWN_Z=49) — no built geometry exists there today (confirmed: only
 * data anchors, LAND_DOCK_SLOTS stay north of the wall at z=28). Offset well
 * east of the vehicle lane (LAND_GATE spans x -6..6) so it never blocks
 * traffic through the gate. */
export const CAMPFIRE_AREA = {
  minX: 9, maxX: 17,   // width 8, east of the vehicle lane (clears x=6 by 3m)
  minZ: 33, maxZ: 41,  // depth 8, starts 1m south of the back-area wall
  floorY: -1.5,        // same floor level — no ramp/stairs needed
};

const areaCx = (CAMPFIRE_AREA.minX + CAMPFIRE_AREA.maxX) / 2;
const areaCz = (CAMPFIRE_AREA.minZ + CAMPFIRE_AREA.maxZ) / 2;

/** The campfire itself, center of the clearing (spec: "營火、木頭、四周石頭
 * 、木頭長椅、烤棉花糖架"). */
export const CAMPFIRE_CENTER = new THREE.Vector3(areaCx, CAMPFIRE_AREA.floorY, areaCz);

/** Four log benches around the fire, one per compass side — Day6's own
 * player+NPC pair sits on two of them (north/south), Day8's finale later
 * reuses ALL four for the scattered reunion + the player's own "sit down to
 * end the game" trigger seat (south bench, facing the fire). */
const BENCH_RADIUS = 1.6;
export const CAMPFIRE_BENCH_NORTH = new THREE.Vector3(areaCx, CAMPFIRE_AREA.floorY, areaCz - BENCH_RADIUS);
export const CAMPFIRE_BENCH_SOUTH = new THREE.Vector3(areaCx, CAMPFIRE_AREA.floorY, areaCz + BENCH_RADIUS);
export const CAMPFIRE_BENCH_EAST = new THREE.Vector3(areaCx + BENCH_RADIUS, CAMPFIRE_AREA.floorY, areaCz);
export const CAMPFIRE_BENCH_WEST = new THREE.Vector3(areaCx - BENCH_RADIUS, CAMPFIRE_AREA.floorY, areaCz);

export const CAMPFIRE_LOOK_TARGET = new THREE.Vector3(areaCx, CAMPFIRE_AREA.floorY + 0.6, areaCz);

/** Day6's own story NPC — spawns just outside the clearing (north, from the
 * direction of the back-area gate) and walks in to the north bench, mirroring
 * every other story day's own short "walk in from just off the scene" beat. */
export const CAMPFIRE_NPC_SPAWN = { x: areaCx, z: CAMPFIRE_AREA.minZ - 1.5 };
export const CAMPFIRE_NPC_WAIT_SPOT = { x: CAMPFIRE_BENCH_NORTH.x, z: CAMPFIRE_BENCH_NORTH.z };

/** Marshmallow-roasting sticks, leaning against the stone ring — purely
 * decorative, clustered near the west bench, out of the walking lane. */
export const CAMPFIRE_STICK_A = new THREE.Vector3(areaCx - 0.9, CAMPFIRE_AREA.floorY, areaCz - 0.5);
export const CAMPFIRE_STICK_B = new THREE.Vector3(areaCx - 0.9, CAMPFIRE_AREA.floorY, areaCz - 0.2);
