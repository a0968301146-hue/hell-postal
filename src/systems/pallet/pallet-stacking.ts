import * as THREE from 'three';
import { PalletDimensions, PALLET_DETECT_HEIGHT } from './pallet-data';

/**
 * Pure stacking/support-detection math for PalletSystem — extracted as a
 * "Phase 2 大型檔案拆分" round. The BFS traversal, layer-1 zone test, and
 * layer-2+ AABB-overlap test below are byte-for-byte the same algorithm as
 * the original `findSupportedCargoRecursive` private method; only the input/
 * output shape changed, from live `InteractableObject`/`interactables` Map
 * reads to plain candidate data. Candidate collection (filtering
 * `interactables` by pallet/rack id, held/visible state, and
 * `cargoSystem.getCargoData` shapeType) stays in pallet-system.ts, since that
 * part is inherently a live-registry query. Never imports pallet-system.ts.
 */

/** One box/large cargo item's plain-data footprint, as seen from a pallet's
 * own candidate-collection pass. `localPos` is the item's position in the
 * PALLET's own local space (used for the layer-1 top-surface zone test,
 * rotation-aware); `worldPos` is its raw scene position — the SAME
 * `mesh.position` reference the original algorithm's layer-2+ AABB overlap
 * test reads directly, un-transformed by the pallet's own rotation (an
 * existing property of the original algorithm, preserved as-is here). */
export interface CargoStackCandidate {
  id: string;
  localPos: THREE.Vector3;
  worldPos: THREE.Vector3;
  halfWidth: number;
  halfHeight: number;
  halfDepth: number;
}

/** True while `localPos` (already pallet-local-space) falls within the
 * pallet's own top-surface detection zone — the SAME formula both
 * `findSupportedCargo`'s own layer-1 pass and `updateOrganizeScan`
 * (pallet-system.ts) use, factored out once both were confirmed to be
 * exact duplicates of each other. */
export function isCargoInPalletDetectionZone(localPos: THREE.Vector3, dimensions: PalletDimensions): boolean {
  const { width, depth, height } = dimensions;
  const innerHW = width / 2;
  const innerHD = depth / 2;
  return (
    localPos.x >= -innerHW && localPos.x <= innerHW &&
    localPos.z >= -innerHD && localPos.z <= innerHD &&
    localPos.y >= height / 2 - 0.05 && localPos.y <= height / 2 + PALLET_DETECT_HEIGHT
  );
}

/** Recursive (iterative BFS, not function recursion) multi-layer support
 * detection — layer 1 is direct contact with the pallet's own top face
 * (`isCargoInPalletDetectionZone`); every subsequent layer is found by
 * testing every not-yet-supported candidate against every already-supported
 * item's own world-space AABB (vertical gap -0.03~0.12m, real XZ footprint
 * overlap), repeating until a pass finds nothing new. `supportedIds` is the
 * visited-set cycle/duplicate guard; there is no max-layer cap. Returns the
 * supported candidates' own ids, in the same discovery order as the
 * original. */
export function findSupportedCargo(dimensions: PalletDimensions, candidates: CargoStackCandidate[]): string[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));

  const supported: string[] = [];
  const supportedIds = new Set<string>();

  // Layer 1: cargo resting directly on the pallet's own top surface.
  for (const cand of candidates) {
    if (isCargoInPalletDetectionZone(cand.localPos, dimensions)) {
      supported.push(cand.id);
      supportedIds.add(cand.id);
    }
  }

  // Layers 2+: cargo resting on top of already-supported cargo, found via
  // real world-space AABB overlap (vertical gap + XZ footprint overlap),
  // repeated breadth-first until a pass adds nothing new.
  let frontier = supported.slice();
  while (frontier.length > 0) {
    const nextFrontier: string[] = [];
    for (const supportId of frontier) {
      const support = byId.get(supportId)!;
      const sTop = support.worldPos.y + support.halfHeight;
      const sMinX = support.worldPos.x - support.halfWidth, sMaxX = support.worldPos.x + support.halfWidth;
      const sMinZ = support.worldPos.z - support.halfDepth, sMaxZ = support.worldPos.z + support.halfDepth;

      for (const cand of candidates) {
        if (supportedIds.has(cand.id)) continue;
        const cBottom = cand.worldPos.y - cand.halfHeight;
        const gap = cBottom - sTop;
        if (gap < -0.03 || gap > 0.12) continue;

        const cMinX = cand.worldPos.x - cand.halfWidth, cMaxX = cand.worldPos.x + cand.halfWidth;
        const cMinZ = cand.worldPos.z - cand.halfDepth, cMaxZ = cand.worldPos.z + cand.halfDepth;
        const overlapsXZ = cMinX < sMaxX && cMaxX > sMinX && cMinZ < sMaxZ && cMaxZ > sMinZ;
        if (!overlapsXZ) continue;

        supported.push(cand.id);
        supportedIds.add(cand.id);
        nextFrontier.push(cand.id);
      }
    }
    frontier = nextFrontier;
  }

  return supported;
}
