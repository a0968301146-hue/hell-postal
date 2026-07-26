import { EnvelopeData } from './envelope-data';
import { SortingBoxSystem } from './sorting-box-system';
import { InteractableObject } from '../shared/types/interactable';
import { PhysicsSystem } from '../adapters/rapier/physics-system';
import { HUD } from './hud';
import { SBOX_HEIGHT } from './sorting-box-data';

const STABLE_TIME_REQUIRED = 0.3; // seconds
const VELOCITY_THRESHOLD = 0.4;

interface PendingSort {
  envelopeId: string;
  boxId: string;
  timer: number;
}

export class MailSortingSystem {
  private sortingBoxSystem: SortingBoxSystem;
  private interactables: Map<string, InteractableObject>;
  private physics: PhysicsSystem;
  private envelopeDataMap: Map<string, EnvelopeData>;
  private hud: HUD;
  private pending: Map<string, PendingSort> = new Map();
  private onFirstSort?: () => void;

  constructor(
    sortingBoxSystem: SortingBoxSystem,
    interactables: Map<string, InteractableObject>,
    physics: PhysicsSystem,
    envelopeDataMap: Map<string, EnvelopeData>,
    hud: HUD,
    onFirstSort?: () => void
  ) {
    this.sortingBoxSystem = sortingBoxSystem;
    this.interactables = interactables;
    this.physics = physics;
    this.envelopeDataMap = envelopeDataMap;
    this.hud = hud;
    this.onFirstSort = onFirstSort;
  }

  /** Called every frame to check envelopes inside sorting boxes */
  update(deltaTime: number): void {
    // Check each sorting box for envelopes inside
    for (const [boxId, boxData] of this.sortingBoxSystem.boxes) {
      if (!boxData.isPlaced || boxData.isHeld) continue;

      const sensor = this.sortingBoxSystem.getSensorBox(boxId);
      if (!sensor) continue;

      // Find envelopes inside this sensor
      for (const obj of this.interactables.values()) {
        if (obj.isHeld || !obj.mesh.visible) continue;
        if (obj.height > 0.05) continue; // only envelopes (thin)

        const envData = this.envelopeDataMap.get(obj.id);
        if (!envData) continue;
        if (envData.isSorted) continue; // already sorted

        const pos = obj.mesh.position;
        if (!sensor.containsPoint(pos)) {
          // Envelope left the sensor, remove pending
          this.pending.delete(obj.id);
          continue;
        }

        // Envelope center must be below box top
        const boxObj = this.interactables.get(boxId);
        if (!boxObj) continue;
        // Root is at bottom, top = root.y + SBOX_HEIGHT
        const boxTopY = boxObj.mesh.position.y + SBOX_HEIGHT;
        if (pos.y > boxTopY) continue;

        // Check velocity
        if (!obj.rigidBody) continue;
        const lv = obj.rigidBody.linvel();
        const av = obj.rigidBody.angvel();
        const speed = Math.sqrt(lv.x ** 2 + lv.y ** 2 + lv.z ** 2);
        const angSpeed = Math.sqrt(av.x ** 2 + av.y ** 2 + av.z ** 2);

        if (speed > VELOCITY_THRESHOLD || angSpeed > VELOCITY_THRESHOLD) {
          // Still moving - reset timer
          this.pending.delete(obj.id);
          continue;
        }

        // Accumulate stable time
        const existing = this.pending.get(obj.id);
        if (existing && existing.boxId === boxId) {
          existing.timer += deltaTime;
          if (existing.timer >= STABLE_TIME_REQUIRED) {
            this.attemptSort(obj.id, boxId);
            this.pending.delete(obj.id);
          }
        } else {
          this.pending.set(obj.id, { envelopeId: obj.id, boxId, timer: 0 });
        }
      }
    }
  }

  private attemptSort(envelopeId: string, boxId: string): void {
    const envData = this.envelopeDataMap.get(envelopeId);
    if (!envData) return;

    const boxData = this.sortingBoxSystem.getBoxData(boxId);
    if (!boxData) return;

    console.log(`[Sort] Attempting: env=${envelopeId} stamped=${envData.isStamped} stampId=${envData.appliedStampId} dest=${envData.destinationId} box=${boxId} boxDest=${boxData.destinationId}`);

    // Validation
    if (!envData.isStamped) {
      this.hud.showInteractionPrompt(boxData.displayName, '這封信尚未貼郵票');
      setTimeout(() => this.hud.hideInteractionPrompt(), 2000);
      return;
    }

    if (envData.destinationId !== boxData.destinationId || envData.appliedStampId !== boxData.acceptedStampId) {
      this.hud.showInteractionPrompt(boxData.displayName, '這封信放錯分類箱');
      setTimeout(() => this.hud.hideInteractionPrompt(), 2000);
      return;
    }

    if (boxData.envelopeCount >= boxData.capacity) {
      this.hud.showInteractionPrompt(boxData.displayName, '分類箱已滿');
      setTimeout(() => this.hud.hideInteractionPrompt(), 2000);
      return;
    }

    // Prevent duplicate
    if (envData.isSorted || boxData.envelopeIds.includes(envelopeId)) return;

    // SUCCESS
    envData.isSorted = true;
    envData.sortedBagId = boxId;
    this.sortingBoxSystem.recordSort(boxId, envelopeId);
    this.onFirstSort?.();

    // Disable envelope physics and make non-interactable
    const obj = this.interactables.get(envelopeId);
    if (obj) {
      obj.canPickUp = false;
      if (obj.rigidBody) {
        obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.physics.setBodyEnabled(obj.rigidBody, false);
      }
      // Fade out after short delay
      setTimeout(() => {
        obj.mesh.visible = false;
      }, 500);
    }

    this.hud.showInteractionPrompt(boxData.displayName, '✓ 分類完成！');
    setTimeout(() => this.hud.hideInteractionPrompt(), 1500);
  }
}
