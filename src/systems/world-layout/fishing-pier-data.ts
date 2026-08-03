import * as THREE from 'three';
import { PIER } from './logistics-layout-data';

/** "Relocate pallet racks and add fishing pier" round三: an independent
 * small fishing pier, south of the main sea-vehicle PIER — every position
 * here is centralized so fishing-pier-builder.ts never hardcodes a
 * coordinate directly, matching this codebase's own established convention
 * (pallet-data.ts, logistics-layout-data.ts).
 *
 * Placed flush against the main pier's own south edge (PIER.maxZ=24) so the
 * two decks share one seam with zero height discontinuity (same floorY),
 * and entirely south of it — every sea vehicle's own dock/travel range stays
 * within z<=22.95 (see vehicle-dock-data.ts's SEA_DOCK_SLOTS), so this whole
 * structure is south of any vehicle activity by construction, needing no
 * further runtime collision-avoidance logic. X-range (10.8..13.2) sits
 * within the main pier's own X-span (10..18), near the shore/building side,
 * so it reads as a small offshoot rather than a separate structure. */
export const FISHING_PIER = {
  minX: 10.8, maxX: 13.2, // 2.4m wide
  minZ: PIER.maxZ, maxZ: PIER.maxZ + 4.0, // 4.0m long, extending further south
  floorY: PIER.floorY, // identical to the main pier deck — no height seam
  deckThickness: 0.18,
};

export const FISHING_PIER_CENTER_X = (FISHING_PIER.minX + FISHING_PIER.maxX) / 2;
export const FISHING_PIER_DECK_TOP_Y = FISHING_PIER.floorY;

/** Two chairs, side by side, both facing south (+Z, out over open water past
 * the deck's own south edge at FISHING_PIER.maxZ=28) — spec: "0.5~0.8m
 * apart", "碼頭末端附近". 0.6m gap in X; sitting 0.8m north of the deck's own
 * south edge keeps them clear of the open end while still reading as "near
 * the end".
 *
 * Deliberately NOT centered on the deck (which is only 2.4m wide) — the
 * player capsule's own radius (0.35m, physics-system.ts) plus each chair's
 * static collider half-extent (0.26m) means a centered pair leaves NEITHER
 * side lane wide enough to clear both a chair and the deck's own edge at
 * once. Shifting both chairs toward the WEST edge instead sacrifices the
 * west lane (already unusable) but leaves the full EAST lane
 * (x:~12.16..13.2, 1.04m) clear along the whole deck length — spec: "玩家仍
 * 可從椅子後方或側邊通過". */
const CHAIR_Z = FISHING_PIER.maxZ - 0.8;
export const FISHING_CHAIR_A = new THREE.Vector3(FISHING_PIER.minX + 0.5, FISHING_PIER_DECK_TOP_Y, CHAIR_Z);
export const FISHING_CHAIR_B = new THREE.Vector3(FISHING_PIER.minX + 1.1, FISHING_PIER_DECK_TOP_Y, CHAIR_Z);
/** Chairs face +Z — no yaw needed, the chair mesh itself is built with its
 * backrest on the -Z side. */
export const FISHING_CHAIR_FACING = 0;

/** Fishing dressing — clustered with the chairs on the west side, entirely
 * out of the clear east walking lane (spec: "不得妨礙行走動線",
 * "不可雜亂堆疊在走道上"). None of these carry colliders (purely visual),
 * but keeping them out of the lane avoids visual clutter on the path. */
export const FISHING_ROD_A = new THREE.Vector3(FISHING_PIER.minX + 0.15, FISHING_PIER_DECK_TOP_Y, CHAIR_Z + 0.35);
export const FISHING_ROD_B = new THREE.Vector3(FISHING_PIER.minX + 0.75, FISHING_PIER_DECK_TOP_Y, CHAIR_Z + 0.35);
export const FISHING_BUCKET = new THREE.Vector3(FISHING_PIER.minX + 0.3, FISHING_PIER_DECK_TOP_Y, FISHING_PIER.minZ + 1.6);
export const FISHING_TACKLE_BOX = new THREE.Vector3(FISHING_PIER.minX + 0.9, FISHING_PIER_DECK_TOP_Y, FISHING_PIER.minZ + 1.6);
export const FISHING_LANTERN = new THREE.Vector3(FISHING_PIER.minX + 0.6, FISHING_PIER_DECK_TOP_Y, FISHING_PIER.minZ + 0.6);

/** Future-use-only anchors ("NPCs fish after work", not implemented this
 * round — spec三: "不顯示、不碰撞，純資料集中管理"). Plain position data, no
 * scene-graph presence at all, so there is nothing to accidentally render or
 * collide with — a future system can read these directly. */
export const fishingSeatAnchorA = FISHING_CHAIR_A.clone();
export const fishingSeatAnchorB = FISHING_CHAIR_B.clone();
export const fishingLookTarget = new THREE.Vector3(FISHING_PIER_CENTER_X, FISHING_PIER_DECK_TOP_Y + 0.3, FISHING_PIER.maxZ + 6);
export const fishingActivityCenter = new THREE.Vector3(FISHING_PIER_CENTER_X, FISHING_PIER_DECK_TOP_Y, (CHAIR_Z + FISHING_PIER.maxZ) / 2);
