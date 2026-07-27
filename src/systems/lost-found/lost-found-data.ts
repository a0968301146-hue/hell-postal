// Case + lost-item data for the lost & found NPC flow ("Expand modular lost
// found NPC flow" round). Deliberately independent of cargo-data.ts/
// vehicle-data.ts — lost items are never CargoData, never ride a vehicle,
// and never touch DAILY_CARGO_CONFIG (spec: 失物不屬於 dailyCargoIds).
// lost-found-system.ts reads this data to pick each day's case and build
// its matching lost item; it never hand-picks shapes/colors/text inline.

/** Which THREE.js primitive lost-found-system.ts's buildLostItemGeometry()
 * builds for this preset — deliberately never 'box', so a lost item never
 * reads as ordinary cargo (spec六: "外形不能像一般箱子或包裹"). */
export type LostItemShape = 'staff' | 'doll' | 'pot' | 'instrument';

export interface LostItemPreset {
  id: string;
  displayName: string;
  shape: LostItemShape;
  color: number;
  /** Bounding half-extents — used for BOTH the physics collider (a plain
   * cuboid approximation, same convention this codebase already uses for
   * every non-cuboid prop) and to size the shape-specific geometry itself.
   * width/height/depth. */
  halfExtents: { x: number; y: number; z: number };
}

/** At least several non-box silhouettes (spec六: "至少準備數種非方箱造
 * 型") — a magic staff, a plush doll, a ceramic pot, and an old lute. */
export const LOST_ITEM_PRESETS: LostItemPreset[] = [
  { id: 'magic-staff', displayName: '魔法手杖', shape: 'staff', color: 0x8a5aa0, halfExtents: { x: 0.06, y: 0.5, z: 0.06 } },
  { id: 'plush-doll', displayName: '玩偶娃娃', shape: 'doll', color: 0xd88a5a, halfExtents: { x: 0.14, y: 0.28, z: 0.14 } },
  { id: 'ceramic-pot', displayName: '陶壺', shape: 'pot', color: 0xa0603a, halfExtents: { x: 0.18, y: 0.22, z: 0.18 } },
  { id: 'old-lute', displayName: '古董魯特琴', shape: 'instrument', color: 0x7a5a30, halfExtents: { x: 0.22, y: 0.12, z: 0.4 } },
];

export interface LostFoundCaseDef {
  id: string;
  customerName: string;
  /** References LOST_ITEM_PRESETS[].id — which shape this case's NPC is
   * looking for. */
  lostItemPresetId: string;
  successText: string;
}

/** One case this round — lost-found-system.ts's pickTodaysCase() cycles
 * through this list by day number, so adding more cases later needs no
 * code changes there. */
export const LOST_FOUND_CASES: LostFoundCaseDef[] = [
  { id: 'case-001', customerName: '委託人', lostItemPresetId: 'magic-staff', successText: '「就是這個！太感謝你了。」' },
];

/** Exact spec wording (spec七: "顯示「這不是他要找的失物」") — the ONE shared
 * message for any incorrect hand-over attempt, not per-case flavor text. */
export const LOST_FOUND_WRONG_ITEM_TEXT = '這不是他要找的失物';

/** Shown on the NPC's bubble the moment 載具出發 is pressed with today's NPC
 * never having been talked to ("Spawn lost found NPC during unloading and
 * penalize missed interaction" round 三: NPC顯示失望／離開提示) — the ONE
 * shared message for a missed-interaction departure, not per-case flavor
 * text (mirrors LOST_FOUND_WRONG_ITEM_TEXT's pattern above). */
export const LOST_FOUND_MISSED_TEXT = '看來今天沒機會了……我先走了。';
