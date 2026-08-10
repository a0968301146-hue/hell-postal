export interface Destination {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  color: number;
}

// "世界地名與郵票圖樣調整" round — this legacy counter/stamp-minigame flow is
// currently disabled (ENABLE_LEGACY_COUNTER/ENABLE_LEGACY_MAIL_FLOW both
// false, feature-flags.ts), but its own data still mirrors the same
// real-world place names the live mail-data.ts once did — renamed here to
// the same fantasy locations for consistency, ids left unchanged (internal
// keys, never shown to the player).
export const DESTINATIONS: Destination[] = [
  { id: 'taichung-city', name: '赫菲斯提亞', displayName: '赫菲斯提亞', icon: '⚒️', color: 0xCC5500 },
  { id: 'taipei-city', name: '阿爾戈斯', displayName: '阿爾戈斯', icon: '🏰', color: 0xD4AF37 },
  { id: 'japan', name: '東方群島', displayName: '東方群島', icon: '🌅', color: 0xFF7F50 },
  { id: 'united-states', name: '精靈之島', displayName: '精靈之島', icon: '🌙', color: 0x5F8A6F },
];

export function getDestinationById(id: string): Destination | undefined {
  return DESTINATIONS.find(d => d.id === id);
}
