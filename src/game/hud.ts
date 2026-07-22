export class HUD {
  private crosshairEl: HTMLElement;
  private promptEl: HTMLElement;
  private instructionsEl: HTMLElement;
  private tooFarEl: HTMLElement;
  private chargeBarContainer: HTMLElement;
  private chargeBarFill: HTMLElement;
  private shipmentSummaryEl: HTMLElement;
  private tooFarTimer: number | null = null;
  private dailyFlowEl: HTMLElement;
  private dailyCompleteEl: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer: number | null = null;
  private dayTransitionEl: HTMLElement;
  private dayTransitionTimer: number | null = null;

  constructor() {
    const hud = document.createElement('div');
    hud.id = 'hud';
    document.body.appendChild(hud);

    this.crosshairEl = document.createElement('div');
    this.crosshairEl.id = 'crosshair';
    this.crosshairEl.textContent = '+';
    hud.appendChild(this.crosshairEl);

    this.promptEl = document.createElement('div');
    this.promptEl.id = 'interaction-prompt';
    hud.appendChild(this.promptEl);

    this.tooFarEl = document.createElement('div');
    this.tooFarEl.id = 'too-far-prompt';
    this.tooFarEl.textContent = '距離太遠';
    hud.appendChild(this.tooFarEl);

    // Charge bar
    this.chargeBarContainer = document.createElement('div');
    this.chargeBarContainer.id = 'charge-bar-container';
    this.chargeBarFill = document.createElement('div');
    this.chargeBarFill.id = 'charge-bar-fill';
    this.chargeBarContainer.appendChild(this.chargeBarFill);
    hud.appendChild(this.chargeBarContainer);

    this.shipmentSummaryEl = document.createElement('div');
    this.shipmentSummaryEl.id = 'shipment-summary';
    hud.appendChild(this.shipmentSummaryEl);

    this.instructionsEl = document.createElement('div');
    this.instructionsEl.id = 'instructions-panel';
    this.instructionsEl.innerHTML = `
      <p>點擊畫面開始</p>
      <p>WASD 移動 ｜ Shift 奔跑</p>
      <p>Space 跳躍</p>
      <p>滑鼠控制視角</p>
      <p>E 拿起物件 / 進入放置模式</p>
      <p>按住 Q 蓄力丟出</p>
      <p>左鍵 確認放置 ｜ 右鍵 取消</p>
      <p>Esc 解除滑鼠鎖定</p>
      <p>Tab 開啟物流手冊</p>
    `;
    hud.appendChild(this.instructionsEl);

    // Daily flow status panel (spec "每日貨品清空核心流程" section 十八) —
    // top-right, deliberately not top-left where CompassUI already sits.
    this.dailyFlowEl = document.createElement('div');
    this.dailyFlowEl.id = 'daily-flow-panel';
    hud.appendChild(this.dailyFlowEl);

    this.dailyCompleteEl = document.createElement('div');
    this.dailyCompleteEl.id = 'daily-complete-banner';
    this.dailyCompleteEl.textContent = '今日貨品已全部清空';
    hud.appendChild(this.dailyCompleteEl);

    this.toastEl = document.createElement('div');
    this.toastEl.id = 'daily-toast';
    hud.appendChild(this.toastEl);

    this.dayTransitionEl = document.createElement('div');
    this.dayTransitionEl.id = 'day-transition';
    hud.appendChild(this.dayTransitionEl);
  }

  /** Daily flow status panel — updated every frame from game.ts's loop
   * (cheap text-only DOM write, same pattern CompassUI already uses). */
  updateDailyFlow(params: { day: number; stateLabel: string; remaining: number; completed: number; total: number }): void {
    const { day, stateLabel, remaining, completed, total } = params;
    this.dailyFlowEl.innerHTML = `
      <p class="daily-flow-day">第 ${day} 天</p>
      <p>今日狀態：${stateLabel}</p>
      <p>今日剩餘貨品：${remaining}</p>
      <p>今日已完成：${completed} / ${total}</p>
    `;
    this.dailyCompleteEl.classList.toggle('visible', remaining === 0 && total > 0);
  }

  /** Brief, non-blocking message (spec: "不要使用 browser alert") — reused
   * for both the outbound zone's "尚未完成整理"/"已送達出貨區" messages and
   * the unload/end-day buttons' blocked reasons. */
  showToast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('visible');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('visible');
      this.toastTimer = null;
    }, 1800);
  }

  /** "第 X 天完成" transition text (spec 十九) — brief, auto-hides, does
   * NOT pause the game (resetting happens instantly under it). */
  showDayTransition(text: string): void {
    this.dayTransitionEl.textContent = text;
    this.dayTransitionEl.classList.add('visible');
    if (this.dayTransitionTimer !== null) window.clearTimeout(this.dayTransitionTimer);
    this.dayTransitionTimer = window.setTimeout(() => {
      this.dayTransitionEl.classList.remove('visible');
      this.dayTransitionTimer = null;
    }, 2000);
  }

  showInstructions(): void { this.instructionsEl.classList.remove('hidden'); }
  hideInstructions(): void { this.instructionsEl.classList.add('hidden'); }

  showInteractionPrompt(name: string, action: string): void {
    this.promptEl.textContent = `${name}\n${action}`;
    this.promptEl.style.whiteSpace = 'pre-line';
    this.promptEl.classList.add('visible');
  }
  hideInteractionPrompt(): void { this.promptEl.classList.remove('visible'); }

  setCrosshairActive(active: boolean): void {
    this.crosshairEl.classList.toggle('active', active);
  }

  showTooFar(): void {
    this.tooFarEl.classList.add('visible');
    if (this.tooFarTimer !== null) window.clearTimeout(this.tooFarTimer);
    this.tooFarTimer = window.setTimeout(() => {
      this.tooFarEl.classList.remove('visible');
      this.tooFarTimer = null;
    }, 2000);
  }

  showPlacementPrompt(isValid: boolean): void {
    this.promptEl.textContent = isValid ? '左鍵：放置\n右鍵：取消' : '此處無法放置\n右鍵：取消';
    this.promptEl.style.whiteSpace = 'pre-line';
    this.promptEl.classList.add('visible');
  }

  showChargeBar(ratio: number): void {
    this.chargeBarContainer.classList.add('visible');
    this.chargeBarFill.style.width = `${ratio * 100}%`;
    // Color gradient: green to yellow to red
    if (ratio < 0.5) {
      this.chargeBarFill.style.backgroundColor = '#44ff44';
    } else if (ratio < 0.8) {
      this.chargeBarFill.style.backgroundColor = '#ffcc00';
    } else {
      this.chargeBarFill.style.backgroundColor = '#ff4444';
    }
  }

  hideChargeBar(): void {
    this.chargeBarContainer.classList.remove('visible');
    this.chargeBarFill.style.width = '0%';
  }

  /** Combined land+sea settlement panel (spec section 十五/十九) — shown
   * only once BOTH routes have finished departing, stays open (game paused
   * behind it) until the player clicks 繼續. Each route's breakdown always
   * satisfies correctCount+incompatibleCount === loadedCount
   * (see cargo-compliance.ts / vehicle-control-system.ts). */
  showVehicleSettlement(params: {
    land: { vehicleName: string; loadedCount: number; correctCount: number; incompatibleCount: number; scoreChange: number };
    sea: { vehicleName: string; loadedCount: number; correctCount: number; incompatibleCount: number; scoreChange: number };
    totalCount: number;
    totalCorrect: number;
    totalIncorrect: number;
    totalScoreChange: number;
    cumulativeScore: number;
    onContinue: () => void;
  }): void {
    const { land, sea, totalCount, totalCorrect, totalIncorrect, totalScoreChange, cumulativeScore, onContinue } = params;
    const landEmpty = land.loadedCount === 0;
    const seaEmpty = sea.loadedCount === 0;

    let emptyNote = '';
    if (landEmpty && seaEmpty) emptyNote = '<p class="summary-empty">本次陸運與海運皆為空載</p>';
    else if (landEmpty) emptyNote = '<p class="summary-empty">陸運本次空載出發</p>';
    else if (seaEmpty) emptyNote = '<p class="summary-empty">海運本次空載出發</p>';

    const routeBlock = (label: string, r: typeof land) => `
      <div class="summary-route">
        <p class="summary-route-title">${label}：${r.vehicleName}</p>
        <p>本次裝載件數：${r.loadedCount} 件</p>
        <p>正確受理：${r.correctCount} 件　不相容貨物：${r.incompatibleCount} 件</p>
        <p>${label}分數變化：${r.scoreChange >= 0 ? '+' : ''}${r.scoreChange}</p>
      </div>`;

    this.shipmentSummaryEl.innerHTML = `
      <p class="summary-title">兩台載具已出發</p>
      ${emptyNote}
      ${routeBlock('陸運', land)}
      ${routeBlock('海運', sea)}
      <p>本次總件數：${totalCount} 件</p>
      <p>本次正確件數：${totalCorrect} 件　本次錯誤件數：${totalIncorrect} 件</p>
      <p>本次總分變化：${totalScoreChange >= 0 ? '+' : ''}${totalScoreChange}</p>
      <p>累積分數：${cumulativeScore}</p>
      <p class="summary-note">（原型暫定計分，僅供測試，非正式規格）</p>
      <button id="settlement-continue-btn">繼續</button>
    `;
    this.shipmentSummaryEl.classList.add('visible');
    const btn = this.shipmentSummaryEl.querySelector('#settlement-continue-btn') as HTMLButtonElement;
    btn.addEventListener('click', () => {
      this.hideVehicleSettlement();
      onContinue();
    }, { once: true });
  }

  hideVehicleSettlement(): void {
    this.shipmentSummaryEl.classList.remove('visible');
  }
}
