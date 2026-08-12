import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { PlayerController } from '../player';
import { PlayerInteractionData } from '../../core/game-state';
import { SettingsManager } from '../settings';
import { HUD } from '../hud';
import { SCENE_CONFIG } from '../world-layout';
import { VehicleSystem } from '../vehicle/vehicle-system';
import { ALL_DOCK_SLOTS } from '../vehicle/vehicle-dock-data';
import { LAND_VEHICLE_CONFIGS, SEA_VEHICLE_CONFIGS, VehicleConfig } from '../vehicle/vehicle-data';
import { getEffectiveDayUnlockConfig } from '../../data/daily-unlock-data';
import {
  CleaningToolId, CleaningPointDefinition, getVehicleCleaningDefinition, pickNightlyCleaningPoints,
  CLEANING_TOOL_LABELS,
} from '../../data/vehicle/vehicle-cleaning-data';
import {
  createStoryBubble, showStoryBubbleText, hideStoryBubble, disposeStoryBubble, wrapStoryLine,
} from '../story/after-work-story-bubble-ui';
import {
  createNightCleaningUi, setFadeOpacity, showToolBar, hideToolBar, highlightSelectedTool, NightCleaningUiHandle,
} from './vehicle-night-cleaning-ui';
import { NightCleaningState, VehicleCleaningInstance } from './vehicle-night-cleaning-types';

const ALL_VEHICLE_CONFIGS: VehicleConfig[] = [...LAND_VEHICLE_CONFIGS, ...SEA_VEHICLE_CONFIGS];

/** GIANT_CAKE_DAY duplicated as a literal here rather than imported from
 * after-work-story-system.ts — mirrors vehicle-control-system.ts's/
 * complete-day-cheat-system.ts's own established convention of repeating
 * the bare `=== 8` check locally rather than depending on that file's own
 * internal constant (avoids a needless cross-system import purely for one
 * literal, same reasoning those two files already document). */
const DAY8 = 8;

/** Marker light + its owning point/vehicle ids — the ONLY thing the aim
 * raycast actually tests against. */
interface CleaningMarker {
  mesh: THREE.Mesh;
  pointId: string;
  vehicleId: string;
}

const NIGHT_FADE_HOLD_SECONDS = 0.7;
const CLEAN_HOLD_DURATION_SECONDS = 1.0; // matches lost-found-cleaning-system.ts's own 1.0s precedent
const MARKER_RADIUS = 0.09;
const DIALOGUE_LINE_POINT = ['……'];
const DIALOGUE_LINE_THANKYOU = ['謝謝你幫我整理乾淨。'];

type DialogueKind = 'point' | 'thankYou';

/**
 * "載具夜間清潔互動" round — the new 白天出貨→夜晚載具回來→玩家清潔→載具道謝→
 * NPC等待→AfterWorkStorySystem 流程 (spec一/二十一). Deliberately mirrors this
 * codebase's own established conventions throughout rather than inventing a
 * parallel architecture (spec六/十六/十七):
 *   - "Today's vehicles" is read directly from daily-unlock-data.ts's own
 *     getEffectiveDayUnlockConfig(day).vehicles (spec四) — never a second
 *     roster. Every vehicle unlocked for a day is ALWAYS called+departed
 *     together (VehicleControlSystem.pressCallButton spawns every slot
 *     atomically, canDepart requires every slot docked) — so "vehicles that
 *     departed today" and "vehicles unlocked today" are the exact same set,
 *     letting this file avoid touching vehicle-control-system.ts at all.
 *   - Returned vehicles are real `VehicleSystem` instances (spec二十五: "先
 *     使用現有載具模型") parked at their own ALL_DOCK_SLOTS position
 *     (vehicle-dock-data.ts) — the real daytime roster is already fully torn
 *     down and rebuilt for the NEW day by the time this fires (DailyFlow-
 *     System.advanceToNextDay's own resetTools() callback, which includes
 *     VehicleControlSystem.resetForNewDay(), runs BEFORE onDayCompleted），
 *     so these dock spots are guaranteed empty and collision-free.
 *   - The hold-E/re-validate-every-frame/HUD charge-bar pattern mirrors
 *     lost-found-cleaning-system.ts's own hold-F-to-clean precedent exactly
 *     (same 1.0s duration, same "release resets, doesn't pause" behavior,
 *     same hud.showChargeBar/hideChargeBar reuse — spec十).
 *   - Per-point/per-vehicle dialogue reuses after-work-story-bubble-ui.ts's
 *     own generic sprite-bubble functions directly (spec十七: "沿用...letter-
 *     reading-ui.ts...不要重新建立一套大型對話系統") — those functions only
 *     ever take a plain THREE.Sprite + text, no NPC-specific logic, so this
 *     file just points them at whichever vehicle is currently being thanked/
 *     just finished a point instead of an NPC.
 *   - The player lock during any popup reuses the SAME playerData.state=
 *     'stamping-minigame' + playerController.setInputEnabled(false)
 *     combination AfterWorkStorySystem/DreamComicSystem already established
 *     (spec十八).
 *   - "Which tool is equipped" is a small, fully self-contained concept
 *     (vehicle-night-cleaning-ui.ts's own tool-select strip) — deliberately
 *     NOT wired into core/game-state.ts's ActiveTool union or ToolSystem's
 *     hotbar/day-unlock gating (spec二十五: "不要自行發明新的遊戲工具模型") —
 *     see vehicle-cleaning-data.ts's own doc comment for the full reasoning.
 *
 * NPC gating (spec十四/十五): this class does NOT call
 * AfterWorkStorySystem.trigger() itself and has no reference to that class
 * at all — create-game-systems.ts's own onDayCompleted callback calls BOTH
 * `vehicleNightCleaningSystem.startNight(finishedDay)` AND
 * `afterWorkStorySystem.trigger(finishedDay)` back to back, so the NPC
 * spawns and walks in (and parks at 'waitingForPlayer', per
 * after-work-story-system.ts's OWN existing arrived-and-idle state) WHILE
 * the player is still cleaning — exactly spec十四's "NPC可以在玩家清潔期間進
 * 入大廳". What stops the NPC from starting dialogue early is a single new
 * guard added to AfterWorkStorySystem.startStory() itself
 * (`vehicleNightCleaningSystem.allVehiclesCleaned`), reusing that class's
 * OWN existing "arrived but not yet in dialogue" state rather than building
 * a second NPC-waiting mechanism (spec十六).
 *
 * `update()` is called from game-app.ts INSIDE the `!pauseManager.isPaused`
 * gate — same reasoning DreamComicSystem's own doc comment documents (no
 * continuous per-frame effect needs to survive an unrelated pause; the
 * night sequence should simply freeze alongside everything else while
 * paused, and correctness doesn't depend on it ticking while the main menu
 * is shown, since it's only ever started by a live gameplay action).
 */
export class VehicleNightCleaningSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private camera: THREE.PerspectiveCamera;
  private playerController: PlayerController;
  private playerData: PlayerInteractionData;
  private hud: HUD;
  private settingsManager: SettingsManager;
  private ui: NightCleaningUiHandle;
  private raycaster = new THREE.Raycaster();

  private state: NightCleaningState = 'idle';
  private vehicles: VehicleCleaningInstance[] = [];
  private markers: CleaningMarker[] = [];
  private markerGroup: THREE.Group;

  private selectedToolId: CleaningToolId | null = null;
  private chargingPointId: string | null = null;
  private chargeElapsed = 0;
  private fadeTimer = 0;
  private pendingVehicleIds: string[] = [];

  private dialogueBubble: THREE.Sprite | null = null;
  private dialogueKind: DialogueKind = 'point';
  private dialogueLines: string[] = [];
  private dialogueLineIndex = 0;
  private dialogueVehicle: VehicleCleaningInstance | null = null;

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, camera: THREE.PerspectiveCamera,
    playerController: PlayerController, playerData: PlayerInteractionData, hud: HUD, settingsManager: SettingsManager
  ) {
    this.scene = scene;
    this.physics = physics;
    this.camera = camera;
    this.playerController = playerController;
    this.playerData = playerData;
    this.hud = hud;
    this.settingsManager = settingsManager;

    this.markerGroup = new THREE.Group();
    scene.add(this.markerGroup);

    this.ui = createNightCleaningUi((toolId) => this.selectTool(toolId));

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
  }

  /** Read by AfterWorkStorySystem.startStory() (spec十五) — true once every
   * returned vehicle has been thanked, false at every earlier point
   * (including while the NPC has already walked in and is idly waiting). */
  get allVehiclesCleaned(): boolean {
    return this.state === 'waitingForStory';
  }

  /** True whenever the night sequence is doing ANYTHING (not just plain
   * daytime) — kept public for the same "obvious future extension point"
   * reason AfterWorkStorySystem.isActive/DreamComicSystem.isActive already
   * are, though nothing else reads it this round. */
  get isActive(): boolean {
    return this.state !== 'idle';
  }

  /** The ONE entry point (spec一/二十) — called from create-game-systems.ts's
   * existing onDayCompleted callback, the exact same call site
   * afterWorkStorySystem.trigger(finishedDay) already fires from. */
  startNight(finishedDay: number): void {
    // Defensive floor mirroring daily-flow-system.ts's/vehicle-control-
    // system.ts's own repeated Day8 guards (spec二十六) — structurally
    // unreachable already (advanceToNextDay() itself no-ops entirely on day
    // 8, so onDayCompleted never fires for it), kept anyway per this
    // codebase's own established "repeat the floor even where it's already
    // impossible" convention.
    if (finishedDay === DAY8) return;
    if (this.state !== 'idle' && this.state !== 'waitingForStory') return;
    const vehicleIds = getEffectiveDayUnlockConfig(finishedDay).vehicles;
    if (vehicleIds.length === 0) return;

    this.pendingVehicleIds = vehicleIds;
    this.state = 'nightTransition';
    this.fadeTimer = 0;
    setFadeOpacity(this.ui, 1);
    this.playerData.state = 'stamping-minigame';
    this.playerController.setInputEnabled(false);
  }

  update(deltaTime: number): void {
    // Ticks each night-parked VehicleSystem's own per-frame animation (spec
    // 八/二十五: reuse the real vehicle model as-is) — this is what actually
    // drives the frog's mouth open after onArrived() sets its target angle
    // (VehicleSystem.update() is a no-op for every other vehicle, see its
    // own doc comment); without this the mouth's own angle would never
    // animate away from closed, permanently sealing the mouth-area cleaning
    // points behind it (a real bug found during this round's own testing —
    // see spawnReturnedVehicles' own onArrived() doc comment for the other
    // half of this fix).
    for (const vehicle of this.vehicles) (vehicle.vehicleSystem as VehicleSystem).update(deltaTime);

    switch (this.state) {
      case 'idle':
      case 'cleaningDialogue':
      case 'vehicleThankYou':
      case 'waitingForStory':
        return; // no continuous per-frame work — driven entirely by onKeyDown
      case 'nightTransition':
        this.updateNightTransition(deltaTime);
        return;
      case 'vehicleReturn':
        this.updateVehicleReturn(deltaTime);
        return;
      case 'cleaning':
        this.updateCleaning(deltaTime);
        return;
    }
  }

  // --- Night transition (spec三) ---

  private updateNightTransition(deltaTime: number): void {
    this.fadeTimer += deltaTime;
    if (this.fadeTimer < NIGHT_FADE_HOLD_SECONDS) return;
    this.spawnReturnedVehicles();
    this.fadeTimer = 0;
    this.state = 'vehicleReturn';
  }

  private updateVehicleReturn(deltaTime: number): void {
    this.fadeTimer += deltaTime;
    if (this.fadeTimer < NIGHT_FADE_HOLD_SECONDS) return;
    setFadeOpacity(this.ui, 0);
    this.playerData.state = 'empty-handed';
    this.playerController.setInputEnabled(true);
    showToolBar(this.ui);
    this.state = 'cleaning';
  }

  // --- Vehicle + marker spawning (spec四/六/七/八) ---

  private spawnReturnedVehicles(): void {
    this.vehicles = [];
    for (const vehicleId of this.pendingVehicleIds) {
      const config = ALL_VEHICLE_CONFIGS.find((c) => c.id === vehicleId);
      const dock = ALL_DOCK_SLOTS[vehicleId]?.dockPosition;
      if (!config || !dock) continue; // defensive — every real config has a matching dock slot
      const vehicleSystem = new VehicleSystem(this.scene, this.physics, config, dock);
      // The frog's mouth/basin stays fully sealed under its closed upper
      // shell by default (vehicle-system.ts's own buildFrogVehicle) — a
      // real bug found during this round's own testing: several of frog's
      // own "嘴巴" cleaning points sit inside that basin, genuinely
      // unreachable from any exterior angle while closed. onArrived() is
      // the EXACT existing method VehicleControlSystem already calls the
      // moment a frog docks during the day (swings the mouth open, reveals
      // the basin) — a no-op for every other vehicle (vehicle-system.ts's
      // own doc comment on onArrived confirms this), so calling it here
      // unconditionally is safe and reuses the real production mouth-open
      // path rather than inventing a night-only variant of it.
      vehicleSystem.onArrived();

      const nightlyPoints = pickNightlyCleaningPoints(vehicleId); // spec七: 4-5, no duplicates
      const instance: VehicleCleaningInstance = {
        vehicleId, vehicleSystem, activePointIds: nightlyPoints.map((p) => p.id),
        completedPointIds: new Set(), thanked: false,
      };
      this.vehicles.push(instance);
      this.spawnMarkersForVehicle(vehicleId, vehicleSystem, nightlyPoints);
    }
  }

  /** Placeholder light (spec八: "小型發光球...玩家可以清楚看到這裡就是要清潔
   * 的位置...完成後該光點消失") — one small emissive sphere per active point,
   * positioned by adding the point's own LOCAL offset to the vehicle's real
   * world position (vehicle-cleaning-data.ts's own documented convention). */
  private spawnMarkersForVehicle(vehicleId: string, vehicleSystem: VehicleSystem, points: CleaningPointDefinition[]): void {
    for (const point of points) {
      const geo = new THREE.SphereGeometry(MARKER_RADIUS, 12, 12);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffe27a, emissive: 0xffcc33, emissiveIntensity: 1.1 });
      const mesh = new THREE.Mesh(geo, mat);
      const worldPos = vehicleSystem.position;
      mesh.position.set(worldPos.x + point.position.x, worldPos.y + point.position.y, worldPos.z + point.position.z);
      this.markerGroup.add(mesh);
      this.markers.push({ mesh, pointId: point.id, vehicleId });
    }
  }

  private removeMarker(pointId: string): void {
    const idx = this.markers.findIndex((m) => m.pointId === pointId);
    if (idx === -1) return;
    const marker = this.markers[idx];
    this.markerGroup.remove(marker.mesh);
    marker.mesh.geometry.dispose();
    (marker.mesh.material as THREE.Material).dispose();
    this.markers.splice(idx, 1);
  }

  // --- Tool selection (spec五/十) ---

  private selectTool(toolId: CleaningToolId): void {
    if (this.state !== 'cleaning') return;
    this.selectedToolId = toolId;
    highlightSelectedTool(this.ui, toolId);
  }

  // --- Cleaning (spec十) ---

  private getAimedMarker(): CleaningMarker | null {
    if (this.markers.length === 0) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = this.raycaster.intersectObjects(this.markers.map((m) => m.mesh), false);
    if (hits.length === 0) return null;
    if (hits[0].distance > SCENE_CONFIG.interactionDistance) return null;
    return this.markers.find((m) => m.mesh === hits[0].object) ?? null;
  }

  private updateCleaning(deltaTime: number): void {
    if (this.chargingPointId) {
      const marker = this.markers.find((m) => m.pointId === this.chargingPointId);
      const stillAimed = this.getAimedMarker();
      const stillValid = !!marker && stillAimed?.pointId === this.chargingPointId;
      if (!stillValid) {
        this.cancelCharge();
      } else {
        this.chargeElapsed += deltaTime;
        this.hud.showChargeBar(Math.min(this.chargeElapsed / CLEAN_HOLD_DURATION_SECONDS, 1));
        if (this.chargeElapsed >= CLEAN_HOLD_DURATION_SECONDS) this.completePoint(this.chargingPointId);
      }
      return;
    }

    const aimed = this.getAimedMarker();
    if (!aimed) {
      this.hud.hideInteractionPrompt();
      return;
    }
    const def = getVehicleCleaningDefinition(aimed.vehicleId);
    if (!def) return;
    const toolLabel = CLEANING_TOOL_LABELS[def.toolId];
    const holdingCorrectTool = this.selectedToolId === def.toolId;
    this.hud.showInteractionPrompt(
      def.cleaningTarget,
      holdingCorrectTool ? `按住 E 使用${toolLabel}清潔` : `需要${toolLabel}才能清潔`
    );
  }

  private cancelCharge(): void {
    this.chargingPointId = null;
    this.chargeElapsed = 0;
    this.hud.hideChargeBar();
  }

  private completePoint(pointId: string): void {
    const vehicle = this.vehicles.find((v) => v.activePointIds.includes(pointId));
    if (!vehicle) return;
    this.hud.hideChargeBar();
    this.hud.hideInteractionPrompt();
    this.chargingPointId = null;
    this.chargeElapsed = 0;
    vehicle.completedPointIds.add(pointId);
    this.removeMarker(pointId);
    this.beginDialogue(vehicle, 'point');
  }

  // --- Dialogue popups (spec十一/十二/十三) ---

  private beginDialogue(vehicle: VehicleCleaningInstance, kind: DialogueKind): void {
    this.dialogueVehicle = vehicle;
    this.dialogueKind = kind;
    this.dialogueLines = kind === 'point' ? DIALOGUE_LINE_POINT : DIALOGUE_LINE_THANKYOU;
    this.dialogueLineIndex = 0;

    this.playerData.state = 'stamping-minigame';
    this.playerController.setInputEnabled(false);
    hideToolBar(this.ui);

    const vs = vehicle.vehicleSystem as VehicleSystem;
    this.dialogueBubble = createStoryBubble(vs.config.height + 0.6);
    vs.vehicleGroup.add(this.dialogueBubble);
    showStoryBubbleText(this.dialogueBubble, wrapStoryLine(this.dialogueLines[0]));

    this.state = kind === 'point' ? 'cleaningDialogue' : 'vehicleThankYou';
  }

  private advanceDialogue(): void {
    this.dialogueLineIndex++;
    if (this.dialogueLineIndex >= this.dialogueLines.length) {
      this.endDialogue();
      return;
    }
    if (this.dialogueBubble) showStoryBubbleText(this.dialogueBubble, wrapStoryLine(this.dialogueLines[this.dialogueLineIndex]));
  }

  private endDialogue(): void {
    if (this.dialogueBubble) {
      hideStoryBubble(this.dialogueBubble);
      disposeStoryBubble(this.dialogueBubble);
      this.dialogueBubble.parent?.remove(this.dialogueBubble);
      this.dialogueBubble = null;
    }
    const vehicle = this.dialogueVehicle;
    const kind = this.dialogueKind;
    this.dialogueVehicle = null;

    if (kind === 'thankYou' && vehicle) {
      vehicle.thanked = true;
    }

    this.playerData.state = 'empty-handed';
    this.playerController.setInputEnabled(true);

    if (kind === 'point' && vehicle && vehicle.completedPointIds.size >= vehicle.activePointIds.length) {
      // Every one of THIS vehicle's own nightly points is done — go
      // straight into its thank-you popup (spec十二/十三), not back to free
      // cleaning first.
      this.beginDialogue(vehicle, 'thankYou');
      return;
    }

    if (this.vehicles.length > 0 && this.vehicles.every((v) => v.thanked)) {
      this.finishNight();
      return;
    }

    showToolBar(this.ui);
    this.state = 'cleaning';
  }

  /** Every returned vehicle has been thanked (spec十三/十四) — tears down
   * the parked vehicle meshes/markers and hands control to
   * AfterWorkStorySystem's own (already-walking-in) NPC. */
  private finishNight(): void {
    for (const marker of [...this.markers]) this.removeMarker(marker.pointId);
    for (const vehicle of this.vehicles) (vehicle.vehicleSystem as VehicleSystem).dispose();
    this.vehicles = [];
    hideToolBar(this.ui);
    this.selectedToolId = null;
    this.state = 'waitingForStory';
  }

  // --- Input (spec十/十一) ---

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (!this.playerController.isLocked) return; // safe here — this feature only ever fires mid-session, well after the player has already engaged Pointer Lock at least once (unlike DreamComicSystem's own Day1-from-boot edge case)

    if (this.state === 'cleaning') {
      const digitIndex = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(event.code);
      if (digitIndex >= 0) {
        const toolIds = Object.keys(CLEANING_TOOL_LABELS) as CleaningToolId[];
        if (toolIds[digitIndex]) this.selectTool(toolIds[digitIndex]);
        return;
      }
      const bindings = this.settingsManager.inputBindings;
      if (bindings.matches('interact', event.code)) {
        this.tryStartCharge();
      }
      return;
    }

    if (this.state === 'cleaningDialogue' || this.state === 'vehicleThankYou') {
      const bindings = this.settingsManager.inputBindings;
      if (event.code === 'Space' || bindings.matches('interact', event.code) || bindings.matches('pickupPlace', event.code)) {
        event.preventDefault();
        this.advanceDialogue();
      }
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (this.state !== 'cleaning' || !this.chargingPointId) return;
    if (this.settingsManager.inputBindings.matches('interact', event.code)) this.cancelCharge();
  };

  private tryStartCharge(): void {
    if (this.chargingPointId) return;
    const aimed = this.getAimedMarker();
    if (!aimed) return;
    const def = getVehicleCleaningDefinition(aimed.vehicleId);
    if (!def || this.selectedToolId !== def.toolId) return; // spec十: 錯誤工具不能清潔
    this.chargingPointId = aimed.pointId;
    this.chargeElapsed = 0;
  }
}
