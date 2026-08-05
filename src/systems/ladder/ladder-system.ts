import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../../shared/types/interactable';
import { PlayerInteractionData } from '../../core/game-state';
import { HUD } from '../hud';
import { WORLD_BOUNDS, BACK_AREA } from '../world-layout';
import { createFloatingLabel } from '../../adapters/three/world-label-system';
import {
  LADDER_ID, LADDER_RACK_ID, LADDER_DISPLAY_NAME, LADDER_FOLDED, LADDER_UNFOLDED, LADDER_TOTAL_DEPTH,
  LADDER_STEP_COUNT, LADDER_STEP_HEIGHT, LADDER_FRONT_LEG_LENGTH, LADDER_FRONT_LEG_ANGLE,
  LADDER_BACK_LEG_LENGTH, LADDER_BACK_LEG_ANGLE,
  LADDER_WALL_SLOT, LADDER_PLACEMENT_YAW_STEP,
} from './ladder-data';

/** Same carry-distance shape as pallet-system.ts's own CARRY_* constants —
 * the ladder is a comparably large carried object needing the same "stand
 * it off far enough, clamp it between floor/eye height" treatment, just for
 * a single fixed-size object with no pinned-cargo union bounds to fold in. */
const CARRY_BASE_FORWARD_DIST = 1.2;
const CARRY_DROP_BELOW_EYE = 0.4;
const CARRY_MIN_FLOOR_CLEARANCE = 0.1;
const CARRY_MAX_ABOVE_EYE = 0.3;
const MIN_CAMERA_CLEARANCE = 0.8;

/** Rough half-extents envelope covering BOTH the folded and unfolded shapes
 * — used only for carry-distance/clamp math, not the exact placement
 * validity box (see checkPlacementValidity, which uses the real
 * ramp+platform footprint). */
const CARRY_HALF_EXTENTS = new THREE.Vector3(
  LADDER_UNFOLDED.width / 2,
  LADDER_UNFOLDED.standHeight / 2,
  LADDER_TOTAL_DEPTH / 2
);

type LadderState = 'stored' | 'preview' | 'placed';

/**
 * A single foldable/carryable ladder ("Add ladder tool station and envelope
 * vacuum" round一) — deliberately NOT routed through CargoSystem or
 * PickupSystem's generic held-item stack, mirroring pallet-system.ts's own
 * reasoning for why a large wall-storable carried object needs its own
 * dedicated world-space carry/placement/wall-return state machine (a
 * generic "clone into a viewmodel" carry has no concept of "snap back onto
 * this exact wall slot", and PickupSystem has no hook for it).
 *
 * States (spec's own three-state model): 'stored' (folded, mounted on its
 * wall slot, kinematic body disabled — mirrors PalletInstance.storageState
 * ==='stored'), 'preview' (being carried, auto-unfolded, a live floor
 * placement preview shown every frame — this is simultaneously the spec's
 * "preview" state AND pallet's own "held" state, since this game's carry
 * flow has never had a separate "held but not previewing" sub-state),
 * 'placed' (resting unfolded on the floor, walkable).
 *
 * ONE kinematic body, built ONCE at construction with its ramp+platform
 * colliders already attached (PhysicsSystem.addColliderToBodyRotatedX is
 * the exact "walkable sloped surface on a moving body" primitive this
 * codebase already uses for the frog vehicle's own boarding ramp) — never
 * swapped per state. While 'stored' the body is simply DISABLED (identical
 * to how PalletSystem disables a wall-mounted pallet's body), so the
 * folded shape needs no collider of its own at all; while 'preview'/
 * 'placed' the SAME ramp+platform pair is what the player actually walks
 * up, driven kinematically the same way pallet-system.ts drives its own
 * carried/placed pallet body.
 */
export class LadderSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private playerData: PlayerInteractionData;
  private hud: HUD;

  private mesh!: THREE.Group;
  private foldedGroup!: THREE.Group;
  private unfoldedGroup!: THREE.Group;
  private body!: RAPIER.RigidBody;
  private ladderObj!: InteractableObject;
  private floatingLabel!: THREE.Sprite;
  private previewMesh!: THREE.Mesh;

  private state: LadderState = 'stored';
  previewValid = false;
  private placementYaw = 0;
  private placementPos = new THREE.Vector3();
  private placementQuat = new THREE.Quaternion();
  private downRaycaster = new THREE.Raycaster();
  /** The walkable staircase's own genuinely-Fixed colliders — only ever
   * populated while state==='placed' (built fresh at tryPlace(), cleared at
   * the next pickUp()) — see buildWalkableColliders()'s own doc comment for
   * why these can't just ride along on the carry body. */
  private walkableColliderBodies: RAPIER.RigidBody[] = [];

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>,
    playerData: PlayerInteractionData, hud: HUD
  ) {
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;
    this.playerData = playerData;
    this.hud = hud;

    this.buildLadder();
    this.buildRackVisual();
    this.previewMesh = this.buildPreviewMesh();

    document.addEventListener('wheel', (e) => this.onWheel(e));
  }

  // --- Construction ---

  private buildLadder(): void {
    const mesh = new THREE.Group();

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6234 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x6b4a26 });
    const hingeMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.4, roughness: 0.6 });

    // Folded (wall-mounted) — a flat slab profile in the ladder's OWN local
    // frame (local X=width, Y=height, Z=thickness), never reoriented itself
    // — the WHOLE root's quaternion is what points its thin local-Z face
    // into the room while stored (see LADDER_WALL_MOUNT_QUAT's own doc
    // comment in ladder-data.ts).
    const foldedGroup = new THREE.Group();
    const foldedSlab = new THREE.Mesh(
      new THREE.BoxGeometry(LADDER_FOLDED.width, LADDER_FOLDED.height, LADDER_FOLDED.thickness),
      woodMat
    );
    foldedGroup.add(foldedSlab);
    // Two side-rail accents (spec: "木質階梯與側邊支架").
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, LADDER_FOLDED.height * 0.96, LADDER_FOLDED.thickness + 0.02),
        railMat
      );
      rail.position.set(sx * (LADDER_FOLDED.width / 2 - 0.05), 0, 0);
      foldedGroup.add(rail);
    }
    // Metal hinge accents near top/bottom (spec: "金屬鉸鏈").
    for (const hy of [-1, 1]) {
      const hinge = new THREE.Mesh(new THREE.BoxGeometry(LADDER_FOLDED.width * 0.5, 0.08, 0.04), hingeMat);
      hinge.position.set(0, hy * (LADDER_FOLDED.height / 2 - 0.15), LADDER_FOLDED.thickness / 2 + 0.01);
      foldedGroup.add(hinge);
    }
    mesh.add(foldedGroup);
    this.foldedGroup = foldedGroup;

    // Unfolded (floor-placed) — a genuine A-frame. Local origin at the FRONT
    // foot's base center (ground contact point), local +Z = climb direction
    // (front foot toward the apex/hinge, then on through to the rear foot),
    // local +Y = up. The apex/hinge sits at (0, standHeight, frontRun) — both
    // the front (climbing) legs and rear (support) legs meet there, splaying
    // back down to their own feet on either side. This is the SAME local
    // frame the step/platform/rear-leg colliders below are built in, so mesh
    // and physics always stay trivially in sync while carrying/placed.
    const unfoldedGroup = new THREE.Group();
    const apexZ = LADDER_UNFOLDED.frontRun;

    // Front (climbing) rails — base foot (z=0) up to the apex (z=apexZ).
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, LADDER_FRONT_LEG_LENGTH), railMat);
      rail.position.set(sx * (LADDER_UNFOLDED.width / 2 - 0.03), LADDER_UNFOLDED.standHeight / 2, apexZ / 2);
      rail.rotation.x = -LADDER_FRONT_LEG_ANGLE;
      unfoldedGroup.add(rail);
    }
    // Step treads, evenly spaced up the front rails only (spec: "前側為可
    // 攀爬階梯").
    for (let i = 1; i <= LADDER_STEP_COUNT; i++) {
      const stepZ = (i / LADDER_STEP_COUNT) * apexZ;
      const stepY = i * LADDER_STEP_HEIGHT;
      const tread = new THREE.Mesh(new THREE.BoxGeometry(LADDER_UNFOLDED.width * 0.85, 0.04, 0.16), woodMat);
      tread.position.set(0, stepY - LADDER_STEP_HEIGHT / 2, stepZ);
      unfoldedGroup.add(tread);
    }
    // Rear rails — apex (z=apexZ) splaying back down to their own foot
    // (z=LADDER_TOTAL_DEPTH). Mirror image of the front rails' own slope
    // (rotation.x flips sign since Y now DECREASES as Z increases).
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, LADDER_BACK_LEG_LENGTH), railMat);
      rail.position.set(sx * (LADDER_UNFOLDED.width / 2 - 0.03), LADDER_UNFOLDED.standHeight / 2, apexZ + LADDER_UNFOLDED.backRun / 2);
      rail.rotation.x = LADDER_BACK_LEG_ANGLE;
      unfoldedGroup.add(rail);
    }
    // Rear step treads — genuinely double-sided this round (spec十:
    // "前後兩側各有8個可見踏板...玩家可以從任一側走上頂部平台"), evenly spaced
    // down from the apex to the back foot, mirroring the front tread loop
    // exactly (same LADDER_STEP_HEIGHT per step, since both sides share the
    // same total rise/standHeight — only the horizontal run differs).
    for (let i = 1; i <= LADDER_STEP_COUNT; i++) {
      const stepZ = apexZ + (i / LADDER_STEP_COUNT) * LADDER_UNFOLDED.backRun;
      const stepY = LADDER_UNFOLDED.standHeight - i * LADDER_STEP_HEIGHT;
      const tread = new THREE.Mesh(new THREE.BoxGeometry(LADDER_UNFOLDED.width * 0.85, 0.04, 0.16), woodMat);
      tread.position.set(0, stepY + LADDER_STEP_HEIGHT / 2, stepZ);
      unfoldedGroup.add(tread);
    }
    // Apex hinge — the metal pivot joining the front and rear leg pairs,
    // the single most A-defining silhouette cue when viewed from the side.
    const apexHinge = new THREE.Mesh(new THREE.BoxGeometry(LADDER_UNFOLDED.width * 0.55, 0.08, 0.1), hingeMat);
    apexHinge.position.set(0, LADDER_UNFOLDED.standHeight, apexZ);
    unfoldedGroup.add(apexHinge);
    // Spreader bars — one per side, bracing front rail to rear rail partway
    // down (spec: "左右擴張桿撐開角度") — prevents the silhouette reading as
    // two independent leaning boards instead of one splayed frame.
    const spreaderY = LADDER_UNFOLDED.standHeight * 0.35;
    const spreaderFrontZ = apexZ * (spreaderY / LADDER_UNFOLDED.standHeight);
    const spreaderBackZ = apexZ + LADDER_UNFOLDED.backRun * (1 - spreaderY / LADDER_UNFOLDED.standHeight);
    for (const sx of [-1, 1]) {
      const spreader = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.03, spreaderBackZ - spreaderFrontZ),
        hingeMat
      );
      spreader.position.set(sx * (LADDER_UNFOLDED.width / 2 - 0.03), spreaderY, (spreaderFrontZ + spreaderBackZ) / 2);
      unfoldedGroup.add(spreader);
    }
    // Top platform — centered on the apex, spanning slightly fore/aft of the
    // hinge (spec: "頂部平台深度約0.40-0.45m", "玩家可站在頂部平台上").
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(LADDER_UNFOLDED.width, 0.06, LADDER_UNFOLDED.platformDepth),
      woodMat
    );
    platform.position.set(0, LADDER_UNFOLDED.standHeight - 0.03, apexZ);
    unfoldedGroup.add(platform);
    // Base hinge accents where each leg pair meets the ground (front + rear
    // feet — four total, spec: "前後腳底都要接觸地面").
    for (const sx of [-1, 1]) {
      const frontFoot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), hingeMat);
      frontFoot.position.set(sx * (LADDER_UNFOLDED.width / 2 - 0.05), 0.03, 0.05);
      unfoldedGroup.add(frontFoot);
      const backFoot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), hingeMat);
      backFoot.position.set(sx * (LADDER_UNFOLDED.width / 2 - 0.05), 0.03, LADDER_TOTAL_DEPTH - 0.05);
      unfoldedGroup.add(backFoot);
    }
    unfoldedGroup.visible = false;
    mesh.add(unfoldedGroup);
    this.unfoldedGroup = unfoldedGroup;

    mesh.position.copy(LADDER_WALL_SLOT.position);
    mesh.quaternion.copy(LADDER_WALL_SLOT.quaternion);
    this.scene.add(mesh);
    this.mesh = mesh;

    const label = createFloatingLabel(LADDER_DISPLAY_NAME, { width: 0.5, bg: 'rgba(30,25,15,0.75)', fontSize: 20 });
    this.scene.add(label);
    this.floatingLabel = label;
    this.updateLabelFollow();

    // Kinematic body — tracks the ladder's own position/rotation through
    // stored/carry/placed (used by checkPlacementValidity's own
    // self-exclusion and as the InteractableObject's rigidBody), but
    // deliberately carries NO colliders of its own — see
    // buildWalkableColliders() below for why the actual walkable surface is
    // built separately, as genuinely Fixed bodies, only while 'placed'.
    const bodyDesc = this.physics.createKinematicBodyDesc(mesh.position.x, mesh.position.y, mesh.position.z);
    const body = this.physics.createKinematicBody(bodyDesc);
    body.setRotation({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w }, true);
    this.physics.setBodyEnabled(body, false);
    this.body = body;

    const ladderObj = createInteractableObject(LADDER_ID, LADDER_DISPLAY_NAME, mesh as unknown as THREE.Mesh, LADDER_UNFOLDED.width, LADDER_UNFOLDED.standHeight, LADDER_TOTAL_DEPTH);
    ladderObj.rigidBody = body;
    this.interactables.set(LADDER_ID, ladderObj);
    this.ladderObj = ladderObj;
  }

  /** Static wall-bracket dressing (spec: matches the pallet racks' own
   * "簡單壁掛支架" pattern) — a thin backing plate behind the folded ladder's
   * own mounted position, registered purely so the shared crosshair raycast
   * can target it for the "E 收回梯子" return-to-wall prompt while the
   * ladder is being carried (canPickUp=true only to satisfy the raycast
   * filter, never actually pickupable — same convention as every other
   * rack/counter dummy target in this codebase). */
  private buildRackVisual(): void {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x5a5248 });
    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(LADDER_FOLDED.width + 0.12, LADDER_FOLDED.height + 0.12, 0.04),
      frameMat
    );
    const localOffset = new THREE.Vector3(0, 0, -(LADDER_FOLDED.thickness / 2 + 0.02 + 0.01));
    backing.position.copy(localOffset.clone().applyQuaternion(LADDER_WALL_SLOT.quaternion).add(LADDER_WALL_SLOT.position));
    backing.quaternion.copy(LADDER_WALL_SLOT.quaternion);
    this.scene.add(backing);

    const rackObj = createInteractableObject(LADDER_RACK_ID, `${LADDER_DISPLAY_NAME}架`, backing, LADDER_FOLDED.width + 0.12, LADDER_FOLDED.height + 0.12, 0.04);
    rackObj.canPickUp = true;
    this.interactables.set(LADDER_RACK_ID, rackObj);
  }

  private buildPreviewMesh(): THREE.Mesh {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.28, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.raycast = () => {};
    this.scene.add(mesh);
    return mesh;
  }

  private updateLabelFollow(): void {
    const pos = this.mesh.position.clone();
    const upOffset = this.state === 'stored' ? LADDER_FOLDED.height / 2 + 0.3 : LADDER_UNFOLDED.standHeight + 0.3;
    pos.y += upOffset;
    this.floatingLabel.position.copy(pos);
    this.floatingLabel.visible = this.state !== 'placed';
  }

  // --- Occupancy check (spec: "梯子上有玩家或任何Cargo時不可拿起") ---

  /** True if the player capsule OR any non-held interactable currently
   * overlaps the ladder's own placed footprint — checked before EITHER
   * kind of pickup (off the wall is never occupied, but a floor-placed one
   * can be). Reuses the same "expand a Box3 around the current world
   * transform, test overlap" approach pallet-system.ts's own
   * checkPlacementValidity already establishes elsewhere in this codebase. */
  private isOccupied(): boolean {
    if (this.state !== 'placed') return false;
    this.mesh.updateMatrixWorld(true);
    const halfExtents = new THREE.Vector3(LADDER_UNFOLDED.width / 2 + 0.15, LADDER_UNFOLDED.standHeight / 2 + 0.15, LADDER_TOTAL_DEPTH / 2 + 0.15);
    const localCenter = new THREE.Vector3(0, LADDER_UNFOLDED.standHeight / 2, LADDER_TOTAL_DEPTH / 2);
    const worldCenter = localCenter.applyMatrix4(this.mesh.matrixWorld);
    const box = new THREE.Box3(
      worldCenter.clone().sub(halfExtents),
      worldCenter.clone().add(halfExtents)
    );

    const playerPos = this.physics.playerBody.translation();
    const playerBox = new THREE.Box3(
      new THREE.Vector3(playerPos.x - 0.35, playerPos.y - 0.9, playerPos.z - 0.35),
      new THREE.Vector3(playerPos.x + 0.35, playerPos.y + 0.9, playerPos.z + 0.35)
    );
    if (box.intersectsBox(playerBox)) return true;

    for (const [id, obj] of this.interactables) {
      if (id === LADDER_ID || id === LADDER_RACK_ID || obj.isHeld || !obj.mesh.visible) continue;
      const otherBox = new THREE.Box3().setFromObject(obj.mesh);
      if (box.intersectsBox(otherBox)) return true;
    }
    return false;
  }

  // --- Targeting helpers (read by InteractionSystem) ---

  isLadderTarget(id: string): boolean {
    return id === LADDER_ID;
  }

  isLadderRackTarget(id: string): boolean {
    return id === LADDER_RACK_ID;
  }

  get isCarrying(): boolean {
    return this.state === 'preview';
  }

  get heldId(): string | null {
    return this.state === 'preview' ? LADDER_ID : null;
  }

  /** Read by InteractionSystem to decide the E-prompt text/whether E should
   * even attempt pickUp() — mirrors canStoreHeldPallet's "one canonical
   * judgment shared by prompt and action" pattern. */
  canPickUp(): boolean {
    if (this.state === 'preview') return false;
    if (this.playerData.state !== 'empty-handed') return false;
    return !this.isOccupied();
  }

  // --- Pick up (from the floor OR straight off the wall rack) ---

  pickUp(cameraPosition: THREE.Vector3, cameraForward: THREE.Vector3): void {
    if (!this.canPickUp()) return;
    const wasStored = this.state === 'stored';
    // Leaving 'placed' — the walkable staircase's own separate Fixed
    // colliders (see buildWalkableColliders) no longer apply to wherever
    // it's about to be carried off to.
    this.clearWalkableColliders();

    if (wasStored) {
      this.physics.setBodyEnabled(this.body, true);
    }
    this.placementYaw = wasStored ? 0 : new THREE.Euler().setFromQuaternion(this.mesh.quaternion, 'YXZ').y;

    this.foldedGroup.visible = false;
    this.unfoldedGroup.visible = true;
    this.state = 'preview';
    this.ladderObj.isHeld = true;
    this.playerData.state = 'holding-item';
    this.playerData.heldObjectId = LADDER_ID;
    this.hud.showInteractionPrompt(LADDER_DISPLAY_NAME, '滾輪旋轉　E放置');
    this.updateLabelFollow();

    // First-frame carry placement bypasses the normal collision-clamped
    // move (updateCarry/clampCarryMove below) — that clamp is only
    // meaningful for CONTINUOUS movement from an already-clear position.
    // Taking the ladder off its OWN wall slot necessarily means the player
    // is facing the wall at that exact moment, so computeCarryTransform's
    // usual "some distance in front of wherever the camera looks" result
    // would place it further INTO the wall, not away from it — a shape-cast
    // whose STARTING pose already overlaps the wall reports zero allowed
    // movement, leaving the ladder stuck flush against it forever
    // afterward too (every later frame's cast starts from that same
    // still-overlapping position). Popping straight to a fixed point
    // pulled away from the wall along its own known outward normal instead
    // — mirrors PickupSystem's own generic pickup, which parents a held
    // item directly into the viewmodel with no physics transition at all —
    // guarantees the FIRST frame already sits safely out in open room
    // space; only subsequent frames (following the camera from there) need
    // the clamp. Not needed when picking up an ALREADY-placed ladder off
    // the floor, since nothing there was ever wall-adjacent to begin with.
    if (wasStored) {
      const initialPos = new THREE.Vector3(LADDER_WALL_SLOT.position.x - 1.5, BACK_AREA.floorY + 1.0, LADDER_WALL_SLOT.position.z);
      const initialQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.placementYaw);
      this.applyCarryTransform(initialPos, initialQuat);
      this.updateLabelFollow();
      this.updatePlacementPreview(initialPos, initialQuat);
    }

    // Now genuinely safe (either the fresh-off-the-wall pop above, or an
    // already-clear floor position) to run the normal clamped carry move,
    // following the camera from wherever this frame's press landed it.
    this.updateCarry(cameraPosition, cameraForward);
  }

  // --- Carry / live placement preview ---

  private computeCarryTransform(cameraPosition: THREE.Vector3, cameraForward: THREE.Vector3): { pos: THREE.Vector3; quat: THREE.Quaternion } | null {
    const flat = new THREE.Vector3(cameraForward.x, 0, cameraForward.z);
    if (flat.lengthSq() < 1e-6) return null;
    flat.normalize();

    const horizExtent = Math.max(CARRY_HALF_EXTENTS.x, CARRY_HALF_EXTENTS.z);
    const forwardDist = Math.max(CARRY_BASE_FORWARD_DIST, MIN_CAMERA_CLEARANCE) + horizExtent;
    const targetX = cameraPosition.x + flat.x * forwardDist;
    const targetZ = cameraPosition.z + flat.z * forwardDist;
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.placementYaw);

    const desiredCenterY = cameraPosition.y - CARRY_DROP_BELOW_EYE;
    const minCenterY = BACK_AREA.floorY + CARRY_MIN_FLOOR_CLEARANCE + CARRY_HALF_EXTENTS.y;
    const maxCenterY = cameraPosition.y + CARRY_MAX_ABOVE_EYE - CARRY_HALF_EXTENTS.y;
    const centerY = THREE.MathUtils.clamp(desiredCenterY, minCenterY, Math.max(minCenterY, maxCenterY));
    // The ladder's own local origin is its BASE (not its bounding-box
    // center) — centerY above describes the desired vertical MIDPOINT of
    // the carried envelope, so the base sits half a standHeight below that.
    const targetY = centerY - CARRY_HALF_EXTENTS.y;

    return { pos: new THREE.Vector3(targetX, targetY, targetZ), quat };
  }

  private clampCarryMove(targetPos: THREE.Vector3, targetQuat: THREE.Quaternion): THREE.Vector3 {
    const oldPos = this.mesh.position;
    const shapeCenter = oldPos.clone().add(new THREE.Vector3(0, CARRY_HALF_EXTENTS.y, 0).applyQuaternion(targetQuat));
    const delta = new THREE.Vector3(targetPos.x - oldPos.x, targetPos.y - oldPos.y, targetPos.z - oldPos.z);
    const allowedFraction = this.physics.castShapeMove(shapeCenter, targetQuat, CARRY_HALF_EXTENTS, delta);
    return new THREE.Vector3(oldPos.x + delta.x * allowedFraction, oldPos.y + delta.y * allowedFraction, oldPos.z + delta.z * allowedFraction);
  }

  private applyCarryTransform(pos: THREE.Vector3, quat: THREE.Quaternion): void {
    this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
    this.body.setNextKinematicRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    this.mesh.position.copy(pos);
    this.mesh.quaternion.copy(quat);
    this.mesh.updateMatrixWorld(true);
  }

  private updateCarry(cameraPosition: THREE.Vector3, cameraForward: THREE.Vector3): void {
    const transform = this.computeCarryTransform(cameraPosition, cameraForward);
    if (!transform) return;
    const clampedPos = this.clampCarryMove(transform.pos, transform.quat);
    if (!Number.isFinite(clampedPos.x) || !Number.isFinite(clampedPos.y) || !Number.isFinite(clampedPos.z)) {
      console.error('[LadderSystem] carry position became non-finite — force-releasing.');
      this.forceReleaseToSafePosition();
      return;
    }
    this.applyCarryTransform(clampedPos, transform.quat);
    this.updateLabelFollow();
    this.updatePlacementPreview(clampedPos, transform.quat);
  }

  private updatePlacementPreview(carryPos: THREE.Vector3, carryQuat: THREE.Quaternion): void {
    const excludeRoots: THREE.Object3D[] = [this.mesh, this.previewMesh];
    this.downRaycaster.set(new THREE.Vector3(carryPos.x, carryPos.y + CARRY_HALF_EXTENTS.y + 3, carryPos.z), new THREE.Vector3(0, -1, 0));
    const hits = this.downRaycaster.intersectObjects(this.scene.children, true).filter((h) => !this.isExcluded(h.object, excludeRoots));
    const supportY = hits.length > 0 ? hits[0].point.y : BACK_AREA.floorY;

    this.placementPos.set(carryPos.x, supportY, carryPos.z);
    this.placementQuat.copy(carryQuat);

    const valid = this.checkPlacementValidity();
    this.previewValid = valid;

    this.previewMesh.visible = true;
    const localCenter = new THREE.Vector3(0, CARRY_HALF_EXTENTS.y, LADDER_TOTAL_DEPTH / 2);
    this.previewMesh.position.copy(this.placementPos).add(localCenter.clone().applyQuaternion(this.placementQuat));
    this.previewMesh.quaternion.copy(this.placementQuat);
    this.previewMesh.scale.set(LADDER_UNFOLDED.width, LADDER_UNFOLDED.standHeight, LADDER_TOTAL_DEPTH);
    const mat = this.previewMesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(valid ? 0x00ff88 : 0xff3333);
    mat.opacity = valid ? 0.28 : 0.35;
  }

  private isExcluded(obj: THREE.Object3D, excludeRoots: THREE.Object3D[]): boolean {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (excludeRoots.includes(cur)) return true;
      cur = cur.parent;
    }
    return false;
  }

  /** Checked against the ladder's REAL footprint (base at placementPos, full
   * width/standHeight/LADDER_TOTAL_DEPTH envelope at the current yaw) — world
   * bounds, then an AABB overlap scan against every other still-visible,
   * not-held interactable (spec: "不可放在載具內、牆內、其他梯子／托盤／大型
   * 物件內"), then a physics shape-cast against static geometry (walls) —
   * the exact three checks pallet-system.ts's own checkPlacementValidity
   * already performs for the same reasons. */
  private checkPlacementValidity(): boolean {
    const cos = Math.abs(Math.cos(this.placementYaw));
    const sin = Math.abs(Math.sin(this.placementYaw));
    const halfW = (LADDER_UNFOLDED.width / 2) * cos + (LADDER_TOTAL_DEPTH / 2) * sin;
    const halfD = (LADDER_UNFOLDED.width / 2) * sin + (LADDER_TOTAL_DEPTH / 2) * cos;
    const halfH = LADDER_UNFOLDED.standHeight / 2;
    const localCenter = new THREE.Vector3(0, halfH, LADDER_TOTAL_DEPTH / 2);
    const center = this.placementPos.clone().add(localCenter.applyQuaternion(this.placementQuat));

    if (center.x - halfW < WORLD_BOUNDS.minX || center.x + halfW > WORLD_BOUNDS.maxX ||
        center.z - halfD < WORLD_BOUNDS.minZ || center.z + halfD > WORLD_BOUNDS.maxZ) return false;

    const eps = 0.02;
    const box = new THREE.Box3(
      new THREE.Vector3(center.x - halfW + eps, center.y - halfH + eps, center.z - halfD + eps),
      new THREE.Vector3(center.x + halfW - eps, center.y + halfH - eps, center.z + halfD - eps)
    );
    for (const [id, obj] of this.interactables) {
      if (id === LADDER_ID || id === LADDER_RACK_ID || obj.isHeld || !obj.mesh.visible) continue;
      const otherBox = new THREE.Box3().setFromObject(obj.mesh);
      if (box.intersectsBox(otherBox)) return false;
    }

    if (this.physics.castShapeAgainstStaticAndBox(center, new THREE.Vector3(halfW - eps, halfH - eps, halfD - eps), this.body)) return false;

    return true;
  }

  tryPlace(): boolean {
    if (this.state !== 'preview') return false;
    if (!this.previewValid) {
      this.hud.showToast('此處無法放置梯子');
      return false;
    }

    const finalPos = this.placementPos.clone();
    const finalQuat = this.placementQuat.clone();
    this.body.setNextKinematicTranslation({ x: finalPos.x, y: finalPos.y, z: finalPos.z });
    this.body.setNextKinematicRotation({ x: finalQuat.x, y: finalQuat.y, z: finalQuat.z, w: finalQuat.w });
    this.mesh.position.copy(finalPos);
    this.mesh.quaternion.copy(finalQuat);
    this.mesh.updateMatrixWorld(true);

    this.state = 'placed';
    this.ladderObj.isHeld = false;
    this.previewMesh.visible = false;
    this.playerData.state = 'empty-handed';
    this.playerData.heldObjectId = null;
    this.hud.hideInteractionPrompt();
    this.updateLabelFollow();
    this.buildWalkableColliders();
    return true;
  }

  /** Builds the walkable staircase as genuinely Fixed colliders at the
   * ladder's CURRENT (just-finalized) placed transform — one per visible
   * front step, one per visible BACK step (spec十: genuinely double-sided,
   * climbable from either side — no more a single blocking-only rear
   * panel), plus the top platform (8+8+1=17 total, spec十's own count),
   * mirroring the visual treads' own local offsets exactly (buildLadder's
   * own unfoldedGroup). Verified directly with a real trusted-input walk
   * test that a KINEMATIC body's colliders do NOT receive the player
   * character controller's autostep/slope-climb treatment (the player got
   * stuck partway up no matter how the steps were sized), while the
   * IDENTICAL geometry as separate Fixed bodies climbs correctly — so the
   * walkable surface has to be its own set of Fixed bodies, rebuilt fresh
   * every time the ladder is placed (never reused from a previous
   * placement — see clearWalkableColliders, called at the start of every
   * pickUp()). Each step's own depth intentionally overlaps its neighbors
   * slightly so there's no gap a foot could catch or fall through
   * between them. */
  private buildWalkableColliders(): void {
    const q = this.mesh.quaternion;
    const apexZ = LADDER_UNFOLDED.frontRun;

    const frontStepDepth = (apexZ / LADDER_STEP_COUNT) * 1.6;
    for (let i = 1; i <= LADDER_STEP_COUNT; i++) {
      const localZ = (i / LADDER_STEP_COUNT) * apexZ;
      const localY = i * LADDER_STEP_HEIGHT - 0.03;
      const world = new THREE.Vector3(0, localY, localZ).applyQuaternion(q).add(this.mesh.position);
      const body = this.physics.createRemovableStaticCuboid(
        world.x, world.y, world.z, q.x, q.y, q.z, q.w,
        LADDER_UNFOLDED.width / 2, 0.03, frontStepDepth / 2
      );
      this.walkableColliderBodies.push(body);
    }

    // Back steps — same per-step collider approach as the front, mirroring
    // buildLadder's own back-tread visual loop exactly (descending from the
    // apex toward the back foot as Z increases).
    const backStepDepth = (LADDER_UNFOLDED.backRun / LADDER_STEP_COUNT) * 1.6;
    for (let i = 1; i <= LADDER_STEP_COUNT; i++) {
      const localZ = apexZ + (i / LADDER_STEP_COUNT) * LADDER_UNFOLDED.backRun;
      const localY = (LADDER_UNFOLDED.standHeight - i * LADDER_STEP_HEIGHT) + 0.03;
      const world = new THREE.Vector3(0, localY, localZ).applyQuaternion(q).add(this.mesh.position);
      const body = this.physics.createRemovableStaticCuboid(
        world.x, world.y, world.z, q.x, q.y, q.z, q.w,
        LADDER_UNFOLDED.width / 2, 0.03, backStepDepth / 2
      );
      this.walkableColliderBodies.push(body);
    }

    const platformLocalY = LADDER_UNFOLDED.standHeight - 0.03;
    const platformLocalZ = apexZ;
    const platformWorld = new THREE.Vector3(0, platformLocalY, platformLocalZ).applyQuaternion(q).add(this.mesh.position);
    const platformBody = this.physics.createRemovableStaticCuboid(
      platformWorld.x, platformWorld.y, platformWorld.z, q.x, q.y, q.z, q.w,
      LADDER_UNFOLDED.width / 2, 0.03, LADDER_UNFOLDED.platformDepth / 2
    );
    this.walkableColliderBodies.push(platformBody);
  }

  private clearWalkableColliders(): void {
    for (const body of this.walkableColliderBodies) this.physics.removeRigidBody(body);
    this.walkableColliderBodies = [];
  }

  // --- Wall rack return ---

  canReturnToRack(): boolean {
    return this.state === 'preview';
  }

  tryReturnToRack(): boolean {
    if (this.state !== 'preview') return false;

    this.body.setNextKinematicTranslation({ x: LADDER_WALL_SLOT.position.x, y: LADDER_WALL_SLOT.position.y, z: LADDER_WALL_SLOT.position.z });
    this.body.setNextKinematicRotation({ x: LADDER_WALL_SLOT.quaternion.x, y: LADDER_WALL_SLOT.quaternion.y, z: LADDER_WALL_SLOT.quaternion.z, w: LADDER_WALL_SLOT.quaternion.w });
    this.mesh.position.copy(LADDER_WALL_SLOT.position);
    this.mesh.quaternion.copy(LADDER_WALL_SLOT.quaternion);
    this.mesh.updateMatrixWorld(true);
    this.physics.setBodyEnabled(this.body, false);

    this.foldedGroup.visible = true;
    this.unfoldedGroup.visible = false;
    this.state = 'stored';
    this.ladderObj.isHeld = false;
    this.previewMesh.visible = false;
    this.placementYaw = 0;
    this.playerData.state = 'empty-handed';
    this.playerData.heldObjectId = null;
    this.hud.hideInteractionPrompt();
    this.updateLabelFollow();
    return true;
  }

  private forceReleaseToSafePosition(): void {
    this.state = 'placed';
    this.ladderObj.isHeld = false;
    this.previewMesh.visible = false;
    const safeY = BACK_AREA.floorY;
    this.mesh.position.set(LADDER_WALL_SLOT.position.x, safeY, BACK_AREA.floorY + 2);
    this.mesh.quaternion.identity();
    this.mesh.updateMatrixWorld(true);
    this.body.setTranslation({ x: this.mesh.position.x, y: safeY, z: this.mesh.position.z }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.placementYaw = 0;
    this.updateLabelFollow();
    if (this.playerData.heldObjectId === LADDER_ID) {
      this.playerData.state = 'empty-handed';
      this.playerData.heldObjectId = null;
    }
    this.hud.hideInteractionPrompt();
  }

  // --- Per-frame update / input ---

  update(cameraPosition: THREE.Vector3, cameraForward: THREE.Vector3): void {
    if (this.state !== 'preview') return;
    this.updateCarry(cameraPosition, cameraForward);
  }

  private onWheel(event: WheelEvent): void {
    if (this.state !== 'preview') return;
    if (Math.abs(event.deltaY) < 1) return;
    const dir = event.deltaY > 0 ? 1 : -1;
    this.placementYaw += dir * LADDER_PLACEMENT_YAW_STEP;
  }
}
