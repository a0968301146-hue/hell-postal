import * as THREE from 'three';
import { PhysicsSystem } from './physics-system';
import { InteractableObject, createInteractableObject } from './interactable-object';
import { PickupSystem } from './pickup-system';
import { SCENE_CONFIG } from './scene-manager';
import {
  LOST_FOUND_ROOM, LOST_FOUND_COUNTER, LOST_FOUND_CUSTOMER_SPOT, LOST_FOUND_SHELF, LOST_FOUND_ITEM_SLOTS,
} from './lost-found-layout-data';
import { LOST_FOUND_ITEMS, LOST_FOUND_CASES, LostFoundCaseDef } from './lost-found-data';
import { createFloatingLabel } from './world-label-system';
import { LostFoundUI } from './lost-found-ui';

const ITEM_ID_PREFIX = 'lostfound-item-';
const ITEM_SIZE = 0.22;
const SHELF_HEIGHT = 0.9;
const SHELF_HALF_X = 0.2;
const SHELF_HALF_Z = 0.9;
const COUNTER_HALF_X = 0.5;
const COUNTER_HEIGHT = 0.9;
const COUNTER_HALF_Z = 0.25;
/** Seconds the customer mesh lingers after a successful case before being
 * removed (spec三: "正確：案件完成，顧客離開") — long enough for the player
 * to read the success text before the customer visibly disappears. */
const CUSTOMER_LEAVE_DELAY = 1.8;

type CaseState = 'active' | 'leaving' | 'done';

/**
 * Owns the west-side lost & found desk's minimal case flow ("Reduce daily
 * cargo and add lost found desk" round 三): one customer, one case, a shelf
 * of pickupable items (reusing the EXISTING generic PickupSystem/
 * InteractionSystem raycasting flow — this file never touches player input
 * itself), and a counter the player confirms at. Builds its own furniture
 * (counter/shelf/items/customer), same pattern as PalletSystem/
 * RollerRackSystem/UnloadingSystem/CounterServiceSystem each building their
 * own — the room's structural WALLS live in scene-manager.ts instead (see
 * buildLostFoundRoom there), matching how BACK_AREA's own walls are built
 * separately from any single system's furniture.
 */
export class LostFoundSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private pickupSystem: PickupSystem;
  private ui: LostFoundUI;

  private caseDef: LostFoundCaseDef;
  private caseState: CaseState = 'active';
  private leaveTimer = 0;

  private customerGroup: THREE.Group | null = null;

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>,
    pickupSystem: PickupSystem, ui: LostFoundUI
  ) {
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;
    this.pickupSystem = pickupSystem;
    this.ui = ui;

    // Exactly one case this round (spec: "先製作一個可完整測試的案件，不擴充
    // 故事內容") — LOST_FOUND_CASES[0] only, never cycled to another.
    this.caseDef = LOST_FOUND_CASES[0];

    this.buildCounter();
    this.buildShelf();
    this.spawnShelfItems();
    this.spawnCustomer();
  }

  private buildCounter(): void {
    const geo = new THREE.BoxGeometry(COUNTER_HALF_X * 2, COUNTER_HEIGHT, COUNTER_HALF_Z * 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x7a5c3a }));
    const y = LOST_FOUND_ROOM.floorY + COUNTER_HEIGHT / 2;
    mesh.position.set(LOST_FOUND_COUNTER.x, y, LOST_FOUND_COUNTER.z);
    this.scene.add(mesh);
    this.physics.createStaticCuboid(LOST_FOUND_COUNTER.x, y, LOST_FOUND_COUNTER.z, COUNTER_HALF_X, COUNTER_HEIGHT / 2, COUNTER_HALF_Z);

    const label = createFloatingLabel('失物招領櫃檯', { width: 0.9, bg: 'rgba(30,25,20,0.75)' });
    label.position.set(LOST_FOUND_COUNTER.x, y + COUNTER_HEIGHT / 2 + 0.5, LOST_FOUND_COUNTER.z);
    this.scene.add(label);
  }

  private buildShelf(): void {
    const geo = new THREE.BoxGeometry(SHELF_HALF_X * 2, SHELF_HEIGHT, SHELF_HALF_Z * 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x5a4530 }));
    const y = LOST_FOUND_ROOM.floorY + SHELF_HEIGHT / 2;
    mesh.position.set(LOST_FOUND_SHELF.x, y, LOST_FOUND_SHELF.z);
    this.scene.add(mesh);
    this.physics.createStaticCuboid(LOST_FOUND_SHELF.x, y, LOST_FOUND_SHELF.z, SHELF_HALF_X, SHELF_HEIGHT / 2, SHELF_HALF_Z);

    const label = createFloatingLabel('失物暫存架', { width: 0.85, bg: 'rgba(30,25,20,0.75)' });
    label.position.set(LOST_FOUND_SHELF.x, y + SHELF_HEIGHT / 2 + 0.5, LOST_FOUND_SHELF.z);
    this.scene.add(label);
  }

  /** One pickupable item per LOST_FOUND_ITEMS entry, resting on top of the
   * shelf — registered into the SHARED interactables map, so the existing
   * PickupSystem/InteractionSystem raycasting pickup flow already handles
   * them with zero changes to either (spec: 不修改玩家操作). */
  private spawnShelfItems(): void {
    const y = LOST_FOUND_ROOM.floorY + SHELF_HEIGHT + ITEM_SIZE / 2 + 0.01;
    LOST_FOUND_ITEMS.forEach((def, i) => {
      const slot = LOST_FOUND_ITEM_SLOTS[i % LOST_FOUND_ITEM_SLOTS.length];
      const id = ITEM_ID_PREFIX + def.id;

      const geo = new THREE.BoxGeometry(ITEM_SIZE, ITEM_SIZE, ITEM_SIZE);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: def.color }));
      mesh.position.set(slot.x, y, slot.z);
      this.scene.add(mesh);

      const obj = createInteractableObject(id, def.displayName, mesh, ITEM_SIZE, ITEM_SIZE, ITEM_SIZE);
      const { body, collider } = this.physics.createBoxBody(slot.x, y, slot.z, ITEM_SIZE / 2, ITEM_SIZE / 2, ITEM_SIZE / 2, 40);
      obj.rigidBody = body;
      obj.collider = collider;

      this.interactables.set(id, obj);
    });
  }

  private spawnCustomer(): void {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc9a05a });
    const capsuleGeo = new THREE.CapsuleGeometry(0.28, 0.9, 4, 8);
    const body = new THREE.Mesh(capsuleGeo, bodyMat);
    body.position.y = LOST_FOUND_ROOM.floorY + 0.28 + 0.45;
    group.add(body);

    group.position.set(LOST_FOUND_CUSTOMER_SPOT.x, 0, LOST_FOUND_CUSTOMER_SPOT.z);
    this.scene.add(group);
    this.customerGroup = group;

    const label = createFloatingLabel(this.caseDef.customerName, { width: 0.8, bg: 'rgba(30,25,20,0.75)' });
    label.position.set(0, LOST_FOUND_ROOM.floorY + 1.9, 0);
    group.add(label);
  }

  private distanceXZ(pos: THREE.Vector3, target: { x: number; z: number }): number {
    const dx = pos.x - target.x;
    const dz = pos.z - target.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  isPlayerNearCustomer(playerPos: THREE.Vector3): boolean {
    if (!this.customerGroup) return false;
    return this.distanceXZ(playerPos, LOST_FOUND_CUSTOMER_SPOT) < SCENE_CONFIG.interactionDistance + 1;
  }

  isPlayerNearCounter(playerPos: THREE.Vector3): boolean {
    return this.distanceXZ(playerPos, LOST_FOUND_COUNTER) < SCENE_CONFIG.interactionDistance + 1;
  }

  /** Whether `id` is one of THIS system's own shelf items — InteractionSystem
   * checks this before treating a held item as a lost-found confirmation
   * candidate at the counter. */
  isLostFoundItem(id: string): boolean {
    return id.startsWith(ITEM_ID_PREFIX);
  }

  /** Press E near the customer — shows the case description (spec三: 玩家按
   * E 互動後取得失物描述). Re-approachable any time the case is still active,
   * so the player can re-read it without penalty. */
  pressTalkToCustomer(): void {
    if (this.caseState !== 'active') return;
    this.ui.showDescription(this.caseDef.customerName, this.caseDef.requestText);
  }

  /** Press E at the counter while holding a lost-found item (spec三: 玩家從
   * 失物架拿取物品，帶到櫃檯按 E 確認). Correct item completes the case and
   * consumes the item; wrong item just shows a hint and stays held so the
   * player can walk back and swap it for another (spec: 不扣分、不失敗). */
  tryConfirmAtCounter(heldId: string): void {
    if (this.caseState !== 'active') return;
    if (!this.isLostFoundItem(heldId)) return;

    const targetId = ITEM_ID_PREFIX + this.caseDef.targetItemId;
    if (heldId === targetId) {
      this.pickupSystem.forceDropHeld();
      this.disposeItem(heldId);
      this.ui.showSuccess(this.caseDef.successText);
      this.caseState = 'leaving';
      this.leaveTimer = 0;
    } else {
      this.ui.showWrong(this.caseDef.wrongText);
    }
  }

  private disposeItem(id: string): void {
    const obj = this.interactables.get(id);
    if (!obj) return;
    this.scene.remove(obj.mesh);
    obj.mesh.geometry.dispose();
    (obj.mesh.material as THREE.Material).dispose();
    if (obj.rigidBody) this.physics.removeRigidBody(obj.rigidBody);
    this.interactables.delete(id);
  }

  update(deltaTime: number): void {
    if (this.caseState !== 'leaving' || !this.customerGroup) return;
    this.leaveTimer += deltaTime;
    if (this.leaveTimer >= CUSTOMER_LEAVE_DELAY) {
      this.scene.remove(this.customerGroup);
      this.customerGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material?.dispose();
        }
      });
      this.customerGroup = null;
      this.caseState = 'done';
    }
  }
}
