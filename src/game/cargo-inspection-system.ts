import * as THREE from 'three';
import { CargoSystem } from './cargo-system';
import { CargoData } from './cargo-data';
import { PauseManager } from '../core/pause-manager';

/** Max distance (meters) the crosshair ray will report a cargo target at —
 * spec: "距離超過約4公尺" hides the UI. */
const MAX_INSPECT_DISTANCE = 4;

/**
 * Owns ONLY the crosshair raycast + distance/occlusion/pause judgment for
 * "貨物種類準心檢視 UI" — decides WHICH cargo (if any) the player is
 * currently aiming at, exposed as `currentCargo`. Does not touch the DOM
 * (see cargo-inspection-ui.ts) and does not touch pickup/interaction state
 * (see interaction-system.ts) — this is a read-only observer, entirely
 * independent of both.
 *
 * Raycasts against the FULL world scene graph (not a curated interactable
 * list) so a wall or any other solid geometry between the camera and a
 * cargo item naturally produces a closer, non-cargo hit first — exactly
 * the "被牆或其他實體遮擋" requirement, for free, via normal raycast depth
 * ordering, with no separate occlusion pass needed.
 */
export class CargoInspectionSystem {
  currentCargo: CargoData | null = null;

  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private cargoSystem: CargoSystem;
  private pauseManager: PauseManager;
  private raycaster = new THREE.Raycaster();

  constructor(camera: THREE.PerspectiveCamera, scene: THREE.Scene, cargoSystem: CargoSystem, pauseManager: PauseManager) {
    this.camera = camera;
    this.scene = scene;
    this.cargoSystem = cargoSystem;
    this.pauseManager = pauseManager;
  }

  update(): void {
    if (this.pauseManager.isPaused) {
      this.currentCargo = null;
      return;
    }

    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    this.raycaster.set(this.camera.position, direction);
    this.raycaster.far = MAX_INSPECT_DISTANCE;

    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    if (hits.length === 0) {
      this.currentCargo = null;
      return;
    }

    // intersectObjects already returns hits sorted nearest-first, and `far`
    // above already excludes anything beyond MAX_INSPECT_DISTANCE — so the
    // first entry is simultaneously "the nearest thing along the ray" and
    // "within range". If that nearest hit isn't cargo (a wall, the pallet,
    // the dolly, ...), resolveCargoFromObject correctly returns null —
    // covering both "對準非貨物物件" and "被牆或其他實體遮擋" in one check.
    this.currentCargo = this.cargoSystem.resolveCargoFromObject(hits[0].object);
  }
}
