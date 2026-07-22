import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsSystem } from './physics-system';
import { InteractableObject, createInteractableObject } from './interactable-object';
import { CargoSystem } from './cargo-system';
import {
  DOLLY_PLATFORM_WIDTH, DOLLY_PLATFORM_DEPTH, DOLLY_PLATFORM_THICKNESS,
  DOLLY_RAIL_HEIGHT, DOLLY_RAIL_THICKNESS, DOLLY_HANDLE_HEIGHT,
  DOLLY_HANDLE_ZONE_DEPTH, DOLLY_TOTAL_DEPTH,
  DOLLY_PUSH_OFFSET, DOLLY_CONFIGS, DollyConfig, DOLLY_FLOOR_Y,
} from './dolly-data';
import { createFloatingLabel, updateFloatingLabel } from './world-label-system';
import { SCENE_CONFIG } from './scene-manager';

const IDLE_TEXT = '拖板車\n按 E 推行';
const PUSHING_TEXT = '推行中\n按 E 放開';

/**
 * Flatbed dolly the player PUSHES (not hand-carries) around the back area.
 *
 * Deliberately NOT inserted into the shared `interactables` map: it isn't a
 * PickupSystem object (no raycast pick-up, no viewmodel), it's driven by its
 * own proximity check + dedicated push state, so keeping it out of that map
 * avoids any conflict with PickupSystem's raycasting/priority chain.
 *
 * The platform's rigid body is KINEMATIC (same pattern as VehicleSystem) —
 * immune to gravity/bumps while parked, and only moves when this system's
 * update() explicitly drives it each frame while pushing, clamped by a
 * swept shape cast so it can't be pushed through fixed scene geometry.
 * Cargo detected on the platform at push-start is pinned: physics disabled,
 * its transform relative to the platform saved once, then every frame its
 * world position/rotation is re-derived from that saved local transform
 * against the platform's current world matrix (so it follows rotation
 * correctly, not just a position delta) — physics re-enabled on release.
 */
export class DollySystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private cargoSystem: CargoSystem;

  private dollyObj: InteractableObject;
  private body: RAPIER.RigidBody;
  private label: THREE.Sprite;
  platformTopMesh: THREE.Mesh;

  isPushing = false;
  private pinnedCargo: { obj: InteractableObject; localPos: THREE.Vector3; localQuat: THREE.Quaternion }[] = [];

  constructor(scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>, cargoSystem: CargoSystem) {
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;
    this.cargoSystem = cargoSystem;

    const config = DOLLY_CONFIGS[0];
    const built = this.buildDolly(config);
    this.dollyObj = built.obj;
    this.body = built.body;
    this.label = built.label;
    this.platformTopMesh = built.platformTopMesh;
  }

  private buildDolly(config: DollyConfig): { obj: InteractableObject; body: RAPIER.RigidBody; label: THREE.Sprite; platformTopMesh: THREE.Mesh } {
    const totalHeight = DOLLY_PLATFORM_THICKNESS + DOLLY_RAIL_HEIGHT;
    const rootY = DOLLY_FLOOR_Y + 0.02;

    const frameMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b0 });
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x888880 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a });
    const hw = DOLLY_PLATFORM_WIDTH / 2;
    const hd = DOLLY_PLATFORM_DEPTH / 2;
    const rt = DOLLY_RAIL_THICKNESS;

    // Root — invisible tiny cube, origin at BOTTOM CENTER (same convention
    // as every other movable container in this project).
    const rootGeo = new THREE.BoxGeometry(0.001, 0.001, 0.001);
    const rootMat = new THREE.MeshBasicMaterial({ visible: false });
    const root = new THREE.Mesh(rootGeo, rootMat);

    // Flatbed platform
    const platformGeo = new THREE.BoxGeometry(DOLLY_PLATFORM_WIDTH, DOLLY_PLATFORM_THICKNESS, DOLLY_PLATFORM_DEPTH);
    const platform = new THREE.Mesh(platformGeo, frameMat);
    platform.position.y = DOLLY_PLATFORM_THICKNESS / 2;
    root.add(platform);

    // Low rim on all 4 sides — enough to keep parked cargo from drifting off
    const railBaseY = DOLLY_PLATFORM_THICKNESS + DOLLY_RAIL_HEIGHT / 2;
    const frontBackGeo = new THREE.BoxGeometry(DOLLY_PLATFORM_WIDTH, DOLLY_RAIL_HEIGHT, rt);
    const front = new THREE.Mesh(frontBackGeo, frameMat);
    front.position.set(0, railBaseY, hd - rt / 2);
    root.add(front);
    const back = new THREE.Mesh(frontBackGeo, frameMat);
    back.position.set(0, railBaseY, -hd + rt / 2);
    root.add(back);
    const sideGeo = new THREE.BoxGeometry(rt, DOLLY_RAIL_HEIGHT, DOLLY_PLATFORM_DEPTH);
    const left = new THREE.Mesh(sideGeo, frameMat);
    left.position.set(-hw + rt / 2, railBaseY, 0);
    root.add(left);
    const right = new THREE.Mesh(sideGeo, frameMat);
    right.position.set(hw - rt / 2, railBaseY, 0);
    root.add(right);

    // Handle / tow bar — mounted at the BACK of the handle zone (behind the
    // bed, closest to the player pushing), reaching the full DOLLY_TOTAL_DEPTH
    // footprint so the overall shape reads as "bed in front, handle behind"
    // like a real hand truck, not just a longer flat platform.
    const handleZ = -(hd + DOLLY_HANDLE_ZONE_DEPTH);
    const postGeo = new THREE.BoxGeometry(0.05, DOLLY_HANDLE_HEIGHT, 0.05);
    const postL = new THREE.Mesh(postGeo, handleMat);
    postL.position.set(-hw + 0.08, DOLLY_HANDLE_HEIGHT / 2, handleZ);
    root.add(postL);
    const postR = new THREE.Mesh(postGeo, handleMat);
    postR.position.set(hw - 0.08, DOLLY_HANDLE_HEIGHT / 2, handleZ);
    root.add(postR);
    const crossGeo = new THREE.BoxGeometry(DOLLY_PLATFORM_WIDTH - 0.16 + 0.1, 0.05, 0.05);
    const cross = new THREE.Mesh(crossGeo, handleMat);
    cross.position.set(0, DOLLY_HANDLE_HEIGHT, handleZ);
    root.add(cross);
    // Rails connecting the bed's back edge to the handle posts — cosmetic
    // "frame", makes the handle zone read as part of one continuous chassis
    // rather than two disconnected pieces.
    const frameGeo = new THREE.BoxGeometry(0.04, 0.04, DOLLY_HANDLE_ZONE_DEPTH + rt);
    const frameL = new THREE.Mesh(frameGeo, frameMat);
    frameL.position.set(-hw + 0.08, DOLLY_PLATFORM_THICKNESS, handleZ + DOLLY_HANDLE_ZONE_DEPTH / 2);
    root.add(frameL);
    const frameR = new THREE.Mesh(frameGeo, frameMat);
    frameR.position.set(hw - 0.08, DOLLY_PLATFORM_THICKNESS, handleZ + DOLLY_HANDLE_ZONE_DEPTH / 2);
    root.add(frameR);

    // Four cosmetic wheels
    const wheelGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12);
    const wheelPositions: [number, number][] = [
      [-hw + 0.14, -hd + 0.14], [hw - 0.14, -hd + 0.14],
      [-hw + 0.14, hd - 0.14], [hw - 0.14, hd - 0.14],
    ];
    for (const [wx, wz] of wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.02, wz);
      root.add(wheel);
    }

    const label = createFloatingLabel(IDLE_TEXT, { width: 0.7 });
    label.position.set(0, totalHeight + DOLLY_HANDLE_HEIGHT * 0.4 + 0.3, 0);
    root.add(label);

    root.position.set(config.posX, rootY, config.posZ);
    root.userData.bottomOrigin = true;
    root.userData.dollyId = config.dollyId;
    this.scene.add(root);

    // NOTE: `depth` here is the OVERALL footprint (bed + handle zone,
    // DOLLY_TOTAL_DEPTH) — used by the collision shape-cast and push-offset
    // math (this.dollyObj.depth) — not the bed-only DOLLY_PLATFORM_DEPTH.
    // containerBounds below stays bed-only, since that's what actually
    // carries cargo.
    const obj = createInteractableObject(config.dollyId, '拖板車', root, DOLLY_PLATFORM_WIDTH, totalHeight, DOLLY_TOTAL_DEPTH);
    obj.canPickUp = false; // pushed, never hand-picked-up
    obj.containerBounds = {
      innerWidth: DOLLY_PLATFORM_WIDTH - DOLLY_RAIL_THICKNESS * 2,
      innerDepth: DOLLY_PLATFORM_DEPTH - DOLLY_RAIL_THICKNESS * 2,
      innerHeight: DOLLY_RAIL_HEIGHT,
      interiorCenterOffset: new THREE.Vector3(0, (DOLLY_PLATFORM_THICKNESS + DOLLY_RAIL_HEIGHT) / 2, 0),
      tolerance: 0.03,
    };

    // Kinematic body — same reasoning as VehicleSystem: never affected by
    // gravity/bumps while parked, only moves when explicitly driven here.
    const bodyCenterY = rootY + totalHeight / 2;
    const bodyDesc = this.physics.createKinematicBodyDesc(config.posX, bodyCenterY, config.posZ);
    const body = this.physics.createKinematicBody(bodyDesc);

    const hh = totalHeight / 2;
    const floorLocalY = -hh + DOLLY_PLATFORM_THICKNESS / 2;
    const railLocalY = -hh + DOLLY_PLATFORM_THICKNESS + DOLLY_RAIL_HEIGHT / 2;
    this.physics.addColliderToBody(body, 0, floorLocalY, 0, hw, DOLLY_PLATFORM_THICKNESS / 2, hd);
    this.physics.addColliderToBody(body, 0, railLocalY, hd - rt / 2, hw, DOLLY_RAIL_HEIGHT / 2, rt / 2);
    this.physics.addColliderToBody(body, 0, railLocalY, -(hd - rt / 2), hw, DOLLY_RAIL_HEIGHT / 2, rt / 2);
    this.physics.addColliderToBody(body, -(hw - rt / 2), railLocalY, 0, rt / 2, DOLLY_RAIL_HEIGHT / 2, hd);
    this.physics.addColliderToBody(body, hw - rt / 2, railLocalY, 0, rt / 2, DOLLY_RAIL_HEIGHT / 2, hd);

    obj.rigidBody = body;
    obj.collider = null;

    return { obj, body, label, platformTopMesh: platform };
  }

  isPlayerNear(pos: THREE.Vector3): boolean {
    const dx = pos.x - this.dollyObj.mesh.position.x;
    const dz = pos.z - this.dollyObj.mesh.position.z;
    return Math.sqrt(dx * dx + dz * dz) < SCENE_CONFIG.interactionDistance + 1.2;
  }

  startPush(): void {
    if (this.isPushing) return;
    this.isPushing = true;

    this.dollyObj.mesh.updateMatrixWorld(true);
    const dollyMatrixInverse = new THREE.Matrix4().copy(this.dollyObj.mesh.matrixWorld).invert();
    const dollyQuatInverse = this.dollyObj.mesh.quaternion.clone().invert();

    const cargo = this.findCargoOnPlatform();
    this.pinnedCargo = cargo.map((obj) => {
      const localPos = obj.mesh.position.clone().applyMatrix4(dollyMatrixInverse);
      const localQuat = obj.mesh.quaternion.clone().premultiply(dollyQuatInverse);
      return { obj, localPos, localQuat };
    });

    for (const { obj } of this.pinnedCargo) {
      obj.canPickUp = false;
      if (obj.rigidBody) {
        obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.physics.setBodyEnabled(obj.rigidBody, false);
      }
    }
    updateFloatingLabel(this.label, PUSHING_TEXT);
  }

  stopPush(): void {
    if (!this.isPushing) return;
    this.isPushing = false;
    for (const { obj } of this.pinnedCargo) {
      obj.canPickUp = true;
      if (obj.rigidBody) {
        const p = obj.mesh.position;
        const q = obj.mesh.quaternion;
        this.physics.setBodyEnabled(obj.rigidBody, true);
        obj.rigidBody.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
        obj.rigidBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
        obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    this.pinnedCargo = [];
    updateFloatingLabel(this.label, IDLE_TEXT);
  }

  /** Cargo whose center falls within the platform's own containerBounds —
   * per-dolly, not a fixed size borrowed from another container type. */
  private findCargoOnPlatform(): InteractableObject[] {
    const bounds = this.dollyObj.containerBounds!;
    const dollyPos = this.dollyObj.mesh.position;
    const centerX = dollyPos.x + bounds.interiorCenterOffset.x;
    const centerZ = dollyPos.z + bounds.interiorCenterOffset.z;
    const centerY = dollyPos.y + bounds.interiorCenterOffset.y;
    const innerHW = bounds.innerWidth / 2;
    const innerHD = bounds.innerDepth / 2;
    const bottomY = centerY - bounds.innerHeight / 2;
    // Generous headroom above the rail top: normal cargo stacks a bit, and
    // large cargo (up to 1.25m tall, see cargo-data.ts) sits with its
    // center well above the rail line — 1.0m comfortably covers both.
    const topY = centerY + bounds.innerHeight / 2 + 1.0;

    const found: InteractableObject[] = [];
    for (const obj of this.interactables.values()) {
      if (obj.isHeld || !obj.mesh.visible) continue;
      // Any registered cargo (normal or large) — identified by cargoType/
      // cargoDataMap membership, not an id prefix, so envelopes/packages/
      // sorting boxes are never mistakenly captured.
      if (!this.cargoSystem.getCargoData(obj.id)) continue;
      const p = obj.mesh.position;
      if (p.x < centerX - innerHW || p.x > centerX + innerHW) continue;
      if (p.z < centerZ - innerHD || p.z > centerZ + innerHD) continue;
      if (p.y < bottomY - bounds.tolerance || p.y > topY) continue;
      found.push(obj);
    }
    return found;
  }

  /** Drives the platform to a fixed offset in front of the camera while
   * pushing — a simplified follow, not a real rigid-body tow simulation.
   * Translation is clamped by a swept shape cast against fixed scene
   * geometry (walls/glass/counter/furniture) so the kinematic body can't be
   * teleported straight through it. Pinned cargo is re-derived every frame
   * from its saved LOCAL transform against the platform's current world
   * matrix, so it follows rotation correctly (not just a position delta). */
  update(cameraPosition: THREE.Vector3, cameraForward: THREE.Vector3): void {
    if (!this.isPushing) return;

    const flatForward = new THREE.Vector3(cameraForward.x, 0, cameraForward.z);
    if (flatForward.lengthSq() < 1e-6) return;
    flatForward.normalize();

    const oldPos = this.dollyObj.mesh.position.clone();
    const targetX = cameraPosition.x + flatForward.x * DOLLY_PUSH_OFFSET;
    const targetZ = cameraPosition.z + flatForward.z * DOLLY_PUSH_OFFSET;
    const desiredDeltaX = targetX - oldPos.x;
    const desiredDeltaZ = targetZ - oldPos.z;
    const yaw = Math.atan2(flatForward.x, flatForward.z);
    const targetQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));

    // Clamp the intended translation against fixed geometry before
    // committing to it. Rotation itself is left unchecked (see class doc /
    // this round's scope) — that's what lets the player pivot the dolly
    // away from something it's stopped against.
    // NOTE: dollyObj.depth is the overall footprint (bed + handle zone) but
    // this cast box is centered on the BED's own local origin, not the true
    // footprint's center (which sits slightly toward the handle end) — a
    // symmetric simplification that slightly over-reserves clearance ahead
    // of the bed and slightly under-reserves behind the handle tip. Since
    // the leading edge during a forward push is always the bed's front,
    // this bias is conservative-safe where it matters.
    const halfExtents = new THREE.Vector3(this.dollyObj.width / 2, this.dollyObj.height / 2, this.dollyObj.depth / 2);
    const shapeCenter = new THREE.Vector3(oldPos.x, oldPos.y + this.dollyObj.height / 2, oldPos.z);
    const movement = new THREE.Vector3(desiredDeltaX, 0, desiredDeltaZ);
    const allowedFraction = this.physics.castShapeMove(shapeCenter, targetQuat, halfExtents, movement);

    const newX = oldPos.x + desiredDeltaX * allowedFraction;
    const newZ = oldPos.z + desiredDeltaZ * allowedFraction;

    this.dollyObj.mesh.position.set(newX, oldPos.y, newZ);
    this.dollyObj.mesh.rotation.set(0, yaw, 0);
    this.dollyObj.mesh.updateMatrixWorld(true);

    const bodyY = oldPos.y + this.dollyObj.height / 2;
    this.body.setNextKinematicTranslation({ x: newX, y: bodyY, z: newZ });
    this.body.setNextKinematicRotation({ x: targetQuat.x, y: targetQuat.y, z: targetQuat.z, w: targetQuat.w });

    for (const pinned of this.pinnedCargo) {
      const worldPos = pinned.localPos.clone().applyMatrix4(this.dollyObj.mesh.matrixWorld);
      const worldQuat = this.dollyObj.mesh.quaternion.clone().multiply(pinned.localQuat);
      pinned.obj.mesh.position.copy(worldPos);
      pinned.obj.mesh.quaternion.copy(worldQuat);
    }
  }
}
