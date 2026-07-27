import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../../shared/types/interactable';
// See vehicle-control-system.ts's identical import for why this depends on
// the neutral PickupPort contract rather than importing PickupSystem
// (systems/interaction) — avoids a file-level circular import through
// InteractionSystem, which depends on LostFoundSystem.
import { PickupPort } from '../../shared/types/pickup-port';
import { SCENE_CONFIG } from '../world-layout';
import {
  LOST_FOUND_ROOM, LOST_FOUND_COUNTER, LOST_FOUND_COUNTER_HALF_EXTENTS, LOST_FOUND_SHELF, LOST_FOUND_SHELF_HALF_EXTENTS,
} from '../../data/world/lost-found-layout-data';
import {
  LOST_ITEM_PRESETS, LostItemPreset, LOST_FOUND_CASES, LostFoundCaseDef, LOST_FOUND_WRONG_ITEM_TEXT, LOST_FOUND_MISSED_TEXT,
} from './lost-found-data';
import { UNLOAD_PORTS, UNLOAD_SPAWN_JITTER_X, UNLOAD_SPAWN_JITTER_Z, UNLOAD_BURST_CONFIG } from '../daily-flow';
import { createFloatingLabel } from '../../adapters/three/world-label-system';
import { LostFoundUI } from './lost-found-ui';
import { LostFoundNpcSystem } from './lost-found-npc-system';

const LOST_ITEM_ID_PREFIX = 'lostitem-';

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Non-box geometry per LostItemShape (spec六: "外形不能像一般箱子或包裹") —
 * a bounding-cuboid physics collider is still used underneath (spawnLostItemBurst
 * below), same convention this codebase already uses for every non-cuboid
 * prop; only the VISIBLE mesh needs to read as something other than a box. */
function buildLostItemGeometry(preset: LostItemPreset): THREE.BufferGeometry {
  const { x: hx, y: hy, z: hz } = preset.halfExtents;
  switch (preset.shape) {
    case 'staff':
      return new THREE.CylinderGeometry(hx * 0.6, hx, hy * 2, 8);
    case 'doll':
      return new THREE.CapsuleGeometry(hx, Math.max(hy * 2 - hx * 2, 0.05), 4, 8);
    case 'pot':
      return new THREE.CylinderGeometry(hx * 0.7, hx, hy * 2, 12);
    case 'instrument': {
      const r = Math.max(hx, hz);
      return new THREE.TorusGeometry(r * 0.7, r * 0.3, 8, 16);
    }
  }
}

/**
 * Owns the daily lost & found case flow ("Expand modular lost found NPC
 * flow" round 模組化: lost-found-system.ts — 每日生成、案件與交還流程).
 * Builds its own furniture (counter/shelf), same pattern as every other
 * system in this codebase building its own — structural room walls (incl.
 * the NPC's own west gate) stay in scene-manager.ts. Owns a
 * LostFoundNpcSystem for the NPC's entry/exit walk but keeps all case/item
 * knowledge here, mirroring the CounterNpcSystem/CounterServiceSystem
 * split.
 *
 * "Spawn lost found NPC during unloading and penalize missed interaction"
 * round: reacts to exactly TWO external events now — UnloadingSystem's
 * onFirstUnload callback (onDailyUnloadStarted, spawns the case+NPC
 * together) and VehicleControlSystem's onShippingStarted callback
 * (handleShippingStarted, settles the missed-interaction penalty) — rather
 * than polling DailyFlowSystem.state itself (spec四: "不要在多處輪詢每日流
 * 程"); no longer reacts to "all vehicles departed" at all (that USED to be
 * the NPC's own spawn trigger; it now only decides whether the day's
 * lost-found NPC ever got talked to). The lost item's own burst-spawn delay
 * timer below is a purely LOCAL countdown, not a poll of anything external
 * either.
 */
export class LostFoundSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private pickupSystem: PickupPort;
  private ui: LostFoundUI;
  private npcSystem: LostFoundNpcSystem;

  private todaysCase: LostFoundCaseDef | null = null;
  private todaysLostItemId: string | null = null;
  private npcSpawnedToday = false;
  private caseSolvedToday = false;
  /** Set true the first time the player presses E at the counter while the
   * NPC is waiting, regardless of what they're holding (spec二: "本輪『有互
   * 動』只代表玩家已與NPC對話並得知失物需求") — deliberately NOT the same
   * thing as caseSolvedToday (successfully handing over the correct item).
   * Read by handleShippingStarted() to decide whether 載具出發 owes a
   * missed-interaction penalty. */
  private lostFoundNpcInteractedToday = false;
  /** Set true once handleShippingStarted() has actually applied the
   * missed-interaction penalty for today — guards against a second
   * 載具出發 press (or any other future caller) double-penalizing or
   * double-dismissing the NPC. */
  private missedToday = false;
  private dayIndex = 0;
  private lostItemInstanceCounter = 0;
  /** Counts down after onDailyUnloadStarted() before the lost item actually
   * bursts in — matches roughly how long UnloadingSystem's own gate-open +
   * charge-up takes (read-only from UNLOAD_PORTS/UNLOAD_BURST_CONFIG, never
   * modified), so the item doesn't visually launch through a still-closed
   * port. null when no spawn is pending. */
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
    this.npcSystem = new LostFoundNpcSystem(scene);

    this.buildCounter();
    this.buildShelf();
  }

  private buildCounter(): void {
    const { x: hx, y: hy, z: hz } = LOST_FOUND_COUNTER_HALF_EXTENTS;
    const y = LOST_FOUND_ROOM.floorY + hy;
    const geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x7a5c3a }));
    mesh.position.set(LOST_FOUND_COUNTER.x, y, LOST_FOUND_COUNTER.z);
    this.scene.add(mesh);
    this.physics.createStaticCuboid(LOST_FOUND_COUNTER.x, y, LOST_FOUND_COUNTER.z, hx, hy, hz);

    // Raised back panel running the counter's full length, on its EAST edge
    // — a plain symmetric box has no visual "facing" of its own, so this
    // accent is what actually reads as "正面朝向東方" ("Adjust lost found
    // counter orientation" round一): the panel backs the NPC's own east
    // side, leaving the west (player) side an open desktop. Purely
    // decorative — the main counter collider above already covers this
    // footprint.
    const panelGeo = new THREE.BoxGeometry(0.05, 0.3, hz * 2);
    const panel = new THREE.Mesh(panelGeo, new THREE.MeshStandardMaterial({ color: 0x5a4028 }));
    panel.position.set(LOST_FOUND_COUNTER.x + hx - 0.03, y + hy + 0.15, LOST_FOUND_COUNTER.z);
    this.scene.add(panel);

    const label = createFloatingLabel('失物招領櫃檯', { width: 0.9, bg: 'rgba(30,25,20,0.75)' });
    label.position.set(LOST_FOUND_COUNTER.x, y + hy + 0.6, LOST_FOUND_COUNTER.z);
    this.scene.add(label);
  }

  /** Relocated into BACK_AREA's own package-sorting area, against a wall,
   * with open floor on every other side (spec一) — no items are pre-placed
   * on it anymore; the day's one real lost item instead bursts in from a
   * north unload port (spec六, see spawnLostItemBurst below). Purely a
   * themed landmark now. */
  private buildShelf(): void {
    const { x: hx, y: hy, z: hz } = LOST_FOUND_SHELF_HALF_EXTENTS;
    const y = LOST_FOUND_ROOM.floorY + hy; // BACK_AREA shares the same floor level
    const geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x5a4530 }));
    mesh.position.set(LOST_FOUND_SHELF.x, y, LOST_FOUND_SHELF.z);
    this.scene.add(mesh);
    this.physics.createStaticCuboid(LOST_FOUND_SHELF.x, y, LOST_FOUND_SHELF.z, hx, hy, hz);

    const label = createFloatingLabel('失物暫存架', { width: 0.85, bg: 'rgba(30,25,20,0.75)' });
    label.position.set(LOST_FOUND_SHELF.x, y + hy + 0.5, LOST_FOUND_SHELF.z);
    this.scene.add(label);
  }

  /** Picks the next case in rotation and advances dayIndex — the ONE place
   * this happens. Called from onDailyUnloadStarted() below, immediately
   * followed by spawnNpcForToday() — case and NPC are now always
   * established together, in the same call, so handleShippingStarted()
   * further down never needs its own fallback case-creation path. */
  private prepareDailyCase(): void {
    this.todaysCase = LOST_FOUND_CASES[this.dayIndex % LOST_FOUND_CASES.length];
    this.dayIndex++;
  }

  private spawnNpcForToday(): void {
    if (this.npcSpawnedToday || !this.todaysCase) return;
    this.npcSpawnedToday = true;
    const preset = LOST_ITEM_PRESETS.find((p) => p.id === this.todaysCase!.lostItemPresetId);
    this.npcSystem.spawn(preset?.displayName ?? '');
  }

  /** Wired into UnloadingSystem's existing onFirstUnload callback (game.ts)
   * — fires once, right as the daily unload burst begins. "Spawn lost found
   * NPC during unloading and penalize missed interaction" round: prepares
   * today's case AND spawns its NPC together, right here (spec一: "每日按下
   * 卸貨按鈕→建立當日失物案件與失物→同時生成當日唯一一名NPC") — the NPC no
   * longer waits for all six vehicles to depart. Also arms the lost item's
   * own short burst-spawn delay, so the physical item still bursts in from
   * a north port alongside the regular cargo. */
  onDailyUnloadStarted(): void {
    this.prepareDailyCase();
    this.lostItemSpawnTimer = UNLOAD_PORTS[0].gate.openDuration + UNLOAD_BURST_CONFIG.chargeUpDuration;
    this.spawnNpcForToday();
  }

  /** Wired into VehicleControlSystem's new onShippingStarted callback —
   * fires the instant the player presses 載具出發 (spec三), well before the
   * six vehicles actually finish their multi-second departure animation.
   * Returns whether a missed-interaction penalty is due so the caller can
   * fold it into the SAME departure settlement snapshot ScoringSystem
   * already builds — this method itself never touches score (spec: "接入
   * 現有ScoringSystem，不要在...LostFoundSystem各寫一份扣分").
   *
   * Never blocks departure — the six vehicles leave regardless either way
   * (spec三: "仍然允許六台載具正常出發/不阻擋發車"). If the player already
   * talked to the NPC (lostFoundNpcInteractedToday), this is a pure no-op:
   * no penalty, and the NPC/case are left completely alone so an
   * already-started hand-over can still finish later today (spec四: "已互動
   * 且案件未完成時，先保留NPC到當日結束"). */
  handleShippingStarted(): boolean {
    if (!this.todaysCase || this.missedToday || this.caseSolvedToday || this.lostFoundNpcInteractedToday) return false;
    this.missedToday = true;
    if (this.npcSystem.state === 'waiting') {
      this.npcSystem.updateBubbleText(LOST_FOUND_MISSED_TEXT);
      this.npcSystem.startLeaving();
    } else if (this.npcSystem.state === 'walkingIn') {
      this.npcSystem.forceRemove();
    }
    return true;
  }

  private spawnLostItemBurst(caseDef: LostFoundCaseDef): void {
    const preset = LOST_ITEM_PRESETS.find((p) => p.id === caseDef.lostItemPresetId);
    if (!preset) return;

    const port = UNLOAD_PORTS[Math.floor(Math.random() * UNLOAD_PORTS.length)];
    const point = port.spawnPoints[Math.floor(Math.random() * port.spawnPoints.length)];
    const jitterX = (Math.random() - 0.5) * 2 * UNLOAD_SPAWN_JITTER_X;
    const jitterZ = (Math.random() - 0.5) * 2 * UNLOAD_SPAWN_JITTER_Z;
    const x = point.x + jitterX;
    const y = port.spawnY;
    const z = point.z + jitterZ;

    const id = `${LOST_ITEM_ID_PREFIX}${preset.id}-${this.lostItemInstanceCounter++}`;
    const geo = buildLostItemGeometry(preset);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: preset.color }));
    mesh.position.set(x, y, z);
    this.scene.add(mesh);

    const { x: hx, y: hy, z: hz } = preset.halfExtents;
    const obj = createInteractableObject(id, preset.displayName, mesh, hx * 2, hy * 2, hz * 2);
    const { body, collider } = this.physics.createBoxBody(x, y, z, hx, hy, hz, 35);
    obj.rigidBody = body;
    obj.collider = collider;

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

    // Deliberately never registered with CargoSystem/DailyFlowSystem.
    // registerDailyCargo — the shared interactables map is the ONLY place
    // this item exists, so it's automatically excluded from
    // dailyCargoIds-driven daily total/vehicle cargoBounds scan/unshipped
    // scoring/day-reset cargo cleanup (spec六 exclusion list) with zero
    // extra guards needed in any of those systems.
    this.interactables.set(id, obj);
    this.todaysLostItemId = id;
  }

  get isNpcWaiting(): boolean {
    return this.npcSystem.state === 'waiting';
  }

  /** Player must be within range AND on the counter's west side — the NPC
   * always waits on the east side, so this is what actually enforces "玩家與
   * NPC互動時仍隔著櫃檯" ("Adjust lost found counter orientation" round
   * 一). */
  isPlayerNearCounter(pos: THREE.Vector3): boolean {
    const dx = pos.x - LOST_FOUND_COUNTER.x;
    const dz = pos.z - LOST_FOUND_COUNTER.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const onWestSide = pos.x < LOST_FOUND_COUNTER.x;
    return onWestSide && dist < SCENE_CONFIG.interactionDistance + 1;
  }

  /** Press E at the counter while holding ANYTHING, NPC waiting (spec七: 按
   * E將目前拿著的失物交給NPC) — correctness is judged purely by id match
   * against today's actual spawned lost item, so handing over ordinary
   * cargo (or the wrong day's leftover item, defensively) reads as a wrong
   * attempt exactly like the spec describes, with no separate "is this even
   * a lost item" gate needed.
   *
   * "Spawn lost found NPC during unloading and penalize missed interaction"
   * round: ANY press here — right item, wrong item, or empty-handed —
   * counts as "having talked to the NPC" (spec二: "本輪『有互動』只代表玩家
   * 已與NPC對話並得知失物需求"), set on the FIRST such press regardless of
   * whether the hand-over itself succeeds. This is deliberately NOT the
   * same thing as caseSolvedToday. */
  tryConfirmAtCounter(heldId: string): void {
    if (!this.isNpcWaiting || !this.todaysCase) return;
    this.lostFoundNpcInteractedToday = true;

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
    if (this.todaysLostItemId === id) this.todaysLostItemId = null;
  }

  /** Wired into DailyFlowSystem's existing resetTools callback (game.ts) —
   * fires on every day transition. Clears any NOT-yet-completed case's NPC
   * and lost item (spec七: "進入下一天時，清除尚未完成案件的NPC與失物") and
   * resets every daily flag for tomorrow, including
   * lostFoundNpcInteractedToday and missedToday (spec五: "進入隔天時清除...
   * lostFoundNpcInteractedToday/missed狀態/本日失物扣分防重複標記") — a
   * no-op for an already-solved case, since both case/item fields are
   * already null by then. */
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
    this.todaysCase = null;
    this.todaysLostItemId = null;
    this.lostItemSpawnTimer = null;
    this.npcSpawnedToday = false;
    this.caseSolvedToday = false;
    this.lostFoundNpcInteractedToday = false;
    this.missedToday = false;
  }

  update(deltaTime: number): void {
    this.npcSystem.update(deltaTime);

    if (this.lostItemSpawnTimer !== null) {
      this.lostItemSpawnTimer -= deltaTime;
      if (this.lostItemSpawnTimer <= 0) {
        this.lostItemSpawnTimer = null;
        if (this.todaysCase) this.spawnLostItemBurst(this.todaysCase);
      }
    }
  }
}
