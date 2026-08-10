// "Add ladder tool station and envelope vacuum" round三 — the tool cart's
// swap UI, structurally mirroring upgrade-menu-ui.ts's own
// open()/close()/PauseManager/pointer-lock pattern exactly (same "world
// object triggers an external full-screen overlay" convention as the
// bulletin board's UpgradeMenuUI / television's MediaPlayerUI).
import { PauseManager } from '../../core/pause-manager';
import { PlayerController } from '../player';
import { HUD } from '../hud';
import { ToolSystem } from './tool-system';
import { ConfigurableTool, ALL_CONFIGURABLE_TOOLS, TOOL_DEFINITIONS, loadToolLoadout, saveToolLoadout } from './tool-loadout-data';
import { isToolUnlockedOnDay } from '../../data/daily-unlock-data';

export class ToolLoadoutMenuUI {
  private pauseManager: PauseManager;
  private playerController: PlayerController;
  private toolSystem: ToolSystem;
  private hud: HUD;
  /** "Day 1～7 每日內容與解鎖規格" round — see tool-system.ts's own
   * getCurrentDay field doc comment for the same reasoning. */
  private getCurrentDay: () => number;

  private overlayEl: HTMLElement;
  private slotsEl: HTMLElement;
  private poolEl: HTMLElement;
  private _isOpen = false;

  /** Scratch copy edited live while the UI is open — only written to
   * storage/ToolSystem on close (spec: "儲存後立即刷新Hotbar" — the commit
   * point is close, not each individual swap, so a player can freely
   * re-arrange without every intermediate click taking effect on the live
   * hotbar mid-edit). */
  private scratchLoadout: [ConfigurableTool, ConfigurableTool, ConfigurableTool] = ['powerGloves', 'cargoHook', 'sprayCan'];
  /** Which of slots 2-4 (index 0-2 into scratchLoadout) is armed, waiting
   * for the player to click a tool in the right-side pool to swap into it —
   * spec三: "先點第2～4格，再點工具即可替換". */
  private armedSlotIndex: 0 | 1 | 2 | null = null;

  constructor(
    pauseManager: PauseManager, playerController: PlayerController, toolSystem: ToolSystem, hud: HUD,
    getCurrentDay: () => number
  ) {
    this.pauseManager = pauseManager;
    this.playerController = playerController;
    this.toolSystem = toolSystem;
    this.hud = hud;
    this.getCurrentDay = getCurrentDay;

    this.overlayEl = document.createElement('div');
    this.overlayEl.id = 'tool-loadout-overlay';
    this.overlayEl.innerHTML = `
      <div class="tool-loadout-backdrop"></div>
      <div class="tool-loadout-panel">
        <button id="tool-loadout-close-btn" aria-label="關閉工具配置">✕</button>
        <h2 class="tool-loadout-title">工具配置</h2>
        <div class="tool-loadout-body">
          <div class="tool-loadout-slots"></div>
          <div class="tool-loadout-pool"></div>
        </div>
        <p class="tool-loadout-hint">先點選要替換的欄位，再點選右側工具即可替換。第1格永遠是空手，無法更改。</p>
      </div>
    `;
    document.body.appendChild(this.overlayEl);

    this.slotsEl = this.overlayEl.querySelector('.tool-loadout-slots')!;
    this.poolEl = this.overlayEl.querySelector('.tool-loadout-pool')!;

    this.overlayEl.querySelector('#tool-loadout-close-btn')!.addEventListener('click', () => this.close());
    this.overlayEl.querySelector('.tool-loadout-backdrop')!.addEventListener('click', () => this.close());
    this.overlayEl.addEventListener('click', (e) => this.onClick(e));
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  open(): void {
    if (this._isOpen) return;
    this._isOpen = true;
    this.pauseManager.add('toolLoadoutMenu');
    document.exitPointerLock();
    document.body.style.cursor = '';
    this.scratchLoadout = [...loadToolLoadout()];
    this.armedSlotIndex = null;
    this.overlayEl.classList.add('open');
    this.render();
  }

  close(): void {
    if (!this._isOpen) return;
    this._isOpen = false;
    this.overlayEl.classList.remove('open');
    this.pauseManager.remove('toolLoadoutMenu');
    saveToolLoadout(this.scratchLoadout);
    // Spec三: "儲存後立即刷新Hotbar圖示與數字鍵對應" — and, if the tool
    // currently selected got swapped out, setLoadout itself normalizes back
    // to slot 1 (spec: "關閉UI後自動切回第1格空手").
    this.toolSystem.setLoadout(this.scratchLoadout);
    // Same "pointer lock re-acquired on close" convention as UpgradeMenuUI.
    this.playerController.requestLock();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this._isOpen) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;

    const slotEl = target.closest<HTMLElement>('[data-loadout-slot]');
    if (slotEl) {
      const idx = Number(slotEl.dataset.loadoutSlot);
      if (Number.isNaN(idx)) return; // slot 1 (locked) has no data-loadout-slot at all
      this.armedSlotIndex = this.armedSlotIndex === idx ? null : (idx as 0 | 1 | 2);
      this.render();
      return;
    }

    const toolEl = target.closest<HTMLElement>('[data-loadout-tool]');
    if (toolEl && this.armedSlotIndex !== null) {
      const chosen = toolEl.dataset.loadoutTool as ConfigurableTool;
      // "Day 1～7 每日內容與解鎖規格" round — a tool not yet open today can't
      // be swapped INTO an active slot (it can still sit unequipped at the
      // cart, same as before this round).
      if (!isToolUnlockedOnDay(chosen, this.getCurrentDay())) {
        this.hud.showToast('此道具尚未解鎖');
        return;
      }
      const existingIndex = this.scratchLoadout.indexOf(chosen);
      if (existingIndex === this.armedSlotIndex) {
        // Clicked the tool already in the armed slot — nothing to do.
        this.armedSlotIndex = null;
        this.render();
        return;
      }
      if (existingIndex !== -1) {
        // Already equipped in ANOTHER slot — swap the two slots' tools
        // (spec: "不允許相同工具重複放入多格", satisfied by construction
        // since this always stays a permutation of 3 distinct tools).
        const prevInArmedSlot = this.scratchLoadout[this.armedSlotIndex];
        this.scratchLoadout[this.armedSlotIndex] = chosen;
        this.scratchLoadout[existingIndex] = prevInArmedSlot;
      } else {
        // Currently left at the cart (the 4th, unequipped tool) — just
        // drops straight into the armed slot, and whatever it replaced
        // goes back to being the one left at the cart.
        this.scratchLoadout[this.armedSlotIndex] = chosen;
      }
      this.armedSlotIndex = null;
      this.render();
    }
  }

  private render(): void {
    const slotTools: (ConfigurableTool | 'empty')[] = ['empty', ...this.scratchLoadout];
    this.slotsEl.innerHTML = slotTools.map((tool, i) => {
      const def = TOOL_DEFINITIONS[tool];
      if (i === 0) {
        // "Add regional envelope dispatch machine" round一: no lock icon —
        // the "(固定)" suffix alone communicates it can't be replaced.
        // Still has no data-loadout-slot attribute, so onClick's own
        // delegated handler never arms it for replacement.
        return `
          <div class="tool-loadout-slot locked">
            <span class="tool-loadout-slot-key">1</span>
            <span class="tool-loadout-slot-icon">${def.icon}</span>
            <span class="tool-loadout-slot-name">${def.displayName}（固定）</span>
          </div>`;
      }
      const scratchIndex = i - 1;
      const armed = this.armedSlotIndex === scratchIndex;
      return `
        <div class="tool-loadout-slot ${armed ? 'armed' : ''}" data-loadout-slot="${scratchIndex}">
          <span class="tool-loadout-slot-key">${i + 1}</span>
          <span class="tool-loadout-slot-icon">${def.icon}</span>
          <span class="tool-loadout-slot-name">${def.displayName}</span>
        </div>`;
    }).join('');

    const cartTool = ALL_CONFIGURABLE_TOOLS.find((t) => !this.scratchLoadout.includes(t)) ?? null;
    const day = this.getCurrentDay();
    this.poolEl.innerHTML = ALL_CONFIGURABLE_TOOLS.map((tool) => {
      const def = TOOL_DEFINITIONS[tool];
      const equippedSlotIndex = this.scratchLoadout.indexOf(tool);
      const isAtCart = tool === cartTool;
      // "Day 1～7 每日內容與解鎖規格" round — purely a visual hint (see
      // onClick's own real block above for the actual enforcement).
      const locked = !isToolUnlockedOnDay(tool, day);
      const statusText = locked ? '🔒 尚未解鎖' : isAtCart ? '推車內' : `第 ${equippedSlotIndex + 2} 格`;
      return `
        <div class="tool-loadout-pool-item ${isAtCart ? 'at-cart' : 'equipped'} ${locked ? 'locked' : ''}" data-loadout-tool="${tool}">
          <span class="tool-loadout-pool-icon">${def.icon}</span>
          <span class="tool-loadout-pool-name">${def.displayName}</span>
          <span class="tool-loadout-pool-status">${statusText}</span>
        </div>`;
    }).join('');
  }
}
