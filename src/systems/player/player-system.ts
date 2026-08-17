import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { SCENE_CONFIG } from '../world-layout';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { PLAYER_SPAWN } from '../world-layout';
import { DOLLY_PUSH_SPEED_MULTIPLIER } from '../dolly/dolly-data';
import { PlayerInteractionData } from '../../core/game-state';
import { HUD } from '../hud';
import { SettingsManager } from '../settings';
import { InteractableObject } from '../../shared/types/interactable';

const HALF_PI = Math.PI / 2;

/** Baseline movement multiplier while carrying `large`-category cargo
 * ("Add bulletin board upgrade system" round spec五B) — no such slowdown
 * existed anywhere in the codebase before this round (verified: neither
 * this file nor anywhere else read shapeType/'large' for a speed penalty),
 * so this constant IS the Lv.0 baseline the spec's own upgrade-B premise
 * ("Lv.0：使用現有大型貨物移動減速") assumes already exists — introduced
 * here specifically so upgrade B (重物適應) has a real baseline to reduce.
 * Only ever applied while the CURRENT top-of-stack held item's own
 * mesh.userData.shapeType is exactly 'large' (never 'cage'/live, medium,
 * or normal cargo — see PlayerController.isHoldingLargeCargo). */
const BASE_LARGE_CARGO_SLOWDOWN_FACTOR = 0.7;

export class PlayerController {
  private controls: PointerLockControls;
  private camera: THREE.PerspectiveCamera;
  private physics: PhysicsSystem;
  private settingsManager: SettingsManager;
  private moveForward = false;
  private moveBackward = false;
  private moveLeft = false;
  private moveRight = false;
  private isSprinting = false;
  private wantsJump = false;
  private _isLocked = false;
  private hasFiredFirstMove = false;
  private lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  private verticalSpeed = 0;
  private grounded = true;

  /** Upgrade C (移動速度) — fraction ADDED to the ORIGINAL base speed each
   * frame (0, 0.05, 0.10, 0.15), never compounded: always multiplies
   * SCENE_CONFIG.playerSpeed directly, never a previously-boosted value, so
   * repeated UI-opens or save-loads can never stack it (spec五C). */
  private moveSpeedBonusFraction = 0;
  /** Upgrade B (重物適應) level — 0/1/2, recomputed into a slowdown factor
   * fresh every frame from this level (never stored pre-multiplied), so it
   * can't stack across save-loads either (spec五B). */
  private heavyHandlingLevel: 0 | 1 | 2 = 0;

  constructor(
    camera: THREE.PerspectiveCamera, domElement: HTMLElement, private hud: HUD, physics: PhysicsSystem,
    private playerData: PlayerInteractionData, settingsManager: SettingsManager,
    private interactables: Map<string, InteractableObject>
  ) {
    this.camera = camera;
    this.physics = physics;
    this.settingsManager = settingsManager;
    this.controls = new PointerLockControls(camera, domElement);

    // The stock addon's own mousemove listener only supports a uniform
    // pointerSpeed (no per-axis invert), but settings 七 requires a real
    // invert-Y toggle — so its built-in rotation listener is removed here
    // and replaced with our own (see onMouseMoveCustom), while still using
    // the addon for lock()/unlock() and the lock/unlock events themselves.
    const rawControls = this.controls as unknown as { _onMouseMove: (e: MouseEvent) => void };
    domElement.ownerDocument.removeEventListener('mousemove', rawControls._onMouseMove);
    document.addEventListener('mousemove', (e) => this.onMouseMoveCustom(e));

    this.camera.position.set(PLAYER_SPAWN.x, PLAYER_SPAWN.y, PLAYER_SPAWN.z);
    // Face +Z at spawn: the logistics layout (window/ramp/back area/pier)
    // extends toward +Z from the front-office spawn point, whereas a fresh
    // THREE.PerspectiveCamera defaults to looking down -Z.
    this.camera.rotation.y = Math.PI;

    domElement.addEventListener('click', () => {
      if (!this._isLocked) this.controls.lock();
    });

    this.controls.addEventListener('lock', () => {
      this._isLocked = true;
      this.hud.hideInstructions();
    });

    this.controls.addEventListener('unlock', () => {
      this._isLocked = false;
      this.clearInputState();
      this.hud.showInstructions();
    });

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.clearInputState());
  }

  get isLocked(): boolean { return this._isLocked; }

  /** Public so ManualUI can re-request pointer lock is NOT used (see
   * manual close flow — it follows the same click-to-relock convention as
   * ending the stamp minigame, rather than a special-cased programmatic
   * lock() call), but exposed anyway for completeness/consistency. */
  requestLock(): void {
    if (!this._isLocked) this.controls.lock();
  }

  /** UpgradeSystem's ONLY hook for 移動速度 (spec三/七) — `fraction` is
   * always the CURRENT level's own bonus (level * 0.05), never incremented
   * on top of whatever was already set. */
  setMoveSpeedBonus(fraction: number): void {
    this.moveSpeedBonusFraction = fraction;
  }

  /** UpgradeSystem's ONLY hook for 重物適應 (spec三/七). */
  setHeavyHandlingLevel(level: 0 | 1 | 2): void {
    this.heavyHandlingLevel = level;
  }

  /** "Add main menu and return player after dock story" round 一: clears
   * residual gravity/jump state after a manual `physics.setPlayerPosition`
   * teleport (AfterWorkStorySystem's own end-of-story teleport, in
   * particular) — without this, `verticalSpeed` left over from before the
   * teleport would apply itself the next update() tick once input
   * re-enables, causing a visible pop/fall-through-floor-check on the first
   * frame back under player control. */
  resetVerticalMotion(): void {
    this.verticalSpeed = 0;
    this.grounded = true;
  }

  /** True only while the CURRENT top-of-stack held item is `large`-category
   * cargo (mesh.userData.shapeType === 'large', set only by
   * cargo-system.ts's spawnDailyBox/spawnDailyRoller for large presets) —
   * deliberately excludes 'cage' (live animals), 'box'/'roller' (normal or
   * medium cargo), matching spec五B's "只影響大型貨物，不影響活體、中型貨
   * 物" exactly. */
  private isHoldingLargeCargo(): boolean {
    if (!this.playerData.heldObjectId) return false;
    const obj = this.interactables.get(this.playerData.heldObjectId);
    return !!obj && obj.mesh.userData.shapeType === 'large';
  }

  /** Recomputed fresh from `heavyHandlingLevel` every call — Lv.0 keeps the
   * full baseline slowdown, Lv.1 halves the PENALTY (not the speed), Lv.2
   * removes it entirely (spec五B). */
  private heavySlowdownFactor(): number {
    switch (this.heavyHandlingLevel) {
      case 1: return 1 - (1 - BASE_LARGE_CARGO_SLOWDOWN_FACTOR) * 0.5;
      case 2: return 1;
      default: return BASE_LARGE_CARGO_SLOWDOWN_FACTOR;
    }
  }

  private onMouseMoveCustom(event: MouseEvent): void {
    if (!this._isLocked) return;
    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;
    const { sensitivity, invertY } = this.settingsManager.settings.mouse;
    const factor = 0.002 * sensitivity;
    const invertSign = invertY ? 1 : -1;

    this.lookEuler.setFromQuaternion(this.camera.quaternion);
    this.lookEuler.y -= movementX * factor;
    this.lookEuler.x += invertSign * movementY * factor;
    this.lookEuler.x = Math.max(-HALF_PI, Math.min(HALF_PI, this.lookEuler.x));
    this.camera.quaternion.setFromEuler(this.lookEuler);
  }

  setInputEnabled(enabled: boolean): void {
    if (!enabled) this.clearInputState();
    this._inputEnabled = enabled;
  }

  private _inputEnabled = true;

  private clearInputState(): void {
    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;
    this.isSprinting = false;
    this.wantsJump = false;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this._isLocked) return;
    if (event.repeat) return;
    const bindings = this.settingsManager.inputBindings;
    const code = event.code;
    if (bindings.matches('moveForward', code)) this.moveForward = true;
    else if (bindings.matches('moveBackward', code)) this.moveBackward = true;
    else if (bindings.matches('moveLeft', code)) this.moveLeft = true;
    else if (bindings.matches('moveRight', code)) this.moveRight = true;
    else if (bindings.matches('sprint', code)) {
      this.isSprinting = true;
      // "Add sequential lost-found visitors and held cargo feedback" round
      // 四: large-category cargo blocks sprint entirely, at every 重物適應
      // level (only the SLOWDOWN factor scales with that upgrade — see
      // heavySlowdownFactor — sprint itself never comes back until the item
      // is set down). Toast is a one-shot cue on the actual keydown, not a
      // per-frame nag while Shift stays held.
      if (this.isHoldingLargeCargo()) this.hud.showToast('搬運大型貨物時無法衝刺');
    }
    else if (bindings.matches('jump', code)) { if (this.grounded) this.wantsJump = true; }

    if (
      !this.hasFiredFirstMove &&
      (bindings.matches('moveForward', code) || bindings.matches('moveBackward', code) ||
        bindings.matches('moveLeft', code) || bindings.matches('moveRight', code))
    ) {
      this.hasFiredFirstMove = true;
      this.settingsManager.fireTutorialEvent('move');
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    const bindings = this.settingsManager.inputBindings;
    const code = event.code;
    if (bindings.matches('moveForward', code)) this.moveForward = false;
    else if (bindings.matches('moveBackward', code)) this.moveBackward = false;
    else if (bindings.matches('moveLeft', code)) this.moveLeft = false;
    else if (bindings.matches('moveRight', code)) this.moveRight = false;
    else if (bindings.matches('sprint', code)) this.isSprinting = false;
  }

  update(deltaTime: number): void {
    if (!this._isLocked || !this._inputEnabled) return;

    // Pushing a dolly overrides sprinting — can't run while pushing a cart.
    // Holding large-category cargo blocks sprint outright too ("Add
    // sequential lost-found visitors and held cargo feedback" round四:
    // "即使玩家按住Shift，也只能使用當前步行速度" — at EVERY 重物適應 level,
    // never just the ones below max, see heavySlowdownFactor's own doc
    // comment for why only the slowdown FACTOR (not this sprint gate) scales
    // with that upgrade).
    const isLargeCargo = this.isHoldingLargeCargo();
    const speedMult = this.playerData.state === 'pushing-dolly'
      ? DOLLY_PUSH_SPEED_MULTIPLIER
      : (this.isSprinting && !isLargeCargo ? SCENE_CONFIG.sprintMultiplier : 1);
    // Upgrade C: always computed from the ORIGINAL SCENE_CONFIG.playerSpeed
    // constant, never a previously-boosted value (spec五C). Upgrade B's
    // large-cargo slowdown applies ON TOP of this post-upgrade base speed
    // (spec五C: "重物適應的減速效果需疊加在升級後的基礎速度之上"), only
    // while actually holding large cargo — sprint multiplier and jump/
    // gravity (SCENE_CONFIG.sprintMultiplier/jumpHeight/gravity) are never
    // touched by either upgrade.
    const upgradedBaseSpeed = SCENE_CONFIG.playerSpeed * (1 + this.moveSpeedBonusFraction);
    const heavyFactor = isLargeCargo ? this.heavySlowdownFactor() : 1;
    const speed = upgradedBaseSpeed * speedMult * heavyFactor * deltaTime;

    // Get forward/right on XZ
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    // Build desired horizontal movement
    const move = new THREE.Vector3(0, 0, 0);
    if (this.moveForward) move.addScaledVector(forward, speed);
    if (this.moveBackward) move.addScaledVector(forward, -speed);
    if (this.moveLeft) move.addScaledVector(right, -speed);
    if (this.moveRight) move.addScaledVector(right, speed);

    // Jump
    if (this.wantsJump && this.grounded) {
      this.verticalSpeed = Math.sqrt(2 * SCENE_CONFIG.gravity * SCENE_CONFIG.jumpHeight);
      this.grounded = false;
      this.wantsJump = false;
    }

    // Apply gravity
    this.verticalSpeed -= SCENE_CONFIG.gravity * deltaTime;
    move.y = this.verticalSpeed * deltaTime;

    // Use character controller for collision
    const corrected = this.physics.movePlayer(move);

    // Update physics body position
    const currentPos = this.physics.getPlayerPosition();
    const newPos = currentPos.add(corrected);
    this.physics.setPlayerPosition(newPos);

    // Check grounded
    this.grounded = this.physics.isPlayerGrounded();
    if (this.grounded && this.verticalSpeed < 0) {
      this.verticalSpeed = 0;
    }

    // Sync camera to player body position (eye height offset from capsule center)
    const bodyPos = this.physics.getPlayerPosition();
    this.camera.position.set(bodyPos.x, bodyPos.y + 0.6, bodyPos.z);
  }
}
