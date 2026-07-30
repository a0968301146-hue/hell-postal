// Centralized spatial + count data for the "每日貨品清空核心流程" loop
// (unload -> sort -> ship -> end day). Kept separate from
// logistics-layout-data.ts (which owns the older counter/vehicle-era zones)
// so this round's new geometry isn't scattered across scene/system files.
// NORTH_GATES is the one exception — it lives in logistics-layout-data.ts
// because scene-manager.ts's buildBackArea() needs it alongside the
// existing LAND_GATE/SEA_GATE constants it already imports from there.
//
// "刪除北邊房間" round: the separate front-office room the unload dock used
// to sit inside has been removed entirely — the back area is now the whole
// building, and the unload dock is mounted directly on ITS OWN north wall
// (all positions below are now BACK_AREA-relative). PALLET_CONFIG stays
// unchanged (still back-area furniture, untouched by this round).
import { BACK_AREA, NORTH_GATES } from '../world-layout';

/** How many cargo items spawn each day, fixed (spec "貨品外型與比例有更多
 * 變化" round section二: no infinite spawn, no per-day variation of the
 * total). This is the ONE place the daily total is defined —
 * UnloadingSystem builds its spawn plan from these counts (split evenly
 * across UNLOAD_PORTS, see buildSpawnPlan), and DailyFlowSystem/HUD/
 * vehicle-shipment counting/departure-time scoring/next-day cleanup all read
 * the ACTUAL number of ids UnloadingSystem registers (registerDailyCargo),
 * never this constant directly, so nothing else needed to change here.
 *
 * "Fix cargo throwing and rebalance daily manifest" round三: the per-category
 * breakdown that used to live here (normalCount/fragileCount/largeCount/
 * frozenCount/liveCount) moved to cargo-manifest-data.ts's
 * DAILY_CARGO_CATEGORY_QUOTA, alongside its new per-region sub-quota
 * (DAILY_CARGO_REGION_QUOTA) — UnloadingSystem's buildSpawnPlan now builds
 * its item list via cargo-manifest-planner.ts's buildDailyCargoManifest()
 * instead of reading counts off this object. `total` stays here (unchanged
 * at 90, spec: "貨物總量維持90件") since other files' doc comments/upgrade
 * tuning still reference it as the day's overall cargo scale. */
export const DAILY_CARGO_CONFIG = {
  total: 90,
};

/** How far below the ceiling an elevated port's cargo spawn point sits —
 * "天花板高度－安全間距" (spec "Add dual elevated unloading ports and
 * day-one special cargo" round 一). Covers the tallest daily-cargo preset's
 * own half-height (large-tall-crate, cargo-data.ts CARGO_LARGE_PRESETS,
 * 1.55m tall / 0.775 half) plus a clearance buffer, so a spawned item's own
 * top surface never pokes into the ceiling (BACK_AREA.ceilingHeight above
 * the floor). */
export const UNLOAD_PORT_CEILING_SAFETY_MARGIN = 1.3;
const PORT_SPAWN_Y = BACK_AREA.floorY + BACK_AREA.ceilingHeight - UNLOAD_PORT_CEILING_SAFETY_MARGIN;

/** One spawn lane ("Add playable envelope presets and fix unloading spawn
 * jams" round spec二: "兩個北側卸貨口各自建立數個 spawn lane...lane之間保留
 * 足夠間距...大型貨物優先使用較寬、較中央的lane...信封使用較高且靠前的
 * lane"). `maxHalfWidth`/`maxHalfDepth` are the largest item footprint this
 * lane can safely hold without its own collider approaching the neighboring
 * lane, the chute housing, or the gate's own side walls —
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

function buildSpawnLanes(gate: { centerX: number; halfWidth: number }, chuteTopZ: number): UnloadSpawnLane[] {
  const usableHalfWidth = gate.halfWidth - 0.5; // stay clear of the gate's own side edges
  const sideOffset = usableHalfWidth * 0.55;
  return [
    // Wide/central — reserved first for large cargo (spec: "大型貨物優先使
    // 用較寬、較中央的lane"), but still selectable by anything else if the
    // narrower lanes are occupied.
    { id: 'center-wide', x: gate.centerX, z: chuteTopZ + 0.5, yOffset: 0, maxHalfWidth: usableHalfWidth * 0.85, maxHalfDepth: 0.95, preferLarge: true },
    // Two narrower lanes, spaced far enough apart (2x sideOffset) that their
    // own maxHalfWidth allowances can never geometrically overlap each other.
    { id: 'left-normal', x: gate.centerX - sideOffset, z: chuteTopZ + 0.3, yOffset: 0, maxHalfWidth: sideOffset * 0.7, maxHalfDepth: 0.4, preferLarge: false },
    { id: 'right-normal', x: gate.centerX + sideOffset, z: chuteTopZ + 0.3, yOffset: 0, maxHalfWidth: sideOffset * 0.7, maxHalfDepth: 0.4, preferLarge: false },
    // Higher and further into the room than the other lanes (spec: "信封使
    // 用較高且靠前的lane，避免卡入縫隙") — clears the gap between the wall
    // and the chute housing entirely rather than threading through it.
    { id: 'envelope-high', x: gate.centerX, z: chuteTopZ + 0.9, yOffset: 0.4, maxHalfWidth: 0.3, maxHalfDepth: 0.3, preferLarge: false },
  ];
}

export interface UnloadPortConfig {
  id: string;
  /** Gate door — a single flat panel filling the wall opening floor-to-
   * ceiling (matching the flanking wall segments' full height, so "closed"
   * genuinely seals the gap, not just its lower portion), translated
   * straight up to "open". Purely visual — UnloadingSystem's own permanent
   * invisible collider (spec "防止貨品飛出場景的隱藏安全碰撞") stays solid
   * across the WHOLE opening regardless of the panel's animation state, so
   * nothing can ever physically cross this wall plane either way. */
  gate: { centerX: number; centerZ: number; width: number; height: number; thickness: number; openOffsetY: number; openDuration: number };
  /** Launch-tube housing (spec 一: cargo now emerges near the ceiling and
   * pours down). Cargo no longer physically slides down this (it launches
   * on its own trajectory instead, see UnloadingSystem.spawnOne) — the ramp
   * housing stays as the physical "launch tube" the burst mechanism
   * protrudes from, now spanning from near the ceiling down toward the
   * floor (steeper than the old floor-level chute, which is fine since it's
   * decorative only). */
  chute: { topX: number; topY: number; topZ: number; bottomX: number; bottomZ: number; width: number; thickness: number };
  /** Several distinct spawn points spread across this port's own gate width
   * (spec "貨品外型與比例有更多變化" round section四: "必要時使用數個不同噴
   * 射生成點") — each comfortably inside the physical chute. Kept alongside
   * `lanes` below — mail-system.ts's own envelope spawn still reads this
   * array directly and is out of scope for this round. */
  spawnPoints: { x: number; z: number }[];
  /** Cargo spawn height for this port — near the ceiling (PORT_SPAWN_Y),
   * same for every port since they share one north wall. */
  spawnY: number;
  /** Dimension-aware spawn lanes ("Add playable envelope presets and fix
   * unloading spawn jams" round spec二) — UnloadingSystem.pickSpawnPosition
   * is the only reader. */
  lanes: UnloadSpawnLane[];
}

function buildUnloadPort(gate: { id: string; centerX: number; halfWidth: number }): UnloadPortConfig {
  const chuteTopZ = BACK_AREA.minZ + 0.15;
  const chuteTopY = PORT_SPAWN_Y - 0.35;
  return {
    id: gate.id,
    gate: {
      centerX: gate.centerX,
      centerZ: BACK_AREA.minZ,
      width: gate.halfWidth * 2 - 0.1,
      height: BACK_AREA.ceilingHeight,
      thickness: 0.15,
      openOffsetY: BACK_AREA.ceilingHeight, // raises it fully clear of the opening
      openDuration: 0.8, // seconds, within spec's 0.6-1s window
    },
    chute: {
      topX: gate.centerX,
      topY: chuteTopY,
      topZ: chuteTopZ,
      bottomX: gate.centerX,
      bottomZ: BACK_AREA.minZ + 1.95,
      width: gate.halfWidth * 2 - 0.6,
      thickness: 0.12,
    },
    spawnPoints: [
      { x: gate.centerX - 0.8, z: chuteTopZ + 0.2 },
      { x: gate.centerX, z: chuteTopZ + 0.3 },
      { x: gate.centerX + 0.8, z: chuteTopZ + 0.2 },
    ],
    spawnY: PORT_SPAWN_Y,
    lanes: buildSpawnLanes(gate, chuteTopZ),
  };
}

/** One entry per north-wall unload port (logistics-layout-data.ts
 * NORTH_GATES) — the ONE place port position/height/spawn-point data lives;
 * UnloadingSystem builds its per-port gate/chute meshes and spawn logic from
 * this array, never hardcoding a port's geometry inline. */
export const UNLOAD_PORTS: UnloadPortConfig[] = NORTH_GATES.map(buildUnloadPort);

/** Small per-item spawn-point jitter on top of whichever port spawn point is
 * used, so consecutive items from the same point still don't spawn exactly
 * stacked. Shared across ports. */
export const UNLOAD_SPAWN_JITTER_X = 0.3;
export const UNLOAD_SPAWN_JITTER_Z = 0.25;

/** Burst/jet unload performance (spec section三/四/五) — replaces the old
 * one-at-a-time gentle slide. All spawn-sequence timing/velocity tuning
 * lives here, not scattered across UnloadingSystem's methods. */
export const UNLOAD_BURST_CONFIG = {
  /** How many waves the day's cargo splits into, and a brief charge-up
   * before the first wave fires (spec 三: "裝置短暫蓄力"). Scaled ×10
   * alongside DAILY_CARGO_CONFIG.total (spec "北側到貨量 ×10" section:
   * "仍分批噴出，不要一次生成180件，避免物理卡頓") so each wave still only
   * drops 6 items at a time (180/30 — same per-wave batch size the
   * original 18/3 config used), rather than 60 items landing in the same
   * small drop zone within one wave. */
  waveCount: 30,
  chargeUpDuration: 0.4,
  /** Pause between waves (spec四: "每波之間短暫停頓"). */
  waveGapMin: 0.5,
  waveGapMax: 0.7,
  /** Per-item spacing within one wave (spec四: "0.08~0.18秒"). */
  itemIntervalMin: 0.08,
  itemIntervalMax: 0.18,
  /** Launch velocity ranges (spec四). Forward = +Z (into the room), up = +Y,
   * lateral = world X. "Add playable envelope presets and fix unloading
   * spawn jams" round spec三: "生成後加入朝倉庫內部且略微向下的初始速度...
   * 不要只垂直落下或只向牆面方向推動" — upSpeed is now a mild DOWNWARD range
   * (items already spawn right up near the ceiling specifically so they can
   * "pour down" into the room, see UNLOAD_PORT_CEILING_SAFETY_MARGIN's own
   * doc comment; launching them further UP first was the single biggest
   * contributor to ceiling-clipping at spawn) — forward/lateral stay
   * unchanged so the motion is still a genuine forward-and-down arc into the
   * room, never a pure vertical drop or a push back toward the wall. Shared
   * by both UnloadingSystem's cargo spawns AND mail-system.ts's own envelope
   * spawns (both read this same constant), so this one change improves both
   * without touching mail-system.ts at all. */
  forwardSpeedMin: 4, forwardSpeedMax: 7,
  upSpeedMin: -1.2, upSpeedMax: -0.3,
  lateralSpeedMin: -1.5, lateralSpeedMax: 1.5,
  /** Angular velocity range applied at launch (rad/s per axis) — spec: "貨
   * 物在空中帶有不同角度與旋轉". */
  angularSpeedMax: 4,
  /** How long after the last item launches before the gate starts closing
   * (lets the burst finish settling — spec三 step7 "最後一件噴出後，閘門關
   * 閉" — a short buffer avoids clipping the last item's flight). */
  settleAfterLastItem: 0.8,
};

/** Open floor where the pile lands and gets broken apart — the back area's
 * own north end, well clear of the player spawn (z=14.8, see
 * logistics-layout-data.ts PLAYER_SPAWN) and the pallet (z=15.5). Spans
 * every port's own gate width (spec "Add dual elevated unloading ports and
 * day-one special cargo" round 二: two ports on the same north wall). */
const northGateEdges = NORTH_GATES.flatMap(g => [g.centerX - g.halfWidth, g.centerX + g.halfWidth]);
export const UNLOAD_ZONE = {
  minX: Math.min(...northGateEdges) + 0.3, maxX: Math.max(...northGateEdges) - 0.3,
  minZ: BACK_AREA.minZ + 0.3, maxZ: BACK_AREA.minZ + 4.3,
};

/** Wall-side pos for the two unloading-control buttons — off to the west
 * side of the west-most gate opening (clear of every port's own X range and
 * chute/drop paths), spaced apart from each other in Z. Both sit just
 * inside the back area's own north wall (spec section 十九: grouped under
 * "北側卸貨區"). A single shared button pair still controls both ports
 * together (spec doesn't ask for a second button — only the ports/gates/
 * chutes/spawn points are duplicated). */
const westMostNorthGate = [...NORTH_GATES].sort((a, b) => a.centerX - b.centerX)[0];
export const UNLOAD_BUTTON_POS = { x: westMostNorthGate.centerX - westMostNorthGate.halfWidth - 2.0, z: BACK_AREA.minZ + 1.2 };
export const END_DAY_BUTTON_POS = { x: westMostNorthGate.centerX - westMostNorthGate.halfWidth - 2.0, z: BACK_AREA.minZ + 2.8 };

/** Central sorting platform — a wooden pallet, sized within spec's 1.0-1.2m
 * range. Unchanged from the previous round (spec section 二十: "保持不變") —
 * still in the back area, well clear of the doorway/stairs and the vehicle
 * control posts' footprint. */
export const PALLET_CONFIG = {
  posX: -4.0,
  posZ: 15.5,
  width: 1.1,
  depth: 1.1,
  height: 0.15,
  /** Half-height above the pallet TOP a box's center must sit within to
   * count as "on" it — generous enough for stacked boxes (spec 十三). */
  detectHeight: 1.0,
};

/** East-side outbound zone — NOT used by the main flow this round (spec
 * "北側卸貨口/重新啟用呼叫載具" section 八: cargo now ships by riding along
 * with a vehicle, not by walking into a ground zone). Kept only so
 * outbound-zone-system.ts (uninitialized in game.ts, see feature-flags.ts
 * doc comment there) still compiles if it's reused in a future round. */
export const OUTBOUND_ZONE = {
  minX: 5.5, maxX: 9.2,
  minZ: 23.5, maxZ: 28.0,
};

// Daily box/roller/large size+shape+color+label presets moved to
// cargo-data.ts (CARGO_BOX_PRESETS/CARGO_ROLLER_PRESETS/CARGO_LARGE_PRESETS,
// spec "貨品外型與比例有更多變化" round section六/七/八) — cargo identity is
// now bound together in ONE place alongside its subtype/label, rather than
// living here as a bare size list.
