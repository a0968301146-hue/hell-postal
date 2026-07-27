import * as THREE from 'three';
import { GameContext, createGameContext } from './game-context';
import { GameLoop } from './game-loop';
import { createGameSystems, GameSystems } from './create-game-systems';
import { DisposeManager } from '../core/dispose-manager';
import { InteractableObject } from '../shared/types/interactable';
import { SCENE_CONFIG } from '../systems/world-layout';
import { StampMinigame, MinigameResult } from '../game/stamp-minigame';
import { ENABLE_LEGACY_COUNTER, ENABLE_LEGACY_MAIL_FLOW, ENABLE_VEHICLE_LOADING_FLOW } from '../game/feature-flags';
import { DailyState } from '../systems/daily-flow';
import { StampTableUi, StampUiResult } from '../systems/mail/stamp-table-ui';

/**
 * The app's top-level composition root (formerly `Game` in game/game.ts) —
 * builds the engine context, assembles every system via createGameSystems()
 * (app/create-game-systems.ts), starts the frame loop, and disposes on
 * shutdown. Deliberately does NOT contain player-movement details,
 * cargo-spawn loops, vehicle judgment, daily-flow conditions, DOM UI
 * construction, or lost-found NPC logic itself — those all live in their
 * own systems; this file only owns engine/scene lifecycle, the per-frame
 * update dispatch, and a handful of small cross-system orchestration
 * callbacks (pause, minigame start/end, interrupt-on-manual-open) that need
 * to reach into more than one system at once (spec九).
 */
export class GameApp {
  private context!: GameContext;
  private systems!: GameSystems;
  private gameLoop!: GameLoop;
  private disposeManager = new DisposeManager();
  private stampMinigame: StampMinigame | null = null;
  private mailStampUi: StampTableUi | null = null;

  async start(): Promise<void> {
    this.context = await createGameContext();

    this.systems = createGameSystems(this.context, {
      onPauseChange: (paused) => this.setPaused(paused),
      onStartEnvelopeMinigame: () => this.startEnvelopeMinigame(),
      onInterruptPlayerActions: () => this.interruptPlayerActions(),
      onStartMailStampUi: () => this.startMailStampUi(),
    });

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
    if (playerData.state === 'placement-preview') this.systems.pickupSystem.cancelPlacement();
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
    if (playerData.state === 'holding-item' && playerData.heldObjectId !== this.systems.palletSystem.palletId) {
      this.systems.pickupSystem.forceDropHeld();
    }
    if (playerData.state === 'pushing-dolly') {
      this.systems.dollySystem.stopPush();
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
    this.systems.playerController.setInputEnabled(true);

    // Player needs to re-lock pointer
    this.context.hud.showInstructions();
  }

  private startEnvelopeMinigame(): void {
    const { envelopeStation } = this.systems;
    if (!envelopeStation.readyEnvelopeId) return;
    const obj = this.context.interactables.get(envelopeStation.readyEnvelopeId);
    if (!obj || !obj.packageData) return;

    this.context.settingsManager.fireTutorialEvent('stamp');

    this.context.playerData.state = 'stamping-minigame';
    this.context.pauseManager.add('stampMinigame');
    this.systems.playerController.setInputEnabled(false);

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

  /** This round's own mail stamp-table UI — same shape as
   * startEnvelopeMinigame/endStampMinigame above (reuses PauseManager's
   * existing 'stampMinigame' reason and playerData's existing
   * 'stamping-minigame' state, spec: "使用現有PauseManager"), but reads
   * MailSystem's envelope registry instead of the old PackageData-based
   * one, and applies the stamp via MailSystem.applyStamp on success. */
  private startMailStampUi(): void {
    const { mailSystem } = this.systems;
    const envelopeId = mailSystem.readyEnvelopeId;
    if (!envelopeId) return;
    const rec = mailSystem.getEnvelope(envelopeId);
    if (!rec) return;

    this.context.playerData.state = 'stamping-minigame';
    this.context.pauseManager.add('stampMinigame');
    this.systems.playerController.setInputEnabled(false);
    document.exitPointerLock();

    this.mailStampUi = new StampTableUi(
      rec,
      (stamp) => this.systems.mailSystem.applyStamp(envelopeId, stamp),
      (result: StampUiResult) => this.endMailStampUi(result)
    );
  }

  private endMailStampUi(_result: StampUiResult): void {
    if (this.mailStampUi) this.mailStampUi = null;
    this.context.pauseManager.remove('stampMinigame');
    this.systems.mailSystem.releaseFromTable();

    this.context.playerData.state = 'empty-handed';
    this.context.playerData.heldObjectId = null;
    this.systems.playerController.setInputEnabled(true);
    this.context.hud.showInstructions();
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
      this.systems.playerController.setInputEnabled(false);
      document.exitPointerLock();
    } else {
      playerData.state = 'empty-handed';
      playerData.heldObjectId = null;
      this.context.pauseManager.remove('settlement');
      this.systems.playerController.setInputEnabled(true);
      this.context.hud.showInstructions();
    }
  }

  private update(deltaTime: number): void {
    const { scene, camera, renderer, physics, pauseManager, interactables, hud } = this.context;
    const s = this.systems;

    // Skip game updates while ANY pause reason is active (minigame,
    // settlement, or the manual) — see core/pause-manager.ts.
    if (!pauseManager.isPaused) {
      s.playerController.update(deltaTime);
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

      s.interactionSystem.update();
      s.pickupSystem.update(deltaTime);
      if (ENABLE_LEGACY_MAIL_FLOW) {
        s.envelopeStation.update(deltaTime);
        s.mailSortingSystem.update(deltaTime);
      }
      if (ENABLE_VEHICLE_LOADING_FLOW) s.vehicleControlSystem.update(deltaTime);
      const cameraForward = new THREE.Vector3();
      camera.getWorldDirection(cameraForward);
      if (s.dollySystem.isPushing) {
        s.dollySystem.update(camera.position, cameraForward);
      }
      s.palletSystem.update(deltaTime, camera.position, cameraForward);
      if (ENABLE_LEGACY_COUNTER) {
        s.counterNpcSystem.update(deltaTime);
        s.counterServiceSystem.update(deltaTime);
      }

      // Daily unload -> sort -> ship-via-vehicle loop (paused alongside
      // everything else above while the manual/settlement/minigame is open).
      // vehicleControlSystem.update() above already runs the organized-
      // cargo-into-cargoBounds shipment scan every frame it's enabled.
      s.unloadingSystem.update(deltaTime);
      s.lostFoundSystem.update(deltaTime);
      s.mailSystem.update(deltaTime);
      s.mailBagSystem.update(deltaTime);
      const flowState = s.dailyFlowSystem.state;
      const bannerText = flowState === 'completed' ? '今日貨物已全部裝載'
        : flowState === 'dayComplete' ? '今日貨物已全部送出'
        : null;
      hud.updateDailyFlow({
        day: s.dailyFlowSystem.currentDay,
        stateLabel: this.dailyStateLabel(flowState),
        total: s.dailyFlowSystem.totalCargoCount,
        unorganized: s.dailyFlowSystem.unorganizedCount,
        organized: s.dailyFlowSystem.organizedCount,
        remaining: s.dailyFlowSystem.remainingCargoCount,
        loaded: s.dailyFlowSystem.completedCargoCount,
        bannerText,
      });
    }

    s.compassUI.update(camera);

    // Runs unconditionally (not inside the isPaused block above) so a
    // pause takes effect on the UI the SAME frame it begins — the system
    // itself checks pauseManager.isPaused internally and reports no target
    // while paused, rather than leaving a stale target from the frame
    // before pause.
    s.cargoInspectionSystem.update();
    const inspectedCargo = s.cargoInspectionSystem.currentCargo;
    if (inspectedCargo?.category && inspectedCargo.region) {
      s.cargoInspectionUI.show(inspectedCargo.category, inspectedCargo.region);
    } else {
      s.cargoInspectionUI.hide();
    }

    // Render
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(s.pickupSystem.viewModelScene, s.pickupSystem.viewModelCamera);
  }

  private onResize(): void {
    // Delegates to SettingsManager — a FIXED resolution preset (spec 八)
    // deliberately does NOT track window resizes, only 'native' does.
    this.context.settingsManager.onWindowResize();
    this.systems?.pickupSystem?.onResize();
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
