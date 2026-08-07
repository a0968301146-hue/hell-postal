import * as THREE from 'three';
import { PlayerInteractionData } from '../../core/game-state';
import { PauseManager } from '../../core/pause-manager';
import { HUD } from '../hud';
import { ParticleBurst } from '../../adapters/three/particle-burst';
import { LostFoundSystem, LOST_ITEM_ID_PREFIX } from './lost-found-system';

/** spec: "約1秒左右即可". */
const CLEANING_DURATION_SECONDS = 1.0;

const CLEANING_PROMPT_TEXT = '正在清潔...';
const HOLD_PROMPT_ACTION = '按住 F 清潔';

/**
 * "失物招領系統修改" round — replaces the old fixed cleaning-station/aim/E
 * flow entirely (spec: "不要再使用「失物招領工作台」...不需要放到工作台、工
 * 作台UI、工作台互動流程"). The new flow works ANYWHERE, the instant the
 * player is simply holding an uncleaned lost item: hold F for
 * CLEANING_DURATION_SECONDS (spec: "拿起→按F→播放粒子→直接變回真正物品"),
 * no walking to a fixture, no aiming, no putting the item down. Still
 * entirely self-contained and independent of InteractionSystem (own
 * dedicated keydown/keyup listeners for 'KeyF'), mirroring the OLD station
 * system's own established "self-contained, zero interaction-system.ts
 * changes" convention — only the TRIGGER condition changed, not the overall
 * shape of the class.
 */
export class LostFoundCleaningSystem {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private hud: HUD;
  private playerData: PlayerInteractionData;
  private pauseManager: PauseManager;
  private isLocked: () => boolean;
  private lostFoundSystem: LostFoundSystem;

  private isCleaning = false;
  private cleaningElapsed = 0;
  private cleaningItemId: string | null = null;
  private burst: ParticleBurst | null = null;

  constructor(
    scene: THREE.Scene, camera: THREE.PerspectiveCamera, hud: HUD,
    playerData: PlayerInteractionData, pauseManager: PauseManager, isLockedFn: () => boolean,
    lostFoundSystem: LostFoundSystem
  ) {
    this.scene = scene;
    this.camera = camera;
    this.hud = hud;
    this.playerData = playerData;
    this.pauseManager = pauseManager;
    this.isLocked = isLockedFn;
    this.lostFoundSystem = lostFoundSystem;

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));
  }

  /** The currently-held item's id, but ONLY if it's a lost item that still
   * needs cleaning — null for empty-handed, ordinary cargo/mail/pallet, or
   * an already-cleaned lost item (nothing left to do). */
  private heldDirtyLostItemId(): string | null {
    const id = this.playerData.heldObjectId;
    if (!id || !id.startsWith(LOST_ITEM_ID_PREFIX)) return null;
    if (this.lostFoundSystem.isItemClean(id)) return null;
    return id;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.code !== 'KeyF' || event.repeat) return;
    if (!this.isLocked() || this.pauseManager.isPaused) return;
    if (this.isCleaning) return;
    const id = this.heldDirtyLostItemId();
    if (!id) return;
    this.isCleaning = true;
    this.cleaningElapsed = 0;
    this.cleaningItemId = id;
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (event.code !== 'KeyF') return;
    this.cancelCleaning();
  }

  private cancelCleaning(): void {
    if (!this.isCleaning) return;
    this.isCleaning = false;
    this.cleaningElapsed = 0;
    this.cleaningItemId = null;
    this.hud.hideChargeBar();
    if (this.burst) { this.burst.dispose(); this.burst = null; }
  }

  /** Roughly where the held-item viewmodel visually reads on screen, in
   * WORLD space — the viewmodel itself renders through a separate
   * camera-local overlay pass (see pickup-system.ts's own viewModelScene),
   * so a world-space particle burst can only ever approximate that position
   * (camera-forward + a slight downward offset, mirroring the viewmodel's
   * own screen-center-low anchor) rather than exactly coincide with it —
   * close enough for a short decorative sparkle effect. */
  private heldItemWorldPosition(): THREE.Vector3 {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    return this.camera.position.clone().add(forward.multiplyScalar(0.6)).add(new THREE.Vector3(0, -0.15, 0));
  }

  /** Called every frame from game-app.ts's own paused-gated update block,
   * right after lostFoundSystem.update() — same "runs after
   * InteractionSystem, so it has the final say on the shared prompt element
   * while relevant" convention HUD.showToolPrompt's own doc comment already
   * documents for cargoHookSystem/spraySystem. */
  update(deltaTime: number): void {
    if (this.isCleaning) {
      // Re-validate every frame (item dropped/changed) — cancels exactly
      // like an early F release.
      if (this.playerData.heldObjectId !== this.cleaningItemId) {
        this.cancelCleaning();
      } else {
        this.cleaningElapsed += deltaTime;
        this.hud.showChargeBar(Math.min(this.cleaningElapsed / CLEANING_DURATION_SECONDS, 1));
        this.hud.showInteractionPrompt('清潔中', CLEANING_PROMPT_TEXT);

        const origin = this.heldItemWorldPosition();
        if (!this.burst) {
          this.burst = new ParticleBurst(this.scene, origin, {
            color: 0xfff6c8, count: 22, size: 0.045, speedMin: 0.15, speedMax: 0.45,
            durationSeconds: CLEANING_DURATION_SECONDS + 0.3, gravity: 0.05, opacity: 0.85,
          });
        } else {
          this.burst.setOrigin(origin);
          this.burst.update(deltaTime);
        }

        if (this.cleaningElapsed >= CLEANING_DURATION_SECONDS) {
          // Non-null: isCleaning only stays true while cleaningItemId was
          // set at start and never cleared until completion (see
          // cancelCleaning) — the branch above already confirmed
          // heldObjectId still equals it this frame.
          const id = this.cleaningItemId!;
          this.isCleaning = false;
          this.cleaningElapsed = 0;
          this.cleaningItemId = null;
          this.hud.hideChargeBar();
          this.lostFoundSystem.revealLostItem(id);
        }
        return;
      }
    } else if (this.burst) {
      // Cleaning ended (completed or cancelled) but the burst is still
      // fading out — let it finish on its own rather than cutting it dead.
      this.burst.update(deltaTime);
      if (this.burst.done) this.burst = null;
    }

    if (this.heldDirtyLostItemId()) {
      this.hud.showInteractionPrompt('未知失物', HOLD_PROMPT_ACTION);
    }
  }
}
