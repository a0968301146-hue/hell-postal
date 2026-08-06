import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { CargoSystem } from './cargo-system';
import { PlayerInteractionData } from '../../core/game-state';
import { HUD } from '../hud';
import {
  WEST_WALL_SHELVES, WestWallShelfConfig, SHELF_LEVEL_Y_OFFSETS, SHELF_BOARD_THICKNESS,
  SHELF_FRAME_TOP_MARGIN, BACK_AREA,
} from '../world-layout/logistics-layout-data';
import { COLD_VALUE_MIN, COLD_VALUE_MAX, COLD_VALUE_DECAY_PER_SECOND, COLD_VALUE_RECOVERY_PER_SECOND } from './cold-value-data';

/** One shelf-LEVEL's own runtime state — every existing 置物架 level (spec一:
 * "把目前所有「置物架」直接改成「冷凍貨架」", appearance/size/placement
 * gameplay all left completely untouched, per the correction round) gets its
 * own non-blocking Rapier sensor volume sized to that level's real clear
 * headroom (world-layout-system.ts's own buildWestWallShelves board-Y math,
 * read but never modified), never a new cabinet model. The zone "owns" its
 * own cargo membership set, re-diffed once per frame via a single cheap
 * Rapier query — never a per-frozen-item distance scan. */
interface FreezerZone {
  sensor: RAPIER.Collider;
  cargoIds: Set<string>;
}

function buildZonesForShelf(physics: PhysicsSystem, shelf: WestWallShelfConfig): FreezerZone[] {
  const halfD = shelf.depth / 2;
  const halfW = shelf.width / 2;
  const zones: FreezerZone[] = [];
  for (let i = 0; i < SHELF_LEVEL_Y_OFFSETS.length; i++) {
    const levelTopY = SHELF_LEVEL_Y_OFFSETS[i];
    // Clear headroom above THIS level's own board top surface, up to the
    // next level's board bottom (or the frame's own open top, for the
    // topmost level) — exactly the same span buildWestWallShelves() already
    // guarantees is free of any other solid geometry, so any item legally
    // placed on this level (whatever its height) sits inside this zone.
    const clearHeight = i + 1 < SHELF_LEVEL_Y_OFFSETS.length
      ? SHELF_LEVEL_Y_OFFSETS[i + 1] - SHELF_BOARD_THICKNESS - levelTopY
      : SHELF_FRAME_TOP_MARGIN;
    const halfHeight = clearHeight / 2;
    const worldY = BACK_AREA.floorY + levelTopY + halfHeight;
    const sensor = physics.createCargoSensorCuboid(shelf.centerX, worldY, shelf.centerZ, halfD, halfHeight, halfW);
    zones.push({ sensor, cargoIds: new Set() });
  }
  return zones;
}

/**
 * "Add freezer shelves and frozen cargo freshness system" round (correction
 * pass) — the ONLY thing this system adds to the pre-existing west-wall
 * 置物架 is a cold-recovery-zone Collider per shelf level (spec一/七: no new
 * visuals, no new model, no changed dimensions/placement gameplay) plus the
 * per-frame coldValue decay/recovery tick for every `category==='frozen'`
 * CargoData. Zone membership is detected via real Rapier SENSOR trigger
 * volumes (physics-system.ts's own createCargoSensorCuboid/
 * getCollidersInsideCargoSensor), one small query per shelf level (6 total)
 * per frame — never a per-frozen-item distance scan.
 * `CargoData.isInsideFreezerShelf` is only ever WRITTEN on a genuine
 * enter/exit transition (see setClaim below), never reassigned to the same
 * value every frame regardless of change.
 */
export class FreezerSystem {
  private physics: PhysicsSystem;
  private cargoSystem: CargoSystem;
  private playerData: PlayerInteractionData;
  private hud: HUD;

  private zones: FreezerZone[] = [];

  /** How many zones currently claim a given cargo id as "inside" — the ONE
   * source `CargoData.isInsideFreezerShelf` is derived from. A transition
   * across zero (0->1 or 1->0) is exactly an enter/exit event; staying at 1
   * (or briefly higher, if a large item spans two adjacent zones) or staying
   * at 0 never touches the field again until the next real edge. */
  private claimCounts: Map<string, number> = new Map();

  constructor(physics: PhysicsSystem, cargoSystem: CargoSystem, playerData: PlayerInteractionData, hud: HUD) {
    this.physics = physics;
    this.cargoSystem = cargoSystem;
    this.playerData = playerData;
    this.hud = hud;

    for (const shelf of WEST_WALL_SHELVES) {
      this.zones.push(...buildZonesForShelf(physics, shelf));
    }
  }

  /** The ONE place `CargoData.isInsideFreezerShelf` is ever written — only
   * on a genuine 0<->non-zero claim-count transition. */
  private setClaim(cargoId: string, claimed: boolean): void {
    const prev = this.claimCounts.get(cargoId) ?? 0;
    const next = Math.max(0, prev + (claimed ? 1 : -1));
    this.claimCounts.set(cargoId, next);
    if (prev === next) return;
    if ((prev === 0) === (next === 0)) return; // no zero/non-zero edge crossed
    const data = this.cargoSystem.getCargoData(cargoId);
    if (data) data.isInsideFreezerShelf = next > 0;
  }

  /** Zone-owned membership, enter/exit only — no per-frozen-item distance
   * scan. */
  private updateZoneMembership(): void {
    // Collider handle -> cargo id, scoped to frozen cargo only (bounded by
    // frozen count, not total cargo) — held items are excluded entirely
    // (spec三: decay applies to held cargo same as anywhere off-shelf),
    // never eligible to be detected as "inside" regardless of where their
    // collider physically sits.
    const colliderHandleToId = new Map<number, string>();
    for (const data of this.cargoSystem.cargoDataMap.values()) {
      if (data.category !== 'frozen') continue;
      const obj = this.cargoSystem.getInteractable(data.id);
      if (obj && !obj.isHeld && obj.collider) colliderHandleToId.set(obj.collider.handle, data.id);
    }

    for (const zone of this.zones) {
      const hits = this.physics.getCollidersInsideCargoSensor(zone.sensor);
      const current = new Set<string>();
      for (const collider of hits) {
        const id = colliderHandleToId.get(collider.handle);
        if (id) current.add(id);
      }
      for (const id of current) {
        if (!zone.cargoIds.has(id)) this.setClaim(id, true);
      }
      for (const id of zone.cargoIds) {
        if (!current.has(id)) this.setClaim(id, false);
      }
      zone.cargoIds = current;
    }
  }

  /** Purely arithmetic, driven by the ALREADY-CACHED `isInsideFreezerShelf`
   * flag (no geometry/scanning here at all). Decay/recovery RATES are
   * unchanged from the original round. */
  private tickColdValues(deltaTime: number): void {
    for (const data of this.cargoSystem.cargoDataMap.values()) {
      if (data.category !== 'frozen') continue;
      if (data.isInsideFreezerShelf) {
        data.coldValue = Math.min(COLD_VALUE_MAX, data.coldValue + COLD_VALUE_RECOVERY_PER_SECOND * deltaTime);
      } else {
        data.coldValue = Math.max(COLD_VALUE_MIN, data.coldValue - COLD_VALUE_DECAY_PER_SECOND * deltaTime);
      }
    }
  }

  /** Called every frame from game-app.ts's own paused-gated update block. */
  update(deltaTime: number): void {
    this.updateZoneMembership();
    this.tickColdValues(deltaTime);
  }

  /** Held frozen cargo's own live 冷藏值 readout — a separate, tiny method
   * called UNCONDITIONALLY from game-app.ts, outside the pause-gated block
   * the tick above lives in (mirrors cargoInspectionSystem/cargoHookSystem's
   * own established "runs even while paused" convention). Hidden entirely
   * (spec五) whenever the player isn't holding frozen cargo. */
  refreshHeldItemHud(): void {
    const heldId = this.playerData.heldObjectId;
    const heldData = heldId ? this.cargoSystem.getCargoData(heldId) : null;
    if (heldData && heldData.category === 'frozen') {
      this.hud.updateColdValueStatus(heldData.coldValue);
    } else {
      this.hud.updateColdValueStatus(null);
    }
  }
}
