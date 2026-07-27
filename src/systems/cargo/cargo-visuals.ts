// Visual variety for daily-flow cargo (spec "貨品外型與比例有更多變化" round):
// per-subtype decorative child meshes (straps/lids/handles/bands/frames) and
// the visible category-label badge every daily cargo item spawns with.
//
// Both follow the SAME "child of the main mesh" convention cargo-label-
// visuals.ts already established: decorations/labels are plain Object3D
// children of the cargo's one real THREE.Mesh (the one with the actual
// collider-matching geometry — see pickup-system.ts's reliance on
// `obj.mesh.geometry`), so they automatically move/rotate/persist through
// pickup/placement/throw/pallet-carry/vehicle-travel for free, with zero
// extra sync code and zero extra dynamic rigid bodies (spec 七: "不要為每個
// 裝飾建立大量動態剛體，裝飾零件應跟隨主貨物 Mesh").
import * as THREE from 'three';
import { CargoShapeType, CargoSubtype, CARGO_CATEGORY_LABEL_BG } from './cargo-data';
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

// --- Decoration -------------------------------------------------------

/** Adds subtype-specific decorative child meshes to a freshly-built cargo
 * mesh — called once at spawn (cargo-system.ts), right after the main
 * mesh/collider are created. `dims` are the item's own overall w/h/d (box/
 * large) so decorations scale with the actual instance, not a fixed size. */
export function decorateCargoMesh(mesh: THREE.Mesh, subtype: CargoSubtype, baseColor: number, dims: { width: number; height: number; depth: number }): void {
  const { width: w, height: h, depth: d } = dims;
  const darkMat = new THREE.MeshStandardMaterial({ color: darken(baseColor, 0.45) });
  const lightMat = new THREE.MeshStandardMaterial({ color: lighten(baseColor, 0.25) });

  const addStrap = (axis: 'x' | 'z', offset: number, thickness = 0.03) => {
    const geo = axis === 'x'
      ? new THREE.BoxGeometry(w * 1.02, thickness, d * 1.02)
      : new THREE.BoxGeometry(w * 1.02, h * 1.02, thickness);
    const strap = new THREE.Mesh(geo, darkMat);
    if (axis === 'x') strap.position.y = offset; else strap.position.z = offset;
    mesh.add(strap);
  };

  switch (subtype) {
    case 'small-box':
    case 'medium-box':
      // Plain crate — no extra decoration, size + label alone distinguish it.
      break;
    case 'reinforced-box': {
      // Wood-strap cross bracing on the front face and one horizontal band.
      addStrap('x', 0);
      const diag = new THREE.Mesh(new THREE.BoxGeometry(w * 0.06, h * 1.35, d * 0.06), darkMat);
      diag.position.z = d / 2 + 0.005;
      diag.rotation.z = Math.PI / 5;
      mesh.add(diag);
      break;
    }
    case 'long-crate': {
      // Two plank-seam strips running the long axis.
      const seamGeo = new THREE.BoxGeometry(w * 0.9, 0.015, d * 0.06);
      for (const fz of [d * 0.28, -d * 0.28]) {
        const seam = new THREE.Mesh(seamGeo, darkMat);
        seam.position.set(0, h / 2 + 0.008, fz);
        mesh.add(seam);
      }
      break;
    }
    case 'tall-crate': {
      // Slightly overhanging lid cap.
      const lid = new THREE.Mesh(new THREE.BoxGeometry(w * 1.08, h * 0.08, d * 1.08), lightMat);
      lid.position.y = h / 2 + h * 0.04;
      mesh.add(lid);
      break;
    }
    case 'flat-case': {
      // Center carry handle on top.
      const handle = new THREE.Mesh(new THREE.BoxGeometry(w * 0.32, h * 0.5, d * 0.08), darkMat);
      handle.position.y = h / 2 + h * 0.22;
      mesh.add(handle);
      break;
    }
    case 'wide-box': {
      // Top seam line where the lid meets the body.
      const seam = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, 0.02, d * 0.98), darkMat);
      seam.position.y = h * 0.28;
      mesh.add(seam);
      break;
    }
    case 'handled-box': {
      // Two loop handles, left and right.
      for (const sx of [1, -1]) {
        const loop = new THREE.Mesh(new THREE.TorusGeometry(Math.min(w, d) * 0.18, w * 0.03, 6, 10, Math.PI), darkMat);
        loop.position.set(sx * (w / 2 + 0.01), h * 0.1, 0);
        loop.rotation.y = Math.PI / 2;
        mesh.add(loop);
      }
      break;
    }
    case 'wooden-barrel': {
      // Two metal bands around the barrel (rings at ~1/3 and ~2/3 length).
      // CylinderGeometry's own axis is local Y by default — same as the
      // main barrel mesh — so these need NO extra rotation, only
      // positioning along Y (the barrel's length axis pre-tip).
      const radius = h / 2;
      const bandGeo = new THREE.CylinderGeometry(radius * 1.03, radius * 1.03, w * 0.08, 14, 1, true);
      const bandMat = new THREE.MeshStandardMaterial({ color: 0x3a3a38, side: THREE.DoubleSide });
      for (const fy of [-w * 0.26, w * 0.26]) {
        const band = new THREE.Mesh(bandGeo, bandMat);
        band.position.y = fy;
        mesh.add(band);
      }
      break;
    }
    case 'metal-drum': {
      // Rim ridges at both ends, along the same local-Y length axis.
      const radius = h / 2;
      const rimGeo = new THREE.CylinderGeometry(radius * 1.06, radius * 1.06, w * 0.06, 16, 1, true);
      const rimMat = new THREE.MeshStandardMaterial({ color: darken(baseColor, 0.3), side: THREE.DoubleSide });
      for (const fy of [-w / 2 + w * 0.04, w / 2 - w * 0.04]) {
        const rim = new THREE.Mesh(rimGeo, rimMat);
        rim.position.y = fy;
        mesh.add(rim);
      }
      break;
    }
    case 'fabric-roll': {
      // Plain end caps, no bands — reads as soft rolled material.
      const radius = h / 2;
      const capGeo = new THREE.CylinderGeometry(radius * 0.98, radius * 0.98, 0.015, 16);
      for (const fy of [-w / 2 + 0.01, w / 2 - 0.01]) {
        const cap = new THREE.Mesh(capGeo, lightMat);
        cap.position.y = fy;
        mesh.add(cap);
      }
      break;
    }
    case 'spool': {
      // Wide end-rim discs, wider than the barrel itself.
      const radius = h / 2;
      const rimGeo = new THREE.CylinderGeometry(radius * 1.18, radius * 1.18, 0.03, 16);
      for (const fy of [-w / 2 + 0.015, w / 2 - 0.015]) {
        const rim = new THREE.Mesh(rimGeo, darkMat);
        rim.position.y = fy;
        mesh.add(rim);
      }
      break;
    }
    case 'large-crate': {
      // Corner reinforcement posts.
      const postGeo = new THREE.BoxGeometry(w * 0.05, h * 1.02, d * 0.05);
      for (const sx of [1, -1]) {
        for (const sz of [1, -1]) {
          const post = new THREE.Mesh(postGeo, darkMat);
          post.position.set(sx * (w / 2 - w * 0.03), 0, sz * (d / 2 - d * 0.03));
          mesh.add(post);
        }
      }
      break;
    }
    case 'large-long-crate': {
      // Three cross straps along the length.
      for (const fx of [-w * 0.3, 0, w * 0.3]) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.06, h * 1.04, d * 1.04), darkMat);
        strap.position.x = fx;
        mesh.add(strap);
      }
      break;
    }
    case 'large-tall-crate': {
      // Visible frame edges — reads as reinforced/"magic equipment" framed cargo.
      const frameMat = new THREE.MeshStandardMaterial({ color: lighten(baseColor, 0.35), emissive: darken(baseColor, 0.6), emissiveIntensity: 0.25 });
      const edgeThick = Math.min(w, h, d) * 0.05;
      const vertGeo = new THREE.BoxGeometry(edgeThick, h * 1.03, edgeThick);
      for (const sx of [1, -1]) {
        for (const sz of [1, -1]) {
          const edge = new THREE.Mesh(vertGeo, frameMat);
          edge.position.set(sx * (w / 2 - edgeThick / 2), 0, sz * (d / 2 - edgeThick / 2));
          mesh.add(edge);
        }
      }
      const midBand = new THREE.Mesh(new THREE.BoxGeometry(w * 1.03, edgeThick, d * 1.03), frameMat);
      mesh.add(midBand);
      break;
    }
  }
}

// --- Category label -----------------------------------------------------

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
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 64);
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
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
  mesh.userData.cargoSubtypeLabel = true;
  return mesh;
}

/** Attaches the visible category-label badge(s) every daily cargo item
 * spawns with (spec section九/十). Box/large get two copies (front + top,
 * "增加可讀性"); roller gets one, on the barrel's own local +Z pole (reads
 * as "貼在外側的平面標牌", not a floating always-facing sprite — it rotates
 * with the mesh like everything else here). Fixed at spawn, never edited
 * (spec: "標籤不能由玩家修改" — no attach-again/remove function exists). */
export function attachCargoSubtypeLabel(mesh: THREE.Mesh, shapeType: CargoShapeType, label: string, dims: { width: number; height: number; depth: number }): void {
  const bg = CARGO_CATEGORY_LABEL_BG[shapeType];

  if (shapeType === 'roller') {
    const radius = dims.height / 2; // dims.height/depth both encode diameter, see CargoSubtypePreset doc
    const texture = buildLabelTexture(label, bg);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    const size = clampSize(radius * 1.1, 0.14, 0.4);
    const geo = new THREE.PlaneGeometry(size, size * 0.5);
    const badge = new THREE.Mesh(geo, material);
    badge.position.set(0, 0, radius + 0.006);
    badge.renderOrder = 3;
    badge.userData.cargoSubtypeLabel = true;
    mesh.add(badge);
    return;
  }

  const halfW = dims.width / 2, halfH = dims.height / 2, halfD = dims.depth / 2;
  mesh.add(buildBoxLabelMesh('front', label, bg, halfW, halfH, halfD));
  // Second copy on top for readability (spec: "建議在頂面或第二個側面再顯示
  // 一份") — skipped for very flat items where a top badge would barely fit.
  if (halfH > 0.1) {
    mesh.add(buildBoxLabelMesh('top', label, bg, halfW, halfH, halfD));
  }
}
