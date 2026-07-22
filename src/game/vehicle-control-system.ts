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
import { evaluateCargoOutcome, scoreForOutcome } from './cargo-compliance';

/** Per-vehicle lifecycle. 'departed' is a terminal holding state — the
 * vehicle mesh/body is already gone, but the route stays 'departed' (not
 * reset to 'absent') until the COMBINED settlement (both routes departed)
 * has been shown and the player presses 繼續 — see checkCombinedSettlement. */
export type SingleVehicleState = 'absent' | 'arriving' | 'docked' | 'departing' | 'departed';
type RouteVehicleType = 'land' | 'sea';
type ButtonId = 'call' | 'depart';

/** Per-route departure breakdown (spec section 十二) — no more label
 * correctness this round (every cargo item already spawns correctly
 * labeled — see cargo-data.ts), so every loaded item is simply either
 * successfully receivable by this vehicle or not: correctCount +
 * incompatibleCount always equals loadedCount. */
export interface RouteDepartureResult {
  vehicleName: string;
  loadedCount: number;
  correctCount: number;
  incompatibleCount: number;
  scoreChange: number;
}

const CALL_IDLE_TEXT = '呼叫載具\n按 E 同時呼叫陸運與海運';
const DEPART_IDLE_TEXT = '載具出發\n按 E 讓兩台載具一起離場';
const DEPART_BLOCKED_TEXT = '載具尚未全部停靠';

/**
 * One shared per-route state machine, driven twice (once for 'land', once
 * for 'sea') — see SingleVehicleState. Calling "呼叫載具" spawns BOTH routes
 * at once (each still gated by its own round-robin config index), and both
 * must independently reach 'docked' before "載具出發" will do anything.
 * Departure pins each route's OWN cargo-bay contents (never the other
 * route's — see pressDepartButton's per-object bay-membership resolution)
 * and only shows ONE combined settlement panel once BOTH routes have
 * independently finished departing (checkCombinedSettlement).
 */
export class VehicleControlSystem {
  landState: SingleVehicleState = 'absent';
  seaState: SingleVehicleState = 'absent';
  totalScore = 0;

  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private cargoSystem: CargoSystem;
  private pickupSystem: PickupSystem;
  private hud: HUD;
  private onPauseChange: (paused: boolean) => void;
  private onVehicleDiscovered?: (config: VehicleConfig) => void;
  private onCargoLoaded?: () => void;
  private onVehicleDeparted?: () => void;
  private enabled = true;

  private landVehicle: VehicleSystem | null = null;
  private seaVehicle: VehicleSystem | null = null;
  private landPinnedCargo: InteractableObject[] = [];
  private seaPinnedCargo: InteractableObject[] = [];
  private landResult: RouteDepartureResult | null = null;
  private seaResult: RouteDepartureResult | null = null;
  private settlementActive = false;

  /** Round-robin indices — land and sea each cycle through their OWN config
   * list independently (spec section 十六): calling 呼叫載具 advances BOTH
   * indices together, but each still only steps through its own list. */
  private nextLandConfigIndex = 0;
  private nextSeaConfigIndex = 0;

  private callButtonPos: THREE.Vector3;
  private departButtonPos: THREE.Vector3;
  private callLabel!: THREE.Sprite;
  private departLabel!: THREE.Sprite;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsSystem,
    interactables: Map<string, InteractableObject>,
    cargoSystem: CargoSystem,
    pickupSystem: PickupSystem,
    hud: HUD,
    onPauseChange: (paused: boolean) => void,
    onVehicleDiscovered?: (config: VehicleConfig) => void,
    onCargoLoaded?: () => void,
    onVehicleDeparted?: () => void,
    enabled: boolean = true
  ) {
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;
    this.cargoSystem = cargoSystem;
    this.pickupSystem = pickupSystem;
    this.hud = hud;
    this.onPauseChange = onPauseChange;
    this.onVehicleDiscovered = onVehicleDiscovered;
    this.onCargoLoaded = onCargoLoaded;
    this.onVehicleDeparted = onVehicleDeparted;
    this.enabled = enabled;

    const { centerX, centerZ, spacing } = VEHICLE_CONTROL_POS;
    this.callButtonPos = new THREE.Vector3(centerX - spacing / 2, 0, centerZ);
    this.departButtonPos = new THREE.Vector3(centerX + spacing / 2, 0, centerZ);
    // `enabled` gates the call/depart buttons (and everything behind them)
    // out of the scene this round (spec "每日貨品清空核心流程" section 三 —
    // see feature-flags.ts ENABLE_VEHICLE_LOADING_FLOW). callButtonPos/
    // departButtonPos above are cheap position math, harmless either way;
    // getNearestButton() below is the one place that must actually check
    // `enabled` so a disabled system can't report a button that was never
    // built as "nearby".
    if (!enabled) return;
    this.buildButtons();
  }

  private buildButtons(): void {
    this.callLabel = this.buildOneButton(this.callButtonPos, 0x2b6bd8, CALL_IDLE_TEXT);
    this.departLabel = this.buildOneButton(this.departButtonPos, 0xd88a2b, DEPART_IDLE_TEXT);
  }

  private buildOneButton(pos: THREE.Vector3, color: number, labelText: string): THREE.Sprite {
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

  getNearestButton(pos: THREE.Vector3): ButtonId | null {
    if (!this.enabled) return null;
    const dCall = this.distanceXZ(pos, this.callButtonPos);
    const dDepart = this.distanceXZ(pos, this.departButtonPos);
    const range = SCENE_CONFIG.interactionDistance + 1;
    if (dCall > range && dDepart > range) return null;
    return dCall <= dDepart ? 'call' : 'depart';
  }

  get isPaused(): boolean {
    return this.settlementActive;
  }

  get canCall(): boolean {
    return this.landState === 'absent' && this.seaState === 'absent';
  }

  get canDepart(): boolean {
    return this.landState === 'docked' && this.seaState === 'docked';
  }

  callBlockedMessage(): string {
    if (this.settlementActive) return '結算尚未完成';
    const anyMoving = this.landState === 'arriving' || this.landState === 'departing'
      || this.seaState === 'arriving' || this.seaState === 'departing';
    if (anyMoving) return '載具正在移動';
    return '目前已有載具';
  }

  departBlockedMessage(): string {
    return DEPART_BLOCKED_TEXT;
  }

  private flash(label: THREE.Sprite, text: string, revertTo: string): void {
    updateFloatingLabel(label, text);
    setTimeout(() => updateFloatingLabel(label, revertTo), 1500);
  }

  /** 呼叫載具 — spawns land AND sea simultaneously. Gated on BOTH routes
   * being 'absent', so a fast double-press can't spawn a second pair: the
   * very first press already flips both states away from 'absent' before a
   * second press could be handled. */
  pressCallButton(): void {
    if (!this.canCall) {
      this.flash(this.callLabel, this.callBlockedMessage(), CALL_IDLE_TEXT);
      return;
    }
    this.spawnVehicle('land');
    this.spawnVehicle('sea');
  }

  private spawnVehicle(type: RouteVehicleType): void {
    const configs = type === 'land' ? LAND_VEHICLE_CONFIGS : SEA_VEHICLE_CONFIGS;
    const index = type === 'land' ? this.nextLandConfigIndex : this.nextSeaConfigIndex;
    const config = configs[index];
    if (type === 'land') this.nextLandConfigIndex = (index + 1) % configs.length;
    else this.nextSeaConfigIndex = (index + 1) % configs.length;

    const vehicle = new VehicleSystem(this.scene, this.physics, config, config.spawnPosition);
    this.pickupSystem.addPlacementSurface(vehicle.cargoBedTopMesh);
    if (type === 'land') { this.landVehicle = vehicle; this.landState = 'arriving'; }
    else { this.seaVehicle = vehicle; this.seaState = 'arriving'; }

    this.onVehicleDiscovered?.(config);
  }

  /** 載具出發 — only proceeds once BOTH routes are docked. Each object is
   * assigned to at most one route's pinned-cargo list: normally the two
   * cargoBounds never overlap (land dock and sea docks are far apart), but
   * if one ever did fall inside both, it's assigned to whichever bay center
   * is nearer — a deterministic, explicit tie-break rather than double-
   * counting it or leaving it ambiguous. */
  pressDepartButton(): void {
    if (!this.canDepart || !this.landVehicle || !this.seaVehicle) {
      this.flash(this.departLabel, this.departBlockedMessage(), DEPART_IDLE_TEXT);
      return;
    }

    const land = this.landVehicle;
    const sea = this.seaVehicle;
    const landValid: InteractableObject[] = [];
    const seaValid: InteractableObject[] = [];

    for (const obj of this.interactables.values()) {
      if (!this.cargoSystem.getCargoData(obj.id)) continue;
      if (obj.isHeld) continue;
      const inLand = land.isInCargoBay(obj.mesh.position);
      const inSea = sea.isInCargoBay(obj.mesh.position);
      if (inLand && inSea) {
        const dLand = this.distanceXZ(obj.mesh.position, land.position);
        const dSea = this.distanceXZ(obj.mesh.position, sea.position);
        (dLand <= dSea ? landValid : seaValid).push(obj);
      } else if (inLand) {
        landValid.push(obj);
      } else if (inSea) {
        seaValid.push(obj);
      }
    }

    this.landPinnedCargo = landValid;
    this.seaPinnedCargo = seaValid;
    this.pinCargoPhysics(landValid);
    this.pinCargoPhysics(seaValid);
    this.landState = 'departing';
    this.seaState = 'departing';

    this.onVehicleDeparted?.();
    if (landValid.length + seaValid.length > 0) this.onCargoLoaded?.();
  }

  private pinCargoPhysics(list: InteractableObject[]): void {
    for (const obj of list) {
      obj.canPickUp = false;
      if (obj.rigidBody) {
        obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.physics.setBodyEnabled(obj.rigidBody, false);
      }
    }
  }

  update(deltaTime: number): void {
    this.updateRoute('land', deltaTime);
    this.updateRoute('sea', deltaTime);
  }

  private updateRoute(type: RouteVehicleType, deltaTime: number): void {
    const vehicle = type === 'land' ? this.landVehicle : this.seaVehicle;
    if (!vehicle) return;
    const state = type === 'land' ? this.landState : this.seaState;

    if (state === 'arriving') {
      const arrived = vehicle.moveToward(vehicle.config.dockPosition, deltaTime, []);
      if (arrived) {
        if (type === 'land') this.landState = 'docked'; else this.seaState = 'docked';
      }
      return;
    }

    if (state === 'departing') {
      const pinned = type === 'land' ? this.landPinnedCargo : this.seaPinnedCargo;
      const arrived = vehicle.moveToward(vehicle.config.exitPosition, deltaTime, pinned);
      if (arrived) this.finishOneDeparture(type);
    }
  }

  /** Evaluates each pinned item's outcome ONLY here, at actual departure —
   * never at load time or button-press time (spec 十: "出發前不會顯示錯誤
   * 提示"). An incompatible item still ships; it just contributes -1
   * instead of +1 (spec 十一). */
  private finishOneDeparture(type: RouteVehicleType): void {
    const vehicle = type === 'land' ? this.landVehicle : this.seaVehicle;
    const pinned = type === 'land' ? this.landPinnedCargo : this.seaPinnedCargo;
    if (!vehicle) return;

    let correctCount = 0;
    let incompatibleCount = 0;
    let scoreChange = 0;

    for (const obj of pinned) {
      const cargo = this.cargoSystem.getCargoData(obj.id);
      if (!cargo) continue; // pressDepartButton only pins objects with cargo data
      const outcome = evaluateCargoOutcome(cargo, vehicle.config);
      if (outcome.successful) correctCount++;
      else incompatibleCount++;
      scoreChange += scoreForOutcome(outcome);
    }

    const result: RouteDepartureResult = {
      vehicleName: vehicle.config.displayName,
      loadedCount: pinned.length,
      correctCount, incompatibleCount, scoreChange,
    };

    for (const obj of pinned) {
      obj.mesh.visible = false;
      this.interactables.delete(obj.id);
    }
    this.pickupSystem.removePlacementSurface(vehicle.cargoBedTopMesh);
    vehicle.dispose();

    if (type === 'land') {
      this.landVehicle = null;
      this.landPinnedCargo = [];
      this.landState = 'departed';
      this.landResult = result;
    } else {
      this.seaVehicle = null;
      this.seaPinnedCargo = [];
      this.seaState = 'departed';
      this.seaResult = result;
    }

    this.checkCombinedSettlement();
  }

  /** Only fires once both routes have independently finished departing —
   * `settlementActive` guards against either route's transition re-firing
   * this after the panel is already up (both will be 'departed' the whole
   * time the panel is open, since they only reset to 'absent' on 繼續). */
  private checkCombinedSettlement(): void {
    if (this.landState === 'departed' && this.seaState === 'departed' && !this.settlementActive) {
      this.settlementActive = true;
      this.showCombinedSettlement();
    }
  }

  private showCombinedSettlement(): void {
    const land = this.landResult!;
    const sea = this.seaResult!;
    const totalCount = land.loadedCount + sea.loadedCount;
    const totalCorrect = land.correctCount + sea.correctCount;
    const totalScoreChange = land.scoreChange + sea.scoreChange;
    // Cumulative score is a progress threshold, not a spendable currency —
    // never allowed below 0 (spec 十四), and past unlocks never re-lock
    // just because a later run dips the score (nothing in this codebase
    // gates an unlock on the CURRENT score value, only on historical events).
    this.totalScore = Math.max(0, this.totalScore + totalScoreChange);

    this.onPauseChange(true);
    this.hud.showVehicleSettlement({
      land, sea, totalCount, totalCorrect, totalIncorrect: totalCount - totalCorrect,
      totalScoreChange, cumulativeScore: this.totalScore,
      onContinue: () => {
        this.landState = 'absent';
        this.seaState = 'absent';
        this.landResult = null;
        this.seaResult = null;
        this.settlementActive = false;
        this.onPauseChange(false);
      },
    });
  }
}
