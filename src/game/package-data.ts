import * as THREE from 'three';
import { DESTINATIONS } from './destination-data';
import { getStampForDestination, getStampById } from './stamp-data';

export const MAX_PACKAGE_WEIGHT_KG = 10;

export interface PackageData {
  packageId: string;
  recipientName: string;
  streetLine: string;
  destinationId: string;
  destinationName: string;
  requiredStampId: string;
  isStamped: boolean;
  appliedStampId: string | null;
  addressLabelMesh: THREE.Mesh | null;
  stampVisualMesh: THREE.Mesh | null;
  overweightLabelMesh: THREE.Mesh | null;
  // Weight (independent of size)
  sizeCategory: 'small' | 'medium' | 'large';
  weightKg: number;
  maxAllowedWeightKg: number;
  isOverweight: boolean;
  hasBeenWeighed: boolean;
  hasOverweightLabel: boolean;
}

const RECIPIENTS: [string, string][] = [
  ['王小明', '台灣大道二段'],
  ['Emily Chen', '信義路五段'],
  ['佐藤優', '東京都新宿區'],
  ['Alex Smith', 'California'],
  ['林美玲', '中港路一段'],
  ['陳大衛', '忠孝東路四段'],
  ['田中花子', '大阪府堺市'],
  ['John Williams', 'New York'],
  ['張雅婷', '公益路'],
];

let assignIndex = 0;

// Predetermined weights: ensure mix of normal and overweight regardless of size
// Index 0-8 maps to specific weights to guarantee variety
const PACKAGE_WEIGHTS: number[] = [
  3.2,   // parcel-small: normal
  11.4,  // parcel-long: OVERWEIGHT (small but heavy)
  6.8,   // mailbox-medium: normal
  12.6,  // box-small: OVERWEIGHT (small but heavy!)
  4.5,   // box-medium: normal
  8.1,   // parcel-long-2: normal
  7.2,   // box-large-1: normal (large but light!)
  13.8,  // box-large-2: OVERWEIGHT
  5.9,   // box-large-3: normal (large but light)
];

export function createPackageData(packageId: string, boxWidth = 0.5, boxHeight = 0.5, _boxDepth = 0.5): PackageData {
  const destIndex = assignIndex % DESTINATIONS.length;
  assignIndex++;

  const dest = DESTINATIONS[destIndex];
  const stamp = getStampForDestination(dest.id)!;
  const [recipientName, streetLine] = RECIPIENTS[(assignIndex - 1) % RECIPIENTS.length];

  // Size category based on max dimension (visual only, not weight)
  const maxDim = Math.max(boxWidth, boxHeight, _boxDepth);
  const sizeCategory: 'small' | 'medium' | 'large' = maxDim >= 0.8 ? 'large' : maxDim >= 0.45 ? 'medium' : 'small';

  // Weight is independent of size - use predetermined array
  const weightKg = PACKAGE_WEIGHTS[(assignIndex - 1) % PACKAGE_WEIGHTS.length];

  return {
    packageId,
    recipientName,
    streetLine,
    destinationId: dest.id,
    destinationName: dest.displayName,
    requiredStampId: stamp.stampId,
    isStamped: false,
    appliedStampId: null,
    addressLabelMesh: null,
    stampVisualMesh: null,
    overweightLabelMesh: null,
    sizeCategory,
    weightKg,
    maxAllowedWeightKg: MAX_PACKAGE_WEIGHT_KG,
    isOverweight: weightKg > MAX_PACKAGE_WEIGHT_KG,
    hasBeenWeighed: false,
    hasOverweightLabel: false,
  };
}

export function createAddressLabel(pkg: PackageData, boxWidth: number, _boxDepth: number): THREE.Mesh {
  const labelW = Math.min(boxWidth * 0.8, 0.6);
  const labelH = labelW * 0.6;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#FFFDE8';
  ctx.fillRect(0, 0, 256, 160);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, 252, 156);

  ctx.fillStyle = '#222';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(pkg.recipientName, 10, 30);
  ctx.font = '15px sans-serif';
  ctx.fillText(pkg.streetLine, 10, 55);
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(pkg.destinationName, 10, 80);

  ctx.strokeStyle = '#888';
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(170, 95, 70, 55);
  ctx.setLineDash([]);
  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#aaa';
  ctx.fillText('郵票', 190, 125);

  const texture = new THREE.CanvasTexture(canvas);
  const geo = new THREE.PlaneGeometry(labelW, labelH);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.001;
  // Mark with userData for identification
  mesh.userData.isLabel = true;

  return mesh;
}

export function createStampVisual(stampId: string, boxWidth: number): THREE.Mesh {
  const stamp = getStampById(stampId);
  const size = Math.min(boxWidth * 0.25, 0.15);

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  const color = stamp ? `#${stamp.visualColor.toString(16).padStart(6, '0')}` : '#888';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, 60, 60);

  ctx.font = '28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.fillText(stamp?.icon || '?', 32, 42);

  const texture = new THREE.CanvasTexture(canvas);
  const geo = new THREE.PlaneGeometry(size, size);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(boxWidth * 0.25, 0.002, 0);
  mesh.userData.isStampVisual = true;

  return mesh;
}

export function createOverweightLabel(boxWidth: number, boxHeight: number): THREE.Mesh {
  const labelW = Math.min(boxWidth * 0.6, 0.3);
  const labelH = labelW * 0.5;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  // Red warning background
  ctx.fillStyle = '#CC0000';
  ctx.fillRect(0, 0, 128, 64);
  // White border
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 120, 56);
  // Text
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('過重', 64, 32);

  const texture = new THREE.CanvasTexture(canvas);
  const geo = new THREE.PlaneGeometry(labelW, labelH);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const mesh = new THREE.Mesh(geo, mat);

  // Position on front face of package (local Z+)
  mesh.position.set(0, boxHeight * 0.1, boxWidth / 2 + 0.007);
  mesh.userData.isOverweightLabel = true;

  return mesh;
}
