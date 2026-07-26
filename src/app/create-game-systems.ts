import { GameContext } from './game-context';
import { PlayerController } from '../systems/player';
import { InteractionSystem, PickupSystem } from '../systems/interaction';
import { EnvelopeSystem } from '../game/envelope-system';
import { EnvelopeStampStation } from '../game/envelope-stamp-station';
import { SortingBoxSystem } from '../game/sorting-box-system';
import { MailSortingSystem } from '../game/mail-sorting-system';
import { CargoSystem } from '../systems/cargo';
import { DollySystem } from '../game/dolly-system';
import { VehicleControlSystem } from '../systems/vehicle';
import { ScoringSystem } from '../systems/scoring';
import { CounterNpcSystem } from '../game/counter-npc-system';
import { CounterServiceSystem } from '../game/counter-service-system';
import { CompassUI } from '../game/compass-ui';
import { ManualUI } from '../systems/pause-menu';
import { ENABLE_LEGACY_COUNTER, ENABLE_LEGACY_MAIL_FLOW, ENABLE_VEHICLE_LOADING_FLOW, ENABLE_LEGACY_TEST_CARGO } from '../game/feature-flags';
import { DailyFlowSystem } from '../systems/daily-flow';
import { UnloadingSystem } from '../systems/unloading';
import { PalletSystem } from '../systems/pallet';
import { CargoInspectionSystem, CargoInspectionUI } from '../systems/cargo-inspection';
import { LostFoundSystem, LostFoundUI } from '../systems/lost-found';

/** Every gameplay system GameApp constructs once at startup and keeps for
 * the rest of the session (Phase 6: "系統建立、建構子注入、註冊" moved out of
 * game-app.ts). Excludes `stampMinigame`, which is created/destroyed
 * per-minigame rather than once at startup, so it stays a GameApp-owned
 * field instead. */
export interface GameSystems {
  playerController: PlayerController;
  interactionSystem: InteractionSystem;
  pickupSystem: PickupSystem;
  envelopeStation: EnvelopeStampStation;
  envelopeSystem: EnvelopeSystem;
  mailBagSystem: SortingBoxSystem;
  mailSortingSystem: MailSortingSystem;
  cargoSystem: CargoSystem;
  dollySystem: DollySystem;
  vehicleControlSystem: VehicleControlSystem;
  scoringSystem: ScoringSystem;
  counterNpcSystem: CounterNpcSystem;
  counterServiceSystem: CounterServiceSystem;
  compassUI: CompassUI;
  dailyFlowSystem: DailyFlowSystem;
  unloadingSystem: UnloadingSystem;
  palletSystem: PalletSystem;
  cargoInspectionSystem: CargoInspectionSystem;
  cargoInspectionUI: CargoInspectionUI;
  lostFoundSystem: LostFoundSystem;
  lostFoundUI: LostFoundUI;
}

/** Back-references into GameApp's own small orchestration methods — the
 * only things createGameSystems() can't construct standalone, since each
 * one touches cross-system state (the player controller plus whichever
 * systems are mid-interaction) that only exists once this function has
 * finished building everything. Safe to pass as plain closures: none of
 * these fire until well after start() returns (they're all triggered by
 * later player input/UI clicks), by which point GameApp has already stored
 * the GameSystems this function returns. */
export interface GameSystemsHooks {
  onPauseChange: (paused: boolean) => void;
  onStartEnvelopeMinigame: () => void;
  onInterruptPlayerActions: () => void;
}

/**
 * Pure assembly — constructs every gameplay system, wires their constructor
 * dependencies/callbacks, and registers the placement surfaces each needs.
 * Contains no gameplay RULES of its own (spec: "只負責組裝，不包含玩法規
 * 則") — every behavioral decision (what happens when a day completes, how
 * a vehicle judges loaded cargo, etc.) lives inside the systems being
 * constructed here, never in this function.
 */
export function createGameSystems(context: GameContext, hooks: GameSystemsHooks): GameSystems {
  const { scene, camera, physics, hud, pauseManager, settingsManager, playerData, interactables, sceneData } = context;

  // Envelope system + station — disabled this round (spec "每日貨品清空
  // 核心流程" section 三: envelope work equipment must not appear in the
  // main scene), classes kept intact via feature-flags.ts ENABLE_LEGACY_MAIL_FLOW.
  const envelopeSystem = new EnvelopeSystem(scene, physics, interactables, ENABLE_LEGACY_MAIL_FLOW);
  const envelopeStation = new EnvelopeStampStation(scene, physics, interactables, ENABLE_LEGACY_MAIL_FLOW);

  // Mail sorting box system — same flag
  const mailBagSystem = new SortingBoxSystem(scene, physics, interactables, ENABLE_LEGACY_MAIL_FLOW);
  const mailSortingSystem = new MailSortingSystem(
    mailBagSystem, interactables, physics, envelopeSystem.envelopeDataMap, hud,
    () => settingsManager.fireTutorialEvent('sorting')
  );

  // Normal cargo prototype (spawned before pickupSystem so surfaces below
  // register cleanly) — legacy test cargo (labeled/large/normal) is
  // disabled this round (spec 三/十四: "不要生成舊的測試包裹"); daily-flow
  // cargo spawns separately, on demand, via UnloadingSystem below.
  const cargoSystem = new CargoSystem(scene, physics, interactables, ENABLE_LEGACY_TEST_CARGO);

  // Back-area flatbed dolly — pushable, not hand-carried (see dolly-system.ts)
  const dollySystem = new DollySystem(scene, physics, interactables, cargoSystem);

  // ConveyorSystem is intentionally NOT constructed this round — the
  // cargo window + ramp it drove cargo along were part of the
  // front-office/dividing-wall structure removed entirely in the "刪除北
  // 邊房間" round (see world-layout-system.ts). Its class file is kept for
  // a possible future round.

  // Counter NPC service prototype (front office) — disabled this round
  // (spec section 三: no NPC open-for-business button/queue in the main
  // scene), see feature-flags.ts ENABLE_LEGACY_COUNTER.
  const counterNpcSystem = new CounterNpcSystem(scene);
  const counterServiceSystem = new CounterServiceSystem(
    scene, physics, interactables, counterNpcSystem, hud, ENABLE_LEGACY_COUNTER
  );

  const compassUI = new CompassUI();

  // Player controller
  const playerController = new PlayerController(
    camera, context.renderer.domElement, hud, physics, playerData, settingsManager
  );

  // Pickup system
  const pickupSystem = new PickupSystem(
    camera, scene, playerData, interactables, hud, physics, sceneData.floor,
    pauseManager, settingsManager
  );

  // Register the envelope stamp table top as a placement surface — only
  // exists when the legacy mail flow is enabled (tableTopMesh stays
  // unbuilt otherwise, see envelope-stamp-station.ts).
  if (ENABLE_LEGACY_MAIL_FLOW) {
    pickupSystem.addPlacementSurface(envelopeStation.tableTopMesh);
  }

  // Register the pier deck as an additional placement surface (the main
  // back-area floor is already PickupSystem's default surface, passed in
  // above as sceneData.floor) — a docked vehicle registers/deregisters
  // its own cargo bed surface as it comes and goes.
  pickupSystem.addPlacementSurface(sceneData.pierFloor);

  // Register sorting box interior planes as placement surfaces
  for (const plane of mailBagSystem.interiorPlanes.values()) {
    pickupSystem.addPlacementSurface(plane);
  }
  // Register incoming crate interior plane
  if (envelopeSystem.interiorPlane) {
    pickupSystem.addPlacementSurface(envelopeSystem.interiorPlane);
  }
  // Register the dolly's platform top as a placement surface — lets
  // players precisely place cargo onto it without pushing it around
  pickupSystem.addPlacementSurface(dollySystem.platformTopMesh);

  // Register the lost-found room's own floor (a separate mesh from the
  // main back-area floor) as a placement surface, so items can be
  // dropped/placed while standing in it ("Reduce daily cargo and add
  // lost found desk" round 二).
  pickupSystem.addPlacementSurface(sceneData.lostFoundFloor);

  // West-side lost & found desk — minimal one-case flow (spec三). Built
  // after pickupSystem exists (tryConfirmAtCounter consumes the held item
  // via pickupSystem.forceDropHeld() on success).
  const lostFoundUI = new LostFoundUI();
  const lostFoundSystem = new LostFoundSystem(
    scene, physics, interactables, pickupSystem, lostFoundUI
  );

  // Daily unload -> sort -> ship-via-vehicle loop (this round's core).
  // DailyFlowSystem owns the day/state/count bookkeeping and the 結束今天
  // button; UnloadingSystem owns the north gate/chute/spawn sequence and
  // the 開始卸貨 button; VehicleControlSystem (re-enabled this round —
  // spec "北側卸貨口/重新啟用呼叫載具" section 六) now also owns the
  // organized-cargo-into-cargoBounds shipment judgment. All three report
  // into DailyFlowSystem rather than it reaching into them. Constructed
  // BEFORE VehicleControlSystem/UnloadingSystem since both need it.
  const dailyFlowSystem = new DailyFlowSystem(
    scene, physics, cargoSystem, hud,
    () => {
      dollySystem.resetToStart(); unloadingSystem.resetGate(); palletSystem.resetToStart();
      lostFoundSystem.resetDaily();
    },
    () => settingsManager.fireTutorialEvent('dayCompleted'),
    () => lostFoundSystem.onAllVehiclesDeparted()
  );

  // Vehicle spawn/depart control (hall center) — re-enabled this round
  // (see feature-flags.ts ENABLE_VEHICLE_LOADING_FLOW). Needs
  // pickupSystem to register/deregister the cargo bed surface as vehicles
  // come and go, and dailyFlowSystem to gate 呼叫/出發 on today's
  // unload/shipment progress instead of the old always-available rule.
  const scoringSystem = new ScoringSystem(settingsManager);
  const vehicleControlSystem = new VehicleControlSystem(
    scene, physics, interactables, cargoSystem, pickupSystem, hud,
    dailyFlowSystem,
    settingsManager,
    scoringSystem,
    hooks.onPauseChange,
    (config) => settingsManager.markVehicleDiscovered(config.id),
    () => settingsManager.fireTutorialEvent('vehicleCalled'),
    () => settingsManager.fireTutorialEvent('cargoLoaded'),
    () => settingsManager.fireTutorialEvent('vehicleDeparted'),
    ENABLE_VEHICLE_LOADING_FLOW
  );

  const unloadingSystem = new UnloadingSystem(
    scene, physics, cargoSystem, dailyFlowSystem,
    () => {
      settingsManager.fireTutorialEvent('unloadingStarted');
      // Cargo carries its category label the moment it bursts into the
      // room, so "辨識貨品種類" unlocks alongside "啟動北側卸貨口" rather
      // than needing a separate dedicated trigger.
      settingsManager.fireTutorialEvent('cargoLabelSeen');
      // "Expand modular lost found NPC flow" round 六: today's lost item
      // bursts in alongside the regular cargo — picks today's case and
      // arms its own short spawn delay. UnloadingSystem itself is never
      // touched for this (spec: 不要修改北側雙到貨口).
      lostFoundSystem.onDailyUnloadStarted();
    }
  );
  const palletSystem = new PalletSystem(
    scene, physics, cargoSystem, interactables, playerData, hud,
    () => settingsManager.fireTutorialEvent('palletUsed'),
    () => settingsManager.fireTutorialEvent('boxOrganized')
  );
  // Still registered as a normal PickupSystem placement surface — a
  // single cargo item can still be manually placed onto the pallet's top
  // the normal way (spec: this round only adds the ABILITY to also pick
  // up the whole pallet, it doesn't remove normal single-item placement).
  pickupSystem.addPlacementSurface(palletSystem.topMesh);
  // RollerRackSystem removed entirely ("移除滾筒架" round) — roller-shaped
  // cargo is now just a normal special-shape item like 'large', freely
  // placeable/loadable with no dedicated fixture or organizing step of its
  // own (see cargo-data.ts's `organized` field doc comment).
  // OutboundZoneSystem is intentionally NOT constructed this round — cargo
  // now ships by riding along with a vehicle instead of walking into a
  // ground zone (spec section 八/九). Its file is kept for a possible
  // future round; see feature-flags.ts and outbound-zone-system.ts.

  // 貨物種類準心檢視 UI — read-only crosshair inspection, entirely separate
  // from pickup/interaction. See systems/cargo-inspection for the actual
  // logic; GameApp only constructs and updates them.
  const cargoInspectionSystem = new CargoInspectionSystem(camera, scene, cargoSystem, pauseManager);
  const cargoInspectionUI = new CargoInspectionUI();

  // Interaction system
  const interactionSystem = new InteractionSystem(
    camera, interactables, playerData, pickupSystem, hud,
    () => playerController.isLocked,
    envelopeSystem,
    envelopeStation,
    hooks.onStartEnvelopeMinigame,
    mailBagSystem,
    vehicleControlSystem,
    counterServiceSystem,
    dollySystem,
    pauseManager,
    settingsManager,
    unloadingSystem,
    dailyFlowSystem,
    palletSystem,
    lostFoundSystem,
    () => settingsManager.fireTutorialEvent('dollyUsed')
  );

  // 異世界物流手冊 — pause menu / tutorial / settings / codex (spec round).
  // Not stored anywhere: nothing else needs to reference it after
  // construction (it manages its own DOM/listeners internally).
  new ManualUI(pauseManager, settingsManager, hud, hooks.onInterruptPlayerActions);

  return {
    playerController, interactionSystem, pickupSystem, envelopeStation, envelopeSystem,
    mailBagSystem, mailSortingSystem, cargoSystem, dollySystem, vehicleControlSystem,
    scoringSystem, counterNpcSystem, counterServiceSystem, compassUI, dailyFlowSystem,
    unloadingSystem, palletSystem, cargoInspectionSystem, cargoInspectionUI,
    lostFoundSystem, lostFoundUI,
  };
}
