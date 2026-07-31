import * as THREE from 'three';
import { InteractableObject } from '../../shared/types/interactable';
import { PlayerInteractionData } from '../../core/game-state';
import { SCENE_CONFIG } from '../world-layout';
import { PickupSystem } from './pickup-system';
import { EnvelopeSystem } from '../../game/envelope-system';
import { EnvelopeStampStation } from '../../game/envelope-stamp-station';
import { SortingBoxSystem } from '../../game/sorting-box-system';
import { VehicleControlSystem, VEHICLE_CALL_BUTTON_ID, VEHICLE_DEPART_BUTTON_ID } from '../vehicle';
import { CounterServiceSystem } from '../../game/counter-service-system';
import { DollySystem } from '../../game/dolly-system';
import { HUD } from '../hud';
import { PauseManager } from '../../core/pause-manager';
import { SettingsManager } from '../settings';
import { UnloadingSystem } from '../unloading';
import { DailyFlowSystem } from '../daily-flow';
import { PalletSystem } from '../pallet';
import { LostFoundSystem } from '../lost-found';
import { MailSystem } from '../mail/mail-system';
import { MailBagSystem, MAIL_RACK_INTERACTABLE_ID } from '../mail/mail-bag-system';
import { getMailDestination } from '../mail/mail-data';
import { BULLETIN_BOARD_INTERACTABLE_ID, TELEVISION_INTERACTABLE_ID } from '../world-layout';

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
  private mailSystem: MailSystem;
  private mailBagSystem: MailBagSystem;
  private onStartMailStampUi: () => void;
  /** Opens the bulletin board's full-screen upgrade UI ("Add bulletin board
   * upgrade system" round spec二/三) — called ONLY from the empty-handed
   * priority chain below, gated on PickupSystem's actual heldCount === 0. */
  private onOpenUpgradeMenu: () => void;
  /** Opens the television's full-screen media player UI ("Add television
   * media playlist" round spec二) — same empty-handed-only priority pattern
   * as onOpenUpgradeMenu just above. */
  private onOpenMediaPlayer: () => void;
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
    mailSystem: MailSystem,
    mailBagSystem: MailBagSystem,
    onStartMailStampUi: () => void,
    onOpenUpgradeMenu: () => void,
    onOpenMediaPlayer: () => void,
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
    this.mailSystem = mailSystem;
    this.mailBagSystem = mailBagSystem;
    this.onStartMailStampUi = onStartMailStampUi;
    this.onOpenUpgradeMenu = onOpenUpgradeMenu;
    this.onOpenMediaPlayer = onOpenMediaPlayer;
    this.onDollyUsed = onDollyUsed;

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('mousedown', (e) => this.onMouseDown(e));
  }

  /** Right-click, aimed at a mail box holding ≥1 envelope — extracts the
   * most-recently-placed one (LIFO) directly into the player's own held
   * items via the normal PickupSystem.pickUp() path (spec二: "使用既有
   * PickupSystem", "信封直接加入玩家heldItems，不落地、不停留在箱內").
   * Allowed from BOTH empty-handed and holding-item states (spec三:
   * "空手或有足夠搬運容量時") — capacity/exclusivity is peeked via
   * PickupSystem's own canAddToHeld BEFORE calling removeLastEnvelope, so a
   * failed check (capacity full, or currently holding large cargo/a live
   * creature) never mutates box state at all. A held mail box itself can
   * never be `currentTarget` (the update() loop's own raycast filters out
   * any `obj.isHeld === true` object), so "不可在手持箱子時右鍵取出內部信
   * 件" is satisfied structurally — no extra guard needed. Right-click has
   * no other meaning in these two states (PickupSystem's own right-click
   * handler only acts during 'placement-preview'), so this can never
   * collide with cancel-placement or any other right-click function. */
  private onMouseDown(event: MouseEvent): void {
    if (event.button !== 2) return;
    if (!this.isLocked()) return;
    if (this.pauseManager.isPaused) return;
    if (this.playerData.state !== 'empty-handed' && this.playerData.state !== 'holding-item') return;
    if (!this.currentTarget || !this.mailBagSystem.isBag(this.currentTarget.id)) return;
    const bagId = this.currentTarget.id;
    const envelopeIds = this.mailBagSystem.getContainedEnvelopeIds(bagId);
    if (envelopeIds.length === 0) {
      this.hud.showToast('信封箱內沒有信件');
      return;
    }
    const peekId = envelopeIds[envelopeIds.length - 1];
    const peekObj = this.interactables.get(peekId);
    // Temporarily lift the boxed envelope's own canPickUp=false (set by
    // attemptInsert to block direct E-pickup) purely so canAddToHeld's
    // capacity/exclusivity logic can be reused as-is — reverted immediately
    // below if the check fails, so nothing is left mutated on failure.
    if (peekObj) peekObj.canPickUp = true;
    if (!peekObj || !this.pickupSystem.canAddToHeld(peekObj)) {
      if (peekObj) peekObj.canPickUp = false;
      this.hud.showToast('搬運容量已滿');
      return;
    }
    const removed = this.mailBagSystem.removeLastEnvelope(bagId);
    if (removed) this.pickupSystem.pickUp(removed);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (!this.isLocked()) return;
    if (this.pauseManager.isPaused) return;

    // F key: cycle a targeted OPEN mail bag's destination pattern (spec六),
    // or (legacy, dead while ENABLE_LEGACY_MAIL_FLOW is false) take an
    // envelope from the old crate.
    if (event.code === 'KeyF') {
      // "Add tool hotbar and cargo hook" round spec三: while the cargo hook
      // is the selected tool, F ONLY fires the hook (see
      // cargo-hook-system.ts's own separate KeyF listener) — this legacy
      // mail-bag-cycle/envelope-crate action must not also fire.
      if (this.playerData.activeTool === 'cargoHook') return;
      if (this.playerData.state !== 'empty-handed') return;
      if (this.currentTarget && this.mailBagSystem.isBag(this.currentTarget.id)) {
        this.mailBagSystem.cyclePattern(this.currentTarget.id);
        return;
      }
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
      // Bulletin board while holding anything: E does nothing at all (spec
      // 二: "E 不執行任何動作，不能自動丟棄手持物品") — checked first so it
      // can never fall through to the generic "enter placement mode"
      // fallback at the bottom of this branch. currentTarget is only ever
      // set to the board here by update()'s own holding-item raycast below.
      if (this.currentTarget && this.currentTarget.id === BULLETIN_BOARD_INTERACTABLE_ID) {
        return;
      }
      // Television, same reasoning ("Add television media playlist" round
      // spec二: "需空手才能操作電視" — E does nothing while holding anything).
      if (this.currentTarget && this.currentTarget.id === TELEVISION_INTERACTABLE_ID) {
        return;
      }
      // Multi-carry: aiming at a NEW plain pickupable item with spare
      // capacity (spec五A: "瞄準+按拾取鍵，若容量足夠加入持有") — mirrors
      // update()'s own targeting check exactly (same exclusions: the
      // bulletin board above, the pallet and the rack, which each already
      // have their own dedicated holding-item interactions here or below).
      // Mail boxes are ALSO eligible here as of "Remove sealing and add
      // physical mail box contents" round (spec三: "空手或有足夠搬運容量時
      // ...按E拿起信封箱") — UNLESS the player is currently holding an
      // envelope, in which case aiming at a box means "insert" (the
      // dedicated branch just below this one), never "pick up the box
      // itself". A plain pickUp() call, not a second code path — LIFO
      // ordering, capacity, and exclusivity (and, for mail boxes, the
      // contained-envelope carry setup) are all enforced the one place
      // PickupSystem.canAddToHeld/pickUp already own.
      const heldForBagCheck = this.playerData.heldObjectId;
      const isHoldingEnvelope = !!(heldForBagCheck && this.mailSystem.getEnvelope(heldForBagCheck));
      // Also blocked while the pallet itself is the currently-held item
      // ("Fix cargo throwing and rebalance daily manifest" round一) — the
      // pallet's own world-space carry (pallet-system.ts) writes
      // playerData.heldObjectId directly and never pushes onto
      // PickupSystem's own heldStack, so PickupSystem.canAddToHeld would
      // otherwise see an "empty" heldStack and wrongly allow a multi-carry
      // pickup here — silently overwriting heldObjectId out from under the
      // still-carried pallet (exactly the "上一次手持物快取"-style
      // desync spec一 warns against: Q-throw and everything else reading
      // heldObjectId would then point at the wrong item while the pallet is
      // still visibly attached to the player with no way to place it).
      const isHoldingPallet = this.playerData.heldObjectId === this.palletSystem.palletId;
      if (
        this.currentTarget &&
        !isHoldingPallet &&
        this.currentTarget.id !== this.palletSystem.palletId &&
        this.currentTarget.id !== MAIL_RACK_INTERACTABLE_ID &&
        this.currentTarget.id !== VEHICLE_CALL_BUTTON_ID && this.currentTarget.id !== VEHICLE_DEPART_BUTTON_ID &&
        !(this.mailBagSystem.isBag(this.currentTarget.id) && isHoldingEnvelope) &&
        this.pickupSystem.canAddToHeld(this.currentTarget)
      ) {
        this.pickupSystem.pickUp(this.currentTarget);
        this.clearHighlight(this.currentTarget);
        this.currentTarget = null;
        return;
      }
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
      // Insert held envelope into a targeted OPEN mail bag (spec二/三) —
      // intercepts before the sorting-box-interior/lost-found special cases
      // below since currentTarget (set by update()'s own raycast above)
      // already resolved specifically to an open bag's mesh. This whole
      // branch lives entirely inside the holding-item state, so the
      // empty-handed-only sealing priority (0.5) further down is completely
      // unreachable from here — holding an envelope can never accidentally
      // trigger sealing (spec三 last line).
      const heldIdForInsert = this.playerData.heldObjectId;
      if (heldIdForInsert && this.mailSystem.getEnvelope(heldIdForInsert) && this.currentTarget && this.mailBagSystem.isBag(this.currentTarget.id)) {
        const targetBag = this.mailBagSystem.getBag(this.currentTarget.id);
        if (targetBag) {
          this.mailBagSystem.tryInsertHeldEnvelope(heldIdForInsert, this.currentTarget.id);
          // Clear the target after acting (mirrors the rack-spawn special
          // case's own pattern above) — on success this state transitions
          // to empty-handed while still looking at the SAME bag object, so
          // without this the update() loop's identity-based "did the target
          // change" check would never fire and the prompt would stay on the
          // stale "E 放入信件" text instead of refreshing to the bag's own
          // seal/status prompt.
          this.clearHighlight(this.currentTarget);
          this.currentTarget = null;
          return;
        }
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

    // Priority -1: bulletin board upgrade UI (spec二) — reads
    // PickupSystem's actual heldCount rather than trusting playerData.state
    // alone (spec二: "空手判定必須讀取PickupSystem實際持有數量
    // heldCount===0"), checked before every other empty-handed priority
    // since aiming at the board should never simultaneously trigger
    // anything else.
    if (this.currentTarget && this.currentTarget.id === BULLETIN_BOARD_INTERACTABLE_ID) {
      if (this.pickupSystem.heldCount === 0) {
        this.onOpenUpgradeMenu();
      }
      this.clearHighlight(this.currentTarget);
      this.currentTarget = null;
      return;
    }

    // Priority -0.9: television media player ("Add television media
    // playlist" round spec二) — same empty-handed-only pattern as the
    // bulletin board's own upgrade UI just above, checked before the
    // generic pickup priorities below since the TV's own canPickUp is only
    // true to satisfy the raycast's own filter, never meant to actually be
    // picked up (mirrors the bulletin board/mail rack's own pattern).
    if (this.currentTarget && this.currentTarget.id === TELEVISION_INTERACTABLE_ID) {
      if (this.pickupSystem.heldCount === 0) {
        this.onOpenMediaPlayer();
      }
      this.clearHighlight(this.currentTarget);
      this.currentTarget = null;
      return;
    }

    // Priority 0: talk-only interaction at the lost & found counter while
    // empty-handed (spec三 case3: "沒有持有任何物品——僅視為與NPC互動，顯示
    // NPC要找的失物名稱與模型，不算完成案件") — the NPC's own head bubble
    // already shows its target item's name/preview persistently while
    // waiting, so this press only needs to flip
    // lostFoundNpcInteractedToday via tryConfirmAtCounter(null). Checked
    // before the generic pickup priorities below since nothing else should
    // ever be targetable while standing at the counter.
    if (this.lostFoundSystem.isNpcWaiting && this.lostFoundSystem.isPlayerNearCounter(this.camera.position)) {
      this.lostFoundSystem.tryConfirmAtCounter(null);
      return;
    }

    // Priority 0.7: empty-bag supply rack (spec三/四: "玩家必須用準心射線直
    // 接命中供應架互動Collider，按E才能取得新袋" — a raycast-precise target
    // registered in the SAME shared interactables map, resolved by the SAME
    // single crosshair raycast every other target already uses; no
    // proximity/second raycaster). Intercepts before the generic pickup
    // below since this target's canPickUp is only true to satisfy that
    // raycast's own filter, never meant to actually be picked up — mirrors
    // the sorting pallet's own special-case pattern just below.
    if (this.currentTarget && this.currentTarget.id === MAIL_RACK_INTERACTABLE_ID) {
      this.mailBagSystem.trySpawnBag();
      this.clearHighlight(this.currentTarget);
      this.currentTarget = null;
      return;
    }

    // Priority 0.8: vehicle call/depart buttons (re-enabled — see
    // feature-flags.ts ENABLE_VEHICLE_LOADING_FLOW) — now two wall-mounted
    // plaques south of the TV, raycast targets in the SAME shared
    // interactables map like every other crosshair-aimed prop ("Fix cargo
    // throwing and rebalance daily manifest" round二: "準心直接命中壁掛按
    // 鈕才可按E" — replaces the old proximity-based getNearestButton()).
    // Must intercept before Priority 1's generic pickup below, same reason
    // as the mail rack just above — canPickUp is only true to satisfy the
    // raycast's own filter, never meant to actually be picked up.
    if (this.currentTarget && this.currentTarget.id === VEHICLE_CALL_BUTTON_ID) {
      this.vehicleControlSystem.pressCallButton();
      this.clearHighlight(this.currentTarget);
      this.currentTarget = null;
      return;
    }
    if (this.currentTarget && this.currentTarget.id === VEHICLE_DEPART_BUTTON_ID) {
      this.vehicleControlSystem.pressDepartButton();
      this.clearHighlight(this.currentTarget);
      this.currentTarget = null;
      return;
    }

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

    // Priority 2: envelope stamp station (legacy, dead while
    // ENABLE_LEGACY_MAIL_FLOW is false) / this round's new mail stamp table
    // (spec四: "玩家對工作桌按E：開啟貼郵票UI").
    if (this.envelopeStation.readyEnvelopeId && this.envelopeStation.isPlayerNearTable(this.camera.position)) {
      this.onStartEnvelopeMinigame();
      return;
    }
    if (this.mailSystem.readyEnvelopeId && this.mailSystem.isPlayerNearTable(this.camera.position)) {
      this.onStartMailStampUi();
      return;
    }

    // Priority 3: 開始卸貨 / 結束今天 — co-located near the north unload
    // dock close enough together that a naive per-button proximity check
    // would overlap; resolve to whichever one the player is actually
    // nearer to. (The vehicle call/depart buttons used to share this same
    // proximity pattern — see Priority 0.8 above for their current
    // crosshair-raycast replacement.)
    switch (this.nearestUnloadClusterButton()) {
      case 'unload': this.unloadingSystem.pressButton(); return;
      case 'endDay': this.dailyFlowSystem.pressEndDayButton(); return;
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
   * buttons (spec section 十九: "四個按鈕不要互相重疊") — these two stay
   * proximity-based (unlike the vehicle call/depart buttons, now crosshair
   * raycast targets — see VEHICLE_CALL_BUTTON_ID/VEHICLE_DEPART_BUTTON_ID
   * above), out of scope for "Fix cargo throwing and rebalance daily
   * manifest" round二. */
  private nearestUnloadClusterButton(): 'unload' | 'endDay' | null {
    const pos = this.camera.position;
    const unloadNear = this.unloadingSystem.isPlayerNearButton(pos);
    const endDayNear = this.dailyFlowSystem.isPlayerNearButton(pos);
    if (!unloadNear && !endDayNear) return null;
    if (unloadNear && !endDayNear) return 'unload';
    if (!unloadNear && endDayNear) return 'endDay';
    return this.unloadingSystem.buttonDistance(pos) <= this.dailyFlowSystem.buttonDistance(pos) ? 'unload' : 'endDay';
  }

  /** Single shared raycast-and-resolve helper — the ONE raycaster instance
   * this whole class owns, wrapped so both the normal empty-handed target
   * resolution below AND the new "holding an envelope, aim at an open bag"
   * check ("Enlarge mail bags and add E key letter placement" round 二: "沿
   * 用...唯一射線系統") go through the exact same raycast, never a second
   * one. */
  private raycastCurrentHit(): InteractableObject | null {
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    this.raycaster.set(this.camera.position, direction);
    const meshes = this.getInteractableMeshes();
    const intersects = this.raycaster.intersectObjects(meshes, true);
    if (intersects.length > 0 && intersects[0].distance <= SCENE_CONFIG.interactionDistance) {
      return this.resolveInteractableFromHit(intersects[0].object);
    }
    return null;
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
      // Single shared raycast for this whole branch (spec二: "沿用唯一準心
      // raycast系統，不能新增第二套") — this state otherwise skips
      // raycasting entirely (see the pallet/lost-found proximity-only
      // checks below), so every holding-item target check below (bulletin
      // board, mail-bag envelope insertion, multi-carry pickup) reuses this
      // ONE result rather than each calling raycastCurrentHit() again.
      const hit = this.raycastCurrentHit();

      // Bulletin board while holding anything (spec二: "需空手才能查看升
      // 級") — highest priority in this branch since it must show
      // regardless of what's currently held.
      if (hit && hit.id === BULLETIN_BOARD_INTERACTABLE_ID) {
        if (this.currentTarget !== hit) {
          if (this.currentTarget) this.clearHighlight(this.currentTarget);
          this.applyHighlight(hit);
          this.currentTarget = hit;
          this.playerData.targetedObjectId = hit.id;
        }
        this.hud.showInteractionPrompt('物流中心公告欄', '需空手才能查看升級');
        this.hud.setCrosshairActive(false);
        return;
      }

      // Television while holding anything ("Add television media playlist"
      // round spec二: "需空手才能操作電視"), same pattern as the bulletin
      // board just above.
      if (hit && hit.id === TELEVISION_INTERACTABLE_ID) {
        if (this.currentTarget !== hit) {
          if (this.currentTarget) this.clearHighlight(this.currentTarget);
          this.applyHighlight(hit);
          this.currentTarget = hit;
          this.playerData.targetedObjectId = hit.id;
        }
        this.hud.showInteractionPrompt('二手電視', '需空手才能操作電視');
        this.hud.setCrosshairActive(false);
        return;
      }

      // Holding a stamped/unstamped envelope and aiming at an OPEN mail bag
      // (spec二/三: "E 放入信件"). "Allow unset mail boxes to accept first
      // envelope" round五: an UNSET, still-empty box gets its own two more
      // specific prompts instead of the generic one — "E 放入信件並自動設
      // 定圖樣" when the held envelope is actually stamped (E would
      // genuinely succeed and fix the box's destination to it), or "信件尚
      // 未貼郵票" when it isn't (E would just fail) — both replace the old,
      // now-removed "信封箱尚未設定圖樣" blocking message, which no longer
      // applies now that unset boxes are insertable.
      const heldIdForBagPrompt = this.playerData.heldObjectId;
      const heldEnvelopeForBagPrompt = heldIdForBagPrompt ? this.mailSystem.getEnvelope(heldIdForBagPrompt) : undefined;
      if (heldEnvelopeForBagPrompt) {
        const hitBag = hit && this.mailBagSystem.isBag(hit.id) ? this.mailBagSystem.getBag(hit.id) : null;
        if (hit && hitBag) {
          if (this.currentTarget !== hit) {
            if (this.currentTarget) this.clearHighlight(this.currentTarget);
            this.applyHighlight(hit);
            this.currentTarget = hit;
            this.playerData.targetedObjectId = hit.id;
            const isUnsetEmptyBox = !hitBag.destinationPattern && hitBag.envelopeIds.length === 0;
            const promptText = isUnsetEmptyBox
              ? (heldEnvelopeForBagPrompt.state === 'stamped' ? 'E 放入信件並自動設定圖樣' : '信件尚未貼郵票')
              : 'E 放入信件';
            this.hud.showInteractionPrompt(hit.displayName, promptText);
          }
          this.hud.setCrosshairActive(true);
          return;
        }
      }

      // Multi-carry: aiming at a NEW plain pickupable item with spare
      // capacity (spec五A) — same exclusions as onKeyDown's own multi-carry
      // branch (never offered for the board/pallet/rack, each already
      // handled above or below). Mail boxes ARE included here (mirrors
      // onKeyDown's own change) — by this point the "holding an envelope,
      // aiming at a bag" case has already returned above, so reaching here
      // while aiming at a bag always means "pick up the box itself" (spec
      // 三: "空手或有足夠搬運容量時...拿起信封箱"). Vehicle call/depart
      // buttons are excluded the same way ("Fix cargo throwing and
      // rebalance daily manifest" round二) — their own canPickUp=true only
      // exists to satisfy this raycast's generic filter, never meant to
      // actually be carried.
      if (
        hit && this.playerData.heldObjectId !== this.palletSystem.palletId &&
        hit.id !== this.palletSystem.palletId && hit.id !== MAIL_RACK_INTERACTABLE_ID &&
        hit.id !== VEHICLE_CALL_BUTTON_ID && hit.id !== VEHICLE_DEPART_BUTTON_ID &&
        this.pickupSystem.canAddToHeld(hit)
      ) {
        if (this.currentTarget !== hit) {
          if (this.currentTarget) this.clearHighlight(this.currentTarget);
          this.applyHighlight(hit);
          this.currentTarget = hit;
          this.playerData.targetedObjectId = hit.id;
          this.hud.showInteractionPrompt(hit.displayName, `E 拿起（持有 ${this.pickupSystem.heldCount}/${this.pickupSystem.maxCarryCapacity}）`);
        }
        this.hud.setCrosshairActive(true);
        return;
      }

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
        this.hud.showInteractionPrompt('失物招領櫃檯', 'E 交還失物／與顧客互動');
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
    const newTarget = this.raycastCurrentHit();

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
        } else if (this.mailSystem.getEnvelope(newTarget.id)) {
          // Crosshair inspect (spec三) — reuses this SAME raycast/prompt
          // path, no second raycasting system.
          const rec = this.mailSystem.getEnvelope(newTarget.id)!;
          const dest = getMailDestination(rec.destination);
          const regionText = dest.region === 'domestic' ? '國內' : '海外';
          const stampText = rec.state === 'unstamped' ? '未貼票' : '已貼票';
          this.hud.showInteractionPrompt(
            newTarget.displayName,
            `目的地：${dest.displayName}\n地區：${regionText}\n狀態：${stampText}\n按 E 拿起`
          );
        } else if (this.mailBagSystem.isBag(newTarget.id)) {
          // "Remove sealing and add physical mail box contents" round八: no
          // more sealed/open state text — every box is always pickupable/
          // loadable. Empty-handed E is always "pick up the box" (never
          // "insert" — that only ever applies while holding an envelope,
          // handled entirely by the holding-item branches above, never
          // reached from here). Right-click's own extraction hint only
          // shows once the box actually has something to extract.
          const bag = this.mailBagSystem.getBag(newTarget.id)!;
          const pattern = bag.destinationPattern ? getMailDestination(bag.destinationPattern) : null;
          const patternText = pattern ? `${pattern.displayName}（${pattern.region === 'domestic' ? '國內' : '海外'}）` : '未設定';
          const extractHint = bag.envelopeIds.length > 0 ? '\n右鍵：取出信件' : '';
          this.hud.showInteractionPrompt(
            newTarget.displayName,
            `圖樣：${patternText}\n信件數：${bag.envelopeIds.length}／${bag.capacity}\nE：拿起信封箱　F：更改圖樣${extractHint}`
          );
        } else if (newTarget.id === BULLETIN_BOARD_INTERACTABLE_ID) {
          // Empty-handed here (this whole raycast branch only runs once
          // state !== 'holding-item' has already been routed elsewhere
          // above) — spec二's own "E 查看升級" prompt.
          this.hud.showInteractionPrompt('物流中心公告欄', 'E 查看升級');
        } else if (newTarget.id === TELEVISION_INTERACTABLE_ID) {
          // Empty-handed here, same reasoning as the bulletin board just
          // above ("Add television media playlist" round spec二: "E 開啟媒
          // 體播放器").
          this.hud.showInteractionPrompt('二手電視', 'E 開啟媒體播放器');
        } else if (newTarget.id === MAIL_RACK_INTERACTABLE_ID) {
          // World prompt only while the crosshair directly hits the rack
          // (spec三: "只在準心命中供應架時顯示...準心移開後立即隱藏") — this
          // whole branch only runs on a newTarget CHANGE, and newTarget
          // reverts to null (hiding it again, via updateStationPrompts'
          // final hideInteractionPrompt fallback) the instant the raycast
          // no longer hits this mesh.
          this.hud.showInteractionPrompt(
            newTarget.displayName,
            this.mailBagSystem.canSpawnBag ? '按 E 取得新箱' : '空箱數量已達上限'
          );
        } else if (newTarget.id === VEHICLE_CALL_BUTTON_ID) {
          // Wall-mounted call button ("Fix cargo throwing and rebalance
          // daily manifest" round二) — same blocked/idle text VehicleControlSystem
          // already exposed for the old proximity prompt, just shown via
          // this same crosshair-hit chain now (spec二: "準心直接命中壁掛按
          // 鈕才可按E").
          this.hud.showInteractionPrompt(
            '呼叫載具',
            this.vehicleControlSystem.canCall ? '按 E 同時呼叫陸運與海運' : this.vehicleControlSystem.callBlockedMessage()
          );
        } else if (newTarget.id === VEHICLE_DEPART_BUTTON_ID) {
          this.hud.showInteractionPrompt(
            '載具出發',
            this.vehicleControlSystem.canDepart ? '按 E 讓兩台載具一起離場' : this.vehicleControlSystem.departBlockedMessage()
          );
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
    // Lost & found counter — empty-handed talk-only prompt (spec三 case3),
    // checked first since nothing else is targetable while standing there.
    if (this.lostFoundSystem.isNpcWaiting && this.lostFoundSystem.isPlayerNearCounter(this.camera.position)) {
      this.hud.showInteractionPrompt('失物招領櫃檯', 'E 交還失物／與顧客互動');
      this.hud.setCrosshairActive(true);
      return;
    }

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

    // This round's new mail stamp table (spec四) — a targeted-object crosshair
    // hit already covers "aim at a specific envelope"; this proximity check
    // covers "just standing at the table with a ready envelope", matching
    // the old envelope station's own pattern above.
    if (this.mailSystem.isPlayerNearTable(this.camera.position)) {
      if (this.mailSystem.readyEnvelopeId) {
        this.hud.showInteractionPrompt('信封貼郵票工作桌', '按 E 開始貼郵票');
        this.hud.setCrosshairActive(true);
      } else {
        this.hud.showInteractionPrompt('信封貼郵票工作桌', '請先將信封放到桌面');
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
