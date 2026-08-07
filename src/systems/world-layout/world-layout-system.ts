import * as THREE from 'three';
import { InteractableObject } from '../../shared/types/interactable';
// Depends on the neutral PhysicsWorldPort contract (Phase 7: 解除最後一個
// 循環依賴) rather than importing PhysicsSystem (adapters/rapier) directly
// — that adapter used to import PLAYER_SPAWN from this very module, which
// combined with this file's own import of PhysicsSystem created a
// file-level circular import. PLAYER_SPAWN is now passed into
// PhysicsSystem.init() as a parameter instead (see app/game-context.ts),
// and this file only ever needs the one collider-creation method the port
// exposes.
import { PhysicsWorldPort } from '../../shared/types/physics-world-port';
import {
  WALL_THICKNESS, BACK_AREA, LAND_GATE, PIER, SEA_GATE, NORTH_GATES,
  WEST_WALL_SHELVES, SHELF_LEVEL_Y_OFFSETS, SHELF_BOARD_THICKNESS, SHELF_POST_THICKNESS, SHELF_FRAME_TOP_MARGIN,
  BULLETIN_BOARD, TV_TABLE, TELEVISION,
} from './logistics-layout-data';
import { createInteractableObject } from '../../shared/types/interactable';
// Reads the room/gate coordinates from the neutral data layer (Phase 6:
// "模組邊界修正" — moved out of systems/lost-found so world-layout and
// lost-found never import each other's internals; both read the same
// data/world/ file instead).
import { LOST_FOUND_ROOM, LOST_FOUND_DOOR, LOST_FOUND_NPC_GATE } from '../../data/world/lost-found-layout-data';
import { createFloatingLabel } from '../../adapters/three/world-label-system';
import {
  FISHING_PIER, FISHING_CHAIR_A, FISHING_CHAIR_B, FISHING_ROD_A, FISHING_ROD_B,
  FISHING_BUCKET, FISHING_TACKLE_BOX, FISHING_LANTERN,
} from './fishing-pier-data';
// "每日特殊劇情系統" round — two new rooms/areas, same "plain data file,
// geometry built here" split every other room already follows.
import {
  COFFEE_ROOM, COFFEE_ROOM_DOOR, COFFEE_TABLE_CENTER, COFFEE_CHAIR_PLAYER, COFFEE_CHAIR_NPC,
  COFFEE_PROJECTOR_SCREEN_CENTER, COFFEE_PROJECTOR_POS,
} from '../../data/world/coffee-room-layout-data';
import {
  CAMPFIRE_AREA, CAMPFIRE_CENTER, CAMPFIRE_BENCH_NORTH, CAMPFIRE_BENCH_SOUTH, CAMPFIRE_BENCH_EAST, CAMPFIRE_BENCH_WEST,
  CAMPFIRE_STICK_A, CAMPFIRE_STICK_B, CAMPFIRE_ENTRY_CONNECTOR,
} from '../../data/world/campfire-area-data';

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
  /** West-wall freezer cabinets' own level-top boards ("Add freezer shelves
   * and frozen cargo freshness system" round, redesign pass) — 3 boards per
   * cabinet group, 6 total (2 groups). Registered as additional PickupSystem
   * placement surfaces the same way pierFloor/lostFoundFloor already are
   * (see create-game-systems.ts) — this file only builds the
   * Mesh/Collider/candidate-surface geometry, never touches PickupSystem
   * itself (it doesn't exist yet at this point in app startup). */
  shelfSurfaces: THREE.Mesh[];
  /** Television's own floating world label + screen material handles ("Add
   * television media playlist" round) — returned so MediaPlayerSystem
   * (built later in create-game-systems.ts, well after PauseManager exists)
   * can update the label text (playback status, spec八) and toggle the
   * screen's own emissive glow while playing, without this file needing any
   * knowledge of playback state itself (spec: "不需要把網路影片製作成
   * Three.js VideoTexture" — this is a plain material property tweak, not a
   * video texture). */
  television: { label: THREE.Sprite; screenMaterial: THREE.MeshStandardMaterial };
}

/** The bulletin board's own raycast-target id ("Add bulletin board upgrade
 * system" round spec二) — registered directly into the SAME shared
 * `interactables` map every other pickupable prop uses, so
 * InteractionSystem's existing single crosshair raycast resolves it for
 * free, exactly mirroring the empty-bag supply rack's own pattern
 * (MAIL_RACK_INTERACTABLE_ID, mail-bag-system.ts). `canPickUp: true` only
 * so it passes that raycast's own generic filter — it's never actually
 * handed to PickupSystem.pickUp(); InteractionSystem intercepts E specially
 * before the generic pickup/multi-carry path runs. */
export const BULLETIN_BOARD_INTERACTABLE_ID = 'bulletin-board';

/** The west-wall television's own raycast-target id ("Add television media
 * playlist" round spec二) — registered into the SAME shared `interactables`
 * map, resolved by InteractionSystem's existing single crosshair raycast,
 * exactly mirroring BULLETIN_BOARD_INTERACTABLE_ID above. The small table it
 * sits on is NOT registered here (spec二: "互動Collider只包住電視本體") — it
 * only gets a player-blocking physics collider, never an interactable
 * entry, so the TV alone is ever a valid crosshair target. */
export const TELEVISION_INTERACTABLE_ID = 'television';

function stdMat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, ...opts });
}

/** Box wall segment with a matching Rapier static collider. */
function addWall(
  scene: THREE.Scene, physics: PhysicsWorldPort, material: THREE.Material,
  x: number, y: number, z: number, sx: number, sy: number, sz: number
): void {
  const geo = new THREE.BoxGeometry(Math.max(sx, 0.01), Math.max(sy, 0.01), Math.max(sz, 0.01));
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  physics.createStaticCuboid(x, y, z, sx / 2, sy / 2, sz / 2);
}

export function createLogisticsScene(scene: THREE.Scene, physics: PhysicsWorldPort): SceneData {
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
  dirLight.position.set(6, 14, 4);
  scene.add(dirLight);

  const floor = buildBackArea(scene, physics);
  const pierFloor = buildPierAndWater(scene, physics);
  const lostFoundFloor = buildLostFoundRoom(scene, physics);
  const shelfSurfaces = buildWestWallShelves(scene, physics);
  buildFishingPier(scene, physics);
  buildCoffeeRoom(scene, physics);
  buildCampfireArea(scene, physics);
  buildMainHallSkylight(scene, physics);

  const interactables = new Map<string, InteractableObject>();
  buildBulletinBoard(scene, physics, interactables);
  const television = buildTelevisionAndTable(scene, physics, interactables);
  return { interactables, floor, pierFloor, lostFoundFloor, shelfSurfaces, television };
}

/** Wall-mounted bulletin board ("Add bulletin board upgrade system" round
 * spec一) — a thin wood-frame + corkboard panel, facing EAST into the room
 * (local +X, since local Z spans its `width` along the wall — see
 * BULLETIN_BOARD's own doc comment in logistics-layout-data.ts for the axis
 * reasoning). Purely decorative geometry beyond the frame itself (paper
 * scraps + pins + small skill-icon squares, spec一: "裝飾用紙張/圖釘/技能圖
 * 示", explicitly "不需要複雜動畫") — no moving parts, no per-frame update.
 * A single static collider wraps ONLY the board's own thin body (spec二:
 * "互動Collider只包住板面"), never an enlarged detection volume. Registered
 * into the shared `interactables` map as a raycast target the same way the
 * empty-bag supply rack already is — see BULLETIN_BOARD_INTERACTABLE_ID. */
function buildBulletinBoard(scene: THREE.Scene, physics: PhysicsWorldPort, interactables: Map<string, InteractableObject>): void {
  const { centerX, centerY, centerZ, width, height, thickness } = BULLETIN_BOARD;

  const group = new THREE.Group();
  group.position.set(centerX, centerY, centerZ);
  scene.add(group);

  // Wood frame — the full board volume; this IS the raycast/collider mesh.
  const frameMat = stdMat(0x6b4a2a);
  const frameGeo = new THREE.BoxGeometry(thickness, height, width);
  const frameMesh = new THREE.Mesh(frameGeo, frameMat);
  group.add(frameMesh);

  // Corkboard inset — slightly proud of the frame's east (room-facing) face.
  const corkMat = stdMat(0xc9a06a);
  const corkGeo = new THREE.BoxGeometry(thickness * 0.3, height * 0.82, width * 0.9);
  const corkMesh = new THREE.Mesh(corkGeo, corkMat);
  corkMesh.position.set(thickness / 2 + thickness * 0.15, 0, 0);
  group.add(corkMesh);

  // Decorative paper scraps — flat planes pinned at varied offsets.
  const paperColors = [0xe8e0c8, 0xd8ceb0, 0xece4d0];
  const paperPositions = [
    { y: height * 0.22, z: -width * 0.28, rz: 0.06 },
    { y: height * 0.05, z: -width * 0.05, rz: -0.04 },
    { y: -height * 0.12, z: width * 0.22, rz: 0.05 },
    { y: height * 0.18, z: width * 0.32, rz: -0.03 },
  ];
  const paperFaceX = thickness / 2 + thickness * 0.3 + 0.005;
  for (let i = 0; i < paperPositions.length; i++) {
    const p = paperPositions[i];
    const paperGeo = new THREE.PlaneGeometry(0.26, 0.34);
    const paperMesh = new THREE.Mesh(paperGeo, new THREE.MeshStandardMaterial({ color: paperColors[i % paperColors.length], side: THREE.DoubleSide }));
    paperMesh.position.set(paperFaceX, p.y, p.z);
    paperMesh.rotation.set(0, Math.PI / 2, p.rz);
    group.add(paperMesh);

    // Pin — a tiny sphere at the paper's top edge.
    const pinGeo = new THREE.SphereGeometry(0.02, 8, 8);
    const pinMesh = new THREE.Mesh(pinGeo, new THREE.MeshStandardMaterial({ color: 0xc03a3a }));
    pinMesh.position.set(paperFaceX + 0.01, p.y + 0.15, p.z);
    group.add(pinMesh);
  }

  // Small skill-icon squares along the bottom edge — a purely decorative
  // hint of "this board is about upgrades", not a functional icon set.
  const iconColors = [0x4a90b8, 0x8a6a3a, 0x4a9a4a, 0xb8a04a];
  for (let i = 0; i < iconColors.length; i++) {
    const iconGeo = new THREE.PlaneGeometry(0.14, 0.14);
    const iconMesh = new THREE.Mesh(iconGeo, new THREE.MeshStandardMaterial({ color: iconColors[i], side: THREE.DoubleSide }));
    const z = (i - (iconColors.length - 1) / 2) * 0.34;
    iconMesh.position.set(paperFaceX, -height * 0.34, z);
    iconMesh.rotation.y = Math.PI / 2;
    group.add(iconMesh);
  }

  const label = createFloatingLabel('物流中心公告欄', { width: 1.1, bg: 'rgba(30,25,15,0.75)' });
  label.position.set(thickness / 2 + 0.3, height / 2 + 0.3, 0);
  group.add(label);

  group.updateMatrixWorld(true);

  // Collider wraps only the board's own thin body — matches frameMesh
  // exactly, no enlarged detection volume (spec二).
  physics.createStaticCuboid(centerX, centerY, centerZ, thickness / 2, height / 2, width / 2);

  const obj = createInteractableObject(BULLETIN_BOARD_INTERACTABLE_ID, '物流中心公告欄', frameMesh, thickness, height, width);
  interactables.set(BULLETIN_BOARD_INTERACTABLE_ID, obj);
}

/** West-wall TV + small table ("Add television media playlist" round 一) —
 * a low-poly retro TV resting on a small table, both south of the bulletin
 * board (see TV_TABLE/TELEVISION's own doc comment in
 * logistics-layout-data.ts for the exact placement derivation). The table
 * gets its own player-blocking static collider but is NEVER an interactable
 * (spec二: "互動Collider只包住電視本體，不可使用大型距離感應範圍") — only
 * the TV itself is registered into `interactables`, as a SINGLE box mesh
 * with a 6-entry material array so the front (+X, room-facing) face can be
 * a distinct "screen" material without a second child mesh — this avoids
 * any raycast-target ambiguity between a body mesh and a separate screen
 * child (every other prop in this file registers exactly one mesh per
 * interactable; this keeps the TV consistent with that). The returned
 * `screenMaterial` is later toggled by MediaPlayerSystem (brighter emissive
 * while playing, spec八) and `label` shows the current playback status —
 * this file has zero playback-state knowledge of its own, it just hands
 * back the handles. */
function buildTelevisionAndTable(
  scene: THREE.Scene, physics: PhysicsWorldPort, interactables: Map<string, InteractableObject>
): { label: THREE.Sprite; screenMaterial: THREE.MeshStandardMaterial } {
  const { centerX: tableX, centerY: tableY, centerZ: tableZ, width: tableWidth, depth: tableDepth, height: tableHeight } = TV_TABLE;

  const tableGroup = new THREE.Group();
  tableGroup.position.set(tableX, tableY, tableZ);
  scene.add(tableGroup);

  const woodMat = stdMat(0x7a5a34);
  const topThickness = 0.05;
  const topGeo = new THREE.BoxGeometry(tableDepth, topThickness, tableWidth);
  const topMesh = new THREE.Mesh(topGeo, woodMat);
  topMesh.position.set(0, tableHeight / 2 - topThickness / 2, 0);
  tableGroup.add(topMesh);

  const legThickness = 0.06;
  const legHeight = tableHeight - topThickness;
  const legGeo = new THREE.BoxGeometry(legThickness, legHeight, legThickness);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, woodMat);
      leg.position.set(sx * (tableDepth / 2 - legThickness / 2), -topThickness / 2, sz * (tableWidth / 2 - legThickness / 2));
      tableGroup.add(leg);
    }
  }

  tableGroup.updateMatrixWorld(true);

  // Player-blocking collider only — matches the table's own full volume,
  // never registered as an interactable target.
  physics.createStaticCuboid(tableX, tableY, tableZ, tableDepth / 2, tableHeight / 2, tableWidth / 2);

  // --- Television ---
  const { centerX: tvX, centerY: tvY, centerZ: tvZ, width: tvWidth, height: tvHeight, depth: tvDepth } = TELEVISION;

  const bodyMat = stdMat(0x554d42, { roughness: 0.85 });
  // Off/idle screen — MediaPlayerSystem brightens this (emissiveIntensity)
  // while something is actually playing (spec八), never a VideoTexture.
  const screenMaterial = new THREE.MeshStandardMaterial({ color: 0x0c0e10, emissive: 0x3a6a8a, emissiveIntensity: 0, roughness: 0.35 });

  // BoxGeometry's default per-face material groups are ordered
  // [+X, -X, +Y, -Y, +Z, -Z] when given a 6-entry material array — index 0
  // is the local +X face, which (zero rotation, same convention as
  // BULLETIN_BOARD above) already faces east into the room, exactly where
  // the screen needs to be (spec一: "電視螢幕面向東方倉庫內側").
  const bodyGeo = new THREE.BoxGeometry(tvDepth, tvHeight, tvWidth);
  const tvMesh = new THREE.Mesh(bodyGeo, [screenMaterial, bodyMat, bodyMat, bodyMat, bodyMat, bodyMat]);
  tvMesh.position.set(tvX, tvY, tvZ);
  scene.add(tvMesh);

  const label = createFloatingLabel('媒體播放器\n尚未播放', { width: 0.9, bg: 'rgba(20,20,20,0.75)' });
  label.position.set(tvX + tvDepth / 2 + 0.3, tvY + tvHeight / 2 + 0.35, tvZ);
  scene.add(label);

  // Interaction collider wraps ONLY the TV's own body (spec二) — no
  // enlarged detection volume, matches tvMesh exactly.
  physics.createStaticCuboid(tvX, tvY, tvZ, tvDepth / 2, tvHeight / 2, tvWidth / 2);

  const obj = createInteractableObject(TELEVISION_INTERACTABLE_ID, '二手電視', tvMesh, tvDepth, tvHeight, tvWidth);
  interactables.set(TELEVISION_INTERACTABLE_ID, obj);

  return { label, screenMaterial };
}

function buildBackArea(scene: THREE.Scene, physics: PhysicsWorldPort): THREE.Mesh {
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
function buildLostFoundRoom(scene: THREE.Scene, physics: PhysicsWorldPort): THREE.Mesh {
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
function buildCoffeeRoom(scene: THREE.Scene, physics: PhysicsWorldPort): void {
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

/** Outdoor campfire rest area outside the land-vehicle exit ("每日特殊劇情系
 * 統" round, spec: "陸運出口外側，延伸一塊戶外空地，含營火、木頭、四周石頭
 * 、木頭長椅、烤棉花糖架") — Day6's own story scene, later reused by Day8's
 * finale ending. Purely decorative open-air geometry, no walls (it's an
 * outdoor clearing, not a room). */
function buildCampfireArea(scene: THREE.Scene, physics: PhysicsWorldPort): void {
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

/** Decorative skylight above the main hall (BACK_AREA) + a permanently-
 * visible starfield ("每日特殊劇情系統" round, Day3 spec: "在物流中心大廳
 * 加入一個大型天窗，夜晚可透過天窗看到星空、月亮、偶爾流星"). No day/night
 * lighting state exists anywhere in this codebase (confirmed via research —
 * a single fixed ambient+directional pair, never varied), and BACK_AREA has
 * no roof mesh to begin with (open-topped, like every other room here), so
 * this is scoped down to purely decorative geometry: a suspended frame +
 * an always-visible starfield/moon high above the hall. Day3's own "night"
 * framing is carried entirely by dialogue, not an actual lighting change —
 * shooting stars are handled by AfterWorkStorySystem's own Day3 story step
 * (a transient animated streak), not built here. */
function buildMainHallSkylight(scene: THREE.Scene, _physics: PhysicsWorldPort): void {
  const cx = (BACK_AREA.minX + BACK_AREA.maxX) / 2;
  const cz = (BACK_AREA.minZ + BACK_AREA.maxZ) / 2;
  const skyY = BACK_AREA.floorY + BACK_AREA.ceilingHeight + 0.15;

  const frameMat = stdMat(0x2a2a30, { side: THREE.DoubleSide });
  const frameThickness = 0.15;
  const frameSize = 6;
  const half = frameSize / 2;
  const beamA = new THREE.Mesh(new THREE.BoxGeometry(frameSize, frameThickness, frameThickness), frameMat);
  beamA.position.set(cx, skyY, cz - half);
  scene.add(beamA);
  const beamB = new THREE.Mesh(new THREE.BoxGeometry(frameSize, frameThickness, frameThickness), frameMat);
  beamB.position.set(cx, skyY, cz + half);
  scene.add(beamB);
  const beamC = new THREE.Mesh(new THREE.BoxGeometry(frameThickness, frameThickness, frameSize), frameMat);
  beamC.position.set(cx - half, skyY, cz);
  scene.add(beamC);
  const beamD = new THREE.Mesh(new THREE.BoxGeometry(frameThickness, frameThickness, frameSize), frameMat);
  beamD.position.set(cx + half, skyY, cz);
  scene.add(beamD);

  const glassMat = stdMat(0x0a1030, { transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(frameSize, frameSize), glassMat);
  glass.rotation.x = Math.PI / 2;
  glass.position.set(cx, skyY, cz);
  scene.add(glass);

  // Moon.
  const moon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 16), stdMat(0xf5f0dd, { emissive: 0xd8d0a0, emissiveIntensity: 0.6 }));
  moon.position.set(cx + 4, skyY + 18, cz - 3);
  scene.add(moon);

  // Starfield — a scattered point cloud high above the skylight.
  const starCount = 200;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 6 + Math.random() * 18;
    starPositions[i * 3] = cx + Math.cos(angle) * radius;
    starPositions[i * 3 + 1] = skyY + 12 + Math.random() * 12;
    starPositions[i * 3 + 2] = cz + Math.sin(angle) * radius;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, sizeAttenuation: true });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);
}

/** West-wall FREEZER CABINETS ("Add freezer shelves and frozen cargo
 * freshness system" round, third redesign pass spec一) — same footprint/
 * level-Y math as before (still driven by WEST_WALL_SHELVES/
 * SHELF_LEVEL_Y_OFFSETS), only the per-side dressing changed: light-gray
 * metal 4 corner posts (every side keeps these — they're shared structural
 * corners, never a "blocking panel") + 3 horizontal level boards (all still
 * real static Rapier colliders). Per compass side (local +X=East, -X=West,
 * +Z=South, -Z=North — see logistics-layout-data.ts's own convention
 * comment):
 *   - South (+Z) and North (-Z): semi-transparent glass infill panel.
 *   - East (+X): bare metal frame only — no infill panel of any kind (the
 *     old front glass pane that used to live here is gone).
 *   - West (-X): completely open — the old solid back panel (mesh AND
 *     collider) that used to sit against the wall here is removed entirely,
 *     nothing added in its place, so nothing on this side can ever block a
 *     placement raycast/shape-cast or a cargo throw.
 * Posts/glass are NEVER placement-surface candidates; only the 3 level
 * boards per group (6 total across both groups) are, each keeping its own
 * real static collider so placed cargo physically rests on it — identical
 * mechanism to before, just re-skinned per side. Callers
 * (create-game-systems.ts) register the returned meshes with
 * PickupSystem.addPlacementSurface() exactly as before. */
function buildWestWallShelves(scene: THREE.Scene, physics: PhysicsWorldPort): THREE.Mesh[] {
  const floorY = BACK_AREA.floorY;
  const frameMat = stdMat(0xa8adb2, { metalness: 0.75, roughness: 0.35 });
  const boardMat = stdMat(0xc2c6ca, { metalness: 0.55, roughness: 0.4 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xbfe4f0, transparent: true, opacity: 0.28, metalness: 0.1, roughness: 0.05,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const structureHeight = SHELF_LEVEL_Y_OFFSETS[SHELF_LEVEL_Y_OFFSETS.length - 1] + SHELF_BOARD_THICKNESS / 2 + SHELF_FRAME_TOP_MARGIN;

  const surfaces: THREE.Mesh[] = [];

  for (const shelf of WEST_WALL_SHELVES) {
    const { centerX, centerZ, width, depth } = shelf;
    const halfW = width / 2;
    const halfD = depth / 2;
    const group = new THREE.Group();
    group.position.set(centerX, floorY, centerZ);
    scene.add(group);

    // 4 corner posts, full structure height — local X is the cabinet's own
    // "depth" axis (wall -> room, East/West), local Z its "width" axis
    // (along the wall, North/South). Kept on every side (spec一: 東側"保留
    // 金屬框即可").
    const postGeo = new THREE.BoxGeometry(SHELF_POST_THICKNESS, structureHeight, SHELF_POST_THICKNESS);
    for (const sx of [-1, 1]) {
      const px = sx * (halfD - SHELF_POST_THICKNESS / 2);
      for (const sz of [-1, 1]) {
        const pz = sz * (halfW - SHELF_POST_THICKNESS / 2);
        const post = new THREE.Mesh(postGeo, frameMat);
        post.position.set(px, structureHeight / 2, pz);
        group.add(post);
        physics.createStaticCuboid(
          centerX + px, floorY + structureHeight / 2, centerZ + pz,
          SHELF_POST_THICKNESS / 2, structureHeight / 2, SHELF_POST_THICKNESS / 2
        );
      }
    }

    // South (+Z) and North (-Z) glass infill panels — flush with the posts
    // on their own side, spanning the depth (East-West) opening between the
    // front and back posts. Visual only: NEVER given a collider and NEVER
    // added to `surfaces`, so neither can intercept the placement
    // raycast/shape-cast or physically block anything.
    const sideGlassGeo = new THREE.BoxGeometry(depth - SHELF_POST_THICKNESS * 2, structureHeight - 0.05, 0.015);
    for (const sz of [-1, 1]) {
      const pz = sz * (halfW - SHELF_POST_THICKNESS / 2);
      const sideGlass = new THREE.Mesh(sideGlassGeo, glassMat);
      sideGlass.position.set(0, structureHeight / 2, pz);
      group.add(sideGlass);
    }
    // East (+X): bare frame only — no infill mesh at all.
    // West (-X): completely open — no back panel, no collider, nothing.

    // 3 horizontal level boards — each spans the cabinet's full footprint,
    // gets a real static collider (so placed cargo physically rests on it),
    // and is the only geometry this function returns as a placement-surface
    // candidate.
    for (const levelTopY of SHELF_LEVEL_Y_OFFSETS) {
      const boardLocalY = levelTopY - SHELF_BOARD_THICKNESS / 2;
      const boardGeo = new THREE.BoxGeometry(depth, SHELF_BOARD_THICKNESS, width);
      const board = new THREE.Mesh(boardGeo, boardMat);
      board.position.set(0, boardLocalY, 0);
      group.add(board);
      physics.createStaticCuboid(
        centerX, floorY + boardLocalY, centerZ,
        halfD, SHELF_BOARD_THICKNESS / 2, halfW
      );
      surfaces.push(board);
    }

    const label = createFloatingLabel('冷藏貨架', { width: 0.7, bg: 'rgba(20,40,55,0.7)' });
    label.position.set(0, structureHeight + 0.3, 0);
    group.add(label);

    group.updateMatrixWorld(true);
  }

  return surfaces;
}

function buildPierAndWater(scene: THREE.Scene, physics: PhysicsWorldPort): THREE.Mesh {
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

const WOOD_DECK_MAT = () => stdMat(0x8b5a2b);
const WOOD_DARK_MAT = () => stdMat(0x5a3d20);
const WOOD_PILING_MAT = () => stdMat(0x4a3018);

/** Independent small fishing pier ("Relocate pallet racks and add fishing
 * pier" round三) — south of the main sea-vehicle PIER, sharing its floorY so
 * there is no height discontinuity at the seam (spec: "與現有岸邊無高低差").
 * All positions come from fishing-pier-data.ts; this function only builds
 * geometry/colliders from them. Deliberately does NOT touch PIER's own deck,
 * water plane, or collider, and stays entirely south of every sea vehicle's
 * own dock/travel range (see fishing-pier-data.ts's own doc comment) — no
 * vehicle-route safety logic is needed here beyond correct static placement.
 * Open at the south (far) end — no railing there, so the fishing view over
 * open water stays unobstructed (spec: "面向海的一側維持開放"). */
function buildFishingPier(scene: THREE.Scene, physics: PhysicsWorldPort): void {
  const { minX, maxX, minZ, maxZ, floorY, deckThickness } = FISHING_PIER;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const deckGeo = new THREE.PlaneGeometry(width, depth);
  const deck = new THREE.Mesh(deckGeo, WOOD_DECK_MAT());
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(cx, floorY, cz);
  scene.add(deck);
  physics.createStaticCuboid(cx, floorY - deckThickness / 2, cz, width / 2, deckThickness / 2, depth / 2);

  // Four corner support pilings, driven down toward the water below — purely
  // decorative (the deck's own collider above already handles walkability),
  // low-poly (8-sided cylinders) to match the requested wooden/low-poly look.
  const pilingRadius = 0.09;
  const pilingInset = 0.2;
  const pilingTopY = floorY - deckThickness;
  const pilingBottomY = floorY - 1.1;
  const pilingHeight = pilingTopY - pilingBottomY;
  const pilingGeo = new THREE.CylinderGeometry(pilingRadius, pilingRadius * 1.15, pilingHeight, 8);
  for (const px of [minX + pilingInset, maxX - pilingInset]) {
    for (const pz of [minZ + pilingInset, maxZ - pilingInset]) {
      const piling = new THREE.Mesh(pilingGeo, WOOD_PILING_MAT());
      piling.position.set(px, pilingTopY - pilingHeight / 2, pz);
      scene.add(piling);
    }
  }

  buildFishingChair(scene, physics, FISHING_CHAIR_A);
  buildFishingChair(scene, physics, FISHING_CHAIR_B);
  buildFishingRod(scene, FISHING_ROD_A);
  buildFishingRod(scene, FISHING_ROD_B);
  buildFishingBucket(scene, FISHING_BUCKET);
  buildFishingTackleBox(scene, FISHING_TACKLE_BOX);
  buildFishingLantern(scene, FISHING_LANTERN);
}

/** Simple low-poly wooden chair, facing +Z (no yaw — its backrest sits on
 * the -Z side by construction). Static collider only, no sitting behavior
 * this round (spec三: "本輪不需要實作坐下功能"). */
function buildFishingChair(scene: THREE.Scene, physics: PhysicsWorldPort, pos: THREE.Vector3): void {
  const legHeight = 0.28;
  const seatThickness = 0.06;
  const seatY = pos.y + legHeight + seatThickness / 2;

  const legGeo = new THREE.CylinderGeometry(0.03, 0.03, legHeight, 6);
  const legOffsets: [number, number][] = [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]];
  for (const [ox, oz] of legOffsets) {
    const leg = new THREE.Mesh(legGeo, WOOD_DARK_MAT());
    leg.position.set(pos.x + ox, pos.y + legHeight / 2, pos.z + oz);
    scene.add(leg);
  }

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, seatThickness, 0.5), WOOD_DECK_MAT());
  seat.position.set(pos.x, seatY, pos.z);
  scene.add(seat);

  const backHeight = 0.4;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, backHeight, 0.06), WOOD_DECK_MAT());
  back.position.set(pos.x, seatY + backHeight / 2, pos.z - 0.22);
  scene.add(back);

  physics.createStaticCuboid(pos.x, pos.y + 0.35, pos.z, 0.26, 0.35, 0.26);
}

/** Thin leaning fishing rod — a plain cylinder tilted against an implicit
 * rest point near its chair, low-poly. */
function buildFishingRod(scene: THREE.Scene, pos: THREE.Vector3): void {
  const rodLength = 1.6;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, rodLength, 6), WOOD_DARK_MAT());
  rod.position.set(pos.x, pos.y + (rodLength / 2) * Math.cos(0.35), pos.z);
  rod.rotation.z = 0.35;
  scene.add(rod);
}

function buildFishingBucket(scene: THREE.Scene, pos: THREE.Vector3): void {
  const bucketHeight = 0.32;
  const bucket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.13, bucketHeight, 10, 1, true),
    stdMat(0x3a3a3a, { side: THREE.DoubleSide })
  );
  bucket.position.set(pos.x, pos.y + bucketHeight / 2, pos.z);
  scene.add(bucket);
}

function buildFishingTackleBox(scene: THREE.Scene, pos: THREE.Vector3): void {
  const boxHeight = 0.22;
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, boxHeight, 0.24), WOOD_DARK_MAT());
  box.position.set(pos.x, pos.y + boxHeight / 2, pos.z);
  scene.add(box);
}

/** Low lantern — a small wood-topped glass-look cylinder with a faint
 * emissive glow (decorative only, no actual THREE.PointLight — keeps this
 * simple, "不需要複雜動畫"). */
function buildFishingLantern(scene: THREE.Scene, pos: THREE.Vector3): void {
  const bodyHeight = 0.18;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.1, bodyHeight, 8),
    stdMat(0xffdd88, { emissive: 0x442200 })
  );
  body.position.set(pos.x, pos.y + bodyHeight / 2, pos.z);
  scene.add(body);

  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.08, 8), WOOD_DARK_MAT());
  cap.position.set(pos.x, pos.y + bodyHeight + 0.04, pos.z);
  scene.add(cap);
}
