// Visual construction for cargo shape presets ("Organize and expand cargo
// shape presets" round) — replaces the old subtype-keyed decorateCargoMesh/
// attachCargoSubtypeLabel with a preset-keyed mesh FACTORY (buildCargoShapeMesh
// builds the entire root mesh, not just decorations onto an externally-built
// box) plus the same category-label-badge attach pattern as before.
//
// Every builder returns a single THREE.Mesh (the root, whose geometry the
// Rapier collider does NOT need to exactly match — cargo-system.ts sizes the
// physics body from preset.dimensions directly, same as it always has for
// the mail bag's own Lathe-vs-compound-collider mismatch) with all
// decoration/content parts attached as plain Object3D children (spec四: "不
// 要為裝飾物建立大量 Collider" — none of them own a collider of their own),
// so everything still moves/rotates/persists for free through
// pickup/placement/throw/pallet-carry/vehicle-travel via the normal Three.js
// scene graph, exactly like every other cargo item already does.
//
// "cargo-visuals per-category modularization" round — this file used to
// contain every builder function for every visualKind directly (759 lines).
// The individual per-category builders now live in their own files
// (cargo-visuals-normal.ts / -fragile.ts / -large.ts / -frozen.ts /
// -living.ts, one per CargoCategory), and the handful of low-level parts
// shared across MULTIPLE categories (darken/lighten/stdMat/cornerPosts/
// glowShard) live in cargo-visuals-shared.ts — a dependency-free leaf module,
// specifically so those 5 category files can depend on it without this file
// needing to depend on them for anything but their exported builder
// functions (avoids a file-level import cycle). This file keeps only the
// dispatch entry point (buildCargoShapeMesh) and the category-label-badge
// system (attachCargoPresetLabel and friends), neither of which is specific
// to any one cargo type. Pure move — no builder's geometry/material/position
// values changed during the split.
import * as THREE from 'three';
import { CargoShapePreset } from './cargo-shape-presets';
import { CargoCategory } from './cargo-category-data';
import { faceTransform, FaceId } from './cargo-label-visuals';
import { buildClosedBox, buildBarrel, buildSpool } from './cargo-visuals-normal';
import { buildClosedBoxFragile, buildHollowCrate, HOLLOW_CRATE_BUILDERS } from './cargo-visuals-fragile';
import {
  buildCakeBox, buildLargeCrate, buildCarpetRoll, buildFurnitureRack, buildStatueRack, buildOreCrate, buildTimberBundle,
} from './cargo-visuals-large';
import { buildFrostCrate, buildFrostCrateFish, buildFrostMetalBox, buildFrostHerbBox } from './cargo-visuals-frozen';
import { buildCage } from './cargo-visuals-living';

/** The one entry point cargo-system.ts calls to build a preset's full root
 * mesh (spec四: "目前使用程式生成的低多邊形模型即可"). */
export function buildCargoShapeMesh(preset: CargoShapePreset): THREE.Mesh {
  switch (preset.visualKind) {
    case 'closed-box': return buildClosedBox(preset);
    case 'closed-box-fragile': return buildClosedBoxFragile(preset);
    case 'barrel': return buildBarrel(preset);
    case 'spool': return buildSpool(preset);
    case 'cake-box': return buildCakeBox(preset);
    case 'large-crate': return buildLargeCrate(preset);
    case 'carpet-roll': return buildCarpetRoll(preset);
    case 'furniture-rack': return buildFurnitureRack(preset);
    case 'statue-rack': return buildStatueRack(preset);
    case 'ore-crate': return buildOreCrate(preset);
    case 'timber-bundle': return buildTimberBundle(preset);
    case 'frost-crate': return buildFrostCrate(preset);
    case 'frost-crate-fish': return buildFrostCrateFish(preset);
    case 'frost-metal-box': return buildFrostMetalBox(preset);
    case 'frost-herb-box': return buildFrostHerbBox(preset);
    case 'cage': return buildCage(preset);
    default: {
      const contentBuilder = HOLLOW_CRATE_BUILDERS[preset.visualKind];
      if (contentBuilder) return buildHollowCrate(preset.dimensions, preset.color, contentBuilder);
      // Exhaustive by construction (every CargoVisualKind is handled above or
      // via HOLLOW_CRATE_BUILDERS) — this branch only exists as a defensive
      // fallback so a future unmapped visualKind still spawns SOMETHING
      // rather than throwing.
      return buildClosedBox(preset);
    }
  }
}

// --- Category label ---------------------------------------------------

const CARGO_CATEGORY_LABEL_BG: Record<CargoCategory, string> = {
  normal: 'rgba(120, 90, 45, 0.92)',
  fragile: 'rgba(160, 50, 40, 0.92)',
  large: 'rgba(70, 55, 130, 0.92)',
  frozen: 'rgba(50, 108, 128, 0.92)',
  live: 'rgba(45, 100, 70, 0.92)',
};

function buildLabelTexture(text: string, bg: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 120, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 64);
  return new THREE.CanvasTexture(canvas);
}

function clampSize(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function buildBoxLabelMesh(face: FaceId, label: string, bg: string, halfW: number, halfH: number, halfD: number): THREE.Mesh {
  const { pos, rot, faceW, faceH } = faceTransform(face, halfW, halfH, halfD);
  const texture = buildLabelTexture(label, bg);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const w = clampSize(faceW * 0.7, 0.16, 0.5);
  const h = w * 0.5;
  const geo = new THREE.PlaneGeometry(Math.min(w, faceW * 0.9), Math.min(h, faceH * 0.6));
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(pos);
  mesh.rotation.copy(rot);
  mesh.renderOrder = 3;
  mesh.userData.cargoPresetLabel = true;
  return mesh;
}

/** Attaches the visible category-label badge(s) every daily cargo item
 * spawns with, exactly as before ("貨品外型與比例有更多變化" round 九/十),
 * just reading a CargoShapePreset instead of the old subtype/shapeType pair.
 * Box/large/cage-collider items get two copies (front + top); cylinder
 * (barrel/spool) items get one on the barrel's own local +Z pole. Fixed at
 * spawn, never edited afterward (no labeling desk/UI touches daily cargo). */
export function attachCargoPresetLabel(mesh: THREE.Mesh, preset: CargoShapePreset): void {
  const bg = CARGO_CATEGORY_LABEL_BG[preset.category];
  const { width, height, depth } = preset.dimensions;

  if (preset.colliderKind === 'cylinder') {
    const radius = height / 2;
    const texture = buildLabelTexture(preset.displayName, bg);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    const size = clampSize(radius * 1.1, 0.14, 0.4);
    const badge = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.5), material);
    badge.position.set(0, 0, radius + 0.006);
    badge.renderOrder = 3;
    badge.userData.cargoPresetLabel = true;
    mesh.add(badge);
    return;
  }

  const halfW = width / 2, halfH = height / 2, halfD = depth / 2;
  mesh.add(buildBoxLabelMesh('front', preset.displayName, bg, halfW, halfH, halfD));
  if (halfH > 0.1) {
    mesh.add(buildBoxLabelMesh('top', preset.displayName, bg, halfW, halfH, halfD));
  }
}
