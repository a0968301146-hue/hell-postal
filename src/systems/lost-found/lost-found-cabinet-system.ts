import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject } from '../../shared/types/interactable';
import { PickupPort } from '../../shared/types/pickup-port';
import {
  LOST_FOUND_CABINET_POS, LOST_FOUND_CABINET_COLUMNS, LOST_FOUND_CABINET_ROWS,
  LOST_FOUND_CABINET_CELL_WIDTH, LOST_FOUND_CABINET_CELL_HEIGHT, LOST_FOUND_CABINET_CELL_DEPTH,
  LOST_FOUND_CABINET_DIVIDER_THICKNESS, LOST_FOUND_ROOM,
} from '../../data/world/lost-found-layout-data';
import { createFloatingLabel } from '../../adapters/three/world-label-system';

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
const SHELF_THICKNESS = 0.05;
/** spec六: "建議最大尺寸不超過單一格內部空間的85%". */
const CABINET_FIT_MARGIN = 0.85;

/**
 * Uniform (never per-axis) scale factor that shrinks `visualHalfExtents`
 * (world X=cabinet depth, Y=height, Z=width — every lost item mesh is built
 * upright/unrotated, matching how it sits in the cabinet) so its full size
 * stays within 85% of one cell's interior on every axis at once (spec六).
 * Returns 1 when the preset already fits — most presets never get touched.
 * Callers must apply the SAME returned factor to both visualHalfExtents AND
 * colliderHalfExtents (spec: "不得只縮小外觀模型卻保留過大的碰撞體"). */
export function computeLostItemFitScale(visualHalfExtents: { x: number; y: number; z: number }): number {
  const sizeX = visualHalfExtents.x * 2;
  const sizeY = visualHalfExtents.y * 2;
  const sizeZ = visualHalfExtents.z * 2;
  const limitX = CABINET_FIT_MARGIN * LOST_FOUND_CABINET_CELL_DEPTH;
  const limitY = CABINET_FIT_MARGIN * (LOST_FOUND_CABINET_CELL_HEIGHT - SHELF_THICKNESS);
  const limitZ = CABINET_FIT_MARGIN * (LOST_FOUND_CABINET_CELL_WIDTH - LOST_FOUND_CABINET_DIVIDER_THICKNESS);
  const scale = Math.min(1, limitX / sizeX, limitY / sizeY, limitZ / sizeZ);
  return scale;
}

/**
 * The 4x3 grid lost-item storage cabinet ("Expand lost found return storage
 * and scoring" round 四) — a wall-mounted fixture in BACK_AREA's own
 * package-sorting area (same spot the old themed-only shelf used to sit),
 * built independently of world-layout-system.ts (structural room walls stay
 * there; this class builds its own furniture, same pattern as
 * lost-found-system.ts's counter). Purely passive detection, no forced
 * snapping or mini-game (spec: "不需要強制吸附，不新增複雜收納小遊戲") — a
 * real physical shelf per row (with a collider AND a registered
 * PickupSystem placement surface, so the player can precisely place items
 * via the existing placement-preview flow) catches whatever's dropped/
 * placed near it under normal physics; update() below just watches which
 * cell each tracked item's center currently sits in.
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
    const cw = LOST_FOUND_CABINET_CELL_WIDTH;
    const ch = LOST_FOUND_CABINET_CELL_HEIGHT;
    const cd = LOST_FOUND_CABINET_CELL_DEPTH;
    const div = LOST_FOUND_CABINET_DIVIDER_THICKNESS;
    const floorY = LOST_FOUND_ROOM.floorY; // BACK_AREA shares the same floor level
    const totalWidth = cols * cw;
    const totalHeight = rows * ch;
    const centerX = LOST_FOUND_CABINET_POS.x;
    const centerZ = LOST_FOUND_CABINET_POS.z;
    const baseZ = centerZ - totalWidth / 2;

    // Solid back panel spanning the whole grid — the ONE real "you can't
    // walk through this" collider (mirrors the old single-shelf-cuboid
    // pattern this cabinet replaces).
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x5a4530 });
    const backGeo = new THREE.BoxGeometry(cd, totalHeight, totalWidth);
    const backMesh = new THREE.Mesh(backGeo, frameMat);
    backMesh.position.set(centerX, floorY + totalHeight / 2, centerZ);
    scene.add(backMesh);
    physics.createStaticCuboid(centerX, floorY + totalHeight / 2, centerZ, cd / 2, totalHeight / 2, totalWidth / 2);

    // One real horizontal shelf per row boundary — solid collider AND a
    // registered placement surface, so the player can aim at a specific
    // shelf and place an item there precisely via the existing
    // placement-preview flow (same mechanic as the pallet/dolly platform).
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x6b5540 });
    for (let r = 0; r <= rows; r++) {
      const y = floorY + r * ch;
      const shelfGeo = new THREE.BoxGeometry(cd, SHELF_THICKNESS, totalWidth);
      const shelf = new THREE.Mesh(shelfGeo, shelfMat);
      shelf.position.set(centerX, y, centerZ);
      scene.add(shelf);
      physics.createStaticCuboid(centerX, y, centerZ, cd / 2, SHELF_THICKNESS / 2, totalWidth / 2);
      pickupSystem.addPlacementSurface(shelf);
    }

    // Decorative-only vertical column dividers — no separate collider (the
    // solid back panel + shelves above already cover physical solidity);
    // purely the "明確隔板" visual cue that this is a grid of individual
    // cells, not one open shelf.
    const dividerMat = new THREE.MeshStandardMaterial({ color: 0x3f3020 });
    for (let c = 0; c <= cols; c++) {
      const z = baseZ + c * cw;
      const dividerGeo = new THREE.BoxGeometry(cd + 0.02, totalHeight, div);
      const strip = new THREE.Mesh(dividerGeo, dividerMat);
      strip.position.set(centerX, floorY + totalHeight / 2, z);
      scene.add(strip);
    }

    // One slotBounds per cell — independent slotId, independent interior
    // space (spec四), inset from the divider/shelf centerlines so a cell's
    // bounds only cover its own genuinely-open interior volume.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cellMinY = floorY + r * ch + SHELF_THICKNESS / 2;
        const cellMaxY = floorY + (r + 1) * ch - SHELF_THICKNESS / 2;
        const cellMinZ = baseZ + c * cw + div / 2;
        const cellMaxZ = baseZ + (c + 1) * cw - div / 2;
        this.slots.push({
          slotId: `cabinet-r${r}-c${c}`,
          bounds: {
            minX: centerX - cd / 2, maxX: centerX + cd / 2,
            minY: cellMinY, maxY: cellMaxY,
            minZ: cellMinZ, maxZ: cellMaxZ,
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
