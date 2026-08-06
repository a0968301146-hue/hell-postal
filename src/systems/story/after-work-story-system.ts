import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { PlayerController } from '../player';
import { PlayerInteractionData, ActiveTool } from '../../core/game-state';
import { HUD } from '../hud';
import { SettingsManager, TextSpeed } from '../settings';
// Imported directly from pickup-system.ts, NOT the '../interaction' barrel —
// mirrors pallet-system.ts's own established reasoning for the same import
// (avoids a real import cycle back through the interaction barrel).
import { PickupSystem } from '../interaction/pickup-system';
import { LocalStorageAdapter } from '../../adapters/local-storage/local-storage-adapter';
import { LOST_FOUND_ROOM } from '../../data/world/lost-found-layout-data';
import { fishingSeatAnchorA, fishingSeatAnchorB, fishingLookTarget } from '../world-layout/fishing-pier-data';
import { AFTER_WORK_STORIES, AFTER_WORK_STORY_NPC_SPAWN, AFTER_WORK_STORY_NPC_WAIT_SPOT } from './after-work-story-data';
import { createStoryBubble, showStoryBubbleText, hideStoryBubble, disposeStoryBubble, wrapStoryLine } from './after-work-story-bubble-ui';

type StoryState = 'inactive' | 'npcWalking' | 'waitingForPlayer' | 'transitioning' | 'dialogue' | 'completed';

const NPC_SPEED = 1.6; // m/s — same convention as lost-found-npc-system.ts
const ARRIVE_EPS = 0.08;
/** Matches lost-found-npc-system.ts's own resting-capsule-on-floor formula
 * exactly (capsule half-length 0.45 + radius 0.28 above the floor) — this
 * NPC's own group always sits at world Y=0 with this as the body mesh's own
 * local Y offset, same convention, since every floor this NPC ever stands on
 * (LOST_FOUND_ROOM, BACK_AREA, the fishing pier deck) shares the identical
 * floorY = -1.5 (confirmed via fishing-pier-data.ts: FISHING_PIER.floorY =
 * PIER.floorY = BACK_AREA.floorY, "無高度斷層"). */
const NPC_BODY_LOCAL_Y = LOST_FOUND_ROOM.floorY + 0.28 + 0.45;
const NPC_HEAD_Y = LOST_FOUND_ROOM.floorY + 1.9;
const NPC_HITBOX_WIDTH = 0.7;
const NPC_HITBOX_HEIGHT = 1.8;
const NPC_HITBOX_DEPTH = 0.6;

/** How close (raycast hit distance, not mere proximity) the crosshair must
 * be to the NPC for "E 交談" to fire (spec: "必須準心對準NPC按E才開始"). */
const INTERACT_DISTANCE = 3;

/** Black-fade duration each way (spec二: "約0.3～0.5秒黑畫面淡入淡出"). */
const FADE_SECONDS = 0.4;

/** Per-CJK-character reveal interval — 'standard' matches spec五's own
 * "每個中文字約35ms" baseline exactly; slow/fast/instant scale from it. This
 * is the first real consumer of SettingsManager's own already-stored,
 * previously-inert textSpeed setting (see settings-manager.ts's own doc
 * comment on setTextSpeed). */
const CHAR_INTERVAL_MS: Record<TextSpeed, number> = { slow: 55, standard: 35, fast: 18, instant: 0 };

const ESC_SKIP_HOLD_SECONDS = 1.5;

const STORAGE_KEY = 'hp_after_work_story_v1';
interface StoryProgress {
  completedDays: number[];
}

/**
 * "Add day one dock story event" round — a one-time, self-contained cutscene
 * triggered once day 1's own settlement finishes (see create-game-systems.ts's
 * dailyFlowSystem.onDayCompleted hook: `if (finishedDay === 1)
 * afterWorkStorySystem.trigger()`), entirely independent of DailyFlowSystem/
 * LostFoundSystem/PlayerController's own internals (only ever reads their
 * public API/exported data — never modifies them).
 *
 * Deliberately does NOT use PauseManager (spec二: "避免解除Pointer Lock與停
 * 止逐字文字") — instead locks the player via the SAME playerData.state/
 * PlayerController.setInputEnabled(false) combination the stamp-minigame
 * already established (confirmed: setInputEnabled(false) only clears
 * movement/jump/sprint flags, mouse-look stays fully live since
 * onMouseMoveCustom only ever checks _isLocked, never _inputEnabled — see
 * player-system.ts). Its own update() is called UNCONDITIONALLY every frame
 * from game-app.ts (never gated behind `!pauseManager.isPaused`, matching
 * cargoHookSystem/spraySystem/envelopeVacuumSystem's own established
 * "self-guarding system" convention), so its NPC walk-lerp and typewriter
 * timers keep advancing regardless of any OTHER pause reason that might
 * independently activate (e.g. Tab still opens the pause menu during this
 * story — a pre-existing, unrelated key listener this round was not asked
 * to touch — see this class's own doc comment in the completion report).
 *
 * Persists "has day N's story already played" to localStorage (mirrors
 * UpgradeSystem's own LocalStorageAdapter convention) — a plain in-memory
 * flag would NOT survive a normal page refresh (this prototype's own
 * DailyFlowSystem.currentDay resets to 1 on every fresh load with no
 * day-progress save of its own), so without persistence this cutscene would
 * replay on every reload that reaches day-1-end again. resetStoryProgress()
 * is the ONE explicit "新周目" hook (called from create-game-systems.ts's
 * existing "重新開始第1天" flow, spec六).
 */
export class AfterWorkStorySystem {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private physics: PhysicsSystem;
  private hud: HUD;
  private playerController: PlayerController;
  private playerData: PlayerInteractionData;
  private settingsManager: SettingsManager;
  private pickupSystem: PickupSystem;
  private storage = new LocalStorageAdapter();

  private state: StoryState = 'inactive';
  /** Defense-in-depth alongside the persisted flag — guarantees trigger()
   * can never spawn a second NPC / re-enter within the SAME session even if
   * called twice back to back (spec六: "不可重複生成NPC或重複進入第2天"). */
  private hasTriggeredThisSession = false;

  private npcGroup: THREE.Group | null = null;
  private npcBubble: THREE.Sprite | null = null;
  private npcHitboxMesh: THREE.Mesh | null = null;
  private npcTarget = new THREE.Vector3();

  private storyDay = 0;
  private lines: string[] = [];
  private lineIndex = 0;
  private wrappedCurrentLine = '';
  private revealMs = 0;

  private fadePhase: 'out' | 'in' | null = null;
  private fadeElapsed = 0;
  private fadeEl: HTMLDivElement;

  private escHolding = false;
  private escHoldElapsed = 0;

  private savedActiveTool: ActiveTool = 'empty';
  private raycaster = new THREE.Raycaster();

  constructor(
    scene: THREE.Scene, camera: THREE.PerspectiveCamera, physics: PhysicsSystem, hud: HUD,
    playerController: PlayerController, playerData: PlayerInteractionData, settingsManager: SettingsManager,
    pickupSystem: PickupSystem
  ) {
    this.scene = scene;
    this.camera = camera;
    this.physics = physics;
    this.hud = hud;
    this.playerController = playerController;
    this.playerData = playerData;
    this.settingsManager = settingsManager;
    this.pickupSystem = pickupSystem;

    this.fadeEl = document.createElement('div');
    this.fadeEl.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity ' + FADE_SECONDS + 's ease;z-index:9999;';
    document.body.appendChild(this.fadeEl);

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));
  }

  // --- Persistence (spec六: "新周目開始時重置第一天故事完成狀態") ---

  private hasCompletedDay(day: number): boolean {
    const saved = this.storage.getJSON<StoryProgress>(STORAGE_KEY);
    return !!saved?.completedDays.includes(day);
  }

  private markDayCompleted(day: number): void {
    const saved = this.storage.getJSON<StoryProgress>(STORAGE_KEY) ?? { completedDays: [] };
    if (!saved.completedDays.includes(day)) saved.completedDays.push(day);
    this.storage.setJSON(STORAGE_KEY, saved);
  }

  /** The ONE "new playthrough" hook — called from create-game-systems.ts's
   * existing "重新開始第1天" reset flow, right alongside
   * upgradeSystem.resetUpgradesForNewRun(), before the page reload that flow
   * already performs. That reload alone would already reset this class's own
   * in-memory state, but the PERSISTED completedDays flag would otherwise
   * survive across it and wrongly suppress next time — this clears that. */
  resetStoryProgress(): void {
    this.storage.removeItem(STORAGE_KEY);
  }

  // --- Trigger (spec一) ---

  /** Called from DailyFlowSystem's onDayCompleted callback when
   * `finishedDay` has a story entry. No-ops entirely if that day's story
   * already played (this session OR a past one, via the persisted flag) —
   * spec: "此事件每個新周目只執行一次，不可重複生成NPC或重複進入第2天". */
  trigger(finishedDay: number): void {
    if (this.hasTriggeredThisSession) return;
    if (this.state !== 'inactive' && this.state !== 'completed') return;
    const day = AFTER_WORK_STORIES[finishedDay] ? finishedDay : 0;
    if (!day || this.hasCompletedDay(day)) return;

    this.hasTriggeredThisSession = true;
    this.storyDay = day;
    this.lines = AFTER_WORK_STORIES[day].lines;
    this.spawnNpc(AFTER_WORK_STORIES[day].npcName);
    this.state = 'npcWalking';
  }

  private spawnNpc(displayName: string): void {
    const group = new THREE.Group();
    // Weathered/aged color distinct from the daily lost-found NPC's own
    // 0xc9a05a, purely cosmetic differentiation.
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8a7a68 });
    const capsuleGeo = new THREE.CapsuleGeometry(0.28, 0.9, 4, 8);
    const body = new THREE.Mesh(capsuleGeo, bodyMat);
    body.position.y = NPC_BODY_LOCAL_Y;
    group.add(body);

    // Invisible interaction hitbox — deliberately NOT registered into the
    // shared `interactables` map (spec: raycast must resolve ONLY to this
    // one-off story NPC, never fall through InteractionSystem's own generic
    // pickup path the way a shared-map registration would risk — see this
    // class's own doc comment / completion report for the full reasoning).
    // This system runs its OWN dedicated raycast (isAimingAtNpc below)
    // against this exact mesh instead.
    const hitboxGeo = new THREE.BoxGeometry(NPC_HITBOX_WIDTH, NPC_HITBOX_HEIGHT, NPC_HITBOX_DEPTH);
    const hitboxMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const hitboxMesh = new THREE.Mesh(hitboxGeo, hitboxMat);
    hitboxMesh.position.set(0, NPC_BODY_LOCAL_Y, 0);
    group.add(hitboxMesh);
    this.npcHitboxMesh = hitboxMesh;

    group.position.set(AFTER_WORK_STORY_NPC_SPAWN.x, 0, AFTER_WORK_STORY_NPC_SPAWN.z);
    this.scene.add(group);
    this.npcGroup = group;

    const bubble = createStoryBubble(NPC_HEAD_Y + 0.35);
    group.add(bubble);
    this.npcBubble = bubble;

    this.npcTarget.set(AFTER_WORK_STORY_NPC_WAIT_SPOT.x, 0, AFTER_WORK_STORY_NPC_WAIT_SPOT.z);
    // displayName is currently only used for the crosshair prompt title
    // (see isAimingAtNpc/update's own hud.showInteractionPrompt call) —
    // kept as a field-less local capture via closure would be overkill;
    // AFTER_WORK_STORIES[this.storyDay].npcName is read fresh each time
    // instead, so this parameter only needs to exist for callers that might
    // want to pass a different name in the future.
    void displayName;
  }

  // --- Empty-handed "E 交談" while waiting (spec一步驟4/5) ---

  private isAimingAtNpc(): boolean {
    if (!this.npcGroup || !this.npcHitboxMesh || this.state !== 'waitingForPlayer') return false;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.raycaster.set(this.camera.position, dir);
    const hits = this.raycaster.intersectObject(this.npcGroup, true);
    return hits.length > 0 && hits[0].distance <= INTERACT_DISTANCE;
  }

  private startStory(): void {
    if (this.state !== 'waitingForPlayer') return;
    this.hud.hideInteractionPrompt();
    this.savedActiveTool = this.playerData.activeTool;
    this.pickupSystem.forceDropHeld();
    this.playerData.state = 'stamping-minigame';
    this.playerController.setInputEnabled(false);
    this.state = 'transitioning';
    this.fadePhase = 'out';
    this.fadeElapsed = 0;
    this.fadeEl.style.opacity = '1';
  }

  // --- Teleport (spec二) ---

  private teleportToChairs(): void {
    const seatFloorY = fishingSeatAnchorA.y; // === fishingSeatAnchorB.y, same deck
    const playerBodyY = seatFloorY + 0.9; // resting-capsule-on-floor formula, see player-system.ts's own createPlayer/update
    const playerCameraY = playerBodyY + 0.6;

    this.physics.setPlayerPosition(new THREE.Vector3(fishingSeatAnchorA.x, playerBodyY, fishingSeatAnchorA.z));
    this.camera.position.set(fishingSeatAnchorA.x, playerCameraY, fishingSeatAnchorA.z);
    this.camera.lookAt(fishingLookTarget);

    if (this.npcGroup) {
      this.npcGroup.position.set(fishingSeatAnchorB.x, 0, fishingSeatAnchorB.z);
      const dx = fishingSeatAnchorA.x - fishingSeatAnchorB.x;
      const dz = fishingSeatAnchorA.z - fishingSeatAnchorB.z;
      this.npcGroup.rotation.y = Math.atan2(dx, dz);
    }
  }

  // --- Dialogue (spec三) ---

  private beginDialogue(): void {
    this.state = 'dialogue';
    this.lineIndex = 0;
    this.beginLine();
  }

  private beginLine(): void {
    const raw = this.lines[this.lineIndex];
    this.wrappedCurrentLine = wrapStoryLine(raw);
    this.revealMs = 0;
    const textSpeed = this.settingsManager.settings.text.textSpeed;
    if (CHAR_INTERVAL_MS[textSpeed] === 0) {
      // 'instant' — reveal the whole line immediately, no per-character wait.
      this.revealMs = this.wrappedCurrentLine.length * (CHAR_INTERVAL_MS.standard + 1);
    }
    if (this.npcBubble) showStoryBubbleText(this.npcBubble, this.revealedText());
  }

  private get isLineFullyRevealed(): boolean {
    const interval = CHAR_INTERVAL_MS[this.settingsManager.settings.text.textSpeed] || CHAR_INTERVAL_MS.standard;
    const revealedChars = Math.floor(this.revealMs / interval);
    return revealedChars >= this.wrappedCurrentLine.length;
  }

  private revealedText(): string {
    const interval = CHAR_INTERVAL_MS[this.settingsManager.settings.text.textSpeed] || CHAR_INTERVAL_MS.standard;
    const revealedChars = Math.min(this.wrappedCurrentLine.length, Math.floor(this.revealMs / interval));
    return this.wrappedCurrentLine.slice(0, revealedChars);
  }

  private revealFullLine(): void {
    const interval = CHAR_INTERVAL_MS[this.settingsManager.settings.text.textSpeed] || CHAR_INTERVAL_MS.standard;
    this.revealMs = this.wrappedCurrentLine.length * interval;
    if (this.npcBubble) showStoryBubbleText(this.npcBubble, this.revealedText());
  }

  private advanceLine(): void {
    if (this.lineIndex >= this.lines.length - 1) {
      this.finishStory();
      return;
    }
    this.lineIndex++;
    this.beginLine();
  }

  // --- End (spec三 last line / 四 Esc skip) ---

  private finishStory(): void {
    if (this.state === 'completed' || this.state === 'inactive') return;
    this.state = 'completed';
    this.escHolding = false;
    this.escHoldElapsed = 0;
    this.hud.hideChargeBar();
    this.hud.hideInteractionPrompt();
    if (this.npcBubble) hideStoryBubble(this.npcBubble);

    this.markDayCompleted(this.storyDay);

    this.disposeNpc();

    this.playerData.state = 'empty-handed';
    this.playerData.heldObjectId = null;
    this.playerData.activeTool = this.savedActiveTool;
    this.playerController.setInputEnabled(true);
    this.hud.showInstructions();
  }

  private disposeNpc(): void {
    if (!this.npcGroup) return;
    this.scene.remove(this.npcGroup);
    if (this.npcBubble) disposeStoryBubble(this.npcBubble);
    this.npcBubble = null;
    this.npcHitboxMesh = null;
    this.npcGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material?.dispose();
      }
    });
    this.npcGroup = null;
  }

  // --- Input (spec三/四) ---

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.playerController.isLocked) return;

    if (this.state === 'waitingForPlayer' && !event.repeat) {
      const bindings = this.settingsManager.inputBindings;
      if (event.code === 'Space' || bindings.matches('interact', event.code) || bindings.matches('pickupPlace', event.code)) {
        if (this.isAimingAtNpc()) {
          event.preventDefault();
          this.startStory();
        }
      }
      return;
    }

    if (this.state !== 'dialogue') return;

    if (event.code === 'Escape') {
      if (!event.repeat && !this.escHolding) {
        this.escHolding = true;
        this.escHoldElapsed = 0;
      }
      return;
    }

    if (event.repeat) return;
    const bindings = this.settingsManager.inputBindings;
    const isAdvanceKey = event.code === 'Space' || bindings.matches('interact', event.code) || bindings.matches('pickupPlace', event.code);
    if (!isAdvanceKey) return;
    event.preventDefault();
    if (this.isLineFullyRevealed) this.advanceLine();
    else this.revealFullLine();
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (event.code === 'Escape') {
      // spec四: "keyup未達1.5秒則取消" — cancels the hold-to-skip progress
      // regardless of how far it got, UNLESS skipStory() already fired (at
      // which point escHolding is already false — see update() below — so
      // this is naturally a harmless no-op post-skip, satisfying "不可因
      // keyup再次觸發").
      this.escHolding = false;
      this.escHoldElapsed = 0;
      if (this.state === 'dialogue') this.hud.hideChargeBar();
    }
  }

  private skipStory(): void {
    this.finishStory();
  }

  // --- Per-frame (called UNCONDITIONALLY from game-app.ts, spec二: no PauseManager) ---

  update(deltaTime: number): void {
    if (this.state === 'inactive' || this.state === 'completed') return;

    // Defensive per-frame re-assertion — ToolSystem's own digit-key
    // tool-switch has no awareness of this class's own lock (spec二:
    // "禁止...工具切換"), so this directly counteracts any change back to
    // whatever tool was active when the story started, every frame it's
    // locked. A one-frame popup/UI flicker is possible if the player
    // presses a digit key mid-story; the tool itself never actually changes
    // in practice.
    if (this.state === 'transitioning' || this.state === 'dialogue') {
      if (this.playerData.activeTool !== this.savedActiveTool) this.playerData.activeTool = this.savedActiveTool;
    }

    if (this.state === 'npcWalking') {
      this.updateNpcWalk(deltaTime);
      return;
    }

    if (this.state === 'waitingForPlayer') {
      if (this.isAimingAtNpc()) {
        const name = AFTER_WORK_STORIES[this.storyDay]?.npcName ?? '';
        this.hud.showInteractionPrompt(name, 'E 交談');
      } else {
        this.hud.hideInteractionPrompt();
      }
      return;
    }

    if (this.state === 'transitioning') {
      this.updateTransition(deltaTime);
      return;
    }

    if (this.state === 'dialogue') {
      this.updateDialogue(deltaTime);
      return;
    }
  }

  private updateNpcWalk(deltaTime: number): void {
    if (!this.npcGroup) return;
    const pos = this.npcGroup.position;
    const dx = this.npcTarget.x - pos.x;
    const dz = this.npcTarget.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < ARRIVE_EPS) {
      this.state = 'waitingForPlayer';
      return;
    }
    const step = Math.min(NPC_SPEED * deltaTime, dist);
    pos.x += (dx / dist) * step;
    pos.z += (dz / dist) * step;
    if (dist > 0.02) this.npcGroup.rotation.y = Math.atan2(dx, dz);
  }

  private updateTransition(deltaTime: number): void {
    this.fadeElapsed += deltaTime;
    if (this.fadePhase === 'out') {
      if (this.fadeElapsed >= FADE_SECONDS) {
        // Screen is fully black now — safe to teleport without a visible pop.
        this.teleportToChairs();
        this.fadePhase = 'in';
        this.fadeElapsed = 0;
        this.fadeEl.style.opacity = '0';
      }
    } else if (this.fadePhase === 'in') {
      if (this.fadeElapsed >= FADE_SECONDS) {
        this.fadePhase = null;
        this.beginDialogue();
      }
    }
  }

  private updateDialogue(deltaTime: number): void {
    this.revealMs += deltaTime * 1000;
    if (this.npcBubble) showStoryBubbleText(this.npcBubble, this.revealedText());

    this.hud.showInteractionPrompt(
      AFTER_WORK_STORIES[this.storyDay]?.npcName ?? '',
      'E／Space：完整顯示／下一句\n長按Esc：跳過故事'
    );

    if (this.escHolding) {
      this.escHoldElapsed += deltaTime;
      this.hud.showChargeBar(Math.min(this.escHoldElapsed / ESC_SKIP_HOLD_SECONDS, 1));
      if (this.escHoldElapsed >= ESC_SKIP_HOLD_SECONDS) {
        // Fires exactly once — escHolding is cleared immediately, so this
        // branch can't re-enter next frame, and the later keyup's own
        // handler finds escHolding already false (spec四: "不可因keyup再次
        // 觸發", "不可重複呼叫進入第2天").
        this.escHolding = false;
        this.escHoldElapsed = 0;
        this.hud.hideChargeBar();
        this.skipStory();
      }
    }
  }
}
