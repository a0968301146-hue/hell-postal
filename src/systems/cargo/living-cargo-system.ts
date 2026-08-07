import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { CargoSystem } from './cargo-system';
import { PlayerInteractionData } from '../../core/game-state';
import { PauseManager } from '../../core/pause-manager';
import { HUD } from '../hud';
import { ParticleBurst } from '../../adapters/three/particle-burst';
import {
  CALM_VALUE_MIN, CALM_VALUE_MAX,
  CALM_VALUE_SPRINT_SPEED_THRESHOLD, CALM_VALUE_HIGH_SPEED_THRESHOLD,
  CALM_VALUE_SPRINT_DRAIN_PER_SECOND, CALM_VALUE_HIGH_SPEED_DRAIN_PER_SECOND,
  CALM_VALUE_IMPACT_SMALL_THRESHOLD, CALM_VALUE_IMPACT_MEDIUM_THRESHOLD, CALM_VALUE_IMPACT_LARGE_THRESHOLD,
  CALM_VALUE_IMPACT_SMALL_PENALTY, CALM_VALUE_IMPACT_MEDIUM_PENALTY, CALM_VALUE_IMPACT_LARGE_PENALTY,
  CALM_VALUE_SOOTHE_PER_SECOND,
} from './living-cargo-data';

/** Soothing burst colors cycled through each time a new one is spawned
 * (spec五: "愛心、音符、小星星或其他舒服效果") — a single ParticleBurst
 * can't literally draw hearts/notes/stars as shapes (no sprite atlas in this
 * codebase's particle system), so the "which effect" distinction is
 * expressed as color variety instead: pink (heart), gold (star), sky-blue
 * (note) — still reads as "something soft and pleasant is happening". */
const SOOTHE_COLORS = [0xff8fb3, 0xffd76a, 0x8fd9ff];

/**
 * "活物貨物系統" round, refined in the "活物安撫值規格" round — owns every
 * LIVE-category cargo concern in one place, entirely independent of
 * FreezerSystem (不要影響目前冷藏值系統／活物與冷藏貨物可以同時存在): its
 * own calmValue field (CargoData.calmValue), its own decay triggers (moving
 * too fast while held — two speed tiers, sprint vs high-speed — or a hard
 * impact), its own F-hold soothe recovery (no cooldown), and its own HUD
 * panel — never reads or writes coldValue/isInsideFreezerShelf, never
 * touches WEST_WALL_SHELVES/freezer sensors.
 *
 * Impact detection uses a cheap, already-available signal — the
 * drop in a live cargo rigid body's OWN linear-velocity magnitude across one
 * physics step — rather than a Rapier contact-event queue (no such
 * infrastructure exists anywhere else in this codebase yet, and adding one
 * would touch physics-system.ts's own world.step() call, well outside this
 * round's "unly modify UI/decay speed/F互動" scope). A genuine collision
 * produces a large, sudden one-frame drop; ordinary friction-based
 * deceleration under gravity does not, in practice, reach the SMALL
 * threshold (spec: "數值可以再調整" — these are intentionally tunable).
 */
export class LivingCargoSystem {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private physics: PhysicsSystem;
  private cargoSystem: CargoSystem;
  private playerData: PlayerInteractionData;
  private pauseManager: PauseManager;
  private isLocked: () => boolean;
  private hud: HUD;

  /** spec①'s own "玩家移動速度" signal — the player body is
   * kinematicPositionBased (see physics-system.ts's own createPlayerBody),
   * so `playerBody.linvel()` never reflects real movement (Rapier doesn't
   * derive velocity for kinematic bodies from setNextKinematicTranslation
   * the way it would for a dynamic body) — confirmed empirically returning
   * {0,0,0} regardless of actual movement. Horizontal speed is computed
   * here instead, from the player's own position delta across frames, the
   * same "position-delta-over-time" a dynamic body's linvel would report. */
  private lastPlayerPos: THREE.Vector3 | null = null;

  /** Previous frame's own speed per live-cargo id — the ONE piece of state
   * impact detection needs, reset to the item's own current speed whenever
   * it's held (so the very first free-falling frame after being dropped
   * never misreads the held-frozen-at-zero baseline as an "impact"). */
  private lastSpeed: Map<string, number> = new Map();

  private isSoothing = false;
  private sootheItemId: string | null = null;
  private burst: ParticleBurst | null = null;
  private sootheColorIndex = 0;

  constructor(
    scene: THREE.Scene, camera: THREE.PerspectiveCamera, physics: PhysicsSystem, cargoSystem: CargoSystem,
    playerData: PlayerInteractionData, pauseManager: PauseManager, isLockedFn: () => boolean, hud: HUD
  ) {
    this.scene = scene;
    this.camera = camera;
    this.physics = physics;
    this.cargoSystem = cargoSystem;
    this.playerData = playerData;
    this.pauseManager = pauseManager;
    this.isLocked = isLockedFn;
    this.hud = hud;

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));
  }

  private heldLiveId(): string | null {
    const id = this.playerData.heldObjectId;
    if (!id) return null;
    const data = this.cargoSystem.getCargoData(id);
    return data && data.category === 'live' ? id : null;
  }

  /** 玩家拿著活物時按住F開始安撫 — no aim/station requirement, same "works
   * anywhere while held" shape as the reworked lost-found cleaning flow.
   * "F鍵優先權" spec: 1.拿著黑色失物球→F=清潔 2.拿著活物→F=安撫 3.拿著信件
   * →F=信件模式切換 4.其他工具→維持原本功能 — this handler only ever fires
   * for `category==='live'`, LostFoundCleaningSystem's own KeyF handler only
   * for a lost-item id prefix, EnvelopeStackSystem's own KeyF handler only
   * while carrying its own envelope-stack sentinel — all three conditions
   * are mutually exclusive by construction (the single currently-held item
   * can only ever match ONE of them), so the priority order above already
   * holds naturally with no explicit sequencing/stopPropagation needed. */
  private onKeyDown(event: KeyboardEvent): void {
    if (event.code !== 'KeyF' || event.repeat) return;
    if (!this.isLocked() || this.pauseManager.isPaused) return;
    if (this.isSoothing) return;
    const id = this.heldLiveId();
    if (!id) return;
    this.isSoothing = true;
    this.sootheItemId = id;
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (event.code !== 'KeyF') return;
    this.cancelSoothe();
  }

  private cancelSoothe(): void {
    if (!this.isSoothing) return;
    this.isSoothing = false;
    this.sootheItemId = null;
  }

  private applyImpactPenalty(calmValue: number, speedDrop: number): number {
    if (speedDrop >= CALM_VALUE_IMPACT_LARGE_THRESHOLD) return Math.max(CALM_VALUE_MIN, calmValue - CALM_VALUE_IMPACT_LARGE_PENALTY);
    if (speedDrop >= CALM_VALUE_IMPACT_MEDIUM_THRESHOLD) return Math.max(CALM_VALUE_MIN, calmValue - CALM_VALUE_IMPACT_MEDIUM_PENALTY);
    if (speedDrop >= CALM_VALUE_IMPACT_SMALL_THRESHOLD) return Math.max(CALM_VALUE_MIN, calmValue - CALM_VALUE_IMPACT_SMALL_PENALTY);
    return calmValue;
  }

  /** spec①/②/⑤ — the one per-frame arithmetic pass. Held-item fast-move
   * drain and impact-drop detection are two entirely independent checks (an
   * item could theoretically both be held AND have just been thrown by
   * someone else... in practice never simultaneous since a held item's
   * rigidBody is physics-disabled, but the code doesn't need to assume
   * that to stay correct either way). */
  private tickCalmValues(deltaTime: number): void {
    const p = this.physics.playerBody.translation();
    const currentPos = new THREE.Vector3(p.x, p.y, p.z);
    let horizontalSpeed = 0;
    if (this.lastPlayerPos && deltaTime > 0) {
      const dx = currentPos.x - this.lastPlayerPos.x;
      const dz = currentPos.z - this.lastPlayerPos.z;
      horizontalSpeed = Math.sqrt(dx * dx + dz * dz) / deltaTime;
    }
    this.lastPlayerPos = currentPos;

    const heldId = this.heldLiveId();
    if (heldId) {
      // spec③: 一般速度不扣／開始衝刺 -0.5%/秒／高速移動 -1%/秒 — the two
      // thresholds are the game's OWN already-established speed constants
      // (SCENE_CONFIG.playerSpeed / *sprintMultiplier), not invented here.
      let rate = 0;
      if (horizontalSpeed > CALM_VALUE_HIGH_SPEED_THRESHOLD) rate = CALM_VALUE_HIGH_SPEED_DRAIN_PER_SECOND;
      else if (horizontalSpeed > CALM_VALUE_SPRINT_SPEED_THRESHOLD) rate = CALM_VALUE_SPRINT_DRAIN_PER_SECOND;
      if (rate > 0) {
        const data = this.cargoSystem.getCargoData(heldId);
        if (data) data.calmValue = Math.max(CALM_VALUE_MIN, data.calmValue - rate * deltaTime);
      }
    }

    for (const data of this.cargoSystem.cargoDataMap.values()) {
      if (data.category !== 'live') continue;
      const obj = this.cargoSystem.getInteractable(data.id);
      const rb = obj?.rigidBody;

      let currentSpeed = 0;
      if (rb && obj && !obj.isHeld) {
        const lv = rb.linvel();
        currentSpeed = Math.sqrt(lv.x * lv.x + lv.y * lv.y + lv.z * lv.z);
        const prevSpeed = this.lastSpeed.get(data.id) ?? currentSpeed;
        const drop = prevSpeed - currentSpeed;
        if (drop > 0) data.calmValue = this.applyImpactPenalty(data.calmValue, drop);
      }
      this.lastSpeed.set(data.id, currentSpeed);

      if (this.isSoothing && data.id === this.sootheItemId) {
        data.calmValue = Math.min(CALM_VALUE_MAX, data.calmValue + CALM_VALUE_SOOTHE_PER_SECOND * deltaTime);
      }
    }
  }

  private heldItemWorldPosition(): THREE.Vector3 {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    return this.camera.position.clone().add(forward.multiplyScalar(0.6)).add(new THREE.Vector3(0, -0.15, 0));
  }

  /** Called every frame from game-app.ts's own paused-gated update block. */
  update(deltaTime: number): void {
    if (this.isSoothing && this.playerData.heldObjectId !== this.sootheItemId) this.cancelSoothe();

    this.tickCalmValues(deltaTime);

    if (this.isSoothing) {
      const origin = this.heldItemWorldPosition();
      if (!this.burst || this.burst.done) {
        this.burst = new ParticleBurst(this.scene, origin, {
          color: SOOTHE_COLORS[this.sootheColorIndex++ % SOOTHE_COLORS.length],
          count: 14, size: 0.05, speedMin: 0.1, speedMax: 0.3,
          durationSeconds: 0.7, gravity: -0.15, opacity: 0.85,
        });
      } else {
        this.burst.setOrigin(origin);
        this.burst.update(deltaTime);
      }
    } else if (this.burst) {
      this.burst.update(deltaTime);
      if (this.burst.done) this.burst = null;
    }
  }

  /** Held live cargo's own live 安撫值 readout — same unconditional,
   * outside-the-pause-gate convention as FreezerSystem.refreshHeldItemHud
   * (a pause must take effect on the HUD the same frame it begins). Hidden
   * entirely (spec四: "放下活物後立即隱藏") whenever not holding live cargo. */
  refreshHeldItemHud(): void {
    const heldId = this.playerData.heldObjectId;
    const heldData = heldId ? this.cargoSystem.getCargoData(heldId) : null;
    if (heldData && heldData.category === 'live') {
      this.hud.updateCalmValueStatus(heldData.calmValue);
    } else {
      this.hud.updateCalmValueStatus(null);
    }
  }
}
