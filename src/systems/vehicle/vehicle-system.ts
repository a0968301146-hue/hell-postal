import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject } from '../../shared/types/interactable';
import { VehicleConfig, assertWithinSizeLimits, FROG_VEHICLE_CONFIG_ID } from './vehicle-data';
import { CARGO_BOUNDS_HEIGHT_MULTIPLIER } from './vehicle-cargo-bounds-data';
import { BACK_AREA } from '../world-layout';
import { createFloatingLabel } from '../../adapters/three/world-label-system';

const WALL_T = 0.08;
const FLOOR_THICKNESS = 0.1;
const CHASSIS_HEIGHT_RATIO = 0.3;
const ARRIVE_EPS = 0.05;

/** Frog-only hopping/mouth tuning ("Rebuild frog vehicle as hopping mouth
 * cargo carrier" round) — every other vehicle never reads any of these
 * (gated behind `this.isFrog` everywhere they're used below), so none of
 * this affects the other five vehicles' movement or appearance. */
const FROG_HOP_DISTANCE = 1.3; // meters of ground travel per hop arc (spec三: "每次跳躍有上下起伏，落地後再下一跳")
const FROG_HOP_HEIGHT = 0.35; // peak bob height, meters
const FROG_MOUTH_OPEN_ANGLE = Math.PI / 2; // spec四: "張開約90度"
const FROG_MOUTH_ANGULAR_SPEED = Math.PI; // rad/s lerp rate (~0.5s for a full 90° swing)
/** How high above BACK_AREA's floor the mouth cavity's own vertical CENTER
 * sits — a fixed absolute offset (not proportional to config.height) since
 * player reach is an absolute constraint, not one that should drift if
 * config.height is ever retuned (spec二: "嘴巴開口高度不要過高...玩家站在地
 * 面就能把貨物放進嘴裡"). */
const FROG_MOUTH_CENTER_Y_OFFSET = 1.0;

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
  // Definite-assignment: both are always set inside the constructor's own
  // buildGenericBoxVehicle/buildFrogVehicle branch call, just not visible
  // to TS's control-flow analysis across that method boundary.
  cargoBedTopMesh!: THREE.Mesh;
  cargoBayBounds!: CargoBayBounds;

  private physics: PhysicsSystem;
  private body: RAPIER.RigidBody;
  private label: THREE.Sprite;

  /** Frog-only state ("Rebuild frog vehicle as hopping mouth cargo carrier"
   * round) — every field here stays at its default/no-op value, and every
   * method below that reads them is gated behind `isFrog`, for the other
   * five vehicles, which still go through the exact same generic
   * box-building branch this class always used. */
  private isFrog = false;
  private frogHopDistanceAccum = 0;
  private frogLowerJawHinge: THREE.Group | null = null;
  private frogMouthFloorMesh: THREE.Mesh | null = null;
  private frogMouthAngle = 0;
  private frogMouthTargetAngle = 0;

  constructor(scene: THREE.Scene, physics: PhysicsSystem, config: VehicleConfig, spawnAt: { x: number; z: number }) {
    assertWithinSizeLimits(config);
    this.config = config;
    this.physics = physics;

    const floorY = BACK_AREA.floorY;

    this.vehicleGroup = new THREE.Group();
    this.vehicleGroup.position.set(spawnAt.x, 0, spawnAt.z);
    scene.add(this.vehicleGroup);

    // Single kinematic body — the group's Y stays 0 (frog hopping bobs only
    // the VISUAL group position, never this physics body — see moveToward),
    // so local collider Y offsets below are numerically the same as their
    // world Y.
    const bodyDesc = physics.createKinematicBodyDesc(spawnAt.x, 0, spawnAt.z);
    this.body = physics.createKinematicBody(bodyDesc);

    if (config.id === FROG_VEHICLE_CONFIG_ID) {
      this.isFrog = true;
      this.buildFrogVehicle(floorY);
    } else {
      this.buildGenericBoxVehicle(config, floorY);
    }

    this.label = createFloatingLabel(config.displayName, { width: 1.0 });
    this.label.position.set(0, floorY + config.height + 0.6, 0);
    this.vehicleGroup.add(this.label);
  }

  /** The ORIGINAL (pre-frog-round) box builder, unchanged in every respect
   * except its own name — every one of the other five vehicles still goes
   * through exactly this path, with exactly the same geometry/collider/
   * cargoBayBounds math as before this round. */
  private buildGenericBoxVehicle(config: VehicleConfig, floorY: number): void {
    // 'z' (default, land): chassis length along Z, open cargo front at -Z,
    // closed wall at +Z. 'x' (sea): the same layout rotated 90° — length
    // along X, open front at -X (facing the player-accessible interior,
    // since sea vehicles dock with the pier's only approach to the west),
    // closed wall at +X. See VehicleConfig.axis doc in vehicle-data.ts.
    const isXAxis = config.axis === 'x';

    const chassisHeight = config.height * CHASSIS_HEIGHT_RATIO;
    const bedWallHeight = Math.max(config.height - chassisHeight - FLOOR_THICKNESS, 0.2);
    const bedAcross = config.cargoAreaWidth + WALL_T * 2; // across the travel axis
    const bedAlong = config.cargoAreaLength + WALL_T * 2; // along the travel axis

    const chassisMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x6b5b3a });

    // Chassis
    const [chassisSX, chassisSZ] = isXAxis ? [config.length, config.width] : [config.width, config.length];
    const chassisGeo = new THREE.BoxGeometry(chassisSX, chassisHeight, chassisSZ);
    const chassis = new THREE.Mesh(chassisGeo, chassisMat);
    chassis.position.y = floorY + chassisHeight / 2;
    this.vehicleGroup.add(chassis);
    this.physics.addColliderToBody(this.body, 0, chassis.position.y, 0, chassisSX / 2, chassisHeight / 2, chassisSZ / 2);

    // Cargo bed floor
    const bedFloorY = floorY + chassisHeight;
    const [bedSX, bedSZ] = isXAxis ? [bedAlong, bedAcross] : [bedAcross, bedAlong];
    const bedFloorGeo = new THREE.BoxGeometry(bedSX, FLOOR_THICKNESS, bedSZ);
    const bedFloor = new THREE.Mesh(bedFloorGeo, bedMat);
    bedFloor.position.y = bedFloorY + FLOOR_THICKNESS / 2;
    this.vehicleGroup.add(bedFloor);
    this.physics.addColliderToBody(this.body, 0, bedFloor.position.y, 0, bedSX / 2, FLOOR_THICKNESS / 2, bedSZ / 2);

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
    // Detection-zone bottom stays flush with the cargo bed floor (unchanged
    // from before); only the vertical SPAN above it is scaled by
    // CARGO_BOUNDS_HEIGHT_MULTIPLIER — width/length (halfX/halfZ above)
    // are untouched (spec: "只增加高度，長度與寬度不變").
    const detectBottomY = bedFloorY + FLOOR_THICKNESS;
    const detectHeight = (bedWallHeight + 0.5) * CARGO_BOUNDS_HEIGHT_MULTIPLIER;
    this.cargoBayBounds = {
      centerX: 0, // relative — resolved against current position each check
      centerZ: 0,
      bedFloorY: detectBottomY,
      bedTopY: detectBottomY + detectHeight,
      halfX,
      halfZ,
    };
  }

  /** "Rebuild frog vehicle as hopping mouth cargo carrier" round — builds a
   * simple white-box creature (body/legs/head/upper+lower jaw) instead of
   * the generic flatbed box. Every dimension still comes straight from
   * `this.config` (spec: derive from the same VehicleConfig fields, never a
   * second hand-duplicated size) — cargoAreaWidth/Height/Length now mean
   * the MOUTH INTERIOR specifically (spec四), not a flatbed footprint.
   * Local layout convention: the mouth cavity is centered at local (0,
   * mouthCenterY, 0) — i.e. exactly the vehicleGroup's own tracked X/Z
   * position — with the body/head/legs trailing BEHIND it at negative
   * local Z, and the opening facing FORWARD at positive local Z. This is
   * deliberate: it means `cargoBayBounds` needs no X/Z offset at all
   * (centerX/centerZ: 0, exactly like the generic builder above), so
   * isInCargoBay() — shared, unmodified code — already works correctly for
   * the frog with zero changes of its own. The frog's own fixed route
   * (vehicle-route-data.ts: straight line, spawn south of the dock, exit
   * back south) means local +Z (forward/mouth-facing) always ends up
   * pointing world -Z (north, toward the player interior) once docked —
   * see moveToward()'s own rotation-facing logic below. */
  private buildFrogVehicle(floorY: number): void {
    const config = this.config;
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2 });
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8 });
    const cavityMat = new THREE.MeshStandardMaterial({ color: 0x262626 });

    const mouthHalfX = config.cargoAreaWidth / 2;
    const mouthHalfY = config.cargoAreaHeight / 2;
    const mouthHalfZ = config.cargoAreaLength / 2;
    const mouthCenterY = floorY + FROG_MOUTH_CENTER_Y_OFFSET;

    // --- Body (behind the mouth, local -Z) ---
    const bodyGeo = new THREE.SphereGeometry(1, 14, 10);
    const body = new THREE.Mesh(bodyGeo, skinMat);
    body.scale.set(0.85, 0.6, 1.05);
    const bodyCenterY = floorY + 0.62;
    const bodyCenterZ = -(mouthHalfZ + 1.15);
    body.position.set(0, bodyCenterY, bodyCenterZ);
    this.vehicleGroup.add(body);
    this.physics.addColliderToBody(this.body, 0, bodyCenterY, bodyCenterZ, 0.85, 0.6, 1.05);

    // --- Legs (purely decorative, spec三: "不用做真實四足IK" — no collider
    // of their own, the body collider above already covers the footprint). ---
    const legMat = new THREE.MeshStandardMaterial({ color: 0xe0e0e0 });
    const legGeo = new THREE.CylinderGeometry(0.16, 0.19, 0.34, 8);
    for (const [lx, lz] of [[0.68, -0.9], [-0.68, -0.9], [0.7, -2.3], [-0.7, -2.3]] as const) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(lx, floorY + 0.17, lz);
      this.vehicleGroup.add(leg);
    }

    // --- Head/skull (fixed, links body to the jaw assembly) ---
    const skullGeo = new THREE.BoxGeometry(mouthHalfX * 1.5, 0.75, 0.85);
    const skull = new THREE.Mesh(skullGeo, skinMat);
    const skullCenterZ = -(mouthHalfZ + 0.4);
    skull.position.set(0, mouthCenterY + 0.05, skullCenterZ);
    this.vehicleGroup.add(skull);
    this.physics.addColliderToBody(this.body, 0, mouthCenterY + 0.05, skullCenterZ, mouthHalfX * 0.75, 0.375, 0.425);

    // Two simple eye domes on top of the skull — reads as "a frog" at a
    // glance without needing real materials/texturing (spec: "簡單白模/低模
    // 即可，不需要精細材質").
    const eyeGeo = new THREE.SphereGeometry(0.16, 8, 6);
    for (const ex of [0.3, -0.3]) {
      const eye = new THREE.Mesh(eyeGeo, skinMat);
      eye.position.set(ex, mouthCenterY + 0.42, skullCenterZ);
      this.vehicleGroup.add(eye);
    }

    // --- Mouth cavity dressing: a dark back wall so the cavity clearly
    // reads as an enclosed pocket rather than a floating floor plane (spec
    // 二: "載貨空間要明確可見"). ---
    const cavityBackGeo = new THREE.BoxGeometry(mouthHalfX * 2, mouthHalfY * 2, 0.06);
    const cavityBack = new THREE.Mesh(cavityBackGeo, cavityMat);
    cavityBack.position.set(0, mouthCenterY, -mouthHalfZ);
    this.vehicleGroup.add(cavityBack);

    // --- Upper jaw (FIXED — spec四: "上嘴或下嘴其中一側轉開" — this round
    // opens the lower jaw only). Doubles as the cavity's own visible
    // "roof". ---
    const upperJawGeo = new THREE.BoxGeometry(mouthHalfX * 2.1, 0.2, mouthHalfZ * 2.3);
    const upperJaw = new THREE.Mesh(upperJawGeo, mouthMat);
    upperJaw.position.set(0, mouthCenterY + mouthHalfY, -mouthHalfZ * 0.15);
    this.vehicleGroup.add(upperJaw);
    this.physics.addColliderToBody(this.body, 0, mouthCenterY + mouthHalfY, -mouthHalfZ * 0.15, mouthHalfX * 1.05, 0.1, mouthHalfZ * 1.15);

    // --- Lower jaw (HINGED — pivots open/closed around its own back-top
    // edge, i.e. right where it meets the fixed upper jaw when shut). No
    // collider of its own (spec六: "貨物能順利放進嘴內，不要卡在嘴唇" / "不
    // 要讓嘴巴開闔時把貨物彈飛到奇怪的位置") — purely visual, so it can
    // never physically shove cargo around as it rotates.
    //
    // The hinge sits at the TOP of the cavity (matching the upper jaw's own
    // attach height) specifically so a 90° swing — which always converts
    // the jaw's own forward LENGTH into an equal downward DROP — lands the
    // open jaw's far tip just above the floor instead of clipping through
    // it (lowerJawLength below is explicitly clamped against hingeY-floorY
    // for exactly this reason).
    const hingeY = mouthCenterY + mouthHalfY;
    const hingeZ = -mouthHalfZ;
    const lowerJawHinge = new THREE.Group();
    lowerJawHinge.position.set(0, hingeY, hingeZ);
    this.vehicleGroup.add(lowerJawHinge);
    const lowerJawLength = Math.min(mouthHalfZ * 2.1, hingeY - floorY - 0.1);
    const lowerJawGeo = new THREE.BoxGeometry(mouthHalfX * 2, 0.16, lowerJawLength);
    const lowerJawMesh = new THREE.Mesh(lowerJawGeo, mouthMat);
    lowerJawMesh.position.set(0, 0, lowerJawLength / 2); // offset forward from the hinge pivot
    lowerJawHinge.add(lowerJawMesh);
    this.frogLowerJawHinge = lowerJawHinge;

    // --- Mouth floor / cargo placement surface — a plain static plate,
    // always physically present (so anything inside always has something
    // to rest on) but only VISIBLE/usable once the mouth is actually open
    // (see onArrived/onDeparting) — Three.js raycasting skips invisible
    // objects, so PickupSystem's placement-preview simply can never find a
    // valid hit here while closed, with no extra gating code needed. */
    const floorGeo = new THREE.BoxGeometry(mouthHalfX * 2, 0.05, mouthHalfZ * 2);
    const mouthFloor = new THREE.Mesh(floorGeo, cavityMat);
    mouthFloor.position.set(0, mouthCenterY - mouthHalfY, 0);
    mouthFloor.visible = false;
    this.vehicleGroup.add(mouthFloor);
    this.physics.addColliderToBody(this.body, 0, mouthCenterY - mouthHalfY, 0, mouthHalfX, 0.05, mouthHalfZ);
    this.cargoBedTopMesh = mouthFloor;
    this.frogMouthFloorMesh = mouthFloor;

    // cargoBayBounds needs no X/Z offset — see this method's own doc
    // comment for why the mouth is centered exactly on the group's own
    // tracked position.
    this.cargoBayBounds = {
      centerX: 0,
      centerZ: 0,
      bedFloorY: mouthCenterY - mouthHalfY,
      bedTopY: mouthCenterY + mouthHalfY,
      halfX: mouthHalfX,
      halfZ: mouthHalfZ,
    };

    // Starts closed, facing its known fixed arrival heading immediately —
    // avoids a one-frame flash of the default (unrotated) orientation
    // before the first moveToward() call corrects it.
    this.vehicleGroup.rotation.y = Math.PI;
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
   * it has arrived (within a small epsilon). For the frog only ("Rebuild
   * frog vehicle as hopping mouth cargo carrier" round三), ALSO layers a
   * distance-synced hop arc onto the VISUAL group's own Y (never the
   * physics kinematic body, which stays flat at y=0 the whole time — see
   * the constructor's own doc comment) and continuously faces the group
   * toward its current travel direction (spec: "轉向出口方向" falls out of
   * this for free, since the frog's fixed route reverses direction exactly
   * once, between arriving and departing). Every other vehicle's own
   * behavior here is byte-for-byte identical to before this round. */
  moveToward(target: { x: number; z: number }, deltaTime: number, pinnedCargo: InteractableObject[]): boolean {
    const pos = this.vehicleGroup.position;
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < ARRIVE_EPS) {
      if (this.isFrog) { pos.y = 0; this.frogHopDistanceAccum = 0; }
      return true;
    }

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

    const arrived = Math.sqrt((target.x - pos.x) ** 2 + (target.z - pos.z) ** 2) < ARRIVE_EPS;

    if (this.isFrog) {
      if (arrived) {
        pos.y = 0;
        this.frogHopDistanceAccum = 0;
      } else {
        this.frogHopDistanceAccum = (this.frogHopDistanceAccum + step) % FROG_HOP_DISTANCE;
        const hopPhase = this.frogHopDistanceAccum / FROG_HOP_DISTANCE;
        pos.y = Math.sin(hopPhase * Math.PI) * FROG_HOP_HEIGHT;
      }
      this.vehicleGroup.rotation.y = Math.atan2(dx, dz);
    }

    return arrived;
  }

  /** Per-frame animation upkeep unrelated to path-following (called every
   * frame regardless of arriving/docked/departing — see
   * VehicleControlSystem.updateSlot) — currently only the frog's own
   * mouth-angle lerp toward whatever onArrived()/onDeparting() last set as
   * the target; a no-op for every other vehicle. */
  update(deltaTime: number): void {
    if (!this.isFrog || !this.frogLowerJawHinge) return;
    const maxStep = FROG_MOUTH_ANGULAR_SPEED * deltaTime;
    const diff = this.frogMouthTargetAngle - this.frogMouthAngle;
    if (Math.abs(diff) <= maxStep) {
      this.frogMouthAngle = this.frogMouthTargetAngle;
    } else {
      this.frogMouthAngle += Math.sign(diff) * maxStep;
    }
    // Opens DOWNWARD — a positive local-X rotation tips the hinge's own
    // forward-offset jaw mesh down and away from the fixed upper jaw.
    this.frogLowerJawHinge.rotation.x = this.frogMouthAngle;
  }

  /** Fires once, the moment this slot transitions into 'docked' (see
   * VehicleControlSystem.updateSlot) — a no-op for every vehicle except the
   * frog, which starts swinging its lower jaw open (spec四) and reveals its
   * mouth floor as a valid placement surface (see buildFrogVehicle's own
   * doc comment on why toggling `.visible` alone is enough gating). */
  onArrived(): void {
    if (!this.isFrog) return;
    this.frogMouthTargetAngle = FROG_MOUTH_OPEN_ANGLE;
    if (this.frogMouthFloorMesh) this.frogMouthFloorMesh.visible = true;
  }

  /** Fires once, the moment this slot transitions into 'departing' (spec
   * 五: "先停止裝貨"是既有state-gated的scanCargoForShipment已經自動處理，
   * "青蛙把嘴巴閉起來"就是這裡) — a no-op for every vehicle except the frog,
   * which starts closing its jaw, hides the (now-unreachable) placement
   * surface, and hides whatever cargo is riding along pinned to this slot
   * (spec六: "不要讓貨物看起來卡住或懸空" — the alternative, leaving pinned
   * boxes visibly floating in front of a now-closed mouth, reads far worse
   * than simply having the frog "swallow" them for the hop out). */
  onDeparting(pinnedCargo: InteractableObject[]): void {
    if (!this.isFrog) return;
    this.frogMouthTargetAngle = 0;
    if (this.frogMouthFloorMesh) this.frogMouthFloorMesh.visible = false;
    for (const obj of pinnedCargo) obj.mesh.visible = false;
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
