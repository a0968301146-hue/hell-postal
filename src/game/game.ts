import * as THREE from 'three';
import { createLogisticsScene, SCENE_CONFIG } from './scene-manager';
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
import { CargoSystem } from './cargo-system';
import { DollySystem } from './dolly-system';
import { VehicleControlSystem } from './vehicle-control-system';
import { ConveyorSystem } from './conveyor-system';
import { CounterNpcSystem } from './counter-npc-system';
import { CounterServiceSystem } from './counter-service-system';
import { CompassUI } from './compass-ui';

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
  private cargoSystem!: CargoSystem;
  private dollySystem!: DollySystem;
  private vehicleControlSystem!: VehicleControlSystem;
  private conveyorSystem!: ConveyorSystem;
  private counterNpcSystem!: CounterNpcSystem;
  private counterServiceSystem!: CounterServiceSystem;
  private compassUI!: CompassUI;

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
    const sceneData = createLogisticsScene(this.worldScene, this.physics);
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

    // Normal cargo prototype (spawned before pickupSystem so surfaces below register cleanly)
    this.cargoSystem = new CargoSystem(this.worldScene, this.physics, this.interactables);

    // Back-area flatbed dolly — pushable, not hand-carried (see dolly-system.ts)
    this.dollySystem = new DollySystem(this.worldScene, this.physics, this.interactables, this.cargoSystem);

    // Conveyor belt: drives cargo down the ramp from the window to the back area
    this.conveyorSystem = new ConveyorSystem(
      this.interactables, sceneData.ramp.topPos, sceneData.ramp.bottomPos, sceneData.ramp.width,
      sceneData.ramp.mesh.userData.conveyorTexture ?? null
    );

    // Counter NPC service prototype (front office)
    this.counterNpcSystem = new CounterNpcSystem(this.worldScene);
    this.counterServiceSystem = new CounterServiceSystem(
      this.worldScene, this.physics, this.interactables, this.counterNpcSystem, this.hud
    );

    this.compassUI = new CompassUI();

    // Player controller
    this.playerController = new PlayerController(this.camera, this.renderer.domElement, this.hud, this.physics, this.playerData);

    // Pickup system
    this.pickupSystem = new PickupSystem(
      this.camera, this.worldScene, this.playerData, this.interactables, this.hud, this.physics, sceneData.floor
    );

    // Register stamp table top as a placement surface
    this.pickupSystem.addPlacementSurface(this.stampStation.tableTopMesh);
    this.pickupSystem.addPlacementSurface(this.envelopeStation.tableTopMesh);

    // Register the back-area floor, pier deck and the conveyor ramp itself
    // (so players can precisely place cargo onto its high end, not just
    // throw it through the window) — a docked vehicle registers/deregisters
    // its own cargo bed surface as it comes and goes.
    this.pickupSystem.addPlacementSurface(sceneData.backFloor);
    this.pickupSystem.addPlacementSurface(sceneData.pierFloor);
    this.pickupSystem.addPlacementSurface(sceneData.ramp.mesh);

    // Register sorting box interior planes as placement surfaces
    for (const plane of this.mailBagSystem.interiorPlanes.values()) {
      this.pickupSystem.addPlacementSurface(plane);
    }
    // Register incoming crate interior plane
    if (this.envelopeSystem.interiorPlane) {
      this.pickupSystem.addPlacementSurface(this.envelopeSystem.interiorPlane);
    }
    // Register the dolly's platform top as a placement surface — lets
    // players precisely place cargo onto it without pushing it around
    this.pickupSystem.addPlacementSurface(this.dollySystem.platformTopMesh);

    // Vehicle spawn/depart control (hall center) — needs pickupSystem to
    // register/deregister the cargo bed surface as vehicles come and go
    this.vehicleControlSystem = new VehicleControlSystem(
      this.worldScene, this.physics, this.interactables, this.cargoSystem, this.pickupSystem, this.hud,
      (paused) => this.setPaused(paused)
    );

    // Interaction system
    this.interactionSystem = new InteractionSystem(
      this.camera, this.interactables, this.playerData, this.pickupSystem, this.hud,
      () => this.playerController.isLocked,
      this.stampStation,
      () => this.startStampMinigame(),
      this.envelopeSystem,
      this.envelopeStation,
      () => this.startEnvelopeMinigame(),
      this.mailBagSystem,
      this.vehicleControlSystem,
      this.counterServiceSystem,
      this.dollySystem
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

  /** Vehicle settlement pause — mirrors the stamp-minigame pattern: exit
   * pointer lock (stops mouse-look, frees the cursor for the settlement
   * panel's button) and gate the whole per-frame update block below via
   * playerData.state, which also naturally blocks pickup/placement/throw
   * and every station's E-key interaction. */
  private setPaused(paused: boolean): void {
    if (paused) {
      this.playerData.state = 'vehicle-settlement';
      this.playerController.setInputEnabled(false);
      document.exitPointerLock();
    } else {
      this.playerData.state = 'empty-handed';
      this.playerData.heldObjectId = null;
      this.playerController.setInputEnabled(true);
      this.hud.showInstructions();
    }
  }

  private loop(): void {
    requestAnimationFrame(() => this.loop());

    let deltaTime = this.clock.getDelta();
    if (deltaTime > SCENE_CONFIG.deltaTimeMax) deltaTime = SCENE_CONFIG.deltaTimeMax;

    // Skip game updates during a minigame or a vehicle-settlement pause
    if (this.playerData.state !== 'stamping-minigame' && this.playerData.state !== 'vehicle-settlement') {
      this.playerController.update(deltaTime);
      this.physics.update(deltaTime);

      // Sync box meshes to physics bodies (skip disabled bodies — e.g. cargo
      // that has been pinned for departure and is being manually animated
      // by VehicleControlSystem's departure sequence instead)
      for (const obj of this.interactables.values()) {
        if (!obj.isHeld && obj.rigidBody && obj.mesh.visible && obj.rigidBody.isEnabled()) {
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
      this.vehicleControlSystem.update(deltaTime);
      if (this.dollySystem.isPushing) {
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        this.dollySystem.update(this.camera.position, forward);
      }
      this.conveyorSystem.update(deltaTime);
      this.counterNpcSystem.update(deltaTime);
      this.counterServiceSystem.update(deltaTime);
    }

    this.compassUI.update(this.camera);

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
