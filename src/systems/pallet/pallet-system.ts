import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../../shared/types/interactable';
import { PlayerInteractionData } from '../../core/game-state';
import { PauseManager } from '../../core/pause-manager';
import { CargoSystem } from '../cargo';
import { HUD } from '../hud';
import { UpgradeSystem } from '../upgrade';
// Imported directly from pickup-system.ts, NOT the '../interaction' barrel
// — that barrel also re-exports interaction-system.ts, which itself
// imports from '../pallet' (VehicleControlSystem's own pallet-recognition
// needs), so going through the barrel here would create a real import
// cycle (interaction barrel -> interaction-system -> pallet barrel ->
// pallet-system -> interaction barrel).
import { PalletThrowHooks } from '../interaction/pickup-system';
import { PALLET_CONFIG } from '../daily-flow';
import { BACK_AREA, WORLD_BOUNDS } from '../world-layout';
import { createFloatingLabel } from '../../adapters/three/world-label-system';

const STABLE_THRESHOLD = 0.5; // seconds, organize judgment
const VELOCITY_THRESHOLD = 0.4;

/** How far in front of the camera the pallet's carry position sits, PLUS the
 * union bounds' own horizontal half-extent (so a bigger load sits further
 * away — spec 四: "需要依托盤與托盤貨物的 union bounds 動態調整距離"). */
const CARRY_BASE_FORWARD_DIST = 1.0;
/** How far below eye level the union bounds' CENTER sits while walking. */
const CARRY_DROP_BELOW_EYE = 0.45;
/** Never let the union bounds' bottom get closer than this to the floor
 * while WALKING (this is the actual root cause of the pickup bug this round
 * fixes — see updateCarry's doc comment: the old code computed the SAME
 * floor-touching height for both "walking" and "final placement", which
 * made the swept-collision shape start every frame already embedded in the
 * floor's static collider, permanently freezing the carry position). */
const CARRY_MIN_FLOOR_CLEARANCE = 0.15;
/** Never let the union bounds' top rise above camera eye level by more than
 * this (spec四: "大型貨物不會穿過攝影機"). */
const CARRY_MAX_ABOVE_EYE = 0.35;
/** Minimum horizontal clearance between the carry center and the camera —
 * defensive floor under "手持物不會位於玩家膠囊內" (spec四/七), on top of
 * the natural clearance CARRY_BASE_FORWARD_DIST already provides. */
const MIN_CAMERA_CLEARANCE = 0.6;

/** How high above the pallet's local top surface `uiAnchor` sits ("Fix
 * pallet visual and interaction UI following" round spec三: "uiAnchor位於
 * 托盤中心上方約0.3～0.5m"). */
const UI_ANCHOR_HEIGHT_ABOVE_TOP = 0.4;

/** "Add placement rotation and pallet cargo straps" round spec一: manual
 * yaw step per wheel notch, world-Y-only. */
const PLACEMENT_YAW_STEP = THREE.MathUtils.degToRad(15);

/** Rope strap visual thickness/height (spec六: "簡單繩索") — plain flat
 * bars, not modeled rope geometry. */
const ROPE_STRAP_THICKNESS = 0.05;
const ROPE_STRAP_HEIGHT = 0.03;

/** Stable id for the one pallet this round — exported so other systems that
 * need to recognize "is this the pallet" (VehicleControlSystem's departure
 * logic) can do so with a plain string import instead of a class reference
 * (avoids a circular dependency between pallet-system.ts and
 * vehicle-control-system.ts). */
export const PALLET_ID = 'pallet-1';

interface PinnedCargoEntry {
  obj: InteractableObject;
  localPos: THREE.Vector3;
  localQuat: THREE.Quaternion;
}

/**
 * A single wooden pallet — a genuine pickupable InteractableObject
 * integrated into the shared E-key flow (targeted/raycast like any cargo
 * item, picked up via PalletSystem.pickUp() from InteractionSystem's
 * Priority-1 branch — see interaction-system.ts), NOT a second independent
 * input system.
 *
 * SINGLE MODEL HIERARCHY ("Fix pallet visual and interaction UI following"
 * round) — `topMesh` (the base board) IS the hierarchy root: the three
 * decorative top slats, `uiAnchor`, and (this round) the two rope-strap
 * visuals are all its CHILDREN at fixed/computed LOCAL offsets. `topMesh`
 * is the ONLY THREE.Object3D ever added to the scene for the whole pallet,
 * and the ONLY one whose position/rotation this class ever writes — moving
 * it carries everything else along for free via normal Three.js
 * parent-child propagation.
 *
 * SINGLE SOURCE OF TRUTH while held: every frame, updateCarry() computes
 * ONE authoritative target transform and writes it to BOTH the rigid body
 * and `topMesh` itself, from the exact same numbers.
 *
 * ROPE STRAPS ("Add placement rotation and pallet cargo straps" round
 * spec四-八) — a single-level bulletin-board skill (ropeStrap,
 * upgrade-data.ts) unlocks pressing F, while carrying the pallet in its
 * live placement preview, to toggle `isRopeBound` for whatever cargo is
 * CURRENTLY pinned. Binding never changes how cargo is tracked WHILE being
 * carried (the existing `pinned` local-transform-follow mechanism handles
 * that identically whether bound or not) — it only changes what happens
 * once the pallet stops being held:
 * - Placed (tryPlace): bound cargo's collider re-enables (same deferred
 *   one-step timing as everything else) but a Rapier FIXED JOINT is
 *   created between the pallet's body and each bound cargo body at the
 *   exact local offset it was carried at, and `isHeld` deliberately stays
 *   true (reusing the EXISTING "isHeld blocks pickup/cargo-hook-targeting"
 *   invariant every other system already respects — spec七 needs zero
 *   changes to pickup-system.ts/cargo-hook-system.ts for this).
 * - Thrown (Q, via the PalletThrowHooks pair below): the SAME fixed joints
 *   are created BEFORE pickup-system.ts's generic executeThrow() applies
 *   its impulse (prepareForThrow also flips the pallet's permanently-
 *   kinematic body to Dynamic, since a kinematic body silently ignores
 *   impulses/velocity), then each bound cargo's OWN body is given a
 *   matching starting velocity once the pallet's real post-impulse
 *   velocity is known (onThrown) — a one-time nudge, never per-frame
 *   tracking, with the joint keeping them together for every physics step
 *   after that (spec七: "不要在投擲期間每幀setTranslation硬追蹤").
 * - Picked up again while still bound: joints are removed and the SAME
 *   cargo goes back into the ordinary carry-`pinned` array (isRopeBound
 *   stays true throughout, so placing it again without pressing F
 *   re-creates the joints automatically).
 * Since bound-and-placed cargo keeps `isHeld=true`, it's excluded from the
 * generic per-frame physics->mesh sync loop in game-app.ts — this class's
 * own update() manually syncs it instead whenever it's bound but not
 * currently being carried (mid-flight after a throw, or resting placed).
 */
export class PalletSystem implements PalletThrowHooks {
  readonly palletId = PALLET_ID;
  topMesh: THREE.Mesh;

  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private cargoSystem: CargoSystem;
  private interactables: Map<string, InteractableObject>;
  private playerData: PlayerInteractionData;
  private hud: HUD;
  private pauseManager: PauseManager;
  private upgradeSystem: UpgradeSystem;
  private onFirstUse?: () => void;
  private onFirstOrganized?: () => void;

  private palletObj!: InteractableObject;
  private body!: RAPIER.RigidBody;
  private homePos: THREE.Vector3;

  /** Local-only reference point ~0.3-0.5m above the pallet's own top
   * surface, a child of `topMesh` (spec三) — never itself moved after
   * construction; the floating "整理托盤" label reads its LIVE world
   * position from this every frame instead (see updateLabelFollow()) rather
   * than being parented directly, so hiding it while held/not-visible is a
   * plain visibility toggle rather than a reparent/unparent dance. */
  private uiAnchor!: THREE.Object3D;
  private floatingLabel!: THREE.Sprite;
  private labelWorldPosScratch = new THREE.Vector3();

  private stableTimers: Map<string, number> = new Map();
  private hasFiredUse = false;
  private hasFiredOrganized = false;

  isHeld = false;
  private pinned: PinnedCargoEntry[] = [];
  /** Half-extents / local-space center offset of the pallet+all pinned
   * cargo's combined bounding box, computed once at pickup — reused every
   * frame for both the swept-collision clamp and the placement-validity
   * check (spec 十四 from an earlier round: "不要只檢查托盤底板"). */
  private unionHalfExtents = new THREE.Vector3();
  private unionLocalCenterOffset = new THREE.Vector3();
  /** Validity of `placementPos`/`placementQuat` — the floor-level position
   * the pallet would land at if placed RIGHT NOW, distinct from the
   * walking carry transform (see updateCarry doc comment). */
  previewValid = false;
  private placementPos = new THREE.Vector3();
  private placementQuat = new THREE.Quaternion();
  private downRaycaster = new THREE.Raycaster();
  private previewMesh: THREE.Mesh;
  /** Pinned cargo whose collider must stay disabled for one more physics
   * step after tryPlace() repositions it, so it doesn't "explode" from an
   * instant same-frame overlap — flushed at the top of the NEXT update()
   * call, by which point this frame's physics.update() has already stepped
   * the world at least once with the body sitting at its resting transform
   * but still non-colliding (spec 九-7 from an earlier round). */
  private pendingCargoRestore: InteractableObject[] = [];
  /** Fixed-joint creation for a just-placed bound item is deferred to the
   * SAME frame its collider re-enables (see pendingCargoRestore just
   * above), never created while the body is still disabled — creating a
   * Rapier joint on a disabled body was confirmed (in this round's own
   * testing) to corrupt the physics world's internal state, surfacing as a
   * "recursive use of an object" wasm panic inside a LATER world.step()
   * call, sometimes several frames afterward. */
  private pendingJointsToCreate: { cargoId: string; localPos: THREE.Vector3; localQuat: THREE.Quaternion }[] = [];

  /** "Add placement rotation and pallet cargo straps" round spec一/二:
   * manual wheel-controlled yaw (world-Y-only), replacing the old
   * camera-facing auto-yaw while carrying — read by computeCarryTransform,
   * accumulated by onWheel, seeded from the pallet's own current rotation
   * at the start of each pickUp(). */
  private placementYaw = 0;

  // --- Rope straps (spec四-八) ---
  isRopeBound = false;
  private boundCargoIds: string[] = [];
  private cargoJointHandles: Map<string, RAPIER.ImpulseJointHandle> = new Map();
  /** Cargo ids released/bound at the moment of a Q-throw, consumed once by
   * onThrown() to give them the pallet's own post-impulse velocity. */
  private pendingThrowCargoIds: string[] = [];
  private ropeVisualX!: THREE.Mesh;
  private ropeVisualZ!: THREE.Mesh;

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, cargoSystem: CargoSystem, interactables: Map<string, InteractableObject>,
    playerData: PlayerInteractionData, hud: HUD, pauseManager: PauseManager, upgradeSystem: UpgradeSystem,
    onFirstUse?: () => void, onFirstOrganized?: () => void
  ) {
    this.scene = scene;
    this.physics = physics;
    this.cargoSystem = cargoSystem;
    this.interactables = interactables;
    this.playerData = playerData;
    this.hud = hud;
    this.pauseManager = pauseManager;
    this.upgradeSystem = upgradeSystem;
    this.onFirstUse = onFirstUse;
    this.onFirstOrganized = onFirstOrganized;
    this.homePos = new THREE.Vector3(PALLET_CONFIG.posX, 0, PALLET_CONFIG.posZ);

    this.topMesh = this.build();
    this.previewMesh = this.buildPreviewMesh();

    document.addEventListener('wheel', (e) => this.onWheel(e));
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  private build(): THREE.Mesh {
    const { posX, posZ, width, depth, height } = PALLET_CONFIG;
    const floorY = BACK_AREA.floorY;
    const centerY = floorY + height / 2;
    this.homePos.y = centerY;

    // The base board is the hierarchy root (see class doc comment for why
    // this is `topMesh` itself rather than a separate wrapper Group) — the
    // ONLY object ever added to the scene for the whole pallet.
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xa87a42 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), woodMat);
    mesh.position.set(posX, centerY, posZ);
    mesh.userData.surfaceType = 'pallet-top';
    this.scene.add(mesh);

    // A few raised slat lines across the top — purely cosmetic, LOCAL
    // offsets relative to the base board's own origin.
    const slatMat = new THREE.MeshStandardMaterial({ color: 0x8a6234 });
    for (let i = -1; i <= 1; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(width * 0.9, 0.02, depth * 0.12), slatMat);
      slat.position.set(0, height / 2 + 0.01, i * depth * 0.3);
      // "Fix cargo placement on pallet surface" round: tagged the same as
      // the base board — PickupSystem's placement raycast is recursive, so
      // a ray aimed at the pallet's top very often hits one of these raised
      // slats FIRST rather than the board underneath it. Without this tag,
      // that hit was silently falling through every 'pallet-top' special
      // case (support-pallet collider/box3 exclusion, the edge-containment
      // check) exactly as if the player had aimed at open floor.
      slat.userData.surfaceType = 'pallet-top';
      mesh.add(slat);
    }

    this.uiAnchor = new THREE.Object3D();
    this.uiAnchor.position.set(0, height / 2 + UI_ANCHOR_HEIGHT_ABOVE_TOP, 0);
    mesh.add(this.uiAnchor);

    // The floating "整理托盤" label stays a top-level scene object (spec三:
    // read uiAnchor's WORLD position every frame — see updateLabelFollow()
    // — rather than being parented under the base board directly), so
    // hiding it is a plain visibility toggle.
    this.floatingLabel = createFloatingLabel('整理托盤', { width: 0.7, bg: 'rgba(30,25,15,0.75)' });
    this.scene.add(this.floatingLabel);

    // Rope strap visuals (spec六) — built ONCE here as children of the base
    // board (so they follow every carry/rotate/place/throw for free, and
    // never get recreated by repeated F presses — spec六: "不可每次按F都重
    // 複生成新Mesh"), just hidden until bindRope() actually needs them.
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x4a3423 });
    this.ropeVisualX = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), strapMat);
    this.ropeVisualZ = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), strapMat);
    this.ropeVisualX.visible = false;
    this.ropeVisualZ.visible = false;
    // Cosmetic only — never a valid raycast/pickup/hook target.
    this.ropeVisualX.raycast = () => {};
    this.ropeVisualZ.raycast = () => {};
    mesh.add(this.ropeVisualX);
    mesh.add(this.ropeVisualZ);

    // Kinematic body — immune to being knocked/tipped by cargo landing on
    // it while parked, only moves when this system explicitly drives it
    // (carry-follow while held, or the end-of-day reset). Temporarily
    // switched to Dynamic for a Q-throw (see prepareForThrow) and switched
    // back the next time it's picked up (see pickUp()).
    const bodyDesc = this.physics.createKinematicBodyDesc(posX, centerY, posZ);
    const body = this.physics.createKinematicBody(bodyDesc);
    this.physics.addColliderToBody(body, 0, 0, 0, width / 2, height / 2, depth / 2);
    this.body = body;

    const obj = createInteractableObject(this.palletId, '整理托盤', mesh, width, height, depth);
    obj.rigidBody = body;
    this.interactables.set(this.palletId, obj);
    this.palletObj = obj;

    mesh.updateMatrixWorld(true);
    this.updateLabelFollow();
    // "Fix cargo placement on pallet surface" round: establishes the
    // rope straps' correct near-zero initial scale immediately (see
    // updateRopeVisual's own doc comment for why this matters) — without
    // this, they'd sit at BoxGeometry(1,1,1)'s literal default 1x1x1m scale
    // until the player picks the pallet up at least once.
    this.updateRopeVisual();
    return mesh;
  }

  /** Semi-transparent ghost representing the pallet+cargo union bounds at
   * the current placement target (spec 八 from an earlier round) — green
   * when valid, red when not. Never raycast-hittable, never registered as
   * an InteractableObject, no physics body, so it can never be picked up or
   * block placement of itself. */
  private buildPreviewMesh(): THREE.Mesh {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.28, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.renderOrder = 5;
    mesh.raycast = () => {};
    this.scene.add(mesh);
    return mesh;
  }

  /** Keeps the floating "整理托盤" label glued to `uiAnchor`'s LIVE world
   * position every frame, hidden while held, and also hidden whenever the
   * pallet itself isn't visible (e.g. riding away pinned to a departing
   * vehicle, which sets `topMesh.visible = false` — see vehicle-system.ts's
   * onDeparting — entirely outside this round's scope but worth not
   * leaving an orphaned floating label behind for). */
  private updateLabelFollow(): void {
    this.floatingLabel.visible = !this.isHeld && this.palletObj.mesh.visible;
    if (!this.floatingLabel.visible) return;
    this.uiAnchor.getWorldPosition(this.labelWorldPosScratch);
    this.floatingLabel.position.copy(this.labelWorldPosScratch);
  }

  /** "Add placement rotation and pallet cargo straps" round spec一/二:
   * rotates the pallet's own live placement preview 15° per notch while (and
   * ONLY while) it's actually being carried — ToolSystem's own wheel
   * handler gates itself off whenever `heldObjectId === PALLET_ID` (see
   * tool-system.ts), so the two can never both react to the same event. */
  private onWheel(event: WheelEvent): void {
    if (this.pauseManager.isPaused) return;
    if (!this.isHeld) return;
    if (Math.abs(event.deltaY) < 1) return;
    const dir = event.deltaY > 0 ? 1 : -1;
    this.placementYaw += dir * PLACEMENT_YAW_STEP;
  }

  /** "Add placement rotation and pallet cargo straps" round spec五: F
   * toggles rope-binding for whatever's currently pinned, gated on every
   * listed precondition — a completely independent listener from
   * InteractionSystem's own (matching cargo-hook-system.ts's established
   * pattern), so it never intercepts F for anything else (spec五: "F只在上
   * 述托盤放置狀態攔截，不影響其他既有F功能" — every guard below returns
   * silently except the two explicit "not unlocked"/"nothing to bind"
   * cases, which only ever fire once every OTHER guard has already passed,
   * i.e. only while genuinely carrying the pallet with power gloves). */
  private onKeyDown(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (event.code !== 'KeyF') return;
    if (this.pauseManager.isPaused) return;
    if (!this.isHeld) return;
    if (this.playerData.activeTool !== 'powerGloves') return;
    if (!this.upgradeSystem.isRopeStrapUnlocked()) {
      this.hud.showToast('尚未解鎖固定繩索');
      return;
    }
    if (this.isRopeBound) {
      this.unbindRope();
      return;
    }
    if (this.pinned.length === 0) {
      this.hud.showToast('托盤上沒有可固定的貨物');
      return;
    }
    this.bindRope();
  }

  private bindRope(): void {
    this.isRopeBound = true;
    this.boundCargoIds = this.pinned.map((p) => p.obj.id);
    this.updateRopeVisual();
    this.hud.showToast('貨物已被固定繩綁住');
  }

  private unbindRope(): void {
    this.removeAllCargoJoints();
    this.isRopeBound = false;
    this.boundCargoIds = [];
    this.updateRopeVisual();
    this.hud.showToast('已解除固定繩');
  }

  /** Positions the two crossed strap visuals to span the combined LOCAL
   * bounds of every currently-bound item (spec六) — reuses whichever
   * position source is fresh: the live `pinned` local transform while
   * carrying, or the item's own current world position (converted into the
   * pallet's local space) once placed. Hidden whenever nothing is bound.
   *
   * "Fix cargo placement on pallet surface" round — ROOT CAUSE of the
   * regression this fixes: whenever hidden, this must ALSO shrink `.scale`
   * to near-zero, not just toggle `.visible`. THREE.Box3.setFromObject()
   * (used by PickupSystem.validatePlacement()'s overlap check against every
   * OTHER interactable, including the pallet) traverses ALL descendants
   * regardless of `.visible` — the straps are `topMesh`'s children (spec六:
   * "繩索為托盤主Mesh的子物件"), built from a literal `BoxGeometry(1,1,1)`
   * and left at THREE's default (1,1,1) scale until the FIRST bind actually
   * sizes them. Before that (a pallet the player hasn't touched yet, or one
   * that's just been unbound) they were still contributing a full 1×1×1m
   * bounding volume to the pallet's own computed Box3, inflating it far
   * beyond the pallet's real footprint and making ANY nearby placement
   * preview read as overlapping it, unconditionally.
   *
   * Also reset `.position` back to the pallet's own local origin here — a
   * pallet that's been bound (and thus had its straps repositioned to span
   * the bound cargo, e.g. up near a stacked item's height) and then unbound
   * left the now-tiny-scaled straps sitting at that STALE off-center
   * position. Even shrunk to near-zero size, a box still displaced that far
   * from the board still drags the union Box3 out to include that point,
   * reproducing the same inflated-bounds bug one level down (confirmed via
   * a headless test: box3 Y-size stayed inflated to ~0.54m, matching the
   * strap's leftover y-position near the last bound cargo's height, even
   * though its size alone was already negligible). */
  private updateRopeVisual(): void {
    if (!this.isRopeBound || this.boundCargoIds.length === 0) {
      this.ropeVisualX.visible = false;
      this.ropeVisualZ.visible = false;
      this.ropeVisualX.scale.set(0.001, 0.001, 0.001);
      this.ropeVisualZ.scale.set(0.001, 0.001, 0.001);
      this.ropeVisualX.position.set(0, 0, 0);
      this.ropeVisualZ.position.set(0, 0, 0);
      return;
    }

    const { width, height, depth } = PALLET_CONFIG;
    let minX = -width / 2, maxX = width / 2;
    let maxY = height / 2;
    let minZ = -depth / 2, maxZ = depth / 2;

    this.palletObj.mesh.updateMatrixWorld(true);
    const matInv = new THREE.Matrix4().copy(this.palletObj.mesh.matrixWorld).invert();

    for (const id of this.boundCargoIds) {
      const obj = this.interactables.get(id);
      if (!obj) continue;
      const pinnedEntry = this.pinned.find((p) => p.obj.id === id);
      const localPos = pinnedEntry ? pinnedEntry.localPos : obj.mesh.position.clone().applyMatrix4(matInv);
      const hw = obj.width / 2, hh = obj.height / 2, hd = obj.depth / 2;
      minX = Math.min(minX, localPos.x - hw); maxX = Math.max(maxX, localPos.x + hw);
      maxY = Math.max(maxY, localPos.y + hh);
      minZ = Math.min(minZ, localPos.z - hd); maxZ = Math.max(maxZ, localPos.z + hd);
    }

    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const sizeX = Math.max(maxX - minX, ROPE_STRAP_THICKNESS);
    const sizeZ = Math.max(maxZ - minZ, ROPE_STRAP_THICKNESS);

    // One strap spans the full X extent, one the full Z extent, crossing
    // over each other at the top of the combined bounds (spec六: "一條沿X
    // 方向、一條沿Z方向").
    this.ropeVisualX.scale.set(sizeX, ROPE_STRAP_HEIGHT, ROPE_STRAP_THICKNESS);
    this.ropeVisualX.position.set(centerX, maxY, centerZ);
    this.ropeVisualZ.scale.set(ROPE_STRAP_THICKNESS, ROPE_STRAP_HEIGHT, sizeZ);
    this.ropeVisualZ.position.set(centerX, maxY, centerZ);

    this.ropeVisualX.visible = true;
    this.ropeVisualZ.visible = true;
  }

  /** Creates a Rapier fixed joint between the pallet's body and one bound
   * cargo body at a known pallet-local anchor/orientation — reused by both
   * tryPlace() and prepareForThrow(), always fed a FRESH local transform
   * (never stale) by its caller. */
  private createCargoJoint(cargoId: string, localPos: THREE.Vector3, localQuat: THREE.Quaternion): void {
    const obj = this.interactables.get(cargoId);
    if (!obj || !obj.rigidBody) return;
    if (this.cargoJointHandles.has(cargoId)) return;
    const jointData = RAPIER.JointData.fixed(
      { x: localPos.x, y: localPos.y, z: localPos.z },
      { x: localQuat.x, y: localQuat.y, z: localQuat.z, w: localQuat.w },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 }
    );
    const joint = this.physics.world.createImpulseJoint(jointData, this.body, obj.rigidBody, true);
    this.cargoJointHandles.set(cargoId, joint.handle);
  }

  /** Removes every currently-tracked cargo joint (spec七: "解除綁定：移除所
   * 有fixed joints" — also reused defensively any time stale joints must
   * not survive, spec八: day reset / a bound pallet swept away by a
   * departing vehicle). Never touches `isRopeBound`/`boundCargoIds`
   * itself — callers decide separately whether the BINDING intent should
   * also be cleared. */
  private removeAllCargoJoints(): void {
    for (const handle of this.cargoJointHandles.values()) {
      const joint = this.physics.world.getImpulseJoint(handle);
      if (joint) this.physics.world.removeImpulseJoint(joint, true);
    }
    this.cargoJointHandles.clear();
  }

  update(deltaTime: number, cameraPosition?: THREE.Vector3, cameraForward?: THREE.Vector3): void {
    if (this.pendingCargoRestore.length > 0) {
      for (const obj of this.pendingCargoRestore) {
        if (obj.rigidBody) this.physics.setBodyEnabled(obj.rigidBody, true);
      }
      this.pendingCargoRestore = [];
    }
    // Runs strictly AFTER the setBodyEnabled(true) loop just above (same
    // frame, later in the statement order) — see pendingJointsToCreate's
    // own doc comment for why the body must already be enabled.
    if (this.pendingJointsToCreate.length > 0) {
      for (const j of this.pendingJointsToCreate) this.createCargoJoint(j.cargoId, j.localPos, j.localQuat);
      this.pendingJointsToCreate = [];
    }

    // Safety net (spec八: "換日、重置或載具離場不能留下失效joint") — a bound
    // pallet just swept away by a departing vehicle (vehicle-system.ts sets
    // topMesh.visible=false and drags the mesh directly, entirely outside
    // this round's scope) leaves this class's own joints referencing bodies
    // that are no longer meaningfully carried together by anything this
    // class still drives — clear them. The binding INTENT is left alone
    // (isRopeBound/boundCargoIds), only the physics joints go.
    if (this.cargoJointHandles.size > 0 && !this.palletObj.mesh.visible) {
      this.removeAllCargoJoints();
    }

    if (this.isHeld) {
      if (cameraPosition && cameraForward) this.updateCarry(cameraPosition, cameraForward);
      this.updateLabelFollow();
      return;
    }

    // Bound-but-not-currently-carried cargo is genuinely simulating via its
    // fixed joint (resting placed, or mid-flight after a throw) — its own
    // isHeld=true deliberately skips the generic per-frame physics->mesh
    // sync loop in game-app.ts (spec七: keeps it un-pickable/un-hookable),
    // so this class syncs it itself instead.
    if (this.isRopeBound) {
      for (const id of this.boundCargoIds) {
        const obj = this.interactables.get(id);
        if (obj?.rigidBody && obj.rigidBody.isEnabled()) {
          this.physics.syncMeshToBody(obj.mesh, obj.rigidBody);
        }
      }
    }

    this.updateLabelFollow();
    this.updateOrganizeScan(deltaTime);
  }

  /** Unchanged organize judgment — a box/large item resting stably on the
   * pallet's own footprint for >=0.5s gets marked organized (persists after
   * being carried away, and group-carry doesn't re-trigger or lose it since
   * this scan only runs while NOT held, and never touches `organized` false
   * again once true). */
  private updateOrganizeScan(deltaTime: number): void {
    const { posX, posZ, width, depth, height, detectHeight } = PALLET_CONFIG;
    const floorY = BACK_AREA.floorY;
    const topY = floorY + height;
    const innerHW = width / 2;
    const innerHD = depth / 2;

    const idsStillInZone = new Set<string>();

    for (const [id, obj] of this.interactables) {
      if (id === this.palletId) continue;
      if (obj.isHeld || !obj.mesh.visible) continue;
      const data = this.cargoSystem.getCargoData(id);
      if (!data || (data.shapeType !== 'box' && data.shapeType !== 'large')) continue;

      const p = obj.mesh.position;
      const inZone =
        p.x >= posX - innerHW && p.x <= posX + innerHW &&
        p.z >= posZ - innerHD && p.z <= posZ + innerHD &&
        p.y >= topY - 0.05 && p.y <= topY + detectHeight;
      if (!inZone) continue;

      idsStillInZone.add(id);
      if (!this.hasFiredUse) {
        this.hasFiredUse = true;
        this.onFirstUse?.();
      }
      if (data.organized) continue;

      let stable = true;
      if (obj.rigidBody) {
        const lv = obj.rigidBody.linvel();
        const av = obj.rigidBody.angvel();
        const speed = Math.sqrt(lv.x ** 2 + lv.y ** 2 + lv.z ** 2);
        const angSpeed = Math.sqrt(av.x ** 2 + av.y ** 2 + av.z ** 2);
        stable = speed < VELOCITY_THRESHOLD && angSpeed < VELOCITY_THRESHOLD;
      }

      const prev = this.stableTimers.get(id) ?? 0;
      const next = stable ? prev + deltaTime : 0;
      this.stableTimers.set(id, next);

      if (next >= STABLE_THRESHOLD) {
        data.organized = true;
        if (!this.hasFiredOrganized) {
          this.hasFiredOrganized = true;
          this.onFirstOrganized?.();
        }
      }
    }

    for (const id of this.stableTimers.keys()) {
      if (!idsStillInZone.has(id)) this.stableTimers.delete(id);
    }
  }

  get palletObject(): InteractableObject {
    return this.palletObj;
  }

  /** Called by InteractionSystem when the player targets the (unheld)
   * pallet and presses E. Finds every box/large daily-cargo item currently
   * SUPPORTED by the pallet (checked in the pallet's OWN local space, so a
   * rotated pallet's footprint is still detected correctly — spec一/二),
   * saves each one's transform relative to the pallet, pauses their
   * physics, and switches to world-space camera-follow carry — positioning
   * it in front of the player on this very first held frame. */
  pickUp(cameraPosition: THREE.Vector3, cameraForward: THREE.Vector3): void {
    if (this.isHeld) return;
    // Only powerGloves may pick up the pallet — bare-hands and cargoHook
    // must not, checked here (the single place PalletSystem.pickUp() is
    // ever called from — interaction-system.ts's Priority-1 E-handler)
    // rather than requiring every caller to remember the gate.
    if (this.playerData.activeTool !== 'powerGloves') {
      this.hud.showToast('需要裝備力量手套才能搬起托盤');
      return;
    }
    if (this.playerData.state !== 'empty-handed') return;

    // Revert to a genuinely kinematic body in case a previous Q-throw left
    // it Dynamic (see prepareForThrow) — carry logic always assumes a
    // kinematic body it fully drives itself. Synced to wherever the mesh
    // visually settled: while unheld and dynamic, the generic per-frame
    // physics->mesh sync loop in game-app.ts already tracks the mesh from
    // the body, so the mesh is the authoritative "where did it actually
    // land" source here.
    if (this.body.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) {
      const mp = this.palletObj.mesh.position, mq = this.palletObj.mesh.quaternion;
      this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      this.body.setTranslation({ x: mp.x, y: mp.y, z: mp.z }, true);
      this.body.setRotation({ x: mq.x, y: mq.y, z: mq.z, w: mq.w }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    // Seed the manual placement yaw from whatever rotation it's currently
    // resting at (spec一/二: wheel input adjusts FROM here, rather than
    // snapping to a fixed default every pickup).
    this.placementYaw = new THREE.Euler().setFromQuaternion(this.palletObj.mesh.quaternion, 'YXZ').y;

    this.palletObj.mesh.updateMatrixWorld(true);
    const matInv = new THREE.Matrix4().copy(this.palletObj.mesh.matrixWorld).invert();
    const quatInv = this.palletObj.mesh.quaternion.clone().invert();

    const { width, depth, height, detectHeight } = PALLET_CONFIG;
    const innerHW = width / 2;
    const innerHD = depth / 2;

    this.pinned = [];

    // Re-collect already-bound cargo FIRST — it deliberately stays
    // isHeld=true while placed-and-bound (spec七), so the generic
    // footprint scan below (which skips isHeld items, same as every other
    // scan in this class) would never rediscover it on its own.
    if (this.isRopeBound) {
      this.removeAllCargoJoints();
      for (const id of this.boundCargoIds) {
        const obj = this.interactables.get(id);
        if (!obj || !obj.rigidBody) continue;
        const t = obj.rigidBody.translation();
        const r = obj.rigidBody.rotation();
        const localPos = new THREE.Vector3(t.x, t.y, t.z).applyMatrix4(matInv);
        const localQuat = new THREE.Quaternion(r.x, r.y, r.z, r.w).premultiply(quatInv);
        this.pinned.push({ obj, localPos, localQuat });
        obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.physics.setBodyEnabled(obj.rigidBody, false);
      }
    }

    for (const [id, obj] of this.interactables) {
      if (id === this.palletId) continue;
      if (obj.isHeld || !obj.mesh.visible) continue;
      const data = this.cargoSystem.getCargoData(id);
      if (!data || (data.shapeType !== 'box' && data.shapeType !== 'large')) continue;

      // Local-space footprint/height check — rotation-aware by construction
      // (matInv/quatInv already fold in the pallet's current orientation),
      // unlike a plain world-space AABB test.
      const localPos = obj.mesh.position.clone().applyMatrix4(matInv);
      const supported =
        localPos.x >= -innerHW && localPos.x <= innerHW &&
        localPos.z >= -innerHD && localPos.z <= innerHD &&
        localPos.y >= height / 2 - 0.05 && localPos.y <= height / 2 + detectHeight;
      if (!supported) continue;

      const localQuat = obj.mesh.quaternion.clone().premultiply(quatInv);
      this.pinned.push({ obj, localPos, localQuat });

      obj.isHeld = true;
      if (obj.rigidBody) {
        obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.physics.setBodyEnabled(obj.rigidBody, false);
      }
    }

    this.computeUnionBounds();
    this.isHeld = true;
    this.palletObj.isHeld = true;
    this.playerData.state = 'holding-item';
    this.playerData.heldObjectId = this.palletId;
    this.hud.showInteractionPrompt('整理托盤', '滾輪旋轉　E放置　Q丟出');
    this.updateLabelFollow();
    this.updateRopeVisual();

    // Position it in front of the player immediately, not one frame late.
    this.updateCarry(cameraPosition, cameraForward);
  }

  /** Combined pallet+all-pinned-cargo bounding box, in the pallet's OWN
   * local space (center-origin) — computed once at pickup. */
  private computeUnionBounds(): void {
    const { width, height, depth } = PALLET_CONFIG;
    let minX = -width / 2, maxX = width / 2;
    let minY = -height / 2, maxY = height / 2;
    let minZ = -depth / 2, maxZ = depth / 2;

    for (const p of this.pinned) {
      const hw = p.obj.width / 2, hh = p.obj.height / 2, hd = p.obj.depth / 2;
      minX = Math.min(minX, p.localPos.x - hw); maxX = Math.max(maxX, p.localPos.x + hw);
      minY = Math.min(minY, p.localPos.y - hh); maxY = Math.max(maxY, p.localPos.y + hh);
      minZ = Math.min(minZ, p.localPos.z - hd); maxZ = Math.max(maxZ, p.localPos.z + hd);
    }

    this.unionHalfExtents.set((maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2);
    this.unionLocalCenterOffset.set((maxX + minX) / 2, (maxY + minY) / 2, (maxZ + minZ) / 2);
  }

  /** Computes the WALKING carry transform: a comfortable height below eye
   * level, clamped so the union bounds never gets close to the floor and
   * never rises above the camera. Returns null only when the camera is
   * looking straight up/down (no horizontal forward component to carry
   * toward). */
  private computeCarryTransform(cameraPosition: THREE.Vector3, cameraForward: THREE.Vector3): { pos: THREE.Vector3; quat: THREE.Quaternion } | null {
    const flat = new THREE.Vector3(cameraForward.x, 0, cameraForward.z);
    if (flat.lengthSq() < 1e-6) return null;
    flat.normalize();

    // Near-face clearance from the camera is forwardDist minus the union's
    // own horizontal half-extent — floor it at MIN_CAMERA_CLEARANCE so
    // "手持物不會位於玩家膠囊內" holds by construction regardless of load size.
    const horizExtent = Math.max(this.unionHalfExtents.x, this.unionHalfExtents.z);
    const forwardDist = Math.max(CARRY_BASE_FORWARD_DIST, MIN_CAMERA_CLEARANCE) + horizExtent;
    const targetX = cameraPosition.x + flat.x * forwardDist;
    const targetZ = cameraPosition.z + flat.z * forwardDist;
    // "Add placement rotation and pallet cargo straps" round spec一/二: yaw
    // is now player-controlled via mouse wheel (see onWheel) instead of
    // auto-facing the camera direction — this.placementYaw only ever
    // changes on a 15° wheel notch.
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.placementYaw);

    // THIS is the height computation that was the actual bug an earlier
    // round fixed: the old code put the carried pallet at essentially its
    // normal RESTING (floor-touching) height every frame — even while just
    // walking around holding it — which made the swept-collision shape
    // below start every single frame already touching/embedded in the
    // floor's own static collider, freezing X/Z movement completely. The
    // fix: keep the WALKING height clear of the floor at all times; the
    // floor-touching height is only ever computed separately, for the
    // placement PREVIEW (see updatePlacementPreview).
    const desiredCenterY = cameraPosition.y - CARRY_DROP_BELOW_EYE;
    const minCenterY = BACK_AREA.floorY + CARRY_MIN_FLOOR_CLEARANCE + this.unionHalfExtents.y;
    const maxCenterY = cameraPosition.y + CARRY_MAX_ABOVE_EYE - this.unionHalfExtents.y;
    const centerY = THREE.MathUtils.clamp(desiredCenterY, minCenterY, Math.max(minCenterY, maxCenterY));
    const targetY = centerY - this.unionLocalCenterOffset.y;

    return { pos: new THREE.Vector3(targetX, targetY, targetZ), quat };
  }

  /** Swept-collision clamp against fixed scene geometry only (walls/
   * furniture — GROUP_STATIC), using the union bounds' own extent and local
   * center offset (rotated into world space) — same castShapeMove helper
   * dolly-system.ts's push already uses. */
  private clampCarryMove(targetPos: THREE.Vector3, targetQuat: THREE.Quaternion): THREE.Vector3 {
    const oldPos = this.palletObj.mesh.position;
    const rotatedOffset = this.unionLocalCenterOffset.clone().applyQuaternion(targetQuat);
    const delta = new THREE.Vector3(targetPos.x - oldPos.x, targetPos.y - oldPos.y, targetPos.z - oldPos.z);
    const shapeCenter = oldPos.clone().add(rotatedOffset);
    const allowedFraction = this.physics.castShapeMove(shapeCenter, targetQuat, this.unionHalfExtents, delta);
    return new THREE.Vector3(
      oldPos.x + delta.x * allowedFraction,
      oldPos.y + delta.y * allowedFraction,
      oldPos.z + delta.z * allowedFraction
    );
  }

  /** Writes ONE authoritative transform to both the kinematic body (so the
   * collider tracks `topMesh` 1:1) and `topMesh` itself, from the exact
   * same pos/quat — the ONLY place the pallet's transform is ever written
   * while held (spec二: "拾取、手持、放置、旋轉時只更新[root]transform").
   * Every child (slats, uiAnchor, rope straps) moves along for free via
   * normal Three.js parent-child propagation. */
  private applyCarryTransform(pos: THREE.Vector3, quat: THREE.Quaternion): void {
    this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
    this.body.setNextKinematicRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    this.palletObj.mesh.position.copy(pos);
    this.palletObj.mesh.quaternion.copy(quat);
    this.palletObj.mesh.updateMatrixWorld(true);
  }

  private updateCarry(cameraPosition: THREE.Vector3, cameraForward: THREE.Vector3): void {
    const transform = this.computeCarryTransform(cameraPosition, cameraForward);
    if (!transform) return;

    const clampedPos = this.clampCarryMove(transform.pos, transform.quat);

    if (!Number.isFinite(clampedPos.x) || !Number.isFinite(clampedPos.y) || !Number.isFinite(clampedPos.z)) {
      console.error('[PalletSystem] carry position became non-finite — force-releasing to a safe position.');
      this.forceReleaseToSafePosition();
      return;
    }

    this.applyCarryTransform(clampedPos, transform.quat);

    for (const p of this.pinned) {
      const worldPos = p.localPos.clone().applyMatrix4(this.palletObj.mesh.matrixWorld);
      const worldQuat = transform.quat.clone().multiply(p.localQuat);
      p.obj.mesh.position.copy(worldPos);
      p.obj.mesh.quaternion.copy(worldQuat);
    }
    if (this.isRopeBound) this.updateRopeVisual();

    this.updatePlacementPreview(clampedPos, transform.quat);
  }

  /** Computes where the pallet would actually LAND if placed right now
   * (floor/vehicle-bed height under the current carry XZ, via a downward
   * raycast — distinct from the walking carry height above), checks its
   * validity, and updates the ghost preview mesh. */
  private updatePlacementPreview(carryPos: THREE.Vector3, carryQuat: THREE.Quaternion): void {
    // Excludes the WHOLE pallet subtree via the base board (slats/uiAnchor/
    // straps all walk up to it as their parent).
    const excludeRoots: THREE.Object3D[] = [this.palletObj.mesh, this.previewMesh, ...this.pinned.map(p => p.obj.mesh)];
    this.downRaycaster.set(new THREE.Vector3(carryPos.x, carryPos.y + 3, carryPos.z), new THREE.Vector3(0, -1, 0));
    const hits = this.downRaycaster.intersectObjects(this.scene.children, true)
      .filter(h => !this.isExcluded(h.object, excludeRoots));
    const supportY = hits.length > 0 ? hits[0].point.y : BACK_AREA.floorY;

    const placeCenterY = supportY + this.unionHalfExtents.y;
    this.placementPos.set(carryPos.x, placeCenterY - this.unionLocalCenterOffset.y, carryPos.z);
    this.placementQuat.copy(carryQuat);

    const valid = this.checkPlacementValidity();
    this.previewValid = valid;

    this.previewMesh.visible = true;
    this.previewMesh.position.copy(this.placementPos).add(this.unionLocalCenterOffset.clone().applyQuaternion(this.placementQuat));
    this.previewMesh.quaternion.copy(this.placementQuat);
    this.previewMesh.scale.set(this.unionHalfExtents.x * 2, this.unionHalfExtents.y * 2, this.unionHalfExtents.z * 2);
    const mat = this.previewMesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(valid ? 0x00ff88 : 0xff3333);
    mat.opacity = valid ? 0.28 : 0.35;
  }

  /** Placement validity at the current placement target — excludes the
   * pallet's own collider/mesh, its currently-pinned cargo, the player
   * (never in `interactables` to begin with), and anything already
   * isHeld/invisible; still blocks against walls, world bounds, and any
   * other real, resting object. The AABB used here is the ENCLOSING box of
   * the (possibly yawed) union bounds — "Add placement rotation and pallet
   * cargo straps" round spec一: rotation must affect the collision check
   * too, not just the visuals; this codebase's placement math is AABB-only
   * throughout, so this uses the standard enclosing-AABB of the yawed
   * rectangle rather than a genuine rotated-OBB test — never smaller than
   * the true rotated footprint, so it can only ever be equally or more
   * conservative. */
  private checkPlacementValidity(): boolean {
    const cos = Math.abs(Math.cos(this.placementYaw));
    const sin = Math.abs(Math.sin(this.placementYaw));
    const halfW = this.unionHalfExtents.x * cos + this.unionHalfExtents.z * sin;
    const halfD = this.unionHalfExtents.x * sin + this.unionHalfExtents.z * cos;
    const halfH = this.unionHalfExtents.y;
    const center = this.placementPos.clone().add(this.unionLocalCenterOffset.clone().applyQuaternion(this.placementQuat));

    if (center.x - halfW < WORLD_BOUNDS.minX || center.x + halfW > WORLD_BOUNDS.maxX ||
        center.z - halfD < WORLD_BOUNDS.minZ || center.z + halfD > WORLD_BOUNDS.maxZ) return false;

    const eps = 0.02;
    const box = new THREE.Box3(
      new THREE.Vector3(center.x - halfW + eps, center.y - halfH + eps, center.z - halfD + eps),
      new THREE.Vector3(center.x + halfW - eps, center.y + halfH - eps, center.z + halfD - eps)
    );

    const excludeIds = new Set<string>([this.palletId, ...this.pinned.map(p => p.obj.id)]);
    for (const [id, obj] of this.interactables) {
      if (excludeIds.has(id) || obj.isHeld || !obj.mesh.visible) continue;
      const otherBox = new THREE.Box3().setFromObject(obj.mesh);
      if (box.intersectsBox(otherBox)) return false;
    }
    return true;
  }

  private isExcluded(obj: THREE.Object3D, excludeRoots: THREE.Object3D[]): boolean {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (excludeRoots.includes(cur)) return true;
      cur = cur.parent;
    }
    return false;
  }

  /** Called by InteractionSystem on a second E-press while holding the
   * pallet — a direct single-press place (not the generic preview-then-
   * left-click flow other cargo uses, since a WHOLE GROUP's live validity
   * is already visible via the ghost preview every frame). Leaves
   * everything held/unchanged if the current placement target isn't valid,
   * so the player can walk somewhere else and press E again. */
  tryPlace(): boolean {
    if (!this.isHeld) return false;
    if (!this.previewValid) {
      this.hud.showToast('此處無法放置整理托盤');
      return false;
    }

    const finalPos = this.placementPos.clone();
    const finalQuat = this.placementQuat.clone();

    this.body.setNextKinematicTranslation({ x: finalPos.x, y: finalPos.y, z: finalPos.z });
    this.body.setNextKinematicRotation({ x: finalQuat.x, y: finalQuat.y, z: finalQuat.z, w: finalQuat.w });
    this.palletObj.mesh.position.copy(finalPos);
    this.palletObj.mesh.quaternion.copy(finalQuat);
    this.palletObj.mesh.updateMatrixWorld(true);

    for (const p of this.pinned) {
      const obj = p.obj;
      const worldPos = p.localPos.clone().applyMatrix4(this.palletObj.mesh.matrixWorld);
      const worldQuat = finalQuat.clone().multiply(p.localQuat);
      obj.mesh.position.copy(worldPos);
      obj.mesh.quaternion.copy(worldQuat);

      const isBound = this.isRopeBound && this.boundCargoIds.includes(obj.id);
      // Bound cargo deliberately STAYS isHeld=true (spec七: "貨物不恢復自
      // 由物理...玩家不可單獨拿取或用捕貨鉤勾走") — reuses the SAME
      // isHeld-blocks-pickup/hook-targeting invariant every other system
      // already respects, zero changes needed there.
      obj.isHeld = isBound;
      if (obj.rigidBody) {
        obj.rigidBody.setTranslation({ x: worldPos.x, y: worldPos.y, z: worldPos.z }, true);
        obj.rigidBody.setRotation({ x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w }, true);
        obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        // Collider re-enable is deferred one physics step regardless of
        // binding — see pendingCargoRestore's doc comment. The joint (if
        // bound) is deferred to that SAME later step too, never created
        // while the body is still disabled — see pendingJointsToCreate's
        // own doc comment for why.
        this.pendingCargoRestore.push(obj);
        if (isBound) this.pendingJointsToCreate.push({ cargoId: obj.id, localPos: p.localPos.clone(), localQuat: p.localQuat.clone() });
      }
    }

    this.pinned = [];
    this.isHeld = false;
    this.palletObj.isHeld = false;
    this.previewMesh.visible = false;
    this.playerData.state = 'empty-handed';
    this.playerData.heldObjectId = null;
    this.hud.hideInteractionPrompt();
    this.updateLabelFollow();
    this.updateRopeVisual();
    return true;
  }

  // --- Q-throw (PalletThrowHooks — spec三/七) ---

  isPallet(obj: InteractableObject): boolean {
    return obj.id === this.palletId;
  }

  /** PalletThrowHooks — "Fix cargo placement on pallet surface" round
   * spec五: lets PickupSystem refuse new cargo placement onto an already
   * rope-bound pallet with the specific "請先解除固定繩" toast. */
  isPalletRopeBound(obj: InteractableObject): boolean {
    return obj.id === this.palletId && this.isRopeBound;
  }

  /** Called by pickup-system.ts's executeThrow() BEFORE it applies any
   * impulse/velocity — the pallet's body is permanently kinematic while
   * parked/carried, which silently ignores those calls, so it must become
   * a real dynamic body first (spec三: "托盤成為dynamic物理物件"). If
   * rope-bound, creates the fixed joints now (spec七: "在投擲前建立fixed
   * joints，再對托盤施加投擲速度") so the solver carries the impulse into
   * the jointed cargo over subsequent steps; if not bound, releases every
   * currently-pinned item back to independent dynamic physics right now
   * (spec三: "托盤上的Cargo立即解除pinned") — either way, `onThrown` below
   * gives the affected cargo a starting velocity once the pallet's own
   * actual post-impulse velocity is known. */
  prepareForThrow(_obj: InteractableObject): void {
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);

    if (this.isRopeBound) {
      this.pendingThrowCargoIds = [...this.boundCargoIds];
      for (const p of this.pinned) {
        if (!this.boundCargoIds.includes(p.obj.id)) continue;
        if (p.obj.rigidBody) this.physics.setBodyEnabled(p.obj.rigidBody, true);
        this.createCargoJoint(p.obj.id, p.localPos, p.localQuat);
      }
    } else {
      this.pendingThrowCargoIds = this.pinned.map((p) => p.obj.id);
      for (const p of this.pinned) {
        p.obj.isHeld = false;
        p.obj.canPickUp = true;
        if (p.obj.rigidBody) this.physics.setBodyEnabled(p.obj.rigidBody, true);
      }
    }

    this.pinned = [];
    this.isHeld = false;
    this.palletObj.isHeld = false;
    this.previewMesh.visible = false;
    this.playerData.state = 'empty-handed';
    this.playerData.heldObjectId = null;
    this.hud.hideInteractionPrompt();
    this.updateLabelFollow();
  }

  /** Called right after pickup-system.ts's executeThrow() has applied the
   * throw impulse/torque — `linearVelocity`/`angularVelocity` are the
   * pallet's own ACTUAL resulting velocity, read post-impulse. Gives every
   * cargo item released/bound in prepareForThrow() a matching STARTING
   * velocity (a one-time nudge, never per-frame tracking — spec七: "不要在
   * 投擲期間每幀setTranslation硬追蹤"); bound cargo then stays with the
   * pallet purely through its fixed joint from this point on, and unbound
   * cargo scatters independently under normal physics from here (spec三:
   * "依真實物理散落"). */
  onThrown(_obj: InteractableObject, linearVelocity: THREE.Vector3, angularVelocity: THREE.Vector3): void {
    for (const id of this.pendingThrowCargoIds) {
      const cargo = this.interactables.get(id);
      if (cargo?.rigidBody) {
        cargo.rigidBody.setLinvel({ x: linearVelocity.x, y: linearVelocity.y, z: linearVelocity.z }, true);
        cargo.rigidBody.setAngvel({ x: angularVelocity.x, y: angularVelocity.y, z: angularVelocity.z }, true);
        cargo.rigidBody.wakeUp();
      }
    }
    this.pendingThrowCargoIds = [];
    this.updateRopeVisual();
  }

  /** Emergency safety net — NOT part of normal play, only invoked when
   * updateCarry() detects a non-finite computed transform. Snaps the
   * pallet (and releases any pinned cargo) back to a safe, known-good
   * state instead of leaving a NaN mesh/collider or a permanently stuck
   * hold. Also used by resetToStart() below. */
  private forceReleaseToSafePosition(): void {
    for (const p of this.pinned) {
      const obj = p.obj;
      obj.isHeld = false;
      obj.canPickUp = true;
      if (obj.rigidBody) {
        this.physics.setBodyEnabled(obj.rigidBody, true);
        obj.rigidBody.setTranslation({ x: this.homePos.x, y: this.homePos.y + 0.5, z: this.homePos.z }, true);
        obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    this.pinned = [];
    this.pendingCargoRestore = [];
    this.pendingJointsToCreate = [];
    this.isHeld = false;
    this.palletObj.isHeld = false;
    this.previewMesh.visible = false;

    this.palletObj.mesh.position.copy(this.homePos);
    this.palletObj.mesh.quaternion.identity();
    this.palletObj.mesh.updateMatrixWorld(true);
    if (this.body.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) {
      this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    }
    this.body.setTranslation({ x: this.homePos.x, y: this.homePos.y, z: this.homePos.z }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.placementYaw = 0;
    this.updateLabelFollow();

    if (this.playerData.heldObjectId === this.palletId) {
      this.playerData.state = 'empty-handed';
      this.playerData.heldObjectId = null;
      this.hud.hideInteractionPrompt();
    }
  }

  /** End-of-day reset — unconditionally restores the pallet to its home
   * position/rotation, visible and with physics re-enabled, regardless of
   * where it currently is: sitting somewhere in the room, mid-carry
   * (forced-released first, including clearing playerData if it still
   * points at the pallet), or hidden after riding away with a departed
   * vehicle (VehicleControlSystem sets mesh.visible=false for it instead
   * of destroying it). Also unconditionally clears any rope-bind state and
   * joints (spec八: "換日、重置或載具離場不能留下失效joint") — any bound
   * cargo id this leaves behind is about to be swept by the same daily
   * cargo-clear pass every other item goes through regardless. */
  resetToStart(): void {
    this.forceReleaseToSafePosition();
    this.stableTimers.clear();
    this.palletObj.canPickUp = true;
    this.palletObj.mesh.visible = true;

    this.removeAllCargoJoints();
    this.isRopeBound = false;
    this.boundCargoIds = [];
    this.pendingThrowCargoIds = [];
    this.updateRopeVisual();
    this.updateLabelFollow();
  }
}
