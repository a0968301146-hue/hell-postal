import { PauseManager } from '../../core/pause-manager';
import { HUD } from '../hud';
import { ManualUI } from '../pause-menu';
import { DailyFlowSystem } from '../daily-flow';
import { loadRunState, saveRunState, generateRunId } from './run-state-data';

type MainMenuState =
  | 'mainMenu' | 'settings' | 'confirmNewGame' | 'confirmQuit'
  | 'startingNewGame' | 'continuing' | 'inGame';

/** One-shot signal set right before New Game's own `resetForNewRun()` call
 * (which ends in `window.location.reload()`) — read back by this class's own
 * constructor on the NEXT page load so the freshly-reset game launches
 * straight into gameplay instead of showing the main menu a second time
 * (spec三: "重置完成後：關閉主畫面→顯示遊戲HUD→...→正式開始第1天"). A
 * sessionStorage flag rather than a second reset mechanism — the actual
 * reset logic itself is still the ONE existing `resetForNewRun` callback,
 * unchanged (spec: "不要另寫第二套重置"); this only skips re-showing a menu
 * that would otherwise flash by pointlessly on the very next load. */
const SKIP_MENU_AFTER_RESET_KEY = 'hp_skip_main_menu_once';

/**
 * "Add main menu and return player after dock story" round 二-八 — a
 * full-screen DOM overlay shown at boot, before the player can touch
 * anything (spec二: "遊戲載入後不要直接進入場景，先顯示主畫面"). Built AFTER
 * createGameSystems() so it can reuse the exact same live system references
 * every other system already depends on (DailyFlowSystem for 繼續遊戲's own
 * day-resume, ManualUI for 設定, the same resetForNewRun callback ManualUI's
 * own "重新開始第1天" button already calls for 新遊戲) — deliberately never
 * duplicates any of their logic (spec: "不要另寫第二套重置", "只呼叫既有
 * ...系統").
 *
 * Freezes the game world via the SAME PauseManager every other overlay in
 * this codebase already uses (a new 'mainMenu' PauseReason) rather than
 * inventing a second pause mechanism (spec二: "遊戲世界可暫停更新") — this
 * alone already makes InteractionSystem/ToolSystem/PlayerController.update
 * inert (all three already gate on `pauseManager.isPaused` and/or
 * `playerController.isLocked`, and pointer lock is structurally never
 * requested while this overlay covers the canvas, so `isLocked` never
 * becomes true either). The one confirmed gap neither of those two guards
 * already covers is ManualUI's own Tab-open shortcut (fixed directly in
 * pause-menu-ui.ts's own onKeyDown, spec七) — everything else in the
 * required block-list (WASD/jump/sprint/E/F/Q/digit-key tools/mouse) is
 * covered by the pre-existing isLocked/isPaused guards those systems already
 * had. A capture-phase keydown listener on `window` (fires before every
 * other bubble-phase listener in the document, and before other window-
 * capture listeners registered after this one — see this class's own
 * onWindowKeyDown doc comment) is kept anyway as defense-in-depth for the
 * many other minor key listeners this round was not asked to individually
 * audit (spec七's own explicit block-list), EXCEPT while `state==='settings'`
 * — ManualUI needs its own raw keydown stream uninterrupted for key-rebind
 * capture, exactly as it already does during a normal in-game Tab-open.
 */
export class MainMenuSystem {
  private pauseManager: PauseManager;
  private hud: HUD;
  private manualUI: ManualUI;
  private dailyFlowSystem: DailyFlowSystem;
  private resetForNewRun: () => void;

  private state: MainMenuState = 'mainMenu';
  private hasSave = false;

  private overlayEl: HTMLElement;
  private continueBtn: HTMLButtonElement;
  private newGameBtn: HTMLButtonElement;
  private settingsBtn: HTMLButtonElement;
  private quitBtn: HTMLButtonElement;
  private confirmOverlayEl: HTMLElement;
  private confirmTextEl: HTMLElement;
  private noticeEl: HTMLElement;
  private noticeTimer: number | null = null;

  constructor(
    pauseManager: PauseManager, hud: HUD, manualUI: ManualUI,
    dailyFlowSystem: DailyFlowSystem, resetForNewRun: () => void
  ) {
    this.pauseManager = pauseManager;
    this.hud = hud;
    this.manualUI = manualUI;
    this.dailyFlowSystem = dailyFlowSystem;
    this.resetForNewRun = resetForNewRun;

    this.overlayEl = document.createElement('div');
    this.overlayEl.id = 'main-menu-overlay';
    this.overlayEl.innerHTML = `
      <div class="main-menu-content">
        <h1 class="main-menu-title">異世界物流中心</h1>
        <div class="main-menu-buttons">
          <button id="main-menu-new-game" class="main-menu-btn">新遊戲</button>
          <button id="main-menu-continue" class="main-menu-btn">繼續遊戲</button>
          <button id="main-menu-settings" class="main-menu-btn">設定</button>
          <button id="main-menu-quit" class="main-menu-btn">離開遊戲</button>
        </div>
        <p id="main-menu-notice" class="main-menu-notice"></p>
      </div>
      <div id="main-menu-confirm-overlay" class="main-menu-confirm-overlay hidden">
        <div class="main-menu-confirm-box">
          <p id="main-menu-confirm-text"></p>
          <div class="main-menu-confirm-buttons">
            <button id="main-menu-confirm-ok" class="main-menu-btn">確定</button>
            <button id="main-menu-confirm-cancel" class="main-menu-btn">取消</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(this.overlayEl);

    this.continueBtn = this.overlayEl.querySelector('#main-menu-continue')!;
    this.newGameBtn = this.overlayEl.querySelector('#main-menu-new-game')!;
    this.settingsBtn = this.overlayEl.querySelector('#main-menu-settings')!;
    this.quitBtn = this.overlayEl.querySelector('#main-menu-quit')!;
    this.confirmOverlayEl = this.overlayEl.querySelector('#main-menu-confirm-overlay')!;
    this.confirmTextEl = this.overlayEl.querySelector('#main-menu-confirm-text')!;
    this.noticeEl = this.overlayEl.querySelector('#main-menu-notice')!;

    this.overlayEl.addEventListener('click', (e) => this.onClick(e));

    if (this.consumeSkipMenuFlag()) {
      this.enterGameplayDirectly();
    } else {
      this.showMainMenu();
    }
  }

  private consumeSkipMenuFlag(): boolean {
    try {
      if (window.sessionStorage.getItem(SKIP_MENU_AFTER_RESET_KEY) !== '1') return false;
      window.sessionStorage.removeItem(SKIP_MENU_AFTER_RESET_KEY);
      return true;
    } catch {
      return false;
    }
  }

  /** The ONE public re-entry point spec八 requires be kept for a future
   * round's own in-game "返回主畫面" button — unused by anything THIS round
   * (spec八: "本輪不必新增遊戲內返回主畫面的按鈕"), but the full show-menu
   * sequence (pause/hide-HUD/re-attach key blocker/refresh 繼續遊戲's own
   * enabled state) already lives here rather than being duplicated at both
   * the constructor's own initial call site and a future button's. */
  showMainMenu(): void {
    this.state = 'mainMenu';
    this.refreshContinueButton();
    this.overlayEl.classList.add('visible');
    window.addEventListener('keydown', this.onWindowKeyDown, { capture: true });
    this.pauseManager.add('mainMenu');
    this.hud.setRootVisible(false);
    this.render();
  }

  /** Skip-menu-after-reset path (see SKIP_MENU_AFTER_RESET_KEY's own doc
   * comment) — the reset itself (skills/story-progress/hp_run_state_v1)
   * already happened on the PREVIOUS page load, right before the reload that
   * led here; this load's only job is to land directly in gameplay. */
  private enterGameplayDirectly(): void {
    this.dismissToGameplay();
  }

  private refreshContinueButton(): void {
    const saved = loadRunState();
    this.hasSave = !!saved;
    this.continueBtn.disabled = !this.hasSave;
    this.continueBtn.classList.toggle('disabled', !this.hasSave);
    this.continueBtn.title = this.hasSave ? '' : '尚無遊戲進度';
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest('#main-menu-new-game')) {
      if (this.state !== 'mainMenu') return;
      this.state = 'confirmNewGame';
      this.render();
      return;
    }
    if (target.closest('#main-menu-continue')) {
      if (this.state !== 'mainMenu' || !this.hasSave) return;
      this.startContinue();
      return;
    }
    if (target.closest('#main-menu-settings')) {
      if (this.state !== 'mainMenu') return;
      this.openSettings();
      return;
    }
    if (target.closest('#main-menu-quit')) {
      if (this.state !== 'mainMenu') return;
      this.state = 'confirmQuit';
      this.render();
      return;
    }
    if (target.closest('#main-menu-confirm-ok')) {
      if (this.state === 'confirmNewGame') this.confirmNewGame();
      else if (this.state === 'confirmQuit') this.confirmQuit();
      return;
    }
    if (target.closest('#main-menu-confirm-cancel')) {
      this.cancelConfirm();
      return;
    }
  }

  /** Capture-phase (see this class's own doc comment for why) — swallows
   * every key while the main menu's own root/confirm screens are showing,
   * implementing spec七's exact Esc rules directly (settings screen's own
   * Esc-returns-to-menu behavior is handled entirely by ManualUI's own
   * pre-existing close()/handleEscape() — see openSettings below — not
   * here). */
  private onWindowKeyDown = (event: KeyboardEvent): void => {
    if (this.state === 'inGame' || this.state === 'settings') return;
    event.stopImmediatePropagation();
    event.preventDefault();
    if (event.code !== 'Escape') return;
    if (this.state === 'confirmNewGame' || this.state === 'confirmQuit') this.cancelConfirm();
    // mainMenu root / startingNewGame / continuing: no-op (spec七: "主畫面按
    // Esc：不進入遊戲，也不關閉主畫面").
  };

  private cancelConfirm(): void {
    if (this.state !== 'confirmNewGame' && this.state !== 'confirmQuit') return;
    this.state = 'mainMenu';
    this.render();
  }

  private startContinue(): void {
    const saved = loadRunState();
    if (!saved) return; // defensive — button is disabled whenever this is null
    this.state = 'continuing';
    this.dailyFlowSystem.currentDay = saved.currentDay;
    this.dismissToGameplay();
  }

  /** spec三 confirm handler — writes hp_run_state_v1 (spec: "開始新遊戲後
   * hasActiveRun=true") and arms the skip-menu flag BEFORE calling the
   * shared resetForNewRun callback, since that callback's own final step is
   * `window.location.reload()` (upgrade-system.ts/create-game-systems.ts,
   * unchanged) — nothing after this point in THIS page's lifetime runs. */
  private confirmNewGame(): void {
    this.state = 'startingNewGame';
    this.render();
    saveRunState({ hasActiveRun: true, currentDay: 1, runId: generateRunId(), lastSavedAt: Date.now() });
    try { window.sessionStorage.setItem(SKIP_MENU_AFTER_RESET_KEY, '1'); } catch { /* ignore */ }
    this.resetForNewRun();
  }

  /** spec六 confirm handler — window.close() is a silent no-op in every
   * browser that refuses to close a tab it didn't itself open via script
   * (the normal case here); no promise/exception to catch, so execution
   * simply continues right past it whenever that happens (spec: "若瀏覽器不
   * 允許關閉目前分頁，不要報錯"). */
  private confirmQuit(): void {
    window.close();
    this.state = 'mainMenu';
    this.showNotice('瀏覽器版請直接關閉此分頁');
    this.render();
  }

  private showNotice(text: string): void {
    this.noticeEl.textContent = text;
    this.noticeEl.classList.add('visible');
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.noticeEl.classList.remove('visible');
      this.noticeTimer = null;
    }, 3000);
  }

  /** spec五 — reuses the EXISTING ManualUI overlay wholesale (spec: "直接重
   * 用現有設定系統，不複製新的音量／字幕／語言設定資料") via its new
   * openForMainMenu entry point (pause-menu-ui.ts), which redirects close()
   * back here instead of assuming a live game session to resume. Hides this
   * class's own overlay while ManualUI's own (separate, already full-screen)
   * overlay is up, rather than stacking both at once. */
  private openSettings(): void {
    this.state = 'settings';
    this.overlayEl.classList.remove('visible');
    this.manualUI.openForMainMenu(() => {
      this.state = 'mainMenu';
      this.overlayEl.classList.add('visible');
      this.refreshContinueButton();
      this.render();
    });
  }

  private dismissToGameplay(): void {
    this.state = 'inGame';
    this.overlayEl.classList.remove('visible');
    window.removeEventListener('keydown', this.onWindowKeyDown, { capture: true });
    this.pauseManager.remove('mainMenu');
    this.hud.setRootVisible(true);
    this.hud.showInstructions();
  }

  private render(): void {
    this.overlayEl.classList.toggle('confirm-open', this.state === 'confirmNewGame' || this.state === 'confirmQuit');
    this.confirmOverlayEl.classList.toggle('hidden', this.state !== 'confirmNewGame' && this.state !== 'confirmQuit');
    if (this.state === 'confirmNewGame') {
      this.confirmTextEl.textContent = '開始新遊戲會重置目前進度，確定要開始嗎？';
    } else if (this.state === 'confirmQuit') {
      this.confirmTextEl.textContent = '確定要離開遊戲嗎？';
    }

    const busy = this.state === 'startingNewGame' || this.state === 'continuing';
    this.newGameBtn.disabled = busy;
    this.settingsBtn.disabled = busy;
    this.quitBtn.disabled = busy;
    this.continueBtn.disabled = busy || !this.hasSave;
  }
}
