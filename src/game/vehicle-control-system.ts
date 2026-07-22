import * as THREE from 'three';
import { PhysicsSystem } from './physics-system';
import { InteractableObject } from './interactable-object';
import { CargoSystem } from './cargo-system';
import { PickupSystem } from './pickup-system';
import { VehicleSystem } from './vehicle-system';
import { LAND_VEHICLE_CONFIGS, SEA_VEHICLE_CONFIGS, VehicleConfig } from './vehicle-data';
import { VEHICLE_CONTROL_POS, BACK_AREA } from './logistics-layout-data';
import { SCENE_CONFIG } from './scene-manager';
import { createFloatingLabel, updateFloatingLabel } from './world-label-system';
import { HUD } from './hud';

// PROTOTYPE-ONLY scoring constant — not a final design spec.
export const POINTS_PER_CARGO = 1;

export type VehicleFlowState = 'absent' | 'arriving' | 'docked' | 'departing' | 'settlement';
type CallButtonType = 'land' | 'sea';
type ButtonId = CallButtonType | 'depart';

const LAND_IDLE_TEXT = '呼叫陸運\n按 E 呼叫陸運載具';
const SEA_IDLE_TEXT = '呼叫海運\n按 E 呼叫海運載具';
const DEPART_IDLE_TEXT = '載具出發\n按 E 讓載具離場';

/**
 * One shared state machine drives BOTH routes — land and sea are just two
 * different VehicleConfig lists fed into the same absent→arriving→docked→
 * departing→settlement flow (see VehicleFlowState). Exactly one `vehicle`
 * field exists, so at most one vehicle (of either type) can ever be in the
 * scene at once; both call buttons are gated by the same `state !== 'absent'`
 * check, which is what prevents spawning land+sea simultaneously or
 * double-spawning on a fast double-press (the very first press already
 * flips state away from 'absent' before any second press can be handled).
 */
export class VehicleControlSystem {
  state: VehicleFlowState = 'absent';
  totalScore = 0;

  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private cargoSystem: CargoSystem;
  private pickupSystem: PickupSystem;
  private hud: HUD;
  private onPauseChange: (paused: boolean) => void;

  private vehicle: VehicleSystem | null = null;
  private pinnedCargo: InteractableObject[] = [];
  /** Round-robin indices — land and sea each cycle through their OWN config
   * list independently (spec section 七之7), so calling sea vehicles never
   * advances the land index or vice versa. */
  private nextLandConfigIndex = 0;
  private nextSeaConfigIndex = 0;

  private landButtonPos: THREE.Vector3;
  private seaButtonPos: THREE.Vector3;
  private departButtonPos: THREE.Vector3;
  private landLabel!: THREE.Sprite;
  private seaLabel!: THREE.Sprite;
  private departLabel!: THREE.Sprite;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsSystem,
    interactables: Map<string, InteractableObject>,
    cargoSystem: CargoSystem,
    pickupSystem: PickupSystem,
    hud: HUD,
    onPauseChange: (paused: boolean) => void
  ) {
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;
    this.cargoSystem = cargoSystem;
    this.pickupSystem = pickupSystem;
    this.hud = hud;
    this.onPauseChange = onPauseChange;

    const { centerX, centerZ, spacing } = VEHICLE_CONTROL_POS;
    this.landButtonPos = new THREE.Vector3(centerX - spacing, 0, centerZ);
    this.seaButtonPos = new THREE.Vector3(centerX, 0, centerZ);
    this.departButtonPos = new THREE.Vector3(centerX + spacing, 0, centerZ);
    this.buildButtons();
  }

  private buildButtons(): void {
    this.landLabel = this.buildOneButton(this.landButtonPos, 0x2b6bd8, LAND_IDLE_TEXT);
    this.seaLabel = this.buildOneButton(this.seaButtonPos, 0x2bb8d8, SEA_IDLE_TEXT);
    this.departLabel = this.buildOneButton(this.departButtonPos, 0xd88a2b, DEPART_IDLE_TEXT);
  }

  private buildOneButton(pos: THREE.Vector3, color: number, labelText: string): THREE.Sprite {
    // Post/cap/collider/label are all built relative to the back area's
    // actual floor height, not world Y=0 — the button sits in the back area
    // (floorY = -1.5), so anchoring to 0 left it floating mid-air.
    const floorY = BACK_AREA.floorY;
    const postHeight = 0.9;
    const postGeo = new THREE.BoxGeometry(0.22, postHeight, 0.22);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(pos.x, floorY + postHeight / 2, pos.z);
    this.scene.add(post);

    const capGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.07, 12);
    const capMat = new THREE.MeshStandardMaterial({ color });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.set(pos.x, floorY + postHeight + 0.02, pos.z);
    this.scene.add(cap);

    this.physics.createStaticCuboid(pos.x, floorY + postHeight / 2, pos.z, 0.11, postHeight / 2, 0.11);

    const label = createFloatingLabel(labelText, { width: 1.0, bg: 'rgba(20,25,45,0.75)' });
    label.position.set(pos.x, floorY + postHeight + 0.5, pos.z);
    this.scene.add(label);
    return label;
  }

  private distanceXZ(pos: THREE.Vector3, target: THREE.Vector3): number {
    const dx = pos.x - target.x;
    const dz = pos.z - target.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** The three buttons sit close enough together that their proximity radii
   * overlap — resolve which one the player is actually next to (the nearest
   * one) so E/prompt handling never has to guess between them. */
  getNearestButton(pos: THREE.Vector3): ButtonId | null {
    const distances: Record<ButtonId, number> = {
      land: this.distanceXZ(pos, this.landButtonPos),
      sea: this.distanceXZ(pos, this.seaButtonPos),
      depart: this.distanceXZ(pos, this.departButtonPos),
    };
    const range = SCENE_CONFIG.interactionDistance + 1;
    let best: ButtonId | null = null;
    let bestDist = Infinity;
    for (const key of Object.keys(distances) as ButtonId[]) {
      const d = distances[key];
      if (d <= range && d < bestDist) { bestDist = d; best = key; }
    }
    return best;
  }

  get isPaused(): boolean {
    return this.state === 'settlement';
  }

  private flash(label: THREE.Sprite, text: string, revertTo: string): void {
    updateFloatingLabel(label, text);
    setTimeout(() => updateFloatingLabel(label, revertTo), 1500);
  }

  /** Blocked-state message for the two CALL buttons (land/sea) — shown
   * whenever state !== 'absent', i.e. some vehicle already occupies the
   * scene in some phase of its own flow. Public: also used by
   * InteractionSystem's proximity prompt (not just the flash-on-press). */
  blockedCallMessage(): string {
    switch (this.state) {
      case 'docked': return '目前已有載具';
      case 'arriving': case 'departing': return '載具正在移動';
      case 'settlement': return '結算尚未完成';
      default: return '';
    }
  }

  /** Blocked-state message for the DEPART button — shown whenever
   * state !== 'docked'. Public for the same reason as blockedCallMessage. */
  blockedDepartMessage(): string {
    switch (this.state) {
      case 'absent': return '目前沒有載具';
      case 'arriving': case 'departing': return '載具正在移動';
      case 'settlement': return '結算尚未完成';
      default: return '';
    }
  }

  /** 呼叫陸運 / 呼叫海運 — same absent-only gate for both, so the two
   * routes can never spawn simultaneously and a vehicle already in any
   * other phase (arriving/docked/departing/settlement) blocks new calls of
   * either type, not just its own. */
  pressCallButton(type: CallButtonType): void {
    const label = type === 'land' ? this.landLabel : this.seaLabel;
    const idleText = type === 'land' ? LAND_IDLE_TEXT : SEA_IDLE_TEXT;
    if (this.state !== 'absent') {
      this.flash(label, this.blockedCallMessage(), idleText);
      return;
    }
    const configs: VehicleConfig[] = type === 'land' ? LAND_VEHICLE_CONFIGS : SEA_VEHICLE_CONFIGS;
    const index = type === 'land' ? this.nextLandConfigIndex : this.nextSeaConfigIndex;
    const config = configs[index];
    if (type === 'land') this.nextLandConfigIndex = (index + 1) % configs.length;
    else this.nextSeaConfigIndex = (index + 1) % configs.length;

    this.vehicle = new VehicleSystem(this.scene, this.physics, config, config.spawnPosition);
    this.pickupSystem.addPlacementSurface(this.vehicle.cargoBedTopMesh);
    this.state = 'arriving';
  }

  pressDepartButton(): void {
    if (this.state !== 'docked' || !this.vehicle) {
      this.flash(this.departLabel, this.blockedDepartMessage(), DEPART_IDLE_TEXT);
      return;
    }

    const vehicle = this.vehicle;
    const valid: InteractableObject[] = [];
    for (const obj of this.interactables.values()) {
      if (!this.cargoSystem.getCargoData(obj.id)) continue;
      if (obj.isHeld) continue;
      if (!vehicle.isInCargoBay(obj.mesh.position)) continue;
      valid.push(obj);
    }

    this.pinnedCargo = valid;
    for (const obj of valid) {
      obj.canPickUp = false;
      if (obj.rigidBody) {
        obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.physics.setBodyEnabled(obj.rigidBody, false);
      }
    }

    this.state = 'departing';
  }

  update(deltaTime: number): void {
    if (this.state === 'arriving' && this.vehicle) {
      // Use the spawned vehicle's OWN config, not a fixed constant — each
      // cycled-through vehicle can have its own dock/exit position.
      const arrived = this.vehicle.moveToward(this.vehicle.config.dockPosition, deltaTime, []);
      if (arrived) this.state = 'docked';
      return;
    }

    if (this.state === 'departing' && this.vehicle) {
      const arrived = this.vehicle.moveToward(this.vehicle.config.exitPosition, deltaTime, this.pinnedCargo);
      if (arrived) this.finishDeparture();
      return;
    }
  }

  private finishDeparture(): void {
    if (!this.vehicle) return;
    let normalCount = 0;
    let largeCount = 0;
    for (const obj of this.pinnedCargo) {
      if (this.cargoSystem.getCargoData(obj.id)?.cargoType === 'large') largeCount++;
      else normalCount++;
    }
    const count = this.pinnedCargo.length;
    const runScore = count * POINTS_PER_CARGO;
    this.totalScore += runScore;
    const vehicleName = this.vehicle.config.displayName;
    const transportType = this.vehicle.config.vehicleType === 'sea' ? '海運' : '陸運';

    for (const obj of this.pinnedCargo) {
      obj.mesh.visible = false;
      this.interactables.delete(obj.id);
    }
    this.pickupSystem.removePlacementSurface(this.vehicle.cargoBedTopMesh);
    this.vehicle.dispose();
    this.vehicle = null;
    this.pinnedCargo = [];

    this.state = 'settlement';
    this.onPauseChange(true);
    this.hud.showVehicleSettlement({
      vehicleName, transportType, normalCount, largeCount, runScore,
      totalScore: this.totalScore,
      onContinue: () => {
        this.state = 'absent';
        this.onPauseChange(false);
      },
    });
  }
}
