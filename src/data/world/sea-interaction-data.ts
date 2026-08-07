import * as THREE from 'three';
import { PIER } from '../../systems/world-layout/logistics-layout-data';
import { FISHING_PIER } from '../../systems/world-layout/fishing-pier-data';

/** "每日特殊劇情系統" round follow-up — Day6 moved from the campfire to "海
 * 面上的特殊互動區" (spec: "傳送至海面上的特殊互動區"). A small floating
 * platform out in open water, clear east of the fishing pier's own deck
 * (FISHING_PIER maxX=13.5) so it never overlaps or affects that structure —
 * still well within buildPierAndWater's own rendered water plane (roughly
 * x∈[4.4,28.4], z∈[6,30], see that function's own width*3/depth*2 sizing).
 * No day/night lighting change needed (none exists anywhere in this
 * codebase, per Day3's own skylight doc comment) — the "night at sea"
 * framing is carried by dialogue only, same established pattern. */
export const SEA_INTERACTION_AREA = {
  centerX: FISHING_PIER.maxX + 7,
  centerZ: FISHING_PIER.minZ + 2,
  waterY: PIER.waterY,
  platformY: PIER.waterY + 0.15, // small raft freeboard above the waterline
  radius: 1.4,
};

export const SEA_PLATFORM_CENTER = new THREE.Vector3(
  SEA_INTERACTION_AREA.centerX, SEA_INTERACTION_AREA.platformY, SEA_INTERACTION_AREA.centerZ
);
export const SEA_PLATFORM_PLAYER = new THREE.Vector3(
  SEA_INTERACTION_AREA.centerX - 0.5, SEA_INTERACTION_AREA.platformY, SEA_INTERACTION_AREA.centerZ
);
export const SEA_PLATFORM_NPC = new THREE.Vector3(
  SEA_INTERACTION_AREA.centerX + 0.5, SEA_INTERACTION_AREA.platformY, SEA_INTERACTION_AREA.centerZ
);
export const SEA_LOOK_TARGET = new THREE.Vector3(
  SEA_INTERACTION_AREA.centerX, SEA_INTERACTION_AREA.platformY + 0.4, SEA_INTERACTION_AREA.centerZ + 8
);
