// Shared low-level visual building blocks used across MULTIPLE cargo
// categories — extracted from cargo-visuals.ts during the "cargo-visuals
// per-category modularization" round specifically to avoid a circular
// import: cargo-visuals.ts (the dispatch entry point) needs to import each
// category's builder functions, so if these cross-category helpers stayed
// in cargo-visuals.ts, every category file would need to import back from
// it, forming a file-level cycle. This file has zero internal imports — a
// leaf node every category builder file depends on, never the reverse.
import * as THREE from 'three';

export function darken(color: number, amount: number): number {
  const c = new THREE.Color(color);
  c.multiplyScalar(1 - amount);
  return c.getHex();
}

export function lighten(color: number, amount: number): number {
  const c = new THREE.Color(color);
  c.lerp(new THREE.Color(0xffffff), amount);
  return c.getHex();
}

export function stdMat(color: number, extra?: Partial<THREE.MeshStandardMaterialParameters>): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, ...extra });
}

/** Four vertical corner posts spanning the full height — the "open lattice"
 * frame used by hollow crates, large racks, and cages alike. */
export function cornerPosts(w: number, h: number, d: number, postSize: number, color: number): THREE.Group {
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
export function glowShard(size: number, color: number, emissive: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(size, 0),
    new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.6, transparent: true, opacity: 0.85 })
  );
  return mesh;
}
