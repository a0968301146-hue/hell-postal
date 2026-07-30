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

/** Frog-only hopping/mouth tuning ("Refine frog carrier with upward-opening
 * mouth structure" round) — every other vehicle never reads any of these
 * (gated behind `this.isFrog` everywhere they're used below), so none of
 * this affects the other five vehicles' movement or appearance. */
const FROG_HOP_DISTANCE = 1.3; // meters of ground travel per hop arc
const FROG_HOP_HEIGHT = 0.35; // peak bob height, meters
/** The upperMouthLid hinges along a SIDE edge of the basin ("Enlarge frog
 * cargo mouth and route clearance" round — moved off the back edge, see
 * buildFrogVehicle's own doc comment for why) and extends across the width
 * when closed (local +X from the hinge). Rotating that hinge group around
 * local Z by a POSITIVE angle swings the lid's far edge UP to directly
 * above the hinge (negative would swing it down through the basin floor
 * instead) — this sign is specific to THIS hinge axis/offset combination;
 * it was negative under the previous round's back-hinge (local X rotation)
 * design, which is a different configuration, not a typo carried over. */
const FROG_MOUTH_OPEN_ANGLE = Math.PI / 2; // spec: "向上打開約90度"
const FROG_MOUTH_ANGULAR_SPEED = Math.PI; // rad/s lerp rate (~0.5s for a full 90° swing, within spec四's 0.4~0.7s)
const FROG_MOUTH_CLOSE_EPS = 0.02; // rad — "fully closed" tolerance that gates departure movement (spec四)
/** How high above BACK_AREA's floor the basin FLOOR (lowerMouthBase — the
 * stable cargo-carrying base, spec三) sits — a fixed absolute offset since
 * player reach is an absolute constraint, not one that should drift if
 * config.height is ever retuned (spec六: "玩家站在地面附近就能把貨物放進去"). */
const FROG_BASIN_FLOOR_Y_OFFSET = 0.5;

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
  private frogUpperJawHinge: THREE.Group | null = null;
  private frogLowerJawBase: THREE.Mesh | null = null;
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

  /** Builds a low, frog-shaped creature (bodyRoot: torso + headBase + 4
   * limbs + eyes) with an upward-opening biological mouth (lowerMouthBase:
   * a fixed basin floor + 4 short rim walls; upperMouthLid: a single lid
   * that swings UP to reveal a top-loading cargo cavity). Every mouth
   * dimension still comes from `this.config.cargoArea*` (spec: derive from
   * VehicleConfig, never a hand-duplicated size) — these mean the OPEN
   * BASIN's interior exactly, not a flatbed.
   *
   * Local layout convention (unchanged since the mouth was first rebuilt
   * upward-opening): the basin is centered at local (0, *, 0) — i.e.
   * exactly the vehicleGroup's own tracked X/Z position — with the body
   * trailing BEHIND it at negative local Z. This means `cargoBayBounds`
   * still needs no X/Z offset (centerX/centerZ: 0), so isInCargoBay() —
   * shared, unmodified code — keeps working correctly with zero changes of
   * its own. The frog's fixed route (vehicle-route-data.ts: straight line,
   * spawn south of the dock, exit back south) means local +Z always ends up
   * facing world -Z (north, toward the player interior) once docked, via
   * moveToward()'s continuous rotation-facing below.
   *
   * Upward-opening hinge derivation ("Enlarge frog cargo mouth and route
   * clearance" round: hinge moved from the basin's BACK edge to a SIDE
   * edge — with cargoAreaLength now 5.0m to fit the daily cargo quota, a
   * back-hinged lid spanning the full DEPTH would swing up to an absurd
   * ~5m height when open; hinging along the WIDTH edge instead keeps the
   * open height tied to the much shorter width, comfortably under
   * BACK_AREA's ceiling — see the lid-building code below for the exact
   * numbers). The hinge group sits at local (-mouthHalfX-overhang,
   * basinTopY, 0) — the LEFT-TOP edge of the basin — and the lid mesh is
   * offset toward +X from that pivot, so at rotation.z = 0 it lies flat
   * across the basin's open top, exactly covering it. Rotating a point at
   * offset d (along local +X) around local Z by θ maps it to
   * (d·cosθ, d·sinθ). A POSITIVE θ therefore makes the y-component positive
   * (lifts UP) while the x-component shrinks toward 0 (folds back to
   * directly above the hinge) — e.g. at θ=+90°, the lid's far tip ends up d
   * meters straight above the hinge, never sweeping forward, sideways, or
   * down through the basin. This sign is specific to this hinge axis/
   * offset combination — the previous round's back-hinge (local X
   * rotation) needed the opposite sign for the same "opens upward" result,
   * a different configuration, not an inconsistency. */
  private buildFrogVehicle(floorY: number): void {
    const config = this.config;
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf0f0ea });
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d0 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x262626 });

    const mouthHalfX = config.cargoAreaWidth / 2;
    const mouthHalfY = config.cargoAreaHeight / 2;
    const mouthHalfZ = config.cargoAreaLength / 2;
    const basinFloorY = floorY + FROG_BASIN_FLOOR_Y_OFFSET;
    const basinTopY = basinFloorY + mouthHalfY * 2;

    // bodyRoot (spec三) — purely organizational: groups every NON-mouth
    // part (torso/headBase/limbs/eyes) so the creature's structure is
    // literally inspectable as one unit, separate from the hinged lid.
    const bodyRoot = new THREE.Group();
    this.vehicleGroup.add(bodyRoot);

    // --- headBase: wide, flat skull that the basin sits on top of/inside
    // of (spec二: "寬而扁的頭部"). Its own top surface is exactly
    // basinFloorY, so the basin reads as embedded in the head, not a
    // separate floating box. Exactly matches the basin footprint on both
    // axes now (no extra overhang margin) — "Enlarge frog cargo mouth and
    // route clearance" round: with the basin now this wide/deep, any extra
    // margin here would eat directly into the rockgiant-neighbor width
    // budget (see vehicle-data.ts's own doc comment on this config) for no
    // real visual benefit. ---
    const headHalfX = mouthHalfX;
    const headHalfZ = mouthHalfZ;
    const headGeo = new THREE.BoxGeometry(headHalfX * 2, 0.5, headHalfZ * 2);
    const headBase = new THREE.Mesh(headGeo, skinMat);
    const headCenterY = floorY + 0.25;
    headBase.position.set(0, headCenterY, 0);
    bodyRoot.add(headBase);
    this.physics.addColliderToBody(this.body, 0, headCenterY, 0, headHalfX, 0.25, headHalfZ);

    // --- torso/body: low, thick oval trailing behind the head (spec二:
    // "身體低矮、橢圓厚實"). Width now scales proportionally with the head
    // (a fixed 1.1m cap made no sense once the basin/head routinely exceed
    // that on their own) but stays narrower than the head (natural taper,
    // also keeps the torso well clear of the rockgiant-neighbor width
    // budget even though the head/basin already define the tightest
    // margin). Z-depth trimmed from the previous round's 0.9 to 0.75 so the
    // now much-longer head doesn't push the torso's own rear past the south
    // wall line (BACK_AREA.maxZ=32) once docked. ---
    const torsoGeo = new THREE.SphereGeometry(1, 14, 10);
    const torso = new THREE.Mesh(torsoGeo, skinMat);
    const torsoScale = { x: headHalfX * 0.75, y: 0.55, z: 0.75 };
    torso.scale.set(torsoScale.x, torsoScale.y, torsoScale.z);
    const torsoCenterY = floorY + 0.55;
    const torsoCenterZ = -(headHalfZ + torsoScale.z - 0.15);
    torso.position.set(0, torsoCenterY, torsoCenterZ);
    bodyRoot.add(torso);
    this.physics.addColliderToBody(this.body, 0, torsoCenterY, torsoCenterZ, torsoScale.x, torsoScale.y, torsoScale.z);

    // --- 4 limbs: short and thick, hind legs bigger for the jumping read
    // (spec二: "四肢粗短，後腿較有力"). Purely visual — the head/torso
    // colliders above already cover this footprint (spec三: "可簡化"). ---
    const legMat = new THREE.MeshStandardMaterial({ color: 0xe4e4dc });
    const frontLegGeo = new THREE.CylinderGeometry(0.14, 0.17, 0.3, 8);
    const hindLegGeo = new THREE.CylinderGeometry(0.2, 0.24, 0.34, 8);
    const frontLegX = headHalfX * 0.7;
    const hindLegX = Math.max(torsoScale.x * 0.75, frontLegX * 0.9);
    for (const lx of [frontLegX, -frontLegX]) {
      const leg = new THREE.Mesh(frontLegGeo, legMat);
      leg.position.set(lx, floorY + 0.15, -headHalfZ * 0.3);
      bodyRoot.add(leg);
    }
    for (const lx of [hindLegX, -hindLegX]) {
      const leg = new THREE.Mesh(hindLegGeo, legMat);
      leg.position.set(lx, floorY + 0.17, torsoCenterZ - torsoScale.z * 0.5);
      bodyRoot.add(leg);
    }

    // --- eyes: bulge above the head, toward the back near the mouth hinge
    // (spec二: "眼睛位於頭部上方、略微突出"). ---
    const eyeGeo = new THREE.SphereGeometry(0.17, 10, 8);
    const pupilGeo = new THREE.SphereGeometry(0.08, 8, 6);
    const eyeY = basinTopY + 0.12;
    const eyeZ = -headHalfZ * 0.55;
    for (const ex of [0.34, -0.34]) {
      const eye = new THREE.Mesh(eyeGeo, skinMat);
      eye.position.set(ex, eyeY, eyeZ);
      bodyRoot.add(eye);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(ex, eyeY + 0.04, eyeZ + 0.13);
      bodyRoot.add(pupil);
    }

    // --- lowerMouthBase: the STABLE cargo-carrying base (spec三: "下顎與嘴
    // 腔底部應穩定固定，作為載貨基底"). Basin floor + 4 short rim walls,
    // all fixed (never rotate), all solid (spec七: 主要艙體/口腔底部要有效
    // 碰撞). Footprint is exactly mouthHalfX*2 × mouthHalfZ*2 — the same
    // numbers cargoBayBounds uses below, so the visible basin and the
    // placement-detection volume can never disagree (spec五). ---
    const wallT = 0.08;
    const wallH = mouthHalfY * 2;
    const wallCenterY = basinFloorY + wallH / 2;
    const floorGeo = new THREE.BoxGeometry(mouthHalfX * 2, 0.08, mouthHalfZ * 2);
    const basinFloor = new THREE.Mesh(floorGeo, mouthMat);
    basinFloor.position.set(0, basinFloorY, 0);
    basinFloor.visible = false; // revealed once docked — see onArrived()
    this.vehicleGroup.add(basinFloor);
    this.physics.addColliderToBody(this.body, 0, basinFloorY, 0, mouthHalfX, 0.04, mouthHalfZ);
    this.cargoBedTopMesh = basinFloor;
    this.frogLowerJawBase = basinFloor;

    const wallGeo1 = new THREE.BoxGeometry(mouthHalfX * 2, wallH, wallT); // back/front walls
    const wallGeo2 = new THREE.BoxGeometry(wallT, wallH, mouthHalfZ * 2); // left/right walls
    const wallSpecs: Array<[THREE.BoxGeometry, number, number, number, number, number]> = [
      [wallGeo1, 0, wallCenterY, -mouthHalfZ, mouthHalfX, wallT / 2], // back
      [wallGeo1, 0, wallCenterY, mouthHalfZ, mouthHalfX, wallT / 2], // front
      [wallGeo2, -mouthHalfX, wallCenterY, 0, wallT / 2, mouthHalfZ], // left
      [wallGeo2, mouthHalfX, wallCenterY, 0, wallT / 2, mouthHalfZ], // right
    ];
    for (const [geo, wx, wy, wz, chx, chz] of wallSpecs) {
      const wall = new THREE.Mesh(geo, mouthMat);
      wall.position.set(wx, wy, wz);
      this.vehicleGroup.add(wall);
      this.physics.addColliderToBody(this.body, wx, wy, wz, chx, wallH / 2, chz);
    }

    // --- upperMouthLid: the ONLY moving part. "Enlarge frog cargo mouth
    // and route clearance" round: hinged along the basin's SIDE edge now,
    // not the back edge — with cargoAreaLength grown to 5.0m, a
    // back-hinged lid spanning the FULL depth would swing up to
    // basinTopY+~5.1m when open (past the 6m ceiling once the basin's own
    // Y offset is added), which is exactly the "rotation converts the
    // lid's own length into an equal vertical rise" trap the old back-hinge
    // design was tuned around for a much shallower basin. Hinging along the
    // WIDTH edge instead (rotating around local Z, not X) makes the open
    // height scale with WIDTH (2.8m) instead of DEPTH (5.0m) — a much
    // shorter, ceiling-safe swing — while still opening straight UP (spec:
    // "向上打開"), just folding along the basin's long axis instead of its
    // short one. No collider (活動嘴部可不參與貨物碰撞，優先穩定裝貨體驗) —
    // purely visual, so it can never shove loaded cargo around as it
    // swings. Slightly overhangs the rim walls on every side so it seals
    // the basin cleanly when closed. */
    const lidOverhang = 0.04;
    const lidLength = mouthHalfX * 2 + lidOverhang * 2;
    const upperJawHinge = new THREE.Group();
    upperJawHinge.position.set(-mouthHalfX - lidOverhang, basinTopY, 0);
    this.vehicleGroup.add(upperJawHinge);
    const lidGeo = new THREE.BoxGeometry(lidLength, 0.08, mouthHalfZ * 2 + wallT * 2);
    const upperMouthLid = new THREE.Mesh(lidGeo, mouthMat);
    upperMouthLid.position.set(lidLength / 2, 0, 0); // offset toward +X from the hinge pivot — see doc comment
    upperJawHinge.add(upperMouthLid);
    this.frogUpperJawHinge = upperJawHinge;

    // cargoBayBounds needs no X/Z offset (see this method's own doc
    // comment) — footprint and height match the visible basin EXACTLY
    // (spec五: "位置、寬度、深度、高度要與可見嘴腔空間一致"), no fudge
    // factor in any dimension.
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
    if (!this.isFrog || !this.frogUpperJawHinge) return;
    const maxStep = FROG_MOUTH_ANGULAR_SPEED * deltaTime;
    const diff = this.frogMouthTargetAngle - this.frogMouthAngle;
    if (Math.abs(diff) <= maxStep) {
      this.frogMouthAngle = this.frogMouthTargetAngle;
    } else {
      this.frogMouthAngle += Math.sign(diff) * maxStep;
    }
    // Opens UPWARD — a POSITIVE local-Z rotation lifts the hinge's own
    // +X-offset lid mesh straight up over the basin's rim, never forward/
    // sideways/down. Rotation axis changed from X to Z this round (see
    // buildFrogVehicle's own doc comment for why the hinge moved from the
    // back edge to a side edge, and the full sign derivation).
    this.frogUpperJawHinge.rotation.z = this.frogMouthAngle;
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
    if (this.frogLowerJawBase) this.frogLowerJawBase.visible = true;
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
    if (this.frogLowerJawBase) this.frogLowerJawBase.visible = false;
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
