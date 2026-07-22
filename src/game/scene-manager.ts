import * as THREE from 'three';
import { InteractableObject } from './interactable-object';
import { PhysicsSystem } from './physics-system';
import {
  WALL_THICKNESS, FRONT_OFFICE, CARGO_WINDOW, CARGO_RAMP, DOORWAY, STAIRS,
  BACK_AREA, CARGO_ZONES, LAND_DOCKS, LAND_GATE, PIER, SEA_GATE, SEA_DOCKS, WEST_GATE,
} from './logistics-layout-data';
import { NPC_DOOR, NPC_AREA, PLAYER_AREA, COUNTER, COUNTER_GLASS, COUNTER_WINDOW, COUNTER_ITEM_BACKSTOP } from './counter-layout-data';
import { createFloatingLabel } from './world-label-system';

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
  /** Front-office floor — used by PickupSystem as its default placement raycast floor. */
  floor: THREE.Mesh;
  /** Back-area floor — register as an additional PickupSystem placement surface. */
  backFloor: THREE.Mesh;
  /** Pier deck — register as an additional PickupSystem placement surface. */
  pierFloor: THREE.Mesh;
  /** Ramp/conveyor geometry, for ConveyorSystem to drive cargo down it. */
  ramp: { mesh: THREE.Mesh; topPos: THREE.Vector3; bottomPos: THREE.Vector3; width: number };
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

  const floor = buildFrontOffice(scene, physics);
  buildNpcDoorWall(scene, physics);
  buildCounterWall(scene, physics);
  buildCounterGlass(scene, physics);
  buildAreaLabels(scene);
  buildDividingWall(scene, physics);
  const ramp = buildRamp(scene, physics);
  buildStairs(scene, physics);
  const backFloor = buildBackArea(scene, physics);
  buildCargoZones(scene);
  buildLandDocks(scene);
  const pierFloor = buildPierAndWater(scene, physics);
  buildSeaDocks(scene);

  const interactables = new Map<string, InteractableObject>();
  return { interactables, floor, backFloor, pierFloor, ramp };
}

function buildFrontOffice(scene: THREE.Scene, physics: PhysicsSystem): THREE.Mesh {
  const { minX, maxX, minZ, maxZ, floorY, ceilingHeight } = FRONT_OFFICE;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const floorGeo = new THREE.PlaneGeometry(width, depth);
  const floor = new THREE.Mesh(floorGeo, stdMat(0x74746a));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, floorY, cz);
  scene.add(floor);
  physics.createStaticCuboid(cx, floorY - WALL_THICKNESS / 2, cz, width / 2, WALL_THICKNESS / 2, depth / 2);

  const ceilY = floorY + ceilingHeight;
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), stdMat(0x555555, { side: THREE.DoubleSide }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(cx, ceilY, cz);
  scene.add(ceiling);
  physics.createStaticCuboid(cx, ceilY + WALL_THICKNESS / 2, cz, width / 2, WALL_THICKNESS / 2, depth / 2);

  const wallMat = stdMat(0x8a8a80, { side: THREE.DoubleSide });
  const midY = floorY + ceilingHeight / 2;

  addWall(scene, physics, wallMat, minX, midY, cz, WALL_THICKNESS, ceilingHeight, depth); // left
  addWall(scene, physics, wallMat, maxX, midY, cz, WALL_THICKNESS, ceilingHeight, depth); // right
  // minZ wall has the NPC door cut into it — built separately in buildNpcDoorWall().
  // The maxZ wall is the dividing wall — built separately with window/door cutouts.

  return floor;
}

/** NPC entry/exit door, cut into the front office's far (minZ) wall. */
function buildNpcDoorWall(scene: THREE.Scene, physics: PhysicsSystem): void {
  const { minX, maxX, floorY, ceilingHeight } = FRONT_OFFICE;
  const z = FRONT_OFFICE.minZ;
  const wallMat = stdMat(0x8a8a80, { side: THREE.DoubleSide });
  const purpleMat = stdMat(0x7a3fb8);

  const doorL = NPC_DOOR.centerX - NPC_DOOR.halfWidth;
  const doorR = NPC_DOOR.centerX + NPC_DOOR.halfWidth;
  const topY = floorY + ceilingHeight;
  const midY = floorY + ceilingHeight / 2;

  addWall(scene, physics, wallMat, (minX + doorL) / 2, midY, z, doorL - minX, ceilingHeight, WALL_THICKNESS);
  addWall(scene, physics, wallMat, (doorR + maxX) / 2, midY, z, maxX - doorR, ceilingHeight, WALL_THICKNESS);
  const lintelH = topY - NPC_DOOR.height;
  addWall(scene, physics, purpleMat, NPC_DOOR.centerX, NPC_DOOR.height + lintelH / 2, z, NPC_DOOR.halfWidth * 2, lintelH, WALL_THICKNESS);
}

/** Counter wall splitting the front office into an NPC area and a player
 * area — solid up to counter height (blocks walking through on both sides),
 * with a flat top surface where the counter item spawns. */
function buildCounterWall(scene: THREE.Scene, physics: PhysicsSystem): void {
  const { minX, maxX } = COUNTER;
  const floorY = FRONT_OFFICE.floorY;
  const width = maxX - minX;
  const cy = floorY + COUNTER.height / 2;

  const counterMat = stdMat(0x6b5a3a);
  const geo = new THREE.BoxGeometry(width, COUNTER.height, COUNTER.thickness);
  const mesh = new THREE.Mesh(geo, counterMat);
  mesh.position.set((minX + maxX) / 2, cy, COUNTER.z);
  scene.add(mesh);
  physics.createStaticCuboid((minX + maxX) / 2, cy, COUNTER.z, width / 2, COUNTER.height / 2, COUNTER.thickness / 2);

  // Invisible backstop on the counter top, right at the NPC/player boundary
  // — collider only (no mesh, so it doesn't obstruct the window sightline
  // above it) — physically stops a spawned item from ever being pushed past
  // this line back toward the NPC side (see COUNTER_ITEM_BACKSTOP doc comment).
  const { minX: bMinX, maxX: bMaxX, z: bz, thickness: bt, height: bh } = COUNTER_ITEM_BACKSTOP;
  const bWidth = bMaxX - bMinX;
  const bCy = floorY + COUNTER.height + bh / 2;
  physics.createStaticCuboid((bMinX + bMaxX) / 2, bCy, bz, bWidth / 2, bh / 2, bt / 2);
}

/** Glass partition sealing the NPC/player boundary above counter height —
 * the counter itself already blocks floor-to-counter-height, this closes
 * the open-air gap up to the ceiling so nothing (player, NPC, thrown cargo)
 * can cross above it — EXCEPT a service-window opening (COUNTER_WINDOW)
 * centered over the counter item spot, so the player can look straight at
 * the NPC being served. Built as three solid segments flanking/above the
 * opening (left, right, top-of-window), same pattern as the cargo window
 * cut into the dividing wall below. Semi-transparent so both sides stay
 * clearly visible through the solid parts too. */
function buildCounterGlass(scene: THREE.Scene, physics: PhysicsSystem): void {
  const { minX, maxX, z, thickness, bottomY, topY } = COUNTER_GLASS;

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x5ec8e8, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
    metalness: 0.1, roughness: 0.05,
    emissive: 0x2f7a94, emissiveIntensity: 0.4,
  });

  const winL = COUNTER_WINDOW.centerX - COUNTER_WINDOW.halfWidth;
  const winR = COUNTER_WINDOW.centerX + COUNTER_WINDOW.halfWidth;

  // Left segment, full height
  addWall(scene, physics, glassMat, (minX + winL) / 2, (bottomY + topY) / 2, z, winL - minX, topY - bottomY, thickness);
  // Right segment, full height
  addWall(scene, physics, glassMat, (winR + maxX) / 2, (bottomY + topY) / 2, z, maxX - winR, topY - bottomY, thickness);
  // Segment above the window opening
  const aboveH = topY - COUNTER_WINDOW.topY;
  addWall(scene, physics, glassMat, COUNTER_WINDOW.centerX, COUNTER_WINDOW.topY + aboveH / 2, z, winR - winL, aboveH, thickness);
}

function buildAreaLabels(scene: THREE.Scene): void {
  const npcLabel = createFloatingLabel('NPC 等候區', { width: 1.0, bg: 'rgba(40,25,50,0.75)' });
  npcLabel.position.set(0, FRONT_OFFICE.ceilingHeight - 0.6, (NPC_AREA.minZ + NPC_AREA.maxZ) / 2);
  scene.add(npcLabel);

  const playerLabel = createFloatingLabel('臨櫃工作區', { width: 1.0, bg: 'rgba(25,40,50,0.75)' });
  playerLabel.position.set(0, FRONT_OFFICE.ceilingHeight - 0.6, (PLAYER_AREA.minZ + PLAYER_AREA.maxZ) / 2);
  scene.add(playerLabel);
}

function buildDividingWall(scene: THREE.Scene, physics: PhysicsSystem): void {
  const { minX, maxX, floorY, ceilingHeight } = FRONT_OFFICE;
  const z = FRONT_OFFICE.maxZ;
  const wallMat = stdMat(0x8a8a80, { side: THREE.DoubleSide });
  const blackMat = stdMat(0x141414);
  const purpleMat = stdMat(0x7a3fb8);

  const winL = CARGO_WINDOW.centerX - CARGO_WINDOW.halfWidth;
  const winR = CARGO_WINDOW.centerX + CARGO_WINDOW.halfWidth;
  const doorL = DOORWAY.centerX - DOORWAY.halfWidth;
  const doorR = DOORWAY.centerX + DOORWAY.halfWidth;
  const topY = floorY + ceilingHeight;
  const midY = floorY + ceilingHeight / 2;

  // Solid segments flanking the window and door openings
  addWall(scene, physics, wallMat, (minX + winL) / 2, midY, z, winL - minX, ceilingHeight, WALL_THICKNESS);
  addWall(scene, physics, wallMat, (winR + doorL) / 2, midY, z, doorL - winR, ceilingHeight, WALL_THICKNESS);
  addWall(scene, physics, wallMat, (doorR + maxX) / 2, midY, z, maxX - doorR, ceilingHeight, WALL_THICKNESS);

  // Black sill + lintel framing the cargo window opening
  addWall(scene, physics, blackMat, CARGO_WINDOW.centerX, floorY + CARGO_WINDOW.bottomY / 2, z, CARGO_WINDOW.halfWidth * 2, CARGO_WINDOW.bottomY, WALL_THICKNESS);
  const winLintelH = topY - CARGO_WINDOW.topY;
  addWall(scene, physics, blackMat, CARGO_WINDOW.centerX, CARGO_WINDOW.topY + winLintelH / 2, z, CARGO_WINDOW.halfWidth * 2, winLintelH, WALL_THICKNESS);

  // Purple lintel marking the door/stairs opening
  const doorLintelH = topY - DOORWAY.height;
  addWall(scene, physics, purpleMat, DOORWAY.centerX, DOORWAY.height + doorLintelH / 2, z, DOORWAY.halfWidth * 2, doorLintelH, WALL_THICKNESS);
}

/** Canvas-texture stripes across the belt so it visibly reads as a conveyor
 * (segments/rollers), not a plain painted ramp. Returns the texture so the
 * caller can scroll it over time for a "running" look. */
function createConveyorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#a02b2b';
  ctx.fillRect(0, 0, 64, 256);
  ctx.fillStyle = '#6b1b1b';
  const stripeH = 24;
  for (let y = 0; y < 256; y += stripeH) {
    ctx.fillRect(0, y, 64, 6);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 3);
  return texture;
}

function buildRamp(scene: THREE.Scene, physics: PhysicsSystem): SceneData['ramp'] {
  const { topX, topY, topZ, bottomX, bottomZ, width, thickness } = CARGO_RAMP;
  const bottomY = BACK_AREA.floorY;
  const rise = topY - bottomY;
  const run = bottomZ - topZ;
  const length = Math.sqrt(rise * rise + run * run);
  // Positive angle tilts the box's +Z-local end DOWN and further in +Z —
  // i.e. the back-area end ends up lower than the window end, as intended.
  // (A negative angle here was the earlier "reversed" belt bug.)
  const angle = Math.atan2(rise, run);

  const cx = (topX + bottomX) / 2;
  const cy = (topY + bottomY) / 2;
  const cz = (topZ + bottomZ) / 2;

  const texture = createConveyorTexture();
  const geo = new THREE.BoxGeometry(width, thickness, length);
  const rampMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: texture, color: 0xffffff }));
  rampMesh.position.set(cx, cy, cz);
  rampMesh.rotation.x = angle;
  rampMesh.userData.surfaceType = 'cargo-ramp';
  rampMesh.userData.conveyorTexture = texture;
  scene.add(rampMesh);

  physics.createStaticCuboidRotatedX(cx, cy, cz, width / 2, thickness / 2, length / 2, angle, 0.25);

  return {
    mesh: rampMesh,
    topPos: new THREE.Vector3(topX, topY, topZ),
    bottomPos: new THREE.Vector3(bottomX, bottomY, bottomZ),
    width,
  };
}

function buildStairs(scene: THREE.Scene, physics: PhysicsSystem): void {
  const { centerX, width, topZ, bottomZ, stepCount } = STAIRS;
  const totalDrop = FRONT_OFFICE.floorY - BACK_AREA.floorY;
  const totalRun = bottomZ - topZ;
  const stepDepth = totalRun / stepCount;
  const stepHeight = totalDrop / stepCount;
  const purpleMat = stdMat(0x9a6fd8);

  for (let i = 0; i < stepCount; i++) {
    const stepTopY = FRONT_OFFICE.floorY - stepHeight * (i + 1);
    const stepZ = topZ + stepDepth * i + stepDepth / 2;
    const blockH = Math.max(stepTopY - BACK_AREA.floorY, 0.05);
    const cy = BACK_AREA.floorY + blockH / 2;

    const geo = new THREE.BoxGeometry(width, blockH, stepDepth * 0.98);
    const stepMesh = new THREE.Mesh(geo, purpleMat);
    stepMesh.position.set(centerX, cy, stepZ);
    scene.add(stepMesh);
    physics.createStaticCuboid(centerX, cy, stepZ, width / 2, blockH / 2, stepDepth * 0.49);
  }
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

  // West wall — gap for the daily-unloading dock (see daily-flow-data.ts /
  // WEST_GATE in logistics-layout-data.ts). Physical opening only; the
  // UnloadingSystem's own gate panel + chute fill it visually and the daily
  // flow's cargo spawns just inside it, never actually needing to cross
  // this plane from the outside.
  const westGapL = WEST_GATE.centerZ - WEST_GATE.halfWidth;
  const westGapR = WEST_GATE.centerZ + WEST_GATE.halfWidth;
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
