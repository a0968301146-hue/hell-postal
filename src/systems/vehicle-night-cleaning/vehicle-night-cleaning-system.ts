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
  createNightCleaningUi, setFadeOpacity, showVehicleCaption, hideVehicleCaption, removeVehicleCaption,
  updateVehicleCaptionPosition, NightCleaningUiHandle,
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
 *   - "Which tool is required" ("清潔點附著＋互動修正" follow-up round spec
 *     五/六: "玩家不選工具...requiredTool不應該顯示給玩家") is now PURELY an
 *     internal correctness field — tryStartCharge() below resolves it itself
 *     from the aimed point's own vehicleId via getVehicleCleaningDefinition,
 *     never compares it against anything the player chose.
 *
 * "載具對話事件化" round — vehicle dialogue (return greeting / per-point
 * reaction / thank-you) is driven ENTIRELY by GAME EVENTS, never by E:
 *   - A vehicle's greeting shows the moment IT arrives — see showGreeting(),
 *     called for EVERY vehicle from updateVehicleReturn() (never just the
 *     first one, and never gated behind the player aiming at it).
 *   - A point's reaction shows the instant completePoint() fires — the SAME
 *     event that finishes the charge, not a later, separate E press.
 *   - The final point's thank-you shows the same way.
 *   - The ONE remaining place E does anything dialogue-related is dismissing
 *     a vehicle's OWN thank-you message — and even that's only reachable
 *     when the player ISN'T aiming at a cleanable marker (see onKeyDown's
 *     own doc comment for why this resolves the "same E" conflation bug).
 * `this.state` has no separate per-dialogue values that block cleaning —
 * see NightCleaningState's own doc comment in the types file.
 *
 * "每台載具獨立字幕" round — dialogue content/progress (dialogueKind/
 * dialogueLines/dialogueLineIndex) moved from THIS class's own singleton
 * fields onto EACH VehicleCleaningInstance itself, and vehicle-night-
 * cleaning-ui.ts now owns a POOL of independent on-screen captions (one per
 * vehicle) instead of one shared box. Root cause this fixes: with a single
 * shared box, only ONE vehicle could ever be "the one talking" at a time —
 * every vehicle's own greeting had to compete for that one slot, and the
 * only fallback trigger left after removing E-gating was "the player aims
 * at it", which only the FIRST vehicle's own initial synchronous show
 * bypassed. Six independent captions mean six vehicles can each show their
 * own greeting the instant they arrive, genuinely simultaneously, with the
 * exact same code path for every one of them (spec二: 不要用 `if
 * (vehicle.type === 'frog')` 這種針對單一載具的特殊判斷).
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

  /** "回歸對話＋離開表演" round — the ONE vehicle currently driving itself
   * out toward its own config.exitPosition (VehicleSystem.moveToward,
   * reused unchanged from the same movement logic VehicleControlSystem's
   * own daytime departure already uses — see updateDeparture()). Only ever
   * one at a time by construction (this single nullable field IS the
   * capacity limit — unchanged from before this round, since "不要修改...
   * 載具離場" means the departure ANIMATION mechanism itself stays exactly
   * as it was), so a genuinely NEW vehicle that becomes ready to depart
   * while this slot is occupied queues instead — see requestDeparture()/
   * departureQueue below. */
  private departingVehicle: VehicleCleaningInstance | null = null;
  /** "載具對話事件化" round spec八/九 — vehicles awaiting their turn in the
   * single `departingVehicle` slot (see that field's own doc comment). */
  private departureQueue: VehicleCleaningInstance[] = [];

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
    // This lock is NOT about dialogue (see this class's own doc comment) —
    // it's purely so the player can't wander around behind a fully opaque
    // black screen while vehicles are spawning. Cleared the moment the
    // fade clears in updateVehicleReturn() below, well before any dialogue
    // caption shows.
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
    // points behind it (a real bug found during an earlier round's own
    // testing — see spawnReturnedVehicles' own onArrived() doc comment for
    // the other half of this fix).
    for (const vehicle of this.vehicles) (vehicle.vehicleSystem as VehicleSystem).update(deltaTime);

    // "每台載具獨立字幕" round — re-projects EVERY vehicle's own caption
    // (not just one shared box) every frame, so each stays pinned above its
    // own vehicle even though nothing else about it moves while its own
    // dialogue is up (the camera itself keeps moving as the player looks
    // around).
    for (const vehicle of this.vehicles) {
      if (vehicle.dialogueKind !== null) {
        updateVehicleCaptionPosition(this.ui, vehicle.vehicleId, this.camera, vehicle.vehicleSystem as VehicleSystem);
      }
    }

    switch (this.state) {
      case 'idle':
      case 'waitingForStory':
        return;
      case 'nightTransition':
        this.updateNightTransition(deltaTime);
        return;
      case 'vehicleReturn':
        this.updateVehicleReturn(deltaTime);
        return;
      case 'cleaning':
        // "載具對話事件化" round — these three now run together, every
        // frame, for the entire rest of the night: aiming/charging a point
        // for ANY vehicle, driving whichever vehicle is currently in the
        // single departingVehicle slot, and checking whether the whole
        // night is finally done. None of them gate each other any more.
        this.updateCleaning(deltaTime);
        this.updateDeparture(deltaTime);
        this.checkAllDone();
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

  /** "每台載具獨立字幕" round — EVERY returned vehicle shows its own
   * greeting here, the instant the return fade clears (spec: "每一台載具
   * 完成『抵達』事件後...不需要玩家瞄準光點...不需要等待計時器"). Not just the
   * first one, not gated behind the player aiming at any of them — a single
   * uniform loop over `this.vehicles` calling the exact same showGreeting()
   * for each, with zero per-vehicle branching (spec二: 不要用 `if
   * (vehicle.type === 'frog')` 這種特殊判斷). Cleaning is available
   * immediately afterward too — none of this blocks it. */
  private updateVehicleReturn(deltaTime: number): void {
    this.fadeTimer += deltaTime;
    if (this.fadeTimer < NIGHT_FADE_HOLD_SECONDS) return;
    setFadeOpacity(this.ui, 0);
    this.playerData.state = 'empty-handed';
    this.playerController.setInputEnabled(true);
    for (const vehicle of this.vehicles) this.showGreeting(vehicle);
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
      // real bug found during an earlier round's own testing: several of
      // frog's own "嘴巴" cleaning points sit inside that basin, genuinely
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
        dialogueKind: null, dialogueLines: [], dialogueLineIndex: 0,
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

  /** "清潔點附著＋互動修正" follow-up spec五/六: the required tool is resolved
   * SILENTLY here (tryStartCharge below) from the aimed point's own
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

  /** "載具對話事件化" round — THE fix for the "same E" conflation bug this
   * round's spec二/四/七 describe in full: completePoint() (called directly
   * from updateCleaning() the instant a charge finishes — the SAME event,
   * not a later separate one) now shows the vehicle's own next message
   * ITSELF, synchronously, and — critically — `this.state` NEVER changes
   * away from 'cleaning' to do it. There is no longer any intermediate
   * dialogue-only state for the player's still-held E key to get stuck
   * behind: the very next charge (on this point or any other) can start
   * the instant the player next aims-and-presses-E, with zero dismiss step
   * required in between (spec: "不應該要求玩家再額外按一次E才能推進"). Only
   * the TRUE LAST point routes to showThankYou() instead of
   * showPointReaction() — thank-you is the one message that DOES still need
   * an explicit player-driven "I'm done reading this" moment, since after
   * it the vehicle actually leaves. */
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
      this.showThankYou(vehicle);
    } else {
      this.showPointReaction(vehicle);
    }
  }

  // --- Dialogue display (event-driven, per-vehicle — spec一至十) ---

  /** Vehicle arrival — called uniformly for EVERY vehicle from
   * updateVehicleReturn(), never gated behind the player aiming at it or
   * any timer. Both of VEHICLE_RETURN_LINES's own lines are shown TOGETHER
   * (joined, not navigated one-at-a-time via E — there is no "advance the
   * return greeting" event in this design) so no existing dialogue content
   * is dropped. Each vehicle gets its OWN caption now (vehicle-night-
   * cleaning-ui.ts's own per-vehicle pool), so unlike the previous
   * single-shared-box design, this never has to check whether some OTHER
   * vehicle's message is "occupying" anything — there is nothing to
   * clobber. */
  private showGreeting(vehicle: VehicleCleaningInstance): void {
    if (vehicle.greeted) return;
    vehicle.greeted = true;
    const lines = VEHICLE_RETURN_LINES[vehicle.vehicleId] ?? DIALOGUE_LINE_RETURN_FALLBACK;
    vehicle.dialogueKind = 'return';
    vehicle.dialogueLines = lines;
    vehicle.dialogueLineIndex = lines.length - 1; // fully shown already, nothing left for E to advance
    showVehicleCaption(this.ui, vehicle.vehicleId, lines.join('\n'), false);
    updateVehicleCaptionPosition(this.ui, vehicle.vehicleId, this.camera, vehicle.vehicleSystem as VehicleSystem);
  }

  /** completePoint()'s own direct call for an ORDINARY (non-final) point —
   * single-line by design (VEHICLE_POINT_LINES), nothing for E to
   * navigate. */
  private showPointReaction(vehicle: VehicleCleaningInstance): void {
    const lines = VEHICLE_POINT_LINES[vehicle.vehicleId] ?? DIALOGUE_LINE_POINT_FALLBACK;
    vehicle.dialogueKind = 'point';
    vehicle.dialogueLines = lines;
    vehicle.dialogueLineIndex = lines.length - 1;
    showVehicleCaption(this.ui, vehicle.vehicleId, lines[0], false);
    updateVehicleCaptionPosition(this.ui, vehicle.vehicleId, this.camera, vehicle.vehicleSystem as VehicleSystem);
  }

  /** completePoint()'s own direct call for the TRUE LAST point. This is the
   * one message with a real pending player action (dismiss it) — with
   * separate per-vehicle captions, TWO different vehicles can each have
   * their own thank-you pending at once with zero conflict (spec: "不得互
   * 相串話" is satisfied structurally now, not via a queue). */
  private showThankYou(vehicle: VehicleCleaningInstance): void {
    const lines = VEHICLE_THANKYOU_LINES[vehicle.vehicleId] ?? DIALOGUE_LINE_THANKYOU_FALLBACK;
    vehicle.dialogueKind = 'thankYou';
    vehicle.dialogueLines = lines;
    vehicle.dialogueLineIndex = 0;
    showVehicleCaption(this.ui, vehicle.vehicleId, lines[0], true);
    updateVehicleCaptionPosition(this.ui, vehicle.vehicleId, this.camera, vehicle.vehicleSystem as VehicleSystem);
    this.refreshDialogueLockState();
  }

  /** "同一個E" bug fix, other half — while ANY vehicle's thank-you is
   * genuinely pending the player's own dismiss action, OTHER E-driven
   * systems (pickup/NPC/cheat buttons — see interaction-system.ts's own
   * 'vehicle-dialogue' check) must stay out of the way of an E press that
   * isn't aimed at any marker. Aiming at a marker still always wins
   * regardless (see onKeyDown). Recomputed from scratch (rather than a
   * simple counter) so it's correct no matter how many vehicles currently
   * have a pending thank-you. */
  private refreshDialogueLockState(): void {
    const anyPending = this.vehicles.some((v) => v.dialogueKind === 'thankYou');
    this.playerData.state = anyPending ? 'vehicle-dialogue' : 'empty-handed';
  }

  /** E-driven (onKeyDown, only reachable when NOT aiming at any marker) —
   * advances the given vehicle's own thank-you to its next line, or ends it
   * on the last one. */
  private advanceThankYou(vehicle: VehicleCleaningInstance): void {
    vehicle.dialogueLineIndex++;
    if (vehicle.dialogueLineIndex >= vehicle.dialogueLines.length) {
      this.endThankYou(vehicle);
      return;
    }
    showVehicleCaption(this.ui, vehicle.vehicleId, vehicle.dialogueLines[vehicle.dialogueLineIndex], true);
  }

  private endThankYou(vehicle: VehicleCleaningInstance): void {
    hideVehicleCaption(this.ui, vehicle.vehicleId);
    vehicle.dialogueKind = null;
    this.refreshDialogueLockState();
    vehicle.thanked = true;
    this.requestDeparture(vehicle);
  }

  /** Finds which vehicle's own pending thank-you the player most likely
   * means to dismiss when they press E while NOT aiming at any marker —
   * the one most centered in their current view (highest dot product
   * against camera-forward). With independent per-vehicle captions, more
   * than one vehicle can have a thank-you pending at once, so E (which is a
   * single key with no further targeting info of its own) needs SOME
   * deterministic resolution; "whichever one you're most looking toward" is
   * the same intuition SCENE_CONFIG.interactionDistance-based aiming
   * already uses for markers, just without a hitbox to raycast against
   * (thank-you dismissal isn't tied to a physical point in space the same
   * way charging one is). */
  private findClosestPendingThankYou(): VehicleCleaningInstance | null {
    const candidates = this.vehicles.filter((v) => v.dialogueKind === 'thankYou');
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    const camForward = new THREE.Vector3();
    this.camera.getWorldDirection(camForward);
    const toVehicle = new THREE.Vector3();
    let best: VehicleCleaningInstance | null = null;
    let bestDot = -Infinity;
    for (const v of candidates) {
      const vs = v.vehicleSystem as VehicleSystem;
      toVehicle.subVectors(vs.position, this.camera.position).normalize();
      const dot = toVehicle.dot(camForward);
      if (dot > bestDot) { bestDot = dot; best = v; }
    }
    return best;
  }

  // --- Departure performance (spec六/七/八) ---

  /** "載具對話事件化" round — the single `departingVehicle` slot (unchanged
   * capacity/animation mechanism, per spec's own "不要修改...載具離場") is
   * reachable from MULTIPLE vehicles finishing their own thank-you at close
   * to the same time — queues rather than starting a second departure on
   * top of the first. */
  private requestDeparture(vehicle: VehicleCleaningInstance): void {
    if (this.departingVehicle) {
      this.departureQueue.push(vehicle);
      return;
    }
    this.beginDeparture(vehicle);
  }

  /** Starts the just-thanked vehicle driving itself out — reuses
   * VehicleSystem.onDeparting()/moveToward() UNCHANGED (the exact same
   * methods VehicleControlSystem's own daytime departure calls), never a
   * second movement system. Player input was never disabled for dialogue in
   * the first place any more (see this class's own doc comment), so the
   * playerData.state/setInputEnabled calls below are now simply a defensive
   * re-assertion rather than an actual unlock — kept unchanged from the
   * "載具離開時玩家無法移動" round's own fix rather than removed, per this
   * round's own "不要修改...載具離場" instruction. */
  private beginDeparture(vehicle: VehicleCleaningInstance): void {
    this.departingVehicle = vehicle;
    (vehicle.vehicleSystem as VehicleSystem).onDeparting([]);
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
   * dropped from `this.vehicles`, and the next queued departure (if any)
   * takes the now-free slot. A no-op whenever nothing is currently
   * departing (called unconditionally from update()'s 'cleaning' case
   * every frame, alongside updateCleaning — see that switch case's own doc
   * comment). */
  private updateDeparture(deltaTime: number): void {
    const vehicle = this.departingVehicle;
    if (!vehicle) return;
    const vs = vehicle.vehicleSystem as VehicleSystem;
    const arrived = vs.moveToward(vs.config.exitPosition, deltaTime, []);
    if (!arrived) return;

    // Defensive — the vehicle's own caption should already be hidden by
    // endThankYou() well before it ever reaches departure, but this fully
    // REMOVES the DOM element (not just hides it) so a long multi-day run
    // doesn't quietly accumulate one leftover caption element per vehicle
    // that's ever cleaned a night.
    removeVehicleCaption(this.ui, vehicle.vehicleId);
    vs.dispose();
    this.vehicles = this.vehicles.filter((v) => v !== vehicle);
    this.departingVehicle = null;

    const next = this.departureQueue.shift();
    if (next) this.beginDeparture(next);
  }

  /** "載具對話事件化" round — the night is only genuinely finished once
   * every vehicle is gone AND nothing is mid-departure AND nothing is
   * queued to depart next. Called every frame from update()'s 'cleaning'
   * case. */
  private checkAllDone(): void {
    if (this.vehicles.length === 0 && !this.departingVehicle && this.departureQueue.length === 0) {
      this.state = 'waitingForStory';
    }
  }

  // --- Input (spec六: E鍵只允許「下一句」或「結束對話」) ---

  /** "載具對話事件化" round spec二/四/七 — THE fix for the "same E"
   * conflation bug: AIMING AT A VALID MARKER always takes priority. If the
   * player is looking at any cleanable point, E always means "charge it"
   * (tryStartCharge) — completely regardless of whether some OTHER
   * vehicle's thank-you happens to be pending dismissal elsewhere. Only
   * when NOT aiming at anything does E fall through to whichever vehicle's
   * thank-you the player is most likely looking toward (see
   * findClosestPendingThankYou's own doc comment).
   *
   * Also still doesn't gate on playerController.isLocked (see this file's
   * own git history — "進入黑夜卡死風險" round's fix for the same class of
   * bug DreamComicSystem/ItemRewardSystem already document): Pointer Lock
   * is a browser-level concept this feature's own E handling has no real
   * reason to depend on. */
  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (this.state !== 'cleaning') return;
    const bindings = this.settingsManager.inputBindings;

    if (this.getAimedMarker()) {
      if (bindings.matches('interact', event.code)) this.tryStartCharge();
      return;
    }

    const target = this.findClosestPendingThankYou();
    if (target) {
      if (event.code === 'Space' || bindings.matches('interact', event.code) || bindings.matches('pickupPlace', event.code)) {
        event.preventDefault();
        this.advanceThankYou(target);
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
