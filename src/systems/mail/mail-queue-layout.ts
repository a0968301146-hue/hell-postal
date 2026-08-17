import * as THREE from 'three';
import { BACK_AREA } from '../world-layout';
import { STAMP_TABLE, ENVELOPE_SIZE } from '../../data/world/mail-layout-data';

/** How far left/right of the table's own single-slot center (STAMP_TABLE.
 * posX, unchanged — still where the ACTIVE/currently-processing envelope
 * snaps to, exactly as before this round) the two queue piles sit (spec五:
 * "待處理堆位於工作台左側/已完成堆位於工作台右側...兩堆不可重疊"). */
const QUEUE_PILE_X_OFFSET = 0.5;
/** Vertical gap between stacked envelopes in a pending/completed pile —
 * ENVELOPE_SIZE.height plus a hair of daylight so faces don't z-fight. */
const QUEUE_PILE_STEP = ENVELOPE_SIZE.height + 0.003;

export function getPendingSlotPosition(index: number): THREE.Vector3 {
  const x = STAMP_TABLE.posX - QUEUE_PILE_X_OFFSET;
  const y = BACK_AREA.floorY + STAMP_TABLE.height + ENVELOPE_SIZE.height / 2 + 0.005 + index * QUEUE_PILE_STEP;
  const z = STAMP_TABLE.posZ;
  return new THREE.Vector3(x, y, z);
}

export function getCompletedSlotPosition(index: number): THREE.Vector3 {
  const x = STAMP_TABLE.posX + QUEUE_PILE_X_OFFSET;
  const y = BACK_AREA.floorY + STAMP_TABLE.height + ENVELOPE_SIZE.height / 2 + 0.005 + index * QUEUE_PILE_STEP;
  const z = STAMP_TABLE.posZ;
  return new THREE.Vector3(x, y, z);
}

export function getActiveSlotPosition(): THREE.Vector3 {
  const x = STAMP_TABLE.posX;
  const y = BACK_AREA.floorY + STAMP_TABLE.height + ENVELOPE_SIZE.height / 2 + 0.005;
  const z = STAMP_TABLE.posZ;
  return new THREE.Vector3(x, y, z);
}
