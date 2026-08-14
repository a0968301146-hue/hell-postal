// "載具夜間清潔互動" round — pure state/data shapes only, mirroring this
// codebase's own established "types file separate from the owning system"
// convention (dream-comic-types.ts / after-work-story-data.ts's own
// AfterWorkStoryDay). vehicle-night-cleaning-ui.ts and
// vehicle-night-cleaning-system.ts both import from here rather than either
// one owning the shapes the other depends on.

/** Explicit named states (spec十九: "不要用大量boolean互相控制") — one field
 * drives every gate in vehicle-night-cleaning-system.ts, mirroring
 * DailyState/StoryState's own established single-enum convention elsewhere
 * in this codebase.
 *
 * "載具對話事件化" round — collapses what used to be four SEPARATE, mutually-
 * exclusive states ('vehicleReturnDialogue' / 'cleaningPointDialogue' /
 * 'vehicleThankYou' / 'vehicleDeparting') into this ONE 'cleaning' state.
 * Root cause this fixes: those four states each BLOCKED the top-level
 * update() switch from running updateCleaning() at all while active — so
 * completing a point's own charge (which transitions INTO one of them)
 * made it structurally impossible to start charging a DIFFERENT point (or
 * even the SAME vehicle's next one) until a SEPARATE, later E press
 * dismissed that dialogue first. Per-vehicle dialogue/departure progress is
 * now tracked by its own dedicated fields (dialogueVehicle/dialogueKind/
 * dialogueLineIndex, departingVehicle, departureQueue, pendingThankYouQueue
 * — see the owning system's own doc comments) that all coexist WITHIN the
 * single 'cleaning' phase, so aiming at any marker and charging it always
 * works regardless of what any OTHER vehicle's dialogue/departure is
 * currently doing (spec: "不得互相串話").
 *
 * `waitingForStory` doubles as spec十九's own suggested "completed" state —
 * once every vehicle has been cleaned, thanked, AND has actually departed
 * ("回歸對話＋離開表演" round spec十一: 不能只用 allVehiclesCleaned, 必須清潔+
 * 感謝+離開全部完成) there is nothing left for THIS system to do except sit
 * still and report `allVehiclesCleaned` (read by AfterWorkStorySystem's own
 * startStory() guard — that getter's own NAME is unchanged so that file
 * needs no edits, but its underlying `state === 'waitingForStory'`
 * condition is now only reachable once every vehicle has ALSO departed)
 * until the following day's departure calls startNight() again, so a
 * separate terminal state would be a distinction with no behavioral
 * difference. */
export type NightCleaningState =
  | 'idle'            // daytime — nothing to do, update() just returns
  | 'nightTransition' // black fade in, player briefly locked
  | 'vehicleReturn'   // vehicles + their nightly cleaning points spawned, fading back out
  | 'cleaning'        // the WHOLE rest of the night: aiming/charging points, per-vehicle greeting/point-reaction/thank-you dialogue, and vehicle departures all happen here, all in parallel, none of them blocking each other
  | 'waitingForStory'; // every vehicle cleaned+thanked+departed — AfterWorkStorySystem's own NPC may now start dialogue

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
  /** "載具對話事件化" round — true once this vehicle's own greeting has
   * already been auto-shown (drives the "skip if already greeted" checks in
   * showGreeting/updateCleaning's own aim-triggered reveal). No longer
   * drives a sequential "wait for E, then chain to the next vehicle" flow —
   * each vehicle's own greeting fires independently the moment it becomes
   * relevant (arrival, for the first vehicle; the player first aiming at
   * one of its markers, for every other one). */
  greeted: boolean;
  thanked: boolean;
}
