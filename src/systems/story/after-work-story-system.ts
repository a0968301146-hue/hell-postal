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
// Day8's own giant cake stopped being a separate decorative prop this round
// ("Day8巨型蛋糕物流化" — spec: "只有一個來源...不要額外在原地生成蛋糕") — F
// now unwraps the REAL cargo item directly, so this class needs read access
// to CargoSystem (find/detach the cake mesh) and DailyFlowSystem (know when
// day 8 has begun and which id is today's cargo). Neither file imports this
// one back (confirmed no cycle), same reasoning as pickup-system.ts above.
import { CargoSystem } from '../cargo/cargo-system';
import { DailyFlowSystem } from '../daily-flow/daily-flow-system';
// "載具夜間清潔互動" round — a one-way read-only dependency (this class only
// ever reads its `allVehiclesCleaned` getter, never calls into it); that
// file itself only imports from after-work-story-bubble-ui.ts (a lower-level
// shared UI helper, not this file), so no import cycle.
import { VehicleNightCleaningSystem } from '../vehicle-night-cleaning/vehicle-night-cleaning-system';
import { GIANT_CAKE_BOX_PRESET } from '../cargo/cargo-shape-presets';
import { LocalStorageAdapter } from '../../adapters/local-storage/local-storage-adapter';
import { LOST_FOUND_ROOM } from '../../data/world/lost-found-layout-data';
import { MAIN_ROOM_CENTER_SPAWN } from '../world-layout/logistics-layout-data';
import { CAMPFIRE_BENCH_NORTH, CAMPFIRE_BENCH_EAST, CAMPFIRE_BENCH_WEST, CAMPFIRE_BENCH_SOUTH, CAMPFIRE_LOOK_TARGET, CAMPFIRE_CENTER } from '../../data/world/campfire-area-data';
import {
  AFTER_WORK_STORIES, FinaleNpcStation, FinaleIdleKind, FINALE_ENDING_SEAT, DialogueEntry, DialogueChoiceEntry,
} from './after-work-story-data';
import { createStoryBubble, showStoryBubbleText, hideStoryBubble, disposeStoryBubble, wrapStoryLine } from './after-work-story-bubble-ui';
import { createLetterReadingUi, showLetterReadingUi, hideLetterReadingUi, LetterReadingUiHandle } from './letter-reading-ui';
import { createFinaleConfirmUi, showFinaleConfirmUi, hideFinaleConfirmUi, FinaleConfirmUiHandle } from './finale-confirm-ui';
import { FinaleParticleBurst, playUnwrapSfx, playCheerSfx, startPartyBgm, stopPartyBgm } from './finale-effects';
// "男主角台詞系統＋特殊NPC劇情選擇" round — ProtagonistDialogueSystem is a
// generic engine independent of this class (constructed in
// create-game-systems.ts, passed in here as a read/use reference only, same
// convention as pickupSystem/cargoSystem above); dialogue-choice-ui.ts is
// this round's own new satellite UI module, following the SAME "this class
// owns timing/state, the satellite only builds/shows/hides plain
// HTMLElements" convention as finale-confirm-ui.ts/letter-reading-ui.ts.
import { ProtagonistDialogueSystem } from '../dialogue/protagonist-dialogue-system';
import {
  createDialogueChoiceUi, showDialogueChoiceUi, hideDialogueChoiceUi, setDialogueChoiceHighlight, DialogueChoiceUiHandle,
} from '../dialogue/dialogue-choice-ui';

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
  // Day8 follow-up round, then reworked again by "Day8巨型蛋糕物流化" —
  // entered the instant DailyFlowSystem.currentDay becomes 8 (see
  // checkGiantCakeDayStart, called every frame from update() while
  // 'inactive'), with NO fade/teleport/lock of any kind: the player is
  // simply playing through day 8's own completely ordinary unload→carry→
  // place cargo loop the entire time this state is active. The ONLY thing
  // this state does is watch for "today's real giant-cake-box cargo item,
  // not currently held, within CAKE_INTERACT_RADIUS" and show the F prompt
  // (updateFinaleCakeWait) — F itself is handled in onKeyDown.
  | 'finaleCakeWait'
  // Brief locked beat while the unwrap animation plays (spec: "播放拆包裝
  // 流程"), then automatically resolves into 'finaleParty' — no player
  // input decides the outcome once started, matching every other short
  // "cutscene beat" in this file (spec: "沒有倒數，沒有失敗" — this one in
  // particular can't fail or hang, it's a fixed-duration timer).
  | 'finaleUnwrapping'
  // Polish-round follow-up — the campfire E-press now opens a binary
  // confirm ("今天就到這裡吧？【坐下休息】【再逛一下】") instead of jumping
  // straight into the ending. 'R' backs out to 'finaleParty' unchanged;
  // only 'E' here actually starts beginFinaleEnding.
  | 'finaleEndingConfirm'
  // Polish-round follow-up — the slow "camera pulls back, NPCs keep
  // partying, music keeps playing" beat between the "歡迎回家。" line and
  // the credits (spec follow-up五: "避免突然切到Credits"). Purely a timed
  // camera lerp; nothing the player does here changes the outcome.
  | 'finaleEndingHold'
  // "男主角台詞系統＋特殊NPC劇情選擇" round — a Choice node (DialogueEntry's
  // own 'choice' kind) is currently showing, waiting for the player to pick
  // one of pendingChoiceEntry's own options (see beginChoice/resolveChoice
  // below). Purely input-driven, no per-frame update needed — same shape as
  // the existing 'finaleEndingConfirm' state above.
  | 'choice';

/** What should happen once the currently-showing `lines` array runs out
 * (last line consumed via advanceLine, or ESC-hold-skip) — added this round
 * so the SAME dialogue/reveal/skip engine (beginDialogue/beginLine/
 * advanceLine/revealFullLine, all untouched below) can drive four distinct
 * "what happens after" endings without a second dialogue system:
 * - 'endStory': the original/only behavior before this round — fade out,
 *   teleport back to MAIN_ROOM_CENTER_SPAWN, mark the day complete, restore
 *   control. Used by every ordinary day (1-6) and the day7 letter.
 * - 'finaleStation': one of the party phase's own short per-NPC chats;  once
 *   it ends, just return to free-roam (no fade, nothing was ever locked).
 * - 'finaleEnding': the campfire's closing "歡迎回家。" line; once it ends,
 *   roll credits instead of restoring control.
 * (Day8's own opening no longer uses this engine at all — "Day8巨型蛋糕物流
 * 化" round replaced the old locked 'finaleOpenReveal' dialogue sequence
 * with a plain free-roam wait + real-cargo F-unwrap, see checkGiantCakeDayStart/
 * updateFinaleCakeWait below.) */
type DialogueReturnMode = 'endStory' | 'finaleStation' | 'finaleEnding';

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
 * target needed). Measured against the REAL cargo cake's own live mesh
 * position now ("Day8巨型蛋糕物流化" round), wherever the player actually
 * placed it — not a fixed world coordinate. */
const CAKE_INTERACT_RADIUS = 2.2;

/** Local, same convention as cargo-manifest-planner.ts's own GIANT_CAKE_DAY
 * constant (kept separate rather than importing that file's — systems/story
 * has no other reason to depend on systems/cargo/cargo-manifest-planner,
 * and the day number itself is the one piece of coupling every other
 * day-numbered special case in this codebase already accepts implicitly via
 * DailyFlowSystem.currentDay). */
const GIANT_CAKE_DAY = 8;
/** Fixed-duration "拆包裝流程" beat (spec follow-up) — a short locked visual
 * flourish (the ribbon spins away) before the box swaps to its opened look
 * and the party begins. Deliberately brief and unconditional: no player
 * input can extend, skip past requirements, or fail it. */
const UNWRAP_DURATION = 1.0;
/** How long the opened cake + "生日快樂！" bubble lingers on screen after
 * UNWRAP_DURATION before control is handed back for the party phase. */
const REVEAL_LINGER = 1.2;
/** How long the cake's own "pop" bounce-settle takes once opened — a plain
 * overshoot-then-settle scale curve, computed from elapsed time since
 * onCakeOpened() fired (no separate timer field needed). */
const CAKE_BOUNCE_DURATION = 0.4;

/** Polish-round follow-up — the "歡迎回家。" line auto-advances after this
 * long once fully revealed, instead of requiring an E press (spec follow-up
 * 五: the ending should read as one continuous, hands-off beat, not another
 * "press E to continue" prompt). R-hold-skip still works throughout for
 * anyone who wants to skip ahead. */
const ENDING_LINE_AUTO_ADVANCE_HOLD = 2.0;
/** How long the slow camera pull-back away from the campfire takes before
 * credits begin (spec follow-up五: "鏡頭慢慢拉遠...慢慢淡出"). */
const ENDING_PULLBACK_DURATION = 4.0;
/** How far back (and up) the camera drifts during that pull-back, in
 * meters — small enough to stay inside the campfire clearing, framing the
 * whole gathering rather than a single closeup. */
const ENDING_PULLBACK_DISTANCE = 3.5;
const ENDING_PULLBACK_RISE = 1.2;

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

/** BUG FIX ("結算搶跑於NPC劇情之前" round) — bumped from _v1's own
 * `{ completedDays: number[] }` shape, which remembered EVERY previously-
 * finished day forever. trigger()/checkGiantCakeDayStart only ever check
 * membership for the ONE day currently in flight (never a historical day —
 * confirmed: no other call site reads this key), so an ever-growing array
 * had no real behavioral advantage over a single scalar, but a real
 * liability: an entry left over from an EARLIER, unrelated dev/test session
 * (e.g. currentDay manually forced back to a day whose story had already
 * genuinely played in a different session/save) would silently convince
 * trigger() "today's story already happened" even though it demonstrably
 * never did in THIS run — VehicleControlSystem's own settlement gate
 * (isTodaysStoryResolved below) would then fire the instant the last vehicle
 * departed, with the NPC never having appeared at all. `resolvedDay` only
 * ever holds the SINGLE most-recently-resolved day (or null) — trigger()
 * only ever compares it against the one `finishedDay` it was just called
 * with, so this narrower shape is a strict fix with no lost functionality
 * for real, non-tampered play. */
const STORAGE_KEY = 'hp_after_work_story_v2';
interface StoryProgress {
  resolvedDay: number | null;
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
  private cargoSystem: CargoSystem;
  private dailyFlowSystem: DailyFlowSystem;
  /** "載具夜間清潔互動" round — read-only dependency, checked by startStory()/
   * beginLetterReading()/update()'s own prompt-suppression (spec十五: "NPC不
   * 會提前開始劇情...必須等待所有載具清潔完成"). This class never calls
   * anything ON it — purely a one-way "is it safe to start today's story
   * yet" read. */
  private vehicleNightCleaningSystem: VehicleNightCleaningSystem;
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
  private lines: DialogueEntry[] = [];
  private lineIndex = 0;
  private wrappedCurrentLine = '';
  private revealMs = 0;
  private dialogueReturnMode: DialogueReturnMode = 'endStory';

  /** "男主角台詞系統＋特殊NPC劇情選擇" round — generic protagonist-line
   * engine, read/used here only (owned/constructed independently, see this
   * class's own doc comment / create-game-systems.ts). */
  private protagonistDialogueSystem: ProtagonistDialogueSystem;
  private choiceUi: DialogueChoiceUiHandle;
  /** The Choice entry currently awaiting a pick (state === 'choice' only). */
  private pendingChoiceEntry: DialogueChoiceEntry | null = null;
  private choiceHighlightIndex = 0;
  /** The picked option's own response entries, played one at a time WITHOUT
   * ever mutating `lines` itself (spec十一: "不要修改原始lines陣列") —
   * consumed front-to-back by advanceLine(), then `lines` resumes exactly
   * where the choice node was. */
  private pendingResponseQueue: DialogueEntry[] = [];

  private isLetterDay = false;
  private letterPickedUp = false;

  // The REAL giant-cake-box cargo mesh becomes this system's own decorative
  // prop the instant it's unwrapped ("Day8巨型蛋糕物流化" round —
  // detachCargoAsProp below) — no separate decorative Group is ever spawned
  // any more, so `cakeMesh` alone now stands in for what the old `cakeGroup`
  // used to wrap.
  private cakeMesh: THREE.Mesh | null = null;
  private cakeRibbon: THREE.Mesh | null = null;
  private cakeLid: THREE.Mesh | null = null;
  private unwrapElapsed = 0;
  private cakeOpenedFired = false;
  private cakeOpenedAt = 0;
  private finaleStations: {
    group: THREE.Group; hitbox: THREE.Mesh; bubble: THREE.Sprite; npcName: string;
    lines: string[]; repeatLine: string; hasTalked: boolean; idleKind: FinaleIdleKind | undefined;
    baseYaw: number; idlePhase: number; prop: THREE.Mesh | null;
  }[] = [];
  private activeFinaleStationIndex = -1;
  private pendingCredits = false;
  private finaleParticles: FinaleParticleBurst | null = null;
  /** Running clock used purely to phase-offset idle sine waves (spec follow-
   * up二) — resets implicitly whenever the party phase (re)starts since it's
   * only ever read there; never persisted or synced to anything else. */
  private idleClock = 0;

  private confirmUi: FinaleConfirmUiHandle;
  private endingLineHoldElapsed = 0;
  private endingPullbackElapsed = 0;
  private endingCameraStart = new THREE.Vector3();
  private endingCameraEnd = new THREE.Vector3();
  private endingFireBoostLight: THREE.PointLight | null = null;
  private endingClusterBodies: THREE.Mesh[] = [];

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
    pickupSystem: PickupSystem, cargoSystem: CargoSystem, dailyFlowSystem: DailyFlowSystem,
    vehicleNightCleaningSystem: VehicleNightCleaningSystem, protagonistDialogueSystem: ProtagonistDialogueSystem
  ) {
    this.scene = scene;
    this.camera = camera;
    this.physics = physics;
    this.hud = hud;
    this.playerController = playerController;
    this.playerData = playerData;
    this.settingsManager = settingsManager;
    this.pickupSystem = pickupSystem;
    this.cargoSystem = cargoSystem;
    this.dailyFlowSystem = dailyFlowSystem;
    this.vehicleNightCleaningSystem = vehicleNightCleaningSystem;
    this.protagonistDialogueSystem = protagonistDialogueSystem;
    this.choiceUi = createDialogueChoiceUi();

    this.fadeEl = document.createElement('div');
    this.fadeEl.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity ' + FADE_SECONDS + 's ease;z-index:9999;';
    document.body.appendChild(this.fadeEl);

    this.creditsEl = document.createElement('div');
    this.creditsEl.style.cssText = 'position:fixed;inset:0;background:transparent;color:#f5f0e0;display:flex;align-items:center;justify-content:center;text-align:center;font-family:sans-serif;font-size:22px;line-height:2;opacity:0;pointer-events:none;transition:opacity 1.5s ease;z-index:10000;white-space:pre-line;';
    document.body.appendChild(this.creditsEl);

    this.letterUi = createLetterReadingUi();
    this.confirmUi = createFinaleConfirmUi();

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));
  }

  // --- Persistence (spec六: "新周目開始時重置第一天故事完成狀態") ---

  private hasCompletedDay(day: number): boolean {
    const saved = this.storage.getJSON<StoryProgress>(STORAGE_KEY);
    return saved?.resolvedDay === day;
  }

  private markDayCompleted(day: number): void {
    this.storage.setJSON(STORAGE_KEY, { resolvedDay: day });
  }

  /** The ONE "new playthrough" hook — called from create-game-systems.ts's
   * existing "重新開始第1天" reset flow, right alongside
   * upgradeSystem.resetUpgradesForNewRun(), before the page reload that flow
   * already performs. That reload alone would already reset this class's own
   * in-memory state, but the PERSISTED resolvedDay flag would otherwise
   * survive across it and wrongly suppress next time — this clears that. */
  resetStoryProgress(): void {
    this.storage.removeItem(STORAGE_KEY);
  }

  /** True while any story is actively playing (i.e. NOT safe to force a
   * different day's trigger() right now) — 'inactive'/'completed'/
   * 'finaleCredits' are the only states where nothing is in flight. */
  get isActive(): boolean {
    return this.state !== 'inactive' && this.state !== 'completed' && this.state !== 'finaleCredits';
  }

  /** THE explicit, reliable signal for "is today's after-work story fully
   * wrapped up" (spec: "不要用isActive===false推測NPC是否完成" —
   * VehicleControlSystem's own settlement gate reads THIS, not isActive,
   * even though the two currently share the same underlying state check).
   * The distinction is about WHERE correctness comes from: `isActive` is a
   * generic "is anything in flight" flag whose value is only trustworthy
   * because trigger()'s own hasCompletedDay() check (see that method's own
   * doc comment / STORAGE_KEY's own doc comment) now can no longer be fooled
   * by a stale, unrelated-session persisted flag — the fix lives THERE, not
   * in this getter's own boolean logic, which is why a plain rename (rather
   * than a genuinely different check) is still the correct, sufficient fix:
   * once trigger()'s own INPUT is trustworthy, `state` reaching 'inactive'/
   * 'completed'/'finaleCredits' is unambiguous proof today's story either
   * never needed to run or genuinely finished — never a false "already done"
   * for a story nobody in THIS save has ever actually seen. */
  get isTodaysStoryResolved(): boolean {
    return !this.isActive;
  }

  /** TEMPORARY TEST HOOK — used only by the new "跳至第八天" button
   * (complete-day-cheat-system.ts, spec follow-up). Bug root cause this
   * fixes: trigger(8) silently no-ops if day 8 was EVER already completed
   * on this browser (hasCompletedDay's own persisted flag, correctly
   * durable for real players) — so re-testing day 8 a second time without
   * this reset left the story's own interactive cake prop never spawning at
   * all, while the REAL cargo cake (an entirely separate object, spawned by
   * the completely unrelated daily-cargo pipeline) still generated normally
   * — the player would see what looks like the same giant wrapped cake, but
   * with zero F-interaction wired, since only the story's own prop carries
   * that. Real players never call this — resetStoryProgress() below is
   * their own equivalent (a full "新周目" reset, not day-specific).
   *
   * Second bug found in the same round ("Day8巨型蛋糕仍無法互動" follow-up):
   * `state` itself is a SEPARATE guard trigger() also checks
   * (`this.state !== 'inactive' && this.state !== 'completed'`), and once a
   * playthrough reaches Day8's own credits ending, `state` is left at
   * 'finaleCredits' FOREVER — that branch of updateEndTransition never
   * resets it back (by design: a real playthrough's next step is always
   * `resetForNewRun()`'s own `window.location.reload()`, which wipes this
   * whole object and every leftover Three.js mesh/DOM overlay along with
   * it). This test button never reloads the page, so without an explicit
   * reset here `state` would still read 'finaleCredits' on every SUBSEQUENT
   * press — silently failing trigger()'s own state guard exactly like the
   * persisted-flag bug above, leaving only the ordinary dock cargo cake
   * (never F-interactable) visible again. Tearing down the credits/fade
   * overlays and restoring player input here mirrors exactly what a fresh
   * page load would have produced for this system, without needing one. */
  resetForDayJumpTesting(): void {
    if (this.state === 'finaleCredits') {
      this.creditsEl.style.opacity = '0';
      this.fadeEl.style.opacity = '0';
      this.playerController.setInputEnabled(true);
    }
    this.state = 'inactive';
    this.hasTriggeredThisSession = false;
    this.resetStoryProgress();
  }

  // --- Trigger (spec一) ---

  /** Called from DailyFlowSystem's onDayCompleted callback when
   * `finishedDay` has a story entry. No-ops entirely if that day's story
   * already played (this session OR a past one, via the persisted flag) —
   * spec: "此事件每個新周目只執行一次，不可重複生成NPC或重複進入第2天". */
  trigger(finishedDay: number): void {
    // Day8 no longer goes through this "fires once THAT day is fully
    // completed" mechanism at all ("Day8巨型蛋糕物流化" round) — it starts
    // the instant the day BEGINS instead (checkGiantCakeDayStart below),
    // completely independent of shipping/departure/結束今天. Guarding here
    // means a real player who (out of habit) ships the day-8 cake through
    // the ordinary vehicle pipeline and presses 結束今天 anyway can never
    // wrongly fall through to the old NPC-dialogue branch below, which has
    // no npcSpawn/npcWaitSpot data for day 8 and would throw.
    if (finishedDay === GIANT_CAKE_DAY) return;
    if (this.hasTriggeredThisSession) return;
    if (this.state !== 'inactive' && this.state !== 'completed') return;
    const config = AFTER_WORK_STORIES[finishedDay];
    if (!config || this.hasCompletedDay(finishedDay)) return;

    this.hasTriggeredThisSession = true;
    this.storyDay = finishedDay;
    this.isLetterDay = !!config.isLetterDay;
    this.letterPickedUp = false;
    this.pendingCredits = false;

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

  // --- Day8 finale (spec八, reworked by "Day8巨型蛋糕物流化" round) ---

  /** Called every frame from update() while `state === 'inactive'` — the
   * ENTIRE new day8 entry point (spec: "Day8正確流程...啟動Day8測試流程",
   * no fade/teleport/locked intro of any kind any more). The moment
   * DailyFlowSystem.currentDay becomes 8, this just flips `state` straight
   * to 'finaleCakeWait' and gets out of the way — the player keeps playing
   * through the day's own completely ordinary unload→carry→place cargo loop
   * the whole time; updateFinaleCakeWait below is the only thing watching
   * for the real cargo cake to be placed and approached. */
  private checkGiantCakeDayStart(): void {
    if (this.hasTriggeredThisSession) return;
    if (this.dailyFlowSystem.currentDay !== GIANT_CAKE_DAY) return;
    if (this.hasCompletedDay(GIANT_CAKE_DAY)) return;
    if (!AFTER_WORK_STORIES[GIANT_CAKE_DAY]) return;

    this.hasTriggeredThisSession = true;
    this.storyDay = GIANT_CAKE_DAY;
    this.state = 'finaleCakeWait';
  }

  /** Finds today's real giant-cake-box cargo item (spec: "只有一個來源...
   * buildDailyCargoManifest()生成的giant-cake-box") among DailyFlowSystem's
   * own dailyCargoIds — day 8's manifest is already gated (earlier round)
   * to contain exactly this one item and nothing else, so no broader
   * "search every cargo in the world" scan is needed. Returns null once the
   * cake has been detached (unwrapped) or if day 8's cargo hasn't spawned
   * yet (e.g. the very first frame or two after 跳至第八天/normal unload
   * gate opens). `isHeld` mirrors the spec's own F-prompt condition
   * ("貨物目前沒有被拿起"). */
  private findGiantCakeCargo(): { id: string; mesh: THREE.Mesh; isHeld: boolean } | null {
    for (const id of this.dailyFlowSystem.dailyCargoIds) {
      const data = this.cargoSystem.getCargoData(id);
      if (data?.shapePresetId !== GIANT_CAKE_BOX_PRESET.id) continue;
      const obj = this.cargoSystem.getInteractable(id);
      if (!obj) continue;
      return { id, mesh: obj.mesh, isHeld: this.playerData.heldObjectId === id };
    }
    return null;
  }

  /** Visual swap the instant the unwrap timer finishes (spec follow-up:
   * "蛋糕箱打開"), called from updateFinaleUnwrapping below — also fires the
   * confetti/sparkle burst, unwrap+cheer SFX, and starts the party BGM
   * (spec follow-up一/六: "簡單粒子...播放派對音效...背景音樂切換為派對版
   * 本...短暫歡呼或鼓掌音效"). The box's own scale "pop" is computed
   * continuously in updateFinaleUnwrapping from cakeOpenedAt, not set here —
   * this method only fires the one-shot effects. */
  private onCakeOpened(): void {
    const revealLine = AFTER_WORK_STORIES[this.storyDay]?.finaleRevealLines?.[0] ?? '生日快樂！';
    if (this.npcBubble) showStoryBubbleText(this.npcBubble, revealLine);
    playUnwrapSfx();
    playCheerSfx();
    startPartyBgm();
    if (this.cakeMesh) {
      if (!this.finaleParticles) this.finaleParticles = new FinaleParticleBurst(this.scene);
      const burstOrigin = this.cakeMesh.position.clone().add(new THREE.Vector3(0, 1.2, 0));
      this.finaleParticles.spawnConfetti(burstOrigin);
      this.finaleParticles.spawnSparkleBursts(burstOrigin, 3);
    }
    if (!this.cakeMesh) return;
    (this.cakeMesh.material as THREE.MeshStandardMaterial).color.set(0xffe0b0);
    // Icing radius/position read straight off the real preset's own
    // dimensions (rather than the old prop's hardcoded 1.6/1.1 magic
    // numbers) so it still sits flush on top regardless of the cargo
    // mesh's actual local-origin-at-center geometry (buildCakeBox in
    // cargo-visuals.ts).
    const { width: cakeW, height: cakeH, depth: cakeD } = GIANT_CAKE_BOX_PRESET.dimensions;
    const radius = Math.max(cakeW, cakeD) / 2;
    const icing = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.13, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xfff6e6 })
    );
    icing.position.y = cakeH / 2;
    this.cakeMesh.add(icing);
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

      const baseYaw = npc.facingYaw ?? 0;
      group.rotation.y = baseYaw;
      group.position.set(npc.pos.x, 0, npc.pos.z);
      this.scene.add(group);

      const bubble = createStoryBubble(NPC_HEAD_Y + 0.35);
      group.add(bubble);

      // A small held prop for a couple of idle kinds (spec follow-up二:
      // "拿著飲料...烤棉花糖") — purely decorative, parented to the body so
      // it moves/disposes with everything else automatically.
      let prop: THREE.Mesh | null = null;
      if (npc.idleKind === 'drink') {
        prop = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.09, 8), new THREE.MeshStandardMaterial({ color: 0xf5efe0 }));
        prop.position.set(0.22, NPC_BODY_LOCAL_Y + 0.15, 0.18);
        group.add(prop);
      } else if (npc.idleKind === 'roast') {
        prop = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 6), new THREE.MeshStandardMaterial({ color: 0x8a6a45 }));
        prop.position.set(0.2, NPC_BODY_LOCAL_Y, 0.3);
        prop.rotation.x = Math.PI / 2.6;
        group.add(prop);
      }

      this.finaleStations.push({
        group, hitbox: hitboxMesh, bubble, npcName: npc.npcName, lines: npc.lines, repeatLine: npc.repeatLine,
        hasTalked: false, idleKind: npc.idleKind, baseYaw, idlePhase: Math.random() * Math.PI * 2, prop,
      });
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

  /** Per-frame procedural idle motion for every party-phase NPC (spec follow-
   * up二: "每位NPC都有簡單待機動作...不需要新增AI，只要播放不同Idle動作即
   * 可"). No skeletal animation exists anywhere in this codebase — every
   * kind below is a small hand-scripted sine-driven position/rotation tweak
   * around the station's own baseYaw, each with its own random phase offset
   * so a room full of NPCs never bobs/sways in visible unison. */
  private updateFinaleStationIdle(deltaTime: number, elapsedTotal: number): void {
    for (const st of this.finaleStations) {
      st.idlePhase += deltaTime;
      const t = elapsedTotal + st.idlePhase;
      const body = st.group.children.find((c) => c instanceof THREE.Mesh && c !== st.prop) as THREE.Mesh | undefined;
      switch (st.idleKind) {
        case 'sit':
          if (body) body.position.y = NPC_BODY_LOCAL_Y - 0.12 + Math.sin(t * 1.2) * 0.01;
          st.group.rotation.y = st.baseYaw + Math.sin(t * 0.5) * 0.08;
          break;
        case 'drink':
          if (st.prop) st.prop.position.y = NPC_BODY_LOCAL_Y + 0.15 + Math.max(0, Math.sin(t * 0.8)) * 0.12;
          st.group.rotation.y = st.baseYaw + Math.sin(t * 0.6) * 0.15;
          break;
        case 'lookAtSky':
          st.group.rotation.x = -0.35 + Math.sin(t * 0.4) * 0.03;
          st.group.rotation.y = st.baseYaw;
          break;
        case 'lean':
          st.group.rotation.z = 0.18;
          st.group.rotation.y = st.baseYaw + Math.sin(t * 0.3) * 0.05;
          break;
        case 'roast':
          if (st.prop) st.prop.rotation.z = Math.sin(t * 1.5) * 0.2;
          st.group.rotation.y = st.baseYaw + Math.sin(t * 0.4) * 0.06;
          break;
        case 'chat':
        default:
          st.group.rotation.y = st.baseYaw + Math.sin(t * 0.9) * 0.35;
          break;
      }
      if (body && st.idleKind !== 'sit') {
        body.position.y = NPC_BODY_LOCAL_Y + Math.sin(t * 1.1) * 0.015;
      }
    }
  }

  /** Watches for the real giant-cake-box cargo to be placed and approached
   * (spec: "貨物目前沒有被拿起...已放置在地面...才顯示「F 拆開蛋糕包裝」").
   * Runs every frame the whole time `state === 'finaleCakeWait'` is active —
   * which, since checkGiantCakeDayStart sets that state the instant day 8
   * begins with NO lock of any kind, means for the player's entire normal
   * unload→carry→place day-8 workflow. `!cake` covers both "not spawned
   * yet" (first frame or two after the unload gate opens) and "already
   * unwrapped" (detachCargoAsProp removed it from CargoSystem's own
   * bookkeeping, so findGiantCakeCargo naturally stops finding it). */
  private updateFinaleCakeWait(): void {
    const cake = this.findGiantCakeCargo();
    if (!cake || cake.isHeld) {
      this.hud.hideInteractionPrompt();
      return;
    }
    const dx = this.camera.position.x - cake.mesh.position.x;
    const dz = this.camera.position.z - cake.mesh.position.z;
    if (Math.sqrt(dx * dx + dz * dz) <= CAKE_INTERACT_RADIUS) {
      this.hud.showInteractionPrompt('巨型蛋糕包裹', 'F 拆開包裝');
    } else {
      this.hud.hideInteractionPrompt();
    }
  }

  /** F-press near the placed (not-held) cake (spec follow-up: "按F→播放拆包
   * 裝流程"). Locks input for the fixed UNWRAP_DURATION + REVEAL_LINGER beat
   * — same "no player choice changes the outcome" shape as every other
   * short cutscene beat in this file. Detaches the real cargo item from
   * CargoSystem's own bookkeeping right away (spec: 不能"跳過物流流程" — the
   * player must have genuinely shipped-in-place this exact item first,
   * enforced by onKeyDown only ever calling this once findGiantCakeCargo
   * has already confirmed it exists/isn't held) — the SAME mesh (now
   * decorated as an opened cake) becomes this system's own party
   * centerpiece prop, animated in place exactly where the player left it. */
  private beginUnwrap(cargoId: string): void {
    this.hud.hideInteractionPrompt();
    this.savedActiveTool = this.playerData.activeTool;
    this.playerData.state = 'stamping-minigame';
    this.playerController.setInputEnabled(false);
    this.state = 'finaleUnwrapping';
    this.unwrapElapsed = 0;
    this.cakeOpenedFired = false;
    this.cakeOpenedAt = 0;

    this.cakeMesh = this.cargoSystem.detachCargoAsProp(cargoId);
    this.cakeRibbon = (this.cakeMesh?.children.find((c) => c.userData.role === 'cakeRibbon') as THREE.Mesh | undefined) ?? null;
    this.cakeLid = (this.cakeMesh?.children.find((c) => c.userData.role === 'cakeLid') as THREE.Mesh | undefined) ?? null;

    // Once day 8's finale spawns the first time this browser session, the
    // 7 finale NPCs need to exist for the party phase about to start
    // (spawnFinaleStations is otherwise idempotent-safe to call once here —
    // beginUnwrap only ever reaches this point once per playthrough, same
    // guard shape as the old trigger()'s own hasTriggeredThisSession).
    this.spawnFinaleStations(AFTER_WORK_STORIES[this.storyDay]?.finaleNpcs ?? []);
  }

  private updateFinaleUnwrapping(deltaTime: number): void {
    this.unwrapElapsed += deltaTime;
    // Ribbon spins and shrinks away, the lid pops upward and spins, while
    // "unwrapping" — purely decorative (spec: "拆包裝演出").
    const t = Math.min(1, this.unwrapElapsed / UNWRAP_DURATION);
    if (this.cakeRibbon) {
      this.cakeRibbon.rotation.y += deltaTime * 8;
      this.cakeRibbon.scale.setScalar(Math.max(0.001, 1 - t));
    }
    if (this.cakeLid) {
      this.cakeLid.position.y += deltaTime * 0.6;
      this.cakeLid.rotation.y += deltaTime * 3;
    }
    if (!this.cakeOpenedFired && this.unwrapElapsed >= UNWRAP_DURATION) {
      this.cakeOpenedFired = true;
      this.cakeOpenedAt = this.unwrapElapsed;
      if (this.cakeRibbon) {
        this.cakeMesh?.remove(this.cakeRibbon);
        this.cakeRibbon.geometry.dispose();
        (this.cakeRibbon.material as THREE.MeshStandardMaterial).dispose();
        this.cakeRibbon = null;
      }
      if (this.cakeLid) {
        this.cakeMesh?.remove(this.cakeLid);
        this.cakeLid.geometry.dispose();
        (this.cakeLid.material as THREE.MeshStandardMaterial).dispose();
        this.cakeLid = null;
      }
      this.onCakeOpened();
    }
    // Scale "pop" (spec: "顯示時有一點縮放或彈跳效果") — a plain
    // overshoot-then-settle curve driven purely by elapsed time since the
    // box opened, computed fresh every frame rather than a separate tween.
    // Baseline 1 (not the old decorative prop's own 0.55) since the real
    // cargo mesh is already correctly sized at scale 1.
    if (this.cakeOpenedFired && this.cakeMesh) {
      const bt = Math.min(1, (this.unwrapElapsed - this.cakeOpenedAt) / CAKE_BOUNCE_DURATION);
      const overshoot = Math.sin(bt * Math.PI) * 0.18 * (1 - bt);
      this.cakeMesh.scale.set(1 + overshoot * 0.4, 1 + overshoot, 1 + overshoot * 0.4);
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

  private updateFinaleParty(deltaTime: number): void {
    this.idleClock += deltaTime;
    this.updateFinaleStationIdle(deltaTime, this.idleClock);
    if (this.finaleParticles?.isActive) this.finaleParticles.update(deltaTime);

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
   * short per-NPC chat, or (near the campfire) opens the "sit down" confirm
   * (spec follow-up四). Returns whether anything happened, purely so
   * onKeyDown knows whether to preventDefault(). */
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
      this.showEndingConfirm();
      return true;
    }
    return false;
  }

  /** One party NPC's own short chat — deliberately does NOT lock player
   * input/movement (spec explicitly keeps the party phase free-roam even
   * while talking; this is flavor dialogue, not a cutscene), just reuses the
   * bubble/reveal/advance/skip engine anchored to that one station.
   * Follow-up round (spec follow-up三): the FIRST visit shows the station's
   * full `lines`; every visit after that shows only its own short
   * `repeatLine` instead, so re-talking to the same NPC never re-reads a
   * long conversation. */
  private beginStationDialogue(index: number): void {
    const station = this.finaleStations[index];
    this.activeFinaleStationIndex = index;
    this.npcBubble = station.bubble;
    this.lines = station.hasTalked ? [station.repeatLine] : station.lines;
    station.hasTalked = true;
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

  /** Campfire "sit down" confirm (spec follow-up四: "按E→顯示確認視窗
   * 【坐下休息】【再逛一下】"). Locks movement while the choice is up —
   * same reasoning as every other short decision beat in this file — E
   * confirms (resolveEndingConfirm(true)), R backs out
   * (resolveEndingConfirm(false)); see onKeyDown's own 'finaleEndingConfirm'
   * branch for the actual key handling. */
  private showEndingConfirm(): void {
    this.hud.hideInteractionPrompt();
    this.savedActiveTool = this.playerData.activeTool;
    this.playerData.state = 'stamping-minigame';
    this.playerController.setInputEnabled(false);
    this.state = 'finaleEndingConfirm';
    showFinaleConfirmUi(this.confirmUi);
  }

  private resolveEndingConfirm(sitDown: boolean): void {
    hideFinaleConfirmUi(this.confirmUi);
    if (sitDown) {
      this.beginFinaleEnding();
      return;
    }
    // "再逛一下" (spec follow-up四) — just closes the confirm and hands
    // control straight back to the party, no fade/teleport of any kind.
    this.playerData.state = 'empty-handed';
    this.playerData.heldObjectId = null;
    this.playerData.activeTool = this.savedActiveTool;
    this.playerController.setInputEnabled(true);
    this.hud.showInstructions();
    this.state = 'finaleParty';
  }

  /** Campfire "sit down" beat (spec: "所有NPC聚在一起...『歡迎回家。』") —
   * reuses 'transitioning' AGAIN (fade out → teleportToDialogueSpot, now
   * branching to teleportToFinaleEnding below, → fade in → beginDialogue),
   * exactly the same shape as every ordinary day's own story start. Only
   * ever called from resolveEndingConfirm(true) now (spec follow-up四). */
  private beginFinaleEnding(): void {
    const config = AFTER_WORK_STORIES[this.storyDay];
    this.lines = config?.finaleEndingLines ?? ['歡迎回家。'];
    this.dialogueReturnMode = 'finaleEnding';
    this.endingLineHoldElapsed = 0;
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
    if (this.cakeMesh) {
      this.scene.remove(this.cakeMesh);
      this.cakeMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material?.dispose();
        }
      });
      this.cakeMesh = null;
    }
    this.spawnFinaleEndingCluster();

    // Fire glows a little brighter for the closing shot (spec follow-up六:
    // "營火火光可略微加強，營造結局氛圍") — a small SUPPLEMENTARY light
    // layered on top of the campfire's own permanent one (built once in
    // world-layout-system.ts, never touched from here) rather than reaching
    // into that file to modify a light this class doesn't own.
    this.endingFireBoostLight = new THREE.PointLight(0xff8a3a, 1.1, 7);
    this.endingFireBoostLight.position.set(CAMPFIRE_CENTER.x, 0.6, CAMPFIRE_CENTER.z);
    this.scene.add(this.endingFireBoostLight);
  }

  /** Every returning NPC, gathered around the campfire for the closing beat
   * (spec: "所有NPC聚在一起"). Cycles through the four benches (there are
   * more NPCs than benches — a couple end up sharing a bench's own spot,
   * an acceptable crowd-around-the-fire approximation for a closing shot,
   * not a gameplay-relevant placement). Each capsule faces a slightly
   * different way (spec follow-up六: "NPC不要全部面向同一方向") and gets a
   * small idle bob via updateFinaleEndingClusterIdle (spec follow-up五:
   * "NPC維持派對狀態"). */
  private spawnFinaleEndingCluster(): void {
    const group = new THREE.Group();
    group.position.set(CAMPFIRE_CENTER.x, 0, CAMPFIRE_CENTER.z);
    const offsets = [CAMPFIRE_BENCH_NORTH, CAMPFIRE_BENCH_EAST, CAMPFIRE_BENCH_WEST, CAMPFIRE_BENCH_SOUTH];
    const roster = AFTER_WORK_STORIES[this.storyDay]?.finaleNpcs ?? [];
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8a7a68 });
    this.endingClusterBodies = [];
    for (let i = 0; i < roster.length; i++) {
      const p = offsets[i % offsets.length];
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 4, 8), bodyMat);
      body.position.set(p.x - CAMPFIRE_CENTER.x, NPC_BODY_LOCAL_Y, p.z - CAMPFIRE_CENTER.z);
      body.rotation.y = (i / roster.length) * Math.PI * 2;
      group.add(body);
      this.endingClusterBodies.push(body);
    }
    this.scene.add(group);
    this.npcGroup = group;

    const bubble = createStoryBubble(NPC_HEAD_Y + 0.9);
    group.add(bubble);
    this.npcBubble = bubble;
  }

  /** Reached once the "歡迎回家。" line auto-advances (updateDialogue's own
   * finaleEnding branch) — the slow "camera pulls back, NPCs keep partying,
   * music keeps playing" beat before credits (spec follow-up五). */
  private beginEndingPullback(): void {
    this.hud.hideChargeBar();
    this.hud.hideInteractionPrompt();
    if (this.npcBubble) hideStoryBubble(this.npcBubble);
    this.endingPullbackElapsed = 0;
    this.endingCameraStart.copy(this.camera.position);
    const away = this.endingCameraStart.clone().sub(CAMPFIRE_LOOK_TARGET);
    away.y = 0;
    if (away.lengthSq() < 0.0001) away.set(0, 0, 1);
    away.normalize();
    this.endingCameraEnd.copy(this.endingCameraStart)
      .addScaledVector(away, ENDING_PULLBACK_DISTANCE)
      .setY(this.endingCameraStart.y + ENDING_PULLBACK_RISE);
    this.state = 'finaleEndingHold';
  }

  private updateEndingPullback(deltaTime: number): void {
    this.updateFinaleEndingClusterIdle(deltaTime);
    this.endingPullbackElapsed += deltaTime;
    const t = Math.min(1, this.endingPullbackElapsed / ENDING_PULLBACK_DURATION);
    const eased = t * t * (3 - 2 * t); // smoothstep — gentle ease in/out, no sudden camera snap
    this.camera.position.lerpVectors(this.endingCameraStart, this.endingCameraEnd, eased);
    this.camera.lookAt(CAMPFIRE_LOOK_TARGET);
    if (t >= 1) this.beginCredits();
  }

  private beginCredits(): void {
    stopPartyBgm();
    if (this.endingFireBoostLight) {
      this.scene.remove(this.endingFireBoostLight);
      this.endingFireBoostLight = null;
    }
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
    // "載具夜間清潔互動" round spec十五 — the actual floor (update()'s own
    // prompt-suppression above is only a UX nicety on top of this).
    if (!this.vehicleNightCleaningSystem.allVehiclesCleaned) return;
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
    // "載具夜間清潔互動" round spec十五 — same floor as startStory() above;
    // Day7's own letter beat is still "today's story trigger" and must wait
    // the same way every other day's NPC dialogue does.
    if (!this.vehicleNightCleaningSystem.allVehiclesCleaned) return;
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
    this.pendingResponseQueue = [];
    this.pendingChoiceEntry = null;
    this.beginLine();
  }

  /** The entry about to be shown — the pending Choice response queue takes
   * priority over `lines` itself whenever it's non-empty (spec十一: response
   * playback never touches/reindexes the original `lines` array). */
  private currentEntry(): DialogueEntry | null {
    if (this.pendingResponseQueue.length > 0) return this.pendingResponseQueue[0];
    if (this.lineIndex >= this.lines.length) return null;
    return this.lines[this.lineIndex];
  }

  private beginLine(): void {
    const entry = this.currentEntry();
    if (entry === null) { this.onDialogueSequenceComplete(); return; }

    if (typeof entry !== 'string' && 'options' in entry) {
      this.beginChoice(entry);
      return;
    }

    if (typeof entry !== 'string' && 'speaker' in entry) {
      // "男主角台詞系統" round — screen-space subtitle bar instead of the
      // NPC head-bubble; ProtagonistDialogueSystem owns its own reveal timer
      // and E/Space advance input for this beat (see onKeyDown's own guard
      // below), calling back into advanceLine() once the player moves past
      // it — the SAME re-entry point every other entry type already uses.
      if (this.npcBubble) hideStoryBubble(this.npcBubble);
      // Also clear the HUD's own mid-screen interaction-prompt — otherwise
      // the LAST NPC line's stale "老碼頭工人 / E／Space：完整顯示／下一句"
      // hint keeps visibly overlapping the new subtitle bar for the whole
      // protagonist beat (confirmed via browser testing), since
      // updateDialogue() deliberately skips re-setting it while this entry
      // type is active.
      this.hud.hideInteractionPrompt();
      this.protagonistDialogueSystem.say(entry.text, () => this.advanceLine());
      return;
    }

    const raw = entry as string; // narrowed by exclusion; TS can't prove it across the two `in`-guarded returns above
    this.wrappedCurrentLine = wrapStoryLine(raw);
    this.revealMs = 0;
    const textSpeed = this.settingsManager.settings.text.textSpeed;
    if (CHAR_INTERVAL_MS[textSpeed] === 0) {
      // 'instant' — reveal the whole line immediately, no per-character wait.
      this.revealMs = this.wrappedCurrentLine.length * (CHAR_INTERVAL_MS.standard + 1);
    }
    if (this.npcBubble) showStoryBubbleText(this.npcBubble, this.revealedText());
  }

  /** Shows a Choice node's options and waits for onKeyDown's own 'choice'
   * branch to resolve one (spec四: 玩家選擇不能被E跳過, must complete the
   * pick first). */
  private beginChoice(entry: DialogueChoiceEntry): void {
    this.state = 'choice';
    this.pendingChoiceEntry = entry;
    this.choiceHighlightIndex = 0;
    if (this.npcBubble) hideStoryBubble(this.npcBubble);
    this.hud.hideInteractionPrompt();
    showDialogueChoiceUi(this.choiceUi, entry.options.map((o) => o.label));
    setDialogueChoiceHighlight(this.choiceUi, 0);
  }

  /** Queues the picked option's own response entries (never mutating
   * `lines`) and returns to 'dialogue' to play them — advanceLine() drains
   * this queue front-to-back, then resumes `lines` right after the choice
   * node itself once the queue empties (spec: 選項回答結束後回到共同劇情). */
  private resolveChoice(entry: DialogueChoiceEntry, index: number): void {
    hideDialogueChoiceUi(this.choiceUi);
    this.pendingChoiceEntry = null;
    this.state = 'dialogue';
    this.pendingResponseQueue = entry.options[index].response.slice();
    this.beginLine();
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
    if (this.pendingResponseQueue.length > 0) {
      // Still draining a Choice's own response — never touches `lineIndex`
      // (spec十一: 不要修改原始lines陣列) until the response itself is fully
      // consumed, at which point `lines` resumes right after the choice node.
      this.pendingResponseQueue.shift();
      if (this.pendingResponseQueue.length > 0) { this.beginLine(); return; }
      if (this.lineIndex >= this.lines.length - 1) { this.onDialogueSequenceComplete(); return; }
      this.lineIndex++;
      this.beginLine();
      return;
    }
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
      case 'finaleEnding':
        this.beginEndingPullback();
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
    // "男主角台詞系統＋特殊NPC劇情選擇" round — defensive: a choice prompt
    // should never legitimately still be open here (R-hold-skip doesn't fire
    // during 'choice', see onKeyDown's own doc comment), but this guards
    // against any future/edge re-entry (e.g. a testing cheat) leaving it
    // visibly stuck on screen.
    hideDialogueChoiceUi(this.choiceUi);
    this.pendingChoiceEntry = null;

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
    this.cakeMesh = null;
    this.endingClusterBodies = [];
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

    // F only ever does anything here, near the REAL giant-cake-box cargo,
    // during this one state (spec: "F不影響一般貨物...只有Day8巨型蛋糕可觸
    // 發"): PickupSystem/other systems own every other F-key use elsewhere,
    // and this class only ever reads KeyF while state === 'finaleCakeWait'.
    // The same three conditions updateFinaleCakeWait's own prompt already
    // requires (exists, not held, in range) are re-checked here so the
    // prompt and the actual F-action can never disagree.
    if (this.state === 'finaleCakeWait' && !event.repeat) {
      if (event.code === 'KeyF') {
        const cake = this.findGiantCakeCargo();
        if (cake && !cake.isHeld) {
          const dx = this.camera.position.x - cake.mesh.position.x;
          const dz = this.camera.position.z - cake.mesh.position.z;
          if (Math.sqrt(dx * dx + dz * dz) <= CAKE_INTERACT_RADIUS) {
            event.preventDefault();
            this.beginUnwrap(cake.id);
          }
        }
      }
      return;
    }

    // Polish-round follow-up — the campfire's own "今天就到這裡吧？" confirm
    // (spec follow-up四). Deliberately keyboard-only (E confirms, R backs
    // out) rather than mouse-clickable buttons — pointer lock stays engaged
    // throughout this whole system (see this class's own top-of-file doc
    // comment on why PauseManager is never used), so there is no visible OS
    // cursor to click a DOM button with; see finale-confirm-ui.ts's own doc
    // comment for the same reasoning.
    if (this.state === 'finaleEndingConfirm' && !event.repeat) {
      const bindings = this.settingsManager.inputBindings;
      if (event.code === 'Space' || bindings.matches('interact', event.code) || bindings.matches('pickupPlace', event.code)) {
        event.preventDefault();
        this.resolveEndingConfirm(true);
      } else if (event.code === SKIP_HOLD_KEY_CODE) {
        event.preventDefault();
        this.resolveEndingConfirm(false);
      }
      return;
    }

    // "男主角台詞系統＋特殊NPC劇情選擇" round — Choice prompt (spec四: 玩家
    // 選擇時E不應直接跳過選擇, must resolve the pick first). Number keys pick
    // directly; arrows move a highlight; E/interact confirms whichever is
    // currently highlighted (spec十: "玩家可以：數字鍵1/2/3，或方向鍵選擇，
    // E確認"). No R-hold-skip here — a Choice is a decision the player must
    // actually make, not narration to skip past.
    if (this.state === 'choice' && !event.repeat) {
      const entry = this.pendingChoiceEntry;
      if (!entry) return;
      if (event.code === 'Digit1' || event.code === 'Digit2' || event.code === 'Digit3') {
        const idx = Number(event.code.slice(-1)) - 1;
        if (idx < entry.options.length) {
          event.preventDefault();
          this.resolveChoice(entry, idx);
        }
        return;
      }
      if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        event.preventDefault();
        const count = entry.options.length;
        this.choiceHighlightIndex = (this.choiceHighlightIndex + (event.code === 'ArrowDown' ? 1 : -1) + count) % count;
        setDialogueChoiceHighlight(this.choiceUi, this.choiceHighlightIndex);
        return;
      }
      const choiceBindings = this.settingsManager.inputBindings;
      if (event.code === 'Space' || choiceBindings.matches('interact', event.code) || choiceBindings.matches('pickupPlace', event.code)) {
        event.preventDefault();
        this.resolveChoice(entry, this.choiceHighlightIndex);
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

    // "男主角台詞系統" round — ProtagonistDialogueSystem owns its own E/Space
    // advance handling (its own independent keydown listener) while a
    // protagonist entry is the one currently showing, so this class's own
    // advance-key branch below must stay out of its way entirely — see that
    // class's own doc comment on why the two listeners never both react to
    // the same keypress.
    const activeEntry = this.currentEntry();
    if (activeEntry !== null && typeof activeEntry !== 'string' && 'speaker' in activeEntry) return;

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
    if (this.state === 'inactive') this.checkGiantCakeDayStart();
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
    // input genuinely restored (free movement). 'finaleUnwrapping',
    // 'finaleEndingConfirm', and 'finaleEndingHold' ARE included — input is
    // locked for all three (the confirm choice, and the whole closing beat
    // through to credits).
    if (
      this.state === 'transitioning' || this.state === 'dialogue' || this.state === 'letterReading' ||
      this.state === 'finaleUnwrapping' || this.state === 'finaleEndingConfirm' || this.state === 'finaleEndingHold' ||
      this.state === 'choice' ||
      (this.state === 'endTransition' && this.fadePhase === 'out')
    ) {
      if (this.dialogueReturnMode !== 'finaleStation' && this.playerData.activeTool !== this.savedActiveTool) {
        this.playerData.activeTool = this.savedActiveTool;
      }
    }

    if (this.state === 'npcWalking') {
      this.updateNpcWalk(deltaTime);
      return;
    }

    if (this.state === 'waitingForPlayer') {
      // "載具夜間清潔互動" round spec十五: NPC不會提前開始劇情 — while any of
      // tonight's returned vehicles still need cleaning, simply show no E
      // prompt at all (rather than a nagging "先去清潔載具" message, spec
      // 二十三: "不要加入...NPC催促") — the NPC just stands there quietly
      // until vehicleNightCleaningSystem reports every vehicle cleaned.
      // startStory()/beginLetterReading() repeat this same guard as their
      // own floor, so this is purely a UX nicety, not the only thing
      // stopping dialogue from starting early.
      if (!this.vehicleNightCleaningSystem.allVehiclesCleaned) {
        this.hud.hideInteractionPrompt();
        return;
      }
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
      this.updateFinaleParty(deltaTime);
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

    if (this.state === 'finaleEndingHold') {
      this.updateEndingPullback(deltaTime);
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
        // Day8's own opening no longer goes through this 'transitioning'
        // state at all ("Day8巨型蛋糕物流化" round) — only its later
        // campfire-ending beat (dialogueReturnMode 'finaleEnding') and every
        // ordinary day 1-7 still reach here, both via beginDialogue().
        this.beginDialogue();
      }
    }
  }

  private updateDialogue(deltaTime: number): void {
    // "男主角台詞系統" round — while a protagonist entry is the one
    // currently showing, ProtagonistDialogueSystem owns its own reveal timer
    // and UI entirely (see beginLine's own protagonist branch, which already
    // hides the NPC bubble once). This class's own NPC-bubble reveal-tick and
    // HUD prompt must stay out of its way here too — otherwise this method
    // would silently re-show the NPC bubble every frame using the stale
    // revealMs/wrappedCurrentLine still left over from the LAST NPC line.
    // R-hold-skip (escHolding below) still needs to keep working regardless
    // of entry type, matching onKeyDown's own SKIP_HOLD_KEY_CODE handling.
    const entry = this.currentEntry();
    const isProtagonistEntry = entry !== null && typeof entry !== 'string' && 'speaker' in entry;

    if (!isProtagonistEntry) {
      this.revealMs += deltaTime * 1000;
      if (this.npcBubble) showStoryBubbleText(this.npcBubble, this.revealedText());

      // Polish-round follow-up — the ending's own "歡迎回家。" line reads as
      // one continuous, hands-off beat (spec follow-up五: "避免突然切到
      // Credits") rather than another "press E to continue" prompt: once
      // fully revealed, it auto-advances after a short hold instead of
      // waiting for input. Every other dialogueReturnMode (endStory/
      // finaleStation) is completely unchanged — still purely E/Space-driven.
      // R-hold-skip still works throughout for anyone who wants to skip
      // ahead.
      if (this.dialogueReturnMode === 'finaleEnding') {
        this.updateFinaleEndingClusterIdle(deltaTime);
        this.hud.showInteractionPrompt(this.currentSpeakerName(), '長按R：跳過故事');
        if (this.isLineFullyRevealed) {
          this.endingLineHoldElapsed += deltaTime;
          if (this.endingLineHoldElapsed >= ENDING_LINE_AUTO_ADVANCE_HOLD) {
            this.endingLineHoldElapsed = 0;
            this.advanceLine();
            return;
          }
        }
      } else {
        this.hud.showInteractionPrompt(
          this.currentSpeakerName(),
          'E／Space：完整顯示／下一句\n長按R：跳過故事'
        );
      }
    }

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

  /** Small idle bob for the campfire ending cluster (spec follow-up五: "NPC
   * 維持派對狀態" — even during the closing beat, the gathered NPCs keep
   * looking alive rather than freezing in place the moment the player sits
   * down). Ticked during both the "歡迎回家。" line and the camera
   * pull-back that follows it. */
  private updateFinaleEndingClusterIdle(deltaTime: number): void {
    this.idleClock += deltaTime;
    for (let i = 0; i < this.endingClusterBodies.length; i++) {
      const body = this.endingClusterBodies[i];
      const t = this.idleClock + i * 0.7;
      body.position.y = NPC_BODY_LOCAL_Y + Math.sin(t * 1.0) * 0.015;
      body.rotation.y = Math.sin(t * 0.35) * 0.2;
    }
  }
}
