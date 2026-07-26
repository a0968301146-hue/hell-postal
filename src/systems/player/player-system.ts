import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { SCENE_CONFIG } from '../world-layout';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { PLAYER_SPAWN } from '../world-layout';
import { DOLLY_PUSH_SPEED_MULTIPLIER } from '../../game/dolly-data';
import { PlayerInteractionData } from '../../core/game-state';
import { HUD } from '../hud';
import { SettingsManager } from '../settings';

const HALF_PI = Math.PI / 2;

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

  constructor(
    camera: THREE.PerspectiveCamera, domElement: HTMLElement, private hud: HUD, physics: PhysicsSystem,
    private playerData: PlayerInteractionData, settingsManager: SettingsManager
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
    else if (bindings.matches('sprint', code)) this.isSprinting = true;
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
    const speedMult = this.playerData.state === 'pushing-dolly'
      ? DOLLY_PUSH_SPEED_MULTIPLIER
      : (this.isSprinting ? SCENE_CONFIG.sprintMultiplier : 1);
    const speed = SCENE_CONFIG.playerSpeed * speedMult * deltaTime;

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
