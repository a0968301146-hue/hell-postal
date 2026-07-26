import * as THREE from 'three';
import { InteractableObject } from '../shared/types/interactable';
import { CargoSystem } from './cargo-system';
import { DailyFlowSystem } from './daily-flow-system';
import { HUD } from './hud';
import { OUTBOUND_ZONE } from './daily-flow-data';
import { BACK_AREA } from './logistics-layout-data';
import { createFloatingLabel } from '../adapters/three/world-label-system';

const ZONE_MIN_Y = BACK_AREA.floorY - 0.1;
const ZONE_MAX_Y = BACK_AREA.floorY + 2.5;

/**
 * East-side outbound zone (spec "每日貨品清空核心流程" section 十六/十七).
 * Scans ONLY DailyFlowSystem.dailyCargoIds each frame — never the full
 * interactables map — which by construction excludes the pallet, dolly,
 * player, envelopes, old packages, the roller rack and every other scene
 * fixture (spec 十七: "只接受本日 dailyCargoIds 中的貨品") without needing
 * an explicit exclusion list. Once an id is marked completed it's deleted
 * from dailyCargoIds by DailyFlowSystem.markCompleted itself, so it can
 * never be found/re-processed on a later frame — that's what prevents
 * double-counting/double-removal, not a separate "already shipped" flag.
 */
export class OutboundZoneSystem {
  private interactables: Map<string, InteractableObject>;
  private cargoSystem: CargoSystem;
  private dailyFlowSystem: DailyFlowSystem;
  private hud: HUD;
  private onFirstShipped?: () => void;
  /** Ids we've already shown the "尚未完成整理" warning for, so it fires
   * once per zone-visit rather than every single frame the item sits there. */
  private warnedIds: Set<string> = new Set();
  private hasShipped = false;

  constructor(
    scene: THREE.Scene, interactables: Map<string, InteractableObject>, cargoSystem: CargoSystem,
    dailyFlowSystem: DailyFlowSystem, hud: HUD, onFirstShipped?: () => void
  ) {
    this.interactables = interactables;
    this.cargoSystem = cargoSystem;
    this.dailyFlowSystem = dailyFlowSystem;
    this.hud = hud;
    this.onFirstShipped = onFirstShipped;
    this.build(scene);
  }

  private build(scene: THREE.Scene): void {
    const { minX, maxX, minZ, maxZ } = OUTBOUND_ZONE;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const width = maxX - minX;
    const depth = maxZ - minZ;

    const geo = new THREE.PlaneGeometry(width, depth);
    const mat = new THREE.MeshBasicMaterial({ color: 0x3aa8d8, transparent: true, opacity: 0.3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(cx, BACK_AREA.floorY + 0.01, cz);
    scene.add(mesh);

    // Border outline — four thin strips just above the fill, makes the zone
    // read clearly as "a marked area", not just a tinted patch.
    const borderMat = new THREE.MeshBasicMaterial({ color: 0x8fd8f5 });
    const bt = 0.06;
    const mkBorder = (bw: number, bd: number, bx: number, bz: number) => {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(bw, bd), borderMat);
      b.rotation.x = -Math.PI / 2;
      b.position.set(bx, BACK_AREA.floorY + 0.015, bz);
      scene.add(b);
    };
    mkBorder(width, bt, cx, minZ);
    mkBorder(width, bt, cx, maxZ);
    mkBorder(bt, depth, minX, cz);
    mkBorder(bt, depth, maxX, cz);

    const label = createFloatingLabel('出貨區', { width: 0.9, bg: 'rgba(15,40,50,0.75)' });
    label.position.set(cx, BACK_AREA.floorY + 1.5, cz);
    scene.add(label);
  }

  update(_deltaTime: number): void {
    const { minX, maxX, minZ, maxZ } = OUTBOUND_ZONE;

    for (const id of Array.from(this.dailyFlowSystem.dailyCargoIds)) {
      const obj = this.interactables.get(id);
      if (!obj || obj.isHeld || !obj.mesh.visible) continue;

      const p = obj.mesh.position;
      const inZone = p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ && p.y >= ZONE_MIN_Y && p.y <= ZONE_MAX_Y;
      if (!inZone) {
        this.warnedIds.delete(id);
        continue;
      }

      const data = this.cargoSystem.getCargoData(id);
      if (!data || !data.organized) {
        if (!this.warnedIds.has(id)) {
          this.warnedIds.add(id);
          this.hud.showToast('這件貨品尚未完成整理');
        }
        continue;
      }

      this.hud.showToast('貨品已送達出貨區');
      const wasFirst = !this.hasShipped;
      this.hasShipped = true;
      // NOT the main flow's completion path this round (see DailyFlowSystem
      // — cargo ships by riding a vehicle now, not a ground zone), kept only
      // so this file still compiles/works standalone if reused later.
      data.shipped = true;
      this.dailyFlowSystem.refreshCompletion();
      this.cargoSystem.removeCargo(id);
      this.warnedIds.delete(id);
      if (wasFirst) this.onFirstShipped?.();
    }
  }
}
