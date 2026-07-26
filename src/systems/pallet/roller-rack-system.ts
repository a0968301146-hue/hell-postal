import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject } from '../../shared/types/interactable';
import { CargoSystem } from '../cargo';
import { ROLLER_RACK_CONFIG } from '../daily-flow';
import { BACK_AREA } from '../../game/logistics-layout-data';
import { createFloatingLabel } from '../../adapters/three/world-label-system';

const STABLE_THRESHOLD = 0.5; // spec 十五: "至少 0.5 秒"
const VELOCITY_THRESHOLD = 0.4;

/**
 * Wall-mounted roller rack (spec "每日貨品清空核心流程" section 十四/十五) —
 * base platform + divider walls forming shallow U-channels so a roller
 * rolled/dropped roughly nearby settles into a slot under real physics
 * (spec: "不使用隱形完全固定取代物理外型"), not a placement-surface trick
 * like the pallet — a barrel's resting orientation makes precise E-key
 * placement awkward, while a physical channel naturally catches it.
 *
 * organized judgment mirrors PalletSystem: a single combined zone sized to
 * the rack's OWN footprint (spec: "固定架有效範圍必須依實際尺寸計算"),
 * scanning only shapeType==='roller' cargo, box cargo is ignored entirely
 * (spec: "不要讓方形貨品放進滾筒架後被標記為完成整理").
 */
export class RollerRackSystem {
  private cargoSystem: CargoSystem;
  private interactables: Map<string, InteractableObject>;
  private stableTimers: Map<string, number> = new Map();
  private hasFiredOrganized = false;
  private onFirstOrganized?: () => void;

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, cargoSystem: CargoSystem, interactables: Map<string, InteractableObject>,
    onFirstOrganized?: () => void
  ) {
    this.cargoSystem = cargoSystem;
    this.interactables = interactables;
    this.onFirstOrganized = onFirstOrganized;
    this.build(scene, physics);
  }

  private build(scene: THREE.Scene, physics: PhysicsSystem): void {
    const { posX, posZ, width, depth, baseHeight, slotCount } = ROLLER_RACK_CONFIG;
    const floorY = BACK_AREA.floorY;
    const baseCenterY = floorY + baseHeight / 2;

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x707870 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(depth, baseHeight, width), frameMat);
    base.position.set(posX, baseCenterY, posZ);
    scene.add(base);
    physics.createStaticCuboid(posX, baseCenterY, posZ, depth / 2, baseHeight / 2, width / 2);

    // Divider + end walls forming `slotCount` shallow U-channels along Z —
    // low enough (0.28m) to visibly cradle a lying roller without being a
    // tall box that reads as "the roller is sealed inside a crate".
    const wallH = 0.28;
    const wallT = 0.06;
    const wallCenterY = floorY + baseHeight + wallH / 2;
    const slotWidth = width / slotCount;
    for (let i = 0; i <= slotCount; i++) {
      const wz = posZ - width / 2 + i * slotWidth;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(depth, wallH, wallT), frameMat);
      wall.position.set(posX, wallCenterY, wz);
      scene.add(wall);
      physics.createStaticCuboid(posX, wallCenterY, wz, depth / 2, wallH / 2, wallT / 2);
    }
    // Back stop (against the wall side) so a roller can't be pushed straight
    // through the rack's far edge.
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(wallT, wallH, width), frameMat);
    backWall.position.set(posX - depth / 2 + wallT / 2, wallCenterY, posZ);
    scene.add(backWall);
    physics.createStaticCuboid(posX - depth / 2 + wallT / 2, wallCenterY, posZ, wallT / 2, wallH / 2, width / 2);

    const label = createFloatingLabel('滾筒固定架', { width: 0.8, bg: 'rgba(20,30,30,0.75)' });
    label.position.set(posX, floorY + 1.1, posZ);
    scene.add(label);
  }

  update(deltaTime: number): void {
    const { posX, posZ, width, depth, baseHeight, detectHeight } = ROLLER_RACK_CONFIG;
    const floorY = BACK_AREA.floorY;
    const topY = floorY + baseHeight;
    const innerHX = depth / 2 + 0.1;
    const innerHZ = width / 2 + 0.05;

    const idsStillInZone = new Set<string>();

    for (const [id, obj] of this.interactables) {
      if (obj.isHeld || !obj.mesh.visible) continue;
      const data = this.cargoSystem.getCargoData(id);
      if (!data || data.shapeType !== 'roller') continue;

      const p = obj.mesh.position;
      const inZone =
        p.x >= posX - innerHX && p.x <= posX + innerHX &&
        p.z >= posZ - innerHZ && p.z <= posZ + innerHZ &&
        p.y >= topY - 0.05 && p.y <= topY + detectHeight;
      if (!inZone) continue;

      idsStillInZone.add(id);
      if (data.organized) continue;

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

    for (const id of this.stableTimers.keys()) {
      if (!idsStillInZone.has(id)) this.stableTimers.delete(id);
    }
  }
}
