import * as THREE from 'three';
import { DESTINATIONS } from './destination-data';
import { getStampForDestination, getStampById } from './stamp-data';

export interface EnvelopeData {
  envelopeId: string;
  recipientName: string;
  streetLine: string;
  destinationId: string;
  destinationName: string;
  requiredStampId: string;
  isStamped: boolean;
  appliedStampId: string | null;
  isSorted: boolean;
  sortedBagId: string | null;
  isHeld: boolean;
  isOnStampTable: boolean;
}

// Shared interface for stamp minigame compatibility
export interface StampableItem {
  recipientName: string;
  streetLine: string;
  destinationName: string;
  requiredStampId: string;
  isStamped: boolean;
  appliedStampId: string | null;
}

const ENVELOPE_ADDRESSES: { recipient: string; street: string; destId: string }[] = [
  // 台中市 x3
  { recipient: '王小明', street: '台灣大道二段', destId: 'taichung-city' },
  { recipient: '林美玲', street: '中港路一段', destId: 'taichung-city' },
  { recipient: '張雅婷', street: '公益路三段', destId: 'taichung-city' },
  // 台北市 x3
  { recipient: 'Emily Chen', street: '信義路五段', destId: 'taipei-city' },
  { recipient: '陳大衛', street: '忠孝東路四段', destId: 'taipei-city' },
  { recipient: '李秀英', street: '中山北路二段', destId: 'taipei-city' },
  // 日本 x3
  { recipient: '佐藤優', street: '東京都新宿區', destId: 'japan' },
  { recipient: '田中花子', street: '大阪府堺市', destId: 'japan' },
  { recipient: '鈴木太郎', street: '京都府上京區', destId: 'japan' },
  // 美國 x3
  { recipient: 'Alex Smith', street: 'California', destId: 'united-states' },
  { recipient: 'John Williams', street: 'New York', destId: 'united-states' },
  { recipient: 'Sarah Johnson', street: 'Texas', destId: 'united-states' },
];

export function createAllEnvelopes(): EnvelopeData[] {
  return ENVELOPE_ADDRESSES.map((addr, i) => {
    const dest = DESTINATIONS.find(d => d.id === addr.destId)!;
    const stamp = getStampForDestination(addr.destId)!;
    return {
      envelopeId: `envelope-${i + 1}`,
      recipientName: addr.recipient,
      streetLine: addr.street,
      destinationId: addr.destId,
      destinationName: dest.displayName,
      requiredStampId: stamp.stampId,
      isStamped: false,
      appliedStampId: null,
      isSorted: false,
      sortedBagId: null,
      isHeld: false,
      isOnStampTable: false,
    };
  });
}

export function createEnvelopeAddressLabel(env: EnvelopeData): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 180;
  const ctx = canvas.getContext('2d')!;

  // Envelope background
  ctx.fillStyle = '#FFFFF0';
  ctx.fillRect(0, 0, 256, 180);
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, 252, 176);

  // Address text
  ctx.fillStyle = '#222';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(env.recipientName, 15, 40);
  ctx.font = '14px sans-serif';
  ctx.fillText(env.streetLine, 15, 65);
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText(env.destinationName, 15, 90);

  // Stamp box
  ctx.strokeStyle = '#999';
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(175, 110, 60, 50);
  ctx.setLineDash([]);
  ctx.font = '9px sans-serif';
  ctx.fillStyle = '#bbb';
  ctx.fillText('郵票', 192, 138);

  const texture = new THREE.CanvasTexture(canvas);
  const geo = new THREE.PlaneGeometry(0.28, 0.2);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.isLabel = true;
  return mesh;
}

export function createEnvelopeStampVisual(stampId: string): THREE.Mesh {
  const stamp = getStampById(stampId);
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  const color = stamp ? `#${stamp.visualColor.toString(16).padStart(6, '0')}` : '#888';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 48, 48);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, 44, 44);
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.fillText(stamp?.icon || '?', 24, 32);

  const texture = new THREE.CanvasTexture(canvas);
  const geo = new THREE.PlaneGeometry(0.06, 0.06);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.isStampVisual = true;
  return mesh;
}
