import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { CargoSystem } from './cargo-system';
import { CargoData } from './cargo-data';
import { PlayerInteractionData } from '../../core/game-state';
import { HUD } from '../hud';
import { PalletSystem } from '../pallet/pallet-system';
import { MistEmitter } from '../../adapters/three/particle-burst';
import {
  WEST_WALL_SHELVES, WestWallShelfConfig, SHELF_LEVEL_Y_OFFSETS, SHELF_BOARD_THICKNESS,
  SHELF_FRAME_TOP_MARGIN, BACK_AREA,
} from '../world-layout/logistics-layout-data';
import {
  COLD_VALUE_MIN, COLD_VALUE_DECAY_HELD_PER_SECOND, COLD_VALUE_DECAY_FLOOR_PER_SECOND,
  COLD_VALUE_DECAY_PALLET_PER_SECOND, COLD_VALUE_DECAY_VEHICLE_PER_SECOND, COLD_VALUE_RECOVERY_PER_SECOND,
  nextColdValueCap,
} from './cold-value-data';

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
  private palletSystem: PalletSystem;
  private playerData: PlayerInteractionData;
  private hud: HUD;

  private zones: FreezerZone[] = [];
  /** "冷凍貨物系統修改" round新增: purely decorative continuous mist/frost
   * particles per cabinet group (spec二: "持續播放、低密度、循環即可") — never
   * touches the sensor zones, collision, or the cabinet model itself, and
   * never read by any gameplay logic. */
  private mistEmitters: MistEmitter[] = [];

  /** How many zones currently claim a given cargo id as "inside" — the ONE
   * source `CargoData.isInsideFreezerShelf` is derived from. A transition
   * across zero (0->1 or 1->0) is exactly an enter/exit event; staying at 1
   * (or briefly higher, if a large item spans two adjacent zones) or staying
   * at 0 never touches the field again until the next real edge. */
  private claimCounts: Map<string, number> = new Map();

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, cargoSystem: CargoSystem, palletSystem: PalletSystem,
    playerData: PlayerInteractionData, hud: HUD
  ) {
    this.physics = physics;
    this.cargoSystem = cargoSystem;
    this.palletSystem = palletSystem;
    this.playerData = playerData;
    this.hud = hud;

    for (const shelf of WEST_WALL_SHELVES) {
      this.zones.push(...buildZonesForShelf(physics, shelf));
    }

    const structureHeight = SHELF_LEVEL_Y_OFFSETS[SHELF_LEVEL_Y_OFFSETS.length - 1] + SHELF_BOARD_THICKNESS / 2 + SHELF_FRAME_TOP_MARGIN;
    for (const shelf of WEST_WALL_SHELVES) {
      const origin = new THREE.Vector3(shelf.centerX, BACK_AREA.floorY + structureHeight * 0.6, shelf.centerZ);
      const halfExtents = new THREE.Vector3(shelf.depth * 0.35, structureHeight * 0.45, shelf.width * 0.4);
      this.mistEmitters.push(new MistEmitter(scene, origin, {
        color: 0xeaf6ff, size: 0.05, count: 16, halfExtents,
        fallSpeed: 0.12, driftSpeed: 0.04, opacity: 0.4,
      }));
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

  /** "冷凍貨物系統修改" round三: which decay rate applies to a frozen item
   * currently OUTSIDE a freezer zone, based on where it physically is right
   * now — held (`obj.isHeld`) > loaded on a vehicle
   * (`CargoData.loadedVehicleId`, already reliably set/cleared by
   * VehicleControlSystem.scanCargoForShipment) > resting on a pallet
   * (PalletSystem.isCargoOnAnyPallet, a cheap ≤6-pallet Map.has check) >
   * else floor (the residual/default "resting somewhere else" case, per
   * spec三's own "其它維持目前邏輯" — floor's rate doubles as that
   * fallback). Checked in this fixed priority order since an item could
   * technically satisfy more than one loosely (e.g. a held item's own
   * stale loadedVehicleId from before pickup) — held always wins. */
  private resolveDecayRate(data: CargoData, obj: { isHeld: boolean } | null | undefined): number {
    if (obj?.isHeld) return COLD_VALUE_DECAY_HELD_PER_SECOND;
    if (data.loadedVehicleId !== null) return COLD_VALUE_DECAY_VEHICLE_PER_SECOND;
    if (this.palletSystem.isCargoOnAnyPallet(data.id)) return COLD_VALUE_DECAY_PALLET_PER_SECOND;
    return COLD_VALUE_DECAY_FLOOR_PER_SECOND;
  }

  /** Purely arithmetic, driven by the ALREADY-CACHED `isInsideFreezerShelf`
   * flag (no geometry/scanning here at all — resolveDecayRate above only
   * reads already-cheap state, never a new scan of its own). Recovery rate
   * and the permanent quality cap (coldValueCap, nextColdValueCap) are
   * unchanged from the prior round: recovery clamps to coldValueCap (never
   * straight back to 100), and decay is the ONE place that cap can ever be
   * lowered further. */
  private tickColdValues(deltaTime: number): void {
    for (const data of this.cargoSystem.cargoDataMap.values()) {
      if (data.category !== 'frozen') continue;
      if (data.isInsideFreezerShelf) {
        data.coldValue = Math.min(data.coldValueCap, data.coldValue + COLD_VALUE_RECOVERY_PER_SECOND * deltaTime);
      } else {
        const obj = this.cargoSystem.getInteractable(data.id);
        const rate = this.resolveDecayRate(data, obj);
        data.coldValue = Math.max(COLD_VALUE_MIN, data.coldValue - rate * deltaTime);
        data.coldValueCap = nextColdValueCap(data.coldValue, data.coldValueCap);
      }
    }
  }

  /** Called every frame from game-app.ts's own paused-gated update block. */
  update(deltaTime: number): void {
    this.updateZoneMembership();
    this.tickColdValues(deltaTime);
    for (const mist of this.mistEmitters) mist.update(deltaTime);
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

  /** "冷凍貨物系統修改" round四, redone in "準心貨物數值提示" round:
   * crosshair-aim 冷藏值 readout, merged directly into the existing
   * interaction prompt's own text (spec: "直接顯示在準心互動UI即可，不用
   * 另外開視窗") rather than a second DOM element — see
   * HUD.updateAimedColdValue/showInteractionPrompt. Shown ONLY while the
   * player is genuinely empty-handed (spec規則1: "只有玩家空手時顯示" — a
   * new restriction this round; previously showed regardless of hold
   * state) AND aiming at frozen cargo, gone the instant either condition
   * stops holding. Takes `inspectedCargo` as a PARAMETER (game-app.ts's own
   * already-computed `CargoInspectionSystem.currentCargo` for this exact
   * frame) rather than running a second independent raycast of its own —
   * same "reuse the one crosshair raycast" convention CargoHookSystem
   * already follows. Called UNCONDITIONALLY alongside refreshHeldItemHud
   * above, for the same "a pause must take effect the same frame" reason. */
  refreshAimedColdValueHud(inspectedCargo: CargoData | null): void {
    const emptyHanded = this.playerData.heldObjectId === null;
    if (emptyHanded && inspectedCargo && inspectedCargo.category === 'frozen') {
      this.hud.updateAimedColdValue(inspectedCargo.coldValue);
    } else {
      this.hud.updateAimedColdValue(null);
    }
  }
}
