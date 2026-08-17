// Visual/physical construction for the main building's own side rooms/areas
// (north cargo-chute room, west lost-found room, Day2/4 coffee room, player
// bedroom, outdoor campfire area) — split out of world-layout-system.ts
// during the "world-layout per-area modularization" round (pure move, no
// behavior change). Grouped into one file per explicit instruction (each is
// a single builder function, all "side rooms" of the main building). See
// world-layout-system.ts's own createLogisticsScene() for the dispatch/
// composition entry point that calls into these.
import * as THREE from 'three';
import { PhysicsWorldPort } from '../../shared/types/physics-world-port';
import { WALL_THICKNESS } from './logistics-layout-data';
import { CARGO_CHUTE_ROOM } from '../../data/world/cargo-chute-room-layout-data';
import { LOST_FOUND_ROOM, LOST_FOUND_NPC_GATE } from '../../data/world/lost-found-layout-data';
import {
  COFFEE_ROOM, COFFEE_ROOM_DOOR, COFFEE_TABLE_CENTER, COFFEE_CHAIR_PLAYER, COFFEE_CHAIR_NPC,
  COFFEE_PROJECTOR_SCREEN_CENTER, COFFEE_PROJECTOR_POS,
} from '../../data/world/coffee-room-layout-data';
import {
  PLAYER_ROOM, PLAYER_BED, PLAYER_WARDROBE, PLAYER_DESK, PLAYER_CHAIR, PLAYER_ROOM_LABEL_POS,
} from '../../data/world/player-room-layout-data';
import {
  CAMPFIRE_AREA, CAMPFIRE_CENTER, CAMPFIRE_BENCH_NORTH, CAMPFIRE_BENCH_SOUTH, CAMPFIRE_BENCH_EAST, CAMPFIRE_BENCH_WEST,
  CAMPFIRE_STICK_A, CAMPFIRE_STICK_B, CAMPFIRE_ENTRY_CONNECTOR, CAMPFIRE_WEST_EXTENSION,
} from '../../data/world/campfire-area-data';
import { createFloatingLabel } from '../../adapters/three/world-label-system';
import { stdMat, addWall } from './world-layout-shared';

/** North cargo-chute room ("重製出貨口" round spec二) — a medium room
 * (data/world/cargo-chute-room-layout-data.ts's own CARGO_CHUTE_ROOM,
 * reusing the coffee room's documented 6m×6m precedent) sitting directly
 * against BACK_AREA's own north wall, already gapped at CARGO_CHUTE_DOORWAY
 * (see buildBackArea above). Only north/west/east walls are built here —
 * the south side is intentionally left open, mirroring buildLostFoundRoom's
 * own "shared wall, only one side actually builds it" convention for two
 * adjoining rooms (BACK_AREA's own north wall already covers that
 * boundary). The vertical chute/hatch/spawn-point geometry itself is NOT
 * built here — that's UnloadingSystem's own furniture, same "structural
 * walls here, feature geometry in its own system" split every other room in
 * this file follows. */
export function buildCargoChuteRoom(scene: THREE.Scene, physics: PhysicsWorldPort): THREE.Mesh {
  const { minX, maxX, minZ, maxZ, floorY, ceilingHeight } = CARGO_CHUTE_ROOM;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const floorGeo = new THREE.PlaneGeometry(width, depth);
  const floor = new THREE.Mesh(floorGeo, stdMat(0x55554e));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, floorY, cz);
  scene.add(floor);
  physics.createStaticCuboid(cx, floorY - WALL_THICKNESS / 2, cz, width / 2, WALL_THICKNESS / 2, depth / 2);

  const wallMat = stdMat(0x707070, { side: THREE.DoubleSide });
  const midY = floorY + ceilingHeight / 2;

  addWall(scene, physics, wallMat, cx, midY, minZ, width, ceilingHeight, WALL_THICKNESS); // north wall (solid)
  addWall(scene, physics, wallMat, minX, midY, cz, WALL_THICKNESS, ceilingHeight, depth); // west wall
  addWall(scene, physics, wallMat, maxX, midY, cz, WALL_THICKNESS, ceilingHeight, depth); // east wall

  const roomLabel = createFloatingLabel('北側集中出貨區', { width: 1.0, bg: 'rgba(30,30,20,0.75)' });
  roomLabel.position.set(cx, floorY + ceilingHeight - 0.6, cz);
  scene.add(roomLabel);

  return floor;
}

/** West-side lost & found room ("Reduce daily cargo and add lost found
 * desk" round 二) — its own small enclosed shell (floor + north/south/west
 * walls), sitting directly against BACK_AREA's own west wall, which is
 * already gapped (see buildBackArea above) at the matching LOST_FOUND_DOOR
 * position (the PLAYER's own route in/out). No separate east wall is built
 * here — BACK_AREA's own west wall already covers that boundary. This
 * room's own WEST wall ("Expand modular lost found NPC flow" round 二: 西側
 * NPC大門) is now itself gapped at LOST_FOUND_NPC_GATE — the daily NPC's own
 * route in/out, entirely separate from the player's door. Furniture
 * (counter/shelf/NPC) is NOT built here — see lost-found-system.ts/
 * lost-found-npc-system.ts, same split as every other system building its
 * own furniture while structural walls stay in this file. */
export function buildLostFoundRoom(scene: THREE.Scene, physics: PhysicsWorldPort): THREE.Mesh {
  const { minX, maxX, minZ, maxZ, floorY, ceilingHeight } = LOST_FOUND_ROOM;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const floorGeo = new THREE.PlaneGeometry(width, depth);
  const floor = new THREE.Mesh(floorGeo, stdMat(0x4a4a42));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, floorY, cz);
  scene.add(floor);
  physics.createStaticCuboid(cx, floorY - WALL_THICKNESS / 2, cz, width / 2, WALL_THICKNESS / 2, depth / 2);

  const wallMat = stdMat(0x5a5a52, { side: THREE.DoubleSide });
  const midY = floorY + ceilingHeight / 2;

  addWall(scene, physics, wallMat, cx, midY, minZ, width, ceilingHeight, WALL_THICKNESS); // north

  // South wall — "每日特殊劇情系統" round: gapped for COFFEE_ROOM_DOOR, the
  // ONLY route into the new Day2/Day4 coffee room just south of here (same
  // solid-before/gap/solid-after pattern as the west wall's own NPC gate
  // just below).
  const coffeeGapL = COFFEE_ROOM_DOOR.centerX - COFFEE_ROOM_DOOR.halfWidth;
  const coffeeGapR = COFFEE_ROOM_DOOR.centerX + COFFEE_ROOM_DOOR.halfWidth;
  addWall(scene, physics, wallMat, (minX + coffeeGapL) / 2, midY, maxZ, coffeeGapL - minX, ceilingHeight, WALL_THICKNESS);
  addWall(scene, physics, wallMat, (coffeeGapR + maxX) / 2, midY, maxZ, maxX - coffeeGapR, ceilingHeight, WALL_THICKNESS);

  // West wall — gap for the NPC's own outward-facing gate, same
  // solid-before/solid-after pattern as every other gate opening in this
  // file (mirrors the room's own east opening cut into BACK_AREA's wall in
  // buildBackArea above).
  const npcGapL = LOST_FOUND_NPC_GATE.centerZ - LOST_FOUND_NPC_GATE.halfWidth;
  const npcGapR = LOST_FOUND_NPC_GATE.centerZ + LOST_FOUND_NPC_GATE.halfWidth;
  addWall(scene, physics, wallMat, minX, midY, (minZ + npcGapL) / 2, WALL_THICKNESS, ceilingHeight, npcGapL - minZ);
  addWall(scene, physics, wallMat, minX, midY, (npcGapR + maxZ) / 2, WALL_THICKNESS, ceilingHeight, maxZ - npcGapR);

  const roomLabel = createFloatingLabel('失物招領處', { width: 0.9, bg: 'rgba(30,25,20,0.75)' });
  roomLabel.position.set(cx, floorY + ceilingHeight - 0.5, cz);
  scene.add(roomLabel);

  return floor;
}

/** Day2/Day4 mid-size coffee room, south of the lost-found room ("每日特殊
 * 劇情系統" round, spec: "在失物招領房間南方，新增一間中型休息室，尺寸約
 * 6m×6m，含木地板、咖啡桌、兩張椅子、桌上兩杯咖啡，暖色系燈光"). Only the
 * NORTH wall is gapped (mirrors LOST_FOUND_ROOM's own south-wall gap cut for
 * COFFEE_ROOM_DOOR, same centerX so the two openings line up into one
 * doorway) — east/south/west stay fully solid, this room has no other
 * entrance. */
export function buildCoffeeRoom(scene: THREE.Scene, physics: PhysicsWorldPort): void {
  const { minX, maxX, minZ, maxZ, floorY, ceilingHeight } = COFFEE_ROOM;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const floorGeo = new THREE.PlaneGeometry(width, depth);
  const floor = new THREE.Mesh(floorGeo, stdMat(0x8a6a45)); // warm wood flooring
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, floorY, cz);
  scene.add(floor);
  physics.createStaticCuboid(cx, floorY - WALL_THICKNESS / 2, cz, width / 2, WALL_THICKNESS / 2, depth / 2);

  const wallMat = stdMat(0x5a4a3a, { side: THREE.DoubleSide });
  const midY = floorY + ceilingHeight / 2;

  const doorGapL = COFFEE_ROOM_DOOR.centerX - COFFEE_ROOM_DOOR.halfWidth;
  const doorGapR = COFFEE_ROOM_DOOR.centerX + COFFEE_ROOM_DOOR.halfWidth;
  addWall(scene, physics, wallMat, (minX + doorGapL) / 2, midY, minZ, doorGapL - minX, ceilingHeight, WALL_THICKNESS);
  addWall(scene, physics, wallMat, (doorGapR + maxX) / 2, midY, minZ, maxX - doorGapR, ceilingHeight, WALL_THICKNESS);
  addWall(scene, physics, wallMat, cx, midY, maxZ, width, ceilingHeight, WALL_THICKNESS); // south
  addWall(scene, physics, wallMat, minX, midY, cz, WALL_THICKNESS, ceilingHeight, depth); // west
  addWall(scene, physics, wallMat, maxX, midY, cz, WALL_THICKNESS, ceilingHeight, depth); // east

  // Warm-colored lamp (spec: "暖色系燈光") — a small local point light plus a
  // simple fixture mesh, distinct from the building's own flat ambient/
  // directional pair.
  const lamp = new THREE.PointLight(0xffb060, 0.9, 6);
  lamp.position.set(cx, floorY + ceilingHeight - 0.4, cz);
  scene.add(lamp);
  const lampMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), stdMat(0xffcc88, { emissive: 0xffaa55, emissiveIntensity: 0.6 }));
  lampMesh.position.copy(lamp.position);
  scene.add(lampMesh);

  // Coffee table + two chairs + two cups.
  const tableMat = stdMat(0x6b4a2a);
  const table = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.45, 16), tableMat);
  table.position.set(COFFEE_TABLE_CENTER.x, floorY + 0.225, COFFEE_TABLE_CENTER.z);
  scene.add(table);
  physics.createStaticCuboid(table.position.x, table.position.y, table.position.z, 0.5, 0.225, 0.5);

  const chairMat = stdMat(0x4a3a2a);
  for (const seat of [COFFEE_CHAIR_PLAYER, COFFEE_CHAIR_NPC]) {
    const chair = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), chairMat);
    chair.position.set(seat.x, floorY + 0.225, seat.z);
    scene.add(chair);
  }

  const cupMat = stdMat(0xffffff);
  const cupGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.08, 10);
  const cupA = new THREE.Mesh(cupGeo, cupMat);
  cupA.position.set(COFFEE_TABLE_CENTER.x - 0.15, floorY + 0.45 + 0.04, COFFEE_TABLE_CENTER.z);
  scene.add(cupA);
  const cupB = new THREE.Mesh(cupGeo, cupMat);
  cupB.position.set(COFFEE_TABLE_CENTER.x + 0.15, floorY + 0.45 + 0.04, COFFEE_TABLE_CENTER.z);
  scene.add(cupB);

  // Day4-only projector + screen, built as permanent room furniture (see
  // coffee-room-layout-data.ts's own doc comment on COFFEE_PROJECTOR_*).
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), stdMat(0xe8e8e0, { side: THREE.DoubleSide }));
  screen.position.copy(COFFEE_PROJECTOR_SCREEN_CENTER);
  scene.add(screen);
  const frame = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.5, 4), stdMat(0x3a3a3a, { side: THREE.DoubleSide }));
  frame.position.copy(COFFEE_PROJECTOR_SCREEN_CENTER);
  frame.position.z -= 0.01;
  scene.add(frame);
  const projector = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.4), stdMat(0x2a2a2a));
  projector.position.copy(COFFEE_PROJECTOR_POS);
  scene.add(projector);

  const roomLabel = createFloatingLabel('休息室', { width: 0.7, bg: 'rgba(40,30,20,0.75)' });
  roomLabel.position.set(cx, floorY + ceilingHeight - 0.5, cz);
  scene.add(roomLabel);
}

/** Player's private bedroom ("主角房間" round, spec: "位於物流中心東北方牆
 * 角，朝北側延伸...場景空間＋基本家具配置"), north of BACK_AREA's own north
 * wall, already gapped at PLAYER_ROOM_DOOR (see buildBackArea above). Only
 * north/west/east walls are built here — the south side is intentionally
 * left open, mirroring buildCargoChuteRoom's own "shared wall, only one side
 * actually builds it" convention for a room hanging off BACK_AREA's own
 * north wall. Scene-only this round (spec: "不要新增睡覺、休息、時間推進、
 * 存檔或其他遊戲功能") — every piece of furniture below gets a plain static
 * collider (so the player can't walk through it) but is NEVER registered
 * into the shared `interactables` map, exactly mirroring COFFEE_ROOM's own
 * table/chairs (no interaction wiring of any kind). */
export function buildPlayerRoom(scene: THREE.Scene, physics: PhysicsWorldPort): void {
  const { minX, maxX, minZ, maxZ, floorY, ceilingHeight } = PLAYER_ROOM;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const floorGeo = new THREE.PlaneGeometry(width, depth);
  const floor = new THREE.Mesh(floorGeo, stdMat(0x7a6858)); // warm neutral flooring
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, floorY, cz);
  scene.add(floor);
  physics.createStaticCuboid(cx, floorY - WALL_THICKNESS / 2, cz, width / 2, WALL_THICKNESS / 2, depth / 2);

  const wallMat = stdMat(0x8a7a68, { side: THREE.DoubleSide });
  const midY = floorY + ceilingHeight / 2;

  addWall(scene, physics, wallMat, cx, midY, minZ, width, ceilingHeight, WALL_THICKNESS); // north wall (solid)
  addWall(scene, physics, wallMat, minX, midY, cz, WALL_THICKNESS, ceilingHeight, depth); // west wall
  addWall(scene, physics, wallMat, maxX, midY, cz, WALL_THICKNESS, ceilingHeight, depth); // east wall

  // Warm lamp (mirrors COFFEE_ROOM's own "暖色系燈光" fixture) — this
  // prototype's established way of giving a small room a lived-in, cozy
  // feel without any new lighting system.
  const lamp = new THREE.PointLight(0xffb060, 0.7, 5);
  lamp.position.set(cx, floorY + ceilingHeight - 0.4, cz);
  scene.add(lamp);
  const lampMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), stdMat(0xffcc88, { emissive: 0xffaa55, emissiveIntensity: 0.5 }));
  lampMesh.position.copy(lamp.position);
  scene.add(lampMesh);

  // --- Bed (spec: "床靠牆") — base frame + mattress + pillow + headboard.
  const bedFrameMat = stdMat(0x6b4a2a);
  const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(PLAYER_BED.sizeX, PLAYER_BED.height, PLAYER_BED.sizeZ), bedFrameMat);
  bedFrame.position.set(PLAYER_BED.centerX, floorY + PLAYER_BED.height / 2, PLAYER_BED.centerZ);
  scene.add(bedFrame);
  physics.createStaticCuboid(bedFrame.position.x, bedFrame.position.y, bedFrame.position.z, PLAYER_BED.sizeX / 2, PLAYER_BED.height / 2, PLAYER_BED.sizeZ / 2);

  const mattressMat = stdMat(0xe8e0d0);
  const mattressHeight = 0.14;
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(PLAYER_BED.sizeX - 0.08, mattressHeight, PLAYER_BED.sizeZ - 0.08), mattressMat);
  mattress.position.set(PLAYER_BED.centerX, floorY + PLAYER_BED.height + mattressHeight / 2, PLAYER_BED.centerZ);
  scene.add(mattress);

  const pillowMat = stdMat(0xffffff);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(PLAYER_BED.sizeX - 0.3, 0.1, 0.4), pillowMat);
  pillow.position.set(PLAYER_BED.centerX, floorY + PLAYER_BED.height + mattressHeight + 0.05, PLAYER_BED.centerZ - PLAYER_BED.sizeZ / 2 + 0.32);
  scene.add(pillow);

  const headboard = new THREE.Mesh(new THREE.BoxGeometry(PLAYER_BED.sizeX, 0.9, 0.08), bedFrameMat);
  headboard.position.set(PLAYER_BED.centerX, floorY + 0.45, minZ + WALL_THICKNESS / 2 + 0.04);
  scene.add(headboard);
  physics.createStaticCuboid(headboard.position.x, headboard.position.y, headboard.position.z, PLAYER_BED.sizeX / 2, 0.45, 0.04);

  // --- Wardrobe (spec: "櫃子靠近床").
  const wardrobeMat = stdMat(0x5a4530);
  const wardrobe = new THREE.Mesh(new THREE.BoxGeometry(PLAYER_WARDROBE.sizeX, PLAYER_WARDROBE.height, PLAYER_WARDROBE.sizeZ), wardrobeMat);
  wardrobe.position.set(PLAYER_WARDROBE.centerX, floorY + PLAYER_WARDROBE.height / 2, PLAYER_WARDROBE.centerZ);
  scene.add(wardrobe);
  physics.createStaticCuboid(wardrobe.position.x, wardrobe.position.y, wardrobe.position.z, PLAYER_WARDROBE.sizeX / 2, PLAYER_WARDROBE.height / 2, PLAYER_WARDROBE.sizeZ / 2);
  // Two vertical door-seam lines — purely cosmetic surface detail.
  const seamMat = stdMat(0x3a2e1e);
  const seam = new THREE.Mesh(new THREE.BoxGeometry(PLAYER_WARDROBE.sizeX + 0.01, PLAYER_WARDROBE.height - 0.1, 0.02), seamMat);
  seam.position.set(PLAYER_WARDROBE.centerX, floorY + PLAYER_WARDROBE.height / 2, PLAYER_WARDROBE.centerZ);
  scene.add(seam);

  // --- Desk (spec: "書桌靠牆") — tabletop + 4 legs, mirrors buildTelevision-
  // AndTable's own table construction.
  const deskMat = stdMat(0x7a5a34);
  const deskTopThickness = 0.05;
  const deskTop = new THREE.Mesh(new THREE.BoxGeometry(PLAYER_DESK.sizeX, deskTopThickness, PLAYER_DESK.sizeZ), deskMat);
  deskTop.position.set(PLAYER_DESK.centerX, floorY + PLAYER_DESK.height - deskTopThickness / 2, PLAYER_DESK.centerZ);
  scene.add(deskTop);

  const deskLegThickness = 0.05;
  const deskLegHeight = PLAYER_DESK.height - deskTopThickness;
  const deskLegGeo = new THREE.BoxGeometry(deskLegThickness, deskLegHeight, deskLegThickness);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(deskLegGeo, deskMat);
      leg.position.set(
        PLAYER_DESK.centerX + sx * (PLAYER_DESK.sizeX / 2 - deskLegThickness / 2),
        floorY + deskLegHeight / 2,
        PLAYER_DESK.centerZ + sz * (PLAYER_DESK.sizeZ / 2 - deskLegThickness / 2)
      );
      scene.add(leg);
    }
  }
  physics.createStaticCuboid(PLAYER_DESK.centerX, floorY + PLAYER_DESK.height / 2, PLAYER_DESK.centerZ, PLAYER_DESK.sizeX / 2, PLAYER_DESK.height / 2, PLAYER_DESK.sizeZ / 2);

  // --- Chair (spec: "椅子放在書桌前") — mirrors COFFEE_ROOM's own simple box chair.
  const chairMat = stdMat(0x4a3a2a);
  const chair = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), chairMat);
  chair.position.set(PLAYER_CHAIR.x, floorY + 0.225, PLAYER_CHAIR.z);
  scene.add(chair);

  const roomLabel = createFloatingLabel('主角房間', { width: 0.8, bg: 'rgba(35,30,25,0.75)' });
  roomLabel.position.copy(PLAYER_ROOM_LABEL_POS);
  scene.add(roomLabel);
}

/** Outdoor campfire rest area outside the land-vehicle exit ("每日特殊劇情系
 * 統" round, spec: "陸運出口外側，延伸一塊戶外空地，含營火、木頭、四周石頭
 * 、木頭長椅、烤棉花糖架") — Day6's own story scene, later reused by Day8's
 * finale ending. Purely decorative open-air geometry, no walls (it's an
 * outdoor clearing, not a room). */
export function buildCampfireArea(scene: THREE.Scene, physics: PhysicsWorldPort): void {
  const { minX, maxX, minZ, maxZ, floorY } = CAMPFIRE_AREA;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const floorGeo = new THREE.PlaneGeometry(width, depth);
  const floor = new THREE.Mesh(floorGeo, stdMat(0x5a4a38)); // packed dirt clearing
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, floorY, cz);
  scene.add(floor);
  physics.createStaticCuboid(cx, floorY - WALL_THICKNESS / 2, cz, width / 2, WALL_THICKNESS / 2, depth / 2);

  // Entry connector — bug fix ("玩家無法正常走到營火區域"): bridges the
  // land-gate opening in BACK_AREA's own south wall to this clearing's own
  // north edge (see CAMPFIRE_ENTRY_CONNECTOR's own doc comment for why the
  // clearing was unreachable without this).
  {
    const c = CAMPFIRE_ENTRY_CONNECTOR;
    const cWidth = c.maxX - c.minX;
    const cDepth = c.maxZ - c.minZ;
    const ccx = (c.minX + c.maxX) / 2;
    const ccz = (c.minZ + c.maxZ) / 2;
    const connectorFloor = new THREE.Mesh(new THREE.PlaneGeometry(cWidth, cDepth), stdMat(0x54473a));
    connectorFloor.rotation.x = -Math.PI / 2;
    connectorFloor.position.set(ccx, c.floorY, ccz);
    scene.add(connectorFloor);
    physics.createStaticCuboid(ccx, c.floorY - WALL_THICKNESS / 2, ccz, cWidth / 2, WALL_THICKNESS / 2, cDepth / 2);
  }

  // West extension — "露營區地形擴建" round (spec: "露營區地面向西方延伸").
  // Butts directly against CAMPFIRE_AREA's own west edge (same Z-span, no
  // gap) — a real, collidable static-cuboid floor patch, not just decoration
  // (spec: "不要只增加裝飾物，要增加真正可碰撞的地面板塊"). Purely additive:
  // CAMPFIRE_AREA's own rectangle (and everything positioned relative to its
  // center — the fire, all four benches, the roasting sticks) is completely
  // untouched by this.
  {
    const w = CAMPFIRE_WEST_EXTENSION;
    const wWidth = w.maxX - w.minX;
    const wDepth = w.maxZ - w.minZ;
    const wcx = (w.minX + w.maxX) / 2;
    const wcz = (w.minZ + w.maxZ) / 2;
    const westFloor = new THREE.Mesh(new THREE.PlaneGeometry(wWidth, wDepth), stdMat(0x5a4a38));
    westFloor.rotation.x = -Math.PI / 2;
    westFloor.position.set(wcx, w.floorY, wcz);
    scene.add(westFloor);
    physics.createStaticCuboid(wcx, w.floorY - WALL_THICKNESS / 2, wcz, wWidth / 2, WALL_THICKNESS / 2, wDepth / 2);
  }

  // Stone ring + firewood + fire glow.
  const stoneMat = stdMat(0x777066);
  const ringCount = 8;
  for (let i = 0; i < ringCount; i++) {
    const angle = (i / ringCount) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 6), stoneMat);
    stone.position.set(CAMPFIRE_CENTER.x + Math.cos(angle) * 0.65, floorY + 0.1, CAMPFIRE_CENTER.z + Math.sin(angle) * 0.65);
    scene.add(stone);
  }
  const woodMat = stdMat(0x4a3322);
  for (let i = 0; i < 4; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6), woodMat);
    log.position.set(CAMPFIRE_CENTER.x, floorY + 0.1, CAMPFIRE_CENTER.z);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = (i / 4) * Math.PI;
    scene.add(log);
  }
  const fireLight = new THREE.PointLight(0xff6a20, 1.4, 8);
  fireLight.position.set(CAMPFIRE_CENTER.x, floorY + 0.5, CAMPFIRE_CENTER.z);
  scene.add(fireLight);
  const fireGlow = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 8), stdMat(0xff8020, { emissive: 0xff5500, emissiveIntensity: 1.0, transparent: true, opacity: 0.85 }));
  fireGlow.position.set(CAMPFIRE_CENTER.x, floorY + 0.35, CAMPFIRE_CENTER.z);
  scene.add(fireGlow);

  // Four log benches, one per compass side (spec: "木頭長椅").
  const benchMat = stdMat(0x5a4530);
  for (const bench of [CAMPFIRE_BENCH_NORTH, CAMPFIRE_BENCH_SOUTH, CAMPFIRE_BENCH_EAST, CAMPFIRE_BENCH_WEST]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.35), benchMat);
    seat.position.set(bench.x, floorY + 0.175, bench.z);
    const toCenter = Math.atan2(CAMPFIRE_CENTER.x - bench.x, CAMPFIRE_CENTER.z - bench.z);
    seat.rotation.y = toCenter;
    scene.add(seat);
    physics.createStaticCuboid(seat.position.x, seat.position.y, seat.position.z, 0.45, 0.175, 0.175);
  }

  // Marshmallow-roasting sticks, leaning near the west bench (spec: "烤棉花
  // 糖架").
  const stickMat = stdMat(0x8a6a45);
  for (const stick of [CAMPFIRE_STICK_A, CAMPFIRE_STICK_B]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), stickMat);
    rod.position.set(stick.x, floorY + 0.3, stick.z);
    rod.rotation.x = Math.PI / 3.2;
    scene.add(rod);
  }

  const areaLabel = createFloatingLabel('營火區', { width: 0.7, bg: 'rgba(40,25,15,0.75)' });
  areaLabel.position.set(cx, floorY + 2.2, cz);
  scene.add(areaLabel);
}
