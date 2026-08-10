// Centralized spatial + count data for the "每日貨品清空核心流程" loop
// (unload -> sort -> ship -> end day). Kept separate from
// logistics-layout-data.ts (which owns the older counter/vehicle-era zones)
// so this round's new geometry isn't scattered across scene/system files.
//
// "刪除北邊房間" round: the separate front-office room the unload dock used
// to sit inside has been removed entirely — the back area is now the whole
// building, and the unload dock is mounted directly on ITS OWN north wall
// (all positions below are now BACK_AREA-relative). PALLET_CONFIG stays
// unchanged (still back-area furniture, untouched by this round).
//
// "重製出貨口" round: the old dual NORTH_GATES wall-mounted unload docks (and
// their launch-tube/burst-velocity spawn model) are replaced entirely by a
// single vertical chute mounted above a new north room (data/world/
// cargo-chute-room-layout-data.ts) — cargo now spawns invisibly at
// HIGH_CARGO_SPAWN_POINT, at the top of that chute, and falls under real
// gravity into the room below. UNLOAD_PORTS keeps its EXISTING shape/array
// form (still exactly the fields mail-system.ts/lost-found-system.ts read:
// spawnPoints/spawnY/gate.openDuration) but now has exactly ONE entry built
// from the new chute geometry instead of two built from NORTH_GATES — so
// those two files needed zero changes despite this rewrite.
import {
  CARGO_CHUTE_PIPE, CARGO_CHUTE_HATCH, HIGH_CARGO_SPAWN_POINT, CARGO_CHUTE_BUTTON_POS,
} from '../../data/world/cargo-chute-room-layout-data';

/** How many cargo items spawn each day — "Day 1～7 每日系統完整實作" round:
 * no longer a fixed constant (see cargo-manifest-planner.ts's
 * buildDailyCargoManifest, which reads daily-unlock-data.ts's own per-day
 * total instead). Kept here ONLY as a historical/doc-comment reference point
 * for other files that still describe scale relative to "a normal day" —
 * nothing reads this constant to decide an actual spawn count anymore. */
export const DAILY_CARGO_CONFIG = {
  total: 90,
};

/** One spawn lane within the chute's own interior footprint (spec四:
 * "所有貨物統一由 HIGH_CARGO_SPAWN_POINT 之類的單一生成位置控制" — these lanes
 * are all still comfortably inside that one chute, just giving falling
 * items a little scatter/variety exactly like the old multi-lane system
 * did, never a second independent spawn location). `maxHalfWidth`/
 * `maxHalfDepth` are the largest item footprint this lane can safely hold
 * without its own collider approaching the chute's own housing walls —
 * UnloadingSystem.pickSpawnPosition filters candidate lanes by these before
 * ever trying one, on top of its own live castShape overlap check. */
export interface UnloadSpawnLane {
  id: string;
  x: number;
  z: number;
  /** Added on top of the port's base spawnY. */
  yOffset: number;
  maxHalfWidth: number;
  maxHalfDepth: number;
  preferLarge: boolean;
}

function buildChuteLanes(): UnloadSpawnLane[] {
  // Stay clear of the pipe's own housing walls on every side.
  const usableHalf = CARGO_CHUTE_PIPE.width / 2 - 0.5;
  const sideOffset = usableHalf * 0.5;
  return [
    // Wide/central — reserved first for large cargo (including the Day8
    // giant cake), but still selectable by anything else if the narrower
    // lanes are occupied.
    { id: 'center-wide', x: CARGO_CHUTE_PIPE.centerX, z: CARGO_CHUTE_PIPE.centerZ, yOffset: 0, maxHalfWidth: usableHalf * 0.85, maxHalfDepth: usableHalf * 0.85, preferLarge: true },
    // Two narrower lanes, spaced far enough apart (2x sideOffset) that their
    // own maxHalfWidth allowances can never geometrically overlap each other.
    { id: 'left', x: CARGO_CHUTE_PIPE.centerX - sideOffset, z: CARGO_CHUTE_PIPE.centerZ - sideOffset * 0.4, yOffset: 0.2, maxHalfWidth: sideOffset * 0.7, maxHalfDepth: sideOffset * 0.7, preferLarge: false },
    { id: 'right', x: CARGO_CHUTE_PIPE.centerX + sideOffset, z: CARGO_CHUTE_PIPE.centerZ + sideOffset * 0.4, yOffset: 0.2, maxHalfWidth: sideOffset * 0.7, maxHalfDepth: sideOffset * 0.7, preferLarge: false },
  ];
}

export interface UnloadPortConfig {
  id: string;
  /** Horizontal hatch/trapdoor at the chute's own base — purely a visual
   * open/close cue synced with UnloadingSystem's existing burst-timing state
   * machine (unchanged animation code, just applied to a horizontal panel's
   * Y position instead of a vertical wall panel's). mail-system.ts/lost-
   * found-system.ts only ever read `gate.openDuration` (to time their own
   * spawn-delay arm) — never the rest of this object — so those two files
   * stayed correct despite every other field here changing shape. */
  gate: {
    centerX: number; centerZ: number; centerY: number;
    width: number; depth: number; thickness: number;
    openOffsetY: number; openDuration: number;
  };
  /** The vertical pipe housing itself — the "不可視區域" cargo spawns
   * inside, well above the room's own visible ceiling line. */
  chute: { centerX: number; centerZ: number; baseY: number; topY: number; width: number; depth: number; wallThickness: number };
  /** Several distinct spawn points spread across the chute's own interior
   * (spec四, mirrors the old multi-point convention) — each comfortably
   * inside the physical pipe. mail-system.ts's own envelope spawn still
   * reads this array directly. */
  spawnPoints: { x: number; z: number }[];
  /** Cargo spawn height — HIGH_CARGO_SPAWN_POINT's own Y, near the top of
   * the chute. */
  spawnY: number;
  /** Dimension-aware spawn lanes — UnloadingSystem.pickSpawnPosition is the
   * only reader. */
  lanes: UnloadSpawnLane[];
}

function buildCargoChutePort(): UnloadPortConfig {
  return {
    id: 'cargo-chute',
    gate: {
      centerX: CARGO_CHUTE_HATCH.centerX,
      centerZ: CARGO_CHUTE_HATCH.centerZ,
      centerY: CARGO_CHUTE_HATCH.closedY,
      width: CARGO_CHUTE_HATCH.width,
      depth: CARGO_CHUTE_HATCH.depth,
      thickness: CARGO_CHUTE_HATCH.thickness,
      openOffsetY: CARGO_CHUTE_HATCH.openOffsetY,
      openDuration: CARGO_CHUTE_HATCH.openDuration,
    },
    chute: {
      centerX: CARGO_CHUTE_PIPE.centerX,
      centerZ: CARGO_CHUTE_PIPE.centerZ,
      baseY: CARGO_CHUTE_PIPE.baseY,
      topY: CARGO_CHUTE_PIPE.topY,
      width: CARGO_CHUTE_PIPE.width,
      depth: CARGO_CHUTE_PIPE.depth,
      wallThickness: CARGO_CHUTE_PIPE.wallThickness,
    },
    spawnPoints: [
      { x: HIGH_CARGO_SPAWN_POINT.x - 0.7, z: HIGH_CARGO_SPAWN_POINT.z },
      { x: HIGH_CARGO_SPAWN_POINT.x, z: HIGH_CARGO_SPAWN_POINT.z + 0.4 },
      { x: HIGH_CARGO_SPAWN_POINT.x + 0.7, z: HIGH_CARGO_SPAWN_POINT.z },
    ],
    spawnY: HIGH_CARGO_SPAWN_POINT.y,
    lanes: buildChuteLanes(),
  };
}

/** THE single cargo/mail/lost-item unload port ("重製出貨口" round spec四:
 * "不要每種貨物使用不同出貨口...所有貨物統一由單一生成位置控制") — kept as a
 * one-element ARRAY (not a bare object) so mail-system.ts/lost-found-
 * system.ts's existing `UNLOAD_PORTS[Math.floor(Math.random() *
 * UNLOAD_PORTS.length)]` random-pick code keeps working completely
 * unchanged (always resolves to index 0 when length is 1). */
export const UNLOAD_PORTS: UnloadPortConfig[] = [buildCargoChutePort()];

/** Small per-item spawn-point jitter on top of whichever spawn point is
 * used, so consecutive items from the same point still don't spawn exactly
 * stacked. */
export const UNLOAD_SPAWN_JITTER_X = 0.3;
export const UNLOAD_SPAWN_JITTER_Z = 0.25;

/** Burst/jet unload performance — "重製出貨口" round spec五: cargo must fall
 * under REAL gravity from the high chute spawn point, not launch on a
 * strong ballistic arc the way the old wall-mounted gate's cargo did.
 * forward/lateral speeds are cut to a small scatter-only range and up speed
 * stays purely non-positive (never an upward pop) — gravity alone dominates
 * the ~10m drop from HIGH_CARGO_SPAWN_POINT down to the room floor, letting
 * items visibly tumble and land naturally rather than being thrown. Timing
 * fields (waveCount/chargeUpDuration/waveGapMin-Max/itemIntervalMin-Max/
 * settleAfterLastItem) are unchanged from before this round — only the
 * VELOCITY ranges changed. Shared by UnloadingSystem's cargo spawns AND
 * mail-system.ts's own envelope spawns (both read this same constant). */
export const UNLOAD_BURST_CONFIG = {
  /** How many waves the day's cargo splits into, and a brief charge-up
   * before the first wave fires. UnloadingSystem's own buildSpawnPlan
   * further scales the ACTUAL wave count down for smaller days (targeting
   * ~3 items/wave) — this is only the ceiling. */
  waveCount: 30,
  chargeUpDuration: 0.4,
  /** Pause between waves. */
  waveGapMin: 0.5,
  waveGapMax: 0.7,
  /** Per-item spacing within one wave. */
  itemIntervalMin: 0.08,
  itemIntervalMax: 0.18,
  /** Launch velocity ranges — "重製出貨口" round: small scatter only, real
   * gravity does the actual falling (forward = world Z, lateral = world X,
   * up = world Y). */
  forwardSpeedMin: 0.3, forwardSpeedMax: 1.0,
  upSpeedMin: -0.6, upSpeedMax: -0.1,
  lateralSpeedMin: -0.8, lateralSpeedMax: 0.8,
  /** Angular velocity range applied at launch (rad/s per axis) — unchanged,
   * still gives items a natural tumble as they fall. */
  angularSpeedMax: 4,
  /** How long after the last item launches before the hatch starts closing
   * (lets the burst finish settling). */
  settleAfterLastItem: 0.8,
};

/** Wall-side pos for the 開始卸貨 button — "重製出貨口" round: relocated to
 * just west of the new chute room's own single doorway (see
 * cargo-chute-room-layout-data.ts), still inside BACK_AREA itself. "每日結算
 * 流程修改" round removed the old 結束今天 button entirely (see
 * daily-flow-system.ts's own doc comment) — this is the only button left in
 * that cluster now. */
export const UNLOAD_BUTTON_POS = CARGO_CHUTE_BUTTON_POS;

/** Central sorting platform — a wooden pallet, sized within spec's 1.0-1.2m
 * range. Untouched by this round — still in the back area, well clear of
 * the doorway/stairs and the vehicle control posts' footprint. */
export const PALLET_CONFIG = {
  posX: -4.0,
  posZ: 15.5,
  width: 1.1,
  depth: 1.1,
  height: 0.15,
  /** Half-height above the pallet TOP a box's center must sit within to
   * count as "on" it — generous enough for stacked boxes. */
  detectHeight: 1.0,
};

/** East-side outbound zone — NOT used by the main flow this round (cargo
 * ships by riding along with a vehicle, not by walking into a ground zone).
 * Kept only so outbound-zone-system.ts (uninitialized in game.ts, see
 * feature-flags.ts doc comment there) still compiles if it's reused in a
 * future round. */
export const OUTBOUND_ZONE = {
  minX: 5.5, maxX: 9.2,
  minZ: 23.5, maxZ: 28.0,
};

// Daily box/roller/large size+shape+color+label presets moved to
// cargo-data.ts (CARGO_BOX_PRESETS/CARGO_ROLLER_PRESETS/CARGO_LARGE_PRESETS)
// — cargo identity is bound together in ONE place alongside its subtype/
// label, rather than living here as a bare size list.
