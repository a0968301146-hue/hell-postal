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
 * "completed" state — once every vehicle is thanked there is nothing left
 * for THIS system to do except sit still and report `allVehiclesCleaned`
 * (read by AfterWorkStorySystem's own startStory() guard) until the
 * following day's departure calls startNight() again, so a separate
 * terminal state would be a distinction with no behavioral difference. */
export type NightCleaningState =
  | 'idle'               // daytime — nothing to do, update() just returns
  | 'nightTransition'    // black fade in, player briefly locked
  | 'vehicleReturn'      // vehicles + their nightly cleaning points spawned, fading back out
  | 'cleaning'            // player free to walk between vehicles/points
  | 'cleaningDialogue'    // popup after ONE point completes, player locked
  | 'vehicleThankYou'    // popup after a WHOLE vehicle's points all complete, player locked
  | 'waitingForStory';   // every vehicle done — AfterWorkStorySystem's own NPC may now start dialogue

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
  thanked: boolean;
}
