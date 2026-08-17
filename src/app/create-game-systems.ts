import { GameContext } from './game-context';
import { getRequiredStampForMailDestination } from '../data/world/stamp-collection-data';
import { PlayerController } from '../systems/player';
import { InteractionSystem, PickupSystem } from '../systems/interaction';
import { EnvelopeSystem } from '../game/envelope-system';
import { EnvelopeStampStation } from '../game/envelope-stamp-station';
import { SortingBoxSystem } from '../game/sorting-box-system';
import { MailSortingSystem } from '../game/mail-sorting-system';
import { CargoSystem } from '../systems/cargo';
import { DollySystem } from '../systems/dolly/dolly-system';
import { VehicleControlSystem } from '../systems/vehicle';
import { ScoringSystem } from '../systems/scoring';
import { CounterNpcSystem } from '../game/counter-npc-system';
import { CounterServiceSystem } from '../game/counter-service-system';
import { CompassUI } from '../systems/hud/compass-ui';
import { ManualUI } from '../systems/pause-menu';
import { ENABLE_LEGACY_COUNTER, ENABLE_LEGACY_MAIL_FLOW, ENABLE_VEHICLE_LOADING_FLOW, ENABLE_LEGACY_TEST_CARGO } from '../core/feature-flags';
import { DailyFlowSystem } from '../systems/daily-flow';
import { UnloadingSystem } from '../systems/unloading';
import { PalletSystem } from '../systems/pallet';
import { CargoInspectionSystem, CargoInspectionUI } from '../systems/cargo-inspection';
import { LostFoundSystem, LostFoundUI, LostFoundCleaningSystem } from '../systems/lost-found';
import { MailSystem } from '../systems/mail/mail-system';
import { MailBagSystem } from '../systems/mail/mail-bag-system';
import { PackedMailBagSystem } from '../systems/mail/packed-mail-bag-system';
import { EnvelopeDispatchMachineSystem } from '../systems/mail/envelope-dispatch-machine-system';
import { EnvelopeStackSystem } from '../systems/mail/envelope-stack-system';
import { UpgradeSystem, UpgradeMenuUI } from '../systems/upgrade';
import { SimilarCargoHighlight } from '../systems/cargo/similar-cargo-highlight';
import { MediaPlayerSystem } from '../systems/media-player/media-player-system';
import { MediaPlayerUI } from '../systems/media-player/media-player-ui';
import { ToolSystem } from '../systems/tool';
import { ToolLoadoutMenuUI } from '../systems/tool/tool-loadout-menu-ui';
import { CargoHookSystem } from '../systems/cargo-hook';
import { SpraySystem } from '../systems/spray-paint';
// "Add ladder tool station and envelope vacuum" round.
import { LadderSystem } from '../systems/ladder/ladder-system';
import { ToolStationSystem } from '../systems/tool/tool-station-system';
import { EnvelopeVacuumSystem } from '../systems/mail/envelope-vacuum-system';
// "Add day one dock story event" round.
import { AfterWorkStorySystem } from '../systems/story/after-work-story-system';
import { ProtagonistDialogueSystem } from '../systems/dialogue/protagonist-dialogue-system';
import { MascotGuideSystem } from '../systems/mascot/mascot-guide-system';
import { DreamComicSystem } from '../systems/dream-comic/dream-comic-system';
import { ItemRewardSystem } from '../systems/item-reward/item-reward-system';
import { VehicleNightCleaningSystem } from '../systems/vehicle-night-cleaning/vehicle-night-cleaning-system';
// "Add complete day testing cheat button" round.
import { CompleteDayCheatSystem } from '../systems/cheat/complete-day-cheat-system';
// "Add main menu and return player after dock story" round.
import { MainMenuSystem } from '../systems/main-menu/main-menu-system';
import { loadRunState, saveRunState, generateRunId } from '../systems/main-menu/run-state-data';
// "Add freezer shelves and frozen cargo freshness system" round.
import { FreezerSystem } from '../systems/cargo/freezer-system';
import { LivingCargoSystem } from '../systems/cargo/living-cargo-system';

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
  /** "Add lost-found item cleaning system" round. */
  lostFoundCleaningSystem: LostFoundCleaningSystem;
  /** "Add modular envelope stamping and regional mail bag system" round. */
  mailSystem: MailSystem;
  mailBagSystem: MailBagSystem;
  /** "Add envelope stacks and expand pallet inventory" round. */
  envelopeStackSystem: EnvelopeStackSystem;
  /** "Add regional envelope dispatch machine" round. */
  packedMailBagSystem: PackedMailBagSystem;
  envelopeDispatchMachineSystem: EnvelopeDispatchMachineSystem;
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
  /** "Add ladder tool station and envelope vacuum" round. */
  ladderSystem: LadderSystem;
  toolStationSystem: ToolStationSystem;
  envelopeVacuumSystem: EnvelopeVacuumSystem;
  /** "Add day one dock story event" round. */
  afterWorkStorySystem: AfterWorkStorySystem;
  /** "男主角台詞系統＋特殊NPC劇情選擇" round — generic, reusable independent
   * of AfterWorkStorySystem (which only holds a read reference to drive its
   * own protagonist-speaker entries); exposed here so future callers (e.g. a
   * later environment-object interaction round) can reach it too without
   * needing to go through AfterWorkStorySystem. */
  protagonistDialogueSystem: ProtagonistDialogueSystem;
  /** "新增兔子吉祥物" round — permanent guide/lore character, independent of
   * AfterWorkStorySystem/ProtagonistDialogueSystem. */
  mascotGuideSystem: MascotGuideSystem;
  /** "每日起床＋夢境漫畫" round. */
  dreamComicSystem: DreamComicSystem;
  /** "載具夜間清潔互動" round. */
  vehicleNightCleaningSystem: VehicleNightCleaningSystem;
  /** "Add complete day testing cheat button" round. */
  completeDayCheatSystem: CompleteDayCheatSystem;
  /** "Add main menu and return player after dock story" round. */
  mainMenuSystem: MainMenuSystem;
  /** "Add freezer shelves and frozen cargo freshness system" round. */
  freezerSystem: FreezerSystem;
  /** "活物貨物系統" round. */
  livingCargoSystem: LivingCargoSystem;
  /** "每日獲得道具" round. */
  itemRewardSystem: ItemRewardSystem;
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

  // Mail/envelope-stamping loop ("Add modular envelope stamping and
  // regional mail bag system" round) — MailSystem moved up to construct
  // here (was previously built much later, right before MailBagSystem)
  // specifically so it exists in time for EnvelopeStackSystem/UpgradeSystem
  // just below, both of which need a live reference at their own
  // construction time. Only needs pickupSystem, already built just above.
  const mailSystem = new MailSystem(
    scene, physics, interactables, pickupSystem,
    // "郵票系統重新區分" round spec五/九/十二 — fires ONLY on a successful
    // stamp-table processing (mail-system.ts's applyStamp, never at spawn/
    // pickup/drop). Registers BOTH collectibles into the SAME idempotent
    // settingsManager.collectedStamps array (spec六/十一: no second
    // collection data structure): the region's own required stamp (spec
    // 九: 必要郵票也套用鎖定／已取得規則, counted in the 36-total) and this
    // specific envelope's pre-drawn decorative stamp.
    (stamp, decorativeStampId) => {
      const required = getRequiredStampForMailDestination(stamp);
      if (required) settingsManager.markStampCollected(required.stampId);
      settingsManager.markStampCollected(decorativeStampId);
    }
  );

  // Envelope stack carry ("Add envelope stacks and expand pallet inventory"
  // round一-四) — dedicated world-space carry for multiple loose Envelope
  // objects at once, entirely separate from PickupSystem's own generic
  // multi-carry (see envelope-stack-system.ts's own class doc comment for
  // why). Built here, before UpgradeSystem, so its own setMaxCapacity()
  // push-setter can be wired into UpgradeSystem's constructor the same way
  // pickupSystem/playerController already are.
  const envelopeStackSystem = new EnvelopeStackSystem(
    scene, physics, interactables, playerData, camera, hud, mailSystem, pauseManager, () => playerController.isLocked
  );

  // Bulletin board upgrade system ("Add bulletin board upgrade system"
  // round) — constructed as early as pickupSystem/playerController exist,
  // since both scoringSystem's onSettlement hook and dailyFlowSystem's
  // onDayCompleted hook (both further below) need to already be able to
  // call into it. UpgradeSystem only ever reaches PickupSystem/
  // PlayerController/EnvelopeStackSystem through their own narrow public
  // setters (spec三) — never touches mail/lost-found/vehicle/cargo-
  // generation systems directly.
  const upgradeSystem = new UpgradeSystem(pickupSystem, playerController, envelopeStackSystem);
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
  // Same reasoning for the new north cargo-chute room's own floor
  // ("重製出貨口" round) — without this, dropping cargo there would
  // silently fail PickupSystem's placement raycast.
  pickupSystem.addPlacementSurface(sceneData.cargoChuteFloor);

  // Register each west-wall storage shelf's own level-top boards as
  // placement surfaces ("Add storage shelves along west wall" round spec
  // 三) — the boards' side panels/posts/back frame are real static
  // colliders (world-layout-system.ts) but were never added here, so they
  // can only ever block movement/raycasts, never become a placement
  // surface themselves.
  for (const surface of sceneData.shelfSurfaces) {
    pickupSystem.addPlacementSurface(surface);
  }

  // West-side lost & found room — minimal one-case flow (spec三). Built
  // after pickupSystem exists (tryConfirmWithNpc consumes the held item
  // via pickupSystem.forceDropHeld() on success).
  const lostFoundUI = new LostFoundUI();
  const lostFoundSystem = new LostFoundSystem(
    scene, physics, interactables, pickupSystem, lostFoundUI
  );
  // "失物招領系統修改" round — the black-ball-reveal interaction's own
  // standalone system (self-contained keydown, see its own class doc
  // comment for why this needs zero InteractionSystem changes). Fires
  // anywhere the instant the player holds F while carrying an uncleaned
  // lost item — no fixed station anymore.
  const lostFoundCleaningSystem = new LostFoundCleaningSystem(
    scene, camera, hud, playerData, pauseManager,
    () => playerController.isLocked, lostFoundSystem
  );

  // MailBagSystem owns the empty-bag rack + every bag's own lifecycle,
  // calling back into MailSystem (constructed earlier, alongside
  // EnvelopeStackSystem/UpgradeSystem — see its own comment above) to keep
  // envelope state in ONE place.
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
  // "Add regional envelope dispatch machine" round — PackedMailBagSystem
  // owns every sealed regional bag's own lifecycle (spawn/pickup/settlement)
  // once EnvelopeDispatchMachineSystem's own pack button hands it a
  // region's buffered envelope snapshots; the dispatcher itself owns the
  // physical cabinet/holes/per-region buffers/button (built right after,
  // since it needs both mailSystem and packedMailBagSystem to already
  // exist).
  const packedMailBagSystem = new PackedMailBagSystem(scene, physics, interactables, pickupSystem);
  const envelopeDispatchMachineSystem = new EnvelopeDispatchMachineSystem(
    scene, physics, interactables, hud, mailSystem, packedMailBagSystem
  );
  // "Allow mail box pattern changes with contents" round: lets
  // settleAtDeparture exclude a bagged envelope whose own destination no
  // longer matches its bag's live pattern, without MailSystem needing any
  // direct MailBagSystem import/reference of its own. "Add regional envelope
  // dispatch machine" round: extended to ALSO consult packedMailBagSystem —
  // a packed bag's own destination never cycles (fixed at spawn), but this
  // lookup is queried for EVERY bagId settleAtDeparture encounters
  // regardless of which system owns it, so a packed-bag id must resolve
  // here too or its envelopes would incorrectly fail the pattern-match check
  // and never count as shipped.
  mailSystem.setBagPatternLookup((bagId) => (
    mailBagSystem.getBag(bagId)?.destinationPattern ?? packedMailBagSystem.getBagDestination(bagId) ?? null
  ));

  // Daily unload -> sort -> ship-via-vehicle loop (this round's core).
  // DailyFlowSystem owns the day/state/count bookkeeping and the automatic
  // next-day advance ("每日結算流程修改" round removed the old 結束今天
  // button — see daily-flow-system.ts's own advanceToNextDay doc comment);
  // UnloadingSystem owns the north gate/chute/spawn sequence and
  // the 開始卸貨 button; VehicleControlSystem (re-enabled this round —
  // spec "北側卸貨口/重新啟用呼叫載具" section 六) now also owns the
  // organized-cargo-into-cargoBounds shipment judgment. All three report
  // into DailyFlowSystem rather than it reaching into them. Constructed
  // BEFORE VehicleControlSystem/UnloadingSystem since both need it.
  const dailyFlowSystem = new DailyFlowSystem(
    cargoSystem, hud,
    () => {
      dollySystem.resetToStart(); unloadingSystem.resetGate(); palletSystem.resetToStart();
      lostFoundSystem.resetDaily();
      // Mail state clears the SAME way every other daily fixture does
      // (spec十二) — bags first, so any bag-held envelope reference is
      // gone before MailSystem sweeps every remaining envelope id. The
      // dispatch machine's own buffers and any unshipped packed bags clear
      // the same way ("Add regional envelope dispatch machine" round
      // spec十一) — order relative to mailBagSystem doesn't matter (neither
      // touches the other's state), but both still run before MailSystem's
      // own sweep for consistency with the established ordering here.
      mailBagSystem.resetDaily();
      envelopeDispatchMachineSystem.resetDaily();
      packedMailBagSystem.resetDaily();
      // "Add envelope stacks and expand pallet inventory" round — clears
      // this class's own carry bookkeeping (stack membership/mode) before
      // MailSystem's own resetDaily disposes the underlying envelope
      // objects, same ordering reasoning as every other mail-adjacent reset
      // above.
      envelopeStackSystem.resetDaily();
      mailSystem.resetDaily();
      // "船運載具規格重製" round spec二/七 — full teardown+rebuild of the
      // vehicle roster from daily-unlock-data.ts, reading
      // dailyFlowSystem.currentDay which has ALREADY advanced to the new
      // day by the time this whole callback fires (see
      // DailyFlowSystem.advanceToNextDay's own ordering).
      vehicleControlSystem.resetForNewDay();
      // Same round, spec三/七 — the hotbar/tool cart/skill panel all need to
      // re-render against the new day's unlock list the instant it changes,
      // not just wait for their own next unrelated open/close.
      toolSystem.refreshLoadoutDisplay();
    },
    (finishedDay) => {
      settingsManager.fireTutorialEvent('dayCompleted');
      // Converts that day's accumulated departure settlement(s) into
      // upgrade points, exactly once per finishedDay (spec四) — see
      // UpgradeSystem.settleDay's own doc comment for the idempotency
      // guard.
      upgradeSystem.settleDay(finishedDay);
      // "每日結算流程調整" round — vehicleNightCleaningSystem.startNight()/
      // afterWorkStorySystem.trigger() used to fire from right here, but
      // this callback now only runs once the settlement panel AND item-
      // reward popup have ALREADY been shown and dismissed (this round's
      // whole point: 結算移到晚上流程之後), which is far too late to still
      // start the night sequence from. Both now fire instead from
      // vehicleControlSystem's own new onAllVehiclesDeparted hook below —
      // the exact same moment settlement used to appear immediately, now
      // repurposed to kick off the night sequence instead. See that hook's
      // own doc comment for the full timing rationale.
      // "Add main menu and return player after dock story" round 四: the
      // ONE write point for hp_run_state_v1's own currentDay (spec: "日結／
      // 進入下一天後更新currentDay" — never per-frame, only here, once per
      // completed day). Preserves whatever runId New Game originally
      // generated; only regenerates one if this key is somehow missing
      // (e.g. cleared out-of-band) so a day-complete can never itself fail
      // to record progress.
      const existingRun = loadRunState();
      saveRunState({
        hasActiveRun: true,
        currentDay: finishedDay + 1,
        runId: existingRun?.runId ?? generateRunId(),
        lastSavedAt: Date.now(),
      });
    },
    () => {
      // Spec follow-up ("每日結算UI彈出時，立即清除地圖上的所有包裹/信封/
      // 失物招領物品") — fires the MOMENT the settlement UI appears
      // (notifyDayComplete, called from VehicleControlSystem's own
      // showDayCompleteSummary — both the real six-vehicle departure path
      // and the test cheat funnel through that one method), well before the
      // player clicks "continue" and the automatic advanceToNextDay() call
      // that follows. Deliberately narrower than resetTools() above: only
      // touches cargo/mail/lost-found OBJECTS (spec's own explicit "可以清"
      // list) — never dolly/gate/pallet fixture positions (those still
      // reset later, unchanged, at the normal advanceToNextDay() time) and
      // never anything
      // AfterWorkStorySystem owns (story NPCs/props are untouched — this
      // callback has no reference to that system at all, so Day7's letter
      // and Day8's cake can never be caught by it).
      for (const id of dailyFlowSystem.dailyCargoIds) {
        if (cargoSystem.getCargoData(id)) cargoSystem.removeCargo(id);
      }
      mailBagSystem.resetDaily();
      envelopeDispatchMachineSystem.resetDaily();
      packedMailBagSystem.resetDaily();
      envelopeStackSystem.resetDaily();
      mailSystem.resetDaily();
      lostFoundSystem.resetDaily();
    }
  );

  // "Day 1～7 每日內容與解鎖規格" round — mailSystem/upgradeSystem are both
  // constructed BEFORE dailyFlowSystem exists (see their own constructors'
  // doc comments for why), so their own day-based gating is wired late here,
  // the same "avoid a constructor-time circular dependency" pattern every
  // other late setter in this file already uses.
  mailSystem.setDayUnlockProvider(() => dailyFlowSystem.currentDay);
  upgradeSystem.setDayUnlockProvider(() => dailyFlowSystem.currentDay);
  lostFoundSystem.setDayUnlockProvider(() => dailyFlowSystem.currentDay);

  // Day-1 dock story cutscene ("Add day one dock story event" round),
  // generalized to all 8 days by "每日特殊劇情系統". Constructed here (moved
  // down from its old, much earlier spot) specifically so it can take
  // dailyFlowSystem as a live constructor dependency — "Day8巨型蛋糕物流化"
  // round: day 8's own finale now starts the instant
  // dailyFlowSystem.currentDay becomes 8 (watched every frame internally,
  // see AfterWorkStorySystem.checkGiantCakeDayStart), rather than via the
  // onDayCompleted callback below every other day still uses; it also needs
  // cargoSystem (already built much earlier, line ~169) to find/detach
  // today's real giant-cake-box cargo item for its own F-unwrap. Deliberately
  // never touches PauseManager itself (see its own class doc comment) —
  // locks the player via the same playerData.state/setInputEnabled(false)
  // combination the stamp minigame already established, and its own
  // update() is called UNCONDITIONALLY from game-app.ts (never gated behind
  // pauseManager.isPaused), matching cargoHookSystem/spraySystem/
  // envelopeVacuumSystem's own established self-guarding convention.
  // "載具夜間清潔互動" round — constructed BEFORE afterWorkStorySystem so that
  // class can take it as a read-only constructor dependency (its own
  // startStory() gates on this system's `allVehiclesCleaned` getter — spec
  // 十五: "NPC不會提前開始劇情...必須等待所有載具清潔完成"). Needs the same
  // scene/physics/camera/playerController/playerData/settingsManager set
  // every other locked-input narrative system already takes, plus hud (for
  // the shared showChargeBar/showInteractionPrompt HUD elements
  // lost-found-cleaning-system.ts's own hold-to-clean precedent already
  // uses).
  const vehicleNightCleaningSystem = new VehicleNightCleaningSystem(
    scene, physics, camera, playerController, playerData, hud, settingsManager
  );

  // "男主角台詞系統＋特殊NPC劇情選擇" round — constructed BEFORE
  // afterWorkStorySystem so that class can take it as a read reference for
  // its own protagonist-speaker dialogue entries, same "construct the
  // dependency first" convention every other cross-system reference in this
  // file already follows.
  const protagonistDialogueSystem = new ProtagonistDialogueSystem(settingsManager);

  const afterWorkStorySystem = new AfterWorkStorySystem(
    scene, camera, physics, hud, playerController, playerData, settingsManager, pickupSystem,
    cargoSystem, dailyFlowSystem, vehicleNightCleaningSystem, protagonistDialogueSystem
  );

  // "每日起床＋夢境漫畫" round — constructed right after afterWorkStorySystem
  // (needs its own `isActive` getter as a read-only dependency, same
  // established "read another system's public state, never reach into its
  // internals" convention every other cross-system reference in this file
  // already follows) and dailyFlowSystem (reads currentDay/state every idle
  // frame to detect a fresh day starting — see DreamComicSystem's own class
  // doc comment for the full trigger-timing reasoning).
  const dreamComicSystem = new DreamComicSystem(
    camera, physics, playerController, playerData, settingsManager, dailyFlowSystem, afterWorkStorySystem, hud
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
  // "每日獲得道具" round — constructed right before vehicleControlSystem so
  // its show() can be wired into that system's own new onDayCompleteContinue
  // hook below (vehicleControlSystem never imports/references this class
  // itself, only calls the plain callback — see VehicleControlSystem's own
  // doc comment on that constructor param).
  const itemRewardSystem = new ItemRewardSystem(playerController, playerData, settingsManager);

  const vehicleControlSystem = new VehicleControlSystem(
    scene, physics, interactables, cargoSystem, pickupSystem, hud,
    dailyFlowSystem,
    scoringSystem,
    mailSystem,
    mailBagSystem,
    packedMailBagSystem,
    hooks.onPauseChange,
    (config) => settingsManager.markVehicleDiscovered(config.id),
    () => settingsManager.fireTutorialEvent('vehicleCalled'),
    () => settingsManager.fireTutorialEvent('cargoLoaded'),
    () => settingsManager.fireTutorialEvent('vehicleDeparted'),
    // Settles today's lost-found missed-interaction AND lost-item storage
    // penalties at the exact moment 載具出發 is pressed — see
    // LostFoundSystem.settleAtDeparture.
    () => lostFoundSystem.settleAtDeparture(),
    ENABLE_VEHICLE_LOADING_FLOW,
    // "每日獲得道具" round spec五 — inserted into the EXISTING settlement-
    // confirm→day-advance callback chain, never a second day-transition
    // system: itemRewardSystem.show() itself calls `proceed`
    // (=advanceToNextDay) immediately if today has nothing to show.
    (finishedDay, proceed) => itemRewardSystem.show(finishedDay, proceed),
    // "每日結算流程調整" round — fires the moment today's vehicles finish
    // departing (the SAME moment settlement used to appear immediately);
    // now kicks off the night sequence instead (moved here from
    // DailyFlowSystem's own onDayCompleted callback above, which now fires
    // far too late for this — see that callback's own doc comment). Both
    // calls are no-ops on day 8 (each class's own guard), and
    // vehicleNightCleaningSystem/afterWorkStorySystem are both already
    // constructed above this point.
    (finishedDay) => {
      vehicleNightCleaningSystem.startNight(finishedDay);
      afterWorkStorySystem.trigger(finishedDay);
      // "Banner貫穿夜晚" round — the "今日貨物已全部送出" banner's own job is
      // done the instant the night sequence actually takes over; `state`
      // itself stays 'dayComplete' the whole night (still gates
      // advanceToNextDay etc., untouched), only the banner's own display
      // flag clears here.
      dailyFlowSystem.hideDayCompleteBanner();
    },
    // Polled from VehicleControlSystem's own update() while the settlement
    // panel is deliberately withheld (spec: "不可以讓玩家在載具清潔或載具離
    // 開表演期間提前進入結算") — true only once every returned vehicle has
    // been cleaned, thanked, AND has actually departed, AND
    // afterWorkStorySystem.isTodaysStoryResolved (spec follow-up "每日結算不
    // 能搶在NPC劇情之前": allVehiclesCleaned alone only covers 清潔+感謝+離開,
    // not the NPC beat that's supposed to follow it). Reads the dedicated
    // isTodaysStoryResolved getter, NOT a plain !isActive check inline here —
    // see that getter's own doc comment for why the distinction matters: its
    // correctness now depends on AfterWorkStorySystem's own trigger() no
    // longer being foolable by a stale persisted flag from an unrelated
    // earlier session (see STORAGE_KEY's own doc comment there), a real,
    // reproduced bug this round fixes ("結算搶跑於NPC劇情之前" round).
    () => vehicleNightCleaningSystem.allVehiclesCleaned && afterWorkStorySystem.isTodaysStoryResolved
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
      // Day8 exclusion (spec follow-up: "除了巨大蛋糕之外，不要生成...失物招
      // 領物品、信封") — the finale's own cargo manifest is already a single
      // giant cake item (cargo-manifest-planner.ts's GIANT_CAKE_DAY), but
      // lost-found/mail have no day-awareness of their own at all; gating
      // both calls here (the ONE place either ever gets armed each day) is
      // the minimal fix — neither system needs new plumbing.
      if (dailyFlowSystem.currentDay !== 8) {
        lostFoundSystem.onDailyUnloadStarted();
        // Today's 12 envelopes burst in alongside regular cargo from the SAME
        // two north ports (spec二) — UnloadingSystem itself is never touched
        // for this (spec: 不要修改北側雙到貨口位置).
        mailSystem.onDailyUnloadStarted();
      }
    }
  );
  const palletSystem = new PalletSystem(
    scene, physics, cargoSystem, interactables, playerData, hud, pauseManager, upgradeSystem,
    () => settingsManager.fireTutorialEvent('palletUsed'),
    () => settingsManager.fireTutorialEvent('boxOrganized'),
    // "Add envelope stacks and expand pallet inventory" round — registers
    // every pallet top mesh (still a normal PickupSystem placement surface,
    // a single cargo item can always be manually placed on top — spec: this
    // only ever ADDS the ability to pick up the whole pallet) as it's built,
    // covering BOTH the initial sets built during PalletSystem's own
    // constructor above AND any later unlockSecondSet() call — replaces the
    // old one-time post-construction getAllTopMeshes() loop, which only
    // ever covered whatever existed at boot.
    (mesh) => pickupSystem.addPlacementSurface(mesh),
    (mesh) => pickupSystem.removePlacementSurface(mesh),
    () => dailyFlowSystem.currentDay
  );
  // "Add placement rotation and pallet cargo straps" round spec三: lets
  // pickup-system.ts's own generic executeThrow() correctly throw the
  // pallet (its body is otherwise permanently kinematic) — see
  // PalletThrowHooks' own doc comment in pickup-system.ts. PalletSystem
  // implements the interface directly, so no separate adapter object.
  pickupSystem.setPalletThrowHooks(palletSystem);
  // Late-bound the same way pickupSystem.setPalletThrowHooks is just above
  // — PalletSystem is constructed after UpgradeSystem (avoiding a circular
  // import, see PalletInventoryExpansionTarget's own doc comment in
  // upgrade-system.ts), so this wiring can only happen here, post-
  // construction.
  upgradeSystem.setPalletSystem(palletSystem);
  // "Add freezer shelves and frozen cargo freshness system" round — every
  // existing west-wall 置物架 level gets its own cold-recovery-zone sensor.
  // "冷凍貨物系統修改" round三 added a PalletSystem dependency: per-location
  // decay rates need palletSystem.isCargoOnAnyPallet() to tell "resting on a
  // pallet" apart from "resting on the floor".
  const freezerSystem = new FreezerSystem(scene, physics, cargoSystem, palletSystem, playerData, hud);
  // "活物貨物系統" round — entirely independent of FreezerSystem (spec七: "不
  // 要影響目前冷藏值系統"), its own calmValue field/decay triggers/F-soothe/
  // HUD panel.
  const livingCargoSystem = new LivingCargoSystem(
    scene, camera, physics, cargoSystem, playerData, pauseManager, () => playerController.isLocked, hud
  );
  // Foldable ladder + immovable tool cart ("Add ladder tool station and
  // envelope vacuum" round一/二) — built near the pallet system since the
  // ladder's own wall slot is derived from the pallet racks' own wall
  // cluster (ladder-data.ts). Neither is registered into CargoSystem, so
  // CargoHookSystem's own target resolution naturally excludes both without
  // any extra exclusion code (see ladder-system.ts's own class doc comment).
  const ladderSystem = new LadderSystem(scene, physics, interactables, playerData, hud, () => dailyFlowSystem.currentDay);
  const toolStationSystem = new ToolStationSystem(scene, physics, interactables);

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
  const toolSystem = new ToolSystem(
    playerData, hud, pauseManager, () => playerController.isLocked, pickupSystem, () => dailyFlowSystem.currentDay
  );
  // "貨物勾勾修改" round — widened to also hook lost-found items/envelopes,
  // needs envelopeStackSystem for the real E-key-equivalent pickup path.
  const cargoHookSystem = new CargoHookSystem(
    camera, scene, pickupSystem.viewModelScene, physics, interactables, cargoSystem,
    playerData, hud, pauseManager, dailyFlowSystem, pickupSystem, toolSystem, () => playerController.isLocked,
    envelopeStackSystem
  );
  // "貨物工具與技能升級系統修改" round — wires cargoHookLevel's own live push
  // target now that the tool exists (see UpgradeLevelPushTarget's own doc
  // comment in upgrade-system.ts for why this can't happen at UpgradeSystem's
  // own construction time).
  upgradeSystem.setCargoHookSystem(cargoHookSystem);

  // Tool cart's own swap UI ("Add ladder tool station and envelope vacuum"
  // round三) — same PauseManager/pointer-lock convention as
  // UpgradeMenuUI/MediaPlayerUI, built once toolSystem exists since it
  // saves directly back into it on close.
  const toolLoadoutMenuUI = new ToolLoadoutMenuUI(pauseManager, playerController, toolSystem, hud, () => dailyFlowSystem.currentDay);

  // Envelope vacuum tool (spec四-八) — same "self-contained tool watching
  // playerData.activeTool" pattern as CargoHookSystem/SpraySystem just
  // above, sharing the SAME viewModelScene for its own handheld prop.
  const envelopeVacuumSystem = new EnvelopeVacuumSystem(
    physics, interactables, playerData, camera, pickupSystem.viewModelScene,
    mailSystem, pauseManager, () => playerController.isLocked
  );
  // "貨物工具與技能升級系統修改" round — same reasoning as
  // upgradeSystem.setCargoHookSystem above, for envelopeVacuumLevel.
  upgradeSystem.setEnvelopeVacuumSystem(envelopeVacuumSystem);

  // Spray paint tool ("Fix pallet throw and add spray paint tool" round
  // spec五, hotbar slot 4) — restricted to the same real floor meshes
  // PickupSystem itself places items on (main back-area floor, pier deck,
  // lost-found room floor), which is what keeps cargo/pallet/shelves/walls/
  // vehicles/NPCs impossible to spray on without needing any exclusion list
  // of its own (see spray-paint-system.ts's own doc comment).
  const spraySystem = new SpraySystem(
    camera, scene, playerData, hud, pauseManager,
    [sceneData.floor, sceneData.pierFloor, sceneData.lostFoundFloor, sceneData.cargoChuteFloor],
    () => playerController.isLocked
  );

  // "Add complete day testing cheat button" round — a single wall-mounted
  // test button (lost-found room's own north wall) that force-completes
  // today's cargo/mail/lost-found-NPC work through each owning system's own
  // real public API, then opens the real settlement screen. Built after
  // every system it orchestrates already exists (ladderSystem, the last
  // dependency, is constructed just above).
  const completeDayCheatSystem = new CompleteDayCheatSystem(
    scene, interactables, playerData, hud,
    pickupSystem, palletSystem, ladderSystem, envelopeStackSystem, cargoSystem, dailyFlowSystem,
    mailSystem, mailBagSystem, packedMailBagSystem, envelopeDispatchMachineSystem, lostFoundSystem,
    vehicleControlSystem, afterWorkStorySystem, unloadingSystem, upgradeSystem,
    // "跳到第四天" round — both already constructed above (itemRewardSystem
    // right before vehicleControlSystem, dreamComicSystem right after
    // afterWorkStorySystem): needed so jumpToDayForTesting() can clear their
    // own persisted "already resolved" localStorage flags alongside
    // afterWorkStorySystem's own resetForDayJumpTesting() (see that
    // method's own doc comment).
    itemRewardSystem, dreamComicSystem
  );

  // Interaction system
  // "新增兔子吉祥物" round — a permanent, always-present fixture (not tied to
  // any day/story trigger), constructed here so it's ready before
  // interactionSystem wires its own onOpenMascotGuide callback below.
  const mascotGuideSystem = new MascotGuideSystem(
    scene, physics, interactables, playerData, playerController, settingsManager, () => dailyFlowSystem.currentDay
  );

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
    palletSystem,
    lostFoundSystem,
    mailSystem,
    mailBagSystem,
    packedMailBagSystem,
    envelopeDispatchMachineSystem,
    envelopeStackSystem,
    hooks.onStartMailStampUi,
    () => upgradeMenuUI.open(),
    () => mediaPlayerUI.open(),
    ladderSystem,
    toolStationSystem,
    () => toolLoadoutMenuUI.open(),
    completeDayCheatSystem,
    () => mascotGuideSystem.open(),
    () => settingsManager.fireTutorialEvent('dollyUsed')
  );

  // "Reset upgrades when starting day one" round's own "新周目重置" flow —
  // now shared verbatim by TWO callers (ManualUI's own Data-tab "重新開始第
  // 1天" button below, AND MainMenuSystem's own 新遊戲 confirm, "Add main
  // menu and return player after dock story" round spec三: "呼叫既有正式新
  // 周目重置流程，不要另寫第二套重置") — a single named const rather than two
  // separately-written closures guarantees both really do call the exact
  // same steps in the exact same order.
  const resetForNewRun = () => {
    // Resets the upgrade save itself (state/persist/effect-reapply — see
    // UpgradeSystem.resetUpgradesForNewRun's own doc comment), then reloads
    // the page so every OTHER system (day/scene/cargo/vehicles/mail/lost-
    // found/etc.) restarts from its own normal day-1 boot path rather than
    // needing bespoke reset code written here for each of them.
    upgradeSystem.resetUpgradesForNewRun();
    // "Add day one dock story event" round spec六: "新周目開始時重置第一天
    // 故事完成狀態" — clears the persisted completedDays flag so the next
    // playthrough's own day-1-end genuinely re-triggers the story.
    afterWorkStorySystem.resetStoryProgress();
    // "每日起床＋夢境漫畫" round — same "新周目重置" reasoning as
    // afterWorkStorySystem.resetStoryProgress() immediately above: clears the
    // persisted hp_dream_comic_v1 flag so the next playthrough's own Day1
    // genuinely replays its dream instead of being silently suppressed by a
    // stale completedDays entry from a previous run.
    dreamComicSystem.resetDreamProgress();
    // "每日獲得道具" round — same "新周目重置" reasoning as the two resets
    // immediately above: clears the persisted hp_item_reward_v1 flag so the
    // next playthrough's own Day1 genuinely re-shows its reward popup
    // instead of being silently suppressed by a stale grantedDays entry
    // from a previous run.
    itemRewardSystem.resetItemRewardProgress();
    window.location.reload();
  };

  // 異世界物流手冊 — pause menu / tutorial / settings / codex (spec round).
  // Captured into a const this round (previously fire-and-forget) — needed
  // as MainMenuSystem's own reference target so its 設定 button can open the
  // exact same instance rather than a second one (spec五: "直接重用現有設定
  // 系統").
  const manualUI = new ManualUI(
    pauseManager, settingsManager, hud, hooks.onInterruptPlayerActions, resetForNewRun, () => dailyFlowSystem.currentDay
  );

  // "Add main menu and return player after dock story" round 二 — built
  // LAST, once every system it might reach into (dailyFlowSystem for 繼續遊
  // 戲's own day-resume, manualUI for 設定, resetForNewRun for 新遊戲) already
  // exists. Immediately shows itself and pauses the world from its own
  // constructor (spec二: "遊戲載入後不要直接進入場景，先顯示主畫面") — nothing
  // further needed at the GameApp.start() call site below.
  const mainMenuSystem = new MainMenuSystem(pauseManager, hud, manualUI, dailyFlowSystem, resetForNewRun);

  return {
    playerController, interactionSystem, pickupSystem, envelopeStation, envelopeSystem,
    sortingBoxSystem, mailSortingSystem, cargoSystem, dollySystem, vehicleControlSystem,
    scoringSystem, counterNpcSystem, counterServiceSystem, compassUI, dailyFlowSystem,
    unloadingSystem, palletSystem, cargoInspectionSystem, cargoInspectionUI,
    lostFoundSystem, lostFoundUI, lostFoundCleaningSystem, mailSystem, mailBagSystem,
    packedMailBagSystem, envelopeDispatchMachineSystem, envelopeStackSystem,
    upgradeSystem, similarCargoHighlight, mediaPlayerSystem,
    toolSystem, cargoHookSystem, spraySystem,
    ladderSystem, toolStationSystem, envelopeVacuumSystem,
    afterWorkStorySystem, dreamComicSystem, vehicleNightCleaningSystem,
    completeDayCheatSystem, mainMenuSystem, freezerSystem, livingCargoSystem,
    itemRewardSystem, protagonistDialogueSystem, mascotGuideSystem,
  };
}
