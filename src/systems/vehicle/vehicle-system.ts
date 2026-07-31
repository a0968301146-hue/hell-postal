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

/** Frog-only hopping/mouth tuning ("Rebuild frog vehicle from concept
 * sketch" round) — every other vehicle never reads any of these (gated
 * behind `this.isFrog` everywhere they're used below), so none of this
 * affects the other five vehicles' movement or appearance. */
const FROG_HOP_DISTANCE = 1.3; // meters of ground travel per hop arc
const FROG_HOP_HEIGHT = 0.35; // peak bob height, meters
/** upperHeadShell hinges at the BACK-TOP of the basin (spec三: "從頭部後方
 * 鉸鏈") and its own geometry extends FORWARD (local +Z) from that pivot
 * when closed, so at rotation.x = 0 the shell sits flat over the basin's
 * open top, exactly covering it (matching the closed silhouette in the
 * sketch — one continuous round head, no visible seam). Rotating a point
 * at forward offset d around local X by θ maps it to (0, -d·sinθ, d·cosθ)
 * — a NEGATIVE θ makes the y-component positive (lifts UP) while the
 * z-component shrinks toward 0 (folds back to directly above the hinge),
 * e.g. at θ=-90° the shell's front tip ends up d meters straight above the
 * hinge, never sweeping forward/sideways/down through the basin. This
 * matches spec三's own explicit angle: "沿local X軸旋轉約-90°". */
const FROG_MOUTH_OPEN_ANGLE = -Math.PI / 2; // spec三: "沿local X軸旋轉約-90°"
const FROG_MOUTH_ANGULAR_SPEED = Math.PI; // rad/s lerp rate (~0.5s for a full 90° swing, within the 0.4~0.7s range used since the mouth was first rebuilt upward-opening)
const FROG_MOUTH_CLOSE_EPS = 0.02; // rad — "fully closed" tolerance that gates departure movement (spec八: "完全閉合後轉向")
/** How high above BACK_AREA's floor the basin FLOOR (lowerHeadAndJaw's own
 * cargo-carrying surface, spec六: "placement surface只註冊嘴腔底部") sits —
 * a fixed absolute offset matching spec五's own suggested figure exactly
 * ("嘴腔底板離地約0.45m"), since player reach is an absolute constraint,
 * not one that should drift if config.height is ever retuned. */
const FROG_BASIN_FLOOR_Y_OFFSET = 0.45;

/** "Resize cargo and improve frog mouth access" round — the mouth-entrance
 * ramp/threshold tuning. FROG_RAMP_RUN is the ramp's horizontal run; with
 * FROG_BASIN_FLOOR_Y_OFFSET (0.45) as its rise, the resulting slope
 * (~24°) is comfortably walkable without jumping and well under the
 * character controller's own autostep ceiling (physics-system.ts:
 * enableAutostep(0.3, ...) — a bare 0.45m ledge would NOT be climbable by
 * autostep alone, which is exactly why a true sloped collider is used here
 * instead of just shrinking the old front wall). FROG_RAMP_HALF_WIDTH
 * comfortably exceeds the player capsule's own radius (physics-system.ts
 * createPlayer: 0.35) with real margin on both sides (spec: "斜坡寬度至少
 * 能容納玩家Collider並保留左右安全距離"). FROG_FRONT_THRESHOLD_HEIGHT
 * replaces the previous round's proportional (mouthHalfY*0.7) front wall —
 * a small FIXED lip instead, low enough for autostep to cross without
 * blocking entry, matching spec三's "降低正面嘴唇高度". */
const FROG_RAMP_RUN = 1.0;
const FROG_RAMP_HALF_WIDTH = 0.8;
const FROG_FRONT_THRESHOLD_HEIGHT = 0.15;

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

  /** Frog-only state ("Refine frog carrier with upward-opening mouth
   * structure" round) — every field here stays at its default/no-op value,
   * and every method below that reads them is gated behind `isFrog`, for
   * the other five vehicles, which still go through the exact same generic
   * box-building branch this class always used. */
  private isFrog = false;
  private frogHopDistanceAccum = 0;
  private frogUpperHeadShell: THREE.Group | null = null;
  private frogBasinFloor: THREE.Mesh | null = null;
  private frogRampMesh: THREE.Mesh | null = null;
  private frogRampCollider: RAPIER.Collider | null = null;
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

  /** "Rebuild frog vehicle from concept sketch" round — a from-scratch
   * rebuild off the supplied sketch (a low, round, pot-bellied frog; the
   * open state shows a wide rounded bowl mouth, not a box), replacing the
   * previous rounds' flat-box-wall/flat-panel-lid look entirely. No mesh
   * or number here is a scaled copy of the old model.
   *
   * Structure (spec's own naming, used verbatim as the local variable/
   * comment names below): frogRoot contains fixedBody, lowerHeadAndJaw
   * (basin floor + rounded side/front/back shell), upperHeadShell (the ONE
   * moving part -- outer dome + inner lining + leftEye + rightEye, all
   * hinged together), frontLegs, rearLegs. Every mouth dimension still
   * comes from this.config.cargoArea* (never hand-duplicated) -- these mean
   * the OPEN BOWL's interior exactly, not a flatbed.
   *
   * Local layout convention (unchanged since the mouth was first rebuilt
   * upward-opening): the basin is centered at local (0, *, 0) -- i.e.
   * exactly the vehicleGroup's own tracked X/Z position -- with fixedBody
   * trailing BEHIND it at negative local Z. This means cargoBayBounds still
   * needs no X/Z offset (centerX/centerZ: 0), so isInCargoBay() -- shared,
   * unmodified code -- keeps working correctly with zero changes of its
   * own. The frog's fixed route (vehicle-route-data.ts: straight line,
   * spawn south of the dock, exit back south) means local +Z always ends up
   * facing world -Z (north, toward the player interior) once docked, via
   * moveToward()'s continuous rotation-facing below.
   *
   * Upward-opening hinge derivation -- see FROG_MOUTH_OPEN_ANGLE's own doc
   * comment above for the full rotation-sign derivation (the round's exact
   * request: hinge at the back, rotate local X by ~-90 degrees). Width
   * stays capped at the same budget the previous round established
   * (rockgiant neighbor clearance, see vehicle-data.ts's own doc comment on
   * this config) -- this round's suggested exterior width of ~6.0m would
   * physically overlap rockgiant's own dock footprint once both are docked,
   * so depth (which has real headroom) absorbs the capacity requirement
   * instead, same as before. The basin FLOOR stays a full flat rectangle
   * (maximizes usable placement area); only the WALLS switch from 4 flat
   * box panels to smooth curved tube arcs (CylinderGeometry partial arcs:
   * THREE's convention puts theta=0 at local +Z, so a
   * thetaStart=-45deg/thetaLength=90deg arc centered on local +Z gives the
   * front lip, and the complementary 270deg arc gives the taller
   * sides+back) -- this reads as rounded, multi-segment arc walls, not the
   * previous rounds' four vertical flat panels, even though the underlying
   * detection colliders stay simple boxes (explicitly allowed: the visible
   * mesh must be a rounded bowl, the collider can stay simplified). */
  private buildFrogVehicle(floorY: number): void {
    const config = this.config;
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x7ab35f });
    const cavityMat = new THREE.MeshStandardMaterial({ color: 0xc07a78, side: THREE.DoubleSide });
    const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf2efe0 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c });

    const mouthHalfX = config.cargoAreaWidth / 2;
    const mouthHalfY = config.cargoAreaHeight / 2;
    const mouthHalfZ = config.cargoAreaLength / 2;
    const basinFloorY = floorY + FROG_BASIN_FLOOR_Y_OFFSET;
    const basinTopY = basinFloorY + mouthHalfY * 2;

    // frogRoot: purely organizational, groups every FIXED part
    // (fixedBody/legs) separate from the hinged upperHeadShell.
    const frogRoot = new THREE.Group();
    this.vehicleGroup.add(frogRoot);

    // fixedBody: low, thick, round torso trailing behind the head. Its own
    // front edge tucks just under the head's back edge so there is no
    // visible gap between body and head.
    const bodyGeo = new THREE.SphereGeometry(1, 16, 12);
    const fixedBody = new THREE.Mesh(bodyGeo, skinMat);
    const bodyScale = { x: mouthHalfX * 0.8, y: 0.62, z: Math.min(mouthHalfX * 0.85, 0.85) };
    fixedBody.scale.set(bodyScale.x, bodyScale.y, bodyScale.z);
    const bodyCenterY = floorY + 0.6;
    const bodyCenterZ = -(mouthHalfZ + bodyScale.z - 0.25);
    fixedBody.position.set(0, bodyCenterY, bodyCenterZ);
    frogRoot.add(fixedBody);
    this.physics.addColliderToBody(this.body, 0, bodyCenterY, bodyCenterZ, bodyScale.x, bodyScale.y, bodyScale.z);

    // frontLegs / rearLegs: short front legs, thicker rear legs. Purely
    // visual -- fixedBody and the basin shell colliders below already
    // cover this footprint.
    const legMat = skinMat; // one continuous skin tone, no seam at the legs
    const frontLegGeo = new THREE.CylinderGeometry(0.12, 0.15, 0.28, 8);
    const rearLegGeo = new THREE.CylinderGeometry(0.19, 0.24, 0.34, 8);
    const frontLegX = mouthHalfX * 0.55;
    const frontLegZ = -mouthHalfZ * 0.25;
    const rearLegX = bodyScale.x * 0.85;
    const rearLegZ = bodyCenterZ - bodyScale.z * 0.55;
    for (const lx of [frontLegX, -frontLegX]) {
      const leg = new THREE.Mesh(frontLegGeo, legMat);
      leg.position.set(lx, floorY + 0.14, frontLegZ);
      frogRoot.add(leg);
    }
    for (const lx of [rearLegX, -rearLegX]) {
      const leg = new THREE.Mesh(rearLegGeo, legMat);
      leg.position.set(lx, floorY + 0.17, rearLegZ);
      frogRoot.add(leg);
    }

    // lowerHeadAndJaw: the STABLE cargo-carrying base. A flat floor (full
    // rectangle -- maximizes usable placement area) ringed by curved shell
    // arcs (front lip lower, sides+back taller, back connects to the
    // hinge). Every arc is an OUTER green skin layer (normal front-face
    // render) plus an INNER pink lining layer (DoubleSide, visible from
    // inside looking down into the bowl) -- two concentric shells rather
    // than one two-tone material.
    const shellRadialSegments = 20;
    const frontSpan = Math.PI / 2; // front lip covers roughly the front quarter of the rim
    const frontThetaStart = -frontSpan / 2; // centered on local +Z (theta=0 in CylinderGeometry)
    const sideBackThetaStart = frontSpan / 2;
    const sideBackSpan = Math.PI * 2 - frontSpan;
    const frontLipHeight = FROG_FRONT_THRESHOLD_HEIGHT; // spec三: "降低正面嘴唇高度" — a small fixed threshold, not proportional to cavity height
    const sideBackHeight = mouthHalfY * 2; // sides/back match the full cavity height, i.e. cargoBounds top exactly

    const buildShellArc = (thetaStart: number, thetaLength: number, height: number, innerLinerScale: number): THREE.Group => {
      const arcGroup = new THREE.Group();
      const outerGeo = new THREE.CylinderGeometry(1, 1, height, shellRadialSegments, 1, true, thetaStart, thetaLength);
      const outer = new THREE.Mesh(outerGeo, skinMat);
      outer.scale.set(mouthHalfX, 1, mouthHalfZ);
      arcGroup.add(outer);
      const innerGeo = new THREE.CylinderGeometry(1, 1, height, shellRadialSegments, 1, true, thetaStart, thetaLength);
      const inner = new THREE.Mesh(innerGeo, cavityMat);
      inner.scale.set(mouthHalfX * innerLinerScale, 1, mouthHalfZ * innerLinerScale);
      arcGroup.add(inner);
      return arcGroup;
    };

    const frontLip = buildShellArc(frontThetaStart, frontSpan, frontLipHeight, 0.94);
    frontLip.position.set(0, basinFloorY + frontLipHeight / 2, 0);
    this.vehicleGroup.add(frontLip);

    const sideBackWall = buildShellArc(sideBackThetaStart, sideBackSpan, sideBackHeight, 0.97);
    sideBackWall.position.set(0, basinFloorY + sideBackHeight / 2, 0);
    this.vehicleGroup.add(sideBackWall);

    // Basin floor -- the ONLY registered placement surface. Toggled
    // invisible while closed so PickupSystem's raycast-based placement
    // preview can never find a hit here until the shell is actually open.
    const floorGeo = new THREE.BoxGeometry(mouthHalfX * 2, 0.08, mouthHalfZ * 2);
    const basinFloor = new THREE.Mesh(floorGeo, cavityMat);
    basinFloor.position.set(0, basinFloorY, 0);
    basinFloor.visible = false;
    this.vehicleGroup.add(basinFloor);
    this.physics.addColliderToBody(this.body, 0, basinFloorY, 0, mouthHalfX, 0.04, mouthHalfZ);
    this.cargoBedTopMesh = basinFloor;
    this.frogBasinFloor = basinFloor;

    // Simplified detection colliders -- deliberately NOT shaped to match
    // the curved shell meshes exactly: four short boxes are enough to keep
    // cargo contained and the body solid. Front is shorter (matches the
    // visible low lip); back/left/right match the full cavity height.
    const wallT = 0.1;
    this.physics.addColliderToBody(this.body, 0, basinFloorY + frontLipHeight / 2, mouthHalfZ - wallT / 2, mouthHalfX, frontLipHeight / 2, wallT); // front lip
    this.physics.addColliderToBody(this.body, 0, basinFloorY + sideBackHeight / 2, -mouthHalfZ + wallT / 2, mouthHalfX, sideBackHeight / 2, wallT); // back
    this.physics.addColliderToBody(this.body, -mouthHalfX + wallT / 2, basinFloorY + sideBackHeight / 2, 0, wallT, sideBackHeight / 2, mouthHalfZ); // left
    this.physics.addColliderToBody(this.body, mouthHalfX - wallT / 2, basinFloorY + sideBackHeight / 2, 0, wallT, sideBackHeight / 2, mouthHalfZ); // right

    // Entrance ramp/tongue ("Resize cargo and improve frog mouth access"
    // round spec三): bridges ground level up to the basin floor right at
    // the front threshold, so the player can walk straight in without
    // jumping. Runs from local Z=mouthHalfZ (basin floor height, right
    // where the low front threshold sits) out to Z=mouthHalfZ+FROG_RAMP_RUN
    // (ground level) — the two ends land exactly on those two heights (see
    // this round's own derivation of the rotation angle below). Pink cavity
    // material (spec三: "斜坡使用粉紅色嘴腔材質"). Both mesh and collider
    // start hidden/disabled — only enabled while docked with the mouth open
    // (onArrived/onDeparting below), so the ramp can never be walked while
    // closed (spec三: "青蛙未停靠或嘴巴閉合時，斜坡/入口不可使用").
    const rampRise = FROG_BASIN_FLOOR_Y_OFFSET;
    const rampSlopeLength = Math.sqrt(FROG_RAMP_RUN * FROG_RAMP_RUN + rampRise * rampRise);
    const rampAngle = Math.atan2(rampRise, FROG_RAMP_RUN);
    const rampCenterY = floorY + rampRise / 2;
    const rampCenterZ = mouthHalfZ + FROG_RAMP_RUN / 2;
    const rampGeo = new THREE.BoxGeometry(FROG_RAMP_HALF_WIDTH * 2, 0.1, rampSlopeLength);
    const rampMesh = new THREE.Mesh(rampGeo, cavityMat);
    rampMesh.position.set(0, rampCenterY, rampCenterZ);
    rampMesh.rotation.x = rampAngle;
    rampMesh.visible = false;
    this.vehicleGroup.add(rampMesh);
    this.frogRampMesh = rampMesh;
    this.frogRampCollider = this.physics.addColliderToBodyRotatedX(
      this.body, 0, rampCenterY, rampCenterZ, FROG_RAMP_HALF_WIDTH, 0.05, rampSlopeLength / 2, rampAngle
    );
    this.frogRampCollider.setEnabled(false);

    // upperHeadShell: the ONLY moving part -- outer dome + inner lining +
    // both eyes, all hinged together so the eyes swing back with the shell
    // when it opens. Hinged at the basin's back-top edge; the dome's own
    // footprint matches the basin exactly, so when closed (rotation.x=0)
    // it fully seals the cavity -- no visible cargo-hold structure. No
    // collider on this whole group (the moving shell never participates in
    // cargo collision).
    const upperHeadShell = new THREE.Group();
    upperHeadShell.position.set(0, basinTopY, -mouthHalfZ);
    this.vehicleGroup.add(upperHeadShell);

    const domeHeightScale = mouthHalfY * 1.1; // gentle round bulge above the rim, matches the sketch's rounded head-top
    const domeOuterGeo = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeOuter = new THREE.Mesh(domeOuterGeo, skinMat);
    domeOuter.scale.set(mouthHalfX, domeHeightScale, mouthHalfZ);
    domeOuter.position.set(0, 0, mouthHalfZ); // spans hinge-local Z 0..2*mouthHalfZ, matching the basin's full depth
    upperHeadShell.add(domeOuter);

    const domeInnerGeo = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeInner = new THREE.Mesh(domeInnerGeo, cavityMat); // upper jaw inner lining
    domeInner.scale.set(mouthHalfX * 0.95, domeHeightScale * 0.9, mouthHalfZ * 0.95);
    domeInner.position.set(0, 0, mouthHalfZ);
    upperHeadShell.add(domeInner);

    // leftEye / rightEye: mounted on the shell, forward of the hinge and
    // toward the sides, so they swing back with the shell when it opens.
    const eyeGeo = new THREE.SphereGeometry(0.22, 12, 8);
    const pupilGeo = new THREE.SphereGeometry(0.1, 8, 6);
    const eyeForwardZ = mouthHalfZ * 1.25;
    const eyeY = domeHeightScale * 0.7;
    const eyeX = mouthHalfX * 0.6;
    for (const ex of [eyeX, -eyeX]) {
      const eye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
      eye.position.set(ex, eyeY, eyeForwardZ);
      upperHeadShell.add(eye);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(ex, eyeY + 0.05, eyeForwardZ + 0.16);
      upperHeadShell.add(pupil);
    }
    this.frogUpperHeadShell = upperHeadShell;

    // cargoBayBounds needs no X/Z offset (see this method's own doc
    // comment) -- footprint and height match the visible basin EXACTLY, no
    // fudge factor in any dimension.
    this.cargoBayBounds = {
      centerX: 0,
      centerZ: 0,
      bedFloorY: basinFloorY + 0.04, // top surface of the floor plate — where cargo actually rests
      bedTopY: basinTopY,
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
   * it has arrived (within a small epsilon). For the frog only, ALSO layers
   * a distance-synced hop arc onto the VISUAL group's own Y (never the
   * physics kinematic body, which stays flat at y=0 the whole time — see
   * the constructor's own doc comment) and continuously faces the group
   * toward its current travel direction (spec: "轉向出口方向" falls out of
   * this for free, since the frog's fixed route reverses direction exactly
   * once, between arriving and departing). Every other vehicle's own
   * behavior here is byte-for-byte identical to before this round.
   *
   * Frog-only departure gate ("Refine frog carrier with upward-opening
   * mouth structure" round, spec四: "先停止裝貨→關嘴巴→完全閉合後→再轉向出
   * 口→再開始跳躍"): while the mouth hasn't yet reached its (closed) target
   * angle, this returns false immediately without moving, turning, or
   * hopping at all. Since the caller (VehicleControlSystem.updateSlot)
   * already does nothing but return early on `!arrived`, this alone stalls
   * the whole departure sequence until update()'s per-frame lerp — which
   * runs regardless of state — brings the mouth fully shut; only then does
   * movement (and the rotation-to-travel-direction below, which doubles as
   * "turn to exit") resume. During arrival this is always a no-op, since
   * frogMouthAngle stays 0 the entire time onArrived() hasn't fired yet. */
  moveToward(target: { x: number; z: number }, deltaTime: number, pinnedCargo: InteractableObject[]): boolean {
    if (this.isFrog && Math.abs(this.frogMouthAngle) > FROG_MOUTH_CLOSE_EPS) {
      return false;
    }

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
    if (!this.isFrog || !this.frogUpperHeadShell) return;
    const maxStep = FROG_MOUTH_ANGULAR_SPEED * deltaTime;
    const diff = this.frogMouthTargetAngle - this.frogMouthAngle;
    if (Math.abs(diff) <= maxStep) {
      this.frogMouthAngle = this.frogMouthTargetAngle;
    } else {
      this.frogMouthAngle += Math.sign(diff) * maxStep;
    }
    // Opens UPWARD -- a NEGATIVE local-X rotation lifts the hinge's own
    // forward-offset shell up and back over the basin's rim, never
    // forward/sideways/down. See FROG_MOUTH_OPEN_ANGLE's own doc comment
    // for the full derivation.
    this.frogUpperHeadShell.rotation.x = this.frogMouthAngle;
  }

  /** Fires once, the moment this slot transitions into 'docked' (see
   * VehicleControlSystem.updateSlot) — a no-op for every vehicle except the
   * frog, which starts swinging its upperMouthLid open (spec四) and reveals
   * its basin floor as a valid placement surface (see buildFrogVehicle's
   * own doc comment on why toggling `.visible` alone is enough gating —
   * Three.js raycasting skips invisible objects, so PickupSystem's
   * placement-preview simply can never find a valid hit here while the
   * basin is still sealed under the closed lid). */
  onArrived(): void {
    if (!this.isFrog) return;
    this.frogMouthTargetAngle = FROG_MOUTH_OPEN_ANGLE;
    if (this.frogBasinFloor) this.frogBasinFloor.visible = true;
    if (this.frogRampMesh) this.frogRampMesh.visible = true;
    if (this.frogRampCollider) this.frogRampCollider.setEnabled(true);
  }

  /** Fires once, the moment this slot transitions into 'departing' (spec
   * 四: "先停止裝貨"是既有state-gated的scanCargoForShipment已經自動處理，
   * "青蛙把上顎關回來"就是這裡；moveToward()自己的departure gate負責"完全閉
   * 合後才轉向、才跳走") — a no-op for every vehicle except the frog, which
   * starts closing its lid, hides the (now-unreachable) placement surface,
   * and hides whatever cargo is riding along pinned to this slot (spec七:
   * 不要讓貨物看起來卡住或懸空 — the alternative, leaving pinned boxes
   * visibly floating in front of a now-closed mouth, reads far worse than
   * simply having the frog "swallow" them for the hop out). */
  onDeparting(pinnedCargo: InteractableObject[]): void {
    if (!this.isFrog) return;
    this.frogMouthTargetAngle = 0;
    if (this.frogBasinFloor) this.frogBasinFloor.visible = false;
    if (this.frogRampMesh) this.frogRampMesh.visible = false;
    if (this.frogRampCollider) this.frogRampCollider.setEnabled(false);
    for (const obj of pinnedCargo) obj.mesh.visible = false;
  }

  /** Frog-only ("Resize cargo and improve frog mouth access" round spec三:
   * "若玩家仍在青蛙嘴腔內，出發流程開始時先將玩家移到青蛙正前方的安全地面
   * 點"). Checks whether `playerPos` falls anywhere inside the mouth cavity
   * OR on the entrance ramp (a slightly more generous box than
   * cargoBayBounds alone, so a player still walking down the ramp is caught
   * too) — if so, returns a safe world-space ground point just beyond the
   * ramp's own base, clear of every collider, for the caller
   * (VehicleControlSystem.pressDepartButton) to teleport the player's
   * physics body to BEFORE this vehicle's mouth starts closing. Returns
   * null for every other vehicle, or if the player isn't actually inside —
   * the caller only acts on a non-null result, so this never nudges a
   * player who's nowhere near the frog. */
  getSafeExitPointIfPlayerInside(playerPos: { x: number; y: number; z: number }): { x: number; y: number; z: number } | null {
    if (!this.isFrog) return null;
    const mouthHalfX = this.config.cargoAreaWidth / 2;
    const mouthHalfZ = this.config.cargoAreaLength / 2;
    this.vehicleGroup.updateMatrixWorld(true);
    const local = this.vehicleGroup.worldToLocal(new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z));
    const insideX = Math.abs(local.x) <= mouthHalfX + 0.2;
    const insideZ = local.z >= -mouthHalfZ - 0.3 && local.z <= mouthHalfZ + FROG_RAMP_RUN + 0.3;
    if (!insideX || !insideZ) return null;
    const exitLocal = new THREE.Vector3(0, 0, mouthHalfZ + FROG_RAMP_RUN + 0.6);
    const exitWorld = this.vehicleGroup.localToWorld(exitLocal);
    return { x: exitWorld.x, y: BACK_AREA.floorY + 1.0, z: exitWorld.z };
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
