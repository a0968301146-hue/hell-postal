import { PlayerController } from '../player';
import { PlayerInteractionData } from '../../core/game-state';
import { SettingsManager } from '../settings';
import { LocalStorageAdapter } from '../../adapters/local-storage/local-storage-adapter';
import { NewItemReward, getDailyItemReward } from '../../data/daily-item-reward-data';
import {
  createItemRewardUi, showItemRewardUi, hideItemRewardUi, updateItemRewardCard, ItemRewardUiHandle,
} from './item-reward-ui';

const STORAGE_KEY = 'hp_item_reward_v1';
interface RewardProgress { grantedDays: number[]; }

type ItemRewardState = 'inactive' | 'showing';

/**
 * "每日獲得道具" round — a small, single-responsibility popup shown right
 * after the player dismisses the daily-settlement summary, before the day
 * actually advances (spec五: 插入現有流程, 不建立第二套換日系統). This class
 * has NO knowledge of DailyFlowSystem/VehicleControlSystem at all — its one
 * public entry point, show(day, proceed), is called from the existing
 * settlement-continue callback chain (create-game-systems.ts wires it into
 * VehicleControlSystem's new onDayCompleteContinue hook) and simply calls
 * `proceed` back once done (immediately, if there's nothing to show today).
 *
 * Deliberately NOT a shop/reward-choice UI (spec二: "玩家只是查看今天獲得的
 * 新道具") — purely a display card sequence, never mutates any real
 * inventory/tool/skill state; daily-item-reward-data.ts's own NewItemReward
 * is display-only data.
 *
 * Mirrors DreamComicSystem's own established shape throughout: same
 * playerData.state='stamping-minigame'/playerController.setInputEnabled
 * (false) lock (not PauseManager — this is a narrative-style popup, not a
 * settlement-style pause), same DOM full-screen overlay convention (see
 * item-reward-ui.ts), same persisted per-day guard shape AfterWorkStory-
 * System/DreamComicSystem already established (LocalStorageAdapter, a
 * `grantedDays: number[]` blob, hasGranted/markGranted, a resetXxxProgress()
 * hooked into the shared resetForNewRun closure), and the SAME "don't gate
 * onKeyDown on playerController.isLocked" fix DreamComicSystem's own "夢境
 * 卡死修正" round already discovered and documented — this popup can appear
 * moments after the settlement panel's own click-driven DOM UI, before the
 * player has necessarily re-acquired real Pointer Lock, so gating on
 * isLocked would risk the exact same permanent-stuck-on-panel-1 bug that
 * round fixed for the dream sequence.
 */
export class ItemRewardSystem {
  private playerController: PlayerController;
  private playerData: PlayerInteractionData;
  private settingsManager: SettingsManager;
  private storage = new LocalStorageAdapter();
  private ui: ItemRewardUiHandle;

  private state: ItemRewardState = 'inactive';
  private items: NewItemReward[] = [];
  private itemIndex = 0;
  private onDismissed: (() => void) | null = null;

  constructor(playerController: PlayerController, playerData: PlayerInteractionData, settingsManager: SettingsManager) {
    this.playerController = playerController;
    this.playerData = playerData;
    this.settingsManager = settingsManager;
    this.ui = createItemRewardUi();

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('mousedown', this.onMouseDown);
  }

  /** Kept public for the same "obvious future extension point" reason
   * DreamComicSystem.isActive/AfterWorkStorySystem.isActive already are,
   * though nothing else reads it this round. */
  get isActive(): boolean {
    return this.state === 'showing';
  }

  /** THE one entry point (spec五) — `day` is the day that just finished
   * (the settlement being confirmed belongs to it), `proceed` is whatever
   * the caller wants to happen once this popup is done (in practice,
   * DailyFlowSystem.advanceToNextDay()). Calls `proceed` IMMEDIATELY,
   * synchronously, with no popup shown at all, if today has no configured
   * reward (spec五: "沒有獎勵 → 不顯示空白UI") or has already been granted
   * this run (spec五/七: "不可以重複顯示"). */
  show(day: number, proceed: () => void): void {
    if (this.hasGranted(day)) {
      proceed();
      return;
    }
    const items = getDailyItemReward(day);
    if (items.length === 0) {
      proceed();
      return;
    }

    this.markGranted(day);
    this.items = items;
    this.itemIndex = 0;
    this.onDismissed = proceed;
    this.state = 'showing';

    this.playerData.state = 'stamping-minigame';
    this.playerController.setInputEnabled(false);

    updateItemRewardCard(this.ui, this.items[0]);
    showItemRewardUi(this.ui);
  }

  private advance(): void {
    this.itemIndex++;
    if (this.itemIndex >= this.items.length) {
      this.end();
      return;
    }
    updateItemRewardCard(this.ui, this.items[this.itemIndex]);
  }

  private end(): void {
    hideItemRewardUi(this.ui);
    this.playerData.state = 'empty-handed';
    this.playerController.setInputEnabled(true);
    this.state = 'inactive';

    const proceed = this.onDismissed;
    this.onDismissed = null;
    proceed?.();
  }

  private hasGranted(day: number): boolean {
    const saved = this.storage.getJSON<RewardProgress>(STORAGE_KEY);
    return !!saved?.grantedDays.includes(day);
  }

  private markGranted(day: number): void {
    const saved = this.storage.getJSON<RewardProgress>(STORAGE_KEY) ?? { grantedDays: [] };
    if (!saved.grantedDays.includes(day)) saved.grantedDays.push(day);
    this.storage.setJSON(STORAGE_KEY, saved);
  }

  /** Called from create-game-systems.ts's shared resetForNewRun closure
   * (spec五: "新遊戲要正確重置相關狀態"), alongside AfterWorkStorySystem.
   * resetStoryProgress()/DreamComicSystem.resetDreamProgress() — the exact
   * same "just clear the one persisted key" shape those two already use. */
  resetItemRewardProgress(): void {
    this.storage.removeItem(STORAGE_KEY);
  }

  // --- Input --- (see this class's own doc comment for why isLocked is
  // deliberately never checked here)

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.state !== 'showing') return;
    if (event.repeat) return;
    const bindings = this.settingsManager.inputBindings;
    if (event.code === 'Space' || bindings.matches('interact', event.code) || bindings.matches('pickupPlace', event.code)) {
      event.preventDefault();
      this.advance();
    }
  };

  private onMouseDown = (event: MouseEvent): void => {
    if (this.state !== 'showing') return;
    if (event.button !== 0) return;
    this.advance();
  };
}
