// Destination/stamp data + envelope visual builders for the mail module
// ("Add modular envelope stamping and regional mail bag system" round).
// Ported the CANVAS-TEXTURE-DRAWING technique from the old, now-dead
// src/game/envelope-data.ts (spec: "舊信封程式可以局部移植") — not its data
// shape or its EnvelopeData interface, which belonged to the old
// PackageData-based flow this round deliberately does not reactivate.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MailDestination, MailRegion } from './mail-types';
import { ENVELOPE_SIZE } from '../../data/world/mail-layout-data';

export interface MailDestinationInfo {
  id: MailDestination;
  displayName: string;
  region: MailRegion;
  icon: string;
  color: number;
}

/** Four destinations, roughly evenly generated (spec二) — the ONE place
 * destination/region/display data lives; mail-system.ts's daily spawn and
 * mail-bag-system.ts's pattern selection both read this list rather than
 * hand-picking destinations inline. */
export const MAIL_DESTINATIONS: MailDestinationInfo[] = [
  { id: 'taipei', displayName: '台北', region: 'domestic', icon: '🏙️', color: 0x4169e1 },
  { id: 'taichung', displayName: '台中', region: 'domestic', icon: '🌇', color: 0xf4a460 },
  { id: 'japan', displayName: '日本', region: 'international', icon: '🗻', color: 0xff69b4 },
  { id: 'usa', displayName: '美國', region: 'international', icon: '🗽', color: 0x228b22 },
];

export function getMailDestination(id: MailDestination): MailDestinationInfo {
  return MAIL_DESTINATIONS.find((d) => d.id === id)!;
}

/** How many envelopes spawn on top of regular cargo during each day's
 * unload burst (spec二) — the ONE place this count is defined. */
export const DAILY_ENVELOPE_COUNT = 12;

/** Cap on how many empty bags can exist in the world at once (spec六: "場上
 * 空袋上限8個，不可無限生成"). */
export const MAX_OPEN_BAGS = 8;

export const MAIL_BAG_CAPACITY = 12;

/** Draws an envelope's top-face texture — destination icon/name and a
 * dashed stamp-slot box in the corner, filled in with the attached stamp's
 * icon once stamped (spec三: "表面顯示：目的地圖樣/目的地文字/貼票區"). */
function drawEnvelopeCanvas(dest: MailDestinationInfo, attachedStamp: MailDestination | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 180;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#fffff0';
  ctx.fillRect(0, 0, 256, 180);
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 3;
  ctx.strokeRect(3, 3, 250, 174);

  ctx.textAlign = 'left';
  ctx.font = '40px sans-serif';
  ctx.fillText(dest.icon, 18, 65);
  ctx.fillStyle = '#222';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(dest.displayName, 18, 110);
  ctx.font = '14px sans-serif';
  ctx.fillStyle = '#666';
  ctx.fillText(dest.region === 'domestic' ? '國內' : '海外', 18, 140);

  // Stamp slot, top-right corner.
  ctx.strokeStyle = '#999';
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(174, 14, 66, 56);
  ctx.setLineDash([]);
  if (attachedStamp) {
    const stampInfo = getMailDestination(attachedStamp);
    ctx.fillStyle = `#${stampInfo.color.toString(16).padStart(6, '0')}`;
    ctx.fillRect(176, 16, 62, 52);
    ctx.font = '30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(stampInfo.icon, 207, 50);
  } else {
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#bbb';
    ctx.textAlign = 'center';
    ctx.fillText('郵票', 207, 45);
  }

  return canvas;
}

/** Builds a fresh 6-material array for an envelope's BoxGeometry — only the
 * top face (+Y, index 2) carries the destination/stamp texture; the rest
 * stay a plain envelope-paper color, matching BoxGeometry's per-face
 * material-index convention ([+x,-x,+y,-y,+z,-z]). Called once at spawn and
 * again whenever a stamp is applied (regenerating the texture is cheap and
 * only ever happens on a deliberate state change, never per-frame). */
export function buildEnvelopeMaterials(dest: MailDestinationInfo, attachedStamp: MailDestination | null): THREE.Material[] {
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xfffff0 });
  const topCanvas = drawEnvelopeCanvas(dest, attachedStamp);
  const topMat = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(topCanvas) });
  return [paperMat, paperMat, topMat, paperMat, paperMat, paperMat];
}

export function buildEnvelopeGeometry(): THREE.BoxGeometry {
  return new THREE.BoxGeometry(ENVELOPE_SIZE.width, ENVELOPE_SIZE.height, ENVELOPE_SIZE.depth);
}

/** Bag exterior texture — destination pattern icon + region label (spec八:
 * "袋子外側顯示：台北／台中／日本／美國圖樣、國內／海外"). Envelope COUNT is
 * intentionally NOT baked in here — mail-bag-system.ts keeps that on a
 * separate floating label it can cheaply re-render every time the count
 * changes, without rebuilding this texture. */
function drawBagCanvas(pattern: MailDestinationInfo | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 200;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = pattern ? `#${pattern.color.toString(16).padStart(6, '0')}` : '#7a6a55';
  ctx.fillRect(0, 0, 160, 200);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 3;
  ctx.strokeRect(3, 3, 154, 194);

  ctx.textAlign = 'center';
  if (pattern) {
    ctx.font = '48px sans-serif';
    ctx.fillText(pattern.icon, 80, 80);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(pattern.displayName, 80, 130);
    ctx.font = '15px sans-serif';
    ctx.fillText(pattern.region === 'domestic' ? '國內' : '海外', 80, 158);
  } else {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('未設定', 80, 100);
  }

  return canvas;
}

/** Plain interior lining material — no pattern/destination texture (spec二:
 * "內側不顯示目的地郵票"), just a dull fabric-lining color. Built fresh each
 * time purely for symmetry with buildBagExteriorMaterial (both get disposed
 * together whenever the pattern changes); it never actually needs to change
 * with the pattern itself, but keeping ownership/lifecycle identical for
 * both materials avoids any "which one do I dispose" bookkeeping split. */
function buildBagInteriorMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x3a2f22, roughness: 0.95 });
}

/** Exterior material — destination pattern/region texture (spec二: "外側顯
 * 示目前用F切換的目的地郵票／袋子圖樣"). Single-sided (default THREE.FrontSide)
 * — this round replaces the previous DoubleSide-on-one-shell approach (spec:
 * "不要只使用DoubleSide假裝完成內外UV") with a genuine second, independently
 * wound inner shell (see buildBagGeometry) carrying its own separate
 * material index/UV region instead. */
function buildBagExteriorMaterial(pattern: MailDestinationInfo | null): THREE.MeshStandardMaterial {
  const canvas = drawBagCanvas(pattern);
  return new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(canvas) });
}

/** Builds the bag's exterior+interior material PAIR together (spec二: 外側/
 * 內側各自獨立材質) — index 0 matches buildBagGeometry's outer-shell
 * material group, index 1 its inner-shell group. Callers (mail-bag-
 * system.ts) assign this directly as `mesh.material`. */
export function buildBagMaterials(pattern: MailDestinationInfo | null): THREE.Material[] {
  return [buildBagExteriorMaterial(pattern), buildBagInteriorMaterial()];
}

/** Reverses a BufferGeometry's face winding (and re-derives normals to
 * match) in place — used to build the inner shell below so its visible face
 * points INTO the cavity instead of outward. Manual index-swap rather than
 * a scale(-1,..) trick, so it stays correct regardless of the source
 * profile's shape. */
function flipWinding(geo: THREE.BufferGeometry): void {
  const index = geo.getIndex();
  if (!index) return;
  const arr = index.array as Uint16Array | Uint32Array;
  for (let i = 0; i < arr.length; i += 3) {
    const tmp = arr[i + 1];
    arr[i + 1] = arr[i + 2];
    arr[i + 2] = tmp;
  }
  index.needsUpdate = true;
}

/** Low-poly, irregular open-top sack silhouette ("Improve mail table
 * placement and open mail bags" round二: "袋口略寬/中間鼓起/底部略窄"), now
 * built from TWO separately-wound LatheGeometry shells merged into one
 * indexed BufferGeometry with material groups ("Resize mail bags and fix
 * supply rack interaction" round二: "外側與內側使用不同material index／UV
 * 區域，方便未來替換貼圖" — not DoubleSide on a single shell): an OUTER
 * shell (default winding, visible from outside, material group 0) and an
 * INNER shell — the same profile inset by `wallThickness` in radius, with
 * its winding flipped (flipWinding) so it's visible from the INSIDE instead
 * (material group 1). Both profiles deliberately never return to radius 0
 * at the top, so the mouth stays genuinely open on both shells (no cap ever
 * generated there, spec: "袋口與內部必須保持鏤空"); both DO start at radius
 * 0 at the bottom, so the base pinches closed with no separate cap mesh.
 * The whole visual stays exactly one THREE.Mesh (matching InteractableObject
 * .mesh's own single-Mesh contract) with a 2-element material array. Purely
 * cosmetic either way: the REAL collision shape is the separate flat-walled
 * box collider mail-bag-system.ts builds from the same interior/
 * wallThickness numbers (spec: "Collider只能放在：底部/左側/右側/前側/
 * 後側"), never this shape. */
export function buildBagGeometry(interiorWidth: number, interiorDepth: number, interiorHeight: number, wallThickness: number): THREE.BufferGeometry {
  const totalHeight = interiorHeight + wallThickness; // bottom wall only — top stays open
  const bottomY = -totalHeight / 2;
  const topY = totalHeight / 2; // mouth plane = interior top, no wall there
  const avgHalf = (interiorWidth / 2 + interiorDepth / 2) / 2 + wallThickness;
  const bottomRadius = avgHalf * 0.5;
  const bulgeRadius = avgHalf * 1.4; // 中間鼓起 — the widest point
  const mouthRadius = avgHalf * 1.3; // 袋口略寬 — slightly narrower than the bulge

  const outerPoints = [
    new THREE.Vector2(0, bottomY),
    new THREE.Vector2(bottomRadius, bottomY + totalHeight * 0.12),
    new THREE.Vector2(bulgeRadius, (bottomY + topY) / 2),
    new THREE.Vector2(mouthRadius, topY),
  ];
  const outerGeo = new THREE.LatheGeometry(outerPoints, 8);

  const innerPoints = outerPoints.map((p) => new THREE.Vector2(Math.max(0.001, p.x - wallThickness), p.y));
  const innerGeo = new THREE.LatheGeometry(innerPoints, 8);
  flipWinding(innerGeo);

  const merged = mergeGeometries([outerGeo, innerGeo], true);
  outerGeo.dispose();
  innerGeo.dispose();
  if (!merged) throw new Error('mail bag geometry merge failed');
  merged.computeVertexNormals();
  return merged;
}

/** Sealed-bag cinch ring ("Improve mail table placement and open mail bags"
 * round五: sealed需"新增收束袋口或綁繩視覺") — a thin torus sitting just
 * below the mouth, toggled visible only while `state === 'sealed'`
 * (mail-bag-system.ts adds this once at spawn and flips `.visible`, rather
 * than rebuilding geometry on every seal/unseal). */
export function buildBagCinchRing(mouthRadius: number, y: number): THREE.Mesh {
  const geo = new THREE.TorusGeometry(mouthRadius * 0.75, mouthRadius * 0.12, 6, 10);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = y;
  ring.visible = false;
  return ring;
}
