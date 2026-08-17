// Visual construction for 'frozen' category cargo shape presets (frost-crate,
// frost-crate-fish, frost-metal-box, frost-herb-box) — split out of
// cargo-visuals.ts during the "cargo-visuals per-category modularization"
// round (pure move, no behavior change). See cargo-visuals.ts's own
// buildCargoShapeMesh() for the dispatch entry point that calls into these.
import * as THREE from 'three';
import { CargoShapePreset } from './cargo-shape-presets';
import { darken, glowShard, lighten, stdMat } from './cargo-visuals-shared';

/** Ice-crystal rim + rune-shard accents shared by every frost-category
 * preset (spec四 冷凍: "結霜邊緣...冰晶符文...淡色低溫材質"). */
function addFrostAccents(mesh: THREE.Mesh, w: number, h: number, d: number, count = 6): void {
  for (let i = 0; i < count; i++) {
    const shard = glowShard(Math.min(w, d) * 0.05, 0xdff3ff, 0x9fd8f0);
    const angle = (i / count) * Math.PI * 2;
    shard.position.set(Math.cos(angle) * w * 0.42, h / 2 - 0.005, Math.sin(angle) * d * 0.42);
    mesh.add(shard);
  }
}

export function buildFrostCrate(preset: CargoShapePreset): THREE.Mesh {
  const { width: w, height: h, depth: d } = preset.dimensions;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMat(preset.color));
  const frostCap = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, h * 0.06, d * 1.02), stdMat(lighten(preset.color, 0.5), { transparent: true, opacity: 0.75 }));
  frostCap.position.y = h / 2 - h * 0.02;
  mesh.add(frostCap);
  addFrostAccents(mesh, w, h, d, 6);
  return mesh;
}

export function buildFishBadge(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(30,70,90,0.85)';
  ctx.beginPath();
  ctx.roundRect(4, 4, 88, 88, 12);
  ctx.fill();
  ctx.strokeStyle = '#dff3ff';
  ctx.fillStyle = '#dff3ff';
  ctx.lineWidth = 4;
  const c = 48;
  // Simple fish silhouette — body ellipse + tail triangle.
  ctx.beginPath();
  ctx.ellipse(c - 6, c, 26, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(c + 18, c);
  ctx.lineTo(c + 34, c - 14);
  ctx.lineTo(c + 34, c + 14);
  ctx.closePath();
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}

export function buildFrostCrateFish(preset: CargoShapePreset): THREE.Mesh {
  const { width: w, height: h, depth: d } = preset.dimensions;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMat(preset.color));
  const frostCap = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, h * 0.06, d * 1.02), stdMat(lighten(preset.color, 0.5), { transparent: true, opacity: 0.75 }));
  frostCap.position.y = h / 2 - h * 0.02;
  mesh.add(frostCap);
  addFrostAccents(mesh, w, h, d, 5);

  const texture = buildFishBadge();
  const badgeSize = Math.max(0.08, Math.min(w, h) * 0.4);
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(badgeSize, badgeSize), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
  badge.position.set(0, 0, d / 2 + 0.006);
  badge.renderOrder = 3;
  mesh.add(badge);
  return mesh;
}

export function buildFrostMetalBox(preset: CargoShapePreset): THREE.Mesh {
  const { width: w, height: h, depth: d } = preset.dimensions;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMat(preset.color, { metalness: 0.4, roughness: 0.5 }));
  // Corner gussets + rivet studs read as "metal", distinct from the wood
  // frost crates' plank-and-cap treatment above.
  const gussetColor = darken(preset.color, 0.3);
  const gussetGeo = new THREE.BoxGeometry(w * 0.16, h * 0.16, 0.01);
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      const gusset = new THREE.Mesh(gussetGeo, stdMat(gussetColor, { metalness: 0.5, roughness: 0.4 }));
      gusset.position.set(sx * w * 0.32, sy * h * 0.32, d / 2 + 0.006);
      mesh.add(gusset);
      const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 6), stdMat(0xd0d0d0, { metalness: 0.7 }));
      stud.rotation.x = Math.PI / 2;
      stud.position.set(sx * w * 0.32, sy * h * 0.32, d / 2 + 0.014);
      mesh.add(stud);
    }
  }
  addFrostAccents(mesh, w, h, d, 4);
  return mesh;
}

export function buildFrostHerbBox(preset: CargoShapePreset): THREE.Mesh {
  const { width: w, height: h, depth: d } = preset.dimensions;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMat(preset.color));
  // Small recessed "window" panel + herb tufts peeking through it (spec:
  // "可從小型開口看到低溫藥草") — a darker inset plane rather than a real
  // geometric hole, keeping this a single solid collider-friendly box.
  const windowSize = Math.min(w, h) * 0.4;
  const window_ = new THREE.Mesh(new THREE.PlaneGeometry(windowSize, windowSize), stdMat(0x1a2a22));
  window_.position.set(0, 0, d / 2 + 0.004);
  mesh.add(window_);
  const herbColors = [0x4a8a5a, 0x6aa06a, 0x3a7a4f];
  for (let i = 0; i < 4; i++) {
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(windowSize * 0.08, windowSize * 0.32, 6), stdMat(herbColors[i % herbColors.length]));
    tuft.position.set((Math.random() - 0.5) * windowSize * 0.6, -windowSize * 0.2 + windowSize * 0.16, d / 2 + 0.01);
    tuft.rotation.z = (Math.random() - 0.5) * 0.5;
    mesh.add(tuft);
  }
  addFrostAccents(mesh, w, h, d, 4);
  return mesh;
}
