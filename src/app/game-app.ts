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
import { getCargoShapePreset } from '../systems/cargo';

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
    if (playerData.state === 'holding-item' && !this.systems.palletSystem.isPalletId(playerData.heldObjectId ?? '')) {
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
    // Queue auto-advance (spec六): if nothing is currently on the active
    // slot, pull the next envelope off pendingEnvelopeIds first. A no-op
    // if something is already active (mid-queue re-entry from the
    // 0.3s setTimeout in endMailStampUi below).
    if (!mailSystem.readyEnvelopeId) {
      mailSystem.advanceQueue();
    }
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

  private endMailStampUi(result: StampUiResult): void {
    if (this.mailStampUi) this.mailStampUi = null;
    const { mailSystem } = this.systems;

    // spec六/七: file the just-finished (or just-abandoned) envelope into
    // whichever pile it belongs to BEFORE releasing the active slot —
    // releaseFromTable only clears processingEnvelopeId, it no longer
    // owns physics/position handling itself.
    if (result === 'completed') {
      mailSystem.moveActiveToCompleted();
    } else {
      mailSystem.returnActiveToPendingFront();
    }
    mailSystem.releaseFromTable();

    // spec六: consecutive stamping — if the pile still has unfinished
    // envelopes after a completion, auto-load the next one instead of
    // tearing the whole minigame down. A short transition delay (spec六:
    // ~0.25-0.4s) so the completed envelope's own finish animation/UI can
    // be seen before the next one appears; the player never has to leave
    // and re-enter the table between envelopes. An aborted ('cancelled')
    // result always falls through to the full teardown below (spec七).
    if (result === 'completed' && mailSystem.pendingCount > 0) {
      setTimeout(() => this.startMailStampUi(), 300);
      return;
    }

    this.context.pauseManager.remove('stampMinigame');
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
      // "Add freezer shelves and frozen cargo freshness system" round —
      // reads palletSystem's own rack-mount state, so it must run AFTER
      // palletSystem.update just above (both already run inside this same
      // paused-gated block, so pause freezes coldValue ticking too — spec
      // has no requirement either way, but freezing it alongside everything
      // else while the manual/settlement panel is open is the least
      // surprising choice).
      s.freezerSystem.update(deltaTime);
      // "活物貨物系統" round — same paused-gated convention as freezerSystem
      // just above (the actual calmValue tick must freeze while paused,
      // exactly like coldValue does).
      s.livingCargoSystem.update(deltaTime);
      // "Add ladder tool station and envelope vacuum" round一 — same
      // "no-op unless currently being carried" self-guard as
      // palletSystem.update just above.
      s.ladderSystem.update(camera.position, cameraForward);
      // "Add envelope stacks and expand pallet inventory" round — same
      // no-op-unless-carrying self-guard as palletSystem/ladderSystem just
      // above; repositions each held envelope's real mesh/body in front of
      // the camera every frame (spec二). "Add charged envelope stack
      // throwing" round: now also takes deltaTime to accumulate its own
      // independent Q-hold charge timer.
      s.envelopeStackSystem.update(deltaTime);
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
      // "Add lost-found item cleaning system" round — runs right after
      // lostFoundSystem/InteractionSystem so its own prompt/chargebar calls
      // have the final say on the shared HUD elements while the player is
      // aiming at the cleaning station (same ordering convention
      // HUD.showToolPrompt's own doc comment documents for cargoHookSystem/
      // spraySystem).
      s.lostFoundCleaningSystem.update(deltaTime);
      s.mailSystem.update(deltaTime);
      s.mailBagSystem.update(deltaTime);
      // "Add regional envelope dispatch machine" round — same paused-block
      // placement as mailSystem/mailBagSystem just above (its own hole
      // sensors/reject-message cooldowns/button debounce should all freeze
      // alongside every other gameplay system while paused).
      s.envelopeDispatchMachineSystem.update(deltaTime);
      const flowState = s.dailyFlowSystem.state;
      // "Banner貫穿夜晚" round — the 'dayComplete' banner has its own display
      // flag now (dayCompleteBannerVisible), separate from `state` itself,
      // since `state` stays 'dayComplete' for the whole night sequence (see
      // that flag's own doc comment on DailyFlowSystem).
      const bannerText = flowState === 'completed' ? '今日貨物已全部裝載'
        : (flowState === 'dayComplete' && s.dailyFlowSystem.dayCompleteBannerVisible) ? '今日貨物已全部送出'
        : null;
      hud.updateDailyFlow({
        // "結算搶跑於NPC劇情之前" round spec E — the player-visible day number
        // deliberately reads displayDay, not currentDay itself (see that
        // field's own doc comment on DailyFlowSystem) — every OTHER read of
        // currentDay elsewhere in this codebase (unlock gating, cargo/vehicle
        // regeneration, upgrade settlement, etc.) is untouched and keeps
        // reading the real, immediately-advancing currentDay.
        day: s.dailyFlowSystem.displayDay,
        stateLabel: this.dailyStateLabel(flowState),
        total: s.dailyFlowSystem.totalCargoCount,
        unorganized: s.dailyFlowSystem.unorganizedCount,
        organized: s.dailyFlowSystem.organizedCount,
        remaining: s.dailyFlowSystem.remainingCargoCount,
        loaded: s.dailyFlowSystem.completedCargoCount,
        bannerText,
      });
      hud.updateHeldCount(s.pickupSystem.heldCount, s.pickupSystem.maxCarryCapacity);
      // "每日起床＋夢境漫畫" round — deliberately INSIDE this paused-gated
      // block, unlike afterWorkStorySystem.update() below (see
      // DreamComicSystem's own class doc comment for why): this class polls
      // dailyFlowSystem.currentDay/state every idle frame to detect a fresh
      // day starting, and must not be able to do so while e.g. the main menu
      // overlay still covers the screen at boot (MainMenuSystem pauses via
      // PauseManager the whole time it's shown).
      s.dreamComicSystem.update();
      // "載具夜間清潔互動" round — same paused-gated placement as
      // dreamComicSystem.update() just above (no continuous effect needs to
      // survive an unrelated pause, and this feature is only ever started by
      // a live gameplay action, never polled while e.g. the main menu is
      // still up).
      s.vehicleNightCleaningSystem.update(deltaTime);
    }

    s.compassUI.update(camera);

    // Runs unconditionally (not inside the isPaused block above) so a
    // pause takes effect on the UI the SAME frame it begins — the system
    // itself checks pauseManager.isPaused internally and reports no target
    // while paused, rather than leaving a stale target from the frame
    // before pause.
    s.cargoInspectionSystem.update();
    const inspectedCargo = s.cargoInspectionSystem.currentCargo;
    // "Add tool hotbar and cargo hook" round: runs unconditionally (not
    // inside the isPaused block above) for the same reason
    // cargoInspectionSystem does — CargoHookSystem checks
    // pauseManager.isPaused/activeTool internally and self-cancels rather
    // than the caller gating it (spec八). Reuses inspectedCargo, computed
    // just above, for the crosshair "can-hook" indicator instead of a
    // second raycast (spec七).
    s.cargoHookSystem.update(deltaTime, inspectedCargo);
    // "Fix pallet throw and add spray paint tool" round: same unconditional/
    // self-guarding convention as cargoHookSystem just above (checks
    // pauseManager.isPaused/isLocked internally rather than being gated by
    // the caller here).
    s.spraySystem.update();
    // "Add ladder tool station and envelope vacuum" round四-八: same
    // unconditional/self-guarding convention as cargoHookSystem/spraySystem
    // above — runs even while paused so a pause reliably releases any
    // currently-captured envelope the same frame it begins (spec八).
    s.envelopeVacuumSystem.update(deltaTime);
    // "Add freezer shelves and frozen cargo freshness system" round —
    // unconditional for the SAME reason as cargoHookSystem/spraySystem/
    // envelopeVacuumSystem above: a pause must take effect on the held-item
    // 冷藏值 HUD readout the same frame it begins, not lag a frame behind
    // (the coldValue TICK itself stays inside the paused block above —
    // freezerSystem.update(deltaTime) — only this HUD refresh runs here).
    s.freezerSystem.refreshHeldItemHud();
    // "活物貨物系統" round — same unconditional convention as
    // freezerSystem.refreshHeldItemHud above (a pause must take effect on
    // the held-item 安撫值 HUD readout the same frame it begins).
    s.livingCargoSystem.refreshHeldItemHud();
    // "冷凍貨物系統修改" round四 — same unconditional convention, reusing
    // `inspectedCargo` (computed just above by cargoInspectionSystem.update())
    // rather than a second raycast.
    s.freezerSystem.refreshAimedColdValueHud(inspectedCargo);
    // "準心貨物數值提示" round — same unconditional convention, reusing the
    // SAME `inspectedCargo` rather than a second raycast.
    s.livingCargoSystem.refreshAimedCalmValueHud(inspectedCargo);
    // "Add day one dock story event" round — same unconditional/self-
    // guarding convention as cargoHookSystem/spraySystem/envelopeVacuumSystem
    // above: this class deliberately never uses PauseManager itself (see its
    // own class doc comment), so its NPC walk-lerp and dialogue typewriter
    // timers must keep advancing every frame regardless of any OTHER pause
    // reason that might independently activate. No-ops entirely while
    // inactive/completed (its own update() checks this first).
    s.afterWorkStorySystem.update(deltaTime);
    // "同類感知" upgrade ("Revise score upgrades and fix frog walkable
    // colliders" round spec二D: 觸發方式改為手持一件貨物時啟用，不再要求準
    // 心先對準貨物) — driven by the CURRENTLY HELD item instead of the
    // crosshair raycast target. `cargoDataMap.get` returns undefined for
    // anything that isn't real Cargo (envelopes/mail boxes/lost items/the
    // pallet all live in separate registries), so those are excluded for
    // free, with no extra type check needed here. Still reuses
    // SimilarCargoHighlight's own existing radius search — no second scan
    // or raycast of any kind is added.
    const heldCargoData = this.context.playerData.heldObjectId
      ? s.cargoSystem.getCargoData(this.context.playerData.heldObjectId) ?? null
      : null;
    s.similarCargoHighlight.update(s.upgradeSystem.isSimilarCargoSenseUnlocked(), heldCargoData, s.cargoSystem);
    if (inspectedCargo?.category && inspectedCargo.region) {
      // "Organize and expand cargo shape presets" round: the crosshair line
      // also shows the exact shape preset's own displayName + sizeClass
      // (spec七: "外型／種類／地區／尺寸") — looked up from
      // shapePresetId via getCargoShapePreset(), never re-derived from the
      // mesh (spec: "外型名稱從 CargoShapePreset.displayName 取得...不要從
      // 模型名稱猜測").
      const preset = inspectedCargo.shapePresetId ? getCargoShapePreset(inspectedCargo.shapePresetId) : undefined;
      s.cargoInspectionUI.show(inspectedCargo.category, inspectedCargo.region, preset?.displayName ?? null, inspectedCargo.sizeClass);
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
