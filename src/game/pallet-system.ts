import * as THREE from 'three';
import { PhysicsSystem } from './physics-system';
import { InteractableObject } from './interactable-object';
import { CargoSystem } from './cargo-system';
import { PALLET_CONFIG } from './daily-flow-data';
import { BACK_AREA } from './logistics-layout-data';
import { createFloatingLabel } from './world-label-system';

const STABLE_THRESHOLD = 0.5; // seconds, spec 十三: "至少 0.5 秒"
const VELOCITY_THRESHOLD = 0.4;

/**
 * A single wooden pallet in the central sorting area (spec "每日貨品清空核心
 * 流程" section 十二/十三). Fixed this round (spec explicitly allows "固定
 * 或可輕度移動" — kept fully static/immovable to avoid it drifting out of
 * its own detection zone), with a real placement surface on top so players
 * can precisely stack boxes via the normal E-key placement flow.
 *
 * organized judgment is a pure position/velocity check against THIS
 * pallet's own actual dimensions (spec: "不得寫死沿用拖板車或分類箱範圍") —
 * every box-shaped daily cargo item is scanned each frame; once one has
 * been within the zone and below the velocity threshold for
 * STABLE_THRESHOLD seconds, its CargoData.organized flips true permanently
 * (stays true even after it's carried away — see cargo-data.ts doc comment).
 */
export class PalletSystem {
  topMesh: THREE.Mesh;

  private cargoSystem: CargoSystem;
  private interactables: Map<string, InteractableObject>;
  private stableTimers: Map<string, number> = new Map();
  private hasFiredUse = false;
  private hasFiredOrganized = false;
  private onFirstUse?: () => void;
  private onFirstOrganized?: () => void;

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, cargoSystem: CargoSystem, interactables: Map<string, InteractableObject>,
    onFirstUse?: () => void, onFirstOrganized?: () => void
  ) {
    this.cargoSystem = cargoSystem;
    this.interactables = interactables;
    this.onFirstUse = onFirstUse;
    this.onFirstOrganized = onFirstOrganized;

    const { posX, posZ, width, depth, height } = PALLET_CONFIG;
    const floorY = BACK_AREA.floorY;
    const centerY = floorY + height / 2;

    const woodMat = new THREE.MeshStandardMaterial({ color: 0xa87a42 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), woodMat);
    mesh.position.set(posX, centerY, posZ);
    scene.add(mesh);
    this.topMesh = mesh;
    mesh.userData.surfaceType = 'pallet-top';

    // A few raised slat lines across the top — purely cosmetic, reads as a
    // pallet rather than a plain crate lid.
    const slatMat = new THREE.MeshStandardMaterial({ color: 0x8a6234 });
    for (let i = -1; i <= 1; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(width * 0.9, 0.02, depth * 0.12), slatMat);
      slat.position.set(posX, centerY + height / 2 + 0.01, posZ + i * depth * 0.3);
      scene.add(slat);
    }

    physics.createStaticCuboid(posX, centerY, posZ, width / 2, height / 2, depth / 2);

    const label = createFloatingLabel('整理托盤', { width: 0.7, bg: 'rgba(30,25,15,0.75)' });
    label.position.set(posX, centerY + 0.9, posZ);
    scene.add(label);
  }

  update(deltaTime: number): void {
    const { posX, posZ, width, depth, height, detectHeight } = PALLET_CONFIG;
    const floorY = BACK_AREA.floorY;
    const topY = floorY + height;
    const innerHW = width / 2;
    const innerHD = depth / 2;

    const idsStillInZone = new Set<string>();

    for (const [id, obj] of this.interactables) {
      if (obj.isHeld || !obj.mesh.visible) continue;
      const data = this.cargoSystem.getCargoData(id);
      if (!data || data.shapeType !== 'box') continue;

      const p = obj.mesh.position;
      const inZone =
        p.x >= posX - innerHW && p.x <= posX + innerHW &&
        p.z >= posZ - innerHD && p.z <= posZ + innerHD &&
        p.y >= topY - 0.05 && p.y <= topY + detectHeight;
      if (!inZone) continue;

      idsStillInZone.add(id);
      if (!this.hasFiredUse) {
        this.hasFiredUse = true;
        this.onFirstUse?.();
      }
      if (data.organized) continue; // already locked in — no need to keep timing it

      let stable = true;
      if (obj.rigidBody) {
        const lv = obj.rigidBody.linvel();
        const av = obj.rigidBody.angvel();
        const speed = Math.sqrt(lv.x ** 2 + lv.y ** 2 + lv.z ** 2);
        const angSpeed = Math.sqrt(av.x ** 2 + av.y ** 2 + av.z ** 2);
        stable = speed < VELOCITY_THRESHOLD && angSpeed < VELOCITY_THRESHOLD;
      }

      const prev = this.stableTimers.get(id) ?? 0;
      const next = stable ? prev + deltaTime : 0;
      this.stableTimers.set(id, next);

      if (next >= STABLE_THRESHOLD) {
        data.organized = true;
        if (!this.hasFiredOrganized) {
          this.hasFiredOrganized = true;
          this.onFirstOrganized?.();
        }
      }
    }

    // Drop stability timers for anything that left the zone this frame.
    for (const id of this.stableTimers.keys()) {
      if (!idsStillInZone.has(id)) this.stableTimers.delete(id);
    }
  }
}
