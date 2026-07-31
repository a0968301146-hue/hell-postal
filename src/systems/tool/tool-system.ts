import { PlayerInteractionData, ActiveTool } from '../../core/game-state';
import { HUD } from '../hud';
import { PauseManager } from '../../core/pause-manager';

const TOOL_NAME: Record<ActiveTool, string> = {
  empty: '徒手',
  cargoHook: '捕貨鉤',
};

/** Bottom-center 4-slot hotbar ("Add tool hotbar and cargo hook" round 一) —
 * owns ONLY tool-selection state/input/UI. Slots 2 (搬運手套) and 4 (預留)
 * are permanently locked this round — there is no unlock mechanism anywhere
 * yet, so they're hardcoded dead ends (digit press / wheel never reaches
 * them, matching spec: "數字鍵2、4：不切換，只顯示尚未解鎖").
 *
 * Deliberately does NOT know about CargoHookSystem at all — switching AWAY
 * from cargoHook only ever needs to flip `playerData.activeTool` back to
 * 'empty'; CargoHookSystem watches that same field itself every frame and
 * self-cancels the instant it stops being 'cargoHook' (spec八), so no
 * callback/import wiring between the two is needed in either direction. */
export class ToolSystem {
  private playerData: PlayerInteractionData;
  private hud: HUD;
  private pauseManager: PauseManager;
  private isLocked: () => boolean;

  private slot1El: HTMLElement;
  private slot3El: HTMLElement;
  private slot3CooldownOverlay: HTMLElement;
  private slot3CooldownText: HTMLElement;
  private toolNamePopup: HTMLElement;
  private toolNameTimer: number | null = null;

  constructor(playerData: PlayerInteractionData, hud: HUD, pauseManager: PauseManager, isLockedFn: () => boolean) {
    this.playerData = playerData;
    this.hud = hud;
    this.pauseManager = pauseManager;
    this.isLocked = isLockedFn;

    const container = hud.getContainer();

    const hotbar = document.createElement('div');
    hotbar.id = 'hotbar';

    this.slot1El = this.buildSlot('1', '✋', '徒手', false);
    const slot2El = this.buildSlot('2', '🧤', '搬運手套', true);
    this.slot3El = this.buildSlot('3', '🪝', '捕貨鉤', false);
    const slot4El = this.buildSlot('4', '', '', true);

    // "Improve cargo hook aerial pickup" round spec五: "工具欄第3格顯示冷卻
    // 遮罩與剩餘秒數" — a rising dark overlay (height = remaining/total) plus
    // a centered countdown label, both hidden while off cooldown. Only slot 3
    // ever needs this (only cargoHook has a cooldown), so it's built directly
    // here rather than generalizing buildSlot() for a case nothing else uses.
    this.slot3CooldownOverlay = document.createElement('div');
    this.slot3CooldownOverlay.className = 'hotbar-cooldown-overlay';
    this.slot3El.appendChild(this.slot3CooldownOverlay);
    this.slot3CooldownText = document.createElement('div');
    this.slot3CooldownText.className = 'hotbar-cooldown-text';
    this.slot3El.appendChild(this.slot3CooldownText);

    hotbar.appendChild(this.slot1El);
    hotbar.appendChild(slot2El);
    hotbar.appendChild(this.slot3El);
    hotbar.appendChild(slot4El);
    container.appendChild(hotbar);

    this.toolNamePopup = document.createElement('div');
    this.toolNamePopup.id = 'tool-name-popup';
    container.appendChild(this.toolNamePopup);

    // Every fresh page load starts back on bare-hands (spec一: "不需要保存
    // 最後選擇的工具") — playerData already defaults activeTool to 'empty'
    // (see createPlayerInteractionData), this just syncs the visuals to it.
    this.updateSelectionUI();

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('wheel', (e) => this.onWheel(e));
  }

  private buildSlot(key: string, icon: string, name: string, locked: boolean): HTMLElement {
    const el = document.createElement('div');
    el.className = 'hotbar-slot' + (locked ? ' locked' : '');
    el.innerHTML = `
      <span class="hotbar-key">${key}</span>
      <span class="hotbar-icon">${icon}</span>
      <span class="hotbar-name">${name}</span>
      <span class="hotbar-lock">🔒</span>
    `;
    return el;
  }

  private updateSelectionUI(): void {
    this.slot1El.classList.toggle('selected', this.playerData.activeTool === 'empty');
    this.slot3El.classList.toggle('selected', this.playerData.activeTool === 'cargoHook');
  }

  private showToolNamePopup(tool: ActiveTool): void {
    this.toolNamePopup.textContent = TOOL_NAME[tool];
    this.toolNamePopup.classList.add('visible');
    if (this.toolNameTimer !== null) window.clearTimeout(this.toolNameTimer);
    this.toolNameTimer = window.setTimeout(() => {
      this.toolNamePopup.classList.remove('visible');
      this.toolNameTimer = null;
    }, 1200);
  }

  /** Shared select attempt for both digit-key/wheel input AND
   * CargoHookSystem's own auto-switch-back-to-bare-hands on a successful
   * catch ("Improve cargo hook aerial pickup" round spec二: "工具欄同步選中
   * 第1格" — reusing this method rather than a separate sync path means that
   * requirement is satisfied automatically, since this already updates the
   * hotbar UI as part of switching). Public for that cross-call; enforces
   * spec三's (prior round) "捕貨鉤必須空手使用...若玩家正在持有任何物品：
   * 不可切換至捕貨鉤" (Pallet/dolly holds also set state away from
   * 'empty-handed', so this one check covers every kind of "currently
   * holding something" case, not just PickupSystem's own heldObjectId).
   * Does NOT gate on cooldown — a cooldown only blocks FIRING (see
   * CargoHookSystem.onMouseDown), the tool can still be selected/deselected
   * freely while it counts down. */
  trySelect(tool: ActiveTool): void {
    if (this.playerData.activeTool === tool) return;
    if (tool === 'cargoHook' && this.playerData.state !== 'empty-handed') {
      this.hud.showToast('請先放下手上的物品');
      return;
    }
    this.playerData.activeTool = tool;
    this.updateSelectionUI();
    this.showToolNamePopup(tool);
  }

  /** Called every frame by CargoHookSystem (spec五) regardless of which
   * tool is currently selected, so the cooldown mask on slot 3 stays
   * visible even if the player switches away mid-cooldown. */
  setCooldown(remainingSeconds: number, totalSeconds: number): void {
    if (remainingSeconds <= 0) {
      this.slot3CooldownOverlay.style.height = '0%';
      this.slot3CooldownText.textContent = '';
      this.slot3CooldownText.classList.remove('visible');
      return;
    }
    const ratio = Math.min(1, remainingSeconds / totalSeconds);
    this.slot3CooldownOverlay.style.height = `${ratio * 100}%`;
    this.slot3CooldownText.textContent = remainingSeconds.toFixed(1);
    this.slot3CooldownText.classList.add('visible');
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (!this.isLocked()) return;
    if (this.pauseManager.isPaused) return;

    if (event.code === 'Digit1') { this.trySelect('empty'); return; }
    if (event.code === 'Digit3') { this.trySelect('cargoHook'); return; }
    if (event.code === 'Digit2' || event.code === 'Digit4') {
      this.hud.showToast('尚未解鎖');
    }
  }

  private onWheel(event: WheelEvent): void {
    if (!this.isLocked()) return;
    if (this.pauseManager.isPaused) return;
    if (Math.abs(event.deltaY) < 1) return;
    // Only ever cycles between the two usable slots (spec一: "滑鼠滾輪：只在
    // 目前可用的1與3之間循環") — slots 2/4 are never a wheel destination.
    this.trySelect(this.playerData.activeTool === 'empty' ? 'cargoHook' : 'empty');
  }
}
