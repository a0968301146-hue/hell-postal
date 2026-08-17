import * as THREE from 'three';
import { InteractableObject } from '../../shared/types/interactable';
import { SCENE_CONFIG } from '../world-layout';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';

/** "Pickup system 架構整理" round Phase 3 — moving a container's own
 * contents (envelopes sitting inside a sorting box/crate) along with it
 * while it's picked up/placed/thrown, pulled out of PickupSystem. Kept
 * deliberately narrow (spec: "不要建立複雜的系統") — a small class only
 * because it needs to hold `carriedEnvelopes` state ACROSS calls (capture at
 * pickup time, restore at place/throw time; a bare function module would
 * need that state threaded through every call site instead, which is worse,
 * not simpler). No knowledge of playerData, heldStack, or any pickup RULE —
 * purely "given this container object, what's physically inside it right
 * now, and where does that go when the container moves".
 *
 * Unity/C# 對應：ContainerContentTransfer（一個窄責任的 utility/helper
 * class，不是完整的 Manager），PlayerPickupController／PlacementPreview 呼叫
 * 它，它不反過來依賴任何一方。 */
export class ContainerContentTransfer {
  private carriedEnvelopes: { obj: InteractableObject; localPos: THREE.Vector3; localQuat: THREE.Quaternion; wasSorted: boolean }[] = [];

  constructor(private physics: PhysicsSystem, private interactables: Map<string, InteractableObject>) {}

  /** Find and capture all envelopes inside a container before picking it up. */
  capture(container: InteractableObject): void {
    this.carriedEnvelopes = [];
    const bounds = container.containerBounds;
    if (!bounds) return;

    const containerPos = container.mesh.position;
    const containerQuat = container.mesh.quaternion;

    // Interior bounds are per-container (see InteractableObject.containerBounds)
    const innerHW = bounds.innerWidth / 2;
    const innerHD = bounds.innerDepth / 2;
    const centerX = containerPos.x + bounds.interiorCenterOffset.x;
    const centerZ = containerPos.z + bounds.interiorCenterOffset.z;
    const centerY = containerPos.y + bounds.interiorCenterOffset.y;
    const halfH = bounds.innerHeight / 2;
    const bottomY = centerY - halfH;
    const topY = centerY + halfH;

    // Use world-space inverse for local position calculation
    const containerMatrixInverse = new THREE.Matrix4().copy(container.mesh.matrixWorld).invert();

    for (const envObj of this.interactables.values()) {
      if (envObj.id === container.id) continue;
      if (envObj.isHeld || !envObj.mesh.visible) continue;
      // Don't nest containers inside containers (sorting box/crate).
      if (envObj.mesh.userData.sortingBoxId || envObj.mesh.userData.crateId) continue;
      // Must physically fit within THIS container's own interior height —
      // per-container (see containerBounds), not a fixed "envelopes only" cutoff.
      if (envObj.height > bounds.innerHeight) continue;

      const envPos = envObj.mesh.position;
      // Check if envelope center is inside container
      if (envPos.x < centerX - innerHW || envPos.x > centerX + innerHW) continue;
      if (envPos.z < centerZ - innerHD || envPos.z > centerZ + innerHD) continue;
      if (envPos.y < bottomY - bounds.tolerance || envPos.y > topY) continue;

      // Save relative position
      const localPos = envObj.mesh.position.clone().applyMatrix4(containerMatrixInverse);
      const localQuat = envObj.mesh.quaternion.clone();
      // Convert to relative quaternion
      const containerQuatInv = containerQuat.clone().invert();
      localQuat.premultiply(containerQuatInv);

      const wasSorted = !envObj.canPickUp; // sorted envelopes have canPickUp=false

      // Pause envelope physics
      if (envObj.rigidBody) {
        envObj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        envObj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.physics.setBodyEnabled(envObj.rigidBody, false);
      }
      envObj.mesh.visible = false;

      this.carriedEnvelopes.push({ obj: envObj, localPos, localQuat, wasSorted });
    }
  }

  get hasCarriedContents(): boolean {
    return this.carriedEnvelopes.length > 0;
  }

  /** Restore carried envelopes to world after placing container. */
  restore(container: InteractableObject): void {
    if (this.carriedEnvelopes.length === 0) return;
    const bounds = container.containerBounds;

    for (const carried of this.carriedEnvelopes) {
      const envObj = carried.obj;

      // Convert local position back to world using new container world matrix
      const worldPos = carried.localPos.clone().applyMatrix4(container.mesh.matrixWorld);
      const worldQuat = container.mesh.quaternion.clone().multiply(carried.localQuat);

      // Clamp to inside container bounds (per-container, see containerBounds)
      if (bounds) {
        const containerPos = container.mesh.position;
        const centerX = containerPos.x + bounds.interiorCenterOffset.x;
        const centerZ = containerPos.z + bounds.interiorCenterOffset.z;
        const innerHW = bounds.innerWidth / 2 - bounds.tolerance;
        const innerHD = bounds.innerDepth / 2 - bounds.tolerance;
        worldPos.x = Math.max(centerX - innerHW, Math.min(centerX + innerHW, worldPos.x));
        worldPos.z = Math.max(centerZ - innerHD, Math.min(centerZ + innerHD, worldPos.z));
        const bottomY = containerPos.y + bounds.interiorCenterOffset.y - bounds.innerHeight / 2 + bounds.tolerance;
        worldPos.y = Math.max(bottomY, worldPos.y);
      }

      // Restore world mesh
      envObj.mesh.position.copy(worldPos);
      envObj.mesh.quaternion.copy(worldQuat);
      envObj.mesh.visible = true;

      // Restore physics
      if (envObj.rigidBody) {
        this.physics.setBodyEnabled(envObj.rigidBody, true);
        envObj.rigidBody.setTranslation({ x: worldPos.x, y: worldPos.y, z: worldPos.z }, true);
        envObj.rigidBody.setRotation({ x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w }, true);
        envObj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        envObj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }

    this.carriedEnvelopes = [];
  }

  /** Restore envelopes with throw velocity (for Q throw). */
  restoreWithVelocity(container: InteractableObject, throwDir: THREE.Vector3, chargeRatio: number): void {
    if (this.carriedEnvelopes.length === 0) return;
    const bounds = container.containerBounds;

    // Calculate throw velocity to apply to envelopes
    const throwSpeed = SCENE_CONFIG.minThrowImpulse + chargeRatio * (SCENE_CONFIG.maxThrowImpulse - SCENE_CONFIG.minThrowImpulse);
    const throwVel = throwDir.clone().multiplyScalar(throwSpeed * 0.7); // slightly less than container

    for (const carried of this.carriedEnvelopes) {
      const envObj = carried.obj;

      // Convert local position back to world
      const worldPos = carried.localPos.clone().applyMatrix4(container.mesh.matrixWorld);
      const worldQuat = container.mesh.quaternion.clone().multiply(carried.localQuat);

      // Clamp to container bounds (per-container, see containerBounds)
      if (bounds) {
        const containerPos = container.mesh.position;
        const centerX = containerPos.x + bounds.interiorCenterOffset.x;
        const centerZ = containerPos.z + bounds.interiorCenterOffset.z;
        const innerHW = bounds.innerWidth / 2 - bounds.tolerance;
        const innerHD = bounds.innerDepth / 2 - bounds.tolerance;
        worldPos.x = Math.max(centerX - innerHW, Math.min(centerX + innerHW, worldPos.x));
        worldPos.z = Math.max(centerZ - innerHD, Math.min(centerZ + innerHD, worldPos.z));
        const bottomY = containerPos.y + bounds.interiorCenterOffset.y - bounds.innerHeight / 2 + bounds.tolerance;
        worldPos.y = Math.max(bottomY, worldPos.y);
      }

      // Restore world mesh
      envObj.mesh.position.copy(worldPos);
      envObj.mesh.quaternion.copy(worldQuat);
      envObj.mesh.visible = true;

      // Restore physics with inherited velocity
      if (envObj.rigidBody) {
        this.physics.setBodyEnabled(envObj.rigidBody, true);
        envObj.rigidBody.setTranslation({ x: worldPos.x, y: worldPos.y, z: worldPos.z }, true);
        envObj.rigidBody.setRotation({ x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w }, true);
        envObj.rigidBody.setLinvel({ x: throwVel.x, y: throwVel.y, z: throwVel.z }, true);
        envObj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }

    this.carriedEnvelopes = [];
  }
}
