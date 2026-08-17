// Visual construction for 'fragile' category cargo shape presets
// (closed-box-fragile + the six hollow-crate-* content variants) — split out
// of cargo-visuals.ts during the "cargo-visuals per-category modularization"
// round (pure move, no behavior change). See cargo-visuals.ts's own
// buildCargoShapeMesh() for the dispatch entry point that calls into these.
import * as THREE from 'three';
import { CargoShapePreset, CargoVisualKind } from './cargo-shape-presets';
import { cornerPosts, darken, stdMat } from './cargo-visuals-shared';

/** One small bottle — cylinder body + a slightly narrower cap. Shared by
 * every hollow-crate content cluster, varied per-caller by size/color. */
function bottle(radius: number, height: number, bodyColor: number, capColor: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.9, height, 8), stdMat(bodyColor, { transparent: true, opacity: 0.85 }));
  body.position.y = height / 2;
  g.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, height * 0.18, 8), stdMat(capColor));
  cap.position.y = height + height * 0.09;
  g.add(cap);
  return g;
}

// --- Hollow-crate structural shell ---------------------------------------

/** Shared "open-top wooden crate" shell: a solid lower wall section (built by
 * translating the geometry down, leaving the mesh's own local origin at the
 * TRUE center so it still matches the full preset.dimensions collider), four
 * full-height corner posts, and two top-rim cross braces. `dims` is the
 * item's FULL bounding dimensions — the wall itself only fills the lower
 * ~55%, leaving the rest genuinely open so `content` (bottles/glassware/...)
 * reads as visibly sitting inside, poking out through the gaps (spec B: "瓶
 * 子、燈罩、陶瓷等內容物要從木條間露出"). */
export function buildHollowCrate(dims: { width: number; height: number; depth: number }, color: number, buildContent: (w: number, h: number, d: number, color: number) => THREE.Object3D): THREE.Mesh {
  const { width: w, height: h, depth: d } = dims;
  const wallH = h * 0.55;
  const wallGeo = new THREE.BoxGeometry(w, wallH, d);
  wallGeo.translate(0, -h / 2 + wallH / 2, 0);
  const mesh = new THREE.Mesh(wallGeo, stdMat(color));

  mesh.add(cornerPosts(w, h, d, Math.min(w, d) * 0.09, darken(color, 0.35)));

  // Top-rim cross braces (spec: "可加入...木隔板表現固定").
  const braceGeo = new THREE.BoxGeometry(w * 0.9, h * 0.05, d * 0.06);
  for (const fz of [d * 0.26, -d * 0.26]) {
    const brace = new THREE.Mesh(braceGeo, stdMat(darken(color, 0.35)));
    brace.position.set(0, h / 2 - h * 0.03, fz);
    mesh.add(brace);
  }

  // A couple of straw/rope wisps at the base for packing (spec: "可加入稻草、
  // 繩索...表現固定").
  const strawColor = 0xc9b26a;
  for (let i = 0; i < 3; i++) {
    const wisp = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, w * 0.5, 5), stdMat(strawColor));
    wisp.position.set((Math.random() - 0.5) * w * 0.4, -h / 2 + wallH * 0.15, (Math.random() - 0.5) * d * 0.4);
    wisp.rotation.z = Math.PI / 2 + (Math.random() - 0.5) * 0.6;
    wisp.rotation.y = Math.random() * Math.PI;
    mesh.add(wisp);
  }

  const content = buildContent(w, h, d, color);
  content.position.y = -h / 2 + wallH * 0.6;
  mesh.add(content);

  return mesh;
}

function potionContent(w: number, _h: number, d: number): THREE.Object3D {
  const g = new THREE.Group();
  const colors = [0x7a3fb0, 0x3fb07a, 0x3f7ab0, 0xb03f6a];
  for (let i = 0; i < 5; i++) {
    const b = bottle(Math.min(w, d) * 0.08, Math.min(w, d) * 0.5, colors[i % colors.length], 0x5a4a30);
    b.position.set((Math.random() - 0.5) * w * 0.55, 0, (Math.random() - 0.5) * d * 0.55);
    g.add(b);
  }
  return g;
}

function milkContent(w: number, _h: number, d: number): THREE.Object3D {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const b = bottle(Math.min(w, d) * 0.11, Math.min(w, d) * 0.46, 0xf2ede0, 0xdcdcdc);
    b.position.set((Math.random() - 0.5) * w * 0.5, 0, (Math.random() - 0.5) * d * 0.5);
    g.add(b);
  }
  return g;
}

function alchemyContent(w: number, _h: number, d: number): THREE.Object3D {
  const g = new THREE.Group();
  // Flasks — a sphere body sitting on a short neck, greenish glass tint.
  for (let i = 0; i < 4; i++) {
    const flask = new THREE.Group();
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, d) * 0.11, 8, 6), stdMat(0x6ab08a, { transparent: true, opacity: 0.7 }));
    bulb.position.y = Math.min(w, d) * 0.12;
    flask.add(bulb);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, d) * 0.03, Math.min(w, d) * 0.03, Math.min(w, d) * 0.2, 6), stdMat(0x6ab08a, { transparent: true, opacity: 0.7 }));
    neck.position.y = Math.min(w, d) * 0.12 + Math.min(w, d) * 0.2;
    flask.add(neck);
    flask.position.set((Math.random() - 0.5) * w * 0.5, 0, (Math.random() - 0.5) * d * 0.5);
    g.add(flask);
  }
  return g;
}

function lampContent(w: number, h: number, d: number, baseColor: number): THREE.Object3D {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, d) * 0.16, Math.min(w, d) * 0.2, h * 0.14, 8), stdMat(darken(baseColor, 0.3)));
  base.position.y = h * 0.07;
  g.add(base);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(Math.min(w, d) * 0.22, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xfff2c2, emissive: 0xffcf5a, emissiveIntensity: 0.7, transparent: true, opacity: 0.8 })
  );
  bulb.position.y = h * 0.14 + Math.min(w, d) * 0.22;
  g.add(bulb);
  return g;
}

function ceramicContent(w: number, _h: number, d: number): THREE.Object3D {
  const g = new THREE.Group();
  const clayColors = [0xb9865a, 0xc79a6d, 0xa8744a];
  for (let i = 0; i < 3; i++) {
    const vase = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, d) * 0.16, 8, 6), stdMat(clayColors[i % clayColors.length]));
    body.scale.y = 1.3;
    vase.add(body);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, d) * 0.05, Math.min(w, d) * 0.08, Math.min(w, d) * 0.14, 8), stdMat(clayColors[i % clayColors.length]));
    neck.position.y = Math.min(w, d) * 0.2;
    vase.add(neck);
    vase.position.set((Math.random() - 0.5) * w * 0.5, 0, (Math.random() - 0.5) * d * 0.5);
    g.add(vase);
  }
  return g;
}

function perfumeContent(w: number, _h: number, d: number): THREE.Object3D {
  const g = new THREE.Group();
  const colors = [0xd88fb0, 0xd8c08f, 0x8fc0d8];
  for (let i = 0; i < 6; i++) {
    const b = bottle(Math.min(w, d) * 0.05, Math.min(w, d) * 0.32, colors[i % colors.length], 0xc9a227);
    b.position.set((Math.random() - 0.5) * w * 0.6, 0, (Math.random() - 0.5) * d * 0.6);
    g.add(b);
  }
  return g;
}

// --- closed-box-fragile -----------------------------------------------

export function buildFragileBadge(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.roundRect(4, 4, 88, 88, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  // Wine-glass silhouette — "明顯易碎標誌".
  const c = 48;
  ctx.beginPath();
  ctx.moveTo(c - 16, c - 24);
  ctx.quadraticCurveTo(c - 16, c, c, c + 4);
  ctx.quadraticCurveTo(c + 16, c, c + 16, c - 24);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(c, c + 4);
  ctx.lineTo(c, c + 20);
  ctx.moveTo(c - 12, c + 26);
  ctx.lineTo(c + 12, c + 26);
  ctx.stroke();
  return new THREE.CanvasTexture(canvas);
}

export function buildClosedBoxFragile(preset: CargoShapePreset): THREE.Mesh {
  const { width: w, height: h, depth: d } = preset.dimensions;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMat(preset.color));
  const texture = buildFragileBadge();
  const badgeSize = Math.max(0.08, Math.min(w, h) * 0.35);
  const badge = new THREE.Mesh(
    new THREE.PlaneGeometry(badgeSize, badgeSize),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
  );
  badge.position.set(0, 0, d / 2 + 0.006);
  badge.renderOrder = 3;
  mesh.add(badge);
  // A second copy on top, same reasoning as the old subtype label's "front +
  // top" convention — reads clearly even when stacked.
  const badgeTop = badge.clone();
  badgeTop.rotation.x = -Math.PI / 2;
  badgeTop.position.set(0, h / 2 + 0.006, 0);
  mesh.add(badgeTop);
  return mesh;
}

export const HOLLOW_CRATE_BUILDERS: Partial<Record<CargoVisualKind, (w: number, h: number, d: number, color: number) => THREE.Object3D>> = {
  'hollow-crate-potion': potionContent,
  'hollow-crate-milk': milkContent,
  'hollow-crate-alchemy': alchemyContent,
  'hollow-crate-lamp': lampContent,
  'hollow-crate-ceramic': ceramicContent,
  'hollow-crate-perfume': perfumeContent,
};
