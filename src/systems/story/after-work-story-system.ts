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
import { MAIN_ROOM_CENTER_SPAWN } from '../world-layout/logistics-layout-data';
import { CAMPFIRE_BENCH_NORTH, CAMPFIRE_BENCH_EAST, CAMPFIRE_BENCH_WEST, CAMPFIRE_BENCH_SOUTH, CAMPFIRE_LOOK_TARGET, CAMPFIRE_CENTER } from '../../data/world/campfire-area-data';
import { AFTER_WORK_STORIES, AfterWorkStoryDay, FinaleNpcStation, FINALE_ENDING_SEAT, FINALE_CAKE_POS } from './after-work-story-data';
import { createStoryBubble, showStoryBubbleText, hideStoryBubble, disposeStoryBubble, wrapStoryLine } from './after-work-story-bubble-ui';
import { createLetterReadingUi, showLetterReadingUi, hideLetterReadingUi, LetterReadingUiHandle } from './letter-reading-ui';

type StoryState =
  | 'inactive' | 'npcWalking' | 'waitingForPlayer' | 'transitioning' | 'dialogue' | 'endTransition' | 'completed'
  // "每日特殊劇情系統" round — Day8's own free-roam party phase (spec: "玩家
  // 可自由走動並按E與每個NPC互動"), the one phase in this whole system where
  // player movement is NOT locked. Everything else reuses the states above.
  | 'finaleParty'
  // Terminal state once the credits finish fading in — update() no-ops from
  // here on (spec: "遊戲結束").
  | 'finaleCredits'
  // Day7 only (spec follow-up: "彈出信件閱讀UI...信件像貼在螢幕前展示") —
  // replaces the old dialogue-bubble flow for the letter's own text. No
  // typewriter/reveal, no fade-in (the overlay pops up directly over the
  // still-visible, dimmed world) — closing it (E) goes straight into the
  // SAME finishStory() ending every other day already uses.
  | 'letterReading'
  // Day8 follow-up round — replaces the old locked, dialogue-driven "大家
  // 陸續走了進來...快打開！" opening entirely (spec: "玩家需要主動拆開蛋糕
  // ...按F"). Free movement, exactly like 'finaleParty' — the player walks
  // up to the still-wrapped cake at their own pace; nothing else is present
  // yet (spec: "開始時只生成：巨型蛋糕包裹×1").
  | 'finaleCakeWait'
  // Brief locked beat while the unwrap animation plays (spec: "播放拆包裝
  // 流程"), then automatically resolves into 'finaleParty' — no player
  // input decides the outcome once started, matching every other short
  // "cutscene beat" in this file (spec: "沒有倒數，沒有失敗" — this one in
  // particular can't fail or hang, it's a fixed-duration timer).
  | 'finaleUnwrapping';

/** What should happen once the currently-showing `lines` array runs out
 * (last line consumed via advanceLine, or ESC-hold-skip) — added this round
 * so the SAME dialogue/reveal/skip engine (beginDialogue/beginLine/
 * advanceLine/revealFullLine, all untouched below) can drive four distinct
 * "what happens after" endings without a second dialogue system:
 * - 'endStory': the original/only behavior before this round — fade out,
 *   teleport back to MAIN_ROOM_CENTER_SPAWN, mark the day complete, restore
 *   control. Used by every ordinary day (1-6) and the day7 letter.
 * - 'finaleOpenReveal': day8's opening ("快打開！") + reveal ("是蛋糕！")
 *   lines share one sequence; once it ends, enter the free-roam party phase
 *   instead of ending the day.
 * - 'finaleStation': one of the party phase's own short per-NPC chats;  once
 *   it ends, just return to free-roam (no fade, nothing was ever locked).
 * - 'finaleEnding': the campfire's closing "歡迎回家。" line; once it ends,
 *   roll credits instead of restoring control. */
type DialogueReturnMode = 'endStory' | 'finaleOpenReveal' | 'finaleStation' | 'finaleEnding';

const NPC_SPEED = 1.6; // m/s — same convention as lost-found-npc-system.ts
const ARRIVE_EPS = 0.08;
/** Matches lost-found-npc-system.ts's own resting-capsule-on-floor formula
 * exactly (capsule half-length 0.45 + radius 0.28 above the floor) — this
 * NPC's own group always sits at world Y=0 with this as the body mesh's own
 * local Y offset, same convention, since every floor this NPC ever stands on
 * (LOST_FOUND_ROOM, BACK_AREA, the fishing pier deck, the coffee room, the
 * campfire clearing) shares the identical floorY = -1.5 ("無高度斷層"). */
const NPC_BODY_LOCAL_Y = LOST_FOUND_ROOM.floorY + 0.28 + 0.45;
const NPC_HEAD_Y = LOST_FOUND_ROOM.floorY + 1.9;
const NPC_HITBOX_WIDTH = 0.7;
const NPC_HITBOX_HEIGHT = 1.8;
const NPC_HITBOX_DEPTH = 0.6;

/** How close (raycast hit distance, not mere proximity) the crosshair must
 * be to the NPC for "E 交談" to fire (spec: "必須準心對準NPC按E才開始"). */
const INTERACT_DISTANCE = 3;

/** Day8 party phase's own campfire "sit down" trigger radius — a plain XZ
 * proximity check rather than a raycast (spec: "玩家最後在營火區坐下才觸發
 * 結局"; there is no "sit" animation anywhere in this codebase — every other
 * story day's own "sit" is likewise just a position teleport, see
 * teleportToDialogueSpot below — so "sits down" is read here as "walks up to
 * the fire and presses E", the same simplification already established). */
const ENDING_SEAT_RADIUS = 2.2;

/** Day8's own cake-unwrap trigger radius — same plain XZ-proximity approach
 * as ENDING_SEAT_RADIUS above, for the same reason (no "unwrap" raycast
 * target needed; the cake is a single large stationary prop). */
const CAKE_INTERACT_RADIUS = 2.2;
/** Fixed-duration "拆包裝流程" beat (spec follow-up) — a short locked visual
 * flourish (the ribbon spins away) before the box swaps to its opened look
 * and the party begins. Deliberately brief and unconditional: no player
 * input can extend, skip past requirements, or fail it. */
const UNWRAP_DURATION = 1.0;
/** How long the opened cake + "生日快樂！" bubble lingers on screen after
 * UNWRAP_DURATION before control is handed back for the party phase. */
const REVEAL_LINGER = 1.2;

/** Black-fade duration each way (spec二: "約0.3～0.5秒黑畫面淡入淡出"). */
const FADE_SECONDS = 0.4;

/** Per-CJK-character reveal interval — 'standard' matches spec五's own
 * "每個中文字約35ms" baseline exactly; slow/fast/instant scale from it. This
 * is the first real consumer of SettingsManager's own already-stored,
 * previously-inert textSpeed setting (see settings-manager.ts's own doc
 * comment on setTextSpeed). */
const CHAR_INTERVAL_MS: Record<TextSpeed, number> = { slow: 55, standard: 35, fast: 18, instant: 0 };

// "每日特殊劇情系統" round bug-fix follow-up — skip-hold key moved from
// Escape to R (spec: "改為長按R"). Kept as its own named constant (not a
// SettingsManager-rebindable input, same as before) so this is still the
// ONE place the physical key is named — everything else below reads
// SKIP_HOLD_KEY_CODE rather than a literal 'KeyR'/'Escape' string.
const SKIP_HOLD_KEY_CODE = 'KeyR';
const SKIP_HOLD_SECONDS = 1.5;

const STORAGE_KEY = 'hp_after_work_story_v1';
interface StoryProgress {
  completedDays: number[];
}

/** Day8's own closing credits — this prototype has no real staff roster, so
 * this is a short in-universe "thank you" list rather than a literal
 * production credits screen, kept purely as static text (matches every
 * other narrative beat in this system, which is plain strings, never a new
 * asset/animation pipeline). */
const CREDITS_TEXT =
  '異世界物流中心\n\n感謝你陪伴這間物流中心走過的每一天\n\n企劃．製作\n物流中心全體員工\n\n特別感謝\n每一位願意把貨物交給我們的旅人\n\n— 全　劇　終 —';

/**
 * "Add day one dock story event" round — a one-time, self-contained cutscene
 * triggered once day 1's own settlement finishes (see create-game-systems.ts's
 * dailyFlowSystem.onDayCompleted hook: `if (finishedDay === 1)
 * afterWorkStorySystem.trigger()`), entirely independent of DailyFlowSystem/
 * LostFoundSystem/PlayerController's own internals (only ever reads their
 * public API/exported data — never modifies them).
 *
 * "每日特殊劇情系統" round — generalized to drive ALL 8 days (spec Claude注
 * 意事項1: "沿用Day1劇情系統，不要建立第二套劇情框架") purely by making the
 * per-day NPC spawn/wait/dialogue-seat coordinates and the "what happens when
 * the lines run out" ending (DialogueReturnMode above) data-driven, instead
 * of hardcoding the lost-found NPC's own spawn and the fishing-pier chairs as
 * THE one destination for every day. Day7 (no NPC, a letter) and Day8 (no
 * single NPC, a free-roam multi-NPC finale + credits) still reuse every one
 * of this class's own primitives — the fade/lock helpers, the typewriter
 * reveal/advance/skip engine, the story bubble UI — just wired through a
 * couple of new branches (isLetterDay / DialogueReturnMode) rather than a
 * parallel system.
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
  private dialogueReturnMode: DialogueReturnMode = 'endStory';

  private isLetterDay = false;
  private letterPickedUp = false;

  private cakeGroup: THREE.Group | null = null;
  private cakeMesh: THREE.Mesh | null = null;
  private cakeRibbon: THREE.Mesh | null = null;
  private unwrapElapsed = 0;
  private cakeOpenedFired = false;
  private finaleStations: { group: THREE.Group; hitbox: THREE.Mesh; bubble: THREE.Sprite; npcName: string; lines: string[] }[] = [];
  private activeFinaleStationIndex = -1;
  private pendingCredits = false;

  private fadePhase: 'out' | 'in' | null = null;
  private fadeElapsed = 0;
  private fadeEl: HTMLDivElement;
  private creditsEl: HTMLDivElement;
  private letterUi: LetterReadingUiHandle;

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

    this.creditsEl = document.createElement('div');
    this.creditsEl.style.cssText = 'position:fixed;inset:0;background:transparent;color:#f5f0e0;display:flex;align-items:center;justify-content:center;text-align:center;font-family:sans-serif;font-size:22px;line-height:2;opacity:0;pointer-events:none;transition:opacity 1.5s ease;z-index:10000;white-space:pre-line;';
    document.body.appendChild(this.creditsEl);

    this.letterUi = createLetterReadingUi();

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
    const config = AFTER_WORK_STORIES[finishedDay];
    if (!config || this.hasCompletedDay(finishedDay)) return;

    this.hasTriggeredThisSession = true;
    this.storyDay = finishedDay;
    this.isLetterDay = !!config.isLetterDay;
    this.letterPickedUp = false;
    this.pendingCredits = false;

    if (config.isFinaleDay) {
      this.beginFinaleIntro(config);
      return;
    }

    this.dialogueReturnMode = 'endStory';
    this.lines = config.lines;
    if (config.isLetterDay) {
      this.spawnLetterProp(config.letterPos ?? new THREE.Vector3(MAIN_ROOM_CENTER_SPAWN.x, MAIN_ROOM_CENTER_SPAWN.y, MAIN_ROOM_CENTER_SPAWN.z));
      this.state = 'waitingForPlayer';
    } else {
      this.spawnNpc(config.npcSpawn!, config.npcWaitSpot!);
      this.state = 'npcWalking';
    }
  }

  private spawnNpc(spawn: { x: number; z: number }, waitSpot: { x: number; z: number }): void {
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

    group.position.set(spawn.x, 0, spawn.z);
    this.scene.add(group);
    this.npcGroup = group;

    const bubble = createStoryBubble(NPC_HEAD_Y + 0.35);
    group.add(bubble);
    this.npcBubble = bubble;

    this.npcTarget.set(waitSpot.x, 0, waitSpot.z);
  }

  /** Day7 only — a small letter mesh resting exactly where it'll be found,
   * never walking anywhere (spec: "沒有NPC...地上有一封信"). Reuses the SAME
   * npcGroup/npcHitboxMesh/npcBubble fields every other day's NPC uses, so
   * isAimingAtNpc/disposeNpc/the story bubble all keep working unmodified —
   * this is just a different "thing the player interacts with", not a
   * different interaction system. */
  private spawnLetterProp(pos: THREE.Vector3): void {
    const group = new THREE.Group();
    const paper = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.3), new THREE.MeshStandardMaterial({ color: 0xf5efe0 }));
    paper.position.y = 0.02;
    paper.rotation.y = 0.3;
    group.add(paper);

    const hitboxMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hitboxMesh.position.y = 0.2;
    group.add(hitboxMesh);
    this.npcHitboxMesh = hitboxMesh;

    group.position.set(pos.x, pos.y, pos.z);
    this.scene.add(group);
    this.npcGroup = group;

    const bubble = createStoryBubble(pos.y + 0.7);
    group.add(bubble);
    this.npcBubble = bubble;
  }

  // --- Day8 finale (spec八) ---

  /** Kicks the finale straight into the fade+teleport (spec's own shared
   * "黑幕 → 傳送至劇情地點" beat) WITHOUT the usual npcWalking/
   * waitingForPlayer beats first — day8 has no single lead NPC to walk up to
   * and press E on; the cake itself IS the trigger. Follow-up round: the
   * fade+teleport now leads into free movement in front of the still-wrapped
   * cake (state 'finaleCakeWait', set from updateTransition's own fade-in-
   * complete branch) instead of a locked dialogue sequence — spec: "玩家需要
   * 主動拆開蛋糕...按F". dialogueReturnMode stays 'finaleOpenReveal' purely
   * as the marker updateTransition reads to route there instead of
   * beginDialogue(); no `lines` are set for this phase anymore. */
  private beginFinaleIntro(config: AfterWorkStoryDay): void {
    this.dialogueReturnMode = 'finaleOpenReveal';
    // Spawned now (not when the cake later opens) — invisible to the player
    // either way, since they're scattered across the whole map and the
    // player starts right next to the cake; by the time free-roam starts
    // they're already waiting in place, avoiding any pop-in.
    this.spawnFinaleStations(config.finaleNpcs ?? []);
    this.spawnCakeProp();
    this.lockAndFadeToStory();
  }

  /** Giant wrapped cake-package prop at the room's own center spawn (spec:
   * "外觀像放大版的蛋糕盒...約玩家身高5倍"; follow-up round: "拆開前蛋糕保持
   * 包裹狀態"). Modeled as a set piece that simply appears once the fade
   * reaches black, rather than as the ACTUAL item the player picked up from
   * the unload dock and carried over — this game has no "carry a specific
   * tracked cargo item to a non-dock placement zone" mechanic anywhere else
   * (every cargo objective ends at the normal outbound dock), and building
   * one from scratch for a single one-off prop would be a second, parallel
   * placement system. The day's own cargo manifest still spawns and ships
   * this same giant item through the completely ordinary pickup→carry→ship
   * pipeline (see cargo-manifest-data.ts's day-8 override) — this prop is
   * purely the finale's own stand-in for "the thing you just delivered",
   * swapped in the instant the screen goes black so the player never sees
   * both at once. The ribbon (this.cakeRibbon) is the one part of this that
   * actually animates — see updateFinaleUnwrapping below. */
  private spawnCakeProp(): void {
    const group = new THREE.Group();
    const box = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.4, 24), new THREE.MeshStandardMaterial({ color: 0xb85c3a }));
    box.position.y = 0.7;
    group.add(box);
    this.cakeMesh = box;
    const ribbon = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.08, 8, 24), new THREE.MeshStandardMaterial({ color: 0xe8c840 }));
    ribbon.rotation.x = Math.PI / 2;
    ribbon.position.y = 0.7;
    group.add(ribbon);
    this.cakeRibbon = ribbon;

    group.position.set(FINALE_CAKE_POS.x, FINALE_CAKE_POS.y, FINALE_CAKE_POS.z);
    this.scene.add(group);
    this.npcGroup = group;
    this.cakeGroup = group;

    const bubble = createStoryBubble(2.4);
    group.add(bubble);
    this.npcBubble = bubble;
  }

  /** Visual swap the instant the unwrap timer finishes (spec follow-up:
   * "蛋糕箱打開"), called from updateFinaleUnwrapping below. */
  private onCakeOpened(): void {
    const revealLine = AFTER_WORK_STORIES[this.storyDay]?.finaleRevealLines?.[0] ?? '生日快樂！';
    if (this.npcBubble) showStoryBubbleText(this.npcBubble, revealLine);
    if (!this.cakeMesh) return;
    (this.cakeMesh.material as THREE.MeshStandardMaterial).color.set(0xffe0b0);
    this.cakeMesh.scale.set(1, 0.55, 1);
    const icing = new THREE.Mesh(
      new THREE.SphereGeometry(1.35, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xfff6e6 })
    );
    icing.position.y = 1.1;
    this.cakeGroup?.add(icing);
  }

  private spawnFinaleStations(list: FinaleNpcStation[]): void {
    for (const npc of list) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 4, 8), new THREE.MeshStandardMaterial({ color: 0x8a7a68 }));
      body.position.y = NPC_BODY_LOCAL_Y;
      group.add(body);

      const hitboxMesh = new THREE.Mesh(
        new THREE.BoxGeometry(NPC_HITBOX_WIDTH, NPC_HITBOX_HEIGHT, NPC_HITBOX_DEPTH),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      hitboxMesh.position.set(0, NPC_BODY_LOCAL_Y, 0);
      group.add(hitboxMesh);

      group.position.set(npc.pos.x, 0, npc.pos.z);
      this.scene.add(group);

      const bubble = createStoryBubble(NPC_HEAD_Y + 0.35);
      group.add(bubble);

      this.finaleStations.push({ group, hitbox: hitboxMesh, bubble, npcName: npc.npcName, lines: npc.lines });
    }
  }

  private disposeFinaleStations(): void {
    for (const st of this.finaleStations) {
      this.scene.remove(st.group);
      disposeStoryBubble(st.bubble);
      st.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material?.dispose();
        }
      });
    }
    this.finaleStations = [];
  }

  /** Reached once the intro fade-in finishes for day8 (updateTransition's
   * own fade-in-complete branch, when dialogueReturnMode is
   * 'finaleOpenReveal') — restores full player movement immediately, same
   * shape as enterFinaleParty below, but the party hasn't started yet: only
   * the wrapped cake exists in the world (spec follow-up: "開始時只生成：
   * 巨型蛋糕包裹×1"). The player is free to walk right up and press F, or
   * wander a bit first — nothing else can happen until they do. */
  private enterCakeWait(): void {
    this.playerData.state = 'empty-handed';
    this.playerData.heldObjectId = null;
    this.playerData.activeTool = this.savedActiveTool;
    this.playerController.setInputEnabled(true);
    this.hud.showInstructions();
    this.state = 'finaleCakeWait';
  }

  private updateFinaleCakeWait(): void {
    const dx = this.camera.position.x - FINALE_CAKE_POS.x;
    const dz = this.camera.position.z - FINALE_CAKE_POS.z;
    if (Math.sqrt(dx * dx + dz * dz) <= CAKE_INTERACT_RADIUS) {
      this.hud.showInteractionPrompt('巨型蛋糕包裹', 'F 拆開包裝');
    } else {
      this.hud.hideInteractionPrompt();
    }
  }

  /** F-press near the cake (spec follow-up: "按F→播放拆包裝流程"). Locks
   * input for the fixed UNWRAP_DURATION + REVEAL_LINGER beat — same
   * "no player choice changes the outcome" shape as every other short
   * cutscene beat in this file (spec: "沒有倒數，沒有失敗" — it always
   * resolves the same way after a fixed time, nothing to fail). */
  private beginUnwrap(): void {
    this.hud.hideInteractionPrompt();
    this.savedActiveTool = this.playerData.activeTool;
    this.playerData.state = 'stamping-minigame';
    this.playerController.setInputEnabled(false);
    this.state = 'finaleUnwrapping';
    this.unwrapElapsed = 0;
    this.cakeOpenedFired = false;
  }

  private updateFinaleUnwrapping(deltaTime: number): void {
    this.unwrapElapsed += deltaTime;
    // Ribbon spins and shrinks away while "unwrapping" — purely decorative.
    if (this.cakeRibbon) {
      const t = Math.min(1, this.unwrapElapsed / UNWRAP_DURATION);
      this.cakeRibbon.rotation.y += deltaTime * 8;
      this.cakeRibbon.scale.setScalar(Math.max(0.001, 1 - t));
    }
    if (!this.cakeOpenedFired && this.unwrapElapsed >= UNWRAP_DURATION) {
      this.cakeOpenedFired = true;
      if (this.cakeRibbon) {
        this.cakeGroup?.remove(this.cakeRibbon);
        this.cakeRibbon.geometry.dispose();
        (this.cakeRibbon.material as THREE.MeshStandardMaterial).dispose();
        this.cakeRibbon = null;
      }
      this.onCakeOpened();
    }
    if (this.unwrapElapsed >= UNWRAP_DURATION + REVEAL_LINGER) {
      this.enterFinaleParty();
    }
  }

  /** Party phase entry (spec: "派對開始...玩家可自由走動") — reached once the
   * unwrap beat finishes (updateFinaleUnwrapping above). Restores player
   * control exactly like a normal day's finishStory() would, but WITHOUT
   * the fade/teleport/mark-completed steps — the day isn't over yet, the
   * party is just starting. */
  private enterFinaleParty(): void {
    this.hud.hideChargeBar();
    this.hud.hideInteractionPrompt();
    if (this.npcBubble) hideStoryBubble(this.npcBubble);
    this.playerData.state = 'empty-handed';
    this.playerData.heldObjectId = null;
    this.playerData.activeTool = this.savedActiveTool;
    this.playerController.setInputEnabled(true);
    this.hud.showInstructions();
    this.state = 'finaleParty';
  }

  private updateFinaleParty(): void {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.raycaster.set(this.camera.position, dir);
    let bestIdx = -1;
    let bestDist = INTERACT_DISTANCE;
    for (let i = 0; i < this.finaleStations.length; i++) {
      const hits = this.raycaster.intersectObject(this.finaleStations[i].hitbox, true);
      if (hits.length > 0 && hits[0].distance <= bestDist) {
        bestDist = hits[0].distance;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      this.hud.showInteractionPrompt(this.finaleStations[bestIdx].npcName, 'E 交談');
      return;
    }

    const dx = this.camera.position.x - FINALE_ENDING_SEAT.x;
    const dz = this.camera.position.z - FINALE_ENDING_SEAT.z;
    if (Math.sqrt(dx * dx + dz * dz) <= ENDING_SEAT_RADIUS) {
      this.hud.showInteractionPrompt('營火', 'E 坐下休息');
      return;
    }

    this.hud.hideInteractionPrompt();
  }

  /** Fires the E-press during the free-roam party phase — either starts a
   * short per-NPC chat, or (near the campfire) begins the ending. Returns
   * whether anything happened, purely so onKeyDown knows whether to
   * preventDefault(). */
  private tryFinaleInteract(): boolean {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.raycaster.set(this.camera.position, dir);
    let bestIdx = -1;
    let bestDist = INTERACT_DISTANCE;
    for (let i = 0; i < this.finaleStations.length; i++) {
      const hits = this.raycaster.intersectObject(this.finaleStations[i].hitbox, true);
      if (hits.length > 0 && hits[0].distance <= bestDist) {
        bestDist = hits[0].distance;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      this.beginStationDialogue(bestIdx);
      return true;
    }

    const dx = this.camera.position.x - FINALE_ENDING_SEAT.x;
    const dz = this.camera.position.z - FINALE_ENDING_SEAT.z;
    if (Math.sqrt(dx * dx + dz * dz) <= ENDING_SEAT_RADIUS) {
      this.beginFinaleEnding();
      return true;
    }
    return false;
  }

  /** One party NPC's own short chat — deliberately does NOT lock player
   * input/movement (spec explicitly keeps the party phase free-roam even
   * while talking; this is flavor dialogue, not a cutscene), just reuses the
   * bubble/reveal/advance/skip engine anchored to that one station. */
  private beginStationDialogue(index: number): void {
    const station = this.finaleStations[index];
    this.activeFinaleStationIndex = index;
    this.npcBubble = station.bubble;
    this.lines = station.lines;
    this.dialogueReturnMode = 'finaleStation';
    this.beginDialogue();
  }

  private endStationDialogue(): void {
    this.hud.hideChargeBar();
    this.hud.hideInteractionPrompt();
    if (this.npcBubble) hideStoryBubble(this.npcBubble);
    this.activeFinaleStationIndex = -1;
    this.state = 'finaleParty';
  }

  /** Campfire "sit down" beat (spec: "所有NPC聚在一起...『歡迎回家。』") —
   * reuses 'transitioning' AGAIN (fade out → teleportToDialogueSpot, now
   * branching to teleportToFinaleEnding below, → fade in → beginDialogue),
   * exactly the same shape as every ordinary day's own story start. */
  private beginFinaleEnding(): void {
    const config = AFTER_WORK_STORIES[this.storyDay];
    this.lines = config?.finaleEndingLines ?? ['歡迎回家。'];
    this.dialogueReturnMode = 'finaleEnding';
    this.lockAndFadeToStory();
  }

  private teleportToFinaleEnding(): void {
    const seat = new THREE.Vector3(FINALE_ENDING_SEAT.x, FINALE_ENDING_SEAT.y, FINALE_ENDING_SEAT.z + 1.4);
    const bodyY = seat.y + 0.9;
    const cameraY = bodyY + 0.6;
    this.physics.setPlayerPosition(new THREE.Vector3(seat.x, bodyY, seat.z));
    this.camera.position.set(seat.x, cameraY, seat.z);
    this.camera.lookAt(new THREE.Vector3(CAMPFIRE_LOOK_TARGET.x, CAMPFIRE_LOOK_TARGET.y, CAMPFIRE_LOOK_TARGET.z));

    this.disposeFinaleStations();
    if (this.cakeGroup) {
      this.scene.remove(this.cakeGroup);
      this.cakeGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material?.dispose();
        }
      });
      this.cakeGroup = null;
      this.cakeMesh = null;
    }
    this.spawnFinaleEndingCluster();
  }

  /** Every returning NPC, gathered around the campfire for the closing beat
   * (spec: "所有NPC聚在一起"). Cycles through the four benches (there are
   * more NPCs than benches — a couple end up sharing a bench's own spot,
   * an acceptable crowd-around-the-fire approximation for a closing shot,
   * not a gameplay-relevant placement). */
  private spawnFinaleEndingCluster(): void {
    const group = new THREE.Group();
    group.position.set(CAMPFIRE_CENTER.x, 0, CAMPFIRE_CENTER.z);
    const offsets = [CAMPFIRE_BENCH_NORTH, CAMPFIRE_BENCH_EAST, CAMPFIRE_BENCH_WEST, CAMPFIRE_BENCH_SOUTH];
    const roster = AFTER_WORK_STORIES[this.storyDay]?.finaleNpcs ?? [];
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8a7a68 });
    for (let i = 0; i < roster.length; i++) {
      const p = offsets[i % offsets.length];
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 4, 8), bodyMat);
      body.position.set(p.x - CAMPFIRE_CENTER.x, NPC_BODY_LOCAL_Y, p.z - CAMPFIRE_CENTER.z);
      group.add(body);
    }
    this.scene.add(group);
    this.npcGroup = group;

    const bubble = createStoryBubble(NPC_HEAD_Y + 0.9);
    group.add(bubble);
    this.npcBubble = bubble;
  }

  private beginCredits(): void {
    this.pendingCredits = true;
    this.finishStory();
  }

  private showCreditsOverlay(): void {
    this.creditsEl.textContent = CREDITS_TEXT;
    this.creditsEl.style.opacity = '1';
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

  private currentSpeakerName(): string {
    if (this.dialogueReturnMode === 'finaleStation' && this.activeFinaleStationIndex >= 0) {
      return this.finaleStations[this.activeFinaleStationIndex]?.npcName ?? '';
    }
    return AFTER_WORK_STORIES[this.storyDay]?.npcName ?? '';
  }

  private startStory(): void {
    if (this.state !== 'waitingForPlayer') return;
    this.lockAndFadeToStory();
  }

  /** Day7 only — the letter's own second E-press (spec follow-up: "彈出信件
   * 閱讀UI"). Deliberately does NOT go through lockAndFadeToStory()/
   * 'transitioning' — no fade-out/teleport is wanted here at all (spec: the
   * overlay "貼在螢幕前展示", popping up directly over the still-visible,
   * dimmed world exactly where the player already is), just the same input
   * lock every other story state uses. Closing it (onKeyDown's own
   * 'letterReading' branch) reuses finishStory() for the ending exactly like
   * every other day. */
  private beginLetterReading(): void {
    if (this.state !== 'waitingForPlayer') return;
    this.hud.hideInteractionPrompt();
    this.savedActiveTool = this.playerData.activeTool;
    this.pickupSystem.forceDropHeld();
    this.playerData.state = 'stamping-minigame';
    this.playerController.setInputEnabled(false);
    this.state = 'letterReading';
    const config = AFTER_WORK_STORIES[this.storyDay];
    showLetterReadingUi(this.letterUi, config?.letterSender ?? '', config?.letterRecipient ?? '', config?.letterBody ?? []);
  }

  /** Shared "lock player, start the fade-to-black" entry point — used both
   * by startStory() (player pressed E on a waiting NPC) and by the day8
   * finale's own auto-start / campfire-ending beats (which have no "wait for
   * E" step of their own to fire from). */
  private lockAndFadeToStory(): void {
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

  /** Generalizes the old hardcoded teleportToChairs() — every ordinary day
   * (1-6) now reads ITS OWN seatPlayer/seatNpc/lookTarget from
   * AFTER_WORK_STORIES instead of the fishing-pier chairs being the only
   * possible destination. Day7 (letter) has no seatPlayer at all, so this
   * simply no-ops — the letter is read exactly where it was found. */
  private teleportToDialogueSpot(): void {
    if (this.dialogueReturnMode === 'finaleEnding') {
      this.teleportToFinaleEnding();
      return;
    }

    const config = AFTER_WORK_STORIES[this.storyDay];
    if (!config?.seatPlayer) return;

    const seatFloorY = config.seatPlayer.y;
    const playerBodyY = seatFloorY + 0.9; // resting-capsule-on-floor formula, see player-system.ts's own createPlayer/update
    const playerCameraY = playerBodyY + 0.6;

    this.physics.setPlayerPosition(new THREE.Vector3(config.seatPlayer.x, playerBodyY, config.seatPlayer.z));
    this.camera.position.set(config.seatPlayer.x, playerCameraY, config.seatPlayer.z);
    if (config.lookTarget) this.camera.lookAt(config.lookTarget);

    if (config.seatNpc && this.npcGroup) {
      this.npcGroup.position.set(config.seatNpc.x, 0, config.seatNpc.z);
      const dx = config.seatPlayer.x - config.seatNpc.x;
      const dz = config.seatPlayer.z - config.seatNpc.z;
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
      this.onDialogueSequenceComplete();
      return;
    }
    this.lineIndex++;
    this.beginLine();
  }

  /** What happens once the current `lines` array is exhausted — see
   * DialogueReturnMode's own doc comment above for what each branch means. */
  private onDialogueSequenceComplete(): void {
    switch (this.dialogueReturnMode) {
      case 'finaleStation':
        this.endStationDialogue();
        break;
      case 'finaleOpenReveal':
        this.enterFinaleParty();
        break;
      case 'finaleEnding':
        this.beginCredits();
        break;
      case 'endStory':
      default:
        this.finishStory();
        break;
    }
  }

  // --- End (spec三 last line / 四 Esc skip) ---

  /** "Add main menu and return player after dock story" round 一: the SAME
   * single exit point both the natural end-of-dialogue path (advanceLine)
   * and skipStory() already funneled into before this round — now kicks off
   * a short black-fade transition (reusing this class's own fadeEl/
   * FADE_SECONDS, the exact same fade already used at story START) instead
   * of finishing synchronously in place, so the player is never left
   * standing at the fishing-pier chairs. Guarded against re-entry the same
   * way as before (only now 'endTransition' is ALSO excluded, so a second
   * advanceLine/skipStory call arriving mid-fade can't restart the
   * transition or double-teleport/double-mark-completed — spec:
   * "finishStory()只能成功執行一次"). Also the shared exit point for day8's
   * own credits roll (pendingCredits) — see updateEndTransition below. */
  private finishStory(): void {
    if (this.state === 'completed' || this.state === 'inactive' || this.state === 'endTransition') return;
    this.state = 'endTransition';
    this.escHolding = false;
    this.escHoldElapsed = 0;
    this.hud.hideChargeBar();
    this.hud.hideInteractionPrompt();
    if (this.npcBubble) hideStoryBubble(this.npcBubble);

    this.fadePhase = 'out';
    this.fadeElapsed = 0;
    this.fadeEl.style.opacity = '1';
  }

  /** Fires once the fade-out is fully black (fadeElapsed >= FADE_SECONDS) —
   * every step from spec一's own required order between "黑幕淡出" and
   * "黑幕淡入": teleport (+ Controller/body/camera sync + residual-velocity
   * clear, all inside teleportToMainRoomCenter), NPC removal, clearing the
   * story's own input-lock state, then restoring player movement/tools/
   * interaction — all while the screen is still fully black, so none of it
   * is ever visible as a pop/snap.
   *
   * Day8's own credits ending (pendingCredits) takes a different branch here
   * — it marks the day complete and shows the credits overlay instead of
   * teleporting/restoring control/fading back in, since the game is over. */
  private updateEndTransition(deltaTime: number): void {
    this.fadeElapsed += deltaTime;
    if (this.fadePhase === 'out') {
      if (this.fadeElapsed >= FADE_SECONDS) {
        if (this.pendingCredits) {
          this.markDayCompleted(this.storyDay);
          this.disposeNpc();
          this.disposeFinaleStations();
          this.showCreditsOverlay();
          this.fadePhase = null;
          this.state = 'finaleCredits';
          // Bug fix ("Day 2 之後測試按鈕不會生成每日特殊劇情NPC") — see the
          // reset below for the full explanation; harmless here too (no
          // AFTER_WORK_STORIES entry exists past day 8 for a future
          // trigger() to wrongly fire against).
          this.hasTriggeredThisSession = false;
          return;
        }

        this.teleportToMainRoomCenter();

        this.markDayCompleted(this.storyDay);
        this.disposeNpc();

        this.playerData.state = 'empty-handed';
        this.playerData.heldObjectId = null;
        this.playerData.activeTool = this.savedActiveTool;
        this.playerController.setInputEnabled(true);
        this.hud.showInstructions();

        this.fadePhase = 'in';
        this.fadeElapsed = 0;
        this.fadeEl.style.opacity = '0';
      }
    } else if (this.fadePhase === 'in') {
      if (this.fadeElapsed >= FADE_SECONDS) {
        this.fadePhase = null;
        this.state = 'completed';
        // Bug fix ("Day 2 之後測試按鈕不會生成每日特殊劇情NPC"): this field
        // was a correct one-shot-per-session latch back when only day 1 ever
        // had a story (its own doc comment above still describes that
        // original intent) — generalizing to 8 days turned it into a bug,
        // since it was never cleared once set, so trigger() unconditionally
        // no-op'd for every day after the first one that ever played this
        // session (its very first guard: `if (hasTriggeredThisSession)
        // return`) even though DailyFlowSystem.currentDay kept advancing
        // completely independently — exactly matching the reported symptom
        // ("日期會增加，NPC不會出現"). Its real job was only ever to stop a
        // SECOND trigger() call for the SAME day while one is still actively
        // running (state isn't 'inactive'/'completed' — already guarded by
        // the very next check below), not to block every later day forever
        // — so it resets here, the moment a story genuinely finishes,
        // re-arming trigger() for whichever day comes next.
        this.hasTriggeredThisSession = false;
      }
    }
  }

  /** Teleports the player from the story's own dialogue spot back to
   * MAIN_ROOM_CENTER_SPAWN (logistics-layout-data.ts) — mirrors
   * teleportToDialogueSpot's own manual physics+camera write pattern exactly
   * (PlayerController.update()'s own automatic camera sync doesn't run yet
   * at this point, since input is still disabled), plus a residual-velocity
   * reset teleportToDialogueSpot never needed (that teleport happens while
   * the player is still walking under their own control moments earlier in
   * the SAME frame budget; this one follows a screen-black beat with input
   * already off, so leftover gravity/jump state must be explicitly
   * cleared). */
  private teleportToMainRoomCenter(): void {
    const bodyY = MAIN_ROOM_CENTER_SPAWN.y + 0.9; // resting-capsule-on-floor formula, matches teleportToDialogueSpot
    const cameraY = bodyY + 0.6;

    this.physics.setPlayerPosition(new THREE.Vector3(MAIN_ROOM_CENTER_SPAWN.x, bodyY, MAIN_ROOM_CENTER_SPAWN.z));
    this.playerController.resetVerticalMotion();
    this.camera.position.set(MAIN_ROOM_CENTER_SPAWN.x, cameraY, MAIN_ROOM_CENTER_SPAWN.z);
    this.camera.rotation.set(0, MAIN_ROOM_CENTER_SPAWN.facingYaw, 0);
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
    this.cakeGroup = null;
    this.cakeMesh = null;
  }

  // --- Input (spec三/四) ---

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.playerController.isLocked) return;

    if (this.state === 'waitingForPlayer' && !event.repeat) {
      const bindings = this.settingsManager.inputBindings;
      if (event.code === 'Space' || bindings.matches('interact', event.code) || bindings.matches('pickupPlace', event.code)) {
        if (this.isAimingAtNpc()) {
          event.preventDefault();
          if (this.isLetterDay && !this.letterPickedUp) {
            this.letterPickedUp = true;
          } else if (this.isLetterDay) {
            this.beginLetterReading();
          } else {
            this.startStory();
          }
        }
      }
      return;
    }

    if (this.state === 'finaleParty' && !event.repeat) {
      const bindings = this.settingsManager.inputBindings;
      if (event.code === 'Space' || bindings.matches('interact', event.code) || bindings.matches('pickupPlace', event.code)) {
        if (this.tryFinaleInteract()) event.preventDefault();
      }
      return;
    }

    if (this.state === 'letterReading' && !event.repeat) {
      const bindings = this.settingsManager.inputBindings;
      if (event.code === 'Space' || bindings.matches('interact', event.code) || bindings.matches('pickupPlace', event.code)) {
        event.preventDefault();
        hideLetterReadingUi(this.letterUi);
        this.finishStory();
      }
      return;
    }

    // Day8 follow-up round — F only ever does anything here, near the cake,
    // during this one state (spec: "F只在Day8巨型蛋糕附近有效，不影響一般貨
    // 物"): PickupSystem/other systems own every other F-key use elsewhere,
    // and this class only ever reads KeyF while state === 'finaleCakeWait'.
    if (this.state === 'finaleCakeWait' && !event.repeat) {
      if (event.code === 'KeyF') {
        const dx = this.camera.position.x - FINALE_CAKE_POS.x;
        const dz = this.camera.position.z - FINALE_CAKE_POS.z;
        if (Math.sqrt(dx * dx + dz * dz) <= CAKE_INTERACT_RADIUS) {
          event.preventDefault();
          this.beginUnwrap();
        }
      }
      return;
    }

    if (this.state !== 'dialogue') return;

    if (event.code === SKIP_HOLD_KEY_CODE) {
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
    if (event.code === SKIP_HOLD_KEY_CODE) {
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
    this.onDialogueSequenceComplete();
  }

  // --- Per-frame (called UNCONDITIONALLY from game-app.ts, spec二: no PauseManager) ---

  update(deltaTime: number): void {
    if (this.state === 'inactive' || this.state === 'completed' || this.state === 'finaleCredits') return;

    // Defensive per-frame re-assertion — ToolSystem's own digit-key
    // tool-switch has no awareness of this class's own lock (spec二:
    // "禁止...工具切換"), so this directly counteracts any change back to
    // whatever tool was active when the story started, every frame it's
    // locked. A one-frame popup/UI flicker is possible if the player
    // presses a digit key mid-story; the tool itself never actually changes
    // in practice.
    // 'endTransition' only needs this reassertion during its own 'out'
    // phase — input is still disabled then, same as 'transitioning'/
    // 'dialogue'; by the time it flips to 'in', updateEndTransition has
    // already restored activeTool once AND re-enabled input for real, so
    // reasserting here any further would wrongly fight a genuinely-restored
    // player during that final black-screen beat. 'finaleParty' and
    // 'finaleCakeWait' are both deliberately excluded — those phases leave
    // input genuinely restored (free movement). 'finaleUnwrapping' IS
    // included — input is locked for that short fixed beat too.
    if (this.state === 'transitioning' || this.state === 'dialogue' || this.state === 'letterReading' || this.state === 'finaleUnwrapping' || (this.state === 'endTransition' && this.fadePhase === 'out')) {
      if (this.dialogueReturnMode !== 'finaleStation' && this.playerData.activeTool !== this.savedActiveTool) {
        this.playerData.activeTool = this.savedActiveTool;
      }
    }

    if (this.state === 'npcWalking') {
      this.updateNpcWalk(deltaTime);
      return;
    }

    if (this.state === 'waitingForPlayer') {
      if (this.isAimingAtNpc()) {
        const name = this.currentSpeakerName();
        if (this.isLetterDay) {
          this.hud.showInteractionPrompt(name || '信件', this.letterPickedUp ? 'E 打開信件' : 'E 撿起信件');
        } else {
          this.hud.showInteractionPrompt(name, 'E 交談');
        }
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

    if (this.state === 'finaleParty') {
      this.updateFinaleParty();
      return;
    }

    if (this.state === 'finaleCakeWait') {
      this.updateFinaleCakeWait();
      return;
    }

    if (this.state === 'finaleUnwrapping') {
      this.updateFinaleUnwrapping(deltaTime);
      return;
    }

    if (this.state === 'endTransition') {
      this.updateEndTransition(deltaTime);
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
        this.teleportToDialogueSpot();
        this.fadePhase = 'in';
        this.fadeElapsed = 0;
        this.fadeEl.style.opacity = '0';
      }
    } else if (this.fadePhase === 'in') {
      if (this.fadeElapsed >= FADE_SECONDS) {
        this.fadePhase = null;
        // Day8's own intro (spec follow-up: "按F拆包裝") skips the locked
        // dialogue engine entirely — free movement in front of the still-
        // wrapped cake instead. Every other day (including day8's own later
        // campfire-ending beat, dialogueReturnMode 'finaleEnding') still
        // goes through beginDialogue() exactly as before.
        if (this.dialogueReturnMode === 'finaleOpenReveal') {
          this.enterCakeWait();
        } else {
          this.beginDialogue();
        }
      }
    }
  }

  private updateDialogue(deltaTime: number): void {
    this.revealMs += deltaTime * 1000;
    if (this.npcBubble) showStoryBubbleText(this.npcBubble, this.revealedText());

    this.hud.showInteractionPrompt(
      this.currentSpeakerName(),
      'E／Space：完整顯示／下一句\n長按R：跳過故事'
    );

    if (this.escHolding) {
      this.escHoldElapsed += deltaTime;
      this.hud.showChargeBar(Math.min(this.escHoldElapsed / SKIP_HOLD_SECONDS, 1));
      if (this.escHoldElapsed >= SKIP_HOLD_SECONDS) {
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
