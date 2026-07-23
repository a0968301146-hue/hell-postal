import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsSystem } from './physics-system';
import { InteractableObject, createInteractableObject } from './interactable-object';
import { CargoSystem } from './cargo-system';
import { HUD } from './hud';
import { PALLET_CONFIG } from './daily-flow-data';
import { BACK_AREA, WORLD_BOUNDS } from './logistics-layout-data';
import { createFloatingLabel } from './world-label-system';

const STABLE_THRESHOLD = 0.5; // seconds, organize judgment
const VELOCITY_THRESHOLD = 0.4;
/** How far in front of the camera the pallet's carry position sits — actual
 * carry HEIGHT is resolved per-frame by a downward raycast onto whatever's
 * really below (floor or a docked vehicle's cargo bed), not a fixed offset
 * from eye level (see updateCarry's supportY probe). */
const CARRY_FORWARD_DIST = 1.4;

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
 * A single wooden pallet (spec "貨品外型與比例有更多變化" round section
 * 十一~十九) — now a genuine pickupable InteractableObject integrated into
 * the shared E-key flow (targeted/raycast like any cargo item, picked up
 * via PalletSystem.pickUp() from InteractionSystem's Priority-1 branch —
 * see interaction-system.ts), NOT a second independent input system.
 *
 * Rest-state physics is a KINEMATIC body (same reasoning as DollySystem's
 * platform): immune to being knocked around by cargo landing on it, while
 * still fully collidable — cargo resting on top behaves normally.
 *
 * While held, the pallet does NOT go through PickupSystem's generic hide+
 * viewmodel-clone flow (that flow can't carry a whole GROUP of separate
 * cargo objects along with it) — instead it stays visible in world space,
 * following the camera at a fixed offset, with every cargo item currently
 * resting on it (spec 十二: real support test, not "only touching the
 * side") pinned to it by SAVED LOCAL TRANSFORM (spec 十三) and re-derived
 * from the pallet's current world matrix each frame — the exact same
 * pattern dolly-system.ts already uses for cargo riding a pushed dolly.
 * `playerData.state`/`heldObjectId` are still set normally so the rest of
 * the game's mutual-exclusion checks (dolly push, vehicle buttons, another
 * pickup) keep working automatically (spec 十六).
 */
export class PalletSystem {
  readonly palletId = PALLET_ID;
  topMesh: THREE.Mesh;

  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private cargoSystem: CargoSystem;
  private interactables: Map<string, InteractableObject>;
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
   * cargo's combined bounding box, computed once at pickup (spec 十四: "不
   * 要只檢查托盤底板...可以建立整組暫時Bounds") — reused every frame for
   * both the swept-collision clamp and the placement-validity check. */
  private unionHalfExtents = new THREE.Vector3();
  private unionLocalCenterOffset = new THREE.Vector3();
  previewValid = false;
  private carryPos = new THREE.Vector3();
  private carryQuat = new THREE.Quaternion();
  private downRaycaster = new THREE.Raycaster();

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, cargoSystem: CargoSystem, interactables: Map<string, InteractableObject>,
    hud: HUD, onFirstUse?: () => void, onFirstOrganized?: () => void
  ) {
    this.scene = scene;
    this.physics = physics;
    this.cargoSystem = cargoSystem;
    this.interactables = interactables;
    this.hud = hud;
    this.onFirstUse = onFirstUse;
    this.onFirstOrganized = onFirstOrganized;
    this.homePos = new THREE.Vector3(PALLET_CONFIG.posX, 0, PALLET_CONFIG.posZ);

    this.topMesh = this.build();
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
    // (carry-follow while held, or the end-of-day reset).
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

  update(deltaTime: number, cameraPosition?: THREE.Vector3, cameraForward?: THREE.Vector3): void {
    if (this.isHeld) {
      if (cameraPosition && cameraForward) this.updateCarry(cameraPosition, cameraForward);
      return;
    }
    this.updateOrganizeScan(deltaTime);
  }

  /** Unchanged organize judgment from the previous round — a box/large item
   * resting stably on the pallet's own footprint for >=0.5s gets marked
   * organized (spec十九: persists after being carried away, and整托搬運
   * doesn't re-trigger or lose it since this scan only runs while NOT held,
   * and never touches `organized` false again once true). */
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

  /** True once the player is close enough to target/pick up the pallet —
   * not actually needed for raycasting (the pallet is a normal
   * InteractableObject, InteractionSystem's generic crosshair targeting
   * already finds it), kept only for symmetry/clarity in case something
   * wants a plain proximity check later. */
  get palletObject(): InteractableObject {
    return this.palletObj;
  }

  /** Called by InteractionSystem when the player targets the (unheld)
   * pallet and presses E. Finds every box/large daily-cargo item currently
   * SUPPORTED by the pallet (spec十二: center within the pallet's own
   * footprint, resting at pallet-top height — not just "nearby" or "leaning
   * on the side"), saves each one's transform relative to the pallet,
   * pauses their physics, and switches to world-space camera-follow carry. */
  pickUp(): void {
    if (this.isHeld) return;

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
    this.physics.setBodyEnabled(this.body, false);
    this.isHeld = true;
    this.palletObj.isHeld = true;
  }

  /** Combined pallet+all-pinned-cargo bounding box, in the pallet's OWN
   * local space (center-origin) — computed once at pickup, reused every
   * frame for the carry's swept-collision clamp and placement validity
   * (spec十四: "不要只檢查托盤底板")。 */
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

  /** Each frame while held: move the pallet (world-space, not a viewmodel
   * clone — see class doc comment) to a fixed offset in front of the
   * camera, clamped by a swept shape cast against fixed scene geometry
   * (spec十四: "不可穿過北側牆壁/側牆/地板/大型固定設備") using the union
   * bounds computed at pickup, then re-derive every pinned cargo's world
   * transform from its saved LOCAL transform against the pallet's new
   * world matrix (same pattern dolly-system.ts uses). Also probes a
   * downward ray for a placement-height guess (floor or a docked vehicle's
   * cargo bed — whichever the crosshair-independent carry point currently
   * sits above) and box-overlap-checks it for live placement validity. */
  private updateCarry(cameraPosition: THREE.Vector3, cameraForward: THREE.Vector3): void {
    const flat = new THREE.Vector3(cameraForward.x, 0, cameraForward.z);
    if (flat.lengthSq() < 1e-6) return;
    flat.normalize();

    const oldPos = this.palletObj.mesh.position.clone();
    const targetX = cameraPosition.x + flat.x * CARRY_FORWARD_DIST;
    const targetZ = cameraPosition.z + flat.z * CARRY_FORWARD_DIST;
    const yaw = Math.atan2(flat.x, flat.z);
    const targetQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));

    // Support-height probe: straight down from the intended XZ, ignoring
    // the pallet's own mesh and every pinned cargo mesh, landing on
    // whatever's really there (main floor, or a docked vehicle's cargo bed
    // mesh — both are real scene geometry, see vehicle-system.ts
    // cargoBedTopMesh).
    const excludeRoots: THREE.Object3D[] = [this.palletObj.mesh, ...this.pinned.map(p => p.obj.mesh)];
    this.downRaycaster.set(new THREE.Vector3(targetX, oldPos.y + 3, targetZ), new THREE.Vector3(0, -1, 0));
    const hits = this.downRaycaster.intersectObjects(this.scene.children, true)
      .filter(h => !this.isExcluded(h.object, excludeRoots));
    const supportY = hits.length > 0 ? hits[0].point.y : BACK_AREA.floorY;
    const targetY = supportY + PALLET_CONFIG.height / 2 - this.unionLocalCenterOffset.y + this.unionHalfExtents.y
      - (PALLET_CONFIG.height / 2); // net: pallet bottom rests at supportY when placed; while carried we just track this height directly.

    // Swept collision clamp against fixed geometry (spec十四) — same helper
    // DollySystem's push already uses, given the union bounds' own extent
    // and local center offset (rotated into world space).
    const rotatedOffset = this.unionLocalCenterOffset.clone().applyQuaternion(targetQuat);
    const desiredDeltaX = targetX - oldPos.x;
    const desiredDeltaZ = targetZ - oldPos.z;
    const shapeCenter = new THREE.Vector3(oldPos.x, targetY, oldPos.z).add(rotatedOffset);
    const movement = new THREE.Vector3(desiredDeltaX, 0, desiredDeltaZ);
    const allowedFraction = this.physics.castShapeMove(shapeCenter, targetQuat, this.unionHalfExtents, movement);

    const newX = oldPos.x + desiredDeltaX * allowedFraction;
    const newZ = oldPos.z + desiredDeltaZ * allowedFraction;

    this.carryPos.set(newX, targetY, newZ);
    this.carryQuat.copy(targetQuat);

    this.palletObj.mesh.position.copy(this.carryPos);
    this.palletObj.mesh.quaternion.copy(this.carryQuat);
    this.palletObj.mesh.updateMatrixWorld(true);

    for (const p of this.pinned) {
      const worldPos = p.localPos.clone().applyMatrix4(this.palletObj.mesh.matrixWorld);
      const worldQuat = this.carryQuat.clone().multiply(p.localQuat);
      p.obj.mesh.position.copy(worldPos);
      p.obj.mesh.quaternion.copy(worldQuat);
    }

    this.previewValid = allowedFraction > 0.98 && this.checkPlacementOverlap();
  }

  /** Box3-overlap validity check for the CURRENT carry position (spec:
   * "若位置無效: 不執行放置, 保持手持狀態, 顯示無效放置預覽") — world
   * bounds + overlap against every other interactable (excluding the
   * pallet itself and its own pinned cargo). */
  private checkPlacementOverlap(): boolean {
    const halfW = this.unionHalfExtents.x, halfH = this.unionHalfExtents.y, halfD = this.unionHalfExtents.z;
    const center = this.carryPos.clone().add(this.unionLocalCenterOffset.clone().applyQuaternion(this.carryQuat));

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
   * pallet (spec十一: "再按E放置" — a direct single-press place, not the
   * generic preview-then-left-click flow other cargo uses, since a WHOLE
   * GROUP's live validity is already visible via previewValid every frame).
   * Returns false (stays held) if the current carry position isn't valid. */
  tryPlace(): boolean {
    if (!this.isHeld) return false;
    if (!this.previewValid) {
      this.hud.showToast('此處無法放置整理托盤');
      return false;
    }

    this.physics.setBodyEnabled(this.body, true);
    this.body.setTranslation({ x: this.carryPos.x, y: this.carryPos.y, z: this.carryPos.z }, true);
    this.body.setRotation({ x: this.carryQuat.x, y: this.carryQuat.y, z: this.carryQuat.z, w: this.carryQuat.w }, true);

    for (const p of this.pinned) {
      const obj = p.obj;
      const worldPos = obj.mesh.position.clone();
      const worldQuat = obj.mesh.quaternion.clone();
      obj.isHeld = false;
      if (obj.rigidBody) {
        this.physics.setBodyEnabled(obj.rigidBody, true);
        obj.rigidBody.setTranslation({ x: worldPos.x, y: worldPos.y, z: worldPos.z }, true);
        obj.rigidBody.setRotation({ x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w }, true);
        obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }

    this.pinned = [];
    this.isHeld = false;
    this.palletObj.isHeld = false;
    return true;
  }

  /** End-of-day reset (spec十七/十八) — unconditionally restores the pallet
   * to its home position/rotation, visible and with physics re-enabled,
   * regardless of where it currently is: sitting somewhere in the room,
   * mid-carry (defensively released first), or hidden after riding away
   * with a departed vehicle (VehicleControlSystem sets mesh.visible=false
   * for it instead of destroying it — see finishOneDeparture). Also
   * defensively releases any still-pinned cargo back into the world rather
   * than silently deleting it. */
  resetToStart(): void {
    // Defensive — DailyFlowSystem only calls this once canEndDay is true,
    // which requires empty-handed, but release cleanly (regardless of
    // previewValid — unlike a normal tryPlace() this is a forced reset, not
    // a player-initiated placement) rather than leaving pinned cargo stuck.
    for (const p of this.pinned) {
      const obj = p.obj;
      obj.isHeld = false;
      obj.canPickUp = true;
      if (obj.rigidBody) {
        this.physics.setBodyEnabled(obj.rigidBody, true);
        obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    this.pinned = [];
    this.isHeld = false;
    this.stableTimers.clear();

    this.palletObj.isHeld = false;
    this.palletObj.canPickUp = true;
    this.palletObj.mesh.visible = true;
    this.palletObj.mesh.position.copy(this.homePos);
    this.palletObj.mesh.quaternion.identity();
    this.physics.setBodyEnabled(this.body, true);
    this.body.setTranslation({ x: this.homePos.x, y: this.homePos.y, z: this.homePos.z }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  }
}
