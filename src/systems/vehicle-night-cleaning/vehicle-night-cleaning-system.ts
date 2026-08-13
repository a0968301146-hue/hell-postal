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
  CleaningPointDefinition, getVehicleCleaningDefinition, pickNightlyCleaningPoints,
} from '../../data/vehicle/vehicle-cleaning-data';
import {
  createNightCleaningUi, setFadeOpacity, showVehicleDialogueText, hideVehicleDialogueBox, NightCleaningUiHandle,
} from './vehicle-night-cleaning-ui';
import { NightCleaningState, VehicleCleaningInstance } from './vehicle-night-cleaning-types';
import {
  VEHICLE_RETURN_LINES, VEHICLE_POINT_LINES, VEHICLE_THANKYOU_LINES,
  DIALOGUE_LINE_RETURN_FALLBACK, DIALOGUE_LINE_POINT_FALLBACK, DIALOGUE_LINE_THANKYOU_FALLBACK,
} from '../../data/vehicle/vehicle-night-dialogue-data';

const ALL_VEHICLE_CONFIGS: VehicleConfig[] = [...LAND_VEHICLE_CONFIGS, ...SEA_VEHICLE_CONFIGS];

/** GIANT_CAKE_DAY duplicated as a literal here rather than imported from
 * after-work-story-system.ts — mirrors vehicle-control-system.ts's/
 * complete-day-cheat-system.ts's own established convention of repeating
 * the bare `=== 8` check locally rather than depending on that file's own
 * internal constant (avoids a needless cross-system import purely for one
 * literal, same reasoning those two files already document). */
const DAY8 = 8;

/** One active cleaning marker — `mesh` is the small visible glow sphere
 * (spec八: "小型發光球"), `hitboxMesh` is a SEPARATE, larger invisible box the
 * aim raycast actually tests against ("清潔點附著＋互動修正" follow-up spec
 * 二/七: "互動區應該比視覺光點稍大，讓玩家容易操作...不要因此讓玩家可以隔著
 * 很遠的距離互動" — a bigger hit VOLUME co-located with the small visual dot,
 * not a bigger visual dot). Splitting these two follows the exact same
 * pattern AfterWorkStorySystem's own NPC already uses (a small visible body
 * + a separate, appropriately-sized invisible `npcHitboxMesh` the raycast
 * targets) — reused here rather than invented fresh. Both are disposed
 * together the moment a point completes (spec七: "同時移除：視覺光點/
 * interaction target/hitbox"). */
interface CleaningMarker {
  mesh: THREE.Mesh;
  hitboxMesh: THREE.Mesh;
  pointId: string;
  vehicleId: string;
}

const NIGHT_FADE_HOLD_SECONDS = 0.7;
const CLEAN_HOLD_DURATION_SECONDS = 1.0; // matches lost-found-cleaning-system.ts's own 1.0s precedent
const MARKER_RADIUS = 0.09;
/** Half-extent of the INVISIBLE hitbox raycasting actually targets — well
 * bigger than MARKER_RADIUS so the player never needs pixel-precise aim
 * (spec: "不要要求玩家必須瞄準非常精確的單一像素"), but still small enough
 * that it can't be triggered from far away or through unrelated geometry
 * (spec: "不要因此讓玩家可以隔著很遠的距離互動" — SCENE_CONFIG.
 * interactionDistance's own existing range check, unchanged, is still the
 * real distance limiter; this only widens the LATERAL aim tolerance). */
const HITBOX_HALF_EXTENT = 0.22;
type DialogueKind = 'return' | 'point' | 'thankYou';

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
 *   - Per-point/per-vehicle dialogue shows through this system's OWN fixed
 *     screen-space DOM panel (vehicle-night-cleaning-ui.ts's
 *     showVehicleDialogueText/hideVehicleDialogueBox — see that file's own
 *     doc comment for why this is deliberately NOT the same world-space
 *     sprite mechanism after-work-story-bubble-ui.ts's NPC dialogue still
 *     uses, "載具對話框位置" round).
 *   - The player lock during any popup reuses the SAME playerData.state=
 *     'stamping-minigame' + playerController.setInputEnabled(false)
 *     combination AfterWorkStorySystem/DreamComicSystem already established
 *     (spec十八).
 *   - "Which tool is required" ("清潔點附著＋互動修正" follow-up round spec
 *     五/六: "玩家不選工具...requiredTool不應該顯示給玩家") is now PURELY an
 *     internal correctness field — tryStartCharge() below resolves it itself
 *     from the aimed point's own vehicleId via getVehicleCleaningDefinition,
 *     never compares it against anything the player chose. There is no
 *     tool-select UI at all any more (vehicle-night-cleaning-ui.ts no longer
 *     builds one), and this stays deliberately NOT wired into
 *     core/game-state.ts's ActiveTool union or ToolSystem's hotbar/day-unlock
 *     gating either way.
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

  private chargingPointId: string | null = null;
  private chargeElapsed = 0;
  private fadeTimer = 0;
  private pendingVehicleIds: string[] = [];

  private dialogueKind: DialogueKind = 'return';
  private dialogueLines: string[] = [];
  private dialogueLineIndex = 0;
  private dialogueVehicle: VehicleCleaningInstance | null = null;

  /** "回歸對話＋離開表演" round — the ONE vehicle currently driving itself
   * out toward its own config.exitPosition (VehicleSystem.moveToward,
   * reused unchanged from the same movement logic VehicleControlSystem's
   * own daytime departure already uses — see updateVehicleDeparting()).
   * Only ever one at a time by construction (a vehicle only starts
   * departing once its OWN thank-you dialogue ends, and the whole system
   * stays in the single 'vehicleDeparting' state — never 'cleaning' — until
   * this one finishes), so a single nullable field is enough; no need for a
   * list. */
  private departingVehicle: VehicleCleaningInstance | null = null;

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

    this.ui = createNightCleaningUi();

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
      case 'vehicleReturnDialogue':
      case 'cleaningPointDialogue':
      case 'vehicleThankYou':
      case 'waitingForStory':
        return; // no continuous per-frame work — driven entirely by onKeyDown (spec三: 對話絕不自動消失/自動推進)
      case 'nightTransition':
        this.updateNightTransition(deltaTime);
        return;
      case 'vehicleReturn':
        this.updateVehicleReturn(deltaTime);
        return;
      case 'cleaning':
        this.updateCleaning(deltaTime);
        return;
      case 'vehicleDeparting':
        this.updateVehicleDeparting(deltaTime);
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
    // "回歸對話＋離開表演" round spec一: the player is NOT unlocked into
    // free cleaning yet — every returned vehicle gets to say its own
    // automatic greeting FIRST (chained sequentially by
    // beginNextReturnDialogue below), still fully locked the entire time.
    this.beginNextReturnDialogue();
  }

  // --- Return dialogue (spec一/二/十) ---

  /** Finds the next returned vehicle that hasn't greeted the player yet and
   * starts its dialogue; once every vehicle has (base case), finally
   * unlocks the player into free cleaning. Called both right after the
   * night-return fade clears (for the FIRST vehicle) and from endDialogue()
   * when one 'return' dialogue finishes (chaining to the next) — the
   * player's input stays disabled across the entire chain, only re-enabled
   * once this reaches the base case (spec十: "一次處理一台", never letting
   * the player act until every returned vehicle has had its say). */
  private beginNextReturnDialogue(): void {
    const nextVehicle = this.vehicles.find((v) => !v.greeted);
    if (!nextVehicle) {
      this.playerData.state = 'empty-handed';
      this.playerController.setInputEnabled(true);
      this.state = 'cleaning';
      return;
    }
    nextVehicle.greeted = true;
    this.beginDialogue(nextVehicle, 'return');
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

      // "排查碰撞格/Geometry再修正" round — passes this INSTANCE's own live
      // cleaningAnchors (populated during construction just above, from the
      // exact same local variables that built the real meshes) so the
      // minimum-spacing check below operates on genuine geometry, not a
      // second guessed copy of it.
      const nightlyPoints = pickNightlyCleaningPoints(vehicleId, vehicleSystem.cleaningAnchors); // spec七: 4-5, no duplicates, spec五: 最小間距
      const instance: VehicleCleaningInstance = {
        vehicleId, vehicleSystem, activePointIds: nightlyPoints.map((p) => p.id),
        completedPointIds: new Set(), greeted: false, thanked: false,
      };
      this.vehicles.push(instance);
      this.spawnMarkersForVehicle(vehicleId, vehicleSystem, nightlyPoints);
    }
  }

  /** Placeholder light (spec八: "小型發光球...玩家可以清楚看到這裡就是要清潔
   * 的位置...完成後該光點消失") plus its own SEPARATE, larger invisible hitbox
   * ("清潔點附著＋互動修正" follow-up spec二/七) — both positioned via
   * VehicleSystem.getSurfacePoint(), which resolves the point's own named
   * `cleaningAnchors` entry through Object3D.localToWorld() ("排查碰撞格/
   * Geometry再修正" round — replaces the previous round's own naive
   * "vehicle world position + hand-computed local offset" addition, which
   * silently ignored both BACK_AREA.floorY and any vehicle rotation; see
   * vehicle-cleaning-data.ts's own top-of-file doc comment for the full
   * root-cause writeup), so the hitbox always stays exactly co-located
   * with its own visible marker regardless of which vehicle/point it
   * belongs to. */
  private spawnMarkersForVehicle(vehicleId: string, vehicleSystem: VehicleSystem, points: CleaningPointDefinition[]): void {
    for (const point of points) {
      const anchor = vehicleSystem.cleaningAnchors[point.anchorName];
      if (!anchor) continue; // defensive — vehicle-cleaning-data.ts's own load-time check already guards against a typo'd anchorName
      const worldPos = vehicleSystem.getSurfacePoint(anchor);
      const geo = new THREE.SphereGeometry(MARKER_RADIUS, 12, 12);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffe27a, emissive: 0xffcc33, emissiveIntensity: 1.1 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(worldPos);
      this.markerGroup.add(mesh);

      // Invisible, larger hit VOLUME the raycast actually targets (spec二:
      // "互動區應該比視覺光點稍大...Raycast可以穩定命中") — never rendered
      // (MeshBasicMaterial with opacity 0, depthWrite off), mirrors
      // AfterWorkStorySystem's own npcHitboxMesh convention exactly.
      const hitboxGeo = new THREE.BoxGeometry(HITBOX_HALF_EXTENT * 2, HITBOX_HALF_EXTENT * 2, HITBOX_HALF_EXTENT * 2);
      const hitboxMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      const hitboxMesh = new THREE.Mesh(hitboxGeo, hitboxMat);
      hitboxMesh.position.copy(mesh.position);
      this.markerGroup.add(hitboxMesh);

      this.markers.push({ mesh, hitboxMesh, pointId: point.id, vehicleId });
    }
  }

  private removeMarker(pointId: string): void {
    const idx = this.markers.findIndex((m) => m.pointId === pointId);
    if (idx === -1) return;
    const marker = this.markers[idx];
    this.markerGroup.remove(marker.mesh);
    marker.mesh.geometry.dispose();
    (marker.mesh.material as THREE.Material).dispose();
    this.markerGroup.remove(marker.hitboxMesh);
    marker.hitboxMesh.geometry.dispose();
    (marker.hitboxMesh.material as THREE.Material).dispose();
    this.markers.splice(idx, 1);
  }

  // --- Cleaning (spec十/十一) ---

  /** Raycasts against each marker's own SEPARATE, larger hitboxMesh — never
   * the small visible glow sphere itself ("清潔點附著＋互動修正" follow-up
   * spec二/七) — so aiming doesn't require pixel-precise precision against a
   * tiny sphere, while SCENE_CONFIG.interactionDistance (unchanged) still
   * caps how far away it can be triggered from. */
  private getAimedMarker(): CleaningMarker | null {
    if (this.markers.length === 0) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = this.raycaster.intersectObjects(this.markers.map((m) => m.hitboxMesh), false);
    if (hits.length === 0) return null;
    if (hits[0].distance > SCENE_CONFIG.interactionDistance) return null;
    return this.markers.find((m) => m.hitboxMesh === hits[0].object) ?? null;
  }

  /** "清潔點附著＋互動修正" follow-up spec五/六: the player never picks a
   * tool at all any more — whichever tool a point actually needs is resolved
   * silently here (tryStartCharge below) from the aimed point's own
   * vehicleId, so there is no "wrong tool" outcome reachable from the
   * player's side; the prompt text is always the same generic "按住 E 清潔"
   * regardless of which vehicle/point is aimed at (spec四: 不要顯示任何工具
   * 資訊). */
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
    this.hud.showInteractionPrompt(def?.cleaningTarget ?? '', '按住 E 清潔');
  }

  private cancelCharge(): void {
    this.chargingPointId = null;
    this.chargeElapsed = 0;
    this.hud.hideChargeBar();
  }

  /** "光點完成即時反應" round — root cause of "完成光點後載具沒有再說話": an
   * EARLIER round ("清潔光點完成後無法移動") removed per-point dialogue
   * entirely, because the old implementation locked player input for a
   * barely-visible "……" popup and required a second, easy-to-miss E press
   * before the player could move again. That earlier fix over-corrected —
   * it also matches this round's own explicit spec ("每個光點都必須觸發一次
   * 載具反應...不能只有最後一個光點才說話") that a reaction is WANTED after
   * every ordinary point too, just implemented correctly this time: a
   * SHORT, single-line 'point' dialogue (VEHICLE_POINT_LINES, distinct from
   * the two-line return/thank-you sets) that still locks briefly (same
   * playerData.state/setInputEnabled combo every other dialogue kind here
   * uses) but reliably restores control the instant it's dismissed — see
   * endDialogue()'s own 'point' branch, which drops straight back to
   * 'cleaning' rather than chaining anywhere else. Only this vehicle's own
   * TRUE LAST point skips the 'point' reaction entirely and goes straight
   * to 'thankYou' (spec: "最後一個光點的感謝對話則維持目前完整流程"). */
  private completePoint(pointId: string): void {
    const vehicle = this.vehicles.find((v) => v.activePointIds.includes(pointId));
    if (!vehicle) return;
    this.hud.hideChargeBar();
    this.hud.hideInteractionPrompt();
    this.chargingPointId = null;
    this.chargeElapsed = 0;
    vehicle.completedPointIds.add(pointId);
    this.removeMarker(pointId);

    if (vehicle.completedPointIds.size >= vehicle.activePointIds.length) {
      // Every one of THIS vehicle's own nightly points is done — go
      // straight into its thank-you popup (spec十二/十三), skipping the
      // ordinary per-point reaction entirely for this last one.
      this.beginDialogue(vehicle, 'thankYou');
    } else {
      // An ordinary point completion — brief single-line reaction, see this
      // method's own doc comment.
      this.beginDialogue(vehicle, 'point');
    }
  }

  // --- Dialogue popups (spec十一/十二/十三) ---

  private beginDialogue(vehicle: VehicleCleaningInstance, kind: DialogueKind): void {
    this.dialogueVehicle = vehicle;
    this.dialogueKind = kind;
    this.dialogueLines = kind === 'return'
      ? (VEHICLE_RETURN_LINES[vehicle.vehicleId] ?? DIALOGUE_LINE_RETURN_FALLBACK)
      : kind === 'point'
      ? (VEHICLE_POINT_LINES[vehicle.vehicleId] ?? DIALOGUE_LINE_POINT_FALLBACK)
      : (VEHICLE_THANKYOU_LINES[vehicle.vehicleId] ?? DIALOGUE_LINE_THANKYOU_FALLBACK);
    this.dialogueLineIndex = 0;

    this.playerData.state = 'stamping-minigame';
    this.playerController.setInputEnabled(false);

    showVehicleDialogueText(this.ui, this.dialogueLines[0]);

    this.state = kind === 'return' ? 'vehicleReturnDialogue' : kind === 'point' ? 'cleaningPointDialogue' : 'vehicleThankYou';
  }

  private advanceDialogue(): void {
    this.dialogueLineIndex++;
    if (this.dialogueLineIndex >= this.dialogueLines.length) {
      this.endDialogue();
      return;
    }
    showVehicleDialogueText(this.ui, this.dialogueLines[this.dialogueLineIndex]);
  }

  private endDialogue(): void {
    hideVehicleDialogueBox(this.ui);
    const vehicle = this.dialogueVehicle;
    const kind = this.dialogueKind;
    this.dialogueVehicle = null;

    if (kind === 'return') {
      // "回歸對話＋離開表演" round — still fully player-locked: chain
      // straight to the NEXT returned vehicle's own greeting, or (base
      // case) finally unlock free cleaning once every vehicle has spoken.
      // Never re-enables input in between (spec三/十: the player can't act
      // until every returned vehicle has had its say).
      this.beginNextReturnDialogue();
      return;
    }

    if (kind === 'point') {
      // "光點完成即時反應" round — the ONE place this brief lock is meant to
      // release immediately, straight back into free cleaning (spec: "對話
      // 結束後必須立即恢復玩家移動"). Deliberately does NOT chain into
      // anything else — a 'point' dialogue can only ever have been started
      // from an ORDINARY (non-final) point completion (completePoint()
      // routes the true last point to 'thankYou' directly instead), so
      // there is never a thank-you/departure beat waiting behind it.
      this.playerData.state = 'empty-handed';
      this.playerController.setInputEnabled(true);
      this.state = 'cleaning';
      return;
    }

    // kind === 'thankYou' — still locked: this vehicle now performs its own
    // departure (a "watch it leave" beat, not a free moment) before
    // anything is unlocked again (beginDeparture keeps input disabled;
    // updateVehicleDeparting() is what finally re-enables it — see that
    // method's own doc comment).
    if (vehicle) {
      vehicle.thanked = true;
      this.beginDeparture(vehicle);
    }
  }

  // --- Departure performance (spec六/七/八) ---

  /** Starts the just-thanked vehicle driving itself out — reuses
   * VehicleSystem.onDeparting()/moveToward() UNCHANGED (the exact same
   * methods VehicleControlSystem's own daytime departure calls), never a
   * second movement system.
   *
   * BUG FIX ("載具離開時玩家無法移動" round) — root cause: player input used
   * to stay disabled straight through from the thank-you dialogue until
   * updateVehicleDeparting() below detected `arrived`, i.e. the player was
   * forced to stand still and watch the whole departure animation for EVERY
   * vehicle, not just the last one. Restoring input right here instead (the
   * moment departure STARTS, not once it finishes) is the actual fix — the
   * vehicle still drives itself away for real over the following frames
   * (moveToward, unchanged below), it just no longer requires the player to
   * stand and watch it happen. `this.state` stays 'vehicleDeparting' (not
   * 'cleaning') the whole time regardless — the player can walk around
   * freely, but can't start charging another point until THIS vehicle's own
   * departure is fully done (onKeyDown's own 'cleaning'-only gate below). */
  private beginDeparture(vehicle: VehicleCleaningInstance): void {
    this.departingVehicle = vehicle;
    (vehicle.vehicleSystem as VehicleSystem).onDeparting([]);
    this.state = 'vehicleDeparting';
    this.playerData.state = 'empty-handed';
    this.playerController.setInputEnabled(true);
  }

  /** Drives the departing vehicle toward its own config.exitPosition every
   * frame via the SAME moveToward() VehicleControlSystem's daytime
   * departure already uses (spec七: "不要複製一套新的載具移動邏輯") — this
   * also means the frog's own existing "won't move until its mouth has
   * fully closed" gate (moveToward's own internal check) applies for free,
   * with zero extra code here. Only once actually arrived (never a
   * teleport — spec七: "不要瞬間teleport消失") is the vehicle disposed and
   * dropped from `this.vehicles`; `waitingForStory` (spec十一: AND
   * allVehiclesDeparted) is only reachable here, once every vehicle is
   * gone. Player input is no longer this method's concern at all — see
   * beginDeparture()'s own doc comment, it's already been restored the
   * moment departure started. */
  private updateVehicleDeparting(deltaTime: number): void {
    const vehicle = this.departingVehicle;
    if (!vehicle) { this.state = 'cleaning'; return; } // defensive — unreachable in practice
    const vs = vehicle.vehicleSystem as VehicleSystem;
    const arrived = vs.moveToward(vs.config.exitPosition, deltaTime, []);
    if (!arrived) return;

    vs.dispose();
    this.vehicles = this.vehicles.filter((v) => v !== vehicle);
    this.departingVehicle = null;

    this.state = this.vehicles.length === 0 ? 'waitingForStory' : 'cleaning';
  }

  // --- Input (spec十/十一) ---

  /** BUG FIX ("進入黑夜卡死風險" round) — no longer gates on
   * playerController.isLocked, matching DreamComicSystem's/ItemRewardSystem's
   * own established fix for the exact same class of bug ("夢境卡死修正" round
   * — see DreamComicSystem.onKeyDown's own doc comment for the full root-
   * cause writeup): Pointer Lock is a browser-level concept this feature's
   * own dialogue advance/interact keys have no real reason to depend on — if
   * real Pointer Lock is ever lost for any reason (window blur, Escape, a
   * browser quirk) while the player is mid-dialogue here, gating on isLocked
   * would silently drop every subsequent E press, leaving the player
   * permanently stuck at playerData.state='stamping-minigame' with no way to
   * ever advance/end the dialogue that's the ONLY thing still holding that
   * lock. `this.state` alone is the correct, sufficient guard — this class is
   * its own exclusive input owner while state is 'cleaning'/
   * 'vehicleReturnDialogue'/'cleaningPointDialogue'/'vehicleThankYou'
   * (movement is separately gated via playerData.state/inputEnabled, so
   * nothing else meaningfully competes for E/Space here regardless of
   * Pointer Lock status). */
  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;

    if (this.state === 'cleaning') {
      const bindings = this.settingsManager.inputBindings;
      if (bindings.matches('interact', event.code)) {
        this.tryStartCharge();
      }
      return;
    }

    if (this.state === 'vehicleReturnDialogue' || this.state === 'cleaningPointDialogue' || this.state === 'vehicleThankYou') {
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

  /** "清潔點附著＋互動修正" follow-up spec五/六: the required tool is
   * resolved SILENTLY here from the aimed point's own vehicle (never
   * compared against anything the player picked, since the player never
   * picks one) — `getVehicleCleaningDefinition` is only a defensive
   * "this point genuinely belongs to a real vehicle definition" check, not a
   * correctness gate the player can fail. */
  private tryStartCharge(): void {
    if (this.chargingPointId) return;
    const aimed = this.getAimedMarker();
    if (!aimed) return;
    const def = getVehicleCleaningDefinition(aimed.vehicleId);
    if (!def) return;
    this.chargingPointId = aimed.pointId;
    this.chargeElapsed = 0;
  }
}
