// Visual construction for 'normal' category cargo shape presets (closed-box,
// barrel, spool) — split out of cargo-visuals.ts during the "cargo-visuals
// per-category modularization" round (pure move, no behavior change). See
// cargo-visuals.ts's own buildCargoShapeMesh() for the dispatch entry point
// that calls into these.
import * as THREE from 'three';
import { CargoShapePreset } from './cargo-shape-presets';
import { darken, stdMat } from './cargo-visuals-shared';

/** Open cylindrical metal band wrapping a barrel/crate at a given local Y. */
function metalBand(radius: number, thickness: number, y: number, color = 0x3a3a38): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius * 1.03, radius * 1.03, thickness, 14, 1, true);
  const band = new THREE.Mesh(geo, stdMat(color, { side: THREE.DoubleSide }));
  band.position.y = y;
  return band;
}

export function buildClosedBox(preset: CargoShapePreset): THREE.Mesh {
  const { width: w, height: h, depth: d } = preset.dimensions;
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMat(preset.color));
}

export function buildBarrel(preset: CargoShapePreset): THREE.Mesh {
  const length = preset.dimensions.width;
  const radius = preset.dimensions.height / 2;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 16), stdMat(preset.color));
  for (const fy of [-length * 0.26, length * 0.26]) mesh.add(metalBand(radius, length * 0.08, fy));
  return mesh;
}

export function buildSpool(preset: CargoShapePreset): THREE.Mesh {
  const length = preset.dimensions.width;
  const radius = preset.dimensions.height / 2;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 16), stdMat(preset.color));
  const rimGeo = new THREE.CylinderGeometry(radius * 1.18, radius * 1.18, 0.03, 16);
  const darkMat = stdMat(darken(preset.color, 0.45));
  for (const fy of [-length / 2 + 0.015, length / 2 - 0.015]) {
    const rim = new THREE.Mesh(rimGeo, darkMat);
    rim.position.y = fy;
    mesh.add(rim);
  }
  return mesh;
}
