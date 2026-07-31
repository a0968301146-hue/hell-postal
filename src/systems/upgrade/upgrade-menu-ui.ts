// Full-screen "物流中心公告欄" upgrade UI ("Add bulletin board upgrade
// system" round spec三). Display + input only — every actual state change
// goes through UpgradeSystem.purchaseUpgrade(), never touched directly here
// (spec三: "UI不得直接修改玩家資料，只能呼叫UpgradeSystem的公開
// purchaseUpgrade()").
import { PauseManager } from '../../core/pause-manager';
import { HUD } from '../hud';
import { PlayerController } from '../player';
import { UpgradeSystem } from './upgrade-system';
import { UpgradeId } from './upgrade-types';

export class UpgradeMenuUI {
  private pauseManager: PauseManager;
  private playerController: PlayerController;
  private upgradeSystem: UpgradeSystem;

  private overlayEl: HTMLElement;
  private listEl: HTMLElement;
  private pointsEl: HTMLElement;
  private _isOpen = false;

  constructor(pauseManager: PauseManager, _hud: HUD, playerController: PlayerController, upgradeSystem: UpgradeSystem) {
    this.pauseManager = pauseManager;
    this.playerController = playerController;
    this.upgradeSystem = upgradeSystem;

    this.overlayEl = document.createElement('div');
    this.overlayEl.id = 'upgrade-menu-overlay';
    this.overlayEl.innerHTML = `
      <div class="upgrade-menu-backdrop"></div>
      <div class="upgrade-menu-panel">
        <button id="upgrade-menu-close-btn" aria-label="關閉公告欄">✕</button>
        <h2 class="upgrade-menu-title">物流中心公告欄</h2>
        <p class="upgrade-menu-points">可用結算分數：<span id="upgrade-points-value">0</span></p>
        <div class="upgrade-menu-list"></div>
      </div>
    `;
    document.body.appendChild(this.overlayEl);

    this.listEl = this.overlayEl.querySelector('.upgrade-menu-list')!;
    this.pointsEl = this.overlayEl.querySelector('#upgrade-points-value')!;

    this.overlayEl.querySelector('#upgrade-menu-close-btn')!.addEventListener('click', () => this.close());
    this.overlayEl.querySelector('.upgrade-menu-backdrop')!.addEventListener('click', () => this.close());
    this.overlayEl.addEventListener('click', (e) => this.onClick(e));
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  open(): void {
    if (this._isOpen) return;
    this._isOpen = true;
    this.pauseManager.add('upgradeMenu');
    document.exitPointerLock();
    document.body.style.cursor = '';
    this.overlayEl.classList.add('open');
    this.render();
  }

  close(): void {
    if (!this._isOpen) return;
    this._isOpen = false;
    this.overlayEl.classList.remove('open');
    this.pauseManager.remove('upgradeMenu');
    // Spec三 explicitly wants pointer lock RE-ACQUIRED on close (unlike the
    // manual/stamp-minigame's own "wait for the next canvas click"
    // convention) — reuses PlayerController's existing requestLock(),
    // which was already exposed publicly for exactly this purpose (see
    // player-system.ts's own doc comment on that method). This close()
    // call is itself always the direct result of a user gesture (the ESC
    // keydown or the close-button click that reached here), so the
    // browser's fresh-gesture-per-lock-request rule is satisfied. Never a
    // second pause/pointer-lock system — same PauseManager, same
    // PointerLockControls instance every other pause path already uses.
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
    const buyBtn = target.closest<HTMLElement>('[data-buy-upgrade]');
    if (buyBtn && !buyBtn.hasAttribute('disabled')) {
      const id = buyBtn.dataset.buyUpgrade as UpgradeId;
      this.upgradeSystem.purchaseUpgrade(id);
      this.render();
    }
  }

  private render(): void {
    this.pointsEl.textContent = String(this.upgradeSystem.availableSettlementScore);

    const rows = this.upgradeSystem.getDefinitions().map((def) => {
      const level = this.upgradeSystem.getLevel(def.id);
      const maxed = this.upgradeSystem.isMaxed(def.id);
      const nextCost = this.upgradeSystem.getNextCost(def.id);
      const affordable = nextCost !== null && this.upgradeSystem.availableSettlementScore >= nextCost;
      const nextEffect = !maxed ? def.levelEffects[level + 1].description : '';

      return `
        <div class="upgrade-row">
          <div class="upgrade-row-header">
            <span class="upgrade-row-name">${def.displayName}</span>
            <span class="upgrade-row-level">Lv.${level} / ${def.maxLevel}</span>
          </div>
          <p class="upgrade-row-desc">${def.description}</p>
          <p class="upgrade-row-current">目前效果：${def.levelEffects[level].description}</p>
          ${maxed
            ? '<p class="upgrade-row-maxed">已滿級</p>'
            : `
              <p class="upgrade-row-next">下一級效果：${nextEffect}</p>
              <button class="upgrade-buy-btn" data-buy-upgrade="${def.id}" ${affordable ? '' : 'disabled'}>升級（消耗 ${nextCost} 分）</button>
            `}
        </div>`;
    }).join('');

    this.listEl.innerHTML = rows;
  }
}
