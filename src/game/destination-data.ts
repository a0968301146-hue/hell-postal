export interface Destination {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  color: number;
}

export const DESTINATIONS: Destination[] = [
  { id: 'taichung-city', name: '台中市', displayName: '台中市', icon: '🌇', color: 0xF4A460 },
  { id: 'taipei-city', name: '台北市', displayName: '台北市', icon: '🏙️', color: 0x4169E1 },
  { id: 'japan', name: '日本', displayName: '日本', icon: '🗻', color: 0xFF69B4 },
  { id: 'united-states', name: '美國', displayName: '美國', icon: '🗽', color: 0x228B22 },
];

export function getDestinationById(id: string): Destination | undefined {
  return DESTINATIONS.find(d => d.id === id);
}
