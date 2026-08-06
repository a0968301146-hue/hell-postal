import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../../shared/types/interactable';
// See vehicle-control-system.ts's identical import for why this depends on
// the neutral PickupPort contract rather than importing PickupSystem
// (systems/interaction) — avoids a file-level circular import through
// InteractionSystem, which depends on LostFoundSystem.
import { PickupPort } from '../../shared/types/pickup-port';
import {
  LOST_ITEM_PRESETS, LostItemPreset, LOST_FOUND_CASES, LostFoundCaseDef, LOST_FOUND_WRONG_ITEM_TEXT, LOST_FOUND_MISSED_TEXT,
  LOST_FOUND_SEEKING_TEXT, LOST_FOUND_CONTINUE_PROMPT, DECOY_LOST_ITEM_COUNT, DAILY_LOST_FOUND_NPC_COUNT, buildLostItemGeometry,
  pickRandomGreeting, pickRandomThanks, UNKNOWN_LOST_ITEM_DISPLAY_NAME, buildUnknownLostItemGeometry, buildUnknownLostItemMaterial,
  LOST_FOUND_NOT_CLEAN_TEXT,
} from './lost-found-data';
import { UNLOAD_PORTS, UNLOAD_SPAWN_JITTER_X, UNLOAD_SPAWN_JITTER_Z, UNLOAD_BURST_CONFIG } from '../daily-flow';
import { LostFoundUI } from './lost-found-ui';
import { LostFoundNpcSystem } from './lost-found-npc-system';
import { LostItemPreviewRenderer } from './lost-item-preview-renderer';
import { LostFoundCabinetSystem, computeLostItemFitScale } from './lost-found-cabinet-system';
import { LostFoundSettlementInput } from '../scoring/scoring-types';
import { logNpcEDebug } from '../interaction/npc-e-debug';

export const LOST_ITEM_ID_PREFIX = 'lostitem-';

/** How long a successfully-completed NPC lingers showing its thank-you text
 * before actually walking out ("Add sequential lost-found visitors and held
 * cargo feedback" round二: "NPC原地進入thanking 4秒...4秒後才離場"). */
const LOST_FOUND_THANKING_DURATION = 4;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function scaleExtents(e: { x: number; y: number; z: number }, s: number): { x: number; y: number; z: number } {
  return { x: e.x * s, y: e.y * s, z: e.z * s };
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** One NPC's own slot in today's queue ("Add sequential lost-found visitors
 * and held cargo feedback" round一/二) — 'queued' (not yet spawned) ->
 * 'entering' (walking in) -> 'greeting' (arrived, chit-chat + "按E繼續",
 * no item name/preview yet) -> 'waitingForItem' (item name+preview shown,
 * correct item + E hands it over) -> 'thanking' (item received, thank-you
 * text, 4 real seconds, no interaction possible) -> 'leaving' (walking out)
 * -> 'completed'|'missed' (fully gone). `targetItemId` is null until
 * spawnTodaysLostItems() actually spawns the physical item (all 3 targets
 * spawn together, independent of how far the queue itself has progressed —
 * see that method's own doc comment), and is set back to null once handed
 * over (disposeLostItem).
 *
 * `outcome` is set the INSTANT the result is actually decided — 'completed'
 * the moment a correct hand-over happens (entering the thanking stage,
 * well before the NPC physically finishes walking out), 'missed' the
 * instant settleAtDeparture ever has to force-dismiss a not-yet-successful
 * NPC — kept independent of `state` specifically so end-of-day tallying
 * (settleAtDeparture) can read a stable, unambiguous result regardless of
 * which of the two states ('leaving' — reachable via EITHER path — or
 * 'thanking') the animation happens to be in at that exact moment (spec:
 * "greeting／waitingForItem算未完成；thanking／leaving／completed算已完
 * 成"). null means not yet decided (queued/entering/greeting/waitingForItem
 * — always counted as missed if departure happens before it resolves). */
type LostFoundQueueState = 'queued' | 'entering' | 'greeting' | 'waitingForItem' | 'thanking' | 'leaving' | 'completed' | 'missed';
interface LostFoundQueueEntry {
  caseDef: LostFoundCaseDef;
  targetItemId: string | null;
  state: LostFoundQueueState;
  outcome: 'completed' | 'missed' | null;
}

/**
 * Owns the daily lost & found case flow ("Expand modular lost found NPC
 * flow" round 模組化: lost-found-system.ts — 每日生成、案件與交還流程).
 * Builds its own furniture (counter + the cell-grid storage cabinet, via
 * LostFoundCabinetSystem), same pattern as every other system in this
 * codebase building its own — structural room walls (incl. the NPC's own
 * west gate) stay in scene-manager.ts. Owns a LostFoundNpcSystem for the
 * NPC's entry/exit walk and a LostFoundCabinetSystem for storage-slot
 * detection but keeps all case/item knowledge here, mirroring the
 * CounterNpcSystem/CounterServiceSystem split.
 *
 * "Expand lost found return storage and scoring" round: the counter/NPC
 * side flipped 180° (spec一 — player now approaches from the EAST, NPC
 * waits on the WEST); the NPC's head bubble now shows the target item's
 * actual model preview via the ONE shared LostItemPreviewRenderer (spec
 * 二); E-key handling covers three cases — correct/wrong/empty-handed
 * (spec三) — via tryConfirmWithNpc(heldId: string | null); each day now
 * bursts in 1 target + DECOY_LOST_ITEM_COUNT decoy lost items (spec五),
 * every one auto-fit-scaled at spawn time so it can always physically fit
 * a cabinet cell (spec六); and settleAtDeparture() (renamed/extended from
 * the previous round's handleShippingStarted) freezes ONE settlement
 * snapshot — missed-interaction penalty AND lost-item storage penalty,
 * two independent line items (spec七/八) — at the exact moment 載具出發 is
 * pressed, read by VehicleControlSystem's onShippingStarted callback.
 */
export class LostFoundSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private pickupSystem: PickupPort;
  private ui: LostFoundUI;
  private npcSystem: LostFoundNpcSystem;
  private previewRenderer: LostItemPreviewRenderer;
  private cabinetSystem: LostFoundCabinetSystem;

  /** Today's fixed 3-NPC queue, in appearance order ("Add sequential
   * lost-found visitors and held cargo feedback" round一) — see
   * LostFoundQueueEntry's own doc comment for the per-entry state machine. */
  private todaysQueue: LostFoundQueueEntry[] = [];
  /** Index into todaysQueue of whichever entry is currently entering/
   * waiting/leaving — -1 whenever nobody is (before the day's first NPC
   * spawns, briefly between one NPC fully leaving and the next starting to
   * enter, or once all 3 are done). Spec: "場上任何時候最多只能有1位失物
   * NPC" — enforced structurally here since advanceQueue() only ever starts
   * the next entry once this is back to -1. */
  private activeIndex = -1;
  /** Counts down while the active entry is in 'thanking' (spec二: exactly
   * LOST_FOUND_THANKING_DURATION real seconds, no interaction, cannot be
   * skipped) — null whenever no entry is currently thanking. */
  private thankingTimer: number | null = null;
  /** This round's decoy items (spec一, still DECOY_LOST_ITEM_COUNT=5 total
   * per day) — never disposed intra-day (only a correctly-handed-over
   * target ever gets removed before day reset). */
  private todaysDecoyItemIds: string[] = [];
  private todaysTotalLostItemCount = 0;
  /** Set once settleAtDeparture() has already forced the (still-active, if
   * any) NPC to leave and frozen the day's missed count — guards against a
   * second 載具出發 press double-penalizing or double-dismissing (spec:
   * "settleAtDeparture永遠不阻止發車，但只套用一次結算"). */
  private settlementAppliedToday = false;
  private lostItemInstanceCounter = 0;
  /** "Add lost-found item cleaning system" round — the item's REAL data
   * (spec: "真正資料不能消失"), kept per interactable id from the moment it
   * spawns as a black-ball placeholder through to the moment it's cleaned.
   * Never touched by the mesh/material swap in revealLostItem() below —
   * only the placeholder's own geometry/material is display state; this map
   * is what `isClean===false` displays FROM once cleaned. */
  private lostItemPresets: Map<string, LostItemPreset> = new Map();
  /** isClean state (spec: "新增保存 isClean bool") — presence in this set
   * means the item has already been cleaned and is showing its real model;
   * absence (the default for every freshly-spawned id) means it's still the
   * black-ball placeholder. Kept here (not on the shared InteractableObject
   * type) mirroring LostFoundCabinetSystem's own itemToSlot side-table
   * convention for the same reason — purely this domain's own state, not a
   * generic interactable concern. */
  private cleanedItemIds: Set<string> = new Set();
  /** Counts down after onDailyUnloadStarted() before today's lost items
   * actually burst in — matches roughly how long UnloadingSystem's own
   * gate-open + charge-up takes (read-only from UNLOAD_PORTS/
   * UNLOAD_BURST_CONFIG, never modified), so they don't visually launch
   * through a still-closed port. null when no spawn is pending. */
  private lostItemSpawnTimer: number | null = null;

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>,
    pickupSystem: PickupPort, ui: LostFoundUI
  ) {
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;
    this.pickupSystem = pickupSystem;
    this.ui = ui;
    this.previewRenderer = new LostItemPreviewRenderer();
    // "Fix NPC direct interaction and pallet stack handling" round一/二:
    // no more counter/interaction-sensor to build here — the daily NPC
    // registers/unregisters its own raycast hitbox directly into
    // `interactables` as it spawns/despawns (see lost-found-npc-system.ts).
    this.npcSystem = new LostFoundNpcSystem(scene, this.previewRenderer, interactables);
    this.cabinetSystem = new LostFoundCabinetSystem(scene, physics, interactables, pickupSystem);
  }

  /** Draws DAILY_LOST_FOUND_NPC_COUNT (3) DISTINCT cases from the pool —
   * every LOST_FOUND_CASES entry maps to a different lostItemPresetId (see
   * that file's own doc comment), so any 3 distinct cases automatically
   * request 3 distinct items with no separate dedup check needed (spec一:
   * "不可有兩位NPC要求同一件物品"). Builds all 3 queue entries up front, all
   * 'queued' — advanceQueue() (called right after, from
   * onDailyUnloadStarted) is what actually starts the first one entering. */
  private prepareDailyCases(): void {
    const chosen = shuffle(LOST_FOUND_CASES).slice(0, DAILY_LOST_FOUND_NPC_COUNT);
    this.todaysQueue = chosen.map((caseDef) => ({ caseDef, targetItemId: null, state: 'queued' as const, outcome: null }));
    this.activeIndex = -1;
    this.thankingTimer = null;
  }

  /** Starts the NEXT still-'queued' entry entering, if nobody is currently
   * active (spec一: "場上任何時候最多只能有1位失物NPC" / "上一位完全離場後
   * 下一位才出現") — a no-op whenever activeIndex !== -1 (someone's still
   * entering/waiting/leaving) or every entry has already been dispatched.
   * The ONLY two callers are onDailyUnloadStarted (kicks off entry #1) and
   * update()'s own leaving->gone resolution (kicks off whichever is next),
   * so a new NPC only ever starts walking in from exactly one of those two
   * moments. */
  private advanceQueue(): void {
    if (this.activeIndex !== -1) return;
    const idx = this.todaysQueue.findIndex((e) => e.state === 'queued');
    if (idx === -1) return;
    this.activeIndex = idx;
    const entry = this.todaysQueue[idx];
    entry.state = 'entering';
    const preset = LOST_ITEM_PRESETS.find((p) => p.id === entry.caseDef.lostItemPresetId);
    if (preset) this.npcSystem.spawn(preset, entry.caseDef.customerName);
    this.refreshQueueStatusUI();
  }

  private refreshQueueStatusUI(): void {
    const completed = this.todaysQueue.filter((e) => e.state === 'completed').length;
    const currentPosition = this.activeIndex !== -1 ? this.activeIndex + 1 : null;
    this.ui.updateQueueStatus(completed, this.todaysQueue.length, currentPosition);
  }

  /** Wired into UnloadingSystem's existing onFirstUnload callback (game.ts)
   * — fires once, right as the daily unload burst begins. Prepares today's
   * 3-case queue and starts the first NPC entering, together, right here
   * (spec一: "每日按下卸貨按鈕→建立當日失物案件與失物→同時生成第1位NPC").
   * Also arms the lost items' own short burst-spawn delay, so the physical
   * targets + decoys still burst in from the north ports alongside the
   * regular cargo — independent of NPC queue progress (see
   * spawnTodaysLostItems's own doc comment). */
  onDailyUnloadStarted(): void {
    this.prepareDailyCases();
    this.lostItemSpawnTimer = UNLOAD_PORTS[0].gate.openDuration + UNLOAD_BURST_CONFIG.chargeUpDuration;
    this.advanceQueue();
  }

  /** Wired into VehicleControlSystem's onShippingStarted callback — fires
   * the instant the player presses 載具出發, well before the six vehicles
   * actually finish their multi-second departure animation. Builds and
   * returns ONE frozen LostFoundSettlementInput snapshot, covering two
   * INDEPENDENT line items:
   *   - missedCount: how many of today's 3 NPCs have no 'completed' outcome
   *     yet ("Add sequential lost-found visitors and held cargo feedback"
   *     round二/六: "greeting／waitingForItem算未完成...排隊中尚未出現的
   *     NPC仍各算一次漏接") — reads each entry's own `outcome` field, set
   *     the instant a hand-over actually succeeds, NOT the `state` string,
   *     so an entry already in 'thanking'/'leaving' still correctly counts
   *     as handed-over even though its exit walk hasn't finished yet (spec:
   *     "thanking／leaving／completed算已完成").
   *   - stored/unstored: how many of today's still-existing lost items
   *     (any not-yet-handed-over target, plus every decoy) are currently
   *     resting in a valid cabinet slot (spec: computed fresh every call,
   *     independent of missedCount).
   *
   * Never blocks departure — the six vehicles leave regardless either way.
   * The currently-active NPC is force-dismissed ONLY if it hasn't actually
   * succeeded yet (outcome still null — stuck in entering/greeting/
   * waitingForItem); an entry already in 'thanking'/'leaving' is left alone
   * to finish naturally, since its outcome is already locked in as
   * 'completed' — nothing forces an already-successful farewell to be cut
   * short. Guarded by settlementAppliedToday so a second 載具出發 press
   * can't re-dismiss an already-resolved NPC or double-count anything;
   * missedCount/handedOver/stored/unstored stay safe to recompute on every
   * call either way (pure reads). */
  settleAtDeparture(): LostFoundSettlementInput {
    if (!this.settlementAppliedToday) {
      this.settlementAppliedToday = true;
      if (this.activeIndex !== -1) {
        const entry = this.todaysQueue[this.activeIndex];
        if (entry.outcome === null) {
          if (this.npcSystem.state === 'waiting') {
            this.npcSystem.updateBubbleText(LOST_FOUND_MISSED_TEXT);
            this.npcSystem.startLeaving();
          } else if (this.npcSystem.state === 'walkingIn') {
            this.npcSystem.forceRemove();
          }
          entry.outcome = 'missed';
          entry.state = 'missed';
          this.activeIndex = -1;
          this.thankingTimer = null;
          this.refreshQueueStatusUI();
        }
      }
    }

    let missedCount = 0;
    let handedOver = 0;
    for (const entry of this.todaysQueue) {
      if (entry.outcome === 'completed') handedOver++;
      else missedCount++;
    }

    const remainingIds: string[] = [];
    for (const entry of this.todaysQueue) {
      if (entry.targetItemId) remainingIds.push(entry.targetItemId);
    }
    for (const id of this.todaysDecoyItemIds) {
      if (this.interactables.has(id)) remainingIds.push(id);
    }

    let stored = 0;
    for (const id of remainingIds) {
      if (this.cabinetSystem.isStored(id)) stored++;
    }
    const unstored = remainingIds.length - stored;

    return {
      missedCount,
      total: this.todaysTotalLostItemCount,
      handedOver,
      stored,
      unstored,
    };
  }

  /** Spawns all 3 of today's target items PLUS DECOY_LOST_ITEM_COUNT decoys
   * ("Add sequential lost-found visitors and held cargo feedback" round
   * 一, still fired once, off lostItemSpawnTimer, independent of how far
   * the NPC queue has progressed — a target item can burst into the world
   * well before its own NPC has even started walking in, exactly like the
   * old single-NPC flow did) — all excluded from CargoSystem/
   * DailyFlowSystem.registerDailyCargo, so the shared interactables map is
   * the ONLY place any of them exist, automatically excluding every one
   * from dailyCargoIds-driven daily total/vehicle cargoBounds scan/
   * unshipped scoring/day-reset cargo cleanup with zero extra guards needed
   * in any of those systems. Decoys are drawn from the preset pool MINUS
   * all 3 of today's targets, so they can never duplicate any of them;
   * drawing distinct presets (rather than the same one repeated) also means
   * they're never all identical to each other. */
  private spawnTodaysLostItems(): void {
    for (const entry of this.todaysQueue) {
      const preset = LOST_ITEM_PRESETS.find((p) => p.id === entry.caseDef.lostItemPresetId);
      if (preset) entry.targetItemId = this.spawnLostItem(preset, `target-${entry.caseDef.id}`);
    }

    const targetPresetIds = new Set(this.todaysQueue.map((e) => e.caseDef.lostItemPresetId));
    const decoyPool = LOST_ITEM_PRESETS.filter((p) => !targetPresetIds.has(p.id));
    const shuffled = shuffle(decoyPool);
    const decoyPresets = shuffled.slice(0, DECOY_LOST_ITEM_COUNT);
    this.todaysDecoyItemIds = decoyPresets.map((preset, i) => this.spawnLostItem(preset, `decoy${i}`));

    this.todaysTotalLostItemCount = this.todaysQueue.length + this.todaysDecoyItemIds.length;
  }

  private spawnLostItem(preset: LostItemPreset, idSuffix: string): string {
    const port = UNLOAD_PORTS[Math.floor(Math.random() * UNLOAD_PORTS.length)];
    const point = port.spawnPoints[Math.floor(Math.random() * port.spawnPoints.length)];
    const jitterX = (Math.random() - 0.5) * 2 * UNLOAD_SPAWN_JITTER_X;
    const jitterZ = (Math.random() - 0.5) * 2 * UNLOAD_SPAWN_JITTER_Z;
    const x = point.x + jitterX;
    const y = port.spawnY;
    const z = point.z + jitterZ;

    // Auto-fit: shrink the collider by the SAME factor revealLostItem() will
    // later apply to the real model's own visual size (spec六) — checked
    // here, at spawn time, so the physical collision body is sized to fit
    // the storage cabinet from the start, even though the REAL visual model
    // (see revealLostItem below) doesn't exist yet — only the black-ball
    // placeholder, whose own fixed size is entirely independent of this
    // preset's real dimensions (spec: "不要依照不同物品改變大小").
    const fitScale = computeLostItemFitScale(preset.visualHalfExtents);
    const collider = scaleExtents(preset.colliderHalfExtents, fitScale);

    const id = `${LOST_ITEM_ID_PREFIX}${idSuffix}-${this.lostItemInstanceCounter++}`;
    // "Add lost-found item cleaning system" round — every lost item spawns
    // as the SAME black-ball placeholder (spec: "生成Lost Item→建立黑色球
    // 體→保留真正Item ID→等待玩家清潔→完成後替換成真正模型"), never the real
    // buildLostItemGeometry(preset.shape, visual) result directly. The
    // collider below is STILL sized off the real preset's own (auto-fit)
    // extents — display state never affects physics/collision (spec: "不要
    // 修改...Collider/物理").
    const geo = buildUnknownLostItemGeometry();
    const mesh = new THREE.Mesh(geo, buildUnknownLostItemMaterial());
    mesh.position.set(x, y, z);
    this.scene.add(mesh);

    const obj = createInteractableObject(id, UNKNOWN_LOST_ITEM_DISPLAY_NAME, mesh, collider.x * 2, collider.y * 2, collider.z * 2);
    const { body, collider: physCollider } = this.physics.createBoxBody(x, y, z, collider.x, collider.y, collider.z, 35);
    obj.rigidBody = body;
    obj.collider = physCollider;
    this.lostItemPresets.set(id, preset);

    const forward = randRange(UNLOAD_BURST_CONFIG.forwardSpeedMin, UNLOAD_BURST_CONFIG.forwardSpeedMax);
    const up = randRange(UNLOAD_BURST_CONFIG.upSpeedMin, UNLOAD_BURST_CONFIG.upSpeedMax);
    const lateral = randRange(UNLOAD_BURST_CONFIG.lateralSpeedMin, UNLOAD_BURST_CONFIG.lateralSpeedMax);
    body.setLinvel({ x: lateral, y: up, z: forward }, true);
    const amax = UNLOAD_BURST_CONFIG.angularSpeedMax;
    body.setAngvel({
      x: (Math.random() - 0.5) * 2 * amax,
      y: (Math.random() - 0.5) * 2 * amax,
      z: (Math.random() - 0.5) * 2 * amax,
    }, true);

    this.interactables.set(id, obj);
    this.cabinetSystem.track(id);
    return id;
  }

  get isNpcWaiting(): boolean {
    return this.npcSystem.state === 'waiting';
  }

  /** True once today's 3-NPC queue has actually been built (spec: "尚未生成
   * 今日NPC時：請先開始今日工作") — the cheat button's own caller checks this
   * BEFORE calling completeAllNpcForTesting below, so the cheat never
   * silently generates today's content itself. */
  get hasTodaysQueue(): boolean {
    return this.todaysQueue.length > 0;
  }

  /** "Add lost-found item cleaning system" round — true once revealLostItem
   * below has already run for this id; false for every id that either isn't
   * a lost item at all or hasn't been cleaned yet. */
  isItemClean(id: string): boolean {
    return this.cleanedItemIds.has(id);
  }

  /** LostFoundCleaningSystem's own completion hook (the ONE call site) — an
   * in-place model swap (spec: "黑球直接變成真正模型，不要重新生成新的物
   * 件"), never a teardown/respawn: the SAME mesh keeps its rigidBody/
   * collider/id/interactables-map entry throughout, only `mesh.geometry`/
   * `mesh.material` (and `displayName`, so every existing HUD prompt call
   * site — pickup/hold/multi-carry, all already reading `obj.displayName`
   * directly — shows the real name with zero changes needed there) are
   * reassigned. Old placeholder geometry/material are disposed right after,
   * mirroring MailSystem.applyStamp's own established disposal discipline
   * for an in-place visual swap. Returns false (no-op) for an unknown id or
   * one already cleaned — idempotent by construction, so a caller never
   * needs its own extra guard. */
  revealLostItem(id: string): boolean {
    if (this.cleanedItemIds.has(id)) return false;
    const preset = this.lostItemPresets.get(id);
    const obj = this.interactables.get(id);
    if (!preset || !obj) return false;

    const fitScale = computeLostItemFitScale(preset.visualHalfExtents);
    const visual = scaleExtents(preset.visualHalfExtents, fitScale);

    const oldGeo = obj.mesh.geometry;
    const oldMat = obj.mesh.material as THREE.Material;
    obj.mesh.geometry = buildLostItemGeometry(preset.shape, visual);
    obj.mesh.material = new THREE.MeshStandardMaterial({ color: preset.color });
    oldGeo.dispose();
    oldMat.dispose();

    obj.displayName = preset.displayName;
    this.cleanedItemIds.add(id);
    return true;
  }

  /** TEMPORARY TEST CHEAT — remove before public demo. Force-completes
   * EVERY entry in today's queue as a successful hand-over (spec: "當日3位
   * NPC全部視為成功完成"), regardless of which stage each is currently in —
   * mirrors settleAtDeparture's own "force-dismiss whatever's currently
   * active" pattern but marks success instead of failure, and additionally
   * resolves every still-'queued' entry (never even spawned) straight to
   * 'completed' too, so no NPC needs a real visit for testing purposes.
   * Also clears every still-existing lost item (targets + decoys) so no
   * "unstored lost item" penalty applies either (settleAtDeparture's own
   * stored/unstored scan only ever considers items still present in
   * `interactables`/todaysDecoyItemIds). Removes the current NPC's own
   * model/hitbox/bubble immediately via the existing forceRemove() (no
   * walk-out animation), and resets activeIndex to -1 so update()'s own
   * leaving->gone auto-advance can never fire again afterward (spec: "不要
   * 生成下一位NPC後又重複完成") — the caller is expected to follow this with
   * ONE settleAtDeparture() call (the same real API normal departure uses)
   * to read back the resulting all-zero-missed snapshot; this method itself
   * never touches score. */
  completeAllNpcForTesting(): void {
    if (this.activeIndex !== -1) {
      const entry = this.todaysQueue[this.activeIndex];
      if (entry.outcome !== 'completed') {
        this.npcSystem.forceRemove();
        entry.outcome = 'completed';
      }
      entry.state = 'completed';
      this.activeIndex = -1;
      this.thankingTimer = null;
    }
    for (const entry of this.todaysQueue) {
      if (entry.outcome !== 'completed') entry.outcome = 'completed';
      entry.state = 'completed';
    }
    for (const entry of this.todaysQueue) {
      if (entry.targetItemId) this.disposeLostItem(entry.targetItemId);
    }
    for (const id of [...this.todaysDecoyItemIds]) {
      if (this.interactables.has(id)) this.disposeLostItem(id);
    }
    this.refreshQueueStatusUI();
  }

  /** Debug-only structured snapshot ("Trace and fix NPC E interaction
   * routing" round) — read by interaction-system.ts's own NPC-E tracer via
   * npc-e-debug.ts. Never used by real gameplay logic; a no-op cost when
   * DEBUG_NPC_E_INTERACTION is false (the caller gates the call itself). */
  debugSnapshot(): Record<string, unknown> {
    const entry = this.activeIndex !== -1 ? this.todaysQueue[this.activeIndex] : null;
    return {
      activeIndex: this.activeIndex,
      npcSystemState: this.npcSystem.state,
      isNpcWaiting: this.isNpcWaiting,
      entryCaseId: entry ? entry.caseDef.id : null,
      entryState: entry ? entry.state : null,
      entryTargetItemId: entry ? entry.targetItemId : null,
    };
  }

  /** Press E while aiming at the NPC's own interaction hitbox and the
   * CURRENT queue entry's NPC is physically waiting — behavior depends
   * entirely on the entry's own dialogue stage ("Fix NPC direct interaction
   * and pallet stack handling" round二, carried over from "Add sequential
   * lost-found visitors and held cargo feedback" round二). Caller
   * (interaction-system.ts) owns the raycast-hit/distance/activeTool/pause
   * gating — this method only ever judges the NPC's own dialogue stage:
   *   - 'greeting': the FIRST E press only advances to 'waitingForItem' and
   *     reveals the target's name+model preview (spec: "第一次按E只進入需
   *     求階段，不可直接交付") — fires regardless of what's held or even
   *     empty-handed, never completes a hand-over by itself.
   *   - 'waitingForItem': judged purely by id match against this entry's
   *     own spawned target item, so handing over ordinary cargo (or a
   *     decoy, or another entry's target) always reads as "wrong" with no
   *     separate "is this even a lost item" gate needed. heldId===targetId
   *     -> correct hand-over (removed from hand, world model/physics/
   *     interaction registration cleared, entry moves to 'thanking' with a
   *     locked-in 'completed' outcome, NPC's bubble swaps to a random
   *     thank-you — see LOST_FOUND_THANKING_DURATION). Any other non-null
   *     heldId -> refused, item stays held (never consumed), wrong-item
   *     hint shown. heldId===null -> no-op (bubble already shows the need).
   *   - 'entering'/'thanking'/'leaving': no-op entirely (spec:
   *     "thanking期間不可互動、不可跳過"). */
  tryConfirmWithNpc(heldId: string | null): void {
    const before = this.debugSnapshot();
    if (!this.isNpcWaiting || this.activeIndex === -1) {
      logNpcEDebug('LostFoundSystem.tryConfirmWithNpc', { heldId, before, result: 'no-op: not waiting or no active entry', after: this.debugSnapshot() });
      return;
    }
    const entry = this.todaysQueue[this.activeIndex];

    if (entry.state === 'greeting') {
      entry.state = 'waitingForItem';
      this.npcSystem.showItemNeed(LOST_FOUND_SEEKING_TEXT);
      logNpcEDebug('LostFoundSystem.tryConfirmWithNpc', { heldId, before, result: 'greeting -> waitingForItem', after: this.debugSnapshot() });
      return;
    }

    if (entry.state !== 'waitingForItem' || heldId === null) {
      logNpcEDebug('LostFoundSystem.tryConfirmWithNpc', { heldId, before, result: 'no-op: wrong stage or empty-handed', after: this.debugSnapshot() });
      return;
    }

    if (heldId === entry.targetItemId && !this.isItemClean(heldId)) {
      // "Add lost-found item cleaning system" round — the right item, but
      // still the black-ball placeholder (spec: "isClean==false 不得交
      // 件"). Refused exactly like a wrong item, but with its own distinct
      // message — the item stays held (never consumed), same as the wrong-
      // item branch below.
      this.ui.showWrong(LOST_FOUND_NOT_CLEAN_TEXT);
      logNpcEDebug('LostFoundSystem.tryConfirmWithNpc', { heldId, before, result: 'correct item but not clean yet', after: this.debugSnapshot() });
    } else if (heldId === entry.targetItemId) {
      this.pickupSystem.forceDropHeld();
      this.disposeLostItem(heldId);
      entry.state = 'thanking';
      entry.outcome = 'completed';
      this.thankingTimer = LOST_FOUND_THANKING_DURATION;
      this.npcSystem.updateBubbleText(pickRandomThanks());
      logNpcEDebug('LostFoundSystem.tryConfirmWithNpc', { heldId, before, result: 'waitingForItem -> thanking (correct item)', after: this.debugSnapshot() });
    } else {
      this.ui.showWrong(LOST_FOUND_WRONG_ITEM_TEXT);
      logNpcEDebug('LostFoundSystem.tryConfirmWithNpc', { heldId, before, result: 'wrong item, stays waitingForItem', after: this.debugSnapshot() });
    }
  }

  private disposeLostItem(id: string): void {
    const obj = this.interactables.get(id);
    if (!obj) return;
    this.scene.remove(obj.mesh);
    obj.mesh.geometry.dispose();
    (obj.mesh.material as THREE.Material).dispose();
    if (obj.rigidBody) this.physics.removeRigidBody(obj.rigidBody);
    this.interactables.delete(id);
    this.cabinetSystem.untrack(id);
    this.lostItemPresets.delete(id);
    this.cleanedItemIds.delete(id);
    const entry = this.todaysQueue.find((e) => e.targetItemId === id);
    if (entry) entry.targetItemId = null;
  }

  /** Wired into DailyFlowSystem's existing resetTools callback (game.ts) —
   * fires on every day transition. Clears whichever NPC is still active (if
   * any) and every still-existing lost item across the WHOLE queue (targets
   * + decoys — spec: "進入下一天時，清除尚未完成案件的NPC與失物"), resets
   * the cabinet's own slot occupancy, and resets every daily field for
   * tomorrow — a no-op for an already-completed entry's own target, since
   * disposeLostItem already cleared its targetItemId back to null when it
   * was handed over (decoys still get swept either way). */
  resetDaily(): void {
    this.npcSystem.forceRemove();
    for (const entry of this.todaysQueue) {
      if (!entry.targetItemId) continue;
      const obj = this.interactables.get(entry.targetItemId);
      if (obj) {
        // Force it out of the player's hands first, if they're still
        // holding it, so playerData doesn't dangle-reference the
        // about-to-be-deleted interactable.
        if (obj.isHeld) this.pickupSystem.forceDropHeld();
        this.disposeLostItem(entry.targetItemId);
      }
    }
    for (const id of this.todaysDecoyItemIds) {
      const obj = this.interactables.get(id);
      if (!obj) continue;
      if (obj.isHeld) this.pickupSystem.forceDropHeld();
      this.disposeLostItem(id);
    }
    this.cabinetSystem.resetDaily();
    this.todaysQueue = [];
    this.activeIndex = -1;
    this.thankingTimer = null;
    this.todaysDecoyItemIds = [];
    this.todaysTotalLostItemCount = 0;
    this.lostItemSpawnTimer = null;
    this.settlementAppliedToday = false;
    this.ui.hideQueueStatus();
  }

  update(deltaTime: number): void {
    this.npcSystem.update(deltaTime);
    this.cabinetSystem.update(deltaTime);

    // Resolve the active entry's own dialogue stage against the physical
    // NPC's walk animation and the thanking timer (spec一/二: sequencing
    // still driven by the SAME npcSystem this file already owned, not a
    // second movement system) — 'entering' becomes 'greeting' the moment
    // the NPC physically arrives (spec: "先顯示一段問候或閒聊"); 'thanking'
    // counts down for exactly LOST_FOUND_THANKING_DURATION real seconds
    // (spec: "4秒後才離場", no interaction possible in the meantime — see
    // tryConfirmWithNpc's own stage gate) before actually starting the
    // walk-out; 'leaving' resolves into its already-decided outcome
    // ('completed' or 'missed', see LostFoundQueueEntry's own doc comment)
    // ONLY once the NPC has fully walked out and despawned, at which point
    // the NEXT queued entry (if any) is free to start entering (spec: "上
    // 一位真正抵達出口並despawn後，才生成下一位").
    if (this.activeIndex !== -1) {
      const entry = this.todaysQueue[this.activeIndex];
      if (entry.state === 'entering' && this.npcSystem.state === 'waiting') {
        entry.state = 'greeting';
        this.npcSystem.updateBubbleText(`${pickRandomGreeting()}\n${LOST_FOUND_CONTINUE_PROMPT}`);
      } else if (entry.state === 'thanking' && this.thankingTimer !== null) {
        this.thankingTimer -= deltaTime;
        if (this.thankingTimer <= 0) {
          this.thankingTimer = null;
          entry.state = 'leaving';
          this.npcSystem.startLeaving();
        }
      } else if (entry.state === 'leaving' && this.npcSystem.state === 'gone') {
        entry.state = entry.outcome ?? 'missed';
        this.activeIndex = -1;
        this.refreshQueueStatusUI();
        this.advanceQueue();
      }
    }

    if (this.lostItemSpawnTimer !== null) {
      this.lostItemSpawnTimer -= deltaTime;
      if (this.lostItemSpawnTimer <= 0) {
        this.lostItemSpawnTimer = null;
        if (this.todaysQueue.length > 0) this.spawnTodaysLostItems();
      }
    }
  }
}
