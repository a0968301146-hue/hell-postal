import * as THREE from 'three';
import { InteractableObject } from '../../shared/types/interactable';
import { PlayerInteractionData } from '../../core/game-state';
import { SCENE_CONFIG } from '../../game/scene-manager';
import { PickupSystem } from './pickup-system';
import { EnvelopeSystem } from '../../game/envelope-system';
import { EnvelopeStampStation } from '../../game/envelope-stamp-station';
import { SortingBoxSystem } from '../../game/sorting-box-system';
import { VehicleControlSystem } from '../../game/vehicle-control-system';
import { CounterServiceSystem } from '../../game/counter-service-system';
import { DollySystem } from '../../game/dolly-system';
import { HUD } from '../../game/hud';
import { PauseManager } from '../../core/pause-manager';
import { SettingsManager } from '../settings';
import { UnloadingSystem } from '../../game/unloading-system';
import { DailyFlowSystem } from '../../game/daily-flow-system';
import { PalletSystem } from '../../game/pallet-system';
import { LostFoundSystem } from '../../game/lost-found-system';

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
  private unloadingSystem: UnloadingSystem;
  private dailyFlowSystem: DailyFlowSystem;
  private palletSystem: PalletSystem;
  private lostFoundSystem: LostFoundSystem;
  private onDollyUsed?: () => void;

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
    settingsManager: SettingsManager,
    unloadingSystem: UnloadingSystem,
    dailyFlowSystem: DailyFlowSystem,
    palletSystem: PalletSystem,
    lostFoundSystem: LostFoundSystem,
    onDollyUsed?: () => void
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
    this.unloadingSystem = unloadingSystem;
    this.dailyFlowSystem = dailyFlowSystem;
    this.palletSystem = palletSystem;
    this.lostFoundSystem = lostFoundSystem;
    this.onDollyUsed = onDollyUsed;

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
      // Sorting pallet: its own world-space carry/place flow (see
      // pallet-system.ts's class doc comment for why it can't go through
      // PickupSystem's generic viewmodel-clone flow like every other held
      // item below) — a second E press here commits the placement if the
      // live preview is valid, or stays held with a toast otherwise.
      // tryPlace() owns playerData.state/heldObjectId itself on success, so
      // there's nothing left to do here either way.
      if (this.playerData.heldObjectId === this.palletSystem.palletId) {
        this.palletSystem.tryPlace();
        return;
      }
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
      // Lost & found: hand over whatever's currently held at the counter
      // once the day's NPC is waiting there (spec七: 按 E 將目前拿著的失物
      // 交給NPC) — correctness (matching id vs anything else) is judged
      // entirely inside tryConfirmAtCounter, so this gate only needs
      // "is there actually someone to hand it to, and is the player on the
      // correct side of the counter" — intercepts before the generic
      // placement fallback below, same pattern as the pallet/envelope-
      // interior special cases above.
      if (
        this.playerData.heldObjectId &&
        this.lostFoundSystem.isNpcWaiting &&
        this.lostFoundSystem.isPlayerNearCounter(this.camera.position)
      ) {
        this.lostFoundSystem.tryConfirmAtCounter(this.playerData.heldObjectId);
        return;
      }
      // Normal: enter placement mode
      this.pickupSystem.enterPlacementMode();
      return;
    }

    if (this.playerData.state !== 'empty-handed') return;

    // Priority 1: pick up targeted object (envelope, package, crate, or the
    // sorting pallet). The pallet goes through its own pickUp() (world-space
    // group-carry, not PickupSystem's viewmodel clone) — see pallet-system.ts.
    // pickUp() owns playerData.state/heldObjectId itself and positions the
    // pallet in front of the camera on this very first held frame.
    if (this.currentTarget) {
      if (this.currentTarget.id === this.palletSystem.palletId) {
        const fwd = new THREE.Vector3();
        this.camera.getWorldDirection(fwd);
        this.palletSystem.pickUp(this.camera.position, fwd);
        this.clearHighlight(this.currentTarget);
        this.currentTarget = null;
        return;
      }
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

    // Priority 3: 開始卸貨 / 結束今天 — co-located near the north unload
    // dock close enough together that a naive per-button proximity check
    // would overlap; resolve to whichever one the player is actually
    // nearer to (same pattern as VehicleControlSystem's call/depart).
    switch (this.nearestUnloadClusterButton()) {
      case 'unload': this.unloadingSystem.pressButton(); return;
      case 'endDay': this.dailyFlowSystem.pressEndDayButton(); return;
    }

    // Priority 4: vehicle call/depart buttons (re-enabled — see
    // feature-flags.ts ENABLE_VEHICLE_LOADING_FLOW) — the two sit close
    // enough together that a naive per-button proximity check would
    // overlap; resolve to whichever one the player is actually nearer to.
    const nearestVehicleButton = this.vehicleControlSystem.getNearestButton(this.camera.position);
    if (nearestVehicleButton === 'call') {
      this.vehicleControlSystem.pressCallButton();
      return;
    }
    if (nearestVehicleButton === 'depart') {
      this.vehicleControlSystem.pressDepartButton();
      return;
    }

    // Priority 5: counter open-for-business button
    if (this.counterServiceSystem.isPlayerNear(this.camera.position)) {
      this.counterServiceSystem.pressButton();
      return;
    }

    // Priority 6: start pushing the dolly
    if (this.dollySystem.isPlayerNear(this.camera.position)) {
      this.dollySystem.startPush();
      this.playerData.state = 'pushing-dolly';
      this.onDollyUsed?.();
      return;
    }

    if (this.checkFarTarget()) {
      this.hud.showTooFar();
    }
  }

  /** Nearest-wins resolution between the co-located 開始卸貨/結束今天
   * buttons (spec section 十九: "四個按鈕不要互相重疊") — mirrors
   * VehicleControlSystem.getNearestButton()'s own tie-break pattern. */
  private nearestUnloadClusterButton(): 'unload' | 'endDay' | null {
    const pos = this.camera.position;
    const unloadNear = this.unloadingSystem.isPlayerNearButton(pos);
    const endDayNear = this.dailyFlowSystem.isPlayerNearButton(pos);
    if (!unloadNear && !endDayNear) return null;
    if (unloadNear && !endDayNear) return 'unload';
    if (!unloadNear && endDayNear) return 'endDay';
    return this.unloadingSystem.buttonDistance(pos) <= this.dailyFlowSystem.buttonDistance(pos) ? 'unload' : 'endDay';
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
      if (this.playerData.heldObjectId === this.palletSystem.palletId) {
        if (this.palletSystem.previewValid) {
          this.hud.showInteractionPrompt('整理托盤', 'E：放置整理托盤');
          this.hud.setCrosshairActive(true);
        } else {
          this.hud.showInteractionPrompt('整理托盤', '此處無法放置');
          this.hud.setCrosshairActive(false);
        }
      } else if (
        this.playerData.heldObjectId &&
        this.lostFoundSystem.isNpcWaiting &&
        this.lostFoundSystem.isPlayerNearCounter(this.camera.position)
      ) {
        this.hud.showInteractionPrompt('失物招領櫃檯', '按 E 交給委託人確認');
        this.hud.setCrosshairActive(true);
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
        } else if (newTarget.id === this.palletSystem.palletId) {
          this.hud.showInteractionPrompt(newTarget.displayName, 'E：拿起整理托盤');
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

    // 開始卸貨 / 結束今天 buttons — same nearest-button resolution as onKeyDown
    const nearestUnloadCluster = this.nearestUnloadClusterButton();
    if (nearestUnloadCluster === 'unload') {
      if (this.unloadingSystem.canStartUnloading) {
        this.hud.showInteractionPrompt('開始卸貨', '按 E 開始卸貨');
        this.hud.setCrosshairActive(true);
      } else {
        this.hud.showInteractionPrompt('開始卸貨', this.unloadingSystem.startBlockedMessage());
        this.hud.setCrosshairActive(false);
      }
      return;
    }
    if (nearestUnloadCluster === 'endDay') {
      if (this.dailyFlowSystem.canEndDay) {
        this.hud.showInteractionPrompt('結束今天', '按 E 結束今天');
        this.hud.setCrosshairActive(true);
      } else {
        this.hud.showInteractionPrompt('結束今天', this.dailyFlowSystem.endDayBlockedMessage());
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
