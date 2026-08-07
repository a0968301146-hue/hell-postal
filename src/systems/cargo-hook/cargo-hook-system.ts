import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { InteractableObject } from '../../shared/types/interactable';
import { PlayerInteractionData } from '../../core/game-state';
import { HUD } from '../hud';
import { PauseManager } from '../../core/pause-manager';
import { PhysicsSystem, GROUP_STATIC, GROUP_BOX } from '../../adapters/rapier/physics-system';
import { CargoSystem, CargoData } from '../cargo';
import { DailyFlowSystem } from '../daily-flow';
import { PickupSystem } from '../interaction';
import { ToolSystem } from '../tool';
import { EnvelopeStackSystem } from '../mail/envelope-stack-system';
import { LOST_ITEM_ID_PREFIX } from '../lost-found/lost-found-system';
import {
  CARGO_HOOK_MAX_RANGE, CARGO_HOOK_FLIGHT_SPEED, CARGO_HOOK_MAX_ACTIVE_DURATION,
  CARGO_HOOK_CATCH_DISTANCE, CARGO_HOOK_COOLDOWN, CARGO_HOOK_PULL_SPEED, CargoHookPullClass,
  CARGO_HOOK_LIFT_DURATION, CARGO_HOOK_LIFT_HEIGHT, CARGO_HOOK_ARC_HEIGHT_BONUS,
} from './cargo-hook-data';

type HookState = 'idle' | 'extending' | 'attached' | 'retracting';
type AttachedPhase = 'lift' | 'arc';

/** The cargo hook tool. "Improve cargo hook aerial pickup" round introduced
 * the right-click trigger and lift+arc catch flow; "Add power gloves and
 * refine cargo hook cooldown" round narrows WHEN the 3s cooldown actually
 * applies and stops auto-switching back to bare-hands on a catch — no other
 * system is touched beyond the narrow integration points this tool has
 * always needed (InteractionSystem's right-click guard, PickupSystem's
 * activeTool pickup guard).
 *
 * Trigger is right-click; F is fully owned by InteractionSystem's existing
 * handler and never touched here.
 *
 * On a hit, the cargo lifts straight up for ~0.2s by a per-size height, then
 * flies a smooth aerial arc toward a catch point ~1.1m in front of the
 * player, and — once it arrives — is handed to the player through the REAL
 * `PickupSystem.pickUp()`, never by directly writing heldObjectId or
 * cloning a viewmodel mesh by hand. The tool stays selected (cargoHook)
 * whether the catch succeeds or fails — see attemptCatch()'s own doc
 * comment ("Add power gloves..." round spec二: "勾到貨物後不要切回徒手").
 * On failure (pickUp() silently no-ops if canAddToHeld() rejects it) the
 * cargo is simply released — force stops, gravity/damping resume on their
 * own since it was never made kinematic or had its collider disabled — and
 * nothing is deleted.
 *
 * Every frame in flight, the path to the NEXT position (this frame's
 * intended step, not the final destination) is swept with the cargo's own
 * actual collider half-extents via Rapier's `castShape` (spec四: "優先使用
 * 貨物實際Collider尺寸"), filtered against BOTH GROUP_STATIC (walls/door
 * frames/ceiling/shelves) and GROUP_BOX — vehicle shell/ramp colliders are
 * ALSO GROUP_BOX (see physics-system.ts's addColliderToBody), so excluding
 * it would silently let the arc pass through a vehicle's body, which spec四
 * explicitly forbids. This reuses the exact same collision-group packing
 * convention `castShapeMove` already established — no second collision
 * system.
 *
 * Cooldown (3s) is tracked in its own `cooldownTimer` field, decremented
 * every frame regardless of `state`/tool selection so switching tools away
 * and back can never bypass a cooldown that's already counting down — but
 * ("Add power gloves..." round spec一) it is ONLY ever started once the
 * hook has genuinely LATCHED ONTO a valid Cargo (entered 'attached'),
 * whether that sequence then succeeds or fails. A pure miss — nothing valid
 * at the hit point, or the target invalidated before the hook even arrives
 * — retracts through extending → retracting → idle with NO cooldown at
 * all, so `beginRetract()` (the miss/never-attached path) never touches
 * `cooldownTimer`; only `finishSequence()` (every attached-phase exit) and
 * `cancel()` (guarded to only apply while `state === 'attached'`) do. */
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
  private pickupSystem: PickupSystem;
  private toolSystem: ToolSystem;
  private isLocked: () => boolean;
  /** "貨物勾勾修改" round — envelope pickup never routes through the
   * generic PickupSystem.pickUp() (see class doc comment on attemptCatch),
   * so hooking a loose envelope needs the SAME real API E-key pickup
   * already uses. Also doubles as the "is this id an envelope" signal
   * (canPickUpTarget returns false for any non-envelope id — see
   * envelope-stack-system.ts's own eligibleGroundState). */
  private envelopeStackSystem: EnvelopeStackSystem;

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
  /** "Rebuild pallet storage and reset upgrade progression" round二: tracks
   * whether THIS tool owned the shared #interaction-prompt element last
   * frame, purely to fire a one-shot hideInteractionPrompt() the instant it
   * stops (see update()'s own doc comment for why). */
  private wasSelectedLastFrame = false;

  private attachedPhase: AttachedPhase = 'lift';
  private liftTargetY = 0;
  private arcStartPos = new THREE.Vector3();
  private arcTotalHorizontalDist = 0;
  private arcDuration = 0;
  private arcElapsed = 0;

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
    pickupSystem: PickupSystem,
    toolSystem: ToolSystem,
    isLockedFn: () => boolean,
    envelopeStackSystem: EnvelopeStackSystem
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
    this.pickupSystem = pickupSystem;
    this.toolSystem = toolSystem;
    this.isLocked = isLockedFn;
    this.envelopeStackSystem = envelopeStackSystem;
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

    document.addEventListener('mousedown', (e) => this.onMouseDown(e));
  }

  /** Simple low-poly handle + hook head + coiled rope (spec七, prior round)
   * — plain primitive geometry built for this game, no external assets, no
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

  private determinePullClassById(id: string): CargoHookPullClass {
    const cargoData = this.cargoSystem.getCargoData(id);
    if (cargoData) return cargoData.category === 'live' ? 'live' : (cargoData.sizeClass ?? 'medium');
    return 'small';
  }

  /** Single validity check reused by the fire-time target resolution, the
   * per-frame re-validation during flight, and the caller-supplied
   * crosshair CargoData (spec四, prior round: "只允許勾取具有Cargo資料與可
   * 活動RigidBody的貨物", judged purely off rigidBody state — never
   * mesh/model name). Also excludes pinned/departing cargo for free:
   * VehicleControlSystem.pinCargoPhysics disables the SAME rigidBody flag
   * this reads. "貨物勾勾修改" round: now id-based rather than requiring a
   * CargoData, so the SAME generic check covers lost-found items and
   * envelopes too — category-specific eligibility (e.g. an envelope's own
   * stack-capacity/processing-state rules) is layered on TOP of this by
   * resolveNonCargoHookId below, never loosened here. */
  private isValidHookTarget(id: string | null | undefined): boolean {
    if (!id) return false;
    const obj = this.interactables.get(id);
    return !!obj && !!obj.rigidBody && obj.rigidBody.isEnabled() && !obj.isHeld && obj.canPickUp;
  }

  /** "貨物勾勾修改" round — widens targeting beyond real Cargo (spec: "貨物
   * 勾勾...也可以勾失物招領物品／信件／信件整疊") via the generic
   * `mesh.userData.interactableId` tag EVERY InteractableObject now carries
   * (shared/types/interactable.ts), walked the same way
   * CargoSystem.resolveCargoFromObject walks its own cargoId-only tag — but
   * only lost-found items (any id with the LOST_ITEM_ID_PREFIX) and
   * envelopes (envelopeStackSystem.canPickUpTarget — the SAME real
   * eligibility gate the E-key pickup path already uses, so hook
   * eligibility can never diverge from normal pickup eligibility) are ever
   * accepted; anything else found this way (pallets, mail-bag crates,
   * vehicles, the ladder/tool cart, ...) is deliberately rejected so this
   * widening can never make those hookable too. */
  private resolveNonCargoHookId(hitObject: THREE.Object3D): string | null {
    let current: THREE.Object3D | null = hitObject;
    while (current) {
      const id = current.userData.interactableId as string | undefined;
      if (id) {
        const isLostItem = id.startsWith(LOST_ITEM_ID_PREFIX);
        const isEnvelope = this.envelopeStackSystem.canPickUpTarget(id);
        return (isLostItem || isEnvelope) && this.isValidHookTarget(id) ? id : null;
      }
      current = current.parent;
    }
    return null;
  }

  /** Sweeps the cargo's OWN collider half-extents (InteractableObject's
   * width/height/depth — spec四: "優先使用貨物實際Collider尺寸") from its
   * current position to its intended NEXT position this frame, filtered
   * against static scene geometry AND GROUP_BOX (vehicle shell/ramp
   * colliders share GROUP_BOX with cargo — see class doc comment), excluding
   * the cargo's own collider so it never blocks against itself.
   *
   * "Fix pallet throw and add spray paint tool" round二: GROUP_BOX also
   * covers every OTHER loose Cargo item, which meant pulling the bottom box
   * out of a stack immediately cancelled the hook the instant the lift swept
   * into whatever was resting on top of it — spec explicitly wants stacked
   * cargo pulled out from underneath, with the item(s) above it toppling
   * naturally instead of blocking the hook outright. Since collision
   * GROUPS alone can't distinguish "another movable Cargo" from "a vehicle
   * shell/ramp" or "the sorting pallet" (all three share GROUP_BOX
   * membership), this adds a `filterPredicate` that excludes ONLY colliders
   * belonging to a genuinely tracked, currently-movable Cargo item (i.e. one
   * with an id in cargoSystem.cargoDataMap) — vehicle/pallet/static geometry
   * still cancels the hook exactly as before. This ONLY affects this
   * obstruction QUERY; the actual Rapier collision groups are untouched, so
   * the target's real body still physically collides with (and can push,
   * topple, or knock loose) whatever cargo is actually in its way once it's
   * moving, via normal simulation — never disabled, never forced kinematic. */
  private isPathBlocked(obj: InteractableObject, fromPos: THREE.Vector3, toPos: THREE.Vector3): boolean {
    const movement = toPos.clone().sub(fromPos);
    if (movement.lengthSq() < 1e-8) return false;
    const rot = obj.rigidBody!.rotation();
    const shape = new RAPIER.Cuboid(Math.max(obj.width / 2, 0.02), Math.max(obj.height / 2, 0.02), Math.max(obj.depth / 2, 0.02));

    const movableCargoHandles = new Set<number>();
    for (const id of this.cargoSystem.cargoDataMap.keys()) {
      if (id === obj.id) continue;
      const other = this.interactables.get(id);
      if (other?.collider) movableCargoHandles.add(other.collider.handle);
    }

    const hit = this.physics.world.castShape(
      { x: fromPos.x, y: fromPos.y, z: fromPos.z },
      { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
      { x: movement.x, y: movement.y, z: movement.z },
      shape, 0.0, 1.0, false,
      undefined, (GROUP_BOX << 16) | (GROUP_STATIC | GROUP_BOX),
      obj.collider ?? undefined,
      undefined,
      (collider) => !movableCargoHandles.has(collider.handle)
    );
    return hit !== null;
  }

  private onMouseDown(event: MouseEvent): void {
    if (event.button !== 2) return;
    if (!this.isLocked()) return;
    if (this.pauseManager.isPaused) return;
    if (this.playerData.activeTool !== 'cargoHook') return;
    // "Add power gloves and refine cargo hook cooldown" round spec二: "手上
    // 有物品時右鍵不可再次發射" — the tool stays selected after a catch, so
    // this can no longer rely on activeTool switching away to block re-fire.
    if (this.playerData.state !== 'empty-handed') return;
    if (this.state !== 'idle') return;
    if (this.cooldownTimer > 0) return;
    this.fire();
  }

  /** A single ONE-SHOT raycast at the moment of firing (spec五, prior round:
   * "從攝影機／準心中央向前取得射線方向") — distinct from the per-frame
   * crosshair indicator, which reuses the caller-supplied inspectedCargo
   * instead (see class doc comment). Nearest-hit-wins exactly like
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
      if (cargoData && this.isValidHookTarget(cargoData.id)) {
        this.targetId = cargoData.id;
      } else {
        // "貨物勾勾修改" round — only tried once real cargo resolution
        // already failed, so this can never override a genuine cargo hit.
        this.targetId = this.resolveNonCargoHookId(hits[0].object);
      }
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
      if (this.isValidHookTarget(this.targetId)) {
        this.pullClass = this.determinePullClassById(this.targetId);
        this.beginAttach();
        return;
      }
    }
    // Miss: nothing valid at the hit point — keep the ORIGINAL animated
    // retract (spec五, prior round: "勾頭到達最大距離後收回"), unrelated to
    // this round's aerial-pickup changes.
    this.beginRetract();
  }

  /** Enters the attached phase, starting with the straight-up lift
   * (spec三). */
  private beginAttach(): void {
    const obj = this.targetId ? this.interactables.get(this.targetId) : null;
    if (!obj || !obj.rigidBody) { this.beginRetract(); return; }
    const t = obj.rigidBody.translation();
    this.state = 'attached';
    this.attachedPhase = 'lift';
    this.liftTargetY = t.y + CARGO_HOOK_LIFT_HEIGHT[this.pullClass];
  }

  private updateAttached(deltaTime: number): void {
    const obj = this.targetId ? this.interactables.get(this.targetId) : null;
    if (!obj || !obj.rigidBody || !this.isValidHookTarget(this.targetId)) { this.finishSequence(); return; }

    const body = obj.rigidBody;
    const t = body.translation();
    const cargoPos = new THREE.Vector3(t.x, t.y, t.z);
    this.hookHeadMesh.position.copy(cargoPos);

    if (this.attachedPhase === 'lift') this.updateLiftPhase(deltaTime, obj, body, cargoPos);
    else this.updateArcPhase(deltaTime, obj, body, cargoPos);
  }

  /** Phase 1 (spec三): pure vertical lift over CARGO_HOOK_LIFT_DURATION,
   * horizontal velocity zeroed so it rises straight up regardless of
   * whatever it was resting against. Checked each frame against the SAME
   * obstruction sweep as the arc phase (a low ceiling/shelf overhang above
   * the item cancels the lift immediately). */
  private updateLiftPhase(deltaTime: number, obj: InteractableObject, body: RAPIER.RigidBody, cargoPos: THREE.Vector3): void {
    const remainingHeight = this.liftTargetY - cargoPos.y;
    if (remainingHeight <= 0.03) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.beginArcPhase(cargoPos);
      return;
    }
    const liftSpeed = CARGO_HOOK_LIFT_HEIGHT[this.pullClass] / CARGO_HOOK_LIFT_DURATION;
    const vy = Math.min(liftSpeed, remainingHeight / Math.max(deltaTime, 1e-4));
    const nextPos = cargoPos.clone();
    nextPos.y += vy * deltaTime;
    if (this.isPathBlocked(obj, cargoPos, nextPos)) { this.finishSequence(); return; }
    body.setLinvel({ x: 0, y: vy, z: 0 }, true);
    body.wakeUp();
  }

  private beginArcPhase(cargoPos: THREE.Vector3): void {
    this.attachedPhase = 'arc';
    this.arcStartPos.copy(cargoPos);
    const horizDist = Math.hypot(this.camera.position.x - cargoPos.x, this.camera.position.z - cargoPos.z);
    this.arcTotalHorizontalDist = Math.max(horizDist, 0.01);
    this.arcDuration = Math.max(this.arcTotalHorizontalDist / CARGO_HOOK_PULL_SPEED[this.pullClass], 0.05);
    this.arcElapsed = 0;
  }

  /** Phase 2 (spec三/二): a smooth lobbed arc toward a catch point ~1.1m in
   * front of the player (spec二's exact distance), re-aimed every frame off
   * the player's LIVE position (matching the previous ground-pull's own
   * per-frame stop-point convention) — horizontal motion is a constant-speed
   * homing chase capped at the pull-class speed (spec三), vertical motion
   * tracks a sine-bumped curve between the lift height and the catch height
   * so the path reads as a genuine arc rather than a flat glide. Once the
   * catch point is reached, hands off to PickupSystem (spec二). */
  private updateArcPhase(deltaTime: number, obj: InteractableObject, body: RAPIER.RigidBody, cargoPos: THREE.Vector3): void {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1); else forward.normalize();
    const catchPoint = this.camera.position.clone().addScaledVector(forward, CARGO_HOOK_CATCH_DISTANCE);
    catchPoint.y = this.camera.position.y - 0.3;

    const toTarget = catchPoint.clone().sub(cargoPos);
    const horizDist = Math.hypot(toTarget.x, toTarget.z);

    if (horizDist <= 0.35) { this.attemptCatch(obj); return; }

    this.arcElapsed += deltaTime;
    const t = Math.min(this.arcElapsed / this.arcDuration, 1);
    const desiredY = THREE.MathUtils.lerp(this.arcStartPos.y, catchPoint.y, t) + Math.sin(t * Math.PI) * CARGO_HOOK_ARC_HEIGHT_BONUS;

    const speed = CARGO_HOOK_PULL_SPEED[this.pullClass];
    const dirXZ = new THREE.Vector3(toTarget.x, 0, toTarget.z).normalize();
    const horizSpeed = Math.min(speed, horizDist / Math.max(deltaTime, 1e-4));
    const vx = dirXZ.x * horizSpeed;
    const vz = dirXZ.z * horizSpeed;
    const vy = THREE.MathUtils.clamp((desiredY - cargoPos.y) / Math.max(deltaTime, 1e-4), -4, 4);

    const nextPos = cargoPos.clone().add(new THREE.Vector3(vx, vy, vz).multiplyScalar(deltaTime));
    if (this.isPathBlocked(obj, cargoPos, nextPos)) { this.finishSequence(); return; }

    body.setLinvel({ x: vx, y: vy, z: vz }, true);
    body.wakeUp();

    if (t >= 1) this.attemptCatch(obj);
  }

  /** Hands the caught item to the REAL PickupSystem (never directly writes
   * heldObjectId, never clones a mesh by hand) — pickUp() itself is the
   * single source of truth for whether the catch actually succeeds
   * (canAddToHeld() may still reject it, e.g. capacity already full from
   * some other source); nothing here needs to branch on success vs failure
   * since both paths end the same way. The tool deliberately stays selected
   * on cargoHook either way ("Add power gloves and refine cargo hook
   * cooldown" round spec二: "勾到貨物後不要切回徒手...移除
   * ToolSystem.trySelect('empty')") — E-place/Q-throw of whatever ends up
   * held work regardless of activeTool (see pickup-system.ts's own
   * placement/throw paths, neither of which is gated on it), and
   * onMouseDown above already blocks re-firing while anything is held. On
   * failure the cargo is simply released, never deleted — pickUp() never
   * touched its rigidBody in that case, so it keeps whatever velocity this
   * frame's arc math last gave it and gravity/damping take over exactly as
   * if the hook had just let go mid-air.
   *
   * "貨物勾勾修改" round — an ENVELOPE never goes through PickupSystem.
   * pickUp() at all (see mail-system.ts/envelope-stack-system.ts — E-key
   * pickup routes through EnvelopeStackSystem.pickUpTarget() instead, which
   * correctly ADDS to an already-carried stack rather than conflicting with
   * it), so a caught envelope is handed off through that SAME real API,
   * satisfying "勾起後的行為與一般貨物一致：可以收回/放下/丟出" by reusing
   * the mechanism that already provides exactly that for envelopes. Lost-
   * found items have no such special path — they already go through
   * pickUp() for normal E-key pickup — so they fall through to the
   * unchanged cargo branch below. */
  private attemptCatch(obj: InteractableObject): void {
    if (this.envelopeStackSystem.canPickUpTarget(obj.id)) {
      this.envelopeStackSystem.pickUpTarget(obj.id);
      this.finishSequence();
      return;
    }
    // bypassToolGate=true: PickupSystem.canAddToHeld() would otherwise
    // reject this hand-off since activeTool is still 'cargoHook' at this
    // exact moment (the tool deliberately stays selected through a catch —
    // see class doc comment) — see pickup-system.ts's own doc comment on
    // why this parameter exists ONLY for this call.
    this.pickupSystem.pickUp(obj, true);
    this.finishSequence();
  }

  /** Purely visual — retracts the head from wherever it currently is (the
   * fire-time flight path) back toward the camera. Only reached from a
   * miss during 'extending' (see updateExtending/onMouseDown's timeout
   * check) — every attached-phase termination goes through finishSequence()
   * instead, which hides instantly rather than animating a flight back from
   * mid-air. */
  private updateRetracting(deltaTime: number): void {
    const toCamera = this.camera.position.clone().sub(this.hookHeadMesh.position);
    const dist = toCamera.length();
    const step = CARGO_HOOK_FLIGHT_SPEED * deltaTime;
    if (dist <= Math.max(step, 0.05)) { this.finishRetract(); return; }
    this.hookHeadMesh.position.addScaledVector(toCamera.normalize(), step);
  }

  /** Miss / never-attached path ONLY — a target that was never valid to
   * begin with, or stopped being valid before the hook head even arrived.
   * "Add power gloves and refine cargo hook cooldown" round spec一:
   * "extending → retracting → idle...不可設定cooldownTimer" — deliberately
   * does NOT touch cooldownTimer, unlike finishSequence()/cancel() below,
   * both of which only ever fire once the hook has genuinely attached. */
  private beginRetract(): void {
    if (this.state === 'retracting' || this.state === 'idle') return;
    this.targetId = null;
    this.state = 'retracting';
  }

  private finishRetract(): void {
    this.state = 'idle';
    this.hookHeadMesh.visible = false;
    this.ropeLine.visible = false;
  }

  /** Instant terminal cleanup for every ATTACHED-phase outcome (success /
   * wall-block / target-invalidated / timeout-while-attached) — all enter
   * cooldown immediately (this round's spec一: "成功附著有效Cargo後，不論
   * 成功手持或途中失敗：進入3秒冷卻"), no animated retract since the cargo
   * may be anywhere in mid-air. Only ever called once `state === 'attached'`
   * has already been reached, so unconditionally setting cooldownTimer here
   * is always correct — this is the ONE place a successful/failed catch
   * itself starts the cooldown. */
  private finishSequence(): void {
    this.cooldownTimer = CARGO_HOOK_COOLDOWN;
    this.state = 'idle';
    this.attachedPhase = 'lift';
    this.targetId = null;
    this.hookHeadMesh.visible = false;
    this.ropeLine.visible = false;
  }

  /** Immediate cancel + full visual cleanup (tool-switch/pause/UI/day-change
   * mid-sequence) — safe to call from any state, including 'idle' (no-op).
   * Only starts a fresh cooldown if it interrupts a sequence that had
   * ALREADY latched onto valid Cargo (`state === 'attached'`) — spec一: "尚
   * 未附著Cargo：不進冷卻" applies here too, so cancelling out of
   * 'extending'/'retracting' (never attached, or already miss-retracting
   * with no cooldown pending) stays cooldown-free, while cancelling out of
   * 'attached' still can't be used to dodge the cooldown a normal
   * finishSequence() would have imposed. */
  private cancel(): void {
    if (this.state === 'idle') return;
    if (this.state === 'attached') this.cooldownTimer = CARGO_HOOK_COOLDOWN;
    this.state = 'idle';
    this.attachedPhase = 'lift';
    this.targetId = null;
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

    // Cooldown ticks down unconditionally, regardless of state or tool
    // selection (spec五: "切換工具不能繞過") — see class doc comment.
    if (this.cooldownTimer > 0) this.cooldownTimer = Math.max(0, this.cooldownTimer - deltaTime);
    this.toolSystem.setCooldown(this.cooldownTimer, CARGO_HOOK_COOLDOWN);

    // While something is held, PickupSystem/InteractionSystem already own
    // the prompt every frame (the "按 E 選擇放置位置\n按住 Q 蓄力丟出" hint,
    // same as any other held item — "Add power gloves..." round spec二: E/Q
    // must keep working normally on a caught item) — this tool's own prompt
    // would otherwise stomp it every frame purely because cargoHook stays
    // selected through a catch now. Only override the prompt while genuinely
    // empty-handed, i.e. actually able to fire.
    if (isSelected && this.playerData.state === 'empty-handed') {
      this.hud.showToolPrompt(
        this.cooldownTimer > 0 ? `冷卻中 ${this.cooldownTimer.toFixed(1)}s` : '右鍵 發射捕貨鉤'
      );
      this.hud.setCargoHookReady(this.cooldownTimer <= 0 && this.state === 'idle' && this.isValidHookTarget(inspectedCargo?.id));
    } else {
      this.hud.setCargoHookReady(false);
      // "Rebuild pallet storage and reset upgrade progression" round二: this
      // tool's own showToolPrompt() above writes into the SAME shared
      // #interaction-prompt element InteractionSystem owns (see hud.ts's own
      // doc comment on showToolPrompt — its "hand-back" assumption only
      // holds if InteractionSystem's raycast-detected currentTarget CHANGES
      // on some later frame, which never happens for a purely proximity-
      // gated target like the lost-found NPC counter). Without this, the
      // last text this tool wrote (e.g. "冷卻中 2.5s") stayed stuck on
      // screen after switching tools away, even though the underlying E
      // interaction still worked — reading to the player as "can't
      // interact". Firing exactly once on the isSelected->false transition
      // (not every frame while deselected) hands the element back cleanly
      // without fighting any OTHER system that might show its own prompt
      // later this same frame.
      if (this.wasSelectedLastFrame) this.hud.hideInteractionPrompt();
    }
    this.wasSelectedLastFrame = isSelected && this.playerData.state === 'empty-handed';

    if (this.dailyFlowSystem.currentDay !== this.lastKnownDay) {
      this.lastKnownDay = this.dailyFlowSystem.currentDay;
      this.cancel();
      return;
    }

    if (this.pauseManager.isPaused) { this.cancel(); return; }
    if (!isSelected) { this.cancel(); return; }
    if (this.state === 'idle') return;

    if (this.state !== 'retracting') {
      this.activeDuration += deltaTime;
      if (this.activeDuration >= CARGO_HOOK_MAX_ACTIVE_DURATION) {
        if (this.state === 'attached') { this.finishSequence(); return; }
        this.beginRetract();
      }
    }

    if (this.state === 'extending') this.updateExtending(deltaTime);
    else if (this.state === 'attached') this.updateAttached(deltaTime);
    else if (this.state === 'retracting') this.updateRetracting(deltaTime);

    this.updateRopeVisual();
  }
}
