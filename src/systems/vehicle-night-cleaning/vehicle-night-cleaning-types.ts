// "載具夜間清潔互動" round — pure state/data shapes only, mirroring this
// codebase's own established "types file separate from the owning system"
// convention (dream-comic-types.ts / after-work-story-data.ts's own
// AfterWorkStoryDay). vehicle-night-cleaning-ui.ts and
// vehicle-night-cleaning-system.ts both import from here rather than either
// one owning the shapes the other depends on.

/** Explicit named states (spec十九: "不要用大量boolean互相控制") — one field
 * drives every gate in vehicle-night-cleaning-system.ts, mirroring
 * DailyState/StoryState's own established single-enum convention elsewhere
 * in this codebase. `waitingForStory` doubles as spec十九's own suggested
 * "completed" state — once every vehicle has been cleaned, thanked, AND
 * has actually departed ("回歸對話＋離開表演" round spec十一: 不能只用
 * allVehiclesCleaned, 必須清潔+感謝+離開全部完成) there is nothing left for
 * THIS system to do except sit still and report `allVehiclesCleaned` (read
 * by AfterWorkStorySystem's own startStory() guard — that getter's own
 * NAME is unchanged so that file needs no edits, but its underlying
 * `state === 'waitingForStory'` condition is now only reachable once every
 * vehicle has ALSO departed) until the following day's departure calls
 * startNight() again, so a separate terminal state would be a distinction
 * with no behavioral difference. */
export type NightCleaningState =
  | 'idle'                  // daytime — nothing to do, update() just returns
  | 'nightTransition'       // black fade in, player briefly locked
  | 'vehicleReturn'         // vehicles + their nightly cleaning points spawned, fading back out
  | 'vehicleReturnDialogue' // "回歸對話＋離開表演" round — one returned vehicle greeting the player, BEFORE cleaning unlocks; chains sequentially through every returned vehicle
  | 'cleaning'              // player free to walk between vehicles/points
  | 'cleaningDialogue'      // popup after ONE point completes, player locked
  | 'vehicleThankYou'       // popup after a WHOLE vehicle's points all complete, player locked
  | 'vehicleDeparting'      // "回歸對話＋離開表演" round — the just-thanked vehicle is driving itself out (VehicleSystem.moveToward toward its own exitPosition), player locked, before it's finally removed
  | 'waitingForStory';      // every vehicle cleaned+thanked+departed — AfterWorkStorySystem's own NPC may now start dialogue

/** One returned vehicle's own overnight cleaning progress — `vehicleSystem`
 * is intentionally `unknown` here (not `VehicleSystem`) to avoid this types
 * file importing the whole vehicle-system.ts class module just for a type
 * annotation; the owning system file imports the real type itself. */
export interface VehicleCleaningInstance {
  vehicleId: string;
  vehicleSystem: unknown;
  /** This NIGHT's randomly-drawn 4-5 point ids (spec七) — fixed once drawn,
   * never re-rolled mid-night. */
  activePointIds: string[];
  completedPointIds: Set<string>;
  /** "回歸對話＋離開表演" round — true once this vehicle's own automatic
   * return greeting has already been shown (drives beginNextReturnDialogue's
   * own "find the next un-greeted vehicle" sequencing — spec十: "一次處理
   * 一台"). */
  greeted: boolean;
  thanked: boolean;
}
