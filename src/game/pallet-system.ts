import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsSystem } from './physics-system';
import { InteractableObject, createInteractableObject, PlayerInteractionData } from './interactable-object';
import { CargoSystem } from './cargo-system';
import { HUD } from './hud';
import { PALLET_CONFIG } from './daily-flow-data';
import { BACK_AREA, WORLD_BOUNDS } from './logistics-layout-data';
import { createFloatingLabel } from './world-label-system';

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

/** Stable id for the one pallet this round — exported so other systems that
 * need to recognize "is this the pallet" (VehicleControlSystem's departure
 * logic, PickupSystem's no-throw guard) can do so with a plain string
 * import instead of a class reference (avoids a circular dependency between
 * pallet-system.ts and vehicle-control-system.ts). */
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
 * SINGLE SOURCE OF TRUTH while held ("Fix pallet pickup and placement
 * state" round): every frame, updateCarry() computes ONE authoritative
 * target transform and writes it to BOTH the kinematic rigid body (via
 * setNextKinematicTranslation/Rotation, so the collider tracks the mesh —
 * spec 二) and the Three.js mesh, from the exact same numbers. Nothing else
 * ever touches obj.mesh.position/quaternion for the pallet or its pinned
 * cargo while isHeld is true — the generic per-frame physics-to-mesh sync
 * loop in game.ts already skips any InteractableObject with isHeld=true.
 *
 * This class also owns `playerData.state`/`heldObjectId` directly for its
 * own pickup/place transitions (rather than InteractionSystem juggling
 * them externally) so an emergency reset (NaN transform, daily reset) can
 * never leave the shared player state pointing at a pallet hold that
 * PalletSystem itself no longer considers active.
 */
export class PalletSystem {
  readonly palletId = PALLET_ID;
  topMesh: THREE.Mesh;

  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private cargoSystem: CargoSystem;
  private interactables: Map<string, InteractableObject>;
  private playerData: PlayerInteractionData;
  private hud: HUD;
  private onFirstUse?: () => void;
  private onFirstOrganized?: () => void;

  private palletObj!: InteractableObject;
  private body!: RAPIER.RigidBody;
  private homePos: THREE.Vector3;

  private stableTimers: Map<string, number> = new Map();
  private hasFiredUse = false;
  private hasFiredOrganized = false;

  isHeld = false;
  private pinned: PinnedCargoEntry[] = [];
  /** Half-extents / local-space center offset of the pallet+all pinned
   * cargo's combined bounding box, computed once at pickup — reused every
   * frame for both the swept-collision clamp and the placement-validity
   * check (spec 十四 from the previous round: "不要只檢查托盤底板"). */
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
   * but still non-colliding (spec 九-7). */
  private pendingCargoRestore: InteractableObject[] = [];

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, cargoSystem: CargoSystem, interactables: Map<string, InteractableObject>,
    playerData: PlayerInteractionData, hud: HUD, onFirstUse?: () => void, onFirstOrganized?: () => void
  ) {
    this.scene = scene;
    this.physics = physics;
    this.cargoSystem = cargoSystem;
    this.interactables = interactables;
    this.playerData = playerData;
    this.hud = hud;
    this.onFirstUse = onFirstUse;
    this.onFirstOrganized = onFirstOrganized;
    this.homePos = new THREE.Vector3(PALLET_CONFIG.posX, 0, PALLET_CONFIG.posZ);

    this.topMesh = this.build();
    this.previewMesh = this.buildPreviewMesh();
  }

  private build(): THREE.Mesh {
    const { posX, posZ, width, depth, height } = PALLET_CONFIG;
    const floorY = BACK_AREA.floorY;
    const centerY = floorY + height / 2;
    this.homePos.y = centerY;

    const woodMat = new THREE.MeshStandardMaterial({ color: 0xa87a42 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), woodMat);
    mesh.position.set(posX, centerY, posZ);
    this.scene.add(mesh);
    mesh.userData.surfaceType = 'pallet-top';

    // A few raised slat lines across the top — purely cosmetic.
    const slatMat = new THREE.MeshStandardMaterial({ color: 0x8a6234 });
    for (let i = -1; i <= 1; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(width * 0.9, 0.02, depth * 0.12), slatMat);
      slat.position.set(posX, centerY + height / 2 + 0.01, posZ + i * depth * 0.3);
      this.scene.add(slat);
    }

    const label = createFloatingLabel('整理托盤', { width: 0.7, bg: 'rgba(30,25,15,0.75)' });
    label.position.set(posX, centerY + 0.9, posZ);
    this.scene.add(label);

    // Kinematic body — immune to being knocked/tipped by cargo landing on
    // it while parked, only moves when this system explicitly drives it
    // (carry-follow while held, or the end-of-day reset). Stays ENABLED at
    // all times (including while held) so the collider always tracks the
    // mesh 1:1 — see class doc comment on "single source of truth".
    const bodyDesc = this.physics.createKinematicBodyDesc(posX, centerY, posZ);
    const body = this.physics.createKinematicBody(bodyDesc);
    this.physics.addColliderToBody(body, 0, 0, 0, width / 2, height / 2, depth / 2);
    this.body = body;

    const obj = createInteractableObject(this.palletId, '整理托盤', mesh, width, height, depth);
    obj.rigidBody = body;
    // `noThrow` — read by pickup-system.ts's startCharge() guard (spec
    // 十一: "托盤不需要支援Q蓄力投擲...不得讓整托貨物高速飛散").
    mesh.userData.noThrow = true;
    this.interactables.set(this.palletId, obj);
    this.palletObj = obj;
    return mesh;
  }

  /** Semi-transparent ghost representing the pallet+cargo union bounds at
   * the current placement target (spec 八) — green when valid, red when
   * not. Never raycast-hittable, never registered as an InteractableObject,
   * no physics body, so it can never be picked up or block placement of
   * itself. */
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

  update(deltaTime: number, cameraPosition?: THREE.Vector3, cameraForward?: THREE.Vector3): void {
    if (this.pendingCargoRestore.length > 0) {
      for (const obj of this.pendingCargoRestore) {
        if (obj.rigidBody) this.physics.setBodyEnabled(obj.rigidBody, true);
      }
      this.pendingCargoRestore = [];
    }

    if (this.isHeld) {
      if (cameraPosition && cameraForward) this.updateCarry(cameraPosition, cameraForward);
      return;
    }
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
   * SUPPORTED by the pallet (center within the pallet's own footprint,
   * resting at pallet-top height — not just "nearby" or "leaning on the
   * side"), saves each one's transform relative to the pallet, pauses their
   * physics, and switches to world-space camera-follow carry — positioning
   * it in front of the player on this very first held frame (spec 三-9). */
  pickUp(cameraPosition: THREE.Vector3, cameraForward: THREE.Vector3): void {
    if (this.isHeld) return;
    if (this.playerData.state !== 'empty-handed') return;

    this.palletObj.mesh.updateMatrixWorld(true);
    const matInv = new THREE.Matrix4().copy(this.palletObj.mesh.matrixWorld).invert();
    const quatInv = this.palletObj.mesh.quaternion.clone().invert();

    const { posX, posZ, width, depth, height, detectHeight } = PALLET_CONFIG;
    const floorY = BACK_AREA.floorY;
    const topY = floorY + height;
    const innerHW = width / 2;
    const innerHD = depth / 2;

    this.pinned = [];
    for (const [id, obj] of this.interactables) {
      if (id === this.palletId) continue;
      if (obj.isHeld || !obj.mesh.visible) continue;
      const data = this.cargoSystem.getCargoData(id);
      if (!data || (data.shapeType !== 'box' && data.shapeType !== 'large')) continue;

      const p = obj.mesh.position;
      const supported =
        p.x >= posX - innerHW && p.x <= posX + innerHW &&
        p.z >= posZ - innerHD && p.z <= posZ + innerHD &&
        p.y >= topY - 0.05 && p.y <= topY + detectHeight;
      if (!supported) continue;

      const localPos = obj.mesh.position.clone().applyMatrix4(matInv);
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
    this.hud.showInteractionPrompt('整理托盤', 'E：放置整理托盤');

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
    const yaw = Math.atan2(flat.x, flat.z);
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));

    // THIS is the height computation that was the actual bug this round
    // fixes: the previous version put the carried pallet at essentially its
    // normal RESTING (floor-touching) height every frame — even while just
    // walking around holding it — which made the swept-collision shape
    // below start every single frame already touching/embedded in the
    // floor's own static collider. Rapier's castShape reports an immediate
    // time-of-impact (~0) for a shape that begins in contact, so
    // castShapeMove() returned an allowed-movement fraction of 0 on every
    // frame, freezing X/Z movement completely regardless of camera
    // position — the pallet LOOKED stuck on the ground even though
    // updateCarry() was genuinely running every frame and computing a
    // nonzero desired delta. The fix: keep the WALKING height clear of the
    // floor at all times; the floor-touching height is only ever computed
    // separately, for the placement PREVIEW (see updatePlacementPreview).
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
   * dolly-system.ts's push already uses. Now that the carry height is
   * always clear of the floor (see computeCarryTransform), this correctly
   * blocks movement into walls without ever self-blocking against the
   * floor the pallet isn't touching anymore. */
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
   * collider tracks the mesh 1:1 — spec 二) and the mesh itself, from the
   * exact same pos/quat. This is the ONLY place the pallet's transform is
   * ever written while held. */
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

    this.updatePlacementPreview(clampedPos, transform.quat);
  }

  /** Computes where the pallet would actually LAND if placed right now
   * (floor/vehicle-bed height under the current carry XZ, via a downward
   * raycast — distinct from the walking carry height above), checks its
   * validity, and updates the ghost preview mesh (spec 八). */
  private updatePlacementPreview(carryPos: THREE.Vector3, carryQuat: THREE.Quaternion): void {
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
   * isHeld/invisible; still blocks against walls (via the carry clamp
   * above already having limited how far the target can be), world bounds,
   * and any other real, resting object (spec 六). */
  private checkPlacementValidity(): boolean {
    const halfW = this.unionHalfExtents.x, halfH = this.unionHalfExtents.y, halfD = this.unionHalfExtents.z;
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
   * so the player can walk somewhere else and press E again — it can never
   * get permanently stuck (spec 十). */
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
      obj.isHeld = false;
      if (obj.rigidBody) {
        obj.rigidBody.setTranslation({ x: worldPos.x, y: worldPos.y, z: worldPos.z }, true);
        obj.rigidBody.setRotation({ x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w }, true);
        obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        // Collider re-enable is deferred one physics step — see
        // pendingCargoRestore's doc comment (spec 九-7).
        this.pendingCargoRestore.push(obj);
      }
    }

    this.pinned = [];
    this.isHeld = false;
    this.palletObj.isHeld = false;
    this.previewMesh.visible = false;
    this.playerData.state = 'empty-handed';
    this.playerData.heldObjectId = null;
    this.hud.hideInteractionPrompt();
    return true;
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
    this.isHeld = false;
    this.palletObj.isHeld = false;
    this.previewMesh.visible = false;

    this.palletObj.mesh.position.copy(this.homePos);
    this.palletObj.mesh.quaternion.identity();
    this.body.setTranslation({ x: this.homePos.x, y: this.homePos.y, z: this.homePos.z }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);

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
   * points at the pallet — spec 十一: "每日重置時必須強制清除托盤手持狀
   * 態"), or hidden after riding away with a departed vehicle
   * (VehicleControlSystem sets mesh.visible=false for it instead of
   * destroying it — see finishOneDeparture). */
  resetToStart(): void {
    this.forceReleaseToSafePosition();
    this.stableTimers.clear();
    this.palletObj.canPickUp = true;
    this.palletObj.mesh.visible = true;
  }
}
