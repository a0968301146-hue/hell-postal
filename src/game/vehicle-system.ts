import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsSystem } from './physics-system';
import { InteractableObject } from './interactable-object';
import { VehicleConfig, assertWithinSizeLimits } from './vehicle-data';
import { BACK_AREA } from './logistics-layout-data';
import { createFloatingLabel } from './world-label-system';

const WALL_T = 0.08;
const FLOOR_THICKNESS = 0.1;
const CHASSIS_HEIGHT_RATIO = 0.3;
const ARRIVE_EPS = 0.05;

export interface CargoBayBounds {
  centerX: number;
  centerZ: number;
  bedFloorY: number;
  bedTopY: number;
  /** World-X half-extent of the cargo bay (already resolved for the
   * vehicle's axis — NOT always "width", see VehicleSystem constructor). */
  halfX: number;
  /** World-Z half-extent of the cargo bay (already resolved for axis). */
  halfZ: number;
}

/**
 * One vehicle instance, fully built from a VehicleConfig — no dimension is
 * hardcoded here. A single kinematic RigidBody carries the chassis + bed +
 * wall colliders as LOCAL offsets, so moving the body (arriving/departing)
 * moves every collider with it — the correct pattern (see sorting-box-system
 * for the good example, and the Phase 0A crate fix for what goes wrong when
 * a movable container's colliders are NOT attached to one body).
 */
export class VehicleSystem {
  readonly config: VehicleConfig;
  vehicleGroup: THREE.Group;
  cargoBedTopMesh: THREE.Mesh;
  cargoBayBounds: CargoBayBounds;

  private physics: PhysicsSystem;
  private body: RAPIER.RigidBody;
  private label: THREE.Sprite;

  constructor(scene: THREE.Scene, physics: PhysicsSystem, config: VehicleConfig, spawnAt: { x: number; z: number }) {
    assertWithinSizeLimits(config);
    this.config = config;
    this.physics = physics;

    // 'z' (default, land): chassis length along Z, open cargo front at -Z,
    // closed wall at +Z. 'x' (sea): the same layout rotated 90° — length
    // along X, open front at -X (facing the player-accessible interior,
    // since sea vehicles dock with the pier's only approach to the west),
    // closed wall at +X. See VehicleConfig.axis doc in vehicle-data.ts.
    const isXAxis = config.axis === 'x';

    const floorY = BACK_AREA.floorY;
    const chassisHeight = config.height * CHASSIS_HEIGHT_RATIO;
    const bedWallHeight = Math.max(config.height - chassisHeight - FLOOR_THICKNESS, 0.2);
    const bedAcross = config.cargoAreaWidth + WALL_T * 2; // across the travel axis
    const bedAlong = config.cargoAreaLength + WALL_T * 2; // along the travel axis

    const chassisMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x6b5b3a });

    this.vehicleGroup = new THREE.Group();
    this.vehicleGroup.position.set(spawnAt.x, 0, spawnAt.z);
    scene.add(this.vehicleGroup);

    // Single kinematic body — the group's Y stays 0, so local collider Y
    // offsets below are numerically the same as their world Y.
    const bodyDesc = physics.createKinematicBodyDesc(spawnAt.x, 0, spawnAt.z);
    this.body = physics.createKinematicBody(bodyDesc);

    // Chassis
    const [chassisSX, chassisSZ] = isXAxis ? [config.length, config.width] : [config.width, config.length];
    const chassisGeo = new THREE.BoxGeometry(chassisSX, chassisHeight, chassisSZ);
    const chassis = new THREE.Mesh(chassisGeo, chassisMat);
    chassis.position.y = floorY + chassisHeight / 2;
    this.vehicleGroup.add(chassis);
    physics.addColliderToBody(this.body, 0, chassis.position.y, 0, chassisSX / 2, chassisHeight / 2, chassisSZ / 2);

    // Cargo bed floor
    const bedFloorY = floorY + chassisHeight;
    const [bedSX, bedSZ] = isXAxis ? [bedAlong, bedAcross] : [bedAcross, bedAlong];
    const bedFloorGeo = new THREE.BoxGeometry(bedSX, FLOOR_THICKNESS, bedSZ);
    const bedFloor = new THREE.Mesh(bedFloorGeo, bedMat);
    bedFloor.position.y = bedFloorY + FLOOR_THICKNESS / 2;
    this.vehicleGroup.add(bedFloor);
    physics.addColliderToBody(this.body, 0, bedFloor.position.y, 0, bedSX / 2, FLOOR_THICKNESS / 2, bedSZ / 2);

    // Bed walls: two side walls running the full "along" extent, offset
    // ± "across"/2, plus one closed wall at the +along end (open front at
    // -along for loading).
    const wallCY = bedFloorY + FLOOR_THICKNESS + bedWallHeight / 2;
    const alongHalf = bedAlong / 2;
    const acrossHalf = bedAcross / 2;
    if (isXAxis) {
      this.addBedWall(bedMat, 0, wallCY, -acrossHalf + WALL_T / 2, bedAlong, bedWallHeight, WALL_T);
      this.addBedWall(bedMat, 0, wallCY, acrossHalf - WALL_T / 2, bedAlong, bedWallHeight, WALL_T);
      this.addBedWall(bedMat, alongHalf - WALL_T / 2, wallCY, 0, WALL_T, bedWallHeight, bedAcross); // back wall, +X (open front at -X, west-facing when docked)
    } else {
      this.addBedWall(bedMat, -acrossHalf + WALL_T / 2, wallCY, 0, WALL_T, bedWallHeight, bedAlong);
      this.addBedWall(bedMat, acrossHalf - WALL_T / 2, wallCY, 0, WALL_T, bedWallHeight, bedAlong);
      this.addBedWall(bedMat, 0, wallCY, alongHalf - WALL_T / 2, bedAcross, bedWallHeight, WALL_T); // back wall, +Z (south-facing when docked)
    }

    this.cargoBedTopMesh = bedFloor;

    const [halfX, halfZ] = isXAxis
      ? [config.cargoAreaLength / 2, config.cargoAreaWidth / 2]
      : [config.cargoAreaWidth / 2, config.cargoAreaLength / 2];
    this.cargoBayBounds = {
      centerX: 0, // relative — resolved against current position each check
      centerZ: 0,
      bedFloorY: bedFloorY + FLOOR_THICKNESS,
      bedTopY: bedFloorY + FLOOR_THICKNESS + bedWallHeight + 0.5,
      halfX,
      halfZ,
    };

    this.label = createFloatingLabel(config.displayName, { width: 1.0 });
    this.label.position.set(0, floorY + config.height + 0.6, 0);
    this.vehicleGroup.add(this.label);
  }

  private addBedWall(material: THREE.Material, localX: number, localY: number, localZ: number, sx: number, sy: number, sz: number): void {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(localX, localY, localZ);
    this.vehicleGroup.add(mesh);
    this.physics.addColliderToBody(this.body, localX, localY, localZ, sx / 2, sy / 2, sz / 2);
  }

  get position(): THREE.Vector3 {
    return this.vehicleGroup.position;
  }

  isInCargoBay(pos: THREE.Vector3): boolean {
    const b = this.cargoBayBounds;
    const cx = this.vehicleGroup.position.x;
    const cz = this.vehicleGroup.position.z;
    return (
      pos.x >= cx - b.halfX && pos.x <= cx + b.halfX &&
      pos.z >= cz - b.halfZ && pos.z <= cz + b.halfZ &&
      pos.y >= b.bedFloorY - 0.1 && pos.y <= b.bedTopY
    );
  }

  /** Moves the whole vehicle (mesh + kinematic body) toward `target`,
   * translating any pinned cargo meshes by the same delta. Returns true once
   * it has arrived (within a small epsilon). */
  moveToward(target: { x: number; z: number }, deltaTime: number, pinnedCargo: InteractableObject[]): boolean {
    const pos = this.vehicleGroup.position;
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < ARRIVE_EPS) return true;

    const step = Math.min(this.config.movementSpeed * deltaTime, dist);
    const deltaX = (dx / dist) * step;
    const deltaZ = (dz / dist) * step;

    pos.x += deltaX;
    pos.z += deltaZ;
    this.body.setNextKinematicTranslation({ x: pos.x, y: 0, z: pos.z });

    for (const cargo of pinnedCargo) {
      cargo.mesh.position.x += deltaX;
      cargo.mesh.position.z += deltaZ;
    }

    return Math.sqrt((target.x - pos.x) ** 2 + (target.z - pos.z) ** 2) < ARRIVE_EPS;
  }

  /** Removes this vehicle entirely — mesh, materials/geometry, physics body. */
  dispose(): void {
    this.vehicleGroup.parent?.remove(this.vehicleGroup);
    this.vehicleGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material?.dispose();
      }
    });
    this.physics.removeRigidBody(this.body);
  }
}
