import * as THREE from 'three';
import { InteractableObject, PlayerInteractionData } from './interactable-object';
import { SCENE_CONFIG } from './scene-manager';
import { PhysicsSystem } from './physics-system';
import { HUD } from './hud';

export class PickupSystem {
  private camera: THREE.PerspectiveCamera;
  private worldScene: THREE.Scene;
  private playerData: PlayerInteractionData;
  private interactables: Map<string, InteractableObject>;
  private hud: HUD;
  private physics: PhysicsSystem;
  private floor: THREE.Mesh;

  // ViewModel
  viewModelScene: THREE.Scene;
  viewModelCamera: THREE.PerspectiveCamera;
  private heldViewMesh: THREE.Mesh | null = null;
  private heldViewBasePos = new THREE.Vector3();

  // Placement preview
  private previewMesh: THREE.Mesh | null = null;
  private previewValid = false;
  private placementRaycaster: THREE.Raycaster;

  // Charge/throw
  private isCharging = false;
  private chargeTime = 0;
  private additionalSurfaces: THREE.Object3D[] = [];

  // Container content tracking (for moving envelopes with containers)
  private carriedEnvelopes: { obj: InteractableObject; localPos: THREE.Vector3; localQuat: THREE.Quaternion; wasSorted: boolean }[] = [];

  constructor(
    camera: THREE.PerspectiveCamera,
    worldScene: THREE.Scene,
    playerData: PlayerInteractionData,
    interactables: Map<string, InteractableObject>,
    hud: HUD,
    physics: PhysicsSystem,
    floor: THREE.Mesh
  ) {
    this.camera = camera;
    this.worldScene = worldScene;
    this.playerData = playerData;
    this.interactables = interactables;
    this.hud = hud;
    this.physics = physics;
    this.floor = floor;
    this.placementRaycaster = new THREE.Raycaster();

    // ViewModel scene (separate from world)
    this.viewModelScene = new THREE.Scene();
    this.viewModelScene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const vmLight = new THREE.DirectionalLight(0xffffff, 0.6);
    vmLight.position.set(1, 2, 1);
    this.viewModelScene.add(vmLight);

    // ViewModel camera (syncs with main camera)
    this.viewModelCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 10);

    // Events
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousedown', (e) => this.onMouseDown(e));
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.cancelCharge());
  }

  get isInPlacementMode(): boolean {
    return this.playerData.state === 'placement-preview';
  }

  addPlacementSurface(surface: THREE.Object3D): void {
    this.additionalSurfaces.push(surface);
  }

  get chargeRatio(): number {
    if (!this.isCharging) return 0;
    return Math.min(this.chargeTime / SCENE_CONFIG.maxChargeTime, 1);
  }

  // --- PICK UP ---
  pickUp(obj: InteractableObject): void {
    if (!obj || !obj.mesh) return;
    if (this.playerData.state !== 'empty-handed') return;
    if (!obj.canPickUp || obj.isHeld) return;

    // If picking up a container, capture envelopes inside
    const isContainer = obj.mesh.userData.sortingBoxId || obj.mesh.userData.crateId;
    if (isContainer) {
      this.captureContainerContents(obj);
    }

    // Hide world mesh
    obj.mesh.visible = false;

    // Disable physics
    if (obj.rigidBody) {
      obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.physics.setBodyEnabled(obj.rigidBody, false);
    }

    // Create view model mesh
    this.createHeldViewMesh(obj);

    // Update state
    obj.isHeld = true;
    this.playerData.state = 'holding-item';
    this.playerData.heldObjectId = obj.id;

    this.hud.showInteractionPrompt(obj.displayName, '按 E 選擇放置位置\n按住 Q 蓄力丟出');
  }

  /** Find and capture all envelopes inside a container before picking it up */
  private captureContainerContents(container: InteractableObject): void {
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
      if (envObj.height > 0.05) continue; // only envelopes

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

  /** Restore carried envelopes to world after placing container */
  private restoreContainerContents(container: InteractableObject): void {
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

  /** Restore envelopes with throw velocity (for Q throw) */
  private restoreContainerContentsWithVelocity(container: InteractableObject, throwDir: THREE.Vector3, chargeRatio: number): void {
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

  private createHeldViewMesh(obj: InteractableObject): void {
    this.removeHeldViewMesh();

    // Clone the entire mesh tree (including children like walls, labels for containers)
    const cloned = obj.mesh.clone(true);
    cloned.frustumCulled = false;

    // Remove hitproxies from viewmodel first (they're invisible and waste
    // raycasting) so we don't bother giving them owned resources below.
    const toRemove: THREE.Object3D[] = [];
    cloned.traverse((child) => {
      if (child.userData.isHitProxy || child.userData.interiorPlane) {
        toRemove.push(child);
      }
    });
    toRemove.forEach(c => c.parent?.remove(c));

    // Object3D.clone() does NOT deep-clone geometry/material — the cloned
    // meshes still reference the exact same geometry/material instances as
    // the world mesh. Give the viewmodel its own copies so removeHeldViewMesh()
    // can safely dispose them without freeing resources the world mesh needs.
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.frustumCulled = false;
        child.geometry = child.geometry.clone();
        if (Array.isArray(child.material)) {
          child.material = child.material.map(m => m.clone());
        } else if (child.material) {
          child.material = child.material.clone();
        }
      }
    });

    this.heldViewMesh = cloned as THREE.Mesh;

    // Calculate position based on size
    const maxDim = Math.max(obj.width, obj.height, obj.depth);
    const isContainer = obj.mesh.userData.sortingBoxId || obj.mesh.userData.crateId;

    let holdZ: number;
    let holdY: number;

    if (isContainer) {
      // Containers: further away and lower, slightly tilted
      holdZ = -(1.5 + maxDim * 0.6);
      holdY = -0.7 - (maxDim > 0.8 ? (maxDim - 0.8) * 0.15 : 0);
      // Slight tilt toward camera so player can see opening
      cloned.rotation.x = 0.2;
    } else {
      // Normal packages
      holdZ = -(0.8 + maxDim * 0.7);
      holdY = -0.55 - (obj.height > 0.5 ? (obj.height - 0.5) * 0.2 : 0);
    }

    this.heldViewBasePos.set(0, holdY, holdZ);
    this.heldViewMesh.position.copy(this.heldViewBasePos);

    this.viewModelScene.add(this.heldViewMesh);
  }

  private removeHeldViewMesh(): void {
    if (this.heldViewMesh) {
      this.viewModelScene.remove(this.heldViewMesh);
      // Dispose geometries and materials in the tree
      this.heldViewMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
      this.heldViewMesh = null;
    }
  }

  /** Force release held item without placing (used for bag sorting) */
  forceDropHeld(): void {
    if (!this.playerData.heldObjectId) return;
    this.removeHeldViewMesh();
    this.cancelCharge();
    this.playerData.state = 'empty-handed';
    this.playerData.heldObjectId = null;
    this.hud.hideInteractionPrompt();
    this.hud.hideChargeBar();
  }

  /** Place held envelope directly into a sorting container at the given point */
  placeIntoContainer(obj: InteractableObject, containerId: string, hitPoint: THREE.Vector3, sortingBoxSystem: import('./sorting-box-system').SortingBoxSystem): void {
    if (!obj || !this.playerData.heldObjectId) return;

    // Get interior bottom Y from sorting box system or calculate from hit
    let bottomY = sortingBoxSystem.getInteriorBottomY(containerId);
    if (bottomY === null) {
      // Fallback: use the hit point Y as approximate bottom
      bottomY = hitPoint.y;
    }

    // Calculate placement position inside the box
    const placeY = bottomY + (obj.height > 0.01 ? obj.height / 2 : 0.02) + 0.03;
    const placePos = new THREE.Vector3(hitPoint.x, placeY, hitPoint.z);

    // Remove held view
    this.removeHeldViewMesh();
    this.cancelCharge();

    // Re-enable world mesh
    obj.mesh.position.copy(placePos);
    obj.mesh.rotation.set(0, 0, 0);
    obj.mesh.visible = true;

    // Re-enable physics (same order as throw: enable FIRST, then set position)
    if (obj.rigidBody) {
      this.physics.setBodyEnabled(obj.rigidBody, true);
      obj.rigidBody.setTranslation({ x: placePos.x, y: placePos.y, z: placePos.z }, true);
      obj.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    obj.isHeld = false;
    obj.canPickUp = true;
    this.playerData.state = 'empty-handed';
    this.playerData.heldObjectId = null;
    this.hud.hideInteractionPrompt();
    this.hud.hideChargeBar();
  }

  // --- PLACEMENT ---
  enterPlacementMode(): void {
    if (this.playerData.state !== 'holding-item') return;
    if (!this.playerData.heldObjectId) return;
    this.cancelCharge();

    const obj = this.interactables.get(this.playerData.heldObjectId);
    if (!obj) return;

    // Create preview
    const geo = obj.mesh.geometry.clone();
    const previewMat = new THREE.MeshStandardMaterial({
      color: 0x00ff00, transparent: true, opacity: 0.35, depthWrite: false,
    });
    this.previewMesh = new THREE.Mesh(geo, previewMat);
    this.worldScene.add(this.previewMesh);

    this.playerData.state = 'placement-preview';
  }

  cancelPlacement(): void {
    if (this.playerData.state !== 'placement-preview') return;
    if (!this.playerData.heldObjectId) return;

    const obj = this.interactables.get(this.playerData.heldObjectId);
    if (!obj) return;

    this.removePreview();
    this.playerData.state = 'holding-item';
    this.hud.showInteractionPrompt(obj.displayName, '按 E 選擇放置位置\n按住 Q 蓄力丟出');
  }

  confirmPlacement(): void {
    if (this.playerData.state !== 'placement-preview') return;
    if (!this.previewValid || !this.previewMesh) return;
    if (!this.playerData.heldObjectId) return;

    const obj = this.interactables.get(this.playerData.heldObjectId);
    if (!obj) return;

    const pos = this.previewMesh.position.clone();
    // Only add epsilon for objects with colliders that might penetrate
    if (obj.collider) {
      pos.y += 0.015;
    }

    // Re-enable world mesh
    obj.mesh.position.copy(pos);
    obj.mesh.rotation.set(0, 0, 0);
    obj.mesh.visible = true;

    // Re-enable physics (same order as throw: enable FIRST, then set position)
    if (obj.rigidBody) {
      // For bottom-origin containers, rigid body center is at pos.y + height/2
      const isBottomOrigin = obj.mesh.userData.bottomOrigin || obj.mesh.userData.crateId;
      const bodyY = isBottomOrigin ? pos.y + obj.height / 2 : pos.y;
      this.physics.setBodyEnabled(obj.rigidBody, true);
      obj.rigidBody.setTranslation({ x: pos.x, y: bodyY, z: pos.z }, true);
      obj.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    this.removeHeldViewMesh();
    this.removePreview();

    // Restore carried envelopes if this is a container
    const isContainer = obj.mesh.userData.sortingBoxId || obj.mesh.userData.crateId;
    if (isContainer && this.carriedEnvelopes.length > 0) {
      // Update container matrixWorld before restoring contents
      obj.mesh.updateMatrixWorld(true);
      this.restoreContainerContents(obj);
    }

    obj.isHeld = false;
    obj.canPickUp = true;
    this.playerData.state = 'empty-handed';
    this.playerData.heldObjectId = null;
    this.hud.hideInteractionPrompt();
  }

  // --- THROW ---
  private startCharge(): void {
    if (this.playerData.state !== 'holding-item') return;
    this.isCharging = true;
    this.chargeTime = 0;
  }

  private cancelCharge(): void {
    this.isCharging = false;
    this.chargeTime = 0;
    // Reset view mesh position
    if (this.heldViewMesh) {
      this.heldViewMesh.position.copy(this.heldViewBasePos);
      this.heldViewMesh.rotation.set(0, 0, 0);
    }
  }

  private executeThrow(): void {
    if (this.playerData.state !== 'holding-item') { this.cancelCharge(); return; }
    if (!this.playerData.heldObjectId) { this.cancelCharge(); return; }

    const obj = this.interactables.get(this.playerData.heldObjectId);
    if (!obj) { this.cancelCharge(); return; }

    const ratio = this.chargeRatio;
    this.isCharging = false;
    this.chargeTime = 0;

    // Calculate throw direction
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y += 0.15; // slight upward angle
    dir.normalize();

    // Find safe spawn position
    const spawnDist = 1.0 + Math.max(obj.width, obj.depth) * 0.5;
    const spawnPos = this.camera.position.clone().add(dir.clone().multiplyScalar(spawnDist));
    spawnPos.y = Math.max(spawnPos.y, obj.height / 2 + 0.1);

    // Check if spawn position is valid (simple check)
    const halfExtents = new THREE.Vector3(obj.width / 2, obj.height / 2, obj.depth / 2);
    if (this.physics.castShape(spawnPos, halfExtents)) {
      // Space blocked - don't throw
      this.hud.showTooFar(); // reuse as "space blocked" indicator
      return;
    }

    // Place box in world
    obj.mesh.position.copy(spawnPos);
    obj.mesh.rotation.set(0, 0, 0);
    obj.mesh.visible = true;

    // Re-enable physics
    if (obj.rigidBody) {
      this.physics.setBodyEnabled(obj.rigidBody, true);
      obj.rigidBody.setTranslation({ x: spawnPos.x, y: spawnPos.y, z: spawnPos.z }, true);
      obj.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

      // Apply impulse
      const impulseStrength = SCENE_CONFIG.minThrowImpulse + ratio * (SCENE_CONFIG.maxThrowImpulse - SCENE_CONFIG.minThrowImpulse);
      const mass = obj.rigidBody.mass();
      const impulse = dir.clone().multiplyScalar(impulseStrength * mass);
      obj.rigidBody.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);

      // Small angular impulse for rotation
      obj.rigidBody.applyTorqueImpulse({ x: ratio * 0.5, y: 0, z: ratio * -0.3 }, true);
    }

    // Restore carried envelopes if this is a container
    const isContainer = obj.mesh.userData.sortingBoxId || obj.mesh.userData.crateId;
    if (isContainer && this.carriedEnvelopes.length > 0) {
      obj.mesh.updateMatrixWorld(true);
      this.restoreContainerContentsWithVelocity(obj, dir, ratio);
    }

    this.removeHeldViewMesh();
    obj.isHeld = false;
    this.playerData.state = 'empty-handed';
    this.playerData.heldObjectId = null;
    this.hud.hideInteractionPrompt();
    this.hud.hideChargeBar();
  }

  // --- UPDATE ---
  update(deltaTime: number): void {
    // Sync viewModelCamera to main camera
    this.viewModelCamera.aspect = this.camera.aspect;
    this.viewModelCamera.fov = this.camera.fov;
    this.viewModelCamera.updateProjectionMatrix();
    // viewModelCamera stays at origin, heldViewMesh positioned relative to it

    // Charge update
    if (this.isCharging && this.playerData.state === 'holding-item') {
      this.chargeTime = Math.min(this.chargeTime + deltaTime, SCENE_CONFIG.maxChargeTime);
      this.hud.showChargeBar(this.chargeRatio);
      this.updateChargeShake();
    }
  }

  updatePlacementPreview(): void {
    if (this.playerData.state !== 'placement-preview') return;
    if (!this.previewMesh || !this.playerData.heldObjectId) return;

    const obj = this.interactables.get(this.playerData.heldObjectId);
    if (!obj) return;

    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    this.placementRaycaster.set(this.camera.position, direction);

    // For thin objects (envelopes), FIRST check interior planes with highest priority
    const isEnvelope = obj.height <= 0.05;
    if (isEnvelope) {
      const interiorPlanes = this.additionalSurfaces.filter(s =>
        s.userData && (s.userData.interiorPlane || s.userData.surfaceType === 'container-interior')
      );
      if (interiorPlanes.length > 0) {
        const interiorHits = this.placementRaycaster.intersectObjects(interiorPlanes, false);
        if (interiorHits.length > 0 && interiorHits[0].distance <= SCENE_CONFIG.interactionDistance + 2) {
          const hit = interiorHits[0];
          // Use hit point directly — the plane IS at the correct interior height
          const previewY = hit.point.y + obj.height / 2 + 0.01;
          this.previewMesh.position.set(hit.point.x, previewY, hit.point.z);
          this.previewMesh.rotation.set(0, 0, 0);
          this.previewMesh.visible = true;
          this.previewValid = true; // Inside container is always valid
          const mat = this.previewMesh.material as THREE.MeshStandardMaterial;
          mat.color.setHex(0x00ff00);
          this.hud.showPlacementPrompt(true);
          return;
        }
      }
    }

    // Normal surface detection (floor, tables, box tops)
    const surfaces: THREE.Object3D[] = [this.floor];
    // Only add non-interior additional surfaces
    for (const s of this.additionalSurfaces) {
      if (!s.userData.interiorPlane && !s.userData.surfaceType) {
        surfaces.push(s);
      } else if (s.userData.surfaceType === 'stamp-table' || s.userData.surfaceType === 'envelope-table') {
        surfaces.push(s);
      }
    }
    for (const other of this.interactables.values()) {
      if (other.isHeld || other.id === obj.id || !other.mesh.visible) continue;
      surfaces.push(other.mesh);
    }

    const intersects = this.placementRaycaster.intersectObjects(surfaces, true);

    if (intersects.length === 0) {
      this.previewMesh.visible = false;
      this.previewValid = false;
      this.hud.showPlacementPrompt(false);
      return;
    }

    const hit = intersects[0];
    let worldNormal = new THREE.Vector3(0, 1, 0);
    if (hit.face) {
      worldNormal = hit.face.normal.clone();
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
      worldNormal.applyMatrix3(normalMatrix).normalize();
    }

    if (worldNormal.y < 0.9) {
      this.previewMesh.visible = false;
      this.previewValid = false;
      this.hud.showPlacementPrompt(false);
      return;
    }

    // Calculate Y from support
    let supportY = hit.point.y;
    if (hit.object !== this.floor && !hit.object.userData.interiorPlane && !hit.object.userData.surfaceType) {
      const box = new THREE.Box3().setFromObject(hit.object);
      supportY = box.max.y;
    }

    // For bottom-origin containers, don't add height/2
    const isBottomOrigin = obj.mesh.userData.bottomOrigin || obj.mesh.userData.crateId;
    const previewY = isBottomOrigin ? supportY + 0.005 : supportY + obj.height / 2;
    this.previewMesh.position.set(hit.point.x, previewY, hit.point.z);
    this.previewMesh.rotation.set(0, 0, 0);
    this.previewMesh.visible = true;

    this.previewValid = this.validatePlacement(this.previewMesh.position, obj);
    const mat = this.previewMesh.material as THREE.MeshStandardMaterial;
    mat.color.setHex(this.previewValid ? 0x00ff00 : 0xff0000);
    this.hud.showPlacementPrompt(this.previewValid);
  }

  private validatePlacement(position: THREE.Vector3, obj: InteractableObject): boolean {
    const halfW = obj.width / 2;
    const halfH = obj.height / 2;
    const halfD = obj.depth / 2;
    const roomHalfW = SCENE_CONFIG.roomWidth / 2;
    const roomHalfD = SCENE_CONFIG.roomDepth / 2;

    // Room bounds
    if (position.x - halfW < -roomHalfW || position.x + halfW > roomHalfW ||
        position.z - halfD < -roomHalfD || position.z + halfD > roomHalfD) return false;

    // Player overlap
    const dx = position.x - this.camera.position.x;
    const dz = position.z - this.camera.position.z;
    if (Math.sqrt(dx * dx + dz * dz) < 0.5 + Math.max(halfW, halfD)) return false;

    // Box3 overlap check with epsilon
    const eps = 0.02;
    const placementBox = new THREE.Box3(
      new THREE.Vector3(position.x - halfW + eps, position.y - halfH + eps, position.z - halfD + eps),
      new THREE.Vector3(position.x + halfW - eps, position.y + halfH - eps, position.z + halfD - eps)
    );

    for (const other of this.interactables.values()) {
      if (other.id === obj.id || other.isHeld || !other.mesh.visible) continue;
      const otherBox = new THREE.Box3().setFromObject(other.mesh);
      if (placementBox.intersectsBox(otherBox)) return false;
    }

    return true;
  }

  private updateChargeShake(): void {
    if (!this.heldViewMesh) return;
    const ratio = this.chargeRatio;
    const t = performance.now() * 0.001;

    const shakeX = Math.sin(t * 15) * ratio * 0.04;
    const shakeY = Math.cos(t * 12) * ratio * 0.03;
    const shakeZ = Math.sin(t * 10) * ratio * 0.01;
    const rotX = Math.sin(t * 8) * ratio * 0.06;
    const rotY = Math.cos(t * 11) * ratio * 0.04;
    const rotZ = Math.sin(t * 9) * ratio * 0.03;

    this.heldViewMesh.position.set(
      this.heldViewBasePos.x + shakeX,
      this.heldViewBasePos.y + shakeY,
      this.heldViewBasePos.z + shakeZ
    );
    this.heldViewMesh.rotation.set(rotX, rotY, rotZ);
  }

  private removePreview(): void {
    if (this.previewMesh) {
      this.worldScene.remove(this.previewMesh);
      this.previewMesh.geometry.dispose();
      (this.previewMesh.material as THREE.Material).dispose();
      this.previewMesh = null;
    }
    this.previewValid = false;
  }

  // --- INPUT ---
  private onMouseDown(event: MouseEvent): void {
    if (this.playerData.state === 'placement-preview') {
      if (event.button === 0 && this.previewValid) this.confirmPlacement();
      else if (event.button === 2) this.cancelPlacement();
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (event.code === 'KeyQ' && this.playerData.state === 'holding-item') {
      this.startCharge();
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (event.code === 'KeyQ' && this.isCharging) {
      this.executeThrow();
    }
  }

  onResize(): void {
    this.viewModelCamera.aspect = window.innerWidth / window.innerHeight;
    this.viewModelCamera.updateProjectionMatrix();
  }
}
