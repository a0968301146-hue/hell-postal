import * as THREE from 'three';
import { InteractableObject } from '../../shared/types/interactable';
import { PickupPort } from '../../shared/types/pickup-port';
import { PlayerInteractionData } from '../../core/game-state';
import { SCENE_CONFIG } from '../world-layout';
import { WORLD_BOUNDS } from '../world-layout';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { HUD } from '../hud';
import { PauseManager } from '../../core/pause-manager';
import { SettingsManager } from '../settings';

/** "Remove sealing and add physical mail box contents" round三/十: a narrow,
 * mail-box-specific parallel to this file's own EXISTING generic container
 * carry system (captureContainerContents/restoreContainerContents, above,
 * built for sortingBoxId/crateId containers) — kept as a SEPARATE hook
 * rather than folded into that system because mail boxes have a stricter
 * requirement the generic one doesn't (spec三: contained envelopes must stay
 * VISIBLE and visually follow the box's own rotation while held), which the
 * generic system's hide-and-track-in-a-side-array approach doesn't provide.
 * Set once via setMailBoxHooks() from create-game-systems.ts (after both
 * PickupSystem and MailBagSystem exist, avoiding a constructor-time circular
 * dependency), then invoked from pickUp()/confirmPlacement()/executeThrow()
 * ALONGSIDE (never replacing) the existing isContainer checks — the two are
 * mutually exclusive since mail boxes never set sortingBoxId/crateId. */
export interface MailBoxCarryHooks {
  isMailBox(obj: InteractableObject): boolean;
  prepareForCarry(obj: InteractableObject): void;
  restoreAfterPlacement(obj: InteractableObject, boxVelocity: THREE.Vector3): void;
  restoreForThrow(obj: InteractableObject, linearVelocity: THREE.Vector3, angularVelocity: THREE.Vector3): void;
}

export class PickupSystem implements PickupPort {
  private camera: THREE.PerspectiveCamera;
  private worldScene: THREE.Scene;
  private playerData: PlayerInteractionData;
  private interactables: Map<string, InteractableObject>;
  private hud: HUD;
  private physics: PhysicsSystem;
  private floor: THREE.Mesh;
  private pauseManager: PauseManager;
  private settingsManager: SettingsManager;
  private hasFiredFirstPickup = false;
  private hasFiredCounterReceive = false;
  private hasFiredCargoLabelSeen = false;
  private hasFiredCargoPileTouched = false;

  // ViewModel
  viewModelScene: THREE.Scene;
  viewModelCamera: THREE.PerspectiveCamera;
  /** One viewmodel clone + base offset per currently-held item, in pickup
   * order (index 0 = held longest, last index = most recently picked up /
   * "top of stack" — see the class doc comment on multi-carry below). Both
   * arrays are always kept the same length as `heldStack`. */
  private heldViewMeshes: THREE.Mesh[] = [];
  private heldViewBasePositions: THREE.Vector3[] = [];
  /** Per-slot lateral offset applied on top of an item's own natural
   * held-position calculation, so up to 3 simultaneously-held items don't
   * visually overlap/jitter against each other ("Add bulletin board upgrade
   * system" round spec五A: "手持物品之間不能互相碰撞或抖動") — a fixed,
   * simple layout rather than a collision-aware one, adequate since
   * multi-carry-eligible items are always small/medium (large/live cargo
   * is exclusive — see isExclusiveItem). */
  private readonly HELD_SLOT_OFFSETS: THREE.Vector3[] = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.34, -0.06, 0.2),
    new THREE.Vector3(-0.34, -0.06, 0.2),
  ];

  /** Ids of currently-held items, oldest-first — `heldStack[length-1]` is
   * always the "top" (most recently picked up) item, mirrored 1:1 by
   * `playerData.heldObjectId` so every EXISTING external reader of that
   * field (mail-bag-system, lost-found-system, interaction-system, ...)
   * keeps working completely unchanged, always seeing "the current primary
   * held item" — exactly matching this round's own LIFO requirement (spec
   * 五A: "放置/丟出時，最後拿起的物品優先處理", i.e. the same item
   * `heldObjectId` already points to). Multi-carry only ever ADDS the
   * ability to hold MORE than one at once; every single-item place/throw/
   * force-drop code path below is otherwise unchanged. */
  private heldStack: string[] = [];
  private maxCarryCapacity_ = 1;

  // Placement preview
  private previewMesh: THREE.Mesh | null = null;
  private previewValid = false;
  private placementRaycaster: THREE.Raycaster;
  /** True while the current placement preview is resting on a lost-found
   * cabinet cell's own shelf (`userData.lostFoundShelf`, set by
   * lost-found-cabinet-system.ts — "Fix hollow lost found cabinet
   * placement" round). Drives the "E 放入失物" prompt/confirm below —
   * every other placement surface (floor, tables, pallet, cargo) is
   * untouched, still confirmed by left-click only, exactly as before. */
  private previewIsLostFoundShelf = false;

  // Charge/throw
  private isCharging = false;
  private chargeTime = 0;
  private additionalSurfaces: THREE.Object3D[] = [];

  // Container content tracking (for moving envelopes with containers)
  private carriedEnvelopes: { obj: InteractableObject; localPos: THREE.Vector3; localQuat: THREE.Quaternion; wasSorted: boolean }[] = [];

  /** See the MailBoxCarryHooks doc comment above — null until
   * setMailBoxHooks() wires it up from create-game-systems.ts. */
  private mailBoxHooks: MailBoxCarryHooks | null = null;

  setMailBoxHooks(hooks: MailBoxCarryHooks): void {
    this.mailBoxHooks = hooks;
  }

  constructor(
    camera: THREE.PerspectiveCamera,
    worldScene: THREE.Scene,
    playerData: PlayerInteractionData,
    interactables: Map<string, InteractableObject>,
    hud: HUD,
    physics: PhysicsSystem,
    floor: THREE.Mesh,
    pauseManager: PauseManager,
    settingsManager: SettingsManager
  ) {
    this.camera = camera;
    this.worldScene = worldScene;
    this.playerData = playerData;
    this.interactables = interactables;
    this.hud = hud;
    this.physics = physics;
    this.floor = floor;
    this.pauseManager = pauseManager;
    this.settingsManager = settingsManager;
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

  /** How many items are currently held — spec二's exact "must read the
   * actual held COUNT, not just the old single heldItem field" contract
   * (used by InteractionSystem's bulletin-board empty-handed gate) and
   * spec五A's "持有 X/Y" HUD display both read this directly. */
  get heldCount(): number {
    return this.heldStack.length;
  }

  get maxCarryCapacity(): number {
    return this.maxCarryCapacity_;
  }

  /** UpgradeSystem's ONLY hook into multi-carry capacity (spec三/七: never
   * called by anything except UpgradeSystem.applyEffect, never reached into
   * directly). `n` is always >= 1 (Lv.0 baseline). */
  setMaxCarryCapacity(n: number): void {
    this.maxCarryCapacity_ = Math.max(1, n);
  }

  /** shapeType is only ever 'large' or 'cage' for daily cargo (see
   * cargo-system.ts spawnDailyBox/spawnDailyRoller) — both occupy the FULL
   * carry capacity exclusively (spec五A: "大型貨物與活體鐵籠佔滿容量，不可
   * 與其他物品同時持有"), never combinable with anything else in either
   * direction. */
  private isExclusiveItem(obj: InteractableObject): boolean {
    const shapeType = obj.mesh.userData.shapeType;
    return shapeType === 'large' || shapeType === 'cage';
  }

  private isCurrentHoldExclusive(): boolean {
    if (this.heldStack.length === 0) return false;
    const obj = this.interactables.get(this.heldStack[0]);
    return !!obj && this.isExclusiveItem(obj);
  }

  /** Shared "may this specific object be added to the held set right now"
   * check — used by both pickUp() itself and InteractionSystem's own
   * multi-carry pickup-targeting (aiming at a new item while already
   * holding something, spec五A), so the two can never diverge. */
  canAddToHeld(obj: InteractableObject | null | undefined): boolean {
    if (!obj || !obj.mesh || !obj.canPickUp || obj.isHeld) return false;
    if (this.playerData.state !== 'empty-handed' && this.playerData.state !== 'holding-item') return false;
    if (this.heldStack.length === 0) return true;
    if (this.isCurrentHoldExclusive()) return false;
    if (this.isExclusiveItem(obj)) return false;
    return this.heldStack.length < this.maxCarryCapacity_;
  }

  addPlacementSurface(surface: THREE.Object3D): void {
    this.additionalSurfaces.push(surface);
  }

  /** For surfaces that come and go, e.g. a vehicle's cargo bed while docked. */
  removePlacementSurface(surface: THREE.Object3D): void {
    const i = this.additionalSurfaces.indexOf(surface);
    if (i !== -1) this.additionalSurfaces.splice(i, 1);
  }

  get chargeRatio(): number {
    if (!this.isCharging) return 0;
    return Math.min(this.chargeTime / SCENE_CONFIG.maxChargeTime, 1);
  }

  // --- PICK UP ---
  pickUp(obj: InteractableObject): void {
    if (!this.canAddToHeld(obj)) return;

    if (!this.hasFiredFirstPickup) {
      this.hasFiredFirstPickup = true;
      this.settingsManager.fireTutorialEvent('pickup');
    }
    if (!this.hasFiredCounterReceive && obj.id.startsWith('counter-')) {
      this.hasFiredCounterReceive = true;
      this.settingsManager.fireTutorialEvent('counterReceive');
    }
    // "辨識貨物標籤" unlocks on the first labeled-cargo pickup (spec 十三:
    // "玩家第一次拿起有物流標籤的貨物") — cargo ids are always prefixed
    // 'cargo-' by CargoSystem, envelopes/packages are not, so this can't
    // misfire on picking up an envelope.
    if (!this.hasFiredCargoLabelSeen && obj.id.startsWith('cargo-')) {
      this.hasFiredCargoLabelSeen = true;
      this.settingsManager.fireTutorialEvent('cargoLabelSeen');
    }
    // "拆開貨堆" unlocks on the first pickup of any daily-flow cargo item —
    // daily-flow ids are always prefixed 'daily-' by CargoSystem's
    // spawnDailyBox/spawnDailyRoller (see cargo-system.ts).
    if (!this.hasFiredCargoPileTouched && obj.id.startsWith('daily-')) {
      this.hasFiredCargoPileTouched = true;
      this.settingsManager.fireTutorialEvent('cargoPileTouched');
    }

    // If picking up a container, capture envelopes inside
    const isContainer = obj.mesh.userData.sortingBoxId || obj.mesh.userData.crateId;
    if (isContainer) {
      this.captureContainerContents(obj);
    }
    // Mail box: reparent its contained envelopes under its own Mesh so
    // they ride along visibly (spec三) — see MailBoxCarryHooks doc comment.
    if (this.mailBoxHooks?.isMailBox(obj)) {
      this.mailBoxHooks.prepareForCarry(obj);
    }

    // Hide world mesh
    obj.mesh.visible = false;

    // Disable physics
    if (obj.rigidBody) {
      obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.physics.setBodyEnabled(obj.rigidBody, false);
    }

    // Create view model mesh (additive — keeps every already-held item's
    // own viewmodel clone in place, see addHeldViewMesh).
    this.addHeldViewMesh(obj);

    // Update state — pushed onto the stack; heldObjectId always mirrors the
    // new top (spec五A LIFO — see the heldStack field's own doc comment).
    obj.isHeld = true;
    this.heldStack.push(obj.id);
    this.playerData.state = 'holding-item';
    this.playerData.heldObjectId = obj.id;

    this.hud.showInteractionPrompt(obj.displayName, this.holdActionHintText());
  }

  /** "按住 Q 蓄力丟出" plus a "持有 X/Y" line once multi-carry actually
   * matters (Lv.0's max of 1 never shows it — spec五A: "HUD顯示『持有
   * 2/3』", only meaningful once more than one slot exists). */
  private holdActionHintText(): string {
    const countLine = this.maxCarryCapacity_ > 1 ? `\n持有 ${this.heldStack.length}/${this.maxCarryCapacity_}` : '';
    return `按 E 選擇放置位置\n按住 Q 蓄力丟出${countLine}`;
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

  /** Adds ONE more viewmodel clone for `obj` on top of whatever's already
   * held (never removes existing ones — see removeTopHeldViewMesh/
   * removeAllHeldViewMeshes below for how each one is later cleared). */
  private addHeldViewMesh(obj: InteractableObject): void {
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
    // the world mesh. Give the viewmodel its own copies so disposeViewMesh()
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

    const viewMesh = cloned as THREE.Mesh;

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

    // Slot offset (spec五A) — index 0 for the first item held, further
    // slots for each additional one on top of it (never more than
    // maxCarryCapacity_ - 1, capped defensively at the offset table's own
    // length since capacity is currently at most 3).
    const slotIndex = Math.min(this.heldViewMeshes.length, this.HELD_SLOT_OFFSETS.length - 1);
    const offset = this.HELD_SLOT_OFFSETS[slotIndex];
    const basePos = new THREE.Vector3(offset.x, holdY + offset.y, holdZ + offset.z);
    viewMesh.position.copy(basePos);

    // Large cargo (up to 1.35m on an axis) would otherwise fill most of the
    // screen at viewmodel distance — shrink the CLONE only (world size /
    // collider are untouched) once it's clearly bigger than the biggest
    // normal-cargo preset (0.6m, see cargo-data.ts CARGO_SIZE_LIMITS).
    if (maxDim > 0.9) {
      viewMesh.scale.setScalar(Math.max(0.5, 0.9 / maxDim));
    }

    this.heldViewMeshes.push(viewMesh);
    this.heldViewBasePositions.push(basePos);
    this.viewModelScene.add(viewMesh);
  }

  private disposeViewMesh(mesh: THREE.Mesh): void {
    this.viewModelScene.remove(mesh);
    mesh.traverse((child) => {
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
  }

  /** Removes just the TOP (most-recently-added) viewmodel clone — used
   * whenever the top-of-stack held item is placed/thrown/force-dropped,
   * leaving every other still-held item's own viewmodel untouched. */
  private removeTopHeldViewMesh(): void {
    const mesh = this.heldViewMeshes.pop();
    this.heldViewBasePositions.pop();
    if (mesh) this.disposeViewMesh(mesh);
  }

  /** Pops the current top-of-stack held item and updates player state to
   * whatever remains (LIFO — spec五A: "放置/丟出時最後拿起的物品優先處
   * 理"). Deliberately does NOT touch obj.isHeld/mesh/physics — identical
   * contract to the pre-multi-carry forceDropHeld() (see PickupPort's own
   * doc comment: "the object stays wherever it was left...it's the
   * caller's job to dispose or restore it") — every caller below already
   * handles that itself for exactly the one item being released. */
  private releaseTopHeldItem(): void {
    this.heldStack.pop();
    this.removeTopHeldViewMesh();
    if (this.heldStack.length > 0) {
      this.playerData.heldObjectId = this.heldStack[this.heldStack.length - 1];
      this.playerData.state = 'holding-item';
      const obj = this.interactables.get(this.playerData.heldObjectId);
      if (obj) this.hud.showInteractionPrompt(obj.displayName, this.holdActionHintText());
    } else {
      this.playerData.heldObjectId = null;
      this.playerData.state = 'empty-handed';
      this.hud.hideInteractionPrompt();
    }
  }

  /** Force release the CURRENT (top-of-stack) held item without placing it
   * (used for bag sorting) — any OTHER items still held underneath stay
   * held, untouched. */
  forceDropHeld(): void {
    if (!this.playerData.heldObjectId) return;
    this.cancelCharge();
    this.releaseTopHeldItem();
    this.hud.hideChargeBar();
  }

  /** Place held envelope directly into a sorting container at the given point */
  placeIntoContainer(obj: InteractableObject, containerId: string, hitPoint: THREE.Vector3, sortingBoxSystem: import('../../game/sorting-box-system').SortingBoxSystem): void {
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

    // Cancel any active charge (the top-item's viewmodel it was shaking is
    // removed below by releaseTopHeldItem itself).
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
    this.releaseTopHeldItem();
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
    this.hud.showInteractionPrompt(obj.displayName, this.holdActionHintText());
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

    // Re-enable world mesh. Roller cargo (spec "每日貨品清空核心流程" 十一)
    // rests lying on its side, not identity rotation like every other
    // object — see cargo-system.ts spawnDailyRoller for the same tip quaternion.
    const isRoller = obj.mesh.userData.shapeType === 'roller';
    const rollerQuat = isRoller ? new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)) : null;
    obj.mesh.position.copy(pos);
    if (rollerQuat) obj.mesh.quaternion.copy(rollerQuat);
    else obj.mesh.rotation.set(0, 0, 0);
    obj.mesh.visible = true;

    // Re-enable physics (same order as throw: enable FIRST, then set position)
    if (obj.rigidBody) {
      // For bottom-origin containers, rigid body center is at pos.y + height/2
      const isBottomOrigin = obj.mesh.userData.bottomOrigin || obj.mesh.userData.crateId;
      const bodyY = isBottomOrigin ? pos.y + obj.height / 2 : pos.y;
      this.physics.setBodyEnabled(obj.rigidBody, true);
      obj.rigidBody.setTranslation({ x: pos.x, y: bodyY, z: pos.z }, true);
      obj.rigidBody.setRotation(rollerQuat ?? { x: 0, y: 0, z: 0, w: 1 }, true);
      obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    this.removePreview();

    // Restore carried envelopes if this is a container
    const isContainer = obj.mesh.userData.sortingBoxId || obj.mesh.userData.crateId;
    if (isContainer && this.carriedEnvelopes.length > 0) {
      // Update container matrixWorld before restoring contents
      obj.mesh.updateMatrixWorld(true);
      this.restoreContainerContents(obj);
    }
    // Mail box: unparent contained envelopes and restore their own physics
    // at the box's final placed transform, near-zero velocity so they settle
    // naturally (spec四).
    if (this.mailBoxHooks?.isMailBox(obj)) {
      this.mailBoxHooks.restoreAfterPlacement(obj, new THREE.Vector3(0, 0, 0));
    }

    obj.isHeld = false;
    obj.canPickUp = true;
    this.releaseTopHeldItem();
  }

  // --- THROW ---

  /** The ONE item Q-throw (its own toast/charge-bar progress AND the actual
   * throw) ever acts on ("Fix cargo throwing and rebalance daily manifest"
   * round一: "提示文字、蓄力進度與實際丟出必須讀取同一個activeHeldItem") —
   * `heldStack`'s own top when any multi-carry item is held (spec一:
   * "Q永遠處理heldItems最後拿取的物品，也就是heldItems.at(-1)"), falling
   * back to `playerData.heldObjectId` only for the sorting pallet's own
   * separate world-space carry (pallet-system.ts writes that field directly
   * and never pushes onto `heldStack` — see its own class doc comment).
   * Never reads currentTarget/crosshair or any other cached reference. */
  private getActiveHeldItem(): InteractableObject | null {
    if (this.heldStack.length > 0) {
      return this.interactables.get(this.heldStack[this.heldStack.length - 1]) ?? null;
    }
    return this.playerData.heldObjectId ? this.interactables.get(this.playerData.heldObjectId) ?? null : null;
  }

  private startCharge(): void {
    if (this.playerData.state !== 'holding-item') return;
    // Generic opt-out for held objects that must never be thrown (spec
    // "貨品外型與比例有更多變化" round 十一: the sorting pallet — throwing a
    // whole loaded pallet would fling every pinned cargo item with it).
    // Checked via a plain mesh.userData flag rather than an id/type check so
    // any future non-throwable held object can opt in the same way — but as
    // of "Fix cargo throwing and rebalance daily manifest" round一, cargo
    // itself never sets this flag anymore (see cargo-system.ts spawnDailyBox/
    // spawnDailyRoller — every pickupable cargo item is throwable, spec一:
    // "所有可拾取貨物都可以Q丟出"), so in practice this now only ever
    // matches the pallet, and the toast text below is correct ("若
    // activeHeldItem確實是托盤，才顯示「整理托盤無法投擲」").
    const heldObj = this.getActiveHeldItem();
    if (heldObj?.mesh.userData.noThrow) {
      this.hud.showToast('整理托盤無法投擲');
      return;
    }
    this.isCharging = true;
    this.chargeTime = 0;
  }

  private cancelCharge(): void {
    this.isCharging = false;
    this.chargeTime = 0;
    // Reset ONLY the top-of-stack viewmodel's position — that's the only
    // one charging/shaking ever touches (see updateChargeShake below);
    // every other held item's viewmodel stays exactly where its own slot
    // offset put it.
    const topMesh = this.heldViewMeshes[this.heldViewMeshes.length - 1];
    const topBase = this.heldViewBasePositions[this.heldViewBasePositions.length - 1];
    if (topMesh && topBase) {
      topMesh.position.copy(topBase);
      topMesh.rotation.set(0, 0, 0);
    }
  }

  private executeThrow(): void {
    if (this.playerData.state !== 'holding-item') { this.cancelCharge(); return; }
    // Same single source of truth as startCharge()'s own guard (spec一) —
    // never re-reads playerData.heldObjectId directly here, so a held
    // pallet vs. a held cargo item can never diverge between the toast
    // check and the actual throw.
    const obj = this.getActiveHeldItem();
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

    // Place box in world. Roller cargo keeps its on-side tip instead of
    // resetting to identity — see confirmPlacement's isRoller comment above.
    const isThrownRoller = obj.mesh.userData.shapeType === 'roller';
    const throwRollerQuat = isThrownRoller ? new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)) : null;
    obj.mesh.position.copy(spawnPos);
    if (throwRollerQuat) obj.mesh.quaternion.copy(throwRollerQuat);
    else obj.mesh.rotation.set(0, 0, 0);
    obj.mesh.visible = true;

    // Re-enable physics
    if (obj.rigidBody) {
      this.physics.setBodyEnabled(obj.rigidBody, true);
      obj.rigidBody.setTranslation({ x: spawnPos.x, y: spawnPos.y, z: spawnPos.z }, true);
      obj.rigidBody.setRotation(throwRollerQuat ?? { x: 0, y: 0, z: 0, w: 1 }, true);
      obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

      // Apply impulse — large/live cargo gets a reduced (never zero) throw
      // speed (spec一: "大型與活物可以降低投擲速度，但不可完全禁止"). Impulse
      // is already scaled by the object's own mass just below, which cancels
      // out of the resulting velocity (impulse/mass) — so without this
      // explicit multiplier, a heavy live cage would fly exactly as fast as
      // a light box once charge ratio is equal; this multiplier is the only
      // thing that actually slows it down.
      const isHeavyOrLiveCargo = obj.mesh.userData.shapeType === 'large' || obj.mesh.userData.shapeType === 'cage';
      const throwSpeedMultiplier = isHeavyOrLiveCargo ? 0.5 : 1;
      const impulseStrength = (SCENE_CONFIG.minThrowImpulse + ratio * (SCENE_CONFIG.maxThrowImpulse - SCENE_CONFIG.minThrowImpulse)) * throwSpeedMultiplier;
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
    // Mail box: unparent contents and restore their physics IMMEDIATELY at
    // throw time (spec五: "在丟出的瞬間就要恢復物理，而非等箱子落地後才處
    // 理"), inheriting the box's own ACTUAL post-impulse velocity — read
    // AFTER applyImpulse/applyTorqueImpulse above, not the pre-impulse zero.
    if (this.mailBoxHooks?.isMailBox(obj) && obj.rigidBody) {
      obj.mesh.updateMatrixWorld(true);
      const boxLinvel = obj.rigidBody.linvel();
      const boxAngvel = obj.rigidBody.angvel();
      this.mailBoxHooks.restoreForThrow(
        obj,
        new THREE.Vector3(boxLinvel.x, boxLinvel.y, boxLinvel.z),
        new THREE.Vector3(boxAngvel.x, boxAngvel.y, boxAngvel.z)
      );
    }

    obj.isHeld = false;
    this.releaseTopHeldItem();
    this.hud.hideChargeBar();
  }

  // --- UPDATE ---
  update(deltaTime: number): void {
    // Sync viewModelCamera to main camera
    this.viewModelCamera.aspect = this.camera.aspect;
    this.viewModelCamera.fov = this.camera.fov;
    this.viewModelCamera.updateProjectionMatrix();
    // viewModelCamera stays at origin, each heldViewMeshes entry positioned relative to it

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

    this.previewIsLostFoundShelf = false;

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
      } else if (s.userData.surfaceType === 'stamp-table' || s.userData.surfaceType === 'envelope-table' || s.userData.surfaceType === 'cargo-ramp' || s.userData.surfaceType === 'pallet-top') {
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
    // "Fix hollow lost found cabinet placement" round: recognize a
    // lost-found cabinet cell's own shelf specifically (see
    // lost-found-cabinet-system.ts's `userData.lostFoundShelf` tag) so the
    // prompt/confirm-input below can special-case it — every other surface
    // (floor, tables, pallet, cargo) leaves this false, unaffected.
    this.previewIsLostFoundShelf = !!hit.object.userData.lostFoundShelf;
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
    // "Fix hollow lost found cabinet placement" round 二: a dedicated
    // "E 放入失物" prompt while aiming at an empty cabinet cell — every
    // other placement target keeps the existing left-click prompt
    // unchanged (spec: 不要修改貨物與載具).
    if (this.previewIsLostFoundShelf) {
      this.hud.showInteractionPrompt('失物收納格', this.previewValid ? 'E 放入失物' : '此格已被佔用或空間不足');
    } else {
      this.hud.showPlacementPrompt(this.previewValid);
    }
  }

  private validatePlacement(position: THREE.Vector3, obj: InteractableObject): boolean {
    const halfW = obj.width / 2;
    const halfH = obj.height / 2;
    const halfD = obj.depth / 2;

    // World bounds (see logistics-layout-data.ts — the playable area is no
    // longer a single room centered at the origin, so this is a min/max box).
    if (position.x - halfW < WORLD_BOUNDS.minX || position.x + halfW > WORLD_BOUNDS.maxX ||
        position.z - halfD < WORLD_BOUNDS.minZ || position.z + halfD > WORLD_BOUNDS.maxZ) return false;

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

    // Full held-item collider-bounds check against STATIC scene geometry —
    // walls, and (the case this was added for) a storage shelf's own
    // corner posts / back panel / the board of the level above ("Enlarge
    // west wall shelves for medium cargo" round spec三: "放置預覽必須使用
    // 手持物品完整Collider bounds檢查...不要等confirmPlacement後才靠物理碰
    // 撞彈開" — a large item aimed at a shelf level used to show a valid
    // green preview and only get physically shoved out once its rigidbody
    // resumed on confirm; this catches it BEFORE that, at preview time).
    // Uses PhysicsSystem.castShapeAgainstStaticAndBox — a correctly-group-
    // packed sibling of the existing castShape() (see that new method's own
    // doc comment for why the older one couldn't be reused as-is here).
    // Every legitimate placement already positions the preview flush
    // (zero-gap) against its own support surface, and the 0.01 shrink
    // margin both methods share keeps that "resting exactly on top of X"
    // case from ever being misread as overlap — this only ever catches a
    // genuine collision with solid geometry.
    if (this.physics.castShapeAgainstStaticAndBox(position, new THREE.Vector3(halfW, halfH, halfD))) return false;

    return true;
  }

  /** Only the TOP-of-stack held item's viewmodel shakes while charging a
   * throw — every other simultaneously-held item's clone stays static in
   * its own slot (spec五A: no jitter between held items). */
  private updateChargeShake(): void {
    const topMesh = this.heldViewMeshes[this.heldViewMeshes.length - 1];
    const topBase = this.heldViewBasePositions[this.heldViewBasePositions.length - 1];
    if (!topMesh || !topBase) return;
    const ratio = this.chargeRatio;
    const t = performance.now() * 0.001;

    const shakeX = Math.sin(t * 15) * ratio * 0.04;
    const shakeY = Math.cos(t * 12) * ratio * 0.03;
    const shakeZ = Math.sin(t * 10) * ratio * 0.01;
    const rotX = Math.sin(t * 8) * ratio * 0.06;
    const rotY = Math.cos(t * 11) * ratio * 0.04;
    const rotZ = Math.sin(t * 9) * ratio * 0.03;

    topMesh.position.set(
      topBase.x + shakeX,
      topBase.y + shakeY,
      topBase.z + shakeZ
    );
    topMesh.rotation.set(rotX, rotY, rotZ);
  }

  private removePreview(): void {
    if (this.previewMesh) {
      this.worldScene.remove(this.previewMesh);
      this.previewMesh.geometry.dispose();
      (this.previewMesh.material as THREE.Material).dispose();
      this.previewMesh = null;
    }
    this.previewValid = false;
    this.previewIsLostFoundShelf = false;
  }

  // --- INPUT ---
  private onMouseDown(event: MouseEvent): void {
    if (this.pauseManager.isPaused) return;
    if (this.playerData.state === 'placement-preview') {
      if (event.button === 0 && this.previewValid) this.confirmPlacement();
      else if (event.button === 2) this.cancelPlacement();
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.pauseManager.isPaused) return;
    if (event.repeat) return;
    if (this.settingsManager.inputBindings.matches('chargeThrow', event.code) && this.playerData.state === 'holding-item') {
      this.startCharge();
    }
    // "Fix hollow lost found cabinet placement" round 二: E also confirms
    // placement (in addition to the existing left-click path above) while
    // aiming at a valid, empty lost-found cabinet cell — reuses the exact
    // same confirmPlacement() every other placement already commits
    // through (real Rigidbody/Collider re-enabled, no teleport-into-a-data-
    // slot, no forced snapping). Scoped to previewIsLostFoundShelf so every
    // other placement target (cargo, pallet, tables) keeps its existing
    // left-click-only confirm, unchanged. InteractionSystem's own E handler
    // already no-ops entirely during 'placement-preview' state, so there's
    // no double-handling between the two listeners.
    if (
      this.playerData.state === 'placement-preview' && this.previewIsLostFoundShelf && this.previewValid &&
      (this.settingsManager.inputBindings.matches('interact', event.code) || this.settingsManager.inputBindings.matches('pickupPlace', event.code))
    ) {
      this.confirmPlacement();
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    // Deliberately NOT gated by pauseManager: if a charge was already in
    // progress when the pause began, letting the matching keyup still
    // resolve it (rather than leaving isCharging permanently stuck true)
    // avoids a dangling charge bar after the manual/settlement UI closes.
    if (this.settingsManager.inputBindings.matches('chargeThrow', event.code) && this.isCharging) {
      this.executeThrow();
    }
  }

  onResize(): void {
    this.viewModelCamera.aspect = window.innerWidth / window.innerHeight;
    this.viewModelCamera.updateProjectionMatrix();
  }
}
