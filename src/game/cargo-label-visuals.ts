// Visual attachment of cargo labels directly onto a cargo mesh's surface
// (spec section 六) — small textured planes parented to the cargo
// THREE.Mesh, so they automatically move/rotate with it through
// pickup/placement/throw/dolly/vehicle-travel with zero extra bookkeeping
// (a plain Object3D child is already "attached" for free via Three.js's
// scene graph — no per-frame sync needed).
//
// Labels are fixed at spawn and never change afterward this round (no
// labeling desk/UI exists anymore — spec section 七: "現在貨物上的標籤就是
// 正式物流資訊", not something the player edits), so this file only ever
// ATTACHES labels once; there is no longer a "sync to match current state"
// function like the previous round's syncAppliedLabelSprites.
import * as THREE from 'three';
import { CargoLabel } from './cargo-data';

export type FaceId = 'front' | 'back' | 'right' | 'left' | 'top';

// 'domestic' and 'overseas' are mutually exclusive on any one cargo item
// (spec section 三), so they can safely share the same face slot — freeing
// up all 5 non-bottom faces for the 6 possible label kinds without ever
// risking two badges landing on the same face at once.
const LABEL_FACE: Record<CargoLabel, FaceId> = {
  domestic: 'front',
  overseas: 'front',
  fragile: 'back',
  large: 'right',
  frozen: 'left',
  live: 'top',
};

const BADGE_COLOR: Record<CargoLabel, string> = {
  domestic: '#5a8a3a',
  overseas: '#2b6bd8',
  fragile: '#c0392b',
  large: '#c9a227',
  frozen: '#2ba8c9',
  live: '#2ba85a',
};

const EPS = 0.008;

export function faceTransform(face: FaceId, halfW: number, halfH: number, halfD: number) {
  switch (face) {
    case 'front': return { pos: new THREE.Vector3(0, 0, halfD + EPS), rot: new THREE.Euler(0, 0, 0), faceW: halfW * 2, faceH: halfH * 2 };
    case 'back': return { pos: new THREE.Vector3(0, 0, -halfD - EPS), rot: new THREE.Euler(0, Math.PI, 0), faceW: halfW * 2, faceH: halfH * 2 };
    case 'right': return { pos: new THREE.Vector3(halfW + EPS, 0, 0), rot: new THREE.Euler(0, Math.PI / 2, 0), faceW: halfD * 2, faceH: halfH * 2 };
    case 'left': return { pos: new THREE.Vector3(-halfW - EPS, 0, 0), rot: new THREE.Euler(0, -Math.PI / 2, 0), faceW: halfD * 2, faceH: halfH * 2 };
    case 'top': return { pos: new THREE.Vector3(0, halfH + EPS, 0), rot: new THREE.Euler(-Math.PI / 2, 0, 0), faceW: halfW * 2, faceH: halfD * 2 };
  }
}

function drawBadgeIcon(ctx: CanvasRenderingContext2D, kind: CargoLabel): void {
  const s = 128;
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = BADGE_COLOR[kind];
  ctx.beginPath();
  ctx.roundRect(6, 6, s - 12, s - 12, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const c = s / 2;

  if (kind === 'domestic') {
    // Simple house/land silhouette: roof triangle + wall square.
    ctx.beginPath();
    ctx.moveTo(c - 26, c);
    ctx.lineTo(c, c - 28);
    ctx.lineTo(c + 26, c);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.rect(c - 18, c, 36, 30);
    ctx.fill();
  } else if (kind === 'overseas') {
    // Simple boat: hull trapezoid + mast/sail triangle.
    ctx.beginPath();
    ctx.moveTo(c - 34, c + 14);
    ctx.lineTo(c + 34, c + 14);
    ctx.lineTo(c + 22, c + 32);
    ctx.lineTo(c - 22, c + 32);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(c, c - 34);
    ctx.lineTo(c, c + 14);
    ctx.moveTo(c, c - 30);
    ctx.lineTo(c + 26, c + 6);
    ctx.lineTo(c, c + 6);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'fragile') {
    // Wine-glass silhouette.
    ctx.beginPath();
    ctx.moveTo(c - 20, c - 30);
    ctx.quadraticCurveTo(c - 20, c, c, c + 4);
    ctx.quadraticCurveTo(c + 20, c, c + 20, c - 30);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(c, c + 4);
    ctx.lineTo(c, c + 26);
    ctx.moveTo(c - 16, c + 32);
    ctx.lineTo(c + 16, c + 32);
    ctx.stroke();
  } else if (kind === 'large') {
    // Bidirectional size arrow.
    ctx.beginPath();
    ctx.moveTo(c - 32, c);
    ctx.lineTo(c + 32, c);
    ctx.moveTo(c - 32, c);
    ctx.lineTo(c - 20, c - 12);
    ctx.moveTo(c - 32, c);
    ctx.lineTo(c - 20, c + 12);
    ctx.moveTo(c + 32, c);
    ctx.lineTo(c + 20, c - 12);
    ctx.moveTo(c + 32, c);
    ctx.lineTo(c + 20, c + 12);
    ctx.stroke();
  } else if (kind === 'frozen') {
    // Snowflake — 3 crossing lines with side ticks.
    for (let i = 0; i < 3; i++) {
      const ang = (Math.PI / 3) * i;
      const dx = Math.cos(ang) * 30;
      const dy = Math.sin(ang) * 30;
      ctx.beginPath();
      ctx.moveTo(c - dx, c - dy);
      ctx.lineTo(c + dx, c + dy);
      ctx.stroke();
      for (const t of [0.5, -0.5]) {
        const mx = c + dx * t;
        const my = c + dy * t;
        const perp = ang + Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(mx - Math.cos(perp) * 7, my - Math.sin(perp) * 7);
        ctx.lineTo(mx + Math.cos(perp) * 7, my + Math.sin(perp) * 7);
        ctx.stroke();
      }
    }
  } else if (kind === 'live') {
    // Paw print — 3 toe ovals + 1 pad oval.
    ctx.beginPath();
    ctx.ellipse(c, c + 14, 16, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    const toes: [number, number][] = [[-18, -14], [0, -20], [18, -14]];
    for (const [tx, ty] of toes) {
      ctx.beginPath();
      ctx.ellipse(c + tx, c + ty, 8, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function clampSize(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** One colored badge for one label. Sized relative to the face it sits on
 * (spec: "大型貨物要依尺寸調整標籤位置，避免埋入表面") and clamped to a
 * sane min/max so it never dominates a tiny box or shrinks to nothing on
 * a huge one. */
function buildLabelSprite(kind: CargoLabel, halfW: number, halfH: number, halfD: number): THREE.Mesh {
  const face = LABEL_FACE[kind];
  const { pos, rot, faceW, faceH } = faceTransform(face, halfW, halfH, halfD);

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  drawBadgeIcon(canvas.getContext('2d')!, kind);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });

  const size = clampSize(Math.min(faceW, faceH) * 0.5, 0.09, 0.22);
  const geo = new THREE.PlaneGeometry(size, size);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(pos);
  mesh.rotation.copy(rot);
  mesh.renderOrder = 3;
  mesh.userData.cargoLabelSprite = kind;
  return mesh;
}

/** Attaches every label's badge to a freshly-spawned cargo item — called
 * once at spawn (cargo-system.ts) and never again, since labels are fixed
 * for the cargo's whole lifetime this round. Because 'domestic'/'overseas'
 * share one face slot and every other label has its own dedicated face, no
 * two badges from the same `labels` array can ever overlap. */
export function attachCargoLabels(mesh: THREE.Mesh, labels: CargoLabel[], width: number, height: number, depth: number): void {
  const halfW = width / 2, halfH = height / 2, halfD = depth / 2;
  for (const label of labels) {
    mesh.add(buildLabelSprite(label, halfW, halfH, halfD));
  }
}
