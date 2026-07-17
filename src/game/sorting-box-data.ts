import { DESTINATIONS } from './destination-data';
import { getStampForDestination } from './stamp-data';

export const SORTING_BOX_CAPACITY = 10;

// Box physical dimensions
export const SBOX_WIDTH = 0.9;
export const SBOX_DEPTH = 0.7;
export const SBOX_HEIGHT = 0.75;
export const SBOX_WALL_THICKNESS = 0.06;

export interface SortingBoxData {
  boxId: string;
  destinationId: string;
  destinationName: string;
  acceptedStampId: string;
  displayName: string;
  icon: string;
  envelopeIds: string[];
  envelopeCount: number;
  capacity: number;
  isHeld: boolean;
  isPlaced: boolean;
}

export interface SortingBoxConfig {
  boxId: string;
  destinationId: string;
  posX: number;
  posZ: number;
}

// Positions: right side of room, on the GROUND, away from tables
export const SORTING_BOX_CONFIGS: SortingBoxConfig[] = [
  { boxId: 'sortbox-taichung', destinationId: 'taichung-city', posX: 4.0, posZ: 2.0 },
  { boxId: 'sortbox-taipei', destinationId: 'taipei-city', posX: 5.3, posZ: 2.0 },
  { boxId: 'sortbox-japan', destinationId: 'japan', posX: 4.0, posZ: 3.5 },
  { boxId: 'sortbox-usa', destinationId: 'united-states', posX: 5.3, posZ: 3.5 },
];

export function createSortingBoxData(config: SortingBoxConfig): SortingBoxData {
  const dest = DESTINATIONS.find(d => d.id === config.destinationId)!;
  const stamp = getStampForDestination(config.destinationId)!;
  return {
    boxId: config.boxId,
    destinationId: config.destinationId,
    destinationName: dest.displayName,
    acceptedStampId: stamp.stampId,
    displayName: `${dest.displayName}分類箱`,
    icon: dest.icon,
    envelopeIds: [],
    envelopeCount: 0,
    capacity: SORTING_BOX_CAPACITY,
    isHeld: false,
    isPlaced: true,
  };
}
