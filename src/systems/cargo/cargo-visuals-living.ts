// Visual construction for 'live' category cargo shape presets — split out of
// cargo-visuals.ts during the "cargo-visuals per-category modularization"
// round (pure move, no behavior change). See cargo-visuals.ts's own
// buildCargoShapeMesh() for the dispatch entry point that calls into this.
import * as THREE from 'three';
import { CargoShapePreset } from './cargo-shape-presets';
import { cornerPosts, darken, stdMat } from './cargo-visuals-shared';

/** Live-cargo cage — the ONLY visualKind category E ever uses (spec E: "只能
 * 使用鐵籠外型"); the four live presets vary purely by preset.dimensions
 * (small/standard/tall/wide proportions), never by a different builder.
 * Root mesh is the floor plate (geometry translated to the true bottom, same
 * technique as buildHollowCrate) so the collider — a plain bounding cuboid
 * sized from preset.dimensions in cargo-system.ts — still fully encloses the
 * bars/roof/creature-silhouette children above it. */
export function buildCage(preset: CargoShapePreset): THREE.Mesh {
  const { width: w, height: h, depth: d } = preset.dimensions;
  const barColor = preset.color;
  const floorH = h * 0.06;
  const floorGeo = new THREE.BoxGeometry(w, floorH, d);
  floorGeo.translate(0, -h / 2 + floorH / 2, 0);
  const mesh = new THREE.Mesh(floorGeo, stdMat(darken(barColor, 0.3)));

  mesh.add(cornerPosts(w, h, d, Math.min(w, d) * 0.05, barColor));

  const roofGeo = new THREE.BoxGeometry(w, floorH * 0.6, d);
  const roof = new THREE.Mesh(roofGeo, stdMat(darken(barColor, 0.15)));
  roof.position.y = h / 2 - floorH * 0.3;
  mesh.add(roof);

  // Horizontal bars on all 4 sides, three rungs high — "鐵籠欄杆".
  const barThickness = Math.min(w, d) * 0.025;
  for (const ry of [-h * 0.28, 0, h * 0.28]) {
    for (const axis of ['x', 'z'] as const) {
      for (const sign of [1, -1]) {
        const barGeo = axis === 'x' ? new THREE.BoxGeometry(w, barThickness, barThickness) : new THREE.BoxGeometry(barThickness, barThickness, d);
        const bar = new THREE.Mesh(barGeo, stdMat(barColor));
        if (axis === 'x') bar.position.set(0, ry, sign * (d / 2 - barThickness / 2));
        else bar.position.set(sign * (w / 2 - barThickness / 2), ry, 0);
        mesh.add(bar);
      }
    }
  }

  // Simple creature silhouette — a squashed dark ellipsoid on the floor.
  // Visual only, no AI/rigidbody of its own (spec E: "只做視覺").
  const creature = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, d) * 0.28, 8, 6), stdMat(0x14100c));
  creature.scale.set(1, 0.6, 1.3);
  creature.position.y = -h / 2 + floorH + Math.min(w, d) * 0.16;
  mesh.add(creature);

  return mesh;
}
