// Shared low-level scene-building helpers used across MULTIPLE world-layout
// areas — extracted from world-layout-system.ts during the "world-layout
// per-area modularization" round (pure move, no behavior change). Kept as a
// dependency-free-of-the-other-area-files leaf module so every area builder
// file can depend on it without any area file needing to import another
// area file directly (avoids both a world-layout-system.ts <-> area-file
// cycle and a builder-A <-> builder-B cycle).
import * as THREE from 'three';
import { PhysicsWorldPort } from '../../shared/types/physics-world-port';

export function stdMat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, ...opts });
}

/** Box wall segment with a matching Rapier static collider. */
export function addWall(
  scene: THREE.Scene, physics: PhysicsWorldPort, material: THREE.Material,
  x: number, y: number, z: number, sx: number, sy: number, sz: number
): void {
  const geo = new THREE.BoxGeometry(Math.max(sx, 0.01), Math.max(sy, 0.01), Math.max(sz, 0.01));
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  physics.createStaticCuboid(x, y, z, sx / 2, sy / 2, sz / 2);
}

export const WOOD_DECK_MAT = () => stdMat(0x8b5a2b);
export const WOOD_DARK_MAT = () => stdMat(0x5a3d20);

/** Low lantern — a small wood-topped glass-look cylinder with a faint
 * emissive glow (decorative only, no actual THREE.PointLight — keeps this
 * simple, "不需要複雜動畫"). Shared by both the fishing pier and the Day6
 * sea interaction platform. */
export function buildFishingLantern(scene: THREE.Scene, pos: THREE.Vector3): void {
  const bodyHeight = 0.18;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.1, bodyHeight, 8),
    stdMat(0xffdd88, { emissive: 0x442200 })
  );
  body.position.set(pos.x, pos.y + bodyHeight / 2, pos.z);
  scene.add(body);

  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.08, 8), WOOD_DARK_MAT());
  cap.position.set(pos.x, pos.y + bodyHeight + 0.04, pos.z);
  scene.add(cap);
}
