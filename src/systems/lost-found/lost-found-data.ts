// Case + lost-item data for the lost & found NPC flow ("Expand modular lost
// found NPC flow" round). Deliberately independent of cargo-data.ts/
// vehicle-data.ts — lost items are never CargoData, never ride a vehicle,
// and never touch DAILY_CARGO_CONFIG (spec: 失物不屬於 dailyCargoIds).
// lost-found-system.ts reads this data to pick each day's case and build
// its matching lost item; it never hand-picks shapes/colors/text inline.
import * as THREE from 'three';

/** Which THREE.js primitive combo lost-found-system.ts's
 * buildLostItemGeometry() builds for this preset — deliberately never a
 * bare box, so a lost item never reads as ordinary cargo (spec: "不可使用
 * 普通紙箱模型冒充失物"). Expanded this round ("Expand lost found return
 * storage and scoring" 五) from 4 to 8 distinct silhouettes so daily target
 * + decoys never all look identical. */
export type LostItemShape = 'staff' | 'doll' | 'pot' | 'violin' | 'book' | 'lantern' | 'mask' | 'orb';

export interface LostItemPreset {
  id: string;
  displayName: string;
  shape: LostItemShape;
  color: number;
  /** RAW (pre-auto-fit) visual half-extents — used to build the mesh
   * geometry. "Expand lost found return storage and scoring" round 六:
   * split out from the old single shared `halfExtents` so the mesh and
   * collider can keep a small safety margin between them (spec: "模型與
   * Collider需要保留安全間距") — every preset below sets the collider
   * slightly SMALLER than the visual, so the physical box never pokes
   * outside what the player sees. Both get scaled together, by the same
   * factor, if either would exceed the storage cabinet's per-cell fit
   * limit — see lost-found-cabinet-system.ts's computeLostItemFitScale(). */
  visualHalfExtents: { x: number; y: number; z: number };
  colliderHalfExtents: { x: number; y: number; z: number };
}

function preset(
  id: string, displayName: string, shape: LostItemShape, color: number,
  visual: { x: number; y: number; z: number }
): LostItemPreset {
  // Collider stays a fixed 90% of the visual on every axis — a small,
  // uniform safety margin (spec六: "模型與Collider需要保留安全間距"),
  // simpler than hand-tuning each preset's collider independently while
  // still keeping the two sizes genuinely distinct fields.
  const collider = { x: visual.x * 0.9, y: visual.y * 0.9, z: visual.z * 0.9 };
  return { id, displayName, shape, color, visualHalfExtents: visual, colliderHalfExtents: collider };
}

/** At least several non-box silhouettes (spec五: 魔法手杖/玩偶/小提琴/茶壺/
 * 魔法書/提燈/面具/水晶球 — all 8 suggested items included). Every raw size
 * here is intentionally generous/human-scale (a real lost-and-found item),
 * NOT pre-shrunk to fit the storage cabinet — lost-found-cabinet-system.ts's
 * auto-fit scaling (spec六) is what guarantees every one of these can still
 * physically fit into a single cell once spawned, so this list never needs
 * hand-tuning against cabinet cell size. */
export const LOST_ITEM_PRESETS: LostItemPreset[] = [
  preset('magic-staff', '魔法手杖', 'staff', 0x8a5aa0, { x: 0.06, y: 0.5, z: 0.06 }),
  preset('plush-doll', '玩偶娃娃', 'doll', 0xd88a5a, { x: 0.14, y: 0.28, z: 0.14 }),
  preset('ceramic-pot', '茶壺', 'pot', 0xa0603a, { x: 0.18, y: 0.22, z: 0.18 }),
  preset('violin', '小提琴', 'violin', 0x7a5a30, { x: 0.16, y: 0.08, z: 0.42 }),
  preset('magic-book', '魔法書', 'book', 0x4a3a6a, { x: 0.2, y: 0.06, z: 0.26 }),
  preset('lantern', '提燈', 'lantern', 0xc8a020, { x: 0.14, y: 0.24, z: 0.14 }),
  preset('mask', '面具', 'mask', 0xb03a3a, { x: 0.16, y: 0.2, z: 0.08 }),
  preset('crystal-ball', '水晶球', 'orb', 0x4ab0c8, { x: 0.16, y: 0.16, z: 0.16 }),
];

/** How many DECOY (non-target) lost items burst in alongside the day's
 * targets ("Expand lost found return storage and scoring" round五, still 5
 * total per day under "Add sequential lost-found visitors and held cargo
 * feedback" round一 — only the TARGET count grew from 1 to 3) — the ONE
 * place this count is defined. */
export const DECOY_LOST_ITEM_COUNT = 5;

/** How many NPCs (and distinct target items) appear per day ("Add
 * sequential lost-found visitors and held cargo feedback" round一: "每天3
 * 位") — the ONE place this count is defined; LOST_FOUND_CASES above must
 * have at least this many entries for prepareDailyCases() to draw from. */
export const DAILY_LOST_FOUND_NPC_COUNT = 3;

export interface LostFoundCaseDef {
  id: string;
  customerName: string;
  /** References LOST_ITEM_PRESETS[].id — which shape this case's NPC is
   * looking for. */
  lostItemPresetId: string;
}

/** Case pool ("Add sequential lost-found visitors and held cargo feedback"
 * round一: 3位NPC每天各自要求1個不同的目標失物) — every entry maps to a
 * DIFFERENT LOST_ITEM_PRESETS id, so any 3 DISTINCT cases drawn from this
 * pool automatically request 3 distinct items with zero extra dedup logic
 * (see lost-found-system.ts's prepareDailyCases()). At least 3 entries are
 * required for that to even be possible — kept at 5 for daily variety. Each
 * case's own per-case thank-you line ("Add sequential lost-found visitors
 * and held cargo feedback" round) was replaced by a shared random pool
 * (LOST_FOUND_THANKS_TEXTS below, spec二: "準備至少5句隨機答謝") — the
 * thanking stage no longer reads anything case-specific, so `successText`
 * was dropped from this shape entirely rather than left unused. */
export const LOST_FOUND_CASES: LostFoundCaseDef[] = [
  { id: 'case-001', customerName: '委託人', lostItemPresetId: 'magic-staff' },
  { id: 'case-002', customerName: '委託人', lostItemPresetId: 'plush-doll' },
  { id: 'case-003', customerName: '委託人', lostItemPresetId: 'ceramic-pot' },
  { id: 'case-004', customerName: '委託人', lostItemPresetId: 'violin' },
  { id: 'case-005', customerName: '委託人', lostItemPresetId: 'magic-book' },
];

/** Random greeting shown the instant an NPC arrives and turns to face the
 * counter, BEFORE its actual need is ever revealed ("Add sequential
 * lost-found visitors and held cargo feedback" round二: "先顯示一段問候或閒
 * 聊...此時不顯示失物名稱與預覽"). Picked fresh per NPC visit, independent of
 * which item that NPC is actually looking for — see
 * lost-found-system.ts's own greeting-stage transition, the ONE place this
 * pool is read. */
export const LOST_FOUND_GREETING_TEXTS: string[] = [
  '「呼……終於到了，這裡是失物招領處吧？」',
  '「不好意思，打擾一下，能幫我一個忙嗎？」',
  '「你好呀，聽說這裡專門幫忙找東西。」',
  '「哎呀，這趟路走得可真遠……」',
  '「早安！今天生意還不錯吧？」',
];

/** Random thank-you shown the instant a hand-over succeeds, replacing each
 * case's own former successText (spec二: "準備至少5句隨機答謝"). Picked
 * fresh per successful hand-over, independent of which case just completed
 * — see lost-found-system.ts's own thanking-stage transition. */
export const LOST_FOUND_THANKS_TEXTS: string[] = [
  '「太好了！真的非常感謝你。」',
  '「你幫了我一個大忙，謝謝！」',
  '「這下我終於放心了，謝謝你。」',
  '「你真是幫了大忙，感激不盡。」',
  '「太感謝了，祝你生意興隆！」',
];

export function pickRandomGreeting(): string {
  return LOST_FOUND_GREETING_TEXTS[Math.floor(Math.random() * LOST_FOUND_GREETING_TEXTS.length)];
}

export function pickRandomThanks(): string {
  return LOST_FOUND_THANKS_TEXTS[Math.floor(Math.random() * LOST_FOUND_THANKS_TEXTS.length)];
}

/** Shown alongside the greeting text while the NPC waits for the player's
 * first E press (spec二: "顯示「按 E 繼續」"). */
export const LOST_FOUND_CONTINUE_PROMPT = '按 E 繼續';

/** Exact spec wording (spec七: "顯示「這不是他要找的失物」") — the ONE shared
 * message for any incorrect hand-over attempt, not per-case flavor text. */
export const LOST_FOUND_WRONG_ITEM_TEXT = '這不是他要找的失物';

/** Shown on the NPC's bubble the moment 載具出發 is pressed with today's NPC
 * never having been talked to ("Spawn lost found NPC during unloading and
 * penalize missed interaction" round 三: NPC顯示失望／離開提示) — the ONE
 * shared message for a missed-interaction departure, not per-case flavor
 * text (mirrors LOST_FOUND_WRONG_ITEM_TEXT's pattern above). */
export const LOST_FOUND_MISSED_TEXT = '看來今天沒機會了……我先走了。';

/** Bubble prompt line shown alongside the target item's name/preview once
 * the NPC is waiting ("Expand lost found return storage and scoring" round
 * 二: 提示文字，例如「我在找這個失物」). */
export const LOST_FOUND_SEEKING_TEXT = '我在找這個失物';

/** Non-box geometry per LostItemShape (spec: "外形不能像一般箱子或包裹" /
 * "不可使用普通紙箱模型冒充失物") — the ONE place shape→geometry mapping
 * lives, shared by both the real world mesh (lost-found-system.ts) and the
 * head-bubble preview thumbnail (lost-item-preview-renderer.ts), so a
 * preset's on-screen icon always genuinely matches its in-world model
 * rather than being a separate hand-picked image. Every shape is built
 * from a SINGLE primitive (no compound/grouped geometry) so it can stay a
 * single THREE.Mesh throughout the codebase's existing InteractableObject
 * convention. Takes the halfExtents explicitly (rather than reading
 * preset.visualHalfExtents itself) so callers can pass either the raw or
 * an already auto-fit-scaled size. */
export function buildLostItemGeometry(
  shape: LostItemShape, halfExtents: { x: number; y: number; z: number }
): THREE.BufferGeometry {
  const { x: hx, y: hy, z: hz } = halfExtents;
  switch (shape) {
    case 'staff':
      return new THREE.CylinderGeometry(hx * 0.6, hx, hy * 2, 8);
    case 'doll':
      return new THREE.CapsuleGeometry(hx, Math.max(hy * 2 - hx * 2, 0.05), 4, 8);
    case 'pot':
      return new THREE.CylinderGeometry(hx * 0.7, hx, hy * 2, 12);
    case 'violin': {
      // Capsule built vertical by default — rotated flat so its long axis
      // runs along Z (an elongated, rounded body reading as a stringed
      // instrument rather than a standing figure).
      const geo = new THREE.CapsuleGeometry(hy, Math.max(hz * 2 - hy * 2, 0.05), 4, 8);
      geo.rotateX(Math.PI / 2);
      return geo;
    }
    case 'book':
      // Deliberately thin (hy much smaller than hx/hz) — a box, but at
      // proportions no daily cargo preset ever uses (every CARGO_BOX_PRESET
      // stays within a roughly 1:1–1:2 aspect ratio; a book here is 1:6+),
      // so it never reads as ordinary shipping cargo.
      return new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
    case 'lantern':
      // Tapered cylinder (narrower top than base) — distinct silhouette
      // from 'pot' (which tapers the opposite way) and 'staff' (uniform).
      return new THREE.CylinderGeometry(hx * 0.5, hx, hy * 2, 8);
    case 'mask': {
      // Flattened capsule, wide and short — reads as a rounded face shape
      // rather than a figure or container.
      const geo = new THREE.CapsuleGeometry(Math.min(hx, hy), Math.max(hx * 2 - Math.min(hx, hy) * 2, 0.05), 4, 8);
      geo.rotateZ(Math.PI / 2);
      geo.scale(1, 1, hz / hx);
      return geo;
    }
    case 'orb':
      return new THREE.SphereGeometry(hx, 16, 12);
  }
}
