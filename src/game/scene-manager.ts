import * as THREE from 'three';
import { InteractableObject } from '../shared/types/interactable';
import { PhysicsSystem } from '../adapters/rapier/physics-system';
import {
  WALL_THICKNESS, BACK_AREA, CARGO_ZONES, LAND_DOCKS, LAND_GATE, PIER, SEA_GATE, SEA_DOCKS, NORTH_GATES,
} from './logistics-layout-data';
import { LOST_FOUND_ROOM, LOST_FOUND_DOOR, LOST_FOUND_NPC_GATE } from './lost-found-layout-data';
import { createFloatingLabel } from '../adapters/three/world-label-system';

export const SCENE_CONFIG = {
  playerEyeHeight: 1.6,
  playerSpeed: 7,
  sprintMultiplier: 1.5,
  jumpHeight: 0.5,
  gravity: 9.81,
  interactionDistance: 3,
  deltaTimeMax: 0.1,
  maxChargeTime: 2.0,
  minThrowImpulse: 3,
  maxThrowImpulse: 12,
};

export interface SceneData {
  interactables: Map<string, InteractableObject>;
  /** Back-area floor — now the single primary floor for the whole building
   * (the north front-office room was removed entirely this round — see
   * buildBackArea's north wall). Used by PickupSystem as its default
   * placement raycast floor. */
  floor: THREE.Mesh;
  /** Pier deck — register as an additional PickupSystem placement surface. */
  pierFloor: THREE.Mesh;
  /** West-side lost & found room's own floor — a separate mesh from `floor`
   * above, so it must also be registered as an additional PickupSystem
   * placement surface ("Reduce daily cargo and add lost found desk" round
   * 二), same pattern as pierFloor. */
  lostFoundFloor: THREE.Mesh;
}

function stdMat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, ...opts });
}

/** Box wall segment with a matching Rapier static collider. */
function addWall(
  scene: THREE.Scene, physics: PhysicsSystem, material: THREE.Material,
  x: number, y: number, z: number, sx: number, sy: number, sz: number
): void {
  const geo = new THREE.BoxGeometry(Math.max(sx, 0.01), Math.max(sy, 0.01), Math.max(sz, 0.01));
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  physics.createStaticCuboid(x, y, z, sx / 2, sy / 2, sz / 2);
}

export function createLogisticsScene(scene: THREE.Scene, physics: PhysicsSystem): SceneData {
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
  dirLight.position.set(6, 14, 4);
  scene.add(dirLight);

  const floor = buildBackArea(scene, physics);
  buildCargoZones(scene);
  buildLandDocks(scene);
  const pierFloor = buildPierAndWater(scene, physics);
  buildSeaDocks(scene);
  const lostFoundFloor = buildLostFoundRoom(scene, physics);

  const interactables = new Map<string, InteractableObject>();
  return { interactables, floor, pierFloor, lostFoundFloor };
}

function buildBackArea(scene: THREE.Scene, physics: PhysicsSystem): THREE.Mesh {
  const { minX, maxX, minZ, maxZ, floorY, ceilingHeight } = BACK_AREA;
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

  // North wall — gaps for the daily-unload docks (spec "刪除北邊房間" round:
  // the separate front-office room this used to sit in has been removed
  // entirely; this back area is now the whole building, and its own north
  // wall carries the unload docks directly — see NORTH_GATES/UnloadingSystem).
  // Physical openings only — UnloadingSystem's own gate panels + chutes fill
  // them visually, same pattern as every other gate opening in this file.
  // Generalized to N gates ("Add dual elevated unloading ports and day-one
  // special cargo" round 二): walk the gates left-to-right, building one
  // solid wall segment before each gap and a final segment after the last
  // one, so this collapses to the original single-gate behavior when
  // NORTH_GATES has exactly one entry.
  const sortedNorthGates = [...NORTH_GATES].sort((a, b) => a.centerX - b.centerX);
  let northCursor = minX;
  for (const gate of sortedNorthGates) {
    const gapL = gate.centerX - gate.halfWidth;
    const gapR = gate.centerX + gate.halfWidth;
    if (gapL > northCursor) {
      addWall(scene, physics, wallMat, (northCursor + gapL) / 2, midY, minZ, gapL - northCursor, ceilingHeight, WALL_THICKNESS);
    }
    northCursor = gapR;
  }
  if (maxX > northCursor) {
    addWall(scene, physics, wallMat, (northCursor + maxX) / 2, midY, minZ, maxX - northCursor, ceilingHeight, WALL_THICKNESS);
  }

  // West wall — gap for the lost-found room's door ("Reduce daily cargo and
  // add lost found desk" round 二: 西側新增小型前台房間). The new room's own
  // walls (buildLostFoundRoom below) sit directly against this same wall
  // line, so this gap is the ONLY opening connecting the two spaces.
  const westGapL = LOST_FOUND_DOOR.centerZ - LOST_FOUND_DOOR.halfWidth;
  const westGapR = LOST_FOUND_DOOR.centerZ + LOST_FOUND_DOOR.halfWidth;
  addWall(scene, physics, wallMat, minX, midY, (minZ + westGapL) / 2, WALL_THICKNESS, ceilingHeight, westGapL - minZ);
  addWall(scene, physics, wallMat, minX, midY, (westGapR + maxZ) / 2, WALL_THICKNESS, ceilingHeight, maxZ - westGapR);

  // East wall — gap where the pier opens onto the water (sea route)
  const seaGapL = SEA_GATE.centerZ - SEA_GATE.halfWidth;
  const seaGapR = SEA_GATE.centerZ + SEA_GATE.halfWidth;
  addWall(scene, physics, wallMat, maxX, midY, (minZ + seaGapL) / 2, WALL_THICKNESS, ceilingHeight, seaGapL - minZ);
  addWall(scene, physics, wallMat, maxX, midY, (seaGapR + maxZ) / 2, WALL_THICKNESS, ceilingHeight, maxZ - seaGapR);

  // South wall — gap where the land vehicle drives through (land route)
  const landGapL = LAND_GATE.centerX - LAND_GATE.halfWidth;
  const landGapR = LAND_GATE.centerX + LAND_GATE.halfWidth;
  addWall(scene, physics, wallMat, (minX + landGapL) / 2, midY, maxZ, landGapL - minX, ceilingHeight, WALL_THICKNESS);
  addWall(scene, physics, wallMat, (landGapR + maxX) / 2, midY, maxZ, maxX - landGapR, ceilingHeight, WALL_THICKNESS);

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
function buildLostFoundRoom(scene: THREE.Scene, physics: PhysicsSystem): THREE.Mesh {
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
  addWall(scene, physics, wallMat, cx, midY, maxZ, width, ceilingHeight, WALL_THICKNESS); // south

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

/** White-box-only floor markers reserving space for future cargo-type zones
 * (normal/large/frozen/live/lost-found). No function yet — just space claims. */
function buildCargoZones(scene: THREE.Scene): void {
  for (const zone of CARGO_ZONES) {
    const width = zone.halfWidth * 2 - 0.2;
    const depth = zone.maxZ - zone.minZ - 0.2;
    const cz = (zone.minZ + zone.maxZ) / 2;

    const geo = new THREE.PlaneGeometry(width, depth);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: zone.color, transparent: true, opacity: 0.35 }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(zone.centerX, BACK_AREA.floorY + 0.01, cz);
    mesh.userData.zoneId = zone.id;
    scene.add(mesh);

    // Floating billboard above the zone — easier to read while walking past
    // than a flat floor decal, and always faces the player.
    const label = createFloatingLabel(zone.label, { width: 1.1, bg: 'rgba(32,32,28,0.75)', fg: '#e8e0c8' });
    label.position.set(zone.centerX, BACK_AREA.floorY + 1.4, cz);
    scene.add(label);
  }
}

function buildLandDocks(scene: THREE.Scene): void {
  for (const dock of LAND_DOCKS) {
    const geo = new THREE.PlaneGeometry(dock.width, dock.depth);
    const color = dock.active ? 0xd8b400 : 0x8a7a30;
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65 }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(dock.centerX, BACK_AREA.floorY + 0.01, dock.centerZ);
    mesh.userData.dockId = dock.id;
    scene.add(mesh);
  }
}

function buildPierAndWater(scene: THREE.Scene, physics: PhysicsSystem): THREE.Mesh {
  const { minX, maxX, minZ, maxZ, floorY, waterY } = PIER;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const deckGeo = new THREE.PlaneGeometry(width, depth);
  const deck = new THREE.Mesh(deckGeo, stdMat(0x2f8f8f));
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(cx, floorY, cz);
  scene.add(deck);
  physics.createStaticCuboid(cx, floorY - WALL_THICKNESS / 2, cz, width / 2, WALL_THICKNESS / 2, depth / 2);

  // Pier now extends EAST off the back-area wall, so bias the water plane
  // further east (away from the building) rather than in +Z.
  const waterGeo = new THREE.PlaneGeometry(width * 3, depth * 2);
  const water = new THREE.Mesh(waterGeo, new THREE.MeshStandardMaterial({ color: 0x1a4a6a, transparent: true, opacity: 0.85 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx + width * 0.3, waterY, cz);
  scene.add(water);

  return deck;
}

function buildSeaDocks(scene: THREE.Scene): void {
  for (const dock of SEA_DOCKS) {
    const geo = new THREE.CircleGeometry(dock.radius, 24);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x22aa55, transparent: true, opacity: 0.65 }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(dock.centerX, PIER.floorY + 0.02, dock.centerZ);
    mesh.userData.dockId = dock.id;
    scene.add(mesh);
  }
}
