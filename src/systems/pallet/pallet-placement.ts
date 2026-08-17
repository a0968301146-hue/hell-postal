import * as THREE from 'three';
import { PalletDimensions } from './pallet-data';
import { BACK_AREA, WORLD_BOUNDS } from '../world-layout';

/** How far in front of the camera the pallet's carry position sits, PLUS the
 * union bounds' own horizontal half-extent (so a bigger load sits further
 * away — spec 四: "需要依托盤與托盤貨物的 union bounds 動態調整距離"). */
const CARRY_BASE_FORWARD_DIST = 1.0;
/** How far below eye level the union bounds' CENTER sits while walking. */
const CARRY_DROP_BELOW_EYE = 0.45;
/** Never let the union bounds' bottom get closer than this to the floor
 * while WALKING. */
const CARRY_MIN_FLOOR_CLEARANCE = 0.15;
/** Never let the union bounds' top rise above camera eye level by more than
 * this. */
const CARRY_MAX_ABOVE_EYE = 0.35;
/** Minimum horizontal clearance between the carry center and the camera. */
const MIN_CAMERA_CLEARANCE = 0.6;

/**
 * Pure placement/carry math for PalletSystem — extracted as a "Phase 2 大型
 * 檔案拆分" round ("computeUnionBounds"/"computeCarryTransform"/"isExcluded"),
 * every formula below is unchanged from its original pallet-system.ts private
 * method form. Never imports pallet-system.ts.
 */

/** Union AABB (in the pallet's own local space) of the pallet's own bed plus
 * every currently-pinned item's own footprint — same min/max-accumulation
 * math as the original `computeUnionBounds`, just returning the result
 * instead of mutating an instance's Vector3 fields in place. */
export function computeUnionBoundsFromPinned(
  dimensions: PalletDimensions,
  pinned: { localPos: THREE.Vector3; obj: { width: number; height: number; depth: number } }[]
): { halfExtents: THREE.Vector3; centerOffset: THREE.Vector3 } {
  const { width, height, depth } = dimensions;
  let minX = -width / 2, maxX = width / 2;
  let minY = -height / 2, maxY = height / 2;
  let minZ = -depth / 2, maxZ = depth / 2;

  for (const p of pinned) {
    const hw = p.obj.width / 2, hh = p.obj.height / 2, hd = p.obj.depth / 2;
    minX = Math.min(minX, p.localPos.x - hw); maxX = Math.max(maxX, p.localPos.x + hw);
    minY = Math.min(minY, p.localPos.y - hh); maxY = Math.max(maxY, p.localPos.y + hh);
    minZ = Math.min(minZ, p.localPos.z - hd); maxZ = Math.max(maxZ, p.localPos.z + hd);
  }

  return {
    halfExtents: new THREE.Vector3((maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2),
    centerOffset: new THREE.Vector3((maxX + minX) / 2, (maxY + minY) / 2, (maxZ + minZ) / 2),
  };
}

/** Given a THREE.Object3D hit and a list of root objects to ignore, walks the
 * `.parent` chain to decide whether the hit belongs to one of those roots —
 * pure tree-walk, no instance state. */
export function isExcluded(obj: THREE.Object3D, excludeRoots: THREE.Object3D[]): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (excludeRoots.includes(cur)) return true;
    cur = cur.parent;
  }
  return false;
}

/** Where the currently-held pallet's carry position/rotation should sit this
 * frame, given the camera and the pallet's own union bounds — same formulas
 * as the original `computeCarryTransform`, just taking `placementYaw` (a
 * PalletSystem class field) as an explicit parameter instead of reading
 * `this.placementYaw` directly. */
export function computeCarryTransform(params: {
  unionHalfExtents: THREE.Vector3;
  unionLocalCenterOffset: THREE.Vector3;
  placementYaw: number;
  cameraPosition: THREE.Vector3;
  cameraForward: THREE.Vector3;
}): { pos: THREE.Vector3; quat: THREE.Quaternion } | null {
  const { unionHalfExtents, unionLocalCenterOffset, placementYaw, cameraPosition, cameraForward } = params;

  const flat = new THREE.Vector3(cameraForward.x, 0, cameraForward.z);
  if (flat.lengthSq() < 1e-6) return null;
  flat.normalize();

  const horizExtent = Math.max(unionHalfExtents.x, unionHalfExtents.z);
  const forwardDist = Math.max(CARRY_BASE_FORWARD_DIST, MIN_CAMERA_CLEARANCE) + horizExtent;
  const targetX = cameraPosition.x + flat.x * forwardDist;
  const targetZ = cameraPosition.z + flat.z * forwardDist;
  const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placementYaw);

  const desiredCenterY = cameraPosition.y - CARRY_DROP_BELOW_EYE;
  const minCenterY = BACK_AREA.floorY + CARRY_MIN_FLOOR_CLEARANCE + unionHalfExtents.y;
  const maxCenterY = cameraPosition.y + CARRY_MAX_ABOVE_EYE - unionHalfExtents.y;
  const centerY = THREE.MathUtils.clamp(desiredCenterY, minCenterY, Math.max(minCenterY, maxCenterY));
  const targetY = centerY - unionLocalCenterOffset.y;

  return { pos: new THREE.Vector3(targetX, targetY, targetZ), quat };
}

/** The union bounds' own half-width/half-depth as seen from directly above,
 * once rotated by the pallet's current placement yaw — same rotated-AABB
 * projection formula as the original inline fragment inside
 * `checkPlacementValidity`. `halfH` passes through unrotated (yaw is
 * world-Y-only, so vertical extent never changes). */
export function getRotatedPalletFootprint(
  halfExtents: THREE.Vector3, yaw: number
): { halfW: number; halfD: number; halfH: number } {
  const cos = Math.abs(Math.cos(yaw));
  const sin = Math.abs(Math.sin(yaw));
  return {
    halfW: halfExtents.x * cos + halfExtents.z * sin,
    halfD: halfExtents.x * sin + halfExtents.z * cos,
    halfH: halfExtents.y,
  };
}

/** True while a footprint centered at `center` with the given rotated
 * half-width/half-depth stays entirely inside `WORLD_BOUNDS` — same
 * comparison as the original inline fragment inside `checkPlacementValidity`. */
export function isWithinWorldBounds(center: THREE.Vector3, halfW: number, halfD: number): boolean {
  return !(
    center.x - halfW < WORLD_BOUNDS.minX || center.x + halfW > WORLD_BOUNDS.maxX ||
    center.z - halfD < WORLD_BOUNDS.minZ || center.z + halfD > WORLD_BOUNDS.maxZ
  );
}
