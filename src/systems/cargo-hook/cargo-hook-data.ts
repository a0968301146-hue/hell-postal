/** Centralized initial-tuning values for the cargo hook tool ("Add tool
 * hotbar and cargo hook" round spec五: "初始測試數值集中放在
 * cargo-hook-data.ts") — cargo-hook-system.ts reads every one of these,
 * never hardcodes its own copy. */

/** Maximum distance (meters) the hook head can travel before giving up and
 * retracting with no target. */
export const CARGO_HOOK_MAX_RANGE = 8;

/** Hook head travel speed (m/s), used for BOTH the outbound (extending) and
 * inbound (retracting) animation. */
export const CARGO_HOOK_FLIGHT_SPEED = 20;

/** Hard cap (seconds) on how long a single hook sequence (extending →
 * attached → retracting) may stay active before it's force-cancelled. */
export const CARGO_HOOK_MAX_ACTIVE_DURATION = 2.5;

/** How close (meters, measured horizontally) a pulled item must get to a
 * point directly in front of the player before it auto-detaches. */
export const CARGO_HOOK_STOP_DISTANCE = 1.5;

/** Cooldown (seconds) after a hook sequence fully retracts before another
 * can be fired. */
export const CARGO_HOOK_COOLDOWN = 0.4;

/** Pull-speed tiering (spec六) — keyed off CargoData's own existing
 * `sizeClass` ('small'/'medium'/'large'), with a 'live' override for
 * `category === 'live'` cages (see cargo-hook-system.ts's
 * determinePullClass) so live cargo pulls slower than its raw sizeClass
 * would otherwise imply, without inventing any new per-item metadata. */
export type CargoHookPullClass = 'small' | 'medium' | 'large' | 'live';

export const CARGO_HOOK_PULL_SPEED: Record<CargoHookPullClass, number> = {
  small: 8,
  medium: 6,
  large: 3.5,
  live: 3.5,
};
