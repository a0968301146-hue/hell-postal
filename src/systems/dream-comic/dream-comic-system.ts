import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { PlayerController } from '../player';
import { PlayerInteractionData } from '../../core/game-state';
import { SettingsManager } from '../settings';
import { DailyFlowSystem } from '../daily-flow/daily-flow-system';
import { AfterWorkStorySystem } from '../story/after-work-story-system';
import { LocalStorageAdapter } from '../../adapters/local-storage/local-storage-adapter';
import { PLAYER_ROOM_BEDSIDE_SPAWN } from '../../data/world/player-room-layout-data';
import { DREAM_COMICS } from '../../data/story/dream-comic-data';
import { DreamComicDay } from './dream-comic-types';
import {
  createDreamComicUi, showDreamComicUi, hideDreamComicUi, updateDreamComicPanel, DreamComicUiHandle,
} from './dream-comic-ui';

const STORAGE_KEY = 'hp_dream_comic_v1';
interface DreamProgress {
  completedDays: number[];
}

type DreamState = 'inactive' | 'showing';

/**
 * "每日起床＋夢境漫畫" round — plays a short, silhouette-framed "memory of the
 * past" comic (data/story/dream-comic-data.ts) the moment each of Day1~7
 * genuinely BEGINS (spec九: "Day N開始→玩家傳送到主角房間→播放DayN夢境→夢境
 * 結束→玩家可以自由移動"), before the player can touch anything that day.
 *
 * Deliberately mirrors AfterWorkStorySystem's own established shape rather
 * than inventing a second narrative-overlay architecture (spec十三: "如果已
 * 有適合的劇情／漫畫／對話系統，優先整合"):
 *   - Same player-lock combination (playerData.state = 'stamping-minigame' +
 *     playerController.setInputEnabled(false)) — deliberately NOT
 *     PauseManager, matching AfterWorkStorySystem's own doc comment
 *     reasoning; this ALSO means interaction-system.ts's own existing
 *     `state === 'stamping-minigame'` early-return already blocks E-interact
 *     everywhere (including e.g. complete-day-cheat-system.ts's test
 *     buttons) for free, with zero changes needed to any other file.
 *   - Same manual physics.setPlayerPosition + resetVerticalMotion + direct
 *     camera position/rotation write AfterWorkStorySystem.
 *     teleportToMainRoomCenter()/teleportToDialogueSpot() already use (spec
 *     二: "請先確認目前玩家角色的spawn/reset/teleport API...不要自行建立第二
 *     套玩家位置系統").
 *   - Same E/Space/pickupPlace advance-key check AfterWorkStorySystem's own
 *     onKeyDown already uses (settingsManager.inputBindings.matches), plus a
 *     left-click listener for spec四's own explicit "滑鼠左鍵" option (which
 *     AfterWorkStorySystem's own dialogue never needed) — both gated on
 *     `playerController.isLocked`, the same guard AfterWorkStorySystem's own
 *     onKeyDown uses to ignore input whenever pointer lock isn't held (e.g.
 *     the Tab pause menu is open).
 *   - Same LocalStorageAdapter "completedDays" persistence shape
 *     AfterWorkStorySystem's own hp_after_work_story_v1 key already
 *     establishes, under its own hp_dream_comic_v1 key — a per-CALENDAR-DAY
 *     idempotency flag, NOT a duplicate of hp_run_state_v1's own currentDay
 *     tracking, so a mid-day page reload (which resets this class's own
 *     in-memory `state`/`triggeredForDay` but NOT this persisted flag) can
 *     never replay a dream already shown earlier the same day (spec十/
 *     十一).
 *
 * Trigger condition (checkDreamStart, polled from update() every frame this
 * class is idle): `dailyFlowSystem.currentDay` in 1..7, `dailyFlowSystem.
 * state === 'ready'` (the ONE window between "today's reset finished" and
 * "開始卸貨 pressed" — see daily-flow-system.ts's own state machine), AND
 * `!afterWorkStorySystem.isActive`. That last guard is what makes the
 * ordering work WITHOUT a bespoke "day just began" event existing anywhere:
 * DailyFlowSystem.advanceToNextDay() flips state to 'ready' and increments
 * currentDay SYNCHRONOUSLY, then fires onDayCompleted (which calls
 * afterWorkStorySystem.trigger(finishedDay) in the very same tick) — so by
 * the next frame this class's own update() runs, if the day that just ended
 * has its own after-work story, isActive already reads true and this class
 * correctly waits for it to fully finish before waking the player up for the
 * NEW day. On a brand new game (Day1, nothing ever triggered) both
 * conditions are already satisfied at the very first idle frame, which is
 * exactly spec十's own "不要特殊處理，讓現有狀態自然支援" intent for Day1.
 *
 * `update()` is called from game-app.ts INSIDE the `!pauseManager.isPaused`
 * gate (deliberately NOT unconditionally, unlike AfterWorkStorySystem) —
 * this class is a POLLING trigger (checks currentDay/state every idle frame)
 * rather than a purely event-driven one, so it must not be able to fire
 * while e.g. the main menu overlay is still covering the screen at boot
 * (MainMenuSystem pauses via PauseManager the whole time it's shown); once a
 * dream IS showing there is no continuous per-frame animation to preserve
 * across an unrelated pause either (spec four's advance is purely player-
 * driven, no auto-timer), so simply freezing alongside everything else while
 * paused is correct and requires no special-casing.
 */
export class DreamComicSystem {
  private physics: PhysicsSystem;
  private camera: THREE.PerspectiveCamera;
  private playerController: PlayerController;
  private playerData: PlayerInteractionData;
  private settingsManager: SettingsManager;
  private dailyFlowSystem: DailyFlowSystem;
  private afterWorkStorySystem: AfterWorkStorySystem;
  private storage = new LocalStorageAdapter();
  private ui: DreamComicUiHandle;

  private state: DreamState = 'inactive';
  /** In-memory single-fire guard, keyed by day number — defense-in-depth
   * alongside the persisted flag, mirrors AfterWorkStorySystem's own
   * hasTriggeredThisSession (a boolean there since it only ever fires once
   * per whole session; this needs the actual day number since THIS class
   * legitimately fires once per day, 1 through 7). */
  private triggeredForDay: number | null = null;
  private activeDay = 0;
  private panelIndex = 0;

  constructor(
    camera: THREE.PerspectiveCamera, physics: PhysicsSystem, playerController: PlayerController,
    playerData: PlayerInteractionData, settingsManager: SettingsManager,
    dailyFlowSystem: DailyFlowSystem, afterWorkStorySystem: AfterWorkStorySystem
  ) {
    this.camera = camera;
    this.physics = physics;
    this.playerController = playerController;
    this.playerData = playerData;
    this.settingsManager = settingsManager;
    this.dailyFlowSystem = dailyFlowSystem;
    this.afterWorkStorySystem = afterWorkStorySystem;

    this.ui = createDreamComicUi();

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('mousedown', (e) => this.onMouseDown(e));
  }

  /** True while a dream is actively showing — read by nothing else this
   * round (see this class's own doc comment on why complete-day-cheat-
   * system.ts needs no matching guard of its own), kept public for the same
   * reason AfterWorkStorySystem.isActive is: a natural, obvious extension
   * point for anything that legitimately needs to know later. */
  get isActive(): boolean {
    return this.state !== 'inactive';
  }

  // --- Persistence (mirrors AfterWorkStorySystem's own hasCompletedDay/markDayCompleted) ---

  private hasPlayedDream(day: number): boolean {
    const saved = this.storage.getJSON<DreamProgress>(STORAGE_KEY);
    return !!saved?.completedDays.includes(day);
  }

  private markDreamCompleted(day: number): void {
    const saved = this.storage.getJSON<DreamProgress>(STORAGE_KEY) ?? { completedDays: [] };
    if (!saved.completedDays.includes(day)) saved.completedDays.push(day);
    this.storage.setJSON(STORAGE_KEY, saved);
  }

  /** The ONE "new playthrough" hook (mirrors AfterWorkStorySystem.
   * resetStoryProgress exactly) — called from create-game-systems.ts's
   * existing "重新開始第1天" resetForNewRun, right alongside
   * afterWorkStorySystem.resetStoryProgress(), before the page reload that
   * flow already performs. */
  resetDreamProgress(): void {
    this.storage.removeItem(STORAGE_KEY);
  }

  // --- Update / trigger ---

  update(): void {
    if (this.state === 'inactive') this.checkDreamStart();
  }

  private checkDreamStart(): void {
    const day = this.dailyFlowSystem.currentDay;
    if (day < 1 || day > 7) return; // Day8 never gets a dream this round (spec十).
    if (this.dailyFlowSystem.state !== 'ready') return;
    if (this.afterWorkStorySystem.isActive) return;
    if (this.triggeredForDay === day) return;
    if (this.hasPlayedDream(day)) return;
    const config = DREAM_COMICS[day];
    // No entry yet (currently just day 7 — see dream-comic-data.ts's own
    // doc comment) — no-op entirely, the day simply begins without a room/
    // dream beat rather than guessing at content (spec六: "不要直接亂寫").
    if (!config) return;

    this.triggeredForDay = day;
    this.beginDream(config);
  }

  private beginDream(config: DreamComicDay): void {
    this.activeDay = config.day;
    this.panelIndex = 0;

    this.teleportToBedside();
    this.playerData.state = 'stamping-minigame';
    this.playerController.setInputEnabled(false);

    this.state = 'showing';
    showDreamComicUi(this.ui);
    this.renderCurrentPanel(config);
  }

  /** Manual physics+camera write, same formula/shape as AfterWorkStorySystem.
   * teleportToMainRoomCenter()/teleportToDialogueSpot() (see this class's own
   * doc comment) — PLAYER_ROOM_BEDSIDE_SPAWN (player-room-layout-data.ts) is
   * the ONLY position data source, never a second one. */
  private teleportToBedside(): void {
    const spawn = PLAYER_ROOM_BEDSIDE_SPAWN;
    const bodyY = spawn.y + 0.9; // resting-capsule-on-floor formula, matches teleportToDialogueSpot
    const cameraY = bodyY + 0.6;

    this.physics.setPlayerPosition(new THREE.Vector3(spawn.x, bodyY, spawn.z));
    this.playerController.resetVerticalMotion();
    this.camera.position.set(spawn.x, cameraY, spawn.z);
    this.camera.rotation.set(0, spawn.facingYaw, 0);
  }

  private renderCurrentPanel(config: DreamComicDay): void {
    const panel = config.panels[this.panelIndex];
    updateDreamComicPanel(this.ui, panel, this.panelIndex + 1, config.panels.length);
  }

  private advancePanel(): void {
    const config = DREAM_COMICS[this.activeDay];
    if (!config) return;
    this.panelIndex++;
    if (this.panelIndex >= config.panels.length) {
      this.endDream();
      return;
    }
    this.renderCurrentPanel(config);
  }

  private endDream(): void {
    hideDreamComicUi(this.ui);
    this.playerData.state = 'empty-handed';
    this.playerController.setInputEnabled(true);
    this.markDreamCompleted(this.activeDay);
    this.state = 'inactive';
  }

  // --- Input (spec四) ---

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.state !== 'showing') return;
    if (!this.playerController.isLocked) return;
    if (event.repeat) return;
    const bindings = this.settingsManager.inputBindings;
    if (event.code === 'Space' || bindings.matches('interact', event.code) || bindings.matches('pickupPlace', event.code)) {
      event.preventDefault();
      this.advancePanel();
    }
  };

  private onMouseDown = (event: MouseEvent): void => {
    if (this.state !== 'showing') return;
    if (!this.playerController.isLocked) return;
    if (event.button !== 0) return;
    this.advancePanel();
  };
}
