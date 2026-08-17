// Visual/physical construction for the main hall (BACK_AREA) and its own
// wall-mounted furniture — split out of world-layout-system.ts during the
// "world-layout per-area modularization" round (pure move, no behavior
// change). See world-layout-system.ts's own createLogisticsScene() for the
// dispatch/composition entry point that calls into these.
import * as THREE from 'three';
import { InteractableObject, createInteractableObject } from '../../shared/types/interactable';
import { PhysicsWorldPort } from '../../shared/types/physics-world-port';
import {
  WALL_THICKNESS, BACK_AREA, LAND_GATE, SEA_GATE,
  WEST_WALL_SHELVES, SHELF_LEVEL_Y_OFFSETS, SHELF_BOARD_THICKNESS, SHELF_POST_THICKNESS, SHELF_FRAME_TOP_MARGIN,
  BULLETIN_BOARD, TV_TABLE, TELEVISION,
} from './logistics-layout-data';
import { CARGO_CHUTE_DOORWAY } from '../../data/world/cargo-chute-room-layout-data';
import { LOST_FOUND_DOOR } from '../../data/world/lost-found-layout-data';
import { PLAYER_ROOM_DOOR } from '../../data/world/player-room-layout-data';
import { createFloatingLabel } from '../../adapters/three/world-label-system';
import { stdMat, addWall } from './world-layout-shared';

/** The bulletin board's own raycast-target id ("Add bulletin board upgrade
 * system" round spec二) — registered directly into the SAME shared
 * `interactables` map every other pickupable prop uses, so
 * InteractionSystem's existing single crosshair raycast resolves it for
 * free. `canPickUp: true` only so it passes that raycast's own generic
 * filter — it's never actually handed to PickupSystem.pickUp();
 * InteractionSystem intercepts E specially before the generic pickup/
 * multi-carry path runs. */
export const BULLETIN_BOARD_INTERACTABLE_ID = 'bulletin-board';

/** The west-wall television's own raycast-target id ("Add television media
 * playlist" round spec二) — registered into the SAME shared `interactables`
 * map, resolved by InteractionSystem's existing single crosshair raycast,
 * exactly mirroring BULLETIN_BOARD_INTERACTABLE_ID above. The small table it
 * sits on is NOT registered here (spec二: "互動Collider只包住電視本體") — it
 * only gets a player-blocking physics collider, never an interactable
 * entry, so the TV alone is ever a valid crosshair target. */
export const TELEVISION_INTERACTABLE_ID = 'television';

export function buildBackArea(scene: THREE.Scene, physics: PhysicsWorldPort): THREE.Mesh {
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

  // North wall — single doorway into the new north cargo-chute room
  // ("重製出貨口" round spec一/二: replaces the old dual NORTH_GATES
  // wall-mounted unload docks entirely — see cargo-chute-room-layout-data.ts
  // and buildCargoChuteRoom below). Physical opening only — UnloadingSystem
  // builds its own chute-housing/hatch geometry above/inside the new room,
  // same "structural walls here, feature furniture in its own system" split
  // every other gate opening in this file already follows.
  const chuteGapL = CARGO_CHUTE_DOORWAY.centerX - CARGO_CHUTE_DOORWAY.halfWidth;
  const chuteGapR = CARGO_CHUTE_DOORWAY.centerX + CARGO_CHUTE_DOORWAY.halfWidth;
  addWall(scene, physics, wallMat, (minX + chuteGapL) / 2, midY, minZ, chuteGapL - minX, ceilingHeight, WALL_THICKNESS);

  // "主角房間" round — a second gap further east on this same wall, for
  // PLAYER_ROOM_DOOR (the player bedroom's own entrance, spec: "位於物流中心
  // 東北方牆角"). Splits what used to be one long solid segment
  // (chuteGapR..maxX) into solid/gap/solid, same convention as every other
  // gate opening in this file.
  const playerGapL = PLAYER_ROOM_DOOR.centerX - PLAYER_ROOM_DOOR.halfWidth;
  const playerGapR = PLAYER_ROOM_DOOR.centerX + PLAYER_ROOM_DOOR.halfWidth;
  addWall(scene, physics, wallMat, (chuteGapR + playerGapL) / 2, midY, minZ, playerGapL - chuteGapR, ceilingHeight, WALL_THICKNESS);
  addWall(scene, physics, wallMat, (playerGapR + maxX) / 2, midY, minZ, maxX - playerGapR, ceilingHeight, WALL_THICKNESS);

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
export function buildBulletinBoard(scene: THREE.Scene, physics: PhysicsWorldPort, interactables: Map<string, InteractableObject>): void {
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
export function buildTelevisionAndTable(
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
export function buildWestWallShelves(scene: THREE.Scene, physics: PhysicsWorldPort): THREE.Mesh[] {
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
export function buildMainHallSkylight(scene: THREE.Scene, _physics: PhysicsWorldPort): void {
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

/** "世界地名與郵票圖樣調整" round — a purely decorative welcome sign naming
 * this whole building's own town (spec: "伊塔卡港鎮｜主角故鄉、物流中心" —
 * confirmed with the requester that this should be a landmark/signboard
 * ONLY, not a new mail destination/stamp, since Ithaca is the PLAYER's own
 * location rather than something they'd ship mail to). Mounted just inside
 * the south wall's own land-vehicle gate — the first thing a player sees
 * walking in from the land-vehicle dock — as a simple camera-facing sprite
 * label, the exact same convention every other room/area name already uses
 * (buildCampfireArea's own "營火區" label, the coffee room's "休息室" label).
 * No collider, no interactable registration — text only. */
export function buildIthacaTownSign(scene: THREE.Scene): void {
  const label = createFloatingLabel('伊塔卡港鎮\n異世界物流中心', {
    width: 1.3, canvasHeight: 140, fontSize: 30, bg: 'rgba(20,35,45,0.78)', fg: '#ffe9b3',
  });
  label.position.set(LAND_GATE.centerX, BACK_AREA.floorY + 2.6, BACK_AREA.maxZ - 1.2);
  scene.add(label);
}
