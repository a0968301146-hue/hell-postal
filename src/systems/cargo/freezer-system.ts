import * as THREE from 'three';
import { CargoSystem } from './cargo-system';
import { PlayerInteractionData } from '../../core/game-state';
import { HUD } from '../hud';
import { createFloatingLabel } from '../../adapters/three/world-label-system';
import { PalletSystem } from '../pallet/pallet-system';
import { PALLET_WALL_SLOTS, PALLET_WALL_SLOTS_SET2, PalletWallSlot, ALL_PALLET_IDS } from '../pallet/pallet-data';
import {
  COLD_VALUE_MIN, COLD_VALUE_MAX, COLD_VALUE_DECAY_PER_SECOND, COLD_VALUE_RECOVERY_PER_SECOND, coldValueColor,
} from './cold-value-data';

/** How close a LOOSE (never-palletized) frozen item's own mesh center must
 * be to a rack slot's own mount position to count as "touching" it (spec
 * four: "只要冷凍貨物碰到冷凍貨架，開始恢復") — generous enough to cover an
 * item resting on the floor directly beneath/against the rack, without
 * reaching all the way out to the open room floor a few steps away. */
const RACK_ZONE_RADIUS = 1.0;

const MIST_PARTICLES_PER_RACK = 10;
const MIST_RISE_HEIGHT = 0.45;
const MIST_FALL_SPEED = 0.10;
const MIST_DRIFT_SPEED = 0.05;

/**
 * "Add freezer shelves and frozen cargo freshness system" round — owns
 * EVERY freezer-rack-related concern in one place: the purely decorative
 * "all racks are now freezer racks" dressing (spec一: vent/blue light/mist/
 * icon, built at the SAME 6 fixed PALLET_WALL_SLOTS/PALLET_WALL_SLOTS_SET2
 * positions PalletSystem's own (untouched) buildRackVisual already mounts
 * its bracket+label at — never modifies pallet-system.ts's own rack
 * rendering at all), and the per-frame coldValue decay/recovery tick for
 * every `category==='frozen'` CargoData (spec二-五).
 *
 * Deliberately NOT a Rapier sensor/trigger (no such convention exists
 * anywhere else in this codebase to reuse — physics-system.ts's own
 * createSensorCuboid/isPlayerInsideSensor pair is dead code, unused
 * anywhere, and hardcoded to test only the player capsule) — instead a
 * plain per-frame proximity/membership check against a small, FIXED set of
 * rack positions (≤6 total), mirroring every other "is X near Y" check
 * already in this codebase (LostFoundCabinetSystem's own AABB loop,
 * PalletSystem's own updateOrganizeScan) far more closely than reviving
 * unused infrastructure would. Still satisfies spec八's own actual
 * requirement — a maintained `isInsideFreezerShelf` bool, written once per
 * frame here and read nowhere else but this class and the settlement scan —
 * never a brute-force "search every rack every frame FOR EVERY SYSTEM"; only
 * this one system ever does the searching, once per frame, for frozen cargo
 * only.
 */
export class FreezerSystem {
  private scene: THREE.Scene;
  private cargoSystem: CargoSystem;
  private palletSystem: PalletSystem;
  private playerData: PlayerInteractionData;
  private hud: HUD;

  private rackSlots: PalletWallSlot[];
  private mistGeometries: THREE.BufferGeometry[] = [];
  private mistOrigins: THREE.Vector3[] = [];
  private mistVelocities: Float32Array[] = [];

  constructor(
    scene: THREE.Scene, cargoSystem: CargoSystem, palletSystem: PalletSystem,
    playerData: PlayerInteractionData, hud: HUD
  ) {
    this.scene = scene;
    this.cargoSystem = cargoSystem;
    this.palletSystem = palletSystem;
    this.playerData = playerData;
    this.hud = hud;

    // Both pallet sets, always (spec一: "所有貨架改成冷凍貨架") — the second
    // set's own RACK MESHES only actually exist in the world once the
    // pallet-inventory skill unlocks them (pallet-system.ts's own
    // unlockSecondSet, untouched here), but dressing every fixed slot
    // position unconditionally is harmless: nothing is ever positioned at an
    // unbuilt slot for the proximity check to false-trigger on, and the
    // decorative fixtures simply read as "the cold infrastructure is already
    // installed, waiting for a rack to be unlocked there" rather than
    // needing this class to hook into the skill-unlock event at all.
    this.rackSlots = [...Object.values(PALLET_WALL_SLOTS), ...Object.values(PALLET_WALL_SLOTS_SET2)];
    for (const slot of this.rackSlots) this.buildFreezerDressing(slot);
  }

  /** spec一: 冷氣出風口／藍色燈光／微弱白色冷氣霧氣／冷凍圖示 — purely additive
   * decoration at an existing rack slot's own position/orientation; never
   * touches collision (spec一: "不用修改碰撞") since nothing here registers
   * any physics body at all. */
  private buildFreezerDressing(slot: PalletWallSlot): void {
    // Vent — mounted just above the rack's own bracket (mirrors
    // pallet-system.ts's own buildRackVisual local-Y-then-rotate convention
    // for "above this slot, in the slot's own local space").
    const ventGeo = new THREE.BoxGeometry(0.32, 0.08, 0.14);
    const ventMat = new THREE.MeshStandardMaterial({ color: 0x2a2f35, metalness: 0.5, roughness: 0.5 });
    const vent = new THREE.Mesh(ventGeo, ventMat);
    const localAbove = new THREE.Vector3(0, 0.55, 0).applyQuaternion(slot.quaternion).add(slot.position);
    vent.position.copy(localAbove);
    vent.quaternion.copy(slot.quaternion);
    this.scene.add(vent);

    // Thin lighter slats across the vent face, purely cosmetic grate detail.
    const slatMat = new THREE.MeshStandardMaterial({ color: 0x6d8fa8, metalness: 0.3, roughness: 0.4 });
    for (let i = -1; i <= 1; i++) {
      const slatGeo = new THREE.BoxGeometry(0.30, 0.015, 0.005);
      const slat = new THREE.Mesh(slatGeo, slatMat);
      const localSlat = new THREE.Vector3(0, 0.55 + i * 0.02, 0.075).applyQuaternion(slot.quaternion).add(slot.position);
      slat.position.copy(localSlat);
      slat.quaternion.copy(slot.quaternion);
      this.scene.add(slat);
    }

    // Blue freezer light.
    const light = new THREE.PointLight(0x4d8fff, 0.6, 2.4);
    light.position.copy(vent.position);
    this.scene.add(light);

    // Frozen icon — small floating billboard, offset above the rack's own
    // (untouched) text label so the two never overlap.
    const icon = createFloatingLabel('❄', { width: 0.28, bg: 'rgba(20,40,70,0.35)', fontSize: 30 });
    icon.position.copy(vent.position).add(new THREE.Vector3(0, 0.22, 0));
    this.scene.add(icon);

    this.buildMist(vent.position.clone());
  }

  /** A small, cheap THREE.Points cloud per rack (spec一: "微弱白色冷氣霧氣") —
   * particles drift down/outward from the vent and recycle back to the
   * origin once they've fallen far enough, animated in updateMist() below. */
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

  private isNearAnyRack(position: THREE.Vector3): boolean {
    for (const slot of this.rackSlots) {
      if (position.distanceTo(slot.position) <= RACK_ZONE_RADIUS) return true;
    }
    return false;
  }

  /** spec二-五 — the one per-frame coldValue tick, plus the held-item HUD
   * readout (spec七). */
  update(deltaTime: number): void {
    this.updateMist(deltaTime);

    // Pallet membership (spec五: "整張托盤上的所有冷凍貨物全部一起恢復。不用
    // 拆開判定") — computed for EVERY pallet (racked or not), not just racked
    // ones, so a frozen item resting on a FLOOR-PLACED pallet is correctly
    // excluded from the generic loose-item proximity check below even if
    // that pallet happens to be sitting physically close to a rack (spec五:
    // "若托盤離開貨架：全部開始下降" — palletized cargo's cold state is
    // decided ENTIRELY by its own pallet's rack-mount state, never by raw
    // distance).
    const rackedPalletIds = new Set(this.palletSystem.getRackedPalletIds());
    const rackedCargoIds = new Set<string>();
    const anyPalletCargoIds = new Set<string>();
    for (const palletId of ALL_PALLET_IDS) {
      const cargoIds = this.palletSystem.getCargoIdsOnPallet(palletId);
      const onRackedPallet = rackedPalletIds.has(palletId);
      for (const cargoId of cargoIds) {
        anyPalletCargoIds.add(cargoId);
        if (onRackedPallet) rackedCargoIds.add(cargoId);
      }
    }

    for (const data of this.cargoSystem.cargoDataMap.values()) {
      if (data.category !== 'frozen') continue;

      let inside: boolean;
      if (rackedCargoIds.has(data.id)) {
        inside = true;
      } else if (anyPalletCargoIds.has(data.id)) {
        // On some OTHER (unracked) pallet — spec五's own exclusion, no
        // generic proximity fallback for palletized cargo.
        inside = false;
      } else {
        const obj = this.cargoSystem.getInteractable(data.id);
        // spec三: held cargo always decays regardless of where the player
        // happens to be standing — never runs the proximity check while held.
        inside = !!obj && !obj.isHeld && this.isNearAnyRack(obj.mesh.position);
      }

      data.isInsideFreezerShelf = inside;
      if (inside) {
        data.coldValue = Math.min(COLD_VALUE_MAX, data.coldValue + COLD_VALUE_RECOVERY_PER_SECOND * deltaTime);
      } else {
        data.coldValue = Math.max(COLD_VALUE_MIN, data.coldValue - COLD_VALUE_DECAY_PER_SECOND * deltaTime);
      }
    }
  }

  /** spec七: held frozen cargo's own live 冷藏值 readout, color-tiered — a
   * separate, tiny method (not folded into update() above) so game-app.ts
   * can call it UNCONDITIONALLY, outside the pause-gated block the coldValue
   * tick itself lives in (mirrors cargoInspectionSystem/cargoHookSystem's
   * own established "runs even while paused, so a pause takes effect on the
   * UI the SAME frame it begins" convention — see hud.ts's own
   * showToolPrompt doc comment). Without this split, clearing heldObjectId
   * in the same synchronous tick that immediately pauses the game (e.g. the
   * test cheat button's own clearHeldState-then-settle sequence) would leave
   * a stale reading on screen until the next unpause. */
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
