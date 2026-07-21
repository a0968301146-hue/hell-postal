import * as THREE from 'three';
import { createTestScene, SCENE_CONFIG } from './scene-manager';
import { PhysicsSystem } from './physics-system';
import { PlayerController } from './player-controller';
import { InteractionSystem } from './interaction-system';
import { PickupSystem } from './pickup-system';
import { HUD } from './hud';
import { createPlayerInteractionData, InteractableObject, PlayerInteractionData } from './interactable-object';
import { StampStation } from './stamp-station';
import { StampMinigame, MinigameResult } from './stamp-minigame';
import { PackageData } from './package-data';
import { EnvelopeSystem } from './envelope-system';
import { EnvelopeStampStation } from './envelope-stamp-station';
import { SortingBoxSystem } from './sorting-box-system';
import { MailSortingSystem } from './mail-sorting-system';

export class Game {
  private worldScene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private physics: PhysicsSystem;
  private playerController!: PlayerController;
  private interactionSystem!: InteractionSystem;
  private pickupSystem!: PickupSystem;
  private hud!: HUD;
  private clock: THREE.Clock;
  private interactables!: Map<string, InteractableObject>;
  private playerData!: PlayerInteractionData;
  private stampStation!: StampStation;
  private envelopeStation!: EnvelopeStampStation;
  private envelopeSystem!: EnvelopeSystem;
  private mailBagSystem!: SortingBoxSystem;
  private mailSortingSystem!: MailSortingSystem;
  private stampMinigame: StampMinigame | null = null;
  private packageDataMap!: Map<string, PackageData>;

  constructor() {
    this.worldScene = new THREE.Scene();
    this.worldScene.background = new THREE.Color(0x222222);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.autoClear = false;
    document.body.appendChild(this.renderer.domElement);

    this.clock = new THREE.Clock();
    this.physics = new PhysicsSystem();

    window.addEventListener('resize', () => this.onResize());
  }

  async start(): Promise<void> {
    await this.physics.init();

    this.hud = new HUD();
    this.playerData = createPlayerInteractionData();
    const sceneData = createTestScene(this.worldScene, this.physics);
    this.interactables = sceneData.interactables;

    // Build packageDataMap from interactables
    this.packageDataMap = new Map();
    for (const obj of this.interactables.values()) {
      if (obj.packageData) {
        this.packageDataMap.set(obj.id, obj.packageData);
      }
    }

    // Stamp station (packages)
    this.stampStation = new StampStation(this.worldScene, this.physics, this.interactables, this.packageDataMap);

    // Envelope system + station
    this.envelopeSystem = new EnvelopeSystem(this.worldScene, this.physics, this.interactables);
    this.envelopeStation = new EnvelopeStampStation(this.worldScene, this.physics, this.interactables);

    // Mail sorting box system
    this.mailBagSystem = new SortingBoxSystem(this.worldScene, this.physics, this.interactables);
    this.mailSortingSystem = new MailSortingSystem(
      this.mailBagSystem, this.interactables, this.physics, this.envelopeSystem.envelopeDataMap, this.hud
    );

    // Player controller
    this.playerController = new PlayerController(this.camera, this.renderer.domElement, this.hud, this.physics);

    // Pickup system
    this.pickupSystem = new PickupSystem(
      this.camera, this.worldScene, this.playerData, this.interactables, this.hud, this.physics, sceneData.floor
    );

    // Register stamp table top as a placement surface
    this.pickupSystem.addPlacementSurface(this.stampStation.tableTopMesh);
    this.pickupSystem.addPlacementSurface(this.envelopeStation.tableTopMesh);

    // Register sorting box interior planes as placement surfaces
    for (const plane of this.mailBagSystem.interiorPlanes.values()) {
      this.pickupSystem.addPlacementSurface(plane);
    }
    // Register incoming crate interior plane
    if (this.envelopeSystem.interiorPlane) {
      this.pickupSystem.addPlacementSurface(this.envelopeSystem.interiorPlane);
    }

    // Interaction system
    this.interactionSystem = new InteractionSystem(
      this.camera, this.interactables, this.playerData, this.pickupSystem, this.hud,
      () => this.playerController.isLocked,
      this.stampStation,
      () => this.startStampMinigame(),
      this.envelopeSystem,
      this.envelopeStation,
      () => this.startEnvelopeMinigame(),
      this.mailBagSystem
    );

    this.clock.start();
    this.loop();
  }

  private startStampMinigame(): void {
    if (!this.stampStation.readyPackageId) return;
    const obj = this.interactables.get(this.stampStation.readyPackageId);
    if (!obj || !obj.packageData) return;

    // Enter minigame state
    this.playerData.state = 'stamping-minigame';
    this.playerController.setInputEnabled(false);

    // Fix box on table
    if (obj.rigidBody) {
      obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.physics.setBodyEnabled(obj.rigidBody, false);
    }

    // Unlock pointer for minigame UI
    document.exitPointerLock();

    this.stampMinigame = new StampMinigame(obj.packageData, obj, (result: MinigameResult) => {
      this.endStampMinigame(obj, result);
    });
  }

  private endStampMinigame(obj: InteractableObject, _result: MinigameResult): void {
    if (this.stampMinigame) this.stampMinigame = null;

    // Restore package to world - fully interactable
    obj.mesh.visible = true;
    obj.canPickUp = true;
    obj.isHeld = false;

    // Re-enable physics
    if (obj.rigidBody) {
      obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.physics.setBodyEnabled(obj.rigidBody, true);
    }

    // Restore player state
    this.playerData.state = 'empty-handed';
    this.playerData.heldObjectId = null;
    this.playerController.setInputEnabled(true);

    // Player needs to re-lock pointer
    this.hud.showInstructions();
  }

  private startEnvelopeMinigame(): void {
    if (!this.envelopeStation.readyEnvelopeId) return;
    const obj = this.interactables.get(this.envelopeStation.readyEnvelopeId);
    if (!obj || !obj.packageData) return;

    this.playerData.state = 'stamping-minigame';
    this.playerController.setInputEnabled(false);

    if (obj.rigidBody) {
      obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.physics.setBodyEnabled(obj.rigidBody, false);
    }

    document.exitPointerLock();

    this.stampMinigame = new StampMinigame(obj.packageData, obj, (result: MinigameResult) => {
      this.endStampMinigame(obj, result);
    });
  }

  private loop(): void {
    requestAnimationFrame(() => this.loop());

    let deltaTime = this.clock.getDelta();
    if (deltaTime > SCENE_CONFIG.deltaTimeMax) deltaTime = SCENE_CONFIG.deltaTimeMax;

    // Skip game updates during minigame
    if (this.playerData.state !== 'stamping-minigame') {
      this.playerController.update(deltaTime);
      this.physics.update(deltaTime);

      // Sync box meshes to physics bodies
      for (const obj of this.interactables.values()) {
        if (!obj.isHeld && obj.rigidBody && obj.mesh.visible) {
          // For bottom-origin containers, offset Y by -height/2
          if (obj.mesh.userData.bottomOrigin || obj.mesh.userData.crateId) {
            const t = obj.rigidBody.translation();
            const r = obj.rigidBody.rotation();
            obj.mesh.position.set(t.x, t.y - obj.height / 2, t.z);
            obj.mesh.quaternion.set(r.x, r.y, r.z, r.w);
          } else {
            this.physics.syncMeshToBody(obj.mesh, obj.rigidBody);
          }
        }
      }

      this.interactionSystem.update();
      this.pickupSystem.update(deltaTime);
      this.stampStation.update(deltaTime);
      this.envelopeStation.update(deltaTime);
      this.mailSortingSystem.update(deltaTime);
    }

    // Render
    this.renderer.clear();
    this.renderer.render(this.worldScene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.pickupSystem.viewModelScene, this.pickupSystem.viewModelCamera);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.pickupSystem) this.pickupSystem.onResize();
  }
}
