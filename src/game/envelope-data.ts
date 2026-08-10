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

// "世界地名與郵票圖樣調整" round — recipient/street text reworked to fit the
// same fantasy locations destination-data.ts now uses (this whole flow is
// disabled, ENABLE_LEGACY_COUNTER/ENABLE_LEGACY_MAIL_FLOW both false, but
// kept internally consistent rather than left referencing real-world cities).
const ENVELOPE_ADDRESSES: { recipient: string; street: string; destId: string }[] = [
  // 赫菲斯提亞 x3
  { recipient: '鐵爐岡·柏克', street: '鍛造大道二段', destId: 'taichung-city' },
  { recipient: '灰砧·霍恩', street: '熔火街一段', destId: 'taichung-city' },
  { recipient: '鋼須·多林', street: '礦工路三段', destId: 'taichung-city' },
  // 阿爾戈斯 x3
  { recipient: '艾蜜莉亞·凡爾', street: '王城大道五段', destId: 'taipei-city' },
  { recipient: '大衛·亞爾登', street: '商會街四段', destId: 'taipei-city' },
  { recipient: '秀英·蘭道', street: '中央廣場二段', destId: 'taipei-city' },
  // 東方群島 x3
  { recipient: '朝井優', street: '常世島新宿町', destId: 'japan' },
  { recipient: '汐花子', street: '朝霞島堺町', destId: 'japan' },
  { recipient: '潮太郎', street: '東雲島上京町', destId: 'japan' },
  // 精靈之島 x3
  { recipient: '銀葉·星語', street: '月光林道', destId: 'united-states' },
  { recipient: '風歌·夜露', street: '古樹之徑', destId: 'united-states' },
  { recipient: '露娜·星塵', street: '藤蔓小徑', destId: 'united-states' },
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
