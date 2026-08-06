import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject } from '../../shared/types/interactable';
import { PlayerInteractionData } from '../../core/game-state';
import { PauseManager } from '../../core/pause-manager';
import { HUD } from '../hud';
import { createFloatingLabel } from '../../adapters/three/world-label-system';
import { LOST_FOUND_CLEANING_STATION_POS, LOST_FOUND_ROOM } from '../../data/world/lost-found-layout-data';
import { LostFoundSystem, LOST_ITEM_ID_PREFIX } from './lost-found-system';

const STATION_WIDTH = 0.5;
const STATION_HEIGHT = 0.7;
const STATION_DEPTH = 0.4;
const STATION_INTERACT_DISTANCE = 2.5;

/** spec: "清潔時間：0.5秒". */
const CLEANING_DURATION_SECONDS = 0.5;

const CLEANING_PROMPT_TEXT = '正在清潔...';
const AIM_PROMPT_ACTION = '按住 E 清潔';

/**
 * "Add lost-found item cleaning system" round — the standalone "walk to the
 * cleaning station, aim, hold E for 0.5s" interaction that turns a held
 * black-ball placeholder into its real model (via LostFoundSystem's own
 * revealLostItem). Deliberately self-contained and independent of
 * InteractionSystem, mirroring AfterWorkStorySystem's own established
 * pattern for "an aim-driven E interaction with its own hold-timer/HUD
 * feedback" (own THREE.Raycaster against ONLY this station's mesh, own
 * dedicated keydown/keyup listeners for 'KeyE', own per-frame hold-timer) —
 * the station mesh is deliberately NEVER registered into the shared
 * `interactables` map (same reasoning AfterWorkStorySystem's own NPC hitbox
 * doc comment gives: avoids any risk of InteractionSystem's generic pickup/
 * placement fallback chain trying to do something with it), so this file
 * requires zero changes to interaction-system.ts (spec: "不修改...
 * Interaction").
 */
export class LostFoundCleaningSystem {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private hud: HUD;
  private playerData: PlayerInteractionData;
  private interactables: Map<string, InteractableObject>;
  private pauseManager: PauseManager;
  private isLocked: () => boolean;
  private lostFoundSystem: LostFoundSystem;
  private raycaster = new THREE.Raycaster();
  private stationMesh!: THREE.Mesh;

  private isCleaning = false;
  private cleaningElapsed = 0;
  private cleaningItemId: string | null = null;

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, camera: THREE.PerspectiveCamera, hud: HUD,
    playerData: PlayerInteractionData, interactables: Map<string, InteractableObject>,
    pauseManager: PauseManager, isLockedFn: () => boolean, lostFoundSystem: LostFoundSystem
  ) {
    this.scene = scene;
    this.camera = camera;
    this.hud = hud;
    this.playerData = playerData;
    this.interactables = interactables;
    this.pauseManager = pauseManager;
    this.isLocked = isLockedFn;
    this.lostFoundSystem = lostFoundSystem;

    this.buildStation(physics);

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));
  }

  private buildStation(physics: PhysicsSystem): void {
    const floorY = LOST_FOUND_ROOM.floorY; // BACK_AREA shares the same floor level
    const { x, z } = LOST_FOUND_CLEANING_STATION_POS;
    const centerY = floorY + STATION_HEIGHT / 2;

    const geo = new THREE.BoxGeometry(STATION_WIDTH, STATION_HEIGHT, STATION_DEPTH);
    const mat = new THREE.MeshStandardMaterial({ color: 0x7a95a0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, centerY, z);
    this.scene.add(mesh);
    this.stationMesh = mesh;

    physics.createStaticCuboid(x, centerY, z, STATION_WIDTH / 2, STATION_HEIGHT / 2, STATION_DEPTH / 2);

    const label = createFloatingLabel('清潔台\n拿著未知失物並按住E清潔', { width: 1.1, bg: 'rgba(20,30,35,0.75)' });
    label.position.set(x, floorY + STATION_HEIGHT + 0.4, z);
    this.scene.add(label);
  }

  private isAimingAtStation(): boolean {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.raycaster.set(this.camera.position, dir);
    const hits = this.raycaster.intersectObject(this.stationMesh, true);
    return hits.length > 0 && hits[0].distance <= STATION_INTERACT_DISTANCE;
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
    if (event.code !== 'KeyE' || event.repeat) return;
    if (!this.isLocked() || this.pauseManager.isPaused) return;
    if (this.isCleaning) return;
    if (!this.isAimingAtStation()) return;
    const id = this.heldDirtyLostItemId();
    if (!id) return;
    this.isCleaning = true;
    this.cleaningElapsed = 0;
    this.cleaningItemId = id;
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (event.code !== 'KeyE') return;
    this.cancelCleaning();
  }

  private cancelCleaning(): void {
    if (!this.isCleaning) return;
    this.isCleaning = false;
    this.cleaningElapsed = 0;
    this.cleaningItemId = null;
    this.hud.hideChargeBar();
  }

  /** Called every frame from game-app.ts's own paused-gated update block,
   * right after lostFoundSystem.update() — same "runs after
   * InteractionSystem, so it has the final say on the shared prompt element
   * while relevant" convention HUD.showToolPrompt's own doc comment already
   * documents for cargoHookSystem/spraySystem. */
  update(deltaTime: number): void {
    if (this.isCleaning) {
      // Re-validate every frame (aim drifted off the station, or the held
      // item changed/was dropped) — cancels exactly like an early E release.
      if (!this.isAimingAtStation() || this.playerData.heldObjectId !== this.cleaningItemId) {
        this.cancelCleaning();
      } else {
        this.cleaningElapsed += deltaTime;
        this.hud.showChargeBar(Math.min(this.cleaningElapsed / CLEANING_DURATION_SECONDS, 1));
        this.hud.showInteractionPrompt('清潔台', CLEANING_PROMPT_TEXT);
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
          // spec: "完成後：物品名稱恢復正常" — refresh the prompt right away
          // rather than leaving the stale "？？？" text on screen until some
          // unrelated event happens to re-show it.
          const obj = this.interactables.get(id);
          if (obj) this.hud.showInteractionPrompt(obj.displayName, '已清潔完成');
        }
        return;
      }
    }

    if (this.isAimingAtStation() && this.heldDirtyLostItemId()) {
      this.hud.showInteractionPrompt('清潔台', AIM_PROMPT_ACTION);
    }
  }
}
