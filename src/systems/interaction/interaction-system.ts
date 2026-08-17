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
import { DollySystem } from '../dolly/dolly-system';
import { HUD } from '../hud';
import { PauseManager } from '../../core/pause-manager';
import { SettingsManager } from '../settings';
import { UnloadingSystem } from '../unloading';
import { PalletSystem } from '../pallet';
import { LostFoundSystem, LOST_FOUND_NPC_INTERACTABLE_ID } from '../lost-found';
import { MailSystem } from '../mail/mail-system';
import { MailBagSystem } from '../mail/mail-bag-system';
import { PackedMailBagSystem } from '../mail/packed-mail-bag-system';
import { EnvelopeDispatchMachineSystem } from '../mail/envelope-dispatch-machine-system';
import { EnvelopeStackSystem } from '../mail/envelope-stack-system';
import { getMailDestination } from '../mail/mail-data';
import { BULLETIN_BOARD_INTERACTABLE_ID, TELEVISION_INTERACTABLE_ID } from '../world-layout';
import { isNpcEDebugEnabled, logNpcEDebug } from './npc-e-debug';
// "Add ladder tool station and envelope vacuum" round — imported directly
// from their own system files, not a barrel, matching every other
// cross-system import in this file's own established convention.
import { LadderSystem } from '../ladder/ladder-system';
import { ToolStationSystem } from '../tool/tool-station-system';
import { CompleteDayCheatSystem } from '../cheat/complete-day-cheat-system';
// "新增兔子吉祥物" round — imported directly from its own system file (not a
// barrel), mirroring every other cross-system import in this file's own
// established convention (LadderSystem/ToolStationSystem/CompleteDayCheatSystem
// above).
import { MASCOT_INTERACTABLE_ID } from '../mascot/mascot-guide-system';

export class InteractionSystem {
  private raycaster: THREE.Raycaster;
  private camera: THREE.PerspectiveCamera;
  private interactables: Map<string, InteractableObject>;
  private playerData: PlayerInteractionData;
  private pickupSystem: PickupSystem;
  private hud: HUD;
  private currentTarget: InteractableObject | null = null;
  /** The raycast hit id from THIS frame's holding-item update() branch
   * ("Fix NPC direct interaction and pallet stack handling" round六) — the
   * pallet-carry/lost-found-handover checks below deliberately clear
   * `currentTarget` while holding something (it's reserved for the
   * multi-carry highlight), so onKeyDown can't read it for its own "what am
   * I aiming at right now" decision the way every other holding-item branch
   * does. This field is the fix: set once per frame from the SAME `hit`
   * the display logic already computed, so the action side and the display
   * side can never disagree about what's being aimed at (the actual bug
   * behind "掛回托盤提示顯示但按E無效" — see canStoreHeldPallet's own call
   * sites below). */
  private lastHoldingItemHitId: string | null = null;
  /** Companion to lastHoldingItemHitId, set at the exact same moment from
   * the exact same `hit` — "Trace and fix NPC E interaction routing" round
   * 三: isLostFoundNpcTarget() takes an InteractableObject, not a bare id
   * string, so this is the pre-resolved boolean the onKeyDown branch reads
   * instead of re-deriving it from a stale id comparison. */
  private lastHoldingItemHitIsNpc = false;
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
  private palletSystem: PalletSystem;
  private lostFoundSystem: LostFoundSystem;
  private mailSystem: MailSystem;
  private mailBagSystem: MailBagSystem;
  /** "Add regional envelope dispatch machine" round. */
  private packedMailBagSystem: PackedMailBagSystem;
  private envelopeDispatchMachineSystem: EnvelopeDispatchMachineSystem;
  /** "Add envelope stacks and expand pallet inventory" round. */
  private envelopeStackSystem: EnvelopeStackSystem;
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
  private ladderSystem: LadderSystem;
  private toolStationSystem: ToolStationSystem;
  /** Opens the tool cart's tool-loadout swap UI ("Add ladder tool station
   * and envelope vacuum" round三) — same plain-callback pattern as
   * onOpenUpgradeMenu/onOpenMediaPlayer above. */
  private onOpenToolLoadoutMenu: () => void;
  /** "Add complete day testing cheat button" round. */
  private completeDayCheatSystem: CompleteDayCheatSystem;
  /** Opens the rabbit mascot's own small floating guide panel ("新增兔子吉
   * 祥物" round) — same empty-handed-only priority pattern as
   * onOpenUpgradeMenu/onOpenMediaPlayer/onOpenToolLoadoutMenu above. */
  private onOpenMascotGuide: () => void;

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
    palletSystem: PalletSystem,
    lostFoundSystem: LostFoundSystem,
    mailSystem: MailSystem,
    mailBagSystem: MailBagSystem,
    packedMailBagSystem: PackedMailBagSystem,
    envelopeDispatchMachineSystem: EnvelopeDispatchMachineSystem,
    envelopeStackSystem: EnvelopeStackSystem,
    onStartMailStampUi: () => void,
    onOpenUpgradeMenu: () => void,
    onOpenMediaPlayer: () => void,
    ladderSystem: LadderSystem,
    toolStationSystem: ToolStationSystem,
    onOpenToolLoadoutMenu: () => void,
    completeDayCheatSystem: CompleteDayCheatSystem,
    onOpenMascotGuide: () => void,
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
    this.palletSystem = palletSystem;
    this.lostFoundSystem = lostFoundSystem;
    this.mailSystem = mailSystem;
    this.mailBagSystem = mailBagSystem;
    this.packedMailBagSystem = packedMailBagSystem;
    this.envelopeDispatchMachineSystem = envelopeDispatchMachineSystem;
    this.envelopeStackSystem = envelopeStackSystem;
    this.onStartMailStampUi = onStartMailStampUi;
    this.onOpenUpgradeMenu = onOpenUpgradeMenu;
    this.onOpenMediaPlayer = onOpenMediaPlayer;
    this.ladderSystem = ladderSystem;
    this.toolStationSystem = toolStationSystem;
    this.onOpenToolLoadoutMenu = onOpenToolLoadoutMenu;
    this.completeDayCheatSystem = completeDayCheatSystem;
    this.onOpenMascotGuide = onOpenMascotGuide;
    this.onDollyUsed = onDollyUsed;

    // "Fix trusted keyboard NPC interaction" round四: moved from
    // document/bubble to window/CAPTURE phase — capture always runs before
    // any bubble-phase listener anywhere in the tree (including this same
    // event's own target/bubble phases on canvas or any other element), so
    // this is now the FIRST handler to ever see a keydown, regardless of
    // where focus happens to be or what any other DOM node might do with
    // the event on the way up. Still the ONE and only E-key entry point —
    // no second listener was added anywhere.
    window.addEventListener('keydown', (e) => this.onKeyDown(e), { capture: true });
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
    // "Improve cargo hook aerial pickup" round spec一: right-click is now
    // the cargo hook's own fire trigger (see cargo-hook-system.ts's own
    // separate mousedown listener) — this existing mail-bag-envelope-take
    // action must not also fire while it's selected.
    if (this.playerData.activeTool === 'cargoHook') return;
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

  /** "Trace and fix NPC E interaction routing" round三: resolves "is this
   * target the lost-found NPC" from the hitbox mesh's OWN ownership data
   * (set once, at spawn, in lost-found-npc-system.ts), never by comparing a
   * raw id string against an imported constant — spec: "不要依Mesh名稱字串
   * 猜測NPC". Every prompt-display AND E-action call site below routes
   * through this SAME helper, so they can never disagree about what counts
   * as "aiming at the NPC". */
  private isLostFoundNpcTarget(target: InteractableObject | null): boolean {
    return !!target && target.mesh.userData.interactionType === 'lostFoundNpc';
  }

  /** Structured one-shot trace for a real KeyE press ("Fix trusted keyboard
   * NPC interaction" round) — gathers the full pipeline snapshot (raw
   * KeyboardEvent incl. isTrusted/isComposing, player/game/pause state,
   * this class's own raycast/target resolution, LostFoundSystem's own NPC/
   * queue state) BEFORE any guard has a chance to early-return, so a
   * stalled press is diagnosable regardless of which check stops it. Only
   * ever computed when isNpcEDebugEnabled() (the ?debugNpcE=1 URL param) is
   * true AND the physical key looks like the interact key — a plain
   * geometry/state read, no mutation. */
  private buildNpcEKeyTrace(event: KeyboardEvent): Record<string, unknown> {
    const freshHit = this.raycastCurrentHit();
    const activeEl = document.activeElement as HTMLElement | null;
    return {
      event: {
        key: event.key,
        code: event.code,
        isTrusted: event.isTrusted,
        isComposing: event.isComposing,
        keyCode: (event as unknown as { keyCode?: number }).keyCode,
        repeat: event.repeat,
        defaultPrevented: event.defaultPrevented,
        eventTarget: (event.target as HTMLElement | null)?.tagName ?? null,
        documentActiveElement: activeEl ? `${activeEl.tagName}${activeEl.id ? '#' + activeEl.id : ''}` : null,
        pointerLockElement: document.pointerLockElement ? (document.pointerLockElement as HTMLElement).tagName : null,
      },
      gameState: {
        pauseManagerIsPaused: this.pauseManager.isPaused,
        pauseReasons: (['manual', 'settlement', 'stampMinigame', 'upgradeMenu', 'mediaPlayerMenu'] as const).filter((r) => this.pauseManager.has(r)),
        activeTool: this.playerData.activeTool,
        playerState: this.playerData.state,
        heldObjectId: this.playerData.heldObjectId,
        heldStackLength: this.pickupSystem.heldCount,
      },
      interactionSystem: {
        currentTargetId: this.currentTarget ? this.currentTarget.id : null,
        lastHoldingItemHitId: this.lastHoldingItemHitId,
        freshRaycastHitId: freshHit ? freshHit.id : null,
        freshRaycastHitName: freshHit ? freshHit.displayName : null,
        npcHitboxKnownId: LOST_FOUND_NPC_INTERACTABLE_ID,
      },
      lostFoundSystem: this.lostFoundSystem.debugSnapshot(),
    };
  }

  private onKeyDown(event: KeyboardEvent): void {
    // Captured BEFORE any guard below can return early, so a trace exists
    // regardless of which check ends up stopping this press (spec: "按下E
    // 時，必須依順序記錄一次完整追蹤").
    const isELikeKey = event.code === 'KeyE';
    let npcTrace: Record<string, unknown> | null = isNpcEDebugEnabled() && isELikeKey ? this.buildNpcEKeyTrace(event) : null;
    const stopNpcTrace = (stoppedAt: string, extra?: Record<string, unknown>) => {
      if (!npcTrace) return;
      logNpcEDebug('InteractionSystem.onKeyDown', { ...npcTrace, stoppedAt, ...extra });
      npcTrace = null;
    };

    if (event.repeat) { stopNpcTrace('event.repeat === true (ignored)'); return; }
    if (!this.isLocked()) { stopNpcTrace('isLocked() === false'); return; }
    if (this.pauseManager.isPaused) { stopNpcTrace('pauseManager.isPaused === true'); return; }

    // F key: cycle a targeted OPEN mail bag's destination pattern (spec六),
    // or (legacy, dead while ENABLE_LEGACY_MAIL_FLOW is false) take an
    // envelope from the old crate.
    if (event.code === 'KeyF') {
      // "Improve cargo hook aerial pickup" round spec一: the cargo hook's
      // trigger moved to right-click — F is fully restored to this existing
      // handler regardless of which tool is selected.
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
    if (!bindings.matches('interact', event.code) && !bindings.matches('pickupPlace', event.code)) {
      stopNpcTrace('binding mismatch: neither interact nor pickupPlace bound to this event.code');
      return;
    }
    // "Fix trusted keyboard NPC interaction" round四: preventDefault ONLY
    // once we've confirmed this physical key IS a bound game action — never
    // globally for every keydown (spec: "只在確認是遊戲互動鍵後
    // preventDefault，不要對所有鍵盤輸入全域阻擋"). Guards against the
    // browser/OS routing an unhandled key through some other default
    // behavior (e.g. an IME's own composition handling) before this
    // handler's own game logic below gets to act on it.
    event.preventDefault();

    // "載具對話不鎖玩家" round — 'vehicle-dialogue' joins this block for the
    // exact same reason 'stamping-minigame' already does: a vehicle
    // dialogue box owns the E key while it's up (next line / end dialogue
    // only), so this system's own generic pickup/NPC/cheat-button E-actions
    // must stay out of the way — unlike 'stamping-minigame', this state is
    // deliberately never paired with setInputEnabled(false), so the player
    // can still walk/look around freely; only E-driven interactions are
    // blocked here.
    if (this.playerData.state === 'placement-preview' || this.playerData.state === 'stamping-minigame' || this.playerData.state === 'vehicle-dialogue') {
      stopNpcTrace(`state blocks: ${this.playerData.state}`);
      return;
    }

    // Pushing a dolly: E always means "let go", regardless of proximity —
    // checked before the empty-handed guard below since 'pushing-dolly' isn't 'empty-handed'.
    if (this.playerData.state === 'pushing-dolly') {
      stopNpcTrace('state === pushing-dolly (dolly release only)');
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
      // Rabbit mascot, same reasoning ("新增兔子吉祥物" round spec九: "避免
      // 玩家同時操作貨物" — E does nothing while holding anything).
      if (this.currentTarget && this.currentTarget.id === MASCOT_INTERACTABLE_ID) {
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
      // Also blocked while a pallet itself is the currently-held item
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
      const isHoldingPallet = this.palletSystem.isPalletId(this.playerData.heldObjectId ?? '');
      // Ladder, same reasoning as the pallet exclusion just above ("Add
      // ladder tool station and envelope vacuum" round一) — its own
      // world-space carry (ladder-system.ts) likewise writes
      // playerData.heldObjectId directly, never through PickupSystem's own
      // heldStack.
      const isHoldingLadder = this.ladderSystem.isCarrying;
      // Envelope stack, same reasoning as pallet/ladder just above ("Add
      // envelope stacks and expand pallet inventory" round) — its own
      // world-space carry (envelope-stack-system.ts) likewise writes
      // playerData.heldObjectId directly (a fixed sentinel, never a real
      // envelope id), never through PickupSystem's own heldStack.
      const isHoldingEnvelopeStack = this.envelopeStackSystem.isCarryingViaHeldId;
      if (
        this.currentTarget &&
        !isHoldingPallet &&
        !isHoldingLadder &&
        !isHoldingEnvelopeStack &&
        !this.palletSystem.isPalletId(this.currentTarget.id) &&
        !this.palletSystem.isRackId(this.currentTarget.id) &&
        !this.ladderSystem.isLadderTarget(this.currentTarget.id) &&
        !this.ladderSystem.isLadderRackTarget(this.currentTarget.id) &&
        this.currentTarget.id !== VEHICLE_CALL_BUTTON_ID && this.currentTarget.id !== VEHICLE_DEPART_BUTTON_ID &&
        !this.completeDayCheatSystem.isCheatButtonTarget(this.currentTarget.id) &&
        !this.completeDayCheatSystem.isJumpButtonTarget(this.currentTarget.id) &&
        !this.completeDayCheatSystem.isScoreButtonTarget(this.currentTarget.id) &&
        !this.completeDayCheatSystem.isJump4ButtonTarget(this.currentTarget.id) &&
        !this.isLostFoundNpcTarget(this.currentTarget) &&
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
      // live preview is valid, or stays held with a toast otherwise. Aiming
      // at the pallet's OWN matching, currently-empty wall rack slot instead
      // hangs it back up ("Rebuild pallet storage and reset upgrade
      // progression" round六: "按E將托盤吸附回slot") rather than placing it
      // on the floor — checked first since it's the more specific target.
      // "Fix NPC direct interaction and pallet stack handling" round六: reads
      // lastHoldingItemHitId (this frame's own raycast hit, set by update()
      // below) through the ONE canonical canStoreHeldPallet() judgment — NOT
      // this.currentTarget, which is deliberately never set to the rack id
      // while carrying a pallet (see the display logic below), the exact
      // mismatch that caused "提示顯示但按E無效". Both own playerData.state
      // /heldObjectId themselves on success, so there's nothing left to do
      // here either way.
      if (isHoldingPallet && this.playerData.heldObjectId) {
        if (this.lastHoldingItemHitId && this.palletSystem.canStoreHeldPallet(this.lastHoldingItemHitId)) {
          this.palletSystem.tryReturnToRack(this.lastHoldingItemHitId);
        } else {
          this.palletSystem.tryPlace();
        }
        return;
      }
      // Ladder: same "own world-space carry/place flow, second E either
      // hangs it back on its matching wall slot or commits the floor
      // placement" pattern as the pallet just above ("Add ladder tool
      // station and envelope vacuum" round一/二).
      if (isHoldingLadder) {
        if (this.lastHoldingItemHitId && this.ladderSystem.isLadderRackTarget(this.lastHoldingItemHitId) && this.ladderSystem.canReturnToRack()) {
          this.ladderSystem.tryReturnToRack();
        } else {
          this.ladderSystem.tryPlace();
        }
        return;
      }
      // Envelope stack: own world-space carry/place flow, same "dedicated
      // system, bypasses PickupSystem's generic path" pattern as the
      // pallet/ladder blocks just above ("Add envelope stacks and expand
      // pallet inventory" round一-四). Priority: hand off to the stamp table
      // if close enough (spec五, unstamped stacks only — canHandToTable
      // itself gates on that) — else gather more matching envelopes if
      // aiming at an eligible one (spec四, reads lastHoldingItemHitId, NOT
      // this.currentTarget, same reasoning as the pallet-rack-return fix
      // above) — else place the release-batch on the floor/surface ahead.
      if (isHoldingEnvelopeStack) {
        if (this.envelopeStackSystem.canHandToTable(this.camera.position)) {
          this.envelopeStackSystem.tryHandToTable(this.camera.position);
          return;
        }
        if (this.lastHoldingItemHitId && this.envelopeStackSystem.canPickUpTarget(this.lastHoldingItemHitId)) {
          this.envelopeStackSystem.pickUpTarget(this.lastHoldingItemHitId);
          return;
        }
        const fwd = new THREE.Vector3();
        this.camera.getWorldDirection(fwd);
        this.envelopeStackSystem.tryPlaceOnGround(this.camera.position, fwd);
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
      // Lost & found: hand over whatever's currently held, aimed directly at
      // the NPC's own interaction hitbox ("Fix NPC direct interaction and
      // pallet stack handling" round二: 移除失物招領櫃檯，直接瞄準NPC模型
      // 互動) — correctness (matching id vs anything else) is judged
      // entirely inside tryConfirmWithNpc, so this gate only needs "is the
      // crosshair actually on the NPC, and is someone there to hand it to" —
      // intercepts before the generic placement fallback below, same pattern
      // as the pallet/envelope-interior special cases above. Reads
      // lastHoldingItemHitId (this frame's raycast, set by update() below),
      // NOT this.currentTarget — matches the pallet-rack-return fix just
      // above for the same underlying reason.
      if (
        this.playerData.heldObjectId &&
        this.playerData.activeTool === 'empty' &&
        this.lastHoldingItemHitIsNpc &&
        this.lostFoundSystem.isNpcWaiting
      ) {
        const npcStateBefore = this.lostFoundSystem.debugSnapshot();
        this.lostFoundSystem.tryConfirmWithNpc(this.playerData.heldObjectId);
        stopNpcTrace('handled: holding-item NPC hand-over branch', { npcStateBefore, npcStateAfter: this.lostFoundSystem.debugSnapshot() });
        return;
      }
      // Normal: enter placement mode
      stopNpcTrace('holding-item: fell through to generic placement (not aimed at NPC)');
      this.pickupSystem.enterPlacementMode();
      return;
    }

    if (this.playerData.state !== 'empty-handed') {
      stopNpcTrace(`state !== empty-handed: ${this.playerData.state}`);
      return;
    }

    // Priority -1: bulletin board upgrade UI (spec二) — reads
    // PickupSystem's actual heldCount rather than trusting playerData.state
    // alone (spec二: "空手判定必須讀取PickupSystem實際持有數量
    // heldCount===0"), checked before every other empty-handed priority
    // since aiming at the board should never simultaneously trigger
    // anything else.
    if (this.currentTarget && this.currentTarget.id === BULLETIN_BOARD_INTERACTABLE_ID) {
      stopNpcTrace('diverted: currentTarget is bulletin board, not NPC');
      if (this.pickupSystem.heldCount === 0) {
        this.onOpenUpgradeMenu();
      }
      this.clearHighlight(this.currentTarget);
      this.currentTarget = null;
      return;
    }

    // Priority -0.95: rabbit mascot guide panel ("新增兔子吉祥物" round) —
    // same empty-handed-only pattern as the bulletin board just above.
    if (this.currentTarget && this.currentTarget.id === MASCOT_INTERACTABLE_ID) {
      stopNpcTrace('diverted: currentTarget is rabbit mascot, not NPC');
      if (this.pickupSystem.heldCount === 0) {
        // MascotGuideSystem attaches its OWN document-level keydown listener
        // (bubble phase) the moment open() runs below, and — unlike the
        // upgrade/media-player menus, which are mouse/Escape-only — its own
        // first-tier input also treats the SAME 'interact' binding as
        // "confirm highlighted option". Without stopping propagation here,
        // this single E press would open the panel AND immediately
        // auto-confirm category 0, since this listener runs first (capture
        // phase on window, ahead of the mascot's own bubble-phase listener
        // on document) and open() synchronously flips it to "categories"
        // before the event finishes propagating. Same race shape as the
        // ProtagonistDialogueSystem/AfterWorkStorySystem choice-autoconfirm
        // bug fixed earlier this project via stopImmediatePropagation.
        event.stopImmediatePropagation();
        this.onOpenMascotGuide();
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
      stopNpcTrace('diverted: currentTarget is television, not NPC');
      if (this.pickupSystem.heldCount === 0) {
        this.onOpenMediaPlayer();
      }
      this.clearHighlight(this.currentTarget);
      this.currentTarget = null;
      return;
    }

    // Priority 0: crosshair aimed directly at the lost-found NPC's own
    // interaction hitbox while empty-handed ("Fix NPC direct interaction and
    // pallet stack handling" round二: NPC counter removed, aim + E directly
    // at the model instead). Uses this.currentTarget, the same raycast
    // result the generic bottom section already resolved for highlighting/
    // prompting the hitbox — not-yet-arrived (still walking in/out) does
    // nothing since isNpcWaiting only becomes true once physically arrived.
    // Consumed here regardless of outcome so a registered-but-not-yet-
    // waiting hitbox never falls through into a generic pickup attempt.
    if (this.currentTarget && this.isLostFoundNpcTarget(this.currentTarget)) {
      const canInteract = this.playerData.activeTool === 'empty' && this.lostFoundSystem.isNpcWaiting;
      let handleInteractionCalled = false;
      const npcStateBefore = this.lostFoundSystem.debugSnapshot();
      if (canInteract) {
        handleInteractionCalled = true;
        this.lostFoundSystem.tryConfirmWithNpc(null);
      }
      stopNpcTrace('handled: empty-handed NPC priority-0 branch', { canInteract, handleInteractionCalled, npcStateBefore, npcStateAfter: this.lostFoundSystem.debugSnapshot() });
      this.clearHighlight(this.currentTarget);
      this.currentTarget = null;
      return;
    }

    // If we reach here on a real E press, currentTarget did NOT match the
    // NPC id at all (or was null) — the single most important trace point
    // for "raycast hit the NPC per the screenshot, but E did nothing": if
    // this fires, currentTargetId/freshRaycastHitId in the trace above
    // reveal exactly what InteractionSystem actually saw instead.
    stopNpcTrace('currentTarget did not match NPC id when reaching Priority 0.7+ (see currentTargetId/freshRaycastHitId)');


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

    // Priority 0.85: "完成當日" test cheat button (lost-found room north
    // wall — "Add complete day testing cheat button" round). Same
    // raycast-precise, canPickUp-only-for-the-filter pattern as the mail
    // rack/vehicle buttons just above; canPressCheatButton is the ONE
    // canonical judgment this same class's own prompt-update loop below
    // also reads, so the prompt and the actual E-press can never disagree
    // (spec六: "提示與實際操作共用同一個Raycast Target").
    if (this.currentTarget && this.completeDayCheatSystem.isCheatButtonTarget(this.currentTarget.id)) {
      if (this.completeDayCheatSystem.canPressCheatButton(this.camera.position)) {
        this.completeDayCheatSystem.pressCheatButton();
      }
      this.clearHighlight(this.currentTarget);
      this.currentTarget = null;
      return;
    }

    // Priority 0.86: "跳至第八天" test button — same shape as the cheat
    // button just above (spec follow-up三: placed right next to it).
    if (this.currentTarget && this.completeDayCheatSystem.isJumpButtonTarget(this.currentTarget.id)) {
      if (this.completeDayCheatSystem.canPressJumpButton(this.camera.position)) {
        this.completeDayCheatSystem.pressJumpToDay8Button();
      }
      this.clearHighlight(this.currentTarget);
      this.currentTarget = null;
      return;
    }

    // Priority 0.87: "+1000分" test button — same shape as the two cheat
    // buttons just above ("每日結算流程修改" round spec三).
    if (this.currentTarget && this.completeDayCheatSystem.isScoreButtonTarget(this.currentTarget.id)) {
      if (this.completeDayCheatSystem.canPressScoreButton(this.camera.position)) {
        this.completeDayCheatSystem.pressScoreButton();
      }
      this.clearHighlight(this.currentTarget);
      this.currentTarget = null;
      return;
    }

    // Priority 0.88: "跳至第四天" test button — same shape as the other
    // jump button above ("跳到第四天" round).
    if (this.currentTarget && this.completeDayCheatSystem.isJump4ButtonTarget(this.currentTarget.id)) {
      if (this.completeDayCheatSystem.canPressJump4Button(this.camera.position)) {
        this.completeDayCheatSystem.pressJumpToDay4Button();
      }
      this.clearHighlight(this.currentTarget);
      this.currentTarget = null;
      return;
    }

    // Priority 0.9: wall pallet racks, aimed at while empty-handed (nothing
    // to hang up) — canPickUp is only true to satisfy the raycast filter,
    // same reasoning as the mail rack/vehicle buttons above; intercepted
    // here purely so it can never fall into Priority 1's generic pickup
    // fallback below and fail there instead.
    if (this.currentTarget && this.palletSystem.isRackId(this.currentTarget.id)) {
      this.clearHighlight(this.currentTarget);
      this.currentTarget = null;
      return;
    }
    // Priority 0.91: wall ladder rack, same "nothing to hang up while
    // empty-handed" no-op as the pallet racks just above ("Add ladder tool
    // station and envelope vacuum" round一).
    if (this.currentTarget && this.ladderSystem.isLadderRackTarget(this.currentTarget.id)) {
      this.clearHighlight(this.currentTarget);
      this.currentTarget = null;
      return;
    }
    // Priority 0.92: immovable tool cart — aim + E opens the tool-loadout
    // swap UI (spec二/三), same "canPickUp only for the raycast filter,
    // never actually picked up" pattern as every other world-button dummy
    // target in this file.
    if (this.currentTarget && this.toolStationSystem.isToolStationTarget(this.currentTarget.id)) {
      if (this.pickupSystem.heldCount === 0 && this.playerData.state === 'empty-handed') {
        this.onOpenToolLoadoutMenu();
      }
      this.clearHighlight(this.currentTarget);
      this.currentTarget = null;
      return;
    }
    // Priority 0.93: envelope dispatch machine's own left-side pack button
    // ("Add regional envelope dispatch machine" round八) — same "canPickUp
    // only for the raycast filter, real action routed through its own
    // system" pattern as the tool cart just above. canPressPackButton owns
    // BOTH the distance (≤2.5m) and empty-handed gates, so a press that's
    // too far away or made while carrying something is silently ignored,
    // mirroring every other canX()/tryX() pair in this file.
    if (this.currentTarget && this.envelopeDispatchMachineSystem.isPackButtonTarget(this.currentTarget.id)) {
      if (this.envelopeDispatchMachineSystem.canPressPackButton(this.camera.position, this.pickupSystem.heldCount)) {
        this.envelopeDispatchMachineSystem.pressPackButton();
      }
      this.clearHighlight(this.currentTarget);
      this.currentTarget = null;
      return;
    }

    // Priority 1: pick up targeted object (envelope, package, crate, or a
    // sorting pallet — resting on the floor OR straight off its wall rack).
    // Pallets go through their own pickUp() (world-space group-carry, not
    // PickupSystem's viewmodel clone) — see pallet-system.ts. pickUp() owns
    // playerData.state/heldObjectId itself and positions the pallet in
    // front of the camera on this very first held frame. The ladder follows
    // the exact same pattern ("Add ladder tool station and envelope vacuum"
    // round一) — checked first since it never carries anything of its own.
    if (this.currentTarget) {
      if (this.palletSystem.isPalletId(this.currentTarget.id)) {
        const fwd = new THREE.Vector3();
        this.camera.getWorldDirection(fwd);
        this.palletSystem.pickUp(this.currentTarget.id, this.camera.position, fwd);
        this.clearHighlight(this.currentTarget);
        this.currentTarget = null;
        return;
      }
      if (this.ladderSystem.isLadderTarget(this.currentTarget.id)) {
        const fwd = new THREE.Vector3();
        this.camera.getWorldDirection(fwd);
        this.ladderSystem.pickUp(this.camera.position, fwd);
        this.clearHighlight(this.currentTarget);
        this.currentTarget = null;
        return;
      }
      // Envelope stack: empty-handed E on a loose envelope (or one
      // currently sitting in either stamp-table queue pile, spec七) starts
      // a new stack via EnvelopeStackSystem — same "checked before the
      // generic fallback" precedence as pallet/ladder just above ("Add
      // envelope stacks and expand pallet inventory" round一).
      if (this.envelopeStackSystem.canPickUpTarget(this.currentTarget.id)) {
        this.envelopeStackSystem.pickUpTarget(this.currentTarget.id);
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
    if (this.mailSystem.canStartMailTable(this.camera.position)) {
      // "Fix mail workbench envelope intake" round spec四B: empty-handed E
      // at the table first registers whatever unstamped envelopes are
      // physically sitting on the desk but not yet in pendingEnvelopeIds
      // (a no-op if there's nothing new — e.g. the pending-only case,
      // spec四C), THEN opens/resumes the stamp UI (which itself calls
      // MailSystem.advanceQueue() if nothing is active yet).
      this.mailSystem.scanDeskForUnregisteredEnvelopes();
      this.onStartMailStampUi();
      return;
    }

    // Priority 3: 開始卸貨 — "每日結算流程修改" round removed the co-located
    // 結束今天 button entirely (the day now advances automatically once the
    // day-complete summary is dismissed — see daily-flow-system.ts's own
    // advanceToNextDay doc comment), so this is a plain proximity check now.
    if (this.unloadingSystem.isPlayerNearButton(this.camera.position)) {
      this.unloadingSystem.pressButton();
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
    // "載具對話不鎖玩家" round — also skips this system's own per-frame
    // crosshair-highlight/prompt raycast while a vehicle dialogue box is
    // up: E is reserved for advancing/ending that dialogue, so showing an
    // unrelated "按 E 撿起"-style prompt for whatever the free-roaming
    // player happens to be looking at right now would be actively
    // misleading. Movement itself is untouched by this (see
    // VehicleNightCleaningSystem.beginDialogue's own doc comment — this
    // state is never paired with setInputEnabled(false)).
    if (this.playerData.state === 'stamping-minigame' || this.playerData.state === 'vehicle-dialogue') return;

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
      // "Fix NPC direct interaction and pallet stack handling" round六:
      // persisted so onKeyDown can read the SAME target this frame's display
      // logic resolved — see this field's own doc comment for why
      // this.currentTarget alone isn't reliable here (it's deliberately
      // cleared below for the pallet-carry/NPC-hitbox cases, which still
      // need their own aimed-at id available to the action side).
      this.lastHoldingItemHitId = hit ? hit.id : null;
      this.lastHoldingItemHitIsNpc = this.isLostFoundNpcTarget(hit);

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

      // Rabbit mascot while holding anything ("新增兔子吉祥物" round), same
      // pattern as the bulletin board/television just above.
      if (hit && hit.id === MASCOT_INTERACTABLE_ID) {
        if (this.currentTarget !== hit) {
          if (this.currentTarget) this.clearHighlight(this.currentTarget);
          this.applyHighlight(hit);
          this.currentTarget = hit;
          this.playerData.targetedObjectId = hit.id;
        }
        this.hud.showInteractionPrompt('兔子', '需空手才能找兔子聊聊');
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
        hit && !this.palletSystem.isPalletId(this.playerData.heldObjectId ?? '') && !this.ladderSystem.isCarrying &&
        !this.envelopeStackSystem.isCarryingViaHeldId &&
        !this.palletSystem.isPalletId(hit.id) && !this.palletSystem.isRackId(hit.id) &&
        !this.ladderSystem.isLadderTarget(hit.id) && !this.ladderSystem.isLadderRackTarget(hit.id) &&
        !this.toolStationSystem.isToolStationTarget(hit.id) &&
        !this.envelopeDispatchMachineSystem.isPackButtonTarget(hit.id) &&
        hit.id !== VEHICLE_CALL_BUTTON_ID && hit.id !== VEHICLE_DEPART_BUTTON_ID && !this.isLostFoundNpcTarget(hit) &&
        !this.completeDayCheatSystem.isCheatButtonTarget(hit.id) &&
        !this.completeDayCheatSystem.isJumpButtonTarget(hit.id) &&
        !this.completeDayCheatSystem.isScoreButtonTarget(hit.id) &&
        !this.completeDayCheatSystem.isJump4ButtonTarget(hit.id) &&
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
      if (this.playerData.heldObjectId && this.palletSystem.isPalletId(this.playerData.heldObjectId)) {
        // "Fix NPC direct interaction and pallet stack handling" round六:
        // canStoreHeldPallet(hit.id) is the ONE canonical judgment — the
        // ACTION side (onKeyDown, above) now reads the exact same function
        // against the exact same lastHoldingItemHitId this `hit` populates,
        // so the prompt and the actual E-press can never disagree again.
        if (hit && this.palletSystem.canStoreHeldPallet(hit.id)) {
          this.hud.showInteractionPrompt('整理托盤', 'E 掛回托盤');
          this.hud.setCrosshairActive(true);
        } else if (this.palletSystem.previewValid) {
          this.hud.showInteractionPrompt('整理托盤', 'E：放置整理托盤');
          this.hud.setCrosshairActive(true);
        } else {
          this.hud.showInteractionPrompt('整理托盤', '此處無法放置');
          this.hud.setCrosshairActive(false);
        }
      } else if (this.ladderSystem.isCarrying) {
        // Same "one canonical judgment shared by prompt and action" pattern
        // as the pallet block just above ("Add ladder tool station and
        // envelope vacuum" round一/二).
        if (hit && this.ladderSystem.isLadderRackTarget(hit.id) && this.ladderSystem.canReturnToRack()) {
          this.hud.showInteractionPrompt('木梯', 'E 收回梯子');
          this.hud.setCrosshairActive(true);
        } else if (this.ladderSystem.previewValid) {
          this.hud.showInteractionPrompt('木梯', 'E：放置梯子');
          this.hud.setCrosshairActive(true);
        } else {
          this.hud.showInteractionPrompt('木梯', '此處無法放置');
          this.hud.setCrosshairActive(false);
        }
      } else if (this.envelopeStackSystem.isCarryingViaHeldId) {
        // Same "one canonical judgment shared by prompt and action" pattern
        // as the pallet/ladder blocks just above ("Add envelope stacks and
        // expand pallet inventory" round). Priority mirrors onKeyDown's own:
        // hand-to-table, then gather-more, then generic place.
        if (this.envelopeStackSystem.canHandToTable(this.camera.position)) {
          this.hud.showInteractionPrompt('信件工作台', 'E 放入信件');
          this.hud.setCrosshairActive(true);
        } else if (hit && this.envelopeStackSystem.canPickUpTarget(hit.id)) {
          // "Make envelope pickup one at a time" round — every E press only
          // ever adds 1 envelope now, regardless of actionMode, so the
          // prompt is no longer mode-dependent (spec: "提示改為「E 拿起1封
          // 信」").
          this.hud.showInteractionPrompt(hit.displayName, 'E 拿起1封信');
          this.hud.setCrosshairActive(true);
        } else {
          this.hud.showInteractionPrompt('信封', 'E 放下　Q 丟出　F 切換模式');
          this.hud.setCrosshairActive(false);
        }
      } else if (this.playerData.heldObjectId && this.playerData.activeTool === 'empty' && hit && this.isLostFoundNpcTarget(hit)) {
        // "Fix NPC direct interaction and pallet stack handling" round二:
        // hand-over prompt while holding something and aiming directly at
        // the NPC's own hitbox — mirrors onKeyDown's own lastHoldingItemHitId
        // check just above (same `hit`, same frame).
        if (this.lostFoundSystem.isNpcWaiting) {
          this.hud.showInteractionPrompt(hit.displayName, 'E 交談');
          this.hud.setCrosshairActive(true);
        } else {
          this.hud.showInteractionPrompt(hit.displayName, '尚未抵達');
          this.hud.setCrosshairActive(false);
        }
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
        } else if (this.palletSystem.isPalletId(newTarget.id)) {
          // Covers both a floor-placed pallet AND one still mounted on its
          // wall rack (spec五: "按E後直接進入搬運狀態") — pickUp() itself
          // owns the actual power-gloves-equip/level gate and shows the
          // specific "需要裝備力量手套"/"力量手套尚無法搬動X型托盤" toast on
          // a failed attempt, so this prompt stays a plain, always-shown
          // hint rather than pre-computing that same gate twice.
          // "Fix NPC direct interaction and pallet stack handling" round四:
          // getRopeStrapPromptSuffix reads the SAME condition set F's own
          // handler checks (pallet-system.ts), appending "F 綁上固定繩"/
          // "F 解除固定繩" only when F would actually do something for THIS
          // exact pallet right now.
          this.hud.showInteractionPrompt(
            newTarget.displayName,
            'E：拿起整理托盤' + this.palletSystem.getRopeStrapPromptSuffix(newTarget.id)
          );
        } else if (this.palletSystem.isRackId(newTarget.id)) {
          // Empty-handed here (holding a pallet is handled entirely by the
          // holding-item branch above) — an empty rack has nothing to do
          // with E yet, just a neutral label so the crosshair highlight
          // isn't left captionless.
          this.hud.showInteractionPrompt(newTarget.displayName, '空掛架');
        } else if (this.ladderSystem.isLadderTarget(newTarget.id)) {
          // Covers both a floor-placed ladder AND one still folded on its
          // wall rack ("Add ladder tool station and envelope vacuum" round
          // 一/二) — canPickUp() itself owns the actual occupancy gate
          // (spec: "梯子上有玩家或任何Cargo時不可拿起"), so this prompt stays
          // a plain, always-shown hint.
          this.hud.showInteractionPrompt(newTarget.displayName, this.ladderSystem.canPickUp() ? 'E 取下梯子' : '梯子上有東西，無法拿起');
        } else if (this.ladderSystem.isLadderRackTarget(newTarget.id)) {
          // Empty-handed here (carrying the ladder is handled entirely by
          // the holding-item branch above) — same neutral "nothing to do
          // yet" label as the pallet racks just above.
          this.hud.showInteractionPrompt(newTarget.displayName, '空掛架');
        } else if (this.toolStationSystem.isToolStationTarget(newTarget.id)) {
          // Empty-handed-and-nothing-held-only ("Add ladder tool station
          // and envelope vacuum" round二: 工具推車互動不需要特定工具/手持狀
          // 態以外的額外判定) — mirrors the bulletin board/TV's own
          // "E opens a UI" pattern.
          this.hud.showInteractionPrompt(newTarget.displayName, this.pickupSystem.heldCount === 0 ? 'E 開啟工具配置' : '需空手才能使用');
        } else if (this.envelopeDispatchMachineSystem.isPackButtonTarget(newTarget.id)) {
          // "Add regional envelope dispatch machine" round八 — same
          // canPressPackButton() judgment the actual E-press uses (see
          // Priority 0.93 above), so the prompt and the action can never
          // disagree.
          const canPress = this.envelopeDispatchMachineSystem.canPressPackButton(this.camera.position, this.pickupSystem.heldCount);
          this.hud.showInteractionPrompt(newTarget.displayName, canPress ? 'E 打包信件' : '需空手且靠近按鈕');
        } else if (this.packedMailBagSystem.isBag(newTarget.id)) {
          // Crosshair inspect (spec十: "阿爾戈斯信封袋\n內含5封信\nE 拿起") — the
          // actual pickup itself needs no special-cased branch at all here;
          // it already falls through to Priority 1's fully generic
          // this.pickupSystem.pickUp(this.currentTarget) below, exactly like
          // any other plain single-mesh pickupable prop.
          const bag = this.packedMailBagSystem.getBag(newTarget.id)!;
          this.hud.showInteractionPrompt(newTarget.displayName, `內含${bag.envelopeCount}封信\nE 拿起`);
        } else if (this.mailSystem.getEnvelope(newTarget.id)) {
          // Crosshair inspect (spec三) — reuses this SAME raycast/prompt
          // path, no second raycasting system.
          const rec = this.mailSystem.getEnvelope(newTarget.id)!;
          const dest = getMailDestination(rec.destination);
          const regionText = dest.region === 'domestic' ? '國內' : '海外';
          const stampText = rec.state === 'unstamped' ? '未貼票' : '已貼票';
          this.hud.showInteractionPrompt(
            newTarget.displayName,
            `目的地：${dest.displayName}\n地區：${regionText}\n狀態：${stampText}\nE 拿起1封信`
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
        } else if (newTarget.id === MASCOT_INTERACTABLE_ID) {
          // Empty-handed here, same reasoning as the bulletin board/
          // television just above ("新增兔子吉祥物" round spec三).
          this.hud.showInteractionPrompt('兔子', 'E 找兔子聊聊');
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
        } else if (this.completeDayCheatSystem.isCheatButtonTarget(newTarget.id)) {
          // TEMPORARY TEST CHEAT — remove before public demo. Same crosshair-
          // hit-only prompt convention as the other wall buttons above; text
          // is centrally owned by CompleteDayCheatSystem.getPromptText() so
          // this branch and the actual E-action (onKeyDown) never disagree.
          this.hud.showInteractionPrompt(newTarget.displayName, this.completeDayCheatSystem.getPromptText());
        } else if (this.completeDayCheatSystem.isJumpButtonTarget(newTarget.id)) {
          // TEMPORARY TEST CHEAT — mirrors the branch just above, for the
          // new "跳至第八天" button (spec follow-up).
          this.hud.showInteractionPrompt(newTarget.displayName, this.completeDayCheatSystem.getJumpPromptText());
        } else if (this.completeDayCheatSystem.isScoreButtonTarget(newTarget.id)) {
          // TEMPORARY TEST CHEAT — mirrors the branches above, for the new
          // "+1000分" button ("每日結算流程修改" round spec三).
          this.hud.showInteractionPrompt(newTarget.displayName, this.completeDayCheatSystem.getScorePromptText());
        } else if (this.completeDayCheatSystem.isJump4ButtonTarget(newTarget.id)) {
          // TEMPORARY TEST CHEAT — mirrors the "跳至第八天" branch above, for
          // the new "跳至第四天" button ("跳到第四天" round).
          this.hud.showInteractionPrompt(newTarget.displayName, this.completeDayCheatSystem.getJump4PromptText());
        } else if (newTarget && this.isLostFoundNpcTarget(newTarget)) {
          // "Fix NPC direct interaction and pallet stack handling" round二:
          // crosshair directly on the NPC's own hitbox, empty-handed. Not-
          // yet-arrived (still walking in/out) shows a neutral "not here
          // yet" hint rather than the real E-prompt, matching onKeyDown's
          // own isNpcWaiting gate one section above.
          this.hud.showInteractionPrompt(newTarget.displayName, this.lostFoundSystem.isNpcWaiting ? 'E 交談' : '尚未抵達');
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

    // This round's new mail stamp table (spec四) — a targeted-object crosshair
    // hit already covers "aim at a specific envelope"; this proximity check
    // covers "just standing at the table with a ready envelope", matching
    // the old envelope station's own pattern above.
    if (this.mailSystem.isPlayerNearTable(this.camera.position)) {
      // "Fix mail workbench envelope intake" round spec三: the SAME
      // canStartMailTable judgment the E-press handler (onKeyDown, above)
      // reads, so the prompt and the actual action can never disagree —
      // true whenever something's active, pending already has envelopes, OR
      // at least one eligible envelope is sitting on the desk waiting to be
      // scanned in (onKeyDown's own scanDeskForUnregisteredEnvelopes call is
      // what actually registers it).
      if (this.mailSystem.canStartMailTable(this.camera.position)) {
        this.hud.showInteractionPrompt(
          '信封貼郵票工作桌',
          `待處理：${this.mailSystem.pendingCount}封／已完成：${this.mailSystem.completedCount}封\nE 開始／繼續貼郵票`
        );
        this.hud.setCrosshairActive(true);
      } else {
        this.hud.showInteractionPrompt('信封貼郵票工作桌', '請先將信封放到桌面');
        this.hud.setCrosshairActive(false);
      }
      return;
    }

    // 開始卸貨 button — "每日結算流程修改" round removed the co-located
    // 結束今天 button entirely (see daily-flow-system.ts's own doc comment),
    // so no nearest-button disambiguation is needed here anymore.
    if (this.unloadingSystem.isPlayerNearButton(this.camera.position)) {
      if (this.unloadingSystem.canStartUnloading) {
        this.hud.showInteractionPrompt('開始卸貨', '按 E 開始卸貨');
        this.hud.setCrosshairActive(true);
      } else {
        this.hud.showInteractionPrompt('開始卸貨', this.unloadingSystem.startBlockedMessage());
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
