import * as THREE from 'three';
import { InteractableObject } from '../../shared/types/interactable';
import { PickupPort } from '../../shared/types/pickup-port';
import { PlayerInteractionData } from '../../core/game-state';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { HUD } from '../hud';
import { PauseManager } from '../../core/pause-manager';
import { SettingsManager } from '../settings';
import { HeldItemView } from './held-item-view';
import { ContainerContentTransfer } from './container-content-transfer';
import { PlacementPreview } from './placement-preview';
import { MailBoxCarryHooks, PalletThrowHooks, HeldItemAccess } from './pickup-hooks';

// Re-exported for every existing external importer of these three types
// (create-game-systems.ts, pallet-system.ts, upgrade-system.ts,
// packed-mail-bag-system.ts, this folder's own index.ts barrel) — see
// pickup-hooks.ts's own doc comment for why the actual declarations moved
// there (breaking a PickupSystem↔PlacementPreview circular import).
export type { MailBoxCarryHooks, PalletThrowHooks, HeldItemAccess };

export class PickupSystem implements PickupPort, HeldItemAccess {
  private camera: THREE.PerspectiveCamera;
  private playerData: PlayerInteractionData;
  private interactables: Map<string, InteractableObject>;
  private hud: HUD;
  private physics: PhysicsSystem;
  private pauseManager: PauseManager;
  private settingsManager: SettingsManager;
  private hasFiredFirstPickup = false;
  private hasFiredCounterReceive = false;
  private hasFiredCargoLabelSeen = false;
  private hasFiredCargoPileTouched = false;

  // ViewModel — "Pickup system 架構整理" round Phase 1: construction/state
  // moved to HeldItemView (see that file's own doc comment for why), this
  // instance is the ONLY place that owns it. viewModelScene/viewModelCamera
  // stay exposed as getters below since external code (game-app.ts's render
  // loop, create-game-systems.ts wiring cargo-hook/envelope-vacuum tool
  // props into the SAME first-person rig) already reads
  // pickupSystem.viewModelScene/viewModelCamera directly — unchanged API.
  private heldItemView: HeldItemView;

  get viewModelScene(): THREE.Scene {
    return this.heldItemView.viewModelScene;
  }
  get viewModelCamera(): THREE.PerspectiveCamera {
    return this.heldItemView.viewModelCamera;
  }

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

  // Placement Preview / Throw — "Pickup system 架構整理" round Phase 2:
  // preview mesh/raycaster/yaw/charge/throw state and logic all moved to
  // PlacementPreview (see that file's own doc comment for why this is one
  // Gameplay Responsibility, not several), this instance is the ONLY place
  // that owns it. addPlacementSurface/removePlacementSurface/chargeRatio/
  // enterPlacementMode/cancelPlacement/confirmPlacement/updatePlacementPreview
  // stay exposed below as thin delegates since external code (game-app.ts,
  // interaction-system.ts, complete-day-cheat-system.ts, ...) already calls
  // them by these exact names — unchanged API.
  private placementPreview: PlacementPreview;

  // Container content tracking (for moving envelopes with containers) —
  // "Pickup system 架構整理" round Phase 3: moved to ContainerContentTransfer.
  private containerContentTransfer: ContainerContentTransfer;

  /** See the MailBoxCarryHooks doc comment above — null until
   * setMailBoxHooks() wires it up from create-game-systems.ts. */
  private mailBoxHooks: MailBoxCarryHooks | null = null;

  setMailBoxHooks(hooks: MailBoxCarryHooks): void {
    this.mailBoxHooks = hooks;
  }

  /** See the PalletThrowHooks doc comment above — null until
   * setPalletThrowHooks() wires it up from create-game-systems.ts. */
  private palletThrowHooks: PalletThrowHooks | null = null;

  setPalletThrowHooks(hooks: PalletThrowHooks): void {
    this.palletThrowHooks = hooks;
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
    this.playerData = playerData;
    this.interactables = interactables;
    this.hud = hud;
    this.physics = physics;
    this.pauseManager = pauseManager;
    this.settingsManager = settingsManager;
    this.heldItemView = new HeldItemView();
    this.containerContentTransfer = new ContainerContentTransfer(physics, interactables);
    this.placementPreview = new PlacementPreview(
      camera, worldScene, playerData, interactables, physics, hud, floor,
      this.heldItemView, this.containerContentTransfer, this
    );

    // Events
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousedown', (e) => this.onMouseDown(e));
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));
    document.addEventListener('wheel', (e) => this.onWheel(e));
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

  /** "Revise score upgrades and fix frog walkable colliders" round spec二A:
   * multiCarry now ONLY stacks sizeClass='small' Cargo — every other object
   * occupies the FULL carry capacity exclusively, never combinable with
   * anything else in either direction: medium/large cargo, live cages,
   * envelopes, mail boxes, lost items, and the sorting pallet (none of
   * those set `mesh.userData.cargoSizeClass`, since only cargo-system.ts's
   * spawnDailyBox/spawnDailyRoller ever do — so this same single check
   * naturally covers all of them without listing each one by name). */
  private isExclusiveItem(obj: InteractableObject): boolean {
    return obj.mesh.userData.cargoSizeClass !== 'small';
  }

  private isCurrentHoldExclusive(): boolean {
    if (this.heldStack.length === 0) return false;
    const obj = this.interactables.get(this.heldStack[0]);
    return !!obj && this.isExclusiveItem(obj);
  }

  /** Shared "may this specific object be added to the held set right now"
   * check — used by both pickUp() itself and InteractionSystem's own
   * multi-carry pickup-targeting (aiming at a new item while already
   * holding something, spec五A), so the two can never diverge.
   *
   * `bypassToolGate` ("Add power gloves and refine cargo hook cooldown"
   * round) exists ONLY for CargoHookSystem's own catch — the tool
   * deliberately stays selected on cargoHook through a successful catch
   * (spec二: "移除ToolSystem.trySelect('empty')"), so its own
   * `pickupSystem.pickUp()` call would otherwise get rejected by the very
   * tool-gate check below that its catch is supposed to satisfy. Every
   * OTHER caller (the generic E-key pickup path in interaction-system.ts,
   * left untouched) always calls this with the default `false`, so the
   * "only bare-hands may pick up an individual item" rule keeps applying to
   * everything except the hook's own hand-off. */
  canAddToHeld(obj: InteractableObject | null | undefined, bypassToolGate = false): boolean {
    // "Add tool hotbar and cargo hook" round spec三 / "Add power gloves and
    // refine cargo hook cooldown" round spec四: generic E-pickup of an
    // individual Cargo/envelope/lost item/mail box only ever works in bare-
    // hands mode — cargoHook catches cargo through its own aerial flow (see
    // cargo-hook-system.ts) and powerGloves only ever picks up the pallet
    // (see pallet-system.ts's own dedicated pickUp()), neither goes through
    // this generic path. This only ever blocks picking up something NEW —
    // placing/throwing whatever is ALREADY held goes through entirely
    // different methods that never call canAddToHeld, so a cargo-hook catch
    // that stays held while the tool stays selected can still be placed/
    // thrown normally (spec二: "只阻止再次拾取其他物品").
    if (!bypassToolGate && this.playerData.activeTool !== 'empty') return false;
    if (!obj || !obj.mesh || !obj.canPickUp || obj.isHeld) return false;
    if (this.playerData.state !== 'empty-handed' && this.playerData.state !== 'holding-item') return false;
    if (this.heldStack.length === 0) return true;
    if (this.isCurrentHoldExclusive()) return false;
    if (this.isExclusiveItem(obj)) return false;
    return this.heldStack.length < this.maxCarryCapacity_;
  }

  addPlacementSurface(surface: THREE.Object3D): void {
    this.placementPreview.addSurface(surface);
  }

  /** For surfaces that come and go, e.g. a vehicle's cargo bed while docked. */
  removePlacementSurface(surface: THREE.Object3D): void {
    this.placementPreview.removeSurface(surface);
  }

  get chargeRatio(): number {
    return this.placementPreview.chargeRatio;
  }

  // --- PICK UP ---
  pickUp(obj: InteractableObject, bypassToolGate = false): void {
    if (!this.canAddToHeld(obj, bypassToolGate)) return;

    // "Add sequential lost-found visitors and held cargo feedback" round三:
    // "切換物品...時，也必須立即清除震動" — a multi-carry pickup while
    // already charging Q changes WHICH item is activeHeldItem (heldStack's
    // new top), so any in-progress charge/shake belongs to the item being
    // displaced and must not silently carry over onto the freshly-added
    // one's own viewmodel.
    if (this.placementPreview.isChargingThrow) this.placementPreview.cancelCharge();

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
      this.containerContentTransfer.capture(obj);
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
    // own viewmodel clone in place, see HeldItemView.add's own doc comment).
    this.heldItemView.add(obj);

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

  /* Container content capture/restore moved to ContainerContentTransfer
   * (Phase 3) — see pickUp()/confirmPlacement()/executeThrow() below for the
   * call sites, now delegated to this.containerContentTransfer. */

  /** "失物招領系統修改" round — swaps the CURRENTLY-HELD viewmodel clone's
   * own geometry/material to match its (already-updated) world mesh, e.g.
   * right after LostFoundSystem.revealLostItem() swaps the black-ball
   * placeholder's world mesh to the real model. Resolves `id` to its
   * heldStack index (the one piece of "held item" bookkeeping HeldItemView
   * itself never owns) and delegates the actual clone-swap to it. No-op if
   * `id` isn't anywhere in the current held stack. */
  refreshHeldViewMesh(id: string): void {
    const idx = this.heldStack.indexOf(id);
    if (idx === -1) return;
    const obj = this.interactables.get(id);
    if (!obj) return;
    this.heldItemView.refresh(idx, obj);
  }

  /** Pops the current top-of-stack held item and updates player state to
   * whatever remains (LIFO — spec五A: "放置/丟出時最後拿起的物品優先處
   * 理"). Deliberately does NOT touch obj.isHeld/mesh/physics — identical
   * contract to the pre-multi-carry forceDropHeld() (see PickupPort's own
   * doc comment: "the object stays wherever it was left...it's the
   * caller's job to dispose or restore it") — every caller below already
   * handles that itself for exactly the one item being released. */
  releaseTopHeldItem(): void {
    this.heldStack.pop();
    this.heldItemView.removeTop();
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
    this.placementPreview.cancelCharge();

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
    this.placementPreview.enter();
  }

  cancelPlacement(): void {
    this.placementPreview.cancel();
  }

  confirmPlacement(): void {
    this.placementPreview.confirm();
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
  getActiveHeldItem(): InteractableObject | null {
    if (this.heldStack.length > 0) {
      return this.interactables.get(this.heldStack[this.heldStack.length - 1]) ?? null;
    }
    return this.playerData.heldObjectId ? this.interactables.get(this.playerData.heldObjectId) ?? null : null;
  }

  getMailBoxHooks(): MailBoxCarryHooks | null {
    return this.mailBoxHooks;
  }

  getPalletThrowHooks(): PalletThrowHooks | null {
    return this.palletThrowHooks;
  }

  private startCharge(): void {
    this.placementPreview.startCharge();
  }

  private cancelCharge(): void {
    this.placementPreview.cancelCharge();
  }

  private executeThrow(): void {
    this.placementPreview.executeThrow();
  }

  // --- UPDATE ---
  update(deltaTime: number): void {
    // Sync viewModelCamera to main camera — viewModelCamera stays at
    // origin, each held item's own view mesh is positioned relative to it.
    this.heldItemView.syncCamera(this.camera);

    // Charge update
    if (this.placementPreview.isChargingThrow && this.playerData.state === 'holding-item') {
      this.placementPreview.tickCharge(deltaTime);
    }
  }

  updatePlacementPreview(): void {
    this.placementPreview.updatePreview();
  }

  // --- INPUT ---
  private onMouseDown(event: MouseEvent): void {
    if (this.pauseManager.isPaused) return;
    if (this.playerData.state === 'placement-preview') {
      if (event.button === 0 && this.placementPreview.isPreviewValid) this.confirmPlacement();
      else if (event.button === 2) this.cancelPlacement();
    }
  }

  /** "Add placement rotation and pallet cargo straps" round spec一: rotates
   * the placement preview 15° per notch around world Y only, while (and
   * ONLY while) actively in placement-preview — ToolSystem's own wheel
   * handler gates itself off during this same state (see tool-system.ts),
   * so the two can never both react to the same wheel event. */
  private onWheel(event: WheelEvent): void {
    if (this.pauseManager.isPaused) return;
    if (this.playerData.state !== 'placement-preview') return;
    if (Math.abs(event.deltaY) < 1) return;
    const dir = event.deltaY > 0 ? 1 : -1;
    this.placementPreview.rotateYaw(dir * THREE.MathUtils.degToRad(15));
    this.updatePlacementPreview();
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
      this.playerData.state === 'placement-preview' && this.placementPreview.isLostFoundShelfTarget && this.placementPreview.isPreviewValid &&
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
    if (this.settingsManager.inputBindings.matches('chargeThrow', event.code) && this.placementPreview.isChargingThrow) {
      this.executeThrow();
    }
  }

  onResize(): void {
    this.heldItemView.onResize();
  }
}
