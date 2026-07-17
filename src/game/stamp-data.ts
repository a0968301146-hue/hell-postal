export interface StampInfo {
  stampId: string;
  destinationId: string;
  displayName: string;
  icon: string;
  visualColor: number;
  description: string;
}

export const STAMPS: StampInfo[] = [
  { stampId: 'stamp-taichung', destinationId: 'taichung-city', displayName: '台中市郵票', icon: '🌇', visualColor: 0xF4A460, description: '台中市專用郵票' },
  { stampId: 'stamp-taipei', destinationId: 'taipei-city', displayName: '台北市郵票', icon: '🏙️', visualColor: 0x4169E1, description: '台北市專用郵票 - 台北101' },
  { stampId: 'stamp-japan', destinationId: 'japan', displayName: '日本郵票', icon: '🗻', visualColor: 0xFF69B4, description: '日本專用郵票 - 富士山' },
  { stampId: 'stamp-usa', destinationId: 'united-states', displayName: '美國郵票', icon: '🗽', visualColor: 0x228B22, description: '美國專用郵票 - 自由女神' },
];

export function getStampForDestination(destinationId: string): StampInfo | undefined {
  return STAMPS.find(s => s.destinationId === destinationId);
}

export function getStampById(stampId: string): StampInfo | undefined {
  return STAMPS.find(s => s.stampId === stampId);
}
