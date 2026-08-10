import * as THREE from 'three';
import { InteractableObject, createInteractableObject } from '../../shared/types/interactable';
import { PlayerInteractionData } from '../../core/game-state';
import { HUD } from '../hud';
import { createFloatingLabel } from '../../adapters/three/world-label-system';
import { LOST_FOUND_ROOM } from '../../data/world/lost-found-layout-data';
import { WALL_THICKNESS } from '../world-layout';
import { ENABLE_COMPLETE_DAY_CHEAT } from '../../game/feature-flags';
// Imported directly from their own concrete files (not the '../interaction'
// barrel), mirroring pallet-system.ts's/after-work-story-system.ts's own
// established reasoning for the same import shape elsewhere in this
// codebase — avoids a real import cycle back through the interaction
// barrel (InteractionSystem itself will hold a reference to THIS class).
import { PickupSystem } from '../interaction/pickup-system';
import { PalletSystem } from '../pallet/pallet-system';
import { LadderSystem } from '../ladder/ladder-system';
import { EnvelopeStackSystem } from '../mail/envelope-stack-system';
import { CargoSystem } from '../cargo/cargo-system';
import { FrozenSettlementInput, createEmptyFrozenSettlementInput, tallyFrozenColdValue } from '../cargo/cold-value-data';
import { LiveSettlementInput, createEmptyLiveSettlementInput, tallyLiveCalmValue } from '../cargo/living-cargo-data';
import { DailyFlowSystem } from '../daily-flow/daily-flow-system';
import { MailSystem } from '../mail/mail-system';
import { MailBagSystem } from '../mail/mail-bag-system';
import { PackedMailBagSystem } from '../mail/packed-mail-bag-system';
import { EnvelopeDispatchMachineSystem } from '../mail/envelope-dispatch-machine-system';
import { LostFoundSystem } from '../lost-found/lost-found-system';
import { VehicleControlSystem } from '../vehicle/vehicle-control-system';
import { AfterWorkStorySystem } from '../story/after-work-story-system';
import { UnloadingSystem } from '../unloading/unloading-system';

/** TEMPORARY TEST CHEAT — remove before public demo. */
export const COMPLETE_DAY_CHEAT_BUTTON_ID = 'complete-day-cheat-button';
/** TEMPORARY TEST CHEAT (spec follow-up: "新增測試按鈕：直接跳至Day8"). */
export const JUMP_TO_DAY8_BUTTON_ID = 'jump-to-day8-button';

const BUTTON_WIDTH = 0.55;
const BUTTON_HEIGHT = 0.30;
const BUTTON_DEPTH = 0.08;
/** Suggested 1.1~1.3m off-floor mount height — center of that range. */
const BUTTON_CENTER_Y = LOST_FOUND_ROOM.floorY + 1.2;
const BUTTON_WALL_CLEARANCE = 0.08;
/** Centered along the room's own north wall (x -15..-10) — clear of the NPC
 * wait spot (x -12.5, z 16.5 — 2.4m further south, no overlap), the west
 * wall's own NPC gate, and the east-shared player door (see this file's own
 * class doc comment for the full space audit). */
const BUTTON_CENTER_X = (LOST_FOUND_ROOM.minX + LOST_FOUND_ROOM.maxX) / 2;
const northWallInnerFaceZ = LOST_FOUND_ROOM.minZ + WALL_THICKNESS / 2;
const BUTTON_CENTER_Z = northWallInnerFaceZ + BUTTON_WALL_CLEARANCE + BUTTON_DEPTH / 2;
/** Spec follow-up三: "[作弊完成今日] [跳至第八天]" side by side — offset
 * east along the same wall, well within LOST_FOUND_ROOM's own 5m width
 * (minX -15..maxX -10) with room to spare on both sides. */
const JUMP_BUTTON_CENTER_X = BUTTON_CENTER_X + BUTTON_WIDTH + 0.25;

const CHEAT_BUTTON_INTERACT_DISTANCE = 2.5;

const IDLE_TEXT = '測試用\n完成當日';
const ALREADY_DONE_TEXT = '本日工作已完成';
const NOT_STARTED_TEXT = '請先開始今日工作';
const PROMPT_TEXT = 'E 完成所有工作並結算';

const JUMP_IDLE_TEXT = '測試用\n跳至第八天';
const JUMP_PROMPT_TEXT = 'E 清除今日物件並跳至第八天';
const JUMP_BLOCKED_STORY_ACTIVE_TEXT = '請先完成目前的劇情';
const JUMP_BLOCKED_RESETTING_TEXT = '請稍候，今日流程正在處理中';

/**
 * "Add complete day testing cheat button" round — a single wall-mounted
 * test button in the lost-found room's own north wall (position/orientation
 * confirmed against CompassUI's own heading math, see this file's own doc
 * comment below) that instantly force-completes every piece of today's
 * cargo/mail/lost-found-NPC work through each owning system's REAL public
 * API (never fabricates a score or fakes CargoData.correctlyShipped
 * directly), then opens the SAME real day-complete settlement screen
 * (VehicleControlSystem.forceSettleDayForTesting, added this round)
 * normal 載具出發 would — the player still has to walk to the existing
 * 結束今天 button themselves afterward, which runs the SAME unmodified
 * end-of-day reset/day-advance/dock-story-trigger flow every normal day
 * already goes through.
 *
 * North-wall confirmation (spec一: "依Compass確認真正北牆，不要猜座標正
 * 負") — compass-ui.ts's own heading math is `atan2(forward.x, -forward.z)`,
 * confirming smaller/decreasing Z reads as North; world-layout-system.ts's
 * own buildLostFoundRoom() builds its `minZ` wall with an explicit `//
 * north` comment, matching exactly. LOST_FOUND_ROOM.minZ = 14 is therefore
 * genuinely the north wall, not a guess from either the coordinate's sign
 * or the variable's own name.
 *
 * Deliberately excluded requirement: the button's own Hitbox carries NO
 * physics Collider at all (spec: "不阻擋玩家移動") — only a real, visible
 * Mesh registered into the shared `interactables` map for the crosshair
 * raycast to hit; the wall behind it already blocks foot traffic from the
 * room side regardless.
 */
export class CompleteDayCheatSystem {
  private scene: THREE.Scene;
  private interactables: Map<string, InteractableObject>;
  private playerData: PlayerInteractionData;
  private hud: HUD;

  private pickupSystem: PickupSystem;
  private palletSystem: PalletSystem;
  private ladderSystem: LadderSystem;
  private envelopeStackSystem: EnvelopeStackSystem;
  private cargoSystem: CargoSystem;
  private dailyFlowSystem: DailyFlowSystem;
  private mailSystem: MailSystem;
  private mailBagSystem: MailBagSystem;
  private packedMailBagSystem: PackedMailBagSystem;
  private envelopeDispatchMachineSystem: EnvelopeDispatchMachineSystem;
  private lostFoundSystem: LostFoundSystem;
  private vehicleControlSystem: VehicleControlSystem;
  private afterWorkStorySystem: AfterWorkStorySystem;
  private unloadingSystem: UnloadingSystem;

  private buttonMesh: THREE.Mesh | null = null;
  private jumpButtonMesh: THREE.Mesh | null = null;

  /** Re-entrancy lock (spec五: "按鈕處理期間再次按E無效") — pressCheatButton
   * itself is fully synchronous today, but this guard stays cheap insurance
   * against any future async step being added without re-auditing the
   * re-entrancy story. Shared with pressJumpToDay8Button below — the two
   * buttons are never meant to run concurrently either. */
  private isExecuting = false;
  /** Which day the cheat has already successfully completed, if any (spec
   * 五: "同一天只能成功執行一次" / "completedCheatDayId") — compared against
   * DailyFlowSystem's own live `currentDay` on every press. */
  private completedCheatDayId: number | null = null;

  constructor(
    scene: THREE.Scene, interactables: Map<string, InteractableObject>,
    playerData: PlayerInteractionData, hud: HUD,
    pickupSystem: PickupSystem, palletSystem: PalletSystem, ladderSystem: LadderSystem,
    envelopeStackSystem: EnvelopeStackSystem, cargoSystem: CargoSystem, dailyFlowSystem: DailyFlowSystem,
    mailSystem: MailSystem, mailBagSystem: MailBagSystem, packedMailBagSystem: PackedMailBagSystem,
    envelopeDispatchMachineSystem: EnvelopeDispatchMachineSystem, lostFoundSystem: LostFoundSystem,
    vehicleControlSystem: VehicleControlSystem, afterWorkStorySystem: AfterWorkStorySystem,
    unloadingSystem: UnloadingSystem
  ) {
    this.scene = scene;
    this.interactables = interactables;
    this.playerData = playerData;
    this.hud = hud;
    this.pickupSystem = pickupSystem;
    this.palletSystem = palletSystem;
    this.ladderSystem = ladderSystem;
    this.envelopeStackSystem = envelopeStackSystem;
    this.cargoSystem = cargoSystem;
    this.dailyFlowSystem = dailyFlowSystem;
    this.mailSystem = mailSystem;
    this.mailBagSystem = mailBagSystem;
    this.packedMailBagSystem = packedMailBagSystem;
    this.envelopeDispatchMachineSystem = envelopeDispatchMachineSystem;
    this.lostFoundSystem = lostFoundSystem;
    this.vehicleControlSystem = vehicleControlSystem;
    this.afterWorkStorySystem = afterWorkStorySystem;
    this.unloadingSystem = unloadingSystem;

    // spec: "優先選擇完全不生成，而非生成但禁用" (same convention this
    // codebase already established for the pallet-inventory-expansion
    // skill's own second set) — when the flag is off, this button simply
    // never exists in the world at all.
    if (ENABLE_COMPLETE_DAY_CHEAT) {
      this.buildButton();
      this.buildJumpButton();
    }
  }

  private buildButton(): void {
    const geo = new THREE.BoxGeometry(BUTTON_WIDTH, BUTTON_HEIGHT, BUTTON_DEPTH);
    const mat = new THREE.MeshStandardMaterial({ color: 0xdd1111, emissive: 0x330000 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(BUTTON_CENTER_X, BUTTON_CENTER_Y, BUTTON_CENTER_Z);
    this.scene.add(mesh);
    this.buttonMesh = mesh;

    // Deliberately NO physics.createStaticCuboid call — spec: "按鈕Hitbox只
    // 負責準心Raycast，不阻擋玩家移動".

    const label = createFloatingLabel(IDLE_TEXT, { width: 0.7, bg: 'rgba(120,10,10,0.85)', fg: '#ffe14d' });
    label.position.set(BUTTON_CENTER_X, BUTTON_CENTER_Y + BUTTON_HEIGHT / 2 + 0.28, BUTTON_CENTER_Z);
    this.scene.add(label);

    const obj = createInteractableObject(
      COMPLETE_DAY_CHEAT_BUTTON_ID, '測試用完成當日按鈕', mesh, BUTTON_WIDTH, BUTTON_HEIGHT, BUTTON_DEPTH
    );
    this.interactables.set(COMPLETE_DAY_CHEAT_BUTTON_ID, obj);
  }

  /** Spec follow-up二/三: same wall, same mount height/depth, positioned
   * BUTTON_WIDTH + 0.25m east of the existing cheat button (see
   * JUMP_BUTTON_CENTER_X's own doc comment) so both render side by side in
   * the exact "[作弊完成今日] [跳至第八天]" order the spec asks for, sharing
   * this file's one visual style (same geometry/material/label styling). */
  private buildJumpButton(): void {
    const geo = new THREE.BoxGeometry(BUTTON_WIDTH, BUTTON_HEIGHT, BUTTON_DEPTH);
    const mat = new THREE.MeshStandardMaterial({ color: 0xdd1111, emissive: 0x330000 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(JUMP_BUTTON_CENTER_X, BUTTON_CENTER_Y, BUTTON_CENTER_Z);
    this.scene.add(mesh);
    this.jumpButtonMesh = mesh;

    const label = createFloatingLabel(JUMP_IDLE_TEXT, { width: 0.7, bg: 'rgba(120,10,10,0.85)', fg: '#ffe14d' });
    label.position.set(JUMP_BUTTON_CENTER_X, BUTTON_CENTER_Y + BUTTON_HEIGHT / 2 + 0.28, BUTTON_CENTER_Z);
    this.scene.add(label);

    const obj = createInteractableObject(
      JUMP_TO_DAY8_BUTTON_ID, '測試用跳至第八天按鈕', mesh, BUTTON_WIDTH, BUTTON_HEIGHT, BUTTON_DEPTH
    );
    this.interactables.set(JUMP_TO_DAY8_BUTTON_ID, obj);
  }

  isCheatButtonTarget(id: string): boolean {
    return ENABLE_COMPLETE_DAY_CHEAT && id === COMPLETE_DAY_CHEAT_BUTTON_ID;
  }

  isJumpButtonTarget(id: string): boolean {
    return ENABLE_COMPLETE_DAY_CHEAT && id === JUMP_TO_DAY8_BUTTON_ID;
  }

  /** ONE canonical judgment shared by the prompt display and the actual
   * E-press action (spec六: "提示與實際操作共用同一個Raycast Target...不使
   * 用房間距離Sensor代替準心命中") — both call sites (interaction-system.ts's
   * prompt-update loop and its onKeyDown handler) resolve the SAME
   * `currentTarget`/raycast hit id first, then ask this method whether
   * pressing E would actually do anything right now; distance is the only
   * thing checked here beyond the raycast having already hit the button at
   * all (spec: "最遠2.5m"). */
  canPressCheatButton(cameraPosition: THREE.Vector3): boolean {
    if (!this.buttonMesh) return false;
    return cameraPosition.distanceTo(this.buttonMesh.position) <= CHEAT_BUTTON_INTERACT_DISTANCE;
  }

  /** Same raycast-precise distance judgment as canPressCheatButton above,
   * for the new jump button (spec follow-up六 convention carried forward:
   * the prompt and the actual E-action must share this one judgment). */
  canPressJumpButton(cameraPosition: THREE.Vector3): boolean {
    if (!this.jumpButtonMesh) return false;
    return cameraPosition.distanceTo(this.jumpButtonMesh.position) <= CHEAT_BUTTON_INTERACT_DISTANCE;
  }

  /** Prompt text for whatever the current press WOULD do — read by
   * InteractionSystem so the on-screen hint always matches pressCheatButton
   * below's own actual outcome. */
  getPromptText(): string {
    if (this.completedCheatDayId === this.dailyFlowSystem.currentDay) return ALREADY_DONE_TEXT;
    if (!this.canStartCheat()) return NOT_STARTED_TEXT;
    return PROMPT_TEXT;
  }

  /** Mirrors getPromptText above for the jump button. Blocks mid-story
   * (afterWorkStorySystem.isActive) so jumping can't yank the player out
   * from underneath a currently-playing cutscene, and blocks mid-reset
   * (dailyFlowSystem.state === 'resetting') to avoid overlapping with the
   * real end-of-day flow if a normal departure happens to be resolving. */
  getJumpPromptText(): string {
    if (this.isExecuting || this.dailyFlowSystem.state === 'resetting') return JUMP_BLOCKED_RESETTING_TEXT;
    if (this.afterWorkStorySystem.isActive) return JUMP_BLOCKED_STORY_ACTIVE_TEXT;
    return JUMP_PROMPT_TEXT;
  }

  /** Whether today's content has even been generated yet (spec五: "尚未生成
   * 今日貨物／NPC時：請先開始今日工作" — the cheat must never quietly spawn
   * it itself). Mirrors DailyFlowSystem's own state machine: 'ready' means
   * 開始卸貨 hasn't been pressed yet; 'departing'/'dayComplete'/'resetting'
   * mean a real departure (or this same cheat) already resolved the day.
   * Reads DailyFlowSystem's own `hasUnloadedToday` flag (set the instant
   * 開始卸貨 fires, regardless of category) rather than
   * `lostFoundSystem.hasTodaysQueue` — Day8's own finale day (spec follow-
   * up: "除了巨大蛋糕之外，不要生成...失物招領物品") never populates a
   * lost-found queue at all, which would otherwise have made this always
   * return false and permanently disable the cheat button on that one day. */
  private canStartCheat(): boolean {
    const state = this.dailyFlowSystem.state;
    if (state === 'ready') return false;
    if (state === 'departing' || state === 'dayComplete' || state === 'resetting') return false;
    return this.dailyFlowSystem.hasUnloadedToday;
  }

  /** The cheat button's own E-action (spec二/三/四/五/六 in full). */
  pressCheatButton(): void {
    if (this.isExecuting) return;
    if (this.completedCheatDayId === this.dailyFlowSystem.currentDay) {
      this.hud.showToast(ALREADY_DONE_TEXT);
      return;
    }
    if (!this.canStartCheat()) {
      this.hud.showToast(NOT_STARTED_TEXT);
      return;
    }
    // A carried ladder has no safe public force-release API anywhere in
    // this codebase today (confirmed: LadderSystem has no resetToStart()/
    // forceRelease() equivalent, and isn't even wired into the real daily
    // reset) — refusing here rather than risking a stuck carry state is the
    // only in-scope-safe option (fixing that gap is outside this round's
    // own restricted file list).
    if (this.ladderSystem.isCarrying) {
      this.hud.showToast('請先放下手上的梯子');
      return;
    }

    this.isExecuting = true;
    try {
      this.clearHeldState();
      const { total: cargoTotal, frozen: frozenSettlement, live: liveSettlement } = this.completeCargo();
      const mailSettlement = this.completeMail();
      this.lostFoundSystem.completeAllNpcForTesting();
      const lostFoundSettlement = this.lostFoundSystem.settleAtDeparture();
      this.vehicleControlSystem.forceSettleDayForTesting(cargoTotal, lostFoundSettlement, mailSettlement, frozenSettlement, liveSettlement);
      this.completedCheatDayId = this.dailyFlowSystem.currentDay;
    } finally {
      this.isExecuting = false;
    }
  }

  /** spec六: safely cancel/return whatever the player currently holds
   * (cargo, envelope stack + its own Q-charge, pallet, placement preview)
   * BEFORE touching any daily state, and land the player back at a clean
   * empty-handed baseline. */
  private clearHeldState(): void {
    this.pickupSystem.cancelPlacement();
    this.pickupSystem.forceDropHeld();
    // Public, and already safely handles a currently-carried pallet
    // internally (forceReleaseToSafePosition) — the exact same method the
    // REAL daily reset already calls.
    this.palletSystem.resetToStart();
    // Clears stackIds/actionMode and un-holds playerData immediately; if a
    // Q-charge happens to be mid-hold, EnvelopeStackSystem's own update()
    // self-heals it the very next frame once isCarrying reads false (see
    // that class's own cancelCharge/update — no new public method needed).
    this.envelopeStackSystem.resetDaily();
    this.playerData.state = 'empty-handed';
    this.playerData.heldObjectId = null;
  }

  /** Spec follow-up二/三/四: the new "跳至第八天" button's own E-action —
   * resets prior-day logistics state, spawns the ordinary day-8 dock cargo
   * (the single giant cake item, E-only), THEN directly enters the Day8
   * finale itself so the tester can test the F-interactable cake/party/
   * campfire chain with no extra steps (spec follow-up's own "測試者必須能
   * 夠直接測試" requirement — pressCheatButton + pressEndDayButton are no
   * longer required first). resetForDayJumpTesting() clears BOTH guards
   * trigger() itself checks before it will fire a second time in the same
   * session: the persisted completedDays flag (real players are correctly
   * blocked from re-triggering an already-finished day forever) and the
   * in-memory `state` field getting stuck at 'finaleCredits' once a
   * playthrough reaches Day8's own ending (that branch never resets it,
   * since a real playthrough's only next step is resetForNewRun()'s own
   * full page reload). */
  pressJumpToDay8Button(): void {
    if (this.isExecuting) return;
    if (this.dailyFlowSystem.state === 'resetting') {
      this.hud.showToast(JUMP_BLOCKED_RESETTING_TEXT);
      return;
    }
    if (this.afterWorkStorySystem.isActive) {
      this.hud.showToast(JUMP_BLOCKED_STORY_ACTIVE_TEXT);
      return;
    }
    if (this.ladderSystem.isCarrying) {
      this.hud.showToast('請先放下手上的梯子');
      return;
    }

    this.isExecuting = true;
    try {
      this.clearHeldState();

      // Destroy every logistics object left over from whatever day we were
      // on (spec follow-up二: "清除前一天物流物件" — cargo/envelope/lost-found,
      // mesh/collider/rigidbody/interactable-registration/data all included,
      // via each owning system's own real teardown API — same methods the
      // REAL end-of-day reset already calls).
      for (const id of this.dailyFlowSystem.dailyCargoIds) {
        if (this.cargoSystem.getCargoData(id)) this.cargoSystem.removeCargo(id);
      }
      this.mailBagSystem.resetDaily();
      this.packedMailBagSystem.resetDaily();
      this.envelopeDispatchMachineSystem.resetDaily();
      this.envelopeStackSystem.resetDaily();
      this.mailSystem.resetDaily();
      this.lostFoundSystem.resetDaily();
      this.palletSystem.resetToStart();

      // Force the day counter directly (DailyFlowSystem's own fields are
      // all public, same as every other system this cheat already reaches
      // into) and land in 'ready' so unloadingSystem.pressButton() below is
      // willing to start a fresh spawn sequence.
      this.dailyFlowSystem.currentDay = 8;
      this.dailyFlowSystem.state = 'ready';
      this.dailyFlowSystem.dailyCargoIds = new Set();
      this.dailyFlowSystem.totalCargoCount = 0;
      this.dailyFlowSystem.hasUnloadedToday = false;
      this.completedCheatDayId = null;
      // "船運載具規格重製" round — this cheat bypasses the normal
      // DailyFlowSystem.pressEndDayButton()/resetTools sequence entirely
      // (it sets currentDay directly instead), so it must also explicitly
      // rebuild the vehicle roster here the same way that sequence would
      // have — otherwise whatever day's roster happened to be active before
      // the jump would incorrectly persist onto Day 8.
      this.vehicleControlSystem.resetForNewDay();

      // Bug fix (see this method's own doc comment above): clear whatever
      // stale persisted/in-session story-completion state might otherwise
      // block trigger(8) from ever firing again.
      this.afterWorkStorySystem.resetForDayJumpTesting();

      // Re-initialize Day8 state (spec follow-up二): resetGate() guarantees
      // a clean 'idle' phase regardless of what the gate was doing before,
      // then pressButton() starts the same real spawn pipeline every normal
      // day uses — buildDailyCargoManifest(8) is already gated (earlier
      // round) to return exactly the one giant cake and nothing else, so no
      // separate "spawn only the cake" logic is needed here. This is now the
      // ONLY cake that ever exists for Day8 ("Day8巨型蛋糕物流化" round —
      // AfterWorkStorySystem no longer spawns a separate decorative prop at
      // all); AfterWorkStorySystem.update() itself notices
      // dailyFlowSystem.currentDay === 8 the very next frame and starts
      // watching for this exact cargo item to be placed and unwrapped, with
      // zero further action needed from this button.
      this.unloadingSystem.resetGate();
      this.unloadingSystem.pressButton();

      this.hud.showToast('已跳至第八天，蛋糕正在卸貨中');
    } finally {
      this.isExecuting = false;
    }
  }

  /** spec二 items 1/6: every daily Cargo — credited via the exact `total`
   * ScoringSystem.settleDeparture's own `total`/`shippedCorrect` params
   * expect (spec: "全部視為送到正確載具...全部計入正常完成數量...不可重複計
   * 算"), then physically destroyed via CargoSystem's own existing public
   * removeCargo() (spec: "清除仍留在世界中的相關Mesh、RigidBody、Collider"). */
  private completeCargo(): { total: number; frozen: FrozenSettlementInput; live: LiveSettlementInput } {
    const total = this.dailyFlowSystem.totalCargoCount;
    // "Add freezer shelves and frozen cargo freshness system" round spec六
    // — read straight off each item's own CURRENT coldValue (whatever it
    // actually decayed/recovered to) BEFORE removeCargo() tears it down,
    // exactly mirroring the real departure scan's own tallying — never
    // fabricated as a flat 100% just because this is the test cheat.
    // "活物貨物系統" round spec六 — same convention for calmValue.
    const frozen = createEmptyFrozenSettlementInput();
    const live = createEmptyLiveSettlementInput();
    for (const id of this.dailyFlowSystem.dailyCargoIds) {
      const data = this.cargoSystem.getCargoData(id);
      if (!data) continue;
      if (data.category === 'frozen') tallyFrozenColdValue(frozen, data.coldValue);
      if (data.category === 'live') tallyLiveCalmValue(live, data.calmValue);
      this.cargoSystem.removeCargo(id);
    }
    return { total, frozen, live };
  }

  /** spec二 items 2-6: every single Envelope spawned today (dailyEnvelopeIds
   * already tracks every one of them individually regardless of which stage
   * of the pipeline it's currently in — loose, on the stamp table's
   * pending/completed/active slot, sitting in a dispatch-machine region
   * buffer, inside an open MailBagSystem box, or inside a fixed
   * PackedMailBag — so crediting this ONE flat list already satisfies "依
   * 實際Envelope數量計算，不可將整袋只算1封" with no separate per-bag
   * unwrapping needed). MailSystem.markEnvelopeShipped is the SAME (if
   * currently under-used) public API `settleAtDeparture`'s own doc comment
   * always described envelopes reaching 'shipped' through; calling it
   * directly here, then reading the REAL settleAtDeparture() tally back
   * (empty bag-id set — irrelevant once every envelope is already
   * 'shipped', since that branch is checked first), is the most direct real
   * API path available (see this round's own completion report for the
   * full trace confirming no bag-teleport-into-a-vehicle path exists to
   * reuse instead). Every mail-adjacent system's own resetDaily() then
   * clears the corresponding world objects — same idempotent methods the
   * REAL end-of-day reset already calls, safe to call again here early. */
  private completeMail(): { total: number; shipped: number; unshipped: number } {
    for (const id of this.mailSystem.dailyEnvelopeIds) {
      this.mailSystem.markEnvelopeShipped(id);
    }
    const settlement = this.mailSystem.settleAtDeparture(new Set());
    this.mailBagSystem.resetDaily();
    this.packedMailBagSystem.resetDaily();
    this.envelopeDispatchMachineSystem.resetDaily();
    this.mailSystem.resetDaily();
    return settlement;
  }
}
