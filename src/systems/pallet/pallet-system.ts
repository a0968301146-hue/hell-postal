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
// — see the original round's own doc comment on why (avoids a real import
// cycle: interaction barrel -> interaction-system -> pallet barrel ->
// pallet-system -> interaction barrel).
import { PalletThrowHooks } from '../interaction/pickup-system';
import { BACK_AREA, WORLD_BOUNDS, SCENE_CONFIG } from '../world-layout';
import { createFloatingLabel } from '../../adapters/three/world-label-system';
import {
  PalletSize, PalletDimensions, PalletWallSlot, PalletSetDefinition, PALLET_SIZE_ORDER, PALLET_DIMENSIONS,
  PALLET_DETECT_HEIGHT, PALLET_SAFETY_DROP_POS, PALLET_SIZE_DISPLAY_NAME, PALLET_SET_DEFINITIONS,
  RACK_BRACKET_THICKNESS, isPalletId, isRackId,
} from './pallet-data';

const STABLE_THRESHOLD = 0.5; // seconds, organize judgment
const VELOCITY_THRESHOLD = 0.4;

/** How far in front of the camera the pallet's carry position sits, PLUS the
 * union bounds' own horizontal half-extent (so a bigger load sits further
 * away — spec 四: "需要依托盤與托盤貨物的 union bounds 動態調整距離"). */
const CARRY_BASE_FORWARD_DIST = 1.0;
/** How far below eye level the union bounds' CENTER sits while walking. */
const CARRY_DROP_BELOW_EYE = 0.45;
/** Never let the union bounds' bottom get closer than this to the floor
 * while WALKING. */
const CARRY_MIN_FLOOR_CLEARANCE = 0.15;
/** Never let the union bounds' top rise above camera eye level by more than
 * this. */
const CARRY_MAX_ABOVE_EYE = 0.35;
/** Minimum horizontal clearance between the carry center and the camera. */
const MIN_CAMERA_CLEARANCE = 0.6;

/** How high above the pallet's local top surface `uiAnchor` sits. */
const UI_ANCHOR_HEIGHT_ABOVE_TOP = 0.4;

/** Manual yaw step per wheel notch, world-Y-only. */
const PLACEMENT_YAW_STEP = THREE.MathUtils.degToRad(15);

/** Rope strap visual thickness/height — plain flat bars, not modeled rope
 * geometry. */
const ROPE_STRAP_THICKNESS = 0.05;
const ROPE_STRAP_HEIGHT = 0.03;

interface PinnedCargoEntry {
  obj: InteractableObject;
  localPos: THREE.Vector3;
  localQuat: THREE.Quaternion;
}

/** Everything owned by ONE physical pallet — "Rebuild pallet storage and
 * reset upgrade progression" round三: replaces the old single-pallet class
 * fields entirely (spec三: "不可再假設遊戲中只有單一PALLET_ID...將PalletSystem
 * 由單一托盤參照改成Map<palletId, PalletInstance>或等效的多實例結構"). Every
 * per-pallet quantity that used to read a single shared PALLET_CONFIG now
 * reads `dimensions` off THIS instance instead (spec三: "Cargo承載範圍、邊緣
 * 判定、固定繩尺寸與放置碰撞，都必須讀取該托盤自己的dimensions"). */
interface PalletInstance {
  id: string;
  size: PalletSize;
  dimensions: PalletDimensions;
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  palletObj: InteractableObject;
  uiAnchor: THREE.Object3D;
  floatingLabel: THREE.Sprite;
  ropeVisualX: THREE.Mesh;
  ropeVisualZ: THREE.Mesh;
  pinned: PinnedCargoEntry[];
  unionHalfExtents: THREE.Vector3;
  unionLocalCenterOffset: THREE.Vector3;
  isRopeBound: boolean;
  boundCargoIds: string[];
  cargoJointHandles: Map<string, RAPIER.ImpulseJointHandle>;
  /** Cargo ids released/bound at the moment of a Q-throw, consumed once by
   * onThrown() to give them the pallet's own post-impulse velocity. */
  pendingThrowCargoIds: string[];
  /** 'stored' = mounted on its wall rack slot (spec四: kinematic, disabled
   * physics, invisible to the cargo hook, not a floor placement surface,
   * never throwable). 'placed' = resting somewhere on the floor, normal
   * kinematic-while-parked pallet behavior. 'held' = currently being
   * carried — mirrors `heldPalletId` at the class level, kept in sync. */
  storageState: 'stored' | 'placed' | 'held';
  /** The wall slot id it's CURRENTLY docked in — only non-null while
   * storageState==='stored'. "Add envelope stacks and expand pallet
   * inventory" round: with a second pallet set now sharing each size, any
   * rack whose size matches may accept ANY pallet of that size (spec十二:
   * "每個slot只接受對應尺寸的托盤" — size-only, not fixed instance
   * ownership), so this can legitimately differ from `homeSlot.id` if the
   * player hangs a pallet on a same-size rack from the OTHER set. */
  wallSlotId: string | null;
  /** The FIXED rack this pallet always returns to at end-of-day reset
   * (resetToStart), regardless of which matching-size rack it was last
   * manually hung on — set once at construction, never reassigned. */
  homeSlot: PalletWallSlot;
  stableTimers: Map<string, number>;
}

/**
 * Manages every sorting pallet (small/medium/large — "Rebuild pallet storage
 * and reset upgrade progression" round三/四) as a genuine multi-instance
 * `Map<id, PalletInstance>`. Each is a pickupable InteractableObject
 * integrated into the shared E-key flow (targeted/raycast like any cargo
 * item — see interaction-system.ts's own pallet/rack branches), NOT a second
 * independent input system.
 *
 * SINGLE MODEL HIERARCHY per instance — `instance.mesh` (the base board) IS
 * the hierarchy root: the three decorative top slats, `uiAnchor`, and the two
 * rope-strap visuals are all its CHILDREN at fixed/computed LOCAL offsets.
 * `instance.mesh` is the ONLY THREE.Object3D ever added to the scene for
 * that pallet, and the ONLY one whose position/rotation this class ever
 * writes — moving it carries everything else along for free.
 *
 * ONLY ONE PALLET CAN EVER BE HELD AT A TIME (spec五: "同一時間只能搬一張托
 * 盤") — `heldPalletId` tracks which, and the carry/placement SCRATCH state
 * (placementYaw, previewMesh, previewValid, placementPos/Quat,
 * pendingCargoRestore, pendingJointsToCreate) stays class-level rather than
 * per-instance, since it's only ever meaningful for whichever ONE pallet is
 * mid-transaction.
 *
 * WALL STORAGE (spec四-六) — every pallet starts `storageState: 'stored'`,
 * mounted vertically on its own size-matched PALLET_WALL_SLOTS slot
 * (pallet-data.ts), body disabled (spec四: "不受重力影響...不可被捕貨鉤勾
 * 取...不參與地面Cargo放置面" — a disabled Rapier body structurally satisfies
 * all three, reusing the exact invariant pinned cargo already relies on
 * elsewhere in this codebase rather than inventing a new exclusion flag).
 * takeFromRack (folded into pickUp()) checks power-gloves equip AND
 * UpgradeSystem.canCarryPalletSize(size) before letting it leave the wall,
 * going STRAIGHT into the held/carry state (spec五: "不要讓玩家先把掛牆托盤
 * 掉到地上再撿"). tryReturnToRack() reverses this, gated on the pallet being
 * genuinely empty (spec六: pinnedCargo/boundCargoIds/isRopeBound all zero,
 * AND a fresh footprint re-scan finds nothing physically resting on top —
 * "不可只看pinnedCargo，因為托盤放下後可能有未pinned但仍實際放在上面的
 * Cargo").
 *
 * ROPE STRAPS — a single-level bulletin-board skill (ropeStrap,
 * upgrade-data.ts) unlocks pressing F, while carrying ANY pallet in its live
 * placement preview, to toggle that instance's OWN `isRopeBound` for
 * whatever's currently pinned to it. Binding never changes how cargo is
 * tracked WHILE being carried — it only changes what happens once that
 * pallet stops being held: placed cargo gets a real Rapier FIXED JOINT
 * (isHeld deliberately stays true, reusing the "isHeld blocks pickup/
 * cargo-hook-targeting" invariant everywhere else already respects), and a
 * Q-throw creates the same joints before the impulse, then gives bound cargo
 * a one-time starting-velocity nudge once the pallet's own post-impulse
 * velocity is known (never per-frame setTranslation tracking).
 */
export class PalletSystem implements PalletThrowHooks {
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
  private onPalletBuilt?: (mesh: THREE.Mesh) => void;
  private onPalletDestroyed?: (mesh: THREE.Mesh) => void;

  private pallets: Map<string, PalletInstance> = new Map();
  private heldPalletId: string | null = null;
  /** Every rack slot ever built, across both sets, keyed by rack id — the
   * ONE source isMatchingEmptyRack/tryReturnToRack read to resolve a rack id
   * back to its (size, position, quaternion) regardless of which set built
   * it, so a same-size pallet from EITHER set can be hung on EITHER set's
   * rack (spec十二: size-only matching — see PalletInstance.wallSlotId's own
   * doc comment). Entries are added by buildSet(), removed by
   * destroyRackVisual() (lockSecondSet). */
  private rackSlotById: Map<string, PalletWallSlot> = new Map();
  /** Floating text labels built by buildRackVisual() — tracked separately
   * from `interactables` (which only holds the backing-plate mesh) so
   * lockSecondSet's own teardown can find and dispose them too. */
  private rackLabels: Map<string, THREE.Sprite> = new Map();

  private labelWorldPosScratch = new THREE.Vector3();
  private hasFiredUse = false;
  private hasFiredOrganized = false;

  /** Validity of `placementPos`/`placementQuat` for whichever pallet is
   * currently held — the floor-level position it would land at if placed
   * RIGHT NOW, distinct from the walking carry transform. */
  previewValid = false;
  private placementPos = new THREE.Vector3();
  private placementQuat = new THREE.Quaternion();
  private downRaycaster = new THREE.Raycaster();
  /** Crosshair raycaster for the F-key rope-strap check against GROUND
   * pallets ("Fix NPC direct interaction and pallet stack handling" round
   * 四) — a SEPARATE raycaster from downRaycaster (placement-preview) and
   * InteractionSystem's own (that one only ever targets pallets for pickup/
   * return-to-rack, never for rope-binding a pallet that's just resting on
   * the floor). */
  private aimRaycaster = new THREE.Raycaster();
  /** This frame's camera position/forward, cached from update()'s own
   * parameters — read by getAimedGroundPallet() so the F-key handler (a
   * separate keydown listener, fired at an arbitrary point between frames)
   * always has a recent aim direction to raycast from without needing its
   * own camera reference threaded through the constructor. */
  private lastCameraPosition: THREE.Vector3 | null = null;
  private lastCameraForward: THREE.Vector3 | null = null;
  private previewMesh: THREE.Mesh;
  /** Pinned cargo whose collider must stay disabled for one more physics
   * step after tryPlace() repositions it — flushed at the top of the NEXT
   * update() call. */
  private pendingCargoRestore: InteractableObject[] = [];
  /** Fixed-joint creation for a just-placed bound item is deferred to the
   * SAME frame its collider re-enables, never created while the body is
   * still disabled (creating a Rapier joint on a disabled body corrupts the
   * physics world's internal state — confirmed in an earlier round's own
   * testing). Tagged with `palletId` since either currently-acted-upon
   * pallet could populate this in principle. */
  private pendingJointsToCreate: { palletId: string; cargoId: string; localPos: THREE.Vector3; localQuat: THREE.Quaternion }[] = [];

  /** Manual wheel-controlled yaw (world-Y-only) for whichever pallet is
   * currently held — seeded from that pallet's own current rotation at the
   * start of each pickUp(). */
  private placementYaw = 0;

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, cargoSystem: CargoSystem, interactables: Map<string, InteractableObject>,
    playerData: PlayerInteractionData, hud: HUD, pauseManager: PauseManager, upgradeSystem: UpgradeSystem,
    onFirstUse?: () => void, onFirstOrganized?: () => void,
    // "Add envelope stacks and expand pallet inventory" round — fired once
    // per pallet instance actually built (both the initial construction-time
    // sets AND any later unlockSecondSet() call), so create-game-systems.ts
    // can register each new top mesh as a PickupSystem placement surface
    // (pickupSystem.addPlacementSurface) without PalletSystem needing its
    // own PickupSystem reference. Replaces the old one-time post-construction
    // `for (const mesh of palletSystem.getAllTopMeshes())` loop, which only
    // ever covered whatever existed at boot.
    onPalletBuilt?: (mesh: THREE.Mesh) => void,
    // Symmetric teardown hook — fired once per instance from
    // destroyPalletInstance (lockSecondSet only), so create-game-systems.ts
    // can unregister the mesh via pickupSystem.removePlacementSurface before
    // it's disposed.
    onPalletDestroyed?: (mesh: THREE.Mesh) => void
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
    this.onPalletBuilt = onPalletBuilt;
    this.onPalletDestroyed = onPalletDestroyed;

    // "Add envelope stacks and expand pallet inventory" round spec十二: the
    // first set always exists; the second set only gets built here if a
    // restored save is already at palletInventoryLevel>=1 (a fresh page
    // load after a previous purchase) — otherwise it's built later, on
    // demand, by unlockSecondSet() (UpgradeSystem's own applyEffect push).
    this.buildSet(PALLET_SET_DEFINITIONS[0]);
    if (this.upgradeSystem.getLevel('palletInventoryLevel') >= 1) {
      this.buildSet(PALLET_SET_DEFINITIONS[1]);
    }
    this.previewMesh = this.buildPreviewMesh();

    document.addEventListener('wheel', (e) => this.onWheel(e));
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  /** Builds every pallet+rack in one set (spec十二's own "第二組...使用現有
   * PalletSystem多實例架構") — id/size/slot all come from the passed-in
   * PalletSetDefinition (pallet-data.ts) rather than being re-derived here,
   * so this same method builds BOTH the always-on first set (constructor)
   * and the skill-gated second set (unlockSecondSet). Idempotent — skips
   * any id that's already built, so a redundant call (e.g. applyAllEffects
   * re-pushing palletInventoryLevel on every load once already unlocked)
   * never double-constructs. */
  private buildSet(def: PalletSetDefinition): void {
    for (const size of PALLET_SIZE_ORDER) {
      const id = def.ids[size];
      if (this.pallets.has(id)) continue;
      const slot = def.wallSlots[size];
      const instance = this.buildPallet(id, size, slot, def.setIndex);
      this.pallets.set(id, instance);
      this.rackSlotById.set(def.rackIds[size], slot);
      this.onPalletBuilt?.(instance.mesh);
    }
    for (const size of PALLET_SIZE_ORDER) {
      const rackId = def.rackIds[size];
      if (this.interactables.has(rackId)) continue;
      this.buildRackVisual(rackId, def.wallSlots[size], def.setIndex);
    }
  }

  /** Called by UpgradeSystem's own applyEffect (palletInventoryLevel>=1) —
   * either right after purchase (mid-session, spec十二: "購買後立即spawn第二
   * 組...不需要重新整理頁面") or redundantly on every subsequent load once
   * already unlocked (a harmless no-op via buildSet's own idempotency). */
  unlockSecondSet(): void {
    this.buildSet(PALLET_SET_DEFINITIONS[1]);
  }

  /** Reverses unlockSecondSet() — see PalletInventoryExpansionTarget's own
   * doc comment (upgrade-system.ts) for when this fires. A safe no-op if
   * the second set was never built (destroyPalletInstance/destroyRackVisual
   * both tolerate a missing id). */
  lockSecondSet(): void {
    const def = PALLET_SET_DEFINITIONS[1];
    for (const size of PALLET_SIZE_ORDER) {
      const instance = this.pallets.get(def.ids[size]);
      if (instance) this.destroyPalletInstance(instance);
      this.destroyRackVisual(def.rackIds[size]);
    }
  }

  /** Full teardown of one pallet instance (lockSecondSet only — the first
   * set is never torn down) — force-releases it first if currently held or
   * rope-bound (spec十二: "清除第二組托盤的Cargo綁定/繩索/掛架佔用資料，且
   * 不影響第一組"), then disposes every Three.js resource and removes it
   * from both `pallets` and `interactables`. */
  private destroyPalletInstance(instance: PalletInstance): void {
    if (this.heldPalletId === instance.id) {
      this.forceReleaseToSafePosition(instance);
    }
    this.removeAllCargoJoints(instance);
    for (const id of instance.boundCargoIds) {
      const obj = this.interactables.get(id);
      if (obj) obj.isHeld = false;
    }

    this.onPalletDestroyed?.(instance.mesh);
    this.scene.remove(instance.mesh);
    instance.mesh.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const mats = child.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mats)) mats.forEach((m) => m.dispose());
      else mats.dispose();
    });
    this.scene.remove(instance.floatingLabel);
    const labelMat = instance.floatingLabel.material as THREE.SpriteMaterial;
    labelMat.map?.dispose();
    labelMat.dispose();

    this.physics.removeRigidBody(instance.body);
    this.interactables.delete(instance.id);
    this.pallets.delete(instance.id);
  }

  /** Full teardown of one rack's backing-plate mesh + floating label
   * (lockSecondSet only) — mirrors destroyPalletInstance above. */
  private destroyRackVisual(rackId: string): void {
    const rackObj = this.interactables.get(rackId);
    if (rackObj) {
      this.scene.remove(rackObj.mesh);
      rackObj.mesh.geometry.dispose();
      const mats = rackObj.mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mats)) mats.forEach((m) => m.dispose());
      else mats.dispose();
      this.interactables.delete(rackId);
    }
    const label = this.rackLabels.get(rackId);
    if (label) {
      this.scene.remove(label);
      const labelMat = label.material as THREE.SpriteMaterial;
      labelMat.map?.dispose();
      labelMat.dispose();
      this.rackLabels.delete(rackId);
    }
    this.rackSlotById.delete(rackId);
  }

  private buildPallet(id: string, size: PalletSize, slot: PalletWallSlot, setIndex: number): PalletInstance {
    const dims = PALLET_DIMENSIONS[size];
    const displayName = setIndex > 0
      ? `整理托盤（${PALLET_SIZE_DISPLAY_NAME[size]}・二）`
      : `整理托盤（${PALLET_SIZE_DISPLAY_NAME[size]}）`;

    // The base board is the hierarchy root — the ONLY object ever added to
    // the scene for this whole pallet. Starts mounted at its wall slot
    // transform (spec四: "初始狀態：三張托盤全部掛在各自牆面slot").
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xa87a42 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(dims.width, dims.height, dims.depth), woodMat);
    mesh.position.copy(slot.position);
    mesh.quaternion.copy(slot.quaternion);
    mesh.userData.surfaceType = 'pallet-top';
    this.scene.add(mesh);

    // A few raised slat lines across the top — purely cosmetic, LOCAL
    // offsets relative to the base board's own origin. Tagged the same as
    // the base board (see original round's own doc comment) — the placement
    // raycast is recursive, so a ray aimed at the pallet's top very often
    // hits a slat first.
    const slatMat = new THREE.MeshStandardMaterial({ color: 0x8a6234 });
    for (let i = -1; i <= 1; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(dims.width * 0.9, 0.02, dims.depth * 0.12), slatMat);
      slat.position.set(0, dims.height / 2 + 0.01, i * dims.depth * 0.3);
      slat.userData.surfaceType = 'pallet-top';
      mesh.add(slat);
    }

    const uiAnchor = new THREE.Object3D();
    uiAnchor.position.set(0, dims.height / 2 + UI_ANCHOR_HEIGHT_ABOVE_TOP, 0);
    mesh.add(uiAnchor);

    const floatingLabel = createFloatingLabel(displayName, { width: 0.7, bg: 'rgba(30,25,15,0.75)' });
    this.scene.add(floatingLabel);

    // Rope strap visuals — built ONCE here as children of the base board,
    // just hidden/near-zero-scaled until bindRope() actually needs them (see
    // updateRopeVisual's own doc comment for why leaving them at
    // BoxGeometry(1,1,1)'s literal default scale silently corrupts this
    // pallet's own placement-collision Box3 — a confirmed regression from an
    // earlier round, guarded against here from construction).
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x4a3423 });
    const ropeVisualX = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), strapMat);
    const ropeVisualZ = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), strapMat);
    ropeVisualX.visible = false;
    ropeVisualZ.visible = false;
    ropeVisualX.scale.set(0.001, 0.001, 0.001);
    ropeVisualZ.scale.set(0.001, 0.001, 0.001);
    ropeVisualX.raycast = () => {};
    ropeVisualZ.raycast = () => {};
    mesh.add(ropeVisualX);
    mesh.add(ropeVisualZ);

    // Kinematic body — starts DISABLED (stored on the wall). Re-enabled the
    // moment it's taken down (pickUp) or placed on the floor; disabled again
    // whenever it's hung back up (tryReturnToRack).
    const bodyDesc = this.physics.createKinematicBodyDesc(slot.position.x, slot.position.y, slot.position.z);
    const body = this.physics.createKinematicBody(bodyDesc);
    body.setRotation({ x: slot.quaternion.x, y: slot.quaternion.y, z: slot.quaternion.z, w: slot.quaternion.w }, true);
    this.physics.addColliderToBody(body, 0, 0, 0, dims.width / 2, dims.height / 2, dims.depth / 2);
    this.physics.setBodyEnabled(body, false);

    const palletObj = createInteractableObject(id, displayName, mesh, dims.width, dims.height, dims.depth);
    palletObj.rigidBody = body;
    this.interactables.set(id, palletObj);

    mesh.updateMatrixWorld(true);

    const instance: PalletInstance = {
      id, size, dimensions: dims, mesh, body, palletObj, uiAnchor, floatingLabel, ropeVisualX, ropeVisualZ,
      pinned: [], unionHalfExtents: new THREE.Vector3(), unionLocalCenterOffset: new THREE.Vector3(),
      isRopeBound: false, boundCargoIds: [], cargoJointHandles: new Map(), pendingThrowCargoIds: [],
      storageState: 'stored', wallSlotId: slot.id, homeSlot: slot, stableTimers: new Map(),
    };

    this.updateLabelFollow(instance);
    this.updateRopeVisual(instance);
    return instance;
  }

  /** Simple wall-mount dressing for one slot (spec四: "使用簡單壁掛支架、輪
   * 廓框與牆面文字標示") — a thin backing plate sitting just behind the
   * pallet's own mounted depth (so it reads as a shallow mount bracket the
   * board sits flush against) plus a floating text label above it. Built
   * ONCE per size, independent of pallet occupancy (permanent scene
   * furniture, unlike the pallets themselves) — never registered with a
   * physics body, and registered into `interactables` purely so the
   * existing shared crosshair raycast (interaction-system.ts) can target it
   * for the "E 掛回托盤" return-to-rack prompt, the same "canPickUp=true
   * only to satisfy the raycast filter, never meant to actually be picked
   * up" pattern the mail rack / vehicle buttons already established. */
  private buildRackVisual(rackId: string, slot: PalletWallSlot, setIndex: number): void {
    const dims = PALLET_DIMENSIONS[slot.size];
    const labelText = setIndex > 0 ? `${PALLET_SIZE_DISPLAY_NAME[slot.size]}架（二）` : `${PALLET_SIZE_DISPLAY_NAME[slot.size]}架`;

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x5a5248 });
    // Local axes here intentionally mirror the pallet mesh's own convention
    // (X=width, becomes world-vertical after the slot's mount rotation;
    // Y=thickness, becomes world wall-normal; Z=depth, stays world-along-
    // wall) so "behind the pallet" is a simple negative local-Y offset. Holds
    // for BOTH the east-wall (Z-rotation) and south-wall (X-rotation) mount
    // quaternions — see pallet-data.ts's own SOUTH_WALL_MOUNT_QUAT doc
    // comment on why bracketWidth/bracketHeight are interchangeable there.
    const backingGeo = new THREE.BoxGeometry(slot.bracketHeight, RACK_BRACKET_THICKNESS, slot.bracketWidth);
    const backing = new THREE.Mesh(backingGeo, frameMat);
    const localOffset = new THREE.Vector3(0, -(dims.height / 2 + RACK_BRACKET_THICKNESS / 2 + 0.01), 0);
    backing.position.copy(localOffset.applyQuaternion(slot.quaternion).add(slot.position));
    backing.quaternion.copy(slot.quaternion);
    this.scene.add(backing);

    const rackObj = createInteractableObject(rackId, labelText, backing, slot.bracketHeight, RACK_BRACKET_THICKNESS, slot.bracketWidth);
    rackObj.canPickUp = true;
    this.interactables.set(rackId, rackObj);

    const label = createFloatingLabel(labelText, { width: 0.55, bg: 'rgba(20,20,20,0.7)', fontSize: 20 });
    const labelPos = slot.position.clone();
    labelPos.y += slot.bracketHeight / 2 + 0.25;
    label.position.copy(labelPos);
    this.scene.add(label);
    this.rackLabels.set(rackId, label);
  }

  /** Semi-transparent ghost representing the currently-held pallet's own
   * (+ all pinned cargo's) union bounds at the current placement target —
   * green when valid, red when not. Never raycast-hittable, never
   * registered as an InteractableObject, no physics body. Shared across
   * whichever pallet is held (only one ever is). */
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

  private updateLabelFollow(instance: PalletInstance): void {
    instance.floatingLabel.visible = instance.storageState === 'placed' && instance.palletObj.mesh.visible;
    if (!instance.floatingLabel.visible) return;
    instance.uiAnchor.getWorldPosition(this.labelWorldPosScratch);
    instance.floatingLabel.position.copy(this.labelWorldPosScratch);
  }

  /** Rotates the CURRENTLY HELD pallet's own live placement preview 15° per
   * notch — ToolSystem's own wheel handler gates itself off whenever
   * `heldObjectId` is any pallet id (see tool-system.ts), so the two can
   * never both react to the same event. */
  private onWheel(event: WheelEvent): void {
    if (this.pauseManager.isPaused) return;
    if (!this.heldPalletId) return;
    if (Math.abs(event.deltaY) < 1) return;
    const dir = event.deltaY > 0 ? 1 : -1;
    this.placementYaw += dir * PLACEMENT_YAW_STEP;
  }

  /** F toggles rope-binding for a GROUND-PLACED pallet the crosshair is
   * aimed at ("Fix NPC direct interaction and pallet stack handling" round
   * 四: 固定繩索只能對放在地面的托盤使用 — removed entirely from the old
   * "while carrying" flow) — a completely independent listener from
   * InteractionSystem's own (matching cargo-hook-system.ts's established
   * pattern), so it never intercepts F for anything else (spec: "不可破壞信
   * 封箱等其他F功能" — this listener only ever acts when its OWN full
   * condition set is satisfied, silently no-opping otherwise, same as every
   * other independent F/Q listener already in this codebase).
   *
   * Locked-skill/held-pallet/wrong-tool all silently no-op (spec: "技能尚未
   * 解鎖時...按F不執行固定繩功能" — no toast, no prompt, nothing) —
   * getRopeStrapPromptSuffix() below enforces the SAME condition set for the
   * prompt side, so the two can never disagree about when F does something. */
  private onKeyDown(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (event.code !== 'KeyF') return;
    if (this.pauseManager.isPaused) return;
    if (this.heldPalletId) return;
    if (this.playerData.activeTool !== 'powerGloves') return;
    if (!this.upgradeSystem.isRopeStrapUnlocked()) return;

    const instance = this.getAimedGroundPallet();
    if (!instance) return;

    if (instance.isRopeBound) {
      this.unbindRope(instance);
      return;
    }
    if (!this.isPalletRestingStill(instance)) return;
    const supportedCargo = this.findSupportedCargoRecursive(instance);
    if (supportedCargo.length === 0) {
      this.hud.showToast('托盤上沒有可固定的貨物');
      return;
    }
    this.bindRope(instance, supportedCargo);
  }

  /** Raycast-precise "which ground-placed (storageState==='placed') pallet
   * is the crosshair currently aimed at, within interaction range" — the
   * ONE source both onKeyDown's own F-press ABOVE and
   * getRopeStrapPromptSuffix's own display-prompt BELOW read, so they can
   * never disagree (mirrors canStoreHeldPallet's own "single judgment
   * function" role for the wall-mount-return fix). Never matches a held or
   * wall-stored pallet — F does nothing for either (spec四: "已經放置在地面
   * 的托盤" only). */
  private getAimedGroundPallet(): PalletInstance | null {
    if (!this.lastCameraPosition || !this.lastCameraForward) return null;
    this.aimRaycaster.set(this.lastCameraPosition, this.lastCameraForward);
    const groundPallets = Array.from(this.pallets.values()).filter((p) => p.storageState === 'placed');
    const meshes = groundPallets.map((p) => p.mesh);
    const hits = this.aimRaycaster.intersectObjects(meshes, true);
    if (hits.length === 0 || hits[0].distance > SCENE_CONFIG.interactionDistance) return null;
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj) {
      const match = groundPallets.find((p) => p.mesh === obj);
      if (match) return match;
      obj = obj.parent;
    }
    return null;
  }

  /** Spec四: "托盤線速度與角速度接近靜止" — reuses the same VELOCITY_THRESHOLD
   * the organize-scan already treats as "stable" elsewhere in this file. */
  private isPalletRestingStill(instance: PalletInstance): boolean {
    const lv = instance.body.linvel();
    const av = instance.body.angvel();
    const speed = Math.sqrt(lv.x ** 2 + lv.y ** 2 + lv.z ** 2);
    const angSpeed = Math.sqrt(av.x ** 2 + av.y ** 2 + av.z ** 2);
    return speed < VELOCITY_THRESHOLD && angSpeed < VELOCITY_THRESHOLD;
  }

  /** F-key rope-strap hint for whatever the crosshair is CURRENTLY aimed at
   * while empty-handed (InteractionSystem's own generic pallet-aim prompt
   * calls this to build the combined text) — '' whenever F would do nothing
   * right now, so the prompt and the actual key-press can never promise
   * something that doesn't happen. */
  getRopeStrapPromptSuffix(palletId: string): string {
    if (!this.upgradeSystem.isRopeStrapUnlocked()) return '';
    if (this.heldPalletId) return '';
    if (this.playerData.activeTool !== 'powerGloves') return '';
    const instance = this.pallets.get(palletId);
    if (!instance || instance.storageState !== 'placed') return '';
    if (instance.isRopeBound) return '\nF 解除固定繩';
    if (!this.isPalletRestingStill(instance)) return '';
    if (this.findSupportedCargoRecursive(instance).length === 0) return '';
    return '\nF 綁上固定繩';
  }

  /** Recursive multi-layer support detection ("Fix NPC direct interaction
   * and pallet stack handling" round三) — replaces the old single-layer
   * "only cargo directly touching the pallet's own top face" scan. Layer 1
   * is that same direct-contact check; every subsequent layer is found by
   * testing EVERY not-yet-supported candidate against EVERY already-
   * supported item's own world-space AABB (spec: "候選Cargo底部與支撐物頂部
   * 垂直間距約-0.03~0.12m", "XZ footprint必須具有實際重疊" — never just a
   * center-point containment test), repeating until a pass finds nothing
   * new. No max-layer cap; never pulls in cargo that isn't transitively
   * reachable from the pallet's own top face through a real contact chain,
   * so nearby-but-unconnected cargo is never swept up. */
  private findSupportedCargoRecursive(instance: PalletInstance): InteractableObject[] {
    const { width, depth, height } = instance.dimensions;
    const innerHW = width / 2;
    const innerHD = depth / 2;

    instance.palletObj.mesh.updateMatrixWorld(true);
    const matInv = new THREE.Matrix4().copy(instance.palletObj.mesh.matrixWorld).invert();

    const candidates: InteractableObject[] = [];
    for (const [id, obj] of this.interactables) {
      if (isPalletId(id) || isRackId(id)) continue;
      if (obj.isHeld || !obj.mesh.visible) continue;
      const data = this.cargoSystem.getCargoData(id);
      if (!data || (data.shapeType !== 'box' && data.shapeType !== 'large')) continue;
      candidates.push(obj);
    }

    const supported: InteractableObject[] = [];
    const supportedIds = new Set<string>();

    // Layer 1: cargo resting directly on the pallet's own top surface.
    for (const obj of candidates) {
      const localPos = obj.mesh.position.clone().applyMatrix4(matInv);
      const inZone =
        localPos.x >= -innerHW && localPos.x <= innerHW &&
        localPos.z >= -innerHD && localPos.z <= innerHD &&
        localPos.y >= height / 2 - 0.05 && localPos.y <= height / 2 + PALLET_DETECT_HEIGHT;
      if (inZone) {
        supported.push(obj);
        supportedIds.add(obj.id);
      }
    }

    // Layers 2+: cargo resting on top of already-supported cargo, found via
    // real world-space AABB overlap (vertical gap + XZ footprint overlap),
    // repeated breadth-first until a pass adds nothing new.
    let frontier = supported.slice();
    while (frontier.length > 0) {
      const nextFrontier: InteractableObject[] = [];
      for (const support of frontier) {
        const sHalfW = support.width / 2, sHalfD = support.depth / 2, sHalfH = support.height / 2;
        const sPos = support.mesh.position;
        const sTop = sPos.y + sHalfH;
        const sMinX = sPos.x - sHalfW, sMaxX = sPos.x + sHalfW;
        const sMinZ = sPos.z - sHalfD, sMaxZ = sPos.z + sHalfD;

        for (const cand of candidates) {
          if (supportedIds.has(cand.id)) continue;
          const cHalfW = cand.width / 2, cHalfD = cand.depth / 2, cHalfH = cand.height / 2;
          const cPos = cand.mesh.position;
          const cBottom = cPos.y - cHalfH;
          const gap = cBottom - sTop;
          if (gap < -0.03 || gap > 0.12) continue;

          const cMinX = cPos.x - cHalfW, cMaxX = cPos.x + cHalfW;
          const cMinZ = cPos.z - cHalfD, cMaxZ = cPos.z + cHalfD;
          const overlapsXZ = cMinX < sMaxX && cMaxX > sMinX && cMinZ < sMaxZ && cMaxZ > sMinZ;
          if (!overlapsXZ) continue;

          supported.push(cand);
          supportedIds.add(cand.id);
          nextFrontier.push(cand);
        }
      }
      frontier = nextFrontier;
    }

    return supported;
  }

  /** Binds rope straps to a GROUND-PLACED pallet's own currently-detected
   * cargo (spec四) — creates the real fixed joints RIGHT AWAY (unlike
   * tryPlace()'s own deferred pendingJointsToCreate queue, which exists
   * specifically to handle cargo bodies still disabled on the very frame
   * they're re-enabled; a ground pallet's cargo is already fully physics-
   * active, so no such deferral is needed here).
   *
   * Sets `obj.isHeld = true` on every newly-bound item — the SAME invariant
   * tryPlace() already establishes for cargo bound while carrying (its own
   * class doc comment: "isHeld deliberately stays true, reusing the isHeld-
   * blocks-pickup/cargo-hook-targeting invariant"). Without this, a
   * subsequent pickUp() on this same pallet would find these items via BOTH
   * the boundCargoIds re-collection AND the fresh findSupportedCargoRecursive
   * scan (which only skips isHeld===true items) and double-pin them —
   * confirmed via headless testing before this fix (pinnedCount came back
   * doubled). */
  private bindRope(instance: PalletInstance, cargo: InteractableObject[]): void {
    instance.palletObj.mesh.updateMatrixWorld(true);
    const matInv = new THREE.Matrix4().copy(instance.palletObj.mesh.matrixWorld).invert();
    const quatInv = instance.palletObj.mesh.quaternion.clone().invert();

    instance.isRopeBound = true;
    instance.boundCargoIds = cargo.map((obj) => obj.id);
    for (const obj of cargo) {
      const localPos = obj.mesh.position.clone().applyMatrix4(matInv);
      const localQuat = obj.mesh.quaternion.clone().premultiply(quatInv);
      this.createCargoJoint(instance, obj.id, localPos, localQuat);
      obj.isHeld = true;
    }
    this.updateRopeVisual(instance);
    this.hud.showToast('貨物已被固定繩綁住');
  }

  /** Reverses bindRope() above — also clears `isHeld` on every item that WAS
   * bound (mirrors tryPlace()'s own `obj.isHeld = isBound` assignment, which
   * is what resets it for the old held-pallet flow; a ground-only unbind
   * never passes through tryPlace() again, so this method must reset it
   * itself or the cargo would stay permanently unpickupable/untargetable). */
  private unbindRope(instance: PalletInstance): void {
    this.removeAllCargoJoints(instance);
    for (const id of instance.boundCargoIds) {
      const obj = this.interactables.get(id);
      if (obj) obj.isHeld = false;
    }
    instance.isRopeBound = false;
    instance.boundCargoIds = [];
    this.updateRopeVisual(instance);
    this.hud.showToast('已解除固定繩');
  }

  /** Positions the two crossed strap visuals to span the combined LOCAL
   * bounds (in THIS pallet's own local space, using ITS OWN dimensions —
   * spec七: "繩索combined bounds必須依各托盤及貨物重新計算") of every
   * currently-bound item. Hidden (and shrunk to near-zero scale/reset to
   * local origin — see the original round's own doc comment on why both
   * matter, not just `.visible`) whenever nothing is bound. */
  private updateRopeVisual(instance: PalletInstance): void {
    if (!instance.isRopeBound || instance.boundCargoIds.length === 0) {
      instance.ropeVisualX.visible = false;
      instance.ropeVisualZ.visible = false;
      instance.ropeVisualX.scale.set(0.001, 0.001, 0.001);
      instance.ropeVisualZ.scale.set(0.001, 0.001, 0.001);
      instance.ropeVisualX.position.set(0, 0, 0);
      instance.ropeVisualZ.position.set(0, 0, 0);
      return;
    }

    const { width, height, depth } = instance.dimensions;
    let minX = -width / 2, maxX = width / 2;
    let maxY = height / 2;
    let minZ = -depth / 2, maxZ = depth / 2;

    instance.palletObj.mesh.updateMatrixWorld(true);
    const matInv = new THREE.Matrix4().copy(instance.palletObj.mesh.matrixWorld).invert();

    for (const id of instance.boundCargoIds) {
      const obj = this.interactables.get(id);
      if (!obj) continue;
      const pinnedEntry = instance.pinned.find((p) => p.obj.id === id);
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

    instance.ropeVisualX.scale.set(sizeX, ROPE_STRAP_HEIGHT, ROPE_STRAP_THICKNESS);
    instance.ropeVisualX.position.set(centerX, maxY, centerZ);
    instance.ropeVisualZ.scale.set(ROPE_STRAP_THICKNESS, ROPE_STRAP_HEIGHT, sizeZ);
    instance.ropeVisualZ.position.set(centerX, maxY, centerZ);

    instance.ropeVisualX.visible = true;
    instance.ropeVisualZ.visible = true;
  }

  private createCargoJoint(instance: PalletInstance, cargoId: string, localPos: THREE.Vector3, localQuat: THREE.Quaternion): void {
    const obj = this.interactables.get(cargoId);
    if (!obj || !obj.rigidBody) return;
    if (instance.cargoJointHandles.has(cargoId)) return;
    const jointData = RAPIER.JointData.fixed(
      { x: localPos.x, y: localPos.y, z: localPos.z },
      { x: localQuat.x, y: localQuat.y, z: localQuat.z, w: localQuat.w },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 }
    );
    const joint = this.physics.world.createImpulseJoint(jointData, instance.body, obj.rigidBody, true);
    instance.cargoJointHandles.set(cargoId, joint.handle);
  }

  private removeAllCargoJoints(instance: PalletInstance): void {
    for (const handle of instance.cargoJointHandles.values()) {
      const joint = this.physics.world.getImpulseJoint(handle);
      if (joint) this.physics.world.removeImpulseJoint(joint, true);
    }
    instance.cargoJointHandles.clear();
  }

  update(deltaTime: number, cameraPosition?: THREE.Vector3, cameraForward?: THREE.Vector3): void {
    // Cached for getAimedGroundPallet() — the F-key rope-strap listener
    // fires from a separate keydown handler with no camera reference of its
    // own (see that field's own doc comment).
    if (cameraPosition && cameraForward) {
      this.lastCameraPosition = cameraPosition;
      this.lastCameraForward = cameraForward;
    }

    if (this.pendingCargoRestore.length > 0) {
      for (const obj of this.pendingCargoRestore) {
        if (obj.rigidBody) this.physics.setBodyEnabled(obj.rigidBody, true);
      }
      this.pendingCargoRestore = [];
    }
    if (this.pendingJointsToCreate.length > 0) {
      for (const j of this.pendingJointsToCreate) {
        const instance = this.pallets.get(j.palletId);
        if (instance) this.createCargoJoint(instance, j.cargoId, j.localPos, j.localQuat);
      }
      this.pendingJointsToCreate = [];
    }

    for (const instance of this.pallets.values()) {
      // Safety net — a bound pallet just swept away by a departing vehicle
      // (vehicle-control-system.ts sets mesh.visible=false and drags the
      // mesh directly) leaves this class's own joints referencing bodies no
      // longer meaningfully carried together — clear them. The binding
      // INTENT is left alone (isRopeBound/boundCargoIds), only the physics
      // joints go.
      if (instance.cargoJointHandles.size > 0 && !instance.palletObj.mesh.visible) {
        this.removeAllCargoJoints(instance);
      }

      if (instance.storageState === 'held') continue; // handled below, once, for heldPalletId only

      // Bound-but-not-currently-carried cargo is genuinely simulating via
      // its fixed joint — its own isHeld=true deliberately skips the
      // generic per-frame physics->mesh sync loop in game-app.ts, so this
      // class syncs it itself instead.
      if (instance.isRopeBound) {
        for (const id of instance.boundCargoIds) {
          const obj = this.interactables.get(id);
          if (obj?.rigidBody && obj.rigidBody.isEnabled()) {
            this.physics.syncMeshToBody(obj.mesh, obj.rigidBody);
          }
        }
      }

      this.updateLabelFollow(instance);
      if (instance.storageState === 'placed') this.updateOrganizeScan(instance, deltaTime);
    }

    if (this.heldPalletId) {
      const held = this.pallets.get(this.heldPalletId);
      if (held && cameraPosition && cameraForward) this.updateCarry(held, cameraPosition, cameraForward);
    }
  }

  /** A box/large item resting stably on THIS pallet's own CURRENT footprint
   * (rotation-aware local-space check, using the instance's OWN dimensions —
   * spec三) for >=0.5s gets marked organized. */
  private updateOrganizeScan(instance: PalletInstance, deltaTime: number): void {
    const { width, depth, height } = instance.dimensions;
    const innerHW = width / 2;
    const innerHD = depth / 2;

    instance.palletObj.mesh.updateMatrixWorld(true);
    const matInv = new THREE.Matrix4().copy(instance.palletObj.mesh.matrixWorld).invert();

    const idsStillInZone = new Set<string>();

    for (const [id, obj] of this.interactables) {
      if (isPalletId(id) || isRackId(id)) continue;
      if (obj.isHeld || !obj.mesh.visible) continue;
      const data = this.cargoSystem.getCargoData(id);
      if (!data || (data.shapeType !== 'box' && data.shapeType !== 'large')) continue;

      const localPos = obj.mesh.position.clone().applyMatrix4(matInv);
      const inZone =
        localPos.x >= -innerHW && localPos.x <= innerHW &&
        localPos.z >= -innerHD && localPos.z <= innerHD &&
        localPos.y >= height / 2 - 0.05 && localPos.y <= height / 2 + PALLET_DETECT_HEIGHT;
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

      const prev = instance.stableTimers.get(id) ?? 0;
      const next = stable ? prev + deltaTime : 0;
      instance.stableTimers.set(id, next);

      if (next >= STABLE_THRESHOLD) {
        data.organized = true;
        if (!this.hasFiredOrganized) {
          this.hasFiredOrganized = true;
          this.onFirstOrganized?.();
        }
      }
    }

    for (const id of instance.stableTimers.keys()) {
      if (!idsStillInZone.has(id)) instance.stableTimers.delete(id);
    }
  }

  // --- Identity helpers ---

  isPalletId(id: string): boolean {
    return isPalletId(id);
  }

  isRackId(id: string): boolean {
    return isRackId(id);
  }

  getPalletSize(id: string): PalletSize | null {
    return this.pallets.get(id)?.size ?? null;
  }

  getAllTopMeshes(): THREE.Mesh[] {
    return Array.from(this.pallets.values()).map((p) => p.mesh);
  }

  isHeldId(id: string | null): boolean {
    return !!id && id === this.heldPalletId;
  }

  /** Whichever pallet is currently held, if any — used by
   * InteractionSystem's own multi-carry-vs-pallet exclusion check. */
  get heldId(): string | null {
    return this.heldPalletId;
  }

  /** "Add freezer shelves and frozen cargo freshness system" round — every
   * pallet currently mounted on its wall rack (spec五: "若托盤放在冷凍貨架
   * 上"). FreezerSystem's own ONE read of pallet mount state — never reaches
   * into `pallets`/`storageState` directly itself. */
  getRackedPalletIds(): string[] {
    const ids: string[] = [];
    for (const [id, instance] of this.pallets) {
      if (instance.storageState === 'stored') ids.push(id);
    }
    return ids;
  }

  /** "Add freezer shelves and frozen cargo freshness system" round — every
   * cargo id currently resting on the given pallet (spec五: "整張托盤上的所有
   * 冷凍貨物全部一起恢復。不用拆開判定") — a thin public wrapper around the
   * existing findSupportedCargoRecursive scan (already used internally for
   * rope-binding/pinning-for-throw), never a second independent scan. Empty
   * array for an unknown/nonexistent pallet id. */
  getCargoIdsOnPallet(palletId: string): string[] {
    const instance = this.pallets.get(palletId);
    if (!instance) return [];
    return this.findSupportedCargoRecursive(instance).map((obj) => obj.id);
  }

  // --- Pick up (from the floor OR straight off a wall rack) ---

  /** Called by InteractionSystem when the player targets an (unheld) pallet
   * — whether resting on the floor ('placed') or mounted on its wall rack
   * ('stored') — and presses E. Both cases funnel through here (spec五: "按E
   * 後直接進入搬運狀態" — a stored pallet never touches the floor first). */
  pickUp(targetId: string, cameraPosition: THREE.Vector3, cameraForward: THREE.Vector3): void {
    if (this.heldPalletId) return; // spec五: "同一時間只能搬一張托盤"
    const instance = this.pallets.get(targetId);
    if (!instance) return;
    if (instance.storageState === 'held') return;

    if (this.playerData.activeTool !== 'powerGloves') {
      this.hud.showToast('需要裝備力量手套');
      return;
    }
    if (this.playerData.state !== 'empty-handed') return;

    if (!this.upgradeSystem.canCarryPalletSize(instance.size)) {
      this.hud.showToast(
        instance.size === 'large' ? '力量手套尚無法搬動大型托盤' : '力量手套尚無法搬動中型托盤'
      );
      return;
    }

    const wasStored = instance.storageState === 'stored';
    if (wasStored) {
      // Leaving the wall — re-enable physics now that it's about to be
      // driven by the normal carry logic.
      this.physics.setBodyEnabled(instance.body, true);
    }

    // Revert to a genuinely kinematic body in case a previous Q-throw left
    // it Dynamic — carry logic always assumes a kinematic body it fully
    // drives itself. Synced to wherever the mesh visually settled.
    if (instance.body.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) {
      const mp = instance.palletObj.mesh.position, mq = instance.palletObj.mesh.quaternion;
      instance.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      instance.body.setTranslation({ x: mp.x, y: mp.y, z: mp.z }, true);
      instance.body.setRotation({ x: mq.x, y: mq.y, z: mq.z, w: mq.w }, true);
      instance.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      instance.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    // Seed the manual placement yaw from whatever rotation it's currently
    // resting at — a wall-mounted pallet's own tilt quaternion isn't a
    // meaningful FLOOR yaw to seed from, so start flat/unrotated instead.
    this.placementYaw = wasStored
      ? 0
      : new THREE.Euler().setFromQuaternion(instance.palletObj.mesh.quaternion, 'YXZ').y;

    instance.palletObj.mesh.updateMatrixWorld(true);
    const matInv = new THREE.Matrix4().copy(instance.palletObj.mesh.matrixWorld).invert();
    const quatInv = instance.palletObj.mesh.quaternion.clone().invert();

    instance.pinned = [];

    // Re-collect already-bound cargo FIRST — it deliberately stays
    // isHeld=true while placed-and-bound, so the generic footprint scan
    // below (which skips isHeld items) would never rediscover it on its own.
    // Never relevant for a wall-stored pallet (nothing can be bound to it).
    if (instance.isRopeBound) {
      this.removeAllCargoJoints(instance);
      for (const id of instance.boundCargoIds) {
        const obj = this.interactables.get(id);
        if (!obj || !obj.rigidBody) continue;
        const t = obj.rigidBody.translation();
        const r = obj.rigidBody.rotation();
        const localPos = new THREE.Vector3(t.x, t.y, t.z).applyMatrix4(matInv);
        const localQuat = new THREE.Quaternion(r.x, r.y, r.z, r.w).premultiply(quatInv);
        instance.pinned.push({ obj, localPos, localQuat });
        obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.physics.setBodyEnabled(obj.rigidBody, false);
      }
    }

    if (!wasStored) {
      // "Fix NPC direct interaction and pallet stack handling" round三:
      // recursive multi-layer detection (findSupportedCargoRecursive) —
      // replaces the old single-layer "only cargo directly on the pallet's
      // own top face" scan, so a second/third+ stacked layer is picked up
      // (and follows the carry, rotates with the wheel, survives placement,
      // and gets caught by a Q-throw) exactly like the first layer already
      // did.
      for (const obj of this.findSupportedCargoRecursive(instance)) {
        const localPos = obj.mesh.position.clone().applyMatrix4(matInv);
        const localQuat = obj.mesh.quaternion.clone().premultiply(quatInv);
        instance.pinned.push({ obj, localPos, localQuat });

        obj.isHeld = true;
        if (obj.rigidBody) {
          obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
          obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
          this.physics.setBodyEnabled(obj.rigidBody, false);
        }
      }
    }

    this.computeUnionBounds(instance);
    instance.storageState = 'held';
    instance.wallSlotId = null;
    this.heldPalletId = instance.id;
    instance.palletObj.isHeld = true;
    this.playerData.state = 'holding-item';
    this.playerData.heldObjectId = instance.id;
    this.hud.showInteractionPrompt(instance.palletObj.displayName, '滾輪旋轉　E放置　Q丟出');
    this.updateLabelFollow(instance);
    this.updateRopeVisual(instance);

    // Position it in front of the player immediately, not one frame late.
    this.updateCarry(instance, cameraPosition, cameraForward);
  }

  private computeUnionBounds(instance: PalletInstance): void {
    const { width, height, depth } = instance.dimensions;
    let minX = -width / 2, maxX = width / 2;
    let minY = -height / 2, maxY = height / 2;
    let minZ = -depth / 2, maxZ = depth / 2;

    for (const p of instance.pinned) {
      const hw = p.obj.width / 2, hh = p.obj.height / 2, hd = p.obj.depth / 2;
      minX = Math.min(minX, p.localPos.x - hw); maxX = Math.max(maxX, p.localPos.x + hw);
      minY = Math.min(minY, p.localPos.y - hh); maxY = Math.max(maxY, p.localPos.y + hh);
      minZ = Math.min(minZ, p.localPos.z - hd); maxZ = Math.max(maxZ, p.localPos.z + hd);
    }

    instance.unionHalfExtents.set((maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2);
    instance.unionLocalCenterOffset.set((maxX + minX) / 2, (maxY + minY) / 2, (maxZ + minZ) / 2);
  }

  private computeCarryTransform(instance: PalletInstance, cameraPosition: THREE.Vector3, cameraForward: THREE.Vector3): { pos: THREE.Vector3; quat: THREE.Quaternion } | null {
    const flat = new THREE.Vector3(cameraForward.x, 0, cameraForward.z);
    if (flat.lengthSq() < 1e-6) return null;
    flat.normalize();

    const horizExtent = Math.max(instance.unionHalfExtents.x, instance.unionHalfExtents.z);
    const forwardDist = Math.max(CARRY_BASE_FORWARD_DIST, MIN_CAMERA_CLEARANCE) + horizExtent;
    const targetX = cameraPosition.x + flat.x * forwardDist;
    const targetZ = cameraPosition.z + flat.z * forwardDist;
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.placementYaw);

    const desiredCenterY = cameraPosition.y - CARRY_DROP_BELOW_EYE;
    const minCenterY = BACK_AREA.floorY + CARRY_MIN_FLOOR_CLEARANCE + instance.unionHalfExtents.y;
    const maxCenterY = cameraPosition.y + CARRY_MAX_ABOVE_EYE - instance.unionHalfExtents.y;
    const centerY = THREE.MathUtils.clamp(desiredCenterY, minCenterY, Math.max(minCenterY, maxCenterY));
    const targetY = centerY - instance.unionLocalCenterOffset.y;

    return { pos: new THREE.Vector3(targetX, targetY, targetZ), quat };
  }

  private clampCarryMove(instance: PalletInstance, targetPos: THREE.Vector3, targetQuat: THREE.Quaternion): THREE.Vector3 {
    const oldPos = instance.palletObj.mesh.position;
    const rotatedOffset = instance.unionLocalCenterOffset.clone().applyQuaternion(targetQuat);
    const delta = new THREE.Vector3(targetPos.x - oldPos.x, targetPos.y - oldPos.y, targetPos.z - oldPos.z);
    const shapeCenter = oldPos.clone().add(rotatedOffset);
    const allowedFraction = this.physics.castShapeMove(shapeCenter, targetQuat, instance.unionHalfExtents, delta);
    return new THREE.Vector3(
      oldPos.x + delta.x * allowedFraction,
      oldPos.y + delta.y * allowedFraction,
      oldPos.z + delta.z * allowedFraction
    );
  }

  private applyCarryTransform(instance: PalletInstance, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    instance.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
    instance.body.setNextKinematicRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    instance.palletObj.mesh.position.copy(pos);
    instance.palletObj.mesh.quaternion.copy(quat);
    instance.palletObj.mesh.updateMatrixWorld(true);
  }

  private updateCarry(instance: PalletInstance, cameraPosition: THREE.Vector3, cameraForward: THREE.Vector3): void {
    const transform = this.computeCarryTransform(instance, cameraPosition, cameraForward);
    if (!transform) return;

    const clampedPos = this.clampCarryMove(instance, transform.pos, transform.quat);

    if (!Number.isFinite(clampedPos.x) || !Number.isFinite(clampedPos.y) || !Number.isFinite(clampedPos.z)) {
      console.error('[PalletSystem] carry position became non-finite — force-releasing to a safe position.');
      this.forceReleaseToSafePosition(instance);
      return;
    }

    this.applyCarryTransform(instance, clampedPos, transform.quat);

    for (const p of instance.pinned) {
      const worldPos = p.localPos.clone().applyMatrix4(instance.palletObj.mesh.matrixWorld);
      const worldQuat = transform.quat.clone().multiply(p.localQuat);
      p.obj.mesh.position.copy(worldPos);
      p.obj.mesh.quaternion.copy(worldQuat);
    }
    if (instance.isRopeBound) this.updateRopeVisual(instance);

    this.updatePlacementPreview(instance, clampedPos, transform.quat);
  }

  private updatePlacementPreview(instance: PalletInstance, carryPos: THREE.Vector3, carryQuat: THREE.Quaternion): void {
    const excludeRoots: THREE.Object3D[] = [instance.palletObj.mesh, this.previewMesh, ...instance.pinned.map((p) => p.obj.mesh)];
    this.downRaycaster.set(new THREE.Vector3(carryPos.x, carryPos.y + 3, carryPos.z), new THREE.Vector3(0, -1, 0));
    const hits = this.downRaycaster.intersectObjects(this.scene.children, true)
      .filter((h) => !this.isExcluded(h.object, excludeRoots));
    const supportY = hits.length > 0 ? hits[0].point.y : BACK_AREA.floorY;

    const placeCenterY = supportY + instance.unionHalfExtents.y;
    this.placementPos.set(carryPos.x, placeCenterY - instance.unionLocalCenterOffset.y, carryPos.z);
    this.placementQuat.copy(carryQuat);

    const valid = this.checkPlacementValidity(instance);
    this.previewValid = valid;

    this.previewMesh.visible = true;
    this.previewMesh.position.copy(this.placementPos).add(instance.unionLocalCenterOffset.clone().applyQuaternion(this.placementQuat));
    this.previewMesh.quaternion.copy(this.placementQuat);
    this.previewMesh.scale.set(instance.unionHalfExtents.x * 2, instance.unionHalfExtents.y * 2, instance.unionHalfExtents.z * 2);
    const mat = this.previewMesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(valid ? 0x00ff88 : 0xff3333);
    mat.opacity = valid ? 0.28 : 0.35;
  }

  private checkPlacementValidity(instance: PalletInstance): boolean {
    const cos = Math.abs(Math.cos(this.placementYaw));
    const sin = Math.abs(Math.sin(this.placementYaw));
    const halfW = instance.unionHalfExtents.x * cos + instance.unionHalfExtents.z * sin;
    const halfD = instance.unionHalfExtents.x * sin + instance.unionHalfExtents.z * cos;
    const halfH = instance.unionHalfExtents.y;
    const center = this.placementPos.clone().add(instance.unionLocalCenterOffset.clone().applyQuaternion(this.placementQuat));

    if (center.x - halfW < WORLD_BOUNDS.minX || center.x + halfW > WORLD_BOUNDS.maxX ||
        center.z - halfD < WORLD_BOUNDS.minZ || center.z + halfD > WORLD_BOUNDS.maxZ) return false;

    const eps = 0.02;
    const box = new THREE.Box3(
      new THREE.Vector3(center.x - halfW + eps, center.y - halfH + eps, center.z - halfD + eps),
      new THREE.Vector3(center.x + halfW - eps, center.y + halfH - eps, center.z + halfD - eps)
    );

    const excludeIds = new Set<string>([instance.id, ...instance.pinned.map((p) => p.obj.id)]);
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

  /** Called by InteractionSystem on a second E-press while holding a pallet
   * and NOT aiming at a matching empty rack slot (see tryReturnToRack below
   * for that alternative) — commits the floor placement if the live
   * preview is valid. */
  tryPlace(): boolean {
    if (!this.heldPalletId) return false;
    const instance = this.pallets.get(this.heldPalletId);
    if (!instance) return false;
    if (!this.previewValid) {
      this.hud.showToast('此處無法放置整理托盤');
      return false;
    }

    const finalPos = this.placementPos.clone();
    const finalQuat = this.placementQuat.clone();

    instance.body.setNextKinematicTranslation({ x: finalPos.x, y: finalPos.y, z: finalPos.z });
    instance.body.setNextKinematicRotation({ x: finalQuat.x, y: finalQuat.y, z: finalQuat.z, w: finalQuat.w });
    instance.palletObj.mesh.position.copy(finalPos);
    instance.palletObj.mesh.quaternion.copy(finalQuat);
    instance.palletObj.mesh.updateMatrixWorld(true);

    for (const p of instance.pinned) {
      const obj = p.obj;
      const worldPos = p.localPos.clone().applyMatrix4(instance.palletObj.mesh.matrixWorld);
      const worldQuat = finalQuat.clone().multiply(p.localQuat);
      obj.mesh.position.copy(worldPos);
      obj.mesh.quaternion.copy(worldQuat);

      const isBound = instance.isRopeBound && instance.boundCargoIds.includes(obj.id);
      obj.isHeld = isBound;
      if (obj.rigidBody) {
        obj.rigidBody.setTranslation({ x: worldPos.x, y: worldPos.y, z: worldPos.z }, true);
        obj.rigidBody.setRotation({ x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w }, true);
        obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.pendingCargoRestore.push(obj);
        if (isBound) this.pendingJointsToCreate.push({ palletId: instance.id, cargoId: obj.id, localPos: p.localPos.clone(), localQuat: p.localQuat.clone() });
      }
    }

    instance.pinned = [];
    instance.storageState = 'placed';
    instance.palletObj.isHeld = false;
    this.heldPalletId = null;
    this.previewMesh.visible = false;
    this.playerData.state = 'empty-handed';
    this.playerData.heldObjectId = null;
    this.hud.hideInteractionPrompt();
    this.updateLabelFollow(instance);
    this.updateRopeVisual(instance);
    return true;
  }

  // --- Wall rack return (spec六) ---

  /** True while aiming at a rack whose size matches the held pallet AND
   * that slot is currently empty — the ONE extra condition
   * updateRackReturnPrompt/InteractionSystem need to decide whether E
   * should mean "掛回托盤" instead of the normal tryPlace(). "Add envelope
   * stacks and expand pallet inventory" round: with a second pallet set now
   * sharing each size, "empty" is resolved by scanning for whichever pallet
   * (from EITHER set) is currently docked at this exact rack id (its own
   * `wallSlotId === rackId`) — size-only matching, not fixed instance
   * ownership (spec十二: "每個slot只接受對應尺寸的托盤"), so a set-2 pallet
   * can be hung on a set-1 rack of the same size and vice versa. */
  isMatchingEmptyRack(rackId: string, heldPalletId: string): boolean {
    const slot = this.rackSlotById.get(rackId);
    if (!slot) return false;
    const heldInstance = this.pallets.get(heldPalletId);
    if (!heldInstance || heldInstance.size !== slot.size) return false;
    for (const inst of this.pallets.values()) {
      if (inst.wallSlotId === rackId) return false;
    }
    return true;
  }

  /** ONE canonical judgment for "can the CURRENTLY HELD pallet be hung back
   * onto this exact rack slot id right now" ("Fix NPC direct interaction and
   * pallet stack handling" round六) — mirrors tryReturnToRack's own success
   * gate exactly (isMatchingEmptyRack + genuinely empty). InteractionSystem
   * reads this SAME method for both the prompt display and the actual
   * E-press action (against the SAME per-frame raycast hit id), which is
   * the actual fix for "提示顯示但按E無效" — the two call sites used to read
   * different sources (a fresh raycast for the prompt vs. a stale/cleared
   * this.currentTarget for the action) and could disagree. */
  canStoreHeldPallet(slotId: string): boolean {
    if (!this.heldPalletId) return false;
    const instance = this.pallets.get(this.heldPalletId);
    if (!instance) return false;
    if (!this.isMatchingEmptyRack(slotId, instance.id)) return false;
    if (instance.pinned.length > 0 || instance.boundCargoIds.length > 0 || instance.isRopeBound) return false;
    return true;
  }

  /** Called by InteractionSystem's own E-handler once it's already
   * confirmed (via isMatchingEmptyRack) that the player is holding a
   * pallet and aiming at its own matching, empty rack slot. Refuses if the
   * pallet still has anything resting on it — spec六 explicitly warns
   * "不可只看pinnedCargo，因為托盤放下後可能有未pinned但仍實際放在上面的
   * Cargo", so this re-scans the pallet's CURRENT footprint fresh rather
   * than trusting `pinned` (which is only ever populated while genuinely
   * held/mid-carry, and is exactly that here — but the check is written
   * against a live footprint scan anyway so it stays correct even if this
   * method's own call site ever changes). */
  tryReturnToRack(rackId: string): boolean {
    if (!this.heldPalletId) return false;
    const instance = this.pallets.get(this.heldPalletId);
    if (!instance) return false;
    if (!this.isMatchingEmptyRack(rackId, instance.id)) {
      this.hud.showToast('掛架目前已有托盤');
      return false;
    }

    if (instance.pinned.length > 0 || instance.boundCargoIds.length > 0 || instance.isRopeBound) {
      this.hud.showToast('請先清空托盤上的貨物');
      return false;
    }

    // The rack actually aimed at — may be a DIFFERENT set's same-size slot
    // than `instance.homeSlot` (spec十二: size-only matching, see
    // isMatchingEmptyRack's own doc comment); resetToStart() is what always
    // sends it back to its own fixed homeSlot regardless of this.
    const slot = this.rackSlotById.get(rackId)!;
    instance.body.setNextKinematicTranslation({ x: slot.position.x, y: slot.position.y, z: slot.position.z });
    instance.body.setNextKinematicRotation({ x: slot.quaternion.x, y: slot.quaternion.y, z: slot.quaternion.z, w: slot.quaternion.w });
    instance.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    instance.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    instance.palletObj.mesh.position.copy(slot.position);
    instance.palletObj.mesh.quaternion.copy(slot.quaternion);
    instance.palletObj.mesh.updateMatrixWorld(true);
    this.physics.setBodyEnabled(instance.body, false);

    instance.storageState = 'stored';
    instance.wallSlotId = slot.id;
    instance.palletObj.isHeld = false;
    this.heldPalletId = null;
    this.previewMesh.visible = false;
    this.placementYaw = 0;
    this.playerData.state = 'empty-handed';
    this.playerData.heldObjectId = null;
    this.hud.hideInteractionPrompt();
    this.updateLabelFollow(instance);
    return true;
  }

  // --- Q-throw (PalletThrowHooks) ---

  isPallet(obj: InteractableObject): boolean {
    return isPalletId(obj.id);
  }

  isPalletRopeBound(obj: InteractableObject): boolean {
    const instance = this.pallets.get(obj.id);
    return !!instance && instance.isRopeBound;
  }

  private syncPinnedCargoToCurrentWorldTransform(instance: PalletInstance, p: PinnedCargoEntry): void {
    const worldPos = p.localPos.clone().applyMatrix4(instance.palletObj.mesh.matrixWorld);
    const worldQuat = instance.palletObj.mesh.quaternion.clone().multiply(p.localQuat);
    p.obj.mesh.position.copy(worldPos);
    p.obj.mesh.quaternion.copy(worldQuat);
    if (p.obj.rigidBody) {
      p.obj.rigidBody.setTranslation({ x: worldPos.x, y: worldPos.y, z: worldPos.z }, true);
      p.obj.rigidBody.setRotation({ x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w }, true);
    }
  }

  prepareForThrow(obj: InteractableObject): void {
    const instance = this.pallets.get(obj.id);
    if (!instance) return;
    instance.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    instance.palletObj.mesh.updateMatrixWorld(true);

    if (instance.isRopeBound) {
      instance.pendingThrowCargoIds = [...instance.boundCargoIds];
      for (const p of instance.pinned) {
        if (!instance.boundCargoIds.includes(p.obj.id)) continue;
        this.syncPinnedCargoToCurrentWorldTransform(instance, p);
        if (p.obj.rigidBody) this.physics.setBodyEnabled(p.obj.rigidBody, true);
        this.createCargoJoint(instance, p.obj.id, p.localPos, p.localQuat);
      }
    } else {
      instance.pendingThrowCargoIds = instance.pinned.map((p) => p.obj.id);
      for (const p of instance.pinned) {
        this.syncPinnedCargoToCurrentWorldTransform(instance, p);
        p.obj.isHeld = false;
        p.obj.canPickUp = true;
        if (p.obj.rigidBody) this.physics.setBodyEnabled(p.obj.rigidBody, true);
      }
    }

    instance.pinned = [];
    instance.storageState = 'placed';
    instance.palletObj.isHeld = false;
    this.heldPalletId = null;
    this.previewMesh.visible = false;
    this.playerData.state = 'empty-handed';
    this.playerData.heldObjectId = null;
    this.hud.hideInteractionPrompt();
    this.updateLabelFollow(instance);
  }

  onThrown(obj: InteractableObject, linearVelocity: THREE.Vector3, angularVelocity: THREE.Vector3): void {
    const instance = this.pallets.get(obj.id);
    if (!instance) return;
    for (const id of instance.pendingThrowCargoIds) {
      const cargo = this.interactables.get(id);
      if (cargo?.rigidBody) {
        cargo.rigidBody.setLinvel({ x: linearVelocity.x, y: linearVelocity.y, z: linearVelocity.z }, true);
        cargo.rigidBody.setAngvel({ x: angularVelocity.x, y: angularVelocity.y, z: angularVelocity.z }, true);
        cargo.rigidBody.wakeUp();
      }
    }
    instance.pendingThrowCargoIds = [];
    this.updateRopeVisual(instance);
  }

  /** Emergency safety net — NOT part of normal play, only invoked when
   * updateCarry() detects a non-finite computed transform. Snaps the
   * pallet (and releases any pinned cargo) back to a safe, known-good FLOOR
   * position instead of leaving a NaN mesh/collider or a permanently stuck
   * hold. */
  private forceReleaseToSafePosition(instance: PalletInstance): void {
    for (const p of instance.pinned) {
      const obj = p.obj;
      obj.isHeld = false;
      obj.canPickUp = true;
      if (obj.rigidBody) {
        this.physics.setBodyEnabled(obj.rigidBody, true);
        obj.rigidBody.setTranslation({ x: PALLET_SAFETY_DROP_POS.x, y: BACK_AREA.floorY + 0.5, z: PALLET_SAFETY_DROP_POS.z }, true);
        obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    instance.pinned = [];
    this.pendingCargoRestore = [];
    this.pendingJointsToCreate = [];
    instance.storageState = 'placed';
    instance.palletObj.isHeld = false;
    this.heldPalletId = null;
    this.previewMesh.visible = false;

    const safeY = BACK_AREA.floorY + instance.dimensions.height / 2;
    instance.palletObj.mesh.position.set(PALLET_SAFETY_DROP_POS.x, safeY, PALLET_SAFETY_DROP_POS.z);
    instance.palletObj.mesh.quaternion.identity();
    instance.palletObj.mesh.updateMatrixWorld(true);
    if (instance.body.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) {
      instance.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    }
    instance.body.setTranslation({ x: PALLET_SAFETY_DROP_POS.x, y: safeY, z: PALLET_SAFETY_DROP_POS.z }, true);
    instance.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    instance.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    instance.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.placementYaw = 0;
    this.updateLabelFollow(instance);

    if (this.playerData.heldObjectId === instance.id) {
      this.playerData.state = 'empty-handed';
      this.playerData.heldObjectId = null;
      this.hud.hideInteractionPrompt();
    }
  }

  /** End-of-day reset — every pallet unconditionally returns to its own
   * wall rack slot (spec四's initial state, re-established every day),
   * regardless of where it currently is: sitting somewhere in the room,
   * mid-carry (force-released first), or hidden after riding away with a
   * departed vehicle. Also unconditionally clears any rope-bind state and
   * joints — any bound cargo id this leaves behind is about to be swept by
   * the same daily cargo-clear pass every other item goes through
   * regardless. */
  resetToStart(): void {
    for (const instance of this.pallets.values()) {
      if (instance.storageState === 'held' || this.playerData.heldObjectId === instance.id) {
        this.forceReleaseToSafePosition(instance);
      }
      instance.stableTimers.clear();
      instance.palletObj.canPickUp = true;
      instance.palletObj.mesh.visible = true;

      this.removeAllCargoJoints(instance);
      instance.isRopeBound = false;
      instance.boundCargoIds = [];
      instance.pendingThrowCargoIds = [];
      instance.pinned = [];

      // Always the pallet's own FIXED home slot (never wherever it was last
      // manually hung — spec十二 allows cross-set same-size hanging during
      // play, but every daily reset re-establishes each pallet's own
      // canonical starting slot).
      const slot = instance.homeSlot;
      if (instance.body.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) {
        instance.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      }
      instance.body.setTranslation({ x: slot.position.x, y: slot.position.y, z: slot.position.z }, true);
      instance.body.setRotation({ x: slot.quaternion.x, y: slot.quaternion.y, z: slot.quaternion.z, w: slot.quaternion.w }, true);
      instance.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      instance.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.physics.setBodyEnabled(instance.body, false);

      instance.palletObj.mesh.position.copy(slot.position);
      instance.palletObj.mesh.quaternion.copy(slot.quaternion);
      instance.palletObj.mesh.updateMatrixWorld(true);
      instance.storageState = 'stored';
      instance.wallSlotId = slot.id;

      this.updateRopeVisual(instance);
      this.updateLabelFollow(instance);
    }
    this.heldPalletId = null;
    this.placementYaw = 0;
    this.previewMesh.visible = false;
  }
}
