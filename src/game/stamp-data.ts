export interface StampInfo {
  stampId: string;
  destinationId: string;
  displayName: string;
  icon: string;
  visualColor: number;
  description: string;
}

export const STAMPS: StampInfo[] = [
  { stampId: 'stamp-taichung', destinationId: 'taichung-city', displayName: '赫菲斯提亞郵票', icon: '⚒️', visualColor: 0xCC5500, description: '赫菲斯提亞專用郵票 - 鍛造爐與鐵砧' },
  { stampId: 'stamp-taipei', destinationId: 'taipei-city', displayName: '阿爾戈斯郵票', icon: '🏰', visualColor: 0xD4AF37, description: '阿爾戈斯專用郵票 - 王城城門' },
  { stampId: 'stamp-japan', destinationId: 'japan', displayName: '東方群島郵票', icon: '🌅', visualColor: 0xFF7F50, description: '東方群島專用郵票 - 朝霞與群島' },
  { stampId: 'stamp-usa', destinationId: 'united-states', displayName: '精靈之島郵票', icon: '🌙', visualColor: 0x5F8A6F, description: '精靈之島專用郵票 - 巨樹與月光' },
];

export function getStampForDestination(destinationId: string): StampInfo | undefined {
  return STAMPS.find(s => s.destinationId === destinationId);
}

export function getStampById(stampId: string): StampInfo | undefined {
  return STAMPS.find(s => s.stampId === stampId);
}
