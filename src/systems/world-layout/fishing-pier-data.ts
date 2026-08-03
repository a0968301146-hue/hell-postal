import * as THREE from 'three';
import { PIER } from './logistics-layout-data';

/** Independent small fishing pier, south of the main sea-vehicle PIER —
 * every position here is centralized so the builder in world-layout-
 * system.ts never hardcodes a coordinate directly, matching this codebase's
 * own established convention (pallet-data.ts, logistics-layout-data.ts).
 *
 * "Fix NPC interaction zone and expand fishing pier" round二: enlarged 25%
 * from the original 2.4m x 4.0m (2.4*1.25=3.0, 4.0*1.25=5.0) — X-range
 * widened to the spec's own suggested 10.5..13.5 (still well within the
 * main pier's own 10..18 X-span), length grown from minZ only (minZ still
 * == PIER.maxZ, so the north edge stays flush against the main pier with no
 * height discontinuity — only maxZ moved further south, 24 -> 29).
 *
 * Every sea vehicle's own dock/travel range stays within z<=22.95 (see
 * vehicle-dock-data.ts's SEA_DOCK_SLOTS) — even at the new maxZ=29 this
 * still leaves 1.05m clearance from minZ=24 to the nearest vehicle
 * footprint (kraken's own far edge), comfortably over the 0.5m minimum this
 * round asks for. */
export const FISHING_PIER = {
  minX: 10.5, maxX: 13.5, // 3.0m wide (was 2.4m)
  minZ: PIER.maxZ, maxZ: PIER.maxZ + 5.0, // 5.0m long (was 4.0m), extending further south
  floorY: PIER.floorY, // identical to the main pier deck — no height seam
  deckThickness: 0.18,
};

export const FISHING_PIER_CENTER_X = (FISHING_PIER.minX + FISHING_PIER.maxX) / 2;
export const FISHING_PIER_DECK_TOP_Y = FISHING_PIER.floorY;

/** Two chairs, side by side, both facing south (+Z, out over open water past
 * the deck's own south edge at FISHING_PIER.maxZ=29) — spec: "椅子間距維持
 * 約0.6~0.8m". 0.7m gap in X.
 *
 * Deliberately NOT centered on the deck — even at the new 3.0m width, a
 * centered pair plus the player capsule's own radius (0.35m, physics-
 * system.ts) still leaves neither side lane individually wide enough to
 * clear both a chair and the deck's own edge. Clustering both chairs
 * against the WEST edge instead sacrifices the (already-unusable) west lane
 * but leaves a full east lane 1.5m+ wide the whole deck length — spec此輪:
 * "至少保留1.0m可通行走道". See FISHING_PIER_EAST_LANE_CLEARANCE below for
 * the actual computed figure. */
const CHAIR_HALF_EXTENT = 0.26;
const CHAIR_GAP = 0.7;
const CHAIR_Z = FISHING_PIER.maxZ - 1.0;
export const FISHING_CHAIR_A = new THREE.Vector3(FISHING_PIER.minX + 0.5, FISHING_PIER_DECK_TOP_Y, CHAIR_Z);
export const FISHING_CHAIR_B = new THREE.Vector3(FISHING_CHAIR_A.x + CHAIR_GAP, FISHING_PIER_DECK_TOP_Y, CHAIR_Z);
/** Chairs face +Z — no yaw needed, the chair mesh itself is built with its
 * backrest on the -Z side. */
export const FISHING_CHAIR_FACING = 0;

/** East lane's own clear width — chair B's own east collider edge through
 * the deck's own east edge (spec requires >=1.0m; this is a plain derived
 * sanity figure, not itself consumed by any builder). */
export const FISHING_PIER_EAST_LANE_CLEARANCE =
  FISHING_PIER.maxX - (FISHING_CHAIR_B.x + CHAIR_HALF_EXTENT);

/** Fishing dressing — clustered with the chairs on the west side, entirely
 * out of the clear east walking lane (spec: "不得妨礙行走動線",
 * "不可雜亂堆疊在走道上"). None of these carry colliders (purely visual),
 * but keeping them out of the lane avoids visual clutter on the path. */
export const FISHING_ROD_A = new THREE.Vector3(FISHING_PIER.minX + 0.15, FISHING_PIER_DECK_TOP_Y, CHAIR_Z + 0.4);
export const FISHING_ROD_B = new THREE.Vector3(FISHING_CHAIR_B.x + 0.15, FISHING_PIER_DECK_TOP_Y, CHAIR_Z + 0.4);
export const FISHING_BUCKET = new THREE.Vector3(FISHING_PIER.minX + 0.3, FISHING_PIER_DECK_TOP_Y, FISHING_PIER.minZ + 1.8);
export const FISHING_TACKLE_BOX = new THREE.Vector3(FISHING_PIER.minX + 1.1, FISHING_PIER_DECK_TOP_Y, FISHING_PIER.minZ + 1.8);
export const FISHING_LANTERN = new THREE.Vector3(FISHING_PIER.minX + 0.7, FISHING_PIER_DECK_TOP_Y, FISHING_PIER.minZ + 0.7);

/** Future-use-only anchors ("NPCs fish after work", not implemented yet —
 * spec: "不顯示、不碰撞，純資料集中管理"). Plain position data, no
 * scene-graph presence at all, so there is nothing to accidentally render or
 * collide with — a future system can read these directly. */
export const fishingSeatAnchorA = FISHING_CHAIR_A.clone();
export const fishingSeatAnchorB = FISHING_CHAIR_B.clone();
export const fishingLookTarget = new THREE.Vector3(FISHING_PIER_CENTER_X, FISHING_PIER_DECK_TOP_Y + 0.3, FISHING_PIER.maxZ + 6);
export const fishingActivityCenter = new THREE.Vector3(FISHING_PIER_CENTER_X, FISHING_PIER_DECK_TOP_Y, (CHAIR_Z + FISHING_PIER.maxZ) / 2);
