import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { CargoSystem } from './cargo-system';
import { PlayerInteractionData } from '../../core/game-state';
import { HUD } from '../hud';
import { createFloatingLabel } from '../../adapters/three/world-label-system';
import { PalletSystem } from '../pallet/pallet-system';
import { PALLET_WALL_SLOTS, PALLET_WALL_SLOTS_SET2, PalletWallSlot } from '../pallet/pallet-data';
import {
  COLD_VALUE_MIN, COLD_VALUE_MAX, COLD_VALUE_DECAY_PER_SECOND, COLD_VALUE_RECOVERY_PER_SECOND, coldValueColor,
} from './cold-value-data';

/** Half-extents of each rack's own cargo-detection sensor — generous enough
 * to cover a loose item resting on the floor directly beneath/against the
 * rack, or a mounted pallet's own hanging footprint at that same slot,
 * without reaching out into the open room floor a few steps away. */
const RACK_SENSOR_HALF_EXTENTS = { x: 0.9, y: 0.9, z: 0.9 };

const MIST_PARTICLES_PER_RACK = 10;
const MIST_RISE_HEIGHT = 0.45;
const MIST_FALL_SPEED = 0.10;
const MIST_DRIFT_SPEED = 0.05;

/** One physical rack slot's own runtime state — the rack itself is what
 * "owns" its current cargo membership (spec follow-up: "由冷凍貨架維護自己
 * 的貨物列表"), never a global per-cargo scan. */
interface FreezerRack {
  slot: PalletWallSlot;
  sensor: RAPIER.Collider;
  /** Loose (non-palletized) cargo ids the sensor currently reports touching
   * this rack — re-diffed each frame via a single cheap Rapier query, never
   * manual distance math. */
  looseCargoIds: Set<string>;
  /** Cargo ids pulled in AS A BATCH because `rackedPalletId` is currently
   * mounted here (spec五: "不用拆開判定") — only ever (re)computed on the
   * pallet's own mount/unmount TRANSITION at this slot, never every frame. */
  palletBulkCargoIds: Set<string>;
  /** Which pallet (if any) this rack believed was mounted here as of last
   * frame — compared against PalletSystem's own live answer each frame
   * (a cheap ≤6-pallet scan, not a cargo scan) purely to detect a
   * mount/unmount edge. */
  rackedPalletId: string | null;
}

/**
 * "Add freezer shelves and frozen cargo freshness system" round (follow-up
 * pass) — owns EVERY freezer-rack-related concern in one place: the purely
 * decorative "all racks are now freezer racks" dressing (spec一: vent/blue
 * light/mist/icon, unchanged from the original round), and the per-frame
 * coldValue decay/recovery tick for every `category==='frozen'` CargoData
 * (spec二-五).
 *
 * Rack-membership detection was rebuilt this pass into a genuine Rapier
 * SENSOR trigger volume per rack (physics-system.ts's own new
 * createCargoSensorCuboid/getCollidersInsideCargoSensor) instead of the
 * original per-frame "for every frozen item, for every rack, compute
 * distance" scan — each FreezerRack now owns its own small membership set
 * (looseCargoIds), re-diffed each frame via ONE cheap Rapier broad-phase
 * query per rack (≤6 total), not one check per frozen cargo item. A
 * pallet's own bulk cargo load (spec五) is now event-driven too: re-scanned
 * via PalletSystem.getCargoIdsOnPallet ONLY the instant a pallet actually
 * mounts/unmounts at a given slot (cheaply detected by comparing
 * PalletSystem.getPalletIdAtRackSlot's answer frame-to-frame), never
 * continuously. `CargoData.isInsideFreezerShelf` itself is only ever
 * WRITTEN on a genuine enter/exit transition (see setClaim below) — never
 * reassigned to the same value every frame regardless of change.
 */
export class FreezerSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private cargoSystem: CargoSystem;
  private palletSystem: PalletSystem;
  private playerData: PlayerInteractionData;
  private hud: HUD;

  private racks: FreezerRack[] = [];
  private mistGeometries: THREE.BufferGeometry[] = [];
  private mistOrigins: THREE.Vector3[] = [];
  private mistVelocities: Float32Array[] = [];

  /** How many racks currently claim a given cargo id as "inside" — the ONE
   * source `CargoData.isInsideFreezerShelf` is derived from. A transition
   * across zero (0->1 or 1->0) is exactly an enter/exit event; staying at 1
   * (or briefly 2, if a loose hit and a pallet-bulk claim ever overlap) or
   * staying at 0 never touches the field again until the next real edge. */
  private claimCounts: Map<string, number> = new Map();

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, cargoSystem: CargoSystem, palletSystem: PalletSystem,
    playerData: PlayerInteractionData, hud: HUD
  ) {
    this.scene = scene;
    this.physics = physics;
    this.cargoSystem = cargoSystem;
    this.palletSystem = palletSystem;
    this.playerData = playerData;
    this.hud = hud;

    // Both pallet sets, always (spec一: "所有貨架改成冷凍貨架") — see this
    // class's own original-round doc comment (still accurate) for why
    // dressing every fixed slot position unconditionally, even before the
    // second set's own skill unlock, is harmless.
    const slots = [...Object.values(PALLET_WALL_SLOTS), ...Object.values(PALLET_WALL_SLOTS_SET2)];
    for (const slot of slots) {
      const sensor = this.physics.createCargoSensorCuboid(
        slot.position.x, slot.position.y, slot.position.z,
        RACK_SENSOR_HALF_EXTENTS.x, RACK_SENSOR_HALF_EXTENTS.y, RACK_SENSOR_HALF_EXTENTS.z
      );
      this.racks.push({
        slot, sensor, looseCargoIds: new Set(), palletBulkCargoIds: new Set(), rackedPalletId: null,
      });
      this.buildFreezerDressing(slot);
    }
  }

  /** spec一: 冷氣出風口／藍色燈光／微弱白色冷氣霧氣／冷凍圖示 — purely additive
   * decoration at an existing rack slot's own position/orientation; never
   * touches collision (spec一: "不用修改碰撞") — the sensor built alongside
   * it is a NON-blocking trigger volume, not a solid collider either. */
  private buildFreezerDressing(slot: PalletWallSlot): void {
    const ventGeo = new THREE.BoxGeometry(0.32, 0.08, 0.14);
    const ventMat = new THREE.MeshStandardMaterial({ color: 0x2a2f35, metalness: 0.5, roughness: 0.5 });
    const vent = new THREE.Mesh(ventGeo, ventMat);
    const localAbove = new THREE.Vector3(0, 0.55, 0).applyQuaternion(slot.quaternion).add(slot.position);
    vent.position.copy(localAbove);
    vent.quaternion.copy(slot.quaternion);
    this.scene.add(vent);

    const slatMat = new THREE.MeshStandardMaterial({ color: 0x6d8fa8, metalness: 0.3, roughness: 0.4 });
    for (let i = -1; i <= 1; i++) {
      const slatGeo = new THREE.BoxGeometry(0.30, 0.015, 0.005);
      const slat = new THREE.Mesh(slatGeo, slatMat);
      const localSlat = new THREE.Vector3(0, 0.55 + i * 0.02, 0.075).applyQuaternion(slot.quaternion).add(slot.position);
      slat.position.copy(localSlat);
      slat.quaternion.copy(slot.quaternion);
      this.scene.add(slat);
    }

    const light = new THREE.PointLight(0x4d8fff, 0.6, 2.4);
    light.position.copy(vent.position);
    this.scene.add(light);

    const icon = createFloatingLabel('❄', { width: 0.28, bg: 'rgba(20,40,70,0.35)', fontSize: 30 });
    icon.position.copy(vent.position).add(new THREE.Vector3(0, 0.22, 0));
    this.scene.add(icon);

    this.buildMist(vent.position.clone());
  }

  private buildMist(origin: THREE.Vector3): void {
    const positions = new Float32Array(MIST_PARTICLES_PER_RACK * 3);
    const velocities = new Float32Array(MIST_PARTICLES_PER_RACK * 3);
    for (let i = 0; i < MIST_PARTICLES_PER_RACK; i++) {
      positions[i * 3] = origin.x + (Math.random() - 0.5) * 0.18;
      positions[i * 3 + 1] = origin.y - Math.random() * MIST_RISE_HEIGHT;
      positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.18;
      velocities[i * 3] = (Math.random() - 0.5) * MIST_DRIFT_SPEED;
      velocities[i * 3 + 1] = -(MIST_FALL_SPEED * (0.6 + Math.random() * 0.6));
      velocities[i * 3 + 2] = (Math.random() - 0.5) * MIST_DRIFT_SPEED;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.045, transparent: true, opacity: 0.32, depthWrite: false, sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.mistGeometries.push(geo);
    this.mistOrigins.push(origin);
    this.mistVelocities.push(velocities);
  }

  private updateMist(deltaTime: number): void {
    for (let p = 0; p < this.mistGeometries.length; p++) {
      const geo = this.mistGeometries[p];
      const origin = this.mistOrigins[p];
      const vel = this.mistVelocities[p];
      const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < posAttr.count; i++) {
        let x = posAttr.getX(i) + vel[i * 3] * deltaTime;
        let y = posAttr.getY(i) + vel[i * 3 + 1] * deltaTime;
        let z = posAttr.getZ(i) + vel[i * 3 + 2] * deltaTime;
        if (y < origin.y - MIST_RISE_HEIGHT) {
          x = origin.x + (Math.random() - 0.5) * 0.18;
          y = origin.y;
          z = origin.z + (Math.random() - 0.5) * 0.18;
        }
        posAttr.setXYZ(i, x, y, z);
      }
      posAttr.needsUpdate = true;
    }
  }

  /** The ONE place `CargoData.isInsideFreezerShelf` is ever written — only
   * on a genuine 0<->non-zero claim-count transition (spec follow-up: "貨物
   * 只在進入／離開貨架時更新isInsideFreezerShelf"). */
  private setClaim(cargoId: string, claimed: boolean): void {
    const prev = this.claimCounts.get(cargoId) ?? 0;
    const next = Math.max(0, prev + (claimed ? 1 : -1));
    this.claimCounts.set(cargoId, next);
    if (prev === next) return;
    if ((prev === 0) === (next === 0)) return; // no zero/non-zero edge crossed
    const data = this.cargoSystem.getCargoData(cargoId);
    if (data) data.isInsideFreezerShelf = next > 0;
  }

  /** spec八: rack-owned membership, enter/exit only — no per-frozen-item
   * distance scan, no unconditional per-frame pallet-cargo re-scan. */
  private updateRackMembership(): void {
    // Collider handle -> cargo id, scoped to frozen cargo only (bounded by
    // frozen count, not total cargo) — held items are excluded here
    // entirely (spec三: "玩家手上...全部都會下降", never eligible to be
    // detected as "inside" regardless of where their collider physically
    // sits), mirroring PalletSystem's own findSupportedCargoRecursive
    // convention of skipping `obj.isHeld` items.
    const colliderHandleToId = new Map<number, string>();
    for (const data of this.cargoSystem.cargoDataMap.values()) {
      if (data.category !== 'frozen') continue;
      const obj = this.cargoSystem.getInteractable(data.id);
      if (obj && !obj.isHeld && obj.collider) colliderHandleToId.set(obj.collider.handle, data.id);
    }

    for (const rack of this.racks) {
      // 1. Loose cargo — one real Rapier sensor query per rack.
      const hits = this.physics.getCollidersInsideCargoSensor(rack.sensor);
      const currentLoose = new Set<string>();
      for (const collider of hits) {
        const id = colliderHandleToId.get(collider.handle);
        if (id) currentLoose.add(id);
      }
      for (const id of currentLoose) {
        if (!rack.looseCargoIds.has(id)) this.setClaim(id, true);
      }
      for (const id of rack.looseCargoIds) {
        if (!currentLoose.has(id)) this.setClaim(id, false);
      }
      rack.looseCargoIds = currentLoose;

      // 2. Pallet bulk — only re-scanned on a mount/unmount TRANSITION at
      // THIS slot (spec五: "整張托盤上的所有冷凍貨物全部一起恢復。不用拆開判
      // 定"), never every frame while unchanged.
      const palletIdHere = this.palletSystem.getPalletIdAtRackSlot(rack.slot.id);
      if (rack.rackedPalletId !== null && rack.rackedPalletId !== palletIdHere) {
        for (const id of rack.palletBulkCargoIds) this.setClaim(id, false);
        rack.palletBulkCargoIds = new Set();
        rack.rackedPalletId = null;
      }
      if (palletIdHere !== null && rack.rackedPalletId === null) {
        const ids = this.palletSystem.getCargoIdsOnPallet(palletIdHere);
        rack.palletBulkCargoIds = new Set(ids);
        for (const id of ids) this.setClaim(id, true);
        rack.rackedPalletId = palletIdHere;
      }
    }
  }

  /** spec二-五 tick — purely arithmetic, driven by the ALREADY-CACHED
   * `isInsideFreezerShelf` flag (no geometry/scanning here at all). */
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
    this.updateMist(deltaTime);
    this.updateRackMembership();
    this.tickColdValues(deltaTime);
  }

  /** spec七: held frozen cargo's own live 冷藏值 readout, color-tiered — a
   * separate, tiny method called UNCONDITIONALLY from game-app.ts, outside
   * the pause-gated block the tick above lives in (mirrors
   * cargoInspectionSystem/cargoHookSystem's own established "runs even
   * while paused, so a pause takes effect on the UI the SAME frame it
   * begins" convention). */
  refreshHeldItemHud(): void {
    const heldId = this.playerData.heldObjectId;
    const heldData = heldId ? this.cargoSystem.getCargoData(heldId) : null;
    if (heldData && heldData.category === 'frozen') {
      this.hud.updateColdValueStatus(heldData.coldValue, coldValueColor(heldData.coldValue));
    } else {
      this.hud.updateColdValueStatus(null);
    }
  }
}
