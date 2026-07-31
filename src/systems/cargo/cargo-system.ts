import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../../shared/types/interactable';
import {
  CargoData, CargoLabelPreset, CargoSize, ShippingStatus,
  CARGO_LABEL_PRESETS, createCargoData, pickCargoSize, pickLargeCargoSize,
  createDailyCargoData,
} from './cargo-data';
import { CargoShapePreset } from './cargo-shape-presets';
import { CargoRegion } from './cargo-region-data';
import { attachCargoLabels } from './cargo-label-visuals';
import { buildCargoShapeMesh, attachCargoPresetLabel } from './cargo-visuals';
import { FRONT_OFFICE, BACK_AREA, CARGO_SPAWN_CONFIG, LARGE_CARGO_SPAWN_POSITIONS, LABELED_CARGO_SPAWN_POSITIONS } from '../world-layout';

const CARGO_COLORS = [0x8b5a2b, 0xa0703a, 0x7a4e24, 0x966032, 0x8b6f47, 0x9a7040];
// Single consistent color for ALL large cargo — a deliberately different
// palette family (steel blue-grey) from normal cargo's browns, so large
// freight reads as visually distinct at a glance, per spec section 十.
const LARGE_CARGO_COLOR = 0x4a6fa5;

// Kept clear of the conveyor's own footprint (width 1.6, so |x| < ~0.9) —
// the back zone spawns cargo either side of the belt, never on it.
const RAMP_EXCLUSION_HALF_WIDTH = 1.0;

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function gridPositions(minX: number, maxX: number, minZ: number, maxZ: number, spacing: number): { x: number; z: number }[] {
  const positions: { x: number; z: number }[] = [];
  for (let x = minX + spacing / 2; x <= maxX - spacing / 2 + 0.001; x += spacing) {
    for (let z = minZ + spacing / 2; z <= maxZ - spacing / 2 + 0.001; z += spacing) {
      positions.push({ x, z });
    }
  }
  return positions;
}

export class CargoSystem {
  cargoDataMap: Map<string, CargoData> = new Map();
  private nextId = 1;
  private nextLargeId = 1;
  private nextLabeledId = 1;
  private nextDailyBoxId = 1;
  private nextDailyRollerId = 1;

  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;

  /** `legacyTestCargoEnabled` gates ONLY the old counter/vehicle-era test
   * cargo this constructor used to always spawn (spec "每日貨品清空核心流程"
   * section 三/十四: "不要生成舊的測試包裹") — daily-flow cargo is spawned
   * separately, on demand, via spawnDailyBox/spawnDailyRoller below,
   * regardless of this flag. */
  constructor(scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>, legacyTestCargoEnabled: boolean) {
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;

    if (!legacyTestCargoEnabled) return;

    const frontSpots = shuffle(
      gridPositions(CARGO_SPAWN_CONFIG.frontZone.minX, CARGO_SPAWN_CONFIG.frontZone.maxX, CARGO_SPAWN_CONFIG.frontZone.minZ, CARGO_SPAWN_CONFIG.frontZone.maxZ, 0.6)
    ).slice(0, CARGO_SPAWN_CONFIG.frontOfficeCount);

    const backSpots = shuffle(
      gridPositions(CARGO_SPAWN_CONFIG.backZone.minX, CARGO_SPAWN_CONFIG.backZone.maxX, CARGO_SPAWN_CONFIG.backZone.minZ, CARGO_SPAWN_CONFIG.backZone.maxZ, 0.7)
        .filter(p => Math.abs(p.x) > RAMP_EXCLUSION_HALF_WIDTH)
    ).slice(0, CARGO_SPAWN_CONFIG.backAreaCount);

    // Plain domestic normal cargo (spec 五: CARGO_LABEL_PRESETS.normalDomestic).
    for (const spot of frontSpots) this.spawnOne(scene, physics, interactables, spot.x, spot.z, FRONT_OFFICE.floorY);
    for (const spot of backSpots) this.spawnOne(scene, physics, interactables, spot.x, spot.z, BACK_AREA.floorY);

    // Large cargo — fixed spots in the back area's "國內大型貨物區"
    // (zone-large-domestic), not random like normal cargo, so the 4 items
    // never overlap at spawn.
    // All domestic (CARGO_LABEL_PRESETS.largeDomestic).
    LARGE_CARGO_SPAWN_POSITIONS.forEach((spot, i) => {
      this.spawnLarge(scene, physics, interactables, spot.x, spot.z, BACK_AREA.floorY, i);
    });

    // Labeling-showcase test cargo (spec 十四) — fixed cargoType/routeType
    // combos so the full label set (domestic/overseas/fragile/large) and
    // vehicle-compatibility rules can be exercised deterministically.
    const L = LABELED_CARGO_SPAWN_POSITIONS;
    for (const spot of L.domesticFragile) {
      this.spawnLabeled(scene, physics, interactables, CARGO_LABEL_PRESETS.fragileDomestic, spot.x, spot.z, pickCargoSize());
    }
    for (const spot of L.overseasNormal) {
      this.spawnLabeled(scene, physics, interactables, CARGO_LABEL_PRESETS.normalOverseas, spot.x, spot.z, pickCargoSize());
    }
    for (const spot of L.overseasFragile) {
      this.spawnLabeled(scene, physics, interactables, CARGO_LABEL_PRESETS.fragileOverseas, spot.x, spot.z, pickCargoSize());
    }
    for (const spot of L.overseasLarge) {
      this.spawnLabeled(scene, physics, interactables, CARGO_LABEL_PRESETS.largeOverseas, spot.x, spot.z, pickLargeCargoSize(0));
    }
    for (const spot of L.overseasLargeFragile) {
      this.spawnLabeled(scene, physics, interactables, CARGO_LABEL_PRESETS.largeFragileOverseas, spot.x, spot.z, pickLargeCargoSize(2));
    }
  }

  getCargoData(id: string): CargoData | undefined {
    return this.cargoDataMap.get(id);
  }

  /** Single public query for "is this item shipped, and correctly?" (Phase
   * 7: 統一狀態來源) — VehicleControlSystem's shipment scan is the ONLY
   * writer of loadedVehicleId/correctlyShipped; everything else (scoring,
   * HUD counts, UI) should read through here (or the equivalent CargoData
   * fields directly) rather than re-deriving vehicle-acceptance rules of
   * its own. Returns undefined for an unknown/already-removed id. */
  getShippingStatus(id: string): ShippingStatus | undefined {
    const data = this.cargoDataMap.get(id);
    if (!data) return undefined;
    return { loadedVehicleId: data.loadedVehicleId, correctlyShipped: data.correctlyShipped };
  }

  /** Resolves any raycast hit (root cargo mesh, a decoration child, or an
   * existing surface label) back to its CargoData — walks up the Object3D
   * parent chain looking for `userData.cargoId` (set on the ROOT mesh only,
   * by spawnDailyBox/spawnDailyRoller above), never by inspecting the
   * mesh's name/size/color. Returns null for anything that isn't cargo, or
   * cargo that's already been removed (removeCargo() clears the id from
   * cargoDataMap, so a stale mesh reference resolves to null too). Used by
   * cargo-inspection-system.ts's crosshair targeting (spec 五). */
  resolveCargoFromObject(object: THREE.Object3D): CargoData | null {
    let current: THREE.Object3D | null = object;
    while (current) {
      const cargoId = current.userData.cargoId as string | undefined;
      if (cargoId) {
        return this.cargoDataMap.get(cargoId) ?? null;
      }
      current = current.parent;
    }
    return null;
  }

  getInteractable(id: string): InteractableObject | undefined {
    return this.interactables.get(id);
  }

  /** Daily-flow box/large/cage cargo ("Organize and expand cargo shape
   * presets" round) — takes a full CargoShapePreset (category/size/
   * dimensions/mesh+collider recipe all bound together, see
   * cargo-shape-presets.ts) rather than a raw size, so every daily box-class
   * item is fully described by picking a preset. buildCargoShapeMesh builds
   * the preset's own distinct silhouette + attachCargoPresetLabel adds the
   * visible category-label badge, both entirely as mesh children — zero
   * extra dynamic bodies. Registered into the SAME cargoDataMap/interactables
   * map as every other cargo item so DollySystem's findCargoOnPlatform
   * (which checks cargoSystem.getCargoData membership) picks it up
   * automatically, with zero changes needed there. `preset.uprightRequired`
   * (live cages) locks X/Z rotation on the body so the unload burst's random
   * tumble can never land one upside down (spec E: "生成與放置時保持正
   * 向") — this only restricts ROTATION, translation/gravity/throwing are
   * untouched. `preset.throwable` is documentation/codex metadata only as of
   * "Fix cargo throwing and rebalance daily manifest" round一 — it USED TO
   * set the same `noThrow` mesh flag pickup-system.ts's charge-throw guard
   * uses for the sorting pallet (blocking large/fragile/live cargo from
   * ever being thrown at all), but spec一 explicitly reverses that: "所有可
   * 拾取貨物都可以Q丟出...大型與活物可以降低投擲速度，但不可完全禁止" — so
   * `noThrow` is now EXCLUSIVELY the pallet's own flag (see pallet-
   * system.ts), never set here; the reduced-speed nuance for large/cage
   * lives in pickup-system.ts's executeThrow() instead, keyed off
   * mesh.userData.shapeType. */
  spawnDailyBox(preset: CargoShapePreset, x: number, y: number, z: number, rotY: number, region: CargoRegion): string {
    const id = `daily-box-${this.nextDailyBoxId++}`;
    const { width, height, depth } = preset.dimensions;
    const mesh = buildCargoShapeMesh(preset);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.userData.shapeType = preset.visualKind === 'cage' ? 'cage' : (preset.category === 'large' ? 'large' : 'box');
    // Root-mesh cargo id — every decoration/label child added below is a
    // plain mesh.add() child with no id of its own, so resolveCargoFromObject()
    // walks the parent chain up to THIS mesh to find it (spec 五).
    mesh.userData.cargoId = id;
    // "Revise score upgrades and fix frog walkable colliders" round spec二A:
    // multiCarry now only stacks sizeClass='small' cargo — pickup-system.ts's
    // isExclusiveItem() reads this directly rather than looking up
    // CargoData through a new cross-system dependency.
    mesh.userData.cargoSizeClass = preset.sizeClass;
    this.scene.add(mesh);

    const data = createDailyCargoData(id, preset, region);
    attachCargoPresetLabel(mesh, preset);

    const obj = createInteractableObject(id, data.displayName, mesh, width, height, depth);
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0));
    const { body, collider } = this.physics.createBoxBody(x, y, z, width / 2, height / 2, depth / 2, 250);
    body.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true);
    if (preset.uprightRequired) body.setEnabledRotations(false, true, false, true);
    obj.rigidBody = body;
    obj.collider = collider;

    this.interactables.set(id, obj);
    this.cargoDataMap.set(id, data);
    return id;
  }

  /** Daily-flow roller cargo (normal-category barrel/spool only — the only
   * two confirmed presets with colliderKind:'cylinder') — CylinderGeometry
   * tipped 90° about Z so it rests lying on its side (barrel axis along
   * world X) and can roll. `dimensions` on CargoData store the TIPPED
   * world-space AABB (width=length, height=depth=diameter) — see
   * physics-system.ts createCylinderBody doc comment for why the collider
   * needs the same tip. */
  spawnDailyRoller(preset: CargoShapePreset, x: number, y: number, z: number, yawVariance: number, region: CargoRegion): string {
    const id = `daily-roller-${this.nextDailyRollerId++}`;
    const length = preset.dimensions.width;
    const radius = preset.dimensions.height / 2;
    const mesh = buildCargoShapeMesh(preset);
    mesh.position.set(x, y, z);
    const tip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawVariance);
    const rot = yaw.multiply(tip);
    mesh.quaternion.copy(rot);
    mesh.userData.shapeType = 'roller';
    mesh.userData.cargoId = id;
    mesh.userData.cargoSizeClass = preset.sizeClass;
    this.scene.add(mesh);

    const data = createDailyCargoData(id, preset, region);
    attachCargoPresetLabel(mesh, preset);

    const obj = createInteractableObject(id, data.displayName, mesh, length, radius * 2, radius * 2);
    const { body, collider } = this.physics.createCylinderBody(
      x, y, z, length / 2, radius, 220, { x: rot.x, y: rot.y, z: rot.z, w: rot.w }
    );
    obj.rigidBody = body;
    obj.collider = collider;

    this.interactables.set(id, obj);
    this.cargoDataMap.set(id, data);
    return id;
  }

  /** Fully removes a daily cargo item once it's shipped (VehicleControlSystem)
   * — disables + removes its rigid body, removes the mesh (and every
   * decoration/label child's own geometry/material, see cargo-visuals.ts),
   * and drops it from both cargoDataMap and the shared interactables map so
   * nothing (raycasting, dolly pinning, placement-surface overlap checks)
   * can reference it again. */
  removeCargo(id: string): void {
    const obj = this.interactables.get(id);
    if (obj) {
      if (obj.rigidBody) this.physics.removeRigidBody(obj.rigidBody);
      obj.mesh.parent?.remove(obj.mesh);
      obj.mesh.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          const mat = child.material;
          if (Array.isArray(mat)) mat.forEach(m => m.dispose()); else mat?.dispose();
        }
      });
      this.interactables.delete(id);
    }
    this.cargoDataMap.delete(id);
  }

  private spawnOne(
    scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>,
    x: number, z: number, floorY: number
  ): void {
    const id = `cargo-normal-${this.nextId++}`;
    const size = pickCargoSize();
    const color = CARGO_COLORS[this.nextId % CARGO_COLORS.length];
    this.buildCargoItem(scene, physics, interactables, id, CARGO_LABEL_PRESETS.normalDomestic, size, x, z, floorY, color);
  }

  private spawnLarge(
    scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>,
    x: number, z: number, floorY: number, presetIndex: number
  ): void {
    const id = `cargo-large-${this.nextLargeId++}`;
    const size = pickLargeCargoSize(presetIndex);
    this.buildCargoItem(scene, physics, interactables, id, CARGO_LABEL_PRESETS.largeDomestic, size, x, z, floorY, LARGE_CARGO_COLOR);
  }

  private spawnLabeled(
    scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>,
    preset: CargoLabelPreset, x: number, z: number, size: CargoSize
  ): void {
    const id = `cargo-labeled-${this.nextLabeledId++}`;
    const color = preset.cargoType === 'large' ? LARGE_CARGO_COLOR : CARGO_COLORS[this.nextLabeledId % CARGO_COLORS.length];
    this.buildCargoItem(scene, physics, interactables, id, preset, size, x, z, BACK_AREA.floorY, color);
  }

  private buildCargoItem(
    scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>,
    id: string, preset: CargoLabelPreset, size: CargoSize, x: number, z: number, floorY: number, color: number
  ): void {
    const y = floorY + size.height / 2 + 0.02;

    const geo = new THREE.BoxGeometry(size.width, size.height, size.depth);
    const material = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    scene.add(mesh);

    const data = createCargoData(id, preset, size);
    // Labels are attached ONCE here, fixed for the item's whole lifetime —
    // no labeling desk/UI exists this round to change them (spec 七).
    attachCargoLabels(mesh, data.labels, size.width, size.height, size.depth);

    const obj = createInteractableObject(id, data.displayName, mesh, size.width, size.height, size.depth);
    const density = 250;
    const { body, collider } = physics.createBoxBody(x, y, z, size.width / 2, size.height / 2, size.depth / 2, density);
    obj.rigidBody = body;
    obj.collider = collider;

    interactables.set(id, obj);
    this.cargoDataMap.set(id, data);
  }
}
