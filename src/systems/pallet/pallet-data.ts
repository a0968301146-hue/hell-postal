import * as THREE from 'three';
import { BACK_AREA, WALL_THICKNESS, SEA_GATE } from '../world-layout';

/** "Rebuild pallet storage and reset upgrade progression" round三: every
 * pallet-size constant lives here, centralized (spec三: "所有尺寸集中於
 * pallet-data.ts"), never duplicated or hardcoded in pallet-system.ts. */
export type PalletSize = 'small' | 'medium' | 'large';

export const PALLET_SIZE_ORDER: PalletSize[] = ['small', 'medium', 'large'];

/** The pre-existing single pallet (spec三: "目前既有托盤尺寸視為medium") is
 * exactly the medium size's own scale, 1.0 — small/large scale its
 * width/depth only, thickness (height) stays identical across all three
 * (spec三: "三種厚度維持既有托盤厚度"). */
export const PALLET_SIZE_SCALE: Record<PalletSize, number> = {
  small: 0.75,
  medium: 1.0,
  large: 1.35,
};

const BASE_WIDTH = 1.1;
const BASE_DEPTH = 1.1;
const BASE_HEIGHT = 0.15;

export interface PalletDimensions {
  width: number;
  depth: number;
  height: number;
}

export const PALLET_DIMENSIONS: Record<PalletSize, PalletDimensions> = PALLET_SIZE_ORDER.reduce(
  (acc, size) => {
    const scale = PALLET_SIZE_SCALE[size];
    acc[size] = { width: BASE_WIDTH * scale, depth: BASE_DEPTH * scale, height: BASE_HEIGHT };
    return acc;
  },
  {} as Record<PalletSize, PalletDimensions>
);

/** Same detect-height for every size — how far above a pallet's own top
 * surface a box's center may sit and still count as "on" it (unchanged from
 * the old single-pallet PALLET_CONFIG.detectHeight). */
export const PALLET_DETECT_HEIGHT = 1.0;

/** Emergency safety-net floor position (forceReleaseToSafePosition) — the
 * old single pallet's own home spot, reused for whichever pallet needs an
 * emergency drop (e.g. a non-finite carry transform). Not a "home" in the
 * storage sense any more — see PALLET_WALL_SLOTS below, the REAL initial
 * resting spots (spec四: "初始狀態：三張托盤全部掛在各自牆面slot"). */
export const PALLET_SAFETY_DROP_POS = { x: -4.0, z: 15.5 };

/** Wall pallet-storage rack ("Relocate pallet racks and add fishing pier"
 * round一) — three slots on the BACK_AREA EAST wall, south of the sea-gate
 * opening (SEA_GATE, which is where PIER breaks through this same wall for
 * x:PIER.minX..PIER.maxX — see logistics-layout-data.ts). The wall is only
 * solid south of the gate's own south edge (SEA_GATE.centerZ+halfWidth=24)
 * through the BACK_AREA south-wall corner (BACK_AREA.maxZ=32) — an 8m clear
 * run with zero other fixtures on it (the doorway/unload dock/bulletin
 * board/TV/vehicle buttons all live on the WEST wall — see
 * logistics-layout-data.ts), and it stays entirely south of every sea
 * vehicle's own dock/travel range (SEA_DOCK_SLOTS never exceeds
 * z≈22.95 — see vehicle-dock-data.ts), so this stretch is both the literal
 * "東南方牆壁" (southeast interior wall) and clear of every listed
 * do-not-overlap fixture by construction. Derived from SEA_GATE/BACK_AREA
 * directly rather than a hardcoded coordinate, matching this codebase's own
 * convention for every other wall fixture. */
const RACK_GATE_CLEARANCE = 1.0; // clear of the sea-gate opening's own south edge
const RACK_CORNER_CLEARANCE = 1.0; // clear of the south-wall corner
const RACK_SLOT_GAP = 0.25;
/** How far above the floor the BOTTOM edge of every slot sits — kept
 * identical across all three sizes so their mounted pallets visually read as
 * resting on one consistent "shelf line" (spec: "掛架底部離地約0.45～0.65m",
 * "玩家站在地面即可瞄準並拿取"). */
const RACK_BOTTOM_CLEARANCE = 0.55;
/** How far the mounted pallet's thin edge stands off the wall's own inner
 * face — mirrors BULLETIN_BOARD_WALL_STANDOFF/TV_TABLE_WALL_STANDOFF's own
 * role for every other wall fixture. */
const RACK_WALL_STANDOFF = 0.05;
/** Simple wall bracket visual — a shallow frame the pallet mounts flush
 * against (spec: "使用簡單壁掛支架、輪廓框與牆面文字標示"). */
const RACK_BRACKET_MARGIN = 0.12; // how far the outline frame extends past the pallet's own mounted footprint
export const RACK_BRACKET_THICKNESS = 0.04;

const eastWallInnerFaceX = BACK_AREA.maxX - WALL_THICKNESS / 2;

const rackClusterNorthZ = SEA_GATE.centerZ + SEA_GATE.halfWidth + RACK_GATE_CLEARANCE;
const rackClusterSouthZ = BACK_AREA.maxZ - RACK_CORNER_CLEARANCE;

export interface PalletWallSlot {
  id: string;
  size: PalletSize;
  /** World position of the pallet's own CENTER when mounted in this slot. */
  position: THREE.Vector3;
  /** World-space mount quaternion — tips the pallet vertical, flush against
   * the wall, its top surface facing east into the room (spec四: "托盤掛牆時
   * 垂直貼牆顯示"). */
  quaternion: THREE.Quaternion;
  /** Bracket/frame outline footprint, for buildWallSlotVisual(). */
  bracketWidth: number;
  bracketHeight: number;
}

/** Rotating +90° about world Z maps local Y (a flat pallet's top-face
 * normal, +Y) to world -X (west, out of the EAST wall into the room) and
 * local X (width) to a now-VERTICAL axis — exactly "flush against the wall,
 * top face outward, standing on edge" (mirror image of the old west-wall
 * mount, which used -90° for the opposite-facing wall). Since every pallet
 * size is SQUARE (width === depth, spec三 — unchanged this round), using
 * width vs depth for the now-vertical span is interchangeable — width is
 * used throughout below. */
const WALL_MOUNT_QUAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);

/** Player facing the east wall (looking +X, into the wall from inside the
 * room) has their own left hand toward -Z (north) — so "由左至右：小型/中型/
 * 大型" places small at the NORTH end (closer to the sea gate) and large at
 * the SOUTH end (closer to the corner, where there's the most floor
 * clearance for its bigger footprint). */
function buildWallSlots(): Record<PalletSize, PalletWallSlot> {
  const slots = {} as Record<PalletSize, PalletWallSlot>;
  let cursorZ = rackClusterNorthZ;
  for (const size of PALLET_SIZE_ORDER) {
    const dims = PALLET_DIMENSIONS[size];
    // After the wall-mount rotation, `width` spans vertically and `height`
    // (the pallet's thin edge) spans the wall-normal (X) axis.
    const centerZ = cursorZ + dims.width / 2;
    const centerX = eastWallInnerFaceX - RACK_WALL_STANDOFF - dims.height / 2;
    const centerY = BACK_AREA.floorY + RACK_BOTTOM_CLEARANCE + dims.width / 2;
    slots[size] = {
      id: `pallet-rack-${size}`,
      size,
      position: new THREE.Vector3(centerX, centerY, centerZ),
      quaternion: WALL_MOUNT_QUAT.clone(),
      bracketWidth: dims.depth + RACK_BRACKET_MARGIN * 2,
      bracketHeight: dims.width + RACK_BRACKET_MARGIN * 2,
    };
    cursorZ += dims.width + RACK_SLOT_GAP;
  }
  // Dev-time guard, never a hardcoded margin left unverified — the whole
  // cluster (north gate clearance through the last slot's own south edge)
  // must stay clear of the south-wall corner.
  if (cursorZ - RACK_SLOT_GAP > rackClusterSouthZ) {
    console.error('[pallet-data] wall rack cluster overflows into the south-wall corner clearance zone');
  }
  return slots;
}

export const PALLET_WALL_SLOTS: Record<PalletSize, PalletWallSlot> = buildWallSlots();

export const PALLET_SIZE_DISPLAY_NAME: Record<PalletSize, string> = {
  small: '小型托盤',
  medium: '中型托盤',
  large: '大型托盤',
};

/** "Rebuild pallet storage and reset upgrade progression" round三: stable
 * per-size ids, one instance per size (spec三: "不可再假設遊戲中只有單一
 * PALLET_ID") — plain data exported from here (rather than from
 * pallet-system.ts) specifically so systems that only need to RECOGNIZE a
 * pallet id (vehicle-control-system.ts's departure-bay scan, tool-system.ts's
 * hold-blocks-tool-switch gate) can do so with a lightweight data-only
 * import, the same reasoning the old single PALLET_ID constant was exported
 * for in the first place — never a live PalletSystem instance reference,
 * which would risk a heavier/circular dependency. */
export const PALLET_IDS: Record<PalletSize, string> = {
  small: 'pallet-small',
  medium: 'pallet-medium',
  large: 'pallet-large',
};

export const ALL_PALLET_IDS: string[] = PALLET_SIZE_ORDER.map((size) => PALLET_IDS[size]);

export function isPalletId(id: string | null | undefined): boolean {
  return !!id && ALL_PALLET_IDS.includes(id);
}

export const RACK_IDS: Record<PalletSize, string> = PALLET_SIZE_ORDER.reduce(
  (acc, size) => {
    acc[size] = PALLET_WALL_SLOTS[size].id;
    return acc;
  },
  {} as Record<PalletSize, string>
);

export const ALL_RACK_IDS: string[] = PALLET_SIZE_ORDER.map((size) => RACK_IDS[size]);

export function isRackId(id: string | null | undefined): boolean {
  return !!id && ALL_RACK_IDS.includes(id);
}
