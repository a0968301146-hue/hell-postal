import * as THREE from 'three';
import { PhysicsSystem } from './physics-system';
import { HUD } from './hud';
import { END_DAY_BUTTON_POS } from './daily-flow-data';
import { SCENE_CONFIG } from './scene-manager';
import { BACK_AREA } from './logistics-layout-data';
import { createFloatingLabel, updateFloatingLabel } from './world-label-system';

export type DailyState = 'ready' | 'unloading' | 'sorting' | 'completed' | 'resetting';

const IDLE_TEXT = '結束今天\n按 E 結束';
const BLOCKED_TEXT = '結束今天\n請先清空今日所有貨品';

/**
 * Owns the abstract "one day" state machine for the daily unload->sort->ship
 * loop (spec "每日貨品清空核心流程" section 七) — currentDay/state/counts/
 * dailyCargoIds — plus the 結束今天 button, since pressing it is exactly
 * what drives the state transition this class is responsible for.
 *
 * Deliberately does NOT know how to spawn cargo or animate the gate
 * (UnloadingSystem's job) or judge organized-ness (PalletSystem/
 * RollerRackSystem's job) or remove shipped cargo (OutboundZoneSystem's
 * job) — those systems call INTO this one (registerDailyCargo/
 * notifyUnloadingStarted/notifyUnloadingFinished/markCompleted) rather than
 * this class reaching into them, keeping the state machine itself the
 * single source of truth for "what day is it / are we allowed to X".
 */
export class DailyFlowSystem {
  currentDay = 1;
  state: DailyState = 'ready';
  dailyCargoIds: Set<string> = new Set();
  totalCargoCount = 0;
  remainingCargoCount = 0;
  completedCargoCount = 0;
  hasUnloadedToday = false;

  private hud: HUD;
  private resetTools: () => void;
  private onDayCompleted?: () => void;
  private buttonLabel!: THREE.Sprite;

  constructor(scene: THREE.Scene, physics: PhysicsSystem, hud: HUD, resetTools: () => void, onDayCompleted?: () => void) {
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

  isPlayerNearButton(pos: THREE.Vector3): boolean {
    const dx = pos.x - END_DAY_BUTTON_POS.x;
    const dz = pos.z - END_DAY_BUTTON_POS.z;
    return Math.sqrt(dx * dx + dz * dz) < SCENE_CONFIG.interactionDistance + 1;
  }

  get canEndDay(): boolean {
    return this.state === 'completed' && this.dailyCargoIds.size === 0;
  }

  endDayBlockedMessage(): string {
    return '請先清空今日所有貨品';
  }

  /** Called once by UnloadingSystem right as its spawn sequence begins. */
  notifyUnloadingStarted(): void {
    this.state = 'unloading';
    this.hasUnloadedToday = true;
  }

  /** Called once by UnloadingSystem's spawn sequence, passing every id it
   * just created (spec 八: "所有每日貨品生成後都必須登記到 dailyCargoIds"). */
  registerDailyCargo(ids: string[]): void {
    this.dailyCargoIds = new Set(ids);
    this.totalCargoCount = ids.length;
    this.remainingCargoCount = ids.length;
    this.completedCargoCount = 0;
  }

  /** Called once by UnloadingSystem after the gate has closed again. */
  notifyUnloadingFinished(): void {
    if (this.state === 'unloading') this.state = 'sorting';
  }

  /** Called by OutboundZoneSystem — id must be a currently-registered daily
   * cargo id (spec 十七: "只接受本日 dailyCargoIds 中的貨品"). Returns false
   * (no-op) if it's already been removed, so a stray double-call can never
   * double-count. */
  markCompleted(id: string): boolean {
    if (!this.dailyCargoIds.has(id)) return false;
    this.dailyCargoIds.delete(id);
    this.completedCargoCount++;
    this.remainingCargoCount = Math.max(0, this.remainingCargoCount - 1);
    if (this.dailyCargoIds.size === 0 && this.state === 'sorting') {
      this.state = 'completed';
    }
    return true;
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

    this.currentDay++;
    this.dailyCargoIds = new Set();
    this.totalCargoCount = 0;
    this.remainingCargoCount = 0;
    this.completedCargoCount = 0;
    this.hasUnloadedToday = false;
    this.resetTools();

    this.state = 'ready';
    this.onDayCompleted?.();
  }
}
