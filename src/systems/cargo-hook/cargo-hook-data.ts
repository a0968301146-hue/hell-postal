import { CargoCategory } from '../cargo/cargo-category-data';

/** Centralized initial-tuning values for the cargo hook tool ("Add tool
 * hotbar and cargo hook" round spec五: "初始測試數值集中放在
 * cargo-hook-data.ts") — cargo-hook-system.ts reads every one of these,
 * never hardcodes its own copy. Updated by "Improve cargo hook aerial
 * pickup" round for the lift+arc catch flow and the longer cooldown. */

/** Maximum distance (meters) the hook head can travel before giving up and
 * retracting with no target. */
export const CARGO_HOOK_MAX_RANGE = 8;

/** Hook head travel speed (m/s) for the outbound "extending" (fires from
 * the crosshair toward the target) and the miss-case retract animation —
 * unrelated to the cargo's OWN aerial lift/arc speed below. */
export const CARGO_HOOK_FLIGHT_SPEED = 20;

/** Hard cap (seconds) on how long a single hook sequence (extending →
 * attached → retracting) may stay active before it's force-cancelled. */
export const CARGO_HOOK_MAX_ACTIVE_DURATION = 2.5;

/** "Improve cargo hook aerial pickup" round spec二: how close (meters,
 * horizontal) the aerial arc's catch point must get to the player before a
 * real PickupSystem.pickUp() attempt fires. */
export const CARGO_HOOK_CATCH_DISTANCE = 1.1;

/** "勾貨勾升級" round — cooldown (seconds) entered after EVERY terminal
 * outcome (success, miss, wall-block, target invalidated, timeout), tracked
 * independently of the state machine's own `state` field so switching tools
 * away and back can never bypass it (see cargo-hook-system.ts's own
 * cooldownTimer field). Now indexed by the player's cargoHookLevel upgrade
 * (0..3, see upgrade-data.ts) rather than a single flat value — Lv.0's own
 * 9s is intentionally LONGER than the old flat 3s this replaces, since the
 * skill's whole point is to reward upgrading it down toward 3s. */
export const CARGO_HOOK_COOLDOWN_BY_LEVEL: readonly number[] = [9, 7, 5, 3];

/** Extra meters added on top of CARGO_HOOK_MAX_RANGE per cargoHookLevel
 * (spec: "基礎距離 +0/+1/+2/+3"). */
export const CARGO_HOOK_RANGE_BONUS_BY_LEVEL: readonly number[] = [0, 1, 2, 3];

/** Which CargoData.category values are hookable at each cargoHookLevel
 * (spec: Lv.0-2 只能小型／中型, Lv.3 全部貨物). 'normal'/'fragile' already
 * cover every small/medium cargo preset in cargo-shape-presets.ts — none of
 * them is ever sizeClass 'large' — so gating on category alone already
 * matches the spec's own "小型／中型貨物" framing without a separate
 * sizeClass check; 'large'/'frozen'/'live' items keep their OWN category
 * regardless of their sizeClass (e.g. a small-sized frozen crate is still
 * category 'frozen'), so this correctly blocks them pre-Lv.3 even when
 * their sizeClass alone would otherwise look "small". */
export const CARGO_HOOK_CATEGORIES_BY_LEVEL: readonly CargoCategory[][] = [
  ['normal', 'fragile'],
  ['normal', 'fragile'],
  ['normal', 'fragile'],
  ['normal', 'fragile', 'large', 'frozen', 'live'],
];

/** Whether a loose envelope is a valid hook target at each cargoHookLevel
 * (spec: Lv.1解鎖信件). */
export const CARGO_HOOK_ENVELOPE_UNLOCKED_BY_LEVEL: readonly boolean[] = [false, true, true, true];

/** Whether a lost-found item is a valid hook target at each cargoHookLevel
 * (spec: Lv.2解鎖失物招領). */
export const CARGO_HOOK_LOST_FOUND_UNLOCKED_BY_LEVEL: readonly boolean[] = [false, false, true, true];

/** Pull-speed tiering (spec六) — keyed off CargoData's own existing
 * `sizeClass` ('small'/'medium'/'large'), with a 'live' override for
 * `category === 'live'` cages (see cargo-hook-system.ts's
 * determinePullClass) so live cargo pulls slower than its raw sizeClass
 * would otherwise imply, without inventing any new per-item metadata. Now
 * governs the aerial arc's horizontal homing speed (see updateArcPhase)
 * rather than a flat ground-drag speed. */
export type CargoHookPullClass = 'small' | 'medium' | 'large' | 'live';

export const CARGO_HOOK_PULL_SPEED: Record<CargoHookPullClass, number> = {
  small: 8,
  medium: 6,
  large: 3.5,
  live: 3.5,
};

/** "Improve cargo hook aerial pickup" round spec三: how long the initial
 * straight-up lift takes (seconds) before the aerial arc begins. */
export const CARGO_HOOK_LIFT_DURATION = 0.2;

/** How high (meters) the initial lift raises the cargo, by pull class —
 * spec三's exact per-tier values (live shares large's height). */
export const CARGO_HOOK_LIFT_HEIGHT: Record<CargoHookPullClass, number> = {
  small: 0.9,
  medium: 0.75,
  large: 0.55,
  live: 0.55,
};

/** Extra height (meters) added at the arc's midpoint via a sine bump, so the
 * flight path reads as a genuine lobbed arc rather than a straight line
 * between the lift point and the catch point — not specified numerically by
 * spec, a modest value chosen for a visibly curved but still fast toss. */
export const CARGO_HOOK_ARC_HEIGHT_BONUS = 0.35;
