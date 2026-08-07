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
// Reusable "parts" (plank/metal band/rope/cage bar/bottle/ice shard/...) are
// shared across many visualKinds, but every preset combines them at
// different proportions/positions (spec四: "可以共用零件，但每個外型需由不同
// 組合與比例形成") — never the same base geometry just recolored.
import * as THREE from 'three';
import { CargoShapePreset, CargoVisualKind } from './cargo-shape-presets';
import { CargoCategory } from './cargo-category-data';
import { faceTransform, FaceId } from './cargo-label-visuals';

function darken(color: number, amount: number): number {
  const c = new THREE.Color(color);
  c.multiplyScalar(1 - amount);
  return c.getHex();
}

function lighten(color: number, amount: number): number {
  const c = new THREE.Color(color);
  c.lerp(new THREE.Color(0xffffff), amount);
  return c.getHex();
}

function stdMat(color: number, extra?: Partial<THREE.MeshStandardMaterialParameters>): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, ...extra });
}

// --- Shared parts ---------------------------------------------------------

/** Open cylindrical metal band wrapping a barrel/crate at a given local Y. */
function metalBand(radius: number, thickness: number, y: number, color = 0x3a3a38): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius * 1.03, radius * 1.03, thickness, 14, 1, true);
  const band = new THREE.Mesh(geo, stdMat(color, { side: THREE.DoubleSide }));
  band.position.y = y;
  return band;
}

/** A thin flat box "strap" wrapping a BOX-shaped crate (metal band's square
 * equivalent — used by large-crate/ore-crate instead of a cylindrical band). */
function boxStrap(w: number, d: number, thickness: number, y: number, color = 0x3a3a38): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(w * 1.03, thickness, d * 1.03), stdMat(color)));
  g.position.y = y;
  return g;
}

/** A short rope tie — a thin torus, used for lashing large-cargo bundles. */
function ropeTie(radius: number, tube: number, color = 0x8a7040): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 6, 12), stdMat(color));
  return mesh;
}

/** Four vertical corner posts spanning the full height — the "open lattice"
 * frame used by hollow crates, large racks, and cages alike. */
function cornerPosts(w: number, h: number, d: number, postSize: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(postSize, h, postSize);
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const post = new THREE.Mesh(geo, stdMat(color));
      post.position.set(sx * (w / 2 - postSize / 2), 0, sz * (d / 2 - postSize / 2));
      g.add(post);
    }
  }
  return g;
}

/** A small emissive shard (magic glow accent) — used by frost/ore/timber
 * presets that need a "faintly glowing" reading without a real particle
 * system (spec四 冷凍: "暫時不要製作昂貴粒子效果...可使用簡單透明冰晶或靜態
 * 霜面"). */
function glowShard(size: number, color: number, emissive: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(size, 0),
    new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.6, transparent: true, opacity: 0.85 })
  );
  return mesh;
}

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
function buildHollowCrate(dims: { width: number; height: number; depth: number }, color: number, buildContent: (w: number, h: number, d: number, color: number) => THREE.Object3D): THREE.Mesh {
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

// --- Individual visualKind builders ---------------------------------------

function buildClosedBox(preset: CargoShapePreset): THREE.Mesh {
  const { width: w, height: h, depth: d } = preset.dimensions;
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMat(preset.color));
}

function buildFragileBadge(): THREE.CanvasTexture {
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

function buildClosedBoxFragile(preset: CargoShapePreset): THREE.Mesh {
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

function buildBarrel(preset: CargoShapePreset): THREE.Mesh {
  const length = preset.dimensions.width;
  const radius = preset.dimensions.height / 2;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 16), stdMat(preset.color));
  for (const fy of [-length * 0.26, length * 0.26]) mesh.add(metalBand(radius, length * 0.08, fy));
  return mesh;
}

function buildSpool(preset: CargoShapePreset): THREE.Mesh {
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

/** Day8 finale's own one-off cargo item — a giant, short/squat, UPRIGHT
 * cylindrical cake box ("每日特殊劇情系統" round, spec: "外觀像放大版的蛋糕
 * 盒"). Unlike buildBarrel/buildSpool above, `width`/`depth` here are read as
 * the literal diameter and `height` as the literal upright height — it never
 * rolls (spawned via spawnDailyBox with a box collider + uprightRequired,
 * see cargo-shape-presets.ts's own doc comment on the 'giant-cake-box'
 * preset for why colliderKind stays 'box' despite the round mesh). */
function buildCakeBox(preset: CargoShapePreset): THREE.Mesh {
  const { width: w, height: h, depth: d } = preset.dimensions;
  const radius = Math.max(w, d) / 2;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, h, 24), stdMat(preset.color));
  const ribbon = new THREE.Mesh(new THREE.TorusGeometry(radius, h * 0.06, 8, 24), stdMat(darken(preset.color, 0.3)));
  ribbon.rotation.x = Math.PI / 2;
  // Tagged so AfterWorkStorySystem's own Day8 unwrap animation (spec:
  // "Day8巨型蛋糕物流化" round — F now unwraps THIS real cargo item directly,
  // no separate decorative prop) can find this exact child without relying
  // on fixed child-array indices.
  ribbon.userData.role = 'cakeRibbon';
  mesh.add(ribbon);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.03, radius * 1.03, h * 0.08, 24), stdMat(darken(preset.color, 0.15)));
  lid.position.y = h / 2 + h * 0.04;
  lid.userData.role = 'cakeLid';
  mesh.add(lid);
  return mesh;
}

function buildLargeCrate(preset: CargoShapePreset): THREE.Mesh {
  const { width: w, height: h, depth: d } = preset.dimensions;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMat(preset.color));
  mesh.add(cornerPosts(w, h, d, w * 0.05, darken(preset.color, 0.4)));
  mesh.add(boxStrap(w, d, h * 0.08, h * 0.22, darken(preset.color, 0.5)));
  mesh.add(boxStrap(w, d, h * 0.08, -h * 0.22, darken(preset.color, 0.5)));
  return mesh;
}

function buildCarpetRoll(preset: CargoShapePreset): THREE.Mesh {
  const { width: w, height: h, depth: d } = preset.dimensions;
  const radius = Math.min(w, h) / 2;
  const geo = new THREE.CylinderGeometry(radius, radius, d, 14);
  geo.rotateX(Math.PI / 2); // local Y (length) -> local Z, matching `depth`
  const mesh = new THREE.Mesh(geo, stdMat(preset.color));
  for (const fz of [-d * 0.32, 0, d * 0.32]) {
    const tie = ropeTie(radius * 1.05, radius * 0.09, 0x6a5a30);
    tie.rotation.x = Math.PI / 2;
    tie.position.z = fz;
    mesh.add(tie);
  }
  const endMat = stdMat(lighten(preset.color, 0.2));
  for (const fz of [-d / 2 + 0.008, d / 2 - 0.008]) {
    const cap = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.97, 14), endMat);
    cap.position.z = fz;
    cap.rotation.y = fz > 0 ? Math.PI / 2 : -Math.PI / 2;
    mesh.add(cap);
  }
  return mesh;
}

function buildFurnitureRack(preset: CargoShapePreset): THREE.Mesh {
  const { width: w, height: h, depth: d } = preset.dimensions;
  const baseH = h * 0.1;
  const baseGeo = new THREE.BoxGeometry(w, baseH, d);
  baseGeo.translate(0, -h / 2 + baseH / 2, 0);
  const mesh = new THREE.Mesh(baseGeo, stdMat(preset.color));
  mesh.add(cornerPosts(w, h, d, Math.min(w, d) * 0.06, darken(preset.color, 0.35)));

  // Strapped-on "cabinet" — a body box + two shorter legs.
  const cabinetColor = lighten(preset.color, 0.15);
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, h * 0.55, d * 0.5), stdMat(cabinetColor));
  cabinet.position.y = -h / 2 + baseH + h * 0.28;
  mesh.add(cabinet);
  for (const sx of [1, -1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(w * 0.05, h * 0.12, d * 0.05), stdMat(darken(cabinetColor, 0.3)));
    leg.position.set(sx * w * 0.22, -h / 2 + baseH + h * 0.06, d * 0.18);
    mesh.add(leg);
  }
  // Diagonal rope lashings tying the cabinet to the frame.
  for (const sx of [1, -1]) {
    const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, h * 0.5, 5), stdMat(0x8a7040));
    tie.position.set(sx * w * 0.3, 0, d * 0.3);
    tie.rotation.z = sx * 0.4;
    mesh.add(tie);
  }
  return mesh;
}

function buildStatueRack(preset: CargoShapePreset): THREE.Mesh {
  const { width: w, height: h, depth: d } = preset.dimensions;
  const baseH = h * 0.08;
  const baseGeo = new THREE.BoxGeometry(w, baseH, d);
  baseGeo.translate(0, -h / 2 + baseH / 2, 0);
  const mesh = new THREE.Mesh(baseGeo, stdMat(preset.color));
  mesh.add(cornerPosts(w, h, d, Math.min(w, d) * 0.07, darken(preset.color, 0.35)));

  // Statue figure — pedestal + torso + head, deliberately weighted upward
  // (spec: "重心較高") since most of the visual mass sits in the top third.
  const stoneColor = 0x9a978c;
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(w * 0.3, h * 0.12, d * 0.3), stdMat(darken(stoneColor, 0.15)));
  pedestal.position.y = -h / 2 + baseH + h * 0.06;
  mesh.add(pedestal);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.14, w * 0.18, h * 0.5, 8), stdMat(stoneColor));
  torso.position.y = -h / 2 + baseH + h * 0.12 + h * 0.25;
  mesh.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(w * 0.13, 8, 6), stdMat(stoneColor));
  head.position.y = -h / 2 + baseH + h * 0.12 + h * 0.5 + w * 0.1;
  mesh.add(head);

  // Rope wraps binding statue to frame posts, at two heights.
  for (const fy of [h * 0.05, h * 0.3]) {
    for (const sx of [1, -1]) {
      const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, w * 0.7, 5), stdMat(0x8a7040));
      tie.position.set(0, fy, sx * 0);
      tie.rotation.z = Math.PI / 2;
      tie.position.x = 0;
      tie.position.y = fy;
      tie.position.z = sx * (d / 2 - 0.05);
      mesh.add(tie);
    }
  }
  return mesh;
}

function buildOreCrate(preset: CargoShapePreset): THREE.Mesh {
  const { width: w, height: h, depth: d } = preset.dimensions;
  const wallH = h * 0.7;
  const wallGeo = new THREE.BoxGeometry(w, wallH, d);
  wallGeo.translate(0, -h / 2 + wallH / 2, 0);
  const mesh = new THREE.Mesh(wallGeo, stdMat(preset.color));
  mesh.add(boxStrap(w, d, h * 0.06, -h / 2 + wallH * 0.3, darken(preset.color, 0.5)));
  mesh.add(boxStrap(w, d, h * 0.06, -h / 2 + wallH * 0.75, darken(preset.color, 0.5)));
  mesh.add(cornerPosts(w, h * 0.75, d, Math.min(w, d) * 0.05, darken(preset.color, 0.4)));

  // Glowing ore chunks peeking above the crate's shortened walls.
  const oreColors = [0x9a6fe0, 0x6fc0e0, 0xe0a06f];
  for (let i = 0; i < 5; i++) {
    const chunk = glowShard(Math.min(w, d) * 0.09, oreColors[i % oreColors.length], oreColors[i % oreColors.length]);
    chunk.position.set((Math.random() - 0.5) * w * 0.6, -h / 2 + wallH + Math.min(w, d) * 0.05, (Math.random() - 0.5) * d * 0.6);
    mesh.add(chunk);
  }
  return mesh;
}

function buildTimberBundle(preset: CargoShapePreset): THREE.Mesh {
  const { width: w, height: h, depth: d } = preset.dimensions;
  const logRadius = Math.min(w, h) * 0.16;
  const emissiveColor = lighten(preset.color, 0.4);
  const logMat = new THREE.MeshStandardMaterial({ color: preset.color, emissive: emissiveColor, emissiveIntensity: 0.35 });

  const rootGeo = new THREE.CylinderGeometry(logRadius, logRadius, d, 10);
  rootGeo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(rootGeo, logMat);

  const offsets: [number, number][] = [
    [logRadius * 1.6, 0], [-logRadius * 1.6, 0],
    [logRadius * 0.8, logRadius * 1.4], [-logRadius * 0.8, logRadius * 1.4],
    [logRadius * 0.8, -logRadius * 1.4], [-logRadius * 0.8, -logRadius * 1.4],
  ];
  for (const [ox, oy] of offsets) {
    if (Math.abs(ox) > w / 2 - logRadius || Math.abs(oy) > h / 2 - logRadius) continue;
    const log = new THREE.Mesh(rootGeo.clone(), logMat);
    log.position.set(ox, oy, 0);
    mesh.add(log);
  }

  for (const fz of [-d * 0.3, 0, d * 0.3]) {
    const tie = ropeTie(Math.min(w, h) * 0.42, Math.min(w, h) * 0.05, 0x6a5a30);
    tie.rotation.x = Math.PI / 2;
    tie.position.z = fz;
    mesh.add(tie);
  }
  return mesh;
}

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

function buildFrostCrate(preset: CargoShapePreset): THREE.Mesh {
  const { width: w, height: h, depth: d } = preset.dimensions;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMat(preset.color));
  const frostCap = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, h * 0.06, d * 1.02), stdMat(lighten(preset.color, 0.5), { transparent: true, opacity: 0.75 }));
  frostCap.position.y = h / 2 - h * 0.02;
  mesh.add(frostCap);
  addFrostAccents(mesh, w, h, d, 6);
  return mesh;
}

function buildFishBadge(): THREE.CanvasTexture {
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

function buildFrostCrateFish(preset: CargoShapePreset): THREE.Mesh {
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

function buildFrostMetalBox(preset: CargoShapePreset): THREE.Mesh {
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

function buildFrostHerbBox(preset: CargoShapePreset): THREE.Mesh {
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

/** Live-cargo cage — the ONLY visualKind category E ever uses (spec E: "只能
 * 使用鐵籠外型"); the four live presets vary purely by preset.dimensions
 * (small/standard/tall/wide proportions), never by a different builder.
 * Root mesh is the floor plate (geometry translated to the true bottom, same
 * technique as buildHollowCrate) so the collider — a plain bounding cuboid
 * sized from preset.dimensions in cargo-system.ts — still fully encloses the
 * bars/roof/creature-silhouette children above it. */
function buildCage(preset: CargoShapePreset): THREE.Mesh {
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

const HOLLOW_CRATE_BUILDERS: Partial<Record<CargoVisualKind, (w: number, h: number, d: number, color: number) => THREE.Object3D>> = {
  'hollow-crate-potion': potionContent,
  'hollow-crate-milk': milkContent,
  'hollow-crate-alchemy': alchemyContent,
  'hollow-crate-lamp': lampContent,
  'hollow-crate-ceramic': ceramicContent,
  'hollow-crate-perfume': perfumeContent,
};

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

