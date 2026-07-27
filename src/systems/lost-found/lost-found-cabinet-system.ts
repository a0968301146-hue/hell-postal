import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject } from '../../shared/types/interactable';
import { PickupPort } from '../../shared/types/pickup-port';
import {
  LOST_FOUND_CABINET_COLUMNS, LOST_FOUND_CABINET_ROWS,
  LOST_FOUND_CABINET_DIVIDER_THICKNESS, LOST_FOUND_CABINET_SHELF_THICKNESS, LOST_FOUND_CABINET_BACK_THICKNESS,
  LOST_FOUND_CABINET_WALL_CLEARANCE, LOST_FOUND_CABINET_ANCHOR_Z, LOST_FOUND_ROOM,
} from '../../data/world/lost-found-layout-data';
import { createFloatingLabel } from '../../adapters/three/world-label-system';
import { LOST_ITEM_PRESETS } from './lost-found-data';

export interface CabinetSlotBounds {
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
}

interface CabinetSlot {
  slotId: string;
  bounds: CabinetSlotBounds;
  storedItemId: string | null;
}

const STABLE_THRESHOLD = 0.5; // spec四: "至少0.5秒"
const VELOCITY_THRESHOLD = 0.4;
/** spec六: "建議最大尺寸不超過單一格內部空間的85%" — kept from the previous
 * round as a safety cap; with cell interiors now sized directly off the
 * largest real preset (see computeCellInteriorSize below), this almost
 * never actually triggers any more, but stays as a defensive backstop. */
const CABINET_FIT_MARGIN = 0.85;

/** spec二 ("Fix lost found cabinet storage space" round): "單格內部尺寸至少
 * 為：寬度最大失物寬度x1.25／高度最大失物高度x1.25／深度最大失物深度x1.5". */
const CELL_WIDTH_MARGIN = 1.25;
const CELL_HEIGHT_MARGIN = 1.25;
const CELL_DEPTH_MARGIN = 1.5;

/** BACK_AREA/LOST_FOUND_ROOM's shared west wall is centered at x=-10 with
 * WALL_THICKNESS=0.2 (logistics-layout-data.ts's addWall), so its physical
 * inner face — the actual surface open floor starts from — sits at -9.9,
 * not -10. A literal here for the same reason lost-found-layout-data.ts
 * already uses literals for floorY/minX: importing WALL_THICKNESS/BACK_AREA
 * from logistics-layout-data.ts would be circular (that file imports
 * LOST_FOUND_ROOM from lost-found-layout-data.ts, which this file already
 * imports). */
const BACK_AREA_WEST_WALL_INNER_X = -9.9;

interface CellInteriorSize {
  /** Across the cabinet's face (world Z). */
  width: number;
  height: number;
  /** Into the wall (world X). */
  depth: number;
}

/** Reads every LostItemPreset's own colliderSize and returns the minimum
 * per-cell INTERIOR size that guarantees every one of them fits with real
 * margin (spec二: "讀取所有LostItemPreset的colliderSize，找出最大失物尺
 * 寸") — derived from the actual data rather than a hand-picked constant, so
 * the cabinet is never sized independently of what it actually needs to
 * hold. Every lost item mesh/collider is built upright/unrotated (matching
 * how it's spawned — see lost-found-system.ts), so a preset's own local x/y/z
 * map directly to cabinet depth/height/width. */
function computeCellInteriorSize(): CellInteriorSize {
  let maxWidth = 0;
  let maxHeight = 0;
  let maxDepth = 0;
  for (const preset of LOST_ITEM_PRESETS) {
    maxWidth = Math.max(maxWidth, preset.colliderHalfExtents.z * 2);
    maxHeight = Math.max(maxHeight, preset.colliderHalfExtents.y * 2);
    maxDepth = Math.max(maxDepth, preset.colliderHalfExtents.x * 2);
  }
  return {
    width: maxWidth * CELL_WIDTH_MARGIN,
    height: maxHeight * CELL_HEIGHT_MARGIN,
    depth: maxDepth * CELL_DEPTH_MARGIN,
  };
}

const CELL_INTERIOR = computeCellInteriorSize();

/** Uniform (never per-axis) scale factor that would shrink `visualHalfExtents`
 * (world X=cabinet depth, Y=height, Z=width) so its full size stays within
 * 85% of one cell's interior on every axis at once (spec六 from the previous
 * round). Returns 1 for every current LOST_ITEM_PRESETS entry now that cell
 * interiors are derived from the same data (CELL_INTERIOR above already
 * exceeds every preset's own raw size by the 1.25x/1.5x margins) — kept as a
 * defensive backstop for any future oversized preset. Callers must apply the
 * SAME returned factor to both visualHalfExtents AND colliderHalfExtents. */
export function computeLostItemFitScale(visualHalfExtents: { x: number; y: number; z: number }): number {
  const sizeX = visualHalfExtents.x * 2;
  const sizeY = visualHalfExtents.y * 2;
  const sizeZ = visualHalfExtents.z * 2;
  const limitX = CABINET_FIT_MARGIN * CELL_INTERIOR.depth;
  const limitY = CABINET_FIT_MARGIN * CELL_INTERIOR.height;
  const limitZ = CABINET_FIT_MARGIN * CELL_INTERIOR.width;
  return Math.min(1, limitX / sizeX, limitY / sizeY, limitZ / sizeZ);
}

/**
 * The lost-item storage cabinet ("Expand lost found return storage and
 * scoring" round 四) — a wall-mounted fixture in BACK_AREA's own
 * package-sorting area, built independently of world-layout-system.ts
 * (structural room walls stay there; this class builds its own furniture,
 * same pattern as lost-found-system.ts's counter).
 *
 * "Fix lost found cabinet storage space" round: rebuilt from a solid block
 * with painted-on divider lines (every cell's own "interior" was actually
 * 100% filled by a full-depth back-panel collider, so nothing could ever
 * physically rest inside one) into cells with a genuinely open, hollow
 * interior. Collider only ever exists on the outer frame / left-right
 * dividers / horizontal shelves / the single rear back panel — the front
 * face of every cell is left completely clear (spec一). Every shelf,
 * divider, and the back panel is ALSO registered as a PickupSystem
 * placement surface: shelves are real (top-facing-normal) placement
 * targets, while dividers/the back panel exist in that same list purely so
 * PickupSystem's own existing raycast correctly stops AT them (their
 * exposed faces are vertical, so PickupSystem's "must be a top-facing
 * surface" check already rejects them as placement targets) instead of the
 * ray passing straight through into a neighboring cell (spec四: "射線命中隔
 * 板時不可把物品生成到另一格") — no second placement system, no
 * PickupSystem changes needed.
 *
 * Purely passive detection otherwise, no forced snapping or mini-game — see
 * update() below, which just watches which cell each tracked item's center
 * currently sits in.
 */
export class LostFoundCabinetSystem {
  private interactables: Map<string, InteractableObject>;
  private slots: CabinetSlot[] = [];
  private trackedItemIds: Set<string> = new Set();
  private stableTimers: Map<string, number> = new Map();
  /** id -> slotId currently occupied by that item — mirrors each slot's own
   * storedItemId for O(1) reverse lookup when clearing on pickup/removal. */
  private itemToSlot: Map<string, string> = new Map();

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>, pickupSystem: PickupPort
  ) {
    this.interactables = interactables;
    this.build(scene, physics, pickupSystem);
  }

  private build(scene: THREE.Scene, physics: PhysicsSystem, pickupSystem: PickupPort): void {
    const cols = LOST_FOUND_CABINET_COLUMNS;
    const rows = LOST_FOUND_CABINET_ROWS;
    const div = LOST_FOUND_CABINET_DIVIDER_THICKNESS;
    const shelfT = LOST_FOUND_CABINET_SHELF_THICKNESS;
    const backT = LOST_FOUND_CABINET_BACK_THICKNESS;
    const floorY = LOST_FOUND_ROOM.floorY; // BACK_AREA shares the same floor level

    const totalWidth = cols * CELL_INTERIOR.width + (cols + 1) * div;
    const totalHeight = rows * CELL_INTERIOR.height + (rows + 1) * shelfT;
    const totalDepth = CELL_INTERIOR.depth + backT; // open front — no thickness added on that side

    // Positioned with real clearance off the shared west wall (spec三).
    const backOuterX = BACK_AREA_WEST_WALL_INNER_X + LOST_FOUND_CABINET_WALL_CLEARANCE;
    const centerX = backOuterX + totalDepth / 2;
    const centerZ = LOST_FOUND_CABINET_ANCHOR_Z;
    const centerY = floorY + totalHeight / 2;
    const leftZ = centerZ - totalWidth / 2;

    // backInnerX = the back panel's own FRONT face = the rear boundary of
    // every cell's real interior. frontX = the cabinet's open front plane —
    // no collider is ever built at this X coordinate (spec一: "櫃子正面不得
    // 存在整片封閉Collider").
    const backInnerX = centerX - totalDepth / 2 + backT;
    const frontX = centerX + totalDepth / 2;
    const structDepth = frontX - backInnerX; // == CELL_INTERIOR.depth
    const structCenterX = (backInnerX + frontX) / 2;

    // Back panel — the ONE piece spanning the full depth, and only this
    // one (spec一: Collider只能建立在外框/隔板/層板/背板).
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x5a4530 });
    const backGeo = new THREE.BoxGeometry(backT, totalHeight, totalWidth);
    const backMesh = new THREE.Mesh(backGeo, frameMat);
    backMesh.position.set(centerX - totalDepth / 2 + backT / 2, centerY, centerZ);
    scene.add(backMesh);
    physics.createStaticCuboid(backMesh.position.x, centerY, centerZ, backT / 2, totalHeight / 2, totalWidth / 2);
    // Registered purely so PickupSystem's own raycast stops here instead of
    // passing through to whatever's beyond — its vertical-normal face never
    // passes PickupSystem's own top-facing-surface check, so it can never
    // itself become a valid placement target.
    pickupSystem.addPlacementSurface(backMesh);

    // Horizontal shelves (rows+1) — real floors/ceilings each cell rests
    // between, spanning the open interior depth (never past the front
    // plane) and the cabinet's full width. Registered as placement
    // surfaces — a shelf's top face is what actually makes it a valid
    // PickupSystem placement target.
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x6b5540 });
    const shelfYs: number[] = [];
    {
      let y = floorY;
      for (let r = 0; r <= rows; r++) {
        const shelfCenterY = y + shelfT / 2;
        shelfYs.push(shelfCenterY);
        const shelfGeo = new THREE.BoxGeometry(structDepth, shelfT, totalWidth);
        const shelf = new THREE.Mesh(shelfGeo, shelfMat);
        shelf.position.set(structCenterX, shelfCenterY, centerZ);
        scene.add(shelf);
        physics.createStaticCuboid(structCenterX, shelfCenterY, centerZ, structDepth / 2, shelfT / 2, totalWidth / 2);
        pickupSystem.addPlacementSurface(shelf);
        y += shelfT;
        if (r < rows) y += CELL_INTERIOR.height;
      }
    }

    // Vertical dividers (cols+1) — real left/right cell walls, same
    // full-open-depth span as the shelves. Registered as placement surfaces
    // too, for the same "correctly blocks a reach-through raycast" reason
    // as the back panel above.
    const dividerMat = new THREE.MeshStandardMaterial({ color: 0x3f3020 });
    const dividerZs: number[] = [];
    {
      let z = leftZ;
      for (let c = 0; c <= cols; c++) {
        const dividerCenterZ = z + div / 2;
        dividerZs.push(dividerCenterZ);
        const dividerGeo = new THREE.BoxGeometry(structDepth, totalHeight, div);
        const strip = new THREE.Mesh(dividerGeo, dividerMat);
        strip.position.set(structCenterX, centerY, dividerCenterZ);
        scene.add(strip);
        physics.createStaticCuboid(structCenterX, centerY, dividerCenterZ, structDepth / 2, totalHeight / 2, div / 2);
        pickupSystem.addPlacementSurface(strip);
        z += div;
        if (c < cols) z += CELL_INTERIOR.width;
      }
    }

    // slotBounds — exactly the open interior volume between two shelves and
    // two dividers, bounded at the back by the back panel's own front face
    // and at the front by the cabinet's own open plane (spec五: 不包含隔板
    // 厚度/不超出櫃子正面/不伸入背牆/與視覺格子完全對齊).
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.slots.push({
          slotId: `cabinet-r${r}-c${c}`,
          bounds: {
            minX: backInnerX, maxX: frontX,
            minY: shelfYs[r] + shelfT / 2, maxY: shelfYs[r + 1] - shelfT / 2,
            minZ: dividerZs[c] + div / 2, maxZ: dividerZs[c + 1] - div / 2,
          },
          storedItemId: null,
        });
      }
    }

    const label = createFloatingLabel('失物收納櫃', { width: 0.9, bg: 'rgba(30,25,20,0.75)' });
    label.position.set(centerX, floorY + totalHeight + 0.5, centerZ);
    scene.add(label);
  }

  /** Registers a lost item id to be scanned each frame — called by
   * LostFoundSystem whenever it spawns a new lost item (target or decoy).
   * Deliberately an explicit tracked-id list (mirrors DailyFlowSystem.
   * dailyCargoIds' own pattern) rather than scanning the whole
   * interactables map, so this system never needs to guess which
   * interactable ids are lost items. */
  track(id: string): void {
    this.trackedItemIds.add(id);
  }

  /** Deregisters an id (handed over to the NPC, or otherwise removed) and
   * clears whichever slot it was occupying, if any. */
  untrack(id: string): void {
    this.trackedItemIds.delete(id);
    this.stableTimers.delete(id);
    this.clearSlotFor(id);
  }

  private clearSlotFor(id: string): void {
    const slotId = this.itemToSlot.get(id);
    if (!slotId) return;
    const slot = this.slots.find((s) => s.slotId === slotId);
    if (slot && slot.storedItemId === id) slot.storedItemId = null;
    this.itemToSlot.delete(id);
  }

  isStored(id: string): boolean {
    return this.itemToSlot.has(id);
  }

  getStoredSlotId(id: string): string | null {
    return this.itemToSlot.get(id) ?? null;
  }

  update(deltaTime: number): void {
    for (const id of this.trackedItemIds) {
      const obj = this.interactables.get(id);
      if (!obj || obj.isHeld || !obj.mesh.visible) {
        this.stableTimers.delete(id);
        this.clearSlotFor(id);
        continue;
      }

      const p = obj.mesh.position;
      const slot = this.slots.find((s) =>
        p.x >= s.bounds.minX && p.x <= s.bounds.maxX &&
        p.y >= s.bounds.minY && p.y <= s.bounds.maxY &&
        p.z >= s.bounds.minZ && p.z <= s.bounds.maxZ
      );

      if (!slot) {
        this.stableTimers.delete(id);
        this.clearSlotFor(id);
        continue;
      }

      if (this.itemToSlot.get(id) === slot.slotId) continue; // already stored here

      // A DIFFERENT item already claims this slot (spec四: "一格只能計入一
      // 件失物") — this item can't also claim it; skip rather than evict.
      if (slot.storedItemId && slot.storedItemId !== id) {
        this.stableTimers.delete(id);
        continue;
      }

      let stable = true;
      if (obj.rigidBody) {
        const lv = obj.rigidBody.linvel();
        const av = obj.rigidBody.angvel();
        const speed = Math.sqrt(lv.x ** 2 + lv.y ** 2 + lv.z ** 2);
        const angSpeed = Math.sqrt(av.x ** 2 + av.y ** 2 + av.z ** 2);
        stable = speed < VELOCITY_THRESHOLD && angSpeed < VELOCITY_THRESHOLD;
      }
      const prev = this.stableTimers.get(id) ?? 0;
      const next = stable ? prev + deltaTime : 0;
      this.stableTimers.set(id, next);

      if (next >= STABLE_THRESHOLD) {
        // An item can only belong to one slot at a time (spec四) — clear
        // any previous claim before taking this one.
        this.clearSlotFor(id);
        slot.storedItemId = id;
        this.itemToSlot.set(id, slot.slotId);
        this.stableTimers.delete(id);
      }
    }
  }

  /** Clears all slot occupancy/tracking — day reset only. LostFoundSystem
   * also calls untrack() for every item it individually disposes at reset
   * time, which already clears each one's own slot; this is a defensive
   * full sweep on top of that. */
  resetDaily(): void {
    for (const slot of this.slots) slot.storedItemId = null;
    this.itemToSlot.clear();
    this.stableTimers.clear();
    this.trackedItemIds.clear();
  }
}
