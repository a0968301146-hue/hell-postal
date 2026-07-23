import * as THREE from 'three';
import { createLogisticsScene, SCENE_CONFIG } from './scene-manager';
import { PhysicsSystem } from './physics-system';
import { PlayerController } from './player-controller';
import { InteractionSystem } from './interaction-system';
import { PickupSystem } from './pickup-system';
import { HUD } from './hud';
import { createPlayerInteractionData, InteractableObject, PlayerInteractionData } from './interactable-object';
import { StampMinigame, MinigameResult } from './stamp-minigame';
import { EnvelopeSystem } from './envelope-system';
import { EnvelopeStampStation } from './envelope-stamp-station';
import { SortingBoxSystem } from './sorting-box-system';
import { MailSortingSystem } from './mail-sorting-system';
import { CargoSystem } from './cargo-system';
import { DollySystem } from './dolly-system';
import { VehicleControlSystem } from './vehicle-control-system';
import { CounterNpcSystem } from './counter-npc-system';
import { CounterServiceSystem } from './counter-service-system';
import { CompassUI } from './compass-ui';
import { PauseManager } from './pause-manager';
import { SettingsManager } from './settings-manager';
import { ManualUI } from './manual-ui';
import { ENABLE_LEGACY_COUNTER, ENABLE_LEGACY_MAIL_FLOW, ENABLE_VEHICLE_LOADING_FLOW, ENABLE_LEGACY_TEST_CARGO } from './feature-flags';
import { DailyFlowSystem, DailyState } from './daily-flow-system';
import { UnloadingSystem } from './unloading-system';
import { PalletSystem } from './pallet-system';
import { RollerRackSystem } from './roller-rack-system';

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
  private envelopeStation!: EnvelopeStampStation;
  private envelopeSystem!: EnvelopeSystem;
  private mailBagSystem!: SortingBoxSystem;
  private mailSortingSystem!: MailSortingSystem;
  private stampMinigame: StampMinigame | null = null;
  private cargoSystem!: CargoSystem;
  private dollySystem!: DollySystem;
  private vehicleControlSystem!: VehicleControlSystem;
  private counterNpcSystem!: CounterNpcSystem;
  private counterServiceSystem!: CounterServiceSystem;
  private compassUI!: CompassUI;
  private pauseManager!: PauseManager;
  private settingsManager!: SettingsManager;
  private dailyFlowSystem!: DailyFlowSystem;
  private unloadingSystem!: UnloadingSystem;
  private palletSystem!: PalletSystem;
  private rollerRackSystem!: RollerRackSystem;

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
    this.pauseManager = new PauseManager();
    this.settingsManager = new SettingsManager(this.camera, this.renderer);
    this.playerData = createPlayerInteractionData();
    const sceneData = createLogisticsScene(this.worldScene, this.physics);
    this.interactables = sceneData.interactables;

    // Envelope system + station — disabled this round (spec "每日貨品清空
    // 核心流程" section 三: envelope work equipment must not appear in the
    // main scene), classes kept intact via feature-flags.ts ENABLE_LEGACY_MAIL_FLOW.
    this.envelopeSystem = new EnvelopeSystem(this.worldScene, this.physics, this.interactables, ENABLE_LEGACY_MAIL_FLOW);
    this.envelopeStation = new EnvelopeStampStation(this.worldScene, this.physics, this.interactables, ENABLE_LEGACY_MAIL_FLOW);

    // Mail sorting box system — same flag
    this.mailBagSystem = new SortingBoxSystem(this.worldScene, this.physics, this.interactables, ENABLE_LEGACY_MAIL_FLOW);
    this.mailSortingSystem = new MailSortingSystem(
      this.mailBagSystem, this.interactables, this.physics, this.envelopeSystem.envelopeDataMap, this.hud,
      () => this.settingsManager.fireTutorialEvent('sorting')
    );

    // Normal cargo prototype (spawned before pickupSystem so surfaces below
    // register cleanly) — legacy test cargo (labeled/large/normal) is
    // disabled this round (spec 三/十四: "不要生成舊的測試包裹"); daily-flow
    // cargo spawns separately, on demand, via UnloadingSystem below.
    this.cargoSystem = new CargoSystem(this.worldScene, this.physics, this.interactables, ENABLE_LEGACY_TEST_CARGO);

    // Back-area flatbed dolly — pushable, not hand-carried (see dolly-system.ts)
    this.dollySystem = new DollySystem(this.worldScene, this.physics, this.interactables, this.cargoSystem);

    // ConveyorSystem is intentionally NOT constructed this round — the
    // cargo window + ramp it drove cargo along were part of the
    // front-office/dividing-wall structure removed entirely in the "刪除北
    // 邊房間" round (see scene-manager.ts). Its class file is kept for a
    // possible future round.

    // Counter NPC service prototype (front office) — disabled this round
    // (spec section 三: no NPC open-for-business button/queue in the main
    // scene), see feature-flags.ts ENABLE_LEGACY_COUNTER.
    this.counterNpcSystem = new CounterNpcSystem(this.worldScene);
    this.counterServiceSystem = new CounterServiceSystem(
      this.worldScene, this.physics, this.interactables, this.counterNpcSystem, this.hud, ENABLE_LEGACY_COUNTER
    );

    this.compassUI = new CompassUI();

    // Player controller
    this.playerController = new PlayerController(
      this.camera, this.renderer.domElement, this.hud, this.physics, this.playerData, this.settingsManager
    );

    // Pickup system
    this.pickupSystem = new PickupSystem(
      this.camera, this.worldScene, this.playerData, this.interactables, this.hud, this.physics, sceneData.floor,
      this.pauseManager, this.settingsManager
    );

    // Register the envelope stamp table top as a placement surface — only
    // exists when the legacy mail flow is enabled (tableTopMesh stays
    // unbuilt otherwise, see envelope-stamp-station.ts).
    if (ENABLE_LEGACY_MAIL_FLOW) {
      this.pickupSystem.addPlacementSurface(this.envelopeStation.tableTopMesh);
    }

    // Register the pier deck as an additional placement surface (the main
    // back-area floor is already PickupSystem's default surface, passed in
    // above as sceneData.floor) — a docked vehicle registers/deregisters
    // its own cargo bed surface as it comes and goes.
    this.pickupSystem.addPlacementSurface(sceneData.pierFloor);

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

    // Daily unload -> sort -> ship-via-vehicle loop (this round's core).
    // DailyFlowSystem owns the day/state/count bookkeeping and the 結束今天
    // button; UnloadingSystem owns the north gate/chute/spawn sequence and
    // the 開始卸貨 button; VehicleControlSystem (re-enabled this round —
    // spec "北側卸貨口/重新啟用呼叫載具" section 六) now also owns the
    // organized-cargo-into-cargoBounds shipment judgment. All three report
    // into DailyFlowSystem rather than it reaching into them. Constructed
    // BEFORE VehicleControlSystem/UnloadingSystem since both need it.
    this.dailyFlowSystem = new DailyFlowSystem(
      this.worldScene, this.physics, this.cargoSystem, this.hud,
      () => { this.dollySystem.resetToStart(); this.unloadingSystem.resetGate(); this.palletSystem.resetToStart(); },
      () => this.settingsManager.fireTutorialEvent('dayCompleted')
    );

    // Vehicle spawn/depart control (hall center) — re-enabled this round
    // (see feature-flags.ts ENABLE_VEHICLE_LOADING_FLOW). Needs
    // pickupSystem to register/deregister the cargo bed surface as vehicles
    // come and go, and dailyFlowSystem to gate 呼叫/出發 on today's
    // unload/shipment progress instead of the old always-available rule.
    this.vehicleControlSystem = new VehicleControlSystem(
      this.worldScene, this.physics, this.interactables, this.cargoSystem, this.pickupSystem, this.hud,
      this.dailyFlowSystem,
      (paused) => this.setPaused(paused),
      (config) => this.settingsManager.markVehicleDiscovered(config.id),
      () => this.settingsManager.fireTutorialEvent('vehicleCalled'),
      () => this.settingsManager.fireTutorialEvent('cargoLoaded'),
      () => this.settingsManager.fireTutorialEvent('vehicleDeparted'),
      ENABLE_VEHICLE_LOADING_FLOW
    );

    this.unloadingSystem = new UnloadingSystem(
      this.worldScene, this.physics, this.cargoSystem, this.dailyFlowSystem,
      () => {
        this.settingsManager.fireTutorialEvent('unloadingStarted');
        // Cargo carries its category label the moment it bursts into the
        // room, so "辨識貨品種類" unlocks alongside "啟動北側卸貨口" rather
        // than needing a separate dedicated trigger.
        this.settingsManager.fireTutorialEvent('cargoLabelSeen');
      }
    );
    this.palletSystem = new PalletSystem(
      this.worldScene, this.physics, this.cargoSystem, this.interactables, this.hud,
      () => this.settingsManager.fireTutorialEvent('palletUsed'),
      () => this.settingsManager.fireTutorialEvent('boxOrganized')
    );
    // Still registered as a normal PickupSystem placement surface — a
    // single cargo item can still be manually placed onto the pallet's top
    // the normal way (spec: this round only adds the ABILITY to also pick
    // up the whole pallet, it doesn't remove normal single-item placement).
    this.pickupSystem.addPlacementSurface(this.palletSystem.topMesh);
    this.rollerRackSystem = new RollerRackSystem(
      this.worldScene, this.physics, this.cargoSystem, this.interactables,
      () => this.settingsManager.fireTutorialEvent('rollerOrganized')
    );
    // OutboundZoneSystem is intentionally NOT constructed this round — cargo
    // now ships by riding along with a vehicle instead of walking into a
    // ground zone (spec section 八/九). Its file is kept for a possible
    // future round; see feature-flags.ts and outbound-zone-system.ts.

    // Interaction system
    this.interactionSystem = new InteractionSystem(
      this.camera, this.interactables, this.playerData, this.pickupSystem, this.hud,
      () => this.playerController.isLocked,
      this.envelopeSystem,
      this.envelopeStation,
      () => this.startEnvelopeMinigame(),
      this.mailBagSystem,
      this.vehicleControlSystem,
      this.counterServiceSystem,
      this.dollySystem,
      this.pauseManager,
      this.settingsManager,
      this.unloadingSystem,
      this.dailyFlowSystem,
      this.palletSystem,
      () => this.settingsManager.fireTutorialEvent('dollyUsed')
    );

    // 異世界物流手冊 — pause menu / tutorial / settings / codex (spec round).
    // Not stored on the instance: nothing else in Game needs to reference
    // it after construction (it manages its own DOM/listeners internally).
    new ManualUI(this.pauseManager, this.settingsManager, this.hud, () => this.interruptPlayerActions());

    this.clock.start();
    this.loop();
  }

  /** HUD display text for DailyFlowSystem.state (spec section 十八's exact
   * 7 labels, plus a 'resetting' fallback — resetting is synchronous/
   * instantaneous in practice, so it's essentially never visible, but
   * mapped for completeness). */
  private dailyStateLabel(state: DailyState): string {
    switch (state) {
      case 'ready': return '準備卸貨';
      case 'unloading': return '卸貨中';
      case 'sorting': return '整理貨物';
      case 'loading': return '裝載貨物';
      case 'completed': return '今日貨物已全部裝載';
      case 'departing': return '載具出發中';
      case 'dayComplete': return '今日貨物已全部送出';
      case 'resetting': return '準備中...';
    }
  }

  /** Called when the manual opens, so a mid-hold/mid-placement/mid-push
   * action doesn't sit frozen-but-still-technically-active behind the book
   * (spec 二: "玩家停止目前操作"). Each call is self-guarding (no-op if that
   * state isn't currently active), so it's safe to call unconditionally. */
  private interruptPlayerActions(): void {
    if (this.playerData.state === 'placement-preview') this.pickupSystem.cancelPlacement();
    if (this.playerData.state === 'holding-item') this.pickupSystem.forceDropHeld();
    if (this.playerData.state === 'pushing-dolly') {
      this.dollySystem.stopPush();
      this.playerData.state = 'empty-handed';
    }
  }

  private endStampMinigame(obj: InteractableObject, _result: MinigameResult): void {
    if (this.stampMinigame) this.stampMinigame = null;
    this.pauseManager.remove('stampMinigame');

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

    this.settingsManager.fireTutorialEvent('stamp');

    this.playerData.state = 'stamping-minigame';
    this.pauseManager.add('stampMinigame');
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
      this.pauseManager.add('settlement');
      this.playerController.setInputEnabled(false);
      document.exitPointerLock();
    } else {
      this.playerData.state = 'empty-handed';
      this.playerData.heldObjectId = null;
      this.pauseManager.remove('settlement');
      this.playerController.setInputEnabled(true);
      this.hud.showInstructions();
    }
  }

  private loop(): void {
    requestAnimationFrame(() => this.loop());

    let deltaTime = this.clock.getDelta();
    if (deltaTime > SCENE_CONFIG.deltaTimeMax) deltaTime = SCENE_CONFIG.deltaTimeMax;

    // Skip game updates while ANY pause reason is active (minigame,
    // settlement, or the manual) — see pause-manager.ts.
    if (!this.pauseManager.isPaused) {
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
      if (ENABLE_LEGACY_MAIL_FLOW) {
        this.envelopeStation.update(deltaTime);
        this.mailSortingSystem.update(deltaTime);
      }
      if (ENABLE_VEHICLE_LOADING_FLOW) this.vehicleControlSystem.update(deltaTime);
      const cameraForward = new THREE.Vector3();
      this.camera.getWorldDirection(cameraForward);
      if (this.dollySystem.isPushing) {
        this.dollySystem.update(this.camera.position, cameraForward);
      }
      this.palletSystem.update(deltaTime, this.camera.position, cameraForward);
      if (ENABLE_LEGACY_COUNTER) {
        this.counterNpcSystem.update(deltaTime);
        this.counterServiceSystem.update(deltaTime);
      }

      // Daily unload -> sort -> ship-via-vehicle loop (paused alongside
      // everything else above while the manual/settlement/minigame is open).
      // vehicleControlSystem.update() above already runs the organized-
      // cargo-into-cargoBounds shipment scan every frame it's enabled.
      this.unloadingSystem.update(deltaTime);
      this.rollerRackSystem.update(deltaTime);
      const flowState = this.dailyFlowSystem.state;
      const bannerText = flowState === 'completed' ? '今日貨物已全部裝載'
        : flowState === 'dayComplete' ? '今日貨物已全部送出'
        : null;
      this.hud.updateDailyFlow({
        day: this.dailyFlowSystem.currentDay,
        stateLabel: this.dailyStateLabel(flowState),
        total: this.dailyFlowSystem.totalCargoCount,
        unorganized: this.dailyFlowSystem.unorganizedCount,
        organized: this.dailyFlowSystem.organizedCount,
        remaining: this.dailyFlowSystem.remainingCargoCount,
        loaded: this.dailyFlowSystem.completedCargoCount,
        bannerText,
      });
    }

    this.compassUI.update(this.camera);

    // Render
    this.renderer.clear();
    this.renderer.render(this.worldScene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.pickupSystem.viewModelScene, this.pickupSystem.viewModelCamera);
  }

  private onResize(): void {
    // Delegates to SettingsManager once it exists — a FIXED resolution
    // preset (spec 八) deliberately does NOT track window resizes, only
    // 'native' does. Falls back to the old always-track-window behavior
    // during the brief window before start() has run.
    if (this.settingsManager) {
      this.settingsManager.onWindowResize();
    } else {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    if (this.pickupSystem) this.pickupSystem.onResize();
  }
}
