import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../../shared/types/interactable';
// See vehicle-control-system.ts's identical import for why this depends on
// the neutral PickupPort contract rather than importing PickupSystem
// (systems/interaction) — avoids a file-level circular import through
// InteractionSystem, which depends on LostFoundSystem.
import { PickupPort } from '../../shared/types/pickup-port';
import { SCENE_CONFIG } from '../world-layout';
import { LOST_FOUND_ROOM, LOST_FOUND_COUNTER, LOST_FOUND_COUNTER_HALF_EXTENTS } from '../../data/world/lost-found-layout-data';
import {
  LOST_ITEM_PRESETS, LostItemPreset, LOST_FOUND_CASES, LostFoundCaseDef, LOST_FOUND_WRONG_ITEM_TEXT, LOST_FOUND_MISSED_TEXT,
  DECOY_LOST_ITEM_COUNT, buildLostItemGeometry,
} from './lost-found-data';
import { UNLOAD_PORTS, UNLOAD_SPAWN_JITTER_X, UNLOAD_SPAWN_JITTER_Z, UNLOAD_BURST_CONFIG } from '../daily-flow';
import { createFloatingLabel } from '../../adapters/three/world-label-system';
import { LostFoundUI } from './lost-found-ui';
import { LostFoundNpcSystem } from './lost-found-npc-system';
import { LostItemPreviewRenderer } from './lost-item-preview-renderer';
import { LostFoundCabinetSystem, computeLostItemFitScale } from './lost-found-cabinet-system';
import { LostFoundSettlementInput } from '../scoring/scoring-types';

const LOST_ITEM_ID_PREFIX = 'lostitem-';

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function scaleExtents(e: { x: number; y: number; z: number }, s: number): { x: number; y: number; z: number } {
  return { x: e.x * s, y: e.y * s, z: e.z * s };
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
 * (spec三) — via tryConfirmAtCounter(heldId: string | null); each day now
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

  private todaysCase: LostFoundCaseDef | null = null;
  private todaysLostItemId: string | null = null;
  /** This round's decoy items (spec五) — never disposed intra-day (only the
   * correctly-handed-over target ever gets removed before day reset). */
  private todaysDecoyItemIds: string[] = [];
  private todaysTotalLostItemCount = 0;
  private npcSpawnedToday = false;
  private caseSolvedToday = false;
  /** Set true the first time the player presses E at the counter while the
   * NPC is waiting, regardless of what they're holding — including an
   * empty-handed "talk only" press (spec三 case3) — deliberately NOT the
   * same thing as caseSolvedToday. Read by settleAtDeparture() to decide
   * whether 載具出發 owes a missed-interaction penalty. */
  private lostFoundNpcInteractedToday = false;
  /** Set true once settleAtDeparture() has actually applied the
   * missed-interaction penalty for today — guards against a second
   * 載具出發 press double-penalizing or double-dismissing the NPC. */
  private missedToday = false;
  private dayIndex = 0;
  private lostItemInstanceCounter = 0;
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
    this.npcSystem = new LostFoundNpcSystem(scene, this.previewRenderer);
    this.cabinetSystem = new LostFoundCabinetSystem(scene, physics, interactables, pickupSystem);

    this.buildCounter();
  }

  private buildCounter(): void {
    const { x: hx, y: hy, z: hz } = LOST_FOUND_COUNTER_HALF_EXTENTS;
    const y = LOST_FOUND_ROOM.floorY + hy;
    const geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x7a5c3a }));
    mesh.position.set(LOST_FOUND_COUNTER.x, y, LOST_FOUND_COUNTER.z);
    this.scene.add(mesh);
    this.physics.createStaticCuboid(LOST_FOUND_COUNTER.x, y, LOST_FOUND_COUNTER.z, hx, hy, hz);

    // Raised back panel running the counter's full length, on its WEST edge
    // — a plain symmetric box has no visual "facing" of its own, so this
    // accent is what actually reads as "正面朝向西方" after the 180°
    // rotation ("Expand lost found return storage and scoring" round 一):
    // the panel backs the NPC's own west side, leaving the east (player)
    // side an open desktop. Purely decorative — the main counter collider
    // above already covers this footprint.
    const panelGeo = new THREE.BoxGeometry(0.05, 0.3, hz * 2);
    const panel = new THREE.Mesh(panelGeo, new THREE.MeshStandardMaterial({ color: 0x5a4028 }));
    panel.position.set(LOST_FOUND_COUNTER.x - hx + 0.03, y + hy + 0.15, LOST_FOUND_COUNTER.z);
    this.scene.add(panel);

    const label = createFloatingLabel('失物招領櫃檯', { width: 0.9, bg: 'rgba(30,25,20,0.75)' });
    label.position.set(LOST_FOUND_COUNTER.x, y + hy + 0.6, LOST_FOUND_COUNTER.z);
    this.scene.add(label);
  }

  /** Picks the next case in rotation and advances dayIndex — the ONE place
   * this happens. Called from onDailyUnloadStarted() below, immediately
   * followed by spawnNpcForToday() — case and NPC are now always
   * established together, in the same call, so settleAtDeparture() further
   * down never needs its own fallback case-creation path. */
  private prepareDailyCase(): void {
    this.todaysCase = LOST_FOUND_CASES[this.dayIndex % LOST_FOUND_CASES.length];
    this.dayIndex++;
  }

  private spawnNpcForToday(): void {
    if (this.npcSpawnedToday || !this.todaysCase) return;
    this.npcSpawnedToday = true;
    const preset = LOST_ITEM_PRESETS.find((p) => p.id === this.todaysCase!.lostItemPresetId);
    if (preset) this.npcSystem.spawn(preset);
  }

  /** Wired into UnloadingSystem's existing onFirstUnload callback (game.ts)
   * — fires once, right as the daily unload burst begins. Prepares today's
   * case AND spawns its NPC together, right here (spec一: "每日按下卸貨按鈕
   * →建立當日失物案件與失物→同時生成當日唯一一名NPC"). Also arms the lost
   * items' own short burst-spawn delay, so the physical target + decoys
   * still burst in from the north ports alongside the regular cargo. */
  onDailyUnloadStarted(): void {
    this.prepareDailyCase();
    this.lostItemSpawnTimer = UNLOAD_PORTS[0].gate.openDuration + UNLOAD_BURST_CONFIG.chargeUpDuration;
    this.spawnNpcForToday();
  }

  /** Wired into VehicleControlSystem's onShippingStarted callback — fires
   * the instant the player presses 載具出發 (spec三/七/八), well before the
   * six vehicles actually finish their multi-second departure animation.
   * Builds and returns ONE frozen LostFoundSettlementInput snapshot,
   * covering two INDEPENDENT line items (spec: "失物收納扣分與『未與NPC互
   * 動』扣分是兩條獨立項目"):
   *   - missed: the existing missed-interaction penalty (spec八 case一) —
   *     only true if the player never talked to the NPC at all today.
   *   - stored/unstored: how many of today's still-existing lost items
   *     (the target if not yet handed over, plus every decoy) are
   *     currently resting in a valid cabinet slot (spec七) — computed
   *     regardless of the missed/interacted/solved state, so e.g. an
   *     interacted-but-not-yet-returned case (spec八 case二) still gets its
   *     target counted here if left unstored.
   *
   * Never blocks departure — the six vehicles leave regardless either way.
   * If the player already talked to the NPC, `missed` stays false and the
   * NPC/case are left alone so an already-started hand-over can still
   * finish later today (spec八 case二: "已互動但尚未交還...NPC於發車結算時
   * 離開"). If truly missed, the NPC leaves via the west gate right here
   * and the case is marked missed, but the target item stays in the world
   * (spec八 case一: "目標失物留在場景中，仍可被失物收納結算檢查"). */
  settleAtDeparture(): LostFoundSettlementInput {
    let missed = false;
    if (this.todaysCase && !this.missedToday && !this.caseSolvedToday && !this.lostFoundNpcInteractedToday) {
      this.missedToday = true;
      missed = true;
      if (this.npcSystem.state === 'waiting') {
        this.npcSystem.updateBubbleText(LOST_FOUND_MISSED_TEXT);
        this.npcSystem.startLeaving();
      } else if (this.npcSystem.state === 'walkingIn') {
        this.npcSystem.forceRemove();
      }
    }

    const remainingIds: string[] = [];
    if (this.todaysLostItemId) remainingIds.push(this.todaysLostItemId);
    for (const id of this.todaysDecoyItemIds) {
      if (this.interactables.has(id)) remainingIds.push(id);
    }

    let stored = 0;
    for (const id of remainingIds) {
      if (this.cabinetSystem.isStored(id)) stored++;
    }
    const unstored = remainingIds.length - stored;

    return {
      missed,
      total: this.todaysTotalLostItemCount,
      handedOver: this.caseSolvedToday ? 1 : 0,
      stored,
      unstored,
    };
  }

  /** Spawns today's target item plus DECOY_LOST_ITEM_COUNT decoys (spec五)
   * — all excluded from CargoSystem/DailyFlowSystem.registerDailyCargo, so
   * the shared interactables map is the ONLY place any of them exist,
   * automatically excluding every one from dailyCargoIds-driven daily
   * total/vehicle cargoBounds scan/unshipped scoring/day-reset cargo
   * cleanup with zero extra guards needed in any of those systems. Decoys
   * are drawn from the preset pool MINUS today's actual target, so they can
   * never all duplicate it; drawing distinct presets (rather than the same
   * one repeated) also means they're never all identical to each other. */
  private spawnTodaysLostItems(caseDef: LostFoundCaseDef): void {
    const targetPreset = LOST_ITEM_PRESETS.find((p) => p.id === caseDef.lostItemPresetId);
    if (!targetPreset) return;

    this.todaysLostItemId = this.spawnLostItem(targetPreset, 'target');

    const decoyPool = LOST_ITEM_PRESETS.filter((p) => p.id !== caseDef.lostItemPresetId);
    const shuffled = [...decoyPool].sort(() => Math.random() - 0.5);
    const decoyPresets = shuffled.slice(0, DECOY_LOST_ITEM_COUNT);
    this.todaysDecoyItemIds = decoyPresets.map((preset, i) => this.spawnLostItem(preset, `decoy${i}`));

    this.todaysTotalLostItemCount = 1 + this.todaysDecoyItemIds.length;
  }

  private spawnLostItem(preset: LostItemPreset, idSuffix: string): string {
    const port = UNLOAD_PORTS[Math.floor(Math.random() * UNLOAD_PORTS.length)];
    const point = port.spawnPoints[Math.floor(Math.random() * port.spawnPoints.length)];
    const jitterX = (Math.random() - 0.5) * 2 * UNLOAD_SPAWN_JITTER_X;
    const jitterZ = (Math.random() - 0.5) * 2 * UNLOAD_SPAWN_JITTER_Z;
    const x = point.x + jitterX;
    const y = port.spawnY;
    const z = point.z + jitterZ;

    // Auto-fit: shrink both the visual model AND the collider by the SAME
    // factor if the raw preset would exceed 85% of a single cabinet cell's
    // interior (spec六) — checked here, at spawn time, so nothing ever
    // generates that can't physically fit into the storage cabinet, and the
    // physical collision body is never left oversized relative to what's
    // shown.
    const fitScale = computeLostItemFitScale(preset.visualHalfExtents);
    const visual = scaleExtents(preset.visualHalfExtents, fitScale);
    const collider = scaleExtents(preset.colliderHalfExtents, fitScale);

    const id = `${LOST_ITEM_ID_PREFIX}${idSuffix}-${this.lostItemInstanceCounter++}`;
    const geo = buildLostItemGeometry(preset.shape, visual);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: preset.color }));
    mesh.position.set(x, y, z);
    this.scene.add(mesh);

    const obj = createInteractableObject(id, preset.displayName, mesh, collider.x * 2, collider.y * 2, collider.z * 2);
    const { body, collider: physCollider } = this.physics.createBoxBody(x, y, z, collider.x, collider.y, collider.z, 35);
    obj.rigidBody = body;
    obj.collider = physCollider;

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

  /** Player must be within range AND on the counter's EAST side — the NPC
   * always waits on the west side after the 180° rotation ("Expand lost
   * found return storage and scoring" round一), so this is what actually
   * enforces "玩家與NPC互動時仍隔著櫃檯". */
  isPlayerNearCounter(pos: THREE.Vector3): boolean {
    const dx = pos.x - LOST_FOUND_COUNTER.x;
    const dz = pos.z - LOST_FOUND_COUNTER.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const onEastSide = pos.x > LOST_FOUND_COUNTER.x;
    return onEastSide && dist < SCENE_CONFIG.interactionDistance + 1;
  }

  /** Press E at the counter while the day's NPC is waiting (spec三) — three
   * independent cases, judged purely by id match against today's actual
   * spawned target item so handing over ordinary cargo (or a decoy, or the
   * wrong day's leftover item) always reads as "wrong" with no separate
   * "is this even a lost item" gate needed:
   *   1. heldId === todaysLostItemId — correct hand-over: removed from the
   *      player's hand, world model/physics/interaction registration
   *      cleared, case marked complete, NPC thanks and leaves.
   *   2. heldId is some OTHER id (wrong item, incl. ordinary cargo) — hand-
   *      over refused, item stays held (never consumed — no
   *      forceDropHeld()/disposeLostItem() call in this branch), shows the
   *      wrong-item hint.
   *   3. heldId === null (empty-handed) — counts only as talking to the
   *      NPC; the NPC's own head bubble already persistently shows its
   *      target item's name/preview while waiting, so nothing further is
   *      shown here and the case is NOT completed.
   * ANY of the three sets lostFoundNpcInteractedToday = true on this first
   * press, regardless of which case fired or whether it succeeded — this is
   * deliberately NOT the same thing as caseSolvedToday. */
  tryConfirmAtCounter(heldId: string | null): void {
    if (!this.isNpcWaiting || !this.todaysCase) return;
    this.lostFoundNpcInteractedToday = true;

    if (heldId === null) return;

    if (heldId === this.todaysLostItemId) {
      this.pickupSystem.forceDropHeld();
      this.disposeLostItem(heldId);
      this.npcSystem.updateBubbleText(this.todaysCase.successText);
      this.npcSystem.startLeaving();
      this.caseSolvedToday = true;
    } else {
      this.ui.showWrong(LOST_FOUND_WRONG_ITEM_TEXT);
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
    if (this.todaysLostItemId === id) this.todaysLostItemId = null;
  }

  /** Wired into DailyFlowSystem's existing resetTools callback (game.ts) —
   * fires on every day transition. Clears any NOT-yet-completed case's NPC
   * and every still-existing lost item (target + decoys — spec: "進入下一
   * 天時，清除尚未完成案件的NPC與失物"), resets the cabinet's own slot
   * occupancy, and resets every daily flag for tomorrow — a no-op for an
   * already-solved case's target, since todaysLostItemId is already null by
   * then (decoys still get swept either way). */
  resetDaily(): void {
    this.npcSystem.forceRemove();
    if (this.todaysLostItemId) {
      const obj = this.interactables.get(this.todaysLostItemId);
      if (obj) {
        // Force it out of the player's hands first, if they're still
        // holding it, so playerData doesn't dangle-reference the
        // about-to-be-deleted interactable.
        if (obj.isHeld) this.pickupSystem.forceDropHeld();
        this.disposeLostItem(this.todaysLostItemId);
      }
    }
    for (const id of this.todaysDecoyItemIds) {
      const obj = this.interactables.get(id);
      if (!obj) continue;
      if (obj.isHeld) this.pickupSystem.forceDropHeld();
      this.disposeLostItem(id);
    }
    this.cabinetSystem.resetDaily();
    this.todaysCase = null;
    this.todaysLostItemId = null;
    this.todaysDecoyItemIds = [];
    this.todaysTotalLostItemCount = 0;
    this.lostItemSpawnTimer = null;
    this.npcSpawnedToday = false;
    this.caseSolvedToday = false;
    this.lostFoundNpcInteractedToday = false;
    this.missedToday = false;
  }

  update(deltaTime: number): void {
    this.npcSystem.update(deltaTime);
    this.cabinetSystem.update(deltaTime);

    if (this.lostItemSpawnTimer !== null) {
      this.lostItemSpawnTimer -= deltaTime;
      if (this.lostItemSpawnTimer <= 0) {
        this.lostItemSpawnTimer = null;
        if (this.todaysCase) this.spawnTodaysLostItems(this.todaysCase);
      }
    }
  }
}
