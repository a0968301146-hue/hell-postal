import * as THREE from 'three';
import { InteractableObject, PlayerInteractionData } from './interactable-object';
import { SCENE_CONFIG } from './scene-manager';
import { PickupSystem } from './pickup-system';
import { EnvelopeSystem } from './envelope-system';
import { EnvelopeStampStation } from './envelope-stamp-station';
import { SortingBoxSystem } from './sorting-box-system';
import { VehicleControlSystem } from './vehicle-control-system';
import { CounterServiceSystem } from './counter-service-system';
import { DollySystem } from './dolly-system';
import { HUD } from './hud';
import { PauseManager } from './pause-manager';
import { SettingsManager } from './settings-manager';

export class InteractionSystem {
  private raycaster: THREE.Raycaster;
  private camera: THREE.PerspectiveCamera;
  private interactables: Map<string, InteractableObject>;
  private playerData: PlayerInteractionData;
  private pickupSystem: PickupSystem;
  private hud: HUD;
  private currentTarget: InteractableObject | null = null;
  private isLocked: () => boolean;
  private envelopeSystem: EnvelopeSystem;
  private envelopeStation: EnvelopeStampStation;
  private onStartEnvelopeMinigame: () => void;
  private sortingBoxSystem: SortingBoxSystem;
  private vehicleControlSystem: VehicleControlSystem;
  private counterServiceSystem: CounterServiceSystem;
  private dollySystem: DollySystem;
  private pauseManager: PauseManager;
  private settingsManager: SettingsManager;

  constructor(
    camera: THREE.PerspectiveCamera,
    interactables: Map<string, InteractableObject>,
    playerData: PlayerInteractionData,
    pickupSystem: PickupSystem,
    hud: HUD,
    isLockedFn: () => boolean,
    envelopeSystem: EnvelopeSystem,
    envelopeStation: EnvelopeStampStation,
    onStartEnvelopeMinigame: () => void,
    sortingBoxSystem: SortingBoxSystem,
    vehicleControlSystem: VehicleControlSystem,
    counterServiceSystem: CounterServiceSystem,
    dollySystem: DollySystem,
    pauseManager: PauseManager,
    settingsManager: SettingsManager
  ) {
    this.raycaster = new THREE.Raycaster();
    this.camera = camera;
    this.interactables = interactables;
    this.playerData = playerData;
    this.pickupSystem = pickupSystem;
    this.hud = hud;
    this.isLocked = isLockedFn;
    this.envelopeSystem = envelopeSystem;
    this.envelopeStation = envelopeStation;
    this.onStartEnvelopeMinigame = onStartEnvelopeMinigame;
    this.sortingBoxSystem = sortingBoxSystem;
    this.vehicleControlSystem = vehicleControlSystem;
    this.counterServiceSystem = counterServiceSystem;
    this.dollySystem = dollySystem;
    this.pauseManager = pauseManager;
    this.settingsManager = settingsManager;

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (!this.isLocked()) return;
    if (this.pauseManager.isPaused) return;

    // F key: take envelope from crate (only when empty-handed and near crate)
    if (event.code === 'KeyF') {
      if (this.playerData.state !== 'empty-handed') return;
      if (this.envelopeSystem.isPlayerNearCrate(this.camera.position)) {
        if (this.envelopeSystem.hasEnvelopes()) {
          const envObj = this.envelopeSystem.takeEnvelope();
          if (envObj) {
            this.pickupSystem.pickUp(envObj);
          }
        } else {
          this.hud.showInteractionPrompt('待整理信封箱', '目前沒有未整理信封');
        }
      }
      return;
    }

    // E key — "interact" and "pickupPlace" share this one handler (see
    // input-binding-manager.ts doc comment on why they're not independent).
    const bindings = this.settingsManager.inputBindings;
    if (!bindings.matches('interact', event.code) && !bindings.matches('pickupPlace', event.code)) return;

    if (this.playerData.state === 'placement-preview' || this.playerData.state === 'stamping-minigame') return;

    // Pushing a dolly: E always means "let go", regardless of proximity —
    // checked before the empty-handed guard below since 'pushing-dolly' isn't 'empty-handed'.
    if (this.playerData.state === 'pushing-dolly') {
      this.dollySystem.stopPush();
      this.playerData.state = 'empty-handed';
      return;
    }

    if (this.playerData.state === 'holding-item') {
      // Check if aiming at sorting box interior - direct placement
      const heldId = this.playerData.heldObjectId;
      const heldObj = heldId ? this.interactables.get(heldId) : null;
      if (heldObj && heldObj.height <= 0.05) {
        // Holding an envelope - check if aiming at interior plane
        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        this.raycaster.set(this.camera.position, dir);
        // Collect all interior planes (sorting boxes + incoming crate)
        const planes: THREE.Object3D[] = [];
        for (const plane of this.sortingBoxSystem.interiorPlanes.values()) {
          planes.push(plane);
        }
        if (this.envelopeSystem.interiorPlane) {
          planes.push(this.envelopeSystem.interiorPlane);
        }
        const hits = this.raycaster.intersectObjects(planes, false);
        if (hits.length > 0 && hits[0].distance <= SCENE_CONFIG.interactionDistance + 1) {
          const hitPlane = hits[0].object;
          const boxId = hitPlane.userData.ownerSortingContainerId as string;
          if (boxId && this.sortingBoxSystem.isPlacedBox(this.interactables.get(boxId)!)) {
            // Direct place envelope inside sorting box
            this.pickupSystem.placeIntoContainer(heldObj, boxId, hits[0].point, this.sortingBoxSystem);
            return;
          }
        }
      }
      // Normal: enter placement mode
      this.pickupSystem.enterPlacementMode();
      return;
    }

    if (this.playerData.state !== 'empty-handed') return;

    // Priority 1: pick up targeted object (envelope, package, or crate)
    if (this.currentTarget) {
      this.pickupSystem.pickUp(this.currentTarget);
      this.clearHighlight(this.currentTarget);
      this.currentTarget = null;
      return;
    }

    // Priority 2: envelope stamp station
    if (this.envelopeStation.readyEnvelopeId && this.envelopeStation.isPlayerNearTable(this.camera.position)) {
      this.onStartEnvelopeMinigame();
      return;
    }

    // Priority 3: vehicle call/depart buttons — the two sit close enough
    // together that a naive per-button proximity check would overlap;
    // resolve to whichever one the player is actually nearer to.
    const nearestVehicleButton = this.vehicleControlSystem.getNearestButton(this.camera.position);
    if (nearestVehicleButton === 'call') {
      this.vehicleControlSystem.pressCallButton();
      return;
    }
    if (nearestVehicleButton === 'depart') {
      this.vehicleControlSystem.pressDepartButton();
      return;
    }

    // Priority 4: counter open-for-business button
    if (this.counterServiceSystem.isPlayerNear(this.camera.position)) {
      this.counterServiceSystem.pressButton();
      return;
    }

    // Priority 5: start pushing the dolly
    if (this.dollySystem.isPlayerNear(this.camera.position)) {
      this.dollySystem.startPush();
      this.playerData.state = 'pushing-dolly';
      return;
    }

    if (this.checkFarTarget()) {
      this.hud.showTooFar();
    }
  }

  private checkFarTarget(): boolean {
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    this.raycaster.set(this.camera.position, direction);
    const meshes = this.getInteractableMeshes();
    const intersects = this.raycaster.intersectObjects(meshes, true);
    return intersects.length > 0 && intersects[0].distance > SCENE_CONFIG.interactionDistance;
  }

  update(): void {
    if (!this.isLocked()) return;
    if (this.playerData.state === 'stamping-minigame') return;

    if (this.playerData.state === 'placement-preview') {
      if (this.currentTarget) { this.clearHighlight(this.currentTarget); this.currentTarget = null; }
      this.pickupSystem.updatePlacementPreview();
      return;
    }

    if (this.playerData.state === 'holding-item') {
      if (this.currentTarget) {
        this.clearHighlight(this.currentTarget);
        this.currentTarget = null;
        this.playerData.targetedObjectId = null;
      }
      return;
    }

    if (this.playerData.state === 'pushing-dolly') {
      if (this.currentTarget) {
        this.clearHighlight(this.currentTarget);
        this.currentTarget = null;
        this.playerData.targetedObjectId = null;
      }
      this.hud.showInteractionPrompt('拖板車', '按 E 放開');
      this.hud.setCrosshairActive(true);
      return;
    }

    // Normal raycasting for interaction
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    this.raycaster.set(this.camera.position, direction);
    const meshes = this.getInteractableMeshes();
    const intersects = this.raycaster.intersectObjects(meshes, true);

    let newTarget: InteractableObject | null = null;
    if (intersects.length > 0 && intersects[0].distance <= SCENE_CONFIG.interactionDistance) {
      newTarget = this.resolveInteractableFromHit(intersects[0].object);
    }

    if (newTarget !== this.currentTarget) {
      if (this.currentTarget) this.clearHighlight(this.currentTarget);
      if (newTarget) {
        this.applyHighlight(newTarget);
        // Show appropriate prompt
        if (this.sortingBoxSystem.isSortingBox(newTarget)) {
          this.hud.showInteractionPrompt(newTarget.displayName, '按 E 拿起');
        } else if (this.envelopeSystem.isCrate(newTarget)) {
          this.hud.showInteractionPrompt(newTarget.displayName, `E：拿起信封箱\nF：取出信封 (剩餘${this.envelopeSystem.remainingCount})`);
        } else {
          this.hud.showInteractionPrompt(newTarget.displayName, '按 E 拿起');
        }
        this.hud.setCrosshairActive(true);
      } else {
        this.updateStationPrompts();
      }
      this.currentTarget = newTarget;
      this.playerData.targetedObjectId = newTarget ? newTarget.id : null;
    }
  }

  private updateStationPrompts(): void {
    // Envelope crate proximity (no direct target)
    if (this.envelopeSystem.isPlayerNearCrate(this.camera.position)) {
      if (this.envelopeSystem.hasEnvelopes()) {
        this.hud.showInteractionPrompt('待整理信封箱', `F：取出信封 (剩餘${this.envelopeSystem.remainingCount})`);
        this.hud.setCrosshairActive(false);
      }
      return;
    }

    // Envelope station
    if (this.envelopeStation.isPlayerNearTable(this.camera.position)) {
      const status = this.envelopeStation.statusMessage;
      if (status === 'ready') {
        this.hud.showInteractionPrompt('信封貼郵票桌', '按 E 開始替信封貼郵票');
        this.hud.setCrosshairActive(true);
      } else if (status === 'too-many') {
        this.hud.showInteractionPrompt('信封貼郵票桌', '桌面上只能放置一封信');
        this.hud.setCrosshairActive(false);
      } else if (status === 'already-stamped') {
        this.hud.showInteractionPrompt('信封貼郵票桌', '請先將完成的信封拿走');
        this.hud.setCrosshairActive(false);
      } else {
        this.hud.showInteractionPrompt('信封貼郵票桌', '請先將信封放到桌面');
        this.hud.setCrosshairActive(false);
      }
      return;
    }

    // Vehicle call/depart buttons — same nearest-button resolution as onKeyDown
    const nearestVehicleButton = this.vehicleControlSystem.getNearestButton(this.camera.position);
    if (nearestVehicleButton === 'call') {
      if (this.vehicleControlSystem.canCall) {
        this.hud.showInteractionPrompt('呼叫載具', '按 E 同時呼叫陸運與海運');
        this.hud.setCrosshairActive(true);
      } else {
        this.hud.showInteractionPrompt('呼叫載具', this.vehicleControlSystem.callBlockedMessage());
        this.hud.setCrosshairActive(false);
      }
      return;
    }
    if (nearestVehicleButton === 'depart') {
      if (this.vehicleControlSystem.canDepart) {
        this.hud.showInteractionPrompt('載具出發', '按 E 讓兩台載具一起離場');
        this.hud.setCrosshairActive(true);
      } else {
        this.hud.showInteractionPrompt('載具出發', this.vehicleControlSystem.departBlockedMessage());
        this.hud.setCrosshairActive(false);
      }
      return;
    }

    // Counter open-for-business button
    if (this.counterServiceSystem.isPlayerNear(this.camera.position)) {
      if (this.counterServiceSystem.phase === 'open') {
        this.hud.showInteractionPrompt('開業按鈕', '營業中...');
        this.hud.setCrosshairActive(false);
      } else {
        this.hud.showInteractionPrompt('開業按鈕', '按 E 開始營業');
        this.hud.setCrosshairActive(true);
      }
      return;
    }

    // Flatbed dolly — parked, not currently being pushed
    if (this.dollySystem.isPlayerNear(this.camera.position)) {
      this.hud.showInteractionPrompt('拖板車', '按 E 推行');
      this.hud.setCrosshairActive(true);
      return;
    }

    this.hud.hideInteractionPrompt();
    this.hud.setCrosshairActive(false);
  }

  private getInteractableMeshes(): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const obj of this.interactables.values()) {
      if (obj.isHeld || !obj.canPickUp || !obj.mesh.visible) continue;
      meshes.push(obj.mesh);
    }
    return meshes;
  }

  /** Resolve hit object to InteractableObject by traversing parent chain */
  private resolveInteractableFromHit(hitObject: THREE.Object3D): InteractableObject | null {
    let current: THREE.Object3D | null = hitObject;
    while (current) {
      // Check by direct mesh match
      for (const obj of this.interactables.values()) {
        if (obj.mesh === current && obj.canPickUp && !obj.isHeld && obj.mesh.visible) {
          return obj;
        }
      }
      // Check userData for envelope/package owner
      if (current.userData.ownerEnvelopeId || current.userData.envelopeId) {
        const id = current.userData.ownerEnvelopeId || current.userData.envelopeId;
        const obj = this.interactables.get(id);
        if (obj && obj.canPickUp && !obj.isHeld && obj.mesh.visible) return obj;
      }
      current = current.parent;
    }
    return null;
  }

  private applyHighlight(obj: InteractableObject): void {
    const mat = obj.mesh.material;
    if (mat && 'emissive' in mat) {
      (mat as THREE.MeshStandardMaterial).emissive.setHex(0x444444);
    }
  }

  private clearHighlight(obj: InteractableObject): void {
    const mat = obj.mesh.material;
    if (mat && 'emissive' in mat) {
      (mat as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
    }
  }
}
