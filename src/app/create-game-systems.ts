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
import { MailSystem } from '../systems/mail/mail-system';
import { MailBagSystem } from '../systems/mail/mail-bag-system';
import { UpgradeSystem, UpgradeMenuUI, SimilarCargoHighlight } from '../systems/upgrade';
import { MediaPlayerSystem } from '../systems/media-player/media-player-system';
import { MediaPlayerUI } from '../systems/media-player/media-player-ui';
import { ToolSystem } from '../systems/tool';
import { CargoHookSystem } from '../systems/cargo-hook';
import { SpraySystem } from '../systems/spray-paint';

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
  /** Old sorting-box system (feature-flagged off, ENABLE_LEGACY_MAIL_FLOW)
   * — kept intact and this name preserved for continuity with the rest of
   * this file's own prior history; renamed the local VARIABLE from its
   * previous ambiguous `mailBagSystem` (which collided with this round's
   * genuinely new MailBagSystem class below) to `sortingBoxSystem`,
   * matching what it actually is. */
  sortingBoxSystem: SortingBoxSystem;
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
  /** "Add modular envelope stamping and regional mail bag system" round. */
  mailSystem: MailSystem;
  mailBagSystem: MailBagSystem;
  /** "Add bulletin board upgrade system" round. */
  upgradeSystem: UpgradeSystem;
  similarCargoHighlight: SimilarCargoHighlight;
  /** "Add television media playlist" round. */
  mediaPlayerSystem: MediaPlayerSystem;
  /** "Add tool hotbar and cargo hook" round. */
  toolSystem: ToolSystem;
  cargoHookSystem: CargoHookSystem;
  /** "Fix pallet throw and add spray paint tool" round. */
  spraySystem: SpraySystem;
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
  /** Opens this round's own mail stamp-table UI ("Add modular envelope
   * stamping and regional mail bag system" round 四) — reuses
   * PauseManager's existing 'stampMinigame' reason (never a new one, spec:
   * "使用現有PauseManager") and playerData's existing 'stamping-minigame'
   * state, exactly like the legacy onStartEnvelopeMinigame above; kept as
   * its OWN callback rather than reusing that one since it opens a
   * different UI class against a different registry (MailSystem, not the
   * old EnvelopeStampStation/PackageData). */
  onStartMailStampUi: () => void;
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
  const sortingBoxSystem = new SortingBoxSystem(scene, physics, interactables, ENABLE_LEGACY_MAIL_FLOW);
  const mailSortingSystem = new MailSortingSystem(
    sortingBoxSystem, interactables, physics, envelopeSystem.envelopeDataMap, hud,
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
    camera, context.renderer.domElement, hud, physics, playerData, settingsManager, interactables
  );

  // Pickup system
  const pickupSystem = new PickupSystem(
    camera, scene, playerData, interactables, hud, physics, sceneData.floor,
    pauseManager, settingsManager
  );

  // Bulletin board upgrade system ("Add bulletin board upgrade system"
  // round) — constructed as early as pickupSystem/playerController exist,
  // since both scoringSystem's onSettlement hook and dailyFlowSystem's
  // onDayCompleted hook (both further below) need to already be able to
  // call into it. UpgradeSystem only ever reaches PickupSystem/
  // PlayerController through their own narrow public setters (spec三) —
  // never touches mail/lost-found/vehicle/cargo-generation systems.
  const upgradeSystem = new UpgradeSystem(pickupSystem, playerController);
  const upgradeMenuUI = new UpgradeMenuUI(pauseManager, hud, playerController, upgradeSystem);
  const similarCargoHighlight = new SimilarCargoHighlight(scene);

  // West-wall television media player ("Add television media playlist"
  // round) — same "system owns state, UI owns DOM" split as the upgrade
  // menu just above, and the same PauseManager/pointer-lock convention.
  // Uses the label/screen-material handles WorldLayoutSystem already built
  // (sceneData.television) — this file never touches Three.js geometry
  // itself for it.
  const mediaPlayerSystem = new MediaPlayerSystem(sceneData.television.label, sceneData.television.screenMaterial);
  const mediaPlayerUI = new MediaPlayerUI(pauseManager, playerController, mediaPlayerSystem);

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
  for (const plane of sortingBoxSystem.interiorPlanes.values()) {
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

  // Register each west-wall storage shelf's own level-top boards as
  // placement surfaces ("Add storage shelves along west wall" round spec
  // 三) — the boards' side panels/posts/back frame are real static
  // colliders (world-layout-system.ts) but were never added here, so they
  // can only ever block movement/raycasts, never become a placement
  // surface themselves.
  for (const surface of sceneData.shelfSurfaces) {
    pickupSystem.addPlacementSurface(surface);
  }

  // West-side lost & found desk — minimal one-case flow (spec三). Built
  // after pickupSystem exists (tryConfirmAtCounter consumes the held item
  // via pickupSystem.forceDropHeld() on success).
  const lostFoundUI = new LostFoundUI();
  const lostFoundSystem = new LostFoundSystem(
    scene, physics, interactables, pickupSystem, lostFoundUI
  );

  // Mail/envelope-stamping loop ("Add modular envelope stamping and
  // regional mail bag system" round) — MailSystem owns the envelope
  // registry + daily spawn + stamp table; MailBagSystem owns the empty-bag
  // rack + every bag's own lifecycle, calling back into MailSystem to keep
  // envelope state in ONE place. Built after pickupSystem exists (both
  // register placement surfaces / call forceDropHeld() on reset).
  const mailSystem = new MailSystem(scene, physics, interactables, pickupSystem);
  const mailBagSystem = new MailBagSystem(scene, physics, interactables, pickupSystem, hud, mailSystem);
  // Wired after both exist (avoids a constructor-time circular dependency —
  // MailBagSystem's own constructor already takes pickupSystem) — see
  // MailBoxCarryHooks' own doc comment in pickup-system.ts ("Remove sealing
  // and add physical mail box contents" round三/十).
  pickupSystem.setMailBoxHooks({
    isMailBox: (obj) => mailBagSystem.isMailBox(obj),
    prepareForCarry: (obj) => mailBagSystem.prepareContentsForCarry(obj),
    restoreAfterPlacement: (obj, boxVelocity) => mailBagSystem.restoreContentsAfterPlacement(obj, boxVelocity),
    restoreForThrow: (obj, linearVelocity, angularVelocity) => mailBagSystem.restoreContentsForThrow(obj, linearVelocity, angularVelocity),
  });
  // "Allow mail box pattern changes with contents" round: lets
  // settleAtDeparture exclude a bagged envelope whose own destination no
  // longer matches its bag's live pattern, without MailSystem needing any
  // direct MailBagSystem import/reference of its own.
  mailSystem.setBagPatternLookup((bagId) => mailBagSystem.getBag(bagId)?.destinationPattern ?? null);

  // Daily unload -> sort -> ship-via-vehicle loop (this round's core).
  // DailyFlowSystem owns the day/state/count bookkeeping and the 結束今天
  // button; UnloadingSystem owns the north gate/chute/spawn sequence and
  // the 開始卸貨 button; VehicleControlSystem (re-enabled this round —
  // spec "北側卸貨口/重新啟用呼叫載具" section 六) now also owns the
  // organized-cargo-into-cargoBounds shipment judgment. All three report
  // into DailyFlowSystem rather than it reaching into them. Constructed
  // BEFORE VehicleControlSystem/UnloadingSystem since both need it.
  // onAllVehiclesDeparted callback removed ("Spawn lost found NPC during
  // unloading and penalize missed interaction" round 六: "不要再使用
  // vehiclesDeparted → spawn NPC") — the lost-found NPC no longer spawns
  // on departure; it now spawns from UnloadingSystem's onFirstUnload
  // callback below, alongside the case, via lostFoundSystem.
  // onDailyUnloadStarted().
  const dailyFlowSystem = new DailyFlowSystem(
    scene, physics, cargoSystem, hud,
    () => {
      dollySystem.resetToStart(); unloadingSystem.resetGate(); palletSystem.resetToStart();
      lostFoundSystem.resetDaily();
      // Mail state clears the SAME way every other daily fixture does
      // (spec十二) — bags first, so any bag-held envelope reference is
      // gone before MailSystem sweeps every remaining envelope id.
      mailBagSystem.resetDaily();
      mailSystem.resetDaily();
    },
    (finishedDay) => {
      settingsManager.fireTutorialEvent('dayCompleted');
      // Converts that day's accumulated departure settlement(s) into
      // upgrade points, exactly once per finishedDay (spec四) — see
      // UpgradeSystem.settleDay's own doc comment for the idempotency
      // guard.
      upgradeSystem.settleDay(finishedDay);
    }
  );

  // Vehicle spawn/depart control (hall center) — re-enabled this round
  // (see feature-flags.ts ENABLE_VEHICLE_LOADING_FLOW). Needs
  // pickupSystem to register/deregister the cargo bed surface as vehicles
  // come and go, and dailyFlowSystem to gate 呼叫/出發 on today's
  // unload/shipment progress instead of the old always-available rule.
  const scoringSystem = new ScoringSystem(
    settingsManager,
    // Feeds each departure's settlement into UpgradeSystem's own day tally
    // (spec四) — reads only the numbers ScoringSystem just computed for
    // THIS departure, no re-scanning of cargo/vehicle state.
    (settlement) => upgradeSystem.recordDepartureSettlement(settlement)
  );
  const vehicleControlSystem = new VehicleControlSystem(
    scene, physics, interactables, cargoSystem, pickupSystem, hud,
    dailyFlowSystem,
    settingsManager,
    scoringSystem,
    mailSystem,
    mailBagSystem,
    hooks.onPauseChange,
    (config) => settingsManager.markVehicleDiscovered(config.id),
    () => settingsManager.fireTutorialEvent('vehicleCalled'),
    () => settingsManager.fireTutorialEvent('cargoLoaded'),
    () => settingsManager.fireTutorialEvent('vehicleDeparted'),
    // Settles today's lost-found missed-interaction AND lost-item storage
    // penalties at the exact moment 載具出發 is pressed — see
    // LostFoundSystem.settleAtDeparture.
    () => lostFoundSystem.settleAtDeparture(),
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
      // Today's 12 envelopes burst in alongside regular cargo from the SAME
      // two north ports (spec二) — UnloadingSystem itself is never touched
      // for this (spec: 不要修改北側雙到貨口位置).
      mailSystem.onDailyUnloadStarted();
    }
  );
  const palletSystem = new PalletSystem(
    scene, physics, cargoSystem, interactables, playerData, hud, pauseManager, upgradeSystem,
    () => settingsManager.fireTutorialEvent('palletUsed'),
    () => settingsManager.fireTutorialEvent('boxOrganized')
  );
  // "Add placement rotation and pallet cargo straps" round spec三: lets
  // pickup-system.ts's own generic executeThrow() correctly throw the
  // pallet (its body is otherwise permanently kinematic) — see
  // PalletThrowHooks' own doc comment in pickup-system.ts. PalletSystem
  // implements the interface directly, so no separate adapter object.
  pickupSystem.setPalletThrowHooks(palletSystem);
  // Still registered as a normal PickupSystem placement surface — a
  // single cargo item can still be manually placed onto any pallet's top
  // the normal way (spec: this round only adds the ABILITY to also pick
  // up the whole pallet, it doesn't remove normal single-item placement).
  // "Rebuild pallet storage and reset upgrade progression" round三: now
  // three separate pallet meshes (small/medium/large), each registered.
  for (const mesh of palletSystem.getAllTopMeshes()) {
    pickupSystem.addPlacementSurface(mesh);
  }
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

  // Tool hotbar + cargo hook ("Add tool hotbar and cargo hook" round) —
  // built after playerController/pickupSystem/cargoSystem/dailyFlowSystem
  // all already exist since CargoHookSystem reads all four. ToolSystem
  // deliberately has no reference to CargoHookSystem at all — see
  // tool-system.ts's own doc comment on why no callback wiring is needed in
  // either direction (CargoHookSystem watches playerData.activeTool itself).
  const toolSystem = new ToolSystem(playerData, hud, pauseManager, () => playerController.isLocked, pickupSystem);
  const cargoHookSystem = new CargoHookSystem(
    camera, scene, pickupSystem.viewModelScene, physics, interactables, cargoSystem,
    playerData, hud, pauseManager, dailyFlowSystem, pickupSystem, toolSystem, () => playerController.isLocked
  );

  // Spray paint tool ("Fix pallet throw and add spray paint tool" round
  // spec五, hotbar slot 4) — restricted to the same real floor meshes
  // PickupSystem itself places items on (main back-area floor, pier deck,
  // lost-found room floor), which is what keeps cargo/pallet/shelves/walls/
  // vehicles/NPCs impossible to spray on without needing any exclusion list
  // of its own (see spray-paint-system.ts's own doc comment).
  const spraySystem = new SpraySystem(
    camera, scene, playerData, hud, pauseManager,
    [sceneData.floor, sceneData.pierFloor, sceneData.lostFoundFloor],
    () => playerController.isLocked
  );

  // Interaction system
  const interactionSystem = new InteractionSystem(
    camera, interactables, playerData, pickupSystem, hud,
    () => playerController.isLocked,
    envelopeSystem,
    envelopeStation,
    hooks.onStartEnvelopeMinigame,
    sortingBoxSystem,
    vehicleControlSystem,
    counterServiceSystem,
    dollySystem,
    pauseManager,
    settingsManager,
    unloadingSystem,
    dailyFlowSystem,
    palletSystem,
    lostFoundSystem,
    mailSystem,
    mailBagSystem,
    hooks.onStartMailStampUi,
    () => upgradeMenuUI.open(),
    () => mediaPlayerUI.open(),
    () => settingsManager.fireTutorialEvent('dollyUsed')
  );

  // 異世界物流手冊 — pause menu / tutorial / settings / codex (spec round).
  // Not stored anywhere: nothing else needs to reference it after
  // construction (it manages its own DOM/listeners internally).
  new ManualUI(pauseManager, settingsManager, hud, hooks.onInterruptPlayerActions);

  return {
    playerController, interactionSystem, pickupSystem, envelopeStation, envelopeSystem,
    sortingBoxSystem, mailSortingSystem, cargoSystem, dollySystem, vehicleControlSystem,
    scoringSystem, counterNpcSystem, counterServiceSystem, compassUI, dailyFlowSystem,
    unloadingSystem, palletSystem, cargoInspectionSystem, cargoInspectionUI,
    lostFoundSystem, lostFoundUI, mailSystem, mailBagSystem,
    upgradeSystem, similarCargoHighlight, mediaPlayerSystem,
    toolSystem, cargoHookSystem, spraySystem,
  };
}
