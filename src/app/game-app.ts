import * as THREE from 'three';
import { GameContext, createGameContext } from './game-context';
import { GameLoop } from './game-loop';
import { DisposeManager } from '../core/dispose-manager';
import { InteractableObject } from '../shared/types/interactable';
import { SCENE_CONFIG } from '../game/scene-manager';
import { PlayerController } from '../game/player-controller';
import { InteractionSystem } from '../game/interaction-system';
import { PickupSystem } from '../game/pickup-system';
import { StampMinigame, MinigameResult } from '../game/stamp-minigame';
import { EnvelopeSystem } from '../game/envelope-system';
import { EnvelopeStampStation } from '../game/envelope-stamp-station';
import { SortingBoxSystem } from '../game/sorting-box-system';
import { MailSortingSystem } from '../game/mail-sorting-system';
import { CargoSystem } from '../game/cargo-system';
import { DollySystem } from '../game/dolly-system';
import { VehicleControlSystem } from '../game/vehicle-control-system';
import { CounterNpcSystem } from '../game/counter-npc-system';
import { CounterServiceSystem } from '../game/counter-service-system';
import { CompassUI } from '../game/compass-ui';
import { ManualUI } from '../game/manual-ui';
import { ENABLE_LEGACY_COUNTER, ENABLE_LEGACY_MAIL_FLOW, ENABLE_VEHICLE_LOADING_FLOW, ENABLE_LEGACY_TEST_CARGO } from '../game/feature-flags';
import { DailyFlowSystem, DailyState } from '../game/daily-flow-system';
import { UnloadingSystem } from '../game/unloading-system';
import { PalletSystem } from '../game/pallet-system';
import { RollerRackSystem } from '../game/roller-rack-system';
import { CargoInspectionSystem } from '../game/cargo-inspection-system';
import { CargoInspectionUI } from '../game/cargo-inspection-ui';
import { LostFoundSystem } from '../game/lost-found-system';
import { LostFoundUI } from '../game/lost-found-ui';

/**
 * The app's top-level composition root (formerly `Game` in game/game.ts) —
 * builds the engine context, constructs every system, wires their
 * dependencies/callbacks, starts the frame loop, and disposes on shutdown.
 * Deliberately does NOT contain player-movement details, cargo-spawn loops,
 * vehicle judgment, daily-flow conditions, DOM UI construction, or lost-found
 * NPC logic itself — those all live in their own systems; this file only
 * wires them together (spec九).
 */
export class GameApp {
  private context!: GameContext;
  private gameLoop!: GameLoop;
  private disposeManager = new DisposeManager();

  private playerController!: PlayerController;
  private interactionSystem!: InteractionSystem;
  private pickupSystem!: PickupSystem;
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
  private dailyFlowSystem!: DailyFlowSystem;
  private unloadingSystem!: UnloadingSystem;
  private palletSystem!: PalletSystem;
  private rollerRackSystem!: RollerRackSystem;
  private cargoInspectionSystem!: CargoInspectionSystem;
  private cargoInspectionUI!: CargoInspectionUI;
  private lostFoundSystem!: LostFoundSystem;
  private lostFoundUI!: LostFoundUI;

  async start(): Promise<void> {
    this.context = await createGameContext();
    const { scene, camera, physics, hud, pauseManager, settingsManager, playerData, interactables, sceneData } = this.context;

    // Envelope system + station — disabled this round (spec "每日貨品清空
    // 核心流程" section 三: envelope work equipment must not appear in the
    // main scene), classes kept intact via feature-flags.ts ENABLE_LEGACY_MAIL_FLOW.
    this.envelopeSystem = new EnvelopeSystem(scene, physics, interactables, ENABLE_LEGACY_MAIL_FLOW);
    this.envelopeStation = new EnvelopeStampStation(scene, physics, interactables, ENABLE_LEGACY_MAIL_FLOW);

    // Mail sorting box system — same flag
    this.mailBagSystem = new SortingBoxSystem(scene, physics, interactables, ENABLE_LEGACY_MAIL_FLOW);
    this.mailSortingSystem = new MailSortingSystem(
      this.mailBagSystem, interactables, physics, this.envelopeSystem.envelopeDataMap, hud,
      () => settingsManager.fireTutorialEvent('sorting')
    );

    // Normal cargo prototype (spawned before pickupSystem so surfaces below
    // register cleanly) — legacy test cargo (labeled/large/normal) is
    // disabled this round (spec 三/十四: "不要生成舊的測試包裹"); daily-flow
    // cargo spawns separately, on demand, via UnloadingSystem below.
    this.cargoSystem = new CargoSystem(scene, physics, interactables, ENABLE_LEGACY_TEST_CARGO);

    // Back-area flatbed dolly — pushable, not hand-carried (see dolly-system.ts)
    this.dollySystem = new DollySystem(scene, physics, interactables, this.cargoSystem);

    // ConveyorSystem is intentionally NOT constructed this round — the
    // cargo window + ramp it drove cargo along were part of the
    // front-office/dividing-wall structure removed entirely in the "刪除北
    // 邊房間" round (see scene-manager.ts). Its class file is kept for a
    // possible future round.

    // Counter NPC service prototype (front office) — disabled this round
    // (spec section 三: no NPC open-for-business button/queue in the main
    // scene), see feature-flags.ts ENABLE_LEGACY_COUNTER.
    this.counterNpcSystem = new CounterNpcSystem(scene);
    this.counterServiceSystem = new CounterServiceSystem(
      scene, physics, interactables, this.counterNpcSystem, hud, ENABLE_LEGACY_COUNTER
    );

    this.compassUI = new CompassUI();

    // Player controller
    this.playerController = new PlayerController(
      camera, this.context.renderer.domElement, hud, physics, playerData, settingsManager
    );

    // Pickup system
    this.pickupSystem = new PickupSystem(
      camera, scene, playerData, interactables, hud, physics, sceneData.floor,
      pauseManager, settingsManager
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

    // Register the lost-found room's own floor (a separate mesh from the
    // main back-area floor) as a placement surface, so items can be
    // dropped/placed while standing in it ("Reduce daily cargo and add
    // lost found desk" round 二).
    this.pickupSystem.addPlacementSurface(sceneData.lostFoundFloor);

    // West-side lost & found desk — minimal one-case flow (spec三). Built
    // after pickupSystem exists (tryConfirmAtCounter consumes the held item
    // via pickupSystem.forceDropHeld() on success).
    this.lostFoundUI = new LostFoundUI();
    this.lostFoundSystem = new LostFoundSystem(
      scene, physics, interactables, this.pickupSystem, this.lostFoundUI
    );

    // Daily unload -> sort -> ship-via-vehicle loop (this round's core).
    // DailyFlowSystem owns the day/state/count bookkeeping and the 結束今天
    // button; UnloadingSystem owns the north gate/chute/spawn sequence and
    // the 開始卸貨 button; VehicleControlSystem (re-enabled this round —
    // spec "北側卸貨口/重新啟用呼叫載具" section 六) now also owns the
    // organized-cargo-into-cargoBounds shipment judgment. All three report
    // into DailyFlowSystem rather than it reaching into them. Constructed
    // BEFORE VehicleControlSystem/UnloadingSystem since both need it.
    this.dailyFlowSystem = new DailyFlowSystem(
      scene, physics, this.cargoSystem, hud,
      () => {
        this.dollySystem.resetToStart(); this.unloadingSystem.resetGate(); this.palletSystem.resetToStart();
        this.lostFoundSystem.resetDaily();
      },
      () => settingsManager.fireTutorialEvent('dayCompleted'),
      () => this.lostFoundSystem.onAllVehiclesDeparted()
    );

    // Vehicle spawn/depart control (hall center) — re-enabled this round
    // (see feature-flags.ts ENABLE_VEHICLE_LOADING_FLOW). Needs
    // pickupSystem to register/deregister the cargo bed surface as vehicles
    // come and go, and dailyFlowSystem to gate 呼叫/出發 on today's
    // unload/shipment progress instead of the old always-available rule.
    this.vehicleControlSystem = new VehicleControlSystem(
      scene, physics, interactables, this.cargoSystem, this.pickupSystem, hud,
      this.dailyFlowSystem,
      settingsManager,
      (paused) => this.setPaused(paused),
      (config) => settingsManager.markVehicleDiscovered(config.id),
      () => settingsManager.fireTutorialEvent('vehicleCalled'),
      () => settingsManager.fireTutorialEvent('cargoLoaded'),
      () => settingsManager.fireTutorialEvent('vehicleDeparted'),
      ENABLE_VEHICLE_LOADING_FLOW
    );

    this.unloadingSystem = new UnloadingSystem(
      scene, physics, this.cargoSystem, this.dailyFlowSystem,
      () => {
        settingsManager.fireTutorialEvent('unloadingStarted');
        // Cargo carries its category label the moment it bursts into the
        // room, so "辨識貨品種類" unlocks alongside "啟動北側卸貨口" rather
        // than needing a separate dedicated trigger.
        settingsManager.fireTutorialEvent('cargoLabelSeen');
        // "Expand modular lost found NPC flow" round 六: today's lost item
        // bursts in alongside the regular cargo — picks today's case and
        // arms its own short spawn delay. UnloadingSystem itself is never
        // touched for this (spec: 不要修改北側雙到貨口).
        this.lostFoundSystem.onDailyUnloadStarted();
      }
    );
    this.palletSystem = new PalletSystem(
      scene, physics, this.cargoSystem, interactables, playerData, hud,
      () => settingsManager.fireTutorialEvent('palletUsed'),
      () => settingsManager.fireTutorialEvent('boxOrganized')
    );
    // Still registered as a normal PickupSystem placement surface — a
    // single cargo item can still be manually placed onto the pallet's top
    // the normal way (spec: this round only adds the ABILITY to also pick
    // up the whole pallet, it doesn't remove normal single-item placement).
    this.pickupSystem.addPlacementSurface(this.palletSystem.topMesh);
    this.rollerRackSystem = new RollerRackSystem(
      scene, physics, this.cargoSystem, interactables,
      () => settingsManager.fireTutorialEvent('rollerOrganized')
    );
    // OutboundZoneSystem is intentionally NOT constructed this round — cargo
    // now ships by riding along with a vehicle instead of walking into a
    // ground zone (spec section 八/九). Its file is kept for a possible
    // future round; see feature-flags.ts and outbound-zone-system.ts.

    // 貨物種類準心檢視 UI — read-only crosshair inspection, entirely separate
    // from pickup/interaction. See cargo-inspection-system.ts/
    // cargo-inspection-ui.ts for the actual logic; GameApp only constructs
    // and updates them.
    this.cargoInspectionSystem = new CargoInspectionSystem(camera, scene, this.cargoSystem, pauseManager);
    this.cargoInspectionUI = new CargoInspectionUI();

    // Interaction system
    this.interactionSystem = new InteractionSystem(
      camera, interactables, playerData, this.pickupSystem, hud,
      () => this.playerController.isLocked,
      this.envelopeSystem,
      this.envelopeStation,
      () => this.startEnvelopeMinigame(),
      this.mailBagSystem,
      this.vehicleControlSystem,
      this.counterServiceSystem,
      this.dollySystem,
      pauseManager,
      settingsManager,
      this.unloadingSystem,
      this.dailyFlowSystem,
      this.palletSystem,
      this.lostFoundSystem,
      () => settingsManager.fireTutorialEvent('dollyUsed')
    );

    // 異世界物流手冊 — pause menu / tutorial / settings / codex (spec round).
    // Not stored on the instance: nothing else in GameApp needs to reference
    // it after construction (it manages its own DOM/listeners internally).
    new ManualUI(pauseManager, settingsManager, hud, () => this.interruptPlayerActions());

    this.disposeManager.addEventListener(window, 'resize', () => this.onResize());

    this.gameLoop = new GameLoop(SCENE_CONFIG.deltaTimeMax, (deltaTime) => this.update(deltaTime));
    this.gameLoop.start();
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
    const playerData = this.context.playerData;
    if (playerData.state === 'placement-preview') this.pickupSystem.cancelPlacement();
    // The sorting pallet was NEVER handed to PickupSystem (it uses its own
    // world-space carry flow — see pallet-system.ts), so calling
    // forceDropHeld() while holding it would silently clear the SHARED
    // playerData.state/heldObjectId back to empty-handed while
    // PalletSystem.isHeld stays internally true and its pinned cargo stays
    // suspended — an orphaned hold the player could never recover from via
    // the normal E-key flow. Opening the manual must leave a pallet hold
    // completely untouched instead (spec: "Esc 只開關手冊時，不應破壞托盤
    // 手持狀態") — PauseManager already freezes palletSystem.update() from
    // running while paused, so it just stays frozen in place and resumes
    // normally once the manual closes.
    if (playerData.state === 'holding-item' && playerData.heldObjectId !== this.palletSystem.palletId) {
      this.pickupSystem.forceDropHeld();
    }
    if (playerData.state === 'pushing-dolly') {
      this.dollySystem.stopPush();
      playerData.state = 'empty-handed';
    }
  }

  private endStampMinigame(obj: InteractableObject, _result: MinigameResult): void {
    if (this.stampMinigame) this.stampMinigame = null;
    this.context.pauseManager.remove('stampMinigame');

    // Restore package to world - fully interactable
    obj.mesh.visible = true;
    obj.canPickUp = true;
    obj.isHeld = false;

    // Re-enable physics
    if (obj.rigidBody) {
      obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.context.physics.setBodyEnabled(obj.rigidBody, true);
    }

    // Restore player state
    this.context.playerData.state = 'empty-handed';
    this.context.playerData.heldObjectId = null;
    this.playerController.setInputEnabled(true);

    // Player needs to re-lock pointer
    this.context.hud.showInstructions();
  }

  private startEnvelopeMinigame(): void {
    if (!this.envelopeStation.readyEnvelopeId) return;
    const obj = this.context.interactables.get(this.envelopeStation.readyEnvelopeId);
    if (!obj || !obj.packageData) return;

    this.context.settingsManager.fireTutorialEvent('stamp');

    this.context.playerData.state = 'stamping-minigame';
    this.context.pauseManager.add('stampMinigame');
    this.playerController.setInputEnabled(false);

    if (obj.rigidBody) {
      obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.context.physics.setBodyEnabled(obj.rigidBody, false);
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
    const playerData = this.context.playerData;
    if (paused) {
      playerData.state = 'vehicle-settlement';
      this.context.pauseManager.add('settlement');
      this.playerController.setInputEnabled(false);
      document.exitPointerLock();
    } else {
      playerData.state = 'empty-handed';
      playerData.heldObjectId = null;
      this.context.pauseManager.remove('settlement');
      this.playerController.setInputEnabled(true);
      this.context.hud.showInstructions();
    }
  }

  private update(deltaTime: number): void {
    const { scene, camera, renderer, physics, pauseManager, interactables, hud } = this.context;

    // Skip game updates while ANY pause reason is active (minigame,
    // settlement, or the manual) — see core/pause-manager.ts.
    if (!pauseManager.isPaused) {
      this.playerController.update(deltaTime);
      physics.update(deltaTime);

      // Sync box meshes to physics bodies (skip disabled bodies — e.g. cargo
      // that has been pinned for departure and is being manually animated
      // by VehicleControlSystem's departure sequence instead)
      for (const obj of interactables.values()) {
        if (!obj.isHeld && obj.rigidBody && obj.mesh.visible && obj.rigidBody.isEnabled()) {
          // For bottom-origin containers, offset Y by -height/2
          if (obj.mesh.userData.bottomOrigin || obj.mesh.userData.crateId) {
            const t = obj.rigidBody.translation();
            const r = obj.rigidBody.rotation();
            obj.mesh.position.set(t.x, t.y - obj.height / 2, t.z);
            obj.mesh.quaternion.set(r.x, r.y, r.z, r.w);
          } else {
            physics.syncMeshToBody(obj.mesh, obj.rigidBody);
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
      camera.getWorldDirection(cameraForward);
      if (this.dollySystem.isPushing) {
        this.dollySystem.update(camera.position, cameraForward);
      }
      this.palletSystem.update(deltaTime, camera.position, cameraForward);
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
      this.lostFoundSystem.update(deltaTime);
      const flowState = this.dailyFlowSystem.state;
      const bannerText = flowState === 'completed' ? '今日貨物已全部裝載'
        : flowState === 'dayComplete' ? '今日貨物已全部送出'
        : null;
      hud.updateDailyFlow({
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

    this.compassUI.update(camera);

    // Runs unconditionally (not inside the isPaused block above) so a
    // pause takes effect on the UI the SAME frame it begins — the system
    // itself checks pauseManager.isPaused internally and reports no target
    // while paused, rather than leaving a stale target from the frame
    // before pause.
    this.cargoInspectionSystem.update();
    const inspectedCargo = this.cargoInspectionSystem.currentCargo;
    if (inspectedCargo?.category && inspectedCargo.region) {
      this.cargoInspectionUI.show(inspectedCargo.category, inspectedCargo.region);
    } else {
      this.cargoInspectionUI.hide();
    }

    // Render
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(this.pickupSystem.viewModelScene, this.pickupSystem.viewModelCamera);
  }

  private onResize(): void {
    // Delegates to SettingsManager — a FIXED resolution preset (spec 八)
    // deliberately does NOT track window resizes, only 'native' does.
    this.context.settingsManager.onWindowResize();
    this.pickupSystem?.onResize();
  }

  /** Tears down the frame loop, the event bus, and every listener this file
   * itself registered (spec十: "每個事件監聽都必須可dispose"). Individual
   * systems' own THREE/Rapier resources are each system's own
   * responsibility to release, unchanged from before this refactor. */
  dispose(): void {
    this.gameLoop?.stop();
    this.disposeManager.dispose();
    this.context?.events.dispose();
  }
}
