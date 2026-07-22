// Flatbed dolly ("拖板車") the player can push around the back area to carry
// several small packages at once. Replaces the earlier hand-carried "cart"
// concept — this round's spec explicitly wants a push-along tool, not
// something picked up like a box. All its own dimensions live here, not
// reused from sorting-box-data.ts or any other container's constants.
import { BACK_AREA } from './logistics-layout-data';

// Resized toward a real hand-truck's long-and-narrow proportions (was a
// near-square 1.3×0.9 "flatbed"). Width shrinks (0.9, was 1.3) so it clears
// the same doorways/aisles more comfortably; depth is the bed only — the
// handle/tow-bar posts extend further back into DOLLY_HANDLE_ZONE_DEPTH,
// which is NOT part of the cargo-bearing bed but IS part of the overall
// footprint used for collision + push-offset math (see DOLLY_TOTAL_DEPTH).
export const DOLLY_PLATFORM_WIDTH = 0.9;
export const DOLLY_PLATFORM_DEPTH = 1.4;
export const DOLLY_HANDLE_ZONE_DEPTH = 0.2;
/** Overall footprint depth (bed + handle zone) — used for the swept
 * collision shape and the camera push-offset, NOT for containerBounds
 * (which stays bed-only; see dolly-system.ts). */
export const DOLLY_TOTAL_DEPTH = DOLLY_PLATFORM_DEPTH + DOLLY_HANDLE_ZONE_DEPTH;
export const DOLLY_PLATFORM_THICKNESS = 0.08;
export const DOLLY_RAIL_HEIGHT = 0.16; // low lip — keeps parked cargo from drifting off the edge
export const DOLLY_RAIL_THICKNESS = 0.05;
export const DOLLY_HANDLE_HEIGHT = 0.9;

/** How far in front of the player (along their flattened look direction)
 * the platform's center sits while being pushed. Must clear the handle
 * posts (which sit at the BACK of the platform, closest to the player) by
 * more than the player capsule's radius (0.35, see physics-system.ts) so
 * pushing doesn't visually overlap the player's own body. */
export const DOLLY_PUSH_OFFSET = DOLLY_PLATFORM_DEPTH / 2 + DOLLY_HANDLE_ZONE_DEPTH + 0.5;

/** Movement speed multiplier applied while pushing — slower than a normal
 * walk, well short of empty-handed speed. */
export const DOLLY_PUSH_SPEED_MULTIPLIER = 0.55;

// Note: the push-collision sweep (see DollySystem.update()) uses the
// dolly's own real height exactly (no added vertical margin) — the dolly
// rests with only ~0.02m clearance above the floor it's parked on, so any
// added margin pushes the collision box's bottom edge below the floor
// surface and causes permanent self-collision with the floor slab itself.
//
// The dolly's own Y does not track floor-height changes while being pushed
// (a pre-existing limitation, unchanged this round); pushing it out of the
// back area across a floor-height boundary (e.g. up the stairs into the
// front office) is a separate, out-of-scope issue this round's collision
// fix does not solve.

export interface DollyConfig {
  dollyId: string;
  posX: number;
  posZ: number;
}

// Same open back-area spot the old cart used to occupy — already clear of
// the work-furniture cluster, sorting boxes, cargo-zone row and conveyor exit.
export const DOLLY_CONFIGS: DollyConfig[] = [
  { dollyId: 'dolly-1', posX: 7, posZ: 16 },
];

export const DOLLY_FLOOR_Y = BACK_AREA.floorY;
