export class HUD {
  private crosshairEl: HTMLElement;
  private promptEl: HTMLElement;
  private instructionsEl: HTMLElement;
  private tooFarEl: HTMLElement;
  private chargeBarContainer: HTMLElement;
  private chargeBarFill: HTMLElement;
  private shipmentSummaryEl: HTMLElement;
  private tooFarTimer: number | null = null;

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
    `;
    hud.appendChild(this.instructionsEl);
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

  /** Prototype-only vehicle settlement panel — stays open (game is paused
   * behind it) until the player clicks 繼續. Shared by both land and sea
   * departures; `transportType` is just a display label ('陸運'/'海運'). */
  showVehicleSettlement(params: {
    vehicleName: string;
    transportType: string;
    normalCount: number;
    largeCount: number;
    runScore: number;
    totalScore: number;
    onContinue: () => void;
  }): void {
    const { vehicleName, transportType, normalCount, largeCount, runScore, totalScore, onContinue } = params;
    const total = normalCount + largeCount;
    this.shipmentSummaryEl.innerHTML = `
      <p class="summary-title">${vehicleName}已出發</p>
      <p>運輸類型：${transportType}</p>
      ${total === 0 ? '<p class="summary-empty">本次空載出發</p>' : ''}
      <p>本次送出總件數：${total} 件</p>
      <p>普通貨物：${normalCount} 件</p>
      <p>大型貨物：${largeCount} 件</p>
      <p>本次分數：${runScore}</p>
      <p>累積分數：${totalScore}</p>
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
