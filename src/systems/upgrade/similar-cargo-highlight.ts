import * as THREE from 'three';
import { CargoData, CargoSystem } from '../cargo';

const SEARCH_RADIUS = 12;
const HIGHLIGHT_DURATION = 2.5;

interface ActiveMarker {
  mesh: THREE.Mesh;
  expiresAt: number;
}

/**
 * "同類感知" upgrade's own visual — driven by whatever CargoData game-app.ts
 * passes in as `currentCargo` each frame. "Revise score upgrades and fix
 * frog walkable colliders" round: that source switched from
 * CargoInspectionSystem's crosshair raycast target to the player's
 * CURRENTLY HELD item (spec二D: "手持一件貨物時啟用，不再要求準心先對準貨
 * 物") — this class itself is unchanged, still no raycast/scan of its own.
 * Ground-marker rings only (spec: "簡單outline/glow/ground marker即可，不
 * 要使用昂貴的粒子系統，不需要複雜動畫") — added directly to the main world
 * scene and cleared after ~2.5s or the instant the held item changes. Only
 * ever matches other CargoSystem entries (same category + region) —
 * envelopes/lost items/mail bags/vehicles live in entirely separate
 * registries this class never reads, so they can never be highlighted by
 * construction, not by an extra filter check.
 */
export class SimilarCargoHighlight {
  private scene: THREE.Scene;
  private markers: ActiveMarker[] = [];
  private lastTargetId: string | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  update(unlocked: boolean, currentCargo: CargoData | null, cargoSystem: CargoSystem): void {
    const now = performance.now() / 1000;

    if (!unlocked || !currentCargo || !currentCargo.category || !currentCargo.region) {
      if (this.lastTargetId !== null) {
        this.clearAll();
        this.lastTargetId = null;
      }
      return;
    }

    if (currentCargo.id !== this.lastTargetId) {
      this.lastTargetId = currentCargo.id;
      this.clearAll();
      this.spawnMarkersFor(currentCargo, cargoSystem, now);
    }

    this.expireOld(now);
  }

  private spawnMarkersFor(target: CargoData, cargoSystem: CargoSystem, now: number): void {
    const targetObj = cargoSystem.getInteractable(target.id);
    if (!targetObj) return;
    const originPos = targetObj.mesh.position;

    for (const [id, data] of cargoSystem.cargoDataMap) {
      if (id === target.id) continue;
      if (data.category !== target.category || data.region !== target.region) continue;
      const obj = cargoSystem.getInteractable(id);
      if (!obj || !obj.mesh.visible || obj.isHeld) continue;
      if (obj.mesh.position.distanceTo(originPos) > SEARCH_RADIUS) continue;
      this.spawnMarker(obj.mesh.position, obj.height, now);
    }
  }

  private spawnMarker(pos: THREE.Vector3, height: number, now: number): void {
    const geo = new THREE.RingGeometry(0.26, 0.34, 24);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4ad8ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, pos.y - height / 2 + 0.03, pos.z);
    this.scene.add(ring);
    this.markers.push({ mesh: ring, expiresAt: now + HIGHLIGHT_DURATION });
  }

  private expireOld(now: number): void {
    this.markers = this.markers.filter((m) => {
      if (now < m.expiresAt) return true;
      this.disposeMarker(m);
      return false;
    });
  }

  private clearAll(): void {
    for (const m of this.markers) this.disposeMarker(m);
    this.markers = [];
  }

  private disposeMarker(m: ActiveMarker): void {
    this.scene.remove(m.mesh);
    m.mesh.geometry.dispose();
    (m.mesh.material as THREE.Material).dispose();
  }
}
