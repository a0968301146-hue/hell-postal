// Visual construction for 'large' category cargo shape presets (large-crate,
// carpet-roll, furniture-rack, statue-rack, ore-crate, timber-bundle, and
// the Day8 finale's giant-cake-box) — split out of cargo-visuals.ts during
// the "cargo-visuals per-category modularization" round (pure move, no
// behavior change). See cargo-visuals.ts's own buildCargoShapeMesh() for the
// dispatch entry point that calls into these.
//
// giant-cake-box's own preset declares `category: 'large'` (cargo-shape-
// presets.ts), so buildCakeBox lives here rather than in its own file —
// confirmed against the real preset data, not assumed from the name.
import * as THREE from 'three';
import { CargoShapePreset } from './cargo-shape-presets';
import { cornerPosts, darken, glowShard, lighten, stdMat } from './cargo-visuals-shared';

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

/** Day8 finale's own one-off cargo item — a giant, short/squat, UPRIGHT
 * cylindrical cake box ("每日特殊劇情系統" round, spec: "外觀像放大版的蛋糕
 * 盒"). Unlike buildBarrel/buildSpool, `width`/`depth` here are read as
 * the literal diameter and `height` as the literal upright height — it never
 * rolls (spawned via spawnDailyBox with a box collider + uprightRequired,
 * see cargo-shape-presets.ts's own doc comment on the 'giant-cake-box'
 * preset for why colliderKind stays 'box' despite the round mesh). */
export function buildCakeBox(preset: CargoShapePreset): THREE.Mesh {
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

export function buildLargeCrate(preset: CargoShapePreset): THREE.Mesh {
  const { width: w, height: h, depth: d } = preset.dimensions;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMat(preset.color));
  mesh.add(cornerPosts(w, h, d, w * 0.05, darken(preset.color, 0.4)));
  mesh.add(boxStrap(w, d, h * 0.08, h * 0.22, darken(preset.color, 0.5)));
  mesh.add(boxStrap(w, d, h * 0.08, -h * 0.22, darken(preset.color, 0.5)));
  return mesh;
}

export function buildCarpetRoll(preset: CargoShapePreset): THREE.Mesh {
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

export function buildFurnitureRack(preset: CargoShapePreset): THREE.Mesh {
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

export function buildStatueRack(preset: CargoShapePreset): THREE.Mesh {
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

export function buildOreCrate(preset: CargoShapePreset): THREE.Mesh {
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

export function buildTimberBundle(preset: CargoShapePreset): THREE.Mesh {
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
