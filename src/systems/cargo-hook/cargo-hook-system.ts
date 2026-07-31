import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { InteractableObject } from '../../shared/types/interactable';
import { PlayerInteractionData } from '../../core/game-state';
import { HUD } from '../hud';
import { PauseManager } from '../../core/pause-manager';
import { PhysicsSystem, GROUP_STATIC, GROUP_BOX } from '../../adapters/rapier/physics-system';
import { CargoSystem, CargoData } from '../cargo';
import { DailyFlowSystem } from '../daily-flow';
import {
  CARGO_HOOK_MAX_RANGE, CARGO_HOOK_FLIGHT_SPEED, CARGO_HOOK_MAX_ACTIVE_DURATION,
  CARGO_HOOK_STOP_DISTANCE, CARGO_HOOK_COOLDOWN, CARGO_HOOK_PULL_SPEED, CargoHookPullClass,
} from './cargo-hook-data';

type HookState = 'idle' | 'extending' | 'attached' | 'retracting' | 'cooldown';

/** The cargo hook tool ("Add tool hotbar and cargo hook" round 三/四/五/六/
 * 七/八) — a simple grapple-style state machine that fires a visible hook
 * head from the crosshair, pulls valid Cargo toward the player using its
 * OWN existing Rapier RigidBody (never teleporting, never disabling
 * collision, never going kinematic — spec六), and self-cancels on every
 * listed safety trigger (spec八) by simply re-checking its own preconditions
 * every frame rather than needing every OTHER system to know about it.
 *
 * Deliberately reuses, rather than duplicates:
 * - `cargoSystem.resolveCargoFromObject` / `cargoDataMap` for "is this
 *   really Cargo" (spec四: never judges by mesh/model name).
 * - `InteractableObject.rigidBody.isEnabled()` for "is this pinned/shipping"
 *   — the exact same flag VehicleControlSystem.pinCargoPhysics already
 *   flips, so no new per-item metadata is introduced anywhere.
 * - The caller-supplied `inspectedCargo` (CargoInspectionSystem's own
 *   already-computed per-frame raycast) for the crosshair "can-hook"
 *   indicator — never runs a second per-frame raycast of its own (spec七).
 *   Its own raycast is a single ONE-SHOT query fired only at the moment of
 *   an F press (see fire()), which is a different thing from the per-frame
 *   duplication that instruction forbids.
 * - `pickupSystem.viewModelScene` (passed in) for the handheld tool prop,
 *   rendered through the SAME existing depth-cleared viewmodel pass
 *   game-app.ts already runs — no second render pass.
 */
export class CargoHookSystem {
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private cargoSystem: CargoSystem;
  private playerData: PlayerInteractionData;
  private hud: HUD;
  private pauseManager: PauseManager;
  private dailyFlowSystem: DailyFlowSystem;
  private isLocked: () => boolean;

  private state: HookState = 'idle';
  private raycaster = new THREE.Raycaster();
  private origin = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private travelDistance = 0;
  private currentDistance = 0;
  private targetId: string | null = null;
  private pullClass: CargoHookPullClass = 'medium';
  private activeDuration = 0;
  private cooldownTimer = 0;
  private lastKnownDay: number;

  private toolProp: THREE.Group;
  private hookHeadMesh: THREE.Mesh;
  private ropeLine: THREE.Line;
  private ropeGeometry: THREE.BufferGeometry;

  constructor(
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    viewModelScene: THREE.Scene,
    physics: PhysicsSystem,
    interactables: Map<string, InteractableObject>,
    cargoSystem: CargoSystem,
    playerData: PlayerInteractionData,
    hud: HUD,
    pauseManager: PauseManager,
    dailyFlowSystem: DailyFlowSystem,
    isLockedFn: () => boolean
  ) {
    this.camera = camera;
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;
    this.cargoSystem = cargoSystem;
    this.playerData = playerData;
    this.hud = hud;
    this.pauseManager = pauseManager;
    this.dailyFlowSystem = dailyFlowSystem;
    this.isLocked = isLockedFn;
    this.lastKnownDay = dailyFlowSystem.currentDay;

    this.toolProp = this.buildToolProp();
    this.toolProp.visible = false;
    viewModelScene.add(this.toolProp);

    this.hookHeadMesh = this.buildHookHead();
    this.hookHeadMesh.visible = false;
    // THREE's raycaster does NOT skip invisible objects by default (it only
    // checks layers, not `.visible`) — without this, the hook head's own
    // mesh (parked somewhere in world space between fires) could shadow the
    // REAL target on a later fire()'s own raycast, or spuriously show up in
    // CargoInspectionSystem's unrelated crosshair raycast. Neither this nor
    // the rope below should ever be a valid hit for ANY raycast in the game.
    this.hookHeadMesh.raycast = () => {};
    this.scene.add(this.hookHeadMesh);

    this.ropeGeometry = new THREE.BufferGeometry();
    this.ropeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.ropeLine = new THREE.Line(this.ropeGeometry, new THREE.LineBasicMaterial({ color: 0x2a2a2a }));
    this.ropeLine.visible = false;
    this.ropeLine.frustumCulled = false;
    this.ropeLine.raycast = () => {};
    this.scene.add(this.ropeLine);

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  /** Simple low-poly handle + hook head + coiled rope (spec七) — plain
   * primitive geometry built for this game, no external assets, no
   * character arm. Sits bottom-right of the viewmodel camera. */
  private buildToolProp(): THREE.Group {
    const group = new THREE.Group();

    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.04, 0.28, 8),
      new THREE.MeshStandardMaterial({ color: 0x4a3a2a })
    );
    handle.rotation.x = Math.PI / 2.4;
    group.add(handle);

    const head = new THREE.Mesh(
      new THREE.ConeGeometry(0.05, 0.14, 6),
      new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.6, roughness: 0.4 })
    );
    head.position.set(0, 0.08, -0.16);
    head.rotation.x = -Math.PI / 2.2;
    group.add(head);

    const coil = new THREE.Mesh(
      new THREE.TorusGeometry(0.07, 0.015, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x5a4a35 })
    );
    coil.position.set(0.02, -0.08, 0.05);
    coil.rotation.x = Math.PI / 2;
    group.add(coil);

    group.position.set(0.45, -0.4, -0.65);
    group.rotation.y = -0.3;
    return group;
  }

  private buildHookHead(): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.16, 6),
      new THREE.MeshStandardMaterial({ color: 0xbbbbbb, metalness: 0.7, roughness: 0.3 })
    );
  }

  private determinePullClass(cargoData: CargoData): CargoHookPullClass {
    if (cargoData.category === 'live') return 'live';
    return cargoData.sizeClass ?? 'medium';
  }

  /** Single validity check reused by BOTH the fire-time target resolution
   * and the caller-supplied crosshair CargoData (spec四: "只允許勾取具有
   * Cargo資料與可活動RigidBody的貨物", judged purely off cargoDataMap
   * membership + rigidBody state — never mesh/model name). Also excludes
   * pinned/departing cargo for free: VehicleControlSystem.pinCargoPhysics
   * disables the SAME rigidBody flag this reads. */
  private isValidHookTarget(cargoData: CargoData | null | undefined): boolean {
    if (!cargoData) return false;
    const obj = this.interactables.get(cargoData.id);
    return !!obj && !!obj.rigidBody && obj.rigidBody.isEnabled() && !obj.isHeld && obj.canPickUp;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (event.code !== 'KeyF') return;
    if (!this.isLocked()) return;
    if (this.pauseManager.isPaused) return;
    if (this.playerData.activeTool !== 'cargoHook') return;
    if (this.state !== 'idle') return;
    this.fire();
  }

  /** A single ONE-SHOT raycast at the moment of firing (spec五: "從攝影機／
   * 準心中央向前取得射線方向") — distinct from the per-frame crosshair
   * indicator, which reuses the caller-supplied inspectedCargo instead (see
   * class doc comment). Nearest-hit-wins exactly like
   * CargoInspectionSystem's own raycast, so a wall between the player and
   * cargo naturally blocks targeting via normal raycast depth ordering. */
  private fire(): void {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.direction.copy(dir);
    this.origin.copy(this.camera.position);

    this.raycaster.set(this.origin, this.direction);
    this.raycaster.far = CARGO_HOOK_MAX_RANGE;
    const hits = this.raycaster.intersectObjects(this.scene.children, true);

    this.targetId = null;
    this.travelDistance = CARGO_HOOK_MAX_RANGE;
    if (hits.length > 0) {
      this.travelDistance = Math.min(hits[0].distance, CARGO_HOOK_MAX_RANGE);
      const cargoData = this.cargoSystem.resolveCargoFromObject(hits[0].object);
      if (this.isValidHookTarget(cargoData)) this.targetId = cargoData!.id;
    }

    this.currentDistance = 0;
    this.activeDuration = 0;
    this.state = 'extending';
    this.hookHeadMesh.visible = true;
    this.ropeLine.visible = true;
    this.hookHeadMesh.position.copy(this.origin);
  }

  private updateExtending(deltaTime: number): void {
    this.currentDistance = Math.min(this.currentDistance + CARGO_HOOK_FLIGHT_SPEED * deltaTime, this.travelDistance);
    this.hookHeadMesh.position.copy(this.origin).addScaledVector(this.direction, this.currentDistance);

    if (this.currentDistance < this.travelDistance) return;

    if (this.targetId) {
      const cargoData = this.cargoSystem.getCargoData(this.targetId);
      if (this.isValidHookTarget(cargoData)) {
        this.pullClass = this.determinePullClass(cargoData!);
        this.state = 'attached';
        return;
      }
    }
    this.beginRetract();
  }

  /** Pulls the target via a controlled velocity toward a point ~1.5m in
   * front of the player (spec六) — never setTranslation, never disabling
   * collision, never going kinematic. Re-validates the target every frame
   * (spec八: cargo removed / pinned-by-vehicle mid-pull both immediately
   * cancel) and casts a Rapier ray against ONLY static scene geometry
   * (reusing the exact GROUP_STATIC/GROUP_BOX packing castShapeMove already
   * established, spec六: "不建立第二套場景碰撞系統") to detect a wall
   * between the cargo and the stop point, detaching instantly if blocked. */
  private updateAttached(): void {
    const obj = this.targetId ? this.interactables.get(this.targetId) : null;
    const cargoData = this.targetId ? this.cargoSystem.getCargoData(this.targetId) : null;
    if (!obj || !obj.rigidBody || !this.isValidHookTarget(cargoData)) { this.beginRetract(); return; }

    const body = obj.rigidBody;
    const t = body.translation();
    const cargoPos = new THREE.Vector3(t.x, t.y, t.z);
    this.hookHeadMesh.position.copy(cargoPos);

    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1); else forward.normalize();
    const stopPoint = this.camera.position.clone();
    stopPoint.y = cargoPos.y;
    stopPoint.addScaledVector(forward, CARGO_HOOK_STOP_DISTANCE);

    const toStop = stopPoint.sub(cargoPos);
    toStop.y = 0;
    const dist = toStop.length();

    if (dist <= 0.15) {
      body.setLinvel({ x: 0, y: body.linvel().y, z: 0 }, true);
      this.beginRetract();
      return;
    }

    const rayDir = toStop.clone().normalize();
    const ray = new RAPIER.Ray({ x: cargoPos.x, y: cargoPos.y, z: cargoPos.z }, { x: rayDir.x, y: rayDir.y, z: rayDir.z });
    const hit = this.physics.world.castRay(ray, dist, true, undefined, (GROUP_BOX << 16) | GROUP_STATIC);
    if (hit) { this.beginRetract(); return; }

    const speed = CARGO_HOOK_PULL_SPEED[this.pullClass];
    const currentVel = body.linvel();
    body.setLinvel({ x: rayDir.x * speed, y: currentVel.y, z: rayDir.z * speed }, true);
    body.wakeUp();
  }

  /** Purely visual — retracts the head from wherever it currently is (the
   * fire-time flight path, or the last-known cargo position if it was
   * attached) back toward the camera, never re-deriving from the original
   * origin/direction so a mid-pull cancel retracts smoothly from where the
   * cargo actually was. */
  private updateRetracting(deltaTime: number): void {
    const toCamera = this.camera.position.clone().sub(this.hookHeadMesh.position);
    const dist = toCamera.length();
    const step = CARGO_HOOK_FLIGHT_SPEED * deltaTime;
    if (dist <= Math.max(step, 0.05)) { this.finishRetract(); return; }
    this.hookHeadMesh.position.addScaledVector(toCamera.normalize(), step);
  }

  private beginRetract(): void {
    if (this.state === 'retracting' || this.state === 'idle' || this.state === 'cooldown') return;
    this.targetId = null;
    this.state = 'retracting';
  }

  private finishRetract(): void {
    this.state = 'cooldown';
    this.cooldownTimer = CARGO_HOOK_COOLDOWN;
    this.hookHeadMesh.visible = false;
    this.ropeLine.visible = false;
  }

  /** Immediate cancel + full visual cleanup (spec八) — safe to call from any
   * state, including 'idle' (no-op). Used both by update()'s own
   * self-cancel checks below and implicitly covers every listed trigger:
   * switching tools / opening UI / pausing (playerData.activeTool /
   * pauseManager checked every frame in update()), day transitions
   * (lastKnownDay check), and the 2.5s timeout (handled inline in update()
   * via beginRetract(), which this does not replace — cancel() is for the
   * HARD triggers that must drop everything immediately, not the soft
   * retract-then-cooldown flow). */
  private cancel(): void {
    if (this.state === 'idle') return;
    this.state = 'idle';
    this.targetId = null;
    this.cooldownTimer = 0;
    this.activeDuration = 0;
    this.currentDistance = 0;
    this.hookHeadMesh.visible = false;
    this.ropeLine.visible = false;
  }

  private updateRopeVisual(): void {
    const down = new THREE.Vector3(0, -1, 0);
    const start = this.camera.position.clone().addScaledVector(down, 0.15);
    const positions = this.ropeGeometry.attributes.position as THREE.BufferAttribute;
    positions.setXYZ(0, start.x, start.y, start.z);
    const head = this.hookHeadMesh.position;
    positions.setXYZ(1, head.x, head.y, head.z);
    positions.needsUpdate = true;
  }

  /** `inspectedCargo` is CargoInspectionSystem's own already-computed
   * per-frame crosshair raycast result (see class doc comment) — this
   * method never raycasts on its own except once inside fire(). */
  update(deltaTime: number, inspectedCargo: CargoData | null): void {
    const isSelected = this.playerData.activeTool === 'cargoHook';
    this.toolProp.visible = isSelected;
    if (isSelected) {
      this.hud.showToolPrompt('F 發射捕貨鉤');
      this.hud.setCargoHookReady(this.isValidHookTarget(inspectedCargo));
    } else {
      this.hud.setCargoHookReady(false);
    }

    if (this.dailyFlowSystem.currentDay !== this.lastKnownDay) {
      this.lastKnownDay = this.dailyFlowSystem.currentDay;
      this.cancel();
      return;
    }

    if (this.pauseManager.isPaused) { this.cancel(); return; }
    if (!isSelected) { this.cancel(); return; }
    if (this.state === 'idle') return;

    if (this.state === 'cooldown') {
      this.cooldownTimer -= deltaTime;
      if (this.cooldownTimer <= 0) this.state = 'idle';
      return;
    }

    if (this.state !== 'retracting') {
      this.activeDuration += deltaTime;
      if (this.activeDuration >= CARGO_HOOK_MAX_ACTIVE_DURATION) this.beginRetract();
    }

    if (this.state === 'extending') this.updateExtending(deltaTime);
    else if (this.state === 'attached') this.updateAttached();
    else if (this.state === 'retracting') this.updateRetracting(deltaTime);

    this.updateRopeVisual();
  }
}
