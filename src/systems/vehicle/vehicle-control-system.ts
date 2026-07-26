import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject } from '../../shared/types/interactable';
import { CargoSystem, CargoData, CargoType } from '../cargo';
// Deliberately imports pickup-system.ts directly rather than through
// systems/interaction's own index.ts barrel: that barrel also re-exports
// InteractionSystem, which itself imports VehicleControlSystem (to dispatch
// call/depart button presses) — going through the barrel here would create
// a file-level circular import (VehicleControlSystem -> interaction index ->
// InteractionSystem -> VehicleControlSystem). pickup-system.ts itself has no
// dependency back on this file, so importing it directly is cycle-free.
import { PickupSystem } from '../interaction/pickup-system';
import { VehicleSystem } from './vehicle-system';
import { LAND_VEHICLE_CONFIGS, SEA_VEHICLE_CONFIGS, VehicleConfig } from './vehicle-data';
import { VEHICLE_ROUTES } from './vehicle-route-data';
import { VEHICLE_CONTROL_POS, BACK_AREA } from '../world-layout';
import { ScoringSystem, DepartureSettlement } from '../scoring';
import { SCENE_CONFIG } from '../world-layout';
import { createFloatingLabel, updateFloatingLabel } from '../../adapters/three/world-label-system';
import { HUD } from '../hud';
import { DailyFlowSystem } from '../daily-flow';
import { PALLET_ID } from '../pallet';
import { SettingsManager } from '../settings';

/** A daily cargo item's EFFECTIVE cargo kind for vehicle-compatibility
 * purposes ("Add six cargo vehicles" round) — derived from the fields
 * daily-flow cargo actually populates (shapeType/category), never from
 * CargoData.cargoType/routeType (those stay hardcoded 'normal'/'domestic'
 * placeholders for every daily item — see cargo-data.ts
 * createDailyCargoData). "Add dual elevated unloading ports and day-one
 * special cargo" round: cargo-category-data.ts's CargoCategory now also
 * produces 'frozen'/'live' (previously only normal/fragile were possible),
 * so this derivation recognizes them too — otherwise 蝸牛/克拉肯
 * (vehicle-data.ts's frozen/live-only haulers) would stay permanently
 * unroutable even after such cargo starts spawning. VehicleConfig.
 * acceptedCargoTypes itself is untouched — this is only the read-side
 * mapping from a spawned item's own data to a CargoType. */
function effectiveCargoKind(data: CargoData): CargoType {
  if (data.shapeType === 'large') return 'large';
  if (data.category === 'fragile') return 'fragile';
  if (data.category === 'frozen') return 'frozen';
  if (data.category === 'live') return 'live';
  return 'normal';
}

/** Whether `vehicle` is one of the six creature haulers allowed to accept
 * this item — the ONLY "correctly loaded" test (spec: "貨物放入正確載具才算
 * 成功出貨"); physically being inside ANY docked vehicle's cargoBounds is
 * still what flips CargoData.shipped (see scanCargoForShipment) — this is
 * the SEPARATE, stricter check applied only at departure settlement. */
function vehicleAcceptsCargo(config: VehicleConfig, data: CargoData): boolean {
  return config.acceptedCargoTypes.includes(effectiveCargoKind(data));
}

/** Per-vehicle lifecycle. 'departed' is a terminal holding state — the
 * vehicle mesh/body is already gone, but the slot stays 'departed' (not
 * reset to 'absent') until ALL SIX slots have departed and the day-complete
 * summary has been shown and the player presses 繼續 — see
 * checkAllDeparted(). */
export type SingleVehicleState = 'absent' | 'arriving' | 'docked' | 'departing' | 'departed';

const CALL_IDLE_TEXT = '呼叫載具\n按 E 同時呼叫六台載具';
const DEPART_IDLE_TEXT = '載具出發\n按 E 讓六台載具一起離場';
const DEPART_BLOCKED_TEXT = '載具尚未全部停靠';
const NOT_UNLOADED_TEXT = '請先接收今日貨物';
const ALREADY_HAVE_TEXT = '目前已有載具';

/** Cargo must sit stable inside a docked vehicle's cargoBounds for this long
 * before it counts as shipped — no organized/pallet/rack prerequisite (see
 * scanCargoForShipment's doc comment). */
const SHIP_STABLE_THRESHOLD = 0.5;
const SHIP_VELOCITY_THRESHOLD = 0.4;

type ButtonId = 'call' | 'depart';

/** One of the six FIXED docking slots ("Add six fixed vehicle docking
 * slots" round) — every slot always uses the exact same VehicleConfig (no
 * more round-robin cycling through a shared list), so `config` never
 * changes after construction; only `vehicle`/`state`/`pinnedCargo`/
 * `waypointIndex` are mutated as the day progresses. `waypointIndex` marks
 * which stop (within VEHICLE_ROUTES[config.id].arrivalWaypoints while
 * 'arriving', or .departureWaypoints while 'departing') the vehicle is
 * currently traveling toward — see updateSlot(). */
interface VehicleSlot {
  config: VehicleConfig;
  vehicle: VehicleSystem | null;
  state: SingleVehicleState;
  pinnedCargo: InteractableObject[];
  waypointIndex: number;
}

/**
 * Owns all SIX vehicle docking slots (three land, three sea — see
 * vehicle-dock-data.ts for their fixed world positions), each independently
 * tracking its own VehicleSystem instance/state/pinned-cargo list. 呼叫載具
 * spawns all six at once; 載具出發 sends all six off at once, regardless of
 * how much (or how little, or how correctly) is loaded — see canDepart's
 * doc comment. Also owns the departure-time score settlement snapshot and
 * the per-frame cargoBounds shipment scan across however many slots are
 * currently docked.
 */
export class VehicleControlSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private cargoSystem: CargoSystem;
  private pickupSystem: PickupSystem;
  private hud: HUD;
  private dailyFlowSystem: DailyFlowSystem;
  private settingsManager: SettingsManager;
  private scoringSystem: ScoringSystem;
  private onPauseChange: (paused: boolean) => void;
  private onVehicleDiscovered?: (config: VehicleConfig) => void;
  private onVehicleCalled?: () => void;
  private onCargoLoaded?: () => void;
  private onVehicleDeparted?: () => void;
  private enabled = true;

  /** Fixed six slots, built once in the constructor from
   * [...LAND_VEHICLE_CONFIGS, ...SEA_VEHICLE_CONFIGS] — the SAME slot
   * objects are reused/reset every day (spec: "下一天重置後，六台都能再次
   * 呼叫"), never recreated, so nothing needs to re-derive "which configs
   * exist" per day. */
  private slots: VehicleSlot[];

  private dayCompleteShown = false;
  /** Computed once at pressDepartButton() time, consumed once by
   * showDayCompleteSummary() once all six slots finish departing. */
  private pendingSettlement: DepartureSettlement | null = null;

  /** Per-item stability timers for the shipment scan ("至少 0.5 秒") —
   * separate from PalletSystem/RollerRackSystem's own timers (different
   * map, different fixture). */
  private shipStableTimers: Map<string, number> = new Map();

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
    settingsManager: SettingsManager,
    scoringSystem: ScoringSystem,
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
    this.settingsManager = settingsManager;
    this.scoringSystem = scoringSystem;
    this.onPauseChange = onPauseChange;
    this.onVehicleDiscovered = onVehicleDiscovered;
    this.onVehicleCalled = onVehicleCalled;
    this.onCargoLoaded = onCargoLoaded;
    this.onVehicleDeparted = onVehicleDeparted;
    this.enabled = enabled;

    this.slots = [...LAND_VEHICLE_CONFIGS, ...SEA_VEHICLE_CONFIGS].map((config) => ({
      config, vehicle: null, state: 'absent' as SingleVehicleState, pinnedCargo: [], waypointIndex: 0,
    }));

    const { centerX, centerZ, spacing } = VEHICLE_CONTROL_POS;
    this.callButtonPos = new THREE.Vector3(centerX - spacing / 2, 0, centerZ);
    this.departButtonPos = new THREE.Vector3(centerX + spacing / 2, 0, centerZ);
    // `enabled` gates the call/depart buttons (and everything behind them)
    // out of the scene this round (see feature-flags.ts
    // ENABLE_VEHICLE_LOADING_FLOW). callButtonPos/departButtonPos above are
    // cheap position math, harmless either way; getNearestButton() below is
    // the one place that must actually check `enabled` so a disabled
    // system can't report a button that was never built as "nearby".
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

  /** Allowed only once today's cargo has actually been unloaded (spec:
   * sorting/loading), and only while EVERY slot is still 'absent' — a
   * partial call (some slots already occupied) can't happen since
   * pressCallButton() always spawns all six atomically. */
  get canCall(): boolean {
    const flowState = this.dailyFlowSystem.state;
    const flowAllows = flowState === 'sorting' || flowState === 'loading';
    return flowAllows && this.slots.every((s) => s.state === 'absent');
  }

  /** Allowed as soon as ALL SIX slots are docked — "Add six cargo vehicles
   * and unrestricted departure scoring" round explicitly removed every
   * cargo-completion requirement (loaded count, organized, shipped ===
   * total): the player can send every vehicle off at any time once they've
   * all arrived, with whatever is (or isn't) correctly loaded at that
   * moment settled via pressDepartButton's score snapshot instead of
   * gating the button itself. */
  get canDepart(): boolean {
    return this.slots.every((s) => s.state === 'docked');
  }

  callBlockedMessage(): string {
    const flowState = this.dailyFlowSystem.state;
    if (flowState === 'ready' || flowState === 'unloading') return NOT_UNLOADED_TEXT;
    if (!this.slots.every((s) => s.state === 'absent')) {
      const anyMoving = this.slots.some((s) => s.state === 'arriving' || s.state === 'departing');
      return anyMoving ? '載具正在移動' : ALREADY_HAVE_TEXT;
    }
    return ALREADY_HAVE_TEXT;
  }

  /** Only reason left to block departure is "not all six docked yet" — see
   * canDepart's doc comment. */
  departBlockedMessage(): string {
    return DEPART_BLOCKED_TEXT;
  }

  private flash(label: THREE.Sprite, text: string, revertTo: string): void {
    updateFloatingLabel(label, text);
    setTimeout(() => updateFloatingLabel(label, revertTo), 1500);
  }

  /** 呼叫載具 — spawns all six fixed slots at once (spec: "按下現有「呼叫
   * 載具」按鈕時，同時呼叫六台" / "不再依解鎖貨物種類減少載具數量"). Gated on
   * every slot being 'absent', so a fast double-press can't spawn a second
   * batch: the very first press already flips every slot away from
   * 'absent' before a second press could be handled. */
  pressCallButton(): void {
    if (!this.canCall) {
      this.flash(this.callLabel, this.callBlockedMessage(), CALL_IDLE_TEXT);
      return;
    }
    for (const slot of this.slots) this.spawnSlot(slot);
    this.onVehicleCalled?.();
  }

  private spawnSlot(slot: VehicleSlot): void {
    const vehicle = new VehicleSystem(this.scene, this.physics, slot.config, slot.config.spawnPosition);
    this.pickupSystem.addPlacementSurface(vehicle.cargoBedTopMesh);
    slot.vehicle = vehicle;
    slot.state = 'arriving';
    slot.waypointIndex = 0;
    this.onVehicleDiscovered?.(slot.config);
  }

  /** 載具出發 — proceeds as soon as all six slots are docked, regardless of
   * how much (or how little, or how incorrectly) is currently loaded (see
   * canDepart's doc comment). Two independent things happen per today's
   * cargo item here:
   *   1. Physical pinning: anything CURRENTLY shipped=true (physically
   *      resting in a docked bay, per scanCargoForShipment) rides along
   *      with whichever specific slot it's shipped under and is destroyed
   *      once that vehicle leaves — unchanged from before, and
   *      deliberately NOT conditioned on vehicle-type correctness (spec:
   *      "未出貨貨物照既有扣分與隔天清除規則處理" / "已隨載具離場的貨物照
   *      原流程清除").
   *   2. Score settlement snapshot: SEPARATELY, an item only counts as a
   *      genuine success if it's shipped AND in a vehicle whose
   *      acceptedCargoTypes actually cover its effective kind — everything
   *      else (never shipped, or shipped under the wrong vehicle) counts
   *      as unshipped and is penalized (unchanged formula/constant from
   *      the previous round). */
  pressDepartButton(): void {
    if (!this.canDepart) {
      this.flash(this.departLabel, this.departBlockedMessage(), DEPART_IDLE_TEXT);
      return;
    }

    const slotById = new Map(this.slots.map((s) => [s.config.id, s]));
    let shippedCorrect = 0;
    let unshipped = 0;

    for (const id of this.dailyFlowSystem.dailyCargoIds) {
      const data = this.cargoSystem.getCargoData(id);
      const obj = this.interactables.get(id);
      if (!data || !obj) { unshipped++; continue; }

      const slot = data.shippedVehicleType ? slotById.get(data.shippedVehicleType) : undefined;

      if (data.shipped && slot) {
        slot.pinnedCargo.push(obj);
      }

      const correct = !!data.shipped && !!slot && vehicleAcceptsCargo(slot.config, data);
      if (correct) shippedCorrect++; else unshipped++;
    }

    // The sorting pallet itself is never in dailyCargoIds (spec: "托盤本身
    // 不計入dailyCargoIds") so it needs its own bay-membership check — if
    // it's still sitting inside a docked vehicle's cargo bay at departure
    // time, it rides along the SAME way as any other pinned cargo
    // (vehicle.moveToward() below just translates every entry in the list
    // by the same per-frame delta, so the pallet and whatever cargo is
    // still resting on it stay visually together with zero extra code).
    // Never part of the score settlement either way (not daily cargo).
    const palletObj = this.interactables.get(PALLET_ID);
    if (palletObj && palletObj.mesh.visible && !palletObj.isHeld) {
      for (const slot of this.slots) {
        if (slot.vehicle && slot.vehicle.isInCargoBay(palletObj.mesh.position)) {
          slot.pinnedCargo.push(palletObj);
          break;
        }
      }
    }

    for (const slot of this.slots) {
      this.pinCargoPhysics(slot.pinnedCargo);
      slot.state = 'departing';
      slot.waypointIndex = 0;
    }

    this.pendingSettlement = this.scoringSystem.settleDeparture(this.dailyFlowSystem.totalCargoCount, shippedCorrect, unshipped);

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
    for (const slot of this.slots) this.updateSlot(slot, deltaTime);
    this.scanCargoForShipment(deltaTime);
  }

  /** Drives one slot's vehicle along its VEHICLE_ROUTES waypoint list one
   * leg at a time — never a single spawn→dock (or dock→exit) straight-line
   * interpolation, so land vehicles can no longer cut through a wall that
   * only has a real opening at one shared X (see vehicle-route-data.ts).
   * moveToward() itself is unchanged (still a single-target straight-line
   * mover); this just calls it repeatedly against successive waypoints,
   * advancing `slot.waypointIndex` each time the current leg completes. */
  private updateSlot(slot: VehicleSlot, deltaTime: number): void {
    if (!slot.vehicle) return;
    const route = VEHICLE_ROUTES[slot.config.id];

    if (slot.state === 'arriving') {
      const waypoints = route.arrivalWaypoints;
      const target = waypoints[slot.waypointIndex];
      const arrived = slot.vehicle.moveToward(target, deltaTime, []);
      if (!arrived) return;
      if (slot.waypointIndex < waypoints.length - 1) {
        slot.waypointIndex++;
        return;
      }
      slot.state = 'docked';
      slot.waypointIndex = 0;
      // Player can start loading into whichever vehicle just arrived,
      // without waiting for the other five (idempotent past the first
      // call — see DailyFlowSystem.notifyVehicleDocked's own guard).
      this.dailyFlowSystem.notifyVehicleDocked();
      return;
    }

    if (slot.state === 'departing') {
      const waypoints = route.departureWaypoints;
      const target = waypoints[slot.waypointIndex];
      const arrived = slot.vehicle.moveToward(target, deltaTime, slot.pinnedCargo);
      if (!arrived) return;
      if (slot.waypointIndex < waypoints.length - 1) {
        slot.waypointIndex++;
        return;
      }
      this.finishSlotDeparture(slot);
    }
  }

  /** Continuously scans every daily cargo item against whichever of the six
   * slots are currently 'docked' — any cargo that sits stable inside a
   * cargoBounds for SHIP_STABLE_THRESHOLD seconds gets marked shipped
   * (loading needs no organized=true, or ever having touched the pallet/
   * roller rack — being inside a docked vehicle's cargo bay and settling
   * for 0.5s is the whole rule). If an item is simultaneously inside
   * multiple docked vehicles' bounds (possible now that up to three per
   * route sit close together), the NEAREST one wins, mirroring the old
   * land-vs-sea tie-break. Anything previously shipped that leaves every
   * bounds (or gets picked back up) immediately un-ships (spec: "貨物在
   * 發車前被拿出cargoBounds，要取消loaded/shipped並更新數量") — no debounce
   * needed on that direction since it only happens from a deliberate player
   * action, not physics jitter. */
  private scanCargoForShipment(deltaTime: number): void {
    const dockedSlots = this.slots.filter((s) => s.state === 'docked' && s.vehicle);
    if (dockedSlots.length === 0) return;

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

      let target: VehicleSlot | null = null;
      let bestDist = Infinity;
      for (const slot of dockedSlots) {
        if (!slot.vehicle!.isInCargoBay(obj.mesh.position)) continue;
        const d = this.distanceXZ(obj.mesh.position, slot.vehicle!.position);
        if (d < bestDist) { bestDist = d; target = slot; }
      }

      if (!target) {
        this.shipStableTimers.delete(id);
        if (data.shipped) { data.shipped = false; data.shippedVehicleType = null; anyChanged = true; }
        continue;
      }

      if (data.shipped) {
        if (data.shippedVehicleType !== target.config.id) data.shippedVehicleType = target.config.id;
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
        data.shippedVehicleType = target.config.id;
        this.shipStableTimers.delete(id);
        anyChanged = true;
        this.onCargoLoaded?.();
      }
    }

    if (anyChanged) this.dailyFlowSystem.refreshCompletion();
  }

  /** Destroys each pinned item's mesh/collider/CargoData entirely — only
   * once the vehicle carrying it has actually left the scene, never at load
   * time or button-press time. Reuses CargoSystem's own removeCargo (spec:
   * "不要另寫第二套互相衝突的附著系統"). */
  private finishSlotDeparture(slot: VehicleSlot): void {
    const vehicle = slot.vehicle;
    if (!vehicle) return;

    for (const obj of slot.pinnedCargo) {
      // The pallet itself is never destroyed like shipped cargo is — it
      // just leaves the play space along with the vehicle for the rest of
      // today; PalletSystem.resetToStart() (called from DailyFlowSystem's
      // daily reset) makes it visible again at its home position next day.
      if (obj.id === PALLET_ID) { obj.mesh.visible = false; continue; }
      this.cargoSystem.removeCargo(obj.id);
    }
    this.pickupSystem.removePlacementSurface(vehicle.cargoBedTopMesh);
    vehicle.dispose();

    slot.vehicle = null;
    slot.pinnedCargo = [];
    slot.state = 'departed';

    this.checkAllDeparted();
  }

  /** Only fires once ALL SIX slots have independently finished departing —
   * `dayCompleteShown` guards against any slot's transition re-firing this
   * after the panel is already up (every slot stays 'departed' the whole
   * time the panel is open, since they only reset to 'absent' on 繼續). */
  private checkAllDeparted(): void {
    if (this.slots.every((s) => s.state === 'departed') && !this.dayCompleteShown) {
      this.dayCompleteShown = true;
      this.showDayCompleteSummary();
    }
  }

  /** Completion screen — reads the settlement snapshot computed back at
   * pressDepartButton() press time (total/success/unshipped/penalty/
   * finalScore), rather than re-deriving anything from CargoData (which is
   * no longer meaningful here — every daily cargo item, shipped or not, has
   * been destroyed by now: shipped ones via finishSlotDeparture above,
   * never-shipped ones will be swept up by DailyFlowSystem's next-day
   * cleanup once the player presses 結束今天). Falls back to an all-zero
   * snapshot only defensively (pendingSettlement is always set by
   * pressDepartButton before departure can even begin). */
  private showDayCompleteSummary(): void {
    const settlement = this.pendingSettlement ?? {
      total: this.dailyFlowSystem.totalCargoCount, shipped: 0, unshipped: 0, penalty: 0, finalScore: this.settingsManager.progress.score,
    };
    this.pendingSettlement = null;

    this.dailyFlowSystem.notifyDayComplete();
    this.onPauseChange(true);
    this.hud.showDayCompleteSummary({
      ...settlement,
      onContinue: () => {
        // Same slot objects, reset in place — every one of the six can be
        // called again next day (spec: "下一天重置後，六台都能再次呼叫").
        for (const slot of this.slots) slot.state = 'absent';
        this.dayCompleteShown = false;
        this.onPauseChange(false);
      },
    });
  }
}
