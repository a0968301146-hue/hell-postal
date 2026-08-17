import * as THREE from 'three';
import { InteractableObject } from '../../shared/types/interactable';
import { PlayerInteractionData } from '../../core/game-state';
import { SCENE_CONFIG, WORLD_BOUNDS } from '../world-layout';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { HUD } from '../hud';
import { ENVELOPE_STACK_HELD_ID } from '../mail/envelope-stack-system';
import { HeldItemView } from './held-item-view';
import { ContainerContentTransfer } from './container-content-transfer';
import { HeldItemAccess } from './pickup-hooks';

/** "Fix cargo placement on pallet surface" round spec三: how far a placed
 * item's rotated enclosing footprint may hang past the supporting pallet's
 * own edge and still be allowed ("小幅貼近邊緣可允許") — see
 * validatePlacement's pallet-containment check. */
const PALLET_EDGE_TOLERANCE = 0.12;

/** "Pickup system 架構整理" round Phase 2 — "玩家正在把目前持有物品放在哪
 * 裡／是否有效／是否正在蓄力投擲", pulled out of PickupSystem (spec: 一個檔
 * 案負責一個清楚的Gameplay Responsibility). Owns the FULL placement-preview
 * AND charge/throw lifecycle — the user's own spec groups these together as
 * one "Placement Preview / Throw" responsibility, not two, since both are
 * about "what happens to the currently-held item before it leaves the
 * player's hands", sharing the same raycast/preview-mesh/collision-check
 * machinery.
 *
 * Deliberately reads playerData/interactables directly (the SAME shared
 * primitives PickupSystem itself reads, not a reference TO PickupSystem —
 * every other system in this codebase that needs "what's the player
 * holding" already reads playerData.heldObjectId + interactables.get(id)
 * itself, this is no different) — and reaches back into PickupSystem's own
 * core held-item state ONLY through the narrow HeldItemAccess interface
 * (spec: "不要讓PlacementPreview直接依賴整個PickupSystem").
 *
 * Unity/C# 對應：PlacementPreview（一個 gameplay component，涉及 Raycast／
 * Placement／Throw charge／Physics／Preview，不是單純 UI helper），
 * PlayerPickupController 持有參考並委派呼叫。 */
export class PlacementPreview {
  private previewMesh: THREE.Mesh | null = null;
  private previewValid = false;
  private placementRaycaster: THREE.Raycaster;
  /** True while the current placement preview is resting on a lost-found
   * cabinet cell's own shelf (`userData.lostFoundShelf`, set by
   * lost-found-cabinet-system.ts — "Fix hollow lost found cabinet
   * placement" round). Drives the "E 放入失物" prompt/confirm — every other
   * placement surface (floor, tables, pallet, cargo) is untouched, still
   * confirmed by left-click only, exactly as before. */
  private previewIsLostFoundShelf = false;
  /** "Add placement rotation and pallet cargo straps" round spec一: manual
   * yaw offset (radians, world-Y-only) accumulated 15° per wheel notch
   * while `state === 'placement-preview'`. Reset to 0 on cancel/confirm/
   * entering a fresh preview (spec一: "取消放置、換物品或成功放下後，清除本
   * 次placementYaw"). */
  private placementYaw = 0;
  /** "Fix cargo placement on pallet surface" round spec五: set true for the
   * one frame updatePreview finds the aimed-at support surface is an
   * already rope-bound pallet — confirm() checks this FIRST (ahead of the
   * generic previewValid gate) so it can show the specific "請先解除固定繩"
   * toast instead of silently doing nothing. */
  private previewBlockedByBoundPallet = false;
  private additionalSurfaces: THREE.Object3D[] = [];

  // Charge/throw
  private isCharging = false;
  private chargeTime = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private worldScene: THREE.Scene,
    private playerData: PlayerInteractionData,
    private interactables: Map<string, InteractableObject>,
    private physics: PhysicsSystem,
    private hud: HUD,
    private floor: THREE.Mesh,
    private heldItemView: HeldItemView,
    private containerContentTransfer: ContainerContentTransfer,
    private heldItemAccess: HeldItemAccess
  ) {
    this.placementRaycaster = new THREE.Raycaster();
  }

  get isPreviewValid(): boolean {
    return this.previewValid;
  }
  get isLostFoundShelfTarget(): boolean {
    return this.previewIsLostFoundShelf;
  }

  addSurface(surface: THREE.Object3D): void {
    this.additionalSurfaces.push(surface);
  }

  /** For surfaces that come and go, e.g. a vehicle's cargo bed while docked. */
  removeSurface(surface: THREE.Object3D): void {
    const i = this.additionalSurfaces.indexOf(surface);
    if (i !== -1) this.additionalSurfaces.splice(i, 1);
  }

  /** Driven by PickupSystem's own onWheel — Input stays in pickup-system.ts
   * per spec, this is the narrow write access it needs into placementYaw. */
  rotateYaw(deltaRadians: number): void {
    this.placementYaw += deltaRadians;
  }

  get chargeRatio(): number {
    if (!this.isCharging) return 0;
    return Math.min(this.chargeTime / SCENE_CONFIG.maxChargeTime, 1);
  }

  // --- PLACEMENT ---
  enter(): void {
    if (this.playerData.state !== 'holding-item') return;
    if (!this.playerData.heldObjectId) return;
    this.cancelCharge();

    const obj = this.interactables.get(this.playerData.heldObjectId);
    if (!obj) return;

    // Create preview
    const geo = obj.mesh.geometry.clone();
    const previewMat = new THREE.MeshStandardMaterial({
      color: 0x00ff00, transparent: true, opacity: 0.35, depthWrite: false,
    });
    this.previewMesh = new THREE.Mesh(geo, previewMat);
    this.worldScene.add(this.previewMesh);

    // "Add placement rotation and pallet cargo straps" round spec一: a
    // fresh preview always starts unrotated — cleared again on cancel/
    // confirm below, this is just the "entering a NEW preview" reset.
    this.placementYaw = 0;
    this.playerData.state = 'placement-preview';
  }

  cancel(): void {
    if (this.playerData.state !== 'placement-preview') return;
    if (!this.playerData.heldObjectId) return;

    const obj = this.interactables.get(this.playerData.heldObjectId);
    if (!obj) return;

    this.removePreview();
    this.placementYaw = 0;
    this.playerData.state = 'holding-item';
    this.hud.showInteractionPrompt(obj.displayName, this.holdActionHintText());
  }

  confirm(): void {
    if (this.playerData.state !== 'placement-preview') return;
    // "Fix cargo placement on pallet surface" round spec五: checked ahead of
    // the generic previewValid gate below so the player gets the specific
    // reason ("請先解除固定繩") instead of the placement silently no-oping.
    if (this.previewBlockedByBoundPallet) {
      this.hud.showToast('請先解除固定繩');
      return;
    }
    if (!this.previewValid || !this.previewMesh) return;
    if (!this.playerData.heldObjectId) return;

    const obj = this.interactables.get(this.playerData.heldObjectId);
    if (!obj) return;

    const pos = this.previewMesh.position.clone();
    // Only add epsilon for objects with colliders that might penetrate
    if (obj.collider) {
      pos.y += 0.015;
    }

    // Re-enable world mesh. Roller cargo (spec "每日貨品清空核心流程" 十一)
    // rests lying on its side, not identity rotation like every other
    // object — see cargo-system.ts spawnDailyRoller for the same tip quaternion.
    const isRoller = obj.mesh.userData.shapeType === 'roller';
    const rollerQuat = isRoller ? new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)) : null;
    // "Add placement rotation and pallet cargo straps" round spec一: the
    // manual wheel-yaw the preview was showing becomes the ACTUAL placed
    // rotation — applied on top of the roller's own tip (never replacing
    // it), so "放下後方向與投影一致" holds for rollers too.
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.placementYaw);
    const finalQuat = rollerQuat ? yawQuat.clone().multiply(rollerQuat) : yawQuat;
    obj.mesh.position.copy(pos);
    obj.mesh.quaternion.copy(finalQuat);
    obj.mesh.visible = true;

    // Re-enable physics (same order as throw: enable FIRST, then set position)
    if (obj.rigidBody) {
      // For bottom-origin containers, rigid body center is at pos.y + height/2
      const isBottomOrigin = obj.mesh.userData.bottomOrigin || obj.mesh.userData.crateId;
      const bodyY = isBottomOrigin ? pos.y + obj.height / 2 : pos.y;
      this.physics.setBodyEnabled(obj.rigidBody, true);
      obj.rigidBody.setTranslation({ x: pos.x, y: bodyY, z: pos.z }, true);
      obj.rigidBody.setRotation({ x: finalQuat.x, y: finalQuat.y, z: finalQuat.z, w: finalQuat.w }, true);
      obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    this.removePreview();
    this.placementYaw = 0;

    // Restore carried envelopes if this is a container
    const isContainer = obj.mesh.userData.sortingBoxId || obj.mesh.userData.crateId;
    if (isContainer && this.containerContentTransfer.hasCarriedContents) {
      // Update container matrixWorld before restoring contents
      obj.mesh.updateMatrixWorld(true);
      this.containerContentTransfer.restore(obj);
    }
    // Mail box: unparent contained envelopes and restore their own physics
    // at the box's final placed transform, near-zero velocity so they settle
    // naturally (spec四).
    const mailBoxHooks = this.heldItemAccess.getMailBoxHooks();
    if (mailBoxHooks?.isMailBox(obj)) {
      mailBoxHooks.restoreAfterPlacement(obj, new THREE.Vector3(0, 0, 0));
    }

    obj.isHeld = false;
    obj.canPickUp = true;
    this.heldItemAccess.releaseTopHeldItem();
  }

  // --- THROW ---
  startCharge(): void {
    if (this.playerData.state !== 'holding-item') return;
    // "Add envelope stacks and expand pallet inventory" round — an envelope
    // stack's own Q-throw is entirely owned by EnvelopeStackSystem's own
    // dedicated handling (spec四), never this generic path: unlike the
    // ladder/pallet's own world-space carry (whose heldObjectId always
    // names a REAL registered interactable, so getActiveHeldItem() below
    // would actually resolve one), the stack's sentinel id never does,
    // which already makes this path a silent no-op on release — but
    // without this early bail it would still show a live, dangling charge
    // bar the whole time Q is held for nothing, which reads as a real bug.
    if (this.playerData.heldObjectId === ENVELOPE_STACK_HELD_ID) return;
    // Generic opt-out for held objects that must never be thrown (spec
    // "貨品外型與比例有更多變化" round 十一: the sorting pallet — throwing a
    // whole loaded pallet would fling every pinned cargo item with it).
    // Checked via a plain mesh.userData flag rather than an id/type check so
    // any future non-throwable held object can opt in the same way — but as
    // of "Fix cargo throwing and rebalance daily manifest" round一, cargo
    // itself never sets this flag anymore (see cargo-system.ts spawnDailyBox/
    // spawnDailyRoller — every pickupable cargo item is throwable, spec一:
    // "所有可拾取貨物都可以Q丟出"), so in practice this now only ever
    // matches the pallet, and the toast text below is correct ("若
    // activeHeldItem確實是托盤，才顯示「整理托盤無法投擲」").
    const heldObj = this.heldItemAccess.getActiveHeldItem();
    if (heldObj?.mesh.userData.noThrow) {
      this.hud.showToast('整理托盤無法投擲');
      return;
    }
    this.isCharging = true;
    this.chargeTime = 0;
  }

  cancelCharge(): void {
    this.isCharging = false;
    this.chargeTime = 0;
    // Reset ONLY the top-of-stack viewmodel's position — that's the only
    // one charging/shaking ever touches (see updateChargeShake below);
    // every other held item's viewmodel stays exactly where its own slot
    // offset put it.
    const topMesh = this.heldItemView.topMesh;
    const topBase = this.heldItemView.topBase;
    if (topMesh && topBase) {
      topMesh.position.copy(topBase);
      topMesh.rotation.set(0, 0, 0);
    }
  }

  executeThrow(): void {
    if (this.playerData.state !== 'holding-item') { this.cancelCharge(); return; }
    // Same single source of truth as startCharge()'s own guard (spec一) —
    // never re-reads playerData.heldObjectId directly here, so a held
    // pallet vs. a held cargo item can never diverge between the toast
    // check and the actual throw.
    const obj = this.heldItemAccess.getActiveHeldItem();
    if (!obj) { this.cancelCharge(); return; }

    const ratio = this.chargeRatio;
    this.isCharging = false;
    this.chargeTime = 0;

    // Calculate throw direction
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y += 0.15; // slight upward angle
    dir.normalize();

    // Find safe spawn position
    const spawnDist = 1.0 + Math.max(obj.width, obj.depth) * 0.5;
    const spawnPos = this.camera.position.clone().add(dir.clone().multiplyScalar(spawnDist));
    spawnPos.y = Math.max(spawnPos.y, obj.height / 2 + 0.1);

    // Check if spawn position is valid (simple check)
    const halfExtents = new THREE.Vector3(obj.width / 2, obj.height / 2, obj.depth / 2);
    if (this.physics.castShape(spawnPos, halfExtents)) {
      // Space blocked - don't throw
      this.hud.showTooFar(); // reuse as "space blocked" indicator
      return;
    }

    // Place box in world. Roller cargo keeps its on-side tip instead of
    // resetting to identity — see confirm()'s isRoller comment above.
    const isThrownRoller = obj.mesh.userData.shapeType === 'roller';
    const throwRollerQuat = isThrownRoller ? new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)) : null;
    obj.mesh.position.copy(spawnPos);
    if (throwRollerQuat) obj.mesh.quaternion.copy(throwRollerQuat);
    else obj.mesh.rotation.set(0, 0, 0);
    obj.mesh.visible = true;

    const palletThrowHooks = this.heldItemAccess.getPalletThrowHooks();
    const mailBoxHooks = this.heldItemAccess.getMailBoxHooks();

    // Re-enable physics
    if (obj.rigidBody) {
      this.physics.setBodyEnabled(obj.rigidBody, true);
      // The pallet's own rigid body is PERMANENTLY kinematic while parked/
      // carried (see pallet-system.ts) — kinematic bodies silently ignore
      // every setLinvel/applyImpulse call below, so it must be converted to
      // a real dynamic body (and, if rope-bound, jointed to its cargo)
      // BEFORE any of that happens (spec三: "托盤成為dynamic物理物件").
      if (palletThrowHooks?.isPallet(obj)) palletThrowHooks.prepareForThrow(obj);
      obj.rigidBody.setTranslation({ x: spawnPos.x, y: spawnPos.y, z: spawnPos.z }, true);
      obj.rigidBody.setRotation(throwRollerQuat ?? { x: 0, y: 0, z: 0, w: 1 }, true);
      obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

      // Apply impulse — large/live cargo gets a reduced (never zero) throw
      // speed (spec一: "大型與活物可以降低投擲速度，但不可完全禁止"). Impulse
      // is already scaled by the object's own mass just below, which cancels
      // out of the resulting velocity (impulse/mass) — so without this
      // explicit multiplier, a heavy live cage would fly exactly as fast as
      // a light box once charge ratio is equal; this multiplier is the only
      // thing that actually slows it down.
      const isHeavyOrLiveCargo = obj.mesh.userData.shapeType === 'large' || obj.mesh.userData.shapeType === 'cage';
      const throwSpeedMultiplier = isHeavyOrLiveCargo ? 0.5 : 1;
      const impulseStrength = (SCENE_CONFIG.minThrowImpulse + ratio * (SCENE_CONFIG.maxThrowImpulse - SCENE_CONFIG.minThrowImpulse)) * throwSpeedMultiplier;
      const mass = obj.rigidBody.mass();
      const impulse = dir.clone().multiplyScalar(impulseStrength * mass);
      obj.rigidBody.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);

      // Small angular impulse for rotation
      obj.rigidBody.applyTorqueImpulse({ x: ratio * 0.5, y: 0, z: ratio * -0.3 }, true);

      // Hand the pallet's ACTUAL post-impulse velocity to any cargo it's
      // taking with it (rope-bound, or just-released unbound cargo — see
      // pallet-system.ts's own onThrown) — read AFTER the impulse/torque
      // above, never the pre-impulse zero (spec七: "Cargo繼承托盤的線速度與
      // 角速度").
      if (palletThrowHooks?.isPallet(obj)) {
        const lv = obj.rigidBody.linvel();
        const av = obj.rigidBody.angvel();
        palletThrowHooks.onThrown(obj, new THREE.Vector3(lv.x, lv.y, lv.z), new THREE.Vector3(av.x, av.y, av.z));
      }
    }

    // Restore carried envelopes if this is a container
    const isContainer = obj.mesh.userData.sortingBoxId || obj.mesh.userData.crateId;
    if (isContainer && this.containerContentTransfer.hasCarriedContents) {
      obj.mesh.updateMatrixWorld(true);
      this.containerContentTransfer.restoreWithVelocity(obj, dir, ratio);
    }
    // Mail box: unparent contents and restore their physics IMMEDIATELY at
    // throw time (spec五: "在丟出的瞬間就要恢復物理，而非等箱子落地後才處
    // 理"), inheriting the box's own ACTUAL post-impulse velocity — read
    // AFTER applyImpulse/applyTorqueImpulse above, not the pre-impulse zero.
    if (mailBoxHooks?.isMailBox(obj) && obj.rigidBody) {
      obj.mesh.updateMatrixWorld(true);
      const boxLinvel = obj.rigidBody.linvel();
      const boxAngvel = obj.rigidBody.angvel();
      mailBoxHooks.restoreForThrow(
        obj,
        new THREE.Vector3(boxLinvel.x, boxLinvel.y, boxLinvel.z),
        new THREE.Vector3(boxAngvel.x, boxAngvel.y, boxAngvel.z)
      );
    }

    obj.isHeld = false;
    this.heldItemAccess.releaseTopHeldItem();
    this.hud.hideChargeBar();
  }

  /** Must be called unconditionally every frame while charging — mirrors
   * every other self-guarding system in this codebase. PickupSystem's own
   * update() calls this only while isCharging && holding-item, matching the
   * original inlined behavior exactly. */
  tickCharge(deltaTime: number): void {
    this.chargeTime = Math.min(this.chargeTime + deltaTime, SCENE_CONFIG.maxChargeTime);
    this.hud.showChargeBar(this.chargeRatio);
    this.updateChargeShake();
  }

  get isChargingThrow(): boolean {
    return this.isCharging;
  }

  updatePreview(): void {
    if (this.playerData.state !== 'placement-preview') return;
    if (!this.previewMesh || !this.playerData.heldObjectId) return;

    const obj = this.interactables.get(this.playerData.heldObjectId);
    if (!obj) return;

    this.previewIsLostFoundShelf = false;
    this.previewBlockedByBoundPallet = false;

    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    this.placementRaycaster.set(this.camera.position, direction);

    // For thin objects (envelopes), FIRST check interior planes with highest priority
    const isEnvelope = obj.height <= 0.05;
    if (isEnvelope) {
      const interiorPlanes = this.additionalSurfaces.filter(s =>
        s.userData && (s.userData.interiorPlane || s.userData.surfaceType === 'container-interior')
      );
      if (interiorPlanes.length > 0) {
        const interiorHits = this.placementRaycaster.intersectObjects(interiorPlanes, false);
        if (interiorHits.length > 0 && interiorHits[0].distance <= SCENE_CONFIG.interactionDistance + 2) {
          const hit = interiorHits[0];
          // Use hit point directly — the plane IS at the correct interior height
          const previewY = hit.point.y + obj.height / 2 + 0.01;
          this.previewMesh.position.set(hit.point.x, previewY, hit.point.z);
          this.previewMesh.rotation.set(0, this.placementYaw, 0);
          this.previewMesh.visible = true;
          this.previewValid = true; // Inside container is always valid
          const mat = this.previewMesh.material as THREE.MeshStandardMaterial;
          mat.color.setHex(0x00ff00);
          this.hud.showPlacementPrompt(true);
          return;
        }
      }
    }

    // Normal surface detection (floor, tables, box tops)
    const surfaces: THREE.Object3D[] = [this.floor];
    // Only add non-interior additional surfaces
    for (const s of this.additionalSurfaces) {
      if (!s.userData.interiorPlane && !s.userData.surfaceType) {
        surfaces.push(s);
      } else if (s.userData.surfaceType === 'stamp-table' || s.userData.surfaceType === 'envelope-table' || s.userData.surfaceType === 'cargo-ramp' || s.userData.surfaceType === 'pallet-top') {
        surfaces.push(s);
      }
    }
    for (const other of this.interactables.values()) {
      if (other.isHeld || other.id === obj.id || !other.mesh.visible) continue;
      surfaces.push(other.mesh);
    }

    const intersects = this.placementRaycaster.intersectObjects(surfaces, true);

    if (intersects.length === 0) {
      this.previewMesh.visible = false;
      this.previewValid = false;
      this.hud.showPlacementPrompt(false);
      return;
    }

    const hit = intersects[0];
    // "Fix hollow lost found cabinet placement" round: recognize a
    // lost-found cabinet cell's own shelf specifically (see
    // lost-found-cabinet-system.ts's `userData.lostFoundShelf` tag) so the
    // prompt/confirm-input below can special-case it — every other surface
    // (floor, tables, pallet, cargo) leaves this false, unaffected.
    this.previewIsLostFoundShelf = !!hit.object.userData.lostFoundShelf;

    // "Fix cargo placement on pallet surface" round spec二/五: identify the
    // pallet as the CURRENTLY-HIT support (via its own 'pallet-top' tag —
    // see pallet-system.ts build()) so it can be (a) excluded from blocking
    // its own placement in validatePlacement, and (b) checked for an
    // already-bound state that should refuse new cargo outright.
    let supportPalletObj: InteractableObject | null = null;
    if (hit.object.userData.surfaceType === 'pallet-top') {
      for (const other of this.interactables.values()) {
        // The raycast hit is often one of the pallet's own decorative slat
        // children (tagged the same way, see pallet-system.ts build()),
        // not the base board mesh itself — match either.
        if (other.mesh === hit.object || hit.object.parent === other.mesh) { supportPalletObj = other; break; }
      }
    }
    const palletThrowHooks = this.heldItemAccess.getPalletThrowHooks();
    this.previewBlockedByBoundPallet = !!(
      supportPalletObj && palletThrowHooks?.isPalletRopeBound(supportPalletObj)
    );

    let worldNormal = new THREE.Vector3(0, 1, 0);
    if (hit.face) {
      worldNormal = hit.face.normal.clone();
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
      worldNormal.applyMatrix3(normalMatrix).normalize();
    }

    if (worldNormal.y < 0.9) {
      this.previewMesh.visible = false;
      this.previewValid = false;
      this.hud.showPlacementPrompt(false);
      return;
    }

    // Calculate Y from support
    let supportY = hit.point.y;
    if (hit.object !== this.floor && !hit.object.userData.interiorPlane && !hit.object.userData.surfaceType) {
      const box = new THREE.Box3().setFromObject(hit.object);
      supportY = box.max.y;
    }

    // For bottom-origin containers, don't add height/2
    const isBottomOrigin = obj.mesh.userData.bottomOrigin || obj.mesh.userData.crateId;
    const previewY = isBottomOrigin ? supportY + 0.005 : supportY + obj.height / 2;
    this.previewMesh.position.set(hit.point.x, previewY, hit.point.z);
    this.previewMesh.rotation.set(0, this.placementYaw, 0);
    this.previewMesh.visible = true;

    this.previewValid = this.previewBlockedByBoundPallet
      ? false
      : this.validatePlacement(this.previewMesh.position, obj, supportPalletObj);
    const mat = this.previewMesh.material as THREE.MeshStandardMaterial;
    mat.color.setHex(this.previewValid ? 0x00ff00 : 0xff0000);
    // "Fix hollow lost found cabinet placement" round 二: a dedicated
    // "E 放入失物" prompt while aiming at an empty cabinet cell — every
    // other placement target keeps the existing left-click prompt
    // unchanged (spec: 不要修改貨物與載具).
    if (this.previewIsLostFoundShelf) {
      this.hud.showInteractionPrompt('失物收納格', this.previewValid ? 'E 放入失物' : '此格已被佔用或空間不足');
    } else {
      this.hud.showPlacementPrompt(this.previewValid);
    }
  }

  private validatePlacement(position: THREE.Vector3, obj: InteractableObject, supportObj?: InteractableObject | null): boolean {
    const rawHalfW = obj.width / 2;
    const halfH = obj.height / 2;
    const rawHalfD = obj.depth / 2;
    // "Add placement rotation and pallet cargo straps" round spec一: the
    // collision check must account for the preview's own yaw too, not just
    // its visual mesh — rather than building a genuine rotated-OBB check
    // (this codebase's placement/collision math is AABB-only throughout),
    // this uses the standard enclosing-AABB of the yawed rectangle, which
    // is never SMALLER than the true rotated footprint (so it can only ever
    // be equally or more conservative, never permit an actual overlap).
    const cos = Math.abs(Math.cos(this.placementYaw));
    const sin = Math.abs(Math.sin(this.placementYaw));
    const halfW = rawHalfW * cos + rawHalfD * sin;
    const halfD = rawHalfW * sin + rawHalfD * cos;

    // World bounds (see logistics-layout-data.ts — the playable area is no
    // longer a single room centered at the origin, so this is a min/max box).
    if (position.x - halfW < WORLD_BOUNDS.minX || position.x + halfW > WORLD_BOUNDS.maxX ||
        position.z - halfD < WORLD_BOUNDS.minZ || position.z + halfD > WORLD_BOUNDS.maxZ) return false;

    // "Fix cargo placement on pallet surface" round spec三: since the
    // supporting pallet is now excluded from the generic obstruction checks
    // below (it's the surface being placed ON, not a blocker), nothing else
    // was left to stop cargo from being placed hanging halfway off the
    // pallet's own edge whenever no OTHER object happens to be in the way.
    // Converts the planned position into the pallet's own local space
    // (accounting for its current Y rotation) and checks the placed item's
    // rotated enclosing footprint against the pallet's real half-extents
    // (supportObj.width/depth — the same values PALLET_CONFIG built its
    // collider from). PALLET_EDGE_TOLERANCE allows a small near-edge
    // overhang rather than demanding the full enclosing-AABB fit inside
    // (spec三: "小幅貼近邊緣可允許，不要要求整個旋轉外接AABB必須過度內縮") —
    // only a CLEAR overshoot past that tolerance is rejected.
    if (supportObj) {
      const palletYaw = new THREE.Euler().setFromQuaternion(supportObj.mesh.quaternion, 'YXZ').y;
      const dx = position.x - supportObj.mesh.position.x;
      const dz = position.z - supportObj.mesh.position.z;
      const cosP = Math.cos(-palletYaw);
      const sinP = Math.sin(-palletYaw);
      const localX = dx * cosP - dz * sinP;
      const localZ = dx * sinP + dz * cosP;
      const palletHalfW = supportObj.width / 2;
      const palletHalfD = supportObj.depth / 2;
      if (Math.abs(localX) + halfW - PALLET_EDGE_TOLERANCE > palletHalfW) return false;
      if (Math.abs(localZ) + halfD - PALLET_EDGE_TOLERANCE > palletHalfD) return false;
    }

    // Player overlap
    const dx = position.x - this.camera.position.x;
    const dz = position.z - this.camera.position.z;
    if (Math.sqrt(dx * dx + dz * dz) < 0.5 + Math.max(halfW, halfD)) return false;

    // Box3 overlap check with epsilon
    const eps = 0.02;
    const placementBox = new THREE.Box3(
      new THREE.Vector3(position.x - halfW + eps, position.y - halfH + eps, position.z - halfD + eps),
      new THREE.Vector3(position.x + halfW - eps, position.y + halfH - eps, position.z + halfD - eps)
    );

    for (const other of this.interactables.values()) {
      if (other.id === obj.id || other.isHeld || !other.mesh.visible) continue;
      // "Fix cargo placement on pallet surface" round spec二: the pallet
      // currently being placed ONTO is this placement's own support, not an
      // obstruction — every OTHER interactable (other cargo already on the
      // pallet, walls, shelves) is still checked normally below.
      if (supportObj && other.id === supportObj.id) continue;
      const otherBox = new THREE.Box3().setFromObject(other.mesh);
      if (placementBox.intersectsBox(otherBox)) return false;
    }

    // Full held-item collider-bounds check against STATIC scene geometry —
    // walls, and (the case this was added for) a storage shelf's own
    // corner posts / back panel / the board of the level above ("Enlarge
    // west wall shelves for medium cargo" round spec三: "放置預覽必須使用
    // 手持物品完整Collider bounds檢查...不要等confirmPlacement後才靠物理碰
    // 撞彈開" — a large item aimed at a shelf level used to show a valid
    // green preview and only get physically shoved out once its rigidbody
    // resumed on confirm; this catches it BEFORE that, at preview time).
    // Uses PhysicsSystem.castShapeAgainstStaticAndBox — a correctly-group-
    // packed sibling of the existing castShape() (see that new method's own
    // doc comment for why the older one couldn't be reused as-is here).
    // Every legitimate placement already positions the preview flush
    // (zero-gap) against its own support surface, and the 0.01 shrink
    // margin both methods share keeps that "resting exactly on top of X"
    // case from ever being misread as overlap — this only ever catches a
    // genuine collision with solid geometry.
    if (this.physics.castShapeAgainstStaticAndBox(
      position, new THREE.Vector3(halfW, halfH, halfD), supportObj?.rigidBody ?? undefined
    )) return false;

    return true;
  }

  /** Only the TOP-of-stack held item's viewmodel shakes while charging a
   * throw — every other simultaneously-held item's clone stays static in
   * its own slot (spec五A: no jitter between held items). */
  private updateChargeShake(): void {
    const topMesh = this.heldItemView.topMesh;
    const topBase = this.heldItemView.topBase;
    if (!topMesh || !topBase) return;
    const ratio = this.chargeRatio;
    const t = performance.now() * 0.001;

    const shakeX = Math.sin(t * 15) * ratio * 0.04;
    const shakeY = Math.cos(t * 12) * ratio * 0.03;
    const shakeZ = Math.sin(t * 10) * ratio * 0.01;
    const rotX = Math.sin(t * 8) * ratio * 0.06;
    const rotY = Math.cos(t * 11) * ratio * 0.04;
    const rotZ = Math.sin(t * 9) * ratio * 0.03;

    topMesh.position.set(
      topBase.x + shakeX,
      topBase.y + shakeY,
      topBase.z + shakeZ
    );
    topMesh.rotation.set(rotX, rotY, rotZ);
  }

  private removePreview(): void {
    if (this.previewMesh) {
      this.worldScene.remove(this.previewMesh);
      this.previewMesh.geometry.dispose();
      (this.previewMesh.material as THREE.Material).dispose();
      this.previewMesh = null;
    }
    this.previewValid = false;
    this.previewIsLostFoundShelf = false;
  }

  /** "按住 Q 蓄力丟出" plus a "持有 X/Y" line once multi-carry actually
   * matters — mirrors PickupSystem's own holdActionHintText() exactly
   * (duplicated rather than shared since it's one line and pulls from
   * PickupSystem's own heldStack.length/maxCarryCapacity_, which
   * HeldItemAccess deliberately doesn't expose — cancel() only needs this
   * for the interaction prompt text after backing out of a preview). */
  private holdActionHintText(): string {
    return '按 E 選擇放置位置\n按住 Q 蓄力丟出';
  }
}
