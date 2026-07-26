import * as THREE from 'three';
import { PhysicsSystem } from '../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../shared/types/interactable';
import { CounterNpcSystem, NpcEntity } from './counter-npc-system';
import {
  NPC_QUEUE_SLOTS, NPC_AT_COUNTER_SPOT, NPC_EXIT_POINT, COUNTER_ITEM_SPOT, OPEN_BUTTON_POS,
} from './counter-layout-data';
import { SCENE_CONFIG } from './scene-manager';
import { createPackageData, createAddressLabel } from './package-data';
import { EnvelopeData, createEnvelopeAddressLabel } from './envelope-data';
import { DESTINATIONS } from './destination-data';
import { getStampForDestination } from './stamp-data';
import { createFloatingLabel, updateFloatingLabel } from '../adapters/three/world-label-system';
import { HUD } from './hud';

const TOTAL_NPCS = 5;
const SPAWN_INTERVAL = 1.4; // seconds between staggered NPC spawns
const ARRIVE_EPS = 0.12;
const COUNTER_ENVELOPE_SIZE = { w: 0.32, h: 0.03, d: 0.22 };
const COUNTER_PACKAGE_SIZE = { w: 0.35, h: 0.3, d: 0.3 };

type ServicePhase = 'closed' | 'open' | 'finished';

export class CounterServiceSystem {
  phase: ServicePhase = 'closed';

  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private npcSystem: CounterNpcSystem;
  private hud: HUD;

  private queue: NpcEntity[] = [];
  private serving: NpcEntity | null = null;
  private leaving: NpcEntity | null = null;
  private currentItem: InteractableObject | null = null;
  private servedCount = 0;
  private pendingSpawns = 0;
  private spawnTimer = 0;
  private nextItemId = 1;

  private buttonPost!: THREE.Mesh;
  private buttonLabel!: THREE.Sprite;
  private enabled: boolean;

  /** `enabled` gates the 開業按鈕/NPC queue out of the scene this round
   * (spec "每日貨品清空核心流程" section 三 — see feature-flags.ts
   * ENABLE_LEGACY_COUNTER). isPlayerNear() is guarded below; `phase` stays
   * at its default 'closed' when disabled, which is already the correct
   * "not open" reading everywhere it's checked. */
  constructor(
    scene: THREE.Scene,
    physics: PhysicsSystem,
    interactables: Map<string, InteractableObject>,
    npcSystem: CounterNpcSystem,
    hud: HUD,
    enabled: boolean
  ) {
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;
    this.npcSystem = npcSystem;
    this.hud = hud;
    this.enabled = enabled;
    if (!enabled) return;
    this.buildButton();
  }

  private buildButton(): void {
    const postGeo = new THREE.BoxGeometry(0.25, 1.0, 0.25);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
    this.buttonPost = new THREE.Mesh(postGeo, postMat);
    this.buttonPost.position.set(OPEN_BUTTON_POS.x, 0.5, OPEN_BUTTON_POS.z);
    this.scene.add(this.buttonPost);

    const capGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x33aa44 });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.set(OPEN_BUTTON_POS.x, 1.02, OPEN_BUTTON_POS.z);
    this.scene.add(cap);

    this.buttonLabel = createFloatingLabel('開業按鈕\n按 E 開始營業', { width: 0.9, bg: 'rgba(20,45,20,0.75)' });
    this.buttonLabel.position.set(OPEN_BUTTON_POS.x, 1.5, OPEN_BUTTON_POS.z);
    this.scene.add(this.buttonLabel);

    this.physics.createStaticCuboid(OPEN_BUTTON_POS.x, 0.5, OPEN_BUTTON_POS.z, 0.125, 0.5, 0.125);
  }

  isPlayerNear(playerPos: THREE.Vector3): boolean {
    if (!this.enabled) return false;
    const dx = playerPos.x - OPEN_BUTTON_POS.x;
    const dz = playerPos.z - OPEN_BUTTON_POS.z;
    return Math.sqrt(dx * dx + dz * dz) < SCENE_CONFIG.interactionDistance + 1;
  }

  pressButton(): void {
    if (this.phase === 'open') return;
    this.phase = 'open';
    this.servedCount = 0;
    this.pendingSpawns = TOTAL_NPCS;
    this.spawnTimer = 0;
    this.queue = [];
    this.serving = null;
    this.leaving = null;
    this.currentItem = null;
    updateFloatingLabel(this.buttonLabel, '營業中...');
  }

  update(deltaTime: number): void {
    if (this.phase !== 'open') return;

    if (this.pendingSpawns > 0) {
      this.spawnTimer -= deltaTime;
      if (this.spawnTimer <= 0) {
        const npc = this.npcSystem.spawnNpc();
        this.queue.push(npc);
        this.pendingSpawns--;
        this.spawnTimer = SPAWN_INTERVAL;
        this.recomputeQueueTargets();
      }
    }

    if (!this.serving && this.queue.length > 0) {
      const npc = this.queue.shift()!;
      this.serving = npc;
      this.npcSystem.setTarget(npc, NPC_AT_COUNTER_SPOT.x, NPC_AT_COUNTER_SPOT.z);
      this.recomputeQueueTargets();
    }

    if (this.serving) {
      const npc = this.serving;
      const arrived = this.distanceXZ(npc.mesh.position, NPC_AT_COUNTER_SPOT) < ARRIVE_EPS;
      if (arrived && npc.state !== 'atCounter') {
        npc.state = 'atCounter';
      }
      if (npc.state === 'atCounter' && !this.currentItem) {
        this.currentItem = this.spawnCounterItem();
      }
      if (this.currentItem && this.currentItem.isHeld) {
        this.currentItem = null;
        this.leaving = npc;
        this.serving = null;
        // Walk all the way out through the door, not just to just-inside-the-
        // door spawn point — otherwise the NPC vanishes mid-room instead of
        // visibly exiting the building.
        this.npcSystem.setTarget(npc, NPC_EXIT_POINT.x, NPC_EXIT_POINT.z);
      }
    }

    if (this.leaving) {
      if (this.distanceXZ(this.leaving.mesh.position, NPC_EXIT_POINT) < ARRIVE_EPS) {
        this.npcSystem.removeNpc(this.leaving.id);
        this.leaving = null;
        this.servedCount++;
      }
    }

    if (
      this.phase === 'open' && this.pendingSpawns === 0 && this.queue.length === 0 &&
      !this.serving && !this.leaving && this.servedCount >= TOTAL_NPCS
    ) {
      this.phase = 'finished';
      updateFloatingLabel(this.buttonLabel, '本輪已結束\n按 E 再次開業');
      this.hud.showInteractionPrompt('臨櫃服務', '本輪 5 位客人已全部處理完畢');
      setTimeout(() => this.hud.hideInteractionPrompt(), 2500);
    }
  }

  private recomputeQueueTargets(): void {
    this.queue.forEach((npc, i) => {
      const slot = NPC_QUEUE_SLOTS[i] ?? NPC_QUEUE_SLOTS[NPC_QUEUE_SLOTS.length - 1];
      this.npcSystem.setTarget(npc, slot.x, slot.z);
    });
  }

  private distanceXZ(pos: THREE.Vector3, target: { x: number; z: number }): number {
    const dx = pos.x - target.x;
    const dz = pos.z - target.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** Reuses the existing package/envelope/interactable architecture, but as
   * an independent counter-only object — does not touch the incoming
   * envelope crate's queue. */
  private spawnCounterItem(): InteractableObject {
    const isPackage = Math.random() < 0.5;
    return isPackage ? this.createCounterPackage() : this.createCounterEnvelope();
  }

  private createCounterPackage(): InteractableObject {
    const id = `counter-package-${this.nextItemId++}`;
    const { w, h, d } = COUNTER_PACKAGE_SIZE;
    const x = COUNTER_ITEM_SPOT.x;
    const y = COUNTER_ITEM_SPOT.y + h / 2 + 0.02;
    const z = COUNTER_ITEM_SPOT.z;

    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9a6a3a });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);

    const obj = createInteractableObject(id, '臨櫃包裹', mesh, w, h, d);
    const { body, collider } = this.physics.createBoxBody(x, y, z, w / 2, h / 2, d / 2, 250);
    obj.rigidBody = body;
    obj.collider = collider;

    const pkgData = createPackageData(id, w, h, d);
    obj.packageData = pkgData;
    const label = createAddressLabel(pkgData, w, d);
    label.position.y = h / 2 + 0.001;
    mesh.add(label);
    pkgData.addressLabelMesh = label;

    this.interactables.set(id, obj);
    return obj;
  }

  private createCounterEnvelope(): InteractableObject {
    const id = `counter-envelope-${this.nextItemId++}`;
    const { w, h, d } = COUNTER_ENVELOPE_SIZE;
    const x = COUNTER_ITEM_SPOT.x;
    const y = COUNTER_ITEM_SPOT.y + h / 2 + 0.02;
    const z = COUNTER_ITEM_SPOT.z;

    const dest = DESTINATIONS[Math.floor(Math.random() * DESTINATIONS.length)];
    const stamp = getStampForDestination(dest.id)!;
    const envData: EnvelopeData = {
      envelopeId: id,
      recipientName: '臨櫃客戶',
      streetLine: dest.name,
      destinationId: dest.id,
      destinationName: dest.displayName,
      requiredStampId: stamp.stampId,
      isStamped: false,
      appliedStampId: null,
      isSorted: false,
      sortedBagId: null,
      isHeld: false,
      isOnStampTable: false,
    };

    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({ color: 0xfffacd });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.envelopeId = id;
    mesh.position.set(x, y, z);
    this.scene.add(mesh);

    const label = createEnvelopeAddressLabel(envData);
    label.rotation.x = -Math.PI / 2;
    label.position.y = h / 2 + 0.001;
    label.userData.ownerEnvelopeId = id;
    mesh.add(label);

    const obj = createInteractableObject(id, `臨櫃信件：${envData.recipientName}`, mesh, w, h, d);
    obj.packageData = {
      packageId: id,
      recipientName: envData.recipientName,
      streetLine: envData.streetLine,
      destinationId: envData.destinationId,
      destinationName: envData.destinationName,
      requiredStampId: envData.requiredStampId,
      isStamped: false,
      appliedStampId: null,
      addressLabelMesh: label,
      stampVisualMesh: null,
      overweightLabelMesh: null,
      sizeCategory: 'small',
      weightKg: 0.05,
      maxAllowedWeightKg: 10,
      isOverweight: false,
      hasBeenWeighed: false,
      hasOverweightLabel: false,
    };

    const colliderHalfH = Math.max(h / 2, 0.02);
    const { body, collider } = this.physics.createBoxBody(x, y, z, w / 2, colliderHalfH, d / 2, 50);
    obj.rigidBody = body;
    obj.collider = collider;

    this.interactables.set(id, obj);
    return obj;
  }
}
