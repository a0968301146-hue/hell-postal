// Centralized spatial data for the "counter NPC service" prototype (v0.1).
// The existing FRONT_OFFICE footprint (logistics-layout-data.ts) is split
// into two independent sub-rooms by a counter wall at Z = COUNTER.z:
//   - NPC_AREA  (Z: -2..4)  — customers enter, queue, step up to the counter
//   - PLAYER_AREA (Z: 4..10) — player's work space, leads to the back area
import { FRONT_OFFICE } from './logistics-layout-data';

export const COUNTER = {
  z: 4,
  thickness: 0.4,
  height: 1.0, // solid up to here — blocks walking through, item sits on top
  minX: FRONT_OFFICE.minX,
  maxX: FRONT_OFFICE.maxX,
};

export const NPC_AREA = {
  minX: FRONT_OFFICE.minX, maxX: FRONT_OFFICE.maxX,
  minZ: FRONT_OFFICE.minZ, maxZ: COUNTER.z,
  floorY: FRONT_OFFICE.floorY,
  ceilingHeight: FRONT_OFFICE.ceilingHeight,
};

export const PLAYER_AREA = {
  minX: FRONT_OFFICE.minX, maxX: FRONT_OFFICE.maxX,
  minZ: COUNTER.z, maxZ: FRONT_OFFICE.maxZ,
  floorY: FRONT_OFFICE.floorY,
  ceilingHeight: FRONT_OFFICE.ceilingHeight,
};

/** NPC entry/exit doorway, cut into the NPC area's back wall (minZ). */
export const NPC_DOOR = {
  centerX: 0,
  halfWidth: 0.9,
  height: 2.2,
  z: NPC_AREA.minZ,
};

/** Just inside the door — NPCs spawn here and walk in from this point. */
export const NPC_SPAWN_POINT = { x: 0, z: NPC_AREA.minZ + 0.6 };

/** Well outside the door — a leaving NPC walks all the way through the
 * doorway to here before being removed, so it visibly exits the building
 * instead of vanishing mid-room short of the door. */
export const NPC_EXIT_POINT = { x: 0, z: NPC_AREA.minZ - 1.5 };

/** Single-file queue line, index 0 = front (closest to the counter). */
export const NPC_QUEUE_SLOTS = [0, 1, 2, 3, 4].map(i => ({ x: 0, z: 1.7 - i * 0.8 }));

/** Where the NPC being served stands, on the NPC-area side of the counter. */
export const NPC_AT_COUNTER_SPOT = { x: 0, z: COUNTER.z - 0.7 };

/** Where the counter item (package/envelope) spawns, on top of the counter —
 * biased to the player-facing edge (z > COUNTER.z) so it unambiguously spawns
 * on the player's side of the glass partition, never at/behind the boundary. */
export const COUNTER_ITEM_SPOT = { x: 0, y: COUNTER.height, z: COUNTER.z + 0.12 };

/** Invisible (collider-only, no mesh) barrier on top of the counter, right
 * at the NPC/player boundary line — a backstop so a spawned item can never
 * get bumped/pushed past COUNTER.z back toward the NPC side. Measured with
 * real WASD-driven player movement: a player walking up to the counter can
 * shove a light item over a metre in one approach, so this is deliberately
 * tall (well above item-resting height, unlike a small decorative lip) —
 * being collider-only, it has zero visual effect on the window sightline
 * above it. */
export const COUNTER_ITEM_BACKSTOP = {
  minX: COUNTER.minX,
  maxX: COUNTER.maxX,
  z: COUNTER.z,
  thickness: 0.08,
  height: 0.6,
};

/** Glass partition above the counter, sealing the NPC/player boundary from
 * counter height up to the ceiling (the counter itself already blocks
 * floor-to-counter-height). Sits centered on the counter's Z line. */
export const COUNTER_GLASS = {
  minX: COUNTER.minX,
  maxX: COUNTER.maxX,
  z: COUNTER.z,
  thickness: 0.06,
  bottomY: COUNTER.height,
  topY: FRONT_OFFICE.ceilingHeight,
};

/** Service-window opening cut into the glass, centered above the counter
 * item spot — lets the player look straight at the NPC being served. Sits
 * right on top of the counter (COUNTER.height) so there's no odd sliver of
 * glass below it; the rest of COUNTER_GLASS stays solid around it. */
export const COUNTER_WINDOW = {
  centerX: 0,
  halfWidth: 0.55, // opening width 1.1m
  topY: 2.2, // opening height 1.2m, from counter top up to here
};

/** Open-for-business button, player-area side, beside the counter. */
export const OPEN_BUTTON_POS = { x: -4.5, z: COUNTER.z + 0.9 };

/** Player spawns inside the player area now that the front office is split. */
export const PLAYER_SPAWN = { x: 0, z: 7 };
