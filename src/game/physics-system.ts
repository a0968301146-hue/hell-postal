import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SCENE_CONFIG } from './scene-manager';
import { PLAYER_SPAWN } from './counter-layout-data';

// Collision groups
export const GROUP_STATIC = 0x0001;
export const GROUP_PLAYER = 0x0002;
export const GROUP_BOX = 0x0004;

export class PhysicsSystem {
  world!: RAPIER.World;
  private initialized = false;
  private accumulator = 0;
  private fixedStep = 1 / 60;

  // Player
  playerBody!: RAPIER.RigidBody;
  playerCollider!: RAPIER.Collider;
  characterController!: RAPIER.KinematicCharacterController;

  async init(): Promise<void> {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.initialized = true;

    // Create character controller
    this.characterController = this.world.createCharacterController(0.02);
    this.characterController.enableAutostep(0.3, 0.2, true);
    this.characterController.enableSnapToGround(0.3);
    this.characterController.setApplyImpulsesToDynamicBodies(true);

    this.createPlayer();
  }

  createStaticCuboid(x: number, y: number, z: number, hx: number, hy: number, hz: number): void {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setCollisionGroups((GROUP_STATIC << 16) | (GROUP_PLAYER | GROUP_BOX))
      .setFriction(0.7)
      .setRestitution(0.1);
    this.world.createCollider(colliderDesc, body);
  }

  /** Static cuboid tilted around the X axis (radians) — used for sloped surfaces like the cargo ramp. */
  createStaticCuboidRotatedX(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotX: number, friction = 0.7): void {
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rotX);
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(x, y, z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setCollisionGroups((GROUP_STATIC << 16) | (GROUP_PLAYER | GROUP_BOX))
      .setFriction(friction)
      .setRestitution(0.05);
    this.world.createCollider(colliderDesc, body);
  }

  /** Create a cuboid collider attached to an existing body with a local offset */
  addColliderToBody(body: RAPIER.RigidBody, localX: number, localY: number, localZ: number, hx: number, hy: number, hz: number): RAPIER.Collider {
    const colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(localX, localY, localZ)
      .setCollisionGroups((GROUP_BOX << 16) | (GROUP_STATIC | GROUP_PLAYER | GROUP_BOX))
      .setFriction(0.6)
      .setRestitution(0.05);
    return this.world.createCollider(colliderDesc, body);
  }

  /** Create a dynamic body descriptor */
  createDynamicBodyDesc(x: number, y: number, z: number, _density: number): RAPIER.RigidBodyDesc {
    return RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(1.0)
      .setAngularDamping(1.5)
      .setCcdEnabled(true);
  }

  /** Create a dynamic rigid body from descriptor */
  createDynamicBody(desc: RAPIER.RigidBodyDesc): RAPIER.RigidBody {
    return this.world.createRigidBody(desc);
  }

  /** Kinematic body descriptor — for things moved by scripted position
   * updates (not physics forces) that still need attached colliders to
   * follow them, e.g. a vehicle driving in/out along a fixed path. */
  createKinematicBodyDesc(x: number, y: number, z: number): RAPIER.RigidBodyDesc {
    return RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z);
  }

  createKinematicBody(desc: RAPIER.RigidBodyDesc): RAPIER.RigidBody {
    return this.world.createRigidBody(desc);
  }

  /** Removes a body and all colliders attached to it. */
  removeRigidBody(body: RAPIER.RigidBody): void {
    this.world.removeRigidBody(body);
  }

  private createPlayer(): void {
    const radius = 0.35;
    const halfHeight = 0.55; // total capsule height ~1.8m
    const startY = SCENE_CONFIG.playerEyeHeight;

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(PLAYER_SPAWN.x, startY - 0.3, PLAYER_SPAWN.z);
    this.playerBody = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
      .setCollisionGroups((GROUP_PLAYER << 16) | (GROUP_STATIC | GROUP_BOX))
      .setFriction(0.2);
    this.playerCollider = this.world.createCollider(colliderDesc, this.playerBody);
  }

  createBoxBody(x: number, y: number, z: number, hx: number, hy: number, hz: number, density: number): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(1.0)
      .setAngularDamping(1.5)
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setDensity(density)
      .setCollisionGroups((GROUP_BOX << 16) | (GROUP_STATIC | GROUP_PLAYER | GROUP_BOX))
      .setFriction(0.6)
      .setRestitution(0.05);
    const collider = this.world.createCollider(colliderDesc, body);

    return { body, collider };
  }

  setBodyEnabled(body: RAPIER.RigidBody, enabled: boolean): void {
    body.setEnabled(enabled);
  }

  movePlayer(desiredMovement: THREE.Vector3): THREE.Vector3 {
    if (!this.initialized) return desiredMovement;

    this.characterController.computeColliderMovement(
      this.playerCollider,
      { x: desiredMovement.x, y: desiredMovement.y, z: desiredMovement.z }
    );

    const corrected = this.characterController.computedMovement();
    return new THREE.Vector3(corrected.x, corrected.y, corrected.z);
  }

  isPlayerGrounded(): boolean {
    return this.characterController.computedGrounded();
  }

  setPlayerPosition(pos: THREE.Vector3): void {
    this.playerBody.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
  }

  getPlayerPosition(): THREE.Vector3 {
    const t = this.playerBody.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  update(deltaTime: number): void {
    if (!this.initialized) return;

    this.accumulator += deltaTime;
    while (this.accumulator >= this.fixedStep) {
      this.world.step();
      this.accumulator -= this.fixedStep;
    }
  }

  syncMeshToBody(mesh: THREE.Mesh, body: RAPIER.RigidBody): void {
    const t = body.translation();
    const r = body.rotation();
    mesh.position.set(t.x, t.y, t.z);
    mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  castShape(position: THREE.Vector3, halfExtents: THREE.Vector3): boolean {
    if (!this.initialized) return false;
    const shape = new RAPIER.Cuboid(halfExtents.x - 0.01, halfExtents.y - 0.01, halfExtents.z - 0.01);
    const shapePos = { x: position.x, y: position.y, z: position.z };
    const shapeRot = { x: 0, y: 0, z: 0, w: 1 };
    const hit = this.world.intersectionWithShape(shapePos, shapeRot, shape, undefined,
      (GROUP_STATIC | GROUP_BOX) // filter: only collide with static + boxes
    );
    return hit !== null;
  }

  /** Swept shape cast against FIXED scene geometry only (walls/glass/counter/
   * furniture — GROUP_STATIC), used to clamp a kinematic body's intended
   * per-frame movement so it can't be teleported straight through solid
   * geometry. Returns the fraction (0..1) of `movement` that's actually
   * safe to apply — 1 if the full move is clear, 0 if already blocked. */
  castShapeMove(position: THREE.Vector3, rotation: THREE.Quaternion, halfExtents: THREE.Vector3, movement: THREE.Vector3): number {
    if (!this.initialized) return 1;
    const totalDist = movement.length();
    if (totalDist < 1e-6) return 1;

    const shape = new RAPIER.Cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
    const shapePos = { x: position.x, y: position.y, z: position.z };
    const shapeRot = { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
    const shapeVel = { x: movement.x, y: movement.y, z: movement.z };

    // Rapier query filter groups are packed as (membership << 16) | filter,
    // same as collider.setCollisionGroups() — a bare bitmask (as the older
    // castShape()/intersectionWithShape() above uses) silently matches
    // nothing. Static walls declare membership=GROUP_STATIC and
    // filter=(PLAYER|BOX), so querying with membership=GROUP_BOX and
    // filter=GROUP_STATIC satisfies the symmetric test on both sides —
    // matches only fixed scene geometry, not the player or other loose cargo.
    const hit = this.world.castShape(
      shapePos, shapeRot, shapeVel, shape,
      0.0, 1.0, true,
      undefined, (GROUP_BOX << 16) | GROUP_STATIC
    );
    if (!hit) return 1;

    const margin = 0.03; // stop a little short of actual contact, not flush against it
    const allowedDist = Math.max(0, totalDist * hit.time_of_impact - margin);
    return allowedDist / totalDist;
  }
}
