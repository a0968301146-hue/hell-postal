import * as THREE from 'three';
import { BACK_AREA, LAND_GATE } from '../../systems/world-layout/logistics-layout-data';

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

/** Bridges BACK_AREA's own south wall gate (LAND_GATE, x in [-6,6] at
 * z=BACK_AREA.maxZ=32) to CAMPFIRE_AREA's own north edge (z=33, x starting
 * at 9) — bug fix ("玩家無法正常走到營火區域"): CAMPFIRE_AREA's own floor
 * was an entirely ISOLATED rectangle with nothing connecting it to the
 * building. LAND_GATE is the only opening in that wall, but the gate's own
 * X-range (-6..6) doesn't even overlap CAMPFIRE_AREA's (9..17) — a player
 * walking straight out the gate had no floor under them at all south of the
 * wall (land vehicles never needed one; they're kinematically animated, not
 * gravity-simulated). This one wide, shallow "yard" strip spans from the
 * gate's own west edge all the way to the campfire clearing's own east edge
 * so every straight-line path out the gate and east to the fire has solid
 * ground the whole way, with no seam at the shared z=33 edge with
 * CAMPFIRE_AREA's own floor. */
export const CAMPFIRE_ENTRY_CONNECTOR = {
  minX: LAND_GATE.centerX - LAND_GATE.halfWidth,
  maxX: CAMPFIRE_AREA.maxX,
  minZ: BACK_AREA.maxZ,
  maxZ: CAMPFIRE_AREA.minZ,
  floorY: CAMPFIRE_AREA.floorY,
};

/** "露營區地形擴建" round (spec: "露營區地面向西方延伸...延伸距離約等同主房
 * 子的寬度") — a second walkable floor patch directly west of CAMPFIRE_AREA's
 * own footprint, same Z-span (33..41) so it butts seamlessly against
 * CAMPFIRE_AREA's own west edge (x=9) with no gap/seam and no void between
 * them. Deliberately a SEPARATE rectangle rather than widening
 * CAMPFIRE_AREA itself — CAMPFIRE_CENTER/the four benches/the roasting
 * sticks are all derived from CAMPFIRE_AREA's own center, so widening that
 * rectangle asymmetrically would have shifted the campfire/NPC seats west
 * along with it (spec explicitly forbids moving them: "不要移動營火...不要
 * 移動NPC座標"). East/south/north of CAMPFIRE_AREA are untouched by this —
 * only a new patch of ground appears to the west. Width matches BACK_AREA's
 * own (the main hall's) width, spec's own "主房子的寬度" — an already-
 * existing area constant, not a new hardcoded number. */
export const CAMPFIRE_WEST_EXTENSION = {
  minX: CAMPFIRE_AREA.minX - (BACK_AREA.maxX - BACK_AREA.minX),
  maxX: CAMPFIRE_AREA.minX,
  minZ: CAMPFIRE_AREA.minZ,
  maxZ: CAMPFIRE_AREA.maxZ,
  floorY: CAMPFIRE_AREA.floorY,
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
