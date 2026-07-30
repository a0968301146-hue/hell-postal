// Centralized spatial data for the "underworld logistics center" white-box
// prototype (v0.1 vertical slice). All zone positions/sizes for the new
// layout live here so they are not scattered as magic numbers across
// scene-manager / physics / vehicle / shipment systems.
//
// Coordinate convention: X = left/right, Z = depth (increasing Z = further
// from the north unload dock, toward the docks and pier), Y = height.
// Neutral data-layer import — see world-layout-system.ts's identical import
// for why (Phase 6: world-layout and lost-found both read this file rather
// than importing each other).
import { LOST_FOUND_ROOM, LOST_FOUND_DOOR } from '../../data/world/lost-found-layout-data';
import { CARGO_SHAPE_PRESETS } from '../cargo/cargo-shape-presets';

export const WALL_THICKNESS = 0.2;

/** Historical footprint of the old front-office room (counter/NPC area,
 * later the north unload dock) — the room itself was removed entirely in
 * the "刪除北邊房間" round (scene-manager.ts no longer builds any geometry
 * from this). Kept as plain data only because counter-layout-data.ts's
 * still-preserved (disabled) COUNTER/NPC_AREA/PLAYER_AREA/COUNTER_GLASS
 * definitions are expressed relative to it, and cargo-system.ts's disabled
 * legacy-test-cargo branch references FRONT_OFFICE.floorY — both are dead
 * code paths this round (ENABLE_LEGACY_COUNTER/ENABLE_LEGACY_TEST_CARGO are
 * false) that would otherwise fail to compile. Not used by WORLD_BOUNDS or
 * any real scene geometry anymore. */
export const FRONT_OFFICE = {
  minX: -6, maxX: 6, // width 12
  minZ: -2, maxZ: 10, // depth 12
  floorY: 0,
  ceilingHeight: 4,
};

export const BACK_AREA = {
  minX: -10, maxX: 10, // width 20
  minZ: FRONT_OFFICE.maxZ, maxZ: 32, // depth 22
  floorY: -1.5,
  ceilingHeight: 6,
};

/** Gaps in the back area's own NORTH wall (minZ) for the daily unloading
 * docks (spec "刪除北邊房間" round: the front-office room this used to sit
 * in was removed entirely — the back area is now the whole building, and
 * its own north wall carries the unload docks directly). Two independent
 * ports side by side ("Add dual elevated unloading ports and day-one
 * special cargo" round 二: 東方新增第二個到貨口) — scene-manager.ts's
 * buildBackArea() iterates this array to punch one gap per entry, with
 * solid wall segments before/between/after them. See daily-flow-data.ts
 * (UNLOAD_PORTS) for the gate/chute/spawn geometry built around each
 * opening. Port B (east, centerX 5, span [3,7]) sits 1m clear of Port A's
 * own span ([-2,2]) and 3m clear of BACK_AREA's east wall (maxX 10). */
export const NORTH_GATES = [
  { id: 'north-a', centerX: 0, halfWidth: 2.0 },
  { id: 'north-b', centerX: 5, halfWidth: 2.0 },
];

/** Player spawn point — inside the back area, a short distance south of
 * the north unload dock's drop zone (spec "刪除北邊房間" round: previously
 * inside the now-removed front-office room, at that room's own floor
 * height). `y` bakes in SCENE_CONFIG.playerEyeHeight (1.6, see
 * scene-manager.ts) on top of BACK_AREA's floor, since this is an absolute
 * world-space spawn height, not floor-relative. */
export const PLAYER_SPAWN = { x: 0, y: BACK_AREA.floorY + 1.6, z: 14.8 };

/** Where the conveyor drops cargo, and the open floor around it — the
 * player's main package-handling area, right behind the window. */
export const PACKAGE_WORK_ZONE = {
  minX: -3, maxX: 3,
  minZ: BACK_AREA.minZ + 4, maxZ: BACK_AREA.minZ + 9, // z: 14~19
};

/** Work furniture cluster (stamp tables, crate, sorting boxes) — back area, west side. */
export const WORK_FURNITURE_X = -8;

/** West-wall storage shelves ("Add storage shelves along west wall" /
 * "Enlarge west wall shelves for medium cargo" rounds) — free-standing open
 * wooden shelving hugging BACK_AREA's own west wall (never the lost-found
 * room, spec一: "不要放進失物招領前台房間"), south of the lost-found door
 * (LOST_FOUND_DOOR) with a real walking buffer clear of it, and far enough
 * south of the lost-found cabinet (lost-found-cabinet-system.ts's own
 * computed footprint, roughly Z 10.3-13.7) that the two structures never
 * come close. Purely a free staging/organizing surface (spec四: "只作為自由
 * 暫存與整理工具，不強制區分國內／海外或貨物種類，不新增計分／容量／整理判
 * 定") — WorldLayoutSystem builds the Mesh/Collider/placement-surface
 * geometry straight from this data (spec五), no separate ShelfSystem.
 *
 * "Enlarge west wall shelves for medium cargo" round spec一: sized off the
 * LARGEST sizeClass==='medium' CargoShapePreset on EACH axis independently
 * (not just medium-box — mirrors lost-found-cabinet-system.ts's own
 * computeCellInteriorSize() pattern for "read every real preset, take the
 * per-axis max" rather than a hand-picked constant), so the shelf never
 * needs re-tuning by hand if a new medium preset is ever added. */
function computeMaxMediumCargoDimensions(): { width: number; height: number; depth: number } {
  let maxWidth = 0, maxHeight = 0, maxDepth = 0;
  for (const preset of CARGO_SHAPE_PRESETS) {
    if (preset.sizeClass !== 'medium') continue;
    maxWidth = Math.max(maxWidth, preset.dimensions.width);
    maxHeight = Math.max(maxHeight, preset.dimensions.height);
    maxDepth = Math.max(maxDepth, preset.dimensions.depth);
  }
  return { width: maxWidth, height: maxHeight, depth: maxDepth };
}
/** The largest sizeClass='medium' preset's own width/height/depth,
 * independently per axis — currently width from 寬型活物鐵籠(wide-cage,
 * 0.60), height from 高型活物鐵籠(tall-cage, 0.62), depth from 冷凍魚貨木箱
 * (frozen-fish-crate, 0.52). */
export const MAX_MEDIUM_CARGO_DIMENSIONS = computeMaxMediumCargoDimensions();

/** spec一: each level's usable interior must be at least
 * max-medium-dimension × 1.3 on every axis.
 *
 * Axis mapping (verified directly against PickupSystem.validatePlacement's
 * own bounds check, `position.x ± obj.width/2` / `position.z ± obj.depth/2`
 * — NOT a naming assumption): a cargo item's own `width` occupies WORLD X,
 * and its own `depth` occupies WORLD Z. This shelf's own `depth` field
 * (WestWallShelfConfig) is the wall→room axis, i.e. WORLD X — so it must be
 * sized from the largest medium preset's own WIDTH, not depth. Symmetrically
 * this shelf's own `width` field (along the wall, WORLD Z) must be sized
 * from the largest medium preset's own DEPTH. Getting this backwards would
 * silently under-size whichever axis actually needs the bigger margin. */
const SHELF_ITEM_MARGIN = 1.3;
const REQUIRED_SHELF_DEPTH_INTERIOR = MAX_MEDIUM_CARGO_DIMENSIONS.width * SHELF_ITEM_MARGIN; // world X
const REQUIRED_SHELF_WIDTH_INTERIOR = MAX_MEDIUM_CARGO_DIMENSIONS.depth * SHELF_ITEM_MARGIN; // world Z
const REQUIRED_LEVEL_CLEAR_HEIGHT = MAX_MEDIUM_CARGO_DIMENSIONS.height * SHELF_ITEM_MARGIN;

export const SHELF_WALL_CLEARANCE = 0.08; // spec: "保留約0.05~0.1m" from the wall's own inner face
export const SHELF_BOARD_THICKNESS = 0.04;
export const SHELF_POST_THICKNESS = 0.06;
/** Extra frame height above the top level's own board (a finished-looking
 * open top, not a full roof — spec: "不需要門板、抽屜或吸附格位"). */
export const SHELF_FRAME_TOP_MARGIN = 0.15;

// Depth (X axis, wall -> room): back panel eats into it on one end, one
// corner post on the other (spec二: "支柱位置/背架位置同步調整") — a small
// extra buffer on top of the bare 1.3x requirement so a centered item never
// sits flush against either.
const SHELF_DEPTH_BUFFER = 0.05;
export const SHELF_DEPTH = REQUIRED_SHELF_DEPTH_INTERIOR + SHELF_DEPTH_BUFFER + SHELF_BOARD_THICKNESS + SHELF_POST_THICKNESS;

// Width (Z axis, along the wall): the bare 1.3x single-item requirement plus
// real extra room so several SMALL items can still sit alongside one medium
// item on the same level (spec一: "有空間時可讓同層並排放置多件小型貨物"),
// with a post eating into each end.
const SHELF_WIDTH_EXTRA_FOR_SMALL_ITEMS = 0.9;
export const SHELF_WIDTH = REQUIRED_SHELF_WIDTH_INTERIOR + SHELF_WIDTH_EXTRA_FOR_SMALL_ITEMS + 2 * SHELF_POST_THICKNESS;

export const SHELF_GROUP_GAP = 0.5; // spec: "彼此保留約0.4~0.6m間距"

/** Top-surface Y offsets above the floor for each of the 3 levels (spec:
 * "3層", "每層有效空間至少為...層高：最大中型貨物高度×1.3"). Level spacing
 * is REQUIRED_LEVEL_CLEAR_HEIGHT (plus a small buffer) + one board's own
 * thickness, so the item resting on a lower level always has that much
 * genuine clear headroom below the board above it — never just "looks
 * clear" while a naive fixed spacing would have silently clipped a taller
 * medium item (e.g. 高型活物鐵籠, 0.62m tall) against the level above. */
const SHELF_LEVEL_CLEAR_HEIGHT_BUFFER = 0.02;
const SHELF_LEVEL_SPACING = REQUIRED_LEVEL_CLEAR_HEIGHT + SHELF_LEVEL_CLEAR_HEIGHT_BUFFER + SHELF_BOARD_THICKNESS;
const SHELF_BOTTOM_LEVEL_Y = 0.5;
export const SHELF_LEVEL_Y_OFFSETS = [0, 1, 2].map((i) => SHELF_BOTTOM_LEVEL_Y + i * SHELF_LEVEL_SPACING);

const westWallInnerFaceX = BACK_AREA.minX + WALL_THICKNESS / 2;
const shelfCenterX = westWallInnerFaceX + SHELF_WALL_CLEARANCE + SHELF_DEPTH / 2;
// Starts comfortably south of the lost-found door's own south edge (spec:
// "不得擋住...玩家通道") — the open floor south of the door runs all the way
// to the vehicle-control cluster (z=25.5) and beyond, so there's no need to
// crowd the narrow gap between the cabinet and the door further north. Still
// 3 groups (spec: "數量維持3組、每組維持3層"), re-spaced along the SAME wall
// stretch to fit the now-wider footprint (spec二: "三組貨架間距同步調整").
const shelfGroupStartZ = LOST_FOUND_DOOR.centerZ + LOST_FOUND_DOOR.halfWidth + 0.8;

export interface WestWallShelfConfig {
  id: string;
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
}

export const WEST_WALL_SHELVES: WestWallShelfConfig[] = [0, 1, 2].map((i) => ({
  id: `west-shelf-${i + 1}`,
  centerX: shelfCenterX,
  centerZ: shelfGroupStartZ + SHELF_WIDTH / 2 + i * (SHELF_WIDTH + SHELF_GROUP_GAP),
  width: SHELF_WIDTH,
  depth: SHELF_DEPTH,
}));

/** Wall-mounted bulletin board ("公告欄升級系統" round spec一) — a thin
 * wood-frame+corkboard panel on BACK_AREA's own west wall, facing east into
 * the room (mirrors PickupSystem.validatePlacement's own verified axis
 * mapping: an object's `width` occupies world X, `depth` occupies world Z —
 * so this board's thin dimension, thickness, sits along world X, flush
 * against the wall, and its wide dimension, width, runs along world Z,
 * along the wall).
 *
 * Positioned south of the LAST west-wall shelf group's own south edge
 * (computed from WEST_WALL_SHELVES directly, never a hardcoded coordinate,
 * so this can't silently drift out of sync if the shelf layout ever changes
 * again — spec一: "不要硬編座標，需與貨架保持安全距離") with real clearance
 * (BULLETIN_BOARD_SHELF_CLEARANCE) beyond that edge. Every other structure
 * near the west wall (the lost-found door, its NPC gate, the lost-found
 * cabinet) sits well NORTH of the shelf groups — the shelf groups
 * themselves were already verified clear of all of those (see
 * WEST_WALL_SHELVES's own doc comment above) — so placing this board even
 * further south than the shelves guarantees it stays clear of all of them
 * too, without needing to re-derive their exact footprints again here. */
const BULLETIN_BOARD_WIDTH = 2.2; // along the wall, world Z
const BULLETIN_BOARD_HEIGHT = 1.3;
const BULLETIN_BOARD_THICKNESS = 0.1; // wall -> room, world X
const BULLETIN_BOARD_CENTER_HEIGHT = 1.6; // above the floor, spec: "中心高度約1.6m"
const BULLETIN_BOARD_SHELF_CLEARANCE = 0.6; // spec: "與最近貨架保持至少0.6m淨距"
/** Small standoff from the wall's own inner face so the board's thin body
 * never z-fights/embeds into the wall collider — not the same thing as the
 * shelves' own SHELF_WALL_CLEARANCE (a much deeper free-standing fixture),
 * but the same general idea. */
const BULLETIN_BOARD_WALL_STANDOFF = 0.02;
/** Open floor space the player needs standing directly in front of the
 * board to read/interact with it (spec一: "板面前方至少保留1.2m可站立空
 * 間") — exported so a future round could validate against it without
 * re-deriving the number; nothing in this round computes a second position
 * from it (the board's own east-facing thickness plus the shelves'
 * existing spacing already leaves the whole open floor east of the west
 * wall clear here, far more than 1.2m). */
export const BULLETIN_BOARD_STANDING_CLEARANCE = 1.2;

const lastWestShelf = WEST_WALL_SHELVES[WEST_WALL_SHELVES.length - 1];
const lastShelfSouthEdgeZ = lastWestShelf.centerZ + lastWestShelf.width / 2;

export const BULLETIN_BOARD = {
  centerX: westWallInnerFaceX + BULLETIN_BOARD_WALL_STANDOFF + BULLETIN_BOARD_THICKNESS / 2,
  centerY: BACK_AREA.floorY + BULLETIN_BOARD_CENTER_HEIGHT,
  centerZ: lastShelfSouthEdgeZ + BULLETIN_BOARD_SHELF_CLEARANCE + BULLETIN_BOARD_WIDTH / 2,
  width: BULLETIN_BOARD_WIDTH,
  height: BULLETIN_BOARD_HEIGHT,
  thickness: BULLETIN_BOARD_THICKNESS,
};

/** West-wall TV + small table ("Add television media playlist" round 一) —
 * positioned south of the bulletin board's own south edge, computed from
 * BULLETIN_BOARD directly rather than a hardcoded coordinate (same "derive
 * from the previous structure" convention BULLETIN_BOARD itself already
 * uses relative to WEST_WALL_SHELVES above), with real clearance
 * (TV_TABLE_BULLETIN_CLEARANCE, spec一: "與公告欄保留至少0.5m") beyond that
 * edge. At these numbers this lands around world Z ≈ 28.3, comfortably
 * inside BACK_AREA (maxZ 32) with no other west-wall structure anywhere
 * south of the bulletin board to collide with (verified: only
 * WEST_WALL_SHELVES and BULLETIN_BOARD itself touch this wall stretch).
 * Same axis convention as the board: `depth` is the wall→room dimension
 * (world X), `width` runs along the wall (world Z) — the TV's screen sits
 * on its own local +X face, which (with zero rotation, same as the board)
 * already faces east into the room, exactly as spec requires, with no
 * rotation needed. The table sits flush against the wall (TV_TABLE_
 * WALL_STANDOFF mirrors BULLETIN_BOARD_WALL_STANDOFF); the TV sits centered
 * on the tabletop, both horizontally and along the wall axis. */
const TV_TABLE_WIDTH = 1.2; // along the wall, world Z (spec一建議尺寸)
const TV_TABLE_DEPTH = 0.65; // wall -> room, world X
const TV_TABLE_HEIGHT = 0.75;
const TV_TABLE_WALL_STANDOFF = 0.02;
const TV_TABLE_BULLETIN_CLEARANCE = 0.5; // spec一: "與公告欄保留至少0.5m"
/** Open floor space the player needs standing in front of the TV/table to
 * interact with it (spec一: "前方保留至少1.2m玩家通道") — mirrors
 * BULLETIN_BOARD_STANDING_CLEARANCE's own role; nothing else is placed in
 * the open room space east of the table, so this holds structurally without
 * needing a second derived position here. */
export const TV_TABLE_STANDING_CLEARANCE = 1.2;

const TV_WIDTH = 0.9; // along the wall, world Z (spec一建議尺寸)
const TV_HEIGHT = 0.6;
const TV_DEPTH = 0.18; // wall -> room, world X — screen faces +X (east)

const bulletinBoardSouthEdgeZ = BULLETIN_BOARD.centerZ + BULLETIN_BOARD.width / 2;

export const TV_TABLE = {
  centerX: westWallInnerFaceX + TV_TABLE_WALL_STANDOFF + TV_TABLE_DEPTH / 2,
  centerY: BACK_AREA.floorY + TV_TABLE_HEIGHT / 2,
  centerZ: bulletinBoardSouthEdgeZ + TV_TABLE_BULLETIN_CLEARANCE + TV_TABLE_WIDTH / 2,
  width: TV_TABLE_WIDTH,
  depth: TV_TABLE_DEPTH,
  height: TV_TABLE_HEIGHT,
};

export const TELEVISION = {
  centerX: TV_TABLE.centerX,
  centerY: TV_TABLE.centerY + TV_TABLE.height / 2 + TV_HEIGHT / 2,
  centerZ: TV_TABLE.centerZ,
  width: TV_WIDTH,
  height: TV_HEIGHT,
  depth: TV_DEPTH,
};

/** Wall-mounted vehicle call/depart buttons ("Fix cargo throwing and
 * rebalance daily manifest" round二) — replaces the old freestanding pillar
 * pair (VEHICLE_CONTROL_POS below, now unused) with two small plaques on the
 * same west wall as the TV, positioned south of it (spec二: "依現有電視／
 * 小桌子的南側邊界動態計算，不要寫死一份與電視無關的座標"). Derived from
 * whichever of TV_TABLE/TELEVISION actually has the more southward edge —
 * currently the table (wider than the TV itself), but this stays correct
 * even if either footprint changes later. Same axis convention as the board
 * /TV: `depth` is the wall→room dimension (world X, flush against the wall
 * with a small standoff), `width` runs along the wall (world Z) — with zero
 * rotation this already faces east into the room, matching "面向東方倉庫
 * 內側", no rotation needed. Both buttons share this one X/Z footprint,
 * stacked vertically at their own distinct center heights — call above,
 * depart below (spec二: "上方：召喚載具／下方：載具出發"). */
const VEHICLE_BUTTON_WIDTH = 0.45; // along the wall, world Z (spec二建議尺寸)
const VEHICLE_BUTTON_HEIGHT = 0.35;
const VEHICLE_BUTTON_DEPTH = 0.08; // wall -> room, world X — a thin wall plaque
const VEHICLE_BUTTON_WALL_STANDOFF = 0.02; // mirrors BULLETIN_BOARD/TV_TABLE's own standoff
const VEHICLE_BUTTON_TV_CLEARANCE = 0.5; // spec二: "與電視設施保留至少0.5m"
/** Open floor space the player needs standing in front of the buttons to
 * interact with them (spec二: "前方至少保留1.2m操作空間") — mirrors
 * TV_TABLE_STANDING_CLEARANCE's own role; nothing else occupies the open
 * room space east of this point. */
export const VEHICLE_BUTTON_STANDING_CLEARANCE = 1.2;

const tvSouthEdgeZ = Math.max(
  TV_TABLE.centerZ + TV_TABLE.width / 2,
  TELEVISION.centerZ + TELEVISION.width / 2
);

export const VEHICLE_CONTROL_WALL_BUTTONS = {
  centerX: westWallInnerFaceX + VEHICLE_BUTTON_WALL_STANDOFF + VEHICLE_BUTTON_DEPTH / 2,
  centerZ: tvSouthEdgeZ + VEHICLE_BUTTON_TV_CLEARANCE + VEHICLE_BUTTON_WIDTH / 2,
  callCenterY: BACK_AREA.floorY + 1.35, // spec二: "上方按鈕中心高度約1.35m"
  departCenterY: BACK_AREA.floorY + 0.85, // spec二: "下方按鈕中心高度約0.85m"
  width: VEHICLE_BUTTON_WIDTH,
  height: VEHICLE_BUTTON_HEIGHT,
  depth: VEHICLE_BUTTON_DEPTH,
};

/** Reserved (white-box only, no function yet) cargo-type zones — space is
 * claimed now so future systems have somewhere to go; purely floor decals +
 * floating labels (world-layout-system.ts buildCargoZones), no physics
 * collider, so they never block player movement. Only help the player sort
 * — nothing requires cargo to sit in one before it can ship (unchanged).
 *
 * Two rows ("移除滾筒架/特殊貨物放置區加倍" round: 特殊貨物區域加倍 — 大型/
 * 冷凍/活體三種各多一個海外版): DOMESTIC_ROW (south, the original 5-zone
 * row) and OVERSEAS_ROW (north, immediately adjacent — touches
 * DOMESTIC_ROW's own minZ exactly, never overlapping it) hold matching
 * same-size overseas copies of the large/frozen/live zones only —
 * zone-normal and zone-lost-found stay single (this round only doubles
 * 大型/冷凍/活體, per spec). OVERSEAS_ROW sits at Z 17.5–20.5, well clear
 * of the player spawn (z=14.8)/pallet (z=15.5, PALLET_CONFIG)/dolly's
 * parked spot (z=16, DOLLY_CONFIGS)/unload debris zone (z<=14.3) to its
 * north, and the vehicle control posts (z=25.5, VEHICLE_CONTROL_POS) well
 * south of DOMESTIC_ROW. */
const CARGO_ZONE_HALF_WIDTH = 1.6;
const DOMESTIC_ROW_MIN_Z = BACK_AREA.minZ + 10.5; // 20.5
const DOMESTIC_ROW_MAX_Z = BACK_AREA.minZ + 13.5; // 23.5
const OVERSEAS_ROW_MAX_Z = DOMESTIC_ROW_MIN_Z; // 20.5 — touches, doesn't overlap
const OVERSEAS_ROW_MIN_Z = OVERSEAS_ROW_MAX_Z - (DOMESTIC_ROW_MAX_Z - DOMESTIC_ROW_MIN_Z); // 17.5 — same depth as the domestic row

export const CARGO_ZONES = [
  { id: 'zone-normal', label: '一般貨物區', centerX: -7.2, color: 0x8a8a8a, minZ: DOMESTIC_ROW_MIN_Z, maxZ: DOMESTIC_ROW_MAX_Z },
  { id: 'zone-large-domestic', label: '國內大型貨物區', centerX: -3.6, color: 0x8a6a4a, minZ: DOMESTIC_ROW_MIN_Z, maxZ: DOMESTIC_ROW_MAX_Z },
  { id: 'zone-large-overseas', label: '海外大型貨物區', centerX: -3.6, color: 0x8a6a4a, minZ: OVERSEAS_ROW_MIN_Z, maxZ: OVERSEAS_ROW_MAX_Z },
  { id: 'zone-frozen-domestic', label: '國內冷凍貨物區', centerX: 0, color: 0x4a90b8, minZ: DOMESTIC_ROW_MIN_Z, maxZ: DOMESTIC_ROW_MAX_Z },
  { id: 'zone-frozen-overseas', label: '海外冷凍貨物區', centerX: 0, color: 0x4a90b8, minZ: OVERSEAS_ROW_MIN_Z, maxZ: OVERSEAS_ROW_MAX_Z },
  { id: 'zone-live-domestic', label: '國內活體貨物區', centerX: 3.6, color: 0x4a9a4a, minZ: DOMESTIC_ROW_MIN_Z, maxZ: DOMESTIC_ROW_MAX_Z },
  { id: 'zone-live-overseas', label: '海外活體貨物區', centerX: 3.6, color: 0x4a9a4a, minZ: OVERSEAS_ROW_MIN_Z, maxZ: OVERSEAS_ROW_MAX_Z },
  { id: 'zone-lost-found', label: '失物招領區', centerX: 7.2, color: 0xb8a04a, minZ: DOMESTIC_ROW_MIN_Z, maxZ: DOMESTIC_ROW_MAX_Z },
].map(z => ({ ...z, halfWidth: CARGO_ZONE_HALF_WIDTH }));

// Compass convention (see compass-ui.ts): North = -Z, East = +X, South = +Z, West = -X.

/** Land docks — hugs the back area's SOUTH wall, one active slot per land
 * creature ("Expand land entrance and cargo capacity" round — see
 * vehicle-dock-data.ts for the exact per-vehicle world positions these
 * decorative floor markers echo). "Update vehicle cargo compatibility and
 * capacity" round: centerX/centerZ/width/depth all recomputed to exactly
 * match each vehicle's own SCALED footprint (VEHICLE_VISUAL_SCALE=1.5, see
 * vehicle-data.ts) at its new dock position (vehicle-dock-data.ts), so
 * these decals stay accurate rather than drifting stale under the enlarged
 * roster. */
export const LAND_DOCKS = [
  { id: 'land-dock-frog', centerX: -3.7, centerZ: 28.0, width: 2.25, depth: 3.9, active: true },
  { id: 'land-dock-rockgiant', centerX: 0, centerZ: 28.0, width: 3.9, depth: 6.9, active: true },
  { id: 'land-dock-snail', centerX: 4.0, centerZ: 28.0, width: 3.0, depth: 5.1, active: true },
];

/** Gap in the back area's south wall the land vehicles drive through —
 * widened ("Expand land entrance and cargo capacity" round) so 青蛙／石頭
 * 巨人／蝸牛 can all pass through side by side, each in its own straight
 * lane (see vehicle-dock-data.ts/vehicle-route-data.ts) rather than
 * funneling through one narrow shared point. "Update vehicle cargo
 * compatibility and capacity" round: span changed from [-8.4, 8.4] to
 * [-6.0, 6.0] — narrower, not wider, even though every vehicle grew 1.5x —
 * because the three land vehicles' dock lanes also moved much closer
 * together (vehicle-dock-data.ts) to fit within BACK_AREA's unchanged
 * x -10..10 span once scaled, so the gate only needs to be as wide as
 * those tighter lanes now require. Span [-6.0, 6.0] comfortably covers all
 * three vehicles' own SCALED dock-lane
 * footprints — frog (dock x=-3.7, scaled half-width 1.125, left edge
 * -4.825, 1.175m clear of this gate's left edge) out to snail (dock x=4.0,
 * scaled half-width 1.5, right edge 5.5, 0.5m clear of this gate's right
 * edge) — with real (non-zero) solid wall segments still remaining at both
 * back-area corners (4.0m each side, BACK_AREA spans x -10..10). No longer
 * derived from LAND_DOCKS[0] — a single dock's own X isn't representative
 * of a gate wide enough for all three lanes. */
export const LAND_GATE = {
  centerX: 0,
  halfWidth: 6.0,
};

/** Pier — now extends off the back area's EAST wall, over open water.
 * "Update vehicle cargo compatibility and capacity" round: Z-span widened
 * from 14..22 (8m) to 12..24 (12m) — three sea vehicles' SCALED widths
 * (VEHICLE_VISUAL_SCALE=1.5, see vehicle-data.ts) no longer fit side by
 * side in the old 8m depth (2*(1.35+1.65+1.95) = 9.9m needed for the
 * chassis alone, before any gaps). X-depth (10..18) stays unchanged — every
 * scaled vehicle's length still fits comfortably within it (see
 * vehicle-dock-data.ts's SEA_DOCK_SLOTS comments). Widened symmetrically
 * around the same Z midpoint (18) the old span already used, so nothing
 * else anchored to that midpoint needs to move. */
export const PIER = {
  minX: BACK_AREA.maxX, maxX: BACK_AREA.maxX + 8, // depth 8, eastward
  minZ: 12, maxZ: 24, // width 12, within the back-area hall's depth
  floorY: BACK_AREA.floorY,
  waterY: BACK_AREA.floorY - 0.7,
};

/** Gap in the back area's east wall the pier connects through. */
export const SEA_GATE = {
  centerZ: (PIER.minZ + PIER.maxZ) / 2,
  halfWidth: (PIER.maxZ - PIER.minZ) / 2,
};

export const SEA_DOCKS = [
  { id: 'sea-dock-1', centerX: PIER.minX + 4, centerZ: PIER.minZ + 2, radius: 1.2 },
  { id: 'sea-dock-2', centerX: PIER.minX + 4, centerZ: PIER.maxZ - 2, radius: 1.2 },
];

/** Overall world bounds, used only for a distant backdrop / sanity checks. */
// NOTE (spec "刪除北邊房間" round): deliberately no longer folds in
// FRONT_OFFICE — that room's floor no longer exists, so including its old
// footprint here would let cargo/placement validation succeed in what is
// now empty void space north of BACK_AREA's own wall.
// "Reduce daily cargo and add lost found desk" round: folds in
// LOST_FOUND_ROOM's own footprint (lost-found-layout-data.ts) so item
// placement (PickupSystem.validatePlacement) isn't rejected just for being
// west of BACK_AREA's own wall, inside the new room.
export const WORLD_BOUNDS = {
  minX: Math.min(BACK_AREA.minX, LOST_FOUND_ROOM.minX) - 1,
  maxX: Math.max(BACK_AREA.maxX, PIER.maxX) + 40, // generous — land/sea vehicles travel well beyond the walls
  minZ: BACK_AREA.minZ - 1,
  maxZ: BACK_AREA.maxZ + 40,
};

/** How many normal-cargo boxes to spawn in each area, and where — kept
 * central so counts/zones aren't scattered across scene/cargo setup code. */
export const CARGO_SPAWN_CONFIG = {
  frontOfficeCount: 6,
  backAreaCount: 10,
  // Front-office cargo: player-area side, near the window/conveyor start.
  // minZ kept clear of the player spawn point (z=7).
  frontZone: { minX: -2.2, maxX: 2.2, minZ: 7.6, maxZ: 9.3 },
  // Back-area cargo: the open package-work zone around the conveyor exit.
  backZone: { minX: -3.2, maxX: 3.2, minZ: 14.5, maxZ: 19.5 },
};

/** Fixed (non-random) spawn spots for large cargo, inside CARGO_ZONES'
 * "國內大型貨物區" (zone-large-domestic: centerX -3.6, z 20.5–23.5) — comfortably clear
 * of the front-office NPC area, player spawn, doorway/stairs, conveyor exit
 * and the vehicle control buttons. Spacing (1.6m) leaves margin against the
 * largest large-cargo footprint (1.35m) so the 4 items don't overlap at spawn. */
export const LARGE_CARGO_SPAWN_POSITIONS = [
  { x: -4.4, z: 21.1 },
  { x: -2.8, z: 21.1 },
  { x: -4.4, z: 22.7 },
  { x: -2.8, z: 22.7 },
];

/** Fixed spawn spots for the labeling-system test cargo (spec 九) — placed
 * in the open floor east of the large-cargo zone but west of the vehicle
 * control posts, clear of the NPC area, player spawn, doorway/stairs,
 * conveyor exit, control buttons and the dolly's parked position (7,16).
 * 0.9m spacing comfortably separates every footprint here (normal/fragile
 * cargo maxes out at 0.6m, the one large item at 1.35m — positioned with
 * extra room on its own row). */
export const LABELED_CARGO_SPAWN_POSITIONS = {
  domesticFragile: [{ x: -1.2, z: 21.4 }, { x: -0.2, z: 21.4 }],
  overseasNormal: [{ x: -1.2, z: 22.4 }, { x: -0.2, z: 22.4 }],
  overseasFragile: [{ x: -1.2, z: 23.4 }],
  overseasLarge: [{ x: 1.6, z: 22.0 }],
  overseasLargeFragile: [{ x: 1.6, z: 23.8 }],
};
