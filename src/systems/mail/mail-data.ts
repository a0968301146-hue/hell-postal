// Destination/stamp data + envelope visual builders for the mail module
// ("Add modular envelope stamping and regional mail bag system" round).
// Ported the CANVAS-TEXTURE-DRAWING technique from the old, now-dead
// src/game/envelope-data.ts (spec: "舊信封程式可以局部移植") — not its data
// shape or its EnvelopeData interface, which belonged to the old
// PackageData-based flow this round deliberately does not reactivate.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MailDestination, MailRegion } from './mail-types';
import { ENVELOPE_SIZE, MailBoxDimensions } from '../../data/world/mail-layout-data';

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
 * hand-picking destinations inline.
 *
 * "世界地名與郵票圖樣調整" round — real-world place names replaced with the
 * game's own fantasy world locations (`id` values are UNCHANGED internal
 * keys, never shown to the player — only displayName/icon/color are player-
 * facing, so this is the ONE place their whole in-game identity is defined;
 * every OTHER system, e.g. envelope-dispatch-machine-data.ts's own
 * REGION_GRID, must read displayName from here via getMailDestination()
 * rather than keeping a second hardcoded copy — spec: "不要讓不同系統各自硬
 * 編碼地點名稱"). domestic/international grouping is UNCHANGED from before
 * (still 2+2) — 阿爾戈斯/赫菲斯提亞 are both mainland-kingdom cities,
 * 東方群島/精靈之島 are both overseas territories, mirroring the original
 * Taiwan-domestic/overseas-international split exactly. */
export const MAIL_DESTINATIONS: MailDestinationInfo[] = [
  // 阿爾戈斯｜王都 — 王國首都，政治與商業中心，繁華華麗（王城/城門意象）。
  { id: 'taipei', displayName: '阿爾戈斯', region: 'domestic', icon: '🏰', color: 0xd4af37 },
  // 赫菲斯提亞｜矮人鍛造之城 — 矮人族鍛造都市，火焰與鐵的工匠文化。
  { id: 'taichung', displayName: '赫菲斯提亞', region: 'domestic', icon: '⚒️', color: 0xcc5500 },
  // 常世群島｜東方群島 — 東方海域群島，海上貿易與朝霞海浪意象（刻意不使用
  // 任何現實地球國家的國旗／國徽等素材）。"世界觀地區命名修正" 回合：「東
  // 雲」不是正式地區名稱，僅保留作為常世群島內某座島嶼的候選名稱（見
  // envelope-data.ts 的舊版地址範例）。
  { id: 'japan', displayName: '東方群島', region: 'international', icon: '🌅', color: 0xff7f50 },
  // 阿耳忒彌西亞｜精靈之島 — 精靈族島嶼國度，森林、月光與自然魔法。
  { id: 'usa', displayName: '精靈之島', region: 'international', icon: '🌙', color: 0x5f8a6f },
];

export function getMailDestination(id: MailDestination): MailDestinationInfo {
  return MAIL_DESTINATIONS.find((d) => d.id === id)!;
}

/** How many envelopes spawn on top of regular cargo during each day's
 * unload burst (spec二) — the ONE place this count is defined. "Fix cargo
 * throwing and rebalance daily manifest" round五: raised 12 -> 20 (spec:
 * "每日信件數量從12增加到20"); with exactly 4 MAIL_DESTINATIONS this divides
 * evenly (spawnTodaysEnvelopes' perDestination/remainder split below), so
 * the fixed 5/5/5/5 per-destination distribution the spec asks for falls
 * out of the existing even-split logic with no separate special-case. */
export const DAILY_ENVELOPE_COUNT = 20;

/** Cap on how many empty bags can exist in the world at once (spec六: "場上
 * 空袋上限8個，不可無限生成"). */
export const MAX_OPEN_BAGS = 8;

export const MAIL_BAG_CAPACITY = 12;

/** "Add playable envelope visual presets" round — the ONE place an
 * envelope's physical silhouette/paper color/distinguishing detail are
 * bound together, exactly mirroring cargo-shape-presets.ts's own pattern
 * for cargo. mail-system.ts spawns every daily envelope by picking one of
 * these (independently of destination/region/requiredStamp — spec: "彼此
 * 獨立...不可把外型當成目的地判斷依據"), and the codex (codex-data.ts) lists
 * these same four presets rather than a second, hand-written description
 * (spec: "不保留另一份手寫信件外型清單"). Every preset shares the EXACT
 * SAME height as ENVELOPE_SIZE.height on purpose — mail-bag-system.ts's own
 * stacking math (its own file, out of this round's scope) still reads the
 * global ENVELOPE_SIZE.height for the per-slot vertical spacing, so keeping
 * every preset's real height identical to it is what keeps that stacking
 * math correct for every preset without touching that file at all. */
export interface MailEnvelopeVisualPreset {
  id: string;
  displayName: string;
  dimensions: { width: number; height: number; depth: number };
  /** Base paper color — covers every face except the top (destination/stamp
   * texture, unchanged across presets) and, for wax-seal-envelope, the back
   * face (its own wax-seal texture). */
  paperColor: number;
  /** kraft-envelope's visibly thicker colored edge, drawn as an inset frame
   * on the TOP face texture alongside the destination/stamp info (spec:
   * "牛皮紙色與較厚紙邊"). Null for every other preset. */
  borderColor: number | null;
  /** wax-seal-envelope's distinguishing feature — a colored wax-seal blob
   * drawn onto the BACK face texture (spec: "背面有明顯彩色蠟印"). */
  hasWaxSeal: boolean;
  /** Relative weight for the daily weighted-random pick (spec: "四種外型近
   * 似平均或加權隨機"). Uniform across all four confirmed presets. */
  spawnWeight: number;
  /** Codex description (spec: "圖鑑改為讀取同一份 MailEnvelopeVisualPreset，
   * 不保留另一份手寫信件外型清單") — the codex reads this field directly
   * rather than a separate hand-written text table. */
  note: string;
}

export const MAIL_ENVELOPE_VISUAL_PRESETS: MailEnvelopeVisualPreset[] = [
  {
    id: 'standard-envelope', displayName: '標準信封',
    dimensions: { width: ENVELOPE_SIZE.width, height: ENVELOPE_SIZE.height, depth: ENVELOPE_SIZE.depth },
    paperColor: 0xfffff0, borderColor: null, hasWaxSeal: false, spawnWeight: 1,
    note: '極小扁平信件，一般白色紙質，可直接投入信封箱',
  },
  {
    id: 'kraft-envelope', displayName: '牛皮紙信封',
    dimensions: { width: ENVELOPE_SIZE.width, height: ENVELOPE_SIZE.height, depth: ENVELOPE_SIZE.depth },
    paperColor: 0xc8a165, borderColor: 0x6b4a26, hasWaxSeal: false, spawnWeight: 1,
    note: '極小扁平信件，牛皮紙色澤與較厚紙邊，可直接投入信封箱',
  },
  {
    id: 'wax-seal-envelope', displayName: '蠟封信封',
    dimensions: { width: ENVELOPE_SIZE.width, height: ENVELOPE_SIZE.height, depth: ENVELOPE_SIZE.depth },
    paperColor: 0xf2ece0, borderColor: null, hasWaxSeal: true, spawnWeight: 1,
    note: '極小扁平信件，背面有明顯彩色蠟印，可直接投入信封箱',
  },
  {
    id: 'document-envelope', displayName: '文件信封',
    // Wider flat footprint (spec: "平面尺寸較大"), but the SAME thin height
    // as every other preset (spec: "厚度仍保持很薄") — comfortably clears
    // both the stamp table (1.6x1.0m) and the enlarged mail box's own
    // interior footprint (0.54x0.51m, mail-layout-data.ts MAIL_BOX_DIMENSIONS
    // .innerWidth/.innerDepth) with wide margin on every side (>20%, per
    // "Align mail box colliders with visible mesh" round四's own safety-
    // margin requirement), so it can never jam on either (spec: "不得因尺寸
    // 較大而卡在工作桌或信封箱").
    dimensions: { width: 0.34, height: ENVELOPE_SIZE.height, depth: 0.24 },
    paperColor: 0xf5f5f0, borderColor: null, hasWaxSeal: false, spawnWeight: 1,
    note: '平面尺寸較大、厚度仍很薄的信件，可完整通過信封箱箱口',
  },
];

export function getMailEnvelopeVisualPreset(id: string): MailEnvelopeVisualPreset | undefined {
  return MAIL_ENVELOPE_VISUAL_PRESETS.find((p) => p.id === id);
}

/** Weighted-random pick, entirely independent of destination/region/stamp
 * (spec: "四種外型近似平均或加權隨機...彼此獨立") — mail-system.ts calls this
 * separately from its own destination pick, never lets one influence the
 * other. */
export function pickWeightedMailEnvelopeVisualPreset(): MailEnvelopeVisualPreset {
  const totalWeight = MAIL_ENVELOPE_VISUAL_PRESETS.reduce((sum, p) => sum + p.spawnWeight, 0);
  let roll = Math.random() * totalWeight;
  for (const p of MAIL_ENVELOPE_VISUAL_PRESETS) {
    roll -= p.spawnWeight;
    if (roll <= 0) return p;
  }
  return MAIL_ENVELOPE_VISUAL_PRESETS[MAIL_ENVELOPE_VISUAL_PRESETS.length - 1];
}

/** Draws an envelope's top-face texture — destination icon/name and a
 * dashed stamp-slot box in the corner, filled in with the attached stamp's
 * icon once stamped (spec三: "表面顯示：目的地圖樣/目的地文字/貼票區"), plus
 * an optional inset border frame for kraft-envelope's own "較厚紙邊" detail
 * (spec: "四種輪廓或細節能直接看出差異"). */
function drawEnvelopeCanvas(dest: MailDestinationInfo, attachedStamp: MailDestination | null, borderColor: number | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 180;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#fffff0';
  ctx.fillRect(0, 0, 256, 180);
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 3;
  ctx.strokeRect(3, 3, 250, 174);

  if (borderColor) {
    ctx.strokeStyle = `#${borderColor.toString(16).padStart(6, '0')}`;
    ctx.lineWidth = 10;
    ctx.strokeRect(9, 9, 238, 162);
  }

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

/** wax-seal-envelope's distinguishing back-face texture (spec: "背面有明顯
 * 彩色蠟印") — a plain paper background (matching the preset's own
 * paperColor) with a colored wax-seal blob stamped on it. */
function drawWaxSealCanvas(paperColor: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 180;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = `#${paperColor.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, 256, 180);
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 3;
  ctx.strokeRect(3, 3, 250, 174);

  ctx.fillStyle = '#a5231e';
  ctx.beginPath();
  ctx.arc(128, 90, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '30px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('✦', 128, 92);

  return canvas;
}

/** Builds a fresh 6-material array for an envelope's BoxGeometry — only the
 * top face (+Y, index 2) carries the destination/stamp texture; the base
 * faces use the preset's own paper color, and wax-seal-envelope's back face
 * (-Z, index 5) carries its own distinguishing wax-seal texture instead
 * (spec: "四種輪廓或細節能直接看出差異"), matching BoxGeometry's per-face
 * material-index convention ([+x,-x,+y,-y,+z,-z]). Called once at spawn and
 * again whenever a stamp is applied (regenerating the texture is cheap and
 * only ever happens on a deliberate state change, never per-frame) — the
 * REBUILT materials always read the SAME preset the envelope was originally
 * spawned with (spec: "貼郵票後，在原信封外型上顯示郵票"), never a different
 * one. */
export function buildEnvelopeMaterials(dest: MailDestinationInfo, attachedStamp: MailDestination | null, preset: MailEnvelopeVisualPreset): THREE.Material[] {
  const paperMat = new THREE.MeshStandardMaterial({ color: preset.paperColor });
  const topCanvas = drawEnvelopeCanvas(dest, attachedStamp, preset.borderColor);
  const topMat = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(topCanvas) });
  const backMat = preset.hasWaxSeal
    ? new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(drawWaxSealCanvas(preset.paperColor)) })
    : paperMat;
  return [paperMat, paperMat, topMat, paperMat, paperMat, backMat];
}

export function buildEnvelopeGeometry(dimensions: { width: number; height: number; depth: number }): THREE.BoxGeometry {
  return new THREE.BoxGeometry(dimensions.width, dimensions.height, dimensions.depth);
}

/** Box front-panel texture — destination pattern icon + region label (spec
 * 二: "圖樣顯示在信封箱外側正面"). Envelope COUNT is intentionally NOT baked
 * in here — mail-bag-system.ts keeps that on a separate floating label it
 * can cheaply re-render every time the count changes, without rebuilding
 * this texture. */
function drawBoxFrontCanvas(pattern: MailDestinationInfo | null): HTMLCanvasElement {
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

/** Plain wood/cardboard material — every box surface except the front
 * wall's own destination texture below (spec二: "箱內側不顯示目的地圖
 * 樣" — this also naturally covers the bottom/left/right/back walls'
 * exteriors AND every wall's interior-facing surface, since a thin solid
 * box piece shares one material across all its faces). */
function buildBoxPlainMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.9 });
}

/** Front-wall material carrying the destination pattern texture (spec二:
 * "圖樣顯示在信封箱外側正面...按F後立即更新"). */
function buildBoxFrontMaterial(pattern: MailDestinationInfo | null): THREE.MeshStandardMaterial {
  const canvas = drawBoxFrontCanvas(pattern);
  return new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(canvas) });
}

/** Builds the box's material PAIR together — index 0 matches
 * buildBoxGeometry's own front-wall material group, index 1 every other
 * piece's group (bottom/left/right/back, spec二: "箱內側不顯示目的地圖
 * 樣"). Callers (mail-bag-system.ts) assign this directly as `mesh.material`. */
export function buildBagMaterials(pattern: MailDestinationInfo | null): THREE.Material[] {
  return [buildBoxFrontMaterial(pattern), buildBoxPlainMaterial()];
}

/** Open rectangular mail box ("Replace mail bags with open mail boxes"
 * round一: "上方完全開放、有底板與四面箱壁、不可有箱蓋Collider、不要改回實
 * 心方塊") — 5 separate thin BoxGeometry pieces (bottom + left/right/back/
 * front walls) merged into ONE indexed BufferGeometry with 2 material
 * groups (mergeGeometries's own useGroups=true assigns one group per INPUT
 * geometry in order — grouped here as [frontGeo, restGeo] so index 0 is
 * exactly the front wall, index 1 everything else, matching
 * buildBagMaterials' own [front, plain] pair).
 *
 * "Align mail box colliders with visible mesh" round二: takes the SAME
 * `MailBoxDimensions` object mail-bag-system.ts builds its 5 real Colliders
 * from (position/rotation/width/height/depth for every piece computed with
 * the EXACT identical formulas on both sides) — no separate width/height/
 * depth parameters to accidentally drift apart from what the physics body
 * actually uses. The whole visual stays exactly one THREE.Mesh (matching
 * InteractableObject.mesh's own single-Mesh contract). No top piece is ever
 * created — the mouth stays genuinely open, and nothing here can ever
 * become "a filled-in solid collider" since this function only ever
 * produces a cosmetic mesh; the REAL 5-collider compound body is built
 * separately in mail-bag-system.ts from this same dims object. */
export function buildBoxGeometry(dims: MailBoxDimensions): THREE.BufferGeometry {
  const { outerWidth, outerDepth, outerHeight, innerWidth, innerDepth, innerHeight, wallThickness: wt, bottomThickness: bt } = dims;
  const wallLocalY = -outerHeight / 2 + bt + innerHeight / 2;
  const bottomLocalY = -outerHeight / 2 + bt / 2;

  const bottomGeo = new THREE.BoxGeometry(outerWidth, bt, outerDepth);
  bottomGeo.translate(0, bottomLocalY, 0);

  const leftGeo = new THREE.BoxGeometry(wt, innerHeight, outerDepth);
  leftGeo.translate(-(innerWidth / 2 + wt / 2), wallLocalY, 0);

  const rightGeo = new THREE.BoxGeometry(wt, innerHeight, outerDepth);
  rightGeo.translate(innerWidth / 2 + wt / 2, wallLocalY, 0);

  const backGeo = new THREE.BoxGeometry(outerWidth, innerHeight, wt);
  backGeo.translate(0, wallLocalY, -(innerDepth / 2 + wt / 2));

  const frontGeo = new THREE.BoxGeometry(outerWidth, innerHeight, wt);
  frontGeo.translate(0, wallLocalY, innerDepth / 2 + wt / 2);

  const restGeo = mergeGeometries([bottomGeo, leftGeo, rightGeo, backGeo], false);
  bottomGeo.dispose();
  leftGeo.dispose();
  rightGeo.dispose();
  backGeo.dispose();
  if (!restGeo) throw new Error('mail box geometry merge failed (rest pieces)');

  const merged = mergeGeometries([frontGeo, restGeo], true);
  frontGeo.dispose();
  restGeo.dispose();
  if (!merged) throw new Error('mail box geometry merge failed');
  merged.computeVertexNormals();
  return merged;
}

