import * as THREE from 'three';
import { PhysicsSystem } from './physics-system';
import { HUD } from './hud';
import { CargoSystem } from './cargo-system';
import { END_DAY_BUTTON_POS } from './daily-flow-data';
import { SCENE_CONFIG } from './scene-manager';
import { BACK_AREA } from './logistics-layout-data';
import { createFloatingLabel, updateFloatingLabel } from './world-label-system';

export type DailyState =
  | 'ready' | 'unloading' | 'sorting' | 'loading' | 'completed'
  | 'departing' | 'dayComplete' | 'resetting';

const IDLE_TEXT = '結束今天\n按 E 結束';
const BLOCKED_TEXT = '結束今天\n請先完成今日出貨';

/**
 * Owns the abstract "one day" state machine for the daily unload->sort->
 * ship-via-vehicle loop — currentDay/state/dailyCargoIds — plus the 結束
 * 今天 button, since pressing it is exactly what drives the state
 * transition this class is responsible for.
 *
 * remaining/organized/shipped counts are all DERIVED getters that re-scan
 * dailyCargoIds against CargoSystem's live CargoData each time they're
 * read, rather than separately-tracked counters that could drift out of
 * sync with the real per-item organized/shipped flags (which
 * PalletSystem/RollerRackSystem/VehicleControlSystem mutate directly) —
 * this sidesteps the whole class of double-count/stale-count bugs the spec
 * explicitly worries about, at the cost of an O(dailyCargoIds) scan per
 * read (10 items, negligible).
 *
 * Deliberately does NOT know how to spawn cargo or animate the gate
 * (UnloadingSystem's job), judge organized-ness (PalletSystem/
 * RollerRackSystem's job), or judge/pin/destroy shipped cargo
 * (VehicleControlSystem's job) — those systems call INTO this one
 * (registerDailyCargo/notifyUnloadingStarted/notifyUnloadingFinished/
 * notifyVehicleDocked/refreshCompletion/notifyDeparting/notifyDayComplete)
 * rather than this class reaching into them, keeping the state machine
 * itself the single source of truth for "what day is it / are we allowed
 * to X".
 */
export class DailyFlowSystem {
  currentDay = 1;
  state: DailyState = 'ready';
  dailyCargoIds: Set<string> = new Set();
  totalCargoCount = 0;
  hasUnloadedToday = false;

  private cargoSystem: CargoSystem;
  private hud: HUD;
  private resetTools: () => void;
  private onDayCompleted?: () => void;
  private buttonLabel!: THREE.Sprite;

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, cargoSystem: CargoSystem, hud: HUD,
    resetTools: () => void, onDayCompleted?: () => void
  ) {
    this.cargoSystem = cargoSystem;
    this.hud = hud;
    this.resetTools = resetTools;
    this.onDayCompleted = onDayCompleted;
    this.buildButton(scene, physics);
  }

  private buildButton(scene: THREE.Scene, physics: PhysicsSystem): void {
    const floorY = BACK_AREA.floorY;
    const postHeight = 0.9;
    const postGeo = new THREE.BoxGeometry(0.22, postHeight, 0.22);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(END_DAY_BUTTON_POS.x, floorY + postHeight / 2, END_DAY_BUTTON_POS.z);
    scene.add(post);

    const capGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.07, 12);
    const capMat = new THREE.MeshStandardMaterial({ color: 0xd83a3a });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.set(END_DAY_BUTTON_POS.x, floorY + postHeight + 0.02, END_DAY_BUTTON_POS.z);
    scene.add(cap);

    physics.createStaticCuboid(END_DAY_BUTTON_POS.x, floorY + postHeight / 2, END_DAY_BUTTON_POS.z, 0.11, postHeight / 2, 0.11);

    this.buttonLabel = createFloatingLabel(IDLE_TEXT, { width: 1.0, bg: 'rgba(45,20,20,0.75)' });
    this.buttonLabel.position.set(END_DAY_BUTTON_POS.x, floorY + postHeight + 0.5, END_DAY_BUTTON_POS.z);
    scene.add(this.buttonLabel);
  }

  /** Straight-line distance to this button — see UnloadingSystem's
   * buttonDistance doc comment for why (nearest-wins tie-break with the
   * nearby 開始卸貨 button). */
  buttonDistance(pos: THREE.Vector3): number {
    const dx = pos.x - END_DAY_BUTTON_POS.x;
    const dz = pos.z - END_DAY_BUTTON_POS.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  isPlayerNearButton(pos: THREE.Vector3): boolean {
    return this.buttonDistance(pos) < SCENE_CONFIG.interactionDistance + 1;
  }

  /** How many of today's cargo have organized === true. */
  get organizedCount(): number {
    let n = 0;
    for (const id of this.dailyCargoIds) {
      if (this.cargoSystem.getCargoData(id)?.organized) n++;
    }
    return n;
  }
  get unorganizedCount(): number {
    return this.totalCargoCount - this.organizedCount;
  }

  /** How many of today's cargo have shipped === true (i.e. riding in a
   * vehicle right now). */
  get shippedCount(): number {
    let n = 0;
    for (const id of this.dailyCargoIds) {
      if (this.cargoSystem.getCargoData(id)?.shipped) n++;
    }
    return n;
  }
  get remainingCargoCount(): number {
    return this.totalCargoCount - this.shippedCount;
  }
  get completedCargoCount(): number {
    return this.shippedCount;
  }

  get canEndDay(): boolean {
    return this.state === 'dayComplete';
  }

  endDayBlockedMessage(): string {
    return '請先完成今日出貨';
  }

  /** Called once by UnloadingSystem right as its spawn sequence begins. */
  notifyUnloadingStarted(): void {
    this.state = 'unloading';
    this.hasUnloadedToday = true;
  }

  /** Called once by UnloadingSystem's spawn sequence, passing every id it
   * just created (all of today's cargo must be registered here). */
  registerDailyCargo(ids: string[]): void {
    this.dailyCargoIds = new Set(ids);
    this.totalCargoCount = ids.length;
  }

  /** Called once by UnloadingSystem after the gate has closed again. */
  notifyUnloadingFinished(): void {
    if (this.state === 'unloading') this.state = 'sorting';
  }

  /** Called by VehicleControlSystem once at least one route reaches
   * 'docked' — the player can start loading into whichever vehicle has
   * already arrived, without waiting for both. */
  notifyVehicleDocked(): void {
    if (this.state === 'sorting') this.state = 'loading';
  }

  /** Called by VehicleControlSystem's per-frame shipment scan whenever a
   * cargo item's shipped flag flips (either direction) — re-derives
   * whether all daily cargo is now shipped, transitioning sorting/loading
   * -> completed, or reverting completed -> loading if something gets
   * pulled back out (spec: shipped 取消後 remainingCargoCount 要恢復). */
  refreshCompletion(): void {
    if (this.dailyCargoIds.size === 0) return;
    const allShipped = this.shippedCount >= this.totalCargoCount;
    if (allShipped && (this.state === 'loading' || this.state === 'sorting')) {
      this.state = 'completed';
    } else if (!allShipped && this.state === 'completed') {
      this.state = 'loading';
    }
  }

  /** Called by VehicleControlSystem once 載具出發 is actually pressed. */
  notifyDeparting(): void {
    this.state = 'departing';
  }

  /** Called by VehicleControlSystem once BOTH routes have finished
   * departing and their shipped cargo has been destroyed. */
  notifyDayComplete(): void {
    this.state = 'dayComplete';
  }

  pressEndDayButton(): void {
    if (!this.canEndDay) {
      updateFloatingLabel(this.buttonLabel, BLOCKED_TEXT);
      this.hud.showToast(this.endDayBlockedMessage());
      window.setTimeout(() => {
        if (this.state !== 'resetting') updateFloatingLabel(this.buttonLabel, IDLE_TEXT);
      }, 1500);
      return;
    }

    this.state = 'resetting';
    const finishedDay = this.currentDay;
    this.hud.showDayTransition(`第 ${finishedDay} 天完成`);

    // Any daily cargo id still present in CargoSystem at this point was
    // NEVER shipped — shipped items are already destroyed at departure
    // time by VehicleControlSystem.finishOneDeparture, so whatever's left
    // here is exactly "今日未出貨貨物" (spec三: "刪除所有未出貨的今日貨物
    // ...不得把未出貨貨物留到隔天"). removeCargo() tears down its mesh,
    // rigidBody/collider, and both the cargoDataMap and interactables
    // registrations in one call (cargo-system.ts) — nothing to leave
    // dangling for tomorrow's fresh batch to collide with.
    for (const id of this.dailyCargoIds) {
      if (this.cargoSystem.getCargoData(id)) this.cargoSystem.removeCargo(id);
    }

    this.currentDay++;
    this.dailyCargoIds = new Set();
    this.totalCargoCount = 0;
    this.hasUnloadedToday = false;
    this.resetTools();

    this.state = 'ready';
    this.onDayCompleted?.();
  }
}
