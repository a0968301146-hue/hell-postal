import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../../shared/types/interactable';
import {
  CargoSystem, CargoData, CargoType, FrozenSettlementInput, createEmptyFrozenSettlementInput, tallyFrozenColdValue,
  LiveSettlementInput, createEmptyLiveSettlementInput, tallyLiveCalmValue, GIANT_CAKE_BOX_PRESET,
} from '../cargo';
// Depends on the neutral PickupPort contract (Phase 6: 模組邊界修正)
// instead of importing PickupSystem (systems/interaction) — that system's
// own index.ts also re-exports InteractionSystem, which depends on
// VehicleControlSystem to dispatch call/depart button presses, so importing
// the concrete class (even via the barrel) would create a file-level
// circular import. GameApp injects the one real PickupSystem instance,
// which structurally satisfies PickupPort.
import { PickupPort } from '../../shared/types/pickup-port';
import { VehicleSystem } from './vehicle-system';
import { LAND_VEHICLE_CONFIGS, SEA_VEHICLE_CONFIGS, VehicleConfig, vehicleAcceptsMailRegion } from './vehicle-data';
import { MailSystem } from '../mail/mail-system';
import { MailBagSystem } from '../mail/mail-bag-system';
import { PackedMailBagSystem } from '../mail/packed-mail-bag-system';
import { VEHICLE_ROUTES } from './vehicle-route-data';
import { VEHICLE_CONTROL_WALL_BUTTONS } from '../world-layout';
import { ScoringSystem, DepartureSettlement, LostFoundSettlementInput, MailSettlementInput } from '../scoring';
import { createFloatingLabel, updateFloatingLabel } from '../../adapters/three/world-label-system';
import { HUD } from '../hud';
import { DailyFlowSystem } from '../daily-flow';
import { ALL_PALLET_IDS, isPalletId } from '../pallet';
import { isVehicleUnlockedOnDay } from '../../data/daily-unlock-data';

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

/** Day8's finale cake ("Day8巨型蛋糕與載具完全隔離" round) — identified the
 * SAME way after-work-story-system.ts's own findGiantCakeCargo already does
 * (shapePresetId match against the ONE real GIANT_CAKE_BOX_PRESET
 * cargo-manifest-planner.ts ever spawns for day 8), so there is no second,
 * driftable definition of "which cargo is the cake". This is the ONE place
 * VehicleControlSystem checks it — scanCargoForShipment and
 * pressDepartButton's own settlement scan both call this before touching
 * loadedVehicleId/correctlyShipped/shippedCorrect/unshipped/pinnedCargo, so
 * the cake structurally never becomes loadable, shippable, scoreable, or
 * physically pinned to a departing vehicle no matter what the player does
 * with it near a vehicle bay (spec: "完全不能與載具系統產生互動"). */
function isFinaleCakeCargo(data: CargoData): boolean {
  return data.shapePresetId === GIANT_CAKE_BOX_PRESET.id;
}

/** Whether `vehicle` is one of the six creature haulers allowed to accept
 * this item — the ONLY "correctly loaded" test (spec: "貨物放入正確載具才算
 * 成功出貨"). Computed exactly once per load event, inside
 * scanCargoForShipment, which stamps the result onto CargoData.
 * correctlyShipped (Phase 7: 統一狀態來源) — nothing else re-derives this
 * independently; pressDepartButton's scoring and DailyFlowSystem's HUD
 * counts both just read the already-computed field.
 *
 * "Update vehicle cargo compatibility and capacity" round: now ALSO checks
 * config.acceptedRegions against data.region (every land vehicle only
 * 'domestic', every sea vehicle only 'international') — previously only
 * acceptedCargoTypes was checked, so a domestic-only vehicle would happily
 * accept an overseas item of a matching category, which is no longer
 * correct. data.region is null for pre-existing (non-daily) cargo, which
 * this function is never actually called against in practice (only
 * dailyFlowSystem.dailyCargoIds items reach here) — the null check is just
 * defensive. Also defensively excludes the Day8 finale cake (see
 * isFinaleCakeCargo's own doc comment) even though scanCargoForShipment's
 * own earlier skip already keeps this from ever being called against it in
 * practice — belt-and-braces "可裝載判定" hardening per spec's own explicit
 * checklist. */
function vehicleAcceptsCargo(config: VehicleConfig, data: CargoData): boolean {
  return (
    !isFinaleCakeCargo(data) &&
    data.region !== null &&
    config.acceptedRegions.includes(data.region) &&
    config.acceptedCargoTypes.includes(effectiveCargoKind(data))
  );
}

/** Per-vehicle lifecycle. 'departed' is a terminal holding state — the
 * vehicle mesh/body is already gone, but the slot stays 'departed' (not
 * reset to 'absent') until ALL SIX slots have departed and the day-complete
 * summary has been shown and the player presses 繼續 — see
 * checkAllDeparted(). */
export type SingleVehicleState = 'absent' | 'arriving' | 'docked' | 'departing' | 'departed';

/** Wall-mounted button raycast-target ids ("Fix cargo throwing and rebalance
 * daily manifest" round二) — registered into the SAME shared `interactables`
 * map every other crosshair-aimed prop uses (bulletin board, television),
 * replacing the old proximity-based getNearestButton() entirely (spec二:
 * "準心直接命中壁掛按鈕才可按E"). */
export const VEHICLE_CALL_BUTTON_ID = 'vehicle-call-button';
export const VEHICLE_DEPART_BUTTON_ID = 'vehicle-depart-button';

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
  private pickupSystem: PickupPort;
  private hud: HUD;
  private dailyFlowSystem: DailyFlowSystem;
  private scoringSystem: ScoringSystem;
  private onPauseChange: (paused: boolean) => void;
  private onVehicleDiscovered?: (config: VehicleConfig) => void;
  private onVehicleCalled?: () => void;
  private onCargoLoaded?: () => void;
  private onVehicleDeparted?: () => void;
  /** Fired once, synchronously, right at 載具出發 press time ("Spawn lost
   * found NPC during unloading and penalize missed interaction" round,
   * extended "Expand lost found return storage and scoring" round 七/八 to
   * carry the full lost-item storage settlement too) — returns
   * LostFoundSystem's own frozen snapshot, folded into the SAME settlement
   * ScoringSystem.settleDeparture() computes below. Wired to
   * LostFoundSystem.settleAtDeparture(); this class never inspects
   * lost-found state itself. */
  private onShippingStarted?: () => LostFoundSettlementInput;
  /** MailSystem/MailBagSystem — narrow read/write surface ("Add modular
   * envelope stamping and regional mail bag system" round 九/十一): this
   * class is the ONE place a bag's region is checked against a vehicle's
   * acceptedMailRegions (vehicleAcceptsMailRegion, vehicle-data.ts) and the
   * ONE place bag physical presence in a departing bay is scanned —
   * MailBagSystem only ever reports plain bag facts (region/all bag ids/
   * envelope membership), never judges vehicle compatibility itself; the
   * final per-envelope settlement tally is delegated back to MailSystem
   * (spec: "結算以每封信計算", envelope state stays owned there). */
  private mailSystem: MailSystem;
  private mailBagSystem: MailBagSystem;
  /** "Add regional envelope dispatch machine" round — same narrow read/write
   * surface as mailBagSystem just above, for PackedMailBag's own physical
   * bay-presence scan (see pressDepartButton's own extended mail-bag block)
   * and departure teardown (finishSlotDeparture). */
  private packedMailBagSystem: PackedMailBagSystem;

  /** "船運載具規格重製" round — no longer a fixed six-slot array reused
   * forever. `this.slots` now holds EXACTLY today's unlocked vehicle
   * roster, fully torn down and rebuilt from daily-unlock-data.ts every day
   * transition (see resetForNewDay() below) — spec二: "換日 → 全部刪除 → 按
   * 當日資料重新生成", explicitly NOT "just hide locked vehicles". Every
   * entry in this array is therefore always eligible to be called; nothing
   * downstream needs to separately filter by unlock state anymore (compare
   * the old isSlotUnlockedToday-based filtering this replaced). */
  private slots: VehicleSlot[];

  private dayCompleteShown = false;
  /** Computed once at pressDepartButton() time, consumed once by
   * showDayCompleteSummary() once all six slots finish departing. */
  private pendingSettlement: DepartureSettlement | null = null;

  /** Per-item stability timers for the shipment scan ("至少 0.5 秒") —
   * separate from PalletSystem's own timers (different map, different
   * fixture). */
  private shipStableTimers: Map<string, number> = new Map();

  private callLabel!: THREE.Sprite;
  private departLabel!: THREE.Sprite;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsSystem,
    interactables: Map<string, InteractableObject>,
    cargoSystem: CargoSystem,
    pickupSystem: PickupPort,
    hud: HUD,
    dailyFlowSystem: DailyFlowSystem,
    scoringSystem: ScoringSystem,
    mailSystem: MailSystem,
    mailBagSystem: MailBagSystem,
    packedMailBagSystem: PackedMailBagSystem,
    onPauseChange: (paused: boolean) => void,
    onVehicleDiscovered?: (config: VehicleConfig) => void,
    onVehicleCalled?: () => void,
    onCargoLoaded?: () => void,
    onVehicleDeparted?: () => void,
    onShippingStarted?: () => LostFoundSettlementInput,
    enabled: boolean = true
  ) {
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;
    this.cargoSystem = cargoSystem;
    this.pickupSystem = pickupSystem;
    this.hud = hud;
    this.dailyFlowSystem = dailyFlowSystem;
    this.scoringSystem = scoringSystem;
    this.mailSystem = mailSystem;
    this.mailBagSystem = mailBagSystem;
    this.packedMailBagSystem = packedMailBagSystem;
    this.onPauseChange = onPauseChange;
    this.onVehicleDiscovered = onVehicleDiscovered;
    this.onVehicleCalled = onVehicleCalled;
    this.onCargoLoaded = onCargoLoaded;
    this.onVehicleDeparted = onVehicleDeparted;
    this.onShippingStarted = onShippingStarted;

    // Initial roster — Day 1's own unlocked vehicles (same derivation
    // resetForNewDay() below reuses on every later day transition). Reads
    // dailyFlowSystem.currentDay directly rather than hardcoding day 1, so
    // a page load that resumes mid-run (currentDay already >1) still starts
    // with the CORRECT day's roster rather than always Day 1's.
    this.slots = this.buildSlotsForDay(this.dailyFlowSystem.currentDay);

    // `enabled` gates the call/depart buttons (and everything behind them)
    // out of the scene this round (see feature-flags.ts
    // ENABLE_VEHICLE_LOADING_FLOW).
    if (!enabled) return;
    this.buildButtons();
  }

  /** Two wall-mounted plaques on the west wall, south of the TV ("Fix cargo
   * throwing and rebalance daily manifest" round二) — call above, depart
   * below, sharing the same X/Z footprint from VEHICLE_CONTROL_WALL_BUTTONS
   * (logistics-layout-data.ts), stacked at their own distinct center
   * heights. Each is a real InteractableObject with a tightly-fit collider
   * (spec二: "準心直接命中壁掛按鈕才可按E" — same crosshair-raycast pattern
   * as the bulletin board/TV, no proximity detection anymore). */
  private buildButtons(): void {
    const { centerX, centerZ, callCenterY, departCenterY, width, height, depth } = VEHICLE_CONTROL_WALL_BUTTONS;
    this.callLabel = this.buildOneButton(centerX, callCenterY, centerZ, width, height, depth, 0x2b6bd8, CALL_IDLE_TEXT, VEHICLE_CALL_BUTTON_ID, '呼叫載具按鈕');
    this.departLabel = this.buildOneButton(centerX, departCenterY, centerZ, width, height, depth, 0xd88a2b, DEPART_IDLE_TEXT, VEHICLE_DEPART_BUTTON_ID, '載具出發按鈕');
  }

  private buildOneButton(
    x: number, y: number, z: number, width: number, height: number, depth: number,
    color: number, labelText: string, id: string, displayName: string
  ): THREE.Sprite {
    // BoxGeometry's own (width,height,depth) constructor args map to local
    // (X,Y,Z) — X is the wall→room axis here (`depth` param), matching the
    // same convention BULLETIN_BOARD/TELEVISION already use.
    const geo = new THREE.BoxGeometry(depth, height, width);
    const mat = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);

    // Collider wraps only the plaque's own thin body — no enlarged
    // detection volume (same convention as the bulletin board's own
    // "互動Collider只包住板面").
    this.physics.createStaticCuboid(x, y, z, depth / 2, height / 2, width / 2);

    const label = createFloatingLabel(labelText, { width: 1.0, bg: 'rgba(20,25,45,0.75)' });
    label.position.set(x + depth / 2 + 0.3, y + height / 2 + 0.3, z);
    this.scene.add(label);

    const obj = createInteractableObject(id, displayName, mesh, depth, height, width);
    this.interactables.set(id, obj);

    return label;
  }

  /** Flat-plane distance — used by the cargo-shipment scan below to find
   * which docked vehicle's cargo bay a given item is nearest to (unrelated
   * to the call/depart buttons, which are crosshair-raycast targets now,
   * not proximity-based — see buildButtons() above). */
  private distanceXZ(pos: THREE.Vector3, target: THREE.Vector3): number {
    const dx = pos.x - target.x;
    const dz = pos.z - target.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  get isPaused(): boolean {
    return this.dayCompleteShown;
  }

  /** Fresh slot RECORDS (never VehicleSystem instances — those are only
   * ever created on demand by spawnSlot(), when the player actually presses
   * 呼叫載具) for whichever vehicles daily-unlock-data.ts opens on `day`.
   * The single place "which configs exist today" is derived — both the
   * constructor and resetForNewDay() below call this rather than
   * duplicating the filter. */
  private buildSlotsForDay(day: number): VehicleSlot[] {
    return [...LAND_VEHICLE_CONFIGS, ...SEA_VEHICLE_CONFIGS]
      .filter((config) => isVehicleUnlockedOnDay(config.id, day))
      .map((config) => ({ config, vehicle: null, state: 'absent' as SingleVehicleState, pinnedCargo: [], waypointIndex: 0 }));
  }

  /** "船運載具規格重製" round — the ONE place a day transition tears down
   * and rebuilds the vehicle roster (spec二/七: called from the SAME
   * resetTools sequence create-game-systems.ts already runs cargo/mail/
   * lost-found resets through, AFTER DailyFlowSystem.currentDay has already
   * advanced — see DailyFlowSystem.advanceToNextDay's own ordering:
   * `currentDay++` happens before `resetTools()` fires, so reading
   * `this.dailyFlowSystem.currentDay` here already yields the NEW day).
   * Every slot's own VehicleSystem is expected to already be disposed via
   * the normal per-slot departure flow (finishSlotDeparture) by the time
   * this runs — advanceToNextDay only ever runs once dailyFlowSystem.
   * state==='dayComplete', itself only reachable once every slot has
   * independently finished
   * departing — but this defensively disposes any leftover vehicle anyway
   * rather than assuming that invariant always holds. */
  resetForNewDay(): void {
    for (const slot of this.slots) {
      if (slot.vehicle) {
        this.pickupSystem.removePlacementSurface(slot.vehicle.cargoBedTopMesh);
        slot.vehicle.dispose();
      }
    }
    this.slots = this.buildSlotsForDay(this.dailyFlowSystem.currentDay);
    this.dayCompleteShown = false;
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

  /** Allowed as soon as every one of TODAY's slots is docked — "Add six
   * cargo vehicles and unrestricted departure scoring" round explicitly
   * removed every cargo-completion requirement (loaded count, organized,
   * shipped === total): the player can send every called vehicle off at any
   * time once they've all arrived, with whatever is (or isn't) correctly
   * loaded at that moment settled via pressDepartButton's score snapshot
   * instead of gating the button itself. "船運載具規格重製" round: `this.
   * slots` IS already today's exact roster (see buildSlotsForDay/
   * resetForNewDay above) — no separate unlock filter needed here anymore. */
  get canDepart(): boolean {
    return this.slots.length > 0 && this.slots.every((s) => s.state === 'docked');
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

  /** 呼叫載具 — spawns every one of TODAY's slots at once ("Add six fixed
   * vehicle docking slots" round's own "不再依解鎖貨物種類減少載具數量"
   * applied to cargo TYPE, not to whether the vehicle itself is open yet).
   * "船運載具規格重製" round: `this.slots` already IS exactly today's
   * unlocked roster (see buildSlotsForDay/resetForNewDay above), so every
   * entry gets spawned unconditionally — no per-slot unlock check needed
   * anymore. Gated on every slot being 'absent', so a fast double-press
   * can't spawn a second batch: the very first press already flips every
   * slot away from 'absent' before a second press could be handled. */
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
   *      genuine success if CargoData.correctlyShipped is true (Phase 7:
   *      統一狀態來源 — already computed once by scanCargoForShipment, never
   *      re-derived here) — everything else (never loaded, or loaded into
   *      the wrong vehicle) counts as unshipped and is penalized (unchanged
   *      formula/constant from the previous round). */
  pressDepartButton(): void {
    if (!this.canDepart) {
      this.flash(this.departLabel, this.departBlockedMessage(), DEPART_IDLE_TEXT);
      return;
    }

    // Settled synchronously, right here at press time (before the six
    // vehicles' multi-second departure animation even starts) — never
    // blocks departure either way ("Spawn lost found NPC during unloading
    // and penalize missed interaction" round 三, extended "Expand lost
    // found return storage and scoring" round 七/八 to also freeze the
    // lost-item storage snapshot at this same moment). LostFoundSystem
    // decides WHETHER either penalty is due; the actual deduction happens
    // below, folded into the same settleDeparture() call as the
    // unshipped-cargo penalty, so ScoringSystem stays the one place any of
    // them is applied.
    const lostFound = this.onShippingStarted?.() ?? { missedCount: 0, total: 0, handedOver: 0, stored: 0, unstored: 0 };

    const slotById = new Map(this.slots.map((s) => [s.config.id, s]));
    let shippedCorrect = 0;
    let unshipped = 0;
    // "Add freezer shelves and frozen cargo freshness system" round spec六
    // — tallied in this SAME existing scan loop (never a second scan over
    // dailyCargoIds), read straight off the CargoData already being read
    // here for the correctlyShipped check.
    const frozen = createEmptyFrozenSettlementInput();
    // "活物貨物系統" round spec六 — same "tallied in this same scan loop"
    // convention as frozen above, never a second scan.
    const live = createEmptyLiveSettlementInput();

    for (const id of this.dailyFlowSystem.dailyCargoIds) {
      const data = this.cargoSystem.getCargoData(id);
      const obj = this.interactables.get(id);
      if (!data || !obj) { unshipped++; continue; }
      // Day8's finale cake never counts toward regular cargo shipment
      // totals at all — not shipped, not unshipped, never pinned/carried
      // away by a departing vehicle (spec: "不應被計入一般貨物出貨數量...不
      // 應觸發正常的載具出發結算"). `total` below is derived from
      // shippedCorrect+unshipped rather than dailyFlowSystem.
      // totalCargoCount specifically so this skip can never desync the
      // settlement snapshot's own displayed total from what was actually
      // tallied.
      if (isFinaleCakeCargo(data)) continue;

      const slot = data.loadedVehicleId ? slotById.get(data.loadedVehicleId) : undefined;

      // Physically pinned/carried off regardless of correctness — a
      // wrong-vehicle item still physically rides along with whatever bay
      // it's resting in (spec: "已隨載具離場的貨物照原流程清除"), it's just
      // never counted as a successful shipment below.
      if (data.loadedVehicleId && slot) {
        slot.pinnedCargo.push(obj);
      }

      if (data.correctlyShipped) {
        shippedCorrect++;
        // An unshipped frozen item is already covered by the normal
        // per-item unshipped penalty above — only a CORRECTLY shipped one
        // needs its own coldValue tier tallied here.
        if (data.category === 'frozen') tallyFrozenColdValue(frozen, data.coldValue);
        if (data.category === 'live') tallyLiveCalmValue(live, data.calmValue);
      } else {
        unshipped++;
      }
    }

    // The sorting pallets themselves are never in dailyCargoIds (spec: "托盤
    // 本身不計入dailyCargoIds") so each needs its own bay-membership check —
    // if it's still sitting inside a docked vehicle's cargo bay at departure
    // time, it rides along the SAME way as any other pinned cargo
    // (vehicle.moveToward() below just translates every entry in the list
    // by the same per-frame delta, so the pallet and whatever cargo is
    // still resting on it stay visually together with zero extra code).
    // Never part of the score settlement either way (not daily cargo).
    // "Rebuild pallet storage and reset upgrade progression" round三: now
    // three separate pallet ids (small/medium/large) — each independently
    // checked, since more than one could in principle be sitting in a bay
    // (or even the same bay) at once.
    for (const palletId of ALL_PALLET_IDS) {
      const palletObj = this.interactables.get(palletId);
      if (!palletObj || !palletObj.mesh.visible || palletObj.isHeld) continue;
      for (const slot of this.slots) {
        if (slot.vehicle && slot.vehicle.isInCargoBay(palletObj.mesh.position)) {
          slot.pinnedCargo.push(palletObj);
          break;
        }
      }
    }

    // Mail bags ("Remove sealing and add physical mail box contents" round
    // 九/十一) — same one-time physical-bay scan as the pallet block above:
    // ANY box (sealing no longer exists — every box is eligible regardless
    // of contents) currently resting in ANY of the six slots' cargo bays
    // rides along with that vehicle regardless of region match (spec: "已隨
    // 載具離場的貨物照原流程清除" — same convention as wrong-vehicle cargo
    // above); vehicleAcceptsMailRegion (vehicle-data.ts, the ONE place this
    // rule lives) decides whether it counts as CORRECTLY shipped. A box
    // that never made it into any bay at all (still sitting in the mail
    // room) is simply never in this set, so MailSystem.settleAtDeparture
    // below naturally counts its envelopes as unshipped — and since
    // getContainedEnvelopeIds() always reflects the box's CURRENT live
    // contents (escaped/removed envelopes already cleared out by
    // MailBagSystem's own updateEscapedEnvelopes/removeLastEnvelope), this
    // scan only ever needs the box's own identity/region here, never its
    // envelope list directly (spec九: "計分只看當下仍在interiorBounds且已
    // 登記的信件" is already enforced upstream, before this scan runs).
    const correctlyShippedBagIds = new Set<string>();
    for (const bagId of this.mailBagSystem.getAllBagIds()) {
      const bagObj = this.interactables.get(bagId);
      if (!bagObj || bagObj.isHeld || !bagObj.mesh.visible) continue;
      for (const slot of this.slots) {
        if (!slot.vehicle || !slot.vehicle.isInCargoBay(bagObj.mesh.position)) continue;
        slot.pinnedCargo.push(bagObj);
        if (vehicleAcceptsMailRegion(slot.config, this.mailBagSystem.getBagRegion(bagId))) {
          correctlyShippedBagIds.add(bagId);
        }
        break;
      }
    }
    // Packed mail bags ("Add regional envelope dispatch machine" round十) —
    // same one-time physical-bay scan as the open mail-bag block just above,
    // feeding into the SAME correctlyShippedBagIds set: mailSystem.
    // settleAtDeparture treats any bagId present there as correctly shipped
    // regardless of which system actually owns that container, so a packed
    // bag needs no separate settlement call of its own.
    for (const bagId of this.packedMailBagSystem.getAllBagIds()) {
      const bagObj = this.interactables.get(bagId);
      if (!bagObj || bagObj.isHeld || !bagObj.mesh.visible) continue;
      for (const slot of this.slots) {
        if (!slot.vehicle || !slot.vehicle.isInCargoBay(bagObj.mesh.position)) continue;
        slot.pinnedCargo.push(bagObj);
        if (vehicleAcceptsMailRegion(slot.config, this.packedMailBagSystem.getBagRegion(bagId))) {
          correctlyShippedBagIds.add(bagId);
        }
        break;
      }
    }
    const mail = this.mailSystem.settleAtDeparture(correctlyShippedBagIds);

    for (const slot of this.slots) {
      // "Day 1～7 每日內容與解鎖規格" round: a slot whose vehicle was never
      // called today (locked, still 'absent') has no vehicle/pinnedCargo of
      // its own to send off — skip it, rather than incorrectly flipping an
      // 'absent' slot to 'departing' (which would leave it permanently
      // stuck, since updateSlot() below only ever advances a slot that has
      // a real `vehicle`).
      if (slot.state !== 'docked') continue;
      this.pinCargoPhysics(slot.pinnedCargo);
      // A no-op for every vehicle except the frog ("Resize cargo and
      // improve frog mouth access" round spec三: "若玩家仍在青蛙嘴腔內，出
      // 發流程開始時先將玩家移到青蛙正前方的安全地面點，再關閉嘴巴並跳著離
      // 開，不可把玩家關在嘴內或一起載走") — checked BEFORE onDeparting()
      // below closes the mouth, using the player's CURRENT physics position
      // each time (never a stale cached one).
      const playerPos = this.physics.playerBody.translation();
      const safeExit = slot.vehicle?.getSafeExitPointIfPlayerInside(playerPos);
      if (safeExit) this.physics.playerBody.setTranslation(safeExit, true);
      // A no-op for every vehicle except the frog, which starts closing its
      // mouth and hides its own pinned cargo here ("Rebuild frog vehicle as
      // hopping mouth cargo carrier" round spec五/六 — see VehicleSystem.
      // onDeparting's own doc comment for why hiding beats leaving it
      // visibly floating in front of a closed mouth).
      slot.vehicle?.onDeparting(slot.pinnedCargo);
      slot.state = 'departing';
      slot.waypointIndex = 0;
    }

    // Deliberately shippedCorrect+unshipped here, NOT dailyFlowSystem.
    // totalCargoCount — the two are identical on every normal day (every
    // dailyCargoIds entry falls into exactly one bucket), but on Day8
    // totalCargoCount still includes the finale cake (registered in
    // dailyCargoIds for AfterWorkStorySystem's own lookup) while the scan
    // loop above deliberately skips it — using the scan's own tally keeps
    // this settlement's displayed "今日貨物總數" always consistent with what
    // was actually counted, cake excluded.
    this.pendingSettlement = this.scoringSystem.settleDeparture(shippedCorrect + unshipped, shippedCorrect, unshipped, lostFound, mail, frozen, live);

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
    // Animation upkeep (currently only the frog's own mouth-angle lerp,
    // see VehicleSystem.update's own doc comment) — runs every frame
    // regardless of arriving/docked/departing, a no-op for the other five.
    slot.vehicle.update(deltaTime);
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
      // A no-op for every vehicle except the frog, which starts opening its
      // mouth here ("Rebuild frog vehicle as hopping mouth cargo carrier"
      // round spec四).
      slot.vehicle.onArrived();
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
   * cargoBounds for SHIP_STABLE_THRESHOLD seconds gets its
   * `loadedVehicleId` set (loading needs no organized=true, or ever having
   * touched the pallet/roller rack — being inside a docked vehicle's cargo
   * bay and settling for 0.5s is the whole rule for PHYSICAL presence). If
   * an item is simultaneously inside multiple docked vehicles' bounds
   * (possible now that up to three per route sit close together), the
   * NEAREST one wins, mirroring the old land-vs-sea tie-break — an item can
   * never be `loadedVehicleId`'d under two vehicles at once. `correctlyShipped`
   * is derived alongside `loadedVehicleId` every time it's (re)assigned,
   * via vehicleAcceptsCargo — the ONE place that check runs (Phase 7: 統一
   * 狀態來源) — so a wrong-vehicle item gets `loadedVehicleId` set but
   * `correctlyShipped` stays false; it does NOT count as shipped anywhere
   * downstream (HUD counts, departure settlement). Anything previously
   * loaded that leaves every bounds (or gets picked back up) immediately
   * clears both fields (spec "貨物在發車前被拿出cargoBounds，要取消loaded/
   * shipped並更新數量") — no debounce needed on that direction since it only
   * happens from a deliberate player action, not physics jitter. */
  private scanCargoForShipment(deltaTime: number): void {
    const dockedSlots = this.slots.filter((s) => s.state === 'docked' && s.vehicle);
    if (dockedSlots.length === 0) return;

    let anyChanged = false;

    for (const id of this.dailyFlowSystem.dailyCargoIds) {
      const obj = this.interactables.get(id);
      const data = this.cargoSystem.getCargoData(id);
      if (!obj || !data) continue;
      // Day8's finale cake is registered in dailyCargoIds (so
      // AfterWorkStorySystem's own findGiantCakeCargo can still locate it —
      // see isFinaleCakeCargo's own doc comment) but must never be tracked
      // for vehicle loading at all: skipping it here means it can sit
      // inside a docked vehicle's cargo bay indefinitely without ever
      // getting loadedVehicleId/correctlyShipped set.
      if (isFinaleCakeCargo(data)) continue;

      if (obj.isHeld || !obj.mesh.visible) {
        this.shipStableTimers.delete(id);
        if (data.loadedVehicleId) { data.loadedVehicleId = null; data.correctlyShipped = false; anyChanged = true; }
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
        if (data.loadedVehicleId) { data.loadedVehicleId = null; data.correctlyShipped = false; anyChanged = true; }
        continue;
      }

      if (data.loadedVehicleId) {
        if (data.loadedVehicleId !== target.config.id) {
          // Settled inside a DIFFERENT vehicle's bounds than before without
          // ever fully leaving a bay in between — re-derive correctness for
          // the new target rather than only retagging the id, so
          // correctlyShipped never goes stale for the wrong vehicle.
          data.loadedVehicleId = target.config.id;
          data.correctlyShipped = vehicleAcceptsCargo(target.config, data);
          anyChanged = true;
        }
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
        data.loadedVehicleId = target.config.id;
        data.correctlyShipped = vehicleAcceptsCargo(target.config, data);
        this.shipStableTimers.delete(id);
        anyChanged = true;
        // Fires on any physical load (correct or not) — a tutorial hint
        // ("you loaded something"), not a correctness signal; unchanged
        // from before this round's fix.
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
      // A pallet is never destroyed like shipped cargo is — it just leaves
      // the play space along with the vehicle for the rest of today;
      // PalletSystem.resetToStart() (called from DailyFlowSystem's daily
      // reset) makes it visible again, back on its own wall rack, next day.
      if (isPalletId(obj.id)) { obj.mesh.visible = false; continue; }
      // Mail bags aren't CargoData — route their teardown through
      // MailBagSystem itself so its own bag registry doesn't keep a stale
      // entry pointing at an already-destroyed InteractableObject.
      if (this.mailBagSystem.getBag(obj.id)) { this.mailBagSystem.removeShippedBag(obj.id); continue; }
      if (this.packedMailBagSystem.isBag(obj.id)) { this.packedMailBagSystem.removeShippedBag(obj.id); continue; }
      this.cargoSystem.removeCargo(obj.id);
    }
    this.pickupSystem.removePlacementSurface(vehicle.cargoBedTopMesh);
    vehicle.dispose();

    slot.vehicle = null;
    slot.pinnedCargo = [];
    slot.state = 'departed';

    this.checkAllDeparted();
  }

  /** Only fires once every one of TODAY's slots has independently finished
   * departing — `dayCompleteShown` guards against any slot's transition
   * re-firing this after the panel is already up (every slot stays
   * 'departed' the whole time the panel is open). "船運載具規格重製" round:
   * `this.slots` already IS exactly today's roster, so no separate unlock
   * filter is needed here anymore (compare the old isSlotUnlockedToday-based
   * filtering this replaced).
   *
   * "每日結算流程修改" round spec一: this is now the ONLY place a normal day
   * actually settles — there is no more player-facing 結束今天 button, so the
   * moment the player dismisses this summary panel the day must advance on
   * its own (see the showDayCompleteSummary(onSummaryClosed) call below,
   * same wiring the test cheat's forceSettleDayForTesting already used). */
  private checkAllDeparted(): void {
    if (this.slots.every((s) => s.state === 'departed') && !this.dayCompleteShown) {
      this.dayCompleteShown = true;
      this.showDayCompleteSummary(() => this.dailyFlowSystem.advanceToNextDay());
    }
  }

  /** Completion screen — reads the settlement snapshot computed back at
   * pressDepartButton() press time (total/success/unshipped/penalty/
   * finalScore), rather than re-deriving anything from CargoData (which is
   * no longer meaningful here — every daily cargo item, shipped or not, has
   * been destroyed by now: shipped ones via finishSlotDeparture above,
   * never-shipped ones will be swept up by DailyFlowSystem.advanceToNextDay's
   * own next-day cleanup, fired automatically once this panel closes — see
   * `onSummaryClosed` below). Falls back to an all-zero snapshot only
   * defensively (pendingSettlement is always set by pressDepartButton before
   * departure can even begin).
   *
   * `onSummaryClosed` fires AFTER the normal 繼續 handling, i.e. once the
   * summary panel is actually gone and the game is unpaused again — never
   * before, so anything it triggers (the day-1 dock-story NPC, the next
   * day's own cargo/vehicle/tool regeneration) can't fire hidden behind the
   * still-open panel/pause lock. Both real callers (checkAllDeparted above
   * for normal play, forceSettleDayForTesting below for the test cheat) pass
   * the SAME dailyFlowSystem.advanceToNextDay callback — there is no
   * cheat-only day-advance path to keep in sync. */
  private showDayCompleteSummary(onSummaryClosed?: () => void): void {
    const settlement = this.pendingSettlement ?? {
      total: this.dailyFlowSystem.totalCargoCount, shipped: 0, unshipped: 0, penalty: 0,
      lostFoundMissedCount: 0, lostFoundPenalty: 0,
      lostItemTotal: 0, lostItemHandedOver: 0, lostItemStoredCount: 0, lostItemUnstoredCount: 0, lostItemPenalty: 0,
      mailTotal: 0, mailShipped: 0, mailUnshipped: 0, mailPenalty: 0,
      frozenTotal: 0, frozenTier100: 0, frozenTier75: 0, frozenTier50: 0, frozenTier25: 0, frozenPenalty: 0,
      liveTotal: 0, liveComfortableCount: 0, liveAnxiousCount: 0, liveScaredCount: 0, liveBonus: 0,
      // "統一結算分數" round — this all-zero defensive fallback's own
      // finalScore is now a genuine 0, matching every other zeroed field
      // here (was settingsManager.progress.score, the legacy currency this
      // round removed from the settlement UI entirely).
      finalScore: 0,
    };
    this.pendingSettlement = null;

    this.dailyFlowSystem.notifyDayComplete();
    this.onPauseChange(true);
    this.hud.showDayCompleteSummary({
      ...settlement,
      onContinue: () => {
        // "船運載具規格重製" round — no longer resets slot.state here. The
        // REAL teardown+rebuild now happens later, at resetForNewDay() (see
        // its own doc comment), fired from the SAME resetTools sequence
        // cargo/mail/lost-found already reset through once
        // onSummaryClosed's advanceToNextDay() call below actually runs —
        // a genuinely separate, later moment than this 繼續 click
        // (dailyFlowSystem.state stays 'dayComplete' in between, so
        // canCall/canDepart already can't fire regardless of this class's
        // own slot.state in that window).
        this.dayCompleteShown = false;
        this.onPauseChange(false);
        onSummaryClosed?.();
      },
    });
  }

  /** TEMPORARY TEST CHEAT — remove before public demo. The settlement half
   * of the "完成當日" cheat button (complete-day-cheat-system.ts) — bypasses
   * the real six-vehicle dock/load/depart animation sequence entirely, but
   * still computes the settlement via the SAME ScoringSystem.settleDeparture()
   * the real departure flow uses (never touches CargoData.correctlyShipped
   * or fabricates a score directly) and opens the SAME real day-complete
   * summary screen via the exact private showDayCompleteSummary() the real
   * flow itself calls from checkAllDeparted(). The caller (the cheat system)
   * has already marked every daily cargo/envelope/NPC as complete via each
   * system's own real API before calling this — `cargoTotal`/`lostFound`/
   * `mail` are those already-computed real tallies, not fabricated here.
   *
   * "Trigger day one story after cheat completion" round: once the player
   * dismisses this summary panel, also calls the SAME real day-advance entry
   * point (DailyFlowSystem.advanceToNextDay) normal play uses — never a
   * second/parallel day-completion path, never a direct currentDay mutation.
   * That real function itself captures `finishedDay` BEFORE incrementing
   * currentDay and fires the pre-existing onDayCompleted(finishedDay) hook
   * (create-game-systems.ts), which already unconditionally calls
   * afterWorkStorySystem.trigger(finishedDay) — a no-op for any day without
   * a story entry, or one already played, so day-1-only and play-once-only
   * are both enforced by that existing code, not duplicated here. */
  forceSettleDayForTesting(
    cargoTotal: number, lostFound: LostFoundSettlementInput, mail: MailSettlementInput, frozen: FrozenSettlementInput,
    live: LiveSettlementInput
  ): void {
    this.pendingSettlement = this.scoringSystem.settleDeparture(cargoTotal, cargoTotal, 0, lostFound, mail, frozen, live);
    this.showDayCompleteSummary(() => this.dailyFlowSystem.advanceToNextDay());
  }
}
