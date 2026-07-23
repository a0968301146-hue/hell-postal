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
import { DailyFlowSystem } from './daily-flow-system';
import { PALLET_ID } from './pallet-system';

/** Per-vehicle lifecycle. 'departed' is a terminal holding state — the
 * vehicle mesh/body is already gone, but the route stays 'departed' (not
 * reset to 'absent') until BOTH routes have departed and the day-complete
 * summary has been shown and the player presses 繼續 — see
 * checkBothDeparted(). */
export type SingleVehicleState = 'absent' | 'arriving' | 'docked' | 'departing' | 'departed';
type RouteVehicleType = 'land' | 'sea';
type ButtonId = 'call' | 'depart';

const CALL_IDLE_TEXT = '呼叫載具\n按 E 同時呼叫陸運與海運';
const DEPART_IDLE_TEXT = '載具出發\n按 E 讓兩台載具一起離場';
const DEPART_BLOCKED_TEXT = '載具尚未全部停靠';
const NOT_UNLOADED_TEXT = '請先接收今日貨物';
const ALREADY_HAVE_TEXT = '目前已有載具';

/** Cargo must sit stable inside a docked vehicle's cargoBounds for this long
 * before it counts as shipped — no organized/pallet/rack prerequisite (see
 * scanCargoForShipment's doc comment). */
const SHIP_STABLE_THRESHOLD = 0.5;
const SHIP_VELOCITY_THRESHOLD = 0.4;

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

  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private cargoSystem: CargoSystem;
  private pickupSystem: PickupSystem;
  private hud: HUD;
  private dailyFlowSystem: DailyFlowSystem;
  private onPauseChange: (paused: boolean) => void;
  private onVehicleDiscovered?: (config: VehicleConfig) => void;
  private onVehicleCalled?: () => void;
  private onCargoLoaded?: () => void;
  private onVehicleDeparted?: () => void;
  private enabled = true;

  private landVehicle: VehicleSystem | null = null;
  private seaVehicle: VehicleSystem | null = null;
  private landPinnedCargo: InteractableObject[] = [];
  private seaPinnedCargo: InteractableObject[] = [];
  private dayCompleteShown = false;

  /** Per-item stability timers for the shipment scan ("至少 0.5 秒") —
   * separate from PalletSystem/RollerRackSystem's own timers (different
   * map, different fixture). */
  private shipStableTimers: Map<string, number> = new Map();

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
    dailyFlowSystem: DailyFlowSystem,
    onPauseChange: (paused: boolean) => void,
    onVehicleDiscovered?: (config: VehicleConfig) => void,
    onVehicleCalled?: () => void,
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
    this.dailyFlowSystem = dailyFlowSystem;
    this.onPauseChange = onPauseChange;
    this.onVehicleDiscovered = onVehicleDiscovered;
    this.onVehicleCalled = onVehicleCalled;
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
    return this.dayCompleteShown;
  }

  /** Allowed only once today's cargo has actually been unloaded (spec
   * section 七: sorting/loading), and only while no vehicle already exists
   * for this route pair. */
  get canCall(): boolean {
    const flowState = this.dailyFlowSystem.state;
    const flowAllows = flowState === 'sorting' || flowState === 'loading';
    return flowAllows && this.landState === 'absent' && this.seaState === 'absent';
  }

  /** Allowed only once BOTH routes are docked AND every daily cargo item
   * has been shipped (spec section 十四) — dailyFlowSystem.state only
   * reaches 'completed' once refreshCompletion() confirms 100% shipped, so
   * checking it here covers conditions 2/3/5 from the spec in one read. */
  get canDepart(): boolean {
    return this.landState === 'docked' && this.seaState === 'docked' && this.dailyFlowSystem.state === 'completed';
  }

  callBlockedMessage(): string {
    const flowState = this.dailyFlowSystem.state;
    if (flowState === 'ready' || flowState === 'unloading') return NOT_UNLOADED_TEXT;
    if (this.landState !== 'absent' || this.seaState !== 'absent') {
      const anyMoving = this.landState === 'arriving' || this.landState === 'departing'
        || this.seaState === 'arriving' || this.seaState === 'departing';
      return anyMoving ? '載具正在移動' : ALREADY_HAVE_TEXT;
    }
    return ALREADY_HAVE_TEXT;
  }

  departBlockedMessage(): string {
    if (this.landState !== 'docked' || this.seaState !== 'docked') return DEPART_BLOCKED_TEXT;
    const remaining = this.dailyFlowSystem.remainingCargoCount;
    if (remaining > 0) return `還有 ${remaining} 件今日貨物尚未裝載`;
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
    this.onVehicleCalled?.();
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

  /** 載具出發 — only proceeds once canDepart is true (both docked, every
   * daily cargo item shipped — see canDepart's doc comment). Pinned lists
   * come straight from each item's already-known shippedVehicleType (set by
   * the per-frame shipment scan below) rather than re-scanning cargoBounds
   * here, since by now every daily cargo item is guaranteed shipped=true
   * under exactly one route. */
  pressDepartButton(): void {
    if (!this.canDepart || !this.landVehicle || !this.seaVehicle) {
      this.flash(this.departLabel, this.departBlockedMessage(), DEPART_IDLE_TEXT);
      return;
    }

    const landValid: InteractableObject[] = [];
    const seaValid: InteractableObject[] = [];
    for (const id of this.dailyFlowSystem.dailyCargoIds) {
      const data = this.cargoSystem.getCargoData(id);
      const obj = this.interactables.get(id);
      if (!data || !obj || !data.shipped) continue; // defensive — canDepart already guarantees this
      (data.shippedVehicleType === 'sea' ? seaValid : landValid).push(obj);
    }

    // The sorting pallet itself is never in dailyCargoIds (spec 十七: "托盤
    // 本身不計入dailyCargoIds") so it needs its own bay-membership check —
    // if it's still sitting inside a docked vehicle's cargo bay at
    // departure time, it rides along the SAME way as any other pinned cargo
    // (vehicle.moveToward() below just translates every entry in the list
    // by the same per-frame delta, so the pallet and whatever cargo is
    // still resting on it stay visually together with zero extra code).
    const palletObj = this.interactables.get(PALLET_ID);
    if (palletObj && palletObj.mesh.visible && !palletObj.isHeld) {
      if (this.landVehicle.isInCargoBay(palletObj.mesh.position)) landValid.push(palletObj);
      else if (this.seaVehicle.isInCargoBay(palletObj.mesh.position)) seaValid.push(palletObj);
    }

    this.landPinnedCargo = landValid;
    this.seaPinnedCargo = seaValid;
    this.pinCargoPhysics(landValid);
    this.pinCargoPhysics(seaValid);
    this.landState = 'departing';
    this.seaState = 'departing';
    this.dailyFlowSystem.notifyDeparting();

    this.onVehicleDeparted?.();
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
    this.scanCargoForShipment(deltaTime);
  }

  private updateRoute(type: RouteVehicleType, deltaTime: number): void {
    const vehicle = type === 'land' ? this.landVehicle : this.seaVehicle;
    if (!vehicle) return;
    const state = type === 'land' ? this.landState : this.seaState;

    if (state === 'arriving') {
      const arrived = vehicle.moveToward(vehicle.config.dockPosition, deltaTime, []);
      if (arrived) {
        if (type === 'land') this.landState = 'docked'; else this.seaState = 'docked';
        // Player can start loading into whichever vehicle just arrived,
        // without waiting for the other route (spec section 六/七).
        this.dailyFlowSystem.notifyVehicleDocked();
      }
      return;
    }

    if (state === 'departing') {
      const pinned = type === 'land' ? this.landPinnedCargo : this.seaPinnedCargo;
      const arrived = vehicle.moveToward(vehicle.config.exitPosition, deltaTime, pinned);
      if (arrived) this.finishOneDeparture(type);
    }
  }

  /** Continuously scans every daily cargo item against whichever vehicles
   * are currently 'docked' — any cargo that sits stable inside a cargoBounds
   * for SHIP_STABLE_THRESHOLD seconds gets marked shipped ("Fix vehicle
   * cargo loading and departure gate" round: loading no longer requires
   * organized=true, or ever having touched the pallet/roller rack — being
   * inside a docked vehicle's cargo bay and settling for 0.5s is the whole
   * rule). Anything previously shipped that leaves the bounds (or gets
   * picked back up) immediately un-ships (spec: "貨物在發車前被拿出
   * cargoBounds，要取消 loaded/shipped 並更新數量") — no debounce needed on
   * that direction since it only happens from a deliberate player action,
   * not physics jitter. */
  private scanCargoForShipment(deltaTime: number): void {
    const land = this.landState === 'docked' ? this.landVehicle : null;
    const sea = this.seaState === 'docked' ? this.seaVehicle : null;
    if (!land && !sea) return;

    let anyChanged = false;

    for (const id of this.dailyFlowSystem.dailyCargoIds) {
      const obj = this.interactables.get(id);
      const data = this.cargoSystem.getCargoData(id);
      if (!obj || !data) continue;

      if (obj.isHeld || !obj.mesh.visible) {
        this.shipStableTimers.delete(id);
        if (data.shipped) { data.shipped = false; data.shippedVehicleType = null; anyChanged = true; }
        continue;
      }

      const inLand = land ? land.isInCargoBay(obj.mesh.position) : false;
      const inSea = sea ? sea.isInCargoBay(obj.mesh.position) : false;
      let targetType: RouteVehicleType | null = null;
      if (inLand && inSea) {
        const dLand = this.distanceXZ(obj.mesh.position, land!.position);
        const dSea = this.distanceXZ(obj.mesh.position, sea!.position);
        targetType = dLand <= dSea ? 'land' : 'sea';
      } else if (inLand) targetType = 'land';
      else if (inSea) targetType = 'sea';

      if (!targetType) {
        this.shipStableTimers.delete(id);
        if (data.shipped) { data.shipped = false; data.shippedVehicleType = null; anyChanged = true; }
        continue;
      }

      if (data.shipped) {
        if (data.shippedVehicleType !== targetType) data.shippedVehicleType = targetType;
        continue;
      }

      let stable = true;
      if (obj.rigidBody) {
        const lv = obj.rigidBody.linvel();
        const av = obj.rigidBody.angvel();
        const speed = Math.sqrt(lv.x ** 2 + lv.y ** 2 + lv.z ** 2);
        const angSpeed = Math.sqrt(av.x ** 2 + av.y ** 2 + av.z ** 2);
        stable = speed < SHIP_VELOCITY_THRESHOLD && angSpeed < SHIP_VELOCITY_THRESHOLD;
      }
      const prev = this.shipStableTimers.get(id) ?? 0;
      const next = stable ? prev + deltaTime : 0;
      this.shipStableTimers.set(id, next);

      if (next >= SHIP_STABLE_THRESHOLD) {
        data.shipped = true;
        data.shippedVehicleType = targetType;
        this.shipStableTimers.delete(id);
        anyChanged = true;
        this.onCargoLoaded?.();
      }
    }

    if (anyChanged) this.dailyFlowSystem.refreshCompletion();
  }

  /** Destroys each pinned item's mesh/collider/CargoData entirely — only
   * once the vehicle carrying it has actually left the scene (spec section
   * 十: "載具離開場景後,才正式銷毀"), never at load time or button-press
   * time. Reuses CargoSystem's own removeCargo (spec: "不要另寫第二套互相
   * 衝突的附著系統"). */
  private finishOneDeparture(type: RouteVehicleType): void {
    const vehicle = type === 'land' ? this.landVehicle : this.seaVehicle;
    const pinned = type === 'land' ? this.landPinnedCargo : this.seaPinnedCargo;
    if (!vehicle) return;

    for (const obj of pinned) {
      // The pallet itself is never destroyed like shipped cargo is (spec
      // 十七: "不要讓托盤被永久銷毀") — it just leaves the play space along
      // with the vehicle for the rest of today; PalletSystem.resetToStart()
      // (called from DailyFlowSystem's daily reset) makes it visible again
      // at its home position next day.
      if (obj.id === PALLET_ID) { obj.mesh.visible = false; continue; }
      this.cargoSystem.removeCargo(obj.id);
    }
    this.pickupSystem.removePlacementSurface(vehicle.cargoBedTopMesh);
    vehicle.dispose();

    if (type === 'land') {
      this.landVehicle = null;
      this.landPinnedCargo = [];
      this.landState = 'departed';
    } else {
      this.seaVehicle = null;
      this.seaPinnedCargo = [];
      this.seaState = 'departed';
    }

    this.checkBothDeparted();
  }

  /** Only fires once both routes have independently finished departing —
   * `dayCompleteShown` guards against either route's transition re-firing
   * this after the panel is already up (both stay 'departed' the whole
   * time the panel is open, since they only reset to 'absent' on 繼續). */
  private checkBothDeparted(): void {
    if (this.landState === 'departed' && this.seaState === 'departed' && !this.dayCompleteShown) {
      this.dayCompleteShown = true;
      this.showDayCompleteSummary();
    }
  }

  /** Simplified completion screen (this round drops the old score/
   * correct-vs-incompatible breakdown entirely — spec section 十六: no more
   * 正確受理/不相容貨物/國內海外判定/加分扣分). By the time both vehicles
   * have departed, every daily cargo item has already been destroyed
   * (finishOneDeparture above), so the three counts are all just
   * totalCargoCount — canDepart already guaranteed 100% organized+shipped
   * before departure could begin. */
  private showDayCompleteSummary(): void {
    const total = this.dailyFlowSystem.totalCargoCount;

    this.dailyFlowSystem.notifyDayComplete();
    this.onPauseChange(true);
    this.hud.showDayCompleteSummary({
      total, organized: total, loaded: total,
      onContinue: () => {
        this.landState = 'absent';
        this.seaState = 'absent';
        this.dayCompleteShown = false;
        this.onPauseChange(false);
      },
    });
  }
}
