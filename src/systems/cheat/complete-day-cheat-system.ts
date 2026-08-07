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

/** TEMPORARY TEST CHEAT — remove before public demo. */
export const COMPLETE_DAY_CHEAT_BUTTON_ID = 'complete-day-cheat-button';

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

const CHEAT_BUTTON_INTERACT_DISTANCE = 2.5;

const IDLE_TEXT = '測試用\n完成當日';
const ALREADY_DONE_TEXT = '本日工作已完成';
const NOT_STARTED_TEXT = '請先開始今日工作';
const PROMPT_TEXT = 'E 完成所有工作並結算';

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

  private buttonMesh: THREE.Mesh | null = null;

  /** Re-entrancy lock (spec五: "按鈕處理期間再次按E無效") — pressCheatButton
   * itself is fully synchronous today, but this guard stays cheap insurance
   * against any future async step being added without re-auditing the
   * re-entrancy story. */
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
    vehicleControlSystem: VehicleControlSystem
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

    // spec: "優先選擇完全不生成，而非生成但禁用" (same convention this
    // codebase already established for the pallet-inventory-expansion
    // skill's own second set) — when the flag is off, this button simply
    // never exists in the world at all.
    if (ENABLE_COMPLETE_DAY_CHEAT) this.buildButton();
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

  isCheatButtonTarget(id: string): boolean {
    return ENABLE_COMPLETE_DAY_CHEAT && id === COMPLETE_DAY_CHEAT_BUTTON_ID;
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

  /** Prompt text for whatever the current press WOULD do — read by
   * InteractionSystem so the on-screen hint always matches pressCheatButton
   * below's own actual outcome. */
  getPromptText(): string {
    if (this.completedCheatDayId === this.dailyFlowSystem.currentDay) return ALREADY_DONE_TEXT;
    if (!this.canStartCheat()) return NOT_STARTED_TEXT;
    return PROMPT_TEXT;
  }

  /** Whether today's content has even been generated yet (spec五: "尚未生成
   * 今日貨物／NPC時：請先開始今日工作" — the cheat must never quietly spawn
   * it itself). Mirrors DailyFlowSystem's own state machine: 'ready' means
   * 開始卸貨 hasn't been pressed yet; 'departing'/'dayComplete'/'resetting'
   * mean a real departure (or this same cheat) already resolved the day. */
  private canStartCheat(): boolean {
    const state = this.dailyFlowSystem.state;
    if (state === 'ready') return false;
    if (state === 'departing' || state === 'dayComplete' || state === 'resetting') return false;
    return this.lostFoundSystem.hasTodaysQueue;
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
