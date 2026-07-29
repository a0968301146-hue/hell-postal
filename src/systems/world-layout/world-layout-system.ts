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
  WALL_THICKNESS, BACK_AREA, CARGO_ZONES, LAND_DOCKS, LAND_GATE, PIER, SEA_GATE, SEA_DOCKS, NORTH_GATES,
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
  /** West-wall storage shelves' own level-top boards ("Add storage shelves
   * along west wall" round spec三/五) — 3 boards per shelf group, 9 total.
   * Registered as additional PickupSystem placement surfaces the same way
   * pierFloor/lostFoundFloor already are (see create-game-systems.ts) —
   * this file only builds the Mesh/Collider/candidate-surface geometry,
   * never touches PickupSystem itself (it doesn't exist yet at this point
   * in app startup). */
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
  buildCargoZones(scene);
  buildLandDocks(scene);
  const pierFloor = buildPierAndWater(scene, physics);
  buildSeaDocks(scene);
  const lostFoundFloor = buildLostFoundRoom(scene, physics);
  const shelfSurfaces = buildWestWallShelves(scene, physics);

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

/** West-wall storage shelves ("Add storage shelves along west wall" round
 * spec二/三/五) — 3 free-standing open wooden shelf groups, each a plain
 * static frame: 4 corner posts + 1 back panel (against the wall) + 3
 * horizontal level boards. Posts/back panel get a real Rapier collider (so
 * they physically block movement/throws and occlude the crosshair/cargo-
 * inspection raycasts) but are NEVER returned as candidate placement
 * surfaces (spec三: "貨架側板、支柱與背架只阻擋射線，不可成為水平放置面") —
 * only the 3 level boards per group (9 total) are, each also getting its
 * own real static collider so placed cargo physically rests on it rather
 * than falling through. Callers (create-game-systems.ts) register the
 * returned meshes with PickupSystem.addPlacementSurface() once that system
 * exists — this file only ever builds Mesh/Collider/candidate-surface
 * geometry, never touches PickupSystem itself (spec五: 不建立新的
 * ShelfSystem). */
function buildWestWallShelves(scene: THREE.Scene, physics: PhysicsWorldPort): THREE.Mesh[] {
  const floorY = BACK_AREA.floorY;
  const frameMat = stdMat(0x6b4a2a);
  const boardMat = stdMat(0x8a6438);
  const structureHeight = SHELF_LEVEL_Y_OFFSETS[SHELF_LEVEL_Y_OFFSETS.length - 1] + SHELF_BOARD_THICKNESS / 2 + SHELF_FRAME_TOP_MARGIN;

  const surfaces: THREE.Mesh[] = [];

  for (const shelf of WEST_WALL_SHELVES) {
    const { centerX, centerZ, width, depth } = shelf;
    const halfW = width / 2;
    const halfD = depth / 2;
    const group = new THREE.Group();
    group.position.set(centerX, floorY, centerZ);
    scene.add(group);

    // 4 corner posts, full structure height — local X is the shelf's own
    // "depth" axis (wall -> room), local Z its "width" axis (along the wall).
    const postGeo = new THREE.BoxGeometry(SHELF_POST_THICKNESS, structureHeight, SHELF_POST_THICKNESS);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const px = sx * (halfD - SHELF_POST_THICKNESS / 2);
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

    // Back panel — against the wall (local -X), full height, spanning the
    // whole width (spec二/三: "背架").
    const backLocalX = -halfD + SHELF_BOARD_THICKNESS / 2;
    const backGeo = new THREE.BoxGeometry(SHELF_BOARD_THICKNESS, structureHeight, width);
    const back = new THREE.Mesh(backGeo, frameMat);
    back.position.set(backLocalX, structureHeight / 2, 0);
    group.add(back);
    physics.createStaticCuboid(
      centerX + backLocalX, floorY + structureHeight / 2, centerZ,
      SHELF_BOARD_THICKNESS / 2, structureHeight / 2, width / 2
    );

    // 3 horizontal level boards — each spans the shelf's full footprint,
    // gets a real static collider (so placed cargo physically rests on it),
    // and is the only geometry this function returns as a placement-surface
    // candidate (spec三).
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

    const label = createFloatingLabel('置物架', { width: 0.7, bg: 'rgba(30,25,15,0.7)' });
    label.position.set(0, structureHeight + 0.3, 0);
    group.add(label);

    group.updateMatrixWorld(true);
  }

  return surfaces;
}

/** White-box-only floor markers reserving space for future cargo-type zones
 * (normal/large(domestic+overseas)/frozen(domestic+overseas)/live(domestic+
 * overseas)/lost-found — see CARGO_ZONES). No function yet — just space
 * claims, purely decal + label, no physics collider. */
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
